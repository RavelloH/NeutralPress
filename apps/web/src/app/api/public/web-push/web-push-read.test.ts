// @vitest-environment node
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET as privateGet } from "@/app/api/public/account/web-push/subscriptions/route";
import { GET as publicGet } from "@/app/api/public/web-push/vapid-key/route";
import * as pushService from "@/lib/server/services/web-push-domain";

vi.mock("@/lib/server/services/web-push-domain", () => ({
  getVapidPublicKey: vi.fn(),
  getUserPushSubscriptions: vi.fn(),
}));
const req = (path: string, query = "") =>
  new NextRequest("https://example.com" + path + query);
const keyPath = "/api/public/web-push/vapid-key";
const devicesPath = "/api/public/account/web-push/subscriptions";

describe("Web Push public VAPID and private subscriptions reads", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects every URL parameter, including tokens, users and endpoints", async () => {
    for (const path of [keyPath, devicesPath]) {
      for (const query of [
        "?access_token=secret",
        "?uid=1",
        "?endpoint=https%3A%2F%2Fpush.example",
      ]) {
        const response =
          path === keyPath
            ? await publicGet(req(path, query))
            : await privateGet(req(path, query));
        expect(response.status).toBe(400);
      }
    }
    expect(pushService.getVapidPublicKey).not.toHaveBeenCalled();
    expect(pushService.getUserPushSubscriptions).not.toHaveBeenCalled();
  });

  it("returns only a public VAPID key, and preserves configuration errors", async () => {
    vi.mocked(pushService.getVapidPublicKey).mockResolvedValueOnce(
      NextResponse.json({
        success: true,
        data: { publicKey: "public-key" },
      }) as never,
    );
    const response = await publicGet(req(keyPath));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json()).data).toEqual({ publicKey: "public-key" });
    expect(pushService.getVapidPublicKey).toHaveBeenCalledWith({
      environment: "serverless",
    });

    vi.mocked(pushService.getVapidPublicKey).mockResolvedValueOnce(
      NextResponse.json({ success: false }, { status: 503 }) as never,
    );
    expect((await publicGet(req(keyPath))).status).toBe(503);
  });

  it("prevents shared caching of private user endpoints and preserves auth", async () => {
    vi.mocked(pushService.getUserPushSubscriptions).mockResolvedValueOnce(
      NextResponse.json({ success: false }, { status: 401 }) as never,
    );
    const unauthorized = await privateGet(req(devicesPath));
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("cache-control")).toBe("private, no-store");
    vi.mocked(pushService.getUserPushSubscriptions).mockResolvedValueOnce(
      NextResponse.json({
        success: true,
        data: { subscriptions: [] },
      }) as never,
    );
    const response = await privateGet(req(devicesPath));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    );
    expect(pushService.getUserPushSubscriptions).toHaveBeenCalledWith({
      environment: "serverless",
    });
  });

  it("never turns existing rate limiting into a successful response", async () => {
    vi.mocked(pushService.getUserPushSubscriptions).mockResolvedValueOnce(
      NextResponse.json({ success: false }, { status: 429 }) as never,
    );
    expect((await privateGet(req(devicesPath))).status).toBe(429);
  });
});
