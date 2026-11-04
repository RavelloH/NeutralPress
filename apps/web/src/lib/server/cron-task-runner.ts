import "server-only";

import type { DoctorSuccessResponse } from "@repo/shared-types/api/doctor";
import type {
  CheckFriendLinksResult,
  FriendLinkIssueType,
  FriendLinkStatus,
} from "@repo/shared-types/api/friendlink";
import type { SyncProjectsGithubResult } from "@repo/shared-types/api/project";

import {
  formatDoctorCheckDetails,
  getDoctorCheckMessage,
  getDoctorCheckOrder,
} from "@/data/check-config";
import { flushEventsToDatabase } from "@/lib/server/analytics-flush";
import { getConfig, getConfigs } from "@/lib/server/config-cache";
import { runAutoCleanupMaintenance } from "@/lib/server/doctor-maintenance";
import { expireCacheTag } from "@/lib/server/isr-invalidation";
import prisma from "@/lib/server/prisma";
import redis, { ensureRedisConnection } from "@/lib/server/redis";
import {
  assertPublicHttpUrl,
  readResponseBufferWithLimit,
} from "@/lib/server/url-security";

import { Prisma } from ".prisma/client";

type SnapshotStatus = "O" | "W" | "E";
type SnapshotValue = number | string | boolean | null;
type SnapshotCheck = {
  v: SnapshotValue;
  d: number;
  s: SnapshotStatus;
};
type HealthCheckSnapshot = {
  checks: Record<string, SnapshotCheck>;
};

type StoredFriendLinkCheckHistoryItem = {
  time: string;
  responseTime: number | null;
  statusCode: number | null;
  issueType: FriendLinkIssueType;
  hasBacklink?: boolean;
};

const DOCTOR_SITE_SELF_TIMEOUT_MS = 10000;
const PROJECTS_FETCH_TIMEOUT_MS = 15000;
const DB_CONNECTION_USAGE_WARNING_PERCENT = 50;
const DB_CONNECTION_USAGE_ERROR_PERCENT = 80;
const REDIS_LATENCY_WARNING_MS = 25;
const REDIS_LATENCY_ERROR_MS = 100;
const REDIS_MEMORY_WARNING_BYTES = 16 * 1024 * 1024;
const REDIS_MEMORY_ERROR_BYTES = 64 * 1024 * 1024;
const REDIS_KEYS_WARNING_COUNT = 750;
const REDIS_KEYS_ERROR_COUNT = 1500;

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}

async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function classifyByThreshold(
  value: number,
  warningThreshold: number,
  errorThreshold: number,
): SnapshotStatus {
  if (value < warningThreshold) return "O";
  if (value < errorThreshold) return "W";
  return "E";
}

function snapshotStatusToSeverity(
  status: SnapshotStatus,
): "info" | "warning" | "error" {
  if (status === "E") return "error";
  if (status === "W") return "warning";
  return "info";
}

function normalizeSnapshotValue(value: unknown): SnapshotValue {
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return null;
}

function buildDoctorIssues(
  snapshotChecks: Record<string, SnapshotCheck>,
): DoctorSuccessResponse["data"]["issues"] {
  const checks = Object.entries(snapshotChecks).map(([code, check]) => ({
    code,
    message: getDoctorCheckMessage(code),
    severity: snapshotStatusToSeverity(check.s),
    details: formatDoctorCheckDetails(code, check.v),
  }));

  checks.sort((a, b) => {
    const orderDiff = getDoctorCheckOrder(a.code) - getDoctorCheckOrder(b.code);
    if (orderDiff !== 0) return orderDiff;
    return a.code.localeCompare(b.code);
  });

  return checks;
}

async function measure<T>(
  fn: () => Promise<T>,
): Promise<{ value: T; durationMs: number }> {
  const started = Date.now();
  const value = await fn();
  return { value, durationMs: Date.now() - started };
}

function getOverallStatus(counts: {
  okCount: number;
  warningCount: number;
  errorCount: number;
}): "OK" | "WARNING" | "ERROR" {
  if (counts.errorCount > 0) return "ERROR";
  if (counts.warningCount > 0) return "WARNING";
  return "OK";
}

