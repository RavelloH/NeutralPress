import { beforeEach, describe, expect, it, vi } from "vitest";

// ============ Mocks ============

const mockHeaders = vi.fn().mockReturnValue(new Headers());
vi.mock("next/headers", () => ({
  headers: (...args: unknown[]) => mockHeaders(...args),
}));

const mockLimitControl = vi.fn().mockResolvedValue(true);
vi.mock("@/lib/server/rate-limit", () => ({
  default: (...args: unknown[]) => mockLimitControl(...args),
}));

const mockAuthVerify = vi.fn();
vi.mock("@/lib/server/auth-verify", () => ({
  authVerify: (...args: unknown[]) => mockAuthVerify(...args),
}));

const mockVerifyCaptchaToken = vi.fn().mockResolvedValue({ success: true });
vi.mock("@/lib/server/captcha", () => ({
  verifyToken: (...args: unknown[]) => mockVerifyCaptchaToken(...args),
}));

const mockGetConfig = vi.fn();
const mockGetConfigs = vi.fn();
vi.mock("@/lib/server/config-cache", () => ({
  getConfig: (...args: unknown[]) => mockGetConfig(...args),
  getConfigs: (...args: unknown[]) => mockGetConfigs(...args),
}));

const mockSendNotice = vi.fn();
vi.mock("@/lib/server/notice", () => ({
  sendNotice: (...args: unknown[]) => mockSendNotice(...args),
}));

const mockPrisma = {
  friendLink: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  user: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
};
vi.mock("@/lib/server/prisma", () => ({ default: mockPrisma }));

vi.mock("@/lib/server/audit", () => ({
  logAuditEvent: vi.fn(),
}));

vi.mock("@/lib/server/url-security", () => ({
  fetchPublicHttpUrlBuffer: vi.fn(),
}));

vi.mock("@/lib/server/cron-task-runner", () => ({
  runFriendLinksCheck: vi.fn(),
}));

vi.mock("next/cache", () => ({
  updateTag: vi.fn(),
}));
vi.mock("@/lib/server/isr-invalidation", () => ({ expireCacheTag: vi.fn() }));

vi.mock("next/server", () => ({
  after: vi.fn((fn: () => Promise<void>) => fn()),
}));

// ============ Tests ============

