import { beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================================
// Mocks
// ============================================================================

const mockCookiesGet = vi.fn();
const mockCookiesSet = vi.fn();
const mockCookiesDelete = vi.fn();
vi.mock("next/headers", () => ({
  cookies: vi.fn(() => ({
    get: mockCookiesGet,
    set: mockCookiesSet,
    delete: mockCookiesDelete,
  })),
}));

vi.mock("next/server", () => ({
  after: vi.fn((fn: () => Promise<void>) => fn()),
}));

const mockPrismaUserFindUnique = vi.fn();
const mockPrismaUserCreate = vi.fn();
const mockPrismaUserUpdate = vi.fn();
const mockPrismaAccountFindUnique = vi.fn();
const mockPrismaAccountCreate = vi.fn();
const mockPrismaAccountDelete = vi.fn();
const mockPrismaRefreshTokenCreate = vi.fn();
const mockPrismaRefreshTokenDelete = vi.fn();
vi.mock("@/lib/server/prisma", () => ({
  default: {
    user: {
      findUnique: (...args: unknown[]) => mockPrismaUserFindUnique(...args),
      create: (...args: unknown[]) => mockPrismaUserCreate(...args),
      update: (...args: unknown[]) => mockPrismaUserUpdate(...args),
    },
    account: {
      findUnique: (...args: unknown[]) => mockPrismaAccountFindUnique(...args),
      create: (...args: unknown[]) => mockPrismaAccountCreate(...args),
      delete: (...args: unknown[]) => mockPrismaAccountDelete(...args),
    },
    refreshToken: {
      create: (...args: unknown[]) => mockPrismaRefreshTokenCreate(...args),
      delete: (...args: unknown[]) => mockPrismaRefreshTokenDelete(...args),
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

const mockGetConfig = vi.fn();
const mockGetConfigs = vi.fn();
vi.mock("@/lib/server/config-cache", () => ({
  getConfig: (...args: unknown[]) => mockGetConfig(...args),
  getConfigs: (...args: unknown[]) => mockGetConfigs(...args),
}));

const mockHashPassword = vi.fn();
vi.mock("@/lib/server/password", () => ({
  hashPassword: (...args: unknown[]) => mockHashPassword(...args),
}));

vi.mock("@/lib/server/audit", () => ({
  logAuditEvent: vi.fn(),
}));

const mockGetClientIP = vi.fn();
const mockGetClientUserAgent = vi.fn();
vi.mock("@/lib/server/get-client-info", () => ({
  getClientIP: (...args: unknown[]) => mockGetClientIP(...args),
  getClientUserAgent: (...args: unknown[]) => mockGetClientUserAgent(...args),
}));

const mockCheckReauthToken = vi.fn();
vi.mock("@/actions/reauth", () => ({
  checkReauthToken: (...args: unknown[]) => mockCheckReauthToken(...args),
}));

const mockValidateOAuthCallback = vi.fn();
vi.mock("@/lib/server/oauth", () => ({
  validateOAuthCallback: (...args: unknown[]) =>
    mockValidateOAuthCallback(...args),
}));

// ============================================================================
// 测试
// ============================================================================

describe("sso actions", () => {
  let ssoModule: typeof import("@/actions/sso");

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    mockCheckReauthToken.mockResolvedValue(true);
    mockGetConfig.mockResolvedValue(true);
    mockGetConfigs.mockResolvedValue(["TestSite", "http://localhost:3000"]);
    mockHashPassword.mockResolvedValue("hashed");
    mockJwtTokenSign.mockReturnValue("signed-token");
    mockVerifyAccessToken.mockResolvedValue({
      type: "access",
      uid: 1,
      sessionId: "session-1",
      username: "testuser",
      nickname: "testuser",
      role: "USER",
    });
    mockVerifySession.mockImplementation(
      async (_sessionId: string, uid: number) => ({
        uid,
        username: "testuser",
        nickname: "testuser",
        role: "USER",
      }),
    );
    mockGetClientIP.mockResolvedValue("127.0.0.1");
    mockGetClientUserAgent.mockResolvedValue("Mozilla/5.0");

    mockCookiesGet.mockReturnValue(undefined);

    ssoModule = await import("@/actions/sso");
  });

  // ==========================================================================
  // unlinkSSO
  // ==========================================================================

  describe("unlinkSSO", () => {
    it("无 access token 时应返回未授权", async () => {
      mockCookiesGet.mockReturnValue(undefined);

      const result = await ssoModule.unlinkSSO({ provider: "google" });

      expect(result.success).toBe(false);
    });

    it("无 reauth token 时应返回禁止", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "ACCESS_TOKEN") return { value: "valid" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({ uid: 1 });
      mockCheckReauthToken.mockResolvedValue(false);

      const result = await ssoModule.unlinkSSO({ provider: "google" });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("NEED_REAUTH");
    });

    it("用户不存在时应返回未授权", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "ACCESS_TOKEN") return { value: "valid" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({ uid: 1 });
      mockPrismaUserFindUnique.mockResolvedValue(null);

      const result = await ssoModule.unlinkSSO({ provider: "google" });

      expect(result.success).toBe(false);
    });

    it("最后一个 SSO 且无密码时应返回错误", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "ACCESS_TOKEN") return { value: "valid" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({ uid: 1 });
      mockPrismaUserFindUnique.mockResolvedValue({
        uid: 1,
        password: null,
        accounts: [{ id: "acc-1", provider: "GOOGLE" }],
      });

      const result = await ssoModule.unlinkSSO({ provider: "google" });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("PASSWORD_REQUIRED");
    });

    it("未绑定该 SSO 时应返回错误", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "ACCESS_TOKEN") return { value: "valid" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({ uid: 1 });
      mockPrismaUserFindUnique.mockResolvedValue({
        uid: 1,
        password: "hashed",
        accounts: [{ id: "acc-1", provider: "GOOGLE" }],
      });
      mockPrismaAccountFindUnique.mockResolvedValue(null);

      const result = await ssoModule.unlinkSSO({ provider: "google" });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("NOT_LINKED");
    });

    it("解绑成功应返回成功消息", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "ACCESS_TOKEN") return { value: "valid" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({ uid: 1 });
      mockPrismaUserFindUnique.mockResolvedValue({
        uid: 1,
        password: "hashed",
        accounts: [{ id: "acc-1", provider: "GOOGLE" }],
      });
      mockPrismaAccountFindUnique.mockResolvedValue({ id: "acc-1" });

      const result = await ssoModule.unlinkSSO({ provider: "google" });

      expect(result.success).toBe(true);
      expect(mockPrismaAccountDelete).toHaveBeenCalledWith({
        where: { id: "acc-1" },
      });
    });
  });

  // ==========================================================================
  // setPassword
  // ==========================================================================

  describe("setPassword", () => {
    it("无 access token 时应返回未授权", async () => {
      mockCookiesGet.mockReturnValue(undefined);

      const result = await ssoModule.setPassword({ newPassword: "NewPass1" });

      expect(result.success).toBe(false);
    });

    it("无 reauth token 时应返回禁止", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "ACCESS_TOKEN") return { value: "valid" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({ uid: 1 });
      mockCheckReauthToken.mockResolvedValue(false);

      const result = await ssoModule.setPassword({ newPassword: "NewPass1" });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("NEED_REAUTH");
    });

    it("已有密码时应返回错误", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "ACCESS_TOKEN") return { value: "valid" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({ uid: 1 });
      mockPrismaUserFindUnique.mockResolvedValue({
        uid: 1,
        password: "existing-hash",
      });

      const result = await ssoModule.setPassword({ newPassword: "NewPass1" });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("PASSWORD_ALREADY_SET");
    });

    it("密码强度不足时应返回错误", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "ACCESS_TOKEN") return { value: "valid" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({ uid: 1 });
      mockPrismaUserFindUnique.mockResolvedValue({
        uid: 1,
        password: null,
      });

      const result = await ssoModule.setPassword({ newPassword: "weak" });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("WEAK_PASSWORD");
    });

    it("设置成功应返回成功消息", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "ACCESS_TOKEN") return { value: "valid" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({ uid: 1 });
      mockPrismaUserFindUnique.mockResolvedValue({
        uid: 1,
        password: null,
      });

      const result = await ssoModule.setPassword({
        newPassword: "StrongPass1",
      });

      expect(result.success).toBe(true);
      expect(mockPrismaUserUpdate).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // handleSSOBind
  // ==========================================================================

  describe("handleSSOBind", () => {
    const validParams = {
      provider: "google",
      code: "auth-code",
      state: "state-value",
      codeVerifier: "verifier",
    };

    it("不支持的 provider 应返回错误", async () => {
      const result = await ssoModule.handleSSOBind({
        ...validParams,
        provider: "twitter",
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("INVALID_PROVIDER");
    });

    it("无 state cookie 时应返回错误", async () => {
      mockCookiesGet.mockReturnValue(undefined);

      const result = await ssoModule.handleSSOBind(validParams);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("STATE_MISSING");
    });

    it("state 不匹配时应返回错误", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "oauth_bind_state_google") return { value: "jwt-state" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({
        state: "different-state",
        mode: "bind",
        provider: "google",
      });

      const result = await ssoModule.handleSSOBind(validParams);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("STATE_MISMATCH");
    });

    it("无 bind token cookie 时应返回未授权", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "oauth_bind_state_google") return { value: "jwt-state" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({
        state: "state-value",
        mode: "bind",
        provider: "google",
      });

      const result = await ssoModule.handleSSOBind(validParams);

      expect(result.success).toBe(false);
    });

    it("bind token 无效时应返回未授权", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "oauth_bind_state_google") return { value: "jwt-state" };
        if (name === "oauth_bind_token_google") return { value: "bind-token" };
        return undefined;
      });
      let callCount = 0;
      mockJwtTokenVerify.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return { state: "state-value", mode: "bind", provider: "google" };
        }
        return null; // bind token 无效
      });

      const result = await ssoModule.handleSSOBind(validParams);

      expect(result.success).toBe(false);
    });

    it("已绑定该 provider 时应返回错误", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "oauth_bind_state_google") return { value: "jwt-state" };
        if (name === "oauth_bind_token_google") return { value: "bind-token" };
        return undefined;
      });
      let callCount = 0;
      mockJwtTokenVerify.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return { state: "state-value", mode: "bind", provider: "google" };
        }
        return {
          uid: 1,
          sessionId: "session-1",
          purpose: "oauth_bind",
          provider: "google",
        };
      });
      mockPrismaUserFindUnique.mockResolvedValue({ uid: 1 });
      mockValidateOAuthCallback.mockResolvedValue({
        providerAccountId: "gp-123",
        email: "user@gmail.com",
      });
      mockPrismaAccountFindUnique.mockResolvedValueOnce({ id: "existing" }); // 已绑定

      const result = await ssoModule.handleSSOBind(validParams);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("ALREADY_LINKED");
    });

    it("SSO 账户已被其他用户绑定时应返回错误", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "oauth_bind_state_google") return { value: "jwt-state" };
        if (name === "oauth_bind_token_google") return { value: "bind-token" };
        return undefined;
      });
      let callCount = 0;
      mockJwtTokenVerify.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return { state: "state-value", mode: "bind", provider: "google" };
        }
        return {
          uid: 1,
          sessionId: "session-1",
          purpose: "oauth_bind",
          provider: "google",
        };
      });
      mockPrismaUserFindUnique.mockResolvedValue({ uid: 1 });
      mockValidateOAuthCallback.mockResolvedValue({
        providerAccountId: "gp-123",
        email: "user@gmail.com",
      });
      // 第一次 findUnique (检查当前用户是否已绑定) 返回 null
      // 第二次 findUnique (检查 SSO 账户是否被其他用户绑定) 返回匹配
      mockPrismaAccountFindUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: "other-user-account" });

      const result = await ssoModule.handleSSOBind(validParams);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("ACCOUNT_BOUND");
    });
  });

  // ==========================================================================
  // handleSSOCallback
  // ==========================================================================

  describe("handleSSOCallback", () => {
    const validParams = {
      provider: "google",
      code: "auth-code",
      state: "state-value",
    };

    it("不支持的 provider 应返回错误", async () => {
      const result = await ssoModule.handleSSOCallback({
        ...validParams,
        provider: "twitter",
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("INVALID_PROVIDER");
    });

    it("无 state cookie 时应返回错误", async () => {
      mockCookiesGet.mockReturnValue(undefined);

      const result = await ssoModule.handleSSOCallback(validParams);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("STATE_MISSING");
    });

    it("state 不匹配时应返回错误", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "oauth_state_google") return { value: "jwt-state" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({
        state: "wrong",
        mode: "login",
        provider: "google",
      });

      const result = await ssoModule.handleSSOCallback(validParams);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("STATE_MISMATCH");
    });

    it("已绑定用户应登录成功", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "oauth_state_google") return { value: "jwt-state" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({
        state: "state-value",
        mode: "login",
        provider: "google",
      });
      mockValidateOAuthCallback.mockResolvedValue({
        providerAccountId: "gp-123",
        email: "user@gmail.com",
        name: "User",
        avatar: null,
      });
      mockPrismaAccountFindUnique.mockResolvedValue({
        user: {
          uid: 1,
          username: "user",
          nickname: "User",
          email: "user@gmail.com",
          avatar: null,
          role: "USER",
          status: "ACTIVE",
          deletedAt: null,
        },
      });
      mockPrismaRefreshTokenCreate.mockResolvedValue({ id: "rt-1" });

      const result = await ssoModule.handleSSOCallback(validParams);

      expect(result.success).toBe(true);
      expect(result.data?.action).toBe("login");
    });

    it("被禁用用户应返回错误", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "oauth_state_google") return { value: "jwt-state" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({
        state: "state-value",
        mode: "login",
        provider: "google",
      });
      mockValidateOAuthCallback.mockResolvedValue({
        providerAccountId: "gp-123",
        email: "disabled@gmail.com",
      });
      mockPrismaAccountFindUnique.mockResolvedValue({
        user: {
          uid: 2,
          username: "disabled",
          nickname: "Disabled",
          email: "disabled@gmail.com",
          avatar: null,
          role: "USER",
          status: "SUSPENDED",
          deletedAt: null,
        },
      });

      const result = await ssoModule.handleSSOCallback(validParams);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("ACCOUNT_DISABLED");
    });

    it("邮箱已被注册时应返回错误", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "oauth_state_google") return { value: "jwt-state" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({
        state: "state-value",
        mode: "login",
        provider: "google",
      });
      mockValidateOAuthCallback.mockResolvedValue({
        providerAccountId: "gp-new",
        email: "existing@gmail.com",
      });
      mockPrismaAccountFindUnique.mockResolvedValue(null); // 无已绑定账户
      mockPrismaUserFindUnique.mockResolvedValue({ uid: 99 }); // 邮箱已存在

      const result = await ssoModule.handleSSOCallback(validParams);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("EMAIL_EXISTS");
    });

    it("注册关闭时新用户应返回禁止", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "oauth_state_google") return { value: "jwt-state" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({
        state: "state-value",
        mode: "login",
        provider: "google",
      });
      mockValidateOAuthCallback.mockResolvedValue({
        providerAccountId: "gp-new",
        email: "new@gmail.com",
        name: "New",
      });
      mockPrismaAccountFindUnique.mockResolvedValue(null);
      mockPrismaUserFindUnique.mockResolvedValue(null);
      mockGetConfig.mockResolvedValue(false); // 注册关闭

      const result = await ssoModule.handleSSOCallback(validParams);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("REGISTRATION_DISABLED");
    });

    it("新用户注册并登录成功", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "oauth_state_google") return { value: "jwt-state" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({
        state: "state-value",
        mode: "login",
        provider: "google",
      });
      mockValidateOAuthCallback.mockResolvedValue({
        providerAccountId: "gp-new",
        email: "new@gmail.com",
        name: "New User",
        avatar: "avatar.jpg",
      });
      mockPrismaAccountFindUnique.mockResolvedValue(null);
      // findUnique 用于检查用户名是否存在
      mockPrismaUserFindUnique.mockResolvedValue(null);
      mockGetConfig.mockResolvedValue(true); // 注册开启
      mockPrismaUserCreate.mockResolvedValue({
        uid: 5,
        username: "new",
        nickname: "New User",
        email: "new@gmail.com",
        avatar: "avatar.jpg",
        role: "USER",
      });
      mockPrismaRefreshTokenCreate.mockResolvedValue({ id: "rt-new" });

      const result = await ssoModule.handleSSOCallback(validParams);

      expect(result.success).toBe(true);
      expect(result.data?.action).toBe("login");
      expect(result.data?.userInfo?.username).toBe("new");
    });
  });
});
