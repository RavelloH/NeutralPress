import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/public/comments/[operation]/route";
import * as service from "@/lib/server/services/comment-domain";

vi.mock("@/lib/server/services/comment-domain", () => ({
  getPostComments: vi.fn(),
  getCommentReplies: vi.fn(),
  getDirectChildren: vi.fn(),
}));

function request(op: string, input?: unknown, suffix = "") {
  const url = new URL("https://example.com/api/public/comments/" + op);
  if (input !== undefined)
    url.searchParams.set("params", JSON.stringify(input));
  return new NextRequest(url.toString() + suffix);
}
const context = (operation: string) => ({
  params: Promise.resolve({ operation }),
});

describe("GET /api/public/comments/[operation]", () => {
  beforeEach(() => vi.clearAllMocks());
  it("rejects unknown operations, malformed input and credential leakage", async () => {
    expect((await GET(request("delete"), context("delete"))).status).toBe(400);
    const op = "post";
    const malformed = new NextRequest(
      "https://example.com/api/public/comments/" + op + "?params=%7Bbroken",
    );
    expect((await GET(malformed, context(op))).status).toBe(400);
    expect(
      (await GET(request(op, { access_token: "forbidden" }), context(op)))
        .status,
    ).toBe(400);
    expect(
      (await GET(request(op, {}, "&access_token=bad"), context(op))).status,
    ).toBe(400);
    expect(vi.mocked(service.getPostComments)).not.toHaveBeenCalled();
    expect(vi.mocked(service.getCommentReplies)).not.toHaveBeenCalled();
    expect(vi.mocked(service.getDirectChildren)).not.toHaveBeenCalled();
  });
  it("preserves authentication errors and disables proxy caching", async () => {
    vi.mocked(service.getPostComments).mockResolvedValueOnce(
      NextResponse.json({ success: false }, { status: 403 }) as never,
    );
    const response = await GET(
      request("post", { slug: "example" }),
      context("post"),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("routes post to the server-only getPostComments service", async () => {
    vi.mocked(service.getPostComments).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: [] }) as never,
    );
    const response = await GET(
      request("post", { slug: "example" }),
      context("post"),
    );
    expect(vi.mocked(service.getPostComments)).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "example" }),
      { environment: "serverless" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("routes replies to the server-only getCommentReplies service", async () => {
    vi.mocked(service.getCommentReplies).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: [] }) as never,
    );
    const response = await GET(
      request("replies", { commentId: "00000000-0000-4000-8000-000000000001" }),
      context("replies"),
    );
    expect(vi.mocked(service.getCommentReplies)).toHaveBeenCalledWith(
      expect.objectContaining({
        commentId: "00000000-0000-4000-8000-000000000001",
      }),
      { environment: "serverless" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("routes children to the server-only getDirectChildren service", async () => {
    vi.mocked(service.getDirectChildren).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: [] }) as never,
    );
    const response = await GET(
      request("children", { parentId: null, postSlug: "example" }),
      context("children"),
    );
    expect(vi.mocked(service.getDirectChildren)).toHaveBeenCalledWith(
      expect.objectContaining({ parentId: null, postSlug: "example" }),
      { environment: "serverless" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
