import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Mock prisma
const _mockFindMany = vi.fn();
vi.mock("@/lib/server/prisma", () => ({
  default: {
    config: { findMany: vi.fn().mockResolvedValue([]) },
    page: { findMany: vi.fn().mockResolvedValue([]) },
    post: { findMany: vi.fn().mockResolvedValue([]) },
    project: { findMany: vi.fn().mockResolvedValue([]) },
    tag: { findMany: vi.fn().mockResolvedValue([]) },
    category: { findMany: vi.fn().mockResolvedValue([]) },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    photo: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

// Mock post-access
vi.mock("@/lib/server/post-access", () => ({
  LISTABLE_POST_PUBLISHED_WHERE: { deletedAt: null, status: "PUBLISHED" },
}));

describe("cache-bootstrap-targets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getCriticalRevalidatePathTargets", () => {
    it("应返回路径目标数组", async () => {
      const { getCriticalRevalidatePathTargets } = await import(
        "@/lib/server/cache-bootstrap-targets"
      );
      const targets = getCriticalRevalidatePathTargets();

      expect(Array.isArray(targets)).toBe(true);
      expect(targets.length).toBeGreaterThan(0);
    });

    it("具体 URL 不设置 type，动态路由和布局目标才设置 type", async () => {
      const { getCriticalRevalidatePathTargets } = await import(
        "@/lib/server/cache-bootstrap-targets"
      );
      const targets = getCriticalRevalidatePathTargets();
      const byPath = new Map(
        targets.map((target) => [target.path, target] as const),
      );

      for (const target of targets) {
        expect(typeof target.path).toBe("string");
        if (target.type !== undefined) {
          expect(["page", "layout"]).toContain(target.type);
        }
      }

      for (const path of [
        "/",
        "/posts",
        "/archive",
        "/projects",
        "/gallery",
        "/feed.xml",
        "/feed.json",
        "/sitemap.xml",
      ]) {
        expect(byPath.get(path)?.type).toBeUndefined();
      }
      expect(byPath.get("/(main)/[[...slug]]")?.type).toBe("page");
    });

    it("应包含根路径", async () => {
      const { getCriticalRevalidatePathTargets } = await import(
        "@/lib/server/cache-bootstrap-targets"
      );
      const targets = getCriticalRevalidatePathTargets();

      const rootPaths = targets.filter((t) => t.path === "/");
      expect(rootPaths.length).toBeGreaterThanOrEqual(1);
    });

    it("应包含 posts 路径", async () => {
      const { getCriticalRevalidatePathTargets } = await import(
        "@/lib/server/cache-bootstrap-targets"
      );
      const targets = getCriticalRevalidatePathTargets();

      const postsPaths = targets.filter((t) => t.path === "/posts");
      expect(postsPaths).toHaveLength(1);
      expect(postsPaths[0]?.type).toBeUndefined();
      expect(targets.find((t) => t.path === "/archive")?.type).toBeUndefined();
    });

    it("应去重返回", async () => {
      const { getCriticalRevalidatePathTargets } = await import(
        "@/lib/server/cache-bootstrap-targets"
      );
      const targets = getCriticalRevalidatePathTargets();

      const dedupCheck = new Set<string>();
      for (const target of targets) {
        const key = `${target.type ?? "exact"}:${target.path}`;
        expect(dedupCheck.has(key)).toBe(false);
        dedupCheck.add(key);
      }
    });

    it("应包含 layout 类型的路径", async () => {
      const { getCriticalRevalidatePathTargets } = await import(
        "@/lib/server/cache-bootstrap-targets"
      );
      const targets = getCriticalRevalidatePathTargets();

      const layoutTargets = targets.filter((t) => t.type === "layout");
      expect(layoutTargets.length).toBeGreaterThan(0);
    });

    it("应包含 page 类型的路径", async () => {
      const { getCriticalRevalidatePathTargets } = await import(
        "@/lib/server/cache-bootstrap-targets"
      );
      const targets = getCriticalRevalidatePathTargets();

      const pageTargets = targets.filter((t) => t.type === "page");
      expect(pageTargets.length).toBeGreaterThan(0);
    });
  });

  describe("collectBootstrapTags", () => {
    it("应返回包含基础标签的数组", async () => {
      const prisma = (await import("@/lib/server/prisma")).default;
      (prisma.config.findMany as any).mockResolvedValue([]);
      (prisma.page.findMany as any).mockResolvedValue([]);
      (prisma.post.findMany as any).mockResolvedValue([]);
      (prisma.project.findMany as any).mockResolvedValue([]);
      (prisma.tag.findMany as any).mockResolvedValue([]);
      (prisma.category.findMany as any).mockResolvedValue([]);
      (prisma.user.findMany as any).mockResolvedValue([]);
      (prisma.photo.findMany as any).mockResolvedValue([]);

      const { collectBootstrapTags } = await import(
        "@/lib/server/cache-bootstrap-targets"
      );
      const tags = await collectBootstrapTags();

      expect(Array.isArray(tags)).toBe(true);
      expect(tags).toContain("config");
      expect(tags).toContain("menus");
      expect(tags).toContain("pages");
      expect(tags).toContain("posts");
      expect(tags).toContain("tags");
      expect(tags).toContain("categories");
      expect(tags).toContain("users");
      expect(tags).toContain("friend-links");
    });

    it("应为每个配置项添加 config/{key} 标签", async () => {
      const prisma = (await import("@/lib/server/prisma")).default;
      (prisma.config.findMany as any).mockResolvedValue([
        { key: "site.title" },
        { key: "site.url" },
      ]);
      (prisma.page.findMany as any).mockResolvedValue([]);
      (prisma.post.findMany as any).mockResolvedValue([]);
      (prisma.project.findMany as any).mockResolvedValue([]);
      (prisma.tag.findMany as any).mockResolvedValue([]);
      (prisma.category.findMany as any).mockResolvedValue([]);
      (prisma.user.findMany as any).mockResolvedValue([]);
      (prisma.photo.findMany as any).mockResolvedValue([]);

      const { collectBootstrapTags } = await import(
        "@/lib/server/cache-bootstrap-targets"
      );
      const tags = await collectBootstrapTags();

      expect(tags).toContain("config/site.title");
      expect(tags).toContain("config/site.url");
    });

    it("应为每个页面添加 pages/{id} 标签", async () => {
      const prisma = (await import("@/lib/server/prisma")).default;
      (prisma.config.findMany as any).mockResolvedValue([]);
      (prisma.page.findMany as any).mockResolvedValue([
        { id: "page-1" },
        { id: "page-2" },
      ]);
      (prisma.post.findMany as any).mockResolvedValue([]);
      (prisma.project.findMany as any).mockResolvedValue([]);
      (prisma.tag.findMany as any).mockResolvedValue([]);
      (prisma.category.findMany as any).mockResolvedValue([]);
      (prisma.user.findMany as any).mockResolvedValue([]);
      (prisma.photo.findMany as any).mockResolvedValue([]);

      const { collectBootstrapTags } = await import(
        "@/lib/server/cache-bootstrap-targets"
      );
      const tags = await collectBootstrapTags();

      expect(tags).toContain("pages/page-1");
      expect(tags).toContain("pages/page-2");
    });

    it("应为已发布文章添加 posts/{slug} 和 users/{uid} 标签", async () => {
      const prisma = (await import("@/lib/server/prisma")).default;
      (prisma.config.findMany as any).mockResolvedValue([]);
      (prisma.page.findMany as any).mockResolvedValue([]);
      (prisma.post.findMany as any).mockResolvedValue([
        { slug: "hello-world", userUid: 1 },
      ]);
      (prisma.project.findMany as any).mockResolvedValue([]);
      (prisma.tag.findMany as any).mockResolvedValue([]);
      (prisma.category.findMany as any).mockResolvedValue([]);
      (prisma.user.findMany as any).mockResolvedValue([]);
      (prisma.photo.findMany as any).mockResolvedValue([]);

      const { collectBootstrapTags } = await import(
        "@/lib/server/cache-bootstrap-targets"
      );
      const tags = await collectBootstrapTags();

      expect(tags).toContain("posts/hello-world");
      expect(tags).toContain("users/1");
    });

    it("应为标签添加 tags/{slug} 标签", async () => {
      const prisma = (await import("@/lib/server/prisma")).default;
      (prisma.config.findMany as any).mockResolvedValue([]);
      (prisma.page.findMany as any).mockResolvedValue([]);
      (prisma.post.findMany as any).mockResolvedValue([]);
      (prisma.project.findMany as any).mockResolvedValue([]);
      (prisma.tag.findMany as any).mockResolvedValue([
        { slug: "react" },
        { slug: "typescript" },
      ]);
      (prisma.category.findMany as any).mockResolvedValue([]);
      (prisma.user.findMany as any).mockResolvedValue([]);
      (prisma.photo.findMany as any).mockResolvedValue([]);

      const { collectBootstrapTags } = await import(
        "@/lib/server/cache-bootstrap-targets"
      );
      const tags = await collectBootstrapTags();

      expect(tags).toContain("tags/react");
      expect(tags).toContain("tags/typescript");
    });

    it("应为分类添加 categories/{fullSlug} 标签", async () => {
      const prisma = (await import("@/lib/server/prisma")).default;
      (prisma.config.findMany as any).mockResolvedValue([]);
      (prisma.page.findMany as any).mockResolvedValue([]);
      (prisma.post.findMany as any).mockResolvedValue([]);
      (prisma.project.findMany as any).mockResolvedValue([]);
      (prisma.tag.findMany as any).mockResolvedValue([]);
      (prisma.category.findMany as any).mockResolvedValue([
        { fullSlug: "tech" },
        { fullSlug: "tech/frontend" },
      ]);
      (prisma.user.findMany as any).mockResolvedValue([]);
      (prisma.photo.findMany as any).mockResolvedValue([]);

      const { collectBootstrapTags } = await import(
        "@/lib/server/cache-bootstrap-targets"
      );
      const tags = await collectBootstrapTags();

      expect(tags).toContain("categories/tech");
      expect(tags).toContain("categories/tech/frontend");
    });

    it("应为照片添加 photos/{slug} 标签", async () => {
      const prisma = (await import("@/lib/server/prisma")).default;
      (prisma.config.findMany as any).mockResolvedValue([]);
      (prisma.page.findMany as any).mockResolvedValue([]);
      (prisma.post.findMany as any).mockResolvedValue([]);
      (prisma.project.findMany as any).mockResolvedValue([]);
      (prisma.tag.findMany as any).mockResolvedValue([]);
      (prisma.category.findMany as any).mockResolvedValue([]);
      (prisma.user.findMany as any).mockResolvedValue([]);
      (prisma.photo.findMany as any).mockResolvedValue([{ slug: "sunset" }]);

      const { collectBootstrapTags } = await import(
        "@/lib/server/cache-bootstrap-targets"
      );
      const tags = await collectBootstrapTags();

      expect(tags).toContain("photos/sunset");
    });

    it("应跳过空 slug 的项目", async () => {
      const prisma = (await import("@/lib/server/prisma")).default;
      (prisma.config.findMany as any).mockResolvedValue([]);
      (prisma.page.findMany as any).mockResolvedValue([]);
      (prisma.post.findMany as any).mockResolvedValue([
        { slug: "  ", userUid: 1 },
      ]);
      (prisma.project.findMany as any).mockResolvedValue([]);
      (prisma.tag.findMany as any).mockResolvedValue([{ slug: "" }]);
      (prisma.category.findMany as any).mockResolvedValue([{ fullSlug: "  " }]);
      (prisma.user.findMany as any).mockResolvedValue([]);
      (prisma.photo.findMany as any).mockResolvedValue([{ slug: "  " }]);

      const { collectBootstrapTags } = await import(
        "@/lib/server/cache-bootstrap-targets"
      );
      const tags = await collectBootstrapTags();

      expect(tags).not.toContain("posts/");
      expect(tags).not.toContain("tags/");
      expect(tags).not.toContain("categories/");
      expect(tags).not.toContain("photos/");
    });

    it("返回的标签应按字母顺序排序", async () => {
      const prisma = (await import("@/lib/server/prisma")).default;
      (prisma.config.findMany as any).mockResolvedValue([]);
      (prisma.page.findMany as any).mockResolvedValue([]);
      (prisma.post.findMany as any).mockResolvedValue([]);
      (prisma.project.findMany as any).mockResolvedValue([]);
      (prisma.tag.findMany as any).mockResolvedValue([]);
      (prisma.category.findMany as any).mockResolvedValue([]);
      (prisma.user.findMany as any).mockResolvedValue([]);
      (prisma.photo.findMany as any).mockResolvedValue([]);

      const { collectBootstrapTags } = await import(
        "@/lib/server/cache-bootstrap-targets"
      );
      const tags = await collectBootstrapTags();

      const sorted = [...tags].sort((a, b) => a.localeCompare(b));
      expect(tags).toEqual(sorted);
    });

    it("应为项目添加 projects/{slug} 标签", async () => {
      const prisma = (await import("@/lib/server/prisma")).default;
      (prisma.config.findMany as any).mockResolvedValue([]);
      (prisma.page.findMany as any).mockResolvedValue([]);
      (prisma.post.findMany as any).mockResolvedValue([]);
      (prisma.project.findMany as any).mockResolvedValue([
        { slug: "my-project", userUid: 1 },
      ]);
      (prisma.tag.findMany as any).mockResolvedValue([]);
      (prisma.category.findMany as any).mockResolvedValue([]);
      (prisma.user.findMany as any).mockResolvedValue([]);
      (prisma.photo.findMany as any).mockResolvedValue([]);

      const { collectBootstrapTags } = await import(
        "@/lib/server/cache-bootstrap-targets"
      );
      const tags = await collectBootstrapTags();

      expect(tags).toContain("projects/my-project");
      expect(tags).toContain("users/1");
    });
  });
});
