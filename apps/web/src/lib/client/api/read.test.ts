import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchPublicRead } from "@/lib/client/api/read";

describe("public GET client transport", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("never exposes access_token to URL and forwards same-origin cookies", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ success: true, data: { ok: true } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchPublicRead<{ ok: boolean }>(
      "/api/public/posts/detail",
      {
        slug: "test",
        access_token: "sensitive-credential",
      },
    );
    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) throw new Error("Expected a fetch call");
    const [url, options] = call;
    expect(String(url)).not.toContain("sensitive-credential");
    expect(new URL(url).searchParams.get("params")).toBe(
      JSON.stringify({ slug: "test" }),
    );
    expect(options).toEqual(
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
    expect(result.data).toEqual({ ok: true });
  });

  it("forwards AbortSignal for cancellable queries", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ success: true, data: null }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    await fetchPublicRead(
      "/api/public/comments/post",
      { slug: "test" },
      controller.signal,
    );
    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) throw new Error("Expected a fetch call");
    expect(call[1].signal).toBe(controller.signal);
  });

  it("propagates transient server failures without swallowing the error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 503 }));
    await expect(fetchPublicRead("/api/public/media/gallery")).rejects.toThrow(
      "获取数据失败",
    );
  });
});
