import { afterEach, describe, expect, it, vi } from "vitest";

import {
  batchGetViewCounts,
  getAnalyticsStats,
  getPageViews,
  getRealTimeStats,
  trackPageView,
} from "@/lib/client/api/analytics-read";

describe("Analytics native HTTP client", () => {
  afterEach(() => vi.unstubAllGlobals());

  function mockFetch(result: unknown) {
    const fn = vi
      .fn()
      .mockResolvedValue({ status: 200, json: async () => result });
    vi.stubGlobal("fetch", fn);
    return fn;
  }

  it("tracks views with same-origin JSON POST, not serialized Server Actions", async () => {
    const spy = mockFetch({ success: true, data: null });
    await trackPageView({ path: "/posts/a", visitorId: "visitor-1" });
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, options] = spy.mock.calls[0]!;
    expect(url).toBe("/api/public/analytics/track");
    expect(options).toEqual(
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
    expect(JSON.parse(options.body)).toEqual({
      path: "/posts/a",
      visitorId: "visitor-1",
    });
  });

  it("keeps admin search filters out of URLs and drops access_token", async () => {
    const spy = mockFetch({ success: true, data: {} });
    await getAnalyticsStats({ days: 30, access_token: "private-token" });
    await getPageViews({
      page: 1,
      pageSize: 25,
      visitorId: "visitor-private",
      access_token: "private-token",
    });
    await getRealTimeStats({ minutes: 5, access_token: "private-token" });
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy.mock.calls.map((call) => call[0])).toEqual([
      "/api/public/admin/analytics/summary",
      "/api/public/admin/analytics/pages",
      "/api/public/admin/analytics/realtime",
    ]);
    for (const [, options] of spy.mock.calls) {
      expect(options.method).toBe("POST");
      expect(options.body).not.toContain("private-token");
    }
  });

  it("returns the legacy raw count array from a bounded GET request", async () => {
    const spy = mockFetch({
      success: true,
      data: [{ path: "/posts/a", count: 18 }],
    });
    const result = await batchGetViewCounts(["/posts/a"]);
    expect(result).toEqual([{ path: "/posts/a", count: 18 }]);
    const [url, options] = spy.mock.calls[0]!;
    expect(url).toContain("/api/public/analytics/view-counts");
    expect(options).toEqual(
      expect.objectContaining({ method: "GET", credentials: "same-origin" }),
    );
  });

  it("raises an error when view count GET returns an API error", async () => {
    mockFetch({
      success: false,
      error: { code: "TOO_MANY_REQUESTS" },
      message: "稍后再试",
    });
    await expect(batchGetViewCounts(["/posts/a"])).rejects.toThrow("稍后再试");
  });
});
