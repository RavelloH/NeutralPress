"use server";

import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type {
  CronConfig,
  CronHistoryItem,
  CronRunStatus,
  CronSnapshot,
  CronTrendItem,
  GetCronConfig,
  GetCronHistory,
  GetCronTrends,
  TriggerCron,
  UpdateCronConfig,
} from "@repo/shared-types/api/cron";
import {
  GetCronConfigSchema,
  TriggerCronSchema,
  UpdateCronConfigSchema,
} from "@repo/shared-types/api/cron";
import { updateTag } from "next/cache";
import { headers } from "next/headers";
import type { NextResponse } from "next/server";

import { dispatchAnalyticsCronReports } from "@/lib/server/analytics-cron-report";
import { logAuditEvent } from "@/lib/server/audit";
import { authVerify } from "@/lib/server/auth-verify";
import { getConfigs } from "@/lib/server/config-cache";
import {
  runAnalyticsRollupForCron,
  runAutoCleanupForCron,
  runDoctorForCron,
  runFriendLinksCheckForCron,
  runProjectsSyncForCron,
} from "@/lib/server/cron-task-runner";
import prisma from "@/lib/server/prisma";
import limitControl from "@/lib/server/rate-limit";
import ResponseBuilder from "@/lib/server/response";
import {
  getCronHistory as getCronHistoryService,
  getCronTrends as getCronTrendsService,
} from "@/lib/server/services/cron-history";
import { cleanupStorageTempFolders } from "@/lib/server/storage-temp-cleanup";
import { validateData } from "@/lib/server/validator";

import type { Prisma } from ".prisma/client";

type ActionEnvironment = "serverless" | "serveraction";
type ActionConfig = { environment?: ActionEnvironment };
type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

type CronTaskKey = "doctor" | "projects" | "friends" | "cleanup" | "analytics";
type CronTaskStatus = "O" | "E" | "S";
type CronTaskSnapshot = CronSnapshot["tasks"][CronTaskKey];

type CronHistoryRecord = {
  id: number;
  startedAt: Date;
  createdAt: Date;
  durationMs: number;
  triggerType: "MANUAL" | "CLOUD" | "AUTO";
  status: CronRunStatus;
  totalCount: number;
  enabledCount: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  snapshot: unknown;
};

const CRON_CONFIG_KEYS = [
  "cron.enable",
  "cron.task.doctor.enable",
  "cron.task.projects.enable",
  "cron.task.friends.enable",
  "cron.task.cleanup.enable",
  "cron.task.analytics.enable",
  "cron.task.cleanup.searchLog.retentionDays",
  "cron.task.cleanup.healthCheck.retentionDays",
  "cron.task.cleanup.auditLog.retentionDays",
  "cron.task.cleanup.cronHistory.retentionDays",
  "cron.task.cleanup.cloudTriggerHistory.retentionDays",
  "cron.task.cleanup.notice.retentionDays",
  "cron.task.cleanup.recycleBin.retentionDays",
  "cron.task.cleanup.mailSubscriptionUnsubscribed.retentionDays",
  "cron.task.cleanup.refreshToken.expiredRetentionDays",
  "cron.task.cleanup.passwordReset.retentionMinutes",
  "cron.task.cleanup.pushSubscription.markInactiveDays",
  "cron.task.cleanup.pushSubscription.deleteInactiveDays",
  "cron.task.cleanup.pushSubscription.deleteDisabledUserDays",
  "cron.task.analytics.report.mode",
  "cron.task.analytics.report.daily.enable",
  "cron.task.analytics.report.weekly.enable",
  "cron.task.analytics.report.monthly.enable",
  "cron.task.analytics.report.notifyAdmin.uid",
] as const;

const CRON_TASK_KEYS: CronTaskKey[] = [
  "doctor",
  "projects",
  "friends",
  "cleanup",
  "analytics",
];

const CRON_CLEANUP_SETTING_KEYS = {
  searchLogRetentionDays: "cron.task.cleanup.searchLog.retentionDays",
  healthCheckRetentionDays: "cron.task.cleanup.healthCheck.retentionDays",
  auditLogRetentionDays: "cron.task.cleanup.auditLog.retentionDays",
  cronHistoryRetentionDays: "cron.task.cleanup.cronHistory.retentionDays",
  cloudTriggerHistoryRetentionDays:
    "cron.task.cleanup.cloudTriggerHistory.retentionDays",
  noticeRetentionDays: "cron.task.cleanup.notice.retentionDays",
  recycleBinRetentionDays: "cron.task.cleanup.recycleBin.retentionDays",
  mailSubscriptionUnsubscribedRetentionDays:
    "cron.task.cleanup.mailSubscriptionUnsubscribed.retentionDays",
  refreshTokenExpiredRetentionDays:
    "cron.task.cleanup.refreshToken.expiredRetentionDays",
  passwordResetRetentionMinutes:
    "cron.task.cleanup.passwordReset.retentionMinutes",
  pushSubscriptionMarkInactiveDays:
    "cron.task.cleanup.pushSubscription.markInactiveDays",
  pushSubscriptionDeleteInactiveDays:
    "cron.task.cleanup.pushSubscription.deleteInactiveDays",
  pushSubscriptionDeleteDisabledUserDays:
    "cron.task.cleanup.pushSubscription.deleteDisabledUserDays",
} as const;

