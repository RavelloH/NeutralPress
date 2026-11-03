// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  GET,
  POST,
} from "@/app/api/public/admin/mail-subscriptions/[operation]/route";
import * as service from "@/lib/server/services/mail-subscription-domain";

vi.mock("@/lib/server/services/mail-subscription-domain", () => ({
  getMailSubscriptionList: vi.fn(),
  getLatestMailDispatchOverview: vi.fn(),
  getMailSubscriptionStatusDistribution: vi.fn(),
}));
const context = (operation: string) => ({
  params: Promise.resolve({ operation }),
});
function get(operation: string, params: unknown = {}) {
  const url = new URL(
    "https://example.com/api/public/admin/mail-subscriptions/" + operation,
  );
  url.searchParams.set("params", JSON.stringify(params));
  return new NextRequest(url.toString());
}
function post(
  operation: string,
  body: unknown = {},
  headers: Record<string, string> = {},
) {
  return new NextRequest(
    "https://example.com/api/public/admin/mail-subscriptions/" + operation,
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", ...headers },
    },
  );
}
describe("subscriber-admin HTTP API (email filters must not appear in GET URLs)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("blocks all mutation operations and rejects email-search GET", async () => {
    expect((await GET(get("list"), context("list"))).status).toBe(400);
    expect((await GET(get("dispatch"), context("dispatch"))).status).toBe(400);
    expect((await POST(post("dispatch"), context("dispatch"))).status).toBe(
      400,
    );
    expect(service.getMailSubscriptionList).not.toHaveBeenCalled();
  });

  it("strictly validates private JSON list searches before reaching service", async () => {
    expect(
      (
        await POST(
          post("list", { search: "a@b.test", access_token: "secret" }),
          context("list"),
        )
      ).status,
    ).toBe(400);
    expect(
      (await POST(post("list", { pageSize: 201 }), context("list"))).status,
    ).toBe(400);
    expect(
      (await POST(post("list", { status: ["BAD"] }), context("list"))).status,
    ).toBe(400);
    expect(
      (await POST(post("list", { search: "x".repeat(250) }), context("list")))
        .status,
    ).toBe(400);
    expect(
      (
        await POST(
          post(
            "list",
            { search: "someone@example.com" },
            { origin: "https://evil.example" },
          ),
          context("list"),
        )
      ).status,
    ).toBe(403);
    expect(service.getMailSubscriptionList).not.toHaveBeenCalled();
  });

  it("reads subscriber emails only via cookie-protected JSON POST without proxy caching", async () => {
    vi.mocked(service.getMailSubscriptionList).mockResolvedValueOnce({
      success: true,
      data: { items: [] },
    } as never);
    const request = post(
      "list",
      { page: 1, pageSize: 25, search: "someone@example.com" },
      { origin: "https://example.com" },
    );
    expect(request.nextUrl.href).not.toContain("someone@example.com");
    const response = await POST(request, context("list"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(service.getMailSubscriptionList).toHaveBeenCalledWith(
      expect.objectContaining({ search: "someone@example.com", pageSize: 25 }),
    );
  });

  it("preserves admin/editor authorization errors and rate limits", async () => {
    vi.mocked(service.getMailSubscriptionList).mockResolvedValueOnce({
      success: false,
      error: { code: "UNAUTHORIZED" },
    } as never);
    const unauthorized = await POST(post("list", {}), context("list"));
    expect(unauthorized.status).toBe(401);
    vi.mocked(service.getMailSubscriptionList).mockResolvedValueOnce({
      success: false,
      error: { code: "TOO_MANY_REQUESTS" },
    } as never);
    const limited = await POST(post("list", {}), context("list"));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("cache-control")).toBe("private, no-store");
  });

  it("reads overview and distribution as strict, private GETs", async () => {
    vi.mocked(service.getLatestMailDispatchOverview).mockResolvedValueOnce({
      success: true,
      data: { totalActive: 3 },
    } as never);
    vi.mocked(
      service.getMailSubscriptionStatusDistribution,
    ).mockResolvedValueOnce({ success: true, data: [] } as never);
    const overview = await GET(get("overview"), context("overview"));
    const distribution = await GET(
      get("distribution"),
      context("distribution"),
    );
    expect(overview.status).toBe(200);
    expect(distribution.status).toBe(200);
    expect(overview.headers.get("cache-control")).toBe("private, no-store");
    expect(service.getLatestMailDispatchOverview).toHaveBeenCalledTimes(1);
    expect(service.getMailSubscriptionStatusDistribution).toHaveBeenCalledTimes(
      1,
    );
    expect(
      (
        await GET(
          get("overview", { access_token: "leak" }),
          context("overview"),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await GET(
          get("distribution", { search: "someone@example.com" }),
          context("distribution"),
        )
      ).status,
    ).toBe(400);
  });
});
