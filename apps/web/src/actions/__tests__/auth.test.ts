import { beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================================
// Mocks
// ============================================================================

const mockCookiesGet = vi.fn();
const mockCookiesSet = vi.fn();
const mockCookiesDelete = vi.fn();
const mockHeadersGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: vi.fn(() => ({
    get: mockCookiesGet,
    set: mockCookiesSet,
    delete: mockCookiesDelete,
  })),
  headers: vi.fn(() => ({
    get: mockHeadersGet,
  })),
}));

vi.mock("next/server", () => ({
  after: vi.fn((fn: () => Promise<void>) => fn()),
  NextResponse: {
    json: vi.fn(),
  },
}));

const mockLimitControl = vi.fn();
vi.mock("@/lib/server/rate-limit", () => ({
  default: (...args: unknown[]) => mockLimitControl(...args),
}));

const mockVerifyToken = vi.fn();
vi.mock("@/lib/server/captcha", () => ({
  verifyToken: (...args: unknown[]) => mockVerifyToken(...args),
}));

const mockGetConfig = vi.fn();
const mockGetConfigs = vi.fn();
vi.mock("@/lib/server/config-cache", () => ({
  getConfig: (...args: unknown[]) => mockGetConfig(...args),
  getConfigs: (...args: unknown[]) => mockGetConfigs(...args),
}));

const mockPrismaUserFindFirst = vi.fn();
const mockPrismaUserFindUnique = vi.fn();
const mockPrismaUserCreate = vi.fn();
const mockPrismaUserUpdate = vi.fn();
const mockPrismaRefreshTokenCreate = vi.fn();
const mockPrismaRefreshTokenFindUnique = vi.fn();
const mockPrismaRefreshTokenFindMany = vi.fn();
const mockPrismaRefreshTokenUpdate = vi.fn();
const mockPrismaRefreshTokenDelete = vi.fn();
const mockPrismaRefreshTokenDeleteMany = vi.fn();
const mockPrismaPasswordResetFindFirst = vi.fn();
const mockPrismaPasswordResetFindUnique = vi.fn();
const mockPrismaPasswordResetCreate = vi.fn();
const mockPrismaPasswordResetDeleteMany = vi.fn();
vi.mock("@/lib/server/prisma", () => ({
  default: {
    user: {
      findFirst: (...args: unknown[]) => mockPrismaUserFindFirst(...args),
      findUnique: (...args: unknown[]) => mockPrismaUserFindUnique(...args),
      create: (...args: unknown[]) => mockPrismaUserCreate(...args),
      update: (...args: unknown[]) => mockPrismaUserUpdate(...args),
    },
    refreshToken: {
      create: (...args: unknown[]) => mockPrismaRefreshTokenCreate(...args),
      findUnique: (...args: unknown[]) =>
        mockPrismaRefreshTokenFindUnique(...args),
      findMany: (...args: unknown[]) => mockPrismaRefreshTokenFindMany(...args),
      update: (...args: unknown[]) => mockPrismaRefreshTokenUpdate(...args),
      delete: (...args: unknown[]) => mockPrismaRefreshTokenDelete(...args),
      deleteMany: (...args: unknown[]) =>
        mockPrismaRefreshTokenDeleteMany(...args),
    },
    passwordReset: {
      findFirst: (...args: unknown[]) =>
        mockPrismaPasswordResetFindFirst(...args),
      findUnique: (...args: unknown[]) =>
        mockPrismaPasswordResetFindUnique(...args),
      create: (...args: unknown[]) => mockPrismaPasswordResetCreate(...args),
      deleteMany: (...args: unknown[]) =>
        mockPrismaPasswordResetDeleteMany(...args),
    },
  },
}));

const mockVerifyAccessToken = vi.fn();
const mockVerifySession = vi.fn();
vi.mock("@/lib/server/auth-verify", () => ({
  verifyAccessToken: (...args: unknown[]) => mockVerifyAccessToken(...args),
  verifySession: (...args: unknown[]) => mockVerifySession(...args),
}));

