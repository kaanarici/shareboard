import { createFileRoute } from "@tanstack/react-router";
import OpenAI from "openai";
import { YoutubeTranscript } from "youtube-transcript";
import { getTweet } from "react-tweet/api";
import type { CanvasItem } from "@/lib/types";
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
- If tweet text is provided, use it as the primary source for that tweet's summary. Do NOT try to fetch the tweet URL.
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

async function getTweetText(tweetId: string): Promise<{ text: string; author: string } | null> {
  try {
    const tweet = await getTweet(tweetId);
    if (!tweet) return null;
    return {
      text: tweet.text,
      author: `${tweet.user.name} (@${tweet.user.screen_name})`,
    };
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

        const { items } = (await request.json()) as { items: CanvasItem[] };
        if (!items?.length) {
          return Response.json({ error: "No items provided" }, { status: 400 });
        }

        const transcripts = new Map<string, string>();
        const tweetTexts = new Map<string, { text: string; author: string }>();

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
              const tweetData = await getTweetText(tweetId);
              if (tweetData) tweetTexts.set(item.id, tweetData);
            }
          })
        );

        const userPrompt = items
          .map((item, i) => {
            if (item.type === "url") {
              let line = `[${i + 1}] URL (id: ${item.id}, platform: ${item.platform}): ${item.url}`;
              const transcript = transcripts.get(item.id);
              if (transcript) {
                line += `\n    [YouTube Transcript]: ${transcript.slice(0, 3000)}`;
              }
              const tweetData = tweetTexts.get(item.id);
              if (tweetData) {
                line += `\n    [Tweet Author]: ${tweetData.author}`;
                line += `\n    [Tweet Text]: ${tweetData.text}`;
              }
              return line;
            }
            if (item.type === "note") return `[${i + 1}] Note (id: ${item.id}): ${item.text}`;
            if (item.type === "image") return `[${i + 1}] Screenshot (id: ${item.id}): ${item.caption || "No caption"}`;
            return "";
          })
          .join("\n\n");

        try {
          const openai = new OpenAI({ apiKey });

          const response = await openai.responses.create({
            model: "gpt-5.4-mini",
            input: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: userPrompt },
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

          return Response.json(JSON.parse(textContent.text));
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Generation failed";
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },
});
