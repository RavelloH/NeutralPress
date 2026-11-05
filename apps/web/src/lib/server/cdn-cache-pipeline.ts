import "server-only";

import { randomUUID } from "node:crypto";

import { after } from "next/server";

import {
  HTML_CACHE_TAG,
  isDeniedHtmlPath,
  normalizeHtmlPath,
} from "@/lib/server/cdn-html-policy";
import { getCloudflareCacheCredentials } from "@/lib/server/cloudflare-cache-config";
import redis, { ensureRedisConnection } from "@/lib/server/redis";

// Shared public ISR HTML is selected by the origin response, not a path
// allowlist. The Redis outbox persists exact URL purges and a global HTML tag
// purge, without invalidating hashed JS/CSS/image assets.
const QUEUE_KEY = "np:cdn:html-invalidation";
const LOCK_KEY = "np:cdn:html-invalidation:lock";
const ORIGIN = "http://127.0.0.1:3000";
const MAX_PER_PASS = 4;
const REVOKING_PREFIX = "np:cdn:revoking:";
const REVOKING_TTL_SECONDS = 900;
export const ALL_PUBLIC_HTML_JOB = "tag:" + HTML_CACHE_TAG;

export function eligibleCdnPaths(paths: Iterable<string>): string[] {
  const result = new Set<string>();
  for (const original of paths) {
    if (original === ALL_PUBLIC_HTML_JOB) {
      result.add(original);
      continue;
    }
    const normalized = normalizeHtmlPath(original);
    if (normalized && !isDeniedHtmlPath(normalized)) {
      result.add(normalized);
    }
  }
  return [...result].sort();
}

function revokingKey(path: string): string {
  return REVOKING_PREFIX + path;
}

/**
 * Blocks a just-revoked public post from being re-cached by the origin while
 * the administrator is changing its access mode, slug or publication state.
 */
export async function isPublicHtmlRevoking(path: string): Promise<boolean> {
  await ensureRedisConnection();
  return (await redis.exists(revokingKey(path))) > 0;
}

/**
 * Called BEFORE a public article becomes protected, unpublished or renamed:
 * set a temporary origin cache block first, then hard-purge its old HTML.
 * If Cloudflare rejects the purge, the mutation must not proceed.
 */
export async function beginPublicHtmlRevocation(
  paths: Iterable<string>,
): Promise<void> {
  const allowed = eligibleCdnPaths(paths).filter(
    (path) => path !== ALL_PUBLIC_HTML_JOB,
  );
  if (!allowed.length) return;
  const auth = await getCloudflareCacheCredentials();
  if (!auth) return;
  await ensureRedisConnection();
  for (const path of allowed) {
    await redis.set(revokingKey(path), "1", "EX", REVOKING_TTL_SECONDS);
  }
  for (let i = 0; i < allowed.length; i += 100) {
    await purgeUrls(
      allowed.slice(i, i + 100),
      auth.zone,
      auth.token,
      auth.siteUrl,
    );
  }
}

/**
 * Called AFTER the DB update and ISR invalidation. A second hard purge
 * closes the window of any in-flight old public response; do not lift the
 * temporary origin block until Cloudflare acknowledges the purge.
 */
export async function finishPublicHtmlRevocation(
  paths: Iterable<string>,
): Promise<void> {
  const allowed = eligibleCdnPaths(paths).filter(
    (path) => path !== ALL_PUBLIC_HTML_JOB,
  );
  if (!allowed.length) return;
  const auth = await getCloudflareCacheCredentials();
  if (!auth) return;
  for (let i = 0; i < allowed.length; i += 100) {
    await purgeUrls(
      allowed.slice(i, i + 100),
      auth.zone,
      auth.token,
      auth.siteUrl,
    );
  }
  await ensureRedisConnection();
  await redis.del(...allowed.map(revokingKey));
}

async function enqueue(paths: string[]): Promise<void> {
  await ensureRedisConnection();
  const timestamp = Date.now();
  const pipeline = redis.pipeline();
  for (const path of paths) pipeline.zadd(QUEUE_KEY, timestamp, path);
  const results = await pipeline.exec();
  if (!results || results.some(([err]) => err)) {
    throw new Error("Failed to persist CDN invalidation events in Redis");
  }
}

async function warmPage(path: string): Promise<boolean> {
  // Permission changes or deletion make the former public URL uncacheable.
  // Such a path still must be hard-purged, rather than waiting for an ISR HIT.
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(ORIGIN + path, {
      method: "GET",
      cache: "no-store",
      headers: { accept: "text/html" },
      signal: AbortSignal.timeout(15000),
    });
    await response.arrayBuffer();
    if ([301, 302, 303, 307, 308, 404, 410].includes(response.status))
      return true;
    if (
      response.headers.get("Cloudflare-CDN-Cache-Control")?.includes("no-store")
    )
      return true;
    if (response.ok && response.headers.get("x-nextjs-cache") === "HIT")
      return true;
  }
  return false;
}

