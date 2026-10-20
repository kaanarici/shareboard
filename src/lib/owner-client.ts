import { useSyncExternalStore } from "react";
import {
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { errorFromResponse, isRecord, readResponseJson } from "@/lib/json";

type OwnerDevice = { id: string; label: string; createdAt: string; current: boolean };

export type OwnerState =
  | { status: "loading" }
  | { status: "visitor"; claimed: boolean; claimable: boolean }
  | { status: "owner"; devices: OwnerDevice[] };

const LOADING: OwnerState = { status: "loading" };

let state: OwnerState = LOADING;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

function setState(next: OwnerState) {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (state.status === "loading" && !pending) void refreshOwner();
  return () => listeners.delete(listener);
}

export function useOwner(): OwnerState {
  return useSyncExternalStore(subscribe, () => state, () => LOADING);
}

export function isDemo(current: OwnerState): boolean {
  return current.status === "visitor" && !current.claimed && !current.claimable;
}

export async function loadOwner(): Promise<OwnerState> {
  if (state.status === "loading") await refreshOwner();
  return state;
}

function parseDevices(value: unknown): OwnerDevice[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const { id, label, createdAt, current } = entry;
    if (typeof id !== "string" || typeof label !== "string" || typeof createdAt !== "string") return [];
    return [{ id, label, createdAt, current: current === true }];
  });
}

function parseStatus(value: unknown): OwnerState {
  if (!isRecord(value)) return { status: "visitor", claimed: true, claimable: false };
  if (value.owner === true) return { status: "owner", devices: parseDevices(value.devices) };
  return { status: "visitor", claimed: value.claimed === true, claimable: value.claimable === true };
}

function refreshOwner(): Promise<void> {
  pending ??= fetch("/api/owner", { cache: "no-store" })
    .then(async (res) => setState(res.ok ? parseStatus(await readResponseJson(res)) : { status: "visitor", claimed: true, claimable: false }))
    .catch(() => setState({ status: "visitor", claimed: true, claimable: false }))
    .finally(() => {
      pending = null;
    });
  return pending;
}

async function postJson(path: string, body: unknown, method = "POST"): Promise<unknown> {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorFromResponse(res, "Something went wrong. Try again."));
  return readResponseJson(res);
}

function isCreationOptions(value: unknown): value is PublicKeyCredentialCreationOptionsJSON {
  return (
    isRecord(value) &&
    typeof value.challenge === "string" &&
    isRecord(value.rp) &&
    isRecord(value.user) &&
    Array.isArray(value.pubKeyCredParams)
  );
}

function isRequestOptions(value: unknown): value is PublicKeyCredentialRequestOptionsJSON {
  return isRecord(value) && typeof value.challenge === "string";
}

function passkeyError(error: unknown): Error {
  if (error instanceof Error && error.name === "NotAllowedError") return new Error("Passkey request was cancelled");
  if (error instanceof Error && error.name === "InvalidStateError") return new Error("This device already has a passkey for this Shareboard");
  return error instanceof Error ? error : new Error("Passkey didn't work. Try again.");
}

export async function claimOwnership(setupCode: string): Promise<void> {
  const options = await postJson("/api/owner/challenge", { purpose: "claim", setupCode });
  if (!isCreationOptions(options)) throw new Error("Unexpected passkey options");
  const response = await startRegistration({ optionsJSON: options }).catch((error: unknown) => {
    throw passkeyError(error);
  });
  await postJson("/api/owner/session", { purpose: "claim", setupCode, response });
  await refreshOwner();
}

export async function signInOwner(): Promise<void> {
  const options = await postJson("/api/owner/challenge", { purpose: "signin" });
  if (!isRequestOptions(options)) throw new Error("Unexpected passkey options");
  const response = await startAuthentication({ optionsJSON: options }).catch((error: unknown) => {
    throw passkeyError(error);
  });
  await postJson("/api/owner/session", { purpose: "signin", response });
  await refreshOwner();
}

export async function signOutOwner(): Promise<void> {
  await fetch("/api/owner/session", { method: "DELETE" }).catch(() => undefined);
  await refreshOwner();
}

export async function createDeviceLink(): Promise<{ url: string; expiresAt: number }> {
  const created = await postJson("/api/owner/pair", {});
  if (!isRecord(created) || typeof created.code !== "string" || typeof created.expiresAt !== "number") {
    throw new Error("Couldn't create a device link");
  }
  return { url: `${window.location.origin}/pair#${created.code}`, expiresAt: created.expiresAt };
}

export async function redeemDeviceLink(code: string): Promise<void> {
  await postJson("/api/owner/pair", { code }, "PUT");
  await refreshOwner();
}

export async function removeOwnerDevice(id: string): Promise<void> {
  const res = await fetch(`/api/owner/devices/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await errorFromResponse(res, "Couldn't remove that device"));
  await refreshOwner();
}
