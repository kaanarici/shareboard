import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { currentAuthor, isSetup, readProfileDraft, saveProfileDraft } from "./store";

const globals: Record<string, unknown> = globalThis;

beforeEach(() => {
  const values = new Map<string, string>();
  globals.window = globalThis;
  globals.localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
});

afterEach(() => {
  delete globals.window;
  delete globals.localStorage;
});

describe("profile settings", () => {
  test("trims on save, keeps an existing name when the new one is blank, and drops empty links", () => {
    saveProfileDraft({ name: "  Ada ", xUrl: " https://x.com/ada ", instagramUrl: "", linkedinUrl: "  " });
    expect(isSetup()).toBe(true);
    expect(currentAuthor()).toEqual({ author: "Ada", authorProfile: { xUrl: "https://x.com/ada" } });

    saveProfileDraft({ name: "   ", xUrl: "", instagramUrl: "", linkedinUrl: "" });
    expect(readProfileDraft()).toEqual({ name: "Ada", xUrl: "", instagramUrl: "", linkedinUrl: "" });
  });

  test("adds https to links typed without a scheme", () => {
    saveProfileDraft({ name: "Ada", xUrl: "x.com/ada", instagramUrl: "  instagram.com/ada ", linkedinUrl: "http://linkedin.com/in/ada" });
    expect(currentAuthor().authorProfile).toEqual({
      xUrl: "https://x.com/ada",
      instagramUrl: "https://instagram.com/ada",
      linkedinUrl: "http://linkedin.com/in/ada",
    });
  });

  test("ignores corrupt stored profiles", () => {
    localStorage.setItem("shareboard_profile", "{not json");
    expect(readProfileDraft()).toEqual({ name: "", xUrl: "", instagramUrl: "", linkedinUrl: "" });
    expect(isSetup()).toBe(false);
  });
});
