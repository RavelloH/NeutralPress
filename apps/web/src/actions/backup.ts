"use server";

import type {
  DryRunBackupImport,
  ExportBackup,
  GetBackupScopes,
  ImportBackup,
  InitBackupImportUpload,
} from "@repo/shared-types/api/backup";
import {
  DryRunBackupImportSchema,
  ExportBackupSchema,
  ImportBackupSchema,
  InitBackupImportUploadSchema,
} from "@repo/shared-types/api/backup";
import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import { headers } from "next/headers";
import type { NextResponse } from "next/server";

import { logAuditEvent } from "@/lib/server/audit";
import { authVerify } from "@/lib/server/auth-verify";
import type { getBackupScopes as getBackupScopesService } from "@/lib/server/backup";
import {
  BACKUP_DIRECT_LIMIT_BYTES,
  createBackupExport,
  dryRunBackupImport as dryRunBackupImportService,
  importBackup as importBackupService,
  initBackupImportUpload as initBackupImportUploadService,
} from "@/lib/server/backup";
import limitControl from "@/lib/server/rate-limit";
import ResponseBuilder from "@/lib/server/response";
import * as backupScopesDomain from "@/lib/server/services/backup-scopes-domain";
import { validateData } from "@/lib/server/validator";

type ActionEnvironment = "serverless" | "serveraction";
type ActionConfig = { environment?: ActionEnvironment };
type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}

/*
  getBackupScopes - 获取备份分组定义
*/
export async function getBackupScopes(
  params: GetBackupScopes,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<ApiResponse<ReturnType<typeof getBackupScopesService> | null>>
>;

export async function getBackupScopes(
  params: GetBackupScopes,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<ReturnType<typeof getBackupScopesService> | null>>;
export async function getBackupScopes(
  { access_token }: GetBackupScopes,
  serverConfig?: ActionConfig,
): Promise<ActionResult<ReturnType<typeof getBackupScopesService> | null>> {
  return backupScopesDomain.getBackupScopes({ access_token }, serverConfig);
}

/*
  exportBackup - 导出备份（直连/OSS）
*/
export async function exportBackup(
  params: ExportBackup,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<
    ApiResponse<Awaited<ReturnType<typeof createBackupExport>> | null>
  >
>;
export async function exportBackup(
  params: ExportBackup,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<Awaited<ReturnType<typeof createBackupExport>> | null>>;
export async function exportBackup(
  { access_token, scope, mode }: ExportBackup,
  serverConfig?: ActionConfig,
): Promise<
  ActionResult<Awaited<ReturnType<typeof createBackupExport>> | null>
> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "exportBackup"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      scope,
      mode,
    },
    ExportBackupSchema,
  );
  if (validationError) return response.badRequest(validationError);

  const user = await authVerify({
    allowedRoles: ["ADMIN"],
    accessToken: access_token,
  });
  if (!user) {
    return response.unauthorized();
  }

  try {
    const result = await createBackupExport(scope, mode ?? "AUTO");

    await logAuditEvent({
      user: { uid: String(user.uid) },
      details: {
        action: "EXPORT",
        resourceType: "BACKUP",
        resourceId: scope,
        value: {
          old: null,
          new: {
            scope,
            mode: result.mode,
            sizeBytes: result.sizeBytes,
            checksum: "checksum" in result ? result.checksum : null,
          },
        },
        description: `导出备份 (${scope})`,
        metadata: {
          mode: result.mode,
        },
      },
    });

    return response.ok({
      data: result,
      message:
        result.mode === "OSS_REQUIRED"
          ? "文件过大，建议使用 OSS 导出模式"
          : "备份导出成功",
    });
  } catch (error) {
    console.error("Export backup error:", error);
    return response.serverError({
      message: toErrorMessage(error, "导出备份失败"),
      error: {
        code: "BACKUP_EXPORT_FAILED",
        message: toErrorMessage(error, "导出备份失败"),
      },
    });
  }
}

/*
  initBackupImportUpload - 初始化 OSS 导入上传
*/
export async function initBackupImportUpload(
  params: InitBackupImportUpload,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<
    ApiResponse<Awaited<
      ReturnType<typeof initBackupImportUploadService>
    > | null>
  >
>;
export async function initBackupImportUpload(
  params: InitBackupImportUpload,
  serverConfig?: ActionConfig,
): Promise<
  ApiResponse<Awaited<ReturnType<typeof initBackupImportUploadService>> | null>
>;
export async function initBackupImportUpload(
  { access_token, fileName, fileSize, contentType }: InitBackupImportUpload,
  serverConfig?: ActionConfig,
): Promise<
  ActionResult<Awaited<ReturnType<typeof initBackupImportUploadService>> | null>
> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "initBackupImportUpload"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      fileName,
      fileSize,
      contentType,
    },
    InitBackupImportUploadSchema,
  );
  if (validationError) return response.badRequest(validationError);

  const user = await authVerify({
    allowedRoles: ["ADMIN"],
    accessToken: access_token,
  });
  if (!user) {
    return response.unauthorized();
  }

  try {
    const result = await initBackupImportUploadService({
      fileName,
      fileSize,
      contentType,
    });

    await logAuditEvent({
      user: { uid: String(user.uid) },
      details: {
        action: "UPLOAD",
        resourceType: "BACKUP",
        resourceId: fileName,
        value: {
          old: null,
          new: {
            fileName,
            fileSize,
            strategy: result.strategy,
            providerType: result.providerType,
          },
        },
        description: "初始化备份导入上传",
      },
    });

    return response.ok({
      data: result,
      message:
        result.strategy === "UNSUPPORTED"
          ? result.message
          : "已生成上传凭据，请开始上传文件",
    });
  } catch (error) {
    console.error("Init backup import upload error:", error);
    return response.badRequest({
      message: toErrorMessage(error, "初始化上传失败"),
      error: {
        code: "BACKUP_IMPORT_UPLOAD_INIT_FAILED",
        message: toErrorMessage(error, "初始化上传失败"),
      },
    });
  }
}

