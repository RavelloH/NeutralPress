import { beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================================
// Mocks
// ============================================================================

const {
  mockLimitControl,
  mockAuthVerify,
  mockValidateData,
  mockUpdateTag,
  mockHeaders,
  mockPrismaPageFindMany,
  mockPrismaPageFindFirst,
  mockPrismaPageFindUnique,
  mockPrismaPageCreate,
  mockPrismaPageUpdate,
  mockPrismaPageUpdateMany,
  mockPrismaPageCount,
} = vi.hoisted(() => ({
  mockLimitControl: vi.fn(),
  mockAuthVerify: vi.fn(),
  mockValidateData: vi.fn(),
  mockUpdateTag: vi.fn(),
  mockHeaders: vi.fn(),
  mockPrismaPageFindMany: vi.fn(),
  mockPrismaPageFindFirst: vi.fn(),
  mockPrismaPageFindUnique: vi.fn(),
  mockPrismaPageCreate: vi.fn(),
  mockPrismaPageUpdate: vi.fn(),
  mockPrismaPageUpdateMany: vi.fn(),
  mockPrismaPageCount: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  default: {
    page: {
      findMany: mockPrismaPageFindMany,
      findFirst: mockPrismaPageFindFirst,
      findUnique: mockPrismaPageFindUnique,
      create: mockPrismaPageCreate,
      update: mockPrismaPageUpdate,
      updateMany: mockPrismaPageUpdateMany,
      count: mockPrismaPageCount,
    },
  },
}));
vi.mock("@/lib/server/auth-verify", () => ({ authVerify: mockAuthVerify }));
vi.mock("@/lib/server/rate-limit", () => ({ default: mockLimitControl }));
vi.mock("@/lib/server/validator", () => ({ validateData: mockValidateData }));
vi.mock("next/headers", () => ({ headers: mockHeaders }));
vi.mock("next/cache", () => ({ updateTag: mockUpdateTag }));
vi.mock("@/lib/server/isr-invalidation", () => ({
  expireCacheTag: mockUpdateTag,
}));
vi.mock("next/server", () => ({
  NextResponse: { json: vi.fn() },
  after: vi.fn((fn: () => Promise<void>) => fn()),
}));
vi.mock("@/lib/server/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("@/lib/server/block-normalize", () => ({
  normalizeBlockIds: vi.fn((c) => c),
}));
vi.mock("@/lib/server/page-image-tracking", () => ({
  updatePageMediaReferences: vi.fn(),
}));

// ============================================================================
// Imports
// ============================================================================

import {
  createPage,
  deletePages,
  getPageDetail,
  getPagesList,
  updatePage,
  updatePages,
} from "@/actions/page";

// ============================================================================
// Helpers
// ============================================================================

const ADMIN_USER = { uid: 1, username: "admin", role: "ADMIN" as const };

const PAGE_RECORD = {
  id: "page-1",
  title: "About",
  slug: "/about",
  content: "Hello World",
  contentType: "MARKDOWN",
  status: "ACTIVE",
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-02"),
  metaDescription: "About page",
  metaKeywords: "about",
  robotsIndex: true,
  isSystemPage: false,
  config: null,
  author: { uid: 1, username: "admin", nickname: "Admin" },
};

function mockAuthSuccess() {
  mockAuthVerify.mockResolvedValue(ADMIN_USER);
}
function mockAuthFailure() {
  mockAuthVerify.mockResolvedValue(null);
}
function mockRateLimitAllowed() {
  mockLimitControl.mockResolvedValue(true);
}
function mockValidationSuccess() {
  mockValidateData.mockReturnValue(null);
}

// ============================================================================
// Tests
// ============================================================================

