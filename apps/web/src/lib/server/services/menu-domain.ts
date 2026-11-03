import "server-only";

import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type {
  CreateMenu,
  CreateMenuResult,
  DeleteMenus,
  DeleteMenusResult,
  GetMenuDetail,
  GetMenusList,
  GetMenusStats,
  MenuDetail,
  MenuListItem,
  MenusStatsData,
  UpdateMenu,
  UpdateMenuResult,
  UpdateMenus,
  UpdateMenusResult,
} from "@repo/shared-types/api/menu";
import {
  CreateMenuSchema,
  DeleteMenusSchema,
  GetMenuDetailSchema,
  GetMenusListSchema,
  GetMenusStatsSchema,
  UpdateMenuSchema,
  UpdateMenusSchema,
} from "@repo/shared-types/api/menu";
import { updateTag } from "next/cache";
import { headers } from "next/headers";
import type { NextResponse } from "next/server";

import { logAuditEvent } from "@/lib/server/audit";
import { authVerify } from "@/lib/server/auth-verify";
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
    getMenusStats() - 获取菜单统计信息
*/
export async function getMenusStats(
  params: GetMenusStats,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<MenusStatsData | null>>>;
export async function getMenusStats(
  params: GetMenusStats,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<MenusStatsData | null>>;
export async function getMenusStats(
  params: GetMenusStats,
  serverConfig?: ActionConfig,
): Promise<ActionResult<MenusStatsData | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getMenusStats"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(params, GetMenusStatsSchema);
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
    const [total, active, suspended, main, common, outsite] = await Promise.all(
      [
        prisma.menu.count(),
        prisma.menu.count({ where: { status: "ACTIVE" } }),
        prisma.menu.count({ where: { status: "SUSPENDED" } }),
        prisma.menu.count({ where: { category: "MAIN" } }),
        prisma.menu.count({ where: { category: "COMMON" } }),
        prisma.menu.count({ where: { category: "OUTSITE" } }),
      ],
    );

    const data: MenusStatsData = {
      updatedAt: new Date().toISOString(),
      cache: false,
      total: {
        total,
        active,
        suspended,
        main,
        common,
        outsite,
      },
    };

    return response.ok({
      data,
      message: "获取菜单统计成功",
    });
  } catch (error) {
    console.error("[getMenusStats] 获取菜单统计失败:", error);
    return response.serverError({ message: "获取菜单统计失败" });
  }
}

/*
    getMenusList() - 获取菜单列表
*/
export async function getMenusList(
  params: GetMenusList,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<MenuListItem[] | null>>>;
export async function getMenusList(
  params: GetMenusList,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<MenuListItem[] | null>>;
export async function getMenusList(
  params: GetMenusList,
  serverConfig?: ActionConfig,
): Promise<ActionResult<MenuListItem[] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getMenusList"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(params, GetMenusListSchema);
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
      category,
      createdAtStart,
      createdAtEnd,
      updatedAtStart,
      updatedAtEnd,
    } = params;

    // 构建查询条件
    const where: {
      OR?: Array<{
        name?: { contains: string; mode: "insensitive" };
        slug?: { contains: string; mode: "insensitive" };
      }>;
      status?: { in: ("ACTIVE" | "SUSPENDED")[] };
      category?: { in: ("MAIN" | "COMMON" | "OUTSITE")[] };
      createdAt?: { gte?: Date; lte?: Date };
      updatedAt?: { gte?: Date; lte?: Date };
    } = {};

    // 搜索条件
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { slug: { contains: search, mode: "insensitive" } },
      ];
    }

    // 状态筛选
    if (status && status.length > 0) {
      where.status = { in: status };
    }

    // 分类筛选
    if (category && category.length > 0) {
      where.category = { in: category };
    }

    // 创建时间筛选
    if (createdAtStart || createdAtEnd) {
      where.createdAt = {};
      if (createdAtStart) {
        where.createdAt.gte = new Date(createdAtStart);
      }
      if (createdAtEnd) {
        where.createdAt.lte = new Date(createdAtEnd);
      }
    }

    // 更新时间筛选
    if (updatedAtStart || updatedAtEnd) {
      where.updatedAt = {};
      if (updatedAtStart) {
        where.updatedAt.gte = new Date(updatedAtStart);
      }
      if (updatedAtEnd) {
        where.updatedAt.lte = new Date(updatedAtEnd);
      }
    }

    // 排序字段映射
    const orderBy: Record<string, "asc" | "desc"> = {};
    orderBy[sortBy] = sortOrder;

    // 查询菜单列表
    const menus = await prisma.menu.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        page: {
          select: {
            id: true,
            slug: true,
            title: true,
          },
        },
      },
    });

    // 转换为响应格式
    const data: MenuListItem[] = menus.map((menu) => ({
      id: menu.id,
      name: menu.name,
      icon: menu.icon,
      link: menu.link,
      slug: menu.slug,
      status: menu.status,
      order: menu.order,
      category: menu.category,
      createdAt: menu.createdAt.toISOString(),
      updatedAt: menu.updatedAt.toISOString(),
      page: menu.page,
    }));

    return response.ok({
      data,
      message: "获取菜单列表成功",
    });
  } catch (error) {
    console.error("[getMenusList] 获取菜单列表失败:", error);
    return response.serverError({ message: "获取菜单列表失败" });
  }
}

