import { afterEach, describe, expect, test } from "bun:test";
import { resetServerEnv, useMemoryStorage } from "@/test/memory-bucket";
import { defined, pngFile } from "@/test/fixtures";
import { createOwnerSessionForTesting, deviceLabel } from "@/lib/server/owner";
import { resetRateLimitsForTesting } from "@/lib/server/rate-limit";
import { handleOwnerStatus } from "./owner";
import { handleOwnerChallenge } from "./owner.challenge";
import { handleOwnerSignOut } from "./owner.session";
import { handlePairCreate, handlePairRedeem } from "./owner.pair";
import { handleDeviceRemove } from "./owner.devices.$id";
import { handleShareCreate, handleShareDelete } from "./share";
import { handleHandoffCreate } from "./handoff";
import { handleShareTargetPost } from "../share-target";

const ORIGIN = "http://local.test";

afterEach(() => {
  resetServerEnv();
});

function request(path: string, init: { method?: string; cookie?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { Origin: ORIGIN };
  if (init.cookie) headers.Cookie = init.cookie;
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  return new Request(`${ORIGIN}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

function cookieValue(response: Response, name: string): string {
  const header = response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`));
  return defined(header, `${name} cookie`).split(";")[0] ?? "";
}

type StatusBody = {
  claimed: boolean;
  owner: boolean;
  claimable?: boolean;
  devices?: Array<{ id: string; current: boolean }>;
};

async function status(cookie?: string): Promise<StatusBody> {
  return (await handleOwnerStatus(request("/api/owner", { cookie }))).json();
}

async function devices(cookie: string) {
  return defined((await status(cookie)).devices, "devices");
}

describe("owner status", () => {
  test("an unclaimed instance is claimable only when a setup code is configured", async () => {
    useMemoryStorage({ SHAREBOARD_SETUP_CODE: "correct horse" });
    expect(await status()).toEqual({ claimed: false, claimable: true, owner: false });
    useMemoryStorage();
    expect(await status()).toEqual({ claimed: false, claimable: false, owner: false });
  });

  test("visitors see a claimed instance without devices; the owner sees their devices", async () => {
    useMemoryStorage();
    const cookie = await createOwnerSessionForTesting();
    expect(await status()).toEqual({ claimed: true, owner: false });
    const owner = await status(cookie);
    expect(owner).toMatchObject({ claimed: true, owner: true });
    expect(await devices(cookie)).toEqual([expect.objectContaining({ current: true })]);
  });
});

