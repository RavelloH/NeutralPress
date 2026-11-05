import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/prisma", () => ({
  default: {
    config: { findUnique: vi.fn(), findMany: vi.fn() },
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

describe("config-cache expanded", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getRawConfig", () => {
    it("secret.* 键抛出错误", async () => {
      await expect(getRawConfig("secret.apiKey")).rejects.toThrow(
        "无法获取敏感配置项",
      );
    });

    it("secret.* 嵌套键抛出错误", async () => {
      await expect(getRawConfig("secret.db.password")).rejects.toThrow(
        "无法获取敏感配置项",
      );
    });

    it("从数据库返回配置", async () => {
      (mockPrisma.config.findUnique as any).mockResolvedValue({
        key: "site.title",
        value: "My Site",
        updatedAt: new Date("2024-01-01"),
      });
      const result = await getRawConfig("site.title");
      expect(result).toEqual({
        key: "site.title",
        value: "My Site",
        description: undefined,
        updatedAt: new Date("2024-01-01"),
      });
    });

    it("配置不存在时返回 null", async () => {
      (mockPrisma.config.findUnique as any).mockResolvedValue(null);
      const result = await getRawConfig("nonexistent.key");
      expect(result).toBeNull();
    });

    it("数据库查询失败时返回 null", async () => {
      (mockPrisma.config.findUnique as any).mockRejectedValue(
        new Error("DB connection failed"),
      );
      const result = await getRawConfig("site.title");
      expect(result).toBeNull();
    });

    it("处理对象类型的配置值", async () => {
      (mockPrisma.config.findUnique as any).mockResolvedValue({
        key: "theme.settings",
        value: { primary: "#fff", secondary: "#000" },
        updatedAt: new Date("2024-06-15"),
      });
      const result = await getRawConfig("theme.settings");
      expect(result?.value).toEqual({ primary: "#fff", secondary: "#000" });
    });

    it("处理 null 配置值", async () => {
      (mockPrisma.config.findUnique as any).mockResolvedValue({
        key: "optional.setting",
        value: null,
        updatedAt: new Date("2024-01-01"),
      });
      const result = await getRawConfig("optional.setting");
      expect(result?.value).toBeNull();
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

    it("updatedAt 正确映射为 Date 对象", async () => {
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
  });

  describe("getConfig", () => {
    it("从数据库返回配置值", async () => {
      (mockPrisma.config.findUnique as any).mockResolvedValue({
        key: "site.title",
        value: "My Site Title",
        updatedAt: new Date(),
      });
      const result = await getConfig("site.title");
      expect(result).toBe("My Site Title");
    });

    it("数据库返回 null 时回退到默认配置", async () => {
      (mockPrisma.config.findUnique as any).mockResolvedValue(null);
      const result = await getConfig("site.title");
      expect(result).toBe("Default Title");
    });

    it("没有指定 field 时返回对象的 default 属性", async () => {
      (mockPrisma.config.findUnique as any).mockResolvedValue({
        key: "theme.color",
        value: { default: "red", dark: "darkred" },
        updatedAt: new Date(),
      });
      const result = await getConfig("theme.color" as any);
      expect(result).toBe("red");
    });

    it("数据库和默认值都没有时返回 undefined", async () => {
      (mockPrisma.config.findUnique as any).mockResolvedValue(null);
      const result = await getConfig(
        "nonexistent.key" as Parameters<typeof getConfig>[0],
      );
      expect(result).toBeUndefined();
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

    it("字段不存在时返回 undefined", async () => {
      (mockPrisma.config.findUnique as any).mockResolvedValue({
        key: "theme.color",
        value: { default: "blue" },
        updatedAt: new Date(),
      });
      const result = await getConfig(
        "theme.color" as any,
        "nonexistent" as any,
      );
      expect(await result).toBeUndefined();
    });
  });

  describe("getConfigs", () => {
    it("返回多个配置值", async () => {
      (mockPrisma.config.findUnique as any).mockResolvedValue(null);
      const result = await getConfigs(["site.title", "site.url"]);
      expect(result).toHaveLength(2);
      expect(result[0]).toBe("Default Title");
      expect(result[1]).toBe("https://default.example.com");
    });

    it("处理混合存在和不存在的配置", async () => {
      (mockPrisma.config.findUnique as any).mockResolvedValue(null);
      const result = await getConfigs(["site.title", "site.url"]);
      expect(result[0]).toBe("Default Title");
      expect(result[1]).toBe("https://default.example.com");
    });

    it("空键数组返回空数组", async () => {
      const result = await getConfigs([]);
      expect(result).toEqual([]);
    });
  });

  describe("getAllConfigs", () => {
    it("返回所有非敏感配置", async () => {
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
      expect(Object.keys(result)).not.toContain("secret.apiKey");
      expect(Object.keys(result)).toContain("site.title");
      expect(Object.keys(result)).toContain("site.url");
    });

    it("移除 description 字段", async () => {
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

    it("数据库查询失败时返回空对象", async () => {
      (mockPrisma.config.findMany as any).mockRejectedValue(
        new Error("DB connection failed"),
      );
      const result = await getAllConfigs();
      expect(result).toEqual({});
    });

    it("过滤所有 secret.* 键", async () => {
      (mockPrisma.config.findMany as any).mockResolvedValue([
        { key: "secret.apiKey", value: "key1", updatedAt: new Date() },
        { key: "secret.dbPassword", value: "key2", updatedAt: new Date() },
        { key: "public.setting", value: "visible", updatedAt: new Date() },
      ]);
      const result = await getAllConfigs();
      expect(Object.keys(result)).toEqual(["public.setting"]);
      expect(result["public.setting"]!.value).toBe("visible");
    });

    it("保留 updatedAt 为 Date 对象", async () => {
      const date = new Date("2024-06-15T10:30:00Z");
      (mockPrisma.config.findMany as any).mockResolvedValue([
        { key: "site.title", value: "Title", updatedAt: date },
      ]);
      const result = await getAllConfigs();
      expect(result["site.title"]!.updatedAt).toBeInstanceOf(Date);
    });

    it("处理多个配置", async () => {
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
});
