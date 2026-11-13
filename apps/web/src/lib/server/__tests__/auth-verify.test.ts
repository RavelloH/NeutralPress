import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock next/headers 的 cookies 函数
const mockCookiesGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: vi.fn(() => ({
    get: mockCookiesGet,
  })),
}));

// Mock jwt 模块
const mockJwtTokenVerify = vi.fn();
const mockRefreshTokenFindUnique = vi.fn();
vi.mock("@/lib/server/jwt", () => ({
  jwtTokenVerify: (...args: unknown[]) => mockJwtTokenVerify(...args),
}));
vi.mock("@/lib/server/prisma", () => ({
  default: {
    refreshToken: {
      findUnique: (...args: unknown[]) => mockRefreshTokenFindUnique(...args),
    },
  },
}));

function mockValidAccessToken(payload: {
  uid: number;
  username: string;
  nickname: string;
  role?: string;
  iat: number;
  exp: number;
}) {
  Object.assign(payload, {
    type: "access",
    sessionId: `session-${payload.uid}`,
  });
  mockJwtTokenVerify.mockReturnValue(payload);
  mockRefreshTokenFindUnique.mockResolvedValue({
    userUid: payload.uid,
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    user: {
      uid: payload.uid,
      username: payload.username,
      nickname: payload.nickname,
      role: payload.role || "USER",
      status: "ACTIVE",
      deletedAt: null,
    },
  });
}

