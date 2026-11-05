// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mock = vi.hoisted(() => ({
  findMany: vi.fn(),
  getConfigs: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  default: { config: { findMany: mock.findMany } },
}));
vi.mock("@/lib/server/config-cache", () => ({
  getConfigs: mock.getConfigs,
}));

import {
  getCloudflareCacheCredentials,
  normalizeCloudflareSiteUrl,
} from "@/lib/server/cloudflare-cache-config";

const ZONE = "763e43ff82498affce6fafc1648f69cb";
const TOKEN = "example-purge-token-0123456789012345";

describe("Cloudflare CDN canonical Config integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.findMany.mockResolvedValue([]);
    mock.getConfigs.mockResolvedValue([
      ZONE,
      "https://example.com",
      TOKEN,
      "https://example.com",
    ]);
  });

  it("reads Token together with all other ordinary Config values", async () => {
    mock.findMany.mockResolvedValue([{ key: "cdn.cloudflare.zoneId" }]);
    expect(await getCloudflareCacheCredentials()).toEqual({
      zone: ZONE,
      token: TOKEN,
      siteUrl: "https://example.com",
      source: "config",
    });
    expect(mock.getConfigs).toHaveBeenCalledWith([
      "cdn.cloudflare.zoneId",
      "cdn.cloudflare.siteUrl",
      "cdn.cloudflare.purgeToken",
      "site.url",
    ]);
  });

  it("does not silently use previous secrets when standard config is incomplete", async () => {
    mock.findMany.mockResolvedValue([{ key: "cdn.cloudflare.zoneId" }]);
    mock.getConfigs.mockResolvedValue([
      ZONE,
      "https://example.com",
      "",
      "https://example.com",
    ]);
    expect(await getCloudflareCacheCredentials()).toBeNull();
    expect(mock.findMany).toHaveBeenCalledTimes(1);
  });

  it("reads legacy Config values during a safe staged upgrade", async () => {
    mock.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        key: "cdn.cloudflare",
        value: { zoneId: ZONE, siteUrl: "https://ravelloh.com" },
      },
      { key: "secret.cdn.cloudflare.purgeToken", value: TOKEN },
    ]);
    expect(await getCloudflareCacheCredentials()).toEqual({
      zone: ZONE,
      token: TOKEN,
      siteUrl: "https://ravelloh.com",
      source: "legacy",
    });
  });

  it("never reads legacy environment variables on a fresh installation", async () => {
    expect(await getCloudflareCacheCredentials()).toBeNull();
    expect(mock.getConfigs).not.toHaveBeenCalled();
  });

  it("rejects invalid HTTPS public origins", () => {
    expect(normalizeCloudflareSiteUrl("https://example.com/")).toBe(
      "https://example.com",
    );
    expect(() => normalizeCloudflareSiteUrl("http://example.com")).toThrow();
    expect(() =>
      normalizeCloudflareSiteUrl("https://example.com/admin"),
    ).toThrow();
    expect(() =>
      normalizeCloudflareSiteUrl("https://user:pass@example.com"),
    ).toThrow();
  });
});
