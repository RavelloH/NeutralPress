import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/public/admin/cron/history/route";
import { getCronHistory } from "@/lib/server/services/cron-history";

vi.mock("@/lib/server/services/cron-history", () => ({
  getCronHistory: vi.fn(),
}));
const mocked = vi.mocked(getCronHistory);
const request = (q = "") =>
  new NextRequest("https://example.com/api/public/admin/cron/history" + q);

describe("GET /api/public/admin/cron/history", () => {
  beforeEach(() => vi.clearAllMocks());
  it("rejects out-of-range pagination, invalid filters and unknown auth fields", async () => {
    for (const q of [
      "?page=0",
      "?pageSize=501",
      "?id=abc",
      "?sortBy=invalid",
      "?access_token=x",
    ]) {
      const res = await GET(request(q));
      expect(res.status).toBe(400);
      expect(res.headers.get("cache-control")).toContain("no-store");
    }
    expect(mocked).not.toHaveBeenCalled();
  });
  it("preserves administrator authentication failures", async () => {
    mocked.mockResolvedValueOnce(
      NextResponse.json({ success: false }, { status: 401 }) as never,
    );
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
  it("forwards valid pagination with server-side rate limiting unchanged", async () => {
    mocked.mockResolvedValueOnce(
      NextResponse.json({ success: true, data: [] }) as never,
    );
    const res = await GET(request("?page=2&pageSize=25&status=OK"));
    expect(mocked).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2, pageSize: 25, status: "OK" }),
      { environment: "serverless" },
    );
    expect(res.status).toBe(200);
  });
});