describe("auth-verify", () => {
  let authVerify: typeof import("@/lib/server/auth-verify").authVerify;
  let verifyAccessToken: typeof import("@/lib/server/auth-verify").verifyAccessToken;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    const mod = await import("@/lib/server/auth-verify");
    authVerify = mod.authVerify;
    verifyAccessToken = mod.verifyAccessToken;
  });

  // ==========================================================================
  // Token 获取
  // ==========================================================================

  describe("token 获取", () => {
    it("应优先使用传入的 accessToken", async () => {
      const mockPayload = {
        uid: 1,
        username: "test",
        nickname: "T",
        role: "USER",
        iat: 1,
        exp: 9999,
      };
      mockValidAccessToken(mockPayload);

      const result = await authVerify({
        allowedRoles: ["USER"],
        accessToken: "explicit-token",
      });

      expect(result).toEqual(mockPayload);
      expect(mockJwtTokenVerify).toHaveBeenCalledWith("explicit-token");
      // 不应调用 cookies()
      expect(mockCookiesGet).not.toHaveBeenCalled();
    });

    it("未传入 accessToken 时应从 cookie 中读取", async () => {
      const mockPayload = {
        uid: 2,
        username: "cookie_user",
        nickname: "C",
        role: "ADMIN",
        iat: 1,
        exp: 9999,
      };
      mockValidAccessToken(mockPayload);
      mockCookiesGet.mockReturnValue({ value: "cookie-token" });

      const result = await authVerify({
        allowedRoles: ["ADMIN"],
      });

      expect(result).toEqual(mockPayload);
      expect(mockCookiesGet).toHaveBeenCalledWith("ACCESS_TOKEN");
      expect(mockJwtTokenVerify).toHaveBeenCalledWith("cookie-token");
    });

    it("accessToken 为空字符串时应从 cookie 中读取", async () => {
      const mockPayload = {
        uid: 3,
        username: "fallback",
        nickname: "F",
        role: "USER",
        iat: 1,
        exp: 9999,
      };
      mockValidAccessToken(mockPayload);
      mockCookiesGet.mockReturnValue({ value: "fallback-token" });

      const result = await authVerify({
        allowedRoles: ["USER"],
        accessToken: "",
      });

      expect(mockCookiesGet).toHaveBeenCalledWith("ACCESS_TOKEN");
      expect(result).toEqual(mockPayload);
    });
  });

  // ==========================================================================
  // Token 不存在
  // ==========================================================================

  describe("token 不存在", () => {
    it("无 accessToken 且 cookie 中无 ACCESS_TOKEN 时应返回 null", async () => {
      mockCookiesGet.mockReturnValue(undefined);

      const result = await authVerify({
        allowedRoles: ["USER"],
      });

      expect(result).toBeNull();
    });

    it("cookie 的 value 为 undefined 时应返回 null", async () => {
      mockCookiesGet.mockReturnValue({ value: undefined });

      const result = await authVerify({
        allowedRoles: ["USER"],
      });

      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // Token 验证失败
  // ==========================================================================

  describe("token 验证失败", () => {
    it("jwtTokenVerify 返回 null 时应返回 null", async () => {
      mockJwtTokenVerify.mockReturnValue(null);

      const result = await authVerify({
        allowedRoles: ["USER"],
        accessToken: "invalid-token",
      });

      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // 角色权限验证
  // ==========================================================================

  describe("角色权限验证", () => {
    it("用户角色在允许列表中时应返回用户信息", async () => {
      const mockPayload = {
        uid: 1,
        username: "editor",
        nickname: "E",
        role: "EDITOR",
        iat: 1,
        exp: 9999,
      };
      mockValidAccessToken(mockPayload);

      const result = await authVerify({
        allowedRoles: ["EDITOR", "ADMIN"],
        accessToken: "valid-token",
      });

      expect(result).toEqual(mockPayload);
    });

    it("用户角色不在允许列表中时应返回 null", async () => {
      const mockPayload = {
        uid: 1,
        username: "user",
        nickname: "U",
        role: "USER",
        iat: 1,
        exp: 9999,
      };
      mockValidAccessToken(mockPayload);

      const result = await authVerify({
        allowedRoles: ["ADMIN", "EDITOR"],
        accessToken: "valid-token",
      });

      expect(result).toBeNull();
    });

    it("允许列表为空时应返回 null", async () => {
      const mockPayload = {
        uid: 1,
        username: "user",
        nickname: "U",
        role: "USER",
        iat: 1,
        exp: 9999,
      };
      mockValidAccessToken(mockPayload);

      const result = await authVerify({
        allowedRoles: [],
        accessToken: "valid-token",
      });

      expect(result).toBeNull();
    });

    it("应支持 AUTHOR 角色", async () => {
      const mockPayload = {
        uid: 5,
        username: "author",
        nickname: "A",
        role: "AUTHOR",
        iat: 1,
        exp: 9999,
      };
      mockValidAccessToken(mockPayload);

      const result = await authVerify({
        allowedRoles: ["AUTHOR"],
        accessToken: "valid-token",
      });

      expect(result).toEqual(mockPayload);
    });

    it("应支持多角色同时允许", async () => {
      const roles = ["USER", "ADMIN", "EDITOR", "AUTHOR"] as const;

      for (const role of roles) {
        const mockPayload = {
          uid: 1,
          username: "u",
          nickname: "U",
          role,
          iat: 1,
          exp: 9999,
        };
        mockValidAccessToken(mockPayload);

        const result = await authVerify({
          allowedRoles: [...roles],
          accessToken: "token",
        });

        expect(result).toEqual(mockPayload);
      }
    });
  });

  // ==========================================================================
  // 边界情况
  // ==========================================================================

  describe("边界情况", () => {
    it("缺少 access 类型时应返回 null", async () => {
      const mockPayload = {
        uid: 1,
        username: "norole",
        nickname: "N",
        iat: 1,
        exp: 9999,
      };
      mockJwtTokenVerify.mockReturnValue({
        ...mockPayload,
        sessionId: "session-1",
      });

      const result = await authVerify({
        allowedRoles: ["USER"],
        accessToken: "token",
      });

      expect(result).toBeNull();
    });

    it("cookie 中存在多个同名字段时取第一个", async () => {
      const mockPayload = {
        uid: 1,
        username: "test",
        nickname: "T",
        role: "USER",
        iat: 1,
        exp: 9999,
      };
      mockValidAccessToken(mockPayload);
      // cookies.get 返回单个 cookie 对象
      mockCookiesGet.mockReturnValue({ value: "first-token" });

      const result = await authVerify({
        allowedRoles: ["USER"],
      });

      expect(mockJwtTokenVerify).toHaveBeenCalledWith("first-token");
      expect(result).toEqual(mockPayload);
    });
  });

  describe("数据库会话状态", () => {
    it("撤销、过期、缺失或用户不匹配的会话必须拒绝", async () => {
      const payload = {
        uid: 7,
        username: "user",
        nickname: "User",
        role: "ADMIN",
        iat: 1,
        exp: 9999,
      };
      mockValidAccessToken(payload);

      for (const invalidSession of [
        null,
        {
          userUid: 7,
          expiresAt: new Date(Date.now() + 60_000),
          revokedAt: new Date(),
          user: {
            uid: 7,
            username: "user",
            nickname: "User",
            role: "ADMIN",
            status: "ACTIVE",
            deletedAt: null,
          },
        },
        {
          userUid: 8,
          expiresAt: new Date(Date.now() + 60_000),
          revokedAt: null,
          user: {
            uid: 8,
            username: "other",
            nickname: null,
            role: "ADMIN",
            status: "ACTIVE",
            deletedAt: null,
          },
        },
      ]) {
        mockRefreshTokenFindUnique.mockResolvedValueOnce(invalidSession);
        expect(await verifyAccessToken("access-token")).toBeNull();
      }
    });

    it("用户禁用或软删除后拒绝，且返回数据库当前角色", async () => {
      mockJwtTokenVerify.mockReturnValue({
        uid: 9,
        username: "stale-name",
        nickname: "stale",
        role: "ADMIN",
        type: "access",
        sessionId: "session-9",
        iat: 1,
        exp: 9999,
      });

      mockRefreshTokenFindUnique.mockResolvedValueOnce({
        userUid: 9,
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
        user: {
          uid: 9,
          username: "current-name",
          nickname: null,
          role: "USER",
          status: "ACTIVE",
          deletedAt: null,
        },
      });
      expect(await verifyAccessToken("access-token")).toMatchObject({
        username: "current-name",
        nickname: "current-name",
        role: "USER",
      });

      mockRefreshTokenFindUnique.mockResolvedValueOnce({
        userUid: 9,
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
        user: {
          uid: 9,
          username: "current-name",
          nickname: null,
          role: "USER",
          status: "SUSPENDED",
          deletedAt: null,
        },
      });
      expect(await verifyAccessToken("access-token")).toBeNull();

      mockRefreshTokenFindUnique.mockResolvedValueOnce({
        userUid: 9,
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
        user: {
          uid: 9,
          username: "current-name",
          nickname: null,
          role: "USER",
          status: "ACTIVE",
          deletedAt: new Date(),
        },
      });
      expect(await verifyAccessToken("access-token")).toBeNull();
    });
  });
});
