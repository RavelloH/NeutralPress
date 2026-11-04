import { afterEach, describe, expect, it, vi } from "vitest";

import { searchPosts } from "@/lib/client/api/search-posts-read";

describe("Published article search via native JSON POST", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps keywords and visitor metadata outside URL and forces only published results", async () => {
    const spy = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({
        success: true,
        data: { posts: [], tokensUsed: [] },
      }),
    });
    vi.stubGlobal("fetch", spy);
    const result = await searchPosts({
      query: "private search phrase",
      page: 1,
      pageSize: 20,
      searchIn: "both",
      status: "PUBLISHED",
      sessionId: "private-session",
      visitorId: "private-visitor",
    });
    expect(result.success).toBe(true);
    const [url, options] = spy.mock.calls[0]!;
    expect(url).toBe("/api/public/search/posts");
    expect(url).not.toContain("private");
    expect(options).toEqual(
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
    expect(JSON.parse(options.body)).toMatchObject({
      status: "PUBLISHED",
      query: "private search phrase",
      visitorId: "private-visitor",
    });
  });

  it("retains HTTP 429 result without turning it into a successful search", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 429,
        json: async () => ({
          success: false,
          error: { code: "TOO_MANY_REQUESTS" },
        }),
      }),
    );
    expect(
      (
        await searchPosts({
          query: "test",
          page: 1,
          pageSize: 10,
          searchIn: "both",
        })
      ).success,
    ).toBe(false);
  });
});
