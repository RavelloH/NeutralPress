import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getCurrentUserForReauth,
  getSettings,
  getSystemInfo,
} from "@/lib/client/api/admin-infra-read";

describe("native HTTP clients for admin and reauth reads", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses cookie-protected no-store GET for host monitoring and current-user reauth", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ success: true, data: {} }),
    });
    vi.stubGlobal("fetch", mockFetch);
    await getSystemInfo();
    await getCurrentUserForReauth();
    expect(mockFetch.mock.calls.map(([url]) => url)).toEqual([
      "/api/public/admin/system/info",
      "/api/public/account/security/reauth-profile",
    ]);
    for (const [, opts] of mockFetch.mock.calls) {
      expect(opts).toEqual(
        expect.objectContaining({
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
        }),
      );
    }
  });

  it("keeps full admin configuration out of URL through empty JSON POST", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ success: true, data: [] }),
    });
    vi.stubGlobal("fetch", mockFetch);
    await getSettings();
    const [url, options] = mockFetch.mock.calls[0]!;
    expect(url).toBe("/api/public/admin/settings/list");
    expect(options).toEqual(
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        body: "{}",
      }),
    );
  });

  it("keeps errors and unauthorized results visible to UI", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        status: 401,
        json: async () => ({ success: false, message: "请先登录" }),
      })
      .mockResolvedValueOnce({ status: 500 });
    vi.stubGlobal("fetch", mockFetch);
    expect((await getCurrentUserForReauth()).success).toBe(false);
    await expect(getSystemInfo()).rejects.toThrow("读取失败");
  });
});
