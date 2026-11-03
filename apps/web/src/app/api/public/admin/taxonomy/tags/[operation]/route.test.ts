import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/public/admin/taxonomy/tags/[operation]/route";
import * as service from "@/lib/server/services/tag";

vi.mock("@/lib/server/services/tag", () => ({
  getTagsList: vi.fn(),
  getTagDetail: vi.fn(),
  searchTags: vi.fn(),
  getTagsDistribution: vi.fn(),
}));

const cases = [
  ["list", "getTagsList", { page: 1, pageSize: 25 }],
  ["detail", "getTagDetail", { slug: "test" }],
  ["search", "searchTags", { query: "term", limit: 10 }],
  ["distribution", "getTagsDistribution", { limit: 10 }],
] as const;

function request(operation: string, params: unknown) {
  const url = new URL(
    "https://test.example/api/public/admin/taxonomy/tags/" + operation,
  );
  url.searchParams.set("params", JSON.stringify(params));
  return new NextRequest(url);
}
function context(operation: string) {
  return { params: Promise.resolve({ operation }) };
}

describe("protected tags GET API", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(cases)(
    "routes %s into its server-only service",
    async (op, method, params) => {
      const mock = (
        service as unknown as Record<string, ReturnType<typeof vi.fn>>
      )[method];
      expect(mock).toBeDefined();
      mock!.mockResolvedValueOnce(
        NextResponse.json({ success: true, data: [] }),
      );
      const response = await GET(request(op, params), context(op));
      expect(mock).toHaveBeenCalledOnce();
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    },
  );

  it("rejects tokens embedded in URL parameters", async () => {
    const response = await GET(
      request("list", { access_token: "sensitive" }),
      context("list"),
    );
    expect(response.status).toBe(400);
    expect(service.getTagsList).not.toHaveBeenCalled();
  });

  it("rejects an invalid search and preserves an authorization error", async () => {
    const bad = await GET(request("search", { query: "" }), context("search"));
    expect(bad.status).toBe(400);
    vi.mocked(service.searchTags).mockResolvedValueOnce(
      NextResponse.json({ success: false }, { status: 403 }) as never,
    );
    const unauthorized = await GET(
      request("search", { query: "tag" }),
      context("search"),
    );
    expect(unauthorized.status).toBe(403);
    expect(unauthorized.headers.get("cache-control")).toBe("private, no-store");
  });
});