describe("page actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRateLimitAllowed();
    mockValidationSuccess();
    mockHeaders.mockResolvedValue(new Headers());
  });

  describe("getPagesList", () => {
    it("成功返回页面列表", async () => {
      mockAuthSuccess();
      mockPrismaPageFindMany.mockResolvedValue([PAGE_RECORD]);
      mockPrismaPageCount.mockResolvedValue(1);
      const result = await getPagesList(
        {
          access_token: "token",
          page: 1,
          pageSize: 10,
          sortBy: "id",
          sortOrder: "desc",
        },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data![0]!.slug).toBe("/about");
    });

    it("非 ADMIN 用户无法访问", async () => {
      mockAuthFailure();
      const result = await getPagesList(
        {
          access_token: "token",
          page: 1,
          pageSize: 10,
          sortBy: "id",
          sortOrder: "desc",
        },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("速率限制时返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await getPagesList(
        {
          access_token: "token",
          page: 1,
          pageSize: 10,
          sortBy: "id",
          sortOrder: "desc",
        },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("getPageDetail", () => {
    it("成功返回页面详情", async () => {
      mockAuthSuccess();
      mockPrismaPageFindFirst.mockResolvedValue(PAGE_RECORD);
      const result = await getPageDetail(
        { access_token: "token", slug: "/about" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
      expect(result.data!.title).toBe("About");
    });

    it("页面不存在时返回 404", async () => {
      mockAuthSuccess();
      mockPrismaPageFindFirst.mockResolvedValue(null);
      const result = await getPageDetail(
        { access_token: "token", slug: "/nonexistent" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("createPage", () => {
    it("成功创建页面", async () => {
      mockAuthSuccess();
      mockPrismaPageFindFirst.mockResolvedValue(null);
      mockPrismaPageCreate.mockResolvedValue({
        ...PAGE_RECORD,
        id: "new-page",
      });
      const result = await createPage(
        {
          access_token: "token",
          title: "New Page",
          slug: "/new-page",
          content: "Content",
          contentType: "MARKDOWN",
          status: "ACTIVE",
          robotsIndex: true,
          isSystemPage: false,
        },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
      expect(result.data!.id).toBe("new-page");
    });

    it("slug 已存在时返回冲突", async () => {
      mockAuthSuccess();
      mockPrismaPageFindFirst.mockResolvedValue(PAGE_RECORD);
      const result = await createPage(
        {
          access_token: "token",
          title: "Duplicate",
          slug: "/about",
          content: "",
          contentType: "MARKDOWN",
          status: "ACTIVE",
          robotsIndex: true,
          isSystemPage: false,
        },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("updatePage", () => {
    it("成功更新页面", async () => {
      mockAuthSuccess();
      mockPrismaPageFindFirst.mockResolvedValue(PAGE_RECORD);
      mockPrismaPageUpdate.mockResolvedValue({
        ...PAGE_RECORD,
        title: "Updated About",
      });
      const result = await updatePage(
        { access_token: "token", slug: "/about", title: "Updated About" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
    });

    it("页面不存在时返回 404", async () => {
      mockAuthSuccess();
      mockPrismaPageFindFirst.mockResolvedValue(null);
      const result = await updatePage(
        { access_token: "token", slug: "/nonexistent", title: "New" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("修改 slug 时检查新 slug 唯一性", async () => {
      mockAuthSuccess();
      mockPrismaPageFindFirst
        .mockResolvedValueOnce(PAGE_RECORD)
        .mockResolvedValueOnce(null);
      mockPrismaPageUpdate.mockResolvedValue({
        ...PAGE_RECORD,
        slug: "/new-about",
      });
      const result = await updatePage(
        { access_token: "token", slug: "/about", newSlug: "/new-about" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
    });

    it("新 slug 已存在时返回冲突", async () => {
      mockAuthSuccess();
      mockPrismaPageFindFirst
        .mockResolvedValueOnce(PAGE_RECORD)
        .mockResolvedValueOnce({ ...PAGE_RECORD, id: "other" });
      const result = await updatePage(
        { access_token: "token", slug: "/about", newSlug: "/existing" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("系统页面不允许修改 isSystemPage 字段", async () => {
      mockAuthSuccess();
      mockPrismaPageFindFirst.mockResolvedValue({
        ...PAGE_RECORD,
        isSystemPage: true,
      });
      mockPrismaPageUpdate.mockResolvedValue({
        ...PAGE_RECORD,
        isSystemPage: true,
      });
      const result = await updatePage(
        { access_token: "token", slug: "/about" } as any,
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
    });
  });

  describe("updatePages", () => {
    it("成功批量更新页面", async () => {
      mockAuthSuccess();
      mockPrismaPageFindMany.mockResolvedValue([]);
      mockPrismaPageUpdateMany.mockResolvedValue({ count: 2 });
      const result = await updatePages(
        {
          access_token: "token",
          ids: ["page-1", "page-2"],
          status: "SUSPENDED",
        },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
      expect(result.data!.updated).toBe(2);
    });

    it("全部是系统页面时返回错误", async () => {
      mockAuthSuccess();
      mockPrismaPageFindMany.mockResolvedValue([
        { id: "page-1" },
        { id: "page-2" },
      ]);
      const result = await updatePages(
        {
          access_token: "token",
          ids: ["page-1", "page-2"],
          status: "SUSPENDED",
        },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("deletePages", () => {
    it("成功删除页面（软删除）", async () => {
      mockAuthSuccess();
      mockPrismaPageFindMany.mockResolvedValue([]);
      mockPrismaPageUpdateMany.mockResolvedValue({ count: 2 });
      const result = await deletePages(
        { access_token: "token", ids: ["page-1", "page-2"] },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
      expect(result.data!.deleted).toBe(2);
    });

    it("禁止删除系统页面", async () => {
      mockAuthSuccess();
      mockPrismaPageFindMany.mockResolvedValue([
        { id: "page-1", title: "Home" },
      ]);
      const result = await deletePages(
        { access_token: "token", ids: ["page-1"] },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  // ==================== 补充分支覆盖测试 ====================

  describe("getPagesList 补充测试", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await getPagesList(
        {
          access_token: "token",
          page: 1,
          pageSize: 10,
          sortBy: "id",
          sortOrder: "desc",
        },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("getPageDetail 补充测试", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await getPageDetail(
        { access_token: "token", slug: "/page-1" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("非管理员应返回未授权", async () => {
      mockAuthFailure();
      const result = await getPageDetail(
        { access_token: "token", slug: "/page-1" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("createPage 补充测试", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await createPage(
        {
          access_token: "token",
          title: "New Page",
          slug: "new",
          contentType: "MARKDOWN",
          status: "ACTIVE",
          robotsIndex: true,
          isSystemPage: false,
        },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("非管理员应返回未授权", async () => {
      mockAuthFailure();
      const result = await createPage(
        {
          access_token: "token",
          title: "New Page",
          slug: "new",
          contentType: "MARKDOWN",
          status: "ACTIVE",
          robotsIndex: true,
          isSystemPage: false,
        },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("updatePage 补充测试", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await updatePage(
        { access_token: "token", slug: "/page-1", title: "Updated" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("非管理员应返回未授权", async () => {
      mockAuthFailure();
      const result = await updatePage(
        { access_token: "token", slug: "/page-1", title: "Updated" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("updatePages 补充测试", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await updatePages(
        { access_token: "token", ids: ["page-1"], status: "SUSPENDED" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("非管理员应返回未授权", async () => {
      mockAuthFailure();
      const result = await updatePages(
        { access_token: "token", ids: ["page-1"], status: "SUSPENDED" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("deletePages 补充测试", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await deletePages(
        { access_token: "token", ids: ["page-1"] },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("非管理员应返回未授权", async () => {
      mockAuthFailure();
      const result = await deletePages(
        { access_token: "token", ids: ["page-1"] },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  // ===== 分支覆盖补充测试 =====

  describe("getPagesList 分支", () => {
    it("带 search 过滤", async () => {
      mockAuthSuccess();
      mockPrismaPageFindMany.mockResolvedValue([]);
      mockPrismaPageCount.mockResolvedValue(0);
      const result = await getPagesList(
        {
          access_token: "token",
          search: "test",
          page: 1,
          pageSize: 10,
          sortBy: "id",
          sortOrder: "desc",
        },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
    });

    it("数据库错误时返回失败", async () => {
      mockAuthSuccess();
      mockPrismaPageFindMany.mockRejectedValue(new Error("DB error"));
      const result = await getPagesList(
        {
          access_token: "token",
          page: 1,
          pageSize: 10,
          sortBy: "id",
          sortOrder: "desc",
        },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("createPage 分支", () => {
    it("数据库错误时返回失败", async () => {
      mockAuthSuccess();
      mockPrismaPageFindFirst.mockRejectedValue(new Error("DB error"));
      const result = await createPage(
        {
          access_token: "token",
          title: "New Page",
          slug: "new-page",
          contentType: "MARKDOWN",
          status: "ACTIVE",
          robotsIndex: true,
          isSystemPage: false,
        },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("updatePage 分支", () => {
    it("数据库错误时返回失败", async () => {
      mockAuthSuccess();
      mockPrismaPageFindUnique.mockRejectedValue(new Error("DB error"));
      const result = await updatePage(
        { access_token: "token", slug: "/page-1", title: "Updated" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("updatePages 分支", () => {
    it("数据库错误时返回失败", async () => {
      mockAuthSuccess();
      mockPrismaPageFindMany.mockRejectedValue(new Error("DB error"));
      const result = await updatePages(
        { access_token: "token", ids: ["page-1"], status: "ACTIVE" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("deletePages 分支", () => {
    it("数据库错误时返回失败", async () => {
      mockAuthSuccess();
      mockPrismaPageFindMany.mockRejectedValue(new Error("DB error"));
      const result = await deletePages(
        { access_token: "token", ids: ["page-1"] },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });
});
