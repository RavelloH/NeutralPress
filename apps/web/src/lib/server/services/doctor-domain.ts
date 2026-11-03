import "server-only";

import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type {
  Doctor,
  DoctorCheckDetail,
  DoctorHistoryItem,
  DoctorSuccessResponse,
  DoctorTrendItem,
  GetDoctorHistory,
  GetDoctorTrends,
} from "@repo/shared-types/api/doctor";
import {
  DoctorSchema,
  GetDoctorHistorySchema,
  GetDoctorTrendsSchema,
} from "@repo/shared-types/api/doctor";
import { headers } from "next/headers";
import type { NextResponse } from "next/server";

import {
  buildDoctorBriefFromIssues,
  formatDoctorCheckDetails,
  getDoctorCheckMessage,
  getDoctorCheckOrder,
} from "@/data/check-config";
import { logAuditEvent } from "@/lib/server/audit";
import { authVerify } from "@/lib/server/auth-verify";
import { runDoctorHealthCheck } from "@/lib/server/cron-task-runner";
import prisma from "@/lib/server/prisma";
import limitControl from "@/lib/server/rate-limit";
import ResponseBuilder from "@/lib/server/response";
import { validateData } from "@/lib/server/validator";

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

type HealthCheckIssue = DoctorSuccessResponse["data"]["issues"][number];

type ActionEnvironment = "serverless" | "serveraction";
type ActionConfig = { environment?: ActionEnvironment };
type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

const DOCTOR_CACHE_WINDOW_MS = 23 * 60 * 60 * 1000;

function snapshotStatusToSeverity(
  status: SnapshotStatus,
): HealthCheckIssue["severity"] {
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

function parseSnapshot(snapshot: unknown): HealthCheckSnapshot {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return { checks: {} };
  }

  const snapshotObj = snapshot as { checks?: unknown };
  if (
    !snapshotObj.checks ||
    typeof snapshotObj.checks !== "object" ||
    Array.isArray(snapshotObj.checks)
  ) {
    return { checks: {} };
  }

  const normalizedChecks: Record<string, SnapshotCheck> = {};
  const rawChecks = snapshotObj.checks as Record<string, unknown>;
  for (const [code, rawCheck] of Object.entries(rawChecks)) {
    if (!rawCheck || typeof rawCheck !== "object" || Array.isArray(rawCheck)) {
      continue;
    }
    const checkObj = rawCheck as {
      v?: unknown;
      d?: unknown;
      s?: unknown;
    };
    const durationMs =
      typeof checkObj.d === "number" &&
      Number.isFinite(checkObj.d) &&
      checkObj.d >= 0
        ? Math.round(checkObj.d)
        : 0;
    const status =
      checkObj.s === "O" || checkObj.s === "W" || checkObj.s === "E"
        ? checkObj.s
        : "O";

    normalizedChecks[code] = {
      v: normalizeSnapshotValue(checkObj.v),
      d: durationMs,
      s: status,
    };
  }

  return { checks: normalizedChecks };
}

function buildCheckDetails(
  snapshotChecks: Record<string, SnapshotCheck>,
): DoctorCheckDetail[] {
  const checks: DoctorCheckDetail[] = Object.entries(snapshotChecks).map(
    ([code, check]) => {
      const severity = snapshotStatusToSeverity(check.s);
      return {
        code,
        message: getDoctorCheckMessage(code),
        severity,
        details: formatDoctorCheckDetails(code, check.v),
        value: check.v,
        durationMs: check.d,
        status: check.s,
      };
    },
  );

  checks.sort((a, b) => {
    const orderDiff = getDoctorCheckOrder(a.code) - getDoctorCheckOrder(b.code);
    if (orderDiff !== 0) return orderDiff;
    return a.code.localeCompare(b.code);
  });

  return checks;
}

function buildIssues(checks: DoctorCheckDetail[]): HealthCheckIssue[] {
  return checks.map((check) => ({
    code: check.code,
    message: check.message,
    severity: check.severity,
    details: check.details,
  }));
}