function parseFriendLinkHistory(
  rawHistory: Prisma.JsonValue,
): StoredFriendLinkCheckHistoryItem[] {
  if (!Array.isArray(rawHistory)) return [];

  const parsed: StoredFriendLinkCheckHistoryItem[] = [];
  for (const item of rawHistory) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const issueTypeRaw = record.issueType;
    const issueType: FriendLinkIssueType =
      issueTypeRaw === "DISCONNECT" ||
      issueTypeRaw === "NO_BACKLINK" ||
      issueTypeRaw === "NONE"
        ? issueTypeRaw
        : "NONE";

    parsed.push({
      time:
        typeof record.time === "string"
          ? record.time
          : new Date(0).toISOString(),
      responseTime:
        typeof record.responseTime === "number" &&
        Number.isFinite(record.responseTime)
          ? Math.max(0, Math.round(record.responseTime))
          : null,
      statusCode:
        typeof record.statusCode === "number" &&
        Number.isFinite(record.statusCode)
          ? Math.round(record.statusCode)
          : null,
      issueType,
      ...(typeof record.hasBacklink === "boolean"
        ? { hasBacklink: record.hasBacklink }
        : {}),
    });
  }

  return parsed;
}

function countFriendLinkIssues(
  history: StoredFriendLinkCheckHistoryItem[],
): number {
  return history.filter((item) => item.issueType !== "NONE").length;
}

function isFriendLinkFullFailure(
  history: StoredFriendLinkCheckHistoryItem[],
): boolean {
  return history.length === 30 && countFriendLinkIssues(history) === 30;
}

function shouldAutoManageFriendLinkStatus(status: FriendLinkStatus): boolean {
  return (
    status === "PUBLISHED" ||
    status === "DISCONNECT" ||
    status === "NO_BACKLINK"
  );
}

function getDomainFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasBacklinkInHtml(html: string, siteDomain: string): boolean {
  const escapedDomain = escapeRegex(siteDomain);
  const domainRegex = new RegExp(
    `https?:\\/\\/(?:[^"'>\\s]*\\.)?${escapedDomain}(?:[\\/"'\\s]|$)`,
    "i",
  );
  if (domainRegex.test(html)) return true;

  const plainDomainRegex = new RegExp(`\\b${escapedDomain}\\b`, "i");
  return plainDomainRegex.test(html);
}

async function requestUrlWithTiming(url: string): Promise<{
  ok: boolean;
  statusCode: number | null;
  responseTime: number | null;
  html: string | null;
}> {
  const startedAt = performance.now();
  try {
    const safeUrl = (await assertPublicHttpUrl(url.trim())).url.toString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let response: Response;

    try {
      response = await fetch(safeUrl, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent": "NeutralPress FriendLinkChecker/1.0",
        },
        cache: "no-store",
      });
    } finally {
      clearTimeout(timeout);
    }

    const htmlBuffer = await readResponseBufferWithLimit(
      response,
      2 * 1024 * 1024,
    );
    return {
      ok: response.ok,
      statusCode: response.status,
      responseTime: Math.max(0, Math.round(performance.now() - startedAt)),
      html: htmlBuffer.toString("utf-8"),
    };
  } catch {
    return {
      ok: false,
      statusCode: null,
      responseTime: null,
      html: null,
    };
  }
}