async function purgeUrls(
  paths: string[],
  zone: string,
  token: string,
  siteUrl: string,
): Promise<void> {
  const response = await fetch(
    "https://api.cloudflare.com/client/v4/zones/" + zone + "/purge_cache",
    {
      method: "POST",
      headers: {
        authorization: "Bearer " + token,
        "content-type": "application/json",
      },
      body: JSON.stringify({ files: paths.map((path) => siteUrl + path) }),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    },
  );
  const body: { success?: boolean; errors?: Array<{ code: number }> } =
    await response.json();
  if (!response.ok || !body.success) {
    throw new Error(
      "Cloudflare purge failed: HTTP " +
        response.status +
        ", error codes=" +
        (body.errors ?? []).map((e) => e.code).join(","),
    );
  }
}

async function purgePublicHtmlTag(zone: string, token: string): Promise<void> {
  const response = await fetch(
    "https://api.cloudflare.com/client/v4/zones/" + zone + "/purge_cache",
    {
      method: "POST",
      headers: {
        authorization: "Bearer " + token,
        "content-type": "application/json",
      },
      body: JSON.stringify({ tags: [HTML_CACHE_TAG] }),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    },
  );
  const body: { success?: boolean; errors?: Array<{ code: number }> } =
    await response.json();
  if (!response.ok || !body.success) {
    throw new Error(
      "Cloudflare HTML tag purge failed: HTTP " +
        response.status +
        ", error codes=" +
        (body.errors ?? []).map((e) => e.code).join(","),
    );
  }
}

/**
 * Redis is the retry outbox; a per-run token protects the worker lock.
 * Remove each job only if it has not been rewritten by another mutation.
 * All CDN operations use hard purge initially, preventing stale private content.
 */
export async function drainCdnCacheQueue(): Promise<{
  pending: number;
  completed: number;
  configured: boolean;
}> {
  const auth = await getCloudflareCacheCredentials();
  if (!auth) return { pending: 0, completed: 0, configured: false };
  await ensureRedisConnection();
  const owner = randomUUID();
  const acquired = await redis.set(LOCK_KEY, owner, "EX", 180, "NX");
  if (acquired !== "OK") {
    return {
      pending: await redis.zcard(QUEUE_KEY),
      completed: 0,
      configured: true,
    };
  }

  let completed = 0;
  try {
    const jobs = await redis.zrange(
      QUEUE_KEY,
      0,
      MAX_PER_PASS - 1,
      "WITHSCORES",
    );
    for (let i = 0; i < jobs.length; i += 2) {
      const path = jobs[i];
      const score = jobs[i + 1];
      if (path === undefined || score === undefined) continue;
      if (!eligibleCdnPaths([path]).includes(path)) {
        await redis.zrem(QUEUE_KEY, path);
        continue;
      }
      try {
        if (path === ALL_PUBLIC_HTML_JOB) {
          await purgePublicHtmlTag(auth.zone, auth.token);
        } else {
          if (!(await warmPage(path))) {
            throw new Error(
              "Origin did not return regenerated ISR or a safe uncached response",
            );
          }
          await purgeUrls([path], auth.zone, auth.token, auth.siteUrl);
        }
        await redis.eval(
          "local n=redis.call('ZSCORE',KEYS[1],ARGV[1]); " +
            "if n and tonumber(n)<=tonumber(ARGV[2]) then return redis.call('ZREM',KEYS[1],ARGV[1]) end return 0",
          1,
          QUEUE_KEY,
          path,
          score,
        );
        completed++;
      } catch (error) {
        console.error("[CDN cache] Refresh failed for path", path, error);
      }
    }
    return {
      pending: await redis.zcard(QUEUE_KEY),
      completed,
      configured: true,
    };
  } finally {
    await redis.eval(
      "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0",
      1,
      LOCK_KEY,
      owner,
    );
  }
}

/**
 * Register work in the current Next.js request's after() hook.
 * Never enable Cloudflare HTML caching without first configuring purge credentials.
 */
export function scheduleCdnCacheRefresh(paths: Iterable<string>): void {
  const selected = eligibleCdnPaths(paths);
  if (!selected.length) return;

  const work = async () => {
    try {
      // Configuration is read from the database for every mutation, without restart.
      if (!(await getCloudflareCacheCredentials())) return;
      await enqueue(selected);
      await drainCdnCacheQueue();
    } catch (error) {
      console.error("[CDN cache] Unable to persist and start refresh", error);
    }
  };
  try {
    after(work);
  } catch (error) {
    // Standalone scheduled jobs might not have a Next.js request context.
    // Keep content writes successful, then attempt immediate asynchronous enqueue.
    console.warn(
      "[CDN cache] No after() context; enqueueing immediately",
      error,
    );
    void work();
  }
}
