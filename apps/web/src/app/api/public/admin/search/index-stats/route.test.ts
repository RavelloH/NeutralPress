import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/public/admin/search/index-stats/route";
import { getSearchIndexStats } from "@/lib/server/services/search-stats";

vi.mock("@/lib/server/services/search-stats", () => ({
  getSearchIndexStats: vi.fn(),
}));

const mockStats = vi.mocked(getSearchIndexStats);
const request = (query = "") =>
  new NextRequest(
    `https://example.com/api/public/admin/search/index-stats${query}`,
  );

describe("GET /api/public/admin/search/index-stats", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects invalid force values without querying private data", async () => {
    const response = await GET(request("?force=unexpected"));
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mockStats).not.toHaveBeenCalled();
  });

  it("preserves 401 from the authenticated service", async () => {
    mockStats.mockResolvedValueOnce(
      NextResponse.json(
        { success: false, data: null },
        { status: 401 },
      ) as never,
    );
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("passes a forced refresh to the protected service", async () => {
    mockStats.mockResolvedValueOnce(
      NextResponse.json({ success: true, data: {} }) as never,
    );
    const response = await GET(request("?force=true"));
    expect(mockStats).toHaveBeenCalledWith(
      { force: true },
      { environment: "serverless" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
