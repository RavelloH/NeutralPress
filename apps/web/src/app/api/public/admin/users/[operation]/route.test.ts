import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/public/admin/users/[operation]/route";
import * as service from "@/lib/server/services/user-domain";

vi.mock("@/lib/server/services/user-domain", () => ({
  getUsersTrends: vi.fn(),
  getUsersList: vi.fn(),
}));

function request(operation: string, input?: unknown, extra = "") {
  const url = new URL(
    "https://example.com/api/public/admin/users/" + operation,
  );
  if (input !== undefined)
    url.searchParams.set("params", JSON.stringify(input));
  return new NextRequest(url.toString() + extra);
}
const context = (operation: string) => ({
  params: Promise.resolve({ operation }),
});

describe("GET /api/public/admin/users/[operation]", () => {
  beforeEach(() => vi.clearAllMocks());
  it("rejects unknown methods, malformed queries, credential injection and duplicate params", async () => {
    expect((await GET(request("delete"), context("delete"))).status).toBe(400);
    const op = "trends";
    const malformed = new NextRequest(
      "https://example.com/api/public/admin/users/" + op + "?params=%7Bbroken",
    );
    expect((await GET(malformed, context(op))).status).toBe(400);
    expect(
      (await GET(request(op, { access_token: "secret" }), context(op))).status,
    ).toBe(400);
    expect(
      (await GET(request(op, {}, "&access_token=secret"), context(op))).status,
    ).toBe(400);
    expect(
      (await GET(request(op, {}, "&params=%7B%7D"), context(op))).status,
    ).toBe(400);
    expect(
      (await GET(request(op, { injected: "x".repeat(9000) }), context(op)))
        .status,
    ).toBe(400);
    expect(service.getUsersTrends).not.toHaveBeenCalled();
    expect(service.getUsersList).not.toHaveBeenCalled();
  });
  it("preserves an authorization failure and prohibits shared caches", async () => {
    vi.mocked(service.getUsersTrends).mockResolvedValueOnce(
      NextResponse.json({ success: false }, { status: 403 }) as never,
    );
    const response = await GET(request("trends", {}), context("trends"));
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("dispatches trends directly to the protected server-only getUsersTrends service", async () => {
    vi.mocked(service.getUsersTrends).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: {} }) as never,
    );
    const response = await GET(request("trends", {}), context("trends"));
    expect(vi.mocked(service.getUsersTrends)).toHaveBeenCalledWith(
      expect.objectContaining({}),
      { environment: "serverless" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("dispatches list directly to the protected server-only getUsersList service", async () => {
    vi.mocked(service.getUsersList).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: {} }) as never,
    );
    const response = await GET(request("list", {}), context("list"));
    expect(vi.mocked(service.getUsersList)).toHaveBeenCalledWith(
      expect.objectContaining({}),
      { environment: "serverless" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("limits statistics spans and user pagination", async () => {
    expect(
      (
        await GET(
          request("trends", { days: 366, count: 30 }),
          context("trends"),
        )
      ).status,
    ).toBe(400);
    expect(
      (await GET(request("list", { pageSize: 501 }), context("list"))).status,
    ).toBe(400);
    expect(service.getUsersTrends).not.toHaveBeenCalled();
    expect(service.getUsersList).not.toHaveBeenCalled();
  });
});