describe("claiming", () => {
  test("a wrong setup code never yields passkey options", async () => {
    useMemoryStorage({ SHAREBOARD_SETUP_CODE: "correct horse" });
    const wrong = await handleOwnerChallenge(request("/api/owner/challenge", { method: "POST", body: { purpose: "claim", setupCode: "nope" } }));
    expect(wrong.status).toBe(403);
    expect(wrong.headers.getSetCookie()).toEqual([]);
  });

  test("the right setup code returns registration options bound to this host", async () => {
    useMemoryStorage({ SHAREBOARD_SETUP_CODE: "correct horse" });
    const response = await handleOwnerChallenge(
      request("/api/owner/challenge", { method: "POST", body: { purpose: "claim", setupCode: " correct horse " } }),
    );
    expect(response.status).toBe(200);
    const options: { rp: unknown; authenticatorSelection: { residentKey: string } } = await response.json();
    expect(options.rp).toEqual({ name: "Shareboard", id: "local.test" });
    expect(options.authenticatorSelection.residentKey).toBe("required");
    expect(cookieValue(response, "shareboard_owner_challenge")).toMatch(/^shareboard_owner_challenge=.{16,}/);
  });

  test("an instance without a setup code cannot be claimed", async () => {
    useMemoryStorage();
    const response = await handleOwnerChallenge(request("/api/owner/challenge", { method: "POST", body: { purpose: "claim", setupCode: "" } }));
    expect(response.status).toBe(403);
  });

  test("signing in before anyone has claimed the instance is refused", async () => {
    useMemoryStorage();
    const response = await handleOwnerChallenge(request("/api/owner/challenge", { method: "POST", body: { purpose: "signin" } }));
    expect(response.status).toBe(409);
  });

  test("cross-site claim attempts are refused", async () => {
    useMemoryStorage({ SHAREBOARD_SETUP_CODE: "correct horse" });
    const response = await handleOwnerChallenge(
      new Request(`${ORIGIN}/api/owner/challenge`, {
        method: "POST",
        headers: { Origin: "https://evil.test", "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: "claim", setupCode: "correct horse" }),
      }),
    );
    expect(response.status).toBe(403);
  });
});

describe("visitors cannot write", () => {
  test("share, delete, handoff and share-target uploads all require the owner", async () => {
    const bucket = useMemoryStorage();
    await createOwnerSessionForTesting();
    const form = new FormData();
    form.set("payload", JSON.stringify({ pages: [{ id: "p", items: [{ id: "n", type: "note", html: "hi" }], layouts: { lg: [], sm: [] } }] }));
    const share = await handleShareCreate(new Request(`${ORIGIN}/api/share`, { method: "POST", headers: { Origin: ORIGIN }, body: form }));
    expect(share.status).toBe(403);

    const remove = await handleShareDelete(
      new Request(`${ORIGIN}/api/share?id=abcdefghijklmnopqrstuv`, { method: "DELETE", headers: { Origin: ORIGIN } }),
    );
    expect(remove.status).toBe(403);

    const handoff = await handleHandoffCreate(request("/api/handoff", { method: "POST", body: { storageId: "x" } }));
    expect(handoff.status).toBe(403);

    const shared = new FormData();
    shared.set("text", "hello");
    shared.append("media", pngFile("one.png"));
    const target = await handleShareTargetPost(new Request(`${ORIGIN}/share-target`, { method: "POST", body: shared }));
    const location = new URL(defined(target.headers.get("Location")), ORIGIN);
    expect(location.searchParams.get("intake")).toBeNull();
    expect(location.searchParams.get("text")).toBe("hello");
    expect(bucket.keys().filter((key) => !key.startsWith("_shareboard/owner/"))).toEqual([]);
  });

  test("a made-up session cookie is not an owner", async () => {
    useMemoryStorage();
    await createOwnerSessionForTesting();
    expect(await status("shareboard_owner=forged")).toEqual({ claimed: true, owner: false });
  });
});

describe("adding devices", () => {
  test("a pairing link works once and grants a separate session", async () => {
    useMemoryStorage();
    const owner = await createOwnerSessionForTesting();
    const created = await handlePairCreate(request("/api/owner/pair", { method: "POST", cookie: owner, body: {} }));
    expect(created.status).toBe(200);
    const { code }: { code: string } = await created.json();

    const redeemed = await handlePairRedeem(request("/api/owner/pair", { method: "PUT", body: { code } }));
    expect(redeemed.status).toBe(200);
    const phone = cookieValue(redeemed, "shareboard_owner");
    expect((await status(phone)).owner).toBe(true);
    expect(await devices(owner)).toHaveLength(2);

    resetRateLimitsForTesting();
    const again = await handlePairRedeem(request("/api/owner/pair", { method: "PUT", body: { code } }));
    expect(again.status).toBe(410);
  });

  test("visitors cannot create pairing links", async () => {
    useMemoryStorage();
    await createOwnerSessionForTesting();
    const response = await handlePairCreate(request("/api/owner/pair", { method: "POST", body: {} }));
    expect(response.status).toBe(403);
  });

  test("removing a device or signing out ends that session", async () => {
    useMemoryStorage();
    const laptop = await createOwnerSessionForTesting();
    const phone = await createOwnerSessionForTesting();
    const phoneId = defined((await devices(laptop)).find((device) => !device.current), "phone").id;

    const removed = await handleDeviceRemove(request(`/api/owner/devices/${phoneId}`, { method: "DELETE", cookie: laptop }), phoneId);
    expect(removed.status).toBe(200);
    expect((await status(phone)).owner).toBe(false);

    const signedOut = await handleOwnerSignOut(request("/api/owner/session", { method: "DELETE", cookie: laptop }));
    expect(signedOut.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect((await status(laptop)).owner).toBe(false);
  });

  test("visitors cannot remove devices", async () => {
    useMemoryStorage();
    const laptop = await createOwnerSessionForTesting();
    const id = defined((await devices(laptop))[0], "laptop").id;
    const response = await handleDeviceRemove(request(`/api/owner/devices/${id}`, { method: "DELETE" }), id);
    expect(response.status).toBe(403);
    expect((await status(laptop)).owner).toBe(true);
  });
});

describe("device labels", () => {
  test("name common browsers and systems", () => {
    expect(deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15")).toBe(
      "Safari on Mac",
    );
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1")).toBe(
      "Safari on iPhone",
    );
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36")).toBe("Chrome on Windows");
    expect(deviceLabel(null)).toBe("Browser");
  });
});