/*
    getMenuDetail() - 获取菜单详情
*/
export async function getMenuDetail(
  params: GetMenuDetail,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<MenuDetail | null>>>;
export async function getMenuDetail(
  params: GetMenuDetail,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<MenuDetail | null>>;
export async function getMenuDetail(
  params: GetMenuDetail,
  serverConfig?: ActionConfig,
): Promise<ActionResult<MenuDetail | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getMenuDetail"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(params, GetMenuDetailSchema);
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
    const menu = await prisma.menu.findUnique({
      where: { id: params.id },
      include: {
        page: {
          select: {
            id: true,
            slug: true,
            title: true,
          },
        },
      },
    });

    if (!menu) {
      return response.notFound({ message: "菜单不存在" });
    }

    const data: MenuDetail = {
      id: menu.id,
      name: menu.name,
      icon: menu.icon,
      link: menu.link,
      slug: menu.slug,
      status: menu.status,
      order: menu.order,
      category: menu.category,
      createdAt: menu.createdAt.toISOString(),
      updatedAt: menu.updatedAt.toISOString(),
      page: menu.page,
    };

    return response.ok({
      data,
      message: "获取菜单详情成功",
    });
  } catch (error) {
    console.error("[getMenuDetail] 获取菜单详情失败:", error);
    return response.serverError({ message: "获取菜单详情失败" });
  }
}

/*
    createMenu() - 创建菜单
*/
export async function createMenu(
  params: CreateMenu,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CreateMenuResult | null>>>;
export async function createMenu(
  params: CreateMenu,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CreateMenuResult | null>>;
export async function createMenu(
  params: CreateMenu,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CreateMenuResult | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "createMenu"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(params, CreateMenuSchema);
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

  // 验证 slug 和 link 至少有一个
  if (!params.slug && !params.link) {
    return response.badRequest({
      message: "slug 和 link 至少需要提供一个",
    });
  }

  try {
    // 检查 slug 是否已存在（如果提供了 slug）
    if (params.slug) {
      const existingMenu = await prisma.menu.findUnique({
        where: { slug: params.slug },
      });
      if (existingMenu) {
        return response.conflict({ message: "该路径已被使用" });
      }
    }

    // 创建菜单
    const menu = await prisma.menu.create({
      data: {
        name: params.name,
        icon: params.icon || null,
        link: params.link || null,
        slug: params.slug || null,
        status: params.status || "ACTIVE",
        order: params.order || 0,
        category: params.category || "COMMON",
        pageId: params.pageId || null,
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
          action: "CREATE",
          resourceType: "Menu",
          resourceId: menu.id,
          value: {
            old: null,
            new: menu,
          },
          description: `创建菜单: ${menu.name}`,
        },
      });
    });

    const data: CreateMenuResult = {
      id: menu.id,
    };

    // 刷新缓存标签
    updateTag("menus");

    return response.created({
      data,
      message: "创建菜单成功",
    });
  } catch (error) {
    console.error("[createMenu] 创建菜单失败:", error);
    return response.serverError({ message: "创建菜单失败" });
  }
}