const CRON_ANALYTICS_SETTING_KEYS = {
  reportMode: "cron.task.analytics.report.mode",
  reportDailyEnabled: "cron.task.analytics.report.daily.enable",
  reportWeeklyEnabled: "cron.task.analytics.report.weekly.enable",
  reportMonthlyEnabled: "cron.task.analytics.report.monthly.enable",
  reportNotifyAdminUids: "cron.task.analytics.report.notifyAdmin.uid",
} as const;

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}

function normalizeNonNegativeInt(value: unknown, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.round(value));
}

function normalizeAnalyticsReportMode(
  value: unknown,
): CronConfig["analytics"]["report"]["mode"] {
  if (
    value === "NONE" ||
    value === "NOTICE" ||
    value === "EMAIL" ||
    value === "NOTICE_EMAIL"
  ) {
    return value;
  }
  return "NONE";
}

function normalizeUidArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const dedup = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const normalized = item.trim();
    if (!normalized || !/^\d+$/.test(normalized)) continue;
    dedup.add(normalized);
  }

  return Array.from(dedup);
}

function scheduleStorageTempCleanupInBackground(): void {
  void (async () => {
    try {
      const { after } = await import("next/server");
      after(() => {
        cleanupStorageTempFolders().catch((error) => {
          console.error("Auto cleanup: storage temp cleanup failed", error);
        });
      });
    } catch (error) {
      console.error(
        "Auto cleanup: failed to schedule storage temp cleanup with after",
        error,
      );
      cleanupStorageTempFolders().catch((fallbackError) => {
        console.error(
          "Auto cleanup: fallback storage temp cleanup failed",
          fallbackError,
        );
      });
    }
  })();
}

function getCronStatus(
  enabledCount: number,
  successCount: number,
  failedCount: number,
): CronRunStatus {
  if (enabledCount === 0) return "OK";
  if (failedCount === 0) return "OK";
  if (successCount === 0) return "ERROR";
  return "PARTIAL";
}

function createSkippedTaskSnapshot(reason: string): CronTaskSnapshot {
  return {
    e: false,
    x: false,
    s: "S",
    d: 0,
    v: null,
    m: reason,
  };
}

function normalizeTaskStatus(value: unknown): CronTaskStatus {
  if (value === "O" || value === "E" || value === "S") {
    return value;
  }
  return "S";
}

function normalizeTaskSnapshot(
  task: unknown,
  fallback: CronTaskSnapshot,
): CronTaskSnapshot {
  if (!task || typeof task !== "object" || Array.isArray(task)) {
    return fallback;
  }

  const taskObj = task as Record<string, unknown>;
  const durationMsRaw = taskObj.d;
  const durationMs =
    typeof durationMsRaw === "number" &&
    Number.isFinite(durationMsRaw) &&
    durationMsRaw >= 0
      ? Math.round(durationMsRaw)
      : 0;

  return {
    e: typeof taskObj.e === "boolean" ? taskObj.e : fallback.e,
    x: typeof taskObj.x === "boolean" ? taskObj.x : fallback.x,
    s: normalizeTaskStatus(taskObj.s),
    d: durationMs,
    v: taskObj.v ?? null,
    m:
      typeof taskObj.m === "string"
        ? taskObj.m
        : taskObj.m === null
          ? null
          : fallback.m,
    ...(typeof taskObj.b === "string" ? { b: taskObj.b } : {}),
    ...(typeof taskObj.f === "string" ? { f: taskObj.f } : {}),
  };
}

