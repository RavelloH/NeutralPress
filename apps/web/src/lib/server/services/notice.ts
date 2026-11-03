import "server-only";

import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type { GetUnreadNoticeCountSuccessResponse } from "@repo/shared-types/api/notice";
import { cookies, headers } from "next/headers";
import type { NextResponse } from "next/server";

import { authVerify } from "@/lib/server/auth-verify";
import prisma from "@/lib/server/prisma";
import limitControl from "@/lib/server/rate-limit";
import ResponseBuilder from "@/lib/server/response";

type NoticeActionConfig = { environment?: "serverless" | "serveraction" };
type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

/**
 * 获取未读通知数量
 */
export async function getUnreadNoticeCount(serverConfig: {
  environment: "serverless";
}): Promise<
  NextResponse<ApiResponse<GetUnreadNoticeCountSuccessResponse["data"]>>
>;
export async function getUnreadNoticeCount(
  serverConfig?: NoticeActionConfig,
): Promise<ApiResponse<GetUnreadNoticeCountSuccessResponse["data"]>>;
export async function getUnreadNoticeCount(
  serverConfig?: NoticeActionConfig,
): Promise<ActionResult<GetUnreadNoticeCountSuccessResponse["data"] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  // 速率控制
  if (!(await limitControl(await headers(), "getUnreadNoticeCount"))) {
    return response.tooManyRequests();
  }

  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("ACCESS_TOKEN")?.value;
    const user = await authVerify({
      allowedRoles: ["USER", "ADMIN", "EDITOR", "AUTHOR"],
      accessToken: token,
    });

    if (!user) {
      return response.unauthorized({
        message: "未登录",
      });
    }

    const count = await prisma.notice.count({
      where: {
        userUid: user.uid,
        isRead: false,
      },
    });

    // 查询私信未读数：汇总所有私聊对话的 unreadCount
    const messageUnreadResult = await prisma.conversationParticipant.aggregate({
      where: {
        userUid: user.uid,
      },
      _sum: {
        unreadCount: true,
      },
    });

    const messageCount = messageUnreadResult._sum?.unreadCount || 0;

    return response.ok({
      message: "获取未读通知数量成功",
      data: {
        count,
        messageCount,
      },
    }) as unknown as ActionResult<
      GetUnreadNoticeCountSuccessResponse["data"] | null
    >;
  } catch (error) {
    console.error("获取未读通知数量失败:", error);
    return response.serverError({
      message: "获取未读通知数量失败",
      error: {
        code: "SERVER_ERROR",
        message: "获取未读通知数量失败",
      },
    });
  }
}
