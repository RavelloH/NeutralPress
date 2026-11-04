// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mock = vi.hoisted(() => {
  const rows = new Map<string, unknown>();
  const config = {
    findMany: vi.fn(async ({ where }: { where: { key: { in: string[] } } }) =>
      [...rows.entries()]
        .filter(([key]) => where.key.in.includes(key))
        .map(([key, value]) => ({ key, value })),
    ),
    findUnique: vi.fn(async ({ where }: { where: { key: string } }) =>
      rows.has(where.key)
        ? { key: where.key, value: rows.get(where.key) }
        : null,
    ),
    upsert: vi.fn(
      async ({
        where,
        create,
        update,
      }: {
        where: { key: string };
        create: { value: unknown };
        update: { value: unknown };
      }) => {
        const value = rows.has(where.key) ? update.value : create.value;
        rows.set(where.key, value);
        return { key: where.key, value };
      },
    ),
  };
  const prisma = {
    config,
    $transaction: vi.fn(
      async (fn: (tx: { config: typeof config }) => Promise<unknown>) =>
        fn({ config }),
    ),
  };
  return { rows, config, prisma };
});
vi.mock("@/lib/server/prisma", () => ({ default: mock.prisma }));

import {
  getCloudflareCacheCredentials,
  getCloudflareCacheSettings,
  normalizeCloudflareSiteUrl,
  saveCloudflareCacheSettings,
} from "@/lib/server/cloudflare-cache-config";

const TOKEN = "cf-purge-token-example-long-enough";
const ZONE = "763e43ff82498affce6fafc1648f69cb";

describe("Cloudflare CDN internal Config integration", () => {
  beforeEach(() => {
    mock.rows.clear();
    vi.clearAllMocks();
    vi.stubEnv("CLOUDFLARE_CACHE_PURGE_TOKEN", "");
    vi.stubEnv("CLOUDFLARE_CACHE_ZONE_ID", "");
    vi.stubEnv("NEUTRALPRESS_CDN_SITE_URL", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("reads legacy environment config only before database initialization", async () => {
    vi.stubEnv("CLOUDFLARE_CACHE_PURGE_TOKEN", TOKEN);
    vi.stubEnv("CLOUDFLARE_CACHE_ZONE_ID", ZONE);
    mock.rows.set("site.url", { default: "https://ravelloh.com" });
    expect(await getCloudflareCacheCredentials()).toMatchObject({
      token: TOKEN,
      zone: ZONE,
      source: "environment",
    });
    expect(await getCloudflareCacheSettings()).toMatchObject({
      tokenConfigured: true,
      source: "environment",
    });
  });

  it("migrates legacy token as plaintext into the normal Config table", async () => {
    vi.stubEnv("CLOUDFLARE_CACHE_PURGE_TOKEN", TOKEN);
    await saveCloudflareCacheSettings({
      zoneId: ZONE,
      siteUrl: "https://ravelloh.com",
    });
    expect(mock.rows.get("secret.cdn.cloudflare.purgeToken")).toBe(TOKEN);
    expect(mock.rows.get("cdn.cloudflare")).toEqual({
      zoneId: ZONE,
      siteUrl: "https://ravelloh.com",
    });
    expect(await getCloudflareCacheSettings()).toEqual({
      zoneId: ZONE,
      siteUrl: "https://ravelloh.com",
      tokenConfigured: true,
      source: "database",
    });
    expect(JSON.stringify(await getCloudflareCacheSettings())).not.toContain(
      TOKEN,
    );
  });

  it("uses updated database settings immediately without environment or restart", async () => {
    await saveCloudflareCacheSettings({
      zoneId: ZONE,
      siteUrl: "https://ravelloh.com",
      token: TOKEN,
    });
    vi.stubEnv("CLOUDFLARE_CACHE_ZONE_ID", "");
    vi.stubEnv("CLOUDFLARE_CACHE_PURGE_TOKEN", "");
    expect((await getCloudflareCacheCredentials())?.token).toBe(TOKEN);
    const replacement = "new-token-12345678901234567890";
    await saveCloudflareCacheSettings({
      zoneId: ZONE,
      siteUrl: "https://ravelloh.com",
      token: replacement,
    });
    expect((await getCloudflareCacheCredentials())?.token).toBe(replacement);
    expect(mock.config.findMany).toHaveBeenCalledTimes(2);
  });

  it("never falls back to stale environment secrets after database setup", async () => {
    vi.stubEnv("CLOUDFLARE_CACHE_PURGE_TOKEN", TOKEN);
    vi.stubEnv("CLOUDFLARE_CACHE_ZONE_ID", ZONE);
    mock.rows.set("cdn.cloudflare", {
      zoneId: ZONE,
      siteUrl: "https://ravelloh.com",
    });
    expect(await getCloudflareCacheCredentials()).toBeNull();
  });

  it("rejects invalid public origin URLs and incomplete settings", async () => {
    expect(() => normalizeCloudflareSiteUrl("http://example.com")).toThrow();
    expect(() =>
      normalizeCloudflareSiteUrl("https://example.com/admin"),
    ).toThrow();
    await expect(
      saveCloudflareCacheSettings({
        zoneId: "invalid",
        siteUrl: "https://ravelloh.com",
        token: TOKEN,
      }),
    ).rejects.toThrow();
  });
});
