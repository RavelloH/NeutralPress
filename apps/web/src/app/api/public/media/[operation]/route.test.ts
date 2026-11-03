import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/public/media/[operation]/route";
import * as service from "@/lib/server/services/media-domain";

vi.mock("@/lib/server/services/media-domain", () => ({
  getGalleryPhotos: vi.fn(),
}));

function request(op: string, input?: unknown, suffix = "") {
  const url = new URL("https://example.com/api/public/media/" + op);
  if (input !== undefined)
    url.searchParams.set("params", JSON.stringify(input));
  return new NextRequest(url.toString() + suffix);
}
const context = (operation: string) => ({
  params: Promise.resolve({ operation }),
});

describe("GET /api/public/media/[operation]", () => {
  beforeEach(() => vi.clearAllMocks());
  it("rejects unknown operations, malformed input and credential leakage", async () => {
    expect((await GET(request("delete"), context("delete"))).status).toBe(400);
    const op = "gallery";
    const malformed = new NextRequest(
      "https://example.com/api/public/media/" + op + "?params=%7Bbroken",
    );
    expect((await GET(malformed, context(op))).status).toBe(400);
    expect(
      (await GET(request(op, { access_token: "forbidden" }), context(op)))
        .status,
    ).toBe(400);
    expect(
      (await GET(request(op, {}, "&access_token=bad"), context(op))).status,
    ).toBe(400);
    expect(vi.mocked(service.getGalleryPhotos)).not.toHaveBeenCalled();
  });
  it("preserves authentication errors and disables proxy caching", async () => {
    vi.mocked(service.getGalleryPhotos).mockResolvedValueOnce(
      NextResponse.json({ success: false }, { status: 403 }) as never,
    );
    const response = await GET(request("gallery", {}), context("gallery"));
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("routes gallery to the server-only getGalleryPhotos service", async () => {
    vi.mocked(service.getGalleryPhotos).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: [] }) as never,
    );
    const response = await GET(request("gallery", {}), context("gallery"));
    expect(vi.mocked(service.getGalleryPhotos)).toHaveBeenCalledWith(
      expect.objectContaining({}),
      { environment: "serverless" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
