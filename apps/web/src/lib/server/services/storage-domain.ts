import "server-only";

import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type {
  CreateStorage,
  CreateStorageResponseWrapper,
  DeleteStorage,
  DeleteStorageResponseWrapper,
  GetStorageDetail,
  GetStorageDetailResponse,
  GetStorageList,
  GetStorageListResponse,
  SetDefaultStorage,
  SetDefaultStorageResponseWrapper,
  ToggleStorageStatus,
  ToggleStorageStatusResponseWrapper,
  UpdateStorage,
  UpdateStorageResponseWrapper,
} from "@repo/shared-types/api/storage";
import {
  CreateStorageSchema,
  DeleteStorageSchema,
  GetStorageDetailSchema,
  GetStorageListSchema,
  SetDefaultStorageSchema,
  ToggleStorageStatusSchema,
  UpdateStorageSchema,
} from "@repo/shared-types/api/storage";
import { headers } from "next/headers";
import type { NextResponse } from "next/server";

import { logAuditEvent } from "@/lib/server/audit";
import { authVerify } from "@/lib/server/auth-verify";
import { deleteObject, uploadObject } from "@/lib/server/oss";
import prisma from "@/lib/server/prisma";
import limitControl from "@/lib/server/rate-limit";
import ResponseBuilder from "@/lib/server/response";
import { validateData } from "@/lib/server/validator";
import { isVirtualStorage } from "@/lib/server/virtual-storage";
import type { StorageProviderType } from "@/template/storages";

type ActionEnvironment = "serverless" | "serveraction";
type ActionConfig = { environment?: ActionEnvironment };
type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

// ---------------------------------------------------------------------------
// Storage connectivity check: upload a tiny file then delete
// ---------------------------------------------------------------------------

