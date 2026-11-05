import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock 外部依赖
vi.mock("@/lib/server/prisma", () => ({
  default: {
    page: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    category: {
      findMany: vi.fn(),
    },
    tag: {
      findMany: vi.fn(),
    },
    post: {
      findMany: vi.fn(),
      count: vi.fn().mockResolvedValue(40),
    },
  },
}));

vi.mock("next/cache", () => ({
  unstable_cache: vi.fn((fn: (...args: unknown[]) => Promise<unknown>) => fn),
}));

vi.mock("@/lib/server/post-access", () => ({
  LISTABLE_POST_PUBLISHED_WHERE: { status: "PUBLISHED" },
}));

import type { PageItem, SystemPageConfig } from "@/lib/server/page-cache";
import {
  createPageConfigBuilder,
  getBlocksAreas,
  getMatchingPage,
  getPageBlock,
  getPageBlockValue,
  getPageComponent,
  getPageComponentValue,
  getRawPage,
  getRawPageById,
  getSystemPageConfig,
  PageConfigBuilder,
} from "@/lib/server/page-cache";
import prisma from "@/lib/server/prisma";

const mockPrisma = vi.mocked(prisma);

// 辅助函数：创建测试页面数据
function createMockPage(overrides: Partial<PageItem> = {}): PageItem {
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
    ...overrides,
  };
}

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
    author: {
      uid: 1,
      username: "admin",
      nickname: "Admin",
      avatar: null,
    },
    ...overrides,
  };
}

