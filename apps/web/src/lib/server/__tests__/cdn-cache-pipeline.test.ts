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
    exists: vi.fn(async () => 0),
    del: vi.fn(async () => 1),
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
  ALL_PUBLIC_HTML_JOB,
  beginPublicHtmlRevocation,
  drainCdnCacheQueue,
  eligibleCdnPaths,
  finishPublicHtmlRevocation,
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

  it("accepts canonical public HTML paths and the global tag, but rejects private paths", () => {
    expect(
      eligibleCdnPaths([
        "/admin",
        "/",
        "/posts/example",
        "/posts",
        "/gallery/photo/pic",
        "/gallery",
        "/messages",
        "/posts/example",
        ALL_PUBLIC_HTML_JOB,
      ]),
    ).toEqual([
      "/",
      "/gallery",
      "/gallery/photo/pic",
      "/posts",
      "/posts/example",
      ALL_PUBLIC_HTML_JOB,
    ]);
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

  it("purges only tagged HTML across all public ISR pages", async () => {
    configMock.mockResolvedValue({
      zone: "zone",
      token: "token",
      siteUrl: "https://example.com",
      source: "config",
    });
    mocks.redis.zrange.mockResolvedValueOnce([ALL_PUBLIC_HTML_JOB, "1000"]);
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, options?: { body?: string }) => {
        requests.push(options?.body ?? "");
        return { ok: true, status: 200, json: async () => ({ success: true }) };
      }),
    );
    const result = await drainCdnCacheQueue();
    expect(result.completed).toBe(1);
    expect(requests).toEqual([JSON.stringify({ tags: ["np-isr-html"] })]);
  });

  it("holds a revoked URL before purging and releases only after a second purge", async () => {
    configMock.mockResolvedValue({
      zone: "zone",
      token: "token",
      siteUrl: "https://example.com",
      source: "config",
    });
    const purged: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: { body?: string }) => {
        purged.push(init?.body ?? "");
        return { ok: true, status: 200, json: async () => ({ success: true }) };
      }),
    );
    await beginPublicHtmlRevocation(["/posts/old"]);
    expect(mocks.redis.set).toHaveBeenCalledWith(
      "np:cdn:revoking:/posts/old",
      "1",
      "EX",
      900,
    );
    expect(mocks.redis.del).not.toHaveBeenCalled();
    await finishPublicHtmlRevocation(["/posts/old"]);
    expect(mocks.redis.del).toHaveBeenCalledWith("np:cdn:revoking:/posts/old");
    expect(purged).toEqual([
      JSON.stringify({ files: ["https://example.com/posts/old"] }),
      JSON.stringify({ files: ["https://example.com/posts/old"] }),
    ]);
  });

  it("fails the initial revoke when Cloudflare is unavailable", async () => {
    configMock.mockResolvedValue({
      zone: "zone",
      token: "token",
      siteUrl: "https://example.com",
      source: "config",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({ success: false, errors: [] }),
      })),
    );
    await expect(
      beginPublicHtmlRevocation(["/posts/protected"]),
    ).rejects.toThrow("Cloudflare purge failed");
    expect(mocks.redis.del).not.toHaveBeenCalled();
  });

  it("hard-purges a now-private URL even when the origin has no ISR HIT", async () => {
    configMock.mockResolvedValue({
      zone: "zone",
      token: "token",
      siteUrl: "https://example.com",
      source: "config",
    });
    mocks.redis.zrange.mockResolvedValueOnce(["/posts/former-public", "1000"]);
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options?: { body?: string }) => {
        calls.push(url);
        if (url.startsWith("http://127.0.0.1")) {
          return {
            status: 200,
            ok: true,
            arrayBuffer: async () => new ArrayBuffer(0),
            headers: {
              get: (key: string) =>
                key === "Cloudflare-CDN-Cache-Control"
                  ? "private, no-store"
                  : null,
            },
          };
        }
        expect(JSON.parse(options!.body!)).toEqual({
          files: ["https://example.com/posts/former-public"],
        });
        return { ok: true, status: 200, json: async () => ({ success: true }) };
      }),
    );
    expect((await drainCdnCacheQueue()).completed).toBe(1);
    expect(calls).toHaveLength(2);
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
