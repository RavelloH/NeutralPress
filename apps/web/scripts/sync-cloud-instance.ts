import { execSync } from "node:child_process";
import {
  createPrivateKey,
  generateKeyPairSync,
  randomUUID,
  sign,
} from "node:crypto";
import path from "node:path";

import RLog from "rlog-js";

import { loadWebEnv } from "@/../scripts/load-env";
import { loadPrismaClientConstructor } from "@/../scripts/load-prisma-client";

import {
  buildCloudSignMessage,
  encodeBase64Url,
  generateNonce,
} from "../src/lib/shared/cloud-signature";

loadWebEnv();

const rlog = new RLog();

interface CloudSyncConfig {
  enabled: boolean;
  siteId: string;
  sitePubKey: string;
  sitePrivKey: string;
  siteKeyAlg: string;
  scheduleMinuteOfDay: number | null;
  cloudBaseUrl: string;
  siteUrl: string | null;
}

interface ScriptPrismaClient {
  config: {
    findUnique(args: unknown): Promise<{ value: unknown } | null>;
    upsert(args: unknown): Promise<unknown>;
  };
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
}

interface ScriptPool {
  end?: () => Promise<void>;
}

interface ScriptRuntime {
  prisma: ScriptPrismaClient;
  pool: ScriptPool;
}

function readDefaultValue(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const record = value as Record<string, unknown>;
  return "default" in record ? record.default : value;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
  }
  return fallback;
}

function normalizeCloudBaseUrl(raw: string): string {
  const fallback = "https://cloud.neutralpress.net";
  const value = raw || fallback;
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
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

function normalizeCloudScheduleTime(raw: string): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;

  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
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

async function createPrismaClient(): Promise<ScriptRuntime | null> {
  try {
    const PrismaClient = await loadPrismaClientConstructor();
    const { Pool } = await import("pg");
    const { PrismaPg } = await import("@prisma/adapter-pg");

    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
    const adapter = new PrismaPg(pool);
    const prisma = new PrismaClient({ adapter, log: [] });

    await prisma.$connect();
    return {
      prisma: prisma as ScriptPrismaClient,
      pool: pool as ScriptPool,
    };
  } catch (error) {
    rlog.warning(
      ` Prisma initialization failed, skipping cloud sync: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

async function readConfigValue(
  prisma: ScriptPrismaClient,
  key: string,
): Promise<unknown> {
  const record = await prisma.config.findUnique({
    where: { key },
    select: { value: true },
  });
  if (!record) return undefined;
  return readDefaultValue(record.value);
}

async function writeConfigValue(
  prisma: ScriptPrismaClient,
  key: string,
  value: unknown,
): Promise<void> {
  await prisma.config.upsert({
    where: { key },
    update: {
      value: { default: value },
    },
    create: {
      key,
      value: { default: value },
    },
  });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
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

async function ensureCloudIdentity(
  prisma: ScriptPrismaClient,
): Promise<CloudSyncConfig | null> {
  const enabledRaw = await readConfigValue(prisma, "cloud.enable");
  const enabled = normalizeBoolean(enabledRaw, true);
  if (!enabled) {
    rlog.info(" cloud.enable=false, skipping cloud sync");
    return null;
  }

  let siteId = normalizeString(await readConfigValue(prisma, "cloud.id"));
  let sitePubKey = normalizeString(
    await readConfigValue(prisma, "cloud.key.pub"),
  );
  let sitePrivKey = normalizeString(
    await readConfigValue(prisma, "cloud.key.priv"),
  );
  const siteKeyAlgRaw = normalizeString(
    await readConfigValue(prisma, "cloud.key.alg"),
  );
  const scheduleTimeRaw = normalizeString(
    await readConfigValue(prisma, "cloud.schedule.time"),
  );
  const scheduleMinuteOfDay = scheduleTimeToMinuteOfDay(
    normalizeCloudScheduleTime(scheduleTimeRaw),
  );
  const siteKeyAlg = siteKeyAlgRaw || "ed25519";
  const cloudBaseUrl = normalizeCloudBaseUrl(
    normalizeString(await readConfigValue(prisma, "cloud.api.baseUrl")),
  );
  const siteUrl = normalizeSiteUrlForCloud(
    normalizeString(await readConfigValue(prisma, "site.url")),
  );

  if (!isUuid(siteId)) {
    siteId = randomUUID();
    await writeConfigValue(prisma, "cloud.id", siteId);
    rlog.info(` Generated cloud.id: ${siteId}`);
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

    await writeConfigValue(prisma, "cloud.key.pub", sitePubKey);
    await writeConfigValue(prisma, "cloud.key.priv", sitePrivKey);
    await writeConfigValue(prisma, "cloud.key.alg", "ed25519");
    rlog.info(" Generated cloud.key.pub / cloud.key.priv");
  }

  return {
    enabled,
    siteId,
    sitePubKey,
    sitePrivKey,
    siteKeyAlg,
    scheduleMinuteOfDay,
    cloudBaseUrl,
    siteUrl,
  };
}

async function syncToCloud(configValue: CloudSyncConfig): Promise<void> {
  const syncPath = "/v1/instances/sync";
  const ts = new Date().toISOString();
  const nonce = generateNonce(12);

  const packageJsonPath = path.join(process.cwd(), "package.json");
  let appVersion: string | null = null;

  try {
    const fs = await import("node:fs/promises");
    const packageJsonRaw = await fs.readFile(packageJsonPath, "utf8");
    const packageJson = JSON.parse(packageJsonRaw) as { version?: unknown };
    appVersion =
      typeof packageJson.version === "string" && packageJson.version.trim()
        ? packageJson.version.trim()
        : null;
  } catch {
    appVersion = null;
  }

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
    siteId: configValue.siteId,
    sitePubKey: configValue.sitePubKey,
    siteKeyAlg: configValue.siteKeyAlg || "ed25519",
    siteUrl: configValue.siteUrl,
    minuteOfDay: configValue.scheduleMinuteOfDay,
    appVersion,
    buildId,
    commit,
    builtAt,
    idempotencyKey: `${configValue.siteId}:${builtAt}`,
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
    createPrivateKey(configValue.sitePrivKey),
  );
  const sig = encodeBase64Url(signatureBuffer);

  const endpoint = `${configValue.cloudBaseUrl}${syncPath}`;
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

    const text = await response.text();
    if (!response.ok) {
      rlog.warning(` Cloud sync failed (${response.status}): ${text}`);
      return;
    }

    rlog.success(" Instance synced to cloud successfully");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Cloud sync request failed";
    rlog.warning(` Cloud sync failed: ${message}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function syncCloudInstance(options?: {
  prisma?: unknown;
}): Promise<void> {
  const externalPrisma = options?.prisma as ScriptPrismaClient | undefined;
  const runtime = externalPrisma
    ? { prisma: externalPrisma, pool: null }
    : await createPrismaClient();
  if (!runtime) return;

  const { prisma, pool } = runtime;
  try {
    const cloudConfig = await ensureCloudIdentity(prisma);
    if (!cloudConfig) return;
    await syncToCloud(cloudConfig);
  } catch (error) {
    rlog.warning(
      ` Prebuild cloud sync error (ignored): ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    if (!externalPrisma) {
      await prisma.$disconnect().catch(() => undefined);
      await pool?.end?.().catch(() => undefined);
    }
  }
}
