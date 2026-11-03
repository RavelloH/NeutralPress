// @vitest-environment node
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/public/admin/analytics/[operation]/route";
import * as service from "@/lib/server/services/analytics-domain";

vi.mock("@/lib/server/services/analytics-domain", () => ({
  getAnalyticsStats: vi.fn(),
  getPageViews: vi.fn(),
  getRealTimeStats: vi.fn(),
}));

const endpoint = "https://example.com/api/public/admin/analytics/";
function request(
  operation: string,
  body: unknown = {},
  headers: Record<string, string> = {},
) {
  return new NextRequest(endpoint + operation, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
const context = (operation: string) => ({
  params: Promise.resolve({ operation }),
});
describe("admin analytics JSON POST API", () => {
  beforeEach(() => vi.clearAllMocks());
  it("rejects unknown operations, cross-site browser requests, tokens and invalid filters", async () => {
    expect((await POST(request("delete"), context("delete"))).status).toBe(400);
    expect(
      (
        await POST(
          request("summary", { days: 30 }, { origin: "https://evil.example" }),
          context("summary"),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await POST(
          request("summary", { days: 30, access_token: "leak" }),
          context("summary"),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          request("summary", { days: 30, password: "bad" }),
          context("summary"),
        )
      ).status,
    ).toBe(400);
    expect(
      (await POST(request("summary", {}), context("summary"))).status,
    ).toBe(400);
    expect(service.getAnalyticsStats).not.toHaveBeenCalled();
  });
  it("converts legacy ApiResponse authorization failures into actual HTTP 401", async () => {
    vi.mocked(service.getAnalyticsStats).mockResolvedValueOnce({
      success: false,
      error: { code: "UNAUTHORIZED", message: "login required" },
    } as never);
    const response = await POST(
      request("summary", { days: 30 }),
      context("summary"),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("routes time-filtered summary and realtime queries to server-only service", async () => {
    vi.mocked(service.getAnalyticsStats).mockResolvedValueOnce({
      success: true,
      data: {},
    } as never);
    vi.mocked(service.getRealTimeStats).mockResolvedValueOnce({
      success: true,
      data: {},
    } as never);
    expect(
      (await POST(request("summary", { days: 30 }), context("summary"))).status,
    ).toBe(200);
    expect(
      (await POST(request("realtime", { minutes: 5 }), context("realtime")))
        .status,
    ).toBe(200);
    expect(service.getAnalyticsStats).toHaveBeenCalledWith(
      expect.objectContaining({ days: 30 }),
    );
    expect(service.getRealTimeStats).toHaveBeenCalledWith(
      expect.objectContaining({ minutes: 5 }),
    );
  });
  it("preserves HTTP status and private caching for page view list", async () => {
    vi.mocked(service.getPageViews).mockResolvedValueOnce(
      NextResponse.json({ success: false }, { status: 403 }) as never,
    );
    const response = await POST(
      request("pages", { page: 1 }),
      context("pages"),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(service.getPageViews).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1 }),
      { environment: "serverless" },
    );
  });
});
