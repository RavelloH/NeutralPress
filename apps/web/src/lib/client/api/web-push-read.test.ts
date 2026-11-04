import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getUserPushSubscriptions,
  getVapidPublicKey,
} from "@/lib/client/api/web-push-read";

describe("Web Push native HTTP adapters", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("requests VAPID public key with same-origin GET and no-store", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ success: true, data: { publicKey: "public" } }),
    });
    vi.stubGlobal("fetch", mockFetch);
    expect((await getVapidPublicKey()).data).toEqual({ publicKey: "public" });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/public/web-push/vapid-key",
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
  });

  it("restores Date objects after HTTP JSON serialization, including optional last-used dates", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({
        success: true,
        data: {
          subscriptions: [
            {
              id: "one",
              createdAt: "2026-10-01T10:30:00.000Z",
              lastUsedAt: "2026-10-02T11:30:00.000Z",
            },
            {
              id: "two",
              createdAt: "2026-10-03T10:30:00.000Z",
              lastUsedAt: null,
            },
          ],
        },
      }),
    });
    vi.stubGlobal("fetch", mockFetch);
    const result = await getUserPushSubscriptions();
    expect(result.success).toBe(true);
    expect(result.data?.subscriptions[0]?.createdAt).toBeInstanceOf(Date);
    expect(result.data?.subscriptions[0]?.lastUsedAt).toBeInstanceOf(Date);
    expect(result.data?.subscriptions[0]?.createdAt.toISOString()).toBe(
      "2026-10-01T10:30:00.000Z",
    );
    expect(result.data?.subscriptions[1]?.lastUsedAt).toBeNull();
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/public/account/web-push/subscriptions",
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
  });

  it("keeps unauthorized status and surfaces server errors", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        status: 401,
        json: async () => ({ success: false, message: "未登录" }),
      })
      .mockResolvedValueOnce({ status: 500 });
    vi.stubGlobal("fetch", mockFetch);
    expect((await getUserPushSubscriptions()).success).toBe(false);
    await expect(getUserPushSubscriptions()).rejects.toThrow(
      "获取推送订阅列表失败",
    );
  });

  it("preserves VAPID not-configured 503 without converting to a transport exception", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 503,
        json: async () => ({ success: false, message: "Web Push 未配置" }),
      }),
    );
    expect((await getVapidPublicKey()).success).toBe(false);
  });
});
