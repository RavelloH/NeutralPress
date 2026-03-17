import "server-only";

import redis, { ensureRedisConnection } from "@/lib/server/redis";

/**
 * Redis 缓存工具类
 * 提供统一的缓存读写接口，支持自动降级到内存缓存
 */

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 缓存配置选项
 */
export interface CacheOptions {
  /**
   * 缓存过期时间（秒）
   * @default 3600 (1小时)
   */
  ttl?: number;
  /**
   * 是否启用内存降级缓存
   * @default true
   */
  enableFallback?: boolean;
}

/**
 * 内存缓存项
 */
interface MemoryCacheItem<T> {
  data: T;
  expiresAt: Date;
}

// ============================================================================
// 内存降级缓存
// ============================================================================

/**
 * 内存缓存存储（降级方案）
 * 当 Redis 不可用时使用
 */
const memoryCache = new Map<string, MemoryCacheItem<unknown>>();
const MEMORY_CACHE_MAX_SIZE = 1000;

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

/**
 * 清理过期的内存缓存
 */
function cleanExpiredMemoryCache(): void {
  const now = new Date();
  const expiredKeys: string[] = [];

  memoryCache.forEach((item, key) => {
    if (item.expiresAt <= now) {
      expiredKeys.push(key);
    }
  });

  expiredKeys.forEach((key) => memoryCache.delete(key));
}

/**
 * 确保内存缓存不超过大小限制，必要时淘汰最早过期的条目
 */
function ensureMemoryCacheSize(): void {
  if (memoryCache.size < MEMORY_CACHE_MAX_SIZE) return;

  // 先清理过期条目
  cleanExpiredMemoryCache();
  if (memoryCache.size < MEMORY_CACHE_MAX_SIZE) return;

  // 仍然超限时，淘汰最早过期的条目（为即将写入的新条目预留空间）
  const entriesToEvict = memoryCache.size - MEMORY_CACHE_MAX_SIZE + 1;
  if (entriesToEvict <= 0) return;

  const keysToEvict = Array.from(memoryCache.entries())
    .sort((a, b) => a[1].expiresAt.getTime() - b[1].expiresAt.getTime())
    .slice(0, entriesToEvict)
    .map(([key]) => key);

  keysToEvict.forEach((key) => memoryCache.delete(key));
}

// 定期清理过期缓存（每5分钟）
if (typeof setInterval !== "undefined") {
  setInterval(cleanExpiredMemoryCache, 5 * 60 * 1000);
}

// ============================================================================
// 核心缓存函数
// ============================================================================

/**
 * 从缓存中获取数据
 * @param key 缓存键
 * @param options 缓存配置选项
 * @returns 缓存的数据，如果不存在则返回 null
 */
export async function getCache<T>(
  key: string,
  options: CacheOptions = {},
): Promise<T | null> {
  const { enableFallback = true } = options;

  // 尝试从 Redis 获取
  try {
    await ensureRedisConnection();
    const cachedData = await redis.get(key);

    if (cachedData) {
      const parsedData = JSON.parse(cachedData) as T;
      return parsedData;
    }
  } catch (redisError) {
    console.warn(
      `[Cache/Redis] Read failed: ${key}`,
      redisError instanceof Error ? redisError.message : redisError,
    );

    // 降级到内存缓存
    if (enableFallback) {
      const memoryCacheItem = memoryCache.get(key);
      if (memoryCacheItem) {
        const now = new Date();
        if (memoryCacheItem.expiresAt > now) {
          return memoryCacheItem.data as T;
        } else {
          // 缓存已过期，删除
          memoryCache.delete(key);
        }
      }
    }
  }

  return null;
}

/**
 * 将数据存储到缓存
 * @param key 缓存键
 * @param value 要缓存的数据
 * @param options 缓存配置选项
 * @returns 是否成功存储
 */
