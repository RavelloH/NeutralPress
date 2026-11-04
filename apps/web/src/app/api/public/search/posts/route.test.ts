// @vitest-environment node
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/public/search/posts/route";
import { searchPosts } from "@/lib/server/services/search";

vi.mock("@/lib/server/services/search", () => ({ searchPosts: vi.fn() }));

function request(
  body: unknown = {},
  headers: Record<string, string> = {},
  query = "",
) {
  return new NextRequest(
    "https://example.com/api/public/search/posts" + query,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    },
  );
}
describe("Published posts JSON search API", () => {
  beforeEach(() => vi.clearAllMocks());

  it("never permits draft, archived or arbitrary search status and query data", async () => {
    for (const status of ["DRAFT", "ARCHIVED", "SECRET"]) {
      expect((await POST(request({ query: "test", status }))).status).toBe(400);
    }
    expect((await POST(request({ query: "test", page: 101 }))).status).toBe(
      400,
    );
    expect(
      (await POST(request({ query: "test", access_token: "private" }))).status,
    ).toBe(400);
    expect(
      (await POST(request({ query: "test" }, {}, "?q=private"))).status,
    ).toBe(400);
    expect(searchPosts).not.toHaveBeenCalled();
  });

  it("protects the anonymous search endpoint from cross-site fetches and large visitor metadata", async () => {
    expect(
      (
        await POST(
          request({ query: "test" }, { origin: "https://evil.example" }),
        )
      ).status,
    ).toBe(403);
    expect(
      (await POST(request({ query: "test", visitorId: "x".repeat(101) })))
        .status,
    ).toBe(400);
    expect(
      (await POST(request({ query: "test", sessionId: "x".repeat(101) })))
        .status,
    ).toBe(400);
    expect((await POST(request({ query: "x".repeat(201) }))).status).toBe(400);
    expect(searchPosts).not.toHaveBeenCalled();
  });

  it("forces PUBLISHED status and retains rate limit/telemetry service", async () => {
    vi.mocked(searchPosts).mockResolvedValueOnce(
      NextResponse.json({
        success: true,
        data: { posts: [], tokensUsed: [] },
      }) as never,
    );
    const req = request({
      query: "Next.js",
      page: 1,
      pageSize: 20,
      searchIn: "both",
      visitorId: "visitor-private",
    });
    expect(req.nextUrl.href).not.toContain("visitor-private");
    const response = await POST(req);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(searchPosts).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "Next.js",
        status: "PUBLISHED",
        visitorId: "visitor-private",
      }),
      { environment: "serverless" },
    );
  });

  it("does not mask existing rate limit status as successful search", async () => {
    vi.mocked(searchPosts).mockResolvedValueOnce(
      NextResponse.json({ success: false }, { status: 429 }) as never,
    );
    expect((await POST(request({ query: "rate limit" }))).status).toBe(429);
  });
});