/*
  dryRunBackupImport - 备份导入预检
*/
export async function dryRunBackupImport(
  params: DryRunBackupImport,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<
    ApiResponse<Awaited<ReturnType<typeof dryRunBackupImportService>> | null>
  >
>;
export async function dryRunBackupImport(
  params: DryRunBackupImport,
  serverConfig?: ActionConfig,
): Promise<
  ApiResponse<Awaited<ReturnType<typeof dryRunBackupImportService>> | null>
>;
export async function dryRunBackupImport(
  { access_token, source, scope }: DryRunBackupImport,
  serverConfig?: ActionConfig,
): Promise<
  ActionResult<Awaited<ReturnType<typeof dryRunBackupImportService>> | null>
> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "dryRunBackupImport"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      source,
      scope,
      mode: "REPLACE",
    },
    DryRunBackupImportSchema,
  );
  if (validationError) return response.badRequest(validationError);

  const user = await authVerify({
    allowedRoles: ["ADMIN"],
    accessToken: access_token,
  });
  if (!user) {
    return response.unauthorized();
  }

  if (
    source.type === "DIRECT" &&
    Buffer.byteLength(source.content, "utf8") > BACKUP_DIRECT_LIMIT_BYTES
  ) {
    return response.badRequest({
      message: "直连导入内容超过安全上限，请改用 OSS URL 模式",
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "直连导入内容超过 4MB 安全上限",
      },
    });
  }

  try {
    const result = await dryRunBackupImportService({
      source,
      scope,
    });

    await logAuditEvent({
      user: { uid: String(user.uid) },
      details: {
        action: "DRY_RUN",
        resourceType: "BACKUP",
        resourceId: result.scope,
        value: {
          old: null,
          new: {
            scope: result.scope,
            checksum: result.checksum,
            ready: result.ready,
            issueCount: result.issues.length,
            sizeBytes: result.sizeBytes,
          },
        },
        description: `备份导入预检 (${result.scope})`,
      },
    });

    return response.ok({
      data: result,
      message: result.ready ? "预检通过" : "预检存在风险，请先处理",
    });
  } catch (error) {
    console.error("Dry-run backup import error:", error);
    return response.badRequest({
      message: toErrorMessage(error, "预检失败"),
      error: {
        code: "BACKUP_DRY_RUN_FAILED",
        message: toErrorMessage(error, "预检失败"),
      },
    });
  }
}

/*
  importBackup - 执行导入
*/
export async function importBackup(
  params: ImportBackup,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<
    ApiResponse<Awaited<ReturnType<typeof importBackupService>> | null>
  >
>;
export async function importBackup(
  params: ImportBackup,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<Awaited<ReturnType<typeof importBackupService>> | null>>;
export async function importBackup(
  { access_token, source, scope, expectedChecksum, confirmText }: ImportBackup,
  serverConfig?: ActionConfig,
): Promise<
  ActionResult<Awaited<ReturnType<typeof importBackupService>> | null>
> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "importBackup"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      source,
      scope,
      mode: "REPLACE",
      expectedChecksum,
      confirmText,
    },
    ImportBackupSchema,
  );
  if (validationError) return response.badRequest(validationError);

  const user = await authVerify({
    allowedRoles: ["ADMIN"],
    accessToken: access_token,
  });
  if (!user) {
    return response.unauthorized();
  }

  if (
    source.type === "DIRECT" &&
    Buffer.byteLength(source.content, "utf8") > BACKUP_DIRECT_LIMIT_BYTES
  ) {
    return response.badRequest({
      message: "直连导入内容超过安全上限，请改用 OSS URL 模式",
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "直连导入内容超过 4MB 安全上限",
      },
    });
  }

  try {
    const result = await importBackupService({
      source,
      scope,
      expectedChecksum,
      confirmText,
    });

    await logAuditEvent({
      user: { uid: String(user.uid) },
      details: {
        action: "IMPORT",
        resourceType: "BACKUP",
        resourceId: result.scope,
        value: {
          old: null,
          new: {
            scope: result.scope,
            checksum: result.checksum,
            deletedRows: result.summary.deletedRows,
            insertedRows: result.summary.insertedRows,
          },
        },
        description: `执行备份导入 (${result.scope})`,
      },
    });

    try {
      const { revalidatePath, updateTag } = await import("next/cache");
      const { collectBootstrapTags, getCriticalRevalidatePathTargets } =
        await import("@/lib/server/cache-bootstrap-targets");
      const tags = await collectBootstrapTags();
      for (const tag of tags) {
        updateTag(tag);
      }
      const pathTargets = getCriticalRevalidatePathTargets();
      for (const target of pathTargets) {
        revalidatePath(target.path, target.type);
      }
    } catch (cacheError) {
      console.error(
        "Refresh bootstrap caches after backup import failed:",
        cacheError,
      );
    }

    return response.ok({
      data: result,
      message: "备份导入成功",
    });
  } catch (error) {
    console.error("Import backup error:", error);
    return response.badRequest({
      message: toErrorMessage(error, "导入失败"),
      error: {
        code: "BACKUP_IMPORT_FAILED",
        message: toErrorMessage(error, "导入失败"),
      },
    });
  }
}
