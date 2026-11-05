import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/prisma", () => ({
  default: {
    page: { findMany: vi.fn(), findUnique: vi.fn() },
    category: { findMany: vi.fn() },
    tag: { findMany: vi.fn() },
    post: { findMany: vi.fn(), count: vi.fn().mockResolvedValue(40) },
  },
}));

vi.mock("next/cache", () => ({
  unstable_cache: vi.fn((fn: (...args: unknown[]) => Promise<unknown>) => fn),
}));

vi.mock("@/lib/server/post-access", () => ({
  LISTABLE_POST_PUBLISHED_WHERE: { status: "PUBLISHED" },
}));

import type { SystemPageConfig } from "@/lib/server/page-cache";
import {
  createPageConfigBuilder,
  getAllActivePages,
  getBlocksAreas,
  getMainRouteStaticParams,
  getMainRouteTopLevelStaticParams,
  getMatchingPage,
  getPageBlock,
  getPageBlockValue,
  getPageComponent,
  getPageComponentValue,
  getPagesByStatus,
  getPagesByUser,
  getRawPage,
  getRawPageById,
  getSystemPageConfig,
  getSystemPages,
  PageConfigBuilder,
} from "@/lib/server/page-cache";
import prisma from "@/lib/server/prisma";

const mockPrisma = vi.mocked(prisma);

function createMockDbPage(overrides: Record<string, unknown> = {}) {
  return {
    id: "page-1",
    title: "Test Page",
    slug: "/test",
    content: "Test content",
    contentType: "MARKDOWN",
    config: null,
    status: "ACTIVE",
    deletedAt: null,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-06-01"),
    isSystemPage: false,
    metaDescription: null,
    metaKeywords: null,
    robotsIndex: true,
    userUid: 1,
    author: { uid: 1, username: "admin", nickname: "Admin", avatar: null },
    ...overrides,
  };
}