export async function doctor(
  params: Doctor,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<DoctorSuccessResponse["data"]>>>;
export async function doctor(
  params: Doctor,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<DoctorSuccessResponse["data"]>>;
export async function doctor(
  { access_token, force = false }: Doctor,
  serverConfig?: ActionConfig,
): Promise<ActionResult<DoctorSuccessResponse["data"] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );
  if (!(await limitControl(await headers(), "doctor"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      force,
    },
    DoctorSchema,
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
    const persistTriggerType: "MANUAL" | "AUTO" = force ? "MANUAL" : "AUTO";

    if (!force) {
      const cachedRecord = await prisma.healthCheck.findFirst({
        where: {
          createdAt: {
            gte: new Date(Date.now() - DOCTOR_CACHE_WINDOW_MS),
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        select: {
          startedAt: true,
          createdAt: true,
          durationMs: true,
          triggerType: true,
          overallStatus: true,
          okCount: true,
          warningCount: true,
          errorCount: true,
          snapshot: true,
        },
      });

      if (cachedRecord) {
        const cachedSnapshot = parseSnapshot(cachedRecord.snapshot);
        const cachedChecks = buildCheckDetails(cachedSnapshot.checks);
        const cachedIssues = buildIssues(cachedChecks);

        return response.ok({
          data: {
            createdAt: cachedRecord.createdAt.toISOString(),
            startedAt: cachedRecord.startedAt.toISOString(),
            durationMs: cachedRecord.durationMs,
            triggerType: cachedRecord.triggerType,
            status: cachedRecord.overallStatus,
            okCount: cachedRecord.okCount,
            warningCount: cachedRecord.warningCount,
            errorCount: cachedRecord.errorCount,
            issues: cachedIssues,
          },
        });
      }
    }

    const healthCheck = await runDoctorHealthCheck({
      triggerType: persistTriggerType,
    });

    try {
      await logAuditEvent({
        user: {
          uid: user.uid.toString(),
        },
        details: {
          action: "CREATE",
          resourceType: "HEALTH_CHECK",
          resourceId: String(healthCheck.id),
          value: {
            old: null,
            new: {
              id: healthCheck.id,
              triggerType: healthCheck.data.triggerType,
              status: healthCheck.data.status,
              okCount: healthCheck.data.okCount,
              warningCount: healthCheck.data.warningCount,
              errorCount: healthCheck.data.errorCount,
            },
          },
          description: `管理员执行系统体检 - 结果: ${healthCheck.data.status}`,
        },
      });
    } catch (error) {
      console.error("Failed to log audit event:", error);
    }

    return response.ok({
      data: healthCheck.data,
    });
  } catch (error) {
    console.error("Doctor error:", error);
    return response.serverError();
  }
}

export async function getDoctorHistory(
  params: GetDoctorHistory,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<DoctorHistoryItem[] | null>>>;
export async function getDoctorHistory(
  params: GetDoctorHistory,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<DoctorHistoryItem[] | null>>;
export async function getDoctorHistory(
  {
    access_token,
    page = 1,
    pageSize = 10,
    sortBy,
    sortOrder,
    id,
    status,
    triggerType,
    okCount,
    errorCount,
    warningCount,
    createdAtStart,
    createdAtEnd,
  }: GetDoctorHistory,
  serverConfig?: ActionConfig,
): Promise<ActionResult<DoctorHistoryItem[] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getDoctorHistory"))) {
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
      okCount,
      errorCount,
      warningCount,
      createdAtStart,
      createdAtEnd,
    },
    GetDoctorHistorySchema,
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
      overallStatus?: "OK" | "WARNING" | "ERROR";
      triggerType?: "MANUAL" | "AUTO" | "CRON";
      okCount?: number;
      errorCount?: number;
      warningCount?: number;
      createdAt?: {
        gte?: Date;
        lte?: Date;
      };
    } = {};

    if (id !== undefined) where.id = id;
    if (status) where.overallStatus = status;
    if (triggerType) where.triggerType = triggerType;
    if (okCount !== undefined) where.okCount = okCount;
    if (errorCount !== undefined) where.errorCount = errorCount;
    if (warningCount !== undefined) where.warningCount = warningCount;

    if (createdAtStart || createdAtEnd) {
      where.createdAt = {};
      if (createdAtStart) where.createdAt.gte = new Date(createdAtStart);
      if (createdAtEnd) where.createdAt.lte = new Date(createdAtEnd);
    }

    let orderBy:
      | { id: "asc" | "desc" }
      | { createdAt: "asc" | "desc" }
      | { overallStatus: "asc" | "desc" }
      | { okCount: "asc" | "desc" }
      | { warningCount: "asc" | "desc" }
      | { errorCount: "asc" | "desc" }
      | { triggerType: "asc" | "desc" }
      | { durationMs: "asc" | "desc" } = {
      createdAt: "desc",
    };

    if (sortBy && sortOrder) {
      switch (sortBy) {
        case "id":
          orderBy = { id: sortOrder };
          break;
        case "createdAt":
          orderBy = { createdAt: sortOrder };
          break;
        case "status":
          orderBy = { overallStatus: sortOrder };
          break;
        case "okCount":
          orderBy = { okCount: sortOrder };
          break;
        case "warningCount":
          orderBy = { warningCount: sortOrder };
          break;
        case "errorCount":
          orderBy = { errorCount: sortOrder };
          break;
        case "triggerType":
          orderBy = { triggerType: sortOrder };
          break;
        case "durationMs":
          orderBy = { durationMs: sortOrder };
          break;
      }
    }

    const [total, records] = await Promise.all([
      prisma.healthCheck.count({ where }),
      prisma.healthCheck.findMany({
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
          overallStatus: true,
          okCount: true,
          warningCount: true,
          errorCount: true,
          snapshot: true,
        },
      }),
    ]);

    const data: DoctorHistoryItem[] = records.map((record) => {
      const snapshot = parseSnapshot(record.snapshot);
      const checks = buildCheckDetails(snapshot.checks);
      const issues = buildIssues(checks);
      return {
        id: record.id,
        brief: buildDoctorBriefFromIssues(issues),
        status: record.overallStatus,
        triggerType: record.triggerType,
        durationMs: record.durationMs,
        startedAt: record.startedAt.toISOString(),
        createdAt: record.createdAt.toISOString(),
        okCount: record.okCount,
        warningCount: record.warningCount,
        errorCount: record.errorCount,
        checks,
      };
    });

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
    console.error("Get doctor history error:", error);
    return response.serverError();
  }
}

