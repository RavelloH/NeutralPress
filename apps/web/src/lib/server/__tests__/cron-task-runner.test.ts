import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { mockFetchPublicHttpUrlBuffer } = vi.hoisted(() => ({
  mockFetchPublicHttpUrlBuffer: vi.fn(),
}));

// Mock config-cache
const mockGetConfig = vi.fn();
const mockGetConfigs = vi.fn();
vi.mock("@/lib/server/config-cache", () => ({
  getConfig: mockGetConfig,
  getConfigs: mockGetConfigs,
}));

// Mock redis
const mockPing = vi.fn();
const mockInfo = vi.fn();
const mockDbsize = vi.fn();
vi.mock("@/lib/server/redis", () => ({
  default: {
    ping: mockPing,
    info: mockInfo,
    dbsize: mockDbsize,
  },
  ensureRedisConnection: vi.fn().mockResolvedValue(undefined),
}));

// Mock prisma
const mockQueryRaw = vi.fn();
const mockHealthCheckCreate = vi.fn();
vi.mock("@/lib/server/prisma", () => ({
  default: {
    $queryRaw: mockQueryRaw,
    healthCheck: {
      create: mockHealthCheckCreate,
    },
  },
}));

// Mock analytics-flush
vi.mock("@/lib/server/analytics-flush", () => ({
  flushEventsToDatabase: vi
    .fn()
    .mockResolvedValue({ success: true, flushedCount: 10 }),
}));

// Mock url-security
vi.mock("@/lib/server/url-security", () => ({
  fetchPublicHttpUrlBuffer: mockFetchPublicHttpUrlBuffer,
  assertPublicHttpUrl: vi
    .fn()
    .mockResolvedValue({ url: new URL("https://example.com") }),
  readResponseBufferWithLimit: vi.fn().mockResolvedValue(Buffer.from("")),
}));

// Mock doctor-maintenance (the auto cleanup)
vi.mock("@/lib/server/doctor-maintenance", () => ({
  runAutoCleanupMaintenance: vi.fn().mockResolvedValue({
    searchLogDeleted: 0,
    healthCheckDeleted: 0,
    auditLogDeleted: 0,
    cronHistoryDeleted: 0,
    cloudTriggerHistoryDeleted: 0,
    noticeDeleted: 0,
    recycleBinDeleted: 0,
    unsubscribedMailSubscriptionDeleted: 0,
    refreshTokenDeleted: 0,
    passwordResetDeleted: 0,
    pushSubscriptionsMarkedInactive: 0,
    pushSubscriptionsDeletedInactive: 0,
    pushSubscriptionsDeletedForDisabledUsers: 0,
  }),
}));

// Mock check-config
vi.mock("@/data/check-config", () => ({
  formatDoctorCheckDetails: vi.fn().mockReturnValue("formatted details"),
  getDoctorCheckMessage: vi.fn().mockReturnValue("check message"),
  getDoctorCheckOrder: vi.fn().mockReturnValue(1),
}));

// Mock next/cache
vi.mock("@/lib/server/isr-invalidation", () => ({ expireCacheTag: vi.fn() }));

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
}));