export async function runDoctorHealthCheck(
  options: RunDoctorHealthCheckOptions,
): Promise<RunDoctorHealthCheckResult> {
  const startedAt = new Date();
  const startedAtMs = Date.now();

  const getDbSize = async (): Promise<number> => {
    const result = await prisma.$queryRaw<Array<{ size: bigint }>>`
      SELECT pg_database_size(current_database()) AS size;
    `;
    return Number(result[0]?.size || 0);
  };

  const getDbLatency = async (): Promise<number> => {
    const started = Date.now();
    await prisma.$queryRaw`SELECT 1;`;
    return Date.now() - started;
  };

  const getDbConnectionUsagePercent = async (): Promise<number> => {
    const result = await prisma.$queryRaw<Array<{ used: bigint; max: string }>>`
      SELECT
        count(*) FILTER (WHERE backend_type = 'client backend') AS used,
        current_setting('max_connections') AS max
      FROM pg_stat_activity
      ;
    `;

    const usedConnections = Number(result[0]?.used || 0);
    const maxConnections = Number(result[0]?.max || 0);
    if (!Number.isFinite(maxConnections) || maxConnections <= 0) {
      return 0;
    }
    return (usedConnections / maxConnections) * 100;
  };

  const getRedisLatency = async (): Promise<number> => {
    try {
      await ensureRedisConnection();
      const started = Date.now();
      await redis.ping();
      return Date.now() - started;
    } catch {
      return -1;
    }
  };

  const parseRedisInfoNumber = (info: string, key: string): number | null => {
    const prefix = `${key}:`;
    for (const rawLine of info.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#") || !line.startsWith(prefix)) {
        continue;
      }
      const value = Number.parseInt(line.slice(prefix.length), 10);
      if (Number.isFinite(value) && value >= 0) {
        return value;
      }
      return null;
    }
    return null;
  };

  const getRedisMemoryUsage = async (): Promise<number | null> => {
    try {
      await ensureRedisConnection();
      const memoryInfo = await redis.info("memory");
      return parseRedisInfoNumber(memoryInfo, "used_memory");
    } catch {
      return null;
    }
  };

  const getRedisKeysCount = async (): Promise<number | null> => {
    try {
      await ensureRedisConnection();
      const keyCount = Number(await redis.dbsize());
      if (Number.isFinite(keyCount) && keyCount >= 0) {
        return keyCount;
      }
      return null;
    } catch {
      return null;
    }
  };

  const getSiteSelfLatency = async (): Promise<{
    ok: boolean;
    latencyMs: number | null;
    message?: string;
  }> => {
    try {
      const siteUrlConfig = await getConfig("site.url");
      const siteUrl =
        typeof siteUrlConfig === "string" ? siteUrlConfig.trim() : "";

      if (!siteUrl) {
        return { ok: false, latencyMs: null, message: "site.url 未配置" };
      }

      const target = new URL(siteUrl);
      target.pathname = "/";
      target.search = "";
      target.hash = "";

      const started = Date.now();
      const response = await fetchWithTimeout(
        target.toString(),
        {
          method: "GET",
          cache: "no-store",
        },
        DOCTOR_SITE_SELF_TIMEOUT_MS,
      );
      const latencyMs = Date.now() - started;

      if (!response.ok) {
        return {
          ok: false,
          latencyMs,
          message: `HTTP ${response.status}`,
        };
      }

      return {
        ok: true,
        latencyMs,
      };
    } catch (error) {
      const message = toErrorMessage(error, "访问失败");
      if (message.toLowerCase().includes("abort")) {
        return { ok: false, latencyMs: null, message: "访问超时" };
      }
      return { ok: false, latencyMs: null, message };
    }
  };

  const [
    flushResult,
    siteLatencyResult,
    dbSizeResult,
    dbLatencyResult,
    dbConnectionResult,
    redisLatencyResult,
    redisMemoryResult,
    redisKeysResult,
  ] = await Promise.all([
    measure(flushEventsToDatabase),
    measure(getSiteSelfLatency),
    measure(getDbSize),
    measure(getDbLatency),
    measure(getDbConnectionUsagePercent),
    measure(getRedisLatency),
    measure(getRedisMemoryUsage),
    measure(getRedisKeysCount),
  ]);

  const snapshot: HealthCheckSnapshot = { checks: {} };

  snapshot.checks.ANALYTICS_FLUSH_SUCCESS_COUNT = {
    v: flushResult.value.success ? flushResult.value.flushedCount : null,
    d: flushResult.durationMs,
    s: flushResult.value.success ? "O" : "E",
  };

  if (
    siteLatencyResult.value.ok &&
    siteLatencyResult.value.latencyMs !== null
  ) {
    snapshot.checks.SITE_SELF_LATENCY = {
      v: siteLatencyResult.value.latencyMs,
      d: siteLatencyResult.durationMs,
      s: classifyByThreshold(siteLatencyResult.value.latencyMs, 500, 1500),
    };
  } else {
    snapshot.checks.SITE_SELF_LATENCY = {
      v: siteLatencyResult.value.message || "检查失败",
      d: siteLatencyResult.durationMs,
      s: "E",
    };
  }

  snapshot.checks.DB_LATENCY = {
    v: dbLatencyResult.value,
    d: dbLatencyResult.durationMs,
    s: classifyByThreshold(dbLatencyResult.value, 100, 300),
  };

  snapshot.checks.DB_CONNECTIONS = {
    v: dbConnectionResult.value,
    d: dbConnectionResult.durationMs,
    s: classifyByThreshold(
      dbConnectionResult.value,
      DB_CONNECTION_USAGE_WARNING_PERCENT,
      DB_CONNECTION_USAGE_ERROR_PERCENT,
    ),
  };

  snapshot.checks.DB_SIZE = {
    v: dbSizeResult.value,
    d: dbSizeResult.durationMs,
    s: "O",
  };

  if (redisLatencyResult.value === -1) {
    snapshot.checks.REDIS_CONNECTION = {
      v: false,
      d: redisLatencyResult.durationMs,
      s: "E",
    };
  } else {
    snapshot.checks.REDIS_LATENCY = {
      v: redisLatencyResult.value,
      d: redisLatencyResult.durationMs,
      s: classifyByThreshold(
        redisLatencyResult.value,
        REDIS_LATENCY_WARNING_MS,
        REDIS_LATENCY_ERROR_MS,
      ),
    };
  }

  if (redisMemoryResult.value === null) {
    snapshot.checks.REDIS_MEMORY = {
      v: "检查失败",
      d: redisMemoryResult.durationMs,
      s: "E",
    };
  } else {
    snapshot.checks.REDIS_MEMORY = {
      v: redisMemoryResult.value,
      d: redisMemoryResult.durationMs,
      s: classifyByThreshold(
        redisMemoryResult.value,
        REDIS_MEMORY_WARNING_BYTES,
        REDIS_MEMORY_ERROR_BYTES,
      ),
    };
  }

  if (redisKeysResult.value === null) {
    snapshot.checks.REDIS_KEYS = {
      v: "检查失败",
      d: redisKeysResult.durationMs,
      s: "E",
    };
  } else {
    snapshot.checks.REDIS_KEYS = {
      v: redisKeysResult.value,
      d: redisKeysResult.durationMs,
      s: classifyByThreshold(
        redisKeysResult.value,
        REDIS_KEYS_WARNING_COUNT,
        REDIS_KEYS_ERROR_COUNT,
      ),
    };
  }

  const checks = Object.values(snapshot.checks);
  const okCount = checks.filter((check) => check.s === "O").length;
  const warningCount = checks.filter((check) => check.s === "W").length;
  const errorCount = checks.filter((check) => check.s === "E").length;
  const status = getOverallStatus({ okCount, warningCount, errorCount });
  const durationMs = Date.now() - startedAtMs;
  const issues = buildDoctorIssues(snapshot.checks);

  const created = await prisma.healthCheck.create({
    data: {
      startedAt,
      durationMs,
      triggerType: options.triggerType,
      overallStatus: status,
      okCount,
      warningCount,
      errorCount,
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
    },
    select: {
      createdAt: true,
      startedAt: true,
      durationMs: true,
      triggerType: true,
      overallStatus: true,
      okCount: true,
      warningCount: true,
      errorCount: true,
      id: true,
    },
  });

  return {
    id: created.id,
    data: {
      createdAt: created.createdAt.toISOString(),
      startedAt: created.startedAt.toISOString(),
      durationMs: created.durationMs,
      triggerType: created.triggerType,
      status: created.overallStatus,
      okCount: created.okCount,
      warningCount: created.warningCount,
      errorCount: created.errorCount,
      issues,
    },
  };
}

