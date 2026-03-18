"use server";

import { execSync } from "node:child_process";
import {
  createPrivateKey,
  generateKeyPairSync,
  randomUUID,
  sign,
} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type {
  CloudConfig,
  CloudHistoryItem,
  CloudManualSyncResult,
  CloudRemoteStatus,
  CloudTrendItem,
  GetCloudConfig,
  GetCloudHistory,
  GetCloudRemoteStatus,
  GetCloudTrends,
  SyncCloudNow,
  UpdateCloudConfig,
} from "@repo/shared-types/api/cloud";
import {
  CLOUD_RECEIVED_TIMEOUT_MS,
  GetCloudConfigSchema,
  GetCloudHistorySchema,
  GetCloudRemoteStatusSchema,
  GetCloudTrendsSchema,
  SyncCloudNowSchema,
  UpdateCloudConfigSchema,
} from "@repo/shared-types/api/cloud";
import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import { updateTag } from "next/cache";
import { headers } from "next/headers";
import type { NextResponse } from "next/server";

import { logAuditEvent } from "@/lib/server/audit";
import { authVerify } from "@/lib/server/auth-verify";
import { getConfigs } from "@/lib/server/config-cache";
import prisma from "@/lib/server/prisma";
import limitControl from "@/lib/server/rate-limit";
import ResponseBuilder from "@/lib/server/response";
import { validateData } from "@/lib/server/validator";
import {
  buildCloudSignMessage,
  encodeBase64Url,
  generateNonce,
} from "@/lib/shared/cloud-signature";

import { Prisma } from ".prisma/client";

type ActionEnvironment = "serverless" | "serveraction";
type ActionConfig = { environment?: ActionEnvironment };
type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

const CLOUD_CONFIG_KEYS = [
  "cloud.enable",
  "cloud.id",
  "cloud.schedule.time",
  "cloud.api.baseUrl",
  "cloud.verify.dohDomain",
  "cloud.verify.jwksUrl",
  "cloud.verify.issuer",
  "cloud.verify.audience",
] as const;

const CLOUD_IDENTITY_KEYS = [
  "cloud.enable",
  "cloud.id",
  "cloud.schedule.time",
  "cloud.key.pub",
  "cloud.key.priv",
  "cloud.key.alg",
  "cloud.api.baseUrl",
  "site.url",
] as const;

type CloudTriggerRecord = {
  id: number;
  deliveryId: string;
  triggerType: "MANUAL" | "CLOUD" | "AUTO";
  requestedAt: Date | null;
  receivedAt: Date;
  verifyOk: boolean;
  verifySource: string | null;
  accepted: boolean;
  dedupHit: boolean;
  status: "RECEIVED" | "DONE" | "ERROR" | "REJECTED";
  message: string | null;
  cronHistoryId: number | null;
  telemetry: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type CloudIdentity = {
  siteId: string;
  sitePubKey: string;
  sitePrivKey: string;
  siteKeyAlg: string;
  scheduleTime: string | null;
  scheduleMinuteOfDay: number | null;
  cloudBaseUrl: string;
  siteUrl: string | null;
};

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeCloudBaseUrl(raw: string): string {
  const fallback = "https://cloud.neutralpress.net";
  const value = raw || fallback;
  try {
    const parsed = new URL(value);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return fallback;
  }
}

function normalizeSiteUrlForCloud(raw: string): string | null {
  if (!raw) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === "example.com" ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.startsWith("127.") ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  ) {
    return null;
  }

  return `${parsed.protocol}//${parsed.host}`;
}

function normalizeCloudScheduleTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(trimmed);
  if (!match) return null;

  return `${match[1]}:${match[2]}`;
}

function scheduleTimeToMinuteOfDay(value: string | null): number | null {
  if (!value) return null;
  const [hourRaw, minuteRaw] = value.split(":");
  const hour = Number.parseInt(hourRaw ?? "", 10);
  const minute = Number.parseInt(minuteRaw ?? "", 10);

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  return hour * 60 + minute;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readStringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readIntegerOrNull(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.round(value);
}

function readNumberOrNull(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function toConfigJsonValue(value: unknown): Prisma.InputJsonValue {
  if (value === null) {
    return Prisma.JsonNull as unknown as Prisma.InputJsonValue;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => toConfigJsonValue(item));
  }

  if (typeof value === "object") {
    const result: Record<string, Prisma.InputJsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = toConfigJsonValue(item);
    }
    return result;
  }

  return String(value);
}

