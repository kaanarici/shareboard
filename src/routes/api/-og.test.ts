import { describe, expect, test } from "bun:test";
import { parseOgHtml } from "./og";

describe("og metadata", () => {
  test("reads quoted, reordered and bare attributes without truncating at the other quote", () => {
    const html = `<head>
      <meta content="Kaan's board" property="og:title">
      <meta name='description' content='A "quoted" summary'>
      <meta property=og:site_name content=Example>
      <meta property="og:image" content="/cover.png">
      <title>Fallback</title>
    </head>`;
    expect(parseOgHtml(html, "https://example.com/post")).toEqual({
      title: "Kaan's board",
      description: 'A "quoted" summary',
      image: "https://example.com/cover.png",
      siteName: "Example",
      author: undefined,
    });
  });

  test("decodes entities once and falls back to the title tag", () => {
    const html = `<title>Tom &amp;amp; Jerry &#39;s &#x26; more</title><meta name="author" content="A &lt;b&gt;">`;
    expect(parseOgHtml(html, "https://example.com/")).toMatchObject({ title: "Tom &amp; Jerry 's & more", author: "A <b>" });
  });

  test("drops non-http images and keeps the first occurrence of a property", () => {
    const html = `<meta property="og:image" content="javascript:alert(1)"><meta property="og:title" content="First"><meta property="og:title" content="Second">`;
    expect(parseOgHtml(html, "https://example.com/")).toMatchObject({ title: "First", image: undefined });
  });
});
