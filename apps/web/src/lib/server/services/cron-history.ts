import "server-only";

import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type {
  CronHistoryItem,
  CronRunStatus,
  CronSnapshot,
  CronTrendItem,
  GetCronHistory,
  GetCronTrends,
} from "@repo/shared-types/api/cron";
import {
  GetCronHistorySchema,
  GetCronTrendsSchema,
} from "@repo/shared-types/api/cron";
import { headers } from "next/headers";
import type { NextResponse } from "next/server";

import { authVerify } from "@/lib/server/auth-verify";
import prisma from "@/lib/server/prisma";
import limitControl from "@/lib/server/rate-limit";
import ResponseBuilder from "@/lib/server/response";
import { validateData } from "@/lib/server/validator";

type ActionConfig = { environment?: "serverless" | "serveraction" };
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

export async function getCronHistory(
  params: GetCronHistory,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CronHistoryItem[] | null>>>;
export async function getCronHistory(
  params: GetCronHistory,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CronHistoryItem[] | null>>;
export async function getCronHistory(
  {
    access_token,
    page = 1,
    pageSize = 25,
    sortBy,
    sortOrder,
    id,
    status,
    triggerType,
    createdAtStart,
    createdAtEnd,
  }: GetCronHistory,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CronHistoryItem[] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getCronHistory"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      page,
      pageSize,
      sortBy,
      sortOrder,
      id,
      status,
      triggerType,
      createdAtStart,
      createdAtEnd,
    },
    GetCronHistorySchema,
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
    const skip = (page - 1) * pageSize;
    const where: {
      id?: number;
      status?: CronRunStatus;
      triggerType?: "MANUAL" | "CLOUD" | "AUTO";
      createdAt?: {
        gte?: Date;
        lte?: Date;
      };
    } = {};

    if (id !== undefined) where.id = id;
    if (status) where.status = status;
    if (triggerType) where.triggerType = triggerType;
    if (createdAtStart || createdAtEnd) {
      where.createdAt = {};
      if (createdAtStart) {
        where.createdAt.gte = new Date(createdAtStart);
      }
      if (createdAtEnd) {
        where.createdAt.lte = new Date(createdAtEnd);
      }
    }

    let orderBy:
      | { id: "asc" | "desc" }
      | { createdAt: "asc" | "desc" }
      | { startedAt: "asc" | "desc" }
      | { status: "asc" | "desc" }
      | { triggerType: "asc" | "desc" }
      | { durationMs: "asc" | "desc" }
      | { enabledCount: "asc" | "desc" }
      | { successCount: "asc" | "desc" }
      | { failedCount: "asc" | "desc" }
      | { skippedCount: "asc" | "desc" } = { createdAt: "desc" };

    if (sortBy && sortOrder) {
      switch (sortBy) {
        case "id":
          orderBy = { id: sortOrder };
          break;
        case "createdAt":
          orderBy = { createdAt: sortOrder };
          break;
        case "startedAt":
          orderBy = { startedAt: sortOrder };
          break;
        case "status":
          orderBy = { status: sortOrder };
          break;
        case "triggerType":
          orderBy = { triggerType: sortOrder };
          break;
        case "durationMs":
          orderBy = { durationMs: sortOrder };
          break;
        case "enabledCount":
          orderBy = { enabledCount: sortOrder };
          break;
        case "successCount":
          orderBy = { successCount: sortOrder };
          break;
        case "failedCount":
          orderBy = { failedCount: sortOrder };
          break;
        case "skippedCount":
          orderBy = { skippedCount: sortOrder };
          break;
      }
    }

    const [total, records] = await Promise.all([
      prisma.cronHistory.count({ where }),
      prisma.cronHistory.findMany({
        skip,
        take: pageSize,
        where,
        orderBy,
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
      }),
    ]);

    const data = records.map((record) => toCronHistoryItem(record));
    const totalPages = Math.ceil(total / pageSize);
    const meta = {
      page,
      pageSize,
      total,
      totalPages,
      hasNext: totalPages > 0 && page < totalPages,
      hasPrev: totalPages > 0 && page > 1,
    };

    return response.ok({ data, meta });
  } catch (error) {
    console.error("Get cron history error:", error);
    return response.serverError();
  }
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
  { access_token, days = 30, count = 30 }: GetCronTrends,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CronTrendItem[] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getCronTrends"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      days,
      count,
    },
    GetCronTrendsSchema,
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
    const daysAgo = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [recentByTime, recentByCount] = await Promise.all([
      prisma.cronHistory.findMany({
        where: {
          createdAt: {
            gte: daysAgo,
          },
        },
        orderBy: {
          createdAt: "asc",
        },
        select: {
          id: true,
          createdAt: true,
          durationMs: true,
          successCount: true,
          failedCount: true,
          skippedCount: true,
          snapshot: true,
        },
      }),
      prisma.cronHistory.findMany({
        take: count,
        orderBy: {
          createdAt: "desc",
        },
        select: {
          id: true,
          createdAt: true,
          durationMs: true,
          successCount: true,
          failedCount: true,
          skippedCount: true,
          snapshot: true,
        },
      }),
    ]);

    const mergedMap = new Map<number, (typeof recentByTime)[0]>();
    for (const record of recentByTime) {
      mergedMap.set(record.id, record);
    }
    for (const record of recentByCount) {
      mergedMap.set(record.id, record);
    }

    const merged = Array.from(mergedMap.values()).sort(
      (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
    );

    const data: CronTrendItem[] = merged.map((record) => {
      const snapshot = normalizeCronSnapshot(record.snapshot);
      return {
        time: record.createdAt.toISOString(),
        data: {
          totalDurationMs: record.durationMs,
          doctorDurationMs: snapshot.tasks.doctor.d,
          projectsDurationMs: snapshot.tasks.projects.d,
          friendsDurationMs: snapshot.tasks.friends.d,
          cleanupDurationMs: snapshot.tasks.cleanup.d,
          analyticsDurationMs: snapshot.tasks.analytics.d,
          successCount: record.successCount,
          failedCount: record.failedCount,
          skippedCount: record.skippedCount,
        },
      };
    });

    return response.ok({ data });
  } catch (error) {
    console.error("Get cron trends error:", error);
    return response.serverError();
  }
}
