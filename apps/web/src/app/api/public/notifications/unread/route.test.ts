import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getUnreadNoticeCount } from "@/actions/notice";
import { GET } from "@/app/api/public/notifications/unread/route";

vi.mock("@/actions/notice", () => ({
  getUnreadNoticeCount: vi.fn(),
}));

const mockUnreadCount = vi.mocked(getUnreadNoticeCount);

describe("GET /api/public/notifications/unread", () => {
  beforeEach(() => vi.clearAllMocks());

  it("delegates to the existing authenticated handler and disables caching", async () => {
    mockUnreadCount.mockResolvedValueOnce(
      NextResponse.json({
        success: true,
        data: { count: 2, messageCount: 1 },
      }) as never,
    );

    const response = await GET();
    expect(mockUnreadCount).toHaveBeenCalledOnce();
    expect(mockUnreadCount).toHaveBeenCalledWith({ environment: "serverless" });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("preserves authentication errors from the existing action", async () => {
    mockUnreadCount.mockResolvedValueOnce(
      NextResponse.json(
        { success: false, data: null },
        { status: 401 },
      ) as never,
    );

    const response = await GET();
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
