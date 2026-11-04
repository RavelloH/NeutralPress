import { beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================================
// Mocks
// ============================================================================

const {
  mockLimitControl,
  mockAuthVerify,
  mockValidateData,
  mockHeaders,
  mockLogAuditEvent,
  mockPrismaCategoryFindMany,
  mockPrismaCategoryFindFirst,
  mockPrismaCategoryFindUnique,
  mockPrismaCategoryCreate,
  mockPrismaCategoryUpdate,
  mockPrismaCategoryDeleteMany,
  mockPrismaPostFindMany,
  mockPrismaPostCount,
  mockPrismaMediaReferenceDeleteMany,
  mockPrismaMediaReferenceCreate,
  mockPrismaTransaction,
  mockBatchGetCategoryPaths,
  mockBuildCategoryTree,
  mockCalculateCategoryDepth,
  mockCheckCategoryUniqueness,
  mockCountAllDescendants,
  mockCountCategoryPosts,
  mockCountDirectChildren,
  mockFindCategoryByPath,
  mockGetAllDescendantIds,
  mockGetCategoryPath,
  mockValidateCategoryMove,
  mockFindMediaIdByUrl,
  mockGetFeaturedImageUrl,
  mockSlugify,
  mockIsValidSlug,
  mockSanitizeUserSlug,
} = vi.hoisted(() => ({
  mockLimitControl: vi.fn(),
  mockAuthVerify: vi.fn(),
  mockValidateData: vi.fn(),
  mockHeaders: vi.fn(),
  mockLogAuditEvent: vi.fn(),
  mockPrismaCategoryFindMany: vi.fn(),
  mockPrismaCategoryFindFirst: vi.fn(),
  mockPrismaCategoryFindUnique: vi.fn(),
  mockPrismaCategoryCreate: vi.fn(),
  mockPrismaCategoryUpdate: vi.fn(),
  mockPrismaCategoryDeleteMany: vi.fn(),
  mockPrismaPostFindMany: vi.fn(),
  mockPrismaPostCount: vi.fn(),
  mockPrismaMediaReferenceDeleteMany: vi.fn(),
  mockPrismaMediaReferenceCreate: vi.fn(),
  mockPrismaTransaction: vi.fn(),
  mockBatchGetCategoryPaths: vi.fn(),
  mockBuildCategoryTree: vi.fn(),
  mockCalculateCategoryDepth: vi.fn(),
  mockCheckCategoryUniqueness: vi.fn(),
  mockCountAllDescendants: vi.fn(),
  mockCountCategoryPosts: vi.fn(),
  mockCountDirectChildren: vi.fn(),
  mockFindCategoryByPath: vi.fn(),
  mockGetAllDescendantIds: vi.fn(),
  mockGetCategoryPath: vi.fn(),
  mockValidateCategoryMove: vi.fn(),
  mockFindMediaIdByUrl: vi.fn(),
  mockGetFeaturedImageUrl: vi.fn(),
  mockSlugify: vi.fn(),
  mockIsValidSlug: vi.fn(),
  mockSanitizeUserSlug: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  default: {
    category: {
      findMany: mockPrismaCategoryFindMany,
      findFirst: mockPrismaCategoryFindFirst,
      findUnique: mockPrismaCategoryFindUnique,
      create: mockPrismaCategoryCreate,
      update: mockPrismaCategoryUpdate,
      deleteMany: mockPrismaCategoryDeleteMany,
    },
    post: {
      findMany: mockPrismaPostFindMany,
      count: mockPrismaPostCount,
    },
    mediaReference: {
      deleteMany: mockPrismaMediaReferenceDeleteMany,
      create: mockPrismaMediaReferenceCreate,
    },
    $transaction: mockPrismaTransaction,
  },
}));
vi.mock("@/lib/server/auth-verify", () => ({ authVerify: mockAuthVerify }));
vi.mock("@/lib/server/rate-limit", () => ({ default: mockLimitControl }));
vi.mock("@/lib/server/validator", () => ({ validateData: mockValidateData }));
vi.mock("@/lib/server/audit", () => ({ logAuditEvent: mockLogAuditEvent }));
vi.mock("@/lib/server/category-utils", () => ({
  batchGetCategoryPaths: mockBatchGetCategoryPaths,
  buildCategoryTree: mockBuildCategoryTree,
  calculateCategoryDepth: mockCalculateCategoryDepth,
  checkCategoryUniqueness: mockCheckCategoryUniqueness,
  countAllDescendants: mockCountAllDescendants,
  countCategoryPosts: mockCountCategoryPosts,
  countDirectChildren: mockCountDirectChildren,
  findCategoryByPath: mockFindCategoryByPath,
  getAllDescendantIds: mockGetAllDescendantIds,
  getCategoryPath: mockGetCategoryPath,
  validateCategoryMove: mockValidateCategoryMove,
}));
vi.mock("@/lib/server/media-reference", () => ({
  findMediaIdByUrl: mockFindMediaIdByUrl,
  getFeaturedImageUrl: mockGetFeaturedImageUrl,
}));
vi.mock("@/lib/server/slugify", () => ({
  isValidSlug: mockIsValidSlug,
  sanitizeUserSlug: mockSanitizeUserSlug,
  slugify: mockSlugify,
}));
vi.mock("next/cache", () => ({ updateTag: vi.fn() }));
vi.mock("@/lib/server/isr-invalidation", () => ({ expireCacheTag: vi.fn() }));
vi.mock("next/headers", () => ({ headers: mockHeaders }));
vi.mock("next/server", () => ({
  NextResponse: { json: vi.fn() },
  after: vi.fn((fn: () => Promise<void>) => fn()),
}));

// ============================================================================
// Imports
// ============================================================================

import {
  createCategory,
  deleteCategories,
  getCategoriesDistribution,
  getCategoriesList,
  getCategoriesTree,
  getCategoryDetail,
  moveCategories,
  searchCategories,
  updateCategory,
} from "@/actions/category";

// ============================================================================
// Helpers
// ============================================================================

const ADMIN_USER = { uid: 1, username: "admin", role: "ADMIN" as const };

const CATEGORY_RECORD = {
  id: 1,
  slug: "tech",
  name: "技术",
  description: "技术相关文章",
  parentId: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  parent: null,
  posts: [{ id: 1 }],
  children: [],
  mediaRefs: [],
  path: "1",
  depth: 0,
  fullSlug: "tech",
};

function mockAuthSuccess(user = ADMIN_USER) {
  mockAuthVerify.mockResolvedValue(user);
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

describe("category actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRateLimitAllowed();
    mockValidationSuccess();
    mockHeaders.mockResolvedValue(new Headers());
    mockSlugify.mockResolvedValue("tech");
    mockIsValidSlug.mockReturnValue(true);
    mockSanitizeUserSlug.mockImplementation((s: string) => s);
    mockGetFeaturedImageUrl.mockReturnValue(null);
    mockBatchGetCategoryPaths.mockResolvedValue(new Map());
  });

  describe("getCategoriesList", () => {
    it("成功获取分类列表", async () => {
      mockAuthSuccess(ADMIN_USER);
      mockPrismaCategoryFindMany.mockResolvedValue([CATEGORY_RECORD]);
      const result = await getCategoriesList(
        {
          access_token: "token",
          page: 1,
          pageSize: 25,
          sortBy: "totalPostCount",
          sortOrder: "desc",
        },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
    });

    it("未认证时返回未授权", async () => {
      mockAuthFailure();
      const result = await getCategoriesList(
        {
          access_token: "token",
          page: 1,
          pageSize: 25,
          sortBy: "totalPostCount",
          sortOrder: "desc",
        },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("速率限制时返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await getCategoriesList(
        {
          access_token: "token",
          page: 1,
          pageSize: 25,
          sortBy: "totalPostCount",
          sortOrder: "desc",
        },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("getCategoryDetail", () => {
    it("成功获取分类详情", async () => {
      mockAuthSuccess(ADMIN_USER);
      mockPrismaCategoryFindFirst.mockResolvedValue(CATEGORY_RECORD);
      mockPrismaCategoryFindUnique.mockResolvedValue(CATEGORY_RECORD);
      mockPrismaPostCount.mockResolvedValue(1);
      mockCountCategoryPosts.mockResolvedValue(1);
      mockCountDirectChildren.mockResolvedValue(0);
      mockCountAllDescendants.mockResolvedValue(0);
      mockGetCategoryPath.mockResolvedValue(["技术"]);
      mockCalculateCategoryDepth.mockResolvedValue(0);
      const result = await getCategoryDetail(
        { access_token: "token", slug: "tech" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
    });

    it("分类不存在时返回 404", async () => {
      mockAuthSuccess(ADMIN_USER);
      mockPrismaCategoryFindFirst.mockResolvedValue(null);
      const result = await getCategoryDetail(
        { access_token: "token", slug: "nonexistent" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("createCategory", () => {
    it("成功创建分类", async () => {
      mockAuthSuccess(ADMIN_USER);
      mockCheckCategoryUniqueness.mockResolvedValue({
        slugExists: false,
        nameExists: false,
      });
      mockPrismaCategoryCreate.mockResolvedValue({
        id: 2,
        slug: "new-cat",
        name: "新分类",
        description: null,
        parentId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        mediaRefs: [],
        path: "",
        depth: 0,
        fullSlug: "new-cat",
      });
      mockPrismaCategoryFindUnique.mockResolvedValue({
        id: 2,
        slug: "new-cat",
        path: "2",
        depth: 0,
        fullSlug: "new-cat",
        mediaRefs: [],
      });
      mockPrismaCategoryUpdate.mockResolvedValue({});
      const result = await createCategory(
        {
          access_token: "token",
          name: "新分类",
          slug: "new-cat",
        },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
    });

    it("名称重复时返回错误", async () => {
      mockAuthSuccess(ADMIN_USER);
      mockCheckCategoryUniqueness.mockResolvedValue({
        slugExists: false,
        nameExists: true,
      });
      const result = await createCategory(
        {
          access_token: "token",
          name: "技术",
          slug: "tech",
        },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("updateCategory", () => {
    it("成功更新分类", async () => {
      mockAuthSuccess(ADMIN_USER);
      mockPrismaCategoryFindUnique.mockResolvedValue(CATEGORY_RECORD);
      mockCheckCategoryUniqueness.mockResolvedValue({
        slugExists: false,
        nameExists: false,
      });
      mockPrismaTransaction.mockImplementation(async (fn: any) =>
        fn({
          category: {
            update: vi.fn().mockResolvedValue({
              ...CATEGORY_RECORD,
              name: "更新后的技术",
            }),
            findMany: vi.fn().mockResolvedValue([]),
          },
        }),
      );
      mockPrismaCategoryFindUnique.mockResolvedValue({
        ...CATEGORY_RECORD,
        mediaRefs: [],
      });
      const result = await updateCategory(
        {
          access_token: "token",
          id: 1,
          newName: "更新后的技术",
        },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
    });

    it("分类不存在时返回 404", async () => {
      mockAuthSuccess(ADMIN_USER);
      mockPrismaCategoryFindUnique.mockResolvedValue(null);
      const result = await updateCategory(
        {
          access_token: "token",
          id: 999,
          newName: "更新",
        },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("deleteCategories", () => {
    it("成功删除分类", async () => {
      mockAuthSuccess(ADMIN_USER);
      mockPrismaCategoryFindMany
        .mockResolvedValueOnce([]) // uncategorized check
        .mockResolvedValueOnce([{ fullSlug: "tech" }]); // categories to delete
      mockGetAllDescendantIds.mockResolvedValue([]);
      mockPrismaPostFindMany.mockResolvedValue([]);
      mockPrismaTransaction.mockImplementation(async (fn: any) =>
        fn({
          category: {
            deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
          post: {
            findMany: vi.fn().mockResolvedValue([]),
          },
        }),
      );
      const result = await deleteCategories(
        { access_token: "token", ids: [1] },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
    });

    it("未认证时返回未授权", async () => {
      mockAuthFailure();
      const result = await deleteCategories(
        { access_token: "token", ids: [1] },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("moveCategories", () => {
    it("成功移动分类", async () => {
      mockAuthSuccess(ADMIN_USER);
      mockPrismaCategoryFindMany.mockResolvedValue([]);
      mockPrismaCategoryFindUnique.mockResolvedValue({
        id: 2,
        slug: "target",
        name: "目标",
        path: "2",
        depth: 0,
        fullSlug: "target",
      });
      mockValidateCategoryMove.mockResolvedValue(false);
      mockCheckCategoryUniqueness.mockResolvedValue({
        slugExists: false,
        nameExists: false,
      });
      mockPrismaTransaction.mockImplementation(async (fn: any) =>
        fn({
          category: {
            findMany: vi.fn().mockResolvedValue([
              {
                id: 1,
                slug: "tech",
                name: "技术",
                parentId: null,
                path: "1",
                depth: 0,
                fullSlug: "tech",
              },
            ]),
            update: vi.fn().mockResolvedValue({}),
          },
        }),
      );
      const result = await moveCategories(
        { access_token: "token", ids: [1], targetParentId: 2 },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
    });
  });

  describe("searchCategories", () => {
    it("成功搜索分类", async () => {
      mockAuthSuccess(ADMIN_USER);
      mockPrismaCategoryFindMany.mockResolvedValue([
        {
          id: 1,
          slug: "tech",
          name: "技术",
          parentId: null,
          _count: { posts: 5 },
        },
      ]);
      mockBatchGetCategoryPaths.mockResolvedValue(
        new Map([[1, [{ id: 1, slug: "tech", name: "技术" }]]]),
      );
      const result = await searchCategories(
        { access_token: "token", query: "技术", limit: 10 },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
    });
  });

  describe("getCategoriesDistribution", () => {
    it("成功获取分类分布", async () => {
      mockAuthSuccess(ADMIN_USER);
      mockPrismaCategoryFindMany.mockResolvedValue([
        { id: 1, slug: "tech", name: "技术" },
      ]);
      mockCountCategoryPosts.mockResolvedValue(10);
      const result = await getCategoriesDistribution(
        { access_token: "token", limit: 10 },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
    });
  });

  describe("getCategoriesTree", () => {
    it("成功获取分类树", async () => {
      mockAuthSuccess(ADMIN_USER);
      mockBuildCategoryTree.mockResolvedValue([
        {
          id: 1,
          slug: "tech",
          name: "技术",
          description: null,
          parentId: null,
          postCount: 5,
          createdAt: new Date(),
          updatedAt: new Date(),
          children: [],
        },
      ]);
      const result = await getCategoriesTree(
        { access_token: "token" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
    });
  });

  // ==================== 补充分支覆盖测试 ====================

  describe("createCategory 补充测试", () => {
    it("通过 parentSlug 查找父分类", async () => {
      mockAuthSuccess(ADMIN_USER);
      mockPrismaCategoryFindFirst.mockResolvedValue({ id: 10 });
      mockPrismaCategoryFindUnique.mockResolvedValue({ id: 10 });
      mockCheckCategoryUniqueness.mockResolvedValue({
        slugExists: false,
        nameExists: false,
      });
      mockPrismaCategoryCreate.mockResolvedValue({
        id: 2,
        slug: "sub-cat",
        name: "子分类",
        description: null,
        parentId: 10,
        createdAt: new Date(),
        updatedAt: new Date(),
        mediaRefs: [],
        path: "10/2",
        depth: 1,
        fullSlug: "parent/sub-cat",
      });
      mockPrismaCategoryFindUnique.mockResolvedValue({
        id: 2,
        slug: "sub-cat",
        path: "10/2",
        depth: 1,
        fullSlug: "parent/sub-cat",
        mediaRefs: [],
      });
      mockPrismaCategoryUpdate.mockResolvedValue({});
      const result = await createCategory(
        {
          access_token: "token",
          name: "子分类",
          parentSlug: "parent",
        },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
    });

    it("parentSlug 对应分类不存在时返回失败", async () => {
      mockAuthSuccess(ADMIN_USER);
      mockPrismaCategoryFindFirst.mockResolvedValue(null);
      const result = await createCategory(
        {
          access_token: "token",
          name: "子分类",
          parentSlug: "nonexistent",
        },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("指定 parentId 但父分类不存在时返回失败", async () => {
      mockAuthSuccess(ADMIN_USER);
      mockCheckCategoryUniqueness.mockResolvedValue({
        slugExists: false,
        nameExists: false,
      });
      mockPrismaCategoryFindUnique.mockResolvedValue(null);
      const result = await createCategory(
        {
          access_token: "token",
          name: "子分类",
          slug: "sub-cat",
          parentId: 999,
        },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("未提供 slug 时自动生成", async () => {
      mockAuthSuccess(ADMIN_USER);
      mockSlugify.mockResolvedValue("auto-slug");
      mockCheckCategoryUniqueness.mockResolvedValue({
        slugExists: false,
        nameExists: false,
      });
      mockPrismaCategoryCreate.mockResolvedValue({
        id: 3,
        slug: "auto-slug",
        name: "自动分类",
        description: null,
        parentId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        mediaRefs: [],
        path: "3",
        depth: 0,
        fullSlug: "auto-slug",
      });
      mockPrismaCategoryFindUnique.mockResolvedValue({
        id: 3,
        slug: "auto-slug",
        path: "3",
        depth: 0,
        fullSlug: "auto-slug",
        mediaRefs: [],
      });
      mockPrismaCategoryUpdate.mockResolvedValue({});
      const result = await createCategory(
        {
          access_token: "token",
          name: "自动分类",
        },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
    });

    it("名称重复时返回失败", async () => {
      mockAuthSuccess(ADMIN_USER);
      mockCheckCategoryUniqueness.mockResolvedValue({
        slugExists: false,
        nameExists: true,
      });
      const result = await createCategory(
        {
          access_token: "token",
          name: "重复名称",
          slug: "unique-slug",
        },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("非管理员/编辑应返回未授权", async () => {
      mockAuthFailure();
      const result = await createCategory(
        {
          access_token: "token",
          name: "分类",
          slug: "cat",
        },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("updateCategory 补充测试", () => {
    it("非管理员/编辑应返回未授权", async () => {
      mockAuthFailure();
      const result = await updateCategory(
        { access_token: "token", id: 1, newName: "更新" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await updateCategory(
        { access_token: "token", id: 1, newName: "更新" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("更改 slug 时应验证唯一性", async () => {
      mockAuthSuccess(ADMIN_USER);
      mockPrismaCategoryFindUnique.mockResolvedValue(CATEGORY_RECORD);
      mockCheckCategoryUniqueness.mockResolvedValue({
        slugExists: true,
        nameExists: false,
      });
      const result = await updateCategory(
        {
          access_token: "token",
          id: 1,
          newName: "更新",
          newSlug: "existing-slug",
        },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("deleteCategories 补充测试", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await deleteCategories(
        { access_token: "token", ids: [1] },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("非管理员/编辑应返回未授权", async () => {
      mockAuthFailure();
      const result = await deleteCategories(
        { access_token: "token", ids: [1] },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("分类不存在时应返回 404", async () => {
      mockAuthSuccess(ADMIN_USER);
      mockPrismaCategoryFindUnique.mockResolvedValue(null);
      const result = await deleteCategories(
        { access_token: "token", ids: [999] },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("getCategoriesList 补充测试", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await getCategoriesList(
        {
          access_token: "token",
          page: 1,
          pageSize: 25,
          sortBy: "totalPostCount",
          sortOrder: "desc",
        },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("getCategoryDetail 补充测试", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await getCategoryDetail(
        { access_token: "token", slug: "test" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("非管理员/编辑应返回未授权", async () => {
      mockAuthFailure();
      const result = await getCategoryDetail(
        { access_token: "token", slug: "test" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  // ===== 分支覆盖补充测试 =====

  describe("getCategoriesList 分支", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await getCategoriesList(
        {
          access_token: "token",
          page: 1,
          pageSize: 25,
          sortBy: "totalPostCount",
          sortOrder: "desc",
        },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("数据库错误时返回失败", async () => {
      mockAuthSuccess();
      mockPrismaCategoryFindMany.mockRejectedValue(new Error("DB error"));
      const result = await getCategoriesList(
        {
          access_token: "token",
          page: 1,
          pageSize: 25,
          sortBy: "totalPostCount",
          sortOrder: "desc",
        },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("带 search 过滤", async () => {
      mockAuthSuccess();
      mockPrismaCategoryFindMany.mockResolvedValue([]);
      const result = await getCategoriesList(
        {
          access_token: "token",
          page: 1,
          pageSize: 25,
          sortBy: "totalPostCount",
          sortOrder: "desc",
          search: "test",
        },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
    });

    it("带 hasZeroPosts 过滤", async () => {
      mockAuthSuccess();
      mockPrismaCategoryFindMany.mockResolvedValue([]);
      const result = await getCategoriesList(
        {
          access_token: "token",
          page: 1,
          pageSize: 25,
          sortBy: "totalPostCount",
          sortOrder: "desc",
          hasZeroPosts: true,
        },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
    });

    it("带日期范围过滤", async () => {
      mockAuthSuccess();
      mockPrismaCategoryFindMany.mockResolvedValue([]);
      const result = await getCategoriesList(
        {
          access_token: "token",
          page: 1,
          pageSize: 25,
          sortBy: "totalPostCount",
          sortOrder: "desc",
          createdAtStart: "2025-01-01",
          createdAtEnd: "2025-12-31",
        },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
    });
  });

  describe("moveCategories 分支", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await moveCategories(
        { access_token: "token", ids: [1], targetParentId: null },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("非管理员应返回未授权", async () => {
      mockAuthFailure();
      const result = await moveCategories(
        { access_token: "token", ids: [1], targetParentId: null },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("数据库错误时返回失败", async () => {
      mockAuthSuccess();
      mockPrismaCategoryFindMany.mockRejectedValue(new Error("DB error"));
      const result = await moveCategories(
        { access_token: "token", ids: [1], targetParentId: null },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("searchCategories 分支", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await searchCategories(
        { access_token: "token", query: "test", limit: 10 },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("非管理员/编辑/作者应返回未授权", async () => {
      mockAuthFailure();
      const result = await searchCategories(
        { access_token: "token", query: "test", limit: 10 },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("数据库错误时返回失败", async () => {
      mockAuthSuccess();
      mockPrismaCategoryFindMany.mockRejectedValue(new Error("DB error"));
      const result = await searchCategories(
        { access_token: "token", query: "test", limit: 10 },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("空结果返回空数组", async () => {
      mockAuthSuccess();
      mockPrismaCategoryFindMany.mockResolvedValue([]);
      const result = await searchCategories(
        { access_token: "token", query: "nonexistent", limit: 10 },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
    });
  });

  describe("getCategoriesDistribution 分支", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await getCategoriesDistribution(
        { access_token: "token", limit: 10 },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("非管理员/编辑/作者应返回未授权", async () => {
      mockAuthFailure();
      const result = await getCategoriesDistribution(
        { access_token: "token", limit: 10 },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("数据库错误时返回失败", async () => {
      mockAuthSuccess();
      mockPrismaCategoryFindMany.mockRejectedValue(new Error("DB error"));
      const result = await getCategoriesDistribution(
        { access_token: "token", limit: 10 },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("getCategoriesTree 分支", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await getCategoriesTree(
        { access_token: "token" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("非管理员/编辑/作者应返回未授权", async () => {
      mockAuthFailure();
      const result = await getCategoriesTree(
        { access_token: "token" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("deleteCategories 分支", () => {
    it("数据库错误时返回失败", async () => {
      mockAuthSuccess();
      mockPrismaCategoryFindMany.mockRejectedValue(new Error("DB error"));
      const result = await deleteCategories(
        { access_token: "token", ids: [1] },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("updateCategory 分支", () => {
    it("数据库错误时返回失败", async () => {
      mockAuthSuccess();
      mockPrismaCategoryFindUnique.mockRejectedValue(new Error("DB error"));
      const result = await updateCategory(
        { access_token: "token", id: 1, newName: "Updated" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("createCategory 分支", () => {
    it("数据库错误时返回失败", async () => {
      mockAuthSuccess();
      mockPrismaCategoryFindFirst.mockRejectedValue(new Error("DB error"));
      const result = await createCategory(
        { access_token: "token", name: "New Category" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });
});
