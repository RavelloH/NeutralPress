import { afterEach, describe, expect, it, vi } from "vitest";

import { getBackupScopes } from "@/lib/client/api/backup-scopes-read";

describe("Backup scopes HTTP client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses native GET, same-origin cookies and no shared cache", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ success: true, data: [] }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await getBackupScopes();
    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/public/admin/backups/scopes",
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
  });

  it("propagates network/server errors rather than returning a successful catalog", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 500 }));
    await expect(getBackupScopes()).rejects.toThrow("获取备份分组失败");
  });
});
