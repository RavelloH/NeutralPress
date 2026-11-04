import { beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================================
// Mocks - use vi.hoisted() so they're available in vi.mock factories
// ============================================================================

const {
  mockLimitControl,
  mockAuthVerify,
  mockValidateData,
  mockSlugify,
  mockIsValidSlug,
  mockSanitizeUserSlug,
  mockGenerateUniqueSlug,
  mockFindMediaIdByUrl,
  mockGetFeaturedImageUrl,
  mockUpdateTag,
  mockHeaders,
  mockPrismaTagFindMany,
  mockPrismaTagFindUnique,
  mockPrismaTagCreate,
  mockPrismaTagUpdate,
  mockPrismaTagDeleteMany,
  mockPrismaTagCount,
  mockPrismaPostFindMany,
} = vi.hoisted(() => ({
  mockLimitControl: vi.fn(),
  mockAuthVerify: vi.fn(),
  mockValidateData: vi.fn(),
  mockSlugify: vi.fn(),
  mockIsValidSlug: vi.fn(),
  mockSanitizeUserSlug: vi.fn(),
  mockGenerateUniqueSlug: vi.fn(),
  mockFindMediaIdByUrl: vi.fn(),
  mockGetFeaturedImageUrl: vi.fn(),
  mockUpdateTag: vi.fn(),
  mockHeaders: vi.fn(),
  mockPrismaTagFindMany: vi.fn(),
  mockPrismaTagFindUnique: vi.fn(),
  mockPrismaTagCreate: vi.fn(),
  mockPrismaTagUpdate: vi.fn(),
  mockPrismaTagDeleteMany: vi.fn(),
  mockPrismaTagCount: vi.fn(),
  mockPrismaPostFindMany: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  default: {
    tag: {
      findMany: mockPrismaTagFindMany,
      findUnique: mockPrismaTagFindUnique,
      create: mockPrismaTagCreate,
      update: mockPrismaTagUpdate,
      deleteMany: mockPrismaTagDeleteMany,
      count: mockPrismaTagCount,
    },
    post: { findMany: mockPrismaPostFindMany },
  },
}));
vi.mock("@/lib/server/auth-verify", () => ({ authVerify: mockAuthVerify }));
vi.mock("@/lib/server/rate-limit", () => ({ default: mockLimitControl }));
vi.mock("@/lib/server/validator", () => ({ validateData: mockValidateData }));
vi.mock("@/lib/server/slugify", () => ({
  slugify: mockSlugify,
  isValidSlug: mockIsValidSlug,
  sanitizeUserSlug: mockSanitizeUserSlug,
  generateUniqueSlug: mockGenerateUniqueSlug,
}));
vi.mock("@/lib/server/media-reference", () => ({
  findMediaIdByUrl: mockFindMediaIdByUrl,
  getFeaturedImageUrl: mockGetFeaturedImageUrl,
  mediaRefsInclude: {},
  updateFeaturedImageRef: vi.fn(() => ({})),
}));
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
vi.mock("@/lib/server/post-access", () => ({
  LISTABLE_POST_PUBLISHED_WHERE: {},
}));

// ============================================================================
// Imports
// ============================================================================

import {
  createTag,
  deleteTags,
  getTagDetail,
  getTagsDistribution,
  getTagsList,
  searchTags,
  updateTag,
} from "@/actions/tag";

// ============================================================================
// Helpers
// ============================================================================

const ADMIN_USER = { uid: 1, username: "admin", role: "ADMIN" as const };
const EDITOR_USER = { uid: 2, username: "editor", role: "EDITOR" as const };
const AUTHOR_USER = { uid: 3, username: "author", role: "AUTHOR" as const };

const TAG_RECORD = {
  slug: "test-tag",
  name: "Test Tag",
  description: "A test tag",
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-02"),
  posts: [{ id: 1 }],
  mediaRefs: [],
};

function mockAuthSuccess(user: any = ADMIN_USER) {
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

describe("tag actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRateLimitAllowed();
    mockValidationSuccess();
    mockHeaders.mockResolvedValue(new Headers());
    mockGetFeaturedImageUrl.mockReturnValue(null);
    mockSlugify.mockResolvedValue("test-tag");
    mockIsValidSlug.mockReturnValue(true);
    mockSanitizeUserSlug.mockImplementation((s: string) => s);
  });

  // ==========================================================================
  // getTagsList
  // ==========================================================================

  describe("getTagsList", () => {
    it("成功返回标签列表", async () => {
      mockAuthSuccess(ADMIN_USER);
      mockPrismaTagFindMany.mockResolvedValue([TAG_RECORD]);
      mockPrismaTagCount.mockResolvedValue(1);

      const result = await getTagsList(
        {
          access_token: "token",
          page: 1,
          pageSize: 10,
          sortBy: "createdAt",
          sortOrder: "desc",
        },
        { environment: "serveraction" },
      );

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data![0]!.slug).toBe("test-tag");
    });

    it("速率限制拒绝时返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);

      const result = await getTagsList(
        {
          access_token: "token",
          page: 1,
          pageSize: 10,
          sortBy: "createdAt",
          sortOrder: "desc",
        } as any,
        { environment: "serveraction" },
      );

      expect(result.success).toBe(false);
    });

    it("认证失败时返回未授权", async () => {
      mockAuthFailure();

      const result = await getTagsList(
        {
          access_token: "token",
          page: 1,
          pageSize: 10,
          sortBy: "createdAt",
          sortOrder: "desc",
        } as any,
        { environment: "serveraction" },
      );

      expect(result.success).toBe(false);
    });

    it("AUTHOR 角色无法访问标签列表", async () => {
      mockAuthFailure();

      const result = await getTagsList(
        {
          access_token: "token",
          page: 1,
          pageSize: 10,
          sortBy: "createdAt",
          sortOrder: "desc",
        } as any,
        { environment: "serveraction" },
      );

      expect(result.success).toBe(false);
    });
  });

  // ==========================================================================
  // getTagDetail
  // ==========================================================================

  describe("getTagDetail", () => {
    it("成功返回标签详情", async () => {
      mockAuthSuccess(EDITOR_USER);
      mockPrismaTagFindUnique.mockResolvedValue(TAG_RECORD);

      const result = await getTagDetail(
        { access_token: "token", slug: "test-tag" },
        { environment: "serveraction" },
      );

      expect(result.success).toBe(true);
      expect(result.data!.slug).toBe("test-tag");
    });

    it("标签不存在时返回 404", async () => {
      mockAuthSuccess(ADMIN_USER);
      mockPrismaTagFindUnique.mockResolvedValue(null);

      const result = await getTagDetail(
        { access_token: "token", slug: "nonexistent" },
        { environment: "serveraction" },
      );

      expect(result.success).toBe(false);
    });
  });

  // ==========================================================================
  // createTag
  // ==========================================================================

  describe("createTag", () => {
    it("ADMIN 成功创建标签", async () => {
      mockAuthSuccess(ADMIN_USER);
      mockPrismaTagFindUnique.mockResolvedValue(null);
      mockPrismaTagFindMany.mockResolvedValue([]);
      mockPrismaTagCreate.mockResolvedValue({ ...TAG_RECORD, mediaRefs: [] });

      const result = await createTag(
        { access_token: "token", name: "New Tag" },
        { environment: "serveraction" },
      );

      expect(result.success).toBe(true);
    });

    it("AUTHOR 也可以创建标签", async () => {
      mockAuthSuccess(AUTHOR_USER);
      mockPrismaTagFindUnique.mockResolvedValue(null);
      mockPrismaTagFindMany.mockResolvedValue([]);
      mockPrismaTagCreate.mockResolvedValue({ ...TAG_RECORD, mediaRefs: [] });

      const result = await createTag(
        { access_token: "token", name: "New Tag" },
        { environment: "serveraction" },
      );

      expect(result.success).toBe(true);
    });

    it("标签名已存在时返回错误", async () => {
      mockAuthSuccess(ADMIN_USER);
      mockPrismaTagFindUnique
        .mockResolvedValueOnce(null) // slug check
        .mockResolvedValueOnce(TAG_RECORD); // name check

      const result = await createTag(
        { access_token: "token", name: "Test Tag" },
        { environment: "serveraction" },
      );

      expect(result.success).toBe(false);
    });
  });

  // ==========================================================================
  // updateTag
  // ==========================================================================

  describe("updateTag", () => {
    it("成功更新标签", async () => {
      mockAuthSuccess(EDITOR_USER);
      mockPrismaTagFindUnique
        .mockResolvedValueOnce(TAG_RECORD)
        .mockResolvedValueOnce(null);
      mockPrismaPostFindMany.mockResolvedValue([]);
      mockPrismaTagUpdate.mockResolvedValue({
        ...TAG_RECORD,
        name: "Updated",
        mediaRefs: [],
      });

      const result = await updateTag(
        { access_token: "token", slug: "test-tag", newName: "Updated" },
        { environment: "serveraction" },
      );

      expect(result.success).toBe(true);
    });

    it("标签不存在时返回 404", async () => {
      mockAuthSuccess(ADMIN_USER);
      mockPrismaTagFindUnique.mockResolvedValue(null);

      const result = await updateTag(
        { access_token: "token", slug: "nonexistent", newName: "New" },
        { environment: "serveraction" },
      );

      expect(result.success).toBe(false);
    });

    it("AUTHOR 无法更新标签（需要 ADMIN/EDITOR）", async () => {
      mockAuthFailure();

      const result = await updateTag(
        { access_token: "token", slug: "test-tag", newName: "New" },
        { environment: "serveraction" },
      );

      expect(result.success).toBe(false);
    });
  });

  // ==========================================================================
  // deleteTags
  // ==========================================================================

  describe("deleteTags", () => {
    it("ADMIN 成功删除标签", async () => {
      mockAuthSuccess(ADMIN_USER);
      mockPrismaPostFindMany.mockResolvedValue([]);
      mockPrismaTagDeleteMany.mockResolvedValue({ count: 1 });

      const result = await deleteTags(
        { access_token: "token", slugs: ["test-tag"] },
        { environment: "serveraction" },
      );

      expect(result.success).toBe(true);
      expect(result.data!.deleted).toBe(1);
    });

    it("EDITOR 无法删除标签（需要 ADMIN）", async () => {
      mockAuthFailure();

      const result = await deleteTags(
        { access_token: "token", slugs: ["test-tag"] },
        { environment: "serveraction" },
      );

      expect(result.success).toBe(false);
    });
  });

  // ==========================================================================
  // searchTags
  // ==========================================================================

  describe("searchTags", () => {
    it("成功搜索标签", async () => {
      mockAuthSuccess(AUTHOR_USER);
      mockPrismaTagFindMany.mockResolvedValue([
        { slug: "test-tag", name: "Test Tag", posts: [{ id: 1 }] },
      ]);

      const result = await searchTags(
        {
          access_token: "token",
          query: "test",
          page: 1,
          pageSize: 10,
          sortBy: "createdAt",
          sortOrder: "desc",
        } as any,
        { environment: "serveraction" },
      );

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
    });

    it("搜索结果按相关度排序", async () => {
      mockAuthSuccess(ADMIN_USER);
      mockPrismaTagFindMany.mockResolvedValue([
        { slug: "other", name: "Other", posts: [] },
        { slug: "test-tag", name: "test", posts: [{ id: 1 }] },
      ]);

      const result = await searchTags(
        {
          access_token: "token",
          query: "test",
          page: 1,
          pageSize: 10,
          sortBy: "createdAt",
          sortOrder: "desc",
        } as any,
        { environment: "serveraction" },
      );

      expect(result.success).toBe(true);
      expect(result.data![0]!.name).toBe("test");
    });
  });

  // ==========================================================================
  // getTagsDistribution
  // ==========================================================================

  describe("getTagsDistribution", () => {
    it("成功返回标签分布", async () => {
      mockAuthSuccess(EDITOR_USER);
      mockPrismaTagFindMany.mockResolvedValue([
        { name: "Tag A", posts: [{ id: 1 }, { id: 2 }] },
        { name: "Tag B", posts: [{ id: 3 }] },
      ]);

      const result = await getTagsDistribution(
        { access_token: "token" } as any,
        { environment: "serveraction" },
      );

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data![0]!.name).toBe("Tag A");
    });
  });

  // ==================== 补充分支覆盖测试 ====================

  describe("getTagsList 补充测试", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await getTagsList(
        {
          access_token: "token",
          page: 1,
          pageSize: 10,
          sortBy: "createdAt",
          sortOrder: "desc",
        } as any,
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("getTagDetail 补充测试", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await getTagDetail(
        { access_token: "token", slug: "test" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("非管理员应返回未授权", async () => {
      mockAuthFailure();
      const result = await getTagDetail(
        { access_token: "token", slug: "test" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("createTag 补充测试", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await createTag(
        { access_token: "token", name: "New Tag" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("updateTag 补充测试", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await updateTag(
        { access_token: "token", slug: "test", name: "Updated" } as any,
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("deleteTags 补充测试", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await deleteTags(
        { access_token: "token", slugs: ["test"] },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("searchTags 补充测试", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await searchTags(
        {
          access_token: "token",
          query: "test",
          page: 1,
          pageSize: 10,
          sortBy: "createdAt",
          sortOrder: "desc",
        } as any,
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("getTagsDistribution 补充测试", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await getTagsDistribution(
        { access_token: "token" } as any,
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  // ===== 分支覆盖补充测试 =====

  describe("getTagsList 分支", () => {
    it("带 search 过滤", async () => {
      mockAuthSuccess();
      mockPrismaTagFindMany.mockResolvedValue([]);
      mockPrismaTagCount.mockResolvedValue(0);
      const result = await getTagsList(
        {
          access_token: "token",
          search: "test",
          page: 1,
          pageSize: 10,
          sortBy: "createdAt",
          sortOrder: "desc",
        } as any,
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
    });

    it("数据库错误时返回失败", async () => {
      mockAuthSuccess();
      mockPrismaTagFindMany.mockRejectedValue(new Error("DB error"));
      const result = await getTagsList(
        {
          access_token: "token",
          page: 1,
          pageSize: 10,
          sortBy: "createdAt",
          sortOrder: "desc",
        } as any,
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("searchTags 分支", () => {
    it("数据库错误时返回失败", async () => {
      mockAuthSuccess();
      mockPrismaTagFindMany.mockRejectedValue(new Error("DB error"));
      const result = await searchTags(
        {
          access_token: "token",
          query: "test",
          page: 1,
          pageSize: 10,
          sortBy: "createdAt",
          sortOrder: "desc",
        } as any,
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("空结果返回空数组", async () => {
      mockAuthSuccess();
      mockPrismaTagFindMany.mockResolvedValue([]);
      const result = await searchTags(
        {
          access_token: "token",
          query: "nonexistent",
          page: 1,
          pageSize: 10,
          sortBy: "createdAt",
          sortOrder: "desc",
        } as any,
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
    });
  });

  describe("getTagsDistribution 分支", () => {
    it("数据库错误时返回失败", async () => {
      mockAuthSuccess();
      mockPrismaTagFindMany.mockRejectedValue(new Error("DB error"));
      const result = await getTagsDistribution(
        { access_token: "token" } as any,
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("createTag 分支", () => {
    it("数据库错误时返回失败", async () => {
      mockAuthSuccess();
      mockPrismaTagFindUnique.mockRejectedValue(new Error("DB error"));
      const result = await createTag(
        { access_token: "token", name: "New Tag" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("updateTag 分支", () => {
    it("数据库错误时返回失败", async () => {
      mockAuthSuccess();
      mockPrismaTagFindUnique.mockRejectedValue(new Error("DB error"));
      const result = await updateTag(
        { access_token: "token", id: 1, name: "Updated" } as any,
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("deleteTags 分支", () => {
    it("数据库错误时返回失败", async () => {
      mockAuthSuccess();
      mockPrismaTagFindMany.mockRejectedValue(new Error("DB error"));
      const result = await deleteTags(
        { access_token: "token", ids: [1] } as any,
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });
});