function normalizeCronSnapshot(snapshot: unknown): CronSnapshot {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return {
      version: 1,
      tasks: {
        doctor: createSkippedTaskSnapshot("invalid snapshot"),
        projects: createSkippedTaskSnapshot("invalid snapshot"),
        friends: createSkippedTaskSnapshot("invalid snapshot"),
        cleanup: createSkippedTaskSnapshot("invalid snapshot"),
        analytics: createSkippedTaskSnapshot("invalid snapshot"),
      },
    };
  }

  const snapshotObj = snapshot as {
    version?: unknown;
    tasks?: unknown;
  };
  const rawTasks =
    snapshotObj.tasks && typeof snapshotObj.tasks === "object"
      ? (snapshotObj.tasks as Record<string, unknown>)
      : {};

  const doctorFallback = createSkippedTaskSnapshot("doctor task not found");
  const projectsFallback = createSkippedTaskSnapshot("projects task not found");
  const friendsFallback = createSkippedTaskSnapshot("friends task not found");
  const cleanupFallback = createSkippedTaskSnapshot("cleanup task not found");
  const analyticsFallback = createSkippedTaskSnapshot(
    "analytics task not found",
  );

  return {
    version:
      typeof snapshotObj.version === "number" &&
      Number.isFinite(snapshotObj.version) &&
      snapshotObj.version > 0
        ? Math.round(snapshotObj.version)
        : 1,
    tasks: {
      doctor: normalizeTaskSnapshot(rawTasks.doctor, doctorFallback),
      projects: normalizeTaskSnapshot(rawTasks.projects, projectsFallback),
      friends: normalizeTaskSnapshot(rawTasks.friends, friendsFallback),
      cleanup: normalizeTaskSnapshot(rawTasks.cleanup, cleanupFallback),
      analytics: normalizeTaskSnapshot(rawTasks.analytics, analyticsFallback),
    },
  };
}

function toCronHistoryItem(record: CronHistoryRecord): CronHistoryItem {
  return {
    id: record.id,
    startedAt: record.startedAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
    durationMs: record.durationMs,
    triggerType: record.triggerType,
    status: record.status,
    totalCount: record.totalCount,
    enabledCount: record.enabledCount,
    successCount: record.successCount,
    failedCount: record.failedCount,
    skippedCount: record.skippedCount,
    snapshot: normalizeCronSnapshot(record.snapshot),
  };
}

async function loadCronConfigState(): Promise<CronConfig> {
  const [
    cronEnabled,
    doctorEnabled,
    projectsEnabled,
    friendsEnabled,
    cleanupEnabled,
    analyticsEnabled,
    searchLogRetentionDays,
    healthCheckRetentionDays,
    auditLogRetentionDays,
    cronHistoryRetentionDays,
    cloudTriggerHistoryRetentionDays,
    noticeRetentionDays,
    recycleBinRetentionDays,
    mailSubscriptionUnsubscribedRetentionDays,
    refreshTokenExpiredRetentionDays,
    passwordResetRetentionMinutes,
    pushSubscriptionMarkInactiveDays,
    pushSubscriptionDeleteInactiveDays,
    pushSubscriptionDeleteDisabledUserDays,
    analyticsReportMode,
    analyticsReportDailyEnabled,
    analyticsReportWeeklyEnabled,
    analyticsReportMonthlyEnabled,
    analyticsReportNotifyAdminUids,
  ] = await getConfigs([...CRON_CONFIG_KEYS]);

  const records = await prisma.config.findMany({
    where: {
      key: {
        in: [...CRON_CONFIG_KEYS],
      },
    },
    select: {
      updatedAt: true,
    },
  });

  const updatedAt =
    records.length > 0
      ? records
          .reduce(
            (latest, current) =>
              current.updatedAt.getTime() > latest.getTime()
                ? current.updatedAt
                : latest,
            records[0]!.updatedAt,
          )
          .toISOString()
      : new Date().toISOString();

  return {
    enabled: Boolean(cronEnabled),
    tasks: {
      doctor: Boolean(doctorEnabled),
      projects: Boolean(projectsEnabled),
      friends: Boolean(friendsEnabled),
      cleanup: Boolean(cleanupEnabled),
      analytics: Boolean(analyticsEnabled),
    },
    cleanup: {
      searchLogRetentionDays: normalizeNonNegativeInt(searchLogRetentionDays),
      healthCheckRetentionDays: normalizeNonNegativeInt(
        healthCheckRetentionDays,
      ),
      auditLogRetentionDays: normalizeNonNegativeInt(auditLogRetentionDays),
      cronHistoryRetentionDays: normalizeNonNegativeInt(
        cronHistoryRetentionDays,
      ),
      cloudTriggerHistoryRetentionDays: normalizeNonNegativeInt(
        cloudTriggerHistoryRetentionDays,
      ),
      noticeRetentionDays: normalizeNonNegativeInt(noticeRetentionDays),
      recycleBinRetentionDays: normalizeNonNegativeInt(recycleBinRetentionDays),
      mailSubscriptionUnsubscribedRetentionDays: normalizeNonNegativeInt(
        mailSubscriptionUnsubscribedRetentionDays,
      ),
      refreshTokenExpiredRetentionDays: normalizeNonNegativeInt(
        refreshTokenExpiredRetentionDays,
      ),
      passwordResetRetentionMinutes: normalizeNonNegativeInt(
        passwordResetRetentionMinutes,
      ),
      pushSubscriptionMarkInactiveDays: normalizeNonNegativeInt(
        pushSubscriptionMarkInactiveDays,
      ),
      pushSubscriptionDeleteInactiveDays: normalizeNonNegativeInt(
        pushSubscriptionDeleteInactiveDays,
      ),
      pushSubscriptionDeleteDisabledUserDays: normalizeNonNegativeInt(
        pushSubscriptionDeleteDisabledUserDays,
      ),
    },
    analytics: {
      report: {
        mode: normalizeAnalyticsReportMode(analyticsReportMode),
        dailyEnabled: Boolean(analyticsReportDailyEnabled),
        weeklyEnabled: Boolean(analyticsReportWeeklyEnabled),
        monthlyEnabled: Boolean(analyticsReportMonthlyEnabled),
        notifyAdminUids: normalizeUidArray(analyticsReportNotifyAdminUids),
      },
    },
    updatedAt,
  };
}

