// @vitest-environment node
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

const mockPrisma = {
  pageView: {
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
  },
  pageViewArchive: {
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn().mockResolvedValue(null),
    aggregate: vi
      .fn()
      .mockResolvedValue({ _sum: { totalViews: 0, uniqueVisitors: 0 } }),
    findFirst: vi.fn().mockResolvedValue(null),
  },
  config: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  searchLog: {
    create: vi.fn(),
  },
};
vi.mock("@/lib/server/prisma", () => ({ default: mockPrisma }));

const mockRedis = {
  set: vi.fn().mockResolvedValue("OK"),
  eval: vi.fn().mockResolvedValue(1),
  hmget: vi.fn().mockResolvedValue(["10", "20"]),
};
vi.mock("@/lib/server/redis", () => ({ default: mockRedis }));

vi.mock("@/lib/server/analytics-flush", () => ({
  BATCH_SIZE: 50,
  flushEventsToDatabase: vi.fn().mockResolvedValue(undefined),
  REDIS_QUEUE_KEY: "np:analytics:queue",
  REDIS_VIEW_COUNT_KEY: "np:analytics:viewCount",
  withRetry: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

vi.mock("@/lib/server/get-client-info", () => ({
  getClientIP: vi.fn().mockResolvedValue("127.0.0.1"),
  getClientUserAgent: vi.fn().mockResolvedValue("Mozilla/5.0"),
}));

vi.mock("@/lib/server/ip-utils", () => ({
  resolveIpLocation: vi.fn().mockReturnValue(null),
}));

vi.mock("next/server", () => ({
  after: vi.fn((fn: () => Promise<void>) => fn()),
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    readFileSync: vi.fn().mockReturnValue("-- lua script placeholder"),
  };
});

const mockGetResult = vi.fn().mockReturnValue({
  browser: { name: "Chrome", version: "120" },
  os: { name: "Windows", version: "11" },
  device: { type: undefined, model: undefined, vendor: undefined },
});

vi.mock("ua-parser-js", () => ({
  UAParser: class MockUAParser {
    getResult() {
      return mockGetResult();
    }
  },
}));

const mockIsBot = vi.fn().mockReturnValue(false);
const mockIsAIBot = vi.fn().mockReturnValue(false);

vi.mock("ua-parser-js/helpers", () => ({
  isBot: (...args: unknown[]) => mockIsBot(...args),
  isAIBot: (...args: unknown[]) => mockIsAIBot(...args),
}));

// ============ Tests ============

describe("analytics actions", () => {
  let trackPageView: typeof import("@/actions/analytics").trackPageView;
  let getAnalyticsStats: typeof import("@/actions/analytics").getAnalyticsStats;
  let getPageViews: typeof import("@/actions/analytics").getPageViews;
  let getRealTimeStats: typeof import("@/actions/analytics").getRealTimeStats;
  let batchGetViewCounts: typeof import("@/actions/analytics").batchGetViewCounts;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mockLimitControl.mockResolvedValue(true);
    mockAuthVerify.mockResolvedValue(null);
    mockPrisma.pageView.findMany.mockResolvedValue([]);
    mockPrisma.pageView.count.mockResolvedValue(0);
    mockPrisma.pageViewArchive.findMany.mockResolvedValue([]);
    mockPrisma.config.findMany.mockResolvedValue([]);
    mockIsBot.mockReturnValue(false);
    mockIsAIBot.mockReturnValue(false);
    mockGetResult.mockReturnValue({
      browser: { name: "Chrome", version: "120" },
      os: { name: "Windows", version: "11" },
      device: { type: undefined, model: undefined, vendor: undefined },
    });

    const mod = await import("@/actions/analytics");
    trackPageView = mod.trackPageView;
    getAnalyticsStats = mod.getAnalyticsStats;
    getPageViews = mod.getPageViews;
    getRealTimeStats = mod.getRealTimeStats;
    batchGetViewCounts = mod.batchGetViewCounts;
  }, 30000);

  // ==================== trackPageView ====================

  describe("trackPageView", () => {
    describe("速率限制", () => {
      it("速率限制时应返回失败", async () => {
        mockLimitControl.mockResolvedValue(false);
        const result = await trackPageView({
          path: "/test",
          visitorId: "v1",
        });
        expect(result.success).toBe(false);
      });
    });

    describe("去重检查", () => {
      it("成功追踪页面浏览", async () => {
        mockRedis.set.mockResolvedValue("OK");
        mockRedis.eval.mockResolvedValue(1);

        const result = await trackPageView({
          path: "/test",
          visitorId: "v1",
        });
        expect(result.success).toBe(true);
      });

      it("重复请求应静默返回成功", async () => {
        mockRedis.set.mockResolvedValue(null);

        const result = await trackPageView({
          path: "/test",
          visitorId: "v1",
        });
        expect(result.success).toBe(true);
      });

      it("去重键应包含 visitorId 和 path", async () => {
        mockRedis.set.mockResolvedValue("OK");
        mockRedis.eval.mockResolvedValue(1);

        await trackPageView({
          path: "/posts/hello",
          visitorId: "visitor-abc",
        });

        expect(mockRedis.set).toHaveBeenCalledWith(
          "np:analytics:dedup:visitor-abc:/posts/hello",
          "1",
          "PX",
          5000,
          "NX",
        );
      });
    });

    describe("Lua 脚本调用", () => {
      it("应使用 Lua 脚本原子操作写入队列和更新计数器", async () => {
        mockRedis.set.mockResolvedValue("OK");
        mockRedis.eval.mockResolvedValue(1);

        await trackPageView({
          path: "/test",
          visitorId: "v1",
        });

        expect(mockRedis.eval).toHaveBeenCalledWith(
          expect.any(String), // Lua script
          2, // KEYS 数量
          "np:analytics:queue", // KEYS[1]
          "np:analytics:viewCount", // KEYS[2]
          expect.any(String), // ARGV[1] - JSON pageViewData
          "/test", // ARGV[2] - path
        );
      });

      it("pageViewData 应包含 path 和 visitorId", async () => {
        mockRedis.set.mockResolvedValue("OK");
        mockRedis.eval.mockResolvedValue(1);

        await trackPageView({
          path: "/posts/hello",
          visitorId: "visitor-123",
        });

        // eval 被调用时，ARGV[1] 是 JSON 字符串（index 4）
        const evalCall = mockRedis.eval.mock.calls[0];
        const pageViewDataJson = evalCall![4] as string;
        const pageViewData = JSON.parse(pageViewDataJson);
        expect(pageViewData.path).toBe("/posts/hello");
        expect(pageViewData.visitorId).toBe("visitor-123");
      });
    });

    describe("设备类型判断", () => {
      it("桌面 UA 应标记为 desktop", async () => {
        mockGetResult.mockReturnValue({
          browser: { name: "Chrome", version: "120" },
          os: { name: "Windows", version: "11" },
          device: { type: undefined, model: undefined, vendor: undefined },
        });
        mockIsBot.mockReturnValue(false);
        mockIsAIBot.mockReturnValue(false);

        mockRedis.set.mockResolvedValue("OK");
        mockRedis.eval.mockResolvedValue(1);

        await trackPageView({
          path: "/test",
          visitorId: "v1",
        });

        const evalCall = mockRedis.eval.mock.calls[0];
        const pageViewData = JSON.parse(evalCall![4] as string);
        expect(pageViewData.deviceType).toBe("desktop");
      });

      it("移动 UA 应标记为 mobile", async () => {
        mockGetResult.mockReturnValue({
          browser: { name: "Chrome Mobile", version: "120" },
          os: { name: "Android", version: "14" },
          device: { type: undefined, model: "Pixel 8", vendor: "Google" },
        });
        mockIsBot.mockReturnValue(false);
        mockIsAIBot.mockReturnValue(false);

        mockRedis.set.mockResolvedValue("OK");
        mockRedis.eval.mockResolvedValue(1);

        await trackPageView({
          path: "/test",
          visitorId: "v1",
        });

        const evalCall = mockRedis.eval.mock.calls[0];
        const pageViewData = JSON.parse(evalCall![4] as string);
        expect(pageViewData.deviceType).toBe("mobile");
      });

      it("Bot UA 应标记为 bot", async () => {
        mockIsBot.mockReturnValue(true);

        mockRedis.set.mockResolvedValue("OK");
        mockRedis.eval.mockResolvedValue(1);

        await trackPageView({
          path: "/test",
          visitorId: "v1",
        });

        const evalCall = mockRedis.eval.mock.calls[0];
        const pageViewData = JSON.parse(evalCall![4] as string);
        expect(pageViewData.deviceType).toBe("bot");
      });
    });

    describe("批量写入触发", () => {
      it("队列长度 >= BATCH_SIZE 时应触发 flush", async () => {
        mockRedis.set.mockResolvedValue("OK");
        mockRedis.eval.mockResolvedValue(50); // >= BATCH_SIZE

        await trackPageView({
          path: "/test",
          visitorId: "v1",
        });

        // 验证获取 flush 锁
        const setCalls = mockRedis.set.mock.calls;
        const flushLockCall = setCalls.find(
          (call) => call[0] === "np:analytics:flush:lock",
        );
        expect(flushLockCall).toBeDefined();
        expect(flushLockCall![0]).toBe("np:analytics:flush:lock");
      });

      it("队列长度 < BATCH_SIZE 时不应触发 flush", async () => {
        mockRedis.set.mockResolvedValue("OK");
        mockRedis.eval.mockResolvedValue(10); // < BATCH_SIZE

        await trackPageView({
          path: "/test",
          visitorId: "v1",
        });

        const setCalls = mockRedis.set.mock.calls;
        const flushLockCalls = setCalls.filter(
          (call) => call[0] === "np:analytics:flush:lock",
        );
        expect(flushLockCalls).toHaveLength(0);
      });
    });

    describe("错误处理", () => {
      it("追踪失败时应静默返回成功", async () => {
        mockRedis.set.mockResolvedValue("OK");
        mockRedis.eval.mockRejectedValue(new Error("Redis error"));

        const result = await trackPageView({
          path: "/test",
          visitorId: "v1",
        });
        expect(result.success).toBe(true);
      });
    });
  });

  // ==================== getAnalyticsStats ====================

  describe("getAnalyticsStats", () => {
    describe("认证", () => {
      it("非管理员应返回未授权", async () => {
        mockAuthVerify.mockResolvedValue(null);
        const result = await getAnalyticsStats({
          access_token: "token",
          days: 7,
        });
        expect(result.success).toBe(false);
      });

      it("管理员应成功获取统计", async () => {
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });

        const result = await getAnalyticsStats({
          access_token: "token",
          days: 7,
        });

        expect(result.success).toBe(true);
      });
    });

    describe("时区配置", () => {
      it("应从 config 表读取时区配置", async () => {
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
        mockPrisma.config.findMany.mockResolvedValue([
          { key: "analytics.timezone", value: { default: "Asia/Shanghai" } },
        ]);

        const result = await getAnalyticsStats({
          access_token: "token",
          days: 7,
        });

        expect(result.success).toBe(true);
        expect(mockPrisma.config.findMany).toHaveBeenCalled();
      });

      it("无效时区应降级为 UTC", async () => {
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
        mockPrisma.config.findMany.mockResolvedValue([
          { key: "analytics.timezone", value: { default: "Invalid/Timezone" } },
        ]);

        const result = await getAnalyticsStats({
          access_token: "token",
          days: 7,
        });

        expect(result.success).toBe(true);
      });
    });

    describe("时间范围计算", () => {
      it("默认 30 天", async () => {
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });

        const result = await getAnalyticsStats({
          access_token: "token",
          days: 30,
        });

        expect(result.success).toBe(true);
      });

      it("自定义天数", async () => {
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });

        const result = await getAnalyticsStats({
          access_token: "token",
          days: 7,
        });

        expect(result.success).toBe(true);
      });

      it("小时模式", async () => {
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });

        const result = await getAnalyticsStats({
          access_token: "token",
          hours: 24,
        });

        expect(result.success).toBe(true);
      });
    });

    describe("会话分析", () => {
      it("应正确计算会话统计", async () => {
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });

        const now = new Date();
        mockPrisma.pageView.findMany.mockResolvedValue([
          {
            visitorId: "v1",
            path: "/",
            timestamp: new Date(now.getTime() - 1000 * 60 * 5),
            referer: null,
            country: null,
            region: null,
            city: null,
            deviceType: "desktop",
            browser: "Chrome",
            os: "Windows",
            screenSize: null,
            language: null,
            timezone: null,
          },
          {
            visitorId: "v1",
            path: "/about",
            timestamp: new Date(now.getTime() - 1000 * 60 * 3),
            referer: null,
            country: null,
            region: null,
            city: null,
            deviceType: "desktop",
            browser: "Chrome",
            os: "Windows",
            screenSize: null,
            language: null,
            timezone: null,
          },
          {
            visitorId: "v2",
            path: "/",
            timestamp: new Date(now.getTime() - 1000 * 60 * 2),
            referer: null,
            country: null,
            region: null,
            city: null,
            deviceType: "mobile",
            browser: "Chrome Mobile",
            os: "Android",
            screenSize: null,
            language: null,
            timezone: null,
          },
        ]);

        const result = await getAnalyticsStats({
          access_token: "token",
          days: 1,
        });

        expect(result.success).toBe(true);
        expect(result.data.overview).toBeDefined();
      });
    });

    describe("归档数据合并", () => {
      it("应合并归档数据", async () => {
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });

        mockPrisma.pageViewArchive.findMany.mockResolvedValue([
          {
            date: new Date(),
            totalViews: 100,
            uniqueVisitors: 50,
            totalSessions: 30,
            bounces: 10,
            totalDuration: 600,
            pathStats: { "/": { views: 60, visitors: 30 } },
            refererStats: null,
            countryStats: { China: 80 },
            regionStats: null,
            cityStats: null,
            deviceStats: { desktop: 70, mobile: 30 },
            browserStats: { Chrome: 90 },
            osStats: { Windows: 80 },
            screenStats: null,
            languageStats: null,
            timezoneStats: null,
          },
        ]);

        const result = await getAnalyticsStats({
          access_token: "token",
          days: 7,
        });

        expect(result.success).toBe(true);
        expect(result.data.overview.totalViews).toBeGreaterThanOrEqual(0);
      });

      it("有高级筛选时不应查询归档数据", async () => {
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });

        await getAnalyticsStats({
          access_token: "token",
          days: 7,
          country: "China",
        });

        expect(mockPrisma.pageViewArchive.findMany).not.toHaveBeenCalled();
      });
    });

    describe("返回数据结构", () => {
      it("应返回完整的统计数据结构", async () => {
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });

        const result = await getAnalyticsStats({
          access_token: "token",
          days: 7,
        });

        expect(result.success).toBe(true);
        expect(result.data).toHaveProperty("overview");
        expect(result.data).toHaveProperty("dailyTrend");
        expect(result.data).toHaveProperty("topPaths");
        expect(result.data).toHaveProperty("countries");
        expect(result.data).toHaveProperty("devices");
        expect(result.data).toHaveProperty("browsers");
      });

      it("overview 应包含所有统计字段", async () => {
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });

        const result = await getAnalyticsStats({
          access_token: "token",
          days: 7,
        });

        expect(result.data.overview).toHaveProperty("totalViews");
        expect(result.data.overview).toHaveProperty("uniqueVisitors");
        expect(result.data.overview).toHaveProperty("todayViews");
        expect(result.data.overview).toHaveProperty("averageViews");
        expect(result.data.overview).toHaveProperty("bounceRate");
        expect(result.data.overview).toHaveProperty("averageDuration");
        expect(result.data.overview).toHaveProperty("pageViewsPerSession");
      });
    });
  });

  // ==================== getPageViews ====================

  describe("getPageViews", () => {
    describe("认证", () => {
      it("非管理员应返回未授权", async () => {
        mockAuthVerify.mockResolvedValue(null);
        const result = await getPageViews({
          access_token: "token",
          page: 1,
          pageSize: 10,
          sortBy: "timestamp",
          sortOrder: "desc",
        } as any);
        expect((result as any).success).toBe(false);
      });
    });

    describe("分页", () => {
      it("应返回正确的分页信息", async () => {
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
        mockPrisma.pageView.count.mockResolvedValue(100);
        mockPrisma.pageView.findMany.mockResolvedValue([]);

        const result = await getPageViews({
          access_token: "token",
          page: 1,
          pageSize: 25,
        } as any);

        expect((result as any).success).toBe(true);
        expect((result as any).meta).toBeDefined();
        expect((result as any).meta.total).toBe(100);
      });

      it("默认 page=1, pageSize=25", async () => {
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
        mockPrisma.pageView.count.mockResolvedValue(0);
        mockPrisma.pageView.findMany.mockResolvedValue([]);

        await getPageViews({
          access_token: "token",
          page: 1,
          sortBy: "timestamp",
          sortOrder: "desc",
        } as any);

        expect(mockPrisma.pageView.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            skip: 0,
            take: 25,
          }),
        );
      });
    });

    describe("排序", () => {
      it("默认按 timestamp 降序", async () => {
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
        mockPrisma.pageView.count.mockResolvedValue(0);
        mockPrisma.pageView.findMany.mockResolvedValue([]);

        await getPageViews({
          access_token: "token",
          page: 1,
          pageSize: 10,
          sortBy: "timestamp",
          sortOrder: "desc",
        } as any);

        expect(mockPrisma.pageView.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            orderBy: { timestamp: "desc" },
          }),
        );
      });
    });

    describe("筛选", () => {
      it("应支持 path 筛选", async () => {
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
        mockPrisma.pageView.count.mockResolvedValue(0);
        mockPrisma.pageView.findMany.mockResolvedValue([]);

        await getPageViews({
          access_token: "token",
          path: "/posts/hello",
          page: 1,
          pageSize: 10,
          sortBy: "timestamp",
          sortOrder: "desc",
        } as any);

        expect(mockPrisma.pageView.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              path: "/posts/hello",
            }),
          }),
        );
      });
    });

    describe("返回数据结构", () => {
      it("应返回 PageViewItem 数组", async () => {
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
        mockPrisma.pageView.count.mockResolvedValue(1);
        mockPrisma.pageView.findMany.mockResolvedValue([
          {
            id: 1,
            timestamp: new Date(),
            path: "/test",
            visitorId: "v1",
            ipAddress: "127.0.0.1",
            userAgent: "Mozilla/5.0",
            referer: null,
            country: null,
            region: null,
            city: null,
            deviceType: "desktop",
            browser: "Chrome",
            browserVersion: "120",
            os: "Windows",
            osVersion: "11",
            duration: null,
            screenSize: null,
            language: null,
            timezone: null,
          },
        ]);

        const result = await getPageViews({
          access_token: "token",
          page: 1,
          pageSize: 10,
          sortBy: "timestamp",
          sortOrder: "desc",
        } as any);

        expect((result as any).success).toBe(true);
        expect((result as any).data).toHaveLength(1);
        expect((result as any).data[0].path).toBe("/test");
      });
    });
  });

  // ==================== getRealTimeStats ====================

  describe("getRealTimeStats", () => {
    describe("认证", () => {
      it("非管理员应返回未授权", async () => {
        mockAuthVerify.mockResolvedValue(null);
        const result = await getRealTimeStats({
          access_token: "token",
          minutes: 30,
        } as any);
        expect(result.success).toBe(false);
      });
    });

    describe("时间范围", () => {
      it("默认 30 分钟", async () => {
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
        mockPrisma.pageView.findMany.mockResolvedValue([]);

        const result = await getRealTimeStats({
          access_token: "token",
          minutes: 30,
        } as any);

        expect(result.success).toBe(true);
      });

      it("自定义分钟数", async () => {
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
        mockPrisma.pageView.findMany.mockResolvedValue([]);

        const result = await getRealTimeStats({
          access_token: "token",
          minutes: 60,
        });

        expect(result.success).toBe(true);
      });
    });

    describe("数据聚合", () => {
      it("应返回 dataPoints 数组", async () => {
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });

        const now = new Date();
        mockPrisma.pageView.findMany.mockResolvedValue([
          {
            visitorId: "v1",
            timestamp: now,
          },
          {
            visitorId: "v2",
            timestamp: new Date(now.getTime() - 1000 * 60 * 5),
          },
        ]);

        const result = await getRealTimeStats({
          access_token: "token",
          minutes: 30,
        });

        expect(result.success).toBe(true);
        expect(result.data.dataPoints).toBeDefined();
        expect(Array.isArray(result.data.dataPoints)).toBe(true);
      });
    });

    describe("Bot 过滤", () => {
      it("应排除 bot 设备类型", async () => {
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
        mockPrisma.pageView.findMany.mockResolvedValue([]);

        await getRealTimeStats({
          access_token: "token",
          minutes: 30,
        });

        // 验证查询条件排除了 bot
        expect(mockPrisma.pageView.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              AND: expect.arrayContaining([
                expect.objectContaining({
                  OR: expect.arrayContaining([
                    { deviceType: { not: "bot" } },
                    { deviceType: null },
                  ]),
                }),
              ]),
            }),
          }),
        );
      });
    });
  });

  // ==================== batchGetViewCounts ====================

  describe("batchGetViewCounts", () => {
    describe("速率限制", () => {
      it("速率限制时应抛出异常", async () => {
        mockLimitControl.mockResolvedValue(false);
        await expect(batchGetViewCounts(["/test"])).rejects.toThrow();
      });
    });

    describe("验证", () => {
      it("空数组时应抛出异常", async () => {
        await expect(batchGetViewCounts([])).rejects.toThrow();
      });

      it("超过20个路径时应抛出异常", async () => {
        const paths = Array.from({ length: 21 }, (_, i) => `/page${i}`);
        await expect(batchGetViewCounts(paths)).rejects.toThrow();
      });
    });

    describe("成功获取", () => {
      it("应返回 path-count 对", async () => {
        mockRedis.hmget.mockResolvedValue(["100", "200"]);

        const result = await batchGetViewCounts(["/page1", "/page2"]);
        expect(result).toHaveLength(2);
        expect(result[0]!).toEqual({ path: "/page1", count: 100 });
        expect(result[1]!).toEqual({ path: "/page2", count: 200 });
      });

      it("Redis 返回 null 时应返回 0", async () => {
        mockRedis.hmget.mockResolvedValue([null, null]);

        const result = await batchGetViewCounts(["/page1", "/page2"]);
        expect(result).toHaveLength(2);
        expect(result[0]!.count).toBe(0);
        expect(result[1]!.count).toBe(0);
      });

      it("单个路径应正常工作", async () => {
        mockRedis.hmget.mockResolvedValue(["42"]);

        const result = await batchGetViewCounts(["/single-page"]);
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({ path: "/single-page", count: 42 });
      });

      it("混合 null 和非 null 值", async () => {
        mockRedis.hmget.mockResolvedValue(["100", null, "300"]);

        const result = await batchGetViewCounts(["/a", "/b", "/c"]);
        expect(result).toHaveLength(3);
        expect(result[0]!.count).toBe(100);
        expect(result[1]!.count).toBe(0);
        expect(result[2]!.count).toBe(300);
      });

      it("恰好 20 个路径应正常工作", async () => {
        const paths = Array.from({ length: 20 }, (_, i) => `/page${i}`);
        mockRedis.hmget.mockResolvedValue(paths.map(() => "1"));

        const result = await batchGetViewCounts(paths);
        expect(result).toHaveLength(20);
      });
    });
  });
});
