import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { base64UrlToBytes, bytesToBase64Url } from "@/lib/crypto";
import { isRecord, parseJson, readString } from "@/lib/json";
import { getServerEnv, isDevelopmentBuild } from "@/lib/server/env";
import { HttpError } from "@/lib/server/http";
import { deleteObjectsQuietly, getObjectText, putObject, readJsonRecord, updateJsonRecord } from "@/lib/server/storage";

const ACCOUNT_KEY = "_shareboard/owner/account.json";
const DEV_SETUP_CODE = "shareboard";
const SESSION_COOKIE = "shareboard_owner";
const CHALLENGE_COOKIE = "shareboard_owner_challenge";
const SESSION_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const PAIRING_TTL_MS = 10 * 60 * 1000;
const MAX_SESSIONS = 20;

type ChallengePurpose = "claim" | "signin";

type StoredCredential = {
  id: string;
  publicKey: string;
  counter: number;
  transports?: string[];
  createdAt: string;
};

type StoredSession = {
  id: string;
  tokenHash: string;
  label: string;
  createdAt: string;
};

type Account = {
  v: 1;
  userId: string;
  claimedAt: string;
  credentials: StoredCredential[];
  sessions: StoredSession[];
};

type OwnerDevice = { id: string; label: string; createdAt: string; current: boolean };

export type OwnerStatus =
  | { claimed: false; claimable: boolean; owner: false }
  | { claimed: true; owner: false }
  | { claimed: true; owner: true; devices: OwnerDevice[] };

class OwnerRequiredError extends HttpError {
  constructor() {
    super("Only the owner of this Shareboard can do that", 403);
    this.name = "OwnerRequiredError";
  }
}

function randomToken(bytes = 32): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=") || null;
  }
  return null;
}

function cookie(name: string, value: string, maxAgeSeconds: number, path = "/"): string {
  return `${name}=${value}; Path=${path}; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Strict`;
}

function sessionCookie(token: string): string {
  return cookie(SESSION_COOKIE, token, SESSION_MAX_AGE_SECONDS);
}

export function clearedSessionCookie(): string {
  return cookie(SESSION_COOKIE, "", 0);
}

function challengeCookie(id: string, maxAgeSeconds: number): string {
  return cookie(CHALLENGE_COOKIE, id, maxAgeSeconds, "/api/owner");
}

function relyingParty(request: Request) {
  const url = new URL(request.url);
  return { rpID: url.hostname, origin: url.origin };
}

export function deviceLabel(userAgent: string | null): string {
  const ua = userAgent ?? "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  const system = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS X/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : "";
  return system ? `${browser} on ${system}` : browser;
}

function parseCredential(value: unknown): StoredCredential | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const publicKey = readString(value.publicKey);
  const createdAt = readString(value.createdAt);
  if (!id || !publicKey || !createdAt || typeof value.counter !== "number") return null;
  const credential: StoredCredential = { id, publicKey, counter: value.counter, createdAt };
  if (Array.isArray(value.transports)) {
    credential.transports = value.transports.filter((entry): entry is string => typeof entry === "string");
  }
  return credential;
}

function parseSession(value: unknown): StoredSession | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const tokenHash = readString(value.tokenHash);
  const label = readString(value.label);
  const createdAt = readString(value.createdAt);
  return id && tokenHash && label && createdAt ? { id, tokenHash, label, createdAt } : null;
}

function parseAccount(text: string): Account | null {
  const value = parseJson(text);
  if (!isRecord(value) || value.v !== 1) return null;
  const userId = readString(value.userId);
  const claimedAt = readString(value.claimedAt);
  if (!userId || !claimedAt || !Array.isArray(value.credentials) || !Array.isArray(value.sessions)) return null;
  return {
    v: 1,
    userId,
    claimedAt,
    credentials: value.credentials.map(parseCredential).filter((entry) => entry !== null),
    sessions: value.sessions.map(parseSession).filter((entry) => entry !== null),
  };
}

async function readAccount(): Promise<{ account: Account; etag: string } | null> {
  const stored = await readJsonRecord(ACCOUNT_KEY, parseAccount);
  return stored && { account: stored.value, etag: stored.etag };
}

function updateAccount(change: (current: Account | null) => Account): Promise<Account> {
  return updateJsonRecord(ACCOUNT_KEY, parseAccount, change);
}

async function setupCode(): Promise<string | null> {
  const configured = (await getServerEnv()).SHAREBOARD_SETUP_CODE;
  if (configured !== undefined) return configured.trim() || null;
  return isDevelopmentBuild() ? DEV_SETUP_CODE : null;
}

