import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/public/admin/comments/[operation]/route";
import * as service from "@/lib/server/services/comment-domain";

vi.mock("@/lib/server/services/comment-domain", () => ({
  getCommentsAdmin: vi.fn(),
  getCommentHistory: vi.fn(),
  getCommentStats: vi.fn(),
}));

function request(op: string, input?: unknown, suffix = "") {
  const url = new URL("https://example.com/api/public/admin/comments/" + op);
  if (input !== undefined)
    url.searchParams.set("params", JSON.stringify(input));
  return new NextRequest(url.toString() + suffix);
}
const context = (operation: string) => ({
  params: Promise.resolve({ operation }),
});

describe("GET /api/public/admin/comments/[operation]", () => {
  beforeEach(() => vi.clearAllMocks());
  it("rejects unknown operations, malformed input and credential leakage", async () => {
    expect((await GET(request("delete"), context("delete"))).status).toBe(400);
    const op = "list";
    const malformed = new NextRequest(
      "https://example.com/api/public/admin/comments/" +
        op +
        "?params=%7Bbroken",
    );
    expect((await GET(malformed, context(op))).status).toBe(400);
    expect(
      (await GET(request(op, { access_token: "forbidden" }), context(op)))
        .status,
    ).toBe(400);
    expect(
      (await GET(request(op, {}, "&access_token=bad"), context(op))).status,
    ).toBe(400);
    expect(vi.mocked(service.getCommentsAdmin)).not.toHaveBeenCalled();
    expect(vi.mocked(service.getCommentHistory)).not.toHaveBeenCalled();
    expect(vi.mocked(service.getCommentStats)).not.toHaveBeenCalled();
  });
  it("preserves authentication errors and disables proxy caching", async () => {
    vi.mocked(service.getCommentsAdmin).mockResolvedValueOnce(
      NextResponse.json({ success: false }, { status: 403 }) as never,
    );
    const response = await GET(request("list", {}), context("list"));
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("routes list to the server-only getCommentsAdmin service", async () => {
    vi.mocked(service.getCommentsAdmin).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: [] }) as never,
    );
    const response = await GET(request("list", {}), context("list"));
    expect(vi.mocked(service.getCommentsAdmin)).toHaveBeenCalledWith(
      expect.objectContaining({}),
      { environment: "serverless" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("routes history to the server-only getCommentHistory service", async () => {
    vi.mocked(service.getCommentHistory).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: [] }) as never,
    );
    const response = await GET(request("history", {}), context("history"));
    expect(vi.mocked(service.getCommentHistory)).toHaveBeenCalledWith(
      expect.objectContaining({}),
      { environment: "serverless" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("routes stats to the server-only getCommentStats service", async () => {
    vi.mocked(service.getCommentStats).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: [] }) as never,
    );
    const response = await GET(request("stats", {}), context("stats"));
    expect(vi.mocked(service.getCommentStats)).toHaveBeenCalledWith(
      expect.objectContaining({}),
      { environment: "serverless" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
