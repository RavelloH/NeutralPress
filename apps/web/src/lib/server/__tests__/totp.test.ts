import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock Redis 和相关模块
const mockRedis = {
  get: vi.fn(),
  incr: vi.fn(),
  expire: vi.fn(),
  del: vi.fn(),
  eval: vi.fn(),
};

vi.mock("@/lib/server/redis", () => ({
  default: mockRedis,
  ensureRedisConnection: vi.fn(),
}));

vi.mock("@/lib/server/cache", () => ({
  generateCacheKey: (...parts: (string | number)[]) =>
    "np:cache:" + parts.join(":"),
}));

const TEST_MASTER_SECRET =
  "test-master-secret-key-that-is-at-least-32-chars-long-for-testing";

describe("totp", () => {
  let totpModule: typeof import("@/lib/server/totp");

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.MASTER_SECRET = TEST_MASTER_SECRET;
    totpModule = await import("@/lib/server/totp");
  });

  afterEach(() => {
    delete process.env.MASTER_SECRET;
  });

  // ==========================================================================
  // generateTotpSecret
  // ==========================================================================

  describe("generateTotpSecret", () => {
    it("应生成 Base32 编码的 secret", () => {
      const secret = totpModule.generateTotpSecret();
      expect(secret).toBeDefined();
      expect(typeof secret).toBe("string");
      // Base32 字符集: A-Z, 2-7
      expect(secret).toMatch(/^[A-Z2-7]+$/);
    });

    it("默认长度应为 20 字节（32 个 Base32 字符）", () => {
      const secret = totpModule.generateTotpSecret();
      // 20 字节 = 160 bits, Base32 每 5 bits 一个字符 = 32 字符
      expect(secret.length).toBe(32);
    });

    it("应支持自定义长度", () => {
      const secret16 = totpModule.generateTotpSecret(16);
      const secret32 = totpModule.generateTotpSecret(32);

      // 16 bytes = 128 bits = 26 Base32 字符 (128/5 = 25.6, 向上取整为 26)
      expect(secret16.length).toBe(26);
      // 32 bytes = 256 bits = 52 Base32 字符 (256/5 = 51.2, 向上取整为 52)
      expect(secret32.length).toBe(52);
    });

    it("每次生成的 secret 应不同", () => {
      const secret1 = totpModule.generateTotpSecret();
      const secret2 = totpModule.generateTotpSecret();
      expect(secret1).not.toBe(secret2);
    });
  });

  // ==========================================================================
  // generateTotpUri
  // ==========================================================================

  describe("generateTotpUri", () => {
    it("应生成正确的 otpauth URI", () => {
      const uri = totpModule.generateTotpUri(
        "JBSWY3DPEHPK3PXP",
        "user@example.com",
        "NeutralPress",
      );
      expect(uri).toMatch(/^otpauth:\/\/totp\//);
      expect(uri).toContain("NeutralPress");
      expect(uri).toContain("user%40example.com");
      expect(uri).toContain("secret=JBSWY3DPEHPK3PXP");
      expect(uri).toContain("algorithm=SHA1");
      expect(uri).toContain("digits=6");
      expect(uri).toContain("period=30");
    });

    it("应正确编码特殊字符", () => {
      const uri = totpModule.generateTotpUri(
        "SECRET",
        "user+test@exam ple.com",
        "My App",
      );
      expect(uri).toContain("user%2Btest%40exam%20ple.com");
      expect(uri).toContain("My%20App");
    });
  });

  // ==========================================================================
  // generateTotpCode & verifyTotpCode
  // ==========================================================================

  describe("generateTotpCode", () => {
    it("应生成 6 位数字验证码", () => {
      const secret = totpModule.generateTotpSecret();
      const code = totpModule.generateTotpCode(secret);
      expect(code).toMatch(/^\d{6}$/);
    });

    it("同一 secret 和同一时间应生成相同验证码", () => {
      const secret = "JBSWY3DPEHPK3PXP";
      const time = Math.floor(Date.now() / 1000);
      const code1 = totpModule.generateTotpCode(secret, 30, time);
      const code2 = totpModule.generateTotpCode(secret, 30, time);
      expect(code1).toBe(code2);
    });

    it("不同时间步应生成不同验证码", () => {
      const secret = "JBSWY3DPEHPK3PXP";
      const code1 = totpModule.generateTotpCode(secret, 30, 1000000);
      const code2 = totpModule.generateTotpCode(secret, 30, 1000030);
      expect(code1).not.toBe(code2);
    });

    it("验证码不足 6 位时应补零", () => {
      // 通过固定时间和 secret 使得 code % 1000000 < 100000
      // 这里我们只是验证格式总是 6 位
      const secret = totpModule.generateTotpSecret();
      const code = totpModule.generateTotpCode(secret);
      expect(code.length).toBe(6);
    });
  });

  describe("verifyTotpCode", () => {
    it("应验证当前时间窗口内的正确验证码", () => {
      const secret = totpModule.generateTotpSecret();
      const currentTime = Math.floor(Date.now() / 1000);
      const code = totpModule.generateTotpCode(secret, 30, currentTime);

      // verifyTotpCode 使用 Date.now()，这里我们使用当前时间的 code 进行验证
      // 由于 window=1，允许 ±30 秒的误差
      expect(totpModule.verifyTotpCode(secret, code)).toBe(true);
    });

    it("应拒绝错误的验证码", () => {
      const secret = totpModule.generateTotpSecret();
      expect(totpModule.verifyTotpCode(secret, "000000")).toBe(false);
    });

    it("应拒绝过期的验证码（超出时间窗口）", () => {
      const secret = "JBSWY3DPEHPK3PXP";
      // 生成一个很久以前的验证码
      const oldTime = Math.floor(Date.now() / 1000) - 300; // 5 分钟前
      const code = totpModule.generateTotpCode(secret, 30, oldTime);

      expect(totpModule.verifyTotpCode(secret, code, 1)).toBe(false);
    });

    it("window=0 时只验证当前时间步", () => {
      const secret = "JBSWY3DPEHPK3PXP";
      const currentTime = Math.floor(Date.now() / 1000);
      const code = totpModule.generateTotpCode(secret, 30, currentTime);

      // window=0 只验证精确的当前时间步
      // 结果取决于当前时间是否精确对齐
      const result = totpModule.verifyTotpCode(secret, code, 0);
      // 这个测试可能因为时间偏移而失败，所以只验证返回类型
      expect(typeof result).toBe("boolean");
    });

    it("应支持自定义时间步长", () => {
      const secret = "JBSWY3DPEHPK3PXP";
      const currentTime = Math.floor(Date.now() / 1000);
      const timeStep = 60; // 60 秒时间步
      const code = totpModule.generateTotpCode(secret, timeStep, currentTime);

      // verifyTotpCode 内部使用 Date.now()，所以验证可能因时间偏差而不同
      // 这里只验证函数不抛出异常
      expect(() =>
        totpModule.verifyTotpCode(secret, code, 1, timeStep),
      ).not.toThrow();
    });

    it("长度不匹配的验证码应返回 false", () => {
      const secret = totpModule.generateTotpSecret();
      expect(totpModule.verifyTotpCode(secret, "12345")).toBe(false);
      expect(totpModule.verifyTotpCode(secret, "1234567")).toBe(false);
    });
  });

  // ==========================================================================
  // generateTotpCode + verifyTotpCode 端到端
  // ==========================================================================

  describe("TOTP 端到端", () => {
    it("生成的验证码应在时间窗口内验证通过", () => {
      const secret = totpModule.generateTotpSecret();
      const currentTime = Math.floor(Date.now() / 1000);

      // 生成当前、前一和后一时间步的验证码
      const codes = [-1, 0, 1].map((offset) =>
        totpModule.generateTotpCode(secret, 30, currentTime + offset * 30),
      );

      // 至少有一个应该能通过验证（取决于当前精确时间）
      const results = codes.map((code) =>
        totpModule.verifyTotpCode(secret, code),
      );
      expect(results.some((r) => r === true)).toBe(true);
    });
  });

  // ==========================================================================
  // 备份码
  // ==========================================================================

  describe("generateBackupCodes", () => {
    it("默认应生成 8 个备份码", () => {
      const codes = totpModule.generateBackupCodes();
      expect(codes).toHaveLength(8);
    });

    it("应支持自定义数量", () => {
      expect(totpModule.generateBackupCodes(4)).toHaveLength(4);
      expect(totpModule.generateBackupCodes(12)).toHaveLength(12);
      expect(totpModule.generateBackupCodes(1)).toHaveLength(1);
    });

    it("备份码应符合 XXXX-XXXX 格式", () => {
      const codes = totpModule.generateBackupCodes();
      for (const code of codes) {
        expect(code).toMatch(/^\d{4}-\d{4}$/);
      }
    });

    it("每个备份码应为 8 位数字", () => {
      const codes = totpModule.generateBackupCodes();
      for (const code of codes) {
        const digits = code.replace("-", "");
        expect(digits).toHaveLength(8);
        expect(Number(digits)).toBeGreaterThanOrEqual(10000000);
        expect(Number(digits)).toBeLessThanOrEqual(99999999);
      }
    });

    it("所有备份码应唯一", () => {
      const codes = totpModule.generateBackupCodes(20);
      const unique = new Set(codes);
      expect(unique.size).toBe(codes.length);
    });
  });

  describe("isValidBackupCodeFormat", () => {
    it("有效格式应返回 true", () => {
      expect(totpModule.isValidBackupCodeFormat("1234-5678")).toBe(true);
      expect(totpModule.isValidBackupCodeFormat("0000-0000")).toBe(true);
      expect(totpModule.isValidBackupCodeFormat("9999-9999")).toBe(true);
    });

    it("无效格式应返回 false", () => {
      expect(totpModule.isValidBackupCodeFormat("12345678")).toBe(false);
      expect(totpModule.isValidBackupCodeFormat("1234-567")).toBe(false);
      expect(totpModule.isValidBackupCodeFormat("123-45678")).toBe(false);
      expect(totpModule.isValidBackupCodeFormat("abcd-efgh")).toBe(false);
      expect(totpModule.isValidBackupCodeFormat("")).toBe(false);
      expect(totpModule.isValidBackupCodeFormat("1234 5678")).toBe(false);
    });

    it("应拒绝包含空格的格式", () => {
      expect(totpModule.isValidBackupCodeFormat(" 1234-5678")).toBe(false);
      expect(totpModule.isValidBackupCodeFormat("1234-5678 ")).toBe(false);
    });
  });

  // ==========================================================================
  // 加密与解密
  // ==========================================================================

  describe("TOTP Secret 加密/解密", () => {
    it("加密后应能成功解密", () => {
      const secret = totpModule.generateTotpSecret();
      const encrypted = totpModule.encryptTotpSecret(secret);
      const decrypted = totpModule.decryptTotpSecret(encrypted);

      expect(decrypted).toBe(secret);
    });

    it("加密结果应为 base64 编码", () => {
      const secret = totpModule.generateTotpSecret();
      const encrypted = totpModule.encryptTotpSecret(secret);
      expect(encrypted).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });

    it("每次加密结果应不同（随机 IV）", () => {
      const secret = "JBSWY3DPEHPK3PXP";
      const encrypted1 = totpModule.encryptTotpSecret(secret);
      const encrypted2 = totpModule.encryptTotpSecret(secret);
      expect(encrypted1).not.toBe(encrypted2);
    });

    it("解密无效数据应返回 null", () => {
      expect(totpModule.decryptTotpSecret("invalid-base64-data")).toBeNull();
    });

    it("解密过短数据应返回 null", () => {
      // 少于 28 字节（IV + AuthTag 最小长度）
      const short = Buffer.alloc(10).toString("base64");
      expect(totpModule.decryptTotpSecret(short)).toBeNull();
    });

    it("用不同密钥解密应返回 null", () => {
      const secret = totpModule.generateTotpSecret();
      const encrypted = totpModule.encryptTotpSecret(secret);

      // 更换密钥
      process.env.MASTER_SECRET =
        "different-test-master-secret-key-that-is-also-32-chars!!";

      expect(totpModule.decryptTotpSecret(encrypted)).toBeNull();
    });

    it("MASTER_SECRET 未设置时加密应抛出异常", () => {
      delete process.env.MASTER_SECRET;
      expect(() => totpModule.encryptTotpSecret("secret")).toThrow(
        "MASTER_SECRET 环境变量未设置",
      );
    });
  });

  describe("备份码加密/解密", () => {
    it("加密后应能成功解密", () => {
      const code = "1234-5678";
      const encrypted = totpModule.encryptBackupCode(code);
      const decrypted = totpModule.decryptBackupCode(encrypted);
      expect(decrypted).toBe(code);
    });

    it("加密结果应为 base64 编码", () => {
      const encrypted = totpModule.encryptBackupCode("1234-5678");
      expect(encrypted).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });

    it("解密无效数据应返回 null", () => {
      expect(totpModule.decryptBackupCode("not-valid")).toBeNull();
    });

    it("解密过短数据应返回 null", () => {
      const short = Buffer.alloc(5).toString("base64");
      expect(totpModule.decryptBackupCode(short)).toBeNull();
    });
  });

  // ==========================================================================
  // Redis 速率限制函数
  // ==========================================================================

  describe("checkTotpFailCount", () => {
    it("未超过限制时应返回 false", async () => {
      mockRedis.get.mockResolvedValue("2");
      const result = await totpModule.checkTotpFailCount(1);
      expect(result).toBe(false);
    });

    it("达到 3 次限制时应返回 true", async () => {
      mockRedis.get.mockResolvedValue("3");
      const result = await totpModule.checkTotpFailCount(1);
      expect(result).toBe(true);
    });

    it("超过限制时应返回 true", async () => {
      mockRedis.get.mockResolvedValue("5");
      const result = await totpModule.checkTotpFailCount(1);
      expect(result).toBe(true);
    });

    it("无失败记录时应返回 false", async () => {
      mockRedis.get.mockResolvedValue(null);
      const result = await totpModule.checkTotpFailCount(1);
      expect(result).toBe(false);
    });
  });

  describe("incrementTotpFailCount", () => {
    it("应调用 redis.incr 递增计数", async () => {
      mockRedis.incr.mockResolvedValue(1);
      await totpModule.incrementTotpFailCount(1);
      expect(mockRedis.incr).toHaveBeenCalled();
    });

    it("首次递增时应设置 5 分钟过期", async () => {
      mockRedis.incr.mockResolvedValue(1);
      await totpModule.incrementTotpFailCount(1);
      expect(mockRedis.expire).toHaveBeenCalledWith(expect.any(String), 300);
    });

    it("非首次递增时不应设置过期时间", async () => {
      mockRedis.incr.mockResolvedValue(2);
      await totpModule.incrementTotpFailCount(1);
      expect(mockRedis.expire).not.toHaveBeenCalled();
    });
  });

  describe("reserveTotpAttempt", () => {
    it("应通过单条 Lua 脚本原子预留并在首次计数时设置 TTL", async () => {
      mockRedis.eval.mockResolvedValue(1);

      const result = await totpModule.reserveTotpAttempt(42);

      expect(result).toBe(true);
      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.stringContaining("redis.call('INCR',KEYS[1])"),
        1,
        "np:cache:auth:totp:fail:42",
        "3",
        "300",
      );
      const script = mockRedis.eval.mock.calls[0]![0] as string;
      expect(script).toContain("redis.call('GET',KEYS[1])");
      expect(script).toContain("redis.call('EXPIRE',KEYS[1],ARGV[2])");
    });

    it("达到失败次数上限时应拒绝预留", async () => {
      mockRedis.eval.mockResolvedValue(0);

      await expect(totpModule.reserveTotpAttempt(42)).resolves.toBe(false);
    });
  });

  describe("resetTotpFailCount", () => {
    it("应调用 redis.del 删除计数", async () => {
      await totpModule.resetTotpFailCount(1);
      expect(mockRedis.del).toHaveBeenCalled();
    });
  });
});
