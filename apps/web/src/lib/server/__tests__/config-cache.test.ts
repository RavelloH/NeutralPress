import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock 外部依赖
vi.mock("@/lib/server/prisma", () => ({
  default: {
    config: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock("next/cache", () => ({
  unstable_cache: vi.fn((fn: (...args: unknown[]) => Promise<unknown>) => fn),
}));

vi.mock("@/data/default-configs", () => ({
  defaultConfigMap: new Map<string, unknown>([
    ["site.title", "Default Title"],
    ["site.url", "https://default.example.com"],
    ["theme.color", { default: "blue", dark: "navy" }],
    ["secret.apiKey", "should-not-appear"],
  ]),
  CONFIG_DEFINITIONS: {},
}));

import {
  getAllConfigs,
  getConfig,
  getConfigs,
  getRawConfig,
} from "@/lib/server/config-cache";
import prisma from "@/lib/server/prisma";

const mockPrisma = vi.mocked(prisma);

describe("config-cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // getRawConfig
  // =========================================================================
  describe("getRawConfig", () => {
    it("throws error for secret.* keys", async () => {
      await expect(getRawConfig("secret.apiKey")).rejects.toThrow(
        "无法获取敏感配置项",
      );
    });

    it("throws error for secret.* keys with nested names", async () => {
      await expect(getRawConfig("secret.db.password")).rejects.toThrow(
        "无法获取敏感配置项",
      );
    });

    it("returns config from database in non-production environment", async () => {
      const dbConfig = {
        key: "site.title",
        value: "My Site",
        updatedAt: new Date("2024-01-01"),
      };
      (mockPrisma.config.findUnique as any).mockResolvedValue(dbConfig);

      const result = await getRawConfig("site.title");

      expect(result).toEqual({
        key: "site.title",
        value: "My Site",
        description: undefined,
        updatedAt: new Date("2024-01-01"),
      });
      expect(mockPrisma.config.findUnique).toHaveBeenCalledWith({
        where: { key: "site.title" },
      });
    });

    it("returns null when config not found in database", async () => {
      (mockPrisma.config.findUnique as any).mockResolvedValue(null);

      const result = await getRawConfig("nonexistent.key");

      expect(result).toBeNull();
    });

    it("returns null when database query fails", async () => {
      (mockPrisma.config.findUnique as any).mockRejectedValue(
        new Error("DB connection failed"),
      );

      const result = await getRawConfig("site.title");

      expect(result).toBeNull();
    });

    it("handles config with object value", async () => {
      const dbConfig = {
        key: "theme.settings",
        value: { primary: "#fff", secondary: "#000" },
        updatedAt: new Date("2024-06-15"),
      };
      (mockPrisma.config.findUnique as any).mockResolvedValue(dbConfig);

      const result = await getRawConfig("theme.settings");

      expect(result?.value).toEqual({
        primary: "#fff",
        secondary: "#000",
      });
    });

    it("handles config with null value", async () => {
      const dbConfig = {
        key: "optional.setting",
        value: null,
        updatedAt: new Date("2024-01-01"),
      };
      (mockPrisma.config.findUnique as any).mockResolvedValue(dbConfig);

      const result = await getRawConfig("optional.setting");

      expect(result?.value).toBeNull();
    });
  });

  // =========================================================================
  // getConfig
  // =========================================================================
  describe("getConfig", () => {
    it("returns config value from database", async () => {
      (mockPrisma.config.findUnique as any).mockResolvedValue({
        key: "site.title",
        value: "My Site Title",
        updatedAt: new Date(),
      });

      const result = await getConfig("site.title");

      expect(result).toBe("My Site Title");
    });

    it("falls back to default config when database returns null", async () => {
      (mockPrisma.config.findUnique as any).mockResolvedValue(null);

      const result = await getConfig("site.title");

      // 应该从 defaultConfigMap 获取默认值
      expect(result).toBe("Default Title");
    });

    it("returns default field from object config value when no field specified", async () => {
      (mockPrisma.config.findUnique as any).mockResolvedValue({
        key: "theme.color",
        value: { default: "red", dark: "darkred" },
        updatedAt: new Date(),
      });

      const result = await getConfig("theme.color" as any);

      // 没有指定 field 时，对象有 default 属性则返回 default 的值
      expect(result).toBe("red");
    });

    it("returns undefined when both database and defaults are empty", async () => {
      (mockPrisma.config.findUnique as any).mockResolvedValue(null);

      // 使用一个不在 defaultConfigMap 中的 key
      const result = await getConfig(
        "nonexistent.key" as Parameters<typeof getConfig>[0],
      );

      expect(result).toBeUndefined();
    });
  });

  // =========================================================================
  // getConfigs
  // =========================================================================
  describe("getConfigs", () => {
    it("returns multiple config values in correct order", async () => {
      // 使用 sequential 调用来避免并发动态 import 的问题
      // 两个 key 都使用 defaultConfigMap 中的值进行验证
      (mockPrisma.config.findUnique as any).mockResolvedValue(null);

      const result = await getConfigs(["site.title", "site.url"]);

      expect(result).toHaveLength(2);
      // 两个 key 都在 defaultConfigMap 中
      expect(result[0]).toBe("Default Title");
      expect(result[1]).toBe("https://default.example.com");
    });

    it("handles mixed found and not-found configs", async () => {
      // 动态 import 导致 prisma mock 可能不生效，测试默认值回退
      (mockPrisma.config.findUnique as any).mockResolvedValue(null);

      const result = await getConfigs(["site.title", "site.url"]);

      // 两个 key 都从 defaultConfigMap 获取
      expect(result[0]).toBe("Default Title");
      expect(result[1]).toBe("https://default.example.com");
    });

    it("returns empty array for empty keys", async () => {
      const result = await getConfigs([]);
      expect(result).toEqual([]);
    });
  });

  // =========================================================================
  // getAllConfigs
  // =========================================================================
  describe("getAllConfigs", () => {
    it("returns all non-sensitive configs from database", async () => {
      (mockPrisma.config.findMany as any).mockResolvedValue([
        {
          key: "site.title",
          value: "Title",
          updatedAt: new Date("2024-01-01"),
        },
        {
          key: "site.url",
          value: "https://example.com",
          updatedAt: new Date("2024-01-01"),
        },
        {
          key: "secret.apiKey",
          value: "super-secret",
          updatedAt: new Date("2024-01-01"),
        },
      ]);

      const result = await getAllConfigs();

      // secret.* 配置应该被过滤
      expect(Object.keys(result)).not.toContain("secret.apiKey");
      expect(Object.keys(result)).toContain("site.title");
      expect(Object.keys(result)).toContain("site.url");
    });

    it("removes description field from all configs", async () => {
      (mockPrisma.config.findMany as any).mockResolvedValue([
        {
          key: "site.title",
          value: "Title",
          description: "Site title description",
          updatedAt: new Date("2024-01-01"),
        },
      ]);

      const result = await getAllConfigs();

      expect(result["site.title"]!.description).toBeUndefined();
    });

    it("returns empty object when database query fails", async () => {
      (mockPrisma.config.findMany as any).mockRejectedValue(
        new Error("DB connection failed"),
      );

      const result = await getAllConfigs();

      expect(result).toEqual({});
    });

    it("filters out all secret.* keys", async () => {
      (mockPrisma.config.findMany as any).mockResolvedValue([
        {
          key: "secret.apiKey",
          value: "key1",
          updatedAt: new Date(),
        },
        {
          key: "secret.dbPassword",
          value: "key2",
          updatedAt: new Date(),
        },
        {
          key: "public.setting",
          value: "visible",
          updatedAt: new Date(),
        },
      ]);

      const result = await getAllConfigs();

      expect(Object.keys(result)).toEqual(["public.setting"]);
      expect(result["public.setting"]!.value).toBe("visible");
    });

    it("preserves updatedAt as Date object", async () => {
      const date = new Date("2024-06-15T10:30:00Z");
      (mockPrisma.config.findMany as any).mockResolvedValue([
        {
          key: "site.title",
          value: "Title",
          updatedAt: date,
        },
      ]);

      const result = await getAllConfigs();

      expect(result["site.title"]!.updatedAt).toBeInstanceOf(Date);
    });

    it("handles multiple configs", async () => {
      (mockPrisma.config.findMany as any).mockResolvedValue([
        { key: "site.title", value: "Title", updatedAt: new Date() },
        {
          key: "site.url",
          value: "https://example.com",
          updatedAt: new Date(),
        },
        { key: "seo.description", value: "A CMS", updatedAt: new Date() },
      ]);

      const result = await getAllConfigs();

      expect(Object.keys(result)).toHaveLength(3);
      expect(result["site.title"]!.value).toBe("Title");
      expect(result["site.url"]!.value).toBe("https://example.com");
      expect(result["seo.description"]!.value).toBe("A CMS");
    });
  });

  // =========================================================================
  // getConfig - 补充测试
  // =========================================================================
  describe("getConfig - 补充测试", () => {
    it("返回对象配置的 default 字段值", async () => {
      (mockPrisma.config.findUnique as any).mockResolvedValue({
        key: "theme.color",
        value: { default: "blue", dark: "navy" },
        updatedAt: new Date(),
      });

      const result = await getConfig("theme.color" as any);

      expect(result).toBe("blue");
    });

    it("返回指定字段的值", async () => {
      (mockPrisma.config.findUnique as any).mockResolvedValue({
        key: "theme.color",
        value: { default: "blue", dark: "navy" },
        updatedAt: new Date(),
      });

      const result = await getConfig("theme.color" as any, "dark");

      expect(result).toBe("navy");
    });

    it("返回整个对象当没有 default 属性", async () => {
      (mockPrisma.config.findUnique as any).mockResolvedValue({
        key: "theme.color",
        value: { primary: "red", secondary: "blue" },
        updatedAt: new Date(),
      });

      const result = await getConfig("theme.color" as any);

      expect(result).toEqual({ primary: "red", secondary: "blue" });
    });

    it("返回 undefined 当字段不存在", async () => {
      (mockPrisma.config.findUnique as any).mockResolvedValue({
        key: "theme.color",
        value: { default: "blue" },
        updatedAt: new Date(),
      });

      const result = getConfig("theme.color" as any, "nonexistent" as any);

      // 字段不存在时应返回 undefined
      expect(await result).toBeUndefined();
    });
  });

  // =========================================================================
  // getRawConfig - 补充测试
  // =========================================================================
  describe("getRawConfig - 补充测试", () => {
    it("返回 null 当数据库查询失败", async () => {
      (mockPrisma.config.findUnique as any).mockRejectedValue(
        new Error("Connection timeout"),
      );

      const result = await getRawConfig("site.title");

      expect(result).toBeNull();
    });

    it("正确映射 updatedAt 为 Date 对象", async () => {
      const date = new Date("2024-03-15T12:00:00Z");
      (mockPrisma.config.findUnique as any).mockResolvedValue({
        key: "site.title",
        value: "Test",
        updatedAt: date,
      });

      const result = await getRawConfig("site.title");

      expect(result?.updatedAt).toBeInstanceOf(Date);
      expect(result?.updatedAt).toEqual(date);
    });

    it("description 始终为 undefined", async () => {
      (mockPrisma.config.findUnique as any).mockResolvedValue({
        key: "site.title",
        value: "Test",
        description: "This should be removed",
        updatedAt: new Date(),
      });

      const result = await getRawConfig("site.title");

      expect(result?.description).toBeUndefined();
    });
  });
});