const mockJwtTokenSign = vi.fn();
const mockJwtTokenVerify = vi.fn();
vi.mock("@/lib/server/jwt", () => ({
  jwtTokenSign: (...args: unknown[]) => mockJwtTokenSign(...args),
  jwtTokenVerify: (...args: unknown[]) => mockJwtTokenVerify(...args),
}));

const mockVerifyPassword = vi.fn();
const mockHashPassword = vi.fn();
vi.mock("@/lib/server/password", () => ({
  verifyPassword: (...args: unknown[]) => mockVerifyPassword(...args),
  hashPassword: (...args: unknown[]) => mockHashPassword(...args),
}));

vi.mock("@/lib/server/email", () => ({
  default: {
    generate: vi.fn(() => "123456-789"),
    verify: vi.fn(),
    sendEmail: vi.fn(),
  },
}));

const mockGetClientIP = vi.fn();
const mockGetClientUserAgent = vi.fn();
vi.mock("@/lib/server/get-client-info", () => ({
  getClientIP: (...args: unknown[]) => mockGetClientIP(...args),
  getClientUserAgent: (...args: unknown[]) => mockGetClientUserAgent(...args),
}));

vi.mock("@/lib/server/audit", () => ({
  logAuditEvent: vi.fn(),
}));

const mockResetTotpFailCount = vi.fn();
vi.mock("@/lib/server/totp", () => ({
  resetTotpFailCount: (...args: unknown[]) => mockResetTotpFailCount(...args),
}));

const mockCheckReauthToken = vi.fn();
vi.mock("@/actions/reauth", () => ({
  checkReauthToken: (...args: unknown[]) => mockCheckReauthToken(...args),
}));

// ============================================================================
// 测试
// ============================================================================

