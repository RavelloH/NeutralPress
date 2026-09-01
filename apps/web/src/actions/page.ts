"use server";
import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type {
  CreatePage,
  CreatePageResult,
  DeletePages,
  GetPageDetail,
  GetPagesList,
  PageDetail,
  PageListItem,
  UpdatePage,
  UpdatePageResult,
  UpdatePages,
} from "@repo/shared-types/api/page";
import {
  CreatePageSchema,
  DeletePagesSchema,
  GetPageDetailSchema,
  GetPagesListSchema,
  UpdatePageSchema,
  UpdatePagesSchema,
} from "@repo/shared-types/api/page";
import { updateTag } from "next/cache";
import { headers } from "next/headers";
import type { NextResponse } from "next/server";

import type {
  ResolvedBlock,
  RuntimeBlockInput,
} from "@/blocks/core/definition";
import { logAuditEvent } from "@/lib/server/audit";
import { authVerify } from "@/lib/server/auth-verify";
import { normalizeBlockIds } from "@/lib/server/block-normalize";
import { updatePageMediaReferences } from "@/lib/server/page-image-tracking";
import prisma from "@/lib/server/prisma";
import limitControl from "@/lib/server/rate-limit";
import ResponseBuilder from "@/lib/server/response";
import { validateData } from "@/lib/server/validator";

type ActionEnvironment = "serverless" | "serveraction";
type ActionConfig = { environment?: ActionEnvironment };
type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

