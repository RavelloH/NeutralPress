import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/public/admin/storages/[operation]/route";
import * as service from "@/lib/server/services/storage-domain";

vi.mock("@/lib/server/services/storage-domain", () => ({
  getStorageList: vi.fn(),
  getStorageDetail: vi.fn(),
}));
function request(operation: string, params?: unknown, extra = "") {
  const url = new URL(
    "https://example.com/api/public/admin/storages/" + operation,
  );
  if (params !== undefined)
    url.searchParams.set("params", JSON.stringify(params));
  return new NextRequest(url.toString() + extra);
}
const context = (operation: string) => ({
  params: Promise.resolve({ operation }),
});
describe("GET /api/public/admin/storages/[operation]", () => {
  beforeEach(() => vi.clearAllMocks());
  it("rejects unknown operations and malformed JSON before service", async () => {
    expect((await GET(request("delete"), context("delete"))).status).toBe(400);
    const broken = new NextRequest(
      "https://example.com/api/public/admin/storages/list?params=%7Bbroken",
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
    expect(service.getStorageList).not.toHaveBeenCalled();
    expect(service.getStorageDetail).not.toHaveBeenCalled();
  });
  it("keeps authentication failures private and uncached", async () => {
    vi.mocked(service.getStorageList).mockResolvedValueOnce(
      NextResponse.json({ success: false }, { status: 401 }) as never,
    );
    const response = await GET(request("list", {}), context("list"));
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("dispatches list to its protected server-only service", async () => {
    vi.mocked(service.getStorageList).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: {} }) as never,
    );
    const response = await GET(request("list", {}), context("list"));
    expect(service.getStorageList).toHaveBeenCalledWith(
      expect.objectContaining({}),
      { environment: "serverless" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
  it("dispatches detail to its protected server-only service", async () => {
    vi.mocked(service.getStorageDetail).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: {} }) as never,
    );
    const response = await GET(
      request("detail", { id: "00000000-0000-4000-8000-000000000001" }),
      context("detail"),
    );
    expect(service.getStorageDetail).toHaveBeenCalledWith(
      expect.objectContaining({ id: "00000000-0000-4000-8000-000000000001" }),
      { environment: "serverless" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
  it("rejects a non-UUID storage provider identifier", async () => {
    expect(
      (await GET(request("detail", { id: "not-an-uuid" }), context("detail")))
        .status,
    ).toBe(400);
    expect(service.getStorageDetail).not.toHaveBeenCalled();
  });
});
