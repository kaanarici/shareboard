import { afterEach, describe, expect, test } from "bun:test";
import { setServerEnvForTesting } from "./env";
import { createPinVerifier, LockedStorageSecretError, lockedManifestKey, verifyPin } from "./locked-share";

afterEach(() => {
  setServerEnvForTesting(undefined);
});

describe("locked share keys", () => {
  test("outside a Vite dev build, a missing secret is an error rather than a default", async () => {
    setServerEnvForTesting({});
    await expect(lockedManifestKey("board")).rejects.toBeInstanceOf(LockedStorageSecretError);
    setServerEnvForTesting({ SHAREBOARD_LOCKED_STORAGE_SECRET: "   " });
    await expect(lockedManifestKey("board")).rejects.toBeInstanceOf(LockedStorageSecretError);
  });

  test("manifest keys depend on the secret and do not reveal the board id", async () => {
    setServerEnvForTesting({ SHAREBOARD_LOCKED_STORAGE_SECRET: "one" });
    const first = await lockedManifestKey("board-id-1234567890");
    setServerEnvForTesting({ SHAREBOARD_LOCKED_STORAGE_SECRET: "two" });
    const second = await lockedManifestKey("board-id-1234567890");
    expect(first).toMatch(/^locked\/[A-Za-z0-9_-]{43}\.json$/);
    expect(first).not.toBe(second);
    expect(first).not.toContain("board-id");
  });

  test("PIN verifiers accept only the right PIN and reject tampered parameters", async () => {
    const verifier = await createPinVerifier("123456");
    expect(await verifyPin("123456", verifier)).toBe(true);
    expect(await verifyPin("123457", verifier)).toBe(false);
    expect(await verifyPin("123456", { ...verifier, iterations: 1 })).toBe(false);
    expect(await verifyPin("123456", { ...verifier, hash: "AAAA" })).toBe(false);
  });
});