/*
    updateMenu() - 更新单个菜单
*/
export async function updateMenu(
  params: UpdateMenu,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<UpdateMenuResult | null>>>;
export async function updateMenu(
  params: UpdateMenu,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<UpdateMenuResult | null>>;
export async function updateMenu(
  params: UpdateMenu,
  serverConfig?: ActionConfig,
): Promise<ActionResult<UpdateMenuResult | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "updateMenu"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(params, UpdateMenuSchema);
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
    // 检查菜单是否存在
    const existingMenu = await prisma.menu.findUnique({
      where: { id: params.id },
    });
    if (!existingMenu) {
      return response.notFound({ message: "菜单不存在" });
    }

    // 检查 slug 是否已被其他菜单使用
    if (params.slug !== undefined && params.slug !== null) {
      const slugConflict = await prisma.menu.findFirst({
        where: {
          slug: params.slug,
          id: { not: params.id },
        },
      });
      if (slugConflict) {
        return response.conflict({ message: "该路径已被其他菜单使用" });
      }
    }

    // 构建更新数据
    const updateData: {
      name?: string;
      icon?: string | null;
      link?: string | null;
      slug?: string | null;
      status?: "ACTIVE" | "SUSPENDED";
      order?: number;
      category?: "MAIN" | "COMMON" | "OUTSITE";
      pageId?: string | null;
    } = {};

    if (params.name !== undefined) updateData.name = params.name;
    if (params.icon !== undefined) updateData.icon = params.icon;
    if (params.link !== undefined) updateData.link = params.link;
    if (params.slug !== undefined) updateData.slug = params.slug;
    if (params.status !== undefined) updateData.status = params.status;
    if (params.order !== undefined) updateData.order = params.order;
    if (params.category !== undefined) updateData.category = params.category;
    if (params.pageId !== undefined) updateData.pageId = params.pageId;

    // 更新菜单
    const menu = await prisma.menu.update({
      where: { id: params.id },
      data: updateData,
    });

    // 记录审计日志
    const auditOldValue: Record<string, unknown> = {};
    const auditNewValue: Record<string, unknown> = {};

    Object.entries(updateData).forEach(([key, value]) => {
      const oldValue = existingMenu[key as keyof typeof existingMenu];
      if (value !== oldValue) {
        auditOldValue[key] = oldValue;
        auditNewValue[key] = value;
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
            resourceType: "Menu",
            resourceId: menu.id,
            value: {
              old: auditOldValue,
              new: auditNewValue,
            },
            description: `更新菜单: ${menu.name}`,
          },
        });
      });
    }

    const data: UpdateMenuResult = {
      id: menu.id,
    };

    // 刷新缓存标签
    updateTag("menus");

    return response.ok({
      data,
      message: "更新菜单成功",
    });
  } catch (error) {
    console.error("[updateMenu] 更新菜单失败:", error);
    return response.serverError({ message: "更新菜单失败" });
  }
}

/*
    updateMenus() - 批量更新菜单
*/
export async function updateMenus(
  params: UpdateMenus,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<UpdateMenusResult | null>>>;
export async function updateMenus(
  params: UpdateMenus,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<UpdateMenusResult | null>>;
export async function updateMenus(
  params: UpdateMenus,
  serverConfig?: ActionConfig,
): Promise<ActionResult<UpdateMenusResult | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "updateMenus"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(params, UpdateMenusSchema);
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
    // 构建更新数据
    const updateData: {
      name?: string;
      icon?: string | null;
      link?: string | null;
      slug?: string | null;
      status?: "ACTIVE" | "SUSPENDED";
      order?: number;
      category?: "MAIN" | "COMMON" | "OUTSITE";
      pageId?: string | null;
    } = {};

    if (params.name !== undefined) updateData.name = params.name;
    if (params.icon !== undefined) updateData.icon = params.icon;
    if (params.link !== undefined) updateData.link = params.link;
    if (params.slug !== undefined) updateData.slug = params.slug;
    if (params.status !== undefined) updateData.status = params.status;
    if (params.order !== undefined) updateData.order = params.order;
    if (params.category !== undefined) updateData.category = params.category;
    if (params.pageId !== undefined) updateData.pageId = params.pageId;

    // 批量更新菜单
    const result = await prisma.menu.updateMany({
      where: { id: { in: params.ids } },
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
          resourceType: "Menu",
          resourceId: params.ids.join(","),
          value: {
            old: null,
            new: { ids: params.ids, updateData },
          },
          description: `批量更新 ${result.count} 个菜单`,
        },
      });
    });

    const data: UpdateMenusResult = {
      updated: result.count,
    };

    // 刷新缓存标签
    updateTag("menus");

    return response.ok({
      data,
      message: `成功更新 ${result.count} 个菜单`,
    });
  } catch (error) {
    console.error("[updateMenus] 批量更新菜单失败:", error);
    return response.serverError({ message: "批量更新菜单失败" });
  }
}

/*
    deleteMenus() - 批量删除菜单
*/
export async function deleteMenus(
  params: DeleteMenus,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<DeleteMenusResult | null>>>;
export async function deleteMenus(
  params: DeleteMenus,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<DeleteMenusResult | null>>;
export async function deleteMenus(
  params: DeleteMenus,
  serverConfig?: ActionConfig,
): Promise<ActionResult<DeleteMenusResult | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "deleteMenus"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(params, DeleteMenusSchema);
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
    // 获取要删除的菜单信息（用于审计日志）
    const menusToDelete = await prisma.menu.findMany({
      where: { id: { in: params.ids } },
    });

    // 批量删除菜单
    const result = await prisma.menu.deleteMany({
      where: { id: { in: params.ids } },
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
          resourceType: "Menu",
          resourceId: params.ids.join(","),
          value: {
            old: menusToDelete,
            new: null,
          },
          description: `批量删除 ${result.count} 个菜单`,
        },
      });
    });

    const data: DeleteMenusResult = {
      deleted: result.count,
    };

    // 刷新缓存标签
    updateTag("menus");

    return response.ok({
      data,
      message: `成功删除 ${result.count} 个菜单`,
    });
  } catch (error) {
    console.error("[deleteMenus] 批量删除菜单失败:", error);
    return response.serverError({ message: "批量删除菜单失败" });
  }
}
