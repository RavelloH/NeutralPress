import { beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================================
// Mocks
// ============================================================================

const mockHeadersGet = vi.fn();
vi.mock("next/headers", () => ({
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
  RATE_LIMITS: {
    GUEST: 60,
    USER: 120,
    ADMIN: 300,
  },
}));

const mockAuthVerify = vi.fn();
vi.mock("@/lib/server/auth-verify", () => ({
  authVerify: (...args: unknown[]) => mockAuthVerify(...args),
}));

const mockValidateData = vi.fn();
vi.mock("@/lib/server/validator", () => ({
  validateData: (...args: unknown[]) => mockValidateData(...args),
}));

vi.mock("@/lib/server/audit", () => ({
  logAuditEvent: vi.fn(),
}));

const mockGenerateCacheKey = vi.fn();
const mockGetCache = vi.fn();
const mockSetCache = vi.fn();
vi.mock("@/lib/server/cache", () => ({
  generateCacheKey: (...args: unknown[]) => mockGenerateCacheKey(...args),
  getCache: (...args: unknown[]) => mockGetCache(...args),
  setCache: (...args: unknown[]) => mockSetCache(...args),
}));

const mockResolveIpLocation = vi.fn();
vi.mock("@/lib/server/ip-utils", () => ({
  resolveIpLocation: (...args: unknown[]) => mockResolveIpLocation(...args),
}));

const mockRedisScan = vi.fn();
const mockRedisZcount = vi.fn();
const mockRedisGet = vi.fn();
const mockRedisSet = vi.fn();
const mockRedisDel = vi.fn();
const mockRedisTtl = vi.fn();
const mockRedisZrangebyscore = vi.fn();
const mockRedisZrevrange = vi.fn();
const mockRedisPipeline = vi.fn();
const mockEnsureRedisConnection = vi.fn();
vi.mock("@/lib/server/redis", () => ({
  default: {
    scan: (...args: unknown[]) => mockRedisScan(...args),
    zcount: (...args: unknown[]) => mockRedisZcount(...args),
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
    del: (...args: unknown[]) => mockRedisDel(...args),
    ttl: (...args: unknown[]) => mockRedisTtl(...args),
    zrangebyscore: (...args: unknown[]) => mockRedisZrangebyscore(...args),
    zrevrange: (...args: unknown[]) => mockRedisZrevrange(...args),
    pipeline: (...args: unknown[]) => mockRedisPipeline(...args),
  },
  ensureRedisConnection: (...args: unknown[]) =>
    mockEnsureRedisConnection(...args),
}));

// ============================================================================
// 测试
// ============================================================================

describe("security actions", () => {
  let securityModule: typeof import("@/actions/security");

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    mockLimitControl.mockResolvedValue(true);
    mockValidateData.mockReturnValue(undefined); // 验证通过
    mockAuthVerify.mockResolvedValue({
      uid: 1,
      username: "admin",
      role: "ADMIN",
    });
    mockEnsureRedisConnection.mockResolvedValue(undefined);
    mockGenerateCacheKey.mockReturnValue("cache-key");
    mockGetCache.mockResolvedValue(null);
    mockResolveIpLocation.mockReturnValue(null);
    mockHeadersGet.mockReturnValue(null);

    securityModule = await import("@/actions/security");
  });

  // ==========================================================================
  // getSecurityOverview
  // ==========================================================================

  describe("getSecurityOverview", () => {
    it("速率限制触发时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);

      const result = await securityModule.getSecurityOverview();

      expect(result.success).toBe(false);
    });

    it("验证失败时应返回错误", async () => {
      mockValidateData.mockReturnValue({
        message: "验证失败",
        error: { code: "VALIDATION_ERROR", message: "验证失败" },
      });

      const result = await securityModule.getSecurityOverview();

      expect(result.success).toBe(false);
    });

    it("非管理员应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);

      const result = await securityModule.getSecurityOverview();

      expect(result.success).toBe(false);
    });

    it("有缓存时应返回缓存数据", async () => {
      const cachedData = {
        activeIPs: 5,
        bannedIPs: 1,
        currentHourRequests: 100,
        hourlyTrends: [],
        rateLimitedIPs: 0,
        totalRequests: 1000,
        totalSuccess: 900,
        totalError: 100,
        last24hSuccess: 500,
        last24hError: 50,
        last24hActiveHours: 24,
        last30dSuccess: 10000,
        last30dError: 1000,
        last30dActiveDays: 30,
        cache: true,
        updatedAt: new Date().toISOString(),
      };
      mockGetCache.mockResolvedValue(cachedData);

      const result = await securityModule.getSecurityOverview();

      expect(result.success).toBe(true);
      expect(result.data).toEqual(cachedData);
    });

    it("无缓存时应从 Redis 查询数据", async () => {
      mockGetCache.mockResolvedValue(null);
      // scanKeys 返回空
      mockRedisScan.mockResolvedValue(["0", []]);
      // 全局统计
      mockRedisGet.mockResolvedValue("0");
      // Pipeline mock
      const mockExec = vi.fn().mockResolvedValue([]);
      mockRedisPipeline.mockReturnValue({
        get: vi.fn(),
        exec: mockExec,
      });

      const result = await securityModule.getSecurityOverview();

      expect(result.success).toBe(true);
      expect(result.data?.totalRequests).toBe(0);
    });
  });

  // ==========================================================================
  // getIPList
  // ==========================================================================

  describe("getIPList", () => {
    const validParams = {
      access_token: "admin-token",
      page: 1,
      pageSize: 10,
      filter: "all" as const,
      sortBy: "ip" as const,
      sortOrder: "desc" as const,
    };

    it("速率限制触发时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);

      const result = await securityModule.getIPList(validParams);

      expect(result.success).toBe(false);
    });

    it("非管理员应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);

      const result = await securityModule.getIPList(validParams);

      expect(result.success).toBe(false);
    });

    it("获取成功应返回 IP 列表", async () => {
      let scanCallCount = 0;
      mockRedisScan.mockImplementation(() => {
        scanCallCount++;
        if (scanCallCount === 1) {
          // rateLimitKeys scan
          return Promise.resolve(["0", ["np:rate:ip:1.2.3.4"]]);
        }
        // banKeys scan
        return Promise.resolve(["0", []]);
      });
      mockRedisZcount.mockResolvedValue(5);
      mockRedisZrevrange.mockResolvedValue(["1234", String(Date.now())]);
      mockRedisTtl.mockResolvedValue(3600);
      mockRedisGet.mockResolvedValue(null);

      const result = await securityModule.getIPList(validParams);

      expect(result.success).toBe(true);
      expect(result.data?.items).toHaveLength(1);
      expect(result.data?.items[0]!.ip).toBe("1.2.3.4");
    });
  });

  // ==========================================================================
  // banIP
  // ==========================================================================

  describe("banIP", () => {
    const validParams = {
      access_token: "admin-token",
      ip: "1.2.3.4",
      duration: 3600,
      reason: "恶意请求",
    };

    it("速率限制触发时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);

      const result = await securityModule.banIP(validParams);

      expect(result.success).toBe(false);
    });

    it("非管理员应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);

      const result = await securityModule.banIP(validParams);

      expect(result.success).toBe(false);
    });

    it("封禁成功应返回封禁信息", async () => {
      const result = await securityModule.banIP(validParams);

      expect(result.success).toBe(true);
      expect(result.data?.ip).toBe("1.2.3.4");
      expect(result.data?.reason).toBe("恶意请求");
      expect(mockRedisSet).toHaveBeenCalled();
    });

    it("无 reason 时使用默认原因", async () => {
      const result = await securityModule.banIP({
        access_token: "admin-token",
        ip: "5.6.7.8",
        duration: 3600,
      });

      expect(result.success).toBe(true);
      expect(result.data?.reason).toBeUndefined();
    });
  });

  // ==========================================================================
  // unbanIP
  // ==========================================================================

  describe("unbanIP", () => {
    const validParams = {
      access_token: "admin-token",
      ip: "1.2.3.4",
    };

    it("速率限制触发时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);

      const result = await securityModule.unbanIP(validParams);

      expect(result.success).toBe(false);
    });

    it("非管理员应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);

      const result = await securityModule.unbanIP(validParams);

      expect(result.success).toBe(false);
    });

    it("解封成功应返回结果", async () => {
      mockRedisDel.mockResolvedValue(1);

      const result = await securityModule.unbanIP(validParams);

      expect(result.success).toBe(true);
      expect(result.data?.ip).toBe("1.2.3.4");
      expect(result.data?.unbanned).toBe(true);
    });

    it("IP 未被封禁时 unbanned 应为 false", async () => {
      mockRedisDel.mockResolvedValue(0);

      const result = await securityModule.unbanIP(validParams);

      expect(result.success).toBe(true);
      expect(result.data?.unbanned).toBe(false);
    });
  });

  // ==========================================================================
  // clearRateLimit
  // ==========================================================================

  describe("clearRateLimit", () => {
    const validParams = {
      access_token: "admin-token",
      ip: "1.2.3.4",
    };

    it("速率限制触发时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);

      const result = await securityModule.clearRateLimit(validParams);

      expect(result.success).toBe(false);
    });

    it("非管理员应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);

      const result = await securityModule.clearRateLimit(validParams);

      expect(result.success).toBe(false);
    });

    it("清除成功应返回结果", async () => {
      mockRedisDel.mockResolvedValue(1);

      const result = await securityModule.clearRateLimit(validParams);

      expect(result.success).toBe(true);
      expect(result.data?.ip).toBe("1.2.3.4");
      expect(result.data?.cleared).toBe(true);
    });
  });

  // ==========================================================================
  // getEndpointStats
  // ==========================================================================

  describe("getEndpointStats", () => {
    const validParams = {
      access_token: "admin-token",
      hours: 24,
    };

    it("速率限制触发时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);

      const result = await securityModule.getEndpointStats(validParams);

      expect(result.success).toBe(false);
    });

    it("非管理员应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);

      const result = await securityModule.getEndpointStats(validParams);

      expect(result.success).toBe(false);
    });

    it("获取成功应返回端点统计", async () => {
      // 使用旧版格式 apiName:timestamp，其中 timestamp 是纯数字
      mockRedisZrangebyscore.mockResolvedValue([
        "api/users:1234567890",
        "api/posts:1234567890",
        "api/users:1234567891",
      ]);

      const result = await securityModule.getEndpointStats(validParams);

      expect(result.success).toBe(true);
      expect(result.data?.endpoints).toHaveLength(2);
      expect(result.data?.totalRequests).toBe(3);
      // api/users 应排在前面（2次 > 1次）
      expect(result.data?.endpoints[0]!.endpoint).toBe("api/users");
      expect(result.data?.endpoints[0]!.count).toBe(2);
    });
  });

  // ==========================================================================
  // getRequestTrends
  // ==========================================================================

  describe("getRequestTrends", () => {
    const validParams = {
      access_token: "admin-token",
      hours: 24,
      granularity: "hour" as const,
    };

    it("速率限制触发时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);

      const result = await securityModule.getRequestTrends(validParams);

      expect(result.success).toBe(false);
    });

    it("非管理员应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);

      const result = await securityModule.getRequestTrends(validParams);

      expect(result.success).toBe(false);
    });

    it("小时粒度获取成功应返回趋势数据", async () => {
      const mockExec = vi.fn().mockResolvedValue([
        [null, "10"], // success
        [null, "2"], // error
      ]);
      mockRedisPipeline.mockReturnValue({
        get: vi.fn(),
        exec: mockExec,
      });

      const result = await securityModule.getRequestTrends({
        ...validParams,
        hours: 1,
        granularity: "hour",
      });

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data?.[0]!.count).toBe(12);
    });
  });

  // ===== 分支覆盖补充测试 =====

  describe("getSecurityOverview 分支", () => {
    it("force=true 时跳过缓存", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockRedisGet.mockResolvedValue(null);
      mockRedisScan.mockResolvedValue(["0", []]);
      const mod = await import("@/actions/security");
      const result = await mod.getSecurityOverview({
        access_token: "token",
        force: true,
      });
      expect(result.success).toBe(true);
    });

    it("数据库错误时返回失败", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockRedisGet.mockRejectedValue(new Error("Redis error"));
      const mod = await import("@/actions/security");
      const result = await mod.getSecurityOverview({
        access_token: "token",
        force: true,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("getIPList 分支", () => {
    it("带 filter=banned 过滤", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockRedisScan.mockResolvedValue(["0", ["1.2.3.4"]]);
      mockRedisGet.mockResolvedValue("10");
      mockRedisTtl.mockResolvedValue(3600);
      mockRedisZcount.mockResolvedValue(5);
      const mod = await import("@/actions/security");
      const result = await mod.getIPList({
        access_token: "token",
        filter: "banned",
        page: 1,
        pageSize: 10,
        sortBy: "ip",
        sortOrder: "desc",
      } as any);
      expect(result.success).toBe(true);
    });

    it("带 search 过滤", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockRedisScan.mockResolvedValue(["0", ["1.2.3.4", "5.6.7.8"]]);
      mockRedisGet.mockResolvedValue("10");
      mockRedisTtl.mockResolvedValue(3600);
      mockRedisZcount.mockResolvedValue(5);
      const mod = await import("@/actions/security");
      const result = await mod.getIPList({
        access_token: "token",
        search: "1.2",
        page: 1,
        pageSize: 10,
        filter: "all",
        sortBy: "ip",
        sortOrder: "desc",
      } as any);
      expect(result.success).toBe(true);
    });

    it("数据库错误时返回失败", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockRedisScan.mockRejectedValue(new Error("Redis error"));
      const mod = await import("@/actions/security");
      const result = await mod.getIPList({
        access_token: "token",
        page: 1,
        pageSize: 10,
        filter: "all",
        sortBy: "ip",
        sortOrder: "desc",
      } as any);
      expect(result.success).toBe(false);
    });
  });

  describe("banIP 分支", () => {
    it("数据库错误时返回失败", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockRedisSet.mockRejectedValue(new Error("Redis error"));
      const mod = await import("@/actions/security");
      const result = await mod.banIP({
        access_token: "token",
        ip: "1.2.3.4",
        duration: 3600,
      } as any);
      expect(result.success).toBe(false);
    });
  });

  describe("clearRateLimit 分支", () => {
    it("del 返回 0 时 cleared=false", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockRedisDel.mockResolvedValue(0);
      const mod = await import("@/actions/security");
      const result = await mod.clearRateLimit({
        access_token: "token",
        ip: "1.2.3.4",
      });
      expect(result.success).toBe(true);
    });

    it("数据库错误时返回失败", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockRedisDel.mockRejectedValue(new Error("Redis error"));
      const mod = await import("@/actions/security");
      const result = await mod.clearRateLimit({
        access_token: "token",
        ip: "1.2.3.4",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("getEndpointStats 分支", () => {
    it("空结果返回零统计", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockRedisZrangebyscore.mockResolvedValue([]);
      const mod = await import("@/actions/security");
      const result = await mod.getEndpointStats({
        access_token: "token",
        hours: 24,
      } as any);
      expect(result.success).toBe(true);
    });

    it("数据库错误时返回失败", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockRedisZrangebyscore.mockRejectedValue(new Error("Redis error"));
      const mod = await import("@/actions/security");
      const result = await mod.getEndpointStats({
        access_token: "token",
        hours: 24,
      } as any);
      expect(result.success).toBe(false);
    });
  });

  describe("getRequestTrends 分支", () => {
    it("数据库错误时返回失败", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockRedisPipeline.mockReturnValue({
        get: vi.fn(),
        exec: vi.fn().mockRejectedValue(new Error("Redis error")),
      });
      const mod = await import("@/actions/security");
      const result = await mod.getRequestTrends({
        access_token: "token",
        hours: 24,
        granularity: "hour",
      });
      expect(result.success).toBe(false);
    });
  });
});