function toCloudHistoryItem(record: CloudTriggerRecord): CloudHistoryItem {
  const normalizedVerifySource =
    record.verifySource === "DOH" ||
    record.verifySource === "JWKS" ||
    record.verifySource === "NONE"
      ? record.verifySource
      : null;

  const telemetryRoot = asRecord(record.telemetry);
  const telemetryData =
    telemetryRoot && asRecord(telemetryRoot.data)
      ? asRecord(telemetryRoot.data)
      : telemetryRoot;
  const protocol = asRecord(telemetryData?.protocolVerification);
  const latest = asRecord(telemetryData?.latestCronSummary);
  const tasks = asRecord(telemetryData?.taskDurations);
  const health = asRecord(telemetryData?.runtimeHealth);
  const version = asRecord(telemetryData?.versionInfo);

  return {
    id: record.id,
    deliveryId: record.deliveryId,
    triggerType: record.triggerType,
    requestedAt: record.requestedAt ? record.requestedAt.toISOString() : null,
    receivedAt: record.receivedAt.toISOString(),
    verifyOk: record.verifyOk,
    verifySource: normalizedVerifySource,
    accepted: record.accepted,
    dedupHit: record.dedupHit,
    status: record.status,
    message: record.message,
    cronHistoryId: record.cronHistoryId,
    telemetry: telemetryData
      ? {
          schemaVer: readStringOrNull(telemetryData.schemaVer),
          collectedAt: readStringOrNull(telemetryData.collectedAt),
          latestStatus: readStringOrNull(latest?.latestStatus),
          latestDurationMs: readIntegerOrNull(latest?.latestDurationMs),
          doctorDurationMs: readIntegerOrNull(tasks?.doctorDurationMs),
          projectsDurationMs: readIntegerOrNull(tasks?.projectsDurationMs),
          friendsDurationMs: readIntegerOrNull(tasks?.friendsDurationMs),
          healthStatus: readStringOrNull(health?.healthStatus),
          appVersion: readStringOrNull(version?.appVersion),
          verifyMs: readIntegerOrNull(protocol?.verifyMs),
          tokenAgeMs: readIntegerOrNull(protocol?.tokenAgeMs),
          raw: telemetryData,
        }
      : null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
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

function resolveGitCommitHash(): string | null {
  try {
    const full = execSync("git rev-parse HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
    return full || null;
  } catch {
    return null;
  }
}

function resolveBuildIdFromCommit(commit: string | null): string | null {
  if (!commit) return null;
  return commit.slice(0, 12);
}

async function loadCloudConfigState(): Promise<CloudConfig> {
  const [
    enabled,
    siteId,
    scheduleTimeRaw,
    baseUrl,
    dohDomain,
    jwksUrl,
    issuer,
    audience,
  ] = await getConfigs([...CLOUD_CONFIG_KEYS]);

  const updatedRecords = await prisma.config.findMany({
    where: {
      key: {
        in: [...CLOUD_CONFIG_KEYS],
      },
    },
    select: {
      updatedAt: true,
    },
  });

  const updatedAt =
    updatedRecords.length > 0
      ? updatedRecords
          .reduce(
            (latest, current) =>
              current.updatedAt.getTime() > latest.getTime()
                ? current.updatedAt
                : latest,
            updatedRecords[0]!.updatedAt,
          )
          .toISOString()
      : new Date().toISOString();

  return {
    enabled: Boolean(enabled),
    siteId: normalizeString(siteId) || null,
    scheduleTime: normalizeCloudScheduleTime(scheduleTimeRaw),
    cloudBaseUrl: normalizeCloudBaseUrl(normalizeString(baseUrl)),
    dohDomain: normalizeString(dohDomain) || "key.neutralpress.net",
    jwksUrl:
      normalizeString(jwksUrl) ||
      "https://cloud.neutralpress.net/.well-known/jwks.json",
    issuer: normalizeString(issuer) || "np-cloud",
    audience: normalizeString(audience) || "np-instance",
    updatedAt,
  };
}

async function upsertConfigValue(key: string, value: unknown): Promise<void> {
  await prisma.config.upsert({
    where: {
      key,
    },
    update: {
      value: {
        default: toConfigJsonValue(value),
      },
    },
    create: {
      key,
      value: {
        default: toConfigJsonValue(value),
      },
    },
  });
}

async function ensureCloudIdentityForSync(): Promise<{
  enabled: boolean;
  identity: CloudIdentity | null;
  changedKeys: string[];
}> {
  const [
    enabledRaw,
    siteIdRaw,
    scheduleTimeRaw,
    sitePubKeyRaw,
    sitePrivKeyRaw,
    siteKeyAlgRaw,
    cloudBaseUrlRaw,
    siteUrlRaw,
  ] = await getConfigs([...CLOUD_IDENTITY_KEYS]);

  const enabled = Boolean(enabledRaw);
  if (!enabled) {
    return {
      enabled,
      identity: null,
      changedKeys: [],
    };
  }

  const changedKeys: string[] = [];
  let siteId = normalizeString(siteIdRaw);
  let sitePubKey = normalizeString(sitePubKeyRaw);
  let sitePrivKey = normalizeString(sitePrivKeyRaw);
  const siteKeyAlg = normalizeString(siteKeyAlgRaw) || "ed25519";
  const scheduleTime = normalizeCloudScheduleTime(scheduleTimeRaw);
  const scheduleMinuteOfDay = scheduleTimeToMinuteOfDay(scheduleTime);
  const cloudBaseUrl = normalizeCloudBaseUrl(normalizeString(cloudBaseUrlRaw));
  const siteUrl = normalizeSiteUrlForCloud(normalizeString(siteUrlRaw));

  if (!isUuid(siteId)) {
    siteId = randomUUID();
    await upsertConfigValue("cloud.id", siteId);
    changedKeys.push("cloud.id");
  }

  if (!sitePubKey || !sitePrivKey) {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    sitePubKey = publicKey
      .export({
        format: "pem",
        type: "spki",
      })
      .toString();
    sitePrivKey = privateKey
      .export({
        format: "pem",
        type: "pkcs8",
      })
      .toString();

    await upsertConfigValue("cloud.key.pub", sitePubKey);
    await upsertConfigValue("cloud.key.priv", sitePrivKey);
    await upsertConfigValue("cloud.key.alg", "ed25519");
    changedKeys.push("cloud.key.pub", "cloud.key.priv", "cloud.key.alg");
  }

  return {
    enabled,
    identity: {
      siteId,
      sitePubKey,
      sitePrivKey,
      siteKeyAlg,
      scheduleTime,
      scheduleMinuteOfDay,
      cloudBaseUrl,
      siteUrl,
    },
    changedKeys,
  };
}

async function syncCloudIdentity(identity: CloudIdentity): Promise<{
  ok: boolean;
  status: number;
  data: Record<string, unknown> | null;
  message: string;
}> {
  const syncPath = "/v1/instances/sync";
  const ts = new Date().toISOString();
  const nonce = generateNonce(12);
  const appVersion = await readPackageVersion();
  const commit =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    process.env.COMMIT_SHA ||
    resolveGitCommitHash();
  const buildId =
    process.env.VERCEL_BUILD_ID ||
    process.env.GITHUB_RUN_ID ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    resolveBuildIdFromCommit(commit);
  const builtAt = new Date().toISOString();

  const payload = {
    siteId: identity.siteId,
    sitePubKey: identity.sitePubKey,
    siteKeyAlg: identity.siteKeyAlg,
    siteUrl: identity.siteUrl,
    minuteOfDay: identity.scheduleMinuteOfDay,
    appVersion,
    buildId,
    commit,
    builtAt,
    idempotencyKey: `${identity.siteId}:manual:${builtAt}`,
  };

  const message = buildCloudSignMessage({
    method: "POST",
    path: syncPath,
    payload,
    ts,
    nonce,
  });
  const signatureBuffer = sign(
    null,
    Buffer.from(message),
    createPrivateKey(identity.sitePrivKey),
  );
  const sig = encodeBase64Url(signatureBuffer);

  const endpoint = `${identity.cloudBaseUrl}${syncPath}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ...payload,
        signature: {
          alg: "EdDSA",
          ts,
          nonce,
          sig,
        },
      }),
      signal: controller.signal,
    });

    const json = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const data = asRecord(json?.data);

    return {
      ok: response.ok,
      status: response.status,
      data,
      message: response.ok
        ? "云端同步成功"
        : readStringOrNull(asRecord(json?.error)?.message) ||
          `云端同步失败（HTTP ${response.status}）`,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      message: toErrorMessage(error, "云端同步请求失败"),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCloudHealth(baseUrl: string): Promise<boolean | null> {
  const endpoint = `${normalizeCloudBaseUrl(baseUrl)}/v1/health`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(endpoint, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCloudRemoteStatusInternal(): Promise<CloudRemoteStatus> {
  const config = await loadCloudConfigState();
  const cloudOnline = await fetchCloudHealth(config.cloudBaseUrl);

  if (!config.enabled) {
    return {
      available: false,
      cloudOnline,
      message: "cloud.enable=false",
    };
  }

  const [siteIdRaw, privKeyRaw] = await getConfigs([
    "cloud.id",
    "cloud.key.priv",
  ]);

  const siteId = normalizeString(siteIdRaw);
  const privKey = normalizeString(privKeyRaw);
  if (!isUuid(siteId) || !privKey) {
    return {
      available: false,
      cloudOnline,
      siteId: siteId || null,
      message: "缺少 cloud.id 或 cloud.key.priv，无法请求远端状态",
    };
  }

  const statusPath = "/v1/instances/status";
  const ts = new Date().toISOString();
  const nonce = generateNonce(12);
  const payload = {
    siteId,
    requestedAt: ts,
  };

  const signMessage = buildCloudSignMessage({
    method: "POST",
    path: statusPath,
    payload,
    ts,
    nonce,
  });
  const signatureBuffer = sign(
    null,
    Buffer.from(signMessage),
    createPrivateKey(privKey),
  );
  const sig = encodeBase64Url(signatureBuffer);

  const endpoint = `${config.cloudBaseUrl}${statusPath}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ...payload,
        signature: {
          alg: "EdDSA",
          ts,
          nonce,
          sig,
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      if (response.status === 404) {
        return {
          available: false,
          cloudOnline,
          siteId,
          message: "云端尚未提供 /v1/instances/status 接口",
        };
      }

      const text = await response.text();
      return {
        available: false,
        cloudOnline,
        siteId,
        message: text || `远端状态接口失败（HTTP ${response.status}）`,
      };
    }

    const json = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const data = asRecord(json?.data);
    const eventsTotal = readIntegerOrNull(data?.eventsTotal);
    const eventsSuccess = readIntegerOrNull(data?.eventsSuccess);
    const successRateRaw = readNumberOrNull(data?.successRate);

    return {
      available: true,
      cloudOnline: true,
      siteId: readStringOrNull(data?.siteId) || siteId,
      instanceId: readStringOrNull(data?.instanceId),
      status: readStringOrNull(data?.status),
      pendingReason: readStringOrNull(data?.pendingReason),
      minuteOfDay: readIntegerOrNull(data?.minuteOfDay),
      nextRunAt: readStringOrNull(data?.nextRunAt),
      registeredAt: readStringOrNull(data?.registeredAt),
      firstSeenAt: readStringOrNull(data?.firstSeenAt),
      lastSyncAt: readStringOrNull(data?.lastSyncAt),
      eventsTotal,
      eventsSuccess,
      successRate:
        successRateRaw !== null
          ? Math.max(0, Math.min(1, successRateRaw))
          : eventsTotal && eventsSuccess !== null
            ? eventsSuccess / Math.max(1, eventsTotal)
            : null,
      message: null,
    };
  } catch (error) {
    return {
      available: false,
      cloudOnline,
      siteId,
      message: toErrorMessage(error, "请求远端状态失败"),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function getCloudConfig(
  params: GetCloudConfig,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CloudConfig | null>>>;
export async function getCloudConfig(
  params: GetCloudConfig,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CloudConfig | null>>;
export async function getCloudConfig(
  { access_token }: GetCloudConfig,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CloudConfig | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getCloudConfig"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
    },
    GetCloudConfigSchema,
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
    const data = await loadCloudConfigState();
    return response.ok({ data });
  } catch (error) {
    console.error("Get cloud config error:", error);
    return response.serverError();
  }
}

export async function updateCloudConfig(
  params: UpdateCloudConfig,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CloudConfig | null>>>;
export async function updateCloudConfig(
  params: UpdateCloudConfig,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CloudConfig | null>>;
export async function updateCloudConfig(
  {
    access_token,
    enabled,
    scheduleTime,
    cloudBaseUrl,
    dohDomain,
    jwksUrl,
    issuer,
    audience,
  }: UpdateCloudConfig,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CloudConfig | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "updateCloudConfig"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      enabled,
      scheduleTime,
      cloudBaseUrl,
      dohDomain,
      jwksUrl,
      issuer,
      audience,
    },
    UpdateCloudConfigSchema,
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
    const previousConfig = await loadCloudConfigState();
    const updates: Array<{ key: string; value: unknown }> = [];

    if (enabled !== undefined) {
      updates.push({ key: "cloud.enable", value: enabled });
    }
    if (scheduleTime !== undefined) {
      updates.push({
        key: "cloud.schedule.time",
        value: normalizeCloudScheduleTime(scheduleTime) ?? "",
      });
    }
    if (cloudBaseUrl !== undefined) {
      updates.push({
        key: "cloud.api.baseUrl",
        value: normalizeCloudBaseUrl(cloudBaseUrl),
      });
    }
    if (dohDomain !== undefined) {
      updates.push({ key: "cloud.verify.dohDomain", value: dohDomain.trim() });
    }
    if (jwksUrl !== undefined) {
      updates.push({ key: "cloud.verify.jwksUrl", value: jwksUrl.trim() });
    }
    if (issuer !== undefined) {
      updates.push({ key: "cloud.verify.issuer", value: issuer.trim() });
    }
    if (audience !== undefined) {
      updates.push({ key: "cloud.verify.audience", value: audience.trim() });
    }

    if (updates.length === 0) {
      return response.badRequest({
        message: "必须提供至少一个配置项",
      });
    }

    await prisma.$transaction(async (tx) => {
      for (const item of updates) {
        await tx.config.upsert({
          where: {
            key: item.key,
          },
          update: {
            value: {
              default: toConfigJsonValue(item.value),
            },
          },
          create: {
            key: item.key,
            value: {
              default: toConfigJsonValue(item.value),
            },
          },
        });
      }
    });

    updateTag("config");
    for (const item of updates) {
      updateTag(`config/${item.key}`);
    }

    const data = await loadCloudConfigState();

    try {
      await logAuditEvent({
        user: {
          uid: user.uid.toString(),
        },
        details: {
          action: "UPDATE",
          resourceType: "CLOUD_CONFIG",
          resourceId: "global",
          value: {
            old: previousConfig,
            new: data,
          },
          description: "管理员更新云端互联配置",
          metadata: {
            updateCount: updates.length,
          },
        },
      });
    } catch (error) {
      console.error("Failed to log audit event:", error);
    }

    return response.ok({
      message: "云端互联配置已更新",
      data,
    });
  } catch (error) {
    console.error("Update cloud config error:", error);
    return response.serverError();
  }
}

export async function syncCloudNow(
  params: SyncCloudNow,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CloudManualSyncResult | null>>>;
export async function syncCloudNow(
  params: SyncCloudNow,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CloudManualSyncResult | null>>;
export async function syncCloudNow(
  { access_token }: SyncCloudNow,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CloudManualSyncResult | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "syncCloudNow"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
    },
    SyncCloudNowSchema,
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
    const ensured = await ensureCloudIdentityForSync();
    if (!ensured.enabled || !ensured.identity) {
      return response.ok({
        data: {
          synced: false,
          message: "cloud.enable=false，已跳过同步",
        },
      });
    }

    if (ensured.changedKeys.length > 0) {
      updateTag("config");
      for (const key of ensured.changedKeys) {
        updateTag(`config/${key}`);
      }
    }

    const syncResult = await syncCloudIdentity(ensured.identity);
    const data: CloudManualSyncResult = {
      synced: syncResult.ok,
      siteId: ensured.identity.siteId,
      instanceId: readStringOrNull(syncResult.data?.instanceId),
      status: readStringOrNull(syncResult.data?.status),
      pendingReason: readStringOrNull(syncResult.data?.pendingReason),
      minuteOfDay: readIntegerOrNull(syncResult.data?.minuteOfDay),
      nextRunAt: readStringOrNull(syncResult.data?.nextRunAt),
      cloudActiveKid: readStringOrNull(syncResult.data?.cloudActiveKid),
      syncedAt:
        readStringOrNull(syncResult.data?.syncedAt) || new Date().toISOString(),
      message: syncResult.message,
    };

    try {
      await logAuditEvent({
        user: {
          uid: user.uid.toString(),
        },
        details: {
          action: "UPDATE",
          resourceType: "CLOUD_SYNC",
          resourceId: ensured.identity.siteId,
          value: {
            old: null,
            new: data,
          },
          description: `管理员手动同步云端实例 - ${syncResult.ok ? "成功" : "失败"}`,
        },
      });
    } catch (error) {
      console.error("Failed to log audit event:", error);
    }

    if (!syncResult.ok) {
      return response.badGateway({
        message: data.message || "云端同步失败",
      });
    }

    return response.ok({
      message: "云端同步成功",
      data,
    });
  } catch (error) {
    console.error("Sync cloud now error:", error);
    return response.serverError();
  }
}

export async function getCloudRemoteStatus(
  params: GetCloudRemoteStatus,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CloudRemoteStatus | null>>>;
export async function getCloudRemoteStatus(
  params: GetCloudRemoteStatus,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CloudRemoteStatus | null>>;
export async function getCloudRemoteStatus(
  { access_token }: GetCloudRemoteStatus,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CloudRemoteStatus | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getCloudRemoteStatus"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
    },
    GetCloudRemoteStatusSchema,
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
    const data = await fetchCloudRemoteStatusInternal();
    return response.ok({ data });
  } catch (error) {
    console.error("Get cloud remote status error:", error);
    return response.serverError();
  }
}

export async function getCloudHistory(
  params: GetCloudHistory,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CloudHistoryItem[] | null>>>;
export async function getCloudHistory(
  params: GetCloudHistory,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CloudHistoryItem[] | null>>;
export async function getCloudHistory(
  {
    access_token,
    page = 1,
    pageSize = 25,
    sortBy,
    sortOrder,
    id,
    deliveryId,
    status,
    verifySource,
    accepted,
    dedupHit,
    createdAtStart,
    createdAtEnd,
  }: GetCloudHistory,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CloudHistoryItem[] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getCloudHistory"))) {
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
      deliveryId,
      status,
      verifySource,
      accepted,
      dedupHit,
      createdAtStart,
      createdAtEnd,
    },
    GetCloudHistorySchema,
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
      deliveryId?: { contains: string; mode: "insensitive" };
      status?: "RECEIVED" | "DONE" | "ERROR" | "REJECTED";
      verifySource?: "DOH" | "JWKS" | null;
      accepted?: boolean;
      dedupHit?: boolean;
      createdAt?: {
        gte?: Date;
        lte?: Date;
      };
    } = {};

    if (id !== undefined) where.id = id;
    if (deliveryId) {
      where.deliveryId = {
        contains: deliveryId.trim(),
        mode: "insensitive",
      };
    }
    if (status) where.status = status;
    if (verifySource) {
      where.verifySource = verifySource === "NONE" ? null : verifySource;
    }
    if (accepted !== undefined) where.accepted = accepted;
    if (dedupHit !== undefined) where.dedupHit = dedupHit;
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
      | { receivedAt: "asc" | "desc" }
      | { status: "asc" | "desc" }
      | { verifySource: "asc" | "desc" }
      | { accepted: "asc" | "desc" }
      | { dedupHit: "asc" | "desc" }
      | { createdAt: "asc" | "desc" } = { receivedAt: "desc" };

    if (sortBy && sortOrder) {
      switch (sortBy) {
        case "id":
          orderBy = { id: sortOrder };
          break;
        case "receivedAt":
          orderBy = { receivedAt: sortOrder };
          break;
        case "status":
          orderBy = { status: sortOrder };
          break;
        case "verifySource":
          orderBy = { verifySource: sortOrder };
          break;
        case "accepted":
          orderBy = { accepted: sortOrder };
          break;
        case "dedupHit":
          orderBy = { dedupHit: sortOrder };
          break;
        case "createdAt":
          orderBy = { createdAt: sortOrder };
          break;
      }
    }

    const [total, records] = await Promise.all([
      prisma.cloudTriggerHistory.count({ where }),
      prisma.cloudTriggerHistory.findMany({
        skip,
        take: pageSize,
        where,
        orderBy,
        select: {
          id: true,
          deliveryId: true,
          triggerType: true,
          requestedAt: true,
          receivedAt: true,
          verifyOk: true,
          verifySource: true,
          accepted: true,
          dedupHit: true,
          status: true,
          message: true,
          cronHistoryId: true,
          telemetry: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);

    const data = records.map((record) => toCloudHistoryItem(record));
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
    console.error("Get cloud history error:", error);
    return response.serverError();
  }
}

export async function getCloudTrends(
  params: GetCloudTrends,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CloudTrendItem[] | null>>>;
export async function getCloudTrends(
  params: GetCloudTrends,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CloudTrendItem[] | null>>;
export async function getCloudTrends(
  { access_token, days = 30, count = 60 }: GetCloudTrends,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CloudTrendItem[] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getCloudTrends"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      days,
      count,
    },
    GetCloudTrendsSchema,
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
      prisma.cloudTriggerHistory.findMany({
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
          receivedAt: true,
          accepted: true,
          dedupHit: true,
          verifySource: true,
          status: true,
        },
      }),
      prisma.cloudTriggerHistory.findMany({
        take: count,
        orderBy: {
          createdAt: "desc",
        },
        select: {
          id: true,
          receivedAt: true,
          accepted: true,
          dedupHit: true,
          verifySource: true,
          status: true,
        },
      }),
    ]);

    const mergedMap = new Map<number, (typeof recentByTime)[0]>();
    for (const item of recentByTime) {
      mergedMap.set(item.id, item);
    }
    for (const item of recentByCount) {
      mergedMap.set(item.id, item);
    }

    const bucketMap = new Map<
      string,
      {
        acceptedCount: number;
        rejectedCount: number;
        dedupCount: number;
        verifyDohCount: number;
        verifyJwksCount: number;
        errorCount: number;
        timeoutCount: number;
      }
    >();
    const nowMs = Date.now();

    for (const item of mergedMap.values()) {
      const dayKey = `${item.receivedAt.toISOString().slice(0, 10)}T00:00:00.000Z`;
      if (!bucketMap.has(dayKey)) {
        bucketMap.set(dayKey, {
          acceptedCount: 0,
          rejectedCount: 0,
          dedupCount: 0,
          verifyDohCount: 0,
          verifyJwksCount: 0,
          errorCount: 0,
          timeoutCount: 0,
        });
      }
      const bucket = bucketMap.get(dayKey)!;

      if (item.accepted) {
        bucket.acceptedCount += 1;
      } else {
        bucket.rejectedCount += 1;
      }
      if (item.dedupHit) {
        bucket.dedupCount += 1;
      }
      if (item.verifySource === "DOH") {
        bucket.verifyDohCount += 1;
      } else if (item.verifySource === "JWKS") {
        bucket.verifyJwksCount += 1;
      }
      if (item.status === "ERROR" || item.status === "REJECTED") {
        bucket.errorCount += 1;
      }
      if (
        item.status === "RECEIVED" &&
        nowMs - item.receivedAt.getTime() >= CLOUD_RECEIVED_TIMEOUT_MS
      ) {
        bucket.timeoutCount += 1;
      }
    }

    const data: CloudTrendItem[] = Array.from(bucketMap.entries())
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([time, bucket]) => ({
        time,
        data: bucket,
      }));

    return response.ok({ data });
  } catch (error) {
    console.error("Get cloud trends error:", error);
    return response.serverError();
  }
}
