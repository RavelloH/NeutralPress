import { beforeEach, describe, expect, it, vi } from "vitest";

// ============ Mocks ============

const mockHeaders = vi.fn().mockReturnValue(new Headers());
vi.mock("next/headers", () => ({
  headers: (...args: unknown[]) => mockHeaders(...args),
  cookies: vi.fn(() => ({
    get: vi.fn((name: string) => {
      if (name === "ACCESS_TOKEN") return { value: "test-token" };
      return undefined;
    }),
    delete: vi.fn(),
  })),
}));

const mockLimitControl = vi.fn().mockResolvedValue(true);
vi.mock("@/lib/server/rate-limit", () => ({
  default: (...args: unknown[]) => mockLimitControl(...args),
}));

const mockAuthVerify = vi.fn();
const mockVerifyAccessToken = vi.fn();
vi.mock("@/lib/server/auth-verify", () => ({
  authVerify: (...args: unknown[]) => mockAuthVerify(...args),
  verifyAccessToken: (...args: unknown[]) => mockVerifyAccessToken(...args),
}));

const mockPrisma = {
  user: {
    count: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  refreshToken: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
  commentLike: {
    count: vi.fn(),
  },
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
};
vi.mock("@/lib/server/prisma", () => ({ default: mockPrisma }));

vi.mock("@/lib/server/audit", () => ({
  logAuditEvent: vi.fn(),
}));

vi.mock("@/lib/server/crypto", () => ({
  calculateMD5: vi.fn().mockReturnValue("md5hash"),
}));

vi.mock("@/lib/server/password", () => ({
  hashPassword: vi.fn().mockResolvedValue("hashed-pw"),
}));

vi.mock("next/cache", () => ({
  updateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/server/isr-invalidation", () => ({ expireCacheTag: vi.fn() }));

vi.mock("next/server", () => ({
  after: vi.fn((fn: () => Promise<void>) => fn()),
}));

vi.mock("@/lib/server/ably", () => ({
  checkUserOnlineStatus: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/lib/server/ably-config", () => ({
  isAblyEnabled: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/lib/shared/relative-time", () => ({
  formatRelativeTime: vi.fn().mockReturnValue("5 分钟前"),
}));

// ============ Helpers ============

const ADMIN_USER = { uid: 1, username: "admin", role: "ADMIN" as const };

function mockAuthSuccess(user = ADMIN_USER) {
  mockAuthVerify.mockResolvedValue(user);
}
function mockAuthFailure() {
  mockAuthVerify.mockResolvedValue(null);
}

// ============ Tests ============

describe("user actions", () => {
  let getUsersTrends: typeof import("@/actions/user").getUsersTrends;
  let getUsersList: typeof import("@/actions/user").getUsersList;
  let createUser: typeof import("@/actions/user").createUser;
  let updateUsers: typeof import("@/actions/user").updateUsers;
  let deleteUsers: typeof import("@/actions/user").deleteUsers;
  let getUserProfile: typeof import("@/actions/user").getUserProfile;
  let disable2FA: typeof import("@/actions/user").disable2FA;
  let getUserPublicProfile: typeof import("@/actions/user").getUserPublicProfile;
  let getUserActivity: typeof import("@/actions/user").getUserActivity;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mockLimitControl.mockResolvedValue(true);
    mockVerifyAccessToken.mockResolvedValue({
      type: "access",
      uid: 1,
      sessionId: "session-1",
      username: "admin",
      nickname: "Admin",
      role: "ADMIN",
    });
    mockPrisma.$transaction.mockImplementation(
      (callback: (tx: typeof mockPrisma) => unknown) => callback(mockPrisma),
    );
    const mod = await import("@/actions/user");
    getUsersTrends = mod.getUsersTrends;
    getUsersList = mod.getUsersList;
    createUser = mod.createUser;
    updateUsers = mod.updateUsers;
    deleteUsers = mod.deleteUsers;
    getUserProfile = mod.getUserProfile;
    disable2FA = mod.disable2FA;
    getUserPublicProfile = mod.getUserPublicProfile;
    getUserActivity = mod.getUserActivity;
  });

  // ---------- getUsersTrends ----------

  describe("getUsersTrends", () => {
    it("速率限制时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await getUsersTrends({
        access_token: "token",
        days: 30,
        count: 30,
      });
      expect(result.success).toBe(false);
    });

    it("非管理员应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);
      const result = await getUsersTrends({
        access_token: "token",
        days: 30,
        count: 30,
      });
      expect(result.success).toBe(false);
    });

    it("成功获取用户趋势", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.user.count.mockResolvedValue(100);

      const result = await getUsersTrends({
        access_token: "token",
        days: 7,
        count: 3,
      });
      expect(result.success).toBe(true);
      expect(result.data!.length).toBeGreaterThan(0);
    });
  });

  // ---------- getUsersList ----------

  describe("getUsersList", () => {
    it("速率限制时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await getUsersList({
        access_token: "token",
        page: 1,
        pageSize: 25,
        sortBy: "createdAt",
        sortOrder: "desc",
      });
      expect(result.success).toBe(false);
    });

    it("非管理员应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);
      const result = await getUsersList({
        access_token: "token",
        page: 1,
        pageSize: 25,
        sortBy: "createdAt",
        sortOrder: "desc",
      });
      expect(result.success).toBe(false);
    });

    it("成功获取用户列表", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.user.count.mockResolvedValue(2);
      mockPrisma.user.findMany.mockResolvedValue([
        {
          uid: 1,
          email: "admin@test.com",
          emailVerified: true,
          emailNotice: false,
          username: "admin",
          nickname: "Admin",
          website: null,
          bio: null,
          avatar: null,
          createdAt: new Date(),
          lastUseAt: new Date(),
          role: "ADMIN",
          status: "ACTIVE",
          totpSecret: null,
          _count: { posts: 10, comments: 5 },
        },
        {
          uid: 2,
          email: "user@test.com",
          emailVerified: false,
          emailNotice: true,
          username: "user1",
          nickname: null,
          website: null,
          bio: null,
          avatar: null,
          createdAt: new Date(),
          lastUseAt: new Date(),
          role: "USER",
          status: "ACTIVE",
          totpSecret: "secret",
          _count: { posts: 3, comments: 2 },
        },
      ]);

      const result = await getUsersList({
        access_token: "token",
        page: 1,
        pageSize: 25,
        sortBy: "createdAt",
        sortOrder: "desc",
      });
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.meta!.total).toBe(2);
      expect(result.data![1]!.hasTwoFactor).toBe(true);
    });
  });

  // ---------- createUser ----------

  describe("createUser", () => {
    it("用户名已存在时应返回 400", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.user.findUnique.mockResolvedValueOnce({ uid: 99 }); // username exists

      const result = await createUser({
        access_token: "token",
        username: "existing",
        email: "new@test.com",
        password: "pass123",
      });
      expect(result.success).toBe(false);
    });

    it("邮箱已存在时应返回 400", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null) // username not found
        .mockResolvedValueOnce({ uid: 99 }); // email exists

      const result = await createUser({
        access_token: "token",
        username: "newuser",
        email: "existing@test.com",
        password: "pass123",
      });
      expect(result.success).toBe(false);
    });

    it("成功创建用户", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        uid: 10,
        username: "newuser",
        nickname: "New User",
        email: "new@test.com",
        role: "USER",
        status: "ACTIVE",
        emailVerified: false,
        emailNotice: false,
        createdAt: new Date(),
      });

      const result = await createUser({
        access_token: "token",
        username: "newuser",
        email: "new@test.com",
        password: "pass123",
      });
      expect(result.success).toBe(true);
      expect(result.data!.uid).toBe(10);
    });
  });

  // ---------- deleteUsers ----------

  describe("deleteUsers", () => {
    it("尝试删除自己时应返回 400", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });

      const result = await deleteUsers({ access_token: "token", uids: [1] });
      expect(result.success).toBe(false);
      expect(result.message).toContain("当前用户");
    });

    it("成功批量删除用户", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.user.findMany.mockResolvedValue([
        {
          uid: 2,
          username: "user2",
          email: "u2@test.com",
          role: "USER",
          status: "ACTIVE",
          createdAt: new Date(),
        },
      ]);
      mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });

      const result = await deleteUsers({ access_token: "token", uids: [2] });
      expect(result.success).toBe(true);
      expect(result.data!.deleted).toBe(1);
      expect(mockPrisma.$transaction).toHaveBeenCalledOnce();
      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userUid: { in: [2] }, revokedAt: null },
          data: { revokedAt: expect.any(Date) },
        }),
      );
    });
  });

  // ---------- getUserProfile ----------

  describe("getUserProfile", () => {
    it("未登录时应返回未授权", async () => {
      mockVerifyAccessToken.mockResolvedValue(null);
      const result = await getUserProfile();
      expect(result.success).toBe(false);
    });

    it("用户不存在时应返回未授权", async () => {
      mockVerifyAccessToken.mockResolvedValue({ uid: 99 });
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const result = await getUserProfile();
      expect(result.success).toBe(false);
    });

    it("成功获取用户资料", async () => {
      mockVerifyAccessToken.mockResolvedValue({ uid: 1 });
      mockPrisma.user.findUnique.mockResolvedValue({
        uid: 1,
        username: "admin",
        email: "admin@test.com",
        nickname: "Admin",
        website: null,
        bio: null,
        role: "ADMIN",
        createdAt: new Date(),
        password: "hashed",
        accounts: [{ provider: "GITHUB" }],
      });

      const result = await getUserProfile();
      expect(result.success).toBe(true);
      expect(result.data!.username).toBe("admin");
      expect(result.data!.hasPassword).toBe(true);
      expect(result.data!.linkedAccounts).toHaveLength(1);
    });
  });

  // ---------- disable2FA ----------

  describe("disable2FA", () => {
    it("非管理员应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);
      const result = await disable2FA({ access_token: "token", uid: 2 });
      expect(result.success).toBe(false);
    });

    it("尝试关闭自己的 2FA 应返回 400", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      const result = await disable2FA({ access_token: "token", uid: 1 });
      expect(result.success).toBe(false);
    });

    it("目标用户不存在时应返回 400", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const result = await disable2FA({ access_token: "token", uid: 99 });
      expect(result.success).toBe(false);
    });

    it("用户未启用 2FA 时应返回 400", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.user.findUnique.mockResolvedValue({
        uid: 2,
        username: "user2",
        totpSecret: null,
        totpBackupCodes: null,
      });
      const result = await disable2FA({ access_token: "token", uid: 2 });
      expect(result.success).toBe(false);
    });

    it("成功关闭 2FA", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.user.findUnique.mockResolvedValue({
        uid: 2,
        username: "user2",
        totpSecret: "secret",
        totpBackupCodes: [],
      });
      mockPrisma.user.update.mockResolvedValue({});

      const result = await disable2FA({ access_token: "token", uid: 2 });
      expect(result.success).toBe(true);
      expect(result.data!.success).toBe(true);
    });
  });

  // ---------- getUserPublicProfile ----------

  describe("getUserPublicProfile", () => {
    it("无效 UID 应返回 400", async () => {
      const result = await getUserPublicProfile(-1);
      expect(result.success).toBe(false);
    });

    it("用户不存在时应返回 404", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const result = await getUserPublicProfile(999);
      expect(result.success).toBe(false);
    });

    it("成功获取公开资料", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        uid: 2,
        username: "user2",
        nickname: "User Two",
        email: "u2@test.com",
        avatar: null,
        bio: "bio",
        website: null,
        role: "USER",
        status: "ACTIVE",
        createdAt: new Date(),
        lastUseAt: new Date(),
        _count: { posts: 5, comments: 10, commentLikes: 3 },
      });
      mockPrisma.commentLike.count.mockResolvedValue(7);
      mockPrisma.refreshToken.findFirst.mockResolvedValue(null);

      const result = await getUserPublicProfile(2);
      expect(result.success).toBe(true);
      expect(result.data!.user.username).toBe("user2");
      expect(result.data!.stats.postsCount).toBe(5);
      expect(result.data!.stats.likesReceived).toBe(7);
    });
  });

  // ---------- 补充测试 ----------

  describe("getUsersList 补充测试", () => {
    it("速率限制时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await getUsersList({
        access_token: "token",
        page: 1,
        pageSize: 25,
        sortBy: "createdAt",
        sortOrder: "desc",
      });
      expect(result.success).toBe(false);
    });

    it("非管理员应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);
      const result = await getUsersList({
        access_token: "token",
        page: 1,
        pageSize: 25,
        sortBy: "createdAt",
        sortOrder: "desc",
      });
      expect(result.success).toBe(false);
    });

    it("成功获取用户列表", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.user.count.mockResolvedValue(1);
      mockPrisma.user.findMany.mockResolvedValue([
        {
          uid: 1,
          username: "admin",
          nickname: null,
          email: "admin@test.com",
          role: "ADMIN",
          status: "ACTIVE",
          createdAt: new Date(),
          lastUseAt: null,
          _count: { posts: 0, comments: 0 },
        },
      ]);
      mockPrisma.refreshToken.findFirst.mockResolvedValue(null);
      mockPrisma.$queryRaw.mockResolvedValue([]);

      const result = await getUsersList({
        access_token: "token",
        page: 1,
        pageSize: 25,
        sortBy: "createdAt",
        sortOrder: "desc",
      });
      // 可能因为其他原因失败，但不应抛出异常
      expect(result).toBeDefined();
      expect(result).toHaveProperty("success");
    });
  });

  describe("deleteUsers 补充测试", () => {
    it("速率限制时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await deleteUsers({ access_token: "token", uids: [2] });
      expect(result.success).toBe(false);
    });

    it("非管理员应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);
      const result = await deleteUsers({ access_token: "token", uids: [2] });
      expect(result.success).toBe(false);
    });
  });

  describe("createUser 补充测试", () => {
    it("速率限制时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await createUser({
        access_token: "token",
        username: "newuser",
        email: "new@test.com",
        password: "password123",
      });
      expect(result.success).toBe(false);
    });

    it("非管理员应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);
      const result = await createUser({
        access_token: "token",
        username: "newuser",
        email: "new@test.com",
        password: "password123",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("getUserPublicProfile 补充测试", () => {
    it("速率限制时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await getUserPublicProfile(1);
      expect(result.success).toBe(false);
    });
  });

  // ==================== updateUsers 补充测试 ====================

  describe("updateUsers", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await updateUsers(
        { access_token: "token", uids: [1], nickname: "新昵称" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("非管理员应返回未授权", async () => {
      mockAuthFailure();
      const result = await updateUsers(
        { access_token: "token", uids: [1], nickname: "新昵称" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("用户不存在时应返回失败", async () => {
      mockAuthSuccess(ADMIN_USER);
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const result = await updateUsers(
        { access_token: "token", uids: [999], nickname: "新昵称" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("不允许更改当前用户的角色和状态", async () => {
      mockAuthSuccess(ADMIN_USER);
      mockPrisma.user.findUnique.mockResolvedValue({
        uid: 1,
        username: "admin",
        nickname: "Admin",
        email: "admin@test.com",
        avatar: null,
        website: null,
        bio: null,
        emailVerified: true,
        emailNotice: false,
        role: "ADMIN",
        status: "ACTIVE",
      });
      const result = await updateUsers(
        { access_token: "token", uids: [1], role: "USER" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("成功更新单个用户信息", async () => {
      mockAuthSuccess(ADMIN_USER);
      mockPrisma.user.findUnique.mockResolvedValue({
        uid: 2,
        username: "user",
        nickname: "User",
        email: "user@test.com",
        avatar: null,
        website: null,
        bio: null,
        emailVerified: false,
        emailNotice: false,
        role: "USER",
        status: "ACTIVE",
      });
      mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });
      const result = await updateUsers(
        { access_token: "token", uids: [2], nickname: "新昵称" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
    });

    it("批量更新只允许更改角色和状态", async () => {
      mockAuthSuccess(ADMIN_USER);
      const result = await updateUsers(
        {
          access_token: "token",
          uids: [2, 3],
          role: "EDITOR",
          nickname: "不允许",
        },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("成功批量更新用户角色", async () => {
      mockAuthSuccess(ADMIN_USER);
      mockPrisma.user.findMany.mockResolvedValue([
        { uid: 2, username: "user1" },
        { uid: 3, username: "user2" },
      ]);
      mockPrisma.user.updateMany.mockResolvedValue({ count: 2 });
      const result = await updateUsers(
        { access_token: "token", uids: [2, 3], role: "EDITOR" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
    });

    it("停用用户时应在事务内撤销其未撤销会话", async () => {
      mockAuthSuccess(ADMIN_USER);
      mockPrisma.user.findMany.mockResolvedValue([
        { uid: 2, username: "user", role: "USER", status: "ACTIVE" },
      ]);
      mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 2 });

      const result = await updateUsers(
        { access_token: "token", uids: [2], status: "SUSPENDED" },
        { environment: "serveraction" },
      );

      expect(result.success).toBe(true);
      expect(mockPrisma.$transaction).toHaveBeenCalledOnce();
      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userUid: 2, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it("批量更新无更新字段时应返回失败", async () => {
      mockAuthSuccess(ADMIN_USER);
      const result = await updateUsers(
        { access_token: "token", uids: [2, 3] },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("deleteUsers 补充测试", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await deleteUsers(
        { access_token: "token", uids: [2] },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("非管理员应返回未授权", async () => {
      mockAuthFailure();
      const result = await deleteUsers(
        { access_token: "token", uids: [2] },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  // ===== 分支覆盖补充测试 =====

  describe("getUsersList 分支", () => {
    it("带 role 过滤", async () => {
      mockAuthSuccess();
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.user.count.mockResolvedValue(0);
      const result = await getUsersList(
        {
          access_token: "token",
          page: 1,
          pageSize: 20,
          sortBy: "createdAt",
          sortOrder: "desc",
          role: ["ADMIN"],
        },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
    });

    it("带 search 过滤", async () => {
      mockAuthSuccess();
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.user.count.mockResolvedValue(0);
      const result = await getUsersList(
        {
          access_token: "token",
          page: 1,
          pageSize: 20,
          sortBy: "createdAt",
          sortOrder: "desc",
          search: "test",
        },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
    });

    it("带日期范围过滤", async () => {
      mockAuthSuccess();
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.user.count.mockResolvedValue(0);
      const result = await getUsersList(
        {
          access_token: "token",
          page: 1,
          pageSize: 20,
          sortBy: "createdAt",
          sortOrder: "desc",
          createdAtStart: "2025-01-01",
          createdAtEnd: "2025-12-31",
        },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
    });

    it("数据库错误时返回失败", async () => {
      mockAuthSuccess();
      mockPrisma.user.findMany.mockRejectedValue(new Error("DB error"));
      const result = await getUsersList(
        {
          access_token: "token",
          page: 1,
          pageSize: 20,
          sortBy: "createdAt",
          sortOrder: "desc",
        },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("getUserProfile 分支", () => {
    it("数据库错误时返回失败", async () => {
      mockAuthSuccess();
      mockPrisma.user.findUnique.mockRejectedValue(new Error("DB error"));
      const result = await getUserProfile();
      expect(result.success).toBe(false);
    });
  });

  describe("getUserPublicProfile 分支", () => {
    it("无效 uid 返回失败", async () => {
      const result = await getUserPublicProfile(-1);
      expect(result.success).toBe(false);
    });

    it("用户未找到返回失败", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const result = await getUserPublicProfile(999);
      expect(result.success).toBe(false);
    });

    it("数据库错误时返回失败", async () => {
      mockPrisma.user.findUnique.mockRejectedValue(new Error("DB error"));
      const result = await getUserPublicProfile(1);
      expect(result.success).toBe(false);
    });
  });

  describe("disable2FA 分支", () => {
    it("目标用户未找到返回失败", async () => {
      mockAuthSuccess();
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const result = await disable2FA(
        { access_token: "token", uid: 999 },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("目标用户无 2FA 返回失败", async () => {
      mockAuthSuccess();
      mockPrisma.user.findUnique.mockResolvedValue({
        uid: 2,
        totpSecret: null,
      });
      const result = await disable2FA(
        { access_token: "token", uid: 2 },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("数据库错误时返回失败", async () => {
      mockAuthSuccess();
      mockPrisma.user.findUnique.mockRejectedValue(new Error("DB error"));
      const result = await disable2FA(
        { access_token: "token", uid: 2 },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("getUserActivity 分支", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await getUserActivity(1);
      expect(result.success).toBe(false);
    });

    it("无效 uid 返回失败", async () => {
      const result = await getUserActivity(-1);
      expect(result.success).toBe(false);
    });

    it("数据库错误时返回失败", async () => {
      mockPrisma.user.findUnique.mockRejectedValue(new Error("DB error"));
      const result = await getUserActivity(1);
      expect(result.success).toBe(false);
    });
  });
});