describe("page-cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.page.findUnique).mockReset();
  });

  // =========================================================================
  // getBlocksAreas (纯函数)
  // =========================================================================
  describe("getBlocksAreas", () => {
    it("returns areas 1-12 when no header and no footer", () => {
      const result = getBlocksAreas(false, false);
      expect(result).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    });

    it("excludes area 1 when has header", () => {
      const result = getBlocksAreas(true, false);
      expect(result).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      expect(result).not.toContain(1);
    });

    it("excludes area 12 when has footer", () => {
      const result = getBlocksAreas(false, true);
      expect(result).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
      expect(result).not.toContain(12);
    });

    it("excludes both area 1 and area 12 when has header and footer", () => {
      const result = getBlocksAreas(true, true);
      expect(result).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
      expect(result).not.toContain(1);
      expect(result).not.toContain(12);
    });

    it("always returns exactly 12 areas with no header/footer", () => {
      expect(getBlocksAreas(false, false)).toHaveLength(12);
    });

    it("returns 11 areas with header only", () => {
      expect(getBlocksAreas(true, false)).toHaveLength(11);
    });

    it("returns 11 areas with footer only", () => {
      expect(getBlocksAreas(false, true)).toHaveLength(11);
    });

    it("returns 10 areas with both header and footer", () => {
      expect(getBlocksAreas(true, true)).toHaveLength(10);
    });
  });

  // =========================================================================
  // getSystemPageConfig (纯函数)
  // =========================================================================
  describe("getSystemPageConfig", () => {
    it("returns null for null page", () => {
      expect(getSystemPageConfig(null)).toBeNull();
    });

    it("returns null for page without config", () => {
      const page = createMockPage({ config: null });
      expect(getSystemPageConfig(page)).toBeNull();
    });

    it("returns null for page with non-object config", () => {
      const page = createMockPage({
        config: "string-config" as unknown as SystemPageConfig,
      });
      expect(getSystemPageConfig(page)).toBeNull();
    });

    it("returns config with blocks", () => {
      const blocks = [
        { id: 1, type: "hero", content: { title: "Hello" } },
        { id: 2, type: "text", content: { body: "World" } },
      ] as unknown as SystemPageConfig["blocks"];
      const page = createMockPage({ config: { blocks } });

      const result = getSystemPageConfig(page);

      expect(result).not.toBeNull();
      expect(result?.blocks).toEqual(blocks);
    });

    it("returns config with components", () => {
      const components = [
        {
          id: "comp-1",
          value: { header: "Title", content: "Body" },
          description: "A component",
        },
      ];
      const page = createMockPage({
        config: { components } as unknown as SystemPageConfig,
      });

      const result = getSystemPageConfig(page);

      expect(result).not.toBeNull();
      expect(result?.components).toEqual(components);
    });

    it("returns config with both blocks and components", () => {
      const blocks = [
        { id: 1, type: "hero", content: {} },
      ] as unknown as SystemPageConfig["blocks"];
      const components = [
        {
          id: "comp-1",
          value: { header: "H" },
          description: "desc",
        },
      ];
      const page = createMockPage({
        config: { blocks, components } as unknown as SystemPageConfig,
      });

      const result = getSystemPageConfig(page);

      expect(result?.blocks).toEqual(blocks);
      expect(result?.components).toEqual(components);
    });

    it("returns null for config object without blocks or components", () => {
      const page = createMockPage({
        config: { someOtherField: "value" } as unknown as SystemPageConfig,
      });

      const result = getSystemPageConfig(page);

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // getPageBlock (纯函数)
  // =========================================================================
  describe("getPageBlock", () => {
    const blocks = [
      { id: 1, type: "hero", content: { title: "Hero" } },
      { id: 2, type: "text", content: { body: "Text" } },
      { id: "abc", type: "custom", content: { data: "custom" } },
    ] as unknown as NonNullable<SystemPageConfig["blocks"]>;

    it("finds block by numeric id", () => {
      const config: SystemPageConfig = { blocks };
      const result = getPageBlock(config, 1);
      expect(result).toBeDefined();
      expect(result?.id).toBe(1);
    });

    it("finds block by string id", () => {
      const config: SystemPageConfig = { blocks };
      const result = getPageBlock(config, "abc");
      expect(result).toBeDefined();
      expect(result?.id).toBe("abc");
    });

    it("finds block by numeric id passed as string", () => {
      const config: SystemPageConfig = { blocks };
      const result = getPageBlock(config, "2");
      expect(result).toBeDefined();
      expect(result?.id).toBe(2);
    });

    it("returns null when block not found", () => {
      const config: SystemPageConfig = { blocks };
      const result = getPageBlock(config, 999);
      expect(result).toBeNull();
    });

    it("returns null for null config", () => {
      expect(getPageBlock(null, 1)).toBeNull();
    });

    it("returns null for config without blocks", () => {
      expect(getPageBlock({ components: [] }, 1)).toBeNull();
    });
  });

  // =========================================================================
  // getPageComponent (纯函数)
  // =========================================================================
  describe("getPageComponent", () => {
    const components = [
      {
        id: "header",
        value: { header: "Title", content: "Content" },
        description: "Header component",
      },
      {
        id: "footer",
        value: {
          content: ["link1", "link2"],
          footer: { link: "/links", description: "Footer" },
        },
        description: "Footer component",
      },
    ] as unknown as NonNullable<SystemPageConfig["components"]>;

    it("finds component by id", () => {
      const config: SystemPageConfig = { components };
      const result = getPageComponent(config, "header");
      expect(result).toBeDefined();
      expect(result?.id).toBe("header");
    });

    it("returns null when component not found", () => {
      const config: SystemPageConfig = { components };
      const result = getPageComponent(config, "nonexistent");
      expect(result).toBeNull();
    });

    it("returns null for null config", () => {
      expect(getPageComponent(null, "header")).toBeNull();
    });

    it("returns null for config without components", () => {
      expect(getPageComponent({ blocks: [] }, "header")).toBeNull();
    });
  });

  // =========================================================================
  // getPageBlockValue (纯函数)
  // =========================================================================
  describe("getPageBlockValue", () => {
    const config: SystemPageConfig = {
      blocks: [
        {
          id: 1,
          type: "hero",
          content: {
            title: { value: "Welcome" },
            header: { value: "Main Header" },
            content: {
              top: { value: ["item1", "item2"] },
              bottom: { value: ["item3"] },
            },
            footer: { link: "/more", text: "Read More" },
          },
        },
      ] as unknown as NonNullable<SystemPageConfig["blocks"]>,
    };

    it("retrieves nested value by dot path", () => {
      const result = getPageBlockValue(config, 1, "title.value");
      expect(result).toBe("Welcome");
    });

    it("retrieves deeply nested value", () => {
      const result = getPageBlockValue(config, 1, "content.top.value");
      expect(result).toEqual(["item1", "item2"]);
    });

    it("retrieves footer link", () => {
      const result = getPageBlockValue(config, 1, "footer.link");
      expect(result).toBe("/more");
    });

    it("returns default value when path not found", () => {
      const result = getPageBlockValue(
        config,
        1,
        "nonexistent.path",
        "default",
      );
      expect(result).toBe("default");
    });

    it("returns null when path not found and no default", () => {
      const result = getPageBlockValue(config, 1, "nonexistent.path");
      expect(result).toBeNull();
    });

    it("returns default when block not found", () => {
      const result = getPageBlockValue(config, 999, "title", "fallback");
      expect(result).toBe("fallback");
    });

    it("returns null for null config", () => {
      expect(getPageBlockValue(null, 1, "title")).toBeNull();
    });

    it("returns typed default value", () => {
      const result = getPageBlockValue<number>(config, 1, "missing", 42);
      expect(result).toBe(42);
    });
  });

  // =========================================================================
  // getPageComponentValue (纯函数)
  // =========================================================================
  describe("getPageComponentValue", () => {
    const config: SystemPageConfig = {
      components: [
        {
          id: "hero",
          value: { header: "Hero Title", content: "Hero Body" },
          description: "Hero section",
        },
        {
          id: "nav",
          value: {
            content: ["Home", "About", "Contact"],
            footer: { link: "/sitemap", description: "Sitemap" },
          },
          description: "Navigation",
        },
      ],
    };

    it("retrieves simple field from component value", () => {
      const result = getPageComponentValue(config, "hero", "header");
      expect(result).toBe("Hero Title");
    });

    it("retrieves nested field from component value", () => {
      const result = getPageComponentValue(config, "nav", "footer.link");
      expect(result).toBe("/sitemap");
    });

    it("returns array value", () => {
      const result = getPageComponentValue(config, "nav", "content");
      expect(result).toEqual(["Home", "About", "Contact"]);
    });

    it("returns default value when field not found", () => {
      const result = getPageComponentValue(
        config,
        "hero",
        "missing",
        "default",
      );
      expect(result).toBe("default");
    });

    it("returns null when component not found", () => {
      const result = getPageComponentValue(config, "nonexistent", "field");
      expect(result).toBeNull();
    });

    it("returns null for null config", () => {
      expect(getPageComponentValue(null, "hero", "header")).toBeNull();
    });

    it("returns default when path does not exist in value", () => {
      const result = getPageComponentValue(
        config,
        "hero",
        "very.deep.nested.path",
        "fallback",
      );
      expect(result).toBe("fallback");
    });
  });

  // =========================================================================
  // PageConfigBuilder (纯函数)
  // =========================================================================
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
              top: { value: ["top-item-1", "top-item-2"] },
              bottom: { value: ["bottom-item-1"] },
            },
            footer: { link: "/footer-link", text: "Footer Text" },
          },
        },
        {
          id: 2,
          type: "text",
          content: {
            title: { value: "Text Block" },
          },
        },
      ] as unknown as NonNullable<SystemPageConfig["blocks"]>,
      components: [
        {
          id: "comp-hero",
          value: { header: "Component Header", content: "Component Body" },
          description: "A hero component",
        },
      ],
    };

    describe("constructor", () => {
      it("accepts null config", () => {
        const builder = new PageConfigBuilder(null);
        expect(builder.isBlockEnabled(1)).toBe(false);
      });

      it("accepts valid config", () => {
        const builder = new PageConfigBuilder(config);
        expect(builder.isBlockEnabled(1)).toBe(true);
      });
    });

    describe("getBlock", () => {
      it("returns block by id", () => {
        const builder = new PageConfigBuilder(config);
        const block = builder.getBlock(1);
        expect(block).toBeDefined();
        expect(block?.id).toBe(1);
      });

      it("returns null for nonexistent block", () => {
        const builder = new PageConfigBuilder(config);
        expect(builder.getBlock(999)).toBeNull();
      });
    });

    describe("getBlockValue", () => {
      it("retrieves nested value", () => {
        const builder = new PageConfigBuilder(config);
        expect(builder.getBlockValue(1, "title.value")).toBe("Page Title");
      });

      it("returns default for missing path", () => {
        const builder = new PageConfigBuilder(config);
        expect(builder.getBlockValue(1, "missing", "def")).toBe("def");
      });
    });

    describe("getComponentValue", () => {
      it("retrieves component field", () => {
        const builder = new PageConfigBuilder(config);
        expect(builder.getComponentValue("comp-hero", "header")).toBe(
          "Component Header",
        );
      });

      it("returns default for missing component", () => {
        const builder = new PageConfigBuilder(config);
        expect(builder.getComponentValue("missing", "field", "default")).toBe(
          "default",
        );
      });
    });

    describe("getBlockTitle", () => {
      it("returns title value", () => {
        const builder = new PageConfigBuilder(config);
        expect(builder.getBlockTitle(1)).toBe("Page Title");
      });

      it("returns default for missing block", () => {
        const builder = new PageConfigBuilder(config);
        expect(builder.getBlockTitle(999, "No Title")).toBe("No Title");
      });

      it("returns empty string as default", () => {
        const builder = new PageConfigBuilder(null);
        expect(builder.getBlockTitle(1)).toBe("");
      });
    });

    describe("getBlockHeader", () => {
      it("returns header value", () => {
        const builder = new PageConfigBuilder(config);
        expect(builder.getBlockHeader(1)).toBe("Page Header");
      });

      it("returns default for nonexistent block", () => {
        const builder = new PageConfigBuilder(config);
        expect(builder.getBlockHeader(999, "Default Header")).toBe(
          "Default Header",
        );
      });
    });

    describe("getBlockContent", () => {
      it("returns top content by default", () => {
        const builder = new PageConfigBuilder(config);
        expect(builder.getBlockContent(1)).toEqual([
          "top-item-1",
          "top-item-2",
        ]);
      });

      it("returns top content explicitly", () => {
        const builder = new PageConfigBuilder(config);
        expect(builder.getBlockContent(1, "top")).toEqual([
          "top-item-1",
          "top-item-2",
        ]);
      });

      it("returns bottom content", () => {
        const builder = new PageConfigBuilder(config);
        expect(builder.getBlockContent(1, "bottom")).toEqual(["bottom-item-1"]);
      });

      it("returns empty array as default for missing block", () => {
        const builder = new PageConfigBuilder(null);
        expect(builder.getBlockContent(1)).toEqual([]);
      });

      it("returns custom default for missing block", () => {
        const builder = new PageConfigBuilder(null);
        expect(builder.getBlockContent(999, "top", ["fallback"])).toEqual([
          "fallback",
        ]);
      });
    });

    describe("getBlockFooterLink", () => {
      it("returns footer link", () => {
        const builder = new PageConfigBuilder(config);
        expect(builder.getBlockFooterLink(1)).toBe("/footer-link");
      });

      it("returns default for missing block", () => {
        const builder = new PageConfigBuilder(null);
        expect(builder.getBlockFooterLink(1)).toBe("");
      });
    });

    describe("getBlockFooterText", () => {
      it("returns footer text", () => {
        const builder = new PageConfigBuilder(config);
        expect(builder.getBlockFooterText(1)).toBe("Footer Text");
      });

      it("returns default for missing block", () => {
        const builder = new PageConfigBuilder(null);
        expect(builder.getBlockFooterText(1, "No Footer")).toBe("No Footer");
      });
    });

    describe("isBlockEnabled", () => {
      it("returns true when block exists", () => {
        const builder = new PageConfigBuilder(config);
        expect(builder.isBlockEnabled(1)).toBe(true);
        expect(builder.isBlockEnabled(2)).toBe(true);
      });

      it("returns false when block does not exist", () => {
        const builder = new PageConfigBuilder(config);
        expect(builder.isBlockEnabled(999)).toBe(false);
      });

      it("returns false for null config", () => {
        const builder = new PageConfigBuilder(null);
        expect(builder.isBlockEnabled(1)).toBe(false);
      });
    });
  });

  // =========================================================================
  // createPageConfigBuilder (工厂函数)
  // =========================================================================
  describe("createPageConfigBuilder", () => {
    it("returns a PageConfigBuilder instance", () => {
      const builder = createPageConfigBuilder(null);
      expect(builder).toBeInstanceOf(PageConfigBuilder);
    });

    it("creates builder that works with config", () => {
      const config: SystemPageConfig = {
        blocks: [
          { id: 1, type: "hero", content: { title: { value: "Test" } } },
        ] as unknown as NonNullable<SystemPageConfig["blocks"]>,
      };
      const builder = createPageConfigBuilder(config);
      expect(builder.isBlockEnabled(1)).toBe(true);
      expect(builder.getBlockTitle(1)).toBe("Test");
    });

    it("creates builder that works with null config", () => {
      const builder = createPageConfigBuilder(null);
      expect(builder.isBlockEnabled(1)).toBe(false);
      expect(builder.getBlockTitle(1, "default")).toBe("default");
    });
  });

  // =========================================================================
  // getRawPage (需要 mock 数据库)
  // =========================================================================
  describe("getRawPage", () => {
    it("returns page from database", async () => {
      const dbPage = createMockDbPage({
        id: "page-1",
        slug: "/test-page",
        title: "Test Page",
      });
      (mockPrisma.page.findUnique as any).mockResolvedValue(dbPage);

      const result = await getRawPage("/test-page");

      expect(result).not.toBeNull();
      expect(result?.id).toBe("page-1");
      expect(result?.slug).toBe("/test-page");
      expect(result?.title).toBe("Test Page");
      expect(result?.createdAt).toBeInstanceOf(Date);
    });

    it("returns null when page not found", async () => {
      (mockPrisma.page.findUnique as any).mockResolvedValue(null);

      const result = await getRawPage("/nonexistent");

      expect(result).toBeNull();
    });

    it("returns null when database query fails", async () => {
      (mockPrisma.page.findUnique as any).mockRejectedValue(
        new Error("DB connection failed"),
      );

      const result = await getRawPage("/error-page");

      expect(result).toBeNull();
    });

    it("maps all page fields correctly", async () => {
      const dbPage = createMockDbPage({
        id: "full-page",
        title: "Full Page",
        slug: "/full",
        content: "Full content",
        contentType: "MDX",
        config: { blocks: [] },
        status: "ACTIVE",
        deletedAt: null,
        isSystemPage: true,
        metaDescription: "A full page",
        metaKeywords: "full,test",
        robotsIndex: true,
        userUid: 42,
      });
      (mockPrisma.page.findUnique as any).mockResolvedValue(dbPage);

      const result = await getRawPage("/full");

      expect(result?.contentType).toBe("MDX");
      expect(result?.isSystemPage).toBe(true);
      expect(result?.metaDescription).toBe("A full page");
      expect(result?.metaKeywords).toBe("full,test");
      expect(result?.robotsIndex).toBe(true);
      expect(result?.userUid).toBe(42);
    });

    it("excludes deleted pages (deletedAt is not null in DB returns null from query)", async () => {
      // 实际上 findUnique 会根据 where 条件过滤，这里模拟 DB 返回 null
      (mockPrisma.page.findUnique as any).mockResolvedValue(null);

      const result = await getRawPage("/deleted-page");

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // getRawPageById
  // =========================================================================
  describe("getRawPageById", () => {
    it("returns page by id from database", async () => {
      const dbPage = createMockDbPage({
        id: "specific-id",
        title: "Found By ID",
      });
      (mockPrisma.page.findUnique as any).mockResolvedValue(dbPage);

      const result = await getRawPageById("specific-id");

      expect(result).not.toBeNull();
      expect(result?.id).toBe("specific-id");
      expect(result?.title).toBe("Found By ID");
    });

    it("returns null when page not found by id", async () => {
      (mockPrisma.page.findUnique as any).mockResolvedValue(null);

      const result = await getRawPageById("nonexistent-id");

      expect(result).toBeNull();
    });

    it("returns null when database query fails", async () => {
      (mockPrisma.page.findUnique as any).mockRejectedValue(
        new Error("DB error"),
      );

      const result = await getRawPageById("error-id");

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // getMatchingPage (路由匹配)
  // =========================================================================
  describe("getMatchingPage", () => {
    it("matches exact path", async () => {
      const dbPage = createMockDbPage({
        id: "exact-page",
        slug: "/about",
        title: "About",
        status: "ACTIVE",
        deletedAt: null,
      });
      (mockPrisma.page.findUnique as any).mockResolvedValue(dbPage);

      const result = await getMatchingPage(["about"]);

      expect(result).not.toBeNull();
      expect(result?.page.slug).toBe("/about");
      expect(result?.params.url).toBe("/about");
    });

    it("returns null when no pages match", async () => {
      (mockPrisma.page.findUnique as any).mockResolvedValue(null);

      const result = await getMatchingPage(["nonexistent"]);

      expect(result).toBeNull();
    });

    it("handles empty slug segments (root path)", async () => {
      const dbPage = createMockDbPage({
        id: "home",
        slug: "/",
        title: "Home",
        status: "ACTIVE",
        deletedAt: null,
      });
      // 会对多个候选路径查询，全部返回 null 除了 "/"
      (mockPrisma.page.findUnique as any).mockResolvedValue(null);
      // 但 "/" 精确匹配时返回页面
      (mockPrisma.page.findUnique as any).mockImplementation(
        async (args: any) => {
          if (args?.where?.slug === "/") {
            return dbPage;
          }
          return null;
        },
      );

      const result = await getMatchingPage([]);

      expect(result).not.toBeNull();
      expect(result?.page.slug).toBe("/");
    });

    it("handles page parameter in URL", async () => {
      // 当 URL 以 /page/N 结尾时，应该解析分页参数
      (mockPrisma.page.findUnique as any).mockResolvedValue(null);

      const result = await getMatchingPage(["unconfigured", "page", "2"]);

      // 没有匹配的页面模板时返回 null
      expect(result).toBeNull();
    });

    it("handles multi-segment paths", async () => {
      (mockPrisma.page.findUnique as any).mockResolvedValue(null);

      const result = await getMatchingPage(["blog", "2024", "my-post"]);

      expect(result).toBeNull();
    });

    it("handles single segment path", async () => {
      const dbPage = createMockDbPage({
        id: "single-page",
        slug: "/about",
        title: "About",
        status: "ACTIVE",
        deletedAt: null,
      });
      (mockPrisma.page.findUnique as any).mockImplementation(
        async (args: any) => {
          if (args?.where?.slug === "/about") {
            return dbPage;
          }
          return null;
        },
      );

      const result = await getMatchingPage(["about"]);

      expect(result).not.toBeNull();
      expect(result?.page.slug).toBe("/about");
    });
  });

  // =========================================================================
  // getAllActivePages
  // =========================================================================
  describe("getAllActivePages", () => {
    it("returns active pages from database", async () => {
      (mockPrisma.page.findMany as any).mockResolvedValue([
        createMockDbPage({
          id: "page-1",
          slug: "/active",
          title: "Active Page",
          status: "ACTIVE",
          deletedAt: null,
        }),
        createMockDbPage({
          id: "page-2",
          slug: "/suspended",
          title: "Suspended Page",
          status: "SUSPENDED",
          deletedAt: null,
        }),
      ]);

      const { getAllActivePages } = await import("@/lib/server/page-cache");
      const result = await getAllActivePages();

      expect(Object.keys(result)).toContain("/active");
      expect(Object.keys(result)).not.toContain("/suspended");
    });

    it("excludes deleted pages", async () => {
      (mockPrisma.page.findMany as any).mockResolvedValue([
        createMockDbPage({
          id: "page-1",
          slug: "/active",
          title: "Active",
          status: "ACTIVE",
          deletedAt: null,
        }),
        createMockDbPage({
          id: "page-2",
          slug: "/deleted",
          title: "Deleted",
          status: "ACTIVE",
          deletedAt: new Date(),
        }),
      ]);

      const { getAllActivePages } = await import("@/lib/server/page-cache");
      const result = await getAllActivePages();

      expect(Object.keys(result)).toContain("/active");
      expect(Object.keys(result)).not.toContain("/deleted");
    });

    it("returns empty object when database fails", async () => {
      (mockPrisma.page.findMany as any).mockRejectedValue(
        new Error("DB error"),
      );

      const { getAllActivePages } = await import("@/lib/server/page-cache");
      const result = await getAllActivePages();

      expect(result).toEqual({});
    });
  });

  // =========================================================================
  // getPagesByStatus
  // =========================================================================
  describe("getPagesByStatus", () => {
    it("returns only ACTIVE pages", async () => {
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

      const { getPagesByStatus } = await import("@/lib/server/page-cache");
      const result = await getPagesByStatus("ACTIVE");

      expect(Object.keys(result)).toHaveLength(2);
      expect(Object.keys(result)).toContain("/a");
      expect(Object.keys(result)).toContain("/c");
    });

    it("returns only SUSPENDED pages", async () => {
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
      ]);

      const { getPagesByStatus } = await import("@/lib/server/page-cache");
      const result = await getPagesByStatus("SUSPENDED");

      expect(Object.keys(result)).toHaveLength(1);
      expect(Object.keys(result)).toContain("/b");
    });

    it("excludes deleted pages", async () => {
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

      const { getPagesByStatus } = await import("@/lib/server/page-cache");
      const result = await getPagesByStatus("ACTIVE");

      expect(Object.keys(result)).toHaveLength(1);
      expect(Object.keys(result)).toContain("/a");
    });
  });

  // =========================================================================
  // getSystemPages
  // =========================================================================
  describe("getSystemPages", () => {
    it("returns only system pages", async () => {
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

      const { getSystemPages } = await import("@/lib/server/page-cache");
      const result = await getSystemPages();

      expect(Object.keys(result)).toHaveLength(1);
      expect(Object.keys(result)).toContain("/sys");
    });

    it("excludes suspended system pages", async () => {
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

      const { getSystemPages } = await import("@/lib/server/page-cache");
      const result = await getSystemPages();

      expect(Object.keys(result)).toHaveLength(1);
      expect(Object.keys(result)).toContain("/sys-active");
    });
  });

  // =========================================================================
  // getPagesByUser
  // =========================================================================
  describe("getPagesByUser", () => {
    it("returns pages for specific user", async () => {
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

      const { getPagesByUser } = await import("@/lib/server/page-cache");
      const result = await getPagesByUser(1);

      expect(Object.keys(result)).toHaveLength(2);
      expect(Object.keys(result)).toContain("/user1-page");
      expect(Object.keys(result)).toContain("/user1-another");
    });

    it("excludes system pages", async () => {
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

      const { getPagesByUser } = await import("@/lib/server/page-cache");
      const result = await getPagesByUser(1);

      expect(Object.keys(result)).toHaveLength(1);
      expect(Object.keys(result)).toContain("/user-page");
    });

    it("excludes deleted pages", async () => {
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

      const { getPagesByUser } = await import("@/lib/server/page-cache");
      const result = await getPagesByUser(1);

      expect(Object.keys(result)).toHaveLength(1);
      expect(Object.keys(result)).toContain("/active");
    });

    it("returns empty object when user has no pages", async () => {
      (mockPrisma.page.findMany as any).mockResolvedValue([
        createMockDbPage({
          id: "1",
          slug: "/other",
          status: "ACTIVE",
          deletedAt: null,
          isSystemPage: false,
          userUid: 999,
        }),
      ]);

      const { getPagesByUser } = await import("@/lib/server/page-cache");
      const result = await getPagesByUser(1);

      expect(Object.keys(result)).toHaveLength(0);
    });
  });

  // =========================================================================
  // getMainRouteStaticParams
  // =========================================================================
  describe("getMainRouteStaticParams", () => {
    it("returns root slug when no pages exist", async () => {
      (mockPrisma.page.findMany as any).mockResolvedValue([]);

      const { getMainRouteStaticParams } = await import(
        "@/lib/server/page-cache"
      );
      const result = await getMainRouteStaticParams();

      expect(result).toEqual([{ slug: [] }]);
    });

    it("returns static params for simple pages", async () => {
      (mockPrisma.page.findMany as any).mockResolvedValue([
        createMockDbPage({ id: "1", slug: "/about", config: null }),
      ]);

      const { getMainRouteStaticParams } = await import(
        "@/lib/server/page-cache"
      );
      const result = await getMainRouteStaticParams();

      const slugs = result.map((p) => p.slug.join("/"));
      expect(slugs).toContain("about");
    });

    it("handles empty slug (root page)", async () => {
      (mockPrisma.page.findMany as any).mockResolvedValue([
        createMockDbPage({ id: "1", slug: "/", config: null }),
      ]);

      const { getMainRouteStaticParams } = await import(
        "@/lib/server/page-cache"
      );
      const result = await getMainRouteStaticParams();

      expect(result.some((p) => p.slug.length === 0)).toBe(true);
    });
  });

  // =========================================================================
  // getMainRouteTopLevelStaticParams
  // =========================================================================
  describe("getMainRouteTopLevelStaticParams", () => {
    it("returns root slug when no pages exist", async () => {
      (mockPrisma.page.findMany as any).mockResolvedValue([]);

      const { getMainRouteTopLevelStaticParams } = await import(
        "@/lib/server/page-cache"
      );
      const result = await getMainRouteTopLevelStaticParams();

      expect(result).toEqual([{ slug: [] }]);
    });

    it("includes top-level page paths", async () => {
      (mockPrisma.page.findMany as any).mockResolvedValue([
        createMockDbPage({ id: "1", slug: "/about" }),
        createMockDbPage({ id: "2", slug: "/blog" }),
      ]);

      const { getMainRouteTopLevelStaticParams } = await import(
        "@/lib/server/page-cache"
      );
      const result = await getMainRouteTopLevelStaticParams();

      const slugs = result.map((p) => p.slug.join("/"));
      expect(slugs).toContain("about");
      expect(slugs).toContain("blog");
    });

    it("excludes deep nested paths", async () => {
      (mockPrisma.page.findMany as any).mockResolvedValue([
        createMockDbPage({ id: "1", slug: "/a/b/c" }),
      ]);

      const { getMainRouteTopLevelStaticParams } = await import(
        "@/lib/server/page-cache"
      );
      const result = await getMainRouteTopLevelStaticParams();

      const slugs = result.map((p) => p.slug.join("/"));
      expect(slugs).not.toContain("a/b/c");
    });

    it("includes paged template base paths", async () => {
      (mockPrisma.page.findMany as any).mockResolvedValue([
        createMockDbPage({ id: "1", slug: "/posts/page/:page" }),
      ]);

      const { getMainRouteTopLevelStaticParams } = await import(
        "@/lib/server/page-cache"
      );
      const result = await getMainRouteTopLevelStaticParams();

      const slugs = result.map((p) => p.slug.join("/"));
      expect(slugs).toContain("posts");
    });
  });
});
