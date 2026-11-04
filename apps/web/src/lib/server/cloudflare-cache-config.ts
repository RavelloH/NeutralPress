import "server-only";

import { randomBytes } from "node:crypto";

import prisma from "@/lib/server/prisma";

import type { Prisma } from ".prisma/client";

// Both settings live in the existing Config table. As with other integrations,
// the credential is stored as plaintext JSON; no bespoke encryption layer.
const SETTINGS_KEY = "cdn.cloudflare";
const TOKEN_KEY = "secret.cdn.cloudflare.purgeToken";

export interface CloudflareCacheSettings {
  zoneId: string;
  siteUrl: string;
  tokenConfigured: boolean;
  source: "database" | "environment" | "none";
}

export function normalizeCloudflareSiteUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Site URL must be a public HTTPS origin");
  }
  if (!/^[a-z0-9.-]+$/i.test(url.hostname) || url.hostname === "localhost") {
    throw new Error("Invalid public site hostname");
  }
  return url.origin;
}

function parseSettings(
  value: unknown,
): { zoneId: string; siteUrl: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const object = value as Record<string, unknown>;
  return {
    zoneId: typeof object.zoneId === "string" ? object.zoneId : "",
    siteUrl: typeof object.siteUrl === "string" ? object.siteUrl : "",
  };
}

async function readRows() {
  return prisma.config.findMany({
    where: { key: { in: [SETTINGS_KEY, TOKEN_KEY] } },
    select: { key: true, value: true },
  });
}

function tokenFromConfig(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function legacyCredentials(): Promise<{
  zone: string;
  token: string;
  siteUrl: string;
  source: "environment";
} | null> {
  const zone = process.env.CLOUDFLARE_CACHE_ZONE_ID?.trim() ?? "";
  const token = process.env.CLOUDFLARE_CACHE_PURGE_TOKEN?.trim() ?? "";
  if (!/^[0-9a-f]{32}$/i.test(zone) || !token) return null;
  // Use the site's existing persisted URL, not a developer-specific domain.
  const configuredSite = process.env.NEUTRALPRESS_CDN_SITE_URL?.trim();
  const siteSetting = configuredSite
    ? null
    : await prisma.config.findUnique({
        where: { key: "site.url" },
        select: { value: true },
      });
  const siteValue = siteSetting?.value as { default?: unknown } | undefined;
  const siteUrl =
    configuredSite ||
    (typeof siteValue?.default === "string" ? siteValue.default : "");
  if (!siteUrl) return null;
  return {
    zone,
    token,
    siteUrl: normalizeCloudflareSiteUrl(siteUrl),
    source: "environment",
  };
}

/**
 * Always read the database, without unstable_cache or restart. The old
 * environment integration is retained only while no DB CDN settings exist.
 * A partially configured DB entry must not silently fall back to a legacy token.
 */
export async function getCloudflareCacheCredentials(): Promise<{
  zone: string;
  token: string;
  siteUrl: string;
  source: "database" | "environment";
} | null> {
  const rows = await readRows();
  if (rows.length === 0) return legacyCredentials();

  const settings = parseSettings(
    rows.find((row) => row.key === SETTINGS_KEY)?.value,
  );
  const token = tokenFromConfig(
    rows.find((row) => row.key === TOKEN_KEY)?.value,
  );
  const zone = settings?.zoneId?.trim() ?? "";
  const origin = settings?.siteUrl?.trim() ?? "";
  if (!/^[0-9a-f]{32}$/i.test(zone) || !origin || !token) return null;
  return {
    zone,
    token,
    siteUrl: normalizeCloudflareSiteUrl(origin),
    source: "database",
  };
}

export async function getCloudflareCacheSettings(): Promise<CloudflareCacheSettings> {
  const rows = await readRows();
  if (rows.length > 0) {
    const settings = parseSettings(
      rows.find((row) => row.key === SETTINGS_KEY)?.value,
    );
    return {
      zoneId: settings?.zoneId ?? "",
      siteUrl: settings?.siteUrl ?? "",
      tokenConfigured: Boolean(
        tokenFromConfig(rows.find((row) => row.key === TOKEN_KEY)?.value),
      ),
      source: "database",
    };
  }
  const legacy = await legacyCredentials();
  return legacy
    ? {
        zoneId: legacy.zone,
        siteUrl: legacy.siteUrl,
        tokenConfigured: true,
        source: "environment",
      }
    : { zoneId: "", siteUrl: "", tokenConfigured: false, source: "none" };
}

export async function saveCloudflareCacheSettings(input: {
  zoneId: string;
  siteUrl: string;
  token?: string;
}): Promise<void> {
  const zoneId = input.zoneId.trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(zoneId)) {
    throw new Error("Zone ID must be 32 hexadecimal characters");
  }
  const siteUrl = normalizeCloudflareSiteUrl(input.siteUrl.trim());
  const existingToken = input.token?.trim();
  if (
    existingToken &&
    (existingToken.length < 20 || existingToken.length > 4096)
  ) {
    throw new Error("Invalid Cloudflare purge token length");
  }

  // Preserve existing token or migrate the legacy environment token in the
  // same DB transaction, so a saved settings row is always complete.
  await prisma.$transaction(async (db) => {
    const prior = await db.config.findUnique({ where: { key: TOKEN_KEY } });
    const token =
      existingToken ||
      tokenFromConfig(prior?.value) ||
      process.env.CLOUDFLARE_CACHE_PURGE_TOKEN?.trim();
    if (!token) throw new Error("Provide a Cloudflare purge token");

    await db.config.upsert({
      where: { key: SETTINGS_KEY },
      create: { key: SETTINGS_KEY, value: { zoneId, siteUrl } },
      update: { value: { zoneId, siteUrl } },
    });
    await db.config.upsert({
      where: { key: TOKEN_KEY },
      create: { key: TOKEN_KEY, value: token as Prisma.InputJsonValue },
      update: { value: token as Prisma.InputJsonValue },
    });
  });
}

export async function testCloudflareCacheCredentials(input: {
  zoneId: string;
  token: string;
  siteUrl: string;
}): Promise<boolean> {
  const zoneId = input.zoneId.trim();
  if (!/^[0-9a-f]{32}$/i.test(zoneId)) return false;
  const siteUrl = normalizeCloudflareSiteUrl(input.siteUrl);
  const probe =
    siteUrl +
    "/__neutralpress_cache_token_test_" +
    randomBytes(12).toString("hex");
  const response = await fetch(
    "https://api.cloudflare.com/client/v4/zones/" + zoneId + "/purge_cache",
    {
      method: "POST",
      headers: {
        authorization: "Bearer " + input.token,
        "content-type": "application/json",
      },
      body: JSON.stringify({ files: [probe] }),
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    },
  );
  if (!response.ok) return false;
  const result: { success?: boolean } = await response.json();
  return result.success === true;
}
