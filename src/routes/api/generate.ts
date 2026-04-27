import { createFileRoute } from "@tanstack/react-router";
import OpenAI, { APIError } from "openai";
import { YoutubeTranscript } from "youtube-transcript";
import { getTweet } from "react-tweet/api";
import { sanitizeGenerateRequestPayload, sanitizeGeneration } from "@/lib/canvas-sanitize";
import type { GenerateRequestItem } from "@/lib/types";
import { extractYouTubeId, extractTweetId } from "@/lib/youtube";

const SYSTEM_PROMPT = `You are a content summarizer for Shareboard, a sharing tool. The user has collected links, notes, and screenshots to share.

Your job:
1. For each item, produce a concise summary (1-2 sentences), extract the title, identify the author if possible, and pull one key quote if relevant.
2. Write an overall explanation (2-4 paragraphs, markdown) that connects all items into a coherent narrative about what the user is sharing and why.
3. Generate a catchy title for the collection.
4. Suggest 3-5 topic tags.

Use web_search to look up URLs you don't have context for.

IMPORTANT:
- Only state facts you can verify from the content. Never fabricate quotes, stats, or claims.
- If you cannot access a URL, say so in the summary rather than guessing its content.
- If a YouTube transcript is provided, use it as the primary source for that video's summary.
- If tweet text is provided, use it as the primary source for that tweet's summary. Do NOT try to fetch the tweet URL. Any input_image attachments immediately after a tweet's text come from that tweet — describe relevant visual content when summarizing.
- Be concise, clear, and factual.`;

const RESPONSE_SCHEMA = {
  type: "object" as const,
  properties: {
    item_summaries: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          item_id: { type: "string" as const },
          title: { type: "string" as const },
          summary: { type: "string" as const },
          source_type: { type: "string" as const },
          author: { type: "string" as const },
          key_quote: { type: "string" as const },
        },
        required: ["item_id", "title", "summary", "source_type", "author", "key_quote"] as const,
        additionalProperties: false as const,
      },
    },
    overall_summary: {
      type: "object" as const,
      properties: {
        title: { type: "string" as const },
        explanation: { type: "string" as const },
        tags: { type: "array" as const, items: { type: "string" as const } },
      },
      required: ["title", "explanation", "tags"] as const,
      additionalProperties: false as const,
    },
  },
  required: ["item_summaries", "overall_summary"] as const,
  additionalProperties: false as const,
};

async function getYouTubeTranscript(videoId: string): Promise<string | null> {
  try {
    const segments = await YoutubeTranscript.fetchTranscript(videoId);
    return segments.map((s) => s.text).join(" ");
  } catch {
    return null;
  }
}

// Shape: { text: "Palantir CEO...", author: "Chubby♨️ (@kimmonismus)", photos: ["https://pbs.twimg.com/media/HFt_gasaUAA4jYY.jpg"] }
async function getTweetData(
  tweetId: string,
): Promise<{ text: string; author: string; photos: string[] } | null> {
  try {
    const tweet = await getTweet(tweetId);
    if (!tweet) return null;

    // react-tweet's public Tweet type omits note_tweet and mediaDetails; reach
    // for them via a widened shape so we can recover long-tweet bodies (>280
    // chars live in note_tweet) and attach photos as multimodal inputs.
    const extra = tweet as typeof tweet & {
      note_tweet?: { note_tweet_results?: { result?: { text?: string } } };
      mediaDetails?: Array<{ type: string; media_url_https: string }>;
    };

    const longText = extra.note_tweet?.note_tweet_results?.result?.text;
    const text = longText && longText.length > tweet.text.length ? longText : tweet.text;

    const photos = (extra.mediaDetails ?? [])
      .filter((m) => m.type === "photo")
      .map((m) => m.media_url_https);

    return {
      text,
      author: `${tweet.user.name} (@${tweet.user.screen_name})`,
      photos,
    };
  } catch {
    return null;
  }
}

