import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getLatestMailDispatchOverview,
  getMailSubscriptionList,
  getMailSubscriptionStatusDistribution,
} from "@/lib/client/api/mail-subscription-read";

describe("Mail subscription client HTTP transport", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps subscriber email search terms out of URLs", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ success: true, data: { items: [] } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await getMailSubscriptionList({
      search: "secret@example.com",
      pageSize: 25,
    });
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/public/admin/mail-subscriptions/list");
    expect(url).not.toContain("secret@example.com");
    expect(options).toEqual(
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
    expect(JSON.parse(options.body)).toMatchObject({
      search: "secret@example.com",
      pageSize: 25,
    });
  });

  it("uses GET only for aggregates, never mutation", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ success: true, data: {} }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await getLatestMailDispatchOverview();
    await getMailSubscriptionStatusDistribution();
    const urls = fetchMock.mock.calls.map((x) => String(x[0]));
    expect(urls[0]).toContain("/api/public/admin/mail-subscriptions/overview");
    expect(urls[1]).toContain(
      "/api/public/admin/mail-subscriptions/distribution",
    );
    for (const [, options] of fetchMock.mock.calls) {
      expect(options.method).toBe("GET");
    }
  });
});
