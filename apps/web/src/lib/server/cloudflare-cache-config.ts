import "server-only";

import { getConfigs } from "@/lib/server/config-cache";
import prisma from "@/lib/server/prisma";

const STANDARD_KEYS = [
  "cdn.cloudflare.zoneId",
  "cdn.cloudflare.siteUrl",
  "cdn.cloudflare.purgeToken",
] as const;

const LEGACY_SETTINGS_KEY = "cdn.cloudflare";
const LEGACY_TOKEN_KEY = "secret.cdn.cloudflare.purgeToken";

type CdnCredentials = {
  zone: string;
  token: string;
  siteUrl: string;
  source: "config" | "legacy";
};

export function normalizeCloudflareSiteUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !/^[a-z0-9.-]+$/i.test(url.hostname) ||
    url.hostname === "localhost"
  ) {
    throw new Error("Expected a public HTTPS origin");
  }
  return url.origin;
}

/**
 * Cloudflare settings use the same Config reader and invalidation tags as
 * other ordinary settings.
 */
export async function getCloudflareCacheCredentials(): Promise<CdnCredentials | null> {
  const present = await prisma.config.findMany({
    where: { key: { in: [...STANDARD_KEYS] } },
    select: { key: true },
  });

  if (present.length > 0) {
    const [zoneId, originOverride, tokenValue, siteUrlConfig] =
      await getConfigs([
        "cdn.cloudflare.zoneId",
        "cdn.cloudflare.siteUrl",
        "cdn.cloudflare.purgeToken",
        "site.url",
      ]);
    const token = tokenValue.trim();
    const zone = zoneId.trim();
    if (!/^[a-f0-9]{32}$/i.test(zone) || !token) return null;
    const siteUrl = normalizeCloudflareSiteUrl(
      originOverride.trim() || siteUrlConfig.trim(),
    );
    return { zone, token, siteUrl, source: "config" };
  }

  // Read-only upgrade compatibility; no new saves to old Config keys.
  const rows = await prisma.config.findMany({
    where: { key: { in: [LEGACY_SETTINGS_KEY, LEGACY_TOKEN_KEY] } },
    select: { key: true, value: true },
  });
  const oldConfig = rows.find((r) => r.key === LEGACY_SETTINGS_KEY)?.value;
  const oldToken = rows.find((r) => r.key === LEGACY_TOKEN_KEY)?.value;
  if (
    !oldConfig ||
    typeof oldConfig !== "object" ||
    Array.isArray(oldConfig) ||
    typeof oldToken !== "string"
  )
    return null;
  const record = oldConfig as { zoneId?: unknown; siteUrl?: unknown };
  if (
    typeof record.zoneId !== "string" ||
    !/^[a-f0-9]{32}$/i.test(record.zoneId.trim()) ||
    !oldToken.trim()
  )
    return null;
  const [defaultSiteUrl] = await getConfigs(["site.url"]);
  return {
    zone: record.zoneId.trim(),
    token: oldToken.trim(),
    siteUrl: normalizeCloudflareSiteUrl(
      typeof record.siteUrl === "string" && record.siteUrl.trim()
        ? record.siteUrl
        : defaultSiteUrl,
    ),
    source: "legacy",
  };
}