function parseJson(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/api/generate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = request.headers.get("x-api-key");
        if (!apiKey) {
          return Response.json({ error: "Missing API key" }, { status: 401 });
        }

        const body = (await request.json().catch(() => null)) as unknown;
        const payload = sanitizeGenerateRequestPayload(body);
        if (!payload) {
          return Response.json({ error: "Invalid request body" }, { status: 400 });
        }
        const { items } = payload;
        if (!items.length) {
          return Response.json({ error: "No items provided" }, { status: 400 });
        }

        const transcripts = new Map<string, string>();
        const tweetData = new Map<string, { text: string; author: string; photos: string[] }>();

        await Promise.all(
          items.map(async (item) => {
            if (item.type !== "url") return;

            if (item.platform === "youtube") {
              const videoId = extractYouTubeId(item.url);
              if (!videoId) return;
              const transcript = await getYouTubeTranscript(videoId);
              if (transcript) transcripts.set(item.id, transcript);
            }

            if (item.platform === "twitter") {
              const tweetId = extractTweetId(item.url);
              if (!tweetId) return;
              const data = await getTweetData(tweetId);
              if (data) tweetData.set(item.id, data);
            }
          })
        );

        // shape: [{type:"input_text", text:"[1] URL..."}, {type:"input_image", image_url:"https://pbs.twimg.com/media/..."}, ...]
        type UserContent =
          | { type: "input_text"; text: string }
          | { type: "input_image"; image_url: string; detail: "low" };
        const userContent: UserContent[] = [];

        items.forEach((item: GenerateRequestItem, i) => {
          if (item.type === "url") {
            let line = `[${i + 1}] URL (id: ${item.id}, platform: ${item.platform}): ${item.url}`;
            const transcript = transcripts.get(item.id);
            if (transcript) {
              line += `\n    [YouTube Transcript]: ${transcript.slice(0, 3000)}`;
            }
            const data = tweetData.get(item.id);
            if (data) {
              line += `\n    [Tweet Author]: ${data.author}`;
              line += `\n    [Tweet Text]: ${data.text}`;
              if (data.photos.length > 0) {
                line += `\n    [Tweet Images]: ${data.photos.length} image${data.photos.length === 1 ? "" : "s"} attached below (from this tweet).`;
              }
            }
            userContent.push({ type: "input_text", text: line });
            if (data) {
              for (const url of data.photos) {
                userContent.push({ type: "input_image", image_url: url, detail: "low" });
              }
            }
            return;
          }
          if (item.type === "note") {
            userContent.push({ type: "input_text", text: `[${i + 1}] Note (id: ${item.id}): ${item.text}` });
            return;
          }
          if (item.type === "image") {
            userContent.push({
              type: "input_text",
              text: `[${i + 1}] Screenshot (id: ${item.id}): ${item.caption || "No caption"}`,
            });
          }
        });

        try {
          const openai = new OpenAI({ apiKey });

          const response = await openai.responses.create({
            model: "gpt-5.4-mini",
            input: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: userContent },
            ],
            tools: [{ type: "web_search_preview" }],
            text: {
              format: {
                type: "json_schema",
                name: "canvas_summary",
                strict: true,
                schema: RESPONSE_SCHEMA,
              },
            },
          });

          const message = response.output.find(
            (o): o is Extract<typeof o, { type: "message" }> => o.type === "message"
          );
          const textContent = message?.content.find(
            (c): c is Extract<typeof c, { type: "output_text" }> => c.type === "output_text"
          );

          if (!textContent?.text) {
            return Response.json({ error: "No response from model" }, { status: 502 });
          }

          const parsed = sanitizeGeneration(parseJson(textContent.text));
          if (!parsed) {
            return Response.json({ error: "Invalid model response" }, { status: 502 });
          }
          return Response.json(parsed);
        } catch (err: unknown) {
          if (err instanceof APIError) {
            return Response.json(
              { error: err.message },
              { status: err.status && err.status >= 400 && err.status < 600 ? err.status : 502 }
            );
          }
          return Response.json({ error: "Generation failed" }, { status: 500 });
        }
      },
    },
  },
});
