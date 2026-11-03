import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/public/admin/menus/[operation]/route";
import * as service from "@/lib/server/services/menu-domain";

vi.mock("@/lib/server/services/menu-domain", () => ({
  getMenusStats: vi.fn(),
  getMenusList: vi.fn(),
  getMenuDetail: vi.fn(),
}));
function request(operation: string, params?: unknown, extra = "") {
  const url = new URL(
    "https://example.com/api/public/admin/menus/" + operation,
  );
  if (params !== undefined)
    url.searchParams.set("params", JSON.stringify(params));
  return new NextRequest(url.toString() + extra);
}
const context = (operation: string) => ({
  params: Promise.resolve({ operation }),
});
describe("GET /api/public/admin/menus/[operation]", () => {
  beforeEach(() => vi.clearAllMocks());
  it("rejects unknown operations and malformed JSON before service", async () => {
    expect((await GET(request("delete"), context("delete"))).status).toBe(400);
    const broken = new NextRequest(
      "https://example.com/api/public/admin/menus/list?params=%7Bbroken",
    );
    expect((await GET(broken, context("list"))).status).toBe(400);
    const op = "stats";
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
      (await GET(request(op, { text: "x".repeat(9000) }), context(op))).status,
    ).toBe(400);
    expect(service.getMenusStats).not.toHaveBeenCalled();
    expect(service.getMenusList).not.toHaveBeenCalled();
    expect(service.getMenuDetail).not.toHaveBeenCalled();
  });
  it("keeps authentication failures private and uncached", async () => {
    vi.mocked(service.getMenusStats).mockResolvedValueOnce(
      NextResponse.json({ success: false }, { status: 401 }) as never,
    );
    const response = await GET(request("stats", {}), context("stats"));
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("dispatches stats to its protected server-only service", async () => {
    vi.mocked(service.getMenusStats).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: {} }) as never,
    );
    const response = await GET(request("stats", {}), context("stats"));
    expect(service.getMenusStats).toHaveBeenCalledWith(
      expect.objectContaining({}),
      { environment: "serverless" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
  it("dispatches list to its protected server-only service", async () => {
    vi.mocked(service.getMenusList).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: {} }) as never,
    );
    const response = await GET(request("list", {}), context("list"));
    expect(service.getMenusList).toHaveBeenCalledWith(
      expect.objectContaining({}),
      { environment: "serverless" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
  it("dispatches detail to its protected server-only service", async () => {
    vi.mocked(service.getMenuDetail).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: {} }) as never,
    );
    const response = await GET(
      request("detail", { id: "main" }),
      context("detail"),
    );
    expect(service.getMenuDetail).toHaveBeenCalledWith(
      expect.objectContaining({ id: "main" }),
      { environment: "serverless" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
  it("caps menu pagination", async () => {
    expect(
      (await GET(request("list", { pageSize: 501 }), context("list"))).status,
    ).toBe(400);
    expect(service.getMenusList).not.toHaveBeenCalled();
  });
});
