import "server-only";

import type {
  GetSessionsSuccessResponse,
  Session,
} from "@repo/shared-types/api/auth";
import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

import {
  type AccessTokenPayload,
  jwtTokenVerify,
  type RefreshTokenPayload,
} from "@/lib/server/jwt";
import prisma from "@/lib/server/prisma";
import ResponseBuilder from "@/lib/server/response";

type AuthActionEnvironment = "serverless" | "serveraction";

type AuthActionConfig = { environment?: AuthActionEnvironment };

type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

export async function getSessions(serverConfig: {
  environment: "serverless";
}): Promise<NextResponse<ApiResponse<GetSessionsSuccessResponse["data"]>>>;

export async function getSessions(
  serverConfig?: AuthActionConfig,
): Promise<ApiResponse<GetSessionsSuccessResponse["data"]>>;

export async function getSessions(
  serverConfig?: AuthActionConfig,
): Promise<ActionResult<GetSessionsSuccessResponse["data"] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  try {
    // 从 cookie 中获取当前的 REFRESH_TOKEN
    const cookieStore = await cookies();
    const currentToken = cookieStore.get("REFRESH_TOKEN")?.value;

    let currentTokenId: string | null = null;
    if (currentToken) {
      const decoded = jwtTokenVerify<RefreshTokenPayload>(currentToken);
      currentTokenId = decoded?.tokenId || null;
    }

    // 从 ACCESS_TOKEN 中获取用户 UID
    const accessToken = cookieStore.get("ACCESS_TOKEN")?.value;
    if (!accessToken) {
      return response.unauthorized({
        message: "未登录",
      });
    }

    const decodedAccess = jwtTokenVerify<AccessTokenPayload>(accessToken);
    if (!decodedAccess) {
      return response.unauthorized({
        message: "未登录",
      });
    }

    const { uid } = decodedAccess;

    // 获取该用户的所有 RefreshToken（包括已撤销的）
    const tokens = await prisma.refreshToken.findMany({
      where: {
        userUid: uid,
      },
      orderBy: [
        { revokedAt: "asc" }, // 未撤销的在前
        { lastUsedAt: "desc" }, // 按最后使用时间降序
      ],
    });

    // 解析每个 token
    const { parseUserAgent, formatIpLocation } = await import(
      "@/lib/server/user-agent-parser"
    );
    const { resolveIpLocation } = await import("@/lib/server/ip-utils");

    const sessions: Session[] = tokens.map((token) => {
      const parsedUA = parseUserAgent(token.userAgent);
      const ipLocation = resolveIpLocation(token.ipAddress);
      const formattedLocation = formatIpLocation(ipLocation);

      return {
        id: token.id,
        deviceType: parsedUA.deviceType,
        deviceIcon: parsedUA.deviceIcon,
        displayName: parsedUA.displayName,
        browserName: parsedUA.browserName,
        browserVersion: parsedUA.browserVersion,
        createdAt: token.createdAt.toISOString(),
        lastUsedAt: token.lastUsedAt ? token.lastUsedAt.toISOString() : null,
        ipAddress: token.ipAddress || "unknown",
        ipLocation:
          formattedLocation ||
          (token.ipAddress &&
          (token.ipAddress.startsWith("127.") ||
            token.ipAddress.startsWith("192.168.") ||
            token.ipAddress === "::1")
            ? "本地网络"
            : null),
        revokedAt: token.revokedAt ? token.revokedAt.toISOString() : null,
        isCurrent: token.id === currentTokenId,
      };
    });

    // 排序：当前会话 → 活跃会话（按 lastUsedAt 降序） → 已撤销会话（按 revokedAt 降序）
    const sortedSessions = sessions.sort((a, b) => {
      // 当前会话排第一
      if (a.isCurrent) return -1;
      if (b.isCurrent) return 1;

      // 未撤销的在撤销的前面
      if (!a.revokedAt && b.revokedAt) return -1;
      if (a.revokedAt && !b.revokedAt) return 1;

      // 都未撤销：按 lastUsedAt 降序
      if (!a.revokedAt && !b.revokedAt) {
        const aTime = a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : 0;
        const bTime = b.lastUsedAt ? new Date(b.lastUsedAt).getTime() : 0;
        return bTime - aTime;
      }

      // 都已撤销：按 revokedAt 降序
      if (a.revokedAt && b.revokedAt) {
        return (
          new Date(b.revokedAt).getTime() - new Date(a.revokedAt).getTime()
        );
      }

      return 0;
    });

    return response.ok({
      message: "获取会话列表成功",
      data: {
        sessions: sortedSessions,
      },
    }) as unknown as ActionResult<GetSessionsSuccessResponse["data"] | null>;
  } catch (error) {
    console.error("Get sessions error:", error);
    return response.serverError({
      message: "获取会话列表失败",
    });
  }
}