async function verifyStorageConnectivity(params: {
  type: StorageProviderType;
  baseUrl: string;
  pathTemplate?: string;
  config: unknown;
  skip?: boolean;
}) {
  if (params.skip) return;

  const pathTemplate = params.pathTemplate || "/{year}/{month}/{filename}";
  const testFile = {
    buffer: Buffer.from("healthcheck"),
    filename: "healthcheck.txt",
    contentType: "text/plain",
  };

  const basePayload = {
    baseUrl: params.baseUrl,
    pathTemplate,
    ensureUniqueName: true,
    file: testFile,
  } as const;

  try {
    let result;
    switch (params.type) {
      case "LOCAL":
        result = await uploadObject({
          ...basePayload,
          type: "LOCAL",
          config: params.config as unknown as {
            rootDir: string;
            createDirIfNotExists?: boolean;
            fileMode?: string | number;
            dirMode?: string | number;
          },
        });
        await deleteObject({
          type: "LOCAL",
          baseUrl: params.baseUrl,
          pathTemplate,
          config: params.config as unknown as {
            rootDir: string;
            createDirIfNotExists?: boolean;
            fileMode?: string | number;
            dirMode?: string | number;
          },
          key: result.key,
        });
        break;
      case "AWS_S3":
        result = await uploadObject({
          ...basePayload,
          type: "AWS_S3",
          config: params.config as unknown as {
            accessKeyId: string;
            secretAccessKey: string;
            region: string;
            bucket: string;
            endpoint?: string;
            basePath?: string;
            forcePathStyle?: boolean | string;
            acl?: string;
          },
        });
        await deleteObject({
          type: "AWS_S3",
          baseUrl: params.baseUrl,
          pathTemplate,
          config: params.config as unknown as {
            accessKeyId: string;
            secretAccessKey: string;
            region: string;
            bucket: string;
            endpoint?: string;
            basePath?: string;
            forcePathStyle?: boolean | string;
            acl?: string;
          },
          key: result.key,
        });
        break;
      case "VERCEL_BLOB":
        result = await uploadObject({
          ...basePayload,
          type: "VERCEL_BLOB",
          config: params.config as unknown as {
            token: string;
            basePath?: string;
            access?: "public" | "private";
            cacheControl?: string;
          },
        });
        await deleteObject({
          type: "VERCEL_BLOB",
          baseUrl: params.baseUrl,
          pathTemplate,
          config: params.config as unknown as {
            token: string;
            basePath?: string;
            access?: "public" | "private";
            cacheControl?: string;
          },
          key: result.key,
        });
        break;
      case "GITHUB_PAGES":
        {
          const githubConfig =
            (params.config as {
              owner: string;
              repo: string;
              branch: string;
              token: string;
              basePath?: string;
              committerName?: string;
              committerEmail?: string;
              apiBaseUrl?: string;
              commitMessageTemplate?: string;
            }) || {};
          const commitMessageTemplate =
            githubConfig.commitMessageTemplate ||
            "chore(cms): storage healthcheck {{filename}}";

          result = await uploadObject({
            ...basePayload,
            type: "GITHUB_PAGES",
            config: { ...githubConfig, commitMessageTemplate },
          });
          await deleteObject({
            type: "GITHUB_PAGES",
            baseUrl: params.baseUrl,
            pathTemplate,
            config: { ...githubConfig, commitMessageTemplate },
            key: result.key,
          });
        }
        break;
      case "EXTERNAL_URL":
        // 外部URL存储不需要额外的验证，只需验证URL可访问
        await uploadObject({
          type: "EXTERNAL_URL",
          baseUrl: params.baseUrl,
          config: {},
          file: {
            buffer: Buffer.from("test"),
            filename: "test.txt",
            contentType: "text/plain",
          },
        });
        break;
      default:
        throw new Error(
          `Unsupported storage type: ${params.type satisfies never}`,
        );
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "连接测试失败，未知错误";
    throw new Error(`存储连通性校验失败：${message}`);
  }
}

// ============================================================================
// Get Storage List
// ============================================================================

export async function getStorageList(
  params: GetStorageList,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<GetStorageListResponse["data"] | null>>>;
export async function getStorageList(
  params: GetStorageList,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<GetStorageListResponse["data"] | null>>;
export async function getStorageList(
  {
    access_token,
    page,
    pageSize,
    sortBy,
    sortOrder,
    search,
    type,
    isActive,
    isDefault,
  }: GetStorageList,
  serverConfig?: ActionConfig,
): Promise<ActionResult<GetStorageListResponse["data"] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getStorageList"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      page,
      pageSize,
      sortBy,
      sortOrder,
      search,
      type,
      isActive,
      isDefault,
    },
    GetStorageListSchema,
  );

  if (validationError) return response.badRequest(validationError);

  // 身份验证
  const user = await authVerify({
    allowedRoles: ["ADMIN"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    const skip = (page - 1) * pageSize;
    const where: Record<string, unknown> = {};

    // 搜索条件
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { displayName: { contains: search, mode: "insensitive" } },
      ];
    }

    // 类型筛选
    if (type !== undefined) {
      where.type = type;
    }

    // 状态筛选
    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    // 默认存储筛选
    if (isDefault !== undefined) {
      where.isDefault = isDefault;
    }

    // 获取总数和数据
    const [total, storageProviders] = await Promise.all([
      prisma.storageProvider.count({ where }),
      prisma.storageProvider.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { [sortBy]: sortOrder },
        include: {
          _count: {
            select: {
              media: true,
            },
          },
        },
      }),
    ]);

    // 计算每个存储提供商的文件总大小
    const providerIds = storageProviders.map((p) => p.id);
    const sizeSums = await prisma.media.groupBy({
      by: ["storageProviderId"],
      where: {
        storageProviderId: {
          in: providerIds,
        },
      },
      _sum: {
        size: true,
      },
    });

    // 创建一个 Map 以便快速查找
    const sizeMap = new Map(
      sizeSums.map((item) => [item.storageProviderId, item._sum.size || 0]),
    );

    const items = storageProviders.map((provider) => ({
      id: provider.id,
      name: provider.name,
      type: provider.type,
      displayName: provider.displayName,
      baseUrl: provider.baseUrl,
      isActive: provider.isActive,
      isDefault: provider.isDefault,
      maxFileSize: provider.maxFileSize,
      pathTemplate: provider.pathTemplate,
      mediaCount: provider._count.media,
      totalSize: sizeMap.get(provider.id) || 0,
      createdAt: provider.createdAt.toISOString(),
      updatedAt: provider.updatedAt.toISOString(),
    }));

    return response.ok({
      data: items,
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        hasNext: page < Math.ceil(total / pageSize),
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    console.error("GetStorageList error:", error);
    return response.serverError();
  }
}

