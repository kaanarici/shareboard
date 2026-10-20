import { createHash, pbkdf2, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { isRecord, parseJson } from "@/lib/json";
import { getServerEnv, isDevelopmentBuild } from "@/lib/server/env";
import { HttpError } from "@/lib/server/http";
import { getObjectText, putObject, type WriteCondition } from "@/lib/server/storage";
import type { PinVerifier } from "@/lib/types";

const PIN_ITERATIONS = 100_000;
const DEVELOPMENT_SECRET = "shareboard-local-locked-storage";
const pbkdf2Async = promisify(pbkdf2);

export class LockedStorageSecretError extends HttpError {
  constructor() {
    super("Locked share storage secret is not configured", 503);
    this.name = "LockedStorageSecretError";
  }
}

async function lockedStorageSecret(): Promise<string> {
  const secret = (await getServerEnv()).SHAREBOARD_LOCKED_STORAGE_SECRET?.trim();
  if (secret) return secret;
  if (isDevelopmentBuild()) return DEVELOPMENT_SECRET;
  throw new LockedStorageSecretError();
}

async function lockedManifestDigest(id: string): Promise<string> {
  const secret = await lockedStorageSecret();
  return createHash("sha256").update(secret).update(":").update(id).digest("base64url");
}

export async function lockedManifestKey(id: string): Promise<string> {
  return `locked/${await lockedManifestDigest(id)}.json`;
}

export async function createPinVerifier(pin: string): Promise<PinVerifier> {
  const salt = randomBytes(16);
  const hash = await pbkdf2Async(pin, salt, PIN_ITERATIONS, 32, "sha256");
  return {
    kdf: "PBKDF2-SHA-256",
    iterations: PIN_ITERATIONS,
    salt: salt.toString("base64url"),
    hash: hash.toString("base64url"),
  };
}

export async function verifyPin(pin: string, verifier: PinVerifier): Promise<boolean> {
  const expected = Buffer.from(verifier.hash, "base64url");
  if (expected.byteLength !== 32 || verifier.iterations < 10_000 || verifier.iterations > 1_000_000) return false;
  const actual = await pbkdf2Async(pin, Buffer.from(verifier.salt, "base64url"), verifier.iterations, 32, "sha256");
  return timingSafeEqual(expected, actual);
}

const MAX_UNLOCK_ATTEMPTS_PER_HOUR = 10;
const LEDGER_WRITE_ATTEMPTS = 8;

async function unlockLedgerKey(id: string) {
  return `_shareboard/unlock/${await lockedManifestDigest(id)}.json`;
}

async function updateUnlockLedger(id: string, change: (attempts: number) => number | null): Promise<boolean> {
  const key = await unlockLedgerKey(id);
  const hour = new Date().toISOString().slice(0, 13);
  for (let attempt = 0; attempt < LEDGER_WRITE_ATTEMPTS; attempt += 1) {
    const stored = await getObjectText(key);
    const value = stored ? parseJson(stored.text) : null;
    const current = isRecord(value) && value.hour === hour && typeof value.attempts === "number" ? value.attempts : 0;
    const next = change(current);
    if (next === null) return false;
    const condition: WriteCondition = stored ? { kind: "etag", etag: stored.etag } : { kind: "absent" };
    if (await putObject(key, JSON.stringify({ hour, attempts: next }), "application/json", condition)) return true;
  }
  return false;
}

export function reserveUnlockAttempt(id: string): Promise<boolean> {
  return updateUnlockLedger(id, (attempts) => (attempts < MAX_UNLOCK_ATTEMPTS_PER_HOUR ? attempts + 1 : null));
}

export async function releaseUnlockAttempt(id: string): Promise<void> {
  await updateUnlockLedger(id, (attempts) => Math.max(0, attempts - 1)).catch(() => false);
}
