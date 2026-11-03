import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/public/admin/cron/trends/route";
import { getCronTrends } from "@/lib/server/services/cron-history";

vi.mock("@/lib/server/services/cron-history", () => ({
  getCronTrends: vi.fn(),
}));
const mocked = vi.mocked(getCronTrends);
const request = (q = "") =>
  new NextRequest("https://example.com/api/public/admin/cron/trends" + q);

describe("GET /api/public/admin/cron/trends", () => {
  beforeEach(() => vi.clearAllMocks());
  it("rejects invalid dates, oversized count and arbitrary parameters", async () => {
    for (const q of [
      "?days=0",
      "?days=366",
      "?count=501",
      "?count=NaN",
      "?access_token=private",
    ]) {
      const res = await GET(request(q));
      expect(res.status).toBe(400);
      expect(res.headers.get("cache-control")).toContain("no-store");
    }
    expect(mocked).not.toHaveBeenCalled();
  });
  it("preserves 403 from the protected data service", async () => {
    mocked.mockResolvedValueOnce(
      NextResponse.json({ success: false }, { status: 403 }) as never,
    );
    const res = await GET(request());
    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
  it("accepts a valid timeframe", async () => {
    mocked.mockResolvedValueOnce(
      NextResponse.json({ success: true, data: [] }) as never,
    );
    const res = await GET(request("?days=45&count=10"));
    expect(mocked).toHaveBeenCalledWith(
      expect.objectContaining({ days: 45, count: 10 }),
      { environment: "serverless" },
    );
    expect(res.status).toBe(200);
  });
});