export async function setCache<T>(
  key: string,
  value: T,
  options: CacheOptions = {},
): Promise<boolean> {
  const { ttl = 3600, enableFallback = true } = options;

  // 尝试写入 Redis
  try {
    await ensureRedisConnection();
    const serializedData = JSON.stringify(value);
    await redis.setex(key, ttl, serializedData);

    // 同时写入内存缓存作为备份
    if (enableFallback) {
      ensureMemoryCacheSize();
      const expiresAt = new Date(Date.now() + ttl * 1000);
      memoryCache.set(key, { data: value, expiresAt });
    }

    return true;
  } catch (redisError) {
    console.warn(
      `[Cache/Redis] Write failed: ${key}`,
      redisError instanceof Error ? redisError.message : redisError,
    );

    // 降级到内存缓存
    if (enableFallback) {
      ensureMemoryCacheSize();
      const expiresAt = new Date(Date.now() + ttl * 1000);
      memoryCache.set(key, { data: value, expiresAt });
      return true;
    }

    return false;
  }
}

/**
 * 删除缓存
 * @param key 缓存键
 * @param options 缓存配置选项
 * @returns 是否成功删除
 */
export async function deleteCache(
  key: string,
  _options: CacheOptions = {},
): Promise<boolean> {
  let success = false;

  // 尝试从 Redis 删除
  try {
    await ensureRedisConnection();
    await redis.del(key);
    success = true;
  } catch (redisError) {
    console.warn(
      `[Cache/Redis] Delete failed: ${key}`,
      redisError instanceof Error ? redisError.message : redisError,
    );
  }

  // 无论是否启用降级，都尝试从内存缓存删除，避免残留脏数据
  const memoryDeleted = memoryCache.delete(key);
  return success || memoryDeleted;
}

/**
 * 清空所有缓存（慎用）
 * @param pattern 可选的键模式，如 "user:*"
 * @param options 缓存配置选项
 * @returns 删除的键数量
 */
export async function clearCache(
  pattern?: string,
  options: CacheOptions = {},
): Promise<number> {
  const { enableFallback = true } = options;
  let count = 0;

  // 清空 Redis 缓存
  try {
    await ensureRedisConnection();

    if (pattern) {
      // 按模式删除（使用 SCAN 避免 KEYS 阻塞）
      let cursor = "0";
      let deleted = 0;

      do {
        const [nextCursor, keys] = await redis.scan(
          cursor,
          "MATCH",
          pattern,
          "COUNT",
          200,
        );
        cursor = nextCursor;

        if (keys.length > 0) {
          deleted += await redis.del(...keys);
        }
      } while (cursor !== "0");

      count = deleted;
    } else {
      // 清空所有
      await redis.flushdb();
      count = -1; // 表示全部清空
    }
  } catch (redisError) {
    console.warn(
      `[Cache/Redis] Clear failed${pattern ? ` (pattern: ${pattern})` : ""}`,
      redisError instanceof Error ? redisError.message : redisError,
    );
  }

  // 清空内存缓存
  if (enableFallback) {
    if (pattern) {
      // 按模式删除
      const regex = wildcardToRegExp(pattern);
      const keysToDelete: string[] = [];

      memoryCache.forEach((_, key) => {
        if (regex.test(key)) {
          keysToDelete.push(key);
        }
      });

      keysToDelete.forEach((key) => memoryCache.delete(key));
    } else {
      // 清空所有
      memoryCache.clear();
    }
  }

  return count;
}

/**
 * 检查缓存是否存在
 * @param key 缓存键
 * @param options 缓存配置选项
 * @returns 缓存是否存在
 */
