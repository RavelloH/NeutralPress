import "server-only";

import type {
  AuditLogItem,
  AuditTrendItem,
  GetAuditLogs,
  GetAuditTrends,
} from "@repo/shared-types/api/audit";
import {
  GetAuditLogsSchema,
  GetAuditTrendsSchema,
} from "@repo/shared-types/api/audit";
import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import { headers } from "next/headers";
import type { NextResponse } from "next/server";

import { authVerify } from "@/lib/server/auth-verify";
import { resolveIpLocation } from "@/lib/server/ip-utils";
import prisma from "@/lib/server/prisma";
import limitControl from "@/lib/server/rate-limit";
import ResponseBuilder from "@/lib/server/response";
import { validateData } from "@/lib/server/validator";

type ActionEnvironment = "serverless" | "serveraction";
type ActionConfig = { environment?: ActionEnvironment };
type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

export async function getAuditLogs(
  params: GetAuditLogs,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<AuditLogItem[] | null>>>;
export async function getAuditLogs(
  params: GetAuditLogs,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<AuditLogItem[] | null>>;
export async function getAuditLogs(
  {
    access_token,
    page = 1,
    pageSize = 10,
    sortBy,
    sortOrder,
    id,
    action,
    resource,
    userUid,
    timestampStart,
    timestampEnd,
    startDate,
    endDate,
    search,
  }: GetAuditLogs,
  serverConfig?: ActionConfig,
): Promise<ActionResult<AuditLogItem[] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getAuditLogs"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      page,
      pageSize,
      sortBy,
      sortOrder,
      id,
      action,
      resource,
      userUid,
      timestampStart,
      timestampEnd,
      startDate,
      endDate,
      search,
    },
    GetAuditLogsSchema,
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
    // 计算偏移量
    const skip = (page - 1) * pageSize;

    // 构建过滤条件
    const where: {
      id?: number;
      action?: string;
      resource?: string;
      userUid?: number;
      timestamp?: {
        gte?: Date;
        lte?: Date;
      };
      OR?: Array<{
        description?: { contains: string; mode: "insensitive" };
        resourceId?: { contains: string; mode: "insensitive" };
        ipAddress?: { contains: string; mode: "insensitive" };
        userAgent?: { contains: string; mode: "insensitive" };
        action?: { contains: string; mode: "insensitive" };
        resource?: { contains: string; mode: "insensitive" };
        user?: {
          OR: Array<{
            username?: { contains: string; mode: "insensitive" };
            nickname?: { contains: string; mode: "insensitive" };
            email?: { contains: string; mode: "insensitive" };
          }>;
        };
      }>;
    } = {};

    if (id) where.id = id;
    if (action) where.action = action;
    if (resource) where.resource = resource;
    if (userUid) where.userUid = userUid;

    // 优先使用 timestampStart/End，向后兼容 startDate/endDate
    const effectiveStartDate = timestampStart || startDate;
    const effectiveEndDate = timestampEnd || endDate;

    if (effectiveStartDate || effectiveEndDate) {
      where.timestamp = {};
      if (effectiveStartDate)
        where.timestamp.gte = new Date(effectiveStartDate);
      if (effectiveEndDate) where.timestamp.lte = new Date(effectiveEndDate);
    }

    // 通用搜索：搜索描述、资源ID、IP地址、User Agent、操作类型、资源类型、用户信息
    if (search && search.trim()) {
      const searchTerm = search.trim();
      where.OR = [
        { description: { contains: searchTerm, mode: "insensitive" } },
        { resourceId: { contains: searchTerm, mode: "insensitive" } },
        { ipAddress: { contains: searchTerm, mode: "insensitive" } },
        { userAgent: { contains: searchTerm, mode: "insensitive" } },
        { action: { contains: searchTerm, mode: "insensitive" } },
        { resource: { contains: searchTerm, mode: "insensitive" } },
        {
          user: {
            OR: [
              { username: { contains: searchTerm, mode: "insensitive" } },
              { nickname: { contains: searchTerm, mode: "insensitive" } },
              { email: { contains: searchTerm, mode: "insensitive" } },
            ],
          },
        },
      ];
    }

    // 获取总数
    const total = await prisma.auditLog.count({ where });

    // 构建排序条件
    let orderBy:
      | { id: "asc" | "desc" }
      | { timestamp: "asc" | "desc" }
      | { action: "asc" | "desc" }
      | { resource: "asc" | "desc" }
      | { userUid: "asc" | "desc" } = {
      timestamp: "desc",
    }; // 默认排序

    if (sortBy && sortOrder) {
      orderBy = { [sortBy]: sortOrder } as typeof orderBy;
    }

    // 获取分页数据
    const records = await prisma.auditLog.findMany({
      skip,
      take: pageSize,
      where,
      orderBy,
      include: {
        user: {
          select: {
            uid: true,
            username: true,
            nickname: true,
          },
        },
      },
    });

    // 转换数据格式
    const data: AuditLogItem[] = records.map((record) => ({
      id: record.id,
      timestamp: record.timestamp.toISOString(),
      action: record.action,
      resource: record.resource,
      resourceId: record.resourceId,
      userUid: record.userUid,
      ipAddress: record.ipAddress,
      userAgent: record.userAgent,
      oldData: record.oldData,
      newData: record.newData,
      description: record.description,
      metadata: record.metadata as Record<
        string,
        string | number | boolean
      > | null,
      location: record.ipAddress ? resolveIpLocation(record.ipAddress) : null,
      user: record.user,
    }));

    // 计算分页元数据
    const totalPages = Math.ceil(total / pageSize);
    const meta = {
      page,
      pageSize,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    };

    return response.ok({
      data,
      meta,
    });
  } catch (error) {
    console.error("Get audit logs error:", error);
    return response.serverError();
  }
}

