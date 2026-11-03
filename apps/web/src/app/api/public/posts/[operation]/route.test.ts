import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/public/posts/[operation]/route";
import * as service from "@/lib/server/services/post-domain";

vi.mock("@/lib/server/services/post-domain", () => ({
  getPostsTrends: vi.fn(),
  getPostsList: vi.fn(),
  getPostDetail: vi.fn(),
  getPostHistory: vi.fn(),
  getPostVersion: vi.fn(),
  getProtectedPostContent: vi.fn(),
}));

function request(op: string, input?: unknown, suffix = "") {
  const url = new URL("https://example.com/api/public/posts/" + op);
  if (input !== undefined)
    url.searchParams.set("params", JSON.stringify(input));
  return new NextRequest(url.toString() + suffix);
}
const context = (operation: string) => ({
  params: Promise.resolve({ operation }),
});

describe("GET /api/public/posts/[operation]", () => {
  beforeEach(() => vi.clearAllMocks());
  it("rejects unknown operations, malformed input and credential leakage", async () => {
    expect((await GET(request("delete"), context("delete"))).status).toBe(400);
    const op = "trends";
    const malformed = new NextRequest(
      "https://example.com/api/public/posts/" + op + "?params=%7Bbroken",
    );
    expect((await GET(malformed, context(op))).status).toBe(400);
    expect(
      (await GET(request(op, { access_token: "forbidden" }), context(op)))
        .status,
    ).toBe(400);
    expect(
      (await GET(request(op, {}, "&access_token=bad"), context(op))).status,
    ).toBe(400);
    expect(vi.mocked(service.getPostsTrends)).not.toHaveBeenCalled();
    expect(vi.mocked(service.getPostsList)).not.toHaveBeenCalled();
    expect(vi.mocked(service.getPostDetail)).not.toHaveBeenCalled();
    expect(vi.mocked(service.getPostHistory)).not.toHaveBeenCalled();
    expect(vi.mocked(service.getPostVersion)).not.toHaveBeenCalled();
    expect(vi.mocked(service.getProtectedPostContent)).not.toHaveBeenCalled();
  });
  it("preserves authentication errors and disables proxy caching", async () => {
    vi.mocked(service.getPostsTrends).mockResolvedValueOnce(
      NextResponse.json({ success: false }, { status: 403 }) as never,
    );
    const response = await GET(request("trends", {}), context("trends"));
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("routes trends to the server-only getPostsTrends service", async () => {
    vi.mocked(service.getPostsTrends).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: [] }) as never,
    );
    const response = await GET(request("trends", {}), context("trends"));
    expect(vi.mocked(service.getPostsTrends)).toHaveBeenCalledWith(
      expect.objectContaining({}),
      { environment: "serverless" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("routes list to the server-only getPostsList service", async () => {
    vi.mocked(service.getPostsList).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: [] }) as never,
    );
    const response = await GET(request("list", {}), context("list"));
    expect(vi.mocked(service.getPostsList)).toHaveBeenCalledWith(
      expect.objectContaining({}),
      { environment: "serverless" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("routes detail to the server-only getPostDetail service", async () => {
    vi.mocked(service.getPostDetail).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: [] }) as never,
    );
    const response = await GET(
      request("detail", { slug: "example" }),
      context("detail"),
    );
    expect(vi.mocked(service.getPostDetail)).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "example" }),
      { environment: "serverless" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("routes history to the server-only getPostHistory service", async () => {
    vi.mocked(service.getPostHistory).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: [] }) as never,
    );
    const response = await GET(
      request("history", { slug: "example" }),
      context("history"),
    );
    expect(vi.mocked(service.getPostHistory)).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "example" }),
      { environment: "serverless" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("routes version to the server-only getPostVersion service", async () => {
    vi.mocked(service.getPostVersion).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: [] }) as never,
    );
    const response = await GET(
      request("version", { slug: "example" }),
      context("version"),
    );
    expect(vi.mocked(service.getPostVersion)).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "example" }),
      { environment: "serverless" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("routes protected-content to the server-only getProtectedPostContent service", async () => {
    vi.mocked(service.getProtectedPostContent).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: [] }) as never,
    );
    const response = await GET(
      request("protected-content", { slug: "example" }),
      context("protected-content"),
    );
    expect(vi.mocked(service.getProtectedPostContent)).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "example" }),
      { environment: "serverless" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