// ============================================================================
// Get Storage Detail
// ============================================================================

export async function getStorageDetail(
  params: GetStorageDetail,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<GetStorageDetailResponse["data"] | null>>>;
export async function getStorageDetail(
  params: GetStorageDetail,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<GetStorageDetailResponse["data"] | null>>;
export async function getStorageDetail(
  { access_token, id }: GetStorageDetail,
  serverConfig?: ActionConfig,
): Promise<ActionResult<GetStorageDetailResponse["data"] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getStorageDetail"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      id,
    },
    GetStorageDetailSchema,
  );

  if (validationError) return response.badRequest(validationError);

  // 身份验证
  const user = await authVerify({
    allowedRoles: ["ADMIN"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    const storageProvider = await prisma.storageProvider.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            media: true,
          },
        },
      },
    });

    if (!storageProvider) {
      return response.notFound();
    }

    // 计算文件总大小
    const sizeSum = await prisma.media.aggregate({
      where: {
        storageProviderId: id,
      },
      _sum: {
        size: true,
      },
    });

    const data = {
      id: storageProvider.id,
      name: storageProvider.name,
      type: storageProvider.type,
      displayName: storageProvider.displayName,
      baseUrl: storageProvider.baseUrl,
      isActive: storageProvider.isActive,
      isDefault: storageProvider.isDefault,
      maxFileSize: storageProvider.maxFileSize,
      pathTemplate: storageProvider.pathTemplate,
      config: storageProvider.config,
      mediaCount: storageProvider._count.media,
      totalSize: sizeSum._sum.size || 0,
      createdAt: storageProvider.createdAt.toISOString(),
      updatedAt: storageProvider.updatedAt.toISOString(),
    };

    return response.ok({ data });
  } catch (error) {
    console.error("GetStorageDetail error:", error);
    return response.serverError();
  }
}

// ============================================================================
// Create Storage
// ============================================================================

