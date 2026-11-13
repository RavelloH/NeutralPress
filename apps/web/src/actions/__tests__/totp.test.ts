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
  NextResponse: { json: vi.fn() },
}));

const mockLimitControl = vi.fn();
vi.mock("@/lib/server/rate-limit", () => ({
  default: (...args: unknown[]) => mockLimitControl(...args),
}));

const mockGetConfig = vi.fn();
vi.mock("@/lib/server/config-cache", () => ({
  getConfig: (...args: unknown[]) => mockGetConfig(...args),
}));

const mockPrismaUserFindUnique = vi.fn();
const mockPrismaUserUpdate = vi.fn();
const mockPrismaRefreshTokenCreate = vi.fn();
const mockPrismaRefreshTokenDelete = vi.fn();
vi.mock("@/lib/server/prisma", () => ({
  default: {
    user: {
      findUnique: (...args: unknown[]) => mockPrismaUserFindUnique(...args),
      update: (...args: unknown[]) => mockPrismaUserUpdate(...args),
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
const mockEncryptBackupCode = vi.fn();
const mockEncryptTotpSecret = vi.fn();
const mockGenerateBackupCodes = vi.fn();
const mockGenerateTotpSecret = vi.fn();
const mockGenerateTotpUri = vi.fn();
const mockIncrementTotpFailCount = vi.fn();
const mockReserveTotpAttempt = vi.fn();
const mockIsValidBackupCodeFormat = vi.fn();
const mockResetTotpFailCount = vi.fn();
const mockVerifyTotpCode = vi.fn();
vi.mock("@/lib/server/totp", () => ({
  checkTotpFailCount: (...args: unknown[]) => mockCheckTotpFailCount(...args),
  decryptBackupCode: (...args: unknown[]) => mockDecryptBackupCode(...args),
  decryptTotpSecret: (...args: unknown[]) => mockDecryptTotpSecret(...args),
  encryptBackupCode: (...args: unknown[]) => mockEncryptBackupCode(...args),
  encryptTotpSecret: (...args: unknown[]) => mockEncryptTotpSecret(...args),
  generateBackupCodes: (...args: unknown[]) => mockGenerateBackupCodes(...args),
  generateTotpSecret: (...args: unknown[]) => mockGenerateTotpSecret(...args),
  generateTotpUri: (...args: unknown[]) => mockGenerateTotpUri(...args),
  incrementTotpFailCount: (...args: unknown[]) =>
    mockIncrementTotpFailCount(...args),
  reserveTotpAttempt: (...args: unknown[]) => mockReserveTotpAttempt(...args),
  isValidBackupCodeFormat: (...args: unknown[]) =>
    mockIsValidBackupCodeFormat(...args),
  resetTotpFailCount: (...args: unknown[]) => mockResetTotpFailCount(...args),
  verifyTotpCode: (...args: unknown[]) => mockVerifyTotpCode(...args),
}));

const mockRedisGet = vi.fn();
const mockRedisSetex = vi.fn();
const mockRedisDel = vi.fn();
const mockEnsureRedisConnection = vi.fn();
vi.mock("@/lib/server/redis", () => ({
  default: {
    get: (...args: unknown[]) => mockRedisGet(...args),
    setex: (...args: unknown[]) => mockRedisSetex(...args),
    del: (...args: unknown[]) => mockRedisDel(...args),
  },
  ensureRedisConnection: (...args: unknown[]) =>
    mockEnsureRedisConnection(...args),
}));

const mockCheckReauthToken = vi.fn();
vi.mock("@/actions/reauth", () => ({
  checkReauthToken: (...args: unknown[]) => mockCheckReauthToken(...args),
}));

// ============================================================================
// 测试
// ============================================================================

describe("totp actions", () => {
  let totpModule: typeof import("@/actions/totp");

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    mockLimitControl.mockResolvedValue(true);
    mockCheckReauthToken.mockResolvedValue(true);
    mockReserveTotpAttempt.mockResolvedValue(true);
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
    mockGetConfig.mockResolvedValue("TestSite");
    mockEnsureRedisConnection.mockResolvedValue(undefined);
    mockJwtTokenSign.mockReturnValue("signed-token");
    mockGetClientIP.mockResolvedValue("127.0.0.1");
    mockGetClientUserAgent.mockResolvedValue("Mozilla/5.0");

    mockCookiesGet.mockReturnValue(undefined);
    mockHeadersGet.mockReturnValue(null);

    totpModule = await import("@/actions/totp");
  });

  // ==========================================================================
  // verifyTotp
  // ==========================================================================

  describe("verifyTotp", () => {
    it("速率限制触发时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);

      const result = await totpModule.verifyTotp({
        totp_code: "123456",
        token_transport: "cookie",
      });

      expect(result.success).toBe(false);
    });

    it("无验证码和备份码时应返回错误", async () => {
      const result = await totpModule.verifyTotp({
        token_transport: "cookie",
      });

      expect(result.success).toBe(false);
    });

    it("无 TOTP_TOKEN cookie 时应返回未授权", async () => {
      mockCookiesGet.mockReturnValue(undefined);

      const result = await totpModule.verifyTotp({
        totp_code: "123456",
        token_transport: "cookie",
      });

      expect(result.success).toBe(false);
    });

    it("TOTP token 类型不匹配时应返回未授权", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "TOTP_TOKEN") return { value: "token" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({ uid: 1, type: "other" });

      const result = await totpModule.verifyTotp({
        totp_code: "123456",
        token_transport: "cookie",
      });

      expect(result.success).toBe(false);
    });

    it("超过失败次数限制时应返回错误", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "TOTP_TOKEN") return { value: "token" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({
        uid: 1,
        type: "totp_verification",
        purpose: "login",
      });
      mockReserveTotpAttempt.mockResolvedValue(false);

      const result = await totpModule.verifyTotp({
        totp_code: "123456",
        token_transport: "cookie",
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("TOTP_VERIFICATION_FAILED");
    });

    it("用户无 TOTP secret 时应返回错误", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "TOTP_TOKEN") return { value: "token" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({
        uid: 1,
        type: "totp_verification",
        purpose: "login",
      });
      mockReserveTotpAttempt.mockResolvedValue(true);
      mockPrismaUserFindUnique.mockResolvedValue({
        uid: 1,
        username: "test",
        nickname: "T",
        role: "USER",
        avatar: null,
        email: "t@t.com",
        status: "ACTIVE",
        deletedAt: null,
        totpSecret: null,
        totpBackupCodes: null,
      });

      const result = await totpModule.verifyTotp({
        totp_code: "123456",
        token_transport: "cookie",
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("TOTP_NOT_ENABLED");
    });

    it("TOTP 解密失败时应返回服务器错误", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "TOTP_TOKEN") return { value: "token" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({
        uid: 1,
        type: "totp_verification",
        purpose: "login",
      });
      mockReserveTotpAttempt.mockResolvedValue(true);
      mockPrismaUserFindUnique.mockResolvedValue({
        uid: 1,
        username: "test",
        nickname: "T",
        role: "USER",
        avatar: null,
        email: "t@t.com",
        status: "ACTIVE",
        deletedAt: null,
        totpSecret: "encrypted",
        totpBackupCodes: null,
      });
      mockDecryptTotpSecret.mockReturnValue(null);

      const result = await totpModule.verifyTotp({
        totp_code: "123456",
        token_transport: "cookie",
      });

      expect(result.success).toBe(false);
    });

    it("TOTP 码错误时应返回错误", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "TOTP_TOKEN") return { value: "token" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({
        uid: 1,
        type: "totp_verification",
        purpose: "login",
      });
      mockReserveTotpAttempt.mockResolvedValue(true);
      mockPrismaUserFindUnique.mockResolvedValue({
        uid: 1,
        username: "test",
        nickname: "T",
        role: "USER",
        avatar: null,
        email: "t@t.com",
        status: "ACTIVE",
        deletedAt: null,
        totpSecret: "encrypted",
        totpBackupCodes: null,
      });
      mockDecryptTotpSecret.mockReturnValue("secret");
      mockVerifyTotpCode.mockReturnValue(false);

      const result = await totpModule.verifyTotp({
        totp_code: "wrong",
        token_transport: "cookie",
      });

      expect(result.success).toBe(false);
    });

    it("TOTP 验证成功应完成登录流程", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "TOTP_TOKEN") return { value: "token" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({
        uid: 1,
        type: "totp_verification",
        purpose: "login",
      });
      mockReserveTotpAttempt.mockResolvedValue(true);
      mockPrismaUserFindUnique.mockResolvedValue({
        uid: 1,
        username: "test",
        nickname: "T",
        role: "USER",
        avatar: null,
        email: "t@t.com",
        status: "ACTIVE",
        deletedAt: null,
        totpSecret: "encrypted",
        totpBackupCodes: null,
      });
      mockDecryptTotpSecret.mockReturnValue("secret");
      mockVerifyTotpCode.mockReturnValue(true);
      mockPrismaRefreshTokenCreate.mockResolvedValue({ id: "refresh-id" });

      const result = await totpModule.verifyTotp({
        totp_code: "123456",
        token_transport: "cookie",
      });

      expect(result.success).toBe(true);
      expect((result as any).data?.userInfo.username).toBe("test");
      expect(mockResetTotpFailCount).toHaveBeenCalledWith(1);
    });

    it("使用备份码验证失败时应返回错误", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "TOTP_TOKEN") return { value: "token" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({
        uid: 1,
        type: "totp_verification",
        purpose: "login",
      });
      mockReserveTotpAttempt.mockResolvedValue(true);
      mockPrismaUserFindUnique.mockResolvedValue({
        uid: 1,
        username: "test",
        nickname: "T",
        role: "USER",
        avatar: null,
        email: "t@t.com",
        status: "ACTIVE",
        deletedAt: null,
        totpSecret: "encrypted",
        totpBackupCodes: {
          codes: [{ code: "encrypted-abc", used: false, usedAt: null }],
        },
      });
      mockDecryptTotpSecret.mockReturnValue("secret");
      mockIsValidBackupCodeFormat.mockReturnValue(true);
      mockDecryptBackupCode.mockReturnValue("different-code");

      const result = await totpModule.verifyTotp({
        backup_code: "wrong-backup",
        token_transport: "body",
      });

      // backup code 不匹配，验证失败
      expect(result.success).toBe(false);
    });
  });

  // ==========================================================================
  // enableTotp
  // ==========================================================================

  describe("enableTotp", () => {
    it("速率限制触发时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);

      const result = await totpModule.enableTotp();

      expect(result.success).toBe(false);
    });

    it("无 reauth token 时应返回禁止", async () => {
      mockCheckReauthToken.mockResolvedValue(false);

      const result = await totpModule.enableTotp();

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("NEED_REAUTH");
    });

    it("无 access token 时应返回未授权", async () => {
      mockCookiesGet.mockReturnValue(undefined);

      const result = await totpModule.enableTotp();

      expect(result.success).toBe(false);
    });

    it("用户不存在时应返回未授权", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "ACCESS_TOKEN") return { value: "valid" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({ uid: 1 });
      mockPrismaUserFindUnique.mockResolvedValue(null);

      const result = await totpModule.enableTotp();

      expect(result.success).toBe(false);
    });

    it("TOTP 已启用时应返回错误", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "ACCESS_TOKEN") return { value: "valid" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({ uid: 1 });
      mockPrismaUserFindUnique.mockResolvedValue({
        uid: 1,
        username: "test",
        totpSecret: "already-set",
      });

      const result = await totpModule.enableTotp();

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("TOTP_ALREADY_ENABLED");
    });

    it("生成成功应返回 secret 和 QR URI", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "ACCESS_TOKEN") return { value: "valid" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({ uid: 1 });
      mockPrismaUserFindUnique.mockResolvedValue({
        uid: 1,
        username: "test",
        totpSecret: null,
      });
      mockGenerateTotpSecret.mockReturnValue("JBSWY3DPEHPK3PXP");
      mockGenerateTotpUri.mockReturnValue("otpauth://totp/...");

      const result = await totpModule.enableTotp();

      expect(result.success).toBe(true);
      expect(result.data?.secret).toBe("JBSWY3DPEHPK3PXP");
      expect(result.data?.qrCodeUri).toBe("otpauth://totp/...");
    });
  });

  // ==========================================================================
  // confirmTotp
  // ==========================================================================

  describe("confirmTotp", () => {
    it("速率限制触发时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);

      const result = await totpModule.confirmTotp({ totp_code: "123456" });

      expect(result.success).toBe(false);
    });

    it("无 reauth token 时应返回禁止", async () => {
      mockCheckReauthToken.mockResolvedValue(false);

      const result = await totpModule.confirmTotp({ totp_code: "123456" });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("NEED_REAUTH");
    });

    it("Redis 中无设置数据时应返回错误", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "ACCESS_TOKEN") return { value: "valid" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({ uid: 1 });
      mockRedisGet.mockResolvedValue(null);

      const result = await totpModule.confirmTotp({ totp_code: "123456" });

      expect(result.success).toBe(false);
    });

    it("TOTP 码错误时应返回错误", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "ACCESS_TOKEN") return { value: "valid" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({ uid: 1 });
      mockRedisGet.mockResolvedValue(
        JSON.stringify({ secret: "JBSWY3DPEHPK3PXP" }),
      );
      mockVerifyTotpCode.mockReturnValue(false);

      const result = await totpModule.confirmTotp({ totp_code: "wrong" });

      expect(result.success).toBe(false);
    });

    it("确认成功应保存 TOTP 并返回备份码", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "ACCESS_TOKEN") return { value: "valid" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({ uid: 1 });
      mockRedisGet.mockResolvedValue(
        JSON.stringify({ secret: "JBSWY3DPEHPK3PXP" }),
      );
      mockVerifyTotpCode.mockReturnValue(true);
      mockEncryptTotpSecret.mockReturnValue("encrypted-secret");
      mockGenerateBackupCodes.mockReturnValue(["CODE1", "CODE2"]);
      mockEncryptBackupCode.mockReturnValue("encrypted-code");

      const result = await totpModule.confirmTotp({ totp_code: "123456" });

      expect(result.success).toBe(true);
      expect(result.data?.backupCodes).toEqual(["CODE1", "CODE2"]);
      expect(mockPrismaUserUpdate).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // disableTotp
  // ==========================================================================

  describe("disableTotp", () => {
    it("速率限制触发时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);

      const result = await totpModule.disableTotp();

      expect(result.success).toBe(false);
    });

    it("无 reauth token 时应返回禁止", async () => {
      mockCheckReauthToken.mockResolvedValue(false);

      const result = await totpModule.disableTotp();

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("NEED_REAUTH");
    });

    it("TOTP 未启用时应返回错误", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "ACCESS_TOKEN") return { value: "valid" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({ uid: 1 });
      mockPrismaUserFindUnique.mockResolvedValue({
        uid: 1,
        totpSecret: null,
      });

      const result = await totpModule.disableTotp();

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("TOTP_NOT_ENABLED");
    });

    it("禁用成功应返回成功消息", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "ACCESS_TOKEN") return { value: "valid" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({ uid: 1 });
      mockPrismaUserFindUnique.mockResolvedValue({
        uid: 1,
        totpSecret: "encrypted",
      });

      const result = await totpModule.disableTotp();

      expect(result.success).toBe(true);
      expect(mockPrismaUserUpdate).toHaveBeenCalledWith({
        where: { uid: 1 },
        data: { totpSecret: null, totpBackupCodes: null },
      });
    });
  });

  // ==========================================================================
  // regenerateBackupCodes
  // ==========================================================================

  describe("regenerateBackupCodes", () => {
    it("TOTP 未启用时应返回错误", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "ACCESS_TOKEN") return { value: "valid" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({ uid: 1 });
      mockPrismaUserFindUnique.mockResolvedValue({
        uid: 1,
        totpSecret: null,
      });

      const result = await totpModule.regenerateBackupCodes();

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("TOTP_NOT_ENABLED");
    });

    it("成功生成应返回新的备份码", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "ACCESS_TOKEN") return { value: "valid" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({ uid: 1 });
      mockPrismaUserFindUnique.mockResolvedValue({
        uid: 1,
        totpSecret: "encrypted",
      });
      mockGenerateBackupCodes.mockReturnValue(["NEW1", "NEW2"]);
      mockEncryptBackupCode.mockReturnValue("encrypted");

      const result = await totpModule.regenerateBackupCodes();

      expect(result.success).toBe(true);
      expect(result.data?.backupCodes).toEqual(["NEW1", "NEW2"]);
    });
  });

  // ==========================================================================
  // getTotpStatus
  // ==========================================================================

  describe("getTotpStatus", () => {
    it("无 access token 时应返回未授权", async () => {
      mockCookiesGet.mockReturnValue(undefined);

      const result = await totpModule.getTotpStatus();

      expect(result.success).toBe(false);
    });

    it("TOTP 未启用时应返回 enabled=false", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "ACCESS_TOKEN") return { value: "valid" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({ uid: 1 });
      mockPrismaUserFindUnique.mockResolvedValue({
        totpSecret: null,
        totpBackupCodes: null,
      });

      const result = await totpModule.getTotpStatus();

      expect(result.success).toBe(true);
      expect(result.data?.enabled).toBe(false);
      expect(result.data?.backupCodesRemaining).toBe(0);
    });

    it("TOTP 已启用时应返回 enabled=true 和剩余备份码数量", async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === "ACCESS_TOKEN") return { value: "valid" };
        return undefined;
      });
      mockJwtTokenVerify.mockReturnValue({ uid: 1 });
      mockPrismaUserFindUnique.mockResolvedValue({
        totpSecret: "encrypted",
        totpBackupCodes: {
          codes: [
            { code: "c1", used: false, usedAt: null },
            { code: "c2", used: true, usedAt: "2024-01-01" },
            { code: "c3", used: false, usedAt: null },
          ],
        },
      });

      const result = await totpModule.getTotpStatus();

      expect(result.success).toBe(true);
      expect(result.data?.enabled).toBe(true);
      expect(result.data?.backupCodesRemaining).toBe(2);
    });
  });
});