async function setupCodeMatches(candidate: string): Promise<boolean> {
  const expected = await setupCode();
  if (!expected) return false;
  const [a, b] = await Promise.all([sha256(candidate.trim()), sha256(expected)]);
  return a === b;
}

async function findSession(request: Request): Promise<{ account: Account; session: StoredSession } | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const stored = await readAccount();
  if (!stored) return null;
  const tokenHash = await sha256(token);
  const session = stored.account.sessions.find((entry) => entry.tokenHash === tokenHash);
  return session ? { account: stored.account, session } : null;
}

export async function isOwnerRequest(request: Request): Promise<boolean> {
  return (await findSession(request)) !== null;
}

export async function requireOwner(request: Request): Promise<void> {
  if (!(await isOwnerRequest(request))) throw new OwnerRequiredError();
}

export async function ownerStatus(request: Request): Promise<OwnerStatus> {
  const stored = await readAccount();
  if (!stored) return { claimed: false, claimable: (await setupCode()) !== null, owner: false };
  const found = await findSession(request);
  if (!found) return { claimed: true, owner: false };
  return {
    claimed: true,
    owner: true,
    devices: stored.account.sessions.map((entry) => ({
      id: entry.id,
      label: entry.label,
      createdAt: entry.createdAt,
      current: entry.id === found.session.id,
    })),
  };
}

function challengeKey(id: string) {
  return `_shareboard/owner/challenges/${id}.json`;
}

type Challenge = { challenge: string; userId: string };

const EXPIRED_CHALLENGE = "Passkey request expired. Try again.";

async function storeChallenge(purpose: ChallengePurpose, challenge: Challenge): Promise<string> {
  const id = randomToken(18);
  const record = JSON.stringify({ purpose, ...challenge, expiresAt: Date.now() + CHALLENGE_TTL_MS });
  await putObject(challengeKey(id), record, "application/json", { kind: "absent" });
  return id;
}

async function takeChallenge(request: Request, purpose: ChallengePurpose): Promise<Challenge> {
  const id = readCookie(request, CHALLENGE_COOKIE);
  if (!id || !/^[A-Za-z0-9_-]{16,40}$/.test(id)) throw new HttpError(EXPIRED_CHALLENGE, 400);
  const stored = await getObjectText(challengeKey(id));
  await deleteObjectsQuietly([challengeKey(id)]);
  const value = stored ? parseJson(stored.text) : null;
  if (!isRecord(value) || value.purpose !== purpose || typeof value.expiresAt !== "number" || value.expiresAt < Date.now()) {
    throw new HttpError(EXPIRED_CHALLENGE, 400);
  }
  const challenge = readString(value.challenge);
  const userId = readString(value.userId);
  if (!challenge || userId === null) throw new HttpError(EXPIRED_CHALLENGE, 400);
  return { challenge, userId };
}

export type ChallengeResult = { options: unknown; cookie: string };

export async function startClaim(request: Request, code: string): Promise<ChallengeResult> {
  if (!(await setupCodeMatches(code))) throw new HttpError("That setup code doesn't match", 403);
  const { rpID } = relyingParty(request);
  const userId = (await readAccount())?.account.userId ?? randomToken(32);
  const options = await generateRegistrationOptions({
    rpName: "Shareboard",
    rpID,
    userName: `Owner of ${rpID}`,
    userDisplayName: "Shareboard owner",
    userID: base64UrlToBytes(userId),
    attestationType: "none",
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  });
  const id = await storeChallenge("claim", { challenge: options.challenge, userId });
  return { options, cookie: challengeCookie(id, CHALLENGE_TTL_MS / 1000) };
}

export async function startSignIn(request: Request): Promise<ChallengeResult> {
  const stored = await readAccount();
  if (!stored) throw new HttpError("This Shareboard has no owner yet", 409);
  const { rpID } = relyingParty(request);
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "preferred",
    allowCredentials: stored.account.credentials.map((entry) => ({ id: entry.id, transports: entry.transports })),
  });
  const id = await storeChallenge("signin", { challenge: options.challenge, userId: stored.account.userId });
  return { options, cookie: challengeCookie(id, CHALLENGE_TTL_MS / 1000) };
}

async function newSession(request: Request): Promise<{ token: string; session: StoredSession }> {
  const token = randomToken();
  return {
    token,
    session: {
      id: randomToken(9),
      tokenHash: await sha256(token),
      label: deviceLabel(request.headers.get("user-agent")),
      createdAt: new Date().toISOString(),
    },
  };
}

function withSession(sessions: StoredSession[], session: StoredSession): StoredSession[] {
  return [...sessions, session].slice(-MAX_SESSIONS);
}

