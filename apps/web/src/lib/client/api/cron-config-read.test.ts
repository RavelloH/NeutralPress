import { afterEach, describe, expect, it, vi } from "vitest";

import { getCronConfig } from "@/lib/client/api/cron-config-read";

describe("Cron config native HTTP client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses private same-origin GET, without access tokens or mutating payload", async () => {
    const spy = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ success: true, data: { enabled: true } }),
    });
    vi.stubGlobal("fetch", spy);
    expect((await getCronConfig()).success).toBe(true);
    expect(spy).toHaveBeenCalledWith(
      "/api/public/admin/cron/config",
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
  });

  it("reports transport failures and keeps unauthorized data failures", async () => {
    const spy = vi
      .fn()
      .mockResolvedValueOnce({
        status: 401,
        json: async () => ({ success: false, message: "未授权" }),
      })
      .mockResolvedValueOnce({ status: 500 });
    vi.stubGlobal("fetch", spy);
    expect((await getCronConfig()).success).toBe(false);
    await expect(getCronConfig()).rejects.toThrow("获取 Cron 配置失败");
  });
});
