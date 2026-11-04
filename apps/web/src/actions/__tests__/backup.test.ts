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
    serverError(opts?: unknown) {
      return {
        success: false,
        status: 500,
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

vi.mock("@/lib/server/backup", () => ({
  BACKUP_DIRECT_LIMIT_BYTES: 4 * 1024 * 1024,
  getBackupScopes: vi.fn(() => ({ scopes: ["all"] })),
  createBackupExport: vi.fn(),
  dryRunBackupImport: vi.fn(),
  importBackup: vi.fn(),
  initBackupImportUpload: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));
vi.mock("@/lib/server/isr-invalidation", () => ({ expireCacheTag: vi.fn() }));

vi.mock("@/lib/server/cache-bootstrap-targets", () => ({
  collectBootstrapTags: vi.fn(async () => []),
  getCriticalRevalidatePathTargets: vi.fn(() => []),
}));

// ── Imports ──────────────────────────────────────────────────────────────────

import { authVerify } from "@/lib/server/auth-verify";
import {
  createBackupExport,
  dryRunBackupImport as dryRunBackupImportService,
  importBackup as importBackupService,
  initBackupImportUpload as initBackupImportUploadService,
} from "@/lib/server/backup";
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

describe("backup actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // getBackupScopes
  // ==========================================================================
  describe("getBackupScopes", () => {
    it("返回备份分组定义 - 成功路径", async () => {
      setupSuccessMocks();

      const { getBackupScopes } = await import("@/actions/backup");
      const result = await getBackupScopes({ access_token: "valid-token" });

      expect(result).toEqual(expect.objectContaining({ success: true }));
    });

    it("未授权返回 401", async () => {
      mockLimitControl.mockResolvedValue(true as never);
      mockValidateData.mockReturnValue(null as never);
      mockAuthVerify.mockResolvedValue(null as never);

      const { getBackupScopes } = await import("@/actions/backup");
      const result = await getBackupScopes({ access_token: "invalid" });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 401 }),
      );
    });
  });

  // ==========================================================================
  // exportBackup
  // ==========================================================================
  describe("exportBackup", () => {
    it("导出备份 - 成功路径", async () => {
      setupSuccessMocks();
      vi.mocked(createBackupExport).mockResolvedValue({
        mode: "DIRECT",
        sizeBytes: 1024,
        checksum: "abc123",
        data: "base64data",
      } as never);

      const { exportBackup } = await import("@/actions/backup");
      const result = await exportBackup({
        access_token: "valid-token",
        scope: "CONTENT",
      });

      expect(result).toEqual(expect.objectContaining({ success: true }));
    });

    it("导出失败返回 500", async () => {
      setupSuccessMocks();
      vi.mocked(createBackupExport).mockRejectedValue(new Error("导出失败"));

      const { exportBackup } = await import("@/actions/backup");
      const result = await exportBackup({
        access_token: "valid-token",
        scope: "CONTENT",
      });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 500 }),
      );
    });
  });

  // ==========================================================================
  // initBackupImportUpload
  // ==========================================================================
  describe("initBackupImportUpload", () => {
    it("初始化上传 - 成功路径", async () => {
      setupSuccessMocks();
      vi.mocked(initBackupImportUploadService).mockResolvedValue({
        strategy: "DIRECT_UPLOAD",
        providerType: "LOCAL",
        uploadUrl: "https://example.com/upload",
      } as never);

      const { initBackupImportUpload } = await import("@/actions/backup");
      const result = await initBackupImportUpload({
        access_token: "valid-token",
        fileName: "backup.zip",
        fileSize: 1024,
        contentType: "application/zip",
      });

      expect(result).toEqual(expect.objectContaining({ success: true }));
    });

    it("初始化失败返回 400", async () => {
      setupSuccessMocks();
      vi.mocked(initBackupImportUploadService).mockRejectedValue(
        new Error("初始化失败"),
      );

      const { initBackupImportUpload } = await import("@/actions/backup");
      const result = await initBackupImportUpload({
        access_token: "valid-token",
        fileName: "backup.zip",
        fileSize: 1024,
        contentType: "application/zip",
      });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 400 }),
      );
    });
  });

  // ==========================================================================
  // dryRunBackupImport
  // ==========================================================================
  describe("dryRunBackupImport", () => {
    it("预检通过 - 成功路径", async () => {
      setupSuccessMocks();
      vi.mocked(dryRunBackupImportService).mockResolvedValue({
        scope: "CONTENT",
        checksum: "abc123",
        ready: true,
        issues: [],
        sizeBytes: 1024,
      } as never);

      const { dryRunBackupImport } = await import("@/actions/backup");
      const result = await dryRunBackupImport({
        access_token: "valid-token",
        source: { type: "DIRECT", content: "base64content" },
        scope: "CONTENT",
      });

      expect(result).toEqual(expect.objectContaining({ success: true }));
    });

    it("内容过大返回 400", async () => {
      setupSuccessMocks();
      const largeContent = "x".repeat(5 * 1024 * 1024);

      const { dryRunBackupImport } = await import("@/actions/backup");
      const result = await dryRunBackupImport({
        access_token: "valid-token",
        source: { type: "DIRECT", content: largeContent },
        scope: "CONTENT",
      });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 400 }),
      );
    });
  });

  // ==========================================================================
  // importBackup
  // ==========================================================================
  describe("importBackup", () => {
    it("执行导入 - 成功路径", async () => {
      setupSuccessMocks();
      vi.mocked(importBackupService).mockResolvedValue({
        scope: "CONTENT",
        checksum: "abc123",
        summary: { deletedRows: 0, insertedRows: 10 },
      } as never);

      const { importBackup } = await import("@/actions/backup");
      const result = await importBackup({
        access_token: "valid-token",
        source: { type: "DIRECT", content: "base64content" },
        scope: "CONTENT",
        expectedChecksum: "abc123",
        confirmText: "CONFIRM",
      });

      expect(result).toEqual(expect.objectContaining({ success: true }));
    });

    it("导入失败返回 400", async () => {
      setupSuccessMocks();
      vi.mocked(importBackupService).mockRejectedValue(new Error("导入失败"));

      const { importBackup } = await import("@/actions/backup");
      const result = await importBackup({
        access_token: "valid-token",
        source: { type: "DIRECT", content: "base64content" },
        scope: "CONTENT",
        expectedChecksum: "abc123",
        confirmText: "CONFIRM",
      });

      expect(result).toEqual(
        expect.objectContaining({ success: false, status: 400 }),
      );
    });
  });
});
