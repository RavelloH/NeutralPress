import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  unstable_cache: vi.fn((fn: (...args: unknown[]) => Promise<unknown>) => fn),
}));

vi.mock("@/lib/server/category-utils", () => ({
  findCategoryByPath: vi.fn(),
  countPublicCategoryPosts: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  default: { post: { count: vi.fn() } },
}));

vi.mock("@/lib/server/post-access", () => ({
  LISTABLE_POST_PUBLISHED_WHERE: { status: "PUBLISHED" },
}));

import {
  countPublicCategoryPosts,
  findCategoryByPath,
} from "@/lib/server/category-utils";
import prisma from "@/lib/server/prisma";
import {
  getCollectionKindFromTemplate,
  isValidPublicCollectionPage,
} from "@/lib/server/public-pagination";

describe("public pagination boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.post.count).mockResolvedValue(0);
  });

  it("recognizes only supported built-in collection templates", () => {
    expect(getCollectionKindFromTemplate("/posts/page/:page")).toBe("posts");
    expect(getCollectionKindFromTemplate("/tags/:slug/page/:page")).toBe(
      "tags",
    );
    expect(
      getCollectionKindFromTemplate("/categories/:slug.../page/:page"),
    ).toBe("categories");
    expect(getCollectionKindFromTemplate("/custom/page/:page")).toBeNull();
  });

  it("rejects invalid page indices before accessing data", async () => {
    for (const page of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(
        isValidPublicCollectionPage("/posts/page/:page", undefined, page, 20),
      ).resolves.toBe(false);
    }
    expect(prisma.post.count).not.toHaveBeenCalled();
  });

  it("serves the real last page and 404s after it", async () => {
    vi.mocked(prisma.post.count).mockResolvedValue(41);
    expect(
      await isValidPublicCollectionPage("/posts/page/:page", undefined, 3, 20),
    ).toBe(true);
    expect(
      await isValidPublicCollectionPage("/posts/page/:page", undefined, 4, 20),
    ).toBe(false);
  });

  it("allows an empty collection's first page but not the second", async () => {
    expect(
      await isValidPublicCollectionPage(
        "/tags/:slug/page/:page",
        "empty",
        1,
        20,
      ),
    ).toBe(true);
    expect(
      await isValidPublicCollectionPage(
        "/tags/:slug/page/:page",
        "empty",
        2,
        20,
      ),
    ).toBe(false);
  });

  it("uses the visible published tag post filter", async () => {
    vi.mocked(prisma.post.count).mockResolvedValue(8);
    expect(
      await isValidPublicCollectionPage(
        "/tags/:slug/page/:page",
        "react",
        2,
        5,
      ),
    ).toBe(true);
    expect(prisma.post.count).toHaveBeenCalledWith({
      where: { status: "PUBLISHED", tags: { some: { slug: "react" } } },
    });
  });

  it("resolves nested category counts", async () => {
    vi.mocked(findCategoryByPath).mockResolvedValue({ id: 10 } as never);
    vi.mocked(countPublicCategoryPosts).mockResolvedValue(26);
    expect(
      await isValidPublicCollectionPage(
        "/categories/:slug.../page/:page",
        "development/backend",
        3,
        10,
      ),
    ).toBe(true);
    expect(
      await isValidPublicCollectionPage(
        "/categories/:slug.../page/:page",
        "development/backend",
        4,
        10,
      ),
    ).toBe(false);
    expect(findCategoryByPath).toHaveBeenCalledWith(["development", "backend"]);
    expect(countPublicCategoryPosts).toHaveBeenCalledWith(10);
  });

  it("does not impose post pagination on custom data-source pages", async () => {
    expect(
      await isValidPublicCollectionPage(
        "/catalog/page/:page",
        undefined,
        50,
        10,
      ),
    ).toBe(true);
  });
});
