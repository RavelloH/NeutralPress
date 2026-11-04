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
  mockPrismaPostFindMany,
  mockPrismaPostFindUnique,
  mockPrismaPostFindFirst,
  mockPrismaPostCreate,
  mockPrismaPostUpdate,
  mockPrismaPostUpdateMany,
  mockPrismaPostCount,
  mockPrismaCategoryFindMany,
  mockPrismaCategoryFindFirst,
  mockPrismaCategoryFindUnique,
  mockPrismaCategoryCreate,
  mockPrismaCategoryUpdate,
  mockPrismaTagFindUnique,
  mockPrismaMediaReferenceDeleteMany,
  mockPrismaMediaReferenceCreate,
  mockPrismaTransaction,
  mockSlugify,
  mockGetConfig,
  mockFindMediaIdByUrl,
  mockGetFeaturedImageUrl,
  mockGenerateSignature,
  mockMarkdownToPlainText,
  mockAnalyzeText,
  mockBuildTocFromSource,
  mockVerifyToken,
  mockEvaluatePostAccess,
  mockNormalizePostAccessInput,
  mockValidatePostAccessInput,
  mockHasPostAccessChanged,
  mockClearPostAccessCookie,
  mockSetPostAccessCookie,
  mockIsPostLicenseValue,
  mockToStoredPostLicense,
  mockTextVersionImpl,
} = vi.hoisted(() => ({
  mockLimitControl: vi.fn(),
  mockAuthVerify: vi.fn(),
  mockValidateData: vi.fn(),
  mockHeaders: vi.fn(),
  mockLogAuditEvent: vi.fn(),
  mockPrismaPostFindMany: vi.fn(),
  mockPrismaPostFindUnique: vi.fn(),
  mockPrismaPostFindFirst: vi.fn(),
  mockPrismaPostCreate: vi.fn(),
  mockPrismaPostUpdate: vi.fn(),
  mockPrismaPostUpdateMany: vi.fn(),
  mockPrismaPostCount: vi.fn(),
  mockPrismaCategoryFindMany: vi.fn(),
  mockPrismaCategoryFindFirst: vi.fn(),
  mockPrismaCategoryFindUnique: vi.fn(),
  mockPrismaCategoryCreate: vi.fn(),
  mockPrismaCategoryUpdate: vi.fn(),
  mockPrismaTagFindUnique: vi.fn(),
  mockPrismaMediaReferenceDeleteMany: vi.fn(),
  mockPrismaMediaReferenceCreate: vi.fn(),
  mockPrismaTransaction: vi.fn(),
  mockSlugify: vi.fn(),
  mockGetConfig: vi.fn(),
  mockFindMediaIdByUrl: vi.fn(),
  mockGetFeaturedImageUrl: vi.fn(),
  mockGenerateSignature: vi.fn(),
  mockMarkdownToPlainText: vi.fn(),
  mockAnalyzeText: vi.fn(),
  mockBuildTocFromSource: vi.fn(),
  mockVerifyToken: vi.fn(),
  mockEvaluatePostAccess: vi.fn(),
  mockNormalizePostAccessInput: vi.fn(),
  mockValidatePostAccessInput: vi.fn(),
  mockHasPostAccessChanged: vi.fn(),
  mockClearPostAccessCookie: vi.fn(),
  mockSetPostAccessCookie: vi.fn(),
  mockIsPostLicenseValue: vi.fn(),
  mockToStoredPostLicense: vi.fn(),
  mockTextVersionImpl: {} as Record<string, unknown>,
}));