export async function createStorage(
  params: CreateStorage,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<ApiResponse<CreateStorageResponseWrapper["data"] | null>>
>;
export async function createStorage(
  params: CreateStorage,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CreateStorageResponseWrapper["data"] | null>>;
export async function createStorage(
  {
    access_token,
    name,
    type,
    displayName,
    baseUrl,
    isActive,
    isDefault,
    maxFileSize,
    pathTemplate,
    config,
  }: CreateStorage,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CreateStorageResponseWrapper["data"] | null>> {
  const environment = serverConfig?.environment || "serveraction";
  const response = new ResponseBuilder(environment);

  if (!(await limitControl(await headers(), "createStorage"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      name,
      type,
      displayName,
      baseUrl,
      isActive,
      isDefault,
      maxFileSize,
      pathTemplate,
      config,
    },
    CreateStorageSchema,
  );

  if (validationError) return response.badRequest(validationError);

  // 身份验证
  const user = await authVerify({
    allowedRoles: ["ADMIN"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    // Connectivity check: fail fast to avoid saving bad configs
    const pathTpl = pathTemplate || "/{year}/{month}/{filename}";
    const shouldTest = isActive !== false;
    await verifyStorageConnectivity({
      type,
      baseUrl,
      pathTemplate: pathTpl,
      config: config || {},
      skip: !shouldTest,
    });

    // If set as default, clear other defaults first
    if (isDefault) {
      await prisma.storageProvider.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }

    const storageProvider = await prisma.storageProvider.create({
      data: {
        name,
        type,
        displayName,
        baseUrl,
        isActive,
        isDefault,
        maxFileSize,
        pathTemplate,
        config: config || {},
      },
    });

    // 记录审计日志
    const { after } = await import("next/server");
    after(async () => {
      await logAuditEvent({
        user: {
          uid: String(user.uid),
        },
        details: {
          action: "CREATE",
          resourceType: "STORAGE_PROVIDER",
          resourceId: storageProvider.id,
          value: {
            old: null,
            new: {
              name: storageProvider.name,
              type: storageProvider.type,
              displayName: storageProvider.displayName,
              isActive: storageProvider.isActive,
              isDefault: storageProvider.isDefault,
            },
          },
          description: `创建存储提供商: ${storageProvider.name}`,
        },
      });
    });

    const data = {
      id: storageProvider.id,
      name: storageProvider.name,
      type: storageProvider.type,
      displayName: storageProvider.displayName,
      baseUrl: storageProvider.baseUrl,
      isActive: storageProvider.isActive,
      isDefault: storageProvider.isDefault,
      maxFileSize: storageProvider.maxFileSize,
      pathTemplate: storageProvider.pathTemplate,
      createdAt: storageProvider.createdAt.toISOString(),
      updatedAt: storageProvider.updatedAt.toISOString(),
    };

    return response.ok({ data });
  } catch (error: unknown) {
    console.error("CreateStorage error:", error);
    if (
      error instanceof Error &&
      error.message.includes("存储连通性校验失败")
    ) {
      return response.badRequest({
        message: error.message,
        error: { code: "BAD_REQUEST", message: error.message },
      });
    }
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "P2002"
    ) {
      return response.conflict({ message: "存储名称已存在" });
    }
    return response.serverError();
  }
}

// ============================================================================
// Update Storage
// ============================================================================

export async function updateStorage(
  params: UpdateStorage,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<ApiResponse<UpdateStorageResponseWrapper["data"] | null>>
>;
export async function updateStorage(
  params: UpdateStorage,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<UpdateStorageResponseWrapper["data"] | null>>;
export async function updateStorage(
  {
    access_token,
    id,
    name,
    displayName,
    baseUrl,
    isActive,
    isDefault,
    maxFileSize,
    pathTemplate,
    config,
  }: UpdateStorage,
  serverConfig?: ActionConfig,
): Promise<ActionResult<UpdateStorageResponseWrapper["data"] | null>> {
  const environment = serverConfig?.environment || "serveraction";
  const response = new ResponseBuilder(environment);

  if (!(await limitControl(await headers(), "updateStorage"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      id,
      name,
      displayName,
      baseUrl,
      isActive,
      isDefault,
      maxFileSize,
      pathTemplate,
      config,
    },
    UpdateStorageSchema,
  );

  if (validationError) return response.badRequest(validationError);

  // 身份验证
  const user = await authVerify({
    allowedRoles: ["ADMIN"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    const existingStorage = await prisma.storageProvider.findUnique({
      where: { id },
    });

    if (!existingStorage) {
      return response.notFound();
    }

    // 保护虚拟存储提供商
    if (isVirtualStorage(existingStorage)) {
      return response.forbidden({
        message: "虚拟存储提供商不允许修改",
        error: { code: "FORBIDDEN", message: "系统保护的存储提供商" },
      });
    }

    // Connectivity check: skip when disabling, otherwise block bad configs
    const effectiveBaseUrl = baseUrl ?? existingStorage.baseUrl;
    const effectivePathTemplate =
      pathTemplate ??
      existingStorage.pathTemplate ??
      "/{year}/{month}/{filename}";
    const effectiveConfig = config ?? existingStorage.config ?? {};
    const shouldTest = (isActive ?? existingStorage.isActive) !== false;
    await verifyStorageConnectivity({
      type: existingStorage.type,
      baseUrl: effectiveBaseUrl,
      pathTemplate: effectivePathTemplate,
      config: effectiveConfig,
      skip: !shouldTest,
    });

    // If set as default, clear other defaults first
    if (isDefault && !existingStorage.isDefault) {
      await prisma.storageProvider.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (displayName !== undefined) updateData.displayName = displayName;
    if (baseUrl !== undefined) updateData.baseUrl = baseUrl;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (isDefault !== undefined) updateData.isDefault = isDefault;
    if (maxFileSize !== undefined) updateData.maxFileSize = maxFileSize;
    if (pathTemplate !== undefined) updateData.pathTemplate = pathTemplate;
    if (config !== undefined) updateData.config = config;

    const storageProvider = await prisma.storageProvider.update({
      where: { id },
      data: updateData,
    });

    // 记录审计日志
    const auditOldValue: Record<string, unknown> = {};
    const auditNewValue: Record<string, unknown> = {};

    Object.entries(updateData).forEach(([key, value]) => {
      // Config comparison might need JSON stringify if it's an object
      const oldValue = existingStorage[key as keyof typeof existingStorage];
      if (JSON.stringify(value) !== JSON.stringify(oldValue)) {
        auditOldValue[key] = oldValue;
        auditNewValue[key] = value;
      }
    });

    if (Object.keys(auditNewValue).length > 0) {
      const { after } = await import("next/server");
      after(async () => {
        await logAuditEvent({
          user: {
            uid: String(user.uid),
          },
          details: {
            action: "UPDATE",
            resourceType: "STORAGE_PROVIDER",
            resourceId: storageProvider.id,
            value: {
              old: auditOldValue,
              new: auditNewValue,
            },
            description: `更新存储提供商: ${storageProvider.name}`,
          },
        });
      });
    }

    const data = {
      id: storageProvider.id,
      name: storageProvider.name,
      type: storageProvider.type,
      displayName: storageProvider.displayName,
      baseUrl: storageProvider.baseUrl,
      isActive: storageProvider.isActive,
      isDefault: storageProvider.isDefault,
      maxFileSize: storageProvider.maxFileSize,
      pathTemplate: storageProvider.pathTemplate,
      config: storageProvider.config,
      updatedAt: storageProvider.updatedAt.toISOString(),
    };

    return response.ok({ data });
  } catch (error: unknown) {
    console.error("UpdateStorage error:", error);
    if (
      error instanceof Error &&
      error.message.includes("存储连通性校验失败")
    ) {
      return response.badRequest({
        message: error.message,
        error: { code: "BAD_REQUEST", message: error.message },
      });
    }
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "P2002"
    ) {
      return response.conflict({ message: "存储名称已存在" });
    }
    return response.serverError();
  }
}

// ============================================================================
// Delete Storage
// ============================================================================

export async function deleteStorage(
  params: DeleteStorage,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<ApiResponse<DeleteStorageResponseWrapper["data"] | null>>
>;
export async function deleteStorage(
  params: DeleteStorage,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<DeleteStorageResponseWrapper["data"] | null>>;
export async function deleteStorage(
  { access_token, ids }: DeleteStorage,
  serverConfig?: ActionConfig,
): Promise<ActionResult<DeleteStorageResponseWrapper["data"] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "deleteStorage"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      ids,
    },
    DeleteStorageSchema,
  );

  if (validationError) return response.badRequest(validationError);

  // 身份验证
  const user = await authVerify({
    allowedRoles: ["ADMIN"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    // 检查是否包含虚拟存储提供商
    const storageProviders = await prisma.storageProvider.findMany({
      where: {
        id: {
          in: ids,
        },
      },
      select: {
        id: true,
        name: true,
      },
    });

    const virtualStorages = storageProviders.filter((s) => isVirtualStorage(s));
    if (virtualStorages.length > 0) {
      return response.forbidden({
        message: "虚拟存储提供商不允许删除",
        error: { code: "FORBIDDEN", message: "系统保护的存储提供商" },
      });
    }

    // 检查是否有媒体文件关联
    const mediaCount = await prisma.media.count({
      where: {
        storageProviderId: {
          in: ids,
        },
      },
    });

    if (mediaCount > 0) {
      return response.badRequest({
        message: "无法删除已有关联媒体文件的存储提供商",
      });
    }

    const result = await prisma.storageProvider.deleteMany({
      where: {
        id: {
          in: ids,
        },
      },
    });

    // 记录审计日志
    if (result.count > 0) {
      const { after } = await import("next/server");
      after(async () => {
        await logAuditEvent({
          user: {
            uid: String(user.uid),
          },
          details: {
            action: "DELETE",
            resourceType: "STORAGE_PROVIDER",
            resourceId: ids.join(","),
            value: {
              old: { ids },
              new: null,
            },
            description: `批量删除存储提供商: ${result.count} 个`,
          },
        });
      });
    }

    const data = {
      deleted: result.count,
      ids,
    };

    return response.ok({ data });
  } catch (error) {
    console.error("DeleteStorage error:", error);
    return response.serverError();
  }
}

// ============================================================================
// Toggle Storage Status
// ============================================================================

export async function toggleStorageStatus(
  params: ToggleStorageStatus,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<ApiResponse<ToggleStorageStatusResponseWrapper["data"]>>
>;
export async function toggleStorageStatus(
  params: ToggleStorageStatus,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<ToggleStorageStatusResponseWrapper["data"]>>;
export async function toggleStorageStatus(
  { access_token, id, isActive }: ToggleStorageStatus,
  serverConfig?: ActionConfig,
): Promise<ActionResult<ToggleStorageStatusResponseWrapper["data"] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "toggleStorageStatus"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      id,
      isActive,
    },
    ToggleStorageStatusSchema,
  );

  if (validationError) return response.badRequest(validationError);

  // 身份验证
  const user = await authVerify({
    allowedRoles: ["ADMIN"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    const storageProvider = await prisma.storageProvider.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        isActive: true,
      },
    });

    if (!storageProvider) {
      return response.notFound();
    }

    // 保护虚拟存储提供商
    if (isVirtualStorage(storageProvider)) {
      return response.forbidden({
        message: "虚拟存储提供商不允许停用",
        error: { code: "FORBIDDEN", message: "系统保护的存储提供商" },
      });
    }

    const updatedStorage = await prisma.storageProvider.update({
      where: { id },
      data: { isActive },
    });

    // 记录审计日志
    const { after } = await import("next/server");
    after(async () => {
      await logAuditEvent({
        user: {
          uid: String(user.uid),
        },
        details: {
          action: "UPDATE",
          resourceType: "STORAGE_PROVIDER",
          resourceId: updatedStorage.id,
          value: {
            old: { isActive: storageProvider.isActive },
            new: { isActive: updatedStorage.isActive },
          },
          description: `${isActive ? "启用" : "停用"}存储提供商: ${updatedStorage.name}`,
        },
      });
    });

    const data = {
      id: updatedStorage.id,
      isActive: updatedStorage.isActive,
      updatedAt: updatedStorage.updatedAt.toISOString(),
    };

    return response.ok({ data });
  } catch (error) {
    console.error("ToggleStorageStatus error:", error);
    return response.serverError();
  }
}

// ============================================================================
// Set Default Storage
// ============================================================================

export async function setDefaultStorage(
  params: SetDefaultStorage,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<SetDefaultStorageResponseWrapper["data"]>>>;
export async function setDefaultStorage(
  params: SetDefaultStorage,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<SetDefaultStorageResponseWrapper["data"]>>;
export async function setDefaultStorage(
  { access_token, id }: SetDefaultStorage,
  serverConfig?: ActionConfig,
): Promise<ActionResult<SetDefaultStorageResponseWrapper["data"] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "setDefaultStorage"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      id,
    },
    SetDefaultStorageSchema,
  );

  if (validationError) return response.badRequest(validationError);

  // 身份验证
  const user = await authVerify({
    allowedRoles: ["ADMIN"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    // 检查目标存储提供商是否存在
    const targetStorage = await prisma.storageProvider.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
      },
    });

    if (!targetStorage) {
      return response.notFound();
    }

    // 保护虚拟存储提供商
    if (isVirtualStorage(targetStorage)) {
      return response.forbidden({
        message: "虚拟存储提供商不允许设为默认",
        error: { code: "FORBIDDEN", message: "系统保护的存储提供商" },
      });
    }

    await prisma.$transaction(async (tx) => {
      // 先将所有存储设为非默认
      await tx.storageProvider.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });

      // 将指定存储设为默认
      await tx.storageProvider.update({
        where: { id },
        data: { isDefault: true },
      });
    });

    // 记录审计日志
    const { after } = await import("next/server");
    after(async () => {
      await logAuditEvent({
        user: {
          uid: String(user.uid),
        },
        details: {
          action: "UPDATE",
          resourceType: "STORAGE_PROVIDER",
          resourceId: id,
          value: {
            old: { isDefault: false },
            new: { isDefault: true },
          },
          description: `设置默认存储提供商: ${targetStorage.name}`,
        },
      });
    });

    const data = {
      id,
      isDefault: true,
      updatedAt: new Date().toISOString(),
    };

    return response.ok({ data });
  } catch (error) {
    console.error("SetDefaultStorage error:", error);
    return response.serverError();
  }
}
