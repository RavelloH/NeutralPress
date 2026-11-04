// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => {
  const callbackQueue: Array<() => Promise<void>> = [];
  const pipeline = { zadd: vi.fn(), exec: vi.fn(async () => [[null, 1]]) };
  const redis = {
    pipeline: vi.fn(() => pipeline),
    set: vi.fn(async () => "OK"),
    zcard: vi.fn(async () => 0),
    zrange: vi.fn(async () => ["/", "1000"]),
    zrem: vi.fn(async () => 1),
    eval: vi.fn(async () => 1),
  };
  return {
    callbackQueue,
    redis,
    pipeline,
    after: vi.fn((fn: () => Promise<void>) => callbackQueue.push(fn)),
  };
});
vi.mock("next/server", () => ({ after: mocks.after }));
const configMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/cloudflare-cache-config", () => ({
  getCloudflareCacheCredentials: configMock,
}));
vi.mock("@/lib/server/redis", () => ({
  default: mocks.redis,
  ensureRedisConnection: vi.fn(async () => undefined),
}));

import {
  drainCdnCacheQueue,
  eligibleCdnPaths,
  scheduleCdnCacheRefresh,
} from "@/lib/server/cdn-cache-pipeline";

describe("CDN cache invalidation pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configMock.mockResolvedValue(null);
    mocks.callbackQueue.length = 0;
    vi.stubEnv("CLOUDFLARE_CACHE_ZONE_ID", "");
    vi.stubEnv("CLOUDFLARE_CACHE_PURGE_TOKEN", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("only accepts explicit public HTML allowlist routes", () => {
    expect(
      eligibleCdnPaths([
        "/admin",
        "/",
        "/posts/secret",
        "/posts",
        "/",
        "/gallery",
        "/messages",
      ]),
    ).toEqual(["/", "/gallery", "/posts"]);
  });

  it("never starts CDN work without both scoped credentials", async () => {
    scheduleCdnCacheRefresh(["/"]);
    expect(mocks.after).toHaveBeenCalledTimes(1);
    await mocks.callbackQueue[0]!();
    expect(mocks.redis.pipeline).not.toHaveBeenCalled();
    expect(await drainCdnCacheQueue()).toEqual({
      pending: 0,
      completed: 0,
      configured: false,
    });
  });

  it("persists mutation, confirms origin HIT, purges the exact public URL", async () => {
    configMock.mockResolvedValue({
      zone: "test-zone",
      token: "test-token",
      siteUrl: "https://ravelloh.com",
      source: "database",
    });
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
        calls.push({ url, method: init?.method, body: init?.body });
        if (url.startsWith("http://127.0.0.1")) {
          return {
            ok: true,
            headers: {
              get: (key: string) => (key === "x-nextjs-cache" ? "HIT" : null),
            },
            arrayBuffer: async () => new ArrayBuffer(0),
          };
        }
        return { ok: true, status: 200, json: async () => ({ success: true }) };
      }),
    );

    scheduleCdnCacheRefresh(["/", "/admin"]);
    expect(mocks.after).toHaveBeenCalledTimes(1);
    await mocks.callbackQueue[0]!();

    expect(mocks.pipeline.zadd).toHaveBeenCalledWith(
      "np:cdn:html-invalidation",
      expect.any(Number),
      "/",
    );
    expect(calls[0]?.url).toBe("http://127.0.0.1:3000/");
    expect(calls[1]?.url).toContain("/purge_cache");
    expect(JSON.parse(calls[1]!.body!)).toEqual({
      files: ["https://ravelloh.com/"],
    });
  });
});
