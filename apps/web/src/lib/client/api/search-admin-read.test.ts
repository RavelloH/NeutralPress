import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getCustomWords,
  getIndexStatus,
  getPostTokenDetails,
  getSearchLogs,
} from "@/lib/client/api/search-admin-read";

describe("Search administrator native JSON POST clients", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses 4 same-origin POST endpoints, never placing private slugs or terms in URLs", async () => {
    const spy = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ success: true, data: [] }),
    });
    vi.stubGlobal("fetch", spy);
    await getCustomWords();
    await getIndexStatus({ page: 1, pageSize: 25 });
    await getPostTokenDetails({ slug: "draft-private-slug" });
    await getSearchLogs({
      page: 1,
      pageSize: 25,
      sortBy: "createdAt",
      sortOrder: "desc",
      query: "private search phrase",
    });
    expect(spy.mock.calls.map(([url]) => url)).toEqual([
      "/api/public/admin/search/words",
      "/api/public/admin/search/index-status",
      "/api/public/admin/search/tokens",
      "/api/public/admin/search/logs",
    ]);
    for (const [, opts] of spy.mock.calls) {
      expect(opts).toEqual(
        expect.objectContaining({
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
        }),
      );
    }
    expect(spy.mock.calls[2]![1].body).toContain("draft-private-slug");
    expect(spy.mock.calls[3]![1].body).toContain("private search phrase");
  });

  it("keeps unauthorized results and raises server failures", async () => {
    const spy = vi
      .fn()
      .mockResolvedValueOnce({
        status: 401,
        json: async () => ({ success: false, message: "未登录" }),
      })
      .mockResolvedValueOnce({ status: 500 });
    vi.stubGlobal("fetch", spy);
    expect((await getCustomWords()).success).toBe(false);
    await expect(getIndexStatus({ page: 1, pageSize: 25 })).rejects.toThrow(
      "获取搜索管理数据失败",
    );
  });
});