export async function getDoctorTrends(
  params: GetDoctorTrends,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<DoctorTrendItem[] | null>>>;
export async function getDoctorTrends(
  params: GetDoctorTrends,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<DoctorTrendItem[] | null>>;
export async function getDoctorTrends(
  { access_token, days = 30, count = 30 }: GetDoctorTrends,
  serverConfig?: ActionConfig,
): Promise<ActionResult<DoctorTrendItem[] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getDoctorTrends"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      days,
      count,
    },
    GetDoctorTrendsSchema,
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
      prisma.healthCheck.findMany({
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
          okCount: true,
          warningCount: true,
          errorCount: true,
        },
      }),
      prisma.healthCheck.findMany({
        take: count,
        orderBy: {
          createdAt: "desc",
        },
        select: {
          id: true,
          createdAt: true,
          okCount: true,
          warningCount: true,
          errorCount: true,
        },
      }),
    ]);

    const mergedMap = new Map<number, (typeof recentByTime)[0]>();
    recentByTime.forEach((record) => {
      mergedMap.set(record.id, record);
    });
    recentByCount.forEach((record) => {
      mergedMap.set(record.id, record);
    });

    const merged = Array.from(mergedMap.values()).sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );

    const data: DoctorTrendItem[] = merged.map((record) => ({
      time: record.createdAt.toISOString(),
      data: {
        info: record.okCount,
        warning: record.warningCount,
        error: record.errorCount,
      },
    }));

    return response.ok({ data });
  } catch (error) {
    console.error("Get doctor trends error:", error);
    return response.serverError();
  }
}
