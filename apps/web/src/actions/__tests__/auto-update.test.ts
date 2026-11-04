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
      return { success: false, status: 401 };
    }
    conflict(opts?: unknown) {
      return {
        success: false,
        status: 409,
        ...(opts as Record<string, unknown>),
      };
    }
    tooManyRequests() {
      return { success: false, status: 429 };
    }
    serverError() {
      return { success: false, status: 500 };
    }
    badGateway(opts?: unknown) {
      return {
        success: false,
        status: 502,
        ...(opts as Record<string, unknown>),
      };
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

vi.mock("@/lib/server/config-cache", () => ({
  getConfigs: vi.fn(async () => []),
}));

vi.mock("@/lib/shared/cache-bootstrap-auth", () => ({
  deriveWatchtowerApiToken: vi.fn(() => "mock-token"),
}));

vi.mock("next/cache", () => ({
  updateTag: vi.fn(),
}));

vi.mock("next/server", () => ({
  after: vi.fn((fn: () => void) => fn()),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execSync: vi.fn(() => "abc123def456"),
  };
});

vi.mock("node:fs/promises", () => {
  return {
    default: {
      readFile: vi.fn(async () => JSON.stringify({ version: "5.1.2" })),
    },
    readFile: vi.fn(async () => JSON.stringify({ version: "5.1.2" })),
  };
});

// ── Imports ──────────────────────────────────────────────────────────────────

import { authVerify } from "@/lib/server/auth-verify";
import { getConfigs } from "@/lib/server/config-cache";
import prisma from "@/lib/server/prisma";
import limitControl from "@/lib/server/rate-limit";
import { validateData } from "@/lib/server/validator";

const mockLimitControl = vi.mocked(limitControl);
const mockValidateData = vi.mocked(validateData);
const mockAuthVerify = vi.mocked(authVerify);
const mockGetConfigs = vi.mocked(getConfigs);

// ── Helpers ──────────────────────────────────────────────────────────────────

function setupSuccessMocks() {
  mockLimitControl.mockResolvedValue(true as never);
  mockValidateData.mockReturnValue(null as never);
  mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" } as never);
}

function setupAutoUpdateConfig(mode = "REPOSITORY") {
  (mockGetConfigs as any).mockImplementation(async (keys: string[]) => {
    const map: Record<string, unknown> = {
      "autoupdate.mode": mode,
      "autoupdate.repo.fullName": "user/neutralpress",
      "autoupdate.repo.branch": "main",
      "autoupdate.repo.pat": "ghp_test_token",
      "autoupdate.watchtower.baseUrl": "http://watchtower:8080/v1/update",
    };
    return keys.map((k) => map[k] ?? null);
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("auto-update actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.config.findMany).mockResolvedValue([
      { updatedAt: new Date("2025-01-01") },
    ] as never);
  });

  // ==========================================================================
  // getAutoUpdateOverview
  // ==========================================================================
  describe("getAutoUpdateOverview", () => {
    it("返回自动更新概览 - 成功路径", async () => {
      setupSuccessMocks();
      setupAutoUpdateConfig();

      // Mock fetch for GitHub API calls
      (global.fetch as any) = vi.fn(async (url: string) => {
        if (typeof url === "string" && url.includes("releases/latest")) {
          return {
            ok: true,
            json: async () => ({ tag_name: "v5.1.0" }),
          } as Response;
        }
        if (typeof url === "string" && url.includes("compare")) {
          return {
            ok: true,
            json: async () => ({
              status: "identical",
              ahead_by: 0,
              behind_by: 0,
            }),
          } as Response;
        }
        if (typeof url === "string" && url.includes("releases")) {
          return {
            ok: true,
            json: async () => [],
          } as Response;
        }
        if (typeof url === "string" && url.includes("contents")) {
          return {
            ok: true,
            json: async () => ({
              content: Buffer.from(
                JSON.stringify({ version: "5.1.0" }),
              ).toString("base64"),
              encoding: "base64",
            }),
          } as Response;
        }
        return {
          ok: false,
          json: async () => ({ message: "Not found" }),
        } as Response;
      });

      const { getAutoUpdateOverview } = await import("@/actions/auto-update");
      const result = await getAutoUpdateOverview({
        access_token: "valid-token",
      });

      expect(result).toEqual(expect.objectContaining({ success: true }));
    });

    it("未授权返回 401", async () => {
      mockLimitControl.mockResolvedValue(true as never);
      mockValidateData.mockReturnValue(null as never);
      mockAuthVerify.mockResolvedValue(null as never);

      const { getAutoUpdateOverview } = await import("@/actions/auto-update");
      const result = await getAutoUpdateOverview({ access_token: "invalid" });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 401 }),
      );
    });

    it("速率限制触发返回 429", async () => {
      mockLimitControl.mockResolvedValue(false as never);

      const { getAutoUpdateOverview } = await import("@/actions/auto-update");
      const result = await getAutoUpdateOverview({
        access_token: "valid-token",
      });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 429 }),
      );
    });
  });

  // ==========================================================================
  // updateAutoUpdateConfig
  // ==========================================================================
  describe("updateAutoUpdateConfig", () => {
    it("更新自动更新配置 - 成功路径", async () => {
      setupSuccessMocks();
      setupAutoUpdateConfig();
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const tx = {
          config: { upsert: vi.fn().mockResolvedValue({}) },
        };
        return (fn as (tx: unknown) => Promise<unknown>)(tx);
      });

      const { updateAutoUpdateConfig } = await import("@/actions/auto-update");
      const result = await updateAutoUpdateConfig({
        access_token: "valid-token",
        mode: "REPOSITORY",
      });

      expect(result).toEqual(expect.objectContaining({ success: true }));
    });

    it("无配置项返回 400", async () => {
      setupSuccessMocks();
      setupAutoUpdateConfig();

      const { updateAutoUpdateConfig } = await import("@/actions/auto-update");
      const result = await updateAutoUpdateConfig({
        access_token: "valid-token",
      });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 400 }),
      );
    });

    it("未授权返回 401", async () => {
      mockLimitControl.mockResolvedValue(true as never);
      mockValidateData.mockReturnValue(null as never);
      mockAuthVerify.mockResolvedValue(null as never);

      const { updateAutoUpdateConfig } = await import("@/actions/auto-update");
      const result = await updateAutoUpdateConfig({
        access_token: "invalid",
        mode: "REPOSITORY",
      });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 401 }),
      );
    });

    it("数据库错误返回 500", async () => {
      setupSuccessMocks();
      setupAutoUpdateConfig();
      vi.mocked(prisma.$transaction).mockRejectedValue(new Error("DB error"));

      const { updateAutoUpdateConfig } = await import("@/actions/auto-update");
      const result = await updateAutoUpdateConfig({
        access_token: "valid-token",
        mode: "CONTAINER",
      });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 500 }),
      );
    });
  });

  // ==========================================================================
  // triggerAutoUpdate
  // ==========================================================================
  describe("triggerAutoUpdate", () => {
    it("未授权返回 401", async () => {
      mockLimitControl.mockResolvedValue(true as never);
      mockValidateData.mockReturnValue(null as never);
      mockAuthVerify.mockResolvedValue(null as never);

      const { triggerAutoUpdate } = await import("@/actions/auto-update");
      const result = await triggerAutoUpdate({
        access_token: "invalid",
        mode: "REPOSITORY",
      });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 401 }),
      );
    });

    it("速率限制触发返回 429", async () => {
      mockLimitControl.mockResolvedValue(false as never);

      const { triggerAutoUpdate } = await import("@/actions/auto-update");
      const result = await triggerAutoUpdate({
        access_token: "valid-token",
        mode: "REPOSITORY",
      });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 429 }),
      );
    });
  });

  // ==========================================================================
  // getRuntimeVersionInfo
  // ==========================================================================
  describe("getRuntimeVersionInfo", () => {
    it("返回运行时版本信息 - 成功路径", async () => {
      setupSuccessMocks();

      const { getRuntimeVersionInfo } = await import("@/actions/auto-update");
      const result = await getRuntimeVersionInfo({
        access_token: "valid-token",
      });

      expect(result).toEqual(expect.objectContaining({ success: true }));
      const data = (result as Record<string, unknown>).data as Record<
        string,
        unknown
      >;
      expect(data).toBeDefined();
      expect(data.appVersion).toBeDefined();
      expect(data.collectedAt).toBeDefined();
    });

    it("未授权返回 401", async () => {
      mockLimitControl.mockResolvedValue(true as never);
      mockValidateData.mockReturnValue(null as never);
      mockAuthVerify.mockResolvedValue(null as never);

      const { getRuntimeVersionInfo } = await import("@/actions/auto-update");
      const result = await getRuntimeVersionInfo({ access_token: "invalid" });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 401 }),
      );
    });

    it("速率限制触发返回 429", async () => {
      mockLimitControl.mockResolvedValue(false as never);

      const { getRuntimeVersionInfo } = await import("@/actions/auto-update");
      const result = await getRuntimeVersionInfo({
        access_token: "valid-token",
      });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 429 }),
      );
    });
  });

  // ===== 分支覆盖补充测试 =====

  describe("getAutoUpdateOverview 分支", () => {
    it("数据库错误时返回失败", async () => {
      setupSuccessMocks();
      setupAutoUpdateConfig();
      vi.mocked(prisma.config.findMany).mockRejectedValue(
        new Error("DB error"),
      );

      const { getAutoUpdateOverview } = await import("@/actions/auto-update");
      const result = await getAutoUpdateOverview({
        access_token: "valid-token",
      });

      expect(result).toEqual(expect.objectContaining({ success: false }));
    });
  });

  describe("updateAutoUpdateConfig 分支", () => {
    it("速率限制触发返回 429", async () => {
      mockLimitControl.mockResolvedValue(false as never);

      const { updateAutoUpdateConfig } = await import("@/actions/auto-update");
      const result = await updateAutoUpdateConfig({
        access_token: "valid-token",
        mode: "REPOSITORY",
      });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 429 }),
      );
    });

    it("数据库错误时返回失败", async () => {
      setupSuccessMocks();
      setupAutoUpdateConfig();
      vi.mocked(prisma.$transaction).mockRejectedValue(new Error("DB error"));

      const { updateAutoUpdateConfig } = await import("@/actions/auto-update");
      const result = await updateAutoUpdateConfig({
        access_token: "valid-token",
        mode: "CONTAINER",
      });

      expect(result).toEqual(expect.objectContaining({ success: false }));
    });
  });

  describe("getRuntimeVersionInfo 分支", () => {
    it("运行时版本信息不依赖数据库读取", async () => {
      setupSuccessMocks();
      vi.mocked(prisma.config.findMany).mockRejectedValue(
        new Error("DB error"),
      );

      const { getRuntimeVersionInfo } = await import("@/actions/auto-update");
      const result = await getRuntimeVersionInfo({
        access_token: "valid-token",
      });

      expect(result).toEqual(expect.objectContaining({ success: true }));
      expect(prisma.config.findMany).not.toHaveBeenCalled();
    });
  });
});
