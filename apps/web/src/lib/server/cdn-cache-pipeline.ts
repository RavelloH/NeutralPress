import "server-only";

import { randomUUID } from "node:crypto";

import { after } from "next/server";

import redis, { ensureRedisConnection } from "@/lib/server/redis";

// Only explicitly audited, anonymous HTML documents may enter shared CDN cache.
// Do not include /posts/[slug] until protected post access is separately audited.
export const PUBLIC_HTML_CDN_PATHS = [
  "/",
  "/posts",
  "/projects",
  "/gallery",
] as const;
const ALLOWED_PATHS = new Set<string>(PUBLIC_HTML_CDN_PATHS);
const QUEUE_KEY = "np:cdn:html-invalidation";
const LOCK_KEY = "np:cdn:html-invalidation:lock";
const ORIGIN = "http://127.0.0.1:3000";
const WEBSITE = "https://ravelloh.com";
const MAX_PER_PASS = 4;

function credentials(): { zone: string; token: string } | null {
  const zone = process.env.CLOUDFLARE_CACHE_ZONE_ID?.trim();
  const token = process.env.CLOUDFLARE_CACHE_PURGE_TOKEN?.trim();
  return zone && token ? { zone, token } : null;
}

export function eligibleCdnPaths(paths: Iterable<string>): string[] {
  return [...new Set(paths)].filter((path) => ALLOWED_PATHS.has(path)).sort();
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
  // Bypass Cloudflare; the HTTP request after revalidation commits the new ISR.
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(ORIGIN + path, {
      method: "GET",
      cache: "no-store",
      headers: { accept: "text/html" },
      signal: AbortSignal.timeout(15000),
    });
    await response.arrayBuffer();
    if (response.ok && response.headers.get("x-nextjs-cache") === "HIT") {
      return true;
    }
  }
  return false;
}

async function purgeUrls(
  paths: string[],
  zone: string,
  token: string,
): Promise<void> {
  const response = await fetch(
    "https://api.cloudflare.com/client/v4/zones/" + zone + "/purge_cache",
    {
      method: "POST",
      headers: {
        authorization: "Bearer " + token,
        "content-type": "application/json",
      },
      body: JSON.stringify({ files: paths.map((path) => WEBSITE + path) }),
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
  const auth = credentials();
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
      if (!ALLOWED_PATHS.has(path)) {
        await redis.zrem(QUEUE_KEY, path);
        continue;
      }
      try {
        if (!(await warmPage(path))) {
          throw new Error("Origin did not return a regenerated ISR HIT");
        }
        await purgeUrls([path], auth.zone, auth.token);
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
  if (!credentials()) return;
  const selected = eligibleCdnPaths(paths);
  if (!selected.length) return;

  const work = async () => {
    try {
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
