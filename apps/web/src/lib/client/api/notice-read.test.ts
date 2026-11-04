import { afterEach, describe, expect, it, vi } from "vitest";

import { getReadNotices } from "@/lib/client/api/notice-read";

describe("notice pagination GET client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses a same-origin non-cacheable GET, sending only pagination numbers", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ success: true, data: { read: [], unread: [] } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await getReadNotices(20, 10);
    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/api/public/account/notifications/read");
    expect(decodeURIComponent(url)).toContain('"skip":20');
    expect(opts).toEqual(
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
  });
});
