import { describe, expect, test } from "bun:test";
import { JSON_POLICY, isJsonFile, jsonBytesForItems, jsonItemFromFile } from "./json-policy";

describe("json policy", () => {
  test("accepts valid JSON files and normalizes their text", async () => {
    const file = new File(['{"b":2,"a":1}'], "data.json", { type: "application/json" });

    const item = await jsonItemFromFile(file, "json-1");

    expect(item).toEqual({
      id: "json-1",
      type: "json",
      name: "data.json",
      text: '{\n  "b": 2,\n  "a": 1\n}',
      size: 22,
    });
    expect(jsonBytesForItems([item])).toBe(22);
  });

  test("recognizes extension-only JSON files", () => {
    expect(isJsonFile(new File(["{}"], "config.json", { type: "" }))).toBe(true);
    expect(isJsonFile(new File(["{}"], "config.txt", { type: "text/plain" }))).toBe(false);
  });

  test("rejects invalid and oversized JSON files", async () => {
    await expect(jsonItemFromFile(new File(["nope"], "data.json", { type: "application/json" }), "bad")).rejects.toThrow(
      "valid JSON",
    );

    const oversized = new File([" ".repeat(JSON_POLICY.maxFileBytes + 1)], "data.json", {
      type: "application/json",
    });
    await expect(jsonItemFromFile(oversized, "big")).rejects.toThrow("under");
  });
});
