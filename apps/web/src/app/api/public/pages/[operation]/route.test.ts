import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/public/pages/[operation]/route";
import * as service from "@/lib/server/services/page-domain";

vi.mock("@/lib/server/services/page-domain", () => ({
  getPagesList: vi.fn(),
  getPageDetail: vi.fn(),
  getAllPlaceholders: vi.fn(),
}));

function request(operation: string, input?: unknown, extra = "") {
  const url = new URL("https://example.com/api/public/pages/" + operation);
  if (input !== undefined)
    url.searchParams.set("params", JSON.stringify(input));
  return new NextRequest(url.toString() + extra);
}
const context = (operation: string) => ({
  params: Promise.resolve({ operation }),
});

describe("GET /api/public/pages/[operation]", () => {
  beforeEach(() => vi.clearAllMocks());
  it("rejects unknown methods, malformed queries, credential injection and duplicate params", async () => {
    expect((await GET(request("delete"), context("delete"))).status).toBe(400);
    const op = "list";
    const malformed = new NextRequest(
      "https://example.com/api/public/pages/" + op + "?params=%7Bbroken",
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
    expect(service.getPagesList).not.toHaveBeenCalled();
    expect(service.getPageDetail).not.toHaveBeenCalled();
    expect(service.getAllPlaceholders).not.toHaveBeenCalled();
  });
  it("preserves an authorization failure and prohibits shared caches", async () => {
    vi.mocked(service.getPagesList).mockResolvedValueOnce(
      NextResponse.json({ success: false }, { status: 403 }) as never,
    );
    const response = await GET(request("list", {}), context("list"));
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("dispatches list directly to the protected server-only getPagesList service", async () => {
    vi.mocked(service.getPagesList).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: {} }) as never,
    );
    const response = await GET(request("list", {}), context("list"));
    expect(vi.mocked(service.getPagesList)).toHaveBeenCalledWith(
      expect.objectContaining({}),
      { environment: "serverless" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("dispatches detail directly to the protected server-only getPageDetail service", async () => {
    vi.mocked(service.getPageDetail).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: {} }) as never,
    );
    const response = await GET(
      request("detail", { slug: "home" }),
      context("detail"),
    );
    expect(vi.mocked(service.getPageDetail)).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "home" }),
      { environment: "serverless" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("dispatches placeholders directly to the protected server-only getAllPlaceholders service", async () => {
    vi.mocked(service.getAllPlaceholders).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: {} }) as never,
    );
    const response = await GET(
      request("placeholders", {}),
      context("placeholders"),
    );
    expect(vi.mocked(service.getAllPlaceholders).mock.calls[0]).toEqual([
      { environment: "serverless" },
    ]);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("caps oversized page requests", async () => {
    expect(
      (await GET(request("list", { pageSize: 501 }), context("list"))).status,
    ).toBe(400);
    expect(service.getPagesList).not.toHaveBeenCalled();
  });
});
