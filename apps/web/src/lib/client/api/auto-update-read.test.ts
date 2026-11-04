import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getAutoUpdateOverview,
  getRuntimeVersionInfo,
} from "@/lib/client/api/auto-update-read";

describe("Auto Update native HTTP transport", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("never sends the existing private config through a query-string GET", async () => {
    const spy = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ success: true, data: {} }),
    });
    vi.stubGlobal("fetch", spy);
    await getAutoUpdateOverview();
    expect(spy).toHaveBeenCalledWith(
      "/api/public/admin/auto-update/overview",
      expect.objectContaining({
        method: "POST",
        body: "{}",
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
  });

  it("uses private GET for ADMIN version polling and does not leak authentication headers", async () => {
    const spy = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ success: true, data: {} }),
    });
    vi.stubGlobal("fetch", spy);
    await getRuntimeVersionInfo();
    const [url, options] = spy.mock.calls[0]!;
    expect(url).toBe("/api/public/admin/auto-update/runtime");
    expect(options).toEqual(
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
    expect(options).not.toHaveProperty("Authorization");
  });

  it("propagates server errors and retains auth failures as structured response", async () => {
    const spy = vi
      .fn()
      .mockResolvedValueOnce({
        status: 401,
        json: async () => ({ success: false, message: "未授权" }),
      })
      .mockResolvedValueOnce({ status: 500 });
    vi.stubGlobal("fetch", spy);
    expect((await getAutoUpdateOverview()).success).toBe(false);
    await expect(getRuntimeVersionInfo()).rejects.toThrow(
      "获取运行时版本信息失败",
    );
  });
});