export async function runDoctorForCron(): Promise<
  DoctorSuccessResponse["data"]
> {
  const result = await runDoctorHealthCheck({
    triggerType: "CRON",
  });
  return result.data;
}

type RunProjectsGithubSyncOptions = {
  ids?: number[];
};

export async function runProjectsGithubSync(
  options: RunProjectsGithubSyncOptions = {},
): Promise<SyncProjectsGithubResult> {
  const githubToken = await getConfig("content.githubAutoSync.personalKey");
  const projects = await prisma.project.findMany({
    where: {
      enableGithubSync: true,
      repoPath: { not: null },
      deletedAt: null,
      ...(options.ids && options.ids.length > 0
        ? {
            id: {
              in: options.ids,
            },
          }
        : {}),
    },
    select: {
      id: true,
      slug: true,
      repoPath: true,
      enableConentSync: true,
    },
  });

  if (projects.length === 0) {
    return { synced: 0, failed: 0, results: [] };
  }

  const results = await Promise.allSettled(
    projects.map(async (project) => {
      if (!project.repoPath) {
        return {
          id: project.id,
          slug: project.slug,
          success: false,
          error: "仓库路径为空",
        };
      }

      const [owner, repo] = project.repoPath.split("/");
      if (!owner || !repo) {
        return {
          id: project.id,
          slug: project.slug,
          success: false,
          error: "仓库路径格式不正确",
        };
      }

      const headers: Record<string, string> = {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "NeutralPress-CMS",
      };
      if (typeof githubToken === "string" && githubToken.trim()) {
        headers.Authorization = `Bearer ${githubToken}`;
      }

      const repoResponse = await fetchWithTimeout(
        `https://api.github.com/repos/${owner}/${repo}`,
        { headers },
        PROJECTS_FETCH_TIMEOUT_MS,
      );

      if (!repoResponse.ok) {
        return {
          id: project.id,
          slug: project.slug,
          success: false,
          error: `GitHub API 错误: ${repoResponse.status} ${repoResponse.statusText}`,
        };
      }

      const repoData = await repoResponse.json();
      const languagesResponse = await fetchWithTimeout(
        `https://api.github.com/repos/${owner}/${repo}/languages`,
        { headers },
        PROJECTS_FETCH_TIMEOUT_MS,
      );

      let languages: Record<string, number> | null = null;
      if (languagesResponse.ok) {
        languages = await languagesResponse.json();
      }

      const stars =
        typeof repoData.stargazers_count === "number"
          ? repoData.stargazers_count
          : 0;
      const forks =
        typeof repoData.forks_count === "number" ? repoData.forks_count : 0;

      const updateData: Prisma.ProjectUpdateInput = {
        stars,
        forks,
        languages:
          languages === null
            ? Prisma.JsonNull
            : (languages as Prisma.InputJsonValue),
        license: repoData.license?.spdx_id || null,
      };

      if (project.enableConentSync) {
        const readmeResponse = await fetchWithTimeout(
          `https://api.github.com/repos/${owner}/${repo}/readme`,
          {
            headers: {
              ...headers,
              Accept: "application/vnd.github.v3.raw",
            },
          },
          PROJECTS_FETCH_TIMEOUT_MS,
        );
        if (readmeResponse.ok) {
          updateData.content = await readmeResponse.text();
        }
      }

      await prisma.project.update({
        where: { id: project.id, deletedAt: null },
        data: updateData,
      });

      return {
        id: project.id,
        slug: project.slug,
        success: true,
        stars,
        forks,
      };
    }),
  );

  const syncResults = results.map((item, index) => {
    if (item.status === "fulfilled") return item.value;
    const source = projects[index];
    return {
      id: source?.id ?? 0,
      slug: source?.slug ?? "",
      success: false,
      error: toErrorMessage(item.reason, "Promise rejected"),
    };
  });

  const synced = syncResults.filter((item) => item.success).length;
  const failed = syncResults.filter((item) => !item.success).length;

  // Only invalidate successfully committed project updates.
  if (synced > 0) {
    expireCacheTag("projects/list");
    for (const item of syncResults) {
      if (item.success) expireCacheTag(`projects/${item.slug}`);
    }
  }

  return {
    synced,
    failed,
    results: syncResults,
  };
}

