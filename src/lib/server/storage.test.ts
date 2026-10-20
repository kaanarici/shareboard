import { afterEach, describe, expect, test } from "bun:test";
import { resetServerEnv, useMemoryStorage } from "@/test/memory-bucket";
import { putObject } from "./storage";

afterEach(() => {
  resetServerEnv();
});

describe("conditional writes", () => {
  test("report precondition failures without overwriting", async () => {
    const bucket = useMemoryStorage();
    expect(await putObject("canvases/a.json", "1", "application/json", { kind: "absent" })).toBe(true);
    expect(await putObject("canvases/a.json", "2", "application/json", { kind: "absent" })).toBe(false);
    expect(await putObject("canvases/a.json", "3", "application/json", { kind: "etag", etag: "stale" })).toBe(false);
    expect(bucket.text("canvases/a.json")).toBe("1");
  });

  test("refuse unsafe keys before touching storage", async () => {
    useMemoryStorage();
    for (const key of ["../x", "a//b", "/abs", "a/../b", "a\\b", ""]) {
      await expect(putObject(key, "x", "text/plain")).rejects.toThrow("Invalid storage key");
    }
  });
});
