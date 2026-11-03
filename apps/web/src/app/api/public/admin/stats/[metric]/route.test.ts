import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/public/admin/stats/[metric]/route";
import * as stats from "@/lib/server/services/stats";

vi.mock("@/lib/server/services/stats", () => ({
  getUsersStats: vi.fn(),
  getAuditStats: vi.fn(),
  getPostsStats: vi.fn(),
  getTagsStats: vi.fn(),
  getCategoriesStats: vi.fn(),
  getPagesStats: vi.fn(),
  getStorageStats: vi.fn(),
  getVisitStats: vi.fn(),
  getProjectsStats: vi.fn(),
}));

const metrics = [
  "users",
  "audit",
  "posts",
  "tags",
  "categories",
  "pages",
  "storage",
  "visit",
  "projects",
] as const;

function request(metric: string, qs = "") {
  return new NextRequest(
    "https://example.com/api/public/admin/stats/" + metric + qs,
  );
}
function context(metric: string) {
  return { params: Promise.resolve({ metric }) };
}
describe("GET /api/public/admin/stats/[metric]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects an unknown metric or invalid boolean without invoking services", async () => {
    expect((await GET(request("unknown"), context("unknown"))).status).toBe(
      400,
    );
    expect(
      (await GET(request("users", "?force=1"), context("users"))).status,
    ).toBe(400);
    expect(vi.mocked(stats.getUsersStats)).not.toHaveBeenCalled();
  });

  it.each(metrics)(
    "dispatches %s with validated force, no shared cache",
    async (metric) => {
      const method =
        "get" + metric.charAt(0).toUpperCase() + metric.slice(1) + "Stats";
      const mock = vi.mocked(
        (stats as unknown as Record<string, typeof stats.getUsersStats>)[
          method
        ],
      );
      mock!.mockResolvedValueOnce(
        NextResponse.json({ success: true, data: {} }) as never,
      );
      const response = await GET(
        request(metric, "?force=true"),
        context(metric),
      );
      expect(mock).toHaveBeenCalledWith(
        { force: true },
        { environment: "serverless" },
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    },
  );

  it("preserves authentication errors returned by a service", async () => {
    vi.mocked(stats.getUsersStats).mockResolvedValueOnce(
      NextResponse.json({ success: false }, { status: 401 }) as never,
    );
    const response = await GET(request("users"), context("users"));
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