export type SessionResult = { cookies: string[] };

export async function finishClaim(request: Request, code: string, response: RegistrationResponseJSON): Promise<SessionResult> {
  if (!(await setupCodeMatches(code))) throw new HttpError("That setup code doesn't match", 403);
  const { challenge, userId } = await takeChallenge(request, "claim");
  const { rpID, origin } = relyingParty(request);
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
  });
  if (!verification.verified) throw new HttpError("Passkey couldn't be verified", 400);
  const { credential } = verification.registrationInfo;
  const { token, session } = await newSession(request);
  const now = new Date().toISOString();
  const stored: StoredCredential = {
    id: credential.id,
    publicKey: bytesToBase64Url(new Uint8Array(credential.publicKey)),
    counter: credential.counter,
    createdAt: now,
  };
  if (credential.transports) stored.transports = credential.transports;
  await updateAccount(() => ({ v: 1, userId, claimedAt: now, credentials: [stored], sessions: [session] }));
  return { cookies: [sessionCookie(token), challengeCookie("", 0)] };
}

export async function finishSignIn(request: Request, response: AuthenticationResponseJSON): Promise<SessionResult> {
  const { challenge } = await takeChallenge(request, "signin");
  const stored = await readAccount();
  if (!stored) throw new HttpError("This Shareboard has no owner yet", 409);
  const credential = stored.account.credentials.find((entry) => entry.id === response.id);
  if (!credential) throw new HttpError("That passkey isn't registered here", 403);
  const { rpID, origin } = relyingParty(request);
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
    credential: {
      id: credential.id,
      publicKey: base64UrlToBytes(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports,
    },
  });
  if (!verification.verified) throw new HttpError("Passkey couldn't be verified", 403);
  const { token, session } = await newSession(request);
  await updateAccount((current) => {
    if (!current) throw new HttpError("This Shareboard has no owner yet", 409);
    return {
      ...current,
      credentials: current.credentials.map((entry) =>
        entry.id === credential.id ? { ...entry, counter: verification.authenticationInfo.newCounter } : entry,
      ),
      sessions: withSession(current.sessions, session),
    };
  });
  return { cookies: [sessionCookie(token), challengeCookie("", 0)] };
}

export async function signOut(request: Request): Promise<void> {
  const found = await findSession(request);
  if (!found) return;
  await removeDevice(found.session.id);
}

export async function removeDevice(id: string): Promise<void> {
  await updateAccount((current) => {
    if (!current) throw new HttpError("This Shareboard has no owner yet", 409);
    return { ...current, sessions: current.sessions.filter((entry) => entry.id !== id) };
  });
}

function pairingKey(codeHash: string) {
  return `_shareboard/owner/pairing/${codeHash}.json`;
}

export async function createPairing(request: Request): Promise<{ code: string; expiresAt: number }> {
  await requireOwner(request);
  const code = randomToken(24);
  const expiresAt = Date.now() + PAIRING_TTL_MS;
  await putObject(pairingKey(await sha256(code)), JSON.stringify({ expiresAt }), "application/json", { kind: "absent" });
  return { code, expiresAt };
}

export async function redeemPairing(request: Request, code: string): Promise<SessionResult> {
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(code)) throw new HttpError("That device link is invalid", 400);
  const key = pairingKey(await sha256(code));
  const stored = await getObjectText(key);
  if (!stored) throw new HttpError("That device link expired or was already used", 410);
  const claimed = await putObject(key, JSON.stringify({ used: true }), "application/json", { kind: "etag", etag: stored.etag });
  await deleteObjectsQuietly([key]);
  const value = parseJson(stored.text);
  if (!claimed || !isRecord(value) || typeof value.expiresAt !== "number" || value.expiresAt < Date.now()) {
    throw new HttpError("That device link expired or was already used", 410);
  }
  const { token, session } = await newSession(request);
  await updateAccount((current) => {
    if (!current) throw new HttpError("This Shareboard has no owner yet", 409);
    return { ...current, sessions: withSession(current.sessions, session) };
  });
  return { cookies: [sessionCookie(token)] };
}

export async function createOwnerSessionForTesting(request: Request = new Request("http://local.test/")): Promise<string> {
  const { token, session } = await newSession(request);
  await updateAccount((current) => ({
    v: 1,
    userId: current?.userId ?? randomToken(32),
    claimedAt: current?.claimedAt ?? new Date().toISOString(),
    credentials: current?.credentials ?? [],
    sessions: withSession(current?.sessions ?? [], session),
  }));
  return `${SESSION_COOKIE}=${token}`;
}
