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

const mockAuthVerify = vi.fn();
vi.mock("@/lib/server/auth-verify", () => ({
  authVerify: (...args: unknown[]) => mockAuthVerify(...args),
}));

const mockGetConfig = vi.fn();
const mockGetConfigs = vi.fn();
vi.mock("@/lib/server/config-cache", () => ({
  getConfig: (...args: unknown[]) => mockGetConfig(...args),
  getConfigs: (...args: unknown[]) => mockGetConfigs(...args),
}));

const mockPrismaUserFindUnique = vi.fn();
const mockPrismaUserUpdate = vi.fn();
const mockPrismaPasskeyCount = vi.fn();
const mockPrismaPasskeyFindUnique = vi.fn();
const mockPrismaPasskeyFindMany = vi.fn();
const mockPrismaPasskeyCreate = vi.fn();
const mockPrismaPasskeyUpdate = vi.fn();
const mockPrismaPasskeyDelete = vi.fn();
const mockPrismaRefreshTokenCreate = vi.fn();
vi.mock("@/lib/server/prisma", () => ({
  default: {
    user: {
      findUnique: (...args: unknown[]) => mockPrismaUserFindUnique(...args),
      update: (...args: unknown[]) => mockPrismaUserUpdate(...args),
    },
    passkey: {
      count: (...args: unknown[]) => mockPrismaPasskeyCount(...args),
      findUnique: (...args: unknown[]) => mockPrismaPasskeyFindUnique(...args),
      findMany: (...args: unknown[]) => mockPrismaPasskeyFindMany(...args),
      create: (...args: unknown[]) => mockPrismaPasskeyCreate(...args),
      update: (...args: unknown[]) => mockPrismaPasskeyUpdate(...args),
      delete: (...args: unknown[]) => mockPrismaPasskeyDelete(...args),
    },
    refreshToken: {
      create: (...args: unknown[]) => mockPrismaRefreshTokenCreate(...args),
    },
  },
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

const mockGetClientUserAgent = vi.fn();
vi.mock("@/lib/server/get-client-info", () => ({
  getClientUserAgent: (...args: unknown[]) => mockGetClientUserAgent(...args),
}));

const mockRedisGet = vi.fn();
const mockRedisSet = vi.fn();
const mockRedisDel = vi.fn();
const mockEnsureRedisConnection = vi.fn();
vi.mock("@/lib/server/redis", () => ({
  default: {
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
    del: (...args: unknown[]) => mockRedisDel(...args),
  },
  ensureRedisConnection: (...args: unknown[]) =>
    mockEnsureRedisConnection(...args),
}));

const mockCheckReauthToken = vi.fn();
vi.mock("@/lib/server/reauth-verify", () => ({
  checkReauthToken: (...args: unknown[]) => mockCheckReauthToken(...args),
}));

const mockGenerateRegistrationOptions = vi.fn();
const mockGenerateAuthenticationOptions = vi.fn();
const mockVerifyRegistrationResponse = vi.fn();
const mockVerifyAuthenticationResponse = vi.fn();
vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: (...args: unknown[]) =>
    mockGenerateRegistrationOptions(...args),
  generateAuthenticationOptions: (...args: unknown[]) =>
    mockGenerateAuthenticationOptions(...args),
  verifyRegistrationResponse: (...args: unknown[]) =>
    mockVerifyRegistrationResponse(...args),
  verifyAuthenticationResponse: (...args: unknown[]) =>
    mockVerifyAuthenticationResponse(...args),
}));

// ============================================================================
// 测试
// ============================================================================