export async function runProjectsSyncForCron(): Promise<SyncProjectsGithubResult> {
  return runProjectsGithubSync();
}

type RunFriendLinksCheckOptions = {
  checkAll?: boolean;
  ids?: number[];
};

export async function runFriendLinksCheck(
  options: RunFriendLinksCheckOptions = {},
): Promise<CheckFriendLinksResult> {
  const checkAll = options.checkAll ?? false;
  const ids = options.ids ?? [];

  if (!checkAll && ids.length === 0) {
    return {
      total: 0,
      checked: 0,
      skipped: 0,
      failed: 0,
      statusChanged: 0,
      results: [],
    };
  }

  const [checkBacklinkEnabled, autoManageStatusEnabled, siteUrl] =
    await getConfigs([
      "friendlink.autoCheck.checkBackLink.enable",
      "friendlink.autoCheck.autoManageStatus.enable",
      "site.url",
    ]);

  const siteDomain = getDomainFromUrl(siteUrl);
  const links = await prisma.friendLink.findMany({
    where: {
      deletedAt: null,
      ...(checkAll
        ? {}
        : {
            id: {
              in: ids,
            },
          }),
    },
    select: {
      id: true,
      name: true,
      url: true,
      friendLinkUrl: true,
      ignoreBacklink: true,
      status: true,
      checkSuccessCount: true,
      checkFailureCount: true,
      avgResponseTime: true,
      checkHistory: true,
      publishedAt: true,
    },
    orderBy: {
      id: "asc",
    },
  });

  if (links.length === 0) {
    return {
      total: 0,
      checked: 0,
      skipped: 0,
      failed: 0,
      statusChanged: 0,
      results: [],
    };
  }

  type CheckExecutionResult = {
    result: CheckFriendLinksResult["results"][number];
    failed: boolean;
    statusChanged: boolean;
  };

  const executeSingleCheck = async (
    link: (typeof links)[number],
  ): Promise<CheckExecutionResult> => {
    if (link.status === "WHITELIST") {
      return {
        result: {
          id: link.id,
          status: link.status as FriendLinkStatus,
          checked: false,
          skipped: true,
          skipReason: "WHITELIST",
          issueType: "NONE",
          message: "白名单链接，已跳过检查",
        },
        failed: false,
        statusChanged: false,
      };
    }

    try {
      const shouldCheckBacklink =
        Boolean(checkBacklinkEnabled) &&
        !link.ignoreBacklink &&
        Boolean(link.friendLinkUrl) &&
        Boolean(siteDomain);
      const targetUrl = shouldCheckBacklink
        ? (link.friendLinkUrl as string)
        : link.url;

      const requestResult = await requestUrlWithTiming(targetUrl);
      let issueType: FriendLinkIssueType = "NONE";
      let hasBacklink: boolean | undefined;

      if (!requestResult.ok) {
        issueType = "DISCONNECT";
      } else if (shouldCheckBacklink) {
        hasBacklink = hasBacklinkInHtml(
          requestResult.html || "",
          siteDomain as string,
        );
        if (!hasBacklink) {
          issueType = "NO_BACKLINK";
        }
      }

      const history = parseFriendLinkHistory(link.checkHistory);
      const newHistoryItem: StoredFriendLinkCheckHistoryItem = {
        time: new Date().toISOString(),
        responseTime: requestResult.responseTime,
        statusCode: requestResult.statusCode,
        issueType,
        ...(typeof hasBacklink === "boolean" ? { hasBacklink } : {}),
      };
      const newHistory = [...history, newHistoryItem].slice(-30);
      const hasDisconnectIssue = newHistory.some(
        (item) => item.issueType === "DISCONNECT",
      );

      let nextStatus = link.status as FriendLinkStatus;
      if (
        Boolean(autoManageStatusEnabled) &&
        shouldAutoManageFriendLinkStatus(nextStatus)
      ) {
        if (isFriendLinkFullFailure(newHistory)) {
          nextStatus = hasDisconnectIssue ? "DISCONNECT" : "NO_BACKLINK";
        } else if (
          issueType === "NONE" &&
          (nextStatus === "DISCONNECT" || nextStatus === "NO_BACKLINK")
        ) {
          nextStatus = "PUBLISHED";
        }
      }

      const previousChecks = link.checkSuccessCount + link.checkFailureCount;
      const nextAvgResponseTime =
        typeof requestResult.responseTime === "number"
          ? link.avgResponseTime == null
            ? requestResult.responseTime
            : Math.round(
                (link.avgResponseTime * previousChecks +
                  requestResult.responseTime) /
                  (previousChecks + 1),
              )
          : undefined;

      const updated = await prisma.friendLink.update({
        where: {
          id: link.id,
          deletedAt: null,
        },
        data: {
          checkSuccessCount: {
            increment: issueType === "NONE" ? 1 : 0,
          },
          checkFailureCount: {
            increment: issueType === "NONE" ? 0 : 1,
          },
          lastCheckedAt: new Date(),
          checkHistory: newHistory as unknown as Prisma.JsonArray,
          ...(typeof nextAvgResponseTime === "number"
            ? { avgResponseTime: nextAvgResponseTime }
            : {}),
          ...(nextStatus !== link.status
            ? {
                status: nextStatus,
                ...(nextStatus === "PUBLISHED" && !link.publishedAt
                  ? { publishedAt: new Date() }
                  : {}),
              }
            : {}),
        },
        select: {
          status: true,
        },
      });

      return {
        result: {
          id: link.id,
          status: updated.status as FriendLinkStatus,
          checked: true,
          skipped: false,
          issueType,
          responseTime: requestResult.responseTime,
          message:
            issueType === "NONE"
              ? "检查通过"
              : issueType === "DISCONNECT"
                ? "站点不可访问"
                : "未检测到回链",
        },
        failed: issueType !== "NONE",
        statusChanged: nextStatus !== link.status,
      };
    } catch (error) {
      return {
        result: {
          id: link.id,
          status: link.status as FriendLinkStatus,
          checked: true,
          skipped: false,
          issueType: "DISCONNECT",
          responseTime: null,
          message: toErrorMessage(error, "检查失败"),
        },
        failed: true,
        statusChanged: false,
      };
    }
  };

  const CONCURRENCY_LIMIT = 100;
  const executedResults: CheckExecutionResult[] = [];

  for (let start = 0; start < links.length; start += CONCURRENCY_LIMIT) {
    const batch = links.slice(start, start + CONCURRENCY_LIMIT);
    const batchResults = await Promise.allSettled(
      batch.map((link) => executeSingleCheck(link)),
    );
    batchResults.forEach((item, index) => {
      if (item.status === "fulfilled") {
        executedResults.push(item.value);
        return;
      }

      const source = batch[index];
      if (!source) return;
      executedResults.push({
        result: {
          id: source.id,
          status: source.status as FriendLinkStatus,
          checked: true,
          skipped: false,
          issueType: "DISCONNECT",
          responseTime: null,
          message: toErrorMessage(item.reason, "检查失败"),
        },
        failed: true,
        statusChanged: false,
      });
    });
  }

  const results: CheckFriendLinksResult["results"] = executedResults.map(
    (item) => item.result,
  );
  let checked = 0;
  let skipped = 0;
  let failed = 0;
  let statusChanged = 0;

  for (const item of executedResults) {
    if (item.result.skipped) {
      skipped += 1;
    } else {
      checked += 1;
    }
    if (item.failed) {
      failed += 1;
    }
    if (item.statusChanged) {
      statusChanged += 1;
    }
  }

  if (checked > 0) {
    expireCacheTag("friend-links");
  }

  return {
    total: links.length,
    checked,
    skipped,
    failed,
    statusChanged,
    results,
  };
}

export async function runFriendLinksCheckForCron(): Promise<CheckFriendLinksResult> {
  return runFriendLinksCheck({
    checkAll: true,
  });
}

export async function runAutoCleanupForCron() {
  return runAutoCleanupMaintenance();
}

export async function runAnalyticsRollupForCron() {
  return flushEventsToDatabase();
}

export function summarizeTaskValue(value: unknown): SnapshotValue {
  return normalizeSnapshotValue(value);
}

type DoctorTriggerType = "MANUAL" | "AUTO" | "CRON";

type RunDoctorHealthCheckOptions = {
  triggerType: DoctorTriggerType;
};

export type RunDoctorHealthCheckResult = {
  id: number;
  data: DoctorSuccessResponse["data"];
};
