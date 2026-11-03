import { afterEach, describe, expect, it, vi } from "vitest";

import { listUserPasskeys } from "@/lib/client/api/passkey-read";

describe("Passkey native GET client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses same-origin cookies and no-store without serializing secrets to the URL", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ success: true, data: { items: [] } }),
    });
    vi.stubGlobal("fetch", mockFetch);
    expect((await listUserPasskeys()).success).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/public/account/security/passkeys",
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
  });

  it("preserves 401 result and rejects server 500 errors", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        status: 401,
        json: async () => ({ success: false, message: "请先登录" }),
      })
      .mockResolvedValueOnce({ status: 500 });
    vi.stubGlobal("fetch", mockFetch);
    expect((await listUserPasskeys()).success).toBe(false);
    await expect(listUserPasskeys()).rejects.toThrow("获取通行密钥失败");
  });
});
