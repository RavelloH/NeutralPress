import "server-only";

import crypto from "crypto";

import { generateCacheKey } from "@/lib/server/cache";
import redis, { ensureRedisConnection } from "@/lib/server/redis";

// ============================================================================
// Base32 编解码
// ============================================================================

const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Base32 编码
 */
function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i]!;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_CHARS[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_CHARS[(value << (5 - bits)) & 31];
  }

  return output;
}

/**
 * Base32 解码
 */
function base32Decode(str: string): Buffer {
  const cleanStr = str.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (let i = 0; i < cleanStr.length; i++) {
    const char = cleanStr[i]!;
    const idx = BASE32_CHARS.indexOf(char);
    if (idx === -1) continue;

    value = (value << 5) | idx;
    bits += 5;

    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(output);
}

// ============================================================================
// 密钥派生 (用于加密)
// ============================================================================

/**
 * 使用 HKDF 从主密钥派生子密钥
 */
function deriveKey(masterSecret: string, info: string, length: number): Buffer {
  const ikm = Buffer.from(masterSecret, "utf-8");
  const salt = Buffer.alloc(32); // 空盐
  const infoBuffer = Buffer.from(info, "utf-8");

  const derived = crypto.hkdfSync("sha256", ikm, salt, infoBuffer, length);
  return Buffer.from(derived);
}

/**
 * 获取 TOTP 加密密钥
 */
function getTotpEncryptionKey(): Buffer {
  const masterSecret = process.env.MASTER_SECRET;
  if (!masterSecret) {
    throw new Error("MASTER_SECRET 环境变量未设置");
  }
  return deriveKey(masterSecret, "totp-encrypt", 32);
}

// ============================================================================
// TOTP 核心算法 (生成与验证)
// ============================================================================

/**
 * 生成随机的 TOTP secret（Base32 编码）
 * @param length secret 长度（字节），默认 20
 * @returns Base32 编码的 secret
 */
export function generateTotpSecret(length: number = 20): string {
  const buffer = crypto.randomBytes(length);
  return base32Encode(buffer);
}

/**
 * 生成 TOTP URI（用于 QR 码）
 * @param secret Base32 编码的 secret
 * @param accountName 账户名称（通常是用户名或邮箱）
 * @param issuer 发行者名称（站点名称）
 * @returns TOTP URI
 */
export function generateTotpUri(
  secret: string,
  accountName: string,
  issuer: string,
): string {
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });

  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}?${params.toString()}`;
}

/**
 * 生成 TOTP 码
 * @param secret Base32 编码的 secret
 * @param timeStep 时间步长（秒），默认 30
 * @param time 当前时间戳（秒），默认为当前时间
 * @returns 6位数字验证码
 */
export function generateTotpCode(
  secret: string,
  timeStep: number = 30,
  time?: number,
): string {
  const counter = Math.floor((time || Date.now() / 1000) / timeStep);
  const secretBuffer = base32Decode(secret);

  // 生成 8 字节的计数器（大端序）
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  // HMAC-SHA1
  const hmac = crypto.createHmac("sha1", secretBuffer);
  hmac.update(counterBuffer);
  const digest = hmac.digest();

  // 动态截断
  const offset = digest[digest.length - 1]! & 0x0f;
  const code =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;

  // 返回 6 位数字
  return (code % 1000000).toString().padStart(6, "0");
}

/**
 * 验证 TOTP 码
 * @param secret Base32 编码的 secret
 * @param code 用户输入的 6 位验证码
 * @param window 时间窗口（允许前后 n 个时间步），默认 1（允许 ±30 秒）
 * @param timeStep 时间步长（秒），默认 30
 * @returns 是否验证通过
 */
export function verifyTotpCode(
  secret: string,
  code: string,
  window: number = 1,
  timeStep: number = 30,
): boolean {
  const currentTime = Math.floor(Date.now() / 1000);

  // 检查当前时间及前后时间窗口
  for (let i = -window; i <= window; i++) {
    const time = currentTime + i * timeStep;
    const expectedCode = generateTotpCode(secret, timeStep, time);

    // 使用恒定时间比较防止时序攻击
    if (
      code.length === expectedCode.length &&
      crypto.timingSafeEqual(Buffer.from(code), Buffer.from(expectedCode))
    ) {
      return true;
    }
  }

  return false;
}

// ============================================================================
// 备份码生成与验证
// ============================================================================

/**
 * 生成备份码（8位数字，格式 XXXX-XXXX）
 * @param count 生成数量，默认 8
 * @returns 备份码数组
 */
export function generateBackupCodes(count: number = 8): string[] {
  const codes: string[] = [];

  for (let i = 0; i < count; i++) {
    // 生成 8 位数字
    const num = crypto.randomInt(10000000, 99999999);
    const numStr = num.toString();
    // 格式化为 XXXX-XXXX
    const formatted = `${numStr.slice(0, 4)}-${numStr.slice(4)}`;
    codes.push(formatted);
  }

  return codes;
}

/**
 * 验证备份码格式
 * @param code 备份码
 * @returns 是否为有效格式
 */
export function isValidBackupCodeFormat(code: string): boolean {
  return /^\d{4}-\d{4}$/.test(code);
}

// ============================================================================
// 加密与解密 (TOTP Secret & Backup Codes)
// ============================================================================

/**
 * 加密 TOTP secret
 * @param secret 原始 TOTP secret（Base32 编码）
 * @returns base64 编码的加密数据（包含 IV）
 */
export function encryptTotpSecret(secret: string): string {
  const key = getTotpEncryptionKey();
  const iv = crypto.randomBytes(12); // GCM 推荐 12 字节 IV

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(secret, "utf-8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // 格式: IV(12) + AuthTag(16) + Ciphertext
  const combined = Buffer.concat([iv, authTag, encrypted]);

  // 转换为 base64
  return combined.toString("base64");
}

/**
 * 解密 TOTP secret
 * @param encryptedData base64 编码的加密数据
 * @returns 原始 TOTP secret 或 null（解密失败）
 */
export function decryptTotpSecret(encryptedData: string): string | null {
  try {
    const key = getTotpEncryptionKey();
    const combined = Buffer.from(encryptedData, "base64");

    // 解析: IV(12) + AuthTag(16) + Ciphertext
    if (combined.length < 28) {
      return null;
    }

    const iv = combined.subarray(0, 12);
    const authTag = combined.subarray(12, 28);
    const encrypted = combined.subarray(28);

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return decrypted.toString("utf-8");
  } catch {
    return null;
  }
}

/**
 * 加密备份码
 * @param code 原始备份码（8位数字）
 * @returns base64 编码的加密数据
 */
export function encryptBackupCode(code: string): string {
  const key = getTotpEncryptionKey();
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(code, "utf-8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  const combined = Buffer.concat([iv, authTag, encrypted]);
  return combined.toString("base64");
}

/**
 * 解密备份码
 * @param encryptedData base64 编码的加密数据
 * @returns 原始备份码 或 null（解密失败）
 */
export function decryptBackupCode(encryptedData: string): string | null {
  try {
    const key = getTotpEncryptionKey();
    const combined = Buffer.from(encryptedData, "base64");

    if (combined.length < 28) {
      return null;
    }

    const iv = combined.subarray(0, 12);
    const authTag = combined.subarray(12, 28);
    const encrypted = combined.subarray(28);

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return decrypted.toString("utf-8");
  } catch {
    return null;
  }
}

// ============================================================================
// 速率限制 (Redis)
// ============================================================================

/**
 * 检查 TOTP 验证失败次数
 * @returns 是否超过限制（3次）
 */
export async function checkTotpFailCount(uid: number): Promise<boolean> {
  await ensureRedisConnection();
  const key = generateCacheKey("auth", "totp", "fail", uid);
  const count = await redis.get(key);
  return count ? parseInt(count, 10) >= 3 : false;
}

/**
 * 增加 TOTP 验证失败次数
 */
export async function incrementTotpFailCount(uid: number): Promise<void> {
  await ensureRedisConnection();
  const key = generateCacheKey("auth", "totp", "fail", uid);
  const count = await redis.incr(key);

  // 首次设置过期时间为 5 分钟
  if (count === 1) {
    await redis.expire(key, 300);
  }
}

/** 为用户原子预留一次 TOTP 验证机会。 */
export async function reserveTotpAttempt(uid: number): Promise<boolean> {
  await ensureRedisConnection();
  const key = generateCacheKey("auth", "totp", "fail", uid);
  const result = await redis.eval(
    "local count=tonumber(redis.call('GET',KEYS[1]) or '0'); " +
      "if count>=tonumber(ARGV[1]) then return 0 end; " +
      "local next=redis.call('INCR',KEYS[1]); " +
      "if next==1 then redis.call('EXPIRE',KEYS[1],ARGV[2]) end; " +
      "return 1",
    1,
    key,
    "3",
    "300",
  );

  return Number(result) === 1;
}

/**
 * 重置 TOTP 验证失败次数
 */
export async function resetTotpFailCount(uid: number): Promise<void> {
  await ensureRedisConnection();
  const key = generateCacheKey("auth", "totp", "fail", uid);
  await redis.del(key);
}