describe("page-cache expanded", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getBlocksAreas", () => {
    it("无 header/footer 时返回 1-12", () => {
      expect(getBlocksAreas(false, false)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
      ]);
    });

    it("有 header 时排除 area 1", () => {
      const result = getBlocksAreas(true, false);
      expect(result).not.toContain(1);
      expect(result).toContain(2);
      expect(result).toContain(12);
    });

    it("有 footer 时排除 area 12", () => {
      const result = getBlocksAreas(false, true);
      expect(result).toContain(1);
      expect(result).not.toContain(12);
    });

    it("同时有 header 和 footer 时排除 1 和 12", () => {
      const result = getBlocksAreas(true, true);
      expect(result).not.toContain(1);
      expect(result).not.toContain(12);
      expect(result).toHaveLength(10);
    });
  });

  describe("getSystemPageConfig", () => {
    it("null 页面返回 null", () => {
      expect(getSystemPageConfig(null)).toBeNull();
    });

    it("无 config 的页面返回 null", () => {
      expect(getSystemPageConfig({ config: null } as any)).toBeNull();
    });

    it("非对象 config 返回 null", () => {
      expect(getSystemPageConfig({ config: "string" } as any)).toBeNull();
    });

    it("有 blocks 的 config 返回配置", () => {
      const blocks = [{ id: 1, type: "hero", content: {} }];
      const page = { config: { blocks } } as any;
      const result = getSystemPageConfig(page);
      expect(result).not.toBeNull();
      expect(result?.blocks).toEqual(blocks);
    });

    it("有 components 的 config 返回配置", () => {
      const components = [{ id: "c1", value: {}, description: "desc" }];
      const page = { config: { components } } as any;
      const result = getSystemPageConfig(page);
      expect(result).not.toBeNull();
      expect(result?.components).toEqual(components);
    });

    it("无 blocks 且无 components 返回 null", () => {
      expect(
        getSystemPageConfig({ config: { other: true } } as any),
      ).toBeNull();
    });
  });

  describe("getPageBlock", () => {
    const blocks = [
      { id: 1, type: "hero", content: {} },
      { id: 2, type: "text", content: {} },
      { id: "abc", type: "custom", content: {} },
    ] as any;

    it("按数字 id 查找", () => {
      expect(getPageBlock({ blocks }, 1)).toBeDefined();
      expect(getPageBlock({ blocks }, 1)?.id).toBe(1);
    });

    it("按字符串 id 查找", () => {
      expect(getPageBlock({ blocks }, "abc")).toBeDefined();
      expect(getPageBlock({ blocks }, "abc")?.id).toBe("abc");
    });

    it("未找到返回 null", () => {
      expect(getPageBlock({ blocks }, 999)).toBeNull();
    });

    it("null config 返回 null", () => {
      expect(getPageBlock(null, 1)).toBeNull();
    });

    it("无 blocks 返回 null", () => {
      expect(getPageBlock({ components: [] }, 1)).toBeNull();
    });
  });

  describe("getPageComponent", () => {
    const components = [
      { id: "header", value: { header: "Title" }, description: "Header" },
      { id: "footer", value: { content: ["link1"] }, description: "Footer" },
    ] as any;

    it("按 id 查找", () => {
      expect(getPageComponent({ components }, "header")).toBeDefined();
    });

    it("未找到返回 null", () => {
      expect(getPageComponent({ components }, "missing")).toBeNull();
    });

    it("null config 返回 null", () => {
      expect(getPageComponent(null, "header")).toBeNull();
    });
  });

  describe("getPageBlockValue", () => {
    const config: SystemPageConfig = {
      blocks: [
        {
          id: 1,
          type: "hero",
          content: {
            title: { value: "Welcome" },
            content: { top: { value: ["a", "b"] } },
            footer: { link: "/more", text: "Read More" },
          },
        },
      ] as any,
    };

    it("通过点路径获取嵌套值", () => {
      expect(getPageBlockValue(config, 1, "title.value")).toBe("Welcome");
    });

    it("获取深层嵌套值", () => {
      expect(getPageBlockValue(config, 1, "content.top.value")).toEqual([
        "a",
        "b",
      ]);
    });

    it("路径不存在时返回默认值", () => {
      expect(getPageBlockValue(config, 1, "missing", "default")).toBe(
        "default",
      );
    });

    it("无默认值时返回 null", () => {
      expect(getPageBlockValue(config, 1, "missing")).toBeNull();
    });

    it("block 不存在时返回默认值", () => {
      expect(getPageBlockValue(config, 999, "title", "fallback")).toBe(
        "fallback",
      );
    });

    it("null config 返回 null", () => {
      expect(getPageBlockValue(null, 1, "title")).toBeNull();
    });
  });

  describe("getPageComponentValue", () => {
    const config: SystemPageConfig = {
      components: [
        {
          id: "hero",
          value: { header: "Title", content: "Body" },
          description: "Hero",
        },
      ],
    };

    it("获取简单字段", () => {
      expect(getPageComponentValue(config, "hero", "header")).toBe("Title");
    });

    it("字段不存在时返回默认值", () => {
      expect(getPageComponentValue(config, "hero", "missing", "default")).toBe(
        "default",
      );
    });

    it("组件不存在时返回 null", () => {
      expect(getPageComponentValue(config, "missing", "field")).toBeNull();
    });

    it("null config 返回 null", () => {
      expect(getPageComponentValue(null, "hero", "header")).toBeNull();
    });
  });

  describe("PageConfigBuilder", () => {
    const config: SystemPageConfig = {
      blocks: [
        {
          id: 1,
          type: "hero",
          content: {
            title: { value: "Page Title" },
            header: { value: "Page Header" },
            content: {
              top: { value: ["top-item-1"] },
              bottom: { value: ["bottom-item-1"] },
            },
            footer: { link: "/footer-link", text: "Footer Text" },
          },
        },
      ] as any,
      components: [
        {
          id: "comp-hero",
          value: { header: "Component Header" },
          description: "A hero component",
        },
      ],
    };

    it("构造函数接受 null", () => {
      const builder = new PageConfigBuilder(null);
      expect(builder.isBlockEnabled(1)).toBe(false);
    });

    it("getBlock 返回 block", () => {
      const builder = new PageConfigBuilder(config);
      expect(builder.getBlock(1)).toBeDefined();
    });

    it("getBlockTitle 返回标题", () => {
      const builder = new PageConfigBuilder(config);
      expect(builder.getBlockTitle(1)).toBe("Page Title");
    });

    it("getBlockHeader 返回 header", () => {
      const builder = new PageConfigBuilder(config);
      expect(builder.getBlockHeader(1)).toBe("Page Header");
    });

    it("getBlockContent 返回 top content", () => {
      const builder = new PageConfigBuilder(config);
      expect(builder.getBlockContent(1)).toEqual(["top-item-1"]);
    });

    it("getBlockContent 返回 bottom content", () => {
      const builder = new PageConfigBuilder(config);
      expect(builder.getBlockContent(1, "bottom")).toEqual(["bottom-item-1"]);
    });

    it("getBlockFooterLink 返回 footer link", () => {
      const builder = new PageConfigBuilder(config);
      expect(builder.getBlockFooterLink(1)).toBe("/footer-link");
    });

    it("getBlockFooterText 返回 footer text", () => {
      const builder = new PageConfigBuilder(config);
      expect(builder.getBlockFooterText(1)).toBe("Footer Text");
    });

    it("isBlockEnabled 返回 true 当 block 存在", () => {
      const builder = new PageConfigBuilder(config);
      expect(builder.isBlockEnabled(1)).toBe(true);
    });

    it("isBlockEnabled 返回 false 当 block 不存在", () => {
      const builder = new PageConfigBuilder(config);
      expect(builder.isBlockEnabled(999)).toBe(false);
    });

    it("getComponentValue 返回组件字段", () => {
      const builder = new PageConfigBuilder(config);
      expect(builder.getComponentValue("comp-hero", "header")).toBe(
        "Component Header",
      );
    });

    it("null config 时 getBlockTitle 返回默认值", () => {
      const builder = new PageConfigBuilder(null);
      expect(builder.getBlockTitle(1, "default")).toBe("default");
    });

    it("null config 时 getBlockContent 返回空数组", () => {
      const builder = new PageConfigBuilder(null);
      expect(builder.getBlockContent(1)).toEqual([]);
    });

    it("null config 时 getBlockFooterLink 返回空字符串", () => {
      const builder = new PageConfigBuilder(null);
      expect(builder.getBlockFooterLink(1)).toBe("");
    });
  });

  describe("createPageConfigBuilder", () => {
    it("返回 PageConfigBuilder 实例", () => {
      expect(createPageConfigBuilder(null)).toBeInstanceOf(PageConfigBuilder);
    });

    it("创建可用的 builder", () => {
      const config: SystemPageConfig = {
        blocks: [
          { id: 1, type: "hero", content: { title: { value: "Test" } } },
        ] as any,
      };
      const builder = createPageConfigBuilder(config);
      expect(builder.isBlockEnabled(1)).toBe(true);
      expect(builder.getBlockTitle(1)).toBe("Test");
    });
  });

  describe("getRawPage", () => {
    it("从数据库返回页面", async () => {
      (mockPrisma.page.findUnique as any).mockResolvedValue(
        createMockDbPage({
          id: "page-1",
          slug: "/test-page",
          title: "Test Page",
        }),
      );
      const result = await getRawPage("/test-page");
      expect(result).not.toBeNull();
      expect(result?.id).toBe("page-1");
      expect(result?.slug).toBe("/test-page");
    });

    it("页面不存在时返回 null", async () => {
      (mockPrisma.page.findUnique as any).mockResolvedValue(null);
      const result = await getRawPage("/nonexistent");
      expect(result).toBeNull();
    });

    it("数据库查询失败时返回 null", async () => {
      (mockPrisma.page.findUnique as any).mockRejectedValue(
        new Error("DB error"),
      );
      const result = await getRawPage("/error-page");
      expect(result).toBeNull();
    });
  });

  describe("getRawPageById", () => {
    it("按 id 从数据库返回页面", async () => {
      (mockPrisma.page.findUnique as any).mockResolvedValue(
        createMockDbPage({ id: "specific-id", title: "Found By ID" }),
      );
      const result = await getRawPageById("specific-id");
      expect(result).not.toBeNull();
      expect(result?.id).toBe("specific-id");
    });

    it("未找到时返回 null", async () => {
      (mockPrisma.page.findUnique as any).mockResolvedValue(null);
      const result = await getRawPageById("nonexistent-id");
      expect(result).toBeNull();
    });
  });

  describe("getMatchingPage", () => {
    it("精确匹配路径", async () => {
      (mockPrisma.page.findUnique as any).mockResolvedValue(
        createMockDbPage({
          id: "exact-page",
          slug: "/about",
          title: "About",
          status: "ACTIVE",
          deletedAt: null,
        }),
      );
      const result = await getMatchingPage(["about"]);
      expect(result).not.toBeNull();
      expect(result?.page.slug).toBe("/about");
    });

    it("无匹配时返回 null", async () => {
      (mockPrisma.page.findUnique as any).mockResolvedValue(null);
      const result = await getMatchingPage(["nonexistent"]);
      expect(result).toBeNull();
    });

    it("处理空 slug（根路径）", async () => {
      (mockPrisma.page.findUnique as any).mockImplementation(
        async (args: any) => {
          if (args?.where?.slug === "/")
            return createMockDbPage({
              id: "home",
              slug: "/",
              title: "Home",
              status: "ACTIVE",
              deletedAt: null,
            });
          return null;
        },
      );
      const result = await getMatchingPage([]);
      expect(result).not.toBeNull();
      expect(result?.page.slug).toBe("/");
    });
  });

  describe("getAllActivePages", () => {
    it("返回活跃页面", async () => {
      (mockPrisma.page.findMany as any).mockResolvedValue([
        createMockDbPage({
          id: "1",
          slug: "/active",
          status: "ACTIVE",
          deletedAt: null,
        }),
        createMockDbPage({
          id: "2",
          slug: "/suspended",
          status: "SUSPENDED",
          deletedAt: null,
        }),
      ]);
      const result = await getAllActivePages();
      expect(Object.keys(result)).toContain("/active");
      expect(Object.keys(result)).not.toContain("/suspended");
    });

    it("排除已删除页面", async () => {
      (mockPrisma.page.findMany as any).mockResolvedValue([
        createMockDbPage({
          id: "1",
          slug: "/active",
          status: "ACTIVE",
          deletedAt: null,
        }),
        createMockDbPage({
          id: "2",
          slug: "/deleted",
          status: "ACTIVE",
          deletedAt: new Date(),
        }),
      ]);
      const result = await getAllActivePages();
      expect(Object.keys(result)).toContain("/active");
      expect(Object.keys(result)).not.toContain("/deleted");
    });

    it("数据库失败时返回空对象", async () => {
      (mockPrisma.page.findMany as any).mockRejectedValue(
        new Error("DB error"),
      );
      const result = await getAllActivePages();
      expect(result).toEqual({});
    });
  });

  describe("getPagesByStatus", () => {
    it("只返回指定状态的页面", async () => {
      (mockPrisma.page.findMany as any).mockResolvedValue([
        createMockDbPage({
          id: "1",
          slug: "/a",
          status: "ACTIVE",
          deletedAt: null,
        }),
        createMockDbPage({
          id: "2",
          slug: "/b",
          status: "SUSPENDED",
          deletedAt: null,
        }),
        createMockDbPage({
          id: "3",
          slug: "/c",
          status: "ACTIVE",
          deletedAt: null,
        }),
      ]);
      const result = await getPagesByStatus("ACTIVE");
      expect(Object.keys(result)).toHaveLength(2);
      expect(Object.keys(result)).toContain("/a");
      expect(Object.keys(result)).toContain("/c");
    });

    it("排除已删除页面", async () => {
      (mockPrisma.page.findMany as any).mockResolvedValue([
        createMockDbPage({
          id: "1",
          slug: "/a",
          status: "ACTIVE",
          deletedAt: null,
        }),
        createMockDbPage({
          id: "2",
          slug: "/b",
          status: "ACTIVE",
          deletedAt: new Date(),
        }),
      ]);
      const result = await getPagesByStatus("ACTIVE");
      expect(Object.keys(result)).toHaveLength(1);
    });
  });

  describe("getSystemPages", () => {
    it("只返回系统页面", async () => {
      (mockPrisma.page.findMany as any).mockResolvedValue([
        createMockDbPage({
          id: "1",
          slug: "/sys",
          status: "ACTIVE",
          deletedAt: null,
          isSystemPage: true,
        }),
        createMockDbPage({
          id: "2",
          slug: "/user",
          status: "ACTIVE",
          deletedAt: null,
          isSystemPage: false,
        }),
      ]);
      const result = await getSystemPages();
      expect(Object.keys(result)).toHaveLength(1);
      expect(Object.keys(result)).toContain("/sys");
    });

    it("排除暂停的系统页面", async () => {
      (mockPrisma.page.findMany as any).mockResolvedValue([
        createMockDbPage({
          id: "1",
          slug: "/sys-active",
          status: "ACTIVE",
          deletedAt: null,
          isSystemPage: true,
        }),
        createMockDbPage({
          id: "2",
          slug: "/sys-suspended",
          status: "SUSPENDED",
          deletedAt: null,
          isSystemPage: true,
        }),
      ]);
      const result = await getSystemPages();
      expect(Object.keys(result)).toHaveLength(1);
      expect(Object.keys(result)).toContain("/sys-active");
    });
  });

  describe("getPagesByUser", () => {
    it("返回指定用户的页面", async () => {
      (mockPrisma.page.findMany as any).mockResolvedValue([
        createMockDbPage({
          id: "1",
          slug: "/user1-page",
          status: "ACTIVE",
          deletedAt: null,
          isSystemPage: false,
          userUid: 1,
        }),
        createMockDbPage({
          id: "2",
          slug: "/user2-page",
          status: "ACTIVE",
          deletedAt: null,
          isSystemPage: false,
          userUid: 2,
        }),
        createMockDbPage({
          id: "3",
          slug: "/user1-another",
          status: "ACTIVE",
          deletedAt: null,
          isSystemPage: false,
          userUid: 1,
        }),
      ]);
      const result = await getPagesByUser(1);
      expect(Object.keys(result)).toHaveLength(2);
      expect(Object.keys(result)).toContain("/user1-page");
      expect(Object.keys(result)).toContain("/user1-another");
    });

    it("排除系统页面", async () => {
      (mockPrisma.page.findMany as any).mockResolvedValue([
        createMockDbPage({
          id: "1",
          slug: "/user-page",
          status: "ACTIVE",
          deletedAt: null,
          isSystemPage: false,
          userUid: 1,
        }),
        createMockDbPage({
          id: "2",
          slug: "/system-page",
          status: "ACTIVE",
          deletedAt: null,
          isSystemPage: true,
          userUid: 1,
        }),
      ]);
      const result = await getPagesByUser(1);
      expect(Object.keys(result)).toHaveLength(1);
      expect(Object.keys(result)).toContain("/user-page");
    });

    it("排除已删除页面", async () => {
      (mockPrisma.page.findMany as any).mockResolvedValue([
        createMockDbPage({
          id: "1",
          slug: "/active",
          status: "ACTIVE",
          deletedAt: null,
          isSystemPage: false,
          userUid: 1,
        }),
        createMockDbPage({
          id: "2",
          slug: "/deleted",
          status: "ACTIVE",
          deletedAt: new Date(),
          isSystemPage: false,
          userUid: 1,
        }),
      ]);
      const result = await getPagesByUser(1);
      expect(Object.keys(result)).toHaveLength(1);
    });
  });

  describe("getMainRouteStaticParams", () => {
    it("无页面时返回根 slug", async () => {
      (mockPrisma.page.findMany as any).mockResolvedValue([]);
      const result = await getMainRouteStaticParams();
      expect(result).toEqual([{ slug: [] }]);
    });

    it("返回简单页面的静态参数", async () => {
      (mockPrisma.page.findMany as any).mockResolvedValue([
        createMockDbPage({ id: "1", slug: "/about", config: null }),
      ]);
      const result = await getMainRouteStaticParams();
      const slugs = result.map((p) => p.slug.join("/"));
      expect(slugs).toContain("about");
    });

    it("处理根路径", async () => {
      (mockPrisma.page.findMany as any).mockResolvedValue([
        createMockDbPage({ id: "1", slug: "/", config: null }),
      ]);
      const result = await getMainRouteStaticParams();
      expect(result.some((p) => p.slug.length === 0)).toBe(true);
    });
  });

  describe("getMainRouteTopLevelStaticParams", () => {
    it("无页面时返回根 slug", async () => {
      (mockPrisma.page.findMany as any).mockResolvedValue([]);
      const result = await getMainRouteTopLevelStaticParams();
      expect(result).toEqual([{ slug: [] }]);
    });

    it("包含顶级页面路径", async () => {
      (mockPrisma.page.findMany as any).mockResolvedValue([
        createMockDbPage({ id: "1", slug: "/about" }),
        createMockDbPage({ id: "2", slug: "/blog" }),
      ]);
      const result = await getMainRouteTopLevelStaticParams();
      const slugs = result.map((p) => p.slug.join("/"));
      expect(slugs).toContain("about");
      expect(slugs).toContain("blog");
    });

    it("排除深层嵌套路径", async () => {
      (mockPrisma.page.findMany as any).mockResolvedValue([
        createMockDbPage({ id: "1", slug: "/a/b/c" }),
      ]);
      const result = await getMainRouteTopLevelStaticParams();
      const slugs = result.map((p) => p.slug.join("/"));
      expect(slugs).not.toContain("a/b/c");
    });
  });
});
