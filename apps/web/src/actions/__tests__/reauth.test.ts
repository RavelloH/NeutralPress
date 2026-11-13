// @vitest-environment node
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
}));

const mockLimitControl = vi.fn();
vi.mock("@/lib/server/rate-limit", () => ({
  default: (...args: unknown[]) => mockLimitControl(...args),
}));

const mockVerifyToken = vi.fn();
vi.mock("@/lib/server/captcha", () => ({
  verifyToken: (...args: unknown[]) => mockVerifyToken(...args),
}));

const mockPrismaUserFindUnique = vi.fn();
const mockPrismaUserUpdate = vi.fn();
const mockPrismaAccountFindUnique = vi.fn();
vi.mock("@/lib/server/prisma", () => ({
  default: {
    user: {
      findUnique: (...args: unknown[]) => mockPrismaUserFindUnique(...args),
      update: (...args: unknown[]) => mockPrismaUserUpdate(...args),
    },
    account: {
      findUnique: (...args: unknown[]) => mockPrismaAccountFindUnique(...args),
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
vi.mock("@/lib/server/password", () => ({
  verifyPassword: (...args: unknown[]) => mockVerifyPassword(...args),
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

const mockCheckTotpFailCount = vi.fn();
const mockDecryptBackupCode = vi.fn();
const mockDecryptTotpSecret = vi.fn();
const mockIncrementTotpFailCount = vi.fn();
const mockIsValidBackupCodeFormat = vi.fn();
const mockResetTotpFailCount = vi.fn();
const mockReserveTotpAttempt = vi.fn();
const mockVerifyTotpCode = vi.fn();
vi.mock("@/lib/server/totp", () => ({
  checkTotpFailCount: (...args: unknown[]) => mockCheckTotpFailCount(...args),
  decryptBackupCode: (...args: unknown[]) => mockDecryptBackupCode(...args),
  decryptTotpSecret: (...args: unknown[]) => mockDecryptTotpSecret(...args),
  incrementTotpFailCount: (...args: unknown[]) =>
    mockIncrementTotpFailCount(...args),
  isValidBackupCodeFormat: (...args: unknown[]) =>
    mockIsValidBackupCodeFormat(...args),
  resetTotpFailCount: (...args: unknown[]) => mockResetTotpFailCount(...args),
  reserveTotpAttempt: (...args: unknown[]) => mockReserveTotpAttempt(...args),
  verifyTotpCode: (...args: unknown[]) => mockVerifyTotpCode(...args),
}));

// ============================================================================
// 测试
// ============================================================================

describe("reauth actions", () => {
  let reauthModule: typeof import("@/actions/reauth");

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    mockLimitControl.mockResolvedValue(true);
    mockVerifyToken.mockResolvedValue({ success: true });
    mockGetClientIP.mockResolvedValue("127.0.0.1");
    mockGetClientUserAgent.mockResolvedValue("Mozilla/5.0 Test");
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
    mockReserveTotpAttempt.mockResolvedValue(true);

    mockCookiesGet.mockReturnValue(undefined);
    mockHeadersGet.mockReturnValue(null);

    reauthModule = await import("@/actions/reauth");
  });

  // ==========================================================================
  // checkReauthToken
  // ==========================================================================

  describe("checkReauthToken", () => {
    it("无 REAUTH_TOKEN cookie 时应返回 false", async () => {
      mockCookiesGet.mockReturnValue(undefined);

      const result = await reauthModule.checkReauthToken();

      expect(result).toBe(false);
    });

    it("JWT 验证失败时应返回 false", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "REAUTH_TOKEN") return { value: "invalid-token" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue(null);

      const result = await reauthModule.checkReauthToken();

      expect(result).toBe(false);
    });

    it("token 类型不是 reauth 时应返回 false 并删除 cookie", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "REAUTH_TOKEN") return { value: "token" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({
        uid: 1,
        type: "other",
        exp: Math.floor(Date.now() / 1000) + 600,
      });

      const result = await reauthModule.checkReauthToken();

      expect(result).toBe(false);
      expect(mockCookiesDelete).toHaveBeenCalledWith("REAUTH_TOKEN");
    });

    it("token 已过期时应返回 false", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "REAUTH_TOKEN") return { value: "token" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({
        uid: 1,
        type: "reauth",
        exp: Math.floor(Date.now() / 1000) - 100, // 已过期
      });

      const result = await reauthModule.checkReauthToken();

      expect(result).toBe(false);
    });

    it("uid 不匹配时应返回 false", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "REAUTH_TOKEN") return { value: "token" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({
        uid: 1,
        type: "reauth",
        exp: Math.floor(Date.now() / 1000) + 600,
      });

      const result = await reauthModule.checkReauthToken(999);

      expect(result).toBe(false);
    });

    it("有效 token 且 uid 匹配时应返回 true", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "REAUTH_TOKEN") return { value: "token" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({
        uid: 1,
        type: "reauth",
        exp: Math.floor(Date.now() / 1000) + 600,
      });

      const result = await reauthModule.checkReauthToken(1);

      expect(result).toBe(true);
    });

    it("未指定 expectedUid 时应从 ACCESS_TOKEN 获取 uid", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "REAUTH_TOKEN") return { value: "reauth-token" };
        if (name === "ACCESS_TOKEN") return { value: "access-token" };
        return undefined;
      });
      mockJwtTokenVerify.mockImplementation((token: string) => {
        if (token === "reauth-token")
          return {
            uid: 1,
            type: "reauth",
            exp: Math.floor(Date.now() / 1000) + 600,
          };
        if (token === "access-token")
          return { uid: 1, username: "test", role: "USER" };
        return null;
      });

      const result = await reauthModule.checkReauthToken();

      expect(result).toBe(true);
    });
  });

  // ==========================================================================
  // getCurrentUserForReauth
  // ==========================================================================

  describe("getCurrentUserForReauth", () => {
    it("无 access token 时应返回未授权", async () => {
      mockCookiesGet.mockReturnValue(undefined);

      const result = await reauthModule.getCurrentUserForReauth();

      expect(result.success).toBe(false);
    });

    it("JWT 验证失败时应返回未授权", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "ACCESS_TOKEN") return { value: "invalid" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue(null);
      mockVerifyAccessToken.mockResolvedValue(null);

      const result = await reauthModule.getCurrentUserForReauth();

      expect(result.success).toBe(false);
    });

    it("用户不存在时应返回未授权", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "ACCESS_TOKEN") return { value: "valid" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({ uid: 1 });
      mockPrismaUserFindUnique.mockResolvedValue(null);

      const result = await reauthModule.getCurrentUserForReauth();

      expect(result.success).toBe(false);
    });

    it("获取成功应返回用户信息", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "ACCESS_TOKEN") return { value: "valid" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({ uid: 1 });
      mockPrismaUserFindUnique.mockResolvedValue({
        uid: 1,
        username: "testuser",
        email: "test@test.com",
        password: "hashed",
        totpSecret: null,
        accounts: [{ provider: "GITHUB" }],
      });

      const result = await reauthModule.getCurrentUserForReauth();

      expect(result.success).toBe(true);
      expect(result.data?.username).toBe("testuser");
      expect(result.data?.hasPassword).toBe(true);
      expect(result.data?.hasTotpEnabled).toBe(false);
      expect(result.data?.linkedProviders).toEqual(["github"]);
    });
  });

  // ==========================================================================
  // verifyPasswordForReauth
  // ==========================================================================

  describe("verifyPasswordForReauth", () => {
    const validParams = {
      password: "Test1234",
      captcha_token: "valid-captcha",
    };

    it("速率限制触发时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);

      const result = await reauthModule.verifyPasswordForReauth(validParams);

      expect(result.success).toBe(false);
    });

    it("验证码失败时应返回错误", async () => {
      mockVerifyToken.mockResolvedValue({ success: false });

      const result = await reauthModule.verifyPasswordForReauth(validParams);

      expect(result.success).toBe(false);
    });

    it("无 access token 时应返回未授权", async () => {
      mockCookiesGet.mockReturnValue(undefined);

      const result = await reauthModule.verifyPasswordForReauth(validParams);

      expect(result.success).toBe(false);
    });

    it("用户不存在时应返回未授权", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "ACCESS_TOKEN") return { value: "valid" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({ uid: 1 });
      mockPrismaUserFindUnique.mockResolvedValue(null);

      const result = await reauthModule.verifyPasswordForReauth(validParams);

      expect(result.success).toBe(false);
    });

    it("用户无密码时应返回错误", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "ACCESS_TOKEN") return { value: "valid" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({ uid: 1 });
      mockPrismaUserFindUnique.mockResolvedValue({
        uid: 1,
        password: null,
        totpSecret: null,
      });

      const result = await reauthModule.verifyPasswordForReauth(validParams);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("NO_PASSWORD_SET");
    });

    it("密码错误时应返回错误", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "ACCESS_TOKEN") return { value: "valid" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({ uid: 1 });
      mockPrismaUserFindUnique.mockResolvedValue({
        uid: 1,
        password: "hashed",
        totpSecret: null,
      });
      mockVerifyPassword.mockResolvedValue({ isValid: false });

      const result = await reauthModule.verifyPasswordForReauth(validParams);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("INVALID_PASSWORD");
    });

    it("启用 TOTP 时应返回 requiresTotp", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "ACCESS_TOKEN") return { value: "valid" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({ uid: 1 });
      mockPrismaUserFindUnique.mockResolvedValue({
        uid: 1,
        password: "hashed",
        totpSecret: "encrypted-secret",
      });
      mockVerifyPassword.mockResolvedValue({ isValid: true });

      const result = await reauthModule.verifyPasswordForReauth(validParams);

      expect(result.success).toBe(true);
      expect((result as any).data?.requiresTotp).toBe(true);
    });

    it("无 TOTP 时验证成功应设置 REAUTH_TOKEN", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "ACCESS_TOKEN") return { value: "valid" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({ uid: 1 });
      mockPrismaUserFindUnique.mockResolvedValue({
        uid: 1,
        password: "hashed",
        totpSecret: null,
      });
      mockVerifyPassword.mockResolvedValue({ isValid: true });

      const result = await reauthModule.verifyPasswordForReauth(validParams);

      expect(result.success).toBe(true);
      expect(mockCookiesSet).toHaveBeenCalledWith(
        "REAUTH_TOKEN",
        "signed-token",
        expect.any(Object),
      );
    });
  });

  // ==========================================================================
  // verifyTotpForReauth
  // ==========================================================================

  describe("verifyTotpForReauth", () => {
    it("速率限制触发时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);

      const result = await reauthModule.verifyTotpForReauth({
        totp_code: "123456",
      });

      expect(result.success).toBe(false);
    });

    it("无验证码和备份码时应返回错误", async () => {
      const result = await reauthModule.verifyTotpForReauth({});

      expect(result.success).toBe(false);
    });

    it("无 TOTP_TOKEN cookie 时应返回未授权", async () => {
      mockCookiesGet.mockReturnValue(undefined);

      const result = await reauthModule.verifyTotpForReauth({
        totp_code: "123456",
      });

      expect(result.success).toBe(false);
    });

    it("TOTP token 验证失败时应返回未授权", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "TOTP_TOKEN") return { value: "invalid" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue(null);

      const result = await reauthModule.verifyTotpForReauth({
        totp_code: "123456",
      });

      expect(result.success).toBe(false);
    });

    it("超过失败次数限制时应返回错误", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "TOTP_TOKEN") return { value: "totp-token" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({
        uid: 1,
        type: "totp_verification",
        purpose: "reauth",
        sessionId: "session-1",
      });
      mockReserveTotpAttempt.mockResolvedValue(false);

      const result = await reauthModule.verifyTotpForReauth({
        totp_code: "123456",
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("TOTP_VERIFICATION_FAILED");
    });

    it("TOTP 码验证成功时应设置 REAUTH_TOKEN", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "TOTP_TOKEN") return { value: "totp-token" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({
        uid: 1,
        type: "totp_verification",
        purpose: "reauth",
        sessionId: "session-1",
      });
      mockReserveTotpAttempt.mockResolvedValue(true);
      mockPrismaUserFindUnique.mockResolvedValue({
        uid: 1,
        totpSecret: "encrypted",
        totpBackupCodes: null,
        status: "ACTIVE",
        deletedAt: null,
      });
      mockDecryptTotpSecret.mockReturnValue("decrypted-secret");
      mockVerifyTotpCode.mockReturnValue(true);

      const result = await reauthModule.verifyTotpForReauth({
        totp_code: "123456",
      });

      expect(result.success).toBe(true);
      expect(mockCookiesSet).toHaveBeenCalledWith(
        "REAUTH_TOKEN",
        "signed-token",
        expect.any(Object),
      );
    });

    it("备份码格式错误时应返回错误", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "TOTP_TOKEN") return { value: "totp-token" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({
        uid: 1,
        type: "totp_verification",
        purpose: "reauth",
        sessionId: "session-1",
      });
      mockReserveTotpAttempt.mockResolvedValue(true);
      mockPrismaUserFindUnique.mockResolvedValue({
        uid: 1,
        totpSecret: "encrypted",
        totpBackupCodes: { codes: [] },
        status: "ACTIVE",
        deletedAt: null,
      });
      mockDecryptTotpSecret.mockReturnValue("decrypted-secret");
      mockIsValidBackupCodeFormat.mockReturnValue(false);

      const result = await reauthModule.verifyTotpForReauth({
        backup_code: "bad-format",
      });

      expect(result.success).toBe(false);
      expect(mockReserveTotpAttempt).toHaveBeenCalledWith(1);
    });
  });

  // ==========================================================================
  // verifySSOForReauth
  // ==========================================================================

  describe("verifySSOForReauth", () => {
    const validParams = {
      uid: 1,
      provider: "google",
      providerAccountId: "google-123",
    };

    it("无 oauth reauth token 时应返回未授权", async () => {
      mockCookiesGet.mockReturnValue(undefined);

      const result = await reauthModule.verifySSOForReauth(validParams);

      expect(result.success).toBe(false);
    });

    it("oauth token 无效时应返回禁止", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "oauth_reauth_token_google") return { value: "token" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue(null);

      const result = await reauthModule.verifySSOForReauth(validParams);

      expect(result.success).toBe(false);
    });

    it("uid 不匹配时应返回禁止", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "oauth_reauth_token_google") return { value: "token" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({
        uid: 999,
        sessionId: "session-1",
        purpose: "oauth_reauth",
        provider: "google",
      });

      const result = await reauthModule.verifySSOForReauth(validParams);

      expect(result.success).toBe(false);
    });

    it("验证成功应设置 REAUTH_TOKEN", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "oauth_reauth_token_google") return { value: "token" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({
        uid: 1,
        sessionId: "session-1",
        purpose: "oauth_reauth",
        provider: "google",
      });
      mockPrismaUserFindUnique.mockResolvedValue({
        uid: 1,
        accounts: [{ providerAccountId: "google-123" }],
      });

      const result = await reauthModule.verifySSOForReauth(validParams);

      expect(result.success).toBe(true);
      expect(mockCookiesSet).toHaveBeenCalledWith(
        "REAUTH_TOKEN",
        "signed-token",
        expect.any(Object),
      );
    });

    it("SSO 账户未绑定时应返回禁止", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "oauth_reauth_token_google") return { value: "token" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({
        uid: 1,
        sessionId: "session-1",
        purpose: "oauth_reauth",
        provider: "google",
      });
      mockPrismaUserFindUnique.mockResolvedValue({
        uid: 1,
        accounts: [{ providerAccountId: "other-id" }],
      });

      const result = await reauthModule.verifySSOForReauth(validParams);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("ACCOUNT_NOT_LINKED");
    });
  });
});
