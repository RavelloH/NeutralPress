// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "@/app/api/public/admin/security/[operation]/route";
import * as service from "@/lib/server/services/security-domain";

vi.mock("@/lib/server/services/security-domain", () => ({
  getSecurityOverview: vi.fn(),
  getIPList: vi.fn(),
  getEndpointStats: vi.fn(),
  getRequestTrends: vi.fn(),
}));
const context = (operation: string) => ({
  params: Promise.resolve({ operation }),
});
function get(operation: string, params: unknown = {}, extra = "") {
  const url = new URL(
    "https://example.com/api/public/admin/security/" + operation,
  );
  url.searchParams.set("params", JSON.stringify(params));
  return new NextRequest(url.toString() + extra);
}
function post(
  operation: string,
  body: unknown = {},
  headers: Record<string, string> = {},
) {
  return new NextRequest(
    "https://example.com/api/public/admin/security/" + operation,
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", ...headers },
    },
  );
}
describe("Security admin HTTP read whitelist", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not expose ban, unban or rate-limit mutations", async () => {
    for (const operation of ["ban", "unban", "clear-rate-limit", "unknown"]) {
      expect((await GET(get(operation), context(operation))).status).toBe(400);
      expect((await POST(post(operation), context(operation))).status).toBe(
        400,
      );
    }
    expect(service.getIPList).not.toHaveBeenCalled();
    expect(service.getSecurityOverview).not.toHaveBeenCalled();
  });

  it("validates overview, endpoint and trend GET query parameters strictly", async () => {
    expect(
      (
        await GET(
          get("overview", { access_token: "secret" }),
          context("overview"),
        )
      ).status,
    ).toBe(400);
    expect(
      (await GET(get("overview", { force: "true" }), context("overview")))
        .status,
    ).toBe(400);
    expect(
      (await GET(get("endpoints", { hours: 169 }), context("endpoints")))
        .status,
    ).toBe(400);
    expect(
      (await GET(get("trends", { hours: 721 }), context("trends"))).status,
    ).toBe(400);
    expect(
      (await GET(get("trends", { granularity: "second" }), context("trends")))
        .status,
    ).toBe(400);
    expect(
      (
        await GET(
          get("trends", { hours: 24 }, "&access_token=secret"),
          context("trends"),
        )
      ).status,
    ).toBe(400);
    expect(service.getSecurityOverview).not.toHaveBeenCalled();
    expect(service.getEndpointStats).not.toHaveBeenCalled();
    expect(service.getRequestTrends).not.toHaveBeenCalled();
  });

  it("returns an ADMIN-protected private overview", async () => {
    vi.mocked(service.getSecurityOverview).mockResolvedValueOnce({
      success: true,
      data: { activeIPs: 2 },
    } as never);
    const response = await GET(
      get("overview", { force: true }),
      context("overview"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    );
    expect(service.getSecurityOverview).toHaveBeenCalledWith({ force: true });
  });

  it("reads endpoint statistics and request trends with bounded private queries", async () => {
    vi.mocked(service.getEndpointStats).mockResolvedValueOnce({
      success: true,
      data: {},
    } as never);
    vi.mocked(service.getRequestTrends).mockResolvedValueOnce({
      success: true,
      data: [],
    } as never);
    const endpoints = await GET(
      get("endpoints", { hours: 168 }),
      context("endpoints"),
    );
    const trends = await GET(
      get("trends", { hours: 720, granularity: "hour" }),
      context("trends"),
    );
    expect(endpoints.status).toBe(200);
    expect(trends.status).toBe(200);
    expect(endpoints.headers.get("cache-control")).toBe("private, no-store");
    expect(trends.headers.get("cache-control")).toBe("private, no-store");
    expect(service.getEndpointStats).toHaveBeenCalledWith({ hours: 168 });
    expect(service.getRequestTrends).toHaveBeenCalledWith({
      hours: 720,
      granularity: "hour",
    });
  });

  it("keeps IP addresses out of URLs and requires same-origin JSON POST", async () => {
    expect(
      (await POST(post("ips", { access_token: "secret" }), context("ips")))
        .status,
    ).toBe(400);
    expect(
      (await POST(post("ips", { pageSize: 501 }), context("ips"))).status,
    ).toBe(400);
    expect(
      (
        await POST(
          post(
            "ips",
            { search: "1.2.3.4" },
            { origin: "https://evil.example" },
          ),
          context("ips"),
        )
      ).status,
    ).toBe(403);
    expect(service.getIPList).not.toHaveBeenCalled();

    vi.mocked(service.getIPList).mockResolvedValueOnce({
      success: true,
      data: { items: [{ ip: "1.2.3.4" }], total: 1 },
    } as never);
    const request = post(
      "ips",
      { page: 1, pageSize: 20, search: "1.2.3.4" },
      { origin: "https://example.com" },
    );
    expect(request.nextUrl.href).not.toContain("1.2.3.4");
    const response = await POST(request, context("ips"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(service.getIPList).toHaveBeenCalledWith(
      expect.objectContaining({ search: "1.2.3.4", pageSize: 20 }),
    );
  });

  it("preserves authorization and rate-limit HTTP status codes", async () => {
    vi.mocked(service.getIPList).mockResolvedValueOnce({
      success: false,
      error: { code: "UNAUTHORIZED" },
    } as never);
    expect((await POST(post("ips", {}), context("ips"))).status).toBe(401);
    vi.mocked(service.getIPList).mockResolvedValueOnce({
      success: false,
      error: { code: "TOO_MANY_REQUESTS" },
    } as never);
    const limited = await POST(post("ips", {}), context("ips"));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("cache-control")).toBe("private, no-store");
  });
});
