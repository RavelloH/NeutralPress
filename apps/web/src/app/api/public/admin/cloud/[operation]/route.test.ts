// @vitest-environment node
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "@/app/api/public/admin/cloud/[operation]/route";
import * as service from "@/lib/server/services/cloud-domain";

vi.mock("@/lib/server/services/cloud-domain", () => ({
  getCloudHistory: vi.fn(),
  getCloudTrends: vi.fn(),
}));
const context = (operation: string) => ({
  params: Promise.resolve({ operation }),
});
function post(
  operation: string,
  body: unknown = {},
  headers: Record<string, string> = {},
) {
  return new NextRequest(
    "https://example.com/api/public/admin/cloud/" + operation,
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", ...headers },
    },
  );
}
function get(operation: string, params: unknown = {}, extra = "") {
  const url = new URL(
    "https://example.com/api/public/admin/cloud/" + operation,
  );
  url.searchParams.set("params", JSON.stringify(params));
  return new NextRequest(url.toString() + extra);
}
describe("Cloud administration HTTP read whitelist", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not expose remote config, status probing or sync writes", async () => {
    for (const op of ["config", "status", "sync", "update"]) {
      expect((await GET(get(op), context(op))).status).toBe(400);
      expect((await POST(post(op), context(op))).status).toBe(400);
    }
    expect(service.getCloudHistory).not.toHaveBeenCalled();
    expect(service.getCloudTrends).not.toHaveBeenCalled();
  });

  it("rejects history access tokens, invalid filters and cross-origin browser POST", async () => {
    expect(
      (
        await POST(
          post("history", { access_token: "private" }),
          context("history"),
        )
      ).status,
    ).toBe(400);
    expect(
      (await POST(post("history", { pageSize: 501 }), context("history")))
        .status,
    ).toBe(400);
    expect(
      (await POST(post("history", { page: -1 }), context("history"))).status,
    ).toBe(400);
    expect(
      (
        await POST(
          post(
            "history",
            { deliveryId: "cloud-1" },
            { origin: "https://evil.example" },
          ),
          context("history"),
        )
      ).status,
    ).toBe(403);
    expect(service.getCloudHistory).not.toHaveBeenCalled();
  });

  it("keeps cloud delivery IDs in POST bodies, with ADMIN auth and private response", async () => {
    vi.mocked(service.getCloudHistory).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: [] }) as never,
    );
    const request = post(
      "history",
      { page: 1, pageSize: 25, deliveryId: "delivery-private" },
      { origin: "https://example.com" },
    );
    expect(request.nextUrl.href).not.toContain("delivery-private");
    const response = await POST(request, context("history"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(service.getCloudHistory).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryId: "delivery-private", pageSize: 25 }),
      { environment: "serverless" },
    );
  });

  it("preserves service authentication errors from the protected history", async () => {
    vi.mocked(service.getCloudHistory).mockResolvedValueOnce(
      NextResponse.json({ success: false }, { status: 401 }) as never,
    );
    const response = await POST(
      post("history", { page: 1 }),
      context("history"),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("strictly validates and caps trend queries before service", async () => {
    expect(
      (await GET(get("trends", { days: 366 }), context("trends"))).status,
    ).toBe(400);
    expect(
      (await GET(get("trends", { count: 101 }), context("trends"))).status,
    ).toBe(400);
    expect(
      (await GET(get("trends", { access_token: "secret" }), context("trends")))
        .status,
    ).toBe(400);
    expect(
      (
        await GET(
          get("trends", { days: 30 }, "&access_token=secret"),
          context("trends"),
        )
      ).status,
    ).toBe(400);
    expect(service.getCloudTrends).not.toHaveBeenCalled();
  });

  it("performs authenticated trend GET without shared cache", async () => {
    vi.mocked(service.getCloudTrends).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: [] }) as never,
    );
    const response = await GET(
      get("trends", { days: 30, count: 60 }),
      context("trends"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(service.getCloudTrends).toHaveBeenCalledWith(
      { days: 30, count: 60 },
      { environment: "serverless" },
    );
  });
});
