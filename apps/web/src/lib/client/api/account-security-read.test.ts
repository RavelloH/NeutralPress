import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getSessions,
  getTotpStatus,
} from "@/lib/client/api/account-security-read";

describe("account security GET client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses cookie-authenticated, no-store GETs with no query-string credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ success: true, data: {} }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await getSessions();
    await getTotpStatus();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/public/account/sessions");
    expect(fetchMock.mock.calls[1]![0]).toBe(
      "/api/public/account/security/totp-status",
    );
    for (const [, options] of fetchMock.mock.calls) {
      expect(options).toEqual(
        expect.objectContaining({
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
        }),
      );
    }
  });

  it("surfaces server transport failures to the account settings components", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 500,
      json: async () => ({ success: false }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(getSessions()).rejects.toThrow("获取会话列表失败");
    await expect(getTotpStatus()).rejects.toThrow("获取 TOTP 状态失败");
  });
});
