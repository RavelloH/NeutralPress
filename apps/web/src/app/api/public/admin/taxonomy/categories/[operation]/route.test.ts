import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/public/admin/taxonomy/categories/[operation]/route";
import * as service from "@/lib/server/services/category";

vi.mock("@/lib/server/services/category", () => ({
  getCategoriesList: vi.fn(),
  getCategoryDetail: vi.fn(),
  searchCategories: vi.fn(),
  getCategoriesDistribution: vi.fn(),
  getCategoriesTree: vi.fn(),
}));

const cases = [
  ["list", "getCategoriesList", { page: 1, pageSize: 25 }],
  ["detail", "getCategoryDetail", { slug: "test" }],
  ["search", "searchCategories", { query: "term", limit: 10 }],
  ["distribution", "getCategoriesDistribution", { limit: 10 }],
  ["tree", "getCategoriesTree", { maxDepth: 2 }],
] as const;

function request(operation: string, params: unknown) {
  const url = new URL(
    "https://test.example/api/public/admin/taxonomy/categories/" + operation,
  );
  url.searchParams.set("params", JSON.stringify(params));
  return new NextRequest(url);
}
function context(operation: string) {
  return { params: Promise.resolve({ operation }) };
}

describe("protected categories GET API", () => {
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

  it("rejects access tokens embedded in URLs", async () => {
    const response = await GET(
      request("list", { access_token: "not-for-query-strings" }),
      context("list"),
    );
    expect(response.status).toBe(400);
    expect(service.getCategoriesList).not.toHaveBeenCalled();
  });

  it("rejects invalid params without a service call", async () => {
    const response = await GET(
      request("search", { query: "" }),
      context("search"),
    );
    expect(response.status).toBe(400);
    expect(service.searchCategories).not.toHaveBeenCalled();
  });

  it("preserves a service authorization failure", async () => {
    vi.mocked(service.searchCategories).mockResolvedValueOnce(
      NextResponse.json({ success: false }, { status: 401 }) as never,
    );
    const response = await GET(
      request("search", { query: "term" }),
      context("search"),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