vi.mock("@/lib/server/prisma", () => ({
  default: {
    post: {
      findMany: mockPrismaPostFindMany,
      findUnique: mockPrismaPostFindUnique,
      findFirst: mockPrismaPostFindFirst,
      create: mockPrismaPostCreate,
      update: mockPrismaPostUpdate,
      updateMany: mockPrismaPostUpdateMany,
      count: mockPrismaPostCount,
    },
    category: {
      findMany: mockPrismaCategoryFindMany,
      findFirst: mockPrismaCategoryFindFirst,
      findUnique: mockPrismaCategoryFindUnique,
      create: mockPrismaCategoryCreate,
      update: mockPrismaCategoryUpdate,
    },
    tag: { findUnique: mockPrismaTagFindUnique },
    mediaReference: {
      deleteMany: mockPrismaMediaReferenceDeleteMany,
      create: mockPrismaMediaReferenceCreate,
    },
    $transaction: mockPrismaTransaction,
    $executeRaw: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("@/lib/server/auth-verify", () => ({ authVerify: mockAuthVerify }));
vi.mock("@/lib/server/rate-limit", () => ({ default: mockLimitControl }));
vi.mock("@/lib/server/validator", () => ({ validateData: mockValidateData }));
vi.mock("@/lib/server/audit", () => ({ logAuditEvent: mockLogAuditEvent }));
vi.mock("@/lib/server/slugify", () => ({ slugify: mockSlugify }));
vi.mock("@/lib/server/config-cache", () => ({
  getConfig: mockGetConfig,
}));
vi.mock("@/lib/server/media-reference", () => ({
  findMediaIdByUrl: mockFindMediaIdByUrl,
  getFeaturedImageUrl: mockGetFeaturedImageUrl,
}));
vi.mock("@/lib/server/image-crypto", () => ({
  generateSignature: mockGenerateSignature,
}));
vi.mock("@/lib/server/search", () => ({
  markdownToPlainText: mockMarkdownToPlainText,
}));
vi.mock("@/lib/server/tokenizer", () => ({
  analyzeText: mockAnalyzeText,
}));
vi.mock("@/lib/server/rich-text-outline", () => ({
  buildTocFromSource: mockBuildTocFromSource,
}));
vi.mock("@/lib/server/captcha", () => ({
  verifyToken: mockVerifyToken,
}));
vi.mock("@/lib/server/post-access", () => ({
  evaluatePostAccess: mockEvaluatePostAccess,
  normalizePostAccessInput: mockNormalizePostAccessInput,
  validatePostAccessInput: mockValidatePostAccessInput,
  hasPostAccessChanged: mockHasPostAccessChanged,
  clearPostAccessCookie: mockClearPostAccessCookie,
  setPostAccessCookie: mockSetPostAccessCookie,
  LISTABLE_POST_PUBLISHED_WHERE: {},
  PUBLIC_POST_STATUSES: ["PUBLISHED", "ARCHIVED"],
}));
vi.mock("@/lib/shared/post-license", () => ({
  isPostLicenseValue: mockIsPostLicenseValue,
  toStoredPostLicense: mockToStoredPostLicense,
}));
vi.mock("text-version", () => ({
  TextVersion: class MockTextVersion {
    commit = vi.fn();
    export = vi.fn();
    log = vi.fn();
    show = vi.fn();
    reset = vi.fn();
    squash = vi.fn();
    constructor() {
      Object.assign(this, mockTextVersionImpl);
    }
  },
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
  createPost,
  deletePosts,
  getPostDetail,
  getPostHistory,
  getPostsList,
  getPostsTrends,
  getPostVersion,
  getProtectedPostContent,
  resetPostToVersion,
  squashPostToVersion,
  unlockProtectedPost,
  updatePost,
  updatePosts,
} from "@/actions/post";

// ============================================================================
// Helpers
// ============================================================================

const ADMIN_USER = { uid: 1, username: "admin", role: "ADMIN" as const };
const EDITOR_USER = { uid: 2, username: "editor", role: "EDITOR" as const };
const AUTHOR_USER = { uid: 3, username: "author", role: "AUTHOR" as const };

const POST_RECORD = {
  id: 1,
  title: "Test Post",
  slug: "test-post",
  content: "# Hello World",
  excerpt: "Test excerpt",
  status: "PUBLISHED",
  isPinned: false,
  allowComments: true,
  accessMode: "PUBLIC",
  minRole: null,
  accessPasswords: [],
  publishedAt: new Date("2025-01-01"),
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  metaDescription: null,
  metaKeywords: null,
  robotsIndex: true,
  postMode: "MARKDOWN",
  license: "default",
  userUid: 1,
  versionMetadata: null,
  accessVersion: 1,
  author: { uid: 1, username: "admin", nickname: "Admin" },
  categories: [{ id: 1, name: "技术", fullSlug: "tech" }],
  tags: [{ name: "test", slug: "test" }],
  mediaRefs: [],
  viewCount: { cachedCount: 10 },
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

describe("post actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRateLimitAllowed();
    mockValidationSuccess();
    mockHeaders.mockResolvedValue(new Headers());
    mockSlugify.mockResolvedValue("test-post");
    mockGetFeaturedImageUrl.mockReturnValue(null);
    mockGenerateSignature.mockReturnValue("sig");
    mockMarkdownToPlainText.mockResolvedValue("Hello World");
    mockAnalyzeText.mockResolvedValue(["hello", "world"]);
    mockIsPostLicenseValue.mockReturnValue(true);
    mockToStoredPostLicense.mockReturnValue("default");
    mockNormalizePostAccessInput.mockImplementation((input: unknown) => input);
    mockValidatePostAccessInput.mockReturnValue(null);
    mockHasPostAccessChanged.mockReturnValue(false);
    mockFindMediaIdByUrl.mockResolvedValue(null);
    mockGetConfig.mockResolvedValue(true);
    mockPrismaCategoryFindMany.mockResolvedValue([]);
    // Reset mockTextVersionImpl
    for (const key of Object.keys(mockTextVersionImpl)) {
      delete mockTextVersionImpl[key];
    }
  });

  describe("getPostsList", () => {
    it("成功获取文章列表", async () => {
      mockAuthSuccess(ADMIN_USER);
      mockPrismaPostFindMany.mockResolvedValue([POST_RECORD]);
      mockPrismaPostCount.mockResolvedValue(1);
      const result = await getPostsList(
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
    });

    it("未认证时返回未授权", async () => {
      mockAuthFailure();
      const result = await getPostsList(
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

    it("速率限制时返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await getPostsList(
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

  describe("getPostDetail", () => {
    it("成功获取文章详情", async () => {
      mockAuthSuccess(ADMIN_USER);
      mockPrismaPostFindUnique.mockResolvedValue(POST_RECORD);
      const result = await getPostDetail(
        { access_token: "token", slug: "test-post" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
    });

    it("文章不存在时返回 404", async () => {
      mockAuthSuccess(ADMIN_USER);
      mockPrismaPostFindUnique.mockResolvedValue(null);
      const result = await getPostDetail(
        { access_token: "token", slug: "nonexistent" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("AUTHOR 查看他人文章时返回禁止", async () => {
      mockAuthSuccess(AUTHOR_USER);
      mockPrismaPostFindUnique.mockResolvedValue({
        ...POST_RECORD,
        userUid: 999,
      });
      const result = await getPostDetail(
        { access_token: "token", slug: "test-post" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("createPost", () => {
    it("成功创建文章", async () => {
      mockAuthSuccess(EDITOR_USER);
      mockPrismaPostFindUnique.mockResolvedValue(null); // slug check
      mockPrismaPostCreate.mockResolvedValue({
        id: 2,
        slug: "new-post",
        status: "DRAFT",
        publishedAt: null,
        tags: [],
        categories: [{ fullSlug: "uncategorized" }],
      });
      mockPrismaCategoryFindFirst.mockResolvedValue({
        id: 1,
        slug: "uncategorized",
        path: "1",
        depth: 0,
        fullSlug: "uncategorized",
      });
      const mockTvInstance = {
        commit: vi.fn(),
        export: vi.fn().mockReturnValue({
          metadata: "metadata",
          snapshot: "snapshot",
        }),
        log: vi.fn().mockReturnValue([]),
      };
      Object.assign(mockTextVersionImpl, mockTvInstance);
      const result = await createPost(
        {
          access_token: "token",
          title: "New Post",
          content: "# New Post Content",
        } as any,
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
    });

    it("slug 已存在时返回错误", async () => {
      mockAuthSuccess(EDITOR_USER);
      mockPrismaPostFindUnique.mockResolvedValue({ id: 1, slug: "existing" });
      const result = await createPost(
        {
          access_token: "token",
          title: "New Post",
          slug: "existing",
          content: "content",
        } as any,
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("updatePost", () => {
    it("成功更新文章", async () => {
      mockAuthSuccess(EDITOR_USER);
      mockPrismaPostFindUnique.mockResolvedValue(POST_RECORD);
      mockPrismaTransaction.mockImplementation(
        async (fn: (...args: any[]) => any) =>
          fn({
            mediaReference: { deleteMany: vi.fn() },
            post: {
              update: vi.fn().mockResolvedValue({
                id: 1,
                title: "Updated Title",
                slug: "test-post",
                status: "PUBLISHED",
                accessMode: "PUBLIC",
                minRole: null,
                accessPasswords: [],
                accessVersion: 1,
                publishedAt: new Date(),
                categories: [{ fullSlug: "tech" }],
                tags: [{ slug: "test" }],
              }),
            },
          }),
      );
      const result = await updatePost(
        {
          access_token: "token",
          slug: "test-post",
          title: "Updated Title",
        },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
    });

    it("文章不存在时返回 404", async () => {
      mockAuthSuccess(EDITOR_USER);
      mockPrismaPostFindUnique.mockResolvedValue(null);
      const result = await updatePost(
        {
          access_token: "token",
          slug: "nonexistent",
          title: "Updated",
        },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("deletePosts", () => {
    it("成功删除文章", async () => {
      mockAuthSuccess(ADMIN_USER);
      mockPrismaPostFindMany.mockResolvedValue([POST_RECORD]);
      mockPrismaPostUpdateMany.mockResolvedValue({ count: 1 });
      const result = await deletePosts(
        { access_token: "token", ids: [1] },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
    });

    it("未认证时返回未授权", async () => {
      mockAuthFailure();
      const result = await deletePosts(
        { access_token: "token", ids: [1] },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("getPostsTrends", () => {
    it("成功获取文章趋势", async () => {
      mockAuthSuccess(ADMIN_USER);
      mockPrismaPostFindMany.mockResolvedValue([]);
      const result = await getPostsTrends(
        { access_token: "token", days: 7, count: 7 },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
    });
  });

  describe("getPostHistory", () => {
    it("成功获取文章历史", async () => {
      mockAuthSuccess(EDITOR_USER);
      mockPrismaPostFindUnique.mockResolvedValue({
        id: 1,
        content: "# Hello",
        versionMetadata: "metadata",
        userUid: 2,
      });
      const mockTvInstance = {
        log: vi.fn().mockReturnValue([
          {
            version: "2:2025-01-01T00:00:00.000Z:更新内容",
            isSnapshot: true,
          },
        ]),
      };
      Object.assign(mockTextVersionImpl, mockTvInstance);
      mockPrismaPostFindUnique.mockResolvedValue({
        id: 1,
        content: "# Hello",
        versionMetadata: "metadata",
        userUid: 2,
      });
      // Mock user query for version user
      const prisma = await import("@/lib/server/prisma");
      (prisma.default as unknown as Record<string, unknown>).user = {
        findUnique: vi.fn().mockResolvedValue({
          uid: 2,
          username: "editor",
          nickname: "Editor",
        }),
      };
      const result = await getPostHistory(
        { access_token: "token", slug: "test-post" } as any,
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
    });
  });

  describe("getPostVersion", () => {
    it("成功获取版本内容", async () => {
      mockAuthSuccess(EDITOR_USER);
      mockPrismaPostFindUnique.mockResolvedValue({
        id: 1,
        content: "# Hello",
        versionMetadata: "metadata",
        userUid: 2,
      });
      const mockTvInstance = {
        log: vi.fn().mockReturnValue([
          {
            version: "2:2025-01-01T00:00:00.000Z:更新内容",
            isSnapshot: true,
          },
        ]),
        show: vi.fn().mockReturnValue("# Hello World"),
      };
      Object.assign(mockTextVersionImpl, mockTvInstance);
      const prisma = await import("@/lib/server/prisma");
      (prisma.default as unknown as Record<string, unknown>).user = {
        findUnique: vi.fn().mockResolvedValue({
          uid: 2,
          username: "editor",
          nickname: "Editor",
        }),
      };
      const result = await getPostVersion(
        {
          access_token: "token",
          slug: "test-post",
          timestamp: "2025-01-01T00:00:00.000Z",
        },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
    });
  });

  // ==================== unlockProtectedPost ====================

  describe("unlockProtectedPost", () => {
    describe("速率限制", () => {
      it("速率限制时应返回失败", async () => {
        mockLimitControl.mockResolvedValue(false);
        const result = await unlockProtectedPost({
          slug: "test",
          passphrase: "123",
          captcha_token: "token",
        });
        expect(result.success).toBe(false);
      });
    });

    describe("验证码", () => {
      it("验证码失败时应返回失败", async () => {
        mockVerifyToken.mockResolvedValue({ success: false });
        const result = await unlockProtectedPost({
          slug: "test",
          passphrase: "123",
          captcha_token: "invalid",
        });
        expect(result.success).toBe(false);
      });
    });

    describe("业务逻辑", () => {
      it("文章不存在时应返回 404", async () => {
        mockVerifyToken.mockResolvedValue({ success: true });
        mockPrismaPostFindFirst.mockResolvedValue(null);
        const result = await unlockProtectedPost({
          slug: "nonexistent",
          passphrase: "123",
          captcha_token: "valid",
        });
        expect(result.success).toBe(false);
      });

      it("非密码保护文章应返回失败", async () => {
        mockVerifyToken.mockResolvedValue({ success: true });
        mockPrismaPostFindFirst.mockResolvedValue({
          id: 1,
          accessMode: "PUBLIC",
          accessPasswords: ["123"],
          accessVersion: 1,
        });
        const result = await unlockProtectedPost({
          slug: "test",
          passphrase: "123",
          captcha_token: "valid",
        });
        expect(result.success).toBe(false);
      });

      it("口令错误时应返回禁止", async () => {
        mockVerifyToken.mockResolvedValue({ success: true });
        mockPrismaPostFindFirst.mockResolvedValue({
          id: 1,
          accessMode: "PASSWORD",
          accessPasswords: ["correct"],
          accessVersion: 1,
        });
        const result = await unlockProtectedPost({
          slug: "test",
          passphrase: "wrong",
          captcha_token: "valid",
        });
        expect(result.success).toBe(false);
      });

      it("成功解锁文章", async () => {
        mockVerifyToken.mockResolvedValue({ success: true });
        mockPrismaPostFindFirst.mockResolvedValue({
          id: 1,
          accessMode: "PASSWORD",
          accessPasswords: ["123"],
          accessVersion: 1,
        });
        mockSetPostAccessCookie.mockResolvedValue(undefined);
        const result = await unlockProtectedPost({
          slug: "test",
          passphrase: "123",
          captcha_token: "valid",
        });
        expect(result.success).toBe(true);
      });
    });
  });

  // ==================== getProtectedPostContent ====================

  describe("getProtectedPostContent", () => {
    describe("速率限制", () => {
      it("速率限制时应返回失败", async () => {
        mockLimitControl.mockResolvedValue(false);
        const result = await getProtectedPostContent({
          slug: "test",
        });
        expect(result.success).toBe(false);
      });
    });

    describe("业务逻辑", () => {
      it("文章不存在时应返回 404", async () => {
        mockPrismaPostFindFirst.mockResolvedValue(null);
        const result = await getProtectedPostContent({
          slug: "nonexistent",
        });
        expect(result.success).toBe(false);
      });

      it("未登录且需要登录时应返回未授权", async () => {
        mockPrismaPostFindFirst.mockResolvedValue({
          id: 1,
          content: "content",
          postMode: "MARKDOWN",
          allowComments: true,
          accessMode: "PRIVATE",
          minRole: "USER",
          accessPasswords: [],
          accessVersion: 1,
        });
        mockAuthVerify.mockResolvedValue(null);
        mockEvaluatePostAccess.mockResolvedValue({
          allowed: false,
          reason: "LOGIN_REQUIRED",
        });
        const result = await getProtectedPostContent({
          slug: "test",
        });
        expect(result.success).toBe(false);
      });

      it("权限不足时应返回禁止", async () => {
        mockPrismaPostFindFirst.mockResolvedValue({
          id: 1,
          content: "content",
          postMode: "MARKDOWN",
          allowComments: true,
          accessMode: "ROLE",
          minRole: "ADMIN",
          accessPasswords: [],
          accessVersion: 1,
        });
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "USER" });
        mockEvaluatePostAccess.mockResolvedValue({
          allowed: false,
          reason: "ROLE_REQUIRED",
        });
        const result = await getProtectedPostContent({
          slug: "test",
        });
        expect(result.success).toBe(false);
      });

      it("成功获取受保护文章内容", async () => {
        mockPrismaPostFindFirst.mockResolvedValue({
          id: 1,
          content: "# Protected",
          postMode: "MARKDOWN",
          allowComments: true,
          accessMode: "PASSWORD",
          minRole: "USER",
          accessPasswords: ["123"],
          accessVersion: 1,
        });
        mockAuthVerify.mockResolvedValue(null);
        mockEvaluatePostAccess.mockResolvedValue({ allowed: true });
        mockBuildTocFromSource.mockReturnValue([]);
        const result = await getProtectedPostContent({
          slug: "test",
        });
        expect(result.success).toBe(true);
        expect(result.data!.content).toBe("# Protected");
      });
    });
  });

  // ==================== updatePosts ====================

  describe("updatePosts", () => {
    describe("速率限制", () => {
      it("速率限制时应返回失败", async () => {
        mockLimitControl.mockResolvedValue(false);
        const result = await updatePosts({
          access_token: "token",
          ids: [1],
        });
        expect(result.success).toBe(false);
      });
    });

    describe("认证", () => {
      it("未认证时应返回未授权", async () => {
        mockAuthFailure();
        const result = await updatePosts({
          access_token: "token",
          ids: [1],
        });
        expect(result.success).toBe(false);
      });
    });

    describe("权限控制", () => {
      it("AUTHOR 不能修改他人文章", async () => {
        mockAuthSuccess(AUTHOR_USER);
        mockPrismaPostFindMany.mockResolvedValue([{ id: 1, userUid: 999 }]);
        const result = await updatePosts({
          access_token: "token",
          ids: [1],
          status: "PUBLISHED",
        });
        expect(result.success).toBe(false);
      });

      it("ADMIN 可以修改任何文章", async () => {
        mockAuthSuccess(ADMIN_USER);
        mockPrismaPostUpdateMany.mockResolvedValue({ count: 1 });
        const result = await updatePosts({
          access_token: "token",
          ids: [1],
          status: "PUBLISHED",
        });
        expect(result.success).toBe(true);
      });
    });

    describe("批量更新", () => {
      it("成功批量更新文章状态", async () => {
        mockAuthSuccess(EDITOR_USER);
        mockPrismaPostUpdateMany.mockResolvedValue({ count: 2 });
        const result = await updatePosts({
          access_token: "token",
          ids: [1, 2],
          status: "ARCHIVED",
        });
        expect(result.success).toBe(true);
        expect(result.data!.updated).toBe(2);
      });
    });
  });

  // ==================== resetPostToVersion ====================

  describe("resetPostToVersion", () => {
    describe("速率限制", () => {
      it("速率限制时应返回失败", async () => {
        mockLimitControl.mockResolvedValue(false);
        const result = await resetPostToVersion({
          access_token: "token",
          slug: "test",
          timestamp: "2025-01-01T00:00:00.000Z",
        });
        expect(result.success).toBe(false);
      });
    });

    describe("认证", () => {
      it("未认证时应返回未授权", async () => {
        mockAuthFailure();
        const result = await resetPostToVersion({
          access_token: "token",
          slug: "test",
          timestamp: "2025-01-01T00:00:00.000Z",
        });
        expect(result.success).toBe(false);
      });
    });

    describe("业务逻辑", () => {
      it("文章不存在时应返回 404", async () => {
        mockAuthSuccess(EDITOR_USER);
        mockPrismaPostFindUnique.mockResolvedValue(null);
        const result = await resetPostToVersion({
          access_token: "token",
          slug: "nonexistent",
          timestamp: "2025-01-01T00:00:00.000Z",
        });
        expect(result.success).toBe(false);
      });

      it("成功重置文章版本", async () => {
        mockAuthSuccess(EDITOR_USER);
        mockPrismaPostFindUnique.mockResolvedValue({
          id: 1,
          content: "# Current",
          versionMetadata: "metadata",
          userUid: 2,
        });
        const mockTvInstance = {
          log: vi.fn().mockReturnValue([
            {
              version: "1:2025-01-01T00:00:00.000Z:初始版本",
              isSnapshot: true,
            },
          ]),
          show: vi.fn().mockReturnValue("# Old Version"),
          reset: vi.fn(),
          export: vi.fn().mockReturnValue({
            snapshot: "# Old Version",
            metadata: "old-metadata",
          }),
        };
        Object.assign(mockTextVersionImpl, mockTvInstance);
        mockPrismaPostUpdate.mockResolvedValue({});
        const result = await resetPostToVersion({
          access_token: "token",
          slug: "test",
          timestamp: "2025-01-01T00:00:00.000Z",
        });
        expect(result.success).toBe(true);
      });
    });
  });

  // ==================== squashPostToVersion ====================

  describe("squashPostToVersion", () => {
    describe("速率限制", () => {
      it("速率限制时应返回失败", async () => {
        mockLimitControl.mockResolvedValue(false);
        const result = await squashPostToVersion({
          access_token: "token",
          slug: "test",
          timestamp: "2025-01-01T00:00:00.000Z",
        });
        expect(result.success).toBe(false);
      });
    });

    describe("认证", () => {
      it("未认证时应返回未授权", async () => {
        mockAuthFailure();
        const result = await squashPostToVersion({
          access_token: "token",
          slug: "test",
          timestamp: "2025-01-01T00:00:00.000Z",
        });
        expect(result.success).toBe(false);
      });
    });

    describe("业务逻辑", () => {
      it("文章不存在时应返回 404", async () => {
        mockAuthSuccess(EDITOR_USER);
        mockPrismaPostFindUnique.mockResolvedValue(null);
        const result = await squashPostToVersion({
          access_token: "token",
          slug: "nonexistent",
          timestamp: "2025-01-01T00:00:00.000Z",
        });
        expect(result.success).toBe(false);
      });

      it("成功压缩文章版本", async () => {
        mockAuthSuccess(EDITOR_USER);
        mockPrismaPostFindUnique.mockResolvedValue({
          id: 1,
          content: "# Current",
          versionMetadata: "metadata",
          userUid: 2,
        });
        const mockTvInstance = {
          log: vi.fn().mockReturnValue([
            {
              version: "1:2025-01-01T00:00:00.000Z:初始版本",
              isSnapshot: true,
            },
            {
              version: "2:2025-01-02T00:00:00.000Z:更新",
              isSnapshot: false,
            },
          ]),
          squash: vi.fn(),
          export: vi.fn().mockReturnValue({
            snapshot: "# Squashed",
            metadata: "squashed-metadata",
          }),
        };
        Object.assign(mockTextVersionImpl, mockTvInstance);
        mockPrismaPostUpdate.mockResolvedValue({});
        const result = await squashPostToVersion({
          access_token: "token",
          slug: "test",
          timestamp: "2025-01-01T00:00:00.000Z",
        });
        expect(result.success).toBe(true);
      });
    });
  });

  // ===== 分支覆盖补充测试 =====

  describe("updatePost 分支", () => {
    it("AUTHOR 不能修改他人文章", async () => {
      mockAuthSuccess(AUTHOR_USER);
      mockPrismaPostFindUnique.mockResolvedValue({
        ...POST_RECORD,
        userUid: 999, // different user
      });
      const result = await updatePost(
        { access_token: "token", id: 1, title: "Hacked" } as any,
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("slug 冲突返回失败", async () => {
      mockAuthSuccess();
      mockPrismaPostFindUnique.mockResolvedValue(POST_RECORD);
      mockPrismaPostFindFirst.mockResolvedValue({
        id: 999,
        slug: "existing-slug",
      });
      const result = await updatePost(
        { access_token: "token", id: 1, newSlug: "existing-slug" } as any,
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("数据库错误时返回失败", async () => {
      mockAuthSuccess();
      mockPrismaPostFindUnique.mockRejectedValue(new Error("DB error"));
      const result = await updatePost(
        { access_token: "token", id: 1, title: "Updated" } as any,
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("updatePosts 分支", () => {
    it("数据库错误时返回失败", async () => {
      mockAuthSuccess();
      mockPrismaPostFindMany.mockRejectedValue(new Error("DB error"));
      const result = await updatePosts(
        { access_token: "token", ids: [1], status: "PUBLISHED" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("createPost 分支", () => {
    it("数据库错误时返回失败", async () => {
      mockAuthSuccess();
      mockPrismaPostFindFirst.mockRejectedValue(new Error("DB error"));
      const result = await createPost(
        {
          access_token: "token",
          title: "New Post",
          content: "Content",
          status: "DRAFT",
        } as any,
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("deletePosts 分支", () => {
    it("AUTHOR 删除自己的文章", async () => {
      mockAuthSuccess(AUTHOR_USER);
      mockPrismaPostFindMany.mockResolvedValue([
        { id: 1, userUid: AUTHOR_USER.uid },
      ]);
      mockPrismaPostUpdateMany.mockResolvedValue({ count: 1 });
      const result = await deletePosts(
        { access_token: "token", ids: [1] },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
    });

    it("数据库错误时返回失败", async () => {
      mockAuthSuccess();
      mockPrismaPostFindMany.mockRejectedValue(new Error("DB error"));
      const result = await deletePosts(
        { access_token: "token", ids: [1] },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("getPostsList 分支", () => {
    it("AUTHOR 角色过滤到自己的文章", async () => {
      mockAuthSuccess(AUTHOR_USER);
      mockPrismaPostFindMany.mockResolvedValue([]);
      mockPrismaPostCount.mockResolvedValue(0);
      const result = await getPostsList(
        {
          access_token: "token",
          page: 1,
          pageSize: 20,
          sortBy: "createdAt",
          sortOrder: "desc",
        },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
    });

    it("带 search 过滤", async () => {
      mockAuthSuccess();
      mockPrismaPostFindMany.mockResolvedValue([]);
      mockPrismaPostCount.mockResolvedValue(0);
      const result = await getPostsList(
        { access_token: "token", page: 1, pageSize: 20, search: "test" } as any,
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
    });

    it("数据库错误时返回失败", async () => {
      mockAuthSuccess();
      mockPrismaPostFindMany.mockRejectedValue(new Error("DB error"));
      const result = await getPostsList(
        { access_token: "token", page: 1, pageSize: 20 } as any,
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("getPostDetail 分支", () => {
    it("AUTHOR 不能查看他人草稿", async () => {
      mockAuthSuccess(AUTHOR_USER);
      mockPrismaPostFindUnique.mockResolvedValue({
        ...POST_RECORD,
        status: "DRAFT",
        userUid: 999,
      });
      const result = await getPostDetail(
        { access_token: "token", slug: "test" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("数据库错误时返回失败", async () => {
      mockAuthSuccess();
      mockPrismaPostFindUnique.mockRejectedValue(new Error("DB error"));
      const result = await getPostDetail(
        { access_token: "token", slug: "test" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });
});
