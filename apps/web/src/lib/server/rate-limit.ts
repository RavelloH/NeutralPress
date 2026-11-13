import "server-only";

import { readFileSync } from "fs";
import { join } from "path";

import { verifyAccessToken } from "@/lib/server/auth-verify";
import redis, { ensureRedisConnection } from "@/lib/server/redis";

// 配置常量：基于角色的速率限制
const RATE_LIMITS = {
  GUEST: 30, // 访客（未登录）
  USER: 60, // 普通用户
  EDITOR: 120, // 编辑/作者
  ADMIN: 600, // 管理员
} as const;

const WINDOW_MS = 60000; // 限流窗口：1分钟
const EXPIRE_MS = 86400000; // 数据保留：24小时
const HOUR_STATS_TTL = 2592000; // 小时统计 TTL：30天

// 简化后只支持有 get 方法的 Headers 格式
type HeadersObject = { get: (key: string) => string | null };

// 提取IP地址的函数
function extractIpAddress(headers: HeadersObject): string {
  return (
    headers.get("x-real-ip") ||
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-vercel-proxied-for") ||
    "unknown"
  );
}

// 从 Cookie 中提取 ACCESS_TOKEN
function extractAccessToken(headers: HeadersObject): string | null {
  const cookieHeader = headers.get("cookie");
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(";").reduce(
    (acc, cookie) => {
      const [key, value] = cookie.trim().split("=");
      if (key && value) {
        acc[key] = value;
      }
      return acc;
    },
    {} as Record<string, string>,
  );

  return cookies["ACCESS_TOKEN"] || null;
}

// 根据用户角色获取速率限制
async function getRateLimitByRole(headers: HeadersObject): Promise<number> {
  const token = extractAccessToken(headers);

  if (!token) {
    return RATE_LIMITS.GUEST; // 未登录，使用访客限制
  }

  const payload = await verifyAccessToken(token);

  if (!payload || !payload.role) {
    return RATE_LIMITS.GUEST; // Token 无效，使用访客限制
  }

  // 根据角色返回不同的限制
  switch (payload.role) {
    case "ADMIN":
      return RATE_LIMITS.ADMIN;
    case "EDITOR":
      return RATE_LIMITS.EDITOR;
    case "USER":
      return RATE_LIMITS.USER;
    default:
      return RATE_LIMITS.GUEST;
  }
}

// Lua 脚本：原子化限流 + 统计
// 从独立文件加载
const RATE_LIMIT_SCRIPT = readFileSync(
  join(process.cwd(), "src/lib/server/lua-scripts/rate-limit.lua"),
  "utf-8",
);

// 缓存 Lua 脚本的 SHA1 哈希（性能优化）
let scriptSha: string | null = null;

// 加载 Lua 脚本到 Redis，返回 SHA1 哈希
async function ensureScriptLoaded(): Promise<string> {
  if (scriptSha) {
    return scriptSha;
  }

  try {
    await ensureRedisConnection();
    const sha = (await redis.script("LOAD", RATE_LIMIT_SCRIPT)) as string;
    scriptSha = sha;
    console.log(` [Rate Limit] Lua script loaded: ${sha}`);
    return sha;
  } catch (error) {
    console.error("Failed to load Lua script:", error);
    throw error;
  }
}

// 限流结果类型
export type RateLimitResult = 1 | 0 | -1;

// Redis 实现的速率限制（使用 Lua 脚本保证原子性）
async function limitControl(
  headers: HeadersObject,
  apiName: string = "unknown",
): Promise<boolean> {
  try {
    await ensureRedisConnection();

    const ip = extractIpAddress(headers);
    const rateLimit = await getRateLimitByRole(headers); // 动态获取速率限制
    const now = Date.now();
    const currentHour = Math.floor(now / 3600000);

    // 准备 Lua 脚本的 keys 和 args
    const keys = [
      `np:rate:ip:${ip}`, // 1: rateKey
      "np:rate:stat:success", // 2: statSuccess
      "np:rate:stat:error", // 3: statError
      `np:rate:stat:hour:${currentHour}:success`, // 4: statHourSuccess
      `np:rate:stat:hour:${currentHour}:error`, // 5: statHourError
      `np:rate:ban:${ip}`, // 6: banKey
      "np:rate:endpoint", // 7: endpointKey
    ];

    const args = [
      now.toString(), // 1: now
      rateLimit.toString(), // 2: limit（根据用户角色动态调整）
      apiName, // 3: apiName
      EXPIRE_MS.toString(), // 4: expireMs
      WINDOW_MS.toString(), // 5: windowMs
      HOUR_STATS_TTL.toString(), // 6: hourStatsTtl
    ];

    // 确保脚本已加载
    const sha = await ensureScriptLoaded();

    let result: RateLimitResult;

    try {
      // 使用 EVALSHA 减少网络传输（2KB → 40 字节）
      result = (await redis.evalsha(
        sha,
        keys.length,
        ...keys,
        ...args,
      )) as RateLimitResult;
    } catch (error: unknown) {
      // 如果脚本不存在（NOSCRIPT 错误），重新加载并重试
      if (error instanceof Error && error.message?.includes("NOSCRIPT")) {
        console.warn(" [Rate Limit] Script not found, reloading...");
        scriptSha = null; // 清除缓存
        const newSha = await ensureScriptLoaded();
        result = (await redis.evalsha(
          newSha,
          keys.length,
          ...keys,
          ...args,
        )) as RateLimitResult;
      } else {
        throw error;
      }
    }

    // 1 = 允许, 0 = 限流, -1 = 封禁
    return result === 1;
  } catch (error) {
    console.error("Rate limit check failed:", error);
    // 出错时默认允许请求，避免影响正常服务
    return true;
  }
}

// 检查 IP 是否被封禁（供外部查询使用）
async function isIPBanned(ip: string): Promise<boolean> {
  try {
    await ensureRedisConnection();
    const banKey = `np:rate:ban:${ip}`;
    const exists = await redis.exists(banKey);
    return exists === 1;
  } catch (error) {
    console.error("Check IP ban status failed:", error);
    return false;
  }
}

// 导出辅助函数供安全模块使用
export { extractIpAddress, isIPBanned, RATE_LIMITS };
export default limitControl;