// Mock Prisma namespace
vi.mock(".prisma/client", () => ({
  Prisma: {
    JsonNull: null,
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cron-task-runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
    );

    mockGetConfig.mockResolvedValue("https://example.com");
    mockGetConfigs.mockResolvedValue(Array(13).fill(30));

    // Reset queryRaw mock - needs sequential responses
    mockQueryRaw.mockReset();
    mockQueryRaw
      .mockResolvedValueOnce([{ size: BigInt(1024000) }]) // DB size
      .mockResolvedValueOnce([{}]) // DB latency (SELECT 1)
      .mockResolvedValueOnce([{ used: BigInt(5), max: "100" }]); // DB connections

    mockPing.mockResolvedValue("PONG");
    mockInfo.mockResolvedValue("used_memory:1048576\r\n");
    mockDbsize.mockResolvedValue(100);

    mockHealthCheckCreate.mockImplementation(async (args: any) => ({
      id: 1,
      createdAt: new Date(),
      startedAt: new Date(),
      durationMs: 100,
      triggerType: args?.data?.triggerType || "MANUAL",
      overallStatus: "OK",
      okCount: 5,
      warningCount: 0,
      errorCount: 0,
    }));
  });

  describe("runDoctorHealthCheck", () => {
    beforeEach(() => {
      // Reset and setup queryRaw for each test
      mockQueryRaw.mockReset();
      mockQueryRaw
        .mockResolvedValueOnce([{ size: BigInt(1024000) }]) // DB size
        .mockResolvedValueOnce([{}]) // DB latency (SELECT 1)
        .mockResolvedValueOnce([{ used: BigInt(5), max: "100" }]); // DB connections
    });

    it("应执行健康检查并返回结果", async () => {
      const { runDoctorHealthCheck } = await import(
        "@/lib/server/cron-task-runner"
      );
      const result = await runDoctorHealthCheck({ triggerType: "MANUAL" });

      expect(result).toBeDefined();
      expect(result.id).toBe(1);
      expect(result.data).toBeDefined();
    }, 15000);

    it("应返回正确的数据结构", async () => {
      const { runDoctorHealthCheck } = await import(
        "@/lib/server/cron-task-runner"
      );
      const result = await runDoctorHealthCheck({ triggerType: "MANUAL" });

      expect(result.data).toHaveProperty("createdAt");
      expect(result.data).toHaveProperty("startedAt");
      expect(result.data).toHaveProperty("durationMs");
      expect(result.data).toHaveProperty("triggerType");
      expect(result.data).toHaveProperty("status");
      expect(result.data).toHaveProperty("okCount");
      expect(result.data).toHaveProperty("warningCount");
      expect(result.data).toHaveProperty("errorCount");
      expect(result.data).toHaveProperty("issues");
    });

    it("应将 triggerType 传递给数据库记录", async () => {
      const { runDoctorHealthCheck } = await import(
        "@/lib/server/cron-task-runner"
      );
      await runDoctorHealthCheck({ triggerType: "CRON" });

      expect(mockHealthCheckCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            triggerType: "CRON",
          }),
        }),
      );
    }, 15000);

    it("应支持 MANUAL 触发类型", async () => {
      const { runDoctorHealthCheck } = await import(
        "@/lib/server/cron-task-runner"
      );
      const result = await runDoctorHealthCheck({ triggerType: "MANUAL" });
      expect(result.data.triggerType).toBe("MANUAL");
    }, 15000);

    it("应支持 CRON 触发类型", async () => {
      const { runDoctorHealthCheck } = await import(
        "@/lib/server/cron-task-runner"
      );
      const result = await runDoctorHealthCheck({ triggerType: "CRON" });
      expect(result.data.triggerType).toBe("CRON");
    }, 15000);

    it("应检查 Redis 连接状态", async () => {
      const { runDoctorHealthCheck } = await import(
        "@/lib/server/cron-task-runner"
      );
      await runDoctorHealthCheck({ triggerType: "MANUAL" });

      expect(mockPing).toHaveBeenCalled();
    }, 15000);

    it("应检查 Redis 内存使用情况", async () => {
      const { runDoctorHealthCheck } = await import(
        "@/lib/server/cron-task-runner"
      );
      await runDoctorHealthCheck({ triggerType: "MANUAL" });

      expect(mockInfo).toHaveBeenCalledWith("memory");
    }, 15000);

    it("应检查 Redis 键数量", async () => {
      const { runDoctorHealthCheck } = await import(
        "@/lib/server/cron-task-runner"
      );
      await runDoctorHealthCheck({ triggerType: "MANUAL" });

      expect(mockDbsize).toHaveBeenCalled();
    }, 15000);
  });

  describe("runDoctorForCron", () => {
    it("应以 CRON 触发类型执行健康检查", async () => {
      // 为 runDoctorForCron 准备 queryRaw mock
      mockQueryRaw.mockReset();
      mockQueryRaw
        .mockResolvedValueOnce([{ size: BigInt(1024000) }])
        .mockResolvedValueOnce([{}])
        .mockResolvedValueOnce([{ used: BigInt(5), max: "100" }]);

      const { runDoctorForCron } = await import(
        "@/lib/server/cron-task-runner"
      );
      const result = await runDoctorForCron();

      expect(result).toBeDefined();
      expect(result.triggerType).toBe("CRON");
    }, 15000);
  });

  describe("summarizeTaskValue", () => {
    it("应返回数字类型的值", async () => {
      const { summarizeTaskValue } = await import(
        "@/lib/server/cron-task-runner"
      );
      expect(summarizeTaskValue(42)).toBe(42);
    });

    it("应返回字符串类型的值", async () => {
      const { summarizeTaskValue } = await import(
        "@/lib/server/cron-task-runner"
      );
      expect(summarizeTaskValue("hello")).toBe("hello");
    });

    it("应返回布尔类型的值", async () => {
      const { summarizeTaskValue } = await import(
        "@/lib/server/cron-task-runner"
      );
      expect(summarizeTaskValue(true)).toBe(true);
    });

    it("应将 null 返回为 null", async () => {
      const { summarizeTaskValue } = await import(
        "@/lib/server/cron-task-runner"
      );
      expect(summarizeTaskValue(null)).toBeNull();
    });

    it("应将对象转换为 null", async () => {
      const { summarizeTaskValue } = await import(
        "@/lib/server/cron-task-runner"
      );
      expect(summarizeTaskValue({ key: "value" })).toBeNull();
    });

    it("应将数组转换为 null", async () => {
      const { summarizeTaskValue } = await import(
        "@/lib/server/cron-task-runner"
      );
      expect(summarizeTaskValue([1, 2, 3])).toBeNull();
    });

    it("应将 undefined 转换为 null", async () => {
      const { summarizeTaskValue } = await import(
        "@/lib/server/cron-task-runner"
      );
      expect(summarizeTaskValue(undefined)).toBeNull();
    });

    it("应将 NaN 作为数字类型返回", async () => {
      const { summarizeTaskValue } = await import(
        "@/lib/server/cron-task-runner"
      );
      // NaN 的 typeof 是 "number"，所以会被原样返回
      const result = summarizeTaskValue(NaN);
      expect(typeof result).toBe("number");
    });

    it("应将 Infinity 作为数字类型返回", async () => {
      const { summarizeTaskValue } = await import(
        "@/lib/server/cron-task-runner"
      );
      // Infinity 的 typeof 是 "number"，所以会被原样返回
      const result = summarizeTaskValue(Infinity);
      expect(typeof result).toBe("number");
    });
  });

  describe("runAutoCleanupForCron", () => {
    it("应调用 runAutoCleanupMaintenance", async () => {
      const { runAutoCleanupForCron } = await import(
        "@/lib/server/cron-task-runner"
      );
      const result = await runAutoCleanupForCron();

      expect(result).toBeDefined();
      expect(result).toHaveProperty("searchLogDeleted");
    });
  });

  describe("runAnalyticsRollupForCron", () => {
    it("应调用 flushEventsToDatabase", async () => {
      const { runAnalyticsRollupForCron } = await import(
        "@/lib/server/cron-task-runner"
      );
      const result = await runAnalyticsRollupForCron();

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });
  });

  describe("runProjectsGithubSync", () => {
    it("当没有启用 GitHub 同步的项目时应返回空结果", async () => {
      const prisma = (await import("@/lib/server/prisma")).default;
      (prisma as any).project = {
        findMany: vi.fn().mockResolvedValue([]),
      };

      const { runProjectsGithubSync } = await import(
        "@/lib/server/cron-task-runner"
      );
      const result = await runProjectsGithubSync();

      expect(result.synced).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.results).toEqual([]);
    });

    it("应返回正确的结果结构", async () => {
      const prisma = (await import("@/lib/server/prisma")).default;
      (prisma as any).project = {
        findMany: vi.fn().mockResolvedValue([]),
      };

      const { runProjectsGithubSync } = await import(
        "@/lib/server/cron-task-runner"
      );
      const result = await runProjectsGithubSync();

      expect(result).toHaveProperty("synced");
      expect(result).toHaveProperty("failed");
      expect(result).toHaveProperty("results");
      expect(Array.isArray(result.results)).toBe(true);
    });

    it("使用公共 URL 受控抓取并限制大小、超时和重定向", async () => {
      const prisma = (await import("@/lib/server/prisma")).default;
      const link = {
        id: 1,
        name: "示例友链",
        url: "https://friend.example/page",
        friendLinkUrl: null,
        ignoreBacklink: false,
        status: "PUBLISHED",
        checkSuccessCount: 0,
        checkFailureCount: 0,
        avgResponseTime: null,
        checkHistory: [],
        publishedAt: null,
      };
      (prisma as any).friendLink = {
        findMany: vi.fn().mockResolvedValue([link]),
        update: vi.fn().mockResolvedValue({ status: "PUBLISHED" }),
      };
      mockGetConfigs.mockResolvedValue([
        false,
        false,
        "https://neutralpress.example",
      ]);
      mockFetchPublicHttpUrlBuffer.mockResolvedValue({
        status: 200,
        headers: new Headers(),
        body: Buffer.from("ok"),
        finalUrl: link.url,
      });

      const { runFriendLinksCheck } = await import(
        "@/lib/server/cron-task-runner"
      );
      const result = await runFriendLinksCheck({ checkAll: true, ids: [] });

      expect(result.checked).toBe(1);
      expect(mockFetchPublicHttpUrlBuffer).toHaveBeenCalledWith(link.url, {
        method: "GET",
        timeoutMs: 10000,
        maxBytes: 2 * 1024 * 1024,
        maxRedirects: 3,
        headers: {
          "User-Agent": "NeutralPress FriendLinkChecker/1.0",
        },
      });
    });
  });

  describe("runProjectsSyncForCron", () => {
    it("应调用 runProjectsGithubSync", async () => {
      const prisma = (await import("@/lib/server/prisma")).default;
      (prisma as any).project = {
        findMany: vi.fn().mockResolvedValue([]),
      };

      const { runProjectsSyncForCron } = await import(
        "@/lib/server/cron-task-runner"
      );
      const result = await runProjectsSyncForCron();

      expect(result).toBeDefined();
      expect(result).toHaveProperty("synced");
      expect(result).toHaveProperty("failed");
    });
  });

  describe("runFriendLinksCheck", () => {
    it("当 checkAll 为 false 且 ids 为空时应返回空结果", async () => {
      const { runFriendLinksCheck } = await import(
        "@/lib/server/cron-task-runner"
      );
      const result = await runFriendLinksCheck({ checkAll: false, ids: [] });

      expect(result.total).toBe(0);
      expect(result.checked).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(0);
    });

    it("应返回正确的结果结构", async () => {
      const { runFriendLinksCheck } = await import(
        "@/lib/server/cron-task-runner"
      );
      const result = await runFriendLinksCheck({ checkAll: false, ids: [] });

      expect(result).toHaveProperty("total");
      expect(result).toHaveProperty("checked");
      expect(result).toHaveProperty("skipped");
      expect(result).toHaveProperty("failed");
      expect(result).toHaveProperty("statusChanged");
      expect(result).toHaveProperty("results");
      expect(Array.isArray(result.results)).toBe(true);
    });
  });

  describe("runFriendLinksCheckForCron", () => {
    it("应以 checkAll: true 调用 runFriendLinksCheck", async () => {
      const prisma = (await import("@/lib/server/prisma")).default;
      (prisma as any).friendLink = {
        findMany: vi.fn().mockResolvedValue([]),
      };

      const { runFriendLinksCheckForCron } = await import(
        "@/lib/server/cron-task-runner"
      );
      const result = await runFriendLinksCheckForCron();

      expect(result).toBeDefined();
      expect(result).toHaveProperty("total");
    });
  });

  describe("runDoctorHealthCheck 高级场景", () => {
    beforeEach(() => {
      mockQueryRaw.mockReset();
      mockQueryRaw
        .mockResolvedValueOnce([{ size: BigInt(2048000) }])
        .mockResolvedValueOnce([{}])
        .mockResolvedValueOnce([{ used: BigInt(10), max: "200" }]);
    });

    it("应支持 AUTO 触发类型", async () => {
      const { runDoctorHealthCheck } = await import(
        "@/lib/server/cron-task-runner"
      );
      const result = await runDoctorHealthCheck({ triggerType: "AUTO" });

      expect(result.data.triggerType).toBe("AUTO");
    });

    it("应返回包含所有健康检查项的结果", async () => {
      const { runDoctorHealthCheck } = await import(
        "@/lib/server/cron-task-runner"
      );
      const result = await runDoctorHealthCheck({ triggerType: "MANUAL" });

      expect(result.data.issues).toBeDefined();
      expect(Array.isArray(result.data.issues)).toBe(true);
    }, 15000);

    it("应返回有效的 status 值", async () => {
      const { runDoctorHealthCheck } = await import(
        "@/lib/server/cron-task-runner"
      );
      const result = await runDoctorHealthCheck({ triggerType: "MANUAL" });

      expect(["OK", "WARNING", "ERROR"]).toContain(result.data.status);
    }, 15000);

    it("应返回非负的 durationMs", async () => {
      const { runDoctorHealthCheck } = await import(
        "@/lib/server/cron-task-runner"
      );
      const result = await runDoctorHealthCheck({ triggerType: "MANUAL" });

      expect(result.data.durationMs).toBeGreaterThanOrEqual(0);
    }, 15000);

    it("应返回有效的计数值", async () => {
      const { runDoctorHealthCheck } = await import(
        "@/lib/server/cron-task-runner"
      );
      const result = await runDoctorHealthCheck({ triggerType: "MANUAL" });

      expect(result.data.okCount).toBeGreaterThanOrEqual(0);
      expect(result.data.warningCount).toBeGreaterThanOrEqual(0);
      expect(result.data.errorCount).toBeGreaterThanOrEqual(0);
      expect(
        result.data.okCount + result.data.warningCount + result.data.errorCount,
      ).toBeGreaterThan(0);
    });
  });

  describe("summarizeTaskValue 边界情况", () => {
    it("应将空字符串返回为空字符串", async () => {
      const { summarizeTaskValue } = await import(
        "@/lib/server/cron-task-runner"
      );
      expect(summarizeTaskValue("")).toBe("");
    });
  });
});