async function executeDoctorTask(): Promise<CronTaskSnapshot> {
  const startedAt = new Date();
  const startedAtMs = Date.now();
  try {
    const result = await runDoctorForCron();
    const endedAt = new Date();
    const durationMs = Date.now() - startedAtMs;

    return {
      e: true,
      x: true,
      s: "O",
      d: durationMs,
      v: {
        status: result.status,
        okCount: result.okCount,
        warningCount: result.warningCount,
        errorCount: result.errorCount,
      },
      m: null,
      b: startedAt.toISOString(),
      f: endedAt.toISOString(),
    };
  } catch (error) {
    return {
      e: true,
      x: true,
      s: "E",
      d: Date.now() - startedAtMs,
      v: null,
      m: toErrorMessage(error, "doctor 执行失败"),
      b: startedAt.toISOString(),
      f: new Date().toISOString(),
    };
  }
}

async function executeProjectsTask(): Promise<CronTaskSnapshot> {
  const startedAt = new Date();
  const startedAtMs = Date.now();
  try {
    const result = await runProjectsSyncForCron();
    const endedAt = new Date();
    const durationMs = Date.now() - startedAtMs;

    const taskOk = result.failed === 0;
    return {
      e: true,
      x: true,
      s: taskOk ? "O" : "E",
      d: durationMs,
      v: {
        synced: result.synced,
        failed: result.failed,
      },
      m: taskOk ? null : `同步失败 ${result.failed} 项`,
      b: startedAt.toISOString(),
      f: endedAt.toISOString(),
    };
  } catch (error) {
    return {
      e: true,
      x: true,
      s: "E",
      d: Date.now() - startedAtMs,
      v: null,
      m: toErrorMessage(error, "projects 执行失败"),
      b: startedAt.toISOString(),
      f: new Date().toISOString(),
    };
  }
}

async function executeFriendsTask(): Promise<CronTaskSnapshot> {
  const startedAt = new Date();
  const startedAtMs = Date.now();
  try {
    const result = await runFriendLinksCheckForCron();
    const endedAt = new Date();
    const durationMs = Date.now() - startedAtMs;

    return {
      e: true,
      x: true,
      // 友链任务的业务失败数是检查结果的一部分，不代表任务执行失败。
      // 只要检查流程成功运行并产出结果，就视为任务成功。
      s: "O",
      d: durationMs,
      v: {
        total: result.total,
        checked: result.checked,
        skipped: result.skipped,
        failed: result.failed,
        statusChanged: result.statusChanged,
      },
      m: null,
      b: startedAt.toISOString(),
      f: endedAt.toISOString(),
    };
  } catch (error) {
    return {
      e: true,
      x: true,
      s: "E",
      d: Date.now() - startedAtMs,
      v: null,
      m: toErrorMessage(error, "friends 执行失败"),
      b: startedAt.toISOString(),
      f: new Date().toISOString(),
    };
  }
}

async function executeCleanupTask(): Promise<CronTaskSnapshot> {
  const startedAt = new Date();
  const startedAtMs = Date.now();
  try {
    scheduleStorageTempCleanupInBackground();
    const result = await runAutoCleanupForCron();
    const endedAt = new Date();
    const durationMs = Date.now() - startedAtMs;
    const totalDeleted =
      result.searchLogDeleted +
      result.healthCheckDeleted +
      result.auditLogDeleted +
      result.cronHistoryDeleted +
      result.cloudTriggerHistoryDeleted +
      result.noticeDeleted +
      result.recycleBinDeleted +
      result.unsubscribedMailSubscriptionDeleted +
      result.refreshTokenDeleted +
      result.passwordResetDeleted +
      result.pushSubscriptionsDeletedInactive +
      result.pushSubscriptionsDeletedForDisabledUsers;
    const totalAffected = totalDeleted + result.pushSubscriptionsMarkedInactive;

    return {
      e: true,
      x: true,
      s: "O",
      d: durationMs,
      v: {
        totalDeleted,
        totalAffected,
        searchLogDeleted: result.searchLogDeleted,
        healthCheckDeleted: result.healthCheckDeleted,
        auditLogDeleted: result.auditLogDeleted,
        recycleBinDeleted: result.recycleBinDeleted,
        cronHistoryDeleted: result.cronHistoryDeleted,
        cloudTriggerHistoryDeleted: result.cloudTriggerHistoryDeleted,
        noticeDeleted: result.noticeDeleted,
        unsubscribedMailSubscriptionDeleted:
          result.unsubscribedMailSubscriptionDeleted,
        refreshTokenDeleted: result.refreshTokenDeleted,
        passwordResetDeleted: result.passwordResetDeleted,
        pushSubscriptionsMarkedInactive: result.pushSubscriptionsMarkedInactive,
        pushSubscriptionsDeletedInactive:
          result.pushSubscriptionsDeletedInactive,
        pushSubscriptionsDeletedForDisabledUsers:
          result.pushSubscriptionsDeletedForDisabledUsers,
      },
      m: null,
      b: startedAt.toISOString(),
      f: endedAt.toISOString(),
    };
  } catch (error) {
    return {
      e: true,
      x: true,
      s: "E",
      d: Date.now() - startedAtMs,
      v: null,
      m: toErrorMessage(error, "cleanup 执行失败"),
      b: startedAt.toISOString(),
      f: new Date().toISOString(),
    };
  }
}