/*
    getPagesList() - 获取页面列表
*/
export async function getPagesList(
  params: GetPagesList,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<PageListItem[] | null>>>;
export async function getPagesList(
  params: GetPagesList,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<PageListItem[] | null>>;
export async function getPagesList(
  params: GetPagesList,
  serverConfig?: ActionConfig,
): Promise<ActionResult<PageListItem[] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getPagesList"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(params, GetPagesListSchema);
  if (validationError) {
    return response.badRequest({ error: validationError.error });
  }

  // 验证用户身份（仅管理员）
  const authResult = await authVerify({
    accessToken: params.access_token,
    allowedRoles: ["ADMIN"],
  });
  if (!authResult) {
    return response.unauthorized({ message: "需要管理员权限" });
  }

  try {
    const {
      page,
      pageSize,
      sortBy,
      sortOrder,
      search,
      status,
      isSystemPage,
      robotsIndex,
      createdAtStart,
      createdAtEnd,
      updatedAtStart,
      updatedAtEnd,
    } = params;

    // 构建查询条件
    const where: {
      deletedAt: null;
      OR?: Array<{
        title?: { contains: string; mode: "insensitive" };
        slug?: { contains: string; mode: "insensitive" };
        metaDescription?: { contains: string; mode: "insensitive" };
      }>;
      status?: { in: ("ACTIVE" | "SUSPENDED")[] };
      isSystemPage?: boolean;
      robotsIndex?: boolean;
      createdAt?: { gte?: Date; lte?: Date };
      updatedAt?: { gte?: Date; lte?: Date };
    } = {
      deletedAt: null,
    };

    // 搜索条件
    if (search && search.trim()) {
      where.OR = [
        {
          title: { contains: search.trim(), mode: "insensitive" },
          slug: { contains: search.trim(), mode: "insensitive" },
          metaDescription: { contains: search.trim(), mode: "insensitive" },
        },
      ];
    }

    // 状态筛选
    if (status && status.length > 0) {
      where.status = { in: status };
    }

    // 系统页面筛选
    if (isSystemPage && isSystemPage.length === 1) {
      where.isSystemPage = isSystemPage[0];
    } else if (isSystemPage && isSystemPage.length === 2) {
      // 包含 true 和 false，不需要筛选
    }

    // 搜索引擎索引筛选
    if (robotsIndex && robotsIndex.length === 1) {
      where.robotsIndex = robotsIndex[0];
    } else if (robotsIndex && robotsIndex.length === 2) {
      // 包含 true 和 false，不需要筛选
    }

    // 创建时间范围筛选
    if (createdAtStart || createdAtEnd) {
      where.createdAt = {};
      if (createdAtStart) {
        where.createdAt.gte = new Date(createdAtStart);
      }
      if (createdAtEnd) {
        where.createdAt.lte = new Date(createdAtEnd);
      }
    }

    // 更新时间范围筛选
    if (updatedAtStart || updatedAtEnd) {
      where.updatedAt = {};
      if (updatedAtStart) {
        where.updatedAt.gte = new Date(updatedAtStart);
      }
      if (updatedAtEnd) {
        where.updatedAt.lte = new Date(updatedAtEnd);
      }
    }

    // 获取分页数据
    const [pages, total] = await Promise.all([
      prisma.page.findMany({
        where,
        orderBy: {
          [sortBy || "id"]: sortOrder || "desc",
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          title: true,
          slug: true,
          content: true,
          contentType: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          metaDescription: true,
          metaKeywords: true,
          robotsIndex: true,
          isSystemPage: true,
          config: true,
          author: {
            select: {
              uid: true,
              username: true,
              nickname: true,
            },
          },
        },
      }),
      prisma.page.count({ where }),
    ]);

    // 转换数据格式
    const pageList: PageListItem[] = pages.map((page) => ({
      id: page.id,
      title: page.title,
      slug: page.slug,
      status: page.status,
      contentType: page.contentType,
      createdAt: page.createdAt.toISOString(),
      updatedAt: page.updatedAt.toISOString(),
      author: (
        page as {
          author?: {
            uid: number | null;
            username: string | null;
            nickname: string | null;
          } | null;
        }
      ).author || {
        uid: null,
        username: null,
        nickname: null,
      },
      metaDescription: page.metaDescription,
      metaKeywords: page.metaKeywords,
      robotsIndex: page.robotsIndex,
      isSystemPage: page.isSystemPage,
      config: page.config,
    }));

    // 构建分页信息
    const meta = {
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      hasNext: page < Math.ceil(total / pageSize),
      hasPrev: page > 1,
    };

    return response.ok({
      data: pageList,
      meta,
    });
  } catch (error) {
    console.error("获取页面列表失败:", error);
    return response.serverError({ message: "获取页面列表失败" });
  }
}

/*
    getPageDetail() - 获取页面详情
*/
export async function getPageDetail(
  params: GetPageDetail,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<PageDetail | null>>>;
export async function getPageDetail(
  params: GetPageDetail,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<PageDetail | null>>;
export async function getPageDetail(
  params: GetPageDetail,
  serverConfig?: ActionConfig,
): Promise<ActionResult<PageDetail | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getPageDetail"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(params, GetPageDetailSchema);
  if (validationError) {
    return response.badRequest({ error: validationError.error });
  }

  // 验证用户身份（仅管理员）
  const authResult = await authVerify({
    accessToken: params.access_token,
    allowedRoles: ["ADMIN"],
  });
  if (!authResult) {
    return response.unauthorized({ message: "需要管理员权限" });
  }

  try {
    // 获取页面详情
    const page = await prisma.page.findFirst({
      where: {
        slug: params.slug,
        deletedAt: null,
      },
      select: {
        id: true,
        title: true,
        slug: true,
        content: true,
        contentType: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        metaDescription: true,
        metaKeywords: true,
        robotsIndex: true,
        isSystemPage: true,
        config: true,
        author: {
          select: {
            uid: true,
            username: true,
            nickname: true,
          },
        },
      },
    });

    if (!page) {
      return response.notFound({ message: "页面不存在" });
    }

    const pageDetail: PageDetail = {
      id: page.id,
      title: page.title,
      slug: page.slug,
      content: page.content,
      contentType: page.contentType,
      status: page.status,
      createdAt: page.createdAt.toISOString(),
      updatedAt: page.updatedAt.toISOString(),
      author: (
        page as {
          author?: {
            uid: number | null;
            username: string | null;
            nickname: string | null;
          } | null;
        }
      ).author || {
        uid: null,
        username: null,
        nickname: null,
      },
      config: page.config,
      metaDescription: page.metaDescription,
      metaKeywords: page.metaKeywords,
      robotsIndex: page.robotsIndex,
      isSystemPage: page.isSystemPage,
    };

    return response.ok({ data: pageDetail });
  } catch (error) {
    console.error("获取页面详情失败:", error);
    return response.serverError({ message: "获取页面详情失败" });
  }
}

/*
    createPage() - 创建页面
*/
export async function createPage(
  params: CreatePage,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CreatePageResult | null>>>;
export async function createPage(
  params: CreatePage,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CreatePageResult | null>>;
export async function createPage(
  params: CreatePage,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CreatePageResult | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "createPage"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(params, CreatePageSchema);
  if (validationError) {
    return response.badRequest({ error: validationError.error });
  }

  // 验证用户身份（仅管理员）
  const authResult = await authVerify({
    accessToken: params.access_token,
    allowedRoles: ["ADMIN"],
  });
  if (!authResult) {
    return response.unauthorized({ message: "需要管理员权限" });
  }

  try {
    const {
      title,
      slug,
      content,
      contentType,
      config,
      status,
      metaDescription,
      metaKeywords,
      robotsIndex,
      isSystemPage,
    } = params;

    // 检查 slug 是否已存在
    const existingPage = await prisma.page.findFirst({
      where: {
        slug,
        deletedAt: null,
      },
    });

    if (existingPage) {
      return response.conflict({ message: "Slug 已存在" });
    }

    // 规范化 block ID：按照显示顺序重新分配递增的 ID
    const normalizedConfig = normalizeBlockIds(
      config as Record<string, unknown> | null,
    );

    // 创建页面
    const newPage = await prisma.page.create({
      data: {
        title,
        slug,
        content: content || "",
        contentType,
        config: normalizedConfig as typeof config,
        status,
        metaDescription,
        metaKeywords,
        robotsIndex,
        isSystemPage,
        userUid: authResult.uid,
      },
    });

    // 图片追踪：如果页面包含 blocks，更新 mediaRefs
    if (config && typeof config === "object") {
      try {
        const configObj = config as Record<string, unknown> | null;
        if (
          configObj &&
          "blocks" in configObj &&
          Array.isArray(configObj.blocks)
        ) {
          await updatePageMediaReferences(
            newPage.id,
            configObj.blocks as Array<{
              block: string;
              content?: unknown;
              data?: unknown;
            }>,
          );
        }
      } catch (error) {
        // 图片追踪失败不应该影响页面创建，只记录错误
        console.error("Failed to create page media references:", error);
      }
    }

    const result: CreatePageResult = {
      id: newPage.id,
      slug: newPage.slug,
    };

    // 记录审计日志
    const { after } = await import("next/server");
    after(async () => {
      await logAuditEvent({
        user: {
          uid: String(authResult.uid),
        },
        details: {
          action: "CREATE",
          resourceType: "PAGE",
          resourceId: newPage.id,
          value: {
            old: null,
            new: {
              id: newPage.id,
              title,
              slug,
              status,
              isSystemPage,
            },
          },
          description: `创建页面: ${title}`,
          metadata: {
            pageId: newPage.id,
            slug,
            isSystemPage,
          },
        },
      });
    });

    // 刷新当前页面及页面集合缓存，确保 sitemap 能感知新增页面
    updateTag(`pages/${newPage.id}`);
    updateTag("pages");

    return response.created({ data: result });
  } catch (error) {
    console.error("创建页面失败:", error);
    return response.serverError({ message: "创建页面失败" });
  }
}

/*
    updatePage() - 更新单个页面
*/
export async function updatePage(
  params: UpdatePage,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<UpdatePageResult | null>>>;
export async function updatePage(
  params: UpdatePage,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<UpdatePageResult | null>>;
export async function updatePage(
  params: UpdatePage,
  serverConfig?: ActionConfig,
): Promise<ActionResult<UpdatePageResult | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "updatePage"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(params, UpdatePageSchema);
  if (validationError) {
    return response.badRequest({ error: validationError.error });
  }

  // 验证用户身份（仅管理员）
  const authResult = await authVerify({
    accessToken: params.access_token,
    allowedRoles: ["ADMIN"],
  });
  if (!authResult) {
    return response.unauthorized({ message: "需要管理员权限" });
  }

  try {
    const slug = params.slug;
    // 从参数中移除 access_token，保留更新数据
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { access_token, ...updateData } = params;

    // 获取原始页面
    const originalPage = await prisma.page.findFirst({
      where: {
        slug,
        deletedAt: null,
      },
    });

    if (!originalPage) {
      return response.notFound({ message: "页面不存在" });
    }

    // 检查是否为系统页面，系统页面不允许修改某些字段
    if (originalPage.isSystemPage) {
      // 系统页面不允许修改 isSystemPage 字段
      if ("isSystemPage" in updateData) {
        delete updateData.isSystemPage;
      }
    }

    // 如果要修改 slug，检查新 slug 是否已存在
    if (updateData.newSlug && updateData.newSlug !== slug) {
      const existingPage = await prisma.page.findFirst({
        where: {
          slug: updateData.newSlug,
          id: { not: originalPage.id },
          deletedAt: null,
        },
      });

      if (existingPage) {
        return response.conflict({ message: "新 Slug 已存在" });
      }

      // 设置新的 slug
      (updateData as UpdatePage & { slug?: string }).slug = updateData.newSlug;
      delete updateData.newSlug;
    }

    // 移除 undefined 值
    Object.keys(updateData).forEach((key) => {
      if (updateData[key as keyof typeof updateData] === undefined) {
        delete updateData[key as keyof typeof updateData];
      }
    });

    // 规范化 block ID：如果更新了 config，按照显示顺序重新分配递增的 ID
    if (updateData.config && typeof updateData.config === "object") {
      updateData.config = normalizeBlockIds(
        updateData.config as Record<string, unknown> | null,
      ) as typeof updateData.config;
    }

    // 更新页面
    const updatedPage = await prisma.page.update({
      where: {
        id: originalPage.id,
      },
      data: updateData,
    });

    // 图片追踪：如果 config 更新了，更新 mediaRefs
    if (updateData.config && typeof updateData.config === "object") {
      try {
        const config = updatedPage.config as Record<string, unknown> | null;
        if (config && "blocks" in config && Array.isArray(config.blocks)) {
          await updatePageMediaReferences(
            updatedPage.id,
            config.blocks as Array<{
              block: string;
              content?: unknown;
              data?: unknown;
            }>,
          );
        }
      } catch (error) {
        // 图片追踪失败不应该影响页面更新，只记录错误
        console.error("Failed to update page media references:", error);
      }
    }

    const result: UpdatePageResult = {
      id: updatedPage.id,
      slug: updatedPage.slug,
    };

    // 记录审计日志
    const auditOldValue: Record<string, unknown> = {};
    const auditNewValue: Record<string, unknown> = {};

    // 比较并记录变更
    if (updateData.title && updateData.title !== originalPage.title) {
      auditOldValue.title = originalPage.title;
      auditNewValue.title = updateData.title;
    }
    if (updateData.slug && updateData.slug !== originalPage.slug) {
      auditOldValue.slug = originalPage.slug;
      auditNewValue.slug = updateData.slug;
    }
    if (updateData.content && updateData.content !== originalPage.content) {
      // 内容变更通常较大，可能不记录完整内容，或仅记录 hash/摘要
      // 这里简化为只记录有变更
      auditOldValue.content = "(content)";
      auditNewValue.content = "(updated)";
    }
    if (updateData.status && updateData.status !== originalPage.status) {
      auditOldValue.status = originalPage.status;
      auditNewValue.status = updateData.status;
    }
    // ... 其他字段的比较逻辑
    const simpleFields = [
      "contentType",
      "metaDescription",
      "metaKeywords",
      "robotsIndex",
      "isSystemPage",
      "config",
    ] as const;

    simpleFields.forEach((field) => {
      const val = updateData[field as keyof typeof updateData];
      const oldVal = originalPage[field as keyof typeof originalPage];
      if (val !== undefined && JSON.stringify(val) !== JSON.stringify(oldVal)) {
        auditOldValue[field] = oldVal;
        auditNewValue[field] = val;
      }
    });

    if (Object.keys(auditNewValue).length > 0) {
      const { after } = await import("next/server");
      after(async () => {
        await logAuditEvent({
          user: {
            uid: String(authResult.uid),
          },
          details: {
            action: "UPDATE",
            resourceType: "PAGE",
            resourceId: originalPage.id,
            value: {
              old: auditOldValue,
              new: auditNewValue,
            },
            description: `更新页面: ${updatedPage.title}`,
          },
        });
      });
    }

    // 刷新当前页面及页面集合缓存，确保 sitemap 能感知页面更新
    updateTag(`pages/${originalPage.id}`);
    updateTag("pages");

    return response.ok({ data: result });
  } catch (error) {
    console.error("更新页面失败:", error);
    return response.serverError({ message: "更新页面失败" });
  }
}

/*
    updatePages() - 批量更新页面
*/
export async function updatePages(
  params: UpdatePages,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<{ updated: number } | null>>>;
export async function updatePages(
  params: UpdatePages,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<{ updated: number } | null>>;
export async function updatePages(
  params: UpdatePages,
  serverConfig?: ActionConfig,
): Promise<ActionResult<{ updated: number } | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "updatePages"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(params, UpdatePagesSchema);
  if (validationError) {
    return response.badRequest({ error: validationError.error });
  }

  // 验证用户身份（仅管理员）
  const authResult = await authVerify({
    accessToken: params.access_token,
    allowedRoles: ["ADMIN"],
  });
  if (!authResult) {
    return response.unauthorized({ message: "需要管理员权限" });
  }

  try {
    const { access_token: _accessToken, ids, ...updateData } = params;

    // 移除 undefined 值
    Object.keys(updateData).forEach((key) => {
      if (updateData[key as keyof typeof updateData] === undefined) {
        delete updateData[key as keyof typeof updateData];
      }
    });

    // 如果是批量操作，跳过系统页面
    let targetIds = ids;
    if (Object.keys(updateData).length > 0) {
      const systemPages = await prisma.page.findMany({
        where: {
          id: { in: ids },
          isSystemPage: true,
          deletedAt: null,
        },
        select: { id: true },
      });

      if (systemPages.length > 0) {
        // 过滤掉系统页面
        const systemPageIds = systemPages.map((p) => p.id);
        targetIds = ids.filter((id) => !systemPageIds.includes(id));

        if (targetIds.length === 0) {
          return response.badRequest({
            message: "选中的页面都是系统页面，无法批量修改",
          });
        }
      }
    }

    // 执行批量更新
    const result = await prisma.page.updateMany({
      where: {
        id: { in: targetIds },
        deletedAt: null,
      },
      data: updateData,
    });

    // 记录审计日志
    const { after } = await import("next/server");
    after(async () => {
      await logAuditEvent({
        user: {
          uid: String(authResult.uid),
        },
        details: {
          action: "UPDATE",
          resourceType: "PAGE",
          resourceId: targetIds.join(","),
          value: {
            old: { ids: targetIds },
            new: updateData,
          },
          description: `批量更新页面: ${result.count} 个`,
        },
      });
    });

    // 刷新缓存标签
    updateTag("pages");
    targetIds.forEach((id) => {
      updateTag(`pages/${id}`);
    });

    return response.ok({
      data: {
        updated: result.count,
      },
    });
  } catch (error) {
    console.error("批量更新页面失败:", error);
    return response.serverError({ message: "批量更新页面失败" });
  }
}

/*
    fetchBlockData() - 获取单个 Block 的数据
*/
export async function fetchBlockData(
  params: { access_token: string; block: RuntimeBlockInput },
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<{ block: ResolvedBlock } | null>>>;
export async function fetchBlockData(
  params: { access_token: string; block: RuntimeBlockInput },
  serverConfig?: ActionConfig,
): Promise<ApiResponse<{ block: ResolvedBlock } | null>>;
export async function fetchBlockData(
  params: { access_token: string; block: RuntimeBlockInput },
  serverConfig?: ActionConfig,
): Promise<ActionResult<{ block: ResolvedBlock } | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "fetchBlockData"))) {
    return response.tooManyRequests();
  }

  // 验证用户身份（仅管理员）
  const authResult = await authVerify({
    accessToken: params.access_token,
    allowedRoles: ["ADMIN"],
  });
  if (!authResult) {
    return response.unauthorized({ message: "需要管理员权限" });
  }

  try {
    // 动态导入 fetcher 并执行
    const { resolveSingleBlockData } = await import(
      "@/lib/server/block-data-resolver"
    );
    const block = await resolveSingleBlockData(params.block, {});

    return response.ok({ data: { block } });
  } catch (error) {
    console.error("获取 Block 数据失败:", error);
    return response.serverError({ message: "获取 Block 数据失败" });
  }
}

/*
    deletePages() - 批量删除页面
*/
export async function deletePages(
  params: DeletePages,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<{ deleted: number } | null>>>;
export async function deletePages(
  params: DeletePages,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<{ deleted: number } | null>>;
export async function deletePages(
  params: DeletePages,
  serverConfig?: ActionConfig,
): Promise<ActionResult<{ deleted: number } | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "deletePages"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(params, DeletePagesSchema);
  if (validationError) {
    return response.badRequest({ error: validationError.error });
  }

  // 验证用户身份（仅管理员）
  const authResult = await authVerify({
    accessToken: params.access_token,
    allowedRoles: ["ADMIN"],
  });
  if (!authResult) {
    return response.unauthorized({ message: "需要管理员权限" });
  }

  try {
    const { ids } = params;

    // 检查是否包含系统页面
    const systemPages = await prisma.page.findMany({
      where: {
        id: { in: ids },
        isSystemPage: true,
        deletedAt: null,
      },
      select: { id: true, title: true },
    });

    if (systemPages.length > 0) {
      const systemPageTitles = systemPages.map((p) => p.title).join("、");
      return response.badRequest({
        message: `无法删除系统页面：${systemPageTitles}`,
      });
    }

    // 软删除页面
    const result = await prisma.page.updateMany({
      where: {
        id: { in: ids },
        deletedAt: null,
      },
      data: {
        deletedAt: new Date(),
      },
    });

    // 记录审计日志
    const { after } = await import("next/server");
    after(async () => {
      await logAuditEvent({
        user: {
          uid: String(authResult.uid),
        },
        details: {
          action: "DELETE",
          resourceType: "PAGE",
          resourceId: ids.join(","),
          value: {
            old: {
              deletedIds: ids,
              deletedCount: result.count,
            },
            new: null,
          },
          description: `批量删除页面: ${result.count} 个`,
          metadata: {
            count: result.count,
            idsCount: ids.length,
          },
        },
      });
    });

    // 刷新缓存标签
    updateTag("pages");
    ids.forEach((id) => {
      updateTag(`pages/${id}`);
    });

    return response.ok({
      data: {
        deleted: result.count,
      },
    });
  } catch (error) {
    console.error("删除页面失败:", error);
    return response.serverError({ message: "删除页面失败" });
  }
}

/*
  getAllPlaceholders - 获取所有变量占位符
*/
export async function getAllPlaceholders(serverConfig: {
  environment: "serverless";
}): Promise<
  NextResponse<
    ApiResponse<
      | { name: string; description: string; value: string; params?: string }[]
      | null
    >
  >
>;
export async function getAllPlaceholders(
  serverConfig?: ActionConfig,
): Promise<
  ApiResponse<
    | { name: string; description: string; value: string; params?: string }[]
    | null
  >
>;
export async function getAllPlaceholders(
  serverConfig?: ActionConfig,
): Promise<
  ActionResult<
    | { name: string; description: string; value: string; params?: string }[]
    | null
  >
> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getAllPlaceholders"))) {
    return response.tooManyRequests();
  }

  const user = await authVerify({
    allowedRoles: ["ADMIN"],
  });
  if (!user) {
    return response.unauthorized({ message: "需要管理员权限" });
  }

  try {
    const { interpolatorMap, PLACEHOLDER_REGISTRY } = await import(
      "@/blocks/core/placeholders"
    );

    // 缓存每个插值器的返回数据
    const interpolatorDataCache: Record<string, Record<string, unknown>> = {};

    // 调用所有插值器并缓存结果
    for (const [key, loader] of Object.entries(interpolatorMap)) {
      try {
        // eslint-disable-next-line @next/next/no-assign-module-variable
        const module = await loader();
        const funcName = `${key}Interpolator`;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const func = (module as any)[funcName];

        if (typeof func === "function") {
          const res = await func();
          if (res && typeof res === "object") {
            interpolatorDataCache[key] = res as Record<string, unknown>;
          }
        }
      } catch (error) {
        console.error(`Failed to load interpolator ${key}:`, error);
      }
    }

    // 根据注册表生成占位符列表
    const results: {
      name: string;
      description: string;
      value: string;
      params?: string;
    }[] = [];

    for (const placeholder of PLACEHOLDER_REGISTRY) {
      const { name, description, interpolator, params } = placeholder;

      // 获取对应插值器的数据
      const data = interpolatorDataCache[interpolator];

      let value = "-";
      if (data && name in data) {
        const val = data[name];
        if (Array.isArray(val)) {
          value = `[Array(${val.length})]`;
        } else if (val === null || val === undefined) {
          value = "-";
        } else if (typeof val === "object") {
          value = "[Object]";
        } else {
          value = String(val);
        }
      }

      // 格式化参数列表
      const paramsStr =
        params && params.length > 0
          ? params.map((p) => p.name).join(", ")
          : undefined;

      results.push({
        name: `{${name}}`,
        description,
        value,
        params: paramsStr,
      });
    }

    return response.ok({ data: results });
  } catch (error) {
    console.error("Get all placeholders error:", error);
    return response.serverError();
  }
}
