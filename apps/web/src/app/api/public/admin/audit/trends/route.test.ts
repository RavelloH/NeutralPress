import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/public/admin/audit/trends/route";
import { getAuditTrends } from "@/lib/server/services/audit";

vi.mock("@/lib/server/services/audit", () => ({ getAuditTrends: vi.fn() }));
const mocked = vi.mocked(getAuditTrends);
const request = (query = "") =>
  new NextRequest("https://example.com/api/public/admin/audit/trends" + query);

describe("GET /api/public/admin/audit/trends", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects invalid ranges, groupings and extra auth token", async () => {
    for (const q of [
      "?days=0",
      "?days=366",
      "?count=1001",
      "?groupBy=no",
      "?access_token=secret",
    ]) {
      const response = await GET(request(q));
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toContain("no-store");
    }
    expect(mocked).not.toHaveBeenCalled();
  });

  it("preserves authorization errors and prevents shared caching", async () => {
    mocked.mockResolvedValueOnce(
      NextResponse.json({ success: false }, { status: 403 }) as never,
    );
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("passes valid trend filters to the protected service", async () => {
    mocked.mockResolvedValueOnce(
      NextResponse.json({ success: true, data: [] }) as never,
    );
    const response = await GET(request("?days=30&count=30&groupBy=resource"));
    expect(mocked).toHaveBeenCalledWith(
      expect.objectContaining({ days: 30, count: 30, groupBy: "resource" }),
      { environment: "serverless" },
    );
    expect(response.status).toBe(200);
  });
});