async function executeAnalyticsTask(
  triggerType: "MANUAL" | "CLOUD" | "AUTO",
): Promise<CronTaskSnapshot> {
  const startedAt = new Date();
  const startedAtMs = Date.now();
  try {
    const flushResult = await runAnalyticsRollupForCron();
    const reportResult = flushResult.success
      ? await dispatchAnalyticsCronReports({
          triggerType,
          flushResult,
        })
      : {
          mode: "NONE",
          timezone: "UTC",
          recipientCount: 0,
          cycleResults: [],
          noticeSent: 0,
          emailSent: 0,
          errors: [],
        };
    const endedAt = new Date();
    const durationMs = Date.now() - startedAtMs;
    const reportErrorCount = reportResult.errors.length;

    return {
      e: true,
      x: true,
      s: flushResult.success ? "O" : "E",
      d: durationMs,
      v: {
        flushSuccess: flushResult.success,
        flushedCount: flushResult.flushedCount,
        syncedViewCountRows: flushResult.syncedViewCountRows,
        archivedDateGroups: flushResult.archivedDateGroups,
        archivedRawPageViewDeleted: flushResult.archivedRawPageViewDeleted,
        expiredArchiveDeleted: flushResult.expiredArchiveDeleted,
        reportMode: reportResult.mode,
        reportTimezone: reportResult.timezone,
        reportRecipientCount: reportResult.recipientCount,
        reportCycleCount: reportResult.cycleResults.length,
        reportNoticeSent: reportResult.noticeSent,
        reportEmailSent: reportResult.emailSent,
        reportErrorCount,
        reportErrors: reportResult.errors,
        reportCycles: reportResult.cycleResults.map((cycle) => ({
          cycle: cycle.cycle,
          periodLabel: cycle.periodLabel,
          noticeSent: cycle.noticeSent,
          emailSent: cycle.emailSent,
          errorCount: cycle.errorCount,
        })),
      },
      m: flushResult.success
        ? reportErrorCount > 0
          ? `访问统计报告发送出现 ${reportErrorCount} 项异常`
          : null
        : "访问统计整理失败",
      b: startedAt.toISOString(),
      f: endedAt.toISOString(),
    };
  } catch (error) {
    return {
      e: true,
      x: true,
      s: "E",
      d: Date.now() - startedAtMs,
      v: null,
      m: toErrorMessage(error, "analytics 执行失败"),
      b: startedAt.toISOString(),
      f: new Date().toISOString(),
    };
  }
}

