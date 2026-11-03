import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/public/admin/audit/logs/route";
import { getAuditLogs } from "@/lib/server/services/audit";

vi.mock("@/lib/server/services/audit", () => ({ getAuditLogs: vi.fn() }));
const mocked = vi.mocked(getAuditLogs);
const request = (query = "") =>
  new NextRequest("https://example.com/api/public/admin/audit/logs" + query);

describe("GET /api/public/admin/audit/logs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects invalid pagination, type coercion and unrecognized keys", async () => {
    for (const q of [
      "?page=0",
      "?pageSize=501",
      "?id=NaN",
      "?userUid=1.2",
      "?sortBy=unknown",
      "?access_token=secret",
    ]) {
      const response = await GET(request(q));
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toContain("no-store");
    }
    expect(mocked).not.toHaveBeenCalled();
  });

  it("preserves admin authorization failures", async () => {
    mocked.mockResolvedValueOnce(
      NextResponse.json({ success: false }, { status: 401 }) as never,
    );
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("delegates a valid filtered query to the authorized service", async () => {
    mocked.mockResolvedValueOnce(
      NextResponse.json({ success: true, data: [] }) as never,
    );
    const response = await GET(
      request(
        "?page=3&pageSize=25&search=hello&sortBy=timestamp&sortOrder=desc",
      ),
    );
    expect(mocked).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 3,
        pageSize: 25,
        search: "hello",
        sortBy: "timestamp",
        sortOrder: "desc",
      }),
      { environment: "serverless" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
