import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/public/admin/recycle-bin/[operation]/route";
import * as service from "@/lib/server/services/recycle-bin-domain";

vi.mock("@/lib/server/services/recycle-bin-domain", () => ({
  getRecycleBinList: vi.fn(),
  getRecycleBinStats: vi.fn(),
}));
function request(operation: string, params?: unknown, extra = "") {
  const url = new URL(
    "https://example.com/api/public/admin/recycle-bin/" + operation,
  );
  if (params !== undefined)
    url.searchParams.set("params", JSON.stringify(params));
  return new NextRequest(url.toString() + extra);
}
const context = (operation: string) => ({
  params: Promise.resolve({ operation }),
});
describe("GET /api/public/admin/recycle-bin/[operation]", () => {
  beforeEach(() => vi.clearAllMocks());
  it("rejects unknown operations and malformed JSON before service", async () => {
    expect((await GET(request("delete"), context("delete"))).status).toBe(400);
    const broken = new NextRequest(
      "https://example.com/api/public/admin/recycle-bin/list?params=%7Bbroken",
    );
    expect((await GET(broken, context("list"))).status).toBe(400);
    const op = "list";
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
    expect(service.getRecycleBinList).not.toHaveBeenCalled();
    expect(service.getRecycleBinStats).not.toHaveBeenCalled();
  });
  it("keeps authentication failures private and uncached", async () => {
    vi.mocked(service.getRecycleBinList).mockResolvedValueOnce(
      NextResponse.json({ success: false }, { status: 401 }) as never,
    );
    const response = await GET(request("list", {}), context("list"));
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("dispatches list to its protected server-only service", async () => {
    vi.mocked(service.getRecycleBinList).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: {} }) as never,
    );
    const response = await GET(request("list", {}), context("list"));
    expect(service.getRecycleBinList).toHaveBeenCalledWith(
      expect.objectContaining({}),
      { environment: "serverless" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
  it("dispatches stats to its protected server-only service", async () => {
    vi.mocked(service.getRecycleBinStats).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: {} }) as never,
    );
    const response = await GET(request("stats", {}), context("stats"));
    expect(service.getRecycleBinStats).toHaveBeenCalledWith(
      expect.objectContaining({}),
      { environment: "serverless" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