describe("passkey actions", () => {
  let passkeyModule: typeof import("@/actions/passkey");

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    mockLimitControl.mockResolvedValue(true);
    mockAuthVerify.mockResolvedValue({
      uid: 1,
      username: "test",
      role: "USER",
    });
    mockCheckReauthToken.mockResolvedValue(true);
    mockGetConfig.mockResolvedValue(true);
    mockGetConfigs.mockResolvedValue(["http://localhost:3000", "TestSite"]);
    mockEnsureRedisConnection.mockResolvedValue(undefined);
    mockJwtTokenSign.mockReturnValue("signed-token");
    mockGetClientUserAgent.mockResolvedValue(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    );
    mockPrismaPasskeyCount.mockResolvedValue(0);

    mockCookiesGet.mockReturnValue(undefined);
    mockHeadersGet.mockReturnValue(null);

    passkeyModule = await import("@/actions/passkey");
  });

  // ==========================================================================
  // generatePasskeyRegistrationOptions
  // ==========================================================================

  describe("generatePasskeyRegistrationOptions", () => {
    it("速率限制触发时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);

      const result = await passkeyModule.generatePasskeyRegistrationOptions();

      expect(result.success).toBe(false);
    });

    it("未登录时应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);

      const result = await passkeyModule.generatePasskeyRegistrationOptions();

      expect(result.success).toBe(false);
    });

    it("无 reauth token 时应返回未授权", async () => {
      mockCheckReauthToken.mockResolvedValue(false);

      const result = await passkeyModule.generatePasskeyRegistrationOptions();

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("NEED_REAUTH");
    });

    it("用户不存在时应返回错误", async () => {
      mockPrismaUserFindUnique.mockResolvedValue(null);

      const result = await passkeyModule.generatePasskeyRegistrationOptions();

      expect(result.success).toBe(false);
    });

    it("生成成功应返回注册选项", async () => {
      mockPrismaUserFindUnique.mockResolvedValue({
        uid: 1,
        username: "test",
        email: "test@test.com",
      });
      mockGenerateRegistrationOptions.mockResolvedValue({
        challenge: "challenge-value",
      });

      const result = await passkeyModule.generatePasskeyRegistrationOptions();

      expect(result.success).toBe(true);
      expect(result.data?.options.challenge).toBe("challenge-value");
      expect(mockRedisSet).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // verifyPasskeyRegistration
  // ==========================================================================

  describe("verifyPasskeyRegistration", () => {
    const validPayload = {
      response: { id: "cred-id", response: {} },
      name: "My Key",
    };

    it("速率限制触发时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);

      const result =
        await passkeyModule.verifyPasskeyRegistration(validPayload);

      expect(result.success).toBe(false);
    });

    it("未登录时应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);

      const result =
        await passkeyModule.verifyPasskeyRegistration(validPayload);

      expect(result.success).toBe(false);
    });

    it("挑战已过期时应返回错误", async () => {
      mockRedisGet.mockResolvedValue(null);

      const result =
        await passkeyModule.verifyPasskeyRegistration(validPayload);

      expect(result.success).toBe(false);
    });

    it("验证失败时应返回错误", async () => {
      mockRedisGet.mockResolvedValue("expected-challenge");
      mockVerifyRegistrationResponse.mockResolvedValue({
        verified: false,
        registrationInfo: null,
      });

      const result =
        await passkeyModule.verifyPasskeyRegistration(validPayload);

      expect(result.success).toBe(false);
    });

    it("注册成功应保存通行密钥", async () => {
      mockRedisGet.mockResolvedValue("expected-challenge");
      mockVerifyRegistrationResponse.mockResolvedValue({
        verified: true,
        registrationInfo: {
          credential: {
            id: "cred-id",
            publicKey: new Uint8Array([1, 2, 3]),
            counter: 0,
          },
          credentialDeviceType: "platform",
        },
      });

      const result =
        await passkeyModule.verifyPasskeyRegistration(validPayload);

      expect(result.success).toBe(true);
      expect(mockPrismaPasskeyCreate).toHaveBeenCalled();
      expect(mockRedisDel).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // generatePasskeyAuthenticationOptions
  // ==========================================================================

  describe("generatePasskeyAuthenticationOptions", () => {
    it("速率限制触发时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);

      const result = await passkeyModule.generatePasskeyAuthenticationOptions();

      expect(result.success).toBe(false);
    });

    it("生成成功应返回认证选项和 nonce", async () => {
      mockGenerateAuthenticationOptions.mockResolvedValue({
        challenge: "auth-challenge",
      });

      const result = await passkeyModule.generatePasskeyAuthenticationOptions();

      expect(result.success).toBe(true);
      expect(result.data?.nonce).toBeDefined();
      expect(result.data?.options.challenge).toBe("auth-challenge");
    });
  });

  // ==========================================================================
  // verifyPasskeyAuthentication
  // ==========================================================================

  describe("verifyPasskeyAuthentication", () => {
    const validPayload = {
      nonce: "test-nonce",
      response: { id: "cred-id", response: {} },
    };

    it("速率限制触发时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);

      const result =
        await passkeyModule.verifyPasskeyAuthentication(validPayload);

      expect(result.success).toBe(false);
    });

    it("挑战已过期时应返回错误", async () => {
      mockRedisGet.mockResolvedValue(null);

      const result =
        await passkeyModule.verifyPasskeyAuthentication(validPayload);

      expect(result.success).toBe(false);
    });

    it("未找到通行密钥时应返回错误", async () => {
      mockRedisGet.mockResolvedValue("expected-challenge");
      mockPrismaPasskeyFindUnique.mockResolvedValue(null);

      const result =
        await passkeyModule.verifyPasskeyAuthentication(validPayload);

      expect(result.success).toBe(false);
    });

    it("验证失败时应返回错误", async () => {
      mockRedisGet.mockResolvedValue("expected-challenge");
      mockPrismaPasskeyFindUnique.mockResolvedValue({
        credentialId: "cred-id",
        userUid: 1,
        publicKey: Buffer.from([1, 2, 3]).toString("base64"),
        counter: 0n,
      });
      mockVerifyAuthenticationResponse.mockResolvedValue({
        verified: false,
        authenticationInfo: null,
      });

      const result =
        await passkeyModule.verifyPasskeyAuthentication(validPayload);

      expect(result.success).toBe(false);
    });

    it("用户被禁用时应返回禁止", async () => {
      mockRedisGet.mockResolvedValue("expected-challenge");
      mockPrismaPasskeyFindUnique.mockResolvedValue({
        credentialId: "cred-id",
        userUid: 1,
        publicKey: Buffer.from([1, 2, 3]).toString("base64"),
        counter: 0n,
      });
      mockVerifyAuthenticationResponse.mockResolvedValue({
        verified: true,
        authenticationInfo: {
          credentialID: "cred-id",
          newCounter: 1,
        },
      });
      mockPrismaUserFindUnique.mockResolvedValue({
        uid: 1,
        username: "test",
        nickname: "T",
        email: "t@t.com",
        avatar: null,
        role: "USER",
        status: "SUSPENDED",
        deletedAt: null,
      });

      const result =
        await passkeyModule.verifyPasskeyAuthentication(validPayload);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("ACCOUNT_DISABLED");
    });

    it("认证成功应发放 token 并返回用户信息", async () => {
      mockRedisGet.mockResolvedValue("expected-challenge");
      mockPrismaPasskeyFindUnique.mockResolvedValue({
        credentialId: "cred-id",
        userUid: 1,
        publicKey: Buffer.from([1, 2, 3]).toString("base64"),
        counter: 0n,
      });
      mockVerifyAuthenticationResponse.mockResolvedValue({
        verified: true,
        authenticationInfo: {
          credentialID: "cred-id",
          newCounter: 1,
        },
      });
      mockPrismaUserFindUnique.mockResolvedValue({
        uid: 1,
        username: "test",
        nickname: "T",
        email: "t@t.com",
        avatar: null,
        role: "USER",
        status: "ACTIVE",
        deletedAt: null,
      });
      mockPrismaRefreshTokenCreate.mockResolvedValue({ id: "rt-1" });

      const result =
        await passkeyModule.verifyPasskeyAuthentication(validPayload);

      expect(result.success).toBe(true);
      expect(result.data?.userInfo.username).toBe("test");
    });
  });

  // ==========================================================================
  // verifyPasskeyForReauth
  // ==========================================================================

  describe("verifyPasskeyForReauth", () => {
    const validPayload = {
      nonce: "reauth-nonce",
      response: { id: "cred-id", response: {} },
    };

    it("速率限制触发时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);

      const result = await passkeyModule.verifyPasskeyForReauth(validPayload);

      expect(result.success).toBe(false);
    });

    it("未登录时应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);

      const result = await passkeyModule.verifyPasskeyForReauth(validPayload);

      expect(result.success).toBe(false);
    });

    it("挑战已过期时应返回错误", async () => {
      mockRedisGet.mockResolvedValue(null);

      const result = await passkeyModule.verifyPasskeyForReauth(validPayload);

      expect(result.success).toBe(false);
    });

    it("通行密钥不属于当前用户时应返回禁止", async () => {
      mockRedisGet.mockResolvedValue("expected-challenge");
      mockPrismaPasskeyFindUnique.mockResolvedValue({
        credentialId: "cred-id",
        userUid: 999, // 不同用户
        publicKey: Buffer.from([1, 2, 3]).toString("base64"),
        counter: 0n,
      });

      const result = await passkeyModule.verifyPasskeyForReauth(validPayload);

      expect(result.success).toBe(false);
    });

    it("验证成功应设置 REAUTH_TOKEN", async () => {
      mockRedisGet.mockResolvedValue("expected-challenge");
      mockPrismaPasskeyFindUnique.mockResolvedValue({
        credentialId: "cred-id",
        userUid: 1,
        publicKey: Buffer.from([1, 2, 3]).toString("base64"),
        counter: 0n,
      });
      mockVerifyAuthenticationResponse.mockResolvedValue({
        verified: true,
        authenticationInfo: {
          credentialID: "cred-id",
          newCounter: 1,
        },
      });

      const result = await passkeyModule.verifyPasskeyForReauth(validPayload);

      expect(result.success).toBe(true);
      expect(mockCookiesSet).toHaveBeenCalledWith(
        "REAUTH_TOKEN",
        "signed-token",
        expect.any(Object),
      );
    });
  });

  // ==========================================================================
  // listUserPasskeys
  // ==========================================================================

  describe("listUserPasskeys", () => {
    it("未登录时应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);

      const result = await passkeyModule.listUserPasskeys();

      expect(result.success).toBe(false);
    });

    it("获取成功应返回通行密钥列表", async () => {
      mockPrismaPasskeyFindMany.mockResolvedValue([
        {
          credentialId: "cred-1",
          name: "MacBook",
          deviceType: "platform",
          browser: "macOS Safari",
          createdAt: new Date("2024-01-01"),
          lastUsedAt: new Date("2024-06-01"),
        },
      ]);

      const result = await passkeyModule.listUserPasskeys();

      expect(result.success).toBe(true);
      expect(result.data?.items).toHaveLength(1);
      expect(result.data?.items[0]!.name).toBe("MacBook");
      expect(mockPrismaPasskeyFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userUid: 1 } }),
      );
    });
  });

  // ==========================================================================
  // renamePasskey
  // ==========================================================================

  describe("renamePasskey", () => {
    it("未登录时应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);

      const result = await passkeyModule.renamePasskey({
        credentialId: "cred-1",
        name: "New Name",
      });

      expect(result.success).toBe(false);
    });

    it("无 reauth token 时应返回未授权", async () => {
      mockCheckReauthToken.mockResolvedValue(false);

      const result = await passkeyModule.renamePasskey({
        credentialId: "cred-1",
        name: "New Name",
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("NEED_REAUTH");
    });

    it("通行密钥不存在时应返回错误", async () => {
      mockPrismaPasskeyFindUnique.mockResolvedValue(null);

      const result = await passkeyModule.renamePasskey({
        credentialId: "nonexistent",
        name: "New Name",
      });

      expect(result.success).toBe(false);
    });

    it("通行密钥不属于当前用户时应返回错误", async () => {
      mockPrismaPasskeyFindUnique.mockResolvedValue({
        credentialId: "cred-1",
        userUid: 999,
        name: "Old Name",
      });

      const result = await passkeyModule.renamePasskey({
        credentialId: "cred-1",
        name: "New Name",
      });

      expect(result.success).toBe(false);
    });

    it("重命名成功应返回成功消息", async () => {
      mockPrismaPasskeyFindUnique.mockResolvedValue({
        credentialId: "cred-1",
        userUid: 1,
        name: "Old Name",
      });

      const result = await passkeyModule.renamePasskey({
        credentialId: "cred-1",
        name: "New Name",
      });

      expect(result.success).toBe(true);
      expect(mockPrismaPasskeyUpdate).toHaveBeenCalledWith({
        where: { credentialId: "cred-1" },
        data: { name: "New Name" },
      });
    });
  });

  // ==========================================================================
  // deletePasskey
  // ==========================================================================

  describe("deletePasskey", () => {
    it("未登录时应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);

      const result = await passkeyModule.deletePasskey({
        credentialId: "cred-1",
      });

      expect(result.success).toBe(false);
    });

    it("无 reauth token 时应返回未授权", async () => {
      mockCheckReauthToken.mockResolvedValue(false);

      const result = await passkeyModule.deletePasskey({
        credentialId: "cred-1",
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("NEED_REAUTH");
    });

    it("通行密钥不存在时应返回错误", async () => {
      mockPrismaPasskeyFindUnique.mockResolvedValue(null);

      const result = await passkeyModule.deletePasskey({
        credentialId: "nonexistent",
      });

      expect(result.success).toBe(false);
    });

    it("删除成功应返回成功消息", async () => {
      mockPrismaPasskeyFindUnique.mockResolvedValue({
        credentialId: "cred-1",
        userUid: 1,
        name: "My Key",
      });

      const result = await passkeyModule.deletePasskey({
        credentialId: "cred-1",
      });

      expect(result.success).toBe(true);
      expect(mockPrismaPasskeyDelete).toHaveBeenCalledWith({
        where: { credentialId: "cred-1" },
      });
    });
  });
});
