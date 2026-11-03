import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/public/admin/doctor/[operation]/route";
import * as service from "@/lib/server/services/doctor-domain";

vi.mock("@/lib/server/services/doctor-domain", () => ({
  getDoctorHistory: vi.fn(),
  getDoctorTrends: vi.fn(),
}));
function request(operation: string, params?: unknown, extra = "") {
  const url = new URL(
    "https://example.com/api/public/admin/doctor/" + operation,
  );
  if (params !== undefined)
    url.searchParams.set("params", JSON.stringify(params));
  return new NextRequest(url.toString() + extra);
}
const context = (operation: string) => ({
  params: Promise.resolve({ operation }),
});
describe("GET /api/public/admin/doctor/[operation]", () => {
  beforeEach(() => vi.clearAllMocks());
  it("rejects unknown operations and malformed JSON before service", async () => {
    expect((await GET(request("delete"), context("delete"))).status).toBe(400);
    const broken = new NextRequest(
      "https://example.com/api/public/admin/doctor/list?params=%7Bbroken",
    );
    expect((await GET(broken, context("list"))).status).toBe(400);
    const op = "history";
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
    expect(service.getDoctorHistory).not.toHaveBeenCalled();
    expect(service.getDoctorTrends).not.toHaveBeenCalled();
  });
  it("keeps authentication failures private and uncached", async () => {
    vi.mocked(service.getDoctorHistory).mockResolvedValueOnce(
      NextResponse.json({ success: false }, { status: 401 }) as never,
    );
    const response = await GET(request("history", {}), context("history"));
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("dispatches history to its protected server-only service", async () => {
    vi.mocked(service.getDoctorHistory).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: {} }) as never,
    );
    const response = await GET(request("history", {}), context("history"));
    expect(service.getDoctorHistory).toHaveBeenCalledWith(
      expect.objectContaining({}),
      { environment: "serverless" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
  it("dispatches trends to its protected server-only service", async () => {
    vi.mocked(service.getDoctorTrends).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: {} }) as never,
    );
    const response = await GET(request("trends", {}), context("trends"));
    expect(service.getDoctorTrends).toHaveBeenCalledWith(
      expect.objectContaining({}),
      { environment: "serverless" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
  it("caps diagnostic trends", async () => {
    expect(
      (await GET(request("trends", { count: 101 }), context("trends"))).status,
    ).toBe(400);
    expect(service.getDoctorTrends).not.toHaveBeenCalled();
  });
});
