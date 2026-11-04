// @vitest-environment node
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/public/account/notifications/read/route";
import { getReadNotices } from "@/lib/server/services/notice-domain";

vi.mock("@/lib/server/services/notice-domain", () => ({
  getReadNotices: vi.fn(),
}));
function request(params: unknown, extra = "") {
  const url = new URL(
    "https://example.com/api/public/account/notifications/read",
  );
  url.searchParams.set("params", JSON.stringify(params));
  return new NextRequest(url.toString() + extra);
}
describe("private paginated notifications GET", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects UID/token injections, invalid limits, extra query keys, and duplicate params", async () => {
    for (const input of [
      { skip: 0, limit: 10, access_token: "secret" },
      { skip: 0, userUid: 42 },
      { skip: -1 },
      { skip: 1.2 },
      { skip: 0, limit: 51 },
      { skip: 0, limit: 0 },
    ]) {
      expect((await GET(request(input))).status).toBe(400);
    }
    expect(
      (await GET(request({ skip: 0 }, "&access_token=secret"))).status,
    ).toBe(400);
    expect((await GET(request({ skip: 0 }, "&params=%7B%7D"))).status).toBe(
      400,
    );
    expect(getReadNotices).not.toHaveBeenCalled();
  });

  it("uses current cookie identity in existing service, and prevents shared cache", async () => {
    vi.mocked(getReadNotices).mockResolvedValueOnce(
      NextResponse.json({
        success: true,
        data: {
          unread: [],
          read: [{ id: "n1", createdAt: "2026-01-01T00:00:00.000Z" }],
          total: 1,
          unreadCount: 0,
          hasMoreRead: false,
        },
      }) as never,
    );
    const response = await GET(request({ skip: 0, limit: 10 }));
    expect(getReadNotices).toHaveBeenCalledWith(0, 10, {
      environment: "serverless",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("preserves cookie authorization, rate limiting, and private errors", async () => {
    vi.mocked(getReadNotices).mockResolvedValueOnce(
      NextResponse.json({ success: false }, { status: 401 }) as never,
    );
    expect((await GET(request({ skip: 0 }))).status).toBe(401);
    vi.mocked(getReadNotices).mockResolvedValueOnce(
      NextResponse.json({ success: false }, { status: 429 }) as never,
    );
    const rate = await GET(request({ skip: 0 }));
    expect(rate.status).toBe(429);
    expect(rate.headers.get("cache-control")).toBe("private, no-store");
  });
});
