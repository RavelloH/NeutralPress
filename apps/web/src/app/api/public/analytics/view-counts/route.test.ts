// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/public/analytics/view-counts/route";
import { batchGetViewCounts } from "@/lib/server/services/analytics-domain";

vi.mock("@/lib/server/services/analytics-domain", () => ({
  batchGetViewCounts: vi.fn(),
}));
function request(params: unknown, extra = "") {
  const url = new URL("https://example.com/api/public/analytics/view-counts");
  url.searchParams.set("params", JSON.stringify(params));
  return new NextRequest(url.toString() + extra);
}
describe("anonymous batched view-counts GET", () => {
  beforeEach(() => vi.clearAllMocks());
  it("rejects empty/oversized arrays, unknown fields, duplicate parameters and huge URLs", async () => {
    expect((await GET(request({ paths: [] }))).status).toBe(400);
    expect(
      (await GET(request({ paths: Array(21).fill("/posts/a") }))).status,
    ).toBe(400);
    expect(
      (await GET(request({ paths: ["/posts/a"], access_token: "secret" })))
        .status,
    ).toBe(400);
    expect(
      (await GET(request({ paths: ["/posts/a"] }, "&params=%7B%7D"))).status,
    ).toBe(400);
    expect((await GET(request({ paths: ["z".repeat(9000)] }))).status).toBe(
      400,
    );
    expect(batchGetViewCounts).not.toHaveBeenCalled();
  });
  it("returns original Redis count array and no-store response", async () => {
    vi.mocked(batchGetViewCounts).mockResolvedValueOnce([
      { path: "/posts/a", count: 12 },
    ]);
    const response = await GET(request({ paths: ["/posts/a"] }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      success: true,
      data: [{ path: "/posts/a", count: 12 }],
    });
    expect(batchGetViewCounts).toHaveBeenCalledWith(["/posts/a"]);
  });
  it("exposes 429 on rate limiting without leaking internal stack traces", async () => {
    vi.mocked(batchGetViewCounts).mockRejectedValueOnce(
      new Error("请求过于频繁，请稍后再试"),
    );
    const response = await GET(request({ paths: ["/posts/a"] }));
    expect(response.status).toBe(429);
    expect(await response.text()).not.toContain("at Module");
  });
});
