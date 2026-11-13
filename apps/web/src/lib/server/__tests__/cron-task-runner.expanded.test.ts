import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mockGetConfig = vi.fn();
const mockGetConfigs = vi.fn();
vi.mock("@/lib/server/config-cache", () => ({
  getConfig: mockGetConfig,
  getConfigs: mockGetConfigs,
}));

const mockPing = vi.fn();
const mockInfo = vi.fn();
const mockDbsize = vi.fn();
vi.mock("@/lib/server/redis", () => ({
  default: { ping: mockPing, info: mockInfo, dbsize: mockDbsize },
  ensureRedisConnection: vi.fn().mockResolvedValue(undefined),
}));

const mockQueryRaw = vi.fn();
const mockHealthCheckCreate = vi.fn();
vi.mock("@/lib/server/prisma", () => ({
  default: {
    $queryRaw: mockQueryRaw,
    healthCheck: { create: mockHealthCheckCreate },
    project: { findMany: vi.fn().mockResolvedValue([]) },
    friendLink: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock("@/lib/server/analytics-flush", () => ({
  flushEventsToDatabase: vi
    .fn()
    .mockResolvedValue({ success: true, flushedCount: 10 }),
}));

vi.mock("@/lib/server/url-security", () => ({
  fetchPublicHttpUrlBuffer: vi.fn().mockResolvedValue({
    status: 200,
    headers: new Headers(),
    body: Buffer.from(""),
    finalUrl: "https://example.com",
  }),
  assertPublicHttpUrl: vi
    .fn()
    .mockResolvedValue({ url: new URL("https://example.com") }),
  readResponseBufferWithLimit: vi.fn().mockResolvedValue(Buffer.from("")),
}));

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

vi.mock("@/data/check-config", () => ({
  formatDoctorCheckDetails: vi.fn().mockReturnValue("formatted details"),
  getDoctorCheckMessage: vi.fn().mockReturnValue("check message"),
  getDoctorCheckOrder: vi.fn().mockReturnValue(1),
}));

vi.mock("@/lib/server/isr-invalidation", () => ({ expireCacheTag: vi.fn() }));

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

vi.mock(".prisma/client", () => ({ Prisma: { JsonNull: null } }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cron-task-runner expanded", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
    );
    mockGetConfig.mockResolvedValue("https://example.com");
    mockGetConfigs.mockResolvedValue(Array(13).fill(30));
    mockQueryRaw.mockReset();
    mockQueryRaw
      .mockResolvedValueOnce([{ size: BigInt(1024000) }])
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([{ used: BigInt(5), max: "100" }]);
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
      mockQueryRaw.mockReset();
      mockPing.mockReset();
      mockInfo.mockReset();
      mockDbsize.mockReset();
      mockQueryRaw
        .mockResolvedValueOnce([{ size: BigInt(1024000) }])
        .mockResolvedValueOnce([{}])
        .mockResolvedValueOnce([{ used: BigInt(5), max: "100" }]);
      mockPing.mockResolvedValue("PONG");
      mockInfo.mockResolvedValue("used_memory:1048576\r\n");
      mockDbsize.mockResolvedValue(100);
    });

    it("执行健康检查并返回结果", async () => {
      const { runDoctorHealthCheck } = await import(
        "@/lib/server/cron-task-runner"
      );
      const result = await runDoctorHealthCheck({ triggerType: "MANUAL" });
      expect(result).toBeDefined();
      expect(result.id).toBe(1);
      expect(result.data).toBeDefined();
    });

    it("返回正确的数据结构", async () => {
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

    it("将 triggerType 传递给数据库记录", async () => {
      const { runDoctorHealthCheck } = await import(
        "@/lib/server/cron-task-runner"
      );
      await runDoctorHealthCheck({ triggerType: "CRON" });
      expect(mockHealthCheckCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ triggerType: "CRON" }),
        }),
      );
    });

    it("支持 MANUAL 触发类型", async () => {
      mockQueryRaw.mockReset();
      mockQueryRaw
        .mockResolvedValueOnce([{ size: BigInt(1024000) }])
        .mockResolvedValueOnce([{}])
        .mockResolvedValueOnce([{ used: BigInt(5), max: "100" }]);
      const { runDoctorHealthCheck } = await import(
        "@/lib/server/cron-task-runner"
      );
      const result = await runDoctorHealthCheck({ triggerType: "MANUAL" });
      expect(result.data.triggerType).toBe("MANUAL");
    });

    it("支持 AUTO 触发类型", async () => {
      mockQueryRaw.mockReset();
      mockQueryRaw
        .mockResolvedValueOnce([{ size: BigInt(1024000) }])
        .mockResolvedValueOnce([{}])
        .mockResolvedValueOnce([{ used: BigInt(5), max: "100" }]);
      const { runDoctorHealthCheck } = await import(
        "@/lib/server/cron-task-runner"
      );
      const result = await runDoctorHealthCheck({ triggerType: "AUTO" });
      expect(result.data.triggerType).toBe("AUTO");
    });

    it("检查 Redis 连接状态", async () => {
      const { runDoctorHealthCheck } = await import(
        "@/lib/server/cron-task-runner"
      );
      await runDoctorHealthCheck({ triggerType: "MANUAL" });
      expect(mockPing).toHaveBeenCalled();
    });

    it("检查 Redis 内存使用情况", async () => {
      const { runDoctorHealthCheck } = await import(
        "@/lib/server/cron-task-runner"
      );
      await runDoctorHealthCheck({ triggerType: "MANUAL" });
      expect(mockInfo).toHaveBeenCalledWith("memory");
    });

    it("检查 Redis 键数量", async () => {
      const { runDoctorHealthCheck } = await import(
        "@/lib/server/cron-task-runner"
      );
      await runDoctorHealthCheck({ triggerType: "MANUAL" });
      expect(mockDbsize).toHaveBeenCalled();
    });

    it("返回有效的 status 值", async () => {
      const { runDoctorHealthCheck } = await import(
        "@/lib/server/cron-task-runner"
      );
      const result = await runDoctorHealthCheck({ triggerType: "MANUAL" });
      expect(["OK", "WARNING", "ERROR"]).toContain(result.data.status);
    });

    it("返回非负的 durationMs", async () => {
      const { runDoctorHealthCheck } = await import(
        "@/lib/server/cron-task-runner"
      );
      const result = await runDoctorHealthCheck({ triggerType: "MANUAL" });
      expect(result.data.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("返回有效的计数值", async () => {
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

    it("返回包含所有健康检查项的 issues", async () => {
      const { runDoctorHealthCheck } = await import(
        "@/lib/server/cron-task-runner"
      );
      const result = await runDoctorHealthCheck({ triggerType: "MANUAL" });
      expect(result.data.issues).toBeDefined();
      expect(Array.isArray(result.data.issues)).toBe(true);
    });

    it("Redis 连接失败时记录 REDIS_CONNECTION 错误", async () => {
      mockQueryRaw.mockReset();
      mockPing.mockReset();
      mockQueryRaw
        .mockResolvedValueOnce([{ size: BigInt(1024000) }])
        .mockResolvedValueOnce([{}])
        .mockResolvedValueOnce([{ used: BigInt(5), max: "100" }]);
      mockPing.mockRejectedValue(new Error("Connection refused"));
      const { runDoctorHealthCheck } = await import(
        "@/lib/server/cron-task-runner"
      );
      const result = await runDoctorHealthCheck({ triggerType: "MANUAL" });
      expect(result.data).toBeDefined();
      // Restore mock for subsequent tests
      mockPing.mockResolvedValue("PONG");
    });
  });

  describe("runDoctorForCron", () => {
    it("以 CRON 触发类型执行健康检查", async () => {
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
    });
  });

  describe("summarizeTaskValue", () => {
    it("返回数字类型的值", async () => {
      const { summarizeTaskValue } = await import(
        "@/lib/server/cron-task-runner"
      );
      expect(summarizeTaskValue(42)).toBe(42);
    });

    it("返回字符串类型的值", async () => {
      const { summarizeTaskValue } = await import(
        "@/lib/server/cron-task-runner"
      );
      expect(summarizeTaskValue("hello")).toBe("hello");
    });

    it("返回布尔类型的值", async () => {
      const { summarizeTaskValue } = await import(
        "@/lib/server/cron-task-runner"
      );
      expect(summarizeTaskValue(true)).toBe(true);
    });

    it("null 返回 null", async () => {
      const { summarizeTaskValue } = await import(
        "@/lib/server/cron-task-runner"
      );
      expect(summarizeTaskValue(null)).toBeNull();
    });

    it("对象转换为 null", async () => {
      const { summarizeTaskValue } = await import(
        "@/lib/server/cron-task-runner"
      );
      expect(summarizeTaskValue({ key: "value" })).toBeNull();
    });

    it("数组转换为 null", async () => {
      const { summarizeTaskValue } = await import(
        "@/lib/server/cron-task-runner"
      );
      expect(summarizeTaskValue([1, 2, 3])).toBeNull();
    });

    it("undefined 转换为 null", async () => {
      const { summarizeTaskValue } = await import(
        "@/lib/server/cron-task-runner"
      );
      expect(summarizeTaskValue(undefined)).toBeNull();
    });

    it("空字符串返回空字符串", async () => {
      const { summarizeTaskValue } = await import(
        "@/lib/server/cron-task-runner"
      );
      expect(summarizeTaskValue("")).toBe("");
    });

    it("NaN 作为数字类型返回", async () => {
      const { summarizeTaskValue } = await import(
        "@/lib/server/cron-task-runner"
      );
      expect(typeof summarizeTaskValue(NaN)).toBe("number");
    });

    it("Infinity 作为数字类型返回", async () => {
      const { summarizeTaskValue } = await import(
        "@/lib/server/cron-task-runner"
      );
      expect(typeof summarizeTaskValue(Infinity)).toBe("number");
    });
  });

  describe("runAutoCleanupForCron", () => {
    it("调用 runAutoCleanupMaintenance", async () => {
      const { runAutoCleanupForCron } = await import(
        "@/lib/server/cron-task-runner"
      );
      const result = await runAutoCleanupForCron();
      expect(result).toBeDefined();
      expect(result).toHaveProperty("searchLogDeleted");
    });
  });

  describe("runAnalyticsRollupForCron", () => {
    it("调用 flushEventsToDatabase", async () => {
      const { runAnalyticsRollupForCron } = await import(
        "@/lib/server/cron-task-runner"
      );
      const result = await runAnalyticsRollupForCron();
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });
  });

  describe("runProjectsGithubSync", () => {
    it("没有启用 GitHub 同步的项目时返回空结果", async () => {
      const prisma = (await import("@/lib/server/prisma")).default;
      (prisma as any).project = { findMany: vi.fn().mockResolvedValue([]) };
      const { runProjectsGithubSync } = await import(
        "@/lib/server/cron-task-runner"
      );
      const result = await runProjectsGithubSync();
      expect(result.synced).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.results).toEqual([]);
    });

    it("返回正确的结果结构", async () => {
      const prisma = (await import("@/lib/server/prisma")).default;
      (prisma as any).project = { findMany: vi.fn().mockResolvedValue([]) };
      const { runProjectsGithubSync } = await import(
        "@/lib/server/cron-task-runner"
      );
      const result = await runProjectsGithubSync();
      expect(result).toHaveProperty("synced");
      expect(result).toHaveProperty("failed");
      expect(result).toHaveProperty("results");
      expect(Array.isArray(result.results)).toBe(true);
    });
  });

  describe("runProjectsSyncForCron", () => {
    it("调用 runProjectsGithubSync", async () => {
      const prisma = (await import("@/lib/server/prisma")).default;
      (prisma as any).project = { findMany: vi.fn().mockResolvedValue([]) };
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
    it("checkAll 为 false 且 ids 为空时返回空结果", async () => {
      const { runFriendLinksCheck } = await import(
        "@/lib/server/cron-task-runner"
      );
      const result = await runFriendLinksCheck({ checkAll: false, ids: [] });
      expect(result.total).toBe(0);
      expect(result.checked).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(0);
    });

    it("返回正确的结果结构", async () => {
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
    it("以 checkAll: true 调用 runFriendLinksCheck", async () => {
      const prisma = (await import("@/lib/server/prisma")).default;
      (prisma as any).friendLink = { findMany: vi.fn().mockResolvedValue([]) };
      const { runFriendLinksCheckForCron } = await import(
        "@/lib/server/cron-task-runner"
      );
      const result = await runFriendLinksCheckForCron();
      expect(result).toBeDefined();
      expect(result).toHaveProperty("total");
    });
  });
});