describe("friendlink actions", () => {
  let submitFriendLinkApplication: typeof import("@/actions/friendlink").submitFriendLinkApplication;
  let getOwnFriendLink: typeof import("@/actions/friendlink").getOwnFriendLink;
  let updateOwnFriendLink: typeof import("@/actions/friendlink").updateOwnFriendLink;
  let deleteOwnFriendLink: typeof import("@/actions/friendlink").deleteOwnFriendLink;
  let getFriendLinkDetail: typeof import("@/actions/friendlink").getFriendLinkDetail;
  let updateFriendLinkByAdmin: typeof import("@/actions/friendlink").updateFriendLinkByAdmin;
  let deleteFriendLinkByAdmin: typeof import("@/actions/friendlink").deleteFriendLinkByAdmin;
  let reviewFriendLink: typeof import("@/actions/friendlink").reviewFriendLink;
  let parseFriendLinkByAdmin: typeof import("@/actions/friendlink").parseFriendLinkByAdmin;
  let createFriendLinkByAdmin: typeof import("@/actions/friendlink").createFriendLinkByAdmin;
  let getFriendLinksList: typeof import("@/actions/friendlink").getFriendLinksList;
  let getFriendLinksStats: typeof import("@/actions/friendlink").getFriendLinksStats;
  let getFriendLinksTrends: typeof import("@/actions/friendlink").getFriendLinksTrends;
  let checkFriendLinks: typeof import("@/actions/friendlink").checkFriendLinks;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mockLimitControl.mockResolvedValue(true);
    mockAuthVerify.mockResolvedValue(null);
    mockVerifyCaptchaToken.mockResolvedValue({ success: true });

    const mod = await import("@/actions/friendlink");
    submitFriendLinkApplication = mod.submitFriendLinkApplication;
    getOwnFriendLink = mod.getOwnFriendLink;
    updateOwnFriendLink = mod.updateOwnFriendLink;
    deleteOwnFriendLink = mod.deleteOwnFriendLink;
    getFriendLinkDetail = mod.getFriendLinkDetail;
    updateFriendLinkByAdmin = mod.updateFriendLinkByAdmin;
    deleteFriendLinkByAdmin = mod.deleteFriendLinkByAdmin;
    reviewFriendLink = mod.reviewFriendLink;
    parseFriendLinkByAdmin = mod.parseFriendLinkByAdmin;
    createFriendLinkByAdmin = mod.createFriendLinkByAdmin;
    getFriendLinksList = mod.getFriendLinksList;
    getFriendLinksStats = mod.getFriendLinksStats;
    getFriendLinksTrends = mod.getFriendLinksTrends;
    checkFriendLinks = mod.checkFriendLinks;
  });

  // ==================== submitFriendLinkApplication ====================

  describe("submitFriendLinkApplication", () => {
    describe("速率限制", () => {
      it("速率限制时应返回失败", async () => {
        mockLimitControl.mockResolvedValue(false);
        const result = await submitFriendLinkApplication({
          name: "Test",
          url: "https://test.com",
          avatar: "https://test.com/a.png",
          slogan: "Hello",
          friendLinkUrl: "https://test.com/friends",
          captcha_token: "token",
        });
        expect(result.success).toBe(false);
      });
    });

    describe("认证", () => {
      it("未登录时应返回未授权", async () => {
        mockAuthVerify.mockResolvedValue(null);
        const result = await submitFriendLinkApplication({
          name: "Test",
          url: "https://test.com",
          avatar: "https://test.com/a.png",
          slogan: "Hello",
          friendLinkUrl: "https://test.com/friends",
          captcha_token: "token",
        });
        expect(result.success).toBe(false);
      });
    });

    describe("业务逻辑", () => {
      it("已有待审核申请时应返回冲突", async () => {
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "USER" });
        mockPrisma.friendLink.findFirst.mockResolvedValue({
          id: 1,
          ownerUid: 1,
          status: "PENDING",
        });
        const result = await submitFriendLinkApplication({
          name: "Test",
          url: "https://test.com",
          avatar: "https://test.com/a.png",
          slogan: "Hello",
          friendLinkUrl: "https://test.com/friends",
          captcha_token: "token",
        });
        expect(result.success).toBe(false);
      });

      it("成功提交友链申请", async () => {
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "USER" });
        mockPrisma.friendLink.findFirst.mockResolvedValue(null);
        // submitFriendLinkApplication 使用 getConfig 和 getConfigs
        mockGetConfig.mockResolvedValue(true); // friendlink.apply.enable
        mockGetConfigs.mockResolvedValue([false, "https://mysite.com"]);
        mockPrisma.friendLink.create.mockResolvedValue({
          id: 1,
          name: "Test",
          url: "https://test.com",
          status: "PENDING",
          createdAt: new Date(),
        });
        mockPrisma.user.findMany.mockResolvedValue([{ uid: 100 }]);

        const result = await submitFriendLinkApplication({
          name: "Test",
          url: "https://test.com",
          avatar: "https://test.com/a.png",
          slogan: "Hello",
          friendLinkUrl: "https://test.com/friends",
          captcha_token: "valid-token",
        });
        expect(result.success).toBe(true);
      });
    });
  });

  // ==================== getOwnFriendLink ====================

  describe("getOwnFriendLink", () => {
    describe("速率限制", () => {
      it("速率限制时应返回失败", async () => {
        mockLimitControl.mockResolvedValue(false);
        const result = await getOwnFriendLink({ access_token: "token" });
        expect(result.success).toBe(false);
      });
    });

    describe("认证", () => {
      it("未登录时应返回未授权", async () => {
        mockAuthVerify.mockResolvedValue(null);
        const result = await getOwnFriendLink({ access_token: "token" });
        expect(result.success).toBe(false);
      });
    });

    describe("业务逻辑", () => {
      it("无友链记录时返回 null", async () => {
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "USER" });
        mockPrisma.friendLink.findUnique.mockResolvedValue(null);
        const result = await getOwnFriendLink({ access_token: "token" });
        expect(result.success).toBe(true);
        expect(result.data).toBeNull();
      });

      it("成功获取友链信息", async () => {
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "USER" });
        mockPrisma.friendLink.findUnique.mockResolvedValue({
          id: 1,
          name: "Test",
          url: "https://test.com",
          avatar: "https://test.com/avatar.png",
          slogan: "Hello",
          friendLinkUrl: "https://test.com/friends",
          ignoreBacklink: false,
          group: null,
          order: 0,
          status: "PUBLISHED",
          checkSuccessCount: 10,
          checkFailureCount: 0,
          lastCheckedAt: new Date(),
          avgResponseTime: 100,
          applyNote: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          publishedAt: new Date(),
          checkHistory: [],
          owner: { uid: 1, username: "user1", nickname: null },
          auditor: null,
        });
        const result = await getOwnFriendLink({ access_token: "token" });
        expect(result.success).toBe(true);
        expect(result.data!.name).toBe("Test");
      });
    });
  });

  // ==================== updateOwnFriendLink ====================

  describe("updateOwnFriendLink", () => {
    describe("认证", () => {
      it("未登录时应返回未授权", async () => {
        mockAuthVerify.mockResolvedValue(null);
        const result = await updateOwnFriendLink({
          access_token: "token",
          name: "Test",
          url: "https://test.com",
          avatar: "https://test.com/a.png",
          slogan: "Hi",
          friendLinkUrl: "https://test.com/friends",
        });
        expect(result.success).toBe(false);
      });
    });

    describe("业务逻辑", () => {
      it("未找到友链记录时应返回 404", async () => {
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "USER" });
        mockPrisma.friendLink.findUnique.mockResolvedValue(null);
        const result = await updateOwnFriendLink({
          access_token: "token",
          name: "Test",
          url: "https://test.com",
          avatar: "https://test.com/a.png",
          slogan: "Hi",
          friendLinkUrl: "https://test.com/friends",
        });
        expect(result.success).toBe(false);
      });

      it("非发布状态时应返回 403", async () => {
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "USER" });
        mockPrisma.friendLink.findUnique.mockResolvedValue({
          id: 1,
          name: "Test",
          status: "PENDING",
        });
        const result = await updateOwnFriendLink({
          access_token: "token",
          name: "Test",
          url: "https://test.com",
          avatar: "https://test.com/a.png",
          slogan: "Hi",
          friendLinkUrl: "https://test.com/friends",
        });
        expect(result.success).toBe(false);
      });

      it("成功更新友链", async () => {
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "USER" });
        mockPrisma.friendLink.findUnique.mockResolvedValue({
          id: 1,
          name: "Test",
          status: "PUBLISHED",
        });
        mockPrisma.friendLink.update.mockResolvedValue({
          id: 1,
          updatedAt: new Date(),
        });
        const result = await updateOwnFriendLink({
          access_token: "token",
          name: "Updated",
          url: "https://test.com",
          avatar: "https://test.com/a.png",
          slogan: "Hi",
          friendLinkUrl: "https://test.com/friends",
        });
        expect(result.success).toBe(true);
      });
    });
  });

  // ==================== deleteOwnFriendLink ====================

  describe("deleteOwnFriendLink", () => {
    describe("认证", () => {
      it("未登录时应返回未授权", async () => {
        mockAuthVerify.mockResolvedValue(null);
        const result = await deleteOwnFriendLink({ access_token: "token" });
        expect(result.success).toBe(false);
      });
    });

    describe("业务逻辑", () => {
      it("未找到友链记录时应返回 404", async () => {
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "USER" });
        mockPrisma.friendLink.findUnique.mockResolvedValue(null);
        const result = await deleteOwnFriendLink({ access_token: "token" });
        expect(result.success).toBe(false);
      });

      it("被拉黑时应返回 403", async () => {
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "USER" });
        mockPrisma.friendLink.findUnique.mockResolvedValue({
          id: 1,
          name: "Test",
          status: "BLOCKED",
        });
        const result = await deleteOwnFriendLink({ access_token: "token" });
        expect(result.success).toBe(false);
      });

      it("成功删除友链", async () => {
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "USER" });
        mockPrisma.friendLink.findUnique.mockResolvedValue({
          id: 1,
          name: "Test",
          status: "PUBLISHED",
        });
        mockPrisma.friendLink.update.mockResolvedValue({});
        const result = await deleteOwnFriendLink({ access_token: "token" });
        expect(result.success).toBe(true);
      });
    });
  });

  // ==================== getFriendLinkDetail ====================

  describe("getFriendLinkDetail", () => {
    describe("速率限制", () => {
      it("速率限制时应返回失败", async () => {
        mockLimitControl.mockResolvedValue(false);
        const result = await getFriendLinkDetail({
          access_token: "token",
          id: 1,
        });
        expect(result.success).toBe(false);
      });
    });

    describe("认证", () => {
      it("非管理员应返回未授权", async () => {
        mockAuthVerify.mockResolvedValue(null);
        const result = await getFriendLinkDetail({
          access_token: "token",
          id: 1,
        });
        expect(result.success).toBe(false);
      });
    });

    describe("业务逻辑", () => {
      it("友链不存在时应返回 404", async () => {
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
        mockPrisma.friendLink.findUnique.mockResolvedValue(null);
        const result = await getFriendLinkDetail({
          access_token: "token",
          id: 999,
        });
        expect(result.success).toBe(false);
      });

      it("成功获取友链详情", async () => {
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
        mockPrisma.friendLink.findUnique.mockResolvedValue({
          id: 1,
          name: "Test",
          url: "https://test.com",
          avatar: "https://test.com/a.png",
          slogan: "Hello",
          friendLinkUrl: "https://test.com/friends",
          ignoreBacklink: false,
          group: null,
          order: 0,
          status: "PUBLISHED",
          checkSuccessCount: 10,
          checkFailureCount: 0,
          lastCheckedAt: new Date(),
          avgResponseTime: 100,
          applyNote: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          publishedAt: new Date(),
          checkHistory: [],
          owner: { uid: 1, username: "user1", nickname: null },
          auditor: { uid: 2, username: "admin", nickname: null },
        });
        const result = await getFriendLinkDetail({
          access_token: "token",
          id: 1,
        });
        expect(result.success).toBe(true);
        expect(result.data!.name).toBe("Test");
      });
    });
  });

  // ==================== reviewFriendLink ====================

  describe("reviewFriendLink", () => {
    describe("速率限制", () => {
      it("速率限制时应返回失败", async () => {
        mockLimitControl.mockResolvedValue(false);
        const result = await reviewFriendLink({
          access_token: "token",
          id: 1,
          status: "PUBLISHED",
        });
        expect(result.success).toBe(false);
      });
    });

    describe("认证", () => {
      it("非管理员应返回未授权", async () => {
        mockAuthVerify.mockResolvedValue(null);
        const result = await reviewFriendLink({
          access_token: "token",
          id: 1,
          status: "PUBLISHED",
        });
        expect(result.success).toBe(false);
      });
    });

    describe("业务逻辑", () => {
      it("友链不存在时应返回 404", async () => {
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
        mockPrisma.friendLink.findUnique.mockResolvedValue(null);
        const result = await reviewFriendLink({
          access_token: "token",
          id: 999,
          status: "PUBLISHED",
        });
        expect(result.success).toBe(false);
      });

      it("非待审核状态时应返回失败", async () => {
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
        mockPrisma.friendLink.findUnique.mockResolvedValue({
          id: 1,
          status: "PUBLISHED",
        });
        const result = await reviewFriendLink({
          access_token: "token",
          id: 1,
          status: "PUBLISHED",
        });
        expect(result.success).toBe(false);
      });

      it("成功审核通过友链", async () => {
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
        mockPrisma.friendLink.findUnique.mockResolvedValue({
          id: 1,
          status: "PENDING",
          ownerUid: 2,
          name: "Test",
          url: "https://test.com",
          avatar: "https://test.com/a.png",
          slogan: "Hello",
          friendLinkUrl: "https://test.com/friends",
          ignoreBacklink: false,
          group: null,
          order: 0,
          checkSuccessCount: 0,
          checkFailureCount: 0,
          lastCheckedAt: null,
          avgResponseTime: null,
          applyNote: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          publishedAt: null,
          checkHistory: [],
        });
        mockPrisma.friendLink.update.mockResolvedValue({
          id: 1,
          status: "PUBLISHED",
          updatedAt: new Date(),
          publishedAt: new Date(),
        });
        mockGetConfigs.mockResolvedValue([]);
        const result = await reviewFriendLink({
          access_token: "token",
          id: 1,
          status: "PUBLISHED",
        });
        expect(result.success).toBe(true);
      });

      it("成功拒绝友链", async () => {
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
        mockPrisma.friendLink.findUnique.mockResolvedValue({
          id: 1,
          status: "PENDING",
          ownerUid: 2,
          name: "Test",
          url: "https://test.com",
          avatar: "https://test.com/a.png",
          slogan: "Hello",
          friendLinkUrl: "https://test.com/friends",
          ignoreBacklink: false,
          group: null,
          order: 0,
          checkSuccessCount: 0,
          checkFailureCount: 0,
          lastCheckedAt: null,
          avgResponseTime: null,
          applyNote: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          publishedAt: null,
          checkHistory: [],
        });
        mockPrisma.friendLink.update.mockResolvedValue({
          id: 1,
          status: "REJECTED",
          updatedAt: new Date(),
        });
        const result = await reviewFriendLink({
          access_token: "token",
          id: 1,
          status: "REJECTED",
        });
        expect(result.success).toBe(true);
      });
    });
  });

  // ==================== createFriendLinkByAdmin ====================

  describe("createFriendLinkByAdmin", () => {
    describe("速率限制", () => {
      it("速率限制时应返回失败", async () => {
        mockLimitControl.mockResolvedValue(false);
        const result = await createFriendLinkByAdmin({
          access_token: "token",
          name: "Test",
          url: "https://test.com",
          avatar: "https://test.com/a.png",
          slogan: "Hello",
          friendLinkUrl: "https://test.com/friends",
          ignoreBacklink: false,
          status: "PUBLISHED",
        });
        expect(result.success).toBe(false);
      });
    });

    describe("认证", () => {
      it("非管理员应返回未授权", async () => {
        mockAuthVerify.mockResolvedValue(null);
        const result = await createFriendLinkByAdmin({
          access_token: "token",
          name: "Test",
          url: "https://test.com",
          avatar: "https://test.com/a.png",
          slogan: "Hello",
          friendLinkUrl: "https://test.com/friends",
          ignoreBacklink: false,
          status: "PUBLISHED",
        });
        expect(result.success).toBe(false);
      });
    });

    describe("业务逻辑", () => {
      it("成功创建友链", async () => {
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
        mockPrisma.friendLink.create.mockResolvedValue({
          id: 1,
          name: "Test",
          url: "https://test.com",
          avatar: "https://test.com/a.png",
          slogan: "Hello",
          friendLinkUrl: "https://test.com/friends",
          ignoreBacklink: false,
          group: null,
          order: 0,
          status: "PUBLISHED",
          checkSuccessCount: 0,
          checkFailureCount: 0,
          lastCheckedAt: null,
          avgResponseTime: null,
          applyNote: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          publishedAt: new Date(),
          checkHistory: [],
          owner: null,
          auditor: { uid: 1, username: "admin", nickname: null },
        });
        const result = await createFriendLinkByAdmin({
          access_token: "token",
          name: "Test",
          url: "https://test.com",
          avatar: "https://test.com/a.png",
          slogan: "Hello",
          friendLinkUrl: "https://test.com/friends",
          ignoreBacklink: false,
          status: "PUBLISHED",
        });
        expect(result.success).toBe(true);
      });
    });
  });

  // ==================== deleteFriendLinkByAdmin ====================

  describe("deleteFriendLinkByAdmin", () => {
    describe("速率限制", () => {
      it("速率限制时应返回失败", async () => {
        mockLimitControl.mockResolvedValue(false);
        const result = await deleteFriendLinkByAdmin({
          access_token: "token",
          id: 1,
        });
        expect(result.success).toBe(false);
      });
    });

    describe("认证", () => {
      it("非管理员应返回未授权", async () => {
        mockAuthVerify.mockResolvedValue(null);
        const result = await deleteFriendLinkByAdmin({
          access_token: "token",
          id: 1,
        });
        expect(result.success).toBe(false);
      });
    });

    describe("业务逻辑", () => {
      it("友链不存在时应返回 404", async () => {
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
        mockPrisma.friendLink.findUnique.mockResolvedValue(null);
        const result = await deleteFriendLinkByAdmin({
          access_token: "token",
          id: 999,
        });
        expect(result.success).toBe(false);
      });

      it("成功删除友链", async () => {
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
        mockPrisma.friendLink.findUnique.mockResolvedValue({
          id: 1,
          name: "Test",
          ownerUid: 2,
          status: "PUBLISHED",
        });
        mockPrisma.friendLink.update.mockResolvedValue({});
        const result = await deleteFriendLinkByAdmin({
          access_token: "token",
          id: 1,
        });
        expect(result.success).toBe(true);
      });
    });
  });

  // ==================== getFriendLinksList ====================

  describe("getFriendLinksList", () => {
    describe("速率限制", () => {
      it("速率限制时应返回失败", async () => {
        mockLimitControl.mockResolvedValue(false);
        const result = await getFriendLinksList({
          access_token: "token",
          page: 1,
          pageSize: 25,
          sortBy: "createdAt",
          sortOrder: "desc",
        });
        expect(result.success).toBe(false);
      });
    });

    describe("认证", () => {
      it("非管理员应返回未授权", async () => {
        mockAuthVerify.mockResolvedValue(null);
        const result = await getFriendLinksList({
          access_token: "token",
          page: 1,
          pageSize: 25,
          sortBy: "createdAt",
          sortOrder: "desc",
        });
        expect(result.success).toBe(false);
      });
    });

    describe("返回数据", () => {
      it("成功获取友链列表", async () => {
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
        mockPrisma.friendLink.count.mockResolvedValue(1);
        mockPrisma.friendLink.findMany.mockResolvedValue([
          {
            id: 1,
            name: "Test",
            url: "https://test.com",
            avatar: "https://test.com/a.png",
            slogan: "Hello",
            friendLinkUrl: "https://test.com/friends",
            ignoreBacklink: false,
            group: null,
            order: 0,
            status: "PUBLISHED",
            checkSuccessCount: 10,
            checkFailureCount: 0,
            lastCheckedAt: null,
            avgResponseTime: null,
            applyNote: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            publishedAt: new Date(),
            checkHistory: [],
            owner: null,
            auditor: null,
          },
        ]);
        const result = await getFriendLinksList({
          access_token: "token",
          page: 1,
          pageSize: 25,
          sortBy: "updatedAt",
          sortOrder: "desc",
        });
        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(1);
      });

      it("空列表应正常返回", async () => {
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
        mockPrisma.friendLink.count.mockResolvedValue(0);
        mockPrisma.friendLink.findMany.mockResolvedValue([]);
        const result = await getFriendLinksList({
          access_token: "token",
          page: 1,
          pageSize: 25,
          sortBy: "createdAt",
          sortOrder: "desc",
        });
        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(0);
      });
    });
  });

  // ==================== getFriendLinksStats ====================

  describe("getFriendLinksStats", () => {
    describe("速率限制", () => {
      it("速率限制时应返回失败", async () => {
        mockLimitControl.mockResolvedValue(false);
        const result = await getFriendLinksStats({
          access_token: "token",
          force: false,
        });
        expect(result.success).toBe(false);
      });
    });

    describe("认证", () => {
      it("非管理员应返回未授权", async () => {
        mockAuthVerify.mockResolvedValue(null);
        const result = await getFriendLinksStats({
          access_token: "token",
          force: false,
        });
        expect(result.success).toBe(false);
      });
    });

    describe("返回数据", () => {
      it("成功获取友链统计", async () => {
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
        mockPrisma.friendLink.count
          .mockResolvedValueOnce(20) // total
          .mockResolvedValueOnce(3) // pending
          .mockResolvedValueOnce(10) // published
          .mockResolvedValueOnce(2) // whitelist
          .mockResolvedValueOnce(1) // rejected
          .mockResolvedValueOnce(0) // blocked
          .mockResolvedValueOnce(2) // disconnect
          .mockResolvedValueOnce(1) // noBacklink
          .mockResolvedValueOnce(5) // withOwner
          .mockResolvedValueOnce(3); // problematic
        const result = await getFriendLinksStats({
          access_token: "token",
          force: false,
        });
        expect(result.success).toBe(true);
        expect(result.data!.total).toBe(20);
        expect(result.data!.published).toBe(10);
      });
    });
  });

  // ==================== getFriendLinksTrends ====================

  describe("getFriendLinksTrends", () => {
    describe("速率限制", () => {
      it("速率限制时应返回失败", async () => {
        mockLimitControl.mockResolvedValue(false);
        const result = await getFriendLinksTrends({
          access_token: "token",
          days: 30,
          count: 30,
        });
        expect(result.success).toBe(false);
      });
    });

    describe("认证", () => {
      it("非管理员应返回未授权", async () => {
        mockAuthVerify.mockResolvedValue(null);
        const result = await getFriendLinksTrends({
          access_token: "token",
          days: 30,
          count: 30,
        });
        expect(result.success).toBe(false);
      });
    });

    describe("返回数据", () => {
      it("成功获取友链趋势", async () => {
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
        mockPrisma.friendLink.findMany.mockResolvedValue([]);
        const result = await getFriendLinksTrends({
          access_token: "token",
          days: 30,
          count: 30,
        });
        expect(result.success).toBe(true);
      });
    });
  });

  // ==================== 补充分支覆盖测试 ====================

  describe("updateFriendLinkByAdmin", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await updateFriendLinkByAdmin({
        access_token: "token",
        id: 1,
        name: "Updated",
        url: "https://test.com",
        ignoreBacklink: false,
        order: 0,
        status: "PUBLISHED",
      });
      expect(result.success).toBe(false);
    });

    it("非管理员应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);
      const result = await updateFriendLinkByAdmin({
        access_token: "token",
        id: 1,
        name: "Updated",
        url: "https://test.com",
        ignoreBacklink: false,
        order: 0,
        status: "PUBLISHED",
      });
      expect(result.success).toBe(false);
    });

    it("友链不存在时应返回 404", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.friendLink.findUnique.mockResolvedValue(null);
      const result = await updateFriendLinkByAdmin({
        access_token: "token",
        id: 999,
        name: "Updated",
        url: "https://test.com",
        ignoreBacklink: false,
        order: 0,
        status: "PUBLISHED",
      });
      expect(result.success).toBe(false);
    });

    it("成功更新友链", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.friendLink.findUnique.mockResolvedValue({
        id: 1,
        name: "Old Name",
        url: "https://test.com",
        avatar: "https://test.com/a.png",
        slogan: "Hello",
        friendLinkUrl: "https://test.com/friends",
        ignoreBacklink: false,
        group: null,
        order: 0,
        status: "PUBLISHED",
        checkSuccessCount: 0,
        checkFailureCount: 0,
        lastCheckedAt: null,
        avgResponseTime: null,
        applyNote: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        publishedAt: new Date(),
        checkHistory: [],
      });
      mockPrisma.friendLink.update.mockResolvedValue({
        id: 1,
        name: "Updated",
        url: "https://test.com",
        status: "PUBLISHED",
        updatedAt: new Date(),
        publishedAt: new Date(),
      });
      const result = await updateFriendLinkByAdmin({
        access_token: "token",
        id: 1,
        name: "Updated",
        url: "https://test.com",
        status: "PUBLISHED",
        ignoreBacklink: false,
        order: 0,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("parseFriendLinkByAdmin", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await parseFriendLinkByAdmin({
        access_token: "token",
        url: "https://example.com/friends",
      });
      expect(result.success).toBe(false);
    });

    it("非管理员应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);
      const result = await parseFriendLinkByAdmin({
        access_token: "token",
        url: "https://example.com/friends",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("checkFriendLinks", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await checkFriendLinks({
        access_token: "token",
        checkAll: false,
      });
      expect(result.success).toBe(false);
    });

    it("非管理员应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);
      const result = await checkFriendLinks({
        access_token: "token",
        checkAll: false,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("submitFriendLinkApplication 补充测试", () => {
    it("验证码失败时返回失败", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "USER" });
      mockVerifyCaptchaToken.mockResolvedValue({ success: false });
      const result = await submitFriendLinkApplication({
        name: "Test",
        url: "https://test.com",
        avatar: "https://test.com/a.png",
        slogan: "Hello",
        friendLinkUrl: "https://test.com/friends",
        captcha_token: "invalid-token",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("getOwnFriendLink 补充测试", () => {
    it("数据库错误时返回失败", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "USER" });
      mockPrisma.friendLink.findUnique.mockRejectedValue(new Error("DB error"));
      const result = await getOwnFriendLink({ access_token: "token" });
      expect(result.success).toBe(false);
    });
  });

  describe("getFriendLinksList 补充测试", () => {
    it("数据库错误时返回失败", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.friendLink.count.mockRejectedValue(new Error("DB error"));
      const result = await getFriendLinksList({
        access_token: "token",
        page: 1,
        pageSize: 25,
        sortBy: "createdAt",
        sortOrder: "desc",
      });
      expect(result.success).toBe(false);
    });
  });

  // ===== getFriendLinksList 分支覆盖 =====

  describe("getFriendLinksList 过滤分支", () => {
    it("带 search 关键字过滤", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.friendLink.count.mockResolvedValue(0);
      mockPrisma.friendLink.findMany.mockResolvedValue([]);

      const result = await getFriendLinksList({
        access_token: "token",
        page: 1,
        pageSize: 25,
        sortBy: "createdAt",
        sortOrder: "desc",
        search: "test",
      });

      expect(result.success).toBe(true);
    });

    it("带 status 数组过滤", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.friendLink.count.mockResolvedValue(1);
      mockPrisma.friendLink.findMany.mockResolvedValue([]);

      const result = await getFriendLinksList({
        access_token: "token",
        page: 1,
        pageSize: 25,
        sortBy: "createdAt",
        sortOrder: "desc",
        status: ["PUBLISHED", "PENDING"],
      });

      expect(result.success).toBe(true);
    });

    it("带 ownerUid 过滤", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.friendLink.count.mockResolvedValue(0);
      mockPrisma.friendLink.findMany.mockResolvedValue([]);

      const result = await getFriendLinksList({
        access_token: "token",
        page: 1,
        pageSize: 25,
        sortBy: "createdAt",
        sortOrder: "desc",
        ownerUid: 5,
      });

      expect(result.success).toBe(true);
    });

    it("带 ignoreBacklink 过滤", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.friendLink.count.mockResolvedValue(0);
      mockPrisma.friendLink.findMany.mockResolvedValue([]);

      const result = await getFriendLinksList({
        access_token: "token",
        page: 1,
        pageSize: 25,
        sortBy: "createdAt",
        sortOrder: "desc",
        ignoreBacklink: true,
      });

      expect(result.success).toBe(true);
    });

    it("带 hasIssue=true 过滤", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.friendLink.count.mockResolvedValue(0);
      mockPrisma.friendLink.findMany.mockResolvedValue([]);

      const result = await getFriendLinksList({
        access_token: "token",
        page: 1,
        pageSize: 25,
        sortBy: "createdAt",
        sortOrder: "desc",
        hasIssue: true,
      });

      expect(result.success).toBe(true);
    });

    it("带 hasIssue=false 过滤", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.friendLink.count.mockResolvedValue(0);
      mockPrisma.friendLink.findMany.mockResolvedValue([]);

      const result = await getFriendLinksList({
        access_token: "token",
        page: 1,
        pageSize: 25,
        sortBy: "createdAt",
        sortOrder: "desc",
        hasIssue: false,
      });

      expect(result.success).toBe(true);
    });

    it("带 createdAt 日期范围过滤", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.friendLink.count.mockResolvedValue(0);
      mockPrisma.friendLink.findMany.mockResolvedValue([]);

      const result = await getFriendLinksList({
        access_token: "token",
        page: 1,
        pageSize: 25,
        sortBy: "createdAt",
        sortOrder: "desc",
        createdAtStart: "2025-01-01",
        createdAtEnd: "2025-12-31",
      });

      expect(result.success).toBe(true);
    });

    it("带 updatedAt 日期范围过滤", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.friendLink.count.mockResolvedValue(0);
      mockPrisma.friendLink.findMany.mockResolvedValue([]);

      const result = await getFriendLinksList({
        access_token: "token",
        page: 1,
        pageSize: 25,
        sortBy: "createdAt",
        sortOrder: "desc",
        updatedAtStart: "2025-01-01",
        updatedAtEnd: "2025-12-31",
      });

      expect(result.success).toBe(true);
    });

    it("带 publishedAt 日期范围过滤", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.friendLink.count.mockResolvedValue(0);
      mockPrisma.friendLink.findMany.mockResolvedValue([]);

      const result = await getFriendLinksList({
        access_token: "token",
        page: 1,
        pageSize: 25,
        sortBy: "createdAt",
        sortOrder: "desc",
        publishedAtStart: "2025-01-01",
        publishedAtEnd: "2025-12-31",
      });

      expect(result.success).toBe(true);
    });

    it("自定义 sortBy 和 sortOrder", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.friendLink.count.mockResolvedValue(0);
      mockPrisma.friendLink.findMany.mockResolvedValue([]);

      const result = await getFriendLinksList({
        access_token: "token",
        page: 1,
        pageSize: 25,
        sortBy: "name",
        sortOrder: "asc",
      });

      expect(result.success).toBe(true);
    });
  });

  describe("createFriendLinkByAdmin 分支", () => {
    it("WHITELIST 状态设置 publishedAt", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.friendLink.create.mockResolvedValue({
        id: 1,
        name: "Test",
        url: "https://test.com",
        avatar: "https://test.com/a.png",
        slogan: "Hello",
        friendLinkUrl: "https://test.com/friends",
        status: "WHITELIST",
        publishedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        checkFailureCount: 0,
        ignoreBacklink: false,
        ownerUid: 1,
      });

      const result = await createFriendLinkByAdmin({
        access_token: "token",
        name: "Test",
        url: "https://test.com",
        avatar: "https://test.com/a.png",
        slogan: "Hello",
        status: "WHITELIST",
        ignoreBacklink: false,
      });

      expect(result.success).toBe(true);
    });

    it("PUBLISHED 状态设置 publishedAt", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.friendLink.create.mockResolvedValue({
        id: 2,
        name: "Test2",
        url: "https://test2.com",
        avatar: "https://test2.com/a.png",
        slogan: "Hello2",
        friendLinkUrl: "https://test2.com/friends",
        status: "PUBLISHED",
        publishedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        checkFailureCount: 0,
        ignoreBacklink: false,
        ownerUid: 1,
      });

      const result = await createFriendLinkByAdmin({
        access_token: "token",
        name: "Test2",
        url: "https://test2.com",
        avatar: "https://test2.com/a.png",
        slogan: "Hello2",
        status: "PUBLISHED",
        ignoreBacklink: false,
      });

      expect(result.success).toBe(true);
    });

    it("数据库错误时返回失败", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.friendLink.create.mockRejectedValue(new Error("DB error"));

      const result = await createFriendLinkByAdmin({
        access_token: "token",
        name: "Test",
        url: "https://test.com",
        avatar: "https://test.com/a.png",
        slogan: "Hello",
        ignoreBacklink: false,
        status: "PUBLISHED",
      });

      expect(result.success).toBe(false);
    });
  });

  describe("checkFriendLinks 分支", () => {
    it("checkAll=false 且无 ids 返回失败", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });

      const result = await checkFriendLinks({
        access_token: "token",
        checkAll: false,
        ids: [],
      });

      expect(result).toEqual(expect.objectContaining({ success: false }));
    });

    it("checkAll=true 成功执行检查", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      const { runFriendLinksCheck } = await import(
        "@/lib/server/cron-task-runner"
      );
      vi.mocked(runFriendLinksCheck).mockResolvedValue({
        checked: 5,
        fixed: 1,
        errors: 0,
      } as any);

      const result = await checkFriendLinks({
        access_token: "token",
        checkAll: true,
      });

      expect(result.success).toBe(true);
    });

    it("数据库错误时返回失败", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      const { runFriendLinksCheck } = await import(
        "@/lib/server/cron-task-runner"
      );
      vi.mocked(runFriendLinksCheck).mockRejectedValue(new Error("DB error"));

      const result = await checkFriendLinks({
        access_token: "token",
        checkAll: true,
      });

      expect(result.success).toBe(false);
    });
  });

  describe("updateOwnFriendLink 分支", () => {
    it("WHITELIST 状态允许更新", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "USER" });
      mockPrisma.friendLink.findUnique.mockResolvedValue({
        id: 1,
        ownerUid: 1,
        status: "WHITELIST",
        name: "Old",
        url: "https://old.com",
        avatar: "https://old.com/a.png",
        slogan: "Old slogan",
        friendLinkUrl: "https://old.com/friends",
      });
      mockPrisma.friendLink.update.mockResolvedValue({
        id: 1,
        name: "Updated",
        status: "WHITELIST",
        updatedAt: new Date(),
      });

      const result = await updateOwnFriendLink({
        access_token: "token",
        name: "Updated",
        url: "https://updated.com",
        avatar: "https://updated.com/a.png",
        slogan: "Updated slogan",
        friendLinkUrl: "https://updated.com/friends",
      });

      expect(result.success).toBe(true);
    });

    it("数据库错误时返回失败", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "USER" });
      mockPrisma.friendLink.findUnique.mockRejectedValue(new Error("DB error"));

      const result = await updateOwnFriendLink({
        access_token: "token",
        name: "Updated",
        url: "https://updated.com",
        avatar: "https://updated.com/a.png",
        slogan: "Updated slogan",
        friendLinkUrl: "https://updated.com/friends",
      });

      expect(result.success).toBe(false);
    });
  });
});
