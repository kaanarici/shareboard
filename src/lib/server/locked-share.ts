import { createHash, pbkdf2, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { EncryptedCanvasEnvelope } from "@/lib/types";

const LOCKED_PIN_ITERATIONS = 100_000;
const pbkdf2Async = promisify(pbkdf2);

type PinVerifier = NonNullable<EncryptedCanvasEnvelope["pinVerifier"]>;

/**
 * Locked envelopes live at `locked/sha256(secret:id)` in the same bucket that
 * `R2_PUBLIC_URL` exposes for direct public reads. With a public bucket URL,
 * anyone who knows a board id could otherwise fetch the envelope directly and
 * brute-force its 6-digit PIN offline — so key derivation must use a real
 * secret exactly when `R2_PUBLIC_URL` is set. Without it (local dev/preview),
 * objects are only reachable through the share route, which never serves
 * `locked/` keys, so the well-known fallback is safe.
 */
async function getLockedStorageSecret() {
  try {
    const cf = await import(/* @vite-ignore */ "cloudflare:workers");
    const secret = String(cf.env?.SHAREBOARD_LOCKED_STORAGE_SECRET ?? "").trim();
    if (secret) return secret;
    if (!String(cf.env?.R2_PUBLIC_URL ?? "").trim()) return "shareboard-local-locked-storage";
  } catch {
    // Local preview falls back below.
  }
  const secret = String(process.env.SHAREBOARD_LOCKED_STORAGE_SECRET ?? "").trim();
  if (secret) return secret;
  if (!String(process.env.R2_PUBLIC_URL ?? "").trim()) return "shareboard-local-locked-storage";
  throw new Error("Locked share storage secret is not configured");
}

export async function lockedCanvasKey(id: string) {
  const secret = await getLockedStorageSecret();
  const digest = createHash("sha256").update(secret).update(":").update(id).digest("base64url");
  return `locked/${digest}.json`;
}

export async function createPinVerifier(pin: string): Promise<PinVerifier> {
  const salt = randomBytes(16);
  const hash = await pbkdf2Async(pin, salt, LOCKED_PIN_ITERATIONS, 32, "sha256");
  return {
    kdf: "PBKDF2-SHA-256",
    iterations: LOCKED_PIN_ITERATIONS,
    salt: salt.toString("base64url"),
    hash: hash.toString("base64url"),
  };
}

export async function verifyPin(pin: string, verifier: PinVerifier) {
  if (verifier.kdf !== "PBKDF2-SHA-256") return false;
  const expected = Buffer.from(verifier.hash, "base64url");
  const actual = await pbkdf2Async(
    pin,
    Buffer.from(verifier.salt, "base64url"),
    verifier.iterations,
    expected.byteLength,
    "sha256"
  );
  return expected.byteLength === actual.byteLength && timingSafeEqual(expected, actual);
}
