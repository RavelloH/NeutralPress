import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("next/headers", () => ({
  headers: vi.fn(() => new Headers()),
}));

vi.mock("@/lib/server/auth-verify", () => ({
  authVerify: vi.fn(),
}));

vi.mock("@/lib/server/rate-limit", () => ({
  default: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  default: {
    config: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    cronHistory: {
      count: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/server/response", () => {
  class MockResponseBuilder {
    ok(opts?: unknown) {
      return { success: true, ...(opts as Record<string, unknown>) };
    }
    badRequest(opts?: unknown) {
      return {
        success: false,
        status: 400,
        ...(opts as Record<string, unknown>),
      };
    }
    unauthorized() {
      return { success: false, status: 401 };
    }
    tooManyRequests() {
      return { success: false, status: 429 };
    }
    serverError() {
      return { success: false, status: 500 };
    }
  }
  return { default: MockResponseBuilder };
});

vi.mock("@/lib/server/validator", () => ({
  validateData: vi.fn(),
}));

vi.mock("@/lib/server/audit", () => ({
  logAuditEvent: vi.fn(),
}));

vi.mock("@/lib/server/config-cache", () => ({
  getConfigs: vi.fn(async () => []),
}));

vi.mock("next/cache", () => ({
  updateTag: vi.fn(),
}));
vi.mock("@/lib/server/isr-invalidation", () => ({ expireCacheTag: vi.fn() }));

vi.mock("@/lib/server/cron-task-runner", () => ({
  runDoctorForCron: vi.fn(async () => ({
    status: "OK",
    okCount: 5,
    warningCount: 0,
    errorCount: 0,
  })),
  runProjectsSyncForCron: vi.fn(async () => ({ synced: 3, failed: 0 })),
  runFriendLinksCheckForCron: vi.fn(async () => ({
    total: 5,
    checked: 5,
    skipped: 0,
    failed: 0,
    statusChanged: 0,
  })),
  runAutoCleanupForCron: vi.fn(async () => ({
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
  })),
  runAnalyticsRollupForCron: vi.fn(async () => ({
    success: true,
    flushedCount: 0,
    syncedViewCountRows: 0,
    archivedDateGroups: 0,
    archivedRawPageViewDeleted: 0,
    expiredArchiveDeleted: 0,
  })),
}));

vi.mock("@/lib/server/analytics-cron-report", () => ({
  dispatchAnalyticsCronReports: vi.fn(async () => ({
    mode: "NONE",
    timezone: "UTC",
    recipientCount: 0,
    cycleResults: [],
    noticeSent: 0,
    emailSent: 0,
    errors: [],
  })),
}));

vi.mock("@/lib/server/storage-temp-cleanup", () => ({
  cleanupStorageTempFolders: vi.fn(async () => {}),
}));

vi.mock("next/server", () => ({
  after: vi.fn((fn: () => void) => fn()),
}));

// ── Imports ──────────────────────────────────────────────────────────────────

import { authVerify } from "@/lib/server/auth-verify";
import { getConfigs } from "@/lib/server/config-cache";
import prisma from "@/lib/server/prisma";
import limitControl from "@/lib/server/rate-limit";
import { validateData } from "@/lib/server/validator";

const mockLimitControl = vi.mocked(limitControl);
const mockValidateData = vi.mocked(validateData);
const mockAuthVerify = vi.mocked(authVerify);
const mockGetConfigs = vi.mocked(getConfigs);

// ── Helpers ──────────────────────────────────────────────────────────────────

function setupSuccessMocks() {
  mockLimitControl.mockResolvedValue(true as never);
  mockValidateData.mockReturnValue(null as never);
  mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" } as never);
}

function setupCronConfig(enabled = true) {
  (mockGetConfigs as any).mockImplementation(async (keys: string[]) => {
    const map: Record<string, unknown> = {
      "cron.enable": enabled,
      "cron.task.doctor.enable": true,
      "cron.task.projects.enable": true,
      "cron.task.friends.enable": true,
      "cron.task.cleanup.enable": true,
      "cron.task.analytics.enable": true,
    };
    return keys.map((k) => map[k] ?? null);
  });
}

function mockCronHistoryRecord() {
  return {
    id: 1,
    startedAt: new Date("2025-06-01T12:00:00Z"),
    createdAt: new Date("2025-06-01T12:00:05Z"),
    durationMs: 5000,
    triggerType: "MANUAL",
    status: "OK",
    totalCount: 5,
    enabledCount: 5,
    successCount: 5,
    failedCount: 0,
    skippedCount: 0,
    snapshot: {
      version: 1,
      tasks: {
        doctor: { e: true, x: true, s: "O", d: 1000, v: null, m: null },
        projects: { e: true, x: true, s: "O", d: 1000, v: null, m: null },
        friends: { e: true, x: true, s: "O", d: 1000, v: null, m: null },
        cleanup: { e: true, x: true, s: "O", d: 1000, v: null, m: null },
        analytics: { e: true, x: true, s: "O", d: 1000, v: null, m: null },
      },
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("cron actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.config.findMany).mockResolvedValue([
      { updatedAt: new Date("2025-01-01") },
    ] as never);
  });

  // ==========================================================================
  // getCronConfig
  // ==========================================================================
  describe("getCronConfig", () => {
    it("返回计划任务配置 - 成功路径", async () => {
      setupSuccessMocks();
      setupCronConfig();

      const { getCronConfig } = await import("@/actions/cron");
      const result = await getCronConfig({ access_token: "valid-token" });

      expect(result).toEqual(expect.objectContaining({ success: true }));
    });

    it("未授权返回 401", async () => {
      mockLimitControl.mockResolvedValue(true as never);
      mockValidateData.mockReturnValue(null as never);
      mockAuthVerify.mockResolvedValue(null as never);

      const { getCronConfig } = await import("@/actions/cron");
      const result = await getCronConfig({ access_token: "invalid" });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 401 }),
      );
    });
  });

  // ==========================================================================
  // triggerCron
  // ==========================================================================
  describe("triggerCron", () => {
    it("手动触发计划任务 - 成功路径", async () => {
      setupSuccessMocks();
      setupCronConfig();
      vi.mocked(prisma.cronHistory.create).mockResolvedValue(
        mockCronHistoryRecord() as never,
      );

      const { triggerCron } = await import("@/actions/cron");
      const result = await triggerCron({
        access_token: "valid-token",
        triggerType: "MANUAL",
      });

      expect(result).toEqual(expect.objectContaining({ success: true }));
    });

    it("计划任务禁用时仍返回成功（全部跳过）", async () => {
      setupSuccessMocks();
      setupCronConfig(false);
      vi.mocked(prisma.cronHistory.create).mockResolvedValue({
        ...mockCronHistoryRecord(),
        status: "OK",
        enabledCount: 0,
        successCount: 0,
        skippedCount: 5,
      } as never);

      const { triggerCron } = await import("@/actions/cron");
      const result = await triggerCron({
        access_token: "valid-token",
        triggerType: "MANUAL",
      });

      expect(result).toEqual(expect.objectContaining({ success: true }));
    });

    it("未授权返回 401", async () => {
      mockLimitControl.mockResolvedValue(true as never);
      mockValidateData.mockReturnValue(null as never);
      mockAuthVerify.mockResolvedValue(null as never);

      const { triggerCron } = await import("@/actions/cron");
      const result = await triggerCron({
        access_token: "invalid",
        triggerType: "MANUAL",
      });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 401 }),
      );
    });
  });

  // ==========================================================================
  // getCronHistory
  // ==========================================================================
  describe("getCronHistory", () => {
    it("返回计划任务历史 - 成功路径", async () => {
      setupSuccessMocks();
      vi.mocked(prisma.cronHistory.count).mockResolvedValue(1);
      vi.mocked(prisma.cronHistory.findMany).mockResolvedValue([
        mockCronHistoryRecord(),
      ] as never);

      const { getCronHistory } = await import("@/actions/cron");
      const result = await getCronHistory({
        access_token: "valid-token",
        page: 1,
        pageSize: 25,
      });

      expect(result).toEqual(expect.objectContaining({ success: true }));
    });

    it("支持状态过滤", async () => {
      setupSuccessMocks();
      vi.mocked(prisma.cronHistory.count).mockResolvedValue(0);
      vi.mocked(prisma.cronHistory.findMany).mockResolvedValue([]);

      const { getCronHistory } = await import("@/actions/cron");
      const result = await getCronHistory({
        access_token: "valid-token",
        page: 1,
        pageSize: 25,
        status: "OK",
      });

      expect(result).toEqual(expect.objectContaining({ success: true }));
    });
  });

  // ==========================================================================
  // getCronTrends
  // ==========================================================================
  describe("getCronTrends", () => {
    it("返回计划任务趋势 - 成功路径", async () => {
      setupSuccessMocks();
      vi.mocked(prisma.cronHistory.findMany).mockResolvedValue([]);

      const { getCronTrends } = await import("@/actions/cron");
      const result = await getCronTrends({
        access_token: "valid-token",
        days: 30,
        count: 30,
      });

      expect(result).toEqual(expect.objectContaining({ success: true }));
    });
  });

  // ==========================================================================
  // updateCronConfig
  // ==========================================================================
  describe("updateCronConfig", () => {
    it("更新计划任务配置 - 成功路径", async () => {
      setupSuccessMocks();
      setupCronConfig();
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const tx = {
          config: { upsert: vi.fn().mockResolvedValue({}) },
        };
        return (fn as (tx: unknown) => Promise<unknown>)(tx);
      });

      const { updateCronConfig } = await import("@/actions/cron");
      const result = await updateCronConfig({
        access_token: "valid-token",
        enabled: true,
      });

      expect(result).toEqual(expect.objectContaining({ success: true }));
    });

    it("无配置项返回 400", async () => {
      setupSuccessMocks();
      setupCronConfig();

      const { updateCronConfig } = await import("@/actions/cron");
      const result = await updateCronConfig({
        access_token: "valid-token",
      });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 400 }),
      );
    });

    it("未授权返回 401", async () => {
      mockLimitControl.mockResolvedValue(true as never);
      mockValidateData.mockReturnValue(null as never);
      mockAuthVerify.mockResolvedValue(null as never);

      const { updateCronConfig } = await import("@/actions/cron");
      const result = await updateCronConfig({
        access_token: "invalid",
        enabled: true,
      });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 401 }),
      );
    });
  });
});
