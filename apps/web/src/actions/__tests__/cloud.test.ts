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
    cloudTriggerHistory: {
      count: vi.fn(),
      findMany: vi.fn(),
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

vi.mock("next/cache", () => ({
  updateTag: vi.fn(),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execSync: vi.fn(() => "abc123"),
  };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    default: {
      ...(actual as any).default,
      readFile: vi.fn(async () => JSON.stringify({ version: "5.0.0" })),
    },
    readFile: vi.fn(async () => JSON.stringify({ version: "5.0.0" })),
  };
});

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return {
    ...actual,
    sign: vi.fn(() => Buffer.from("mock-signature")),
    createPrivateKey: vi.fn((key: string) => key),
    generateKeyPairSync: vi.fn(() => ({
      publicKey: { export: vi.fn(() => "mock-pub-key") },
      privateKey: { export: vi.fn(() => "mock-priv-key") },
    })),
    randomUUID: vi.fn(() => "mock-uuid-1234"),
  };
});

vi.mock("@/lib/shared/cloud-signature", () => ({
  buildCloudSignMessage: vi.fn(() => "mock-message"),
  encodeBase64Url: vi.fn(() => "mock-sig"),
  generateNonce: vi.fn(() => "mock-nonce"),
}));

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

function setupCloudConfig(enabled = true) {
  (mockGetConfigs as any).mockImplementation(async (keys: string[]) => {
    const map: Record<string, unknown> = {
      "cloud.enable": enabled,
      "cloud.id": "test-site-id",
      "cloud.schedule.time": "03:00",
      "cloud.api.baseUrl": "https://cloud.neutralpress.net",
      "cloud.verify.dohDomain": "key.neutralpress.net",
      "cloud.verify.jwksUrl":
        "https://cloud.neutralpress.net/.well-known/jwks.json",
      "cloud.verify.issuer": "np-cloud",
      "cloud.verify.audience": "np-instance",
      "cloud.key.pub": "mock-pub-key",
      "cloud.key.priv": "mock-priv-key",
      "cloud.key.alg": "ed25519",
      "site.url": "https://example.com",
    };
    return keys.map((k) => map[k] ?? null);
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("cloud actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.config.findMany).mockResolvedValue([
      { updatedAt: new Date("2025-01-01") },
    ] as never);
  });

  // ==========================================================================
  // getCloudConfig
  // ==========================================================================
  describe("getCloudConfig", () => {
    it("返回云端配置 - 成功路径", async () => {
      setupSuccessMocks();
      setupCloudConfig();

      const { getCloudConfig } = await import("@/actions/cloud");
      const result = await getCloudConfig({ access_token: "valid-token" });

      expect(result).toEqual(expect.objectContaining({ success: true }));
    });

    it("未授权返回 401", async () => {
      mockLimitControl.mockResolvedValue(true as never);
      mockValidateData.mockReturnValue(null as never);
      mockAuthVerify.mockResolvedValue(null as never);

      const { getCloudConfig } = await import("@/actions/cloud");
      const result = await getCloudConfig({ access_token: "invalid" });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 401 }),
      );
    });

    it("速率限制触发返回 429", async () => {
      mockLimitControl.mockResolvedValue(false as never);

      const { getCloudConfig } = await import("@/actions/cloud");
      const result = await getCloudConfig({ access_token: "valid-token" });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 429 }),
      );
    });
  });

  // ==========================================================================
  // updateCloudConfig
  // ==========================================================================
  describe("updateCloudConfig", () => {
    it("更新云端配置 - 成功路径", async () => {
      setupSuccessMocks();
      setupCloudConfig();
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const tx = {
          config: { upsert: vi.fn().mockResolvedValue({}) },
        };
        return (fn as (tx: unknown) => Promise<unknown>)(tx);
      });

      const { updateCloudConfig } = await import("@/actions/cloud");
      const result = await updateCloudConfig({
        access_token: "valid-token",
        enabled: true,
      });

      expect(result).toEqual(expect.objectContaining({ success: true }));
    });

    it("无配置项返回 400", async () => {
      setupSuccessMocks();
      setupCloudConfig();

      const { updateCloudConfig } = await import("@/actions/cloud");
      const result = await updateCloudConfig({
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

      const { updateCloudConfig } = await import("@/actions/cloud");
      const result = await updateCloudConfig({
        access_token: "invalid",
        enabled: true,
      });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 401 }),
      );
    });
  });

  // ==========================================================================
  // syncCloudNow
  // ==========================================================================
  describe("syncCloudNow", () => {
    it("云功能禁用时返回 synced=false", async () => {
      setupSuccessMocks();
      setupCloudConfig(false);

      const { syncCloudNow } = await import("@/actions/cloud");
      const result = await syncCloudNow({ access_token: "valid-token" });

      expect(result).toEqual(expect.objectContaining({ success: true }));
      const data = (result as Record<string, unknown>).data as Record<
        string,
        unknown
      >;
      expect(data.synced).toBe(false);
    });

    it("未授权返回 401", async () => {
      mockLimitControl.mockResolvedValue(true as never);
      mockValidateData.mockReturnValue(null as never);
      mockAuthVerify.mockResolvedValue(null as never);

      const { syncCloudNow } = await import("@/actions/cloud");
      const result = await syncCloudNow({ access_token: "invalid" });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 401 }),
      );
    });
  });

  // ==========================================================================
  // getCloudHistory
  // ==========================================================================
  describe("getCloudHistory", () => {
    it("返回云端历史 - 成功路径", async () => {
      setupSuccessMocks();
      vi.mocked(prisma.cloudTriggerHistory.count).mockResolvedValue(0);
      vi.mocked(prisma.cloudTriggerHistory.findMany).mockResolvedValue([]);

      const { getCloudHistory } = await import("@/actions/cloud");
      const result = await getCloudHistory({
        access_token: "valid-token",
        page: 1,
        pageSize: 25,
      });

      expect(result).toEqual(expect.objectContaining({ success: true }));
    });

    it("未授权返回 401", async () => {
      mockLimitControl.mockResolvedValue(true as never);
      mockValidateData.mockReturnValue(null as never);
      mockAuthVerify.mockResolvedValue(null as never);

      const { getCloudHistory } = await import("@/actions/cloud");
      const result = await getCloudHistory({
        access_token: "invalid",
        page: 1,
        pageSize: 25,
      });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 401 }),
      );
    });
  });

  // ==========================================================================
  // getCloudTrends
  // ==========================================================================
  describe("getCloudTrends", () => {
    it("返回云端趋势 - 成功路径", async () => {
      setupSuccessMocks();
      vi.mocked(prisma.cloudTriggerHistory.findMany).mockResolvedValue([]);

      const { getCloudTrends } = await import("@/actions/cloud");
      const result = await getCloudTrends({
        access_token: "valid-token",
        days: 30,
        count: 60,
      });

      expect(result).toEqual(expect.objectContaining({ success: true }));
    });

    it("未授权返回 401", async () => {
      mockLimitControl.mockResolvedValue(true as never);
      mockValidateData.mockReturnValue(null as never);
      mockAuthVerify.mockResolvedValue(null as never);

      const { getCloudTrends } = await import("@/actions/cloud");
      const result = await getCloudTrends({
        access_token: "invalid",
        days: 30,
        count: 60,
      });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 401 }),
      );
    });

    it("速率限制时返回 429", async () => {
      mockLimitControl.mockResolvedValue(false as never);

      const { getCloudTrends } = await import("@/actions/cloud");
      const result = await getCloudTrends({
        access_token: "valid-token",
        days: 30,
        count: 60,
      });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 429 }),
      );
    });
  });

  // ==========================================================================
  // 补充测试
  // ==========================================================================
  describe("getCloudConfig 补充测试", () => {
    it("速率限制时返回 429", async () => {
      mockLimitControl.mockResolvedValue(false as never);

      const { getCloudConfig } = await import("@/actions/cloud");
      const result = await getCloudConfig({
        access_token: "valid-token",
      });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 429 }),
      );
    });
  });

  describe("getCloudHistory 补充测试", () => {
    it("速率限制时返回 429", async () => {
      mockLimitControl.mockResolvedValue(false as never);

      const { getCloudHistory } = await import("@/actions/cloud");
      const result = await getCloudHistory({
        access_token: "valid-token",
        page: 1,
        pageSize: 25,
      });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 429 }),
      );
    });
  });

  describe("updateCloudConfig 补充测试", () => {
    it("速率限制时返回 429", async () => {
      mockLimitControl.mockResolvedValue(false as never);

      const { updateCloudConfig } = await import("@/actions/cloud");
      const result = await updateCloudConfig({
        access_token: "valid-token",
        enabled: true,
      });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 429 }),
      );
    });
  });

  describe("syncCloudNow 补充测试", () => {
    it("速率限制时返回 429", async () => {
      mockLimitControl.mockResolvedValue(false as never);

      const { syncCloudNow } = await import("@/actions/cloud");
      const result = await syncCloudNow({
        access_token: "valid-token",
      });

      expect(result).toEqual(expect.objectContaining({ success: false }));
    });

    it("未授权时返回失败", async () => {
      mockAuthVerify.mockResolvedValue(null);

      const { syncCloudNow } = await import("@/actions/cloud");
      const result = await syncCloudNow({
        access_token: "invalid-token",
      });

      expect(result).toEqual(expect.objectContaining({ success: false }));
    });
  });

  describe("getCloudHistory 补充测试 2", () => {
    it("未授权时返回失败", async () => {
      mockAuthVerify.mockResolvedValue(null);

      const { getCloudHistory } = await import("@/actions/cloud");
      const result = await getCloudHistory({
        access_token: "invalid-token",
        page: 1,
        pageSize: 25,
      });

      expect(result).toEqual(expect.objectContaining({ success: false }));
    });
  });

  describe("getCloudTrends 补充测试 2", () => {
    it("未授权时返回失败", async () => {
      mockAuthVerify.mockResolvedValue(null);

      const { getCloudTrends } = await import("@/actions/cloud");
      const result = await getCloudTrends({
        access_token: "invalid-token",
        days: 30,
        count: 60,
      });

      expect(result).toEqual(expect.objectContaining({ success: false }));
    });
  });

  describe("getCloudConfig 补充测试 2", () => {
    it("非管理员应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);

      const { getCloudConfig } = await import("@/actions/cloud");
      const result = await getCloudConfig({
        access_token: "invalid-token",
      });

      expect(result).toEqual(expect.objectContaining({ success: false }));
    });
  });

  describe("updateCloudConfig 补充测试 2", () => {
    it("非管理员应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);

      const { updateCloudConfig } = await import("@/actions/cloud");
      const result = await updateCloudConfig({
        access_token: "invalid-token",
        enabled: true,
      });

      expect(result).toEqual(expect.objectContaining({ success: false }));
    });
  });

  describe("getCloudHistory 补充测试 2", () => {
    it("速率限制时返回 429", async () => {
      mockLimitControl.mockResolvedValue(false as never);

      const { getCloudHistory } = await import("@/actions/cloud");
      const result = await getCloudHistory({
        access_token: "valid-token",
        page: 1,
        pageSize: 25,
      });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 429 }),
      );
    });
  });

  describe("getCloudTrends 补充测试 3", () => {
    it("速率限制时返回 429", async () => {
      mockLimitControl.mockResolvedValue(false as never);

      const { getCloudTrends } = await import("@/actions/cloud");
      const result = await getCloudTrends({
        access_token: "valid-token",
        days: 30,
        count: 60,
      });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 429 }),
      );
    });
  });

  describe("getCloudConfig 补充测试 3", () => {
    it("数据库错误时返回失败", async () => {
      setupSuccessMocks();
      vi.mocked(prisma.config.findMany).mockRejectedValue(
        new Error("DB error"),
      );

      const { getCloudConfig } = await import("@/actions/cloud");
      const result = await getCloudConfig({
        access_token: "valid-token",
      });

      expect(result).toEqual(expect.objectContaining({ success: false }));
    });
  });

  describe("updateCloudConfig 补充测试 3", () => {
    it("数据库错误时返回失败", async () => {
      setupSuccessMocks();
      vi.mocked(prisma.$transaction).mockRejectedValue(new Error("DB error"));

      const { updateCloudConfig } = await import("@/actions/cloud");
      const result = await updateCloudConfig({
        access_token: "valid-token",
        enabled: true,
      });

      expect(result).toEqual(expect.objectContaining({ success: false }));
    });
  });

  describe("getCloudHistory 补充测试 3", () => {
    it("非管理员应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);

      const { getCloudHistory } = await import("@/actions/cloud");
      const result = await getCloudHistory({
        access_token: "invalid-token",
        page: 1,
        pageSize: 25,
      });

      expect(result).toEqual(expect.objectContaining({ success: false }));
    });

    it("数据库错误时返回失败", async () => {
      setupSuccessMocks();
      vi.mocked(prisma.cloudTriggerHistory.count).mockRejectedValue(
        new Error("DB error"),
      );

      const { getCloudHistory } = await import("@/actions/cloud");
      const result = await getCloudHistory({
        access_token: "valid-token",
        page: 1,
        pageSize: 25,
      });

      expect(result).toEqual(expect.objectContaining({ success: false }));
    });
  });

  describe("getCloudTrends 补充测试 2", () => {
    it("非管理员应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);

      const { getCloudTrends } = await import("@/actions/cloud");
      const result = await getCloudTrends({
        access_token: "invalid-token",
        days: 30,
        count: 60,
      });

      expect(result).toEqual(expect.objectContaining({ success: false }));
    });

    it("数据库错误时返回失败", async () => {
      setupSuccessMocks();
      vi.mocked(prisma.cloudTriggerHistory.findMany).mockRejectedValue(
        new Error("DB error"),
      );

      const { getCloudTrends } = await import("@/actions/cloud");
      const result = await getCloudTrends({
        access_token: "valid-token",
        days: 30,
        count: 60,
      });

      expect(result).toEqual(expect.objectContaining({ success: false }));
    });
  });

  describe("getCloudRemoteStatus", () => {
    it("速率限制时返回 429", async () => {
      mockLimitControl.mockResolvedValue(false as never);

      const { getCloudRemoteStatus } = await import("@/actions/cloud");
      const result = await getCloudRemoteStatus({
        access_token: "valid-token",
      });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 429 }),
      );
    });

    it("非管理员应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);

      const { getCloudRemoteStatus } = await import("@/actions/cloud");
      const result = await getCloudRemoteStatus({
        access_token: "invalid-token",
      });

      expect(result).toEqual(expect.objectContaining({ success: false }));
    });
  });

  // ==========================================================================
  // getCloudHistory - 分支覆盖
  // ==========================================================================
  describe("getCloudHistory 分支覆盖", () => {
    it("带 status 过滤", async () => {
      setupSuccessMocks();
      vi.mocked(prisma.cloudTriggerHistory.count).mockResolvedValue(1);
      vi.mocked(prisma.cloudTriggerHistory.findMany).mockResolvedValue([
        {
          id: 1,
          deliveryId: "del-1",
          triggerType: "CRON",
          requestedAt: new Date(),
          receivedAt: new Date(),
          verifyOk: true,
          verifySource: "DOH",
          accepted: true,
          dedupHit: false,
          status: "DONE",
          message: "ok",
          cronHistoryId: null,
          telemetry: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as never);

      const { getCloudHistory } = await import("@/actions/cloud");
      const result = await getCloudHistory({
        access_token: "valid-token",
        page: 1,
        pageSize: 25,
        status: "DONE",
      });

      expect(result).toEqual(expect.objectContaining({ success: true }));
    });

    it("带 verifySource=NONE 过滤（转为 null）", async () => {
      setupSuccessMocks();
      vi.mocked(prisma.cloudTriggerHistory.count).mockResolvedValue(0);
      vi.mocked(prisma.cloudTriggerHistory.findMany).mockResolvedValue([]);

      const { getCloudHistory } = await import("@/actions/cloud");
      await getCloudHistory({
        access_token: "valid-token",
        page: 1,
        pageSize: 25,
        verifySource: "NONE",
      });

      const whereArg = vi.mocked(prisma.cloudTriggerHistory.count).mock
        .calls[0]?.[0] as Record<string, any>;
      expect(whereArg?.where?.verifySource).toBeNull();
    });

    it("带 verifySource=DOH 过滤", async () => {
      setupSuccessMocks();
      vi.mocked(prisma.cloudTriggerHistory.count).mockResolvedValue(0);
      vi.mocked(prisma.cloudTriggerHistory.findMany).mockResolvedValue([]);

      const { getCloudHistory } = await import("@/actions/cloud");
      await getCloudHistory({
        access_token: "valid-token",
        page: 1,
        pageSize: 25,
        verifySource: "DOH",
      });

      const whereArg = vi.mocked(prisma.cloudTriggerHistory.count).mock
        .calls[0]?.[0] as Record<string, any>;
      expect(whereArg?.where?.verifySource).toBe("DOH");
    });

    it("带 date range 过滤", async () => {
      setupSuccessMocks();
      vi.mocked(prisma.cloudTriggerHistory.count).mockResolvedValue(0);
      vi.mocked(prisma.cloudTriggerHistory.findMany).mockResolvedValue([]);

      const { getCloudHistory } = await import("@/actions/cloud");
      await getCloudHistory({
        access_token: "valid-token",
        page: 1,
        pageSize: 25,
        createdAtStart: "2025-01-01",
        createdAtEnd: "2025-12-31",
      });

      const whereArg = vi.mocked(prisma.cloudTriggerHistory.count).mock
        .calls[0]?.[0] as Record<string, any>;
      expect(whereArg?.where?.createdAt).toBeDefined();
      expect(whereArg?.where?.createdAt?.gte).toBeInstanceOf(Date);
      expect(whereArg?.where?.createdAt?.lte).toBeInstanceOf(Date);
    });

    it("带 accepted 和 dedupHit 过滤", async () => {
      setupSuccessMocks();
      vi.mocked(prisma.cloudTriggerHistory.count).mockResolvedValue(0);
      vi.mocked(prisma.cloudTriggerHistory.findMany).mockResolvedValue([]);

      const { getCloudHistory } = await import("@/actions/cloud");
      await getCloudHistory({
        access_token: "valid-token",
        page: 1,
        pageSize: 25,
        accepted: true,
        dedupHit: false,
      });

      const whereArg = vi.mocked(prisma.cloudTriggerHistory.count).mock
        .calls[0]?.[0] as Record<string, any>;
      expect(whereArg?.where?.accepted).toBe(true);
      expect(whereArg?.where?.dedupHit).toBe(false);
    });

    it("sortBy=id, sortOrder=asc", async () => {
      setupSuccessMocks();
      vi.mocked(prisma.cloudTriggerHistory.count).mockResolvedValue(0);
      vi.mocked(prisma.cloudTriggerHistory.findMany).mockResolvedValue([]);

      const { getCloudHistory } = await import("@/actions/cloud");
      await getCloudHistory({
        access_token: "valid-token",
        page: 1,
        pageSize: 25,
        sortBy: "id",
        sortOrder: "asc",
      });

      const findArg = vi.mocked(prisma.cloudTriggerHistory.findMany).mock
        .calls[0]?.[0] as Record<string, unknown>;
      expect(findArg?.orderBy).toEqual({ id: "asc" });
    });

    it("sortBy=createdAt, sortOrder=desc", async () => {
      setupSuccessMocks();
      vi.mocked(prisma.cloudTriggerHistory.count).mockResolvedValue(0);
      vi.mocked(prisma.cloudTriggerHistory.findMany).mockResolvedValue([]);

      const { getCloudHistory } = await import("@/actions/cloud");
      await getCloudHistory({
        access_token: "valid-token",
        page: 1,
        pageSize: 25,
        sortBy: "createdAt",
        sortOrder: "desc",
      });

      const findArg = vi.mocked(prisma.cloudTriggerHistory.findMany).mock
        .calls[0]?.[0] as Record<string, unknown>;
      expect(findArg?.orderBy).toEqual({ createdAt: "desc" });
    });

    it("sortBy=status", async () => {
      setupSuccessMocks();
      vi.mocked(prisma.cloudTriggerHistory.count).mockResolvedValue(0);
      vi.mocked(prisma.cloudTriggerHistory.findMany).mockResolvedValue([]);

      const { getCloudHistory } = await import("@/actions/cloud");
      await getCloudHistory({
        access_token: "valid-token",
        page: 1,
        pageSize: 25,
        sortBy: "status",
        sortOrder: "asc",
      });

      const findArg = vi.mocked(prisma.cloudTriggerHistory.findMany).mock
        .calls[0]?.[0] as Record<string, unknown>;
      expect(findArg?.orderBy).toEqual({ status: "asc" });
    });

    it("sortBy=verifySource", async () => {
      setupSuccessMocks();
      vi.mocked(prisma.cloudTriggerHistory.count).mockResolvedValue(0);
      vi.mocked(prisma.cloudTriggerHistory.findMany).mockResolvedValue([]);

      const { getCloudHistory } = await import("@/actions/cloud");
      await getCloudHistory({
        access_token: "valid-token",
        page: 1,
        pageSize: 25,
        sortBy: "verifySource",
        sortOrder: "desc",
      });

      const findArg = vi.mocked(prisma.cloudTriggerHistory.findMany).mock
        .calls[0]?.[0] as Record<string, unknown>;
      expect(findArg?.orderBy).toEqual({ verifySource: "desc" });
    });

    it("sortBy=accepted", async () => {
      setupSuccessMocks();
      vi.mocked(prisma.cloudTriggerHistory.count).mockResolvedValue(0);
      vi.mocked(prisma.cloudTriggerHistory.findMany).mockResolvedValue([]);

      const { getCloudHistory } = await import("@/actions/cloud");
      await getCloudHistory({
        access_token: "valid-token",
        page: 1,
        pageSize: 25,
        sortBy: "accepted",
        sortOrder: "asc",
      });

      const findArg = vi.mocked(prisma.cloudTriggerHistory.findMany).mock
        .calls[0]?.[0] as Record<string, unknown>;
      expect(findArg?.orderBy).toEqual({ accepted: "asc" });
    });

    it("sortBy=dedupHit", async () => {
      setupSuccessMocks();
      vi.mocked(prisma.cloudTriggerHistory.count).mockResolvedValue(0);
      vi.mocked(prisma.cloudTriggerHistory.findMany).mockResolvedValue([]);

      const { getCloudHistory } = await import("@/actions/cloud");
      await getCloudHistory({
        access_token: "valid-token",
        page: 1,
        pageSize: 25,
        sortBy: "dedupHit",
        sortOrder: "desc",
      });

      const findArg = vi.mocked(prisma.cloudTriggerHistory.findMany).mock
        .calls[0]?.[0] as Record<string, unknown>;
      expect(findArg?.orderBy).toEqual({ dedupHit: "desc" });
    });

    it("默认排序 receivedAt desc", async () => {
      setupSuccessMocks();
      vi.mocked(prisma.cloudTriggerHistory.count).mockResolvedValue(0);
      vi.mocked(prisma.cloudTriggerHistory.findMany).mockResolvedValue([]);

      const { getCloudHistory } = await import("@/actions/cloud");
      await getCloudHistory({
        access_token: "valid-token",
        page: 1,
        pageSize: 25,
      });

      const findArg = vi.mocked(prisma.cloudTriggerHistory.findMany).mock
        .calls[0]?.[0] as Record<string, unknown>;
      expect(findArg?.orderBy).toEqual({ receivedAt: "desc" });
    });
  });

  // ==========================================================================
  // getCloudTrends - 分支覆盖
  // ==========================================================================
  describe("getCloudTrends 分支覆盖", () => {
    it("有数据时正确聚合 accepted/rejected/dedup/verifySource/status", async () => {
      setupSuccessMocks();
      const baseTime = new Date("2025-06-20T12:00:00Z");
      const items = [
        {
          id: 1,
          receivedAt: baseTime,
          accepted: true,
          dedupHit: false,
          verifySource: "DOH",
          status: "DONE",
        },
        {
          id: 2,
          receivedAt: baseTime,
          accepted: false,
          dedupHit: true,
          verifySource: "JWKS",
          status: "REJECTED",
        },
        {
          id: 3,
          receivedAt: baseTime,
          accepted: true,
          dedupHit: false,
          verifySource: null,
          status: "RECEIVED",
        },
        {
          id: 4,
          receivedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2h ago
          accepted: true,
          dedupHit: false,
          verifySource: "DOH",
          status: "ERROR",
        },
      ];

      // findMany 被调用两次：recentByTime 和 recentByCount
      vi.mocked(prisma.cloudTriggerHistory.findMany)
        .mockResolvedValueOnce(items as never)
        .mockResolvedValueOnce(items as never);

      const { getCloudTrends } = await import("@/actions/cloud");
      const result = await getCloudTrends({
        access_token: "valid-token",
        days: 30,
        count: 60,
      });

      expect(result).toEqual(expect.objectContaining({ success: true }));
      const data = (result as Record<string, unknown>).data as Array<
        Record<string, unknown>
      >;
      expect(data.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // updateCloudConfig - 分支覆盖
  // ==========================================================================
  describe("updateCloudConfig 分支覆盖", () => {
    it("更新 scheduleTime", async () => {
      setupSuccessMocks();
      setupCloudConfig();
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const tx = { config: { upsert: vi.fn().mockResolvedValue({}) } };
        return (fn as (tx: unknown) => Promise<unknown>)(tx);
      });

      const { updateCloudConfig } = await import("@/actions/cloud");
      const result = await updateCloudConfig({
        access_token: "valid-token",
        scheduleTime: "15:30",
      });

      expect(result).toEqual(expect.objectContaining({ success: true }));
    });

    it("更新 cloudBaseUrl", async () => {
      setupSuccessMocks();
      setupCloudConfig();
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const tx = { config: { upsert: vi.fn().mockResolvedValue({}) } };
        return (fn as (tx: unknown) => Promise<unknown>)(tx);
      });

      const { updateCloudConfig } = await import("@/actions/cloud");
      const result = await updateCloudConfig({
        access_token: "valid-token",
        cloudBaseUrl: "https://custom.cloud.net",
      });

      expect(result).toEqual(expect.objectContaining({ success: true }));
    });

    it("更新 dohDomain, jwksUrl, issuer, audience", async () => {
      setupSuccessMocks();
      setupCloudConfig();
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const tx = { config: { upsert: vi.fn().mockResolvedValue({}) } };
        return (fn as (tx: unknown) => Promise<unknown>)(tx);
      });

      const { updateCloudConfig } = await import("@/actions/cloud");
      const result = await updateCloudConfig({
        access_token: "valid-token",
        dohDomain: "doh.example.com",
        jwksUrl: "https://example.com/jwks",
        issuer: "my-issuer",
        audience: "my-audience",
      });

      expect(result).toEqual(expect.objectContaining({ success: true }));
    });

    it("audit log 失败不影响结果", async () => {
      setupSuccessMocks();
      setupCloudConfig();
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const tx = { config: { upsert: vi.fn().mockResolvedValue({}) } };
        return (fn as (tx: unknown) => Promise<unknown>)(tx);
      });
      const { logAuditEvent } = await import("@/lib/server/audit");
      vi.mocked(logAuditEvent).mockRejectedValue(new Error("Audit fail"));

      const { updateCloudConfig } = await import("@/actions/cloud");
      const result = await updateCloudConfig({
        access_token: "valid-token",
        enabled: true,
      });

      expect(result).toEqual(expect.objectContaining({ success: true }));
    });

    it("数据库事务错误返回 serverError", async () => {
      setupSuccessMocks();
      setupCloudConfig();
      vi.mocked(prisma.$transaction).mockRejectedValue(new Error("TX error"));

      const { updateCloudConfig } = await import("@/actions/cloud");
      const result = await updateCloudConfig({
        access_token: "valid-token",
        enabled: true,
      });

      expect(result).toEqual(expect.objectContaining({ success: false }));
    });
  });

  // ==========================================================================
  // getCloudRemoteStatus - 分支覆盖
  // ==========================================================================
  describe("getCloudRemoteStatus 分支覆盖", () => {
    it("验证失败返回 400", async () => {
      setupSuccessMocks();
      mockValidateData.mockReturnValue("error" as never);

      const { getCloudRemoteStatus } = await import("@/actions/cloud");
      const result = await getCloudRemoteStatus({
        access_token: "valid-token",
      });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 400 }),
      );
    });
  });
});