export async function getAuditTrends(
  params: GetAuditTrends,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<AuditTrendItem[] | null>>>;
export async function getAuditTrends(
  params: GetAuditTrends,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<AuditTrendItem[] | null>>;
export async function getAuditTrends(
  { access_token, days = 30, count = 30, groupBy = "action" }: GetAuditTrends,
  serverConfig?: ActionConfig,
): Promise<ActionResult<AuditTrendItem[] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getAuditTrends"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      days,
      count,
      groupBy,
    },
    GetAuditTrendsSchema,
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
    // 获取最近 N 天的时间范围
    const daysAgo = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // 获取最近 N 天和最近 N 次的并集
    const [recentByTime, recentByCount] = await Promise.all([
      // 按时间获取：最近 N 天
      prisma.auditLog.findMany({
        where: {
          timestamp: {
            gte: daysAgo,
          },
        },
        orderBy: {
          timestamp: "asc",
        },
        select: {
          id: true,
          timestamp: true,
          action: true,
          resource: true,
        },
      }),
      // 按数量获取：最近 N 次
      prisma.auditLog.findMany({
        take: count,
        orderBy: {
          timestamp: "desc",
        },
        select: {
          id: true,
          timestamp: true,
          action: true,
          resource: true,
        },
      }),
    ]);

    // 合并两个结果集并去重
    const mergedMap = new Map<number, (typeof recentByTime)[0]>();

    recentByTime.forEach((record) => {
      mergedMap.set(record.id, record);
    });

    recentByCount.forEach((record) => {
      mergedMap.set(record.id, record);
    });

    // 转换为数组并按时间排序
    const merged = Array.from(mergedMap.values()).sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    );

    // 按天分组统计
    const timeGroups = new Map<string, Map<string, number>>();

    merged.forEach((record) => {
      // 将时间戳转换为日期（保留完整时间信息）
      const date = new Date(record.timestamp);
      // 获取当天的起始时间作为分组键
      const dayStart = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
      );
      const timeKey = dayStart.toISOString(); // 使用完整 ISO 格式
      const groupKey = groupBy === "action" ? record.action : record.resource;

      if (!timeGroups.has(timeKey)) {
        timeGroups.set(timeKey, new Map());
      }

      const group = timeGroups.get(timeKey)!;
      group.set(groupKey, (group.get(groupKey) || 0) + 1);
    });

    // 转换数据格式并按时间排序
    const data: AuditTrendItem[] = Array.from(timeGroups.entries())
      .sort((a, b) => a[0].localeCompare(b[0])) // 按日期字符串排序
      .map(([time, counts]) => ({
        time,
        data: Object.fromEntries(counts),
      }));

    return response.ok({ data });
  } catch (error) {
    console.error("Get audit trends error:", error);
    return response.serverError();
  }
}
