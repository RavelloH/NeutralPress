import { afterEach, describe, expect, it, vi } from "vitest";

import {
  markAllNoticesAsRead,
  markNoticesAsRead,
} from "@/lib/client/api/notice-write";

describe("notification mutations via native JSON POST", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends limited identifying IDs in a request body, never a URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ success: true, data: { message: "ok" } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await markNoticesAsRead(["notice-id"]);
    await markAllNoticesAsRead();
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/public/account/notifications/mark",
      "/api/public/account/notifications/mark-all",
    ]);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
      noticeIds: ["notice-id"],
    });
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({});
    for (const [, opts] of fetchMock.mock.calls) {
      expect(opts).toEqual(
        expect.objectContaining({
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
        }),
      );
    }
  });
});
