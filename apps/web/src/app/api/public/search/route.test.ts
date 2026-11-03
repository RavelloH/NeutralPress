import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/public/search/route";
import { searchSite } from "@/lib/server/services/search";

vi.mock("@/lib/server/services/search", () => ({
  searchSite: vi.fn(),
}));

const mockSearchSite = vi.mocked(searchSite);

function request(
  params: string,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(`https://example.com/api/public/search${params}`, {
    headers,
  });
}

describe("GET /api/public/search", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects an absent, empty, or overlong search query", async () => {
    for (const params of ["", "?q=%20", `?q=${"x".repeat(201)}`]) {
      const response = await GET(request(params));
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toContain("no-store");
    }
    expect(mockSearchSite).not.toHaveBeenCalled();
  });

  it("rejects overlong correlation IDs before invoking the search service", async () => {
    const response = await GET(
      request("?q=hello", { "x-search-visitor-id": "x".repeat(101) }),
    );
    expect(response.status).toBe(400);
    expect(mockSearchSite).not.toHaveBeenCalled();
  });

  it("delegates a validated GET to the existing search logic", async () => {
    const body = { success: true, data: { query: "hello", posts: [] } };
    mockSearchSite.mockResolvedValueOnce(NextResponse.json(body) as never);

    const response = await GET(
      request("?q=%20hello%20", {
        "x-search-session-id": "session-1",
        "x-search-visitor-id": "visitor-1",
      }),
    );

    expect(mockSearchSite).toHaveBeenCalledWith(
      { query: "hello", sessionId: "session-1", visitorId: "visitor-1" },
      { environment: "serverless" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual(body);
  });
});