async function runCronAndPersist(
  triggerType: "MANUAL" | "CLOUD" | "AUTO",
): Promise<CronHistoryRecord> {
  const config = await loadCronConfigState();
  const startedAt = new Date();
  const startedAtMs = Date.now();

  const taskSnapshots: Record<CronTaskKey, CronTaskSnapshot> = {
    doctor: createSkippedTaskSnapshot("task disabled"),
    projects: createSkippedTaskSnapshot("task disabled"),
    friends: createSkippedTaskSnapshot("task disabled"),
    cleanup: createSkippedTaskSnapshot("task disabled"),
    analytics: createSkippedTaskSnapshot("task disabled"),
  };

  const taskEnabled: Record<CronTaskKey, boolean> = {
    doctor: config.enabled && config.tasks.doctor,
    projects: config.enabled && config.tasks.projects,
    friends: config.enabled && config.tasks.friends,
    cleanup: config.enabled && config.tasks.cleanup,
    analytics: config.enabled && config.tasks.analytics,
  };

  if (!config.enabled) {
    taskSnapshots.doctor = createSkippedTaskSnapshot("cron disabled");
    taskSnapshots.projects = createSkippedTaskSnapshot("cron disabled");
    taskSnapshots.friends = createSkippedTaskSnapshot("cron disabled");
    taskSnapshots.cleanup = createSkippedTaskSnapshot("cron disabled");
    taskSnapshots.analytics = createSkippedTaskSnapshot("cron disabled");
  } else {
    const runners: Array<Promise<void>> = [];

    for (const key of CRON_TASK_KEYS) {
      if (!taskEnabled[key]) {
        taskSnapshots[key] = createSkippedTaskSnapshot("task disabled");
        continue;
      }

      if (key === "doctor") {
        runners.push(
          (async () => {
            taskSnapshots.doctor = await executeDoctorTask();
          })(),
        );
      } else if (key === "projects") {
        runners.push(
          (async () => {
            taskSnapshots.projects = await executeProjectsTask();
          })(),
        );
      } else if (key === "friends") {
        runners.push(
          (async () => {
            taskSnapshots.friends = await executeFriendsTask();
          })(),
        );
      } else if (key === "cleanup") {
        runners.push(
          (async () => {
            taskSnapshots.cleanup = await executeCleanupTask();
          })(),
        );
      } else {
        runners.push(
          (async () => {
            taskSnapshots.analytics = await executeAnalyticsTask(triggerType);
          })(),
        );
      }
    }

    await Promise.all(runners);
  }

  const totalCount = CRON_TASK_KEYS.length;
  const enabledCount = CRON_TASK_KEYS.filter((key) => taskEnabled[key]).length;
  const successCount = CRON_TASK_KEYS.filter(
    (key) => taskSnapshots[key].x && taskSnapshots[key].s === "O",
  ).length;
  const failedCount = CRON_TASK_KEYS.filter(
    (key) => taskSnapshots[key].x && taskSnapshots[key].s === "E",
  ).length;
  const skippedCount = CRON_TASK_KEYS.filter(
    (key) => taskSnapshots[key].s === "S",
  ).length;

  const status = getCronStatus(enabledCount, successCount, failedCount);
  const durationMs = Date.now() - startedAtMs;

  const snapshot: CronSnapshot = {
    version: 1,
    tasks: taskSnapshots,
  };

  return await prisma.cronHistory.create({
    data: {
      startedAt,
      durationMs,
      triggerType,
      status,
      totalCount,
      enabledCount,
      successCount,
      failedCount,
      skippedCount,
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
    },
    select: {
      id: true,
      startedAt: true,
      createdAt: true,
      durationMs: true,
      triggerType: true,
      status: true,
      totalCount: true,
      enabledCount: true,
      successCount: true,
      failedCount: true,
      skippedCount: true,
      snapshot: true,
    },
  });
}

export async function triggerCron(
  params: TriggerCron,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CronHistoryItem | null>>>;
export async function triggerCron(
  params: TriggerCron,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CronHistoryItem | null>>;
export async function triggerCron(
  { access_token, triggerType = "MANUAL" }: TriggerCron,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CronHistoryItem | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "triggerCron"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      triggerType,
    },
    TriggerCronSchema,
  );
  if (validationError) return response.badRequest(validationError);

  const user = await authVerify({
    allowedRoles: ["ADMIN"],
    accessToken: access_token,
  });
  if (!user) {
    return response.unauthorized();
  }

  try {
    const record = await runCronAndPersist(triggerType);

    try {
      await logAuditEvent({
        user: {
          uid: user.uid.toString(),
        },
        details: {
          action: "CREATE",
          resourceType: "CRON_HISTORY",
          resourceId: String(record.id),
          value: {
            old: null,
            new: {
              id: record.id,
              triggerType: record.triggerType,
              status: record.status,
              enabledCount: record.enabledCount,
              successCount: record.successCount,
              failedCount: record.failedCount,
              skippedCount: record.skippedCount,
            },
          },
          description: `管理员触发计划任务 - 结果: ${record.status}`,
        },
      });
    } catch (error) {
      console.error("Failed to log audit event:", error);
    }

    return response.ok({
      data: toCronHistoryItem(record),
    });
  } catch (error) {
    console.error("Trigger cron error:", error);
    return response.serverError();
  }
}