export async function hasCache(
  key: string,
  options: CacheOptions = {},
): Promise<boolean> {
  const { enableFallback = true } = options;

  // 检查 Redis
  try {
    await ensureRedisConnection();
    const exists = await redis.exists(key);
    if (exists) return true;
  } catch (redisError) {
    console.warn("[Cache/Redis] Exists check failed:", redisError);
  }

  // 检查内存缓存
  if (enableFallback) {
    const memoryCacheItem = memoryCache.get(key);
    if (memoryCacheItem) {
      const now = new Date();
      if (memoryCacheItem.expiresAt > now) {
        return true;
      } else {
        // 缓存已过期，删除
        memoryCache.delete(key);
      }
    }
  }

  return false;
}

/**
 * 获取缓存的剩余过期时间（秒）
 * @param key 缓存键
 * @returns 剩余过期时间（秒），-1 表示永不过期，-2 表示不存在
 */
export async function getCacheTTL(key: string): Promise<number> {
  try {
    await ensureRedisConnection();
    return await redis.ttl(key);
  } catch (redisError) {
    console.warn("[Cache/Redis] TTL query failed:", redisError);

    // 检查内存缓存
    const memoryCacheItem = memoryCache.get(key);
    if (memoryCacheItem) {
      const now = Date.now();
      const ttl = Math.floor(
        (memoryCacheItem.expiresAt.getTime() - now) / 1000,
      );
      return ttl > 0 ? ttl : -2;
    }

    return -2; // 不存在
  }
}

// ============================================================================
// 高级缓存函数
// ============================================================================

/**
 * 获取或设置缓存（如果不存在则执行回调函数获取数据并缓存）
 * @param key 缓存键
 * @param fetchFn 获取数据的回调函数
 * @param options 缓存配置选项
 * @returns 缓存的数据或新获取的数据
 */
export async function getOrSetCache<T>(
  key: string,
  fetchFn: () => Promise<T>,
  options: CacheOptions = {},
): Promise<T> {
  // 尝试从缓存获取
  const cachedData = await getCache<T>(key, options);
  if (cachedData !== null) {
    return cachedData;
  }

  // 缓存未命中,执行回调函数获取数据
  const data = await fetchFn();

  // 将新数据存储到缓存
  await setCache(key, data, options);

  return data;
}

/**
 * 批量获取缓存
 * @param keys 缓存键数组
 * @param options 缓存配置选项
 * @returns 键值对对象
 */
export async function getBatchCache<T>(
  keys: string[],
  options: CacheOptions = {},
): Promise<Record<string, T | null>> {
  const result: Record<string, T | null> = {};

  await Promise.all(
    keys.map(async (key) => {
      result[key] = await getCache<T>(key, options);
    }),
  );

  return result;
}

/**
 * 批量设置缓存
 * @param entries 键值对数组
 * @param options 缓存配置选项
 * @returns 成功设置的键数量
 */
export async function setBatchCache<T>(
  entries: Array<{ key: string; value: T }>,
  options: CacheOptions = {},
): Promise<number> {
  let successCount = 0;

  await Promise.all(
    entries.map(async ({ key, value }) => {
      const success = await setCache(key, value, options);
      if (success) successCount++;
    }),
  );

  return successCount;
}

// ============================================================================
// 导出工具函数
// ============================================================================

/**
 * 生成缓存键
 * @param purpose 使用目的（如：user、post、config 等）
 * @param parts 键的各个部分
 * @returns 格式化的缓存键，格式：np:cache:{purpose}:{part1}:{part2}:...
 * @example
 * generateCacheKey("user", "stats", 123) // => "np:cache:user:stats:123"
 * generateCacheKey("post", "detail", "my-slug") // => "np:cache:post:detail:my-slug"
 */
export function generateCacheKey(purpose: string, ...parts: unknown[]): string {
  return ["np", "cache", purpose, ...parts.map(String)].join(":");
}

/**
 * 获取内存缓存统计信息
 * @returns 内存缓存统计
 */
export function getMemoryCacheStats(): {
  size: number;
  keys: string[];
} {
  return {
    size: memoryCache.size,
    keys: Array.from(memoryCache.keys()),
  };
}
