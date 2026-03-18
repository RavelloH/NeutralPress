import "server-only";

import fs from "node:fs/promises";
import path from "node:path";

import { getConfigs } from "@/lib/server/config-cache";
import prisma from "@/lib/server/prisma";

type VerifySource = "DOH" | "JWKS" | "NONE";

type CloudTelemetry = {
  schemaVer: string;
  collectedAt: string;
  accepted: boolean;
  dedupHit: boolean;
  protocolVerification: {
    accepted: boolean;
    dedupHit: boolean;
    verifySource: VerifySource;
    dnssecAd: boolean | null;
    verifyMs: number;
    tokenAgeMs: number | null;
  };
  configSnapshot: {
    cronEnabled: boolean;
    doctorEnabled: boolean;
    projectsEnabled: boolean;
    friendsEnabled: boolean;
  };
  latestCronSummary: {
    latestRunId: number | null;
    latestCreatedAt: string | null;
    latestStatus: "OK" | "PARTIAL" | "ERROR" | null;
    latestDurationMs: number | null;
    enabledCount: number | null;
    successCount: number | null;
    failedCount: number | null;
    skippedCount: number | null;
  };
  taskDurations: {
    doctorDurationMs: number | null;
    projectsDurationMs: number | null;
    friendsDurationMs: number | null;
  };
  runtimeHealth: {
    healthRecordId: number | null;
    healthCreatedAt: string | null;
    healthStatus: "OK" | "WARNING" | "ERROR" | null;
    healthOkCount: number | null;
    healthWarningCount: number | null;
    healthErrorCount: number | null;
    dbLatencyMs: number | null;
    redisLatencyMs: number | null;
    siteSelfLatencyMs: number | null;
  };
  versionInfo: {
    appVersion: string | null;
    runtimeNodeVersion: string;
    buildId: string | null;
    commit: string | null;
  };
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.round(value);
}

function readHealthCheckNumber(snapshot: unknown, code: string): number | null {
  const snapshotObj = asRecord(snapshot);
  const checks = asRecord(snapshotObj?.checks);
  const check = asRecord(checks?.[code]);
  return readFiniteNumber(check?.v);
}

function readTaskDuration(snapshot: unknown, taskKey: string): number | null {
  const snapshotObj = asRecord(snapshot);
  const tasks = asRecord(snapshotObj?.tasks);
  const task = asRecord(tasks?.[taskKey]);
  return readFiniteNumber(task?.d);
}

async function readPackageVersion(): Promise<string | null> {
  const packageJsonPath = path.join(process.cwd(), "package.json");
  try {
    const raw = await fs.readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === "string" && parsed.version.trim()
      ? parsed.version.trim()
      : null;
  } catch {
    return null;
  }
}

export async function collectCloudTelemetry(input: {
  accepted: boolean;
  dedupHit: boolean;
  verifySource: VerifySource;
  dnssecAd: boolean | null;
  verifyMs: number;
  tokenAgeMs: number | null;
}): Promise<CloudTelemetry> {
  const [
    [cronEnabled, doctorEnabled, projectsEnabled, friendsEnabled],
    latestCron,
    latestHealth,
    appVersion,
  ] = await Promise.all([
    getConfigs([
      "cron.enable",
      "cron.task.doctor.enable",
      "cron.task.projects.enable",
      "cron.task.friends.enable",
    ]),
    prisma.cronHistory.findFirst({
      orderBy: {
        createdAt: "desc",
      },
      select: {
        id: true,
        createdAt: true,
        status: true,
        durationMs: true,
        enabledCount: true,
        successCount: true,
        failedCount: true,
        skippedCount: true,
        snapshot: true,
      },
    }),
    prisma.healthCheck.findFirst({
      orderBy: {
        createdAt: "desc",
      },
      select: {
        id: true,
        createdAt: true,
        overallStatus: true,
        okCount: true,
        warningCount: true,
        errorCount: true,
        snapshot: true,
      },
    }),
    readPackageVersion(),
  ]);

  return {
    schemaVer: "np-cloud-telemetry-v1",
    collectedAt: new Date().toISOString(),
    accepted: input.accepted,
    dedupHit: input.dedupHit,
    protocolVerification: {
      accepted: input.accepted,
      dedupHit: input.dedupHit,
      verifySource: input.verifySource,
      dnssecAd: input.dnssecAd,
      verifyMs: input.verifyMs,
      tokenAgeMs: input.tokenAgeMs,
    },
    configSnapshot: {
      cronEnabled: Boolean(cronEnabled),
      doctorEnabled: Boolean(doctorEnabled),
      projectsEnabled: Boolean(projectsEnabled),
      friendsEnabled: Boolean(friendsEnabled),
    },
    latestCronSummary: {
      latestRunId: latestCron?.id ?? null,
      latestCreatedAt: latestCron?.createdAt.toISOString() ?? null,
      latestStatus: latestCron?.status ?? null,
      latestDurationMs: latestCron?.durationMs ?? null,
      enabledCount: latestCron?.enabledCount ?? null,
      successCount: latestCron?.successCount ?? null,
      failedCount: latestCron?.failedCount ?? null,
      skippedCount: latestCron?.skippedCount ?? null,
    },
    taskDurations: {
      doctorDurationMs: latestCron
        ? readTaskDuration(latestCron.snapshot, "doctor")
        : null,
      projectsDurationMs: latestCron
        ? readTaskDuration(latestCron.snapshot, "projects")
        : null,
      friendsDurationMs: latestCron
        ? readTaskDuration(latestCron.snapshot, "friends")
        : null,
    },
    runtimeHealth: {
      healthRecordId: latestHealth?.id ?? null,
      healthCreatedAt: latestHealth?.createdAt.toISOString() ?? null,
      healthStatus: latestHealth?.overallStatus ?? null,
      healthOkCount: latestHealth?.okCount ?? null,
      healthWarningCount: latestHealth?.warningCount ?? null,
      healthErrorCount: latestHealth?.errorCount ?? null,
      dbLatencyMs: latestHealth
        ? readHealthCheckNumber(latestHealth.snapshot, "DB_LATENCY")
        : null,
      redisLatencyMs: latestHealth
        ? readHealthCheckNumber(latestHealth.snapshot, "REDIS_LATENCY")
        : null,
      siteSelfLatencyMs: latestHealth
        ? readHealthCheckNumber(latestHealth.snapshot, "SITE_SELF_LATENCY")
        : null,
    },
    versionInfo: {
      appVersion,
      runtimeNodeVersion: process.version,
      buildId:
        process.env.VERCEL_BUILD_ID ||
        process.env.VERCEL_GIT_COMMIT_SHA ||
        process.env.GITHUB_RUN_ID ||
        null,
      commit:
        process.env.VERCEL_GIT_COMMIT_SHA ||
        process.env.GITHUB_SHA ||
        process.env.COMMIT_SHA ||
        null,
    },
  };
}

export type { CloudTelemetry, VerifySource };