describe("auth actions", () => {
  let authModule: typeof import("@/actions/auth");

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // 默认设置
    mockLimitControl.mockResolvedValue(true);
    mockVerifyToken.mockResolvedValue({ success: true });
    mockGetConfig.mockResolvedValue(true);
    mockGetConfigs.mockResolvedValue(["TestSite", "http://localhost:3000"]);
    mockGetClientIP.mockResolvedValue("127.0.0.1");
    mockGetClientUserAgent.mockResolvedValue("Mozilla/5.0 Test");
    mockHashPassword.mockResolvedValue("hashed-password");
    mockJwtTokenSign.mockReturnValue("signed-token");
    mockCheckReauthToken.mockResolvedValue(true);
    mockVerifyAccessToken.mockResolvedValue({
      type: "access",
      uid: 1,
      sessionId: "session-1",
      username: "testuser",
      nickname: "testuser",
      role: "USER",
      iat: 1,
      exp: 9999,
    });
    mockVerifySession.mockImplementation(
      async (_sessionId: string, uid: number) => ({
        uid,
        username: "testuser",
        nickname: "testuser",
        role: "USER",
      }),
    );

    // cookie mock: 默认返回空
    mockCookiesGet.mockReturnValue(undefined);
    mockHeadersGet.mockReturnValue(null);

    authModule = await import("@/actions/auth");
  });

  // ==========================================================================
  // login
  // ==========================================================================

  describe("login", () => {
    const validLoginParams = {
      username: "testuser",
      password: "Test1234",
      token_transport: "cookie" as const,
      captcha_token: "valid-captcha",
    };

    it("速率限制触发时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);

      const result = await authModule.login(validLoginParams);

      expect(result.success).toBe(false);
      expect(result.message).toContain("频繁");
    });

    it("验证码验证失败时应返回错误", async () => {
      mockVerifyToken.mockResolvedValue({ success: false });

      const result = await authModule.login(validLoginParams);

      expect(result.success).toBe(false);
    });

    it("用户不存在时应返回无效凭据错误", async () => {
      mockPrismaUserFindFirst.mockResolvedValue(null);

      const result = await authModule.login(validLoginParams);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("INVALID_CREDENTIALS");
    });

    it("用户被禁用时应返回禁止访问", async () => {
      mockPrismaUserFindFirst.mockResolvedValue({
        uid: 1,
        username: "testuser",
        password: "hashed",
        accounts: [],
        nickname: "Test",
        role: "USER",
        avatar: null,
        email: "test@test.com",
        emailVerified: true,
        deletedAt: new Date(),
        status: "ACTIVE",
        totpSecret: null,
      });

      const result = await authModule.login(validLoginParams);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("ACCOUNT_DISABLED");
    });

    it("用户状态为 SUSPENDED 时应返回禁止访问", async () => {
      mockPrismaUserFindFirst.mockResolvedValue({
        uid: 1,
        username: "testuser",
        password: "hashed",
        accounts: [],
        nickname: "Test",
        role: "USER",
        avatar: null,
        email: "test@test.com",
        emailVerified: true,
        deletedAt: null,
        status: "SUSPENDED",
        totpSecret: null,
      });

      const result = await authModule.login(validLoginParams);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("ACCOUNT_DISABLED");
    });

    it("SSO 用户无密码时应返回 SSO_USER 错误", async () => {
      mockPrismaUserFindFirst.mockResolvedValue({
        uid: 1,
        username: "sso_user",
        password: null,
        accounts: [{ provider: "GOOGLE" }],
        nickname: "SSO",
        role: "USER",
        avatar: null,
        email: "sso@test.com",
        emailVerified: true,
        deletedAt: null,
        status: "ACTIVE",
        totpSecret: null,
      });

      const result = await authModule.login(validLoginParams);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("SSO_USER");
    });

    it("密码错误时应返回无效凭据错误", async () => {
      mockPrismaUserFindFirst.mockResolvedValue({
        uid: 1,
        username: "testuser",
        password: "hashed",
        accounts: [],
        nickname: "Test",
        role: "USER",
        avatar: null,
        email: "test@test.com",
        emailVerified: true,
        deletedAt: null,
        status: "ACTIVE",
        totpSecret: null,
      });
      mockVerifyPassword.mockResolvedValue({ isValid: false });
      mockGetConfig.mockImplementation((key: string) => {
        if (key === "user.email.verification.required")
          return Promise.resolve(false);
        return Promise.resolve(true);
      });

      const result = await authModule.login(validLoginParams);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("INVALID_CREDENTIALS");
    });

    it("未验证邮箱且需要邮箱验证时应返回错误", async () => {
      mockPrismaUserFindFirst.mockResolvedValue({
        uid: 1,
        username: "testuser",
        password: "hashed",
        accounts: [],
        nickname: "Test",
        role: "USER",
        avatar: null,
        email: "test@test.com",
        emailVerified: false,
        deletedAt: null,
        status: "ACTIVE",
        totpSecret: null,
      });
      mockGetConfig.mockImplementation((key: string) => {
        if (key === "user.email.verification.required")
          return Promise.resolve(true);
        return Promise.resolve(true);
      });

      const result = await authModule.login(validLoginParams);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("EMAIL_NOT_VERIFIED");
    });

    it("启用 TOTP 时登录应返回 requiresTotp", async () => {
      mockPrismaUserFindFirst.mockResolvedValue({
        uid: 1,
        username: "testuser",
        password: "hashed",
        accounts: [],
        nickname: "Test",
        role: "USER",
        avatar: null,
        email: "test@test.com",
        emailVerified: true,
        deletedAt: null,
        status: "ACTIVE",
        totpSecret: "encrypted-secret",
      });
      mockVerifyPassword.mockResolvedValue({ isValid: true });
      mockGetConfig.mockImplementation((key: string) => {
        if (key === "user.email.verification.required")
          return Promise.resolve(false);
        return Promise.resolve(true);
      });

      const result = await authModule.login(validLoginParams);

      expect(result.success).toBe(true);
      expect((result as any).data?.requiresTotp).toBe(true);
    });

    it("正常登录成功应返回用户信息", async () => {
      mockPrismaUserFindFirst.mockResolvedValue({
        uid: 1,
        username: "testuser",
        password: "hashed",
        accounts: [],
        nickname: "Test",
        role: "USER",
        avatar: null,
        email: "test@test.com",
        emailVerified: true,
        deletedAt: null,
        status: "ACTIVE",
        totpSecret: null,
      });
      mockVerifyPassword.mockResolvedValue({ isValid: true });
      mockGetConfig.mockImplementation((key: string) => {
        if (key === "user.email.verification.required")
          return Promise.resolve(false);
        return Promise.resolve(true);
      });
      mockPrismaRefreshTokenCreate.mockResolvedValue({ id: "token-id" });

      const result = await authModule.login(validLoginParams);

      expect(result.success).toBe(true);
      expect((result as any).data?.userInfo.username).toBe("testuser");
    });

    it("token_transport 为 body 时应返回 token 在响应中", async () => {
      mockPrismaUserFindFirst.mockResolvedValue({
        uid: 1,
        username: "testuser",
        password: "hashed",
        accounts: [],
        nickname: "Test",
        role: "USER",
        avatar: null,
        email: "test@test.com",
        emailVerified: true,
        deletedAt: null,
        status: "ACTIVE",
        totpSecret: null,
      });
      mockVerifyPassword.mockResolvedValue({ isValid: true });
      mockGetConfig.mockImplementation((key: string) => {
        if (key === "user.email.verification.required")
          return Promise.resolve(false);
        return Promise.resolve(true);
      });
      mockPrismaRefreshTokenCreate.mockResolvedValue({ id: "token-id" });

      const result = await authModule.login({
        ...validLoginParams,
        token_transport: "body",
      });

      expect(result.success).toBe(true);
      expect((result as any).data?.access_token).toBe("signed-token");
      expect((result as any).data?.refresh_token).toBe("signed-token");
    });
  });

  // ==========================================================================
  // register
  // ==========================================================================

  describe("register", () => {
    const validRegisterParams = {
      username: "newuser",
      email: "new@test.com",
      password: "Test1234",
      nickname: "New User",
      captcha_token: "valid-captcha",
    };

    it("速率限制触发时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);

      const result = await authModule.register(validRegisterParams);

      expect(result.success).toBe(false);
      expect(result.message).toContain("频繁");
    });

    it("注册功能关闭时应返回禁止访问", async () => {
      mockGetConfig.mockResolvedValue(false);

      const result = await authModule.register(validRegisterParams);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("REGISTRATION_DISABLED");
    });

    it("用户名或邮箱已存在时应返回冲突", async () => {
      mockGetConfig.mockResolvedValue(true);
      mockPrismaUserFindFirst.mockResolvedValue({ uid: 999 });

      const result = await authModule.register(validRegisterParams);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("USER_EXISTS");
    });

    it("注册成功应返回成功消息", async () => {
      mockGetConfig.mockResolvedValue(true);
      mockPrismaUserFindFirst.mockResolvedValue(null);
      mockPrismaUserCreate.mockResolvedValue({
        uid: 2,
        username: "newuser",
        email: "new@test.com",
        nickname: "New User",
      });

      const result = await authModule.register(validRegisterParams);

      expect(result.success).toBe(true);
      expect(result.message).toContain("注册成功");
    });

    it("第一个注册用户应被赋予管理员权限", async () => {
      mockGetConfig.mockResolvedValue(true);
      mockPrismaUserFindFirst.mockResolvedValue(null);
      mockPrismaUserCreate.mockResolvedValue({
        uid: 1,
        username: "firstuser",
        email: "first@test.com",
        nickname: "First",
      });

      await authModule.register({
        username: "firstuser",
        email: "first@test.com",
        password: "Test1234",
        captcha_token: "valid-captcha",
      });

      expect(mockPrismaUserUpdate).toHaveBeenCalledWith({
        where: { uid: 1 },
        data: { role: "ADMIN" },
      });
    });
  });

  // ==========================================================================
  // refresh
  // ==========================================================================

  describe("refresh", () => {
    it("速率限制触发时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);

      const result = await authModule.refresh({
        refresh_token: "token",
        token_transport: "cookie",
      });

      expect(result.success).toBe(false);
    });

    it("无 token 时应返回未授权", async () => {
      mockCookiesGet.mockReturnValue(undefined);

      const result = await authModule.refresh({
        refresh_token: "",
        token_transport: "cookie",
      });

      expect(result.success).toBe(false);
    });

    it("JWT 验证失败时应返回未授权", async () => {
      mockJwtTokenVerify.mockReturnValue(null);

      const result = await authModule.refresh({
        refresh_token: "invalid-token",
        token_transport: "cookie",
      });

      expect(result.success).toBe(false);
    });

    it("数据库中 token 不存在时应返回未授权", async () => {
      mockJwtTokenVerify.mockReturnValue({
        uid: 1,
        tokenId: "token-id",
        exp: 9999999999,
      });
      mockPrismaRefreshTokenFindUnique.mockResolvedValue(null);

      const result = await authModule.refresh({
        refresh_token: "valid-jwt",
        token_transport: "cookie",
      });

      expect(result.success).toBe(false);
    });

    it("token 已撤销时应返回未授权", async () => {
      mockJwtTokenVerify.mockReturnValue({
        uid: 1,
        tokenId: "token-id",
        exp: 9999999999,
      });
      mockPrismaRefreshTokenFindUnique.mockResolvedValue({
        id: "token-id",
        userUid: 1,
        expiresAt: new Date(Date.now() + 86400000),
        revokedAt: new Date(),
        user: {
          uid: 1,
          username: "test",
          nickname: "T",
          role: "USER",
          avatar: null,
          email: "t@t.com",
          status: "ACTIVE",
          deletedAt: null,
        },
      });

      const result = await authModule.refresh({
        refresh_token: "valid-jwt",
        token_transport: "cookie",
      });

      expect(result.success).toBe(false);
    });

    it("刷新成功应返回用户信息", async () => {
      mockJwtTokenVerify.mockReturnValue({
        uid: 1,
        tokenId: "token-id",
        exp: 9999999999,
      });
      mockPrismaRefreshTokenFindUnique.mockResolvedValue({
        id: "token-id",
        userUid: 1,
        expiresAt: new Date(Date.now() + 86400000),
        revokedAt: null,
        user: {
          uid: 1,
          username: "test",
          nickname: "T",
          role: "USER",
          avatar: null,
          email: "t@t.com",
          status: "ACTIVE",
          deletedAt: null,
        },
      });

      const result = await authModule.refresh({
        refresh_token: "valid-jwt",
        token_transport: "body",
      });

      expect(result.success).toBe(true);
      expect((result as any).data?.userInfo.username).toBe("test");
      expect((result as any).data?.access_token).toBe("signed-token");
    });
  });

  // ==========================================================================
  // logout
  // ==========================================================================

  describe("logout", () => {
    it("速率限制触发时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);

      const result = await authModule.logout({
        refresh_token: "token",
      });

      expect(result.success).toBe(false);
    });

    it("无效 token 时应返回未授权并清除 cookie", async () => {
      mockJwtTokenVerify.mockReturnValue(null);

      const result = await authModule.logout({
        refresh_token: "invalid",
      });

      expect(result.success).toBe(false);
      expect(mockCookiesDelete).toHaveBeenCalled();
    });

    it("成功退出应返回成功消息", async () => {
      mockJwtTokenVerify.mockReturnValue({
        uid: 1,
        tokenId: "token-id",
        exp: 9999999999,
      });
      mockPrismaRefreshTokenUpdate.mockResolvedValue({});

      const result = await authModule.logout({
        refresh_token: "valid-token",
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain("退出登录成功");
    });
  });

  // ==========================================================================
  // verifyEmail
  // ==========================================================================

  describe("verifyEmail", () => {
    const validParams = {
      code: "123456",
      captcha_token: "valid-captcha",
      email: "test@test.com",
    };

    it("速率限制触发时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);

      const result = await authModule.verifyEmail(validParams);

      expect(result.success).toBe(false);
    });

    it("验证码验证失败时应返回错误", async () => {
      mockVerifyToken.mockResolvedValue({ success: false });

      const result = await authModule.verifyEmail(validParams);

      expect(result.success).toBe(false);
    });

    it("用户不存在时应返回已验证消息（防遍历）", async () => {
      mockPrismaUserFindUnique.mockResolvedValue(null);

      const result = await authModule.verifyEmail(validParams);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("EMAIL_ALREADY_VERIFIED");
    });

    it("邮箱已验证时应返回已验证消息", async () => {
      mockPrismaUserFindUnique.mockResolvedValue({
        uid: 1,
        emailVerifyCode: "123456-789",
        emailVerified: true,
      });

      const result = await authModule.verifyEmail(validParams);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("EMAIL_ALREADY_VERIFIED");
    });
  });

  // ==========================================================================
  // changePassword
  // ==========================================================================

  describe("changePassword", () => {
    it("速率限制触发时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);

      const result = await authModule.changePassword({
        old_password: "OldPass123",
        new_password: "NewPass123",
      });

      expect(result.success).toBe(false);
    });

    it("无有效 access token 时应返回未授权", async () => {
      mockJwtTokenVerify.mockReturnValue(null);
      mockVerifyAccessToken.mockResolvedValue(null);

      const result = await authModule.changePassword({
        old_password: "OldPass123",
        new_password: "NewPass123",
        access_token: "invalid",
      });

      expect(result.success).toBe(false);
    });

    it("无 reauth token 时应返回需要重新验证", async () => {
      mockJwtTokenVerify.mockReturnValue({
        uid: 1,
        username: "test",
        role: "USER",
      });
      mockCheckReauthToken.mockResolvedValue(false);

      const result = await authModule.changePassword({
        old_password: "OldPass123",
        new_password: "NewPass123",
        access_token: "valid",
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("NEED_REAUTH");
    });

    it("新旧密码相同时应返回错误", async () => {
      mockJwtTokenVerify.mockReturnValue({
        uid: 1,
        username: "test",
        role: "USER",
      });
      mockCheckReauthToken.mockResolvedValue(true);
      mockPrismaUserFindUnique.mockResolvedValue({
        uid: 1,
        password: "hashed-old",
        accounts: [],
      });
      mockVerifyPassword.mockResolvedValue({ isValid: true });

      const result = await authModule.changePassword({
        old_password: "OldPass123",
        new_password: "SamePass123",
        access_token: "valid",
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("PASSWORDS_IDENTICAL");
    });

    it("修改密码成功应返回成功消息", async () => {
      mockJwtTokenVerify.mockReturnValue({
        uid: 1,
        username: "test",
        role: "USER",
      });
      mockCheckReauthToken.mockResolvedValue(true);
      mockPrismaUserFindUnique.mockResolvedValue({
        uid: 1,
        password: "hashed-old",
        accounts: [],
      });
      mockVerifyPassword.mockResolvedValue({ isValid: false });

      const result = await authModule.changePassword({
        old_password: "OldPass123",
        new_password: "NewPass123",
        access_token: "valid",
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain("密码修改成功");
    });
  });

  // ==========================================================================
  // requestPasswordReset
  // ==========================================================================

  describe("requestPasswordReset", () => {
    const validParams = {
      email: "test@test.com",
      captcha_token: "valid-captcha",
    };

    it("速率限制触发时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);

      const result = await authModule.requestPasswordReset(validParams);

      expect(result.success).toBe(false);
    });

    it("用户不存在时应返回成功（防遍历）", async () => {
      mockPrismaUserFindUnique.mockResolvedValue(null);

      const result = await authModule.requestPasswordReset(validParams);

      expect(result.success).toBe(true);
      expect(result.message).toContain("已发送重置密码链接");
    });

    it("30 分钟内已发送过重置邮件时应返回成功", async () => {
      mockPrismaUserFindUnique.mockResolvedValue({
        uid: 1,
        email: "test@test.com",
        username: "test",
        nickname: "Test",
      });
      mockPrismaPasswordResetFindFirst.mockResolvedValue({
        id: "reset-id",
        createdAt: new Date(),
      });

      const result = await authModule.requestPasswordReset(validParams);

      expect(result.success).toBe(true);
    });

    it("正常请求应创建重置记录并返回成功", async () => {
      mockPrismaUserFindUnique.mockResolvedValue({
        uid: 1,
        email: "test@test.com",
        username: "test",
        nickname: "Test",
      });
      mockPrismaPasswordResetFindFirst.mockResolvedValue(null);
      mockPrismaPasswordResetDeleteMany.mockResolvedValue({ count: 0 });
      mockPrismaPasswordResetCreate.mockResolvedValue({ id: "new-reset-id" });

      const result = await authModule.requestPasswordReset(validParams);

      expect(result.success).toBe(true);
      expect(result.message).toContain("已发送重置密码链接");
    });
  });

  // ==========================================================================
  // resetPassword
  // ==========================================================================

  describe("resetPassword", () => {
    const validParams = {
      code: "reset-code",
      new_password: "NewPass123",
      captcha_token: "valid-captcha",
    };

    it("速率限制触发时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);

      const result = await authModule.resetPassword(validParams);

      expect(result.success).toBe(false);
    });

    it("无效重置码时应返回错误", async () => {
      mockPrismaPasswordResetFindUnique.mockResolvedValue(null);

      const result = await authModule.resetPassword(validParams);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("INVALID_RESET_CODE");
    });

    it("重置码已过期时应返回错误", async () => {
      mockPrismaPasswordResetFindUnique.mockResolvedValue({
        id: "reset-code",
        userUid: 1,
        createdAt: new Date(Date.now() - 31 * 60 * 1000), // 31 分钟前
        user: {
          uid: 1,
          email: "test@test.com",
          username: "test",
          nickname: "Test",
          status: "ACTIVE",
        },
      });

      const result = await authModule.resetPassword(validParams);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("EXPIRED_RESET_CODE");
    });

    it("重置成功应返回成功消息", async () => {
      mockPrismaPasswordResetFindUnique.mockResolvedValue({
        id: "reset-code",
        userUid: 1,
        createdAt: new Date(),
        user: {
          uid: 1,
          email: "test@test.com",
          username: "test",
          nickname: "Test",
          status: "ACTIVE",
        },
      });

      const result = await authModule.resetPassword(validParams);

      expect(result.success).toBe(true);
      expect(result.message).toContain("密码重置成功");
    });

    it("NEEDS_UPDATE 用户重置后应更新状态为 ACTIVE", async () => {
      mockPrismaPasswordResetFindUnique.mockResolvedValue({
        id: "reset-code",
        userUid: 1,
        createdAt: new Date(),
        user: {
          uid: 1,
          email: "test@test.com",
          username: "test",
          nickname: "Test",
          status: "NEEDS_UPDATE",
        },
      });

      await authModule.resetPassword(validParams);

      expect(mockPrismaUserUpdate).toHaveBeenCalledWith({
        where: { uid: 1 },
        data: { status: "ACTIVE", emailVerified: true },
      });
    });
  });

  // ==========================================================================
  // resendEmailVerification
  // ==========================================================================

  describe("resendEmailVerification", () => {
    const validParams = {
      email: "test@test.com",
      captcha_token: "valid-captcha",
    };

    it("速率限制触发时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);

      const result = await authModule.resendEmailVerification(validParams);

      expect(result.success).toBe(false);
    });

    it("用户不存在时应返回成功（防遍历）", async () => {
      mockPrismaUserFindUnique.mockResolvedValue(null);

      const result = await authModule.resendEmailVerification(validParams);

      expect(result.success).toBe(true);
    });

    it("邮箱已验证时应返回成功", async () => {
      mockPrismaUserFindUnique.mockResolvedValue({
        uid: 1,
        email: "test@test.com",
        emailVerified: true,
      });

      const result = await authModule.resendEmailVerification(validParams);

      expect(result.success).toBe(true);
    });

    it("正常重发应更新验证码并返回成功", async () => {
      mockPrismaUserFindUnique.mockResolvedValue({
        uid: 1,
        email: "test@test.com",
        emailVerified: false,
      });

      const result = await authModule.resendEmailVerification(validParams);

      expect(result.success).toBe(true);
      expect(mockPrismaUserUpdate).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // getSessions
  // ==========================================================================

  describe("getSessions", () => {
    it("无 access token 时应返回未授权", async () => {
      mockCookiesGet.mockReturnValue(undefined);

      const result = await authModule.getSessions();

      expect(result.success).toBe(false);
    });

    it("access token 验证失败时应返回未授权", async () => {
      mockCookiesGet.mockReturnValue(undefined);
      mockJwtTokenVerify.mockReturnValue(null);

      const result = await authModule.getSessions();

      expect(result.success).toBe(false);
    });

    it("获取成功应返回会话列表", async () => {
      // 第一次调用 cookies get 返回 REFRESH_TOKEN, 第二次返回 ACCESS_TOKEN
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "REFRESH_TOKEN") return { value: "refresh-token" };
        if (name === "ACCESS_TOKEN") return { value: "access-token" };
        return undefined;
      });
      mockJwtTokenVerify.mockImplementation((token: string) => {
        if (token === "refresh-token") return { uid: 1, tokenId: "token-1" };
        if (token === "access-token")
          return { uid: 1, username: "test", role: "USER" };
        return null;
      });
      mockPrismaRefreshTokenFindMany.mockResolvedValue([
        {
          id: "token-1",
          userUid: 1,
          createdAt: new Date(),
          lastUsedAt: new Date(),
          ipAddress: "127.0.0.1",
          userAgent: "Mozilla/5.0",
          revokedAt: null,
        },
      ]);

      const result = await authModule.getSessions();

      expect(result.success).toBe(true);
      expect(result.data?.sessions).toHaveLength(1);
    });
  });

  // ==========================================================================
  // revokeSession
  // ==========================================================================

  describe("revokeSession", () => {
    it("速率限制触发时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);

      const result = await authModule.revokeSession({ sessionId: "session-1" });

      expect(result.success).toBe(false);
    });

    it("撤销当前会话应返回错误", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "REFRESH_TOKEN") return { value: "refresh-token" };
        if (name === "ACCESS_TOKEN") return { value: "access-token" };
        return undefined;
      });
      mockJwtTokenVerify.mockImplementation((token: string) => {
        if (token === "refresh-token") return { uid: 1, tokenId: "session-1" };
        if (token === "access-token")
          return { uid: 1, username: "test", role: "USER" };
        return null;
      });

      const result = await authModule.revokeSession({ sessionId: "session-1" });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("CANNOT_REVOKE_CURRENT_SESSION");
    });

    it("会话不存在时应返回 404", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "REFRESH_TOKEN") return { value: "refresh-token" };
        if (name === "ACCESS_TOKEN") return { value: "access-token" };
        return undefined;
      });
      mockJwtTokenVerify.mockImplementation((token: string) => {
        if (token === "refresh-token")
          return { uid: 1, tokenId: "current-token" };
        if (token === "access-token")
          return { uid: 1, username: "test", role: "USER" };
        return null;
      });
      mockPrismaRefreshTokenFindUnique.mockResolvedValue(null);

      const result = await authModule.revokeSession({
        sessionId: "other-session",
      });

      expect(result.success).toBe(false);
    });

    it("无权撤销他人会话时应返回禁止", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "REFRESH_TOKEN") return { value: "refresh-token" };
        if (name === "ACCESS_TOKEN") return { value: "access-token" };
        return undefined;
      });
      mockJwtTokenVerify.mockImplementation((token: string) => {
        if (token === "refresh-token")
          return { uid: 1, tokenId: "current-token" };
        if (token === "access-token")
          return { uid: 1, username: "test", role: "USER" };
        return null;
      });
      mockPrismaRefreshTokenFindUnique.mockResolvedValue({
        id: "other-session",
        userUid: 999, // 不同用户
        revokedAt: null,
      });

      const result = await authModule.revokeSession({
        sessionId: "other-session",
      });

      expect(result.success).toBe(false);
    });
  });
});
