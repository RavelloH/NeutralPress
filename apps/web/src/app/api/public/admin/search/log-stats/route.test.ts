import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/public/admin/search/log-stats/route";
import { getSearchLogStats } from "@/lib/server/services/search-stats";

vi.mock("@/lib/server/services/search-stats", () => ({
  getSearchLogStats: vi.fn(),
}));

const mockStats = vi.mocked(getSearchLogStats);
const request = (query = "") =>
  new NextRequest(
    `https://example.com/api/public/admin/search/log-stats${query}`,
  );

describe("GET /api/public/admin/search/log-stats", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects days outside the allowed 1..365 range and invalid booleans", async () => {
    for (const query of [
      "?days=0",
      "?days=366",
      "?days=abc",
      "?days=1.5",
      "?force=no",
    ]) {
      const response = await GET(request(query));
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toContain("no-store");
    }
    expect(mockStats).not.toHaveBeenCalled();
  });

  it("preserves authorization failure from the server-only service", async () => {
    mockStats.mockResolvedValueOnce(
      NextResponse.json(
        { success: false, data: null },
        { status: 403 },
      ) as never,
    );
    const response = await GET(request("?days=30"));
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("uses defaults and forwards a validated query", async () => {
    mockStats.mockResolvedValueOnce(
      NextResponse.json({ success: true, data: {} }) as never,
    );
    const response = await GET(request("?days=365&force=true"));
    expect(mockStats).toHaveBeenCalledWith(
      { days: 365, force: true },
      { environment: "serverless" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
