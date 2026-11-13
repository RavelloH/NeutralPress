import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock Redis
const mockRedis = {
  evalsha: vi.fn(),
  script: vi.fn(),
  exists: vi.fn(),
};
vi.mock("@/lib/server/redis", () => ({
  default: mockRedis,
  ensureRedisConnection: vi.fn(),
}));

// Mock access-token validation
const mockVerifyAccessToken = vi.fn();
vi.mock("@/lib/server/auth-verify", () => ({
  verifyAccessToken: (...args: unknown[]) => mockVerifyAccessToken(...args),
}));

// Mock fs 读取 Lua 脚本（rate-limit.ts 在模块顶层调用 readFileSync）
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    readFileSync: vi.fn((filePath: string, encoding?: string) => {
      if (typeof filePath === "string" && filePath.includes("rate-limit.lua")) {
        return "-- mock lua script";
      }
      return actual.readFileSync(filePath, encoding as BufferEncoding);
    }),
  };
});

describe("rate-limit", () => {
  let rateLimitModule: typeof import("@/lib/server/rate-limit");

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mockVerifyAccessToken.mockResolvedValue(null);
    rateLimitModule = await import("@/lib/server/rate-limit");
  });

  // ==========================================================================
  // extractIpAddress
  // ==========================================================================

  describe("extractIpAddress", () => {
    it("应从 x-real-ip 获取 IP", () => {
      const headers = new Headers({ "x-real-ip": "192.168.1.1" });
      expect(rateLimitModule.extractIpAddress(headers)).toBe("192.168.1.1");
    });

    it("应从 x-forwarded-for 获取第一个 IP", () => {
      const headers = new Headers({
        "x-forwarded-for": "10.0.0.1, 10.0.0.2, 10.0.0.3",
      });
      expect(rateLimitModule.extractIpAddress(headers)).toBe("10.0.0.1");
    });

    it("应从 x-vercel-proxied-for 获取 IP", () => {
      const headers = new Headers({ "x-vercel-proxied-for": "172.16.0.1" });
      expect(rateLimitModule.extractIpAddress(headers)).toBe("172.16.0.1");
    });

    it("无 IP 相关 header 时应返回 unknown", () => {
      const headers = new Headers();
      expect(rateLimitModule.extractIpAddress(headers)).toBe("unknown");
    });

    it("x-real-ip 优先级应高于 x-forwarded-for", () => {
      const headers = new Headers({
        "x-real-ip": "192.168.1.1",
        "x-forwarded-for": "10.0.0.1",
      });
      expect(rateLimitModule.extractIpAddress(headers)).toBe("192.168.1.1");
    });

    it("x-forwarded-for 为空时应尝试其他 header", () => {
      const headers = new Headers({
        "x-forwarded-for": "",
        "x-vercel-proxied-for": "172.16.0.1",
      });
      expect(rateLimitModule.extractIpAddress(headers)).toBe("172.16.0.1");
    });

    it("应正确处理 x-forwarded-for 中的空格", () => {
      const headers = new Headers({
        "x-forwarded-for": "  10.0.0.1 , 10.0.0.2",
      });
      expect(rateLimitModule.extractIpAddress(headers)).toBe("10.0.0.1");
    });
  });

  // ==========================================================================
  // RATE_LIMITS 常量
  // ==========================================================================

  describe("RATE_LIMITS", () => {
    it("应包含所有角色的速率限制", () => {
      expect(rateLimitModule.RATE_LIMITS.GUEST).toBe(30);
      expect(rateLimitModule.RATE_LIMITS.USER).toBe(60);
      expect(rateLimitModule.RATE_LIMITS.EDITOR).toBe(120);
      expect(rateLimitModule.RATE_LIMITS.ADMIN).toBe(600);
    });

    it("管理员限制应高于其他角色", () => {
      expect(rateLimitModule.RATE_LIMITS.ADMIN).toBeGreaterThan(
        rateLimitModule.RATE_LIMITS.EDITOR,
      );
      expect(rateLimitModule.RATE_LIMITS.EDITOR).toBeGreaterThan(
        rateLimitModule.RATE_LIMITS.USER,
      );
      expect(rateLimitModule.RATE_LIMITS.USER).toBeGreaterThan(
        rateLimitModule.RATE_LIMITS.GUEST,
      );
    });
  });

  // ==========================================================================
  // isIPBanned
  // ==========================================================================

  describe("isIPBanned", () => {
    it("IP 被封禁时应返回 true", async () => {
      mockRedis.exists.mockResolvedValue(1);
      const result = await rateLimitModule.isIPBanned("192.168.1.1");
      expect(result).toBe(true);
    });

    it("IP 未被封禁时应返回 false", async () => {
      mockRedis.exists.mockResolvedValue(0);
      const result = await rateLimitModule.isIPBanned("192.168.1.1");
      expect(result).toBe(false);
    });

    it("Redis 出错时应返回 false（安全回退）", async () => {
      mockRedis.exists.mockRejectedValue(new Error("Redis connection failed"));
      const result = await rateLimitModule.isIPBanned("192.168.1.1");
      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // 默认导出 (limitControl)
  // ==========================================================================

  describe("limitControl", () => {
    it("Lua 脚本返回 1 时应允许请求", async () => {
      mockRedis.script.mockResolvedValue("sha123");
      mockRedis.evalsha.mockResolvedValue(1);

      const headers = new Headers({ "x-real-ip": "192.168.1.1" });
      const result = await rateLimitModule.default(headers, "test-api");
      expect(result).toBe(true);
    });

    it("Lua 脚本返回 0 时应拒绝请求", async () => {
      mockRedis.script.mockResolvedValue("sha123");
      mockRedis.evalsha.mockResolvedValue(0);

      const headers = new Headers({ "x-real-ip": "192.168.1.1" });
      const result = await rateLimitModule.default(headers, "test-api");
      expect(result).toBe(false);
    });

    it("Lua 脚本返回 -1（封禁）时应拒绝请求", async () => {
      mockRedis.script.mockResolvedValue("sha123");
      mockRedis.evalsha.mockResolvedValue(-1);

      const headers = new Headers({ "x-real-ip": "192.168.1.1" });
      const result = await rateLimitModule.default(headers, "test-api");
      expect(result).toBe(false);
    });

    it("Redis 出错时应默认允许请求", async () => {
      mockRedis.script.mockRejectedValue(new Error("Redis down"));

      const headers = new Headers({ "x-real-ip": "192.168.1.1" });
      const result = await rateLimitModule.default(headers, "test-api");
      expect(result).toBe(true);
    });

    it("NOSCRIPT 错误时应重新加载脚本并重试", async () => {
      mockRedis.script.mockResolvedValue("new-sha");
      mockRedis.evalsha
        .mockRejectedValueOnce(new Error("NOSCRIPT No matching script"))
        .mockResolvedValueOnce(1);

      const headers = new Headers({ "x-real-ip": "192.168.1.1" });
      const result = await rateLimitModule.default(headers, "test-api");
      expect(result).toBe(true);
      expect(mockRedis.script).toHaveBeenCalledWith("LOAD", expect.any(String));
      expect(mockRedis.evalsha).toHaveBeenCalledTimes(2);
    });

    it("应使用访客限制（无 token）", async () => {
      mockRedis.script.mockResolvedValue("sha123");
      mockRedis.evalsha.mockResolvedValue(1);

      const headers = new Headers({ "x-real-ip": "192.168.1.1" });
      await rateLimitModule.default(headers, "test-api");

      // 调用 evalsha 时，args 中应包含 GUEST 限制 (30)
      const callArgs = mockRedis.evalsha.mock.calls[0];
      expect(callArgs).toBeDefined();
      // args 格式: sha, keyCount, ...keys, ...args
      // 7 个 keys 之后是 args，args[1] 是 rateLimit
      const args = callArgs!.slice(2 + 7);
      expect(args![1]).toBe("30");
    });

    it("应根据用户角色使用不同的速率限制", async () => {
      mockRedis.script.mockResolvedValue("sha123");
      mockRedis.evalsha.mockResolvedValue(1);

      // ADMIN 角色
      mockVerifyAccessToken.mockResolvedValue({ uid: 1, role: "ADMIN" });
      const adminHeaders = new Headers({
        "x-real-ip": "10.0.0.1",
        cookie: "ACCESS_TOKEN=admin-token",
      });
      await rateLimitModule.default(adminHeaders, "test-api");

      const adminCallArgs = mockRedis.evalsha.mock.calls[0];
      const adminArgs = adminCallArgs!.slice(2 + 7);
      expect(adminArgs![1]).toBe("600");

      vi.clearAllMocks();
      mockRedis.script.mockResolvedValue("sha123");
      mockRedis.evalsha.mockResolvedValue(1);

      // USER 角色
      mockVerifyAccessToken.mockResolvedValue({ uid: 2, role: "USER" });
      const userHeaders = new Headers({
        "x-real-ip": "10.0.0.2",
        cookie: "ACCESS_TOKEN=user-token",
      });
      await rateLimitModule.default(userHeaders, "test-api");

      const userCallArgs = mockRedis.evalsha.mock.calls[0];
      const userArgs = userCallArgs!.slice(2 + 7);
      expect(userArgs![1]).toBe("60");
    });

    it("无效 token 应使用访客限制", async () => {
      mockRedis.script.mockResolvedValue("sha123");
      mockRedis.evalsha.mockResolvedValue(1);
      mockVerifyAccessToken.mockResolvedValue(null);

      const headers = new Headers({
        "x-real-ip": "10.0.0.1",
        cookie: "ACCESS_TOKEN=invalid-token",
      });
      await rateLimitModule.default(headers, "test-api");

      const callArgs = mockRedis.evalsha.mock.calls[0];
      const args = callArgs!.slice(2 + 7);
      expect(args![1]).toBe("30"); // GUEST 限制
    });

    it("应传递 apiName 给 Lua 脚本", async () => {
      mockRedis.script.mockResolvedValue("sha123");
      mockRedis.evalsha.mockResolvedValue(1);

      const headers = new Headers({ "x-real-ip": "192.168.1.1" });
      await rateLimitModule.default(headers, "my-custom-api");

      const callArgs = mockRedis.evalsha.mock.calls[0];
      const args = callArgs!.slice(2 + 7);
      expect(args![2]).toBe("my-custom-api");
    });

    it("未指定 apiName 时应默认为 unknown", async () => {
      mockRedis.script.mockResolvedValue("sha123");
      mockRedis.evalsha.mockResolvedValue(1);

      const headers = new Headers({ "x-real-ip": "192.168.1.1" });
      await rateLimitModule.default(headers);

      const callArgs = mockRedis.evalsha.mock.calls[0];
      const args = callArgs!.slice(2 + 7);
      expect(args![2]).toBe("unknown");
    });
  });
});