// Backward-compatible Server Actions delegate to the common server-only service.
export async function getCronHistory(
  params: GetCronHistory,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CronHistoryItem[] | null>>>;
export async function getCronHistory(
  params: GetCronHistory,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CronHistoryItem[] | null>>;
export async function getCronHistory(
  params: GetCronHistory,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CronHistoryItem[] | null>> {
  return getCronHistoryService(params, serverConfig);
}

export async function getCronTrends(
  params: GetCronTrends,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CronTrendItem[] | null>>>;
export async function getCronTrends(
  params: GetCronTrends,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CronTrendItem[] | null>>;
export async function getCronTrends(
  params: GetCronTrends,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CronTrendItem[] | null>> {
  return getCronTrendsService(params, serverConfig);
}

export async function getCronConfig(
  params: GetCronConfig,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CronConfig | null>>>;
export async function getCronConfig(
  params: GetCronConfig,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CronConfig | null>>;
export async function getCronConfig(
  { access_token }: GetCronConfig,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CronConfig | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getCronConfig"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
    },
    GetCronConfigSchema,
  );
  if (validationError) return response.badRequest(validationError);

  const user = await authVerify({
    allowedRoles: ["ADMIN"],
    accessToken: access_token,
  });
  if (!user) {
    return response.unauthorized();
  }

  try {
    const data = await loadCronConfigState();
    return response.ok({ data });
  } catch (error) {
    console.error("Get cron config error:", error);
    return response.serverError();
  }
}

export async function updateCronConfig(
  params: UpdateCronConfig,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CronConfig | null>>>;
export async function updateCronConfig(
  params: UpdateCronConfig,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CronConfig | null>>;
export async function updateCronConfig(
  {
    access_token,
    enabled,
    doctor,
    projects,
    friends,
    cleanup,
    analytics,
    searchLogRetentionDays,
    healthCheckRetentionDays,
    auditLogRetentionDays,
    cronHistoryRetentionDays,
    cloudTriggerHistoryRetentionDays,
    noticeRetentionDays,
    recycleBinRetentionDays,
    mailSubscriptionUnsubscribedRetentionDays,
    refreshTokenExpiredRetentionDays,
    passwordResetRetentionMinutes,
    pushSubscriptionMarkInactiveDays,
    pushSubscriptionDeleteInactiveDays,
    pushSubscriptionDeleteDisabledUserDays,
    analyticsReportMode,
    analyticsReportDailyEnabled,
    analyticsReportWeeklyEnabled,
    analyticsReportMonthlyEnabled,
    analyticsReportNotifyAdminUids,
  }: UpdateCronConfig,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CronConfig | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "updateCronConfig"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      enabled,
      doctor,
      projects,
      friends,
      cleanup,
      analytics,
      searchLogRetentionDays,
      healthCheckRetentionDays,
      auditLogRetentionDays,
      cronHistoryRetentionDays,
      cloudTriggerHistoryRetentionDays,
      noticeRetentionDays,
      recycleBinRetentionDays,
      mailSubscriptionUnsubscribedRetentionDays,
      refreshTokenExpiredRetentionDays,
      passwordResetRetentionMinutes,
      pushSubscriptionMarkInactiveDays,
      pushSubscriptionDeleteInactiveDays,
      pushSubscriptionDeleteDisabledUserDays,
      analyticsReportMode,
      analyticsReportDailyEnabled,
      analyticsReportWeeklyEnabled,
      analyticsReportMonthlyEnabled,
      analyticsReportNotifyAdminUids,
    },
    UpdateCronConfigSchema,
  );
  if (validationError) return response.badRequest(validationError);

  const user = await authVerify({
    allowedRoles: ["ADMIN"],
    accessToken: access_token,
  });
  if (!user) {
    return response.unauthorized();
  }

  try {
    const previousConfig = await loadCronConfigState();

    const updates: Array<{
      key: (typeof CRON_CONFIG_KEYS)[number];
      value: boolean | number | string | string[];
    }> = [];

    if (enabled !== undefined) {
      updates.push({ key: "cron.enable", value: enabled });
    }
    if (doctor !== undefined) {
      updates.push({ key: "cron.task.doctor.enable", value: doctor });
    }
    if (projects !== undefined) {
      updates.push({ key: "cron.task.projects.enable", value: projects });
    }
    if (friends !== undefined) {
      updates.push({ key: "cron.task.friends.enable", value: friends });
    }
    if (cleanup !== undefined) {
      updates.push({ key: "cron.task.cleanup.enable", value: cleanup });
    }
    if (analytics !== undefined) {
      updates.push({ key: "cron.task.analytics.enable", value: analytics });
    }
    if (searchLogRetentionDays !== undefined) {
      updates.push({
        key: CRON_CLEANUP_SETTING_KEYS.searchLogRetentionDays,
        value: searchLogRetentionDays,
      });
    }
    if (healthCheckRetentionDays !== undefined) {
      updates.push({
        key: CRON_CLEANUP_SETTING_KEYS.healthCheckRetentionDays,
        value: healthCheckRetentionDays,
      });
    }
    if (auditLogRetentionDays !== undefined) {
      updates.push({
        key: CRON_CLEANUP_SETTING_KEYS.auditLogRetentionDays,
        value: auditLogRetentionDays,
      });
    }
    if (cronHistoryRetentionDays !== undefined) {
      updates.push({
        key: CRON_CLEANUP_SETTING_KEYS.cronHistoryRetentionDays,
        value: cronHistoryRetentionDays,
      });
    }
    if (cloudTriggerHistoryRetentionDays !== undefined) {
      updates.push({
        key: CRON_CLEANUP_SETTING_KEYS.cloudTriggerHistoryRetentionDays,
        value: cloudTriggerHistoryRetentionDays,
      });
    }
    if (noticeRetentionDays !== undefined) {
      updates.push({
        key: CRON_CLEANUP_SETTING_KEYS.noticeRetentionDays,
        value: noticeRetentionDays,
      });
    }
    if (recycleBinRetentionDays !== undefined) {
      updates.push({
        key: CRON_CLEANUP_SETTING_KEYS.recycleBinRetentionDays,
        value: recycleBinRetentionDays,
      });
    }
    if (mailSubscriptionUnsubscribedRetentionDays !== undefined) {
      updates.push({
        key: CRON_CLEANUP_SETTING_KEYS.mailSubscriptionUnsubscribedRetentionDays,
        value: mailSubscriptionUnsubscribedRetentionDays,
      });
    }
    if (refreshTokenExpiredRetentionDays !== undefined) {
      updates.push({
        key: CRON_CLEANUP_SETTING_KEYS.refreshTokenExpiredRetentionDays,
        value: refreshTokenExpiredRetentionDays,
      });
    }
    if (passwordResetRetentionMinutes !== undefined) {
      updates.push({
        key: CRON_CLEANUP_SETTING_KEYS.passwordResetRetentionMinutes,
        value: passwordResetRetentionMinutes,
      });
    }
    if (pushSubscriptionMarkInactiveDays !== undefined) {
      updates.push({
        key: CRON_CLEANUP_SETTING_KEYS.pushSubscriptionMarkInactiveDays,
        value: pushSubscriptionMarkInactiveDays,
      });
    }
    if (pushSubscriptionDeleteInactiveDays !== undefined) {
      updates.push({
        key: CRON_CLEANUP_SETTING_KEYS.pushSubscriptionDeleteInactiveDays,
        value: pushSubscriptionDeleteInactiveDays,
      });
    }
    if (pushSubscriptionDeleteDisabledUserDays !== undefined) {
      updates.push({
        key: CRON_CLEANUP_SETTING_KEYS.pushSubscriptionDeleteDisabledUserDays,
        value: pushSubscriptionDeleteDisabledUserDays,
      });
    }
    if (analyticsReportMode !== undefined) {
      updates.push({
        key: CRON_ANALYTICS_SETTING_KEYS.reportMode,
        value: normalizeAnalyticsReportMode(analyticsReportMode),
      });
    }
    if (analyticsReportDailyEnabled !== undefined) {
      updates.push({
        key: CRON_ANALYTICS_SETTING_KEYS.reportDailyEnabled,
        value: analyticsReportDailyEnabled,
      });
    }
    if (analyticsReportWeeklyEnabled !== undefined) {
      updates.push({
        key: CRON_ANALYTICS_SETTING_KEYS.reportWeeklyEnabled,
        value: analyticsReportWeeklyEnabled,
      });
    }
    if (analyticsReportMonthlyEnabled !== undefined) {
      updates.push({
        key: CRON_ANALYTICS_SETTING_KEYS.reportMonthlyEnabled,
        value: analyticsReportMonthlyEnabled,
      });
    }
    if (analyticsReportNotifyAdminUids !== undefined) {
      updates.push({
        key: CRON_ANALYTICS_SETTING_KEYS.reportNotifyAdminUids,
        value: normalizeUidArray(analyticsReportNotifyAdminUids),
      });
    }

    if (updates.length === 0) {
      return response.badRequest({
        message: "必须提供至少一个配置项",
      });
    }

    await prisma.$transaction(async (tx) => {
      for (const updateItem of updates) {
        await tx.config.upsert({
          where: {
            key: updateItem.key,
          },
          update: {
            value: {
              default: updateItem.value,
            },
          },
          create: {
            key: updateItem.key,
            value: {
              default: updateItem.value,
            },
          },
        });
      }
    });

    updateTag("config");
    updateTag("menus");
    for (const updateItem of updates) {
      updateTag(`config/${updateItem.key}`);
    }

    const data = await loadCronConfigState();

    try {
      await logAuditEvent({
        user: {
          uid: user.uid.toString(),
        },
        details: {
          action: "UPDATE",
          resourceType: "CRON_CONFIG",
          resourceId: "global",
          value: {
            old: previousConfig,
            new: data,
          },
          description: "管理员更新计划任务配置",
          metadata: {
            updateCount: updates.length,
          },
        },
      });
    } catch (error) {
      console.error("Failed to log audit event:", error);
    }

    return response.ok({
      message: "计划任务配置已更新",
      data,
    });
  } catch (error) {
    console.error("Update cron config error:", error);
    return response.serverError();
  }
}
