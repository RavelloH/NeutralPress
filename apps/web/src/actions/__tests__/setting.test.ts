import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("next/headers", () => ({
  headers: vi.fn(() => new Headers()),
}));

vi.mock("@/lib/server/auth-verify", () => ({
  authVerify: vi.fn(),
}));

vi.mock("@/lib/server/rate-limit", () => ({
  default: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  default: {
    config: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/server/response", () => {
  class MockResponseBuilder {
    ok(opts?: unknown) {
      return { success: true, ...(opts as Record<string, unknown>) };
    }
    badRequest(opts?: unknown) {
      return {
        success: false,
        status: 400,
        ...(opts as Record<string, unknown>),
      };
    }
    unauthorized() {
      return { success: false, status: 401, message: "未授权访问" };
    }
    tooManyRequests() {
      return { success: false, status: 429, message: "请求过于频繁" };
    }
    serverError() {
      return { success: false, status: 500, message: "服务器内部错误" };
    }
  }
  return { default: MockResponseBuilder };
});

vi.mock("@/lib/server/validator", () => ({
  validateData: vi.fn(),
}));

vi.mock("@/lib/server/audit", () => ({
  logAuditEvent: vi.fn(),
}));

vi.mock("next/cache", () => ({
  updateTag: vi.fn(),
}));
vi.mock("@/lib/server/isr-invalidation", () => ({ expireCacheTag: vi.fn() }));

vi.mock("@/actions/cloud", () => ({
  syncCloudNow: vi.fn(),
}));

vi.mock("@/data/default-configs", () => ({
  getConfigDefinition: vi.fn(),
  extractDefaultValue: vi.fn((v: unknown) => v),
  extractOptions: vi.fn(() => null),
  extractValidationRules: vi.fn(() => null),
}));

vi.mock("next/server", () => ({
  after: vi.fn((fn: () => void) => fn()),
}));

// ── Imports ──────────────────────────────────────────────────────────────────

import { authVerify } from "@/lib/server/auth-verify";
import prisma from "@/lib/server/prisma";
import limitControl from "@/lib/server/rate-limit";
import { validateData } from "@/lib/server/validator";

const mockLimitControl = vi.mocked(limitControl);
const mockValidateData = vi.mocked(validateData);
const mockAuthVerify = vi.mocked(authVerify);

// ── Helpers ──────────────────────────────────────────────────────────────────

function setupSuccessMocks() {
  mockLimitControl.mockResolvedValue(true as never);
  mockValidateData.mockReturnValue(null as never);
  mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" } as never);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("setting actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getSettings", () => {
    it("返回配置列表 - 成功路径", async () => {
      setupSuccessMocks();
      vi.mocked(prisma.config.findMany).mockResolvedValue([
        {
          key: "site.title",
          value: { default: "Test" },
          createdAt: new Date("2025-01-01"),
          updatedAt: new Date("2025-01-01"),
        },
      ] as never);

      const { getSettings } = await import("@/actions/setting");
      const result = await getSettings({ access_token: "valid-token" });

      // 如果返回 500，打印结果帮助调试
      if (!(result as Record<string, unknown>).success) {
        console.error("getSettings failed:", JSON.stringify(result, null, 2));
      }

      expect(result).toEqual(expect.objectContaining({ success: true }));
    });

    it("速率限制触发时返回 429", async () => {
      mockLimitControl.mockResolvedValue(false as never);

      const { getSettings } = await import("@/actions/setting");
      const result = await getSettings({ access_token: "valid-token" });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 429 }),
      );
    });

    it("未授权用户返回 401", async () => {
      mockLimitControl.mockResolvedValue(true as never);
      mockValidateData.mockReturnValue(null as never);
      mockAuthVerify.mockResolvedValue(null as never);

      const { getSettings } = await import("@/actions/setting");
      const result = await getSettings({ access_token: "invalid-token" });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 401 }),
      );
    });

    it("数据库错误时返回 500", async () => {
      setupSuccessMocks();
      vi.mocked(prisma.config.findMany).mockRejectedValue(
        new Error("DB error"),
      );

      const { getSettings } = await import("@/actions/setting");
      const result = await getSettings({ access_token: "valid-token" });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 500 }),
      );
    });
  });

  describe("updateSettings", () => {
    it("未知配置项返回 400", async () => {
      setupSuccessMocks();
      const { getConfigDefinition } = await import("@/data/default-configs");
      vi.mocked(getConfigDefinition).mockReturnValue(null as never);

      const { updateSettings } = await import("@/actions/setting");
      const result = await updateSettings({
        access_token: "valid-token",
        settings: [{ key: "unknown.key", value: "test" }],
      });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 400 }),
      );
    });

    it("未授权用户返回 401", async () => {
      mockLimitControl.mockResolvedValue(true as never);
      mockValidateData.mockReturnValue(null as never);
      mockAuthVerify.mockResolvedValue(null as never);

      const { updateSettings } = await import("@/actions/setting");
      const result = await updateSettings({
        access_token: "invalid",
        settings: [{ key: "site.title", value: "test" }],
      });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 401 }),
      );
    });

    it("速率限制触发时返回 429", async () => {
      mockLimitControl.mockResolvedValue(false as never);

      const { updateSettings } = await import("@/actions/setting");
      const result = await updateSettings({
        access_token: "valid-token",
        settings: [{ key: "site.title", value: "test" }],
      });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 429 }),
      );
    });

    it("数据库错误时返回失败", async () => {
      setupSuccessMocks();
      const { getConfigDefinition } = await import("@/data/default-configs");
      vi.mocked(getConfigDefinition).mockReturnValue({
        type: "string",
        default: "old",
      } as never);
      vi.mocked(prisma.$transaction).mockRejectedValue(new Error("DB error"));

      const { updateSettings } = await import("@/actions/setting");
      const result = await updateSettings({
        access_token: "valid-token",
        settings: [{ key: "site.title", value: "New Title" }],
      });

      // 可能返回 400（验证错误）或 500（服务器错误），但必定失败
      expect(result).toEqual(expect.objectContaining({ success: false }));
    });
  });

  describe("getSettings 补充测试", () => {
    it("返回空配置列表时应正常工作", async () => {
      setupSuccessMocks();
      vi.mocked(prisma.config.findMany).mockResolvedValue([] as never);

      const { getSettings } = await import("@/actions/setting");
      const result = await getSettings({ access_token: "valid-token" });

      expect(result).toEqual(expect.objectContaining({ success: true }));
    });

    it("返回多个配置项", async () => {
      setupSuccessMocks();
      vi.mocked(prisma.config.findMany).mockResolvedValue([
        {
          key: "site.title",
          value: { default: "Title" },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          key: "site.url",
          value: { default: "https://example.com" },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as never);

      const { getSettings } = await import("@/actions/setting");
      const result = await getSettings({ access_token: "valid-token" });

      expect(result).toEqual(expect.objectContaining({ success: true }));
    });
  });

  // ==================== updateSettings 补充测试 ====================

  describe("updateSettings 补充测试", () => {
    it("成功更新配置项", async () => {
      setupSuccessMocks();
      const { getConfigDefinition } = await import("@/data/default-configs");
      vi.mocked(getConfigDefinition).mockReturnValue({
        type: "string",
        default: "old",
      } as never);
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) =>
        fn(prisma),
      );

      const { updateSettings } = await import("@/actions/setting");
      const result = await updateSettings({
        access_token: "valid-token",
        settings: [{ key: "site.title", value: { default: "New Title" } }],
      });

      expect(result).toEqual(expect.objectContaining({ success: true }));
    });

    it("非管理员应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);
      const { updateSettings } = await import("@/actions/setting");
      const result = await updateSettings({
        access_token: "invalid-token",
        settings: [{ key: "site.title", value: { default: "New Title" } }],
      });

      expect(result).toEqual(expect.objectContaining({ success: false }));
    });
  });

  describe("getSettings 补充测试 2", () => {
    it("非管理员应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);
      const { getSettings } = await import("@/actions/setting");
      const result = await getSettings({
        access_token: "invalid-token",
      });

      expect(result).toEqual(expect.objectContaining({ success: false }));
    });
  });

  describe("updateSettings 补充测试 2", () => {
    it("数据库错误时返回失败", async () => {
      setupSuccessMocks();
      const { getConfigDefinition } = await import("@/data/default-configs");
      vi.mocked(getConfigDefinition).mockReturnValue({
        type: "string",
        default: "old",
      } as never);
      vi.mocked(prisma.$transaction).mockRejectedValue(new Error("DB error"));

      const { updateSettings } = await import("@/actions/setting");
      const result = await updateSettings({
        access_token: "valid-token",
        settings: [{ key: "site.title", value: { default: "New Title" } }],
      });

      expect(result).toEqual(expect.objectContaining({ success: false }));
    });

    it("未知配置项返回 400", async () => {
      setupSuccessMocks();
      const { getConfigDefinition } = await import("@/data/default-configs");
      vi.mocked(getConfigDefinition).mockReturnValue(null as any);

      const { updateSettings } = await import("@/actions/setting");
      const result = await updateSettings({
        access_token: "valid-token",
        settings: [{ key: "unknown.key", value: { default: "value" } }],
      });

      expect(result).toEqual(expect.objectContaining({ success: false }));
    });
  });

  describe("getSettings 补充测试 3", () => {
    it("数据库错误时返回 500", async () => {
      setupSuccessMocks();
      vi.mocked(prisma.config.findMany).mockRejectedValue(
        new Error("DB error"),
      );

      const { getSettings } = await import("@/actions/setting");
      const result = await getSettings({
        access_token: "valid-token",
      });

      expect(result).toEqual(expect.objectContaining({ success: false }));
    });
  });

  describe("updateSettings 补充测试 3", () => {
    it("非管理员应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);
      const { updateSettings } = await import("@/actions/setting");
      const result = await updateSettings({
        access_token: "invalid-token",
        settings: [{ key: "site.title", value: { default: "New Title" } }],
      });

      expect(result).toEqual(expect.objectContaining({ success: false }));
    });
  });

  describe("getSettings 补充测试 4", () => {
    it("速率限制时返回失败", async () => {
      mockLimitControl.mockResolvedValue(false as never);
      const { getSettings } = await import("@/actions/setting");
      const result = await getSettings({
        access_token: "valid-token",
      });

      expect(result).toEqual(expect.objectContaining({ success: false }));
    });
  });

  describe("updateSettings 补充测试 4", () => {
    it("速率限制时返回失败", async () => {
      mockLimitControl.mockResolvedValue(false as never);
      const { updateSettings } = await import("@/actions/setting");
      const result = await updateSettings({
        access_token: "valid-token",
        settings: [{ key: "site.title", value: { default: "New Title" } }],
      });

      expect(result).toEqual(expect.objectContaining({ success: false }));
    });
  });

  // ===== 分支覆盖补充测试 =====

  describe("updateSettings 验证分支", () => {
    it("options 值不在允许列表中返回 400", async () => {
      setupSuccessMocks();
      const {
        getConfigDefinition,
        extractOptions,
        extractDefaultValue,
        extractValidationRules,
      } = await import("@/data/default-configs");
      vi.mocked(getConfigDefinition).mockReturnValue({
        type: "string",
        default: "a",
      } as never);
      vi.mocked(extractOptions).mockReturnValue([
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ] as never);
      // extractDefaultValue 被调用两次: setting.value 和 configDef
      vi.mocked(extractDefaultValue)
        .mockReturnValueOnce("invalid") // newValue from setting.value
        .mockReturnValueOnce("a"); // defaultValue from configDef
      vi.mocked(extractValidationRules).mockReturnValue(undefined);

      const { updateSettings } = await import("@/actions/setting");
      const result = await updateSettings({
        access_token: "valid-token",
        settings: [{ key: "test.key", value: { default: "invalid" } }],
      });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 400 }),
      );
    });

    it("options 值在允许列表中通过验证", async () => {
      setupSuccessMocks();
      const {
        getConfigDefinition,
        extractOptions,
        extractDefaultValue,
        extractValidationRules,
      } = await import("@/data/default-configs");
      vi.mocked(getConfigDefinition).mockReturnValue({
        type: "string",
        default: "a",
      } as never);
      vi.mocked(extractOptions).mockReturnValue([
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ] as never);
      vi.mocked(extractDefaultValue)
        .mockReturnValueOnce("b") // newValue from setting.value
        .mockReturnValueOnce("a"); // defaultValue from configDef
      vi.mocked(extractValidationRules).mockReturnValue(undefined);
      vi.mocked(prisma.config.findMany).mockResolvedValue([]);
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const tx = {
          config: { upsert: vi.fn().mockResolvedValue({ key: "test.key" }) },
        };
        return (fn as (tx: unknown) => Promise<unknown>)(tx);
      });

      const { updateSettings } = await import("@/actions/setting");
      const result = await updateSettings({
        access_token: "valid-token",
        settings: [{ key: "test.key", value: { default: "b" } }],
      });

      expect(result).toEqual(expect.objectContaining({ success: true }));
    });

    it("数组类型期望但非数组值返回 400", async () => {
      setupSuccessMocks();
      const {
        getConfigDefinition,
        extractOptions,
        extractDefaultValue,
        extractValidationRules,
      } = await import("@/data/default-configs");
      vi.mocked(getConfigDefinition).mockReturnValue({
        type: "object",
        default: ["a", "b"],
      } as never);
      vi.mocked(extractOptions).mockReturnValue(undefined);
      vi.mocked(extractDefaultValue)
        .mockReturnValueOnce("not-array") // newValue
        .mockReturnValueOnce(["a", "b"]); // defaultValue
      vi.mocked(extractValidationRules).mockReturnValue(undefined);

      const { updateSettings } = await import("@/actions/setting");
      const result = await updateSettings({
        access_token: "valid-token",
        settings: [{ key: "test.key", value: { default: "not-array" } }],
      });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 400 }),
      );
    });

    it("数组元素类型不匹配返回 400", async () => {
      setupSuccessMocks();
      const {
        getConfigDefinition,
        extractOptions,
        extractDefaultValue,
        extractValidationRules,
      } = await import("@/data/default-configs");
      vi.mocked(getConfigDefinition).mockReturnValue({
        type: "object",
        default: [1, 2, 3],
      } as never);
      vi.mocked(extractOptions).mockReturnValue(undefined);
      vi.mocked(extractDefaultValue)
        .mockReturnValueOnce(["a", "b"]) // newValue
        .mockReturnValueOnce([1, 2, 3]); // defaultValue
      vi.mocked(extractValidationRules).mockReturnValue(undefined);

      const { updateSettings } = await import("@/actions/setting");
      const result = await updateSettings({
        access_token: "valid-token",
        settings: [{ key: "test.key", value: { default: ["a", "b"] } }],
      });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 400 }),
      );
    });

    it("对象类型期望但非对象值返回 400", async () => {
      setupSuccessMocks();
      const {
        getConfigDefinition,
        extractOptions,
        extractDefaultValue,
        extractValidationRules,
      } = await import("@/data/default-configs");
      vi.mocked(getConfigDefinition).mockReturnValue({
        type: "object",
        default: { foo: "bar" },
      } as never);
      vi.mocked(extractOptions).mockReturnValue(undefined);
      vi.mocked(extractDefaultValue)
        .mockReturnValueOnce("not-object") // newValue
        .mockReturnValueOnce({ foo: "bar" }); // defaultValue
      vi.mocked(extractValidationRules).mockReturnValue(undefined);

      const { updateSettings } = await import("@/actions/setting");
      const result = await updateSettings({
        access_token: "valid-token",
        settings: [{ key: "test.key", value: { default: "not-object" } }],
      });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 400 }),
      );
    });

    it("基本类型不匹配返回 400", async () => {
      setupSuccessMocks();
      const {
        getConfigDefinition,
        extractOptions,
        extractDefaultValue,
        extractValidationRules,
      } = await import("@/data/default-configs");
      vi.mocked(getConfigDefinition).mockReturnValue({
        type: "number",
        default: 42,
      } as never);
      vi.mocked(extractOptions).mockReturnValue(undefined);
      vi.mocked(extractDefaultValue)
        .mockReturnValueOnce("not-number") // newValue (string)
        .mockReturnValueOnce(42); // defaultValue (number)
      vi.mocked(extractValidationRules).mockReturnValue(undefined);

      const { updateSettings } = await import("@/actions/setting");
      const result = await updateSettings({
        access_token: "valid-token",
        settings: [{ key: "test.key", value: { default: "not-number" } }],
      });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 400 }),
      );
    });

    it("validationRules 非数字值返回 400", async () => {
      setupSuccessMocks();
      const {
        getConfigDefinition,
        extractOptions,
        extractDefaultValue,
        extractValidationRules,
      } = await import("@/data/default-configs");
      vi.mocked(getConfigDefinition).mockReturnValue({
        type: "number",
        default: 10,
      } as never);
      vi.mocked(extractOptions).mockReturnValue(undefined);
      vi.mocked(extractDefaultValue)
        .mockReturnValueOnce("not-a-number") // newValue
        .mockReturnValueOnce(10); // defaultValue
      vi.mocked(extractValidationRules).mockReturnValue({ min: 0, max: 100 });

      const { updateSettings } = await import("@/actions/setting");
      const result = await updateSettings({
        access_token: "valid-token",
        settings: [{ key: "test.key", value: { default: "abc" } }],
      });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 400 }),
      );
    });

    it("validationRules.integer 非整数返回 400", async () => {
      setupSuccessMocks();
      const {
        getConfigDefinition,
        extractOptions,
        extractDefaultValue,
        extractValidationRules,
      } = await import("@/data/default-configs");
      vi.mocked(getConfigDefinition).mockReturnValue({
        type: "number",
        default: 10,
      } as never);
      vi.mocked(extractOptions).mockReturnValue(undefined);
      vi.mocked(extractDefaultValue)
        .mockReturnValueOnce(3.5) // newValue
        .mockReturnValueOnce(10); // defaultValue
      vi.mocked(extractValidationRules).mockReturnValue({ integer: true });

      const { updateSettings } = await import("@/actions/setting");
      const result = await updateSettings({
        access_token: "valid-token",
        settings: [{ key: "test.key", value: { default: 3.5 } }],
      });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 400 }),
      );
    });

    it("validationRules.min 低于最小值返回 400", async () => {
      setupSuccessMocks();
      const {
        getConfigDefinition,
        extractOptions,
        extractDefaultValue,
        extractValidationRules,
      } = await import("@/data/default-configs");
      vi.mocked(getConfigDefinition).mockReturnValue({
        type: "number",
        default: 10,
      } as never);
      vi.mocked(extractOptions).mockReturnValue(undefined);
      vi.mocked(extractDefaultValue)
        .mockReturnValueOnce(-1) // newValue
        .mockReturnValueOnce(10); // defaultValue
      vi.mocked(extractValidationRules).mockReturnValue({ min: 0 });

      const { updateSettings } = await import("@/actions/setting");
      const result = await updateSettings({
        access_token: "valid-token",
        settings: [{ key: "test.key", value: { default: -1 } }],
      });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 400 }),
      );
    });

    it("validationRules.max 超过最大值返回 400", async () => {
      setupSuccessMocks();
      const {
        getConfigDefinition,
        extractOptions,
        extractDefaultValue,
        extractValidationRules,
      } = await import("@/data/default-configs");
      vi.mocked(getConfigDefinition).mockReturnValue({
        type: "number",
        default: 10,
      } as never);
      vi.mocked(extractOptions).mockReturnValue(undefined);
      vi.mocked(extractDefaultValue)
        .mockReturnValueOnce(200) // newValue
        .mockReturnValueOnce(10); // defaultValue
      vi.mocked(extractValidationRules).mockReturnValue({ max: 100 });

      const { updateSettings } = await import("@/actions/setting");
      const result = await updateSettings({
        access_token: "valid-token",
        settings: [{ key: "test.key", value: { default: 200 } }],
      });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 400 }),
      );
    });

    it("validationRules 整数在范围内通过", async () => {
      setupSuccessMocks();
      const {
        getConfigDefinition,
        extractOptions,
        extractDefaultValue,
        extractValidationRules,
      } = await import("@/data/default-configs");
      vi.mocked(getConfigDefinition).mockReturnValue({
        type: "number",
        default: 10,
      } as never);
      vi.mocked(extractOptions).mockReturnValue(undefined);
      vi.mocked(extractDefaultValue)
        .mockReturnValueOnce(50) // newValue
        .mockReturnValueOnce(10); // defaultValue
      vi.mocked(extractValidationRules).mockReturnValue({
        integer: true,
        min: 0,
        max: 100,
      });
      vi.mocked(prisma.config.findMany).mockResolvedValue([]);
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const tx = {
          config: { upsert: vi.fn().mockResolvedValue({ key: "test.key" }) },
        };
        return (fn as (tx: unknown) => Promise<unknown>)(tx);
      });

      const { updateSettings } = await import("@/actions/setting");
      const result = await updateSettings({
        access_token: "valid-token",
        settings: [{ key: "test.key", value: { default: 50 } }],
      });

      expect(result).toEqual(expect.objectContaining({ success: true }));
    });
  });

  describe("updateSettings 云端同步分支", () => {
    it("site.url 变更后同步云端成功", async () => {
      setupSuccessMocks();
      const {
        getConfigDefinition,
        extractOptions,
        extractDefaultValue,
        extractValidationRules,
      } = await import("@/data/default-configs");
      vi.mocked(getConfigDefinition).mockReturnValue({
        type: "string",
        default: "https://old.com",
      } as never);
      vi.mocked(extractOptions).mockReturnValue(undefined);
      vi.mocked(extractValidationRules).mockReturnValue(undefined);
      vi.mocked(extractDefaultValue)
        .mockReturnValueOnce("https://old.com")
        .mockReturnValue("https://new.com");
      vi.mocked(prisma.config.findMany).mockResolvedValue([
        { key: "site.url", value: { default: "https://old.com" } },
      ] as never);
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const tx = { config: { upsert: vi.fn().mockResolvedValue({}) } };
        return (fn as (tx: unknown) => Promise<unknown>)(tx);
      });
      const { syncCloudNow } = await import("@/actions/cloud");
      vi.mocked(syncCloudNow).mockResolvedValue({
        success: true,
        data: { synced: true },
      } as never);

      const { updateSettings } = await import("@/actions/setting");
      const result = await updateSettings({
        access_token: "valid-token",
        settings: [{ key: "site.url", value: { default: "https://new.com" } }],
      });

      expect(result).toEqual(expect.objectContaining({ success: true }));
    });

    it("site.url 变更后同步云端失败不影响结果", async () => {
      setupSuccessMocks();
      const {
        getConfigDefinition,
        extractOptions,
        extractDefaultValue,
        extractValidationRules,
      } = await import("@/data/default-configs");
      vi.mocked(getConfigDefinition).mockReturnValue({
        type: "string",
        default: "https://old.com",
      } as never);
      vi.mocked(extractOptions).mockReturnValue(undefined);
      vi.mocked(extractValidationRules).mockReturnValue(undefined);
      vi.mocked(extractDefaultValue)
        .mockReturnValueOnce("https://old.com")
        .mockReturnValue("https://new.com");
      vi.mocked(prisma.config.findMany).mockResolvedValue([
        { key: "site.url", value: { default: "https://old.com" } },
      ] as never);
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const tx = { config: { upsert: vi.fn().mockResolvedValue({}) } };
        return (fn as (tx: unknown) => Promise<unknown>)(tx);
      });
      const { syncCloudNow } = await import("@/actions/cloud");
      vi.mocked(syncCloudNow).mockResolvedValue({ success: false } as never);

      const { updateSettings } = await import("@/actions/setting");
      const result = await updateSettings({
        access_token: "valid-token",
        settings: [{ key: "site.url", value: { default: "https://new.com" } }],
      });

      expect(result).toEqual(expect.objectContaining({ success: true }));
    });

    it("site.url 变更后同步云端抛异常不影响结果", async () => {
      setupSuccessMocks();
      const {
        getConfigDefinition,
        extractOptions,
        extractDefaultValue,
        extractValidationRules,
      } = await import("@/data/default-configs");
      vi.mocked(getConfigDefinition).mockReturnValue({
        type: "string",
        default: "https://old.com",
      } as never);
      vi.mocked(extractOptions).mockReturnValue(undefined);
      vi.mocked(extractValidationRules).mockReturnValue(undefined);
      vi.mocked(extractDefaultValue)
        .mockReturnValueOnce("https://old.com")
        .mockReturnValue("https://new.com");
      vi.mocked(prisma.config.findMany).mockResolvedValue([
        { key: "site.url", value: { default: "https://old.com" } },
      ] as never);
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const tx = { config: { upsert: vi.fn().mockResolvedValue({}) } };
        return (fn as (tx: unknown) => Promise<unknown>)(tx);
      });
      const { syncCloudNow } = await import("@/actions/cloud");
      vi.mocked(syncCloudNow).mockRejectedValue(new Error("Sync error"));

      const { updateSettings } = await import("@/actions/setting");
      const result = await updateSettings({
        access_token: "valid-token",
        settings: [{ key: "site.url", value: { default: "https://new.com" } }],
      });

      expect(result).toEqual(expect.objectContaining({ success: true }));
    });
  });
});
