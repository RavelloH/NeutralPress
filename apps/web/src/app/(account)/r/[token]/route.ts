import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jwtTokenVerify } from "@/lib/server/jwt";
import prisma from "@/lib/server/prisma";
import limitControl from "@/lib/server/rate-limit";
import ResponseBuilder from "@/lib/server/response";

const res = new ResponseBuilder("serverless");

/**
 * JWT 通知重定向接口
 * 验证 JWT → 标记通知已读 → 302 重定向到目标链接
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  // 速率限制检查
  const isAllowed = await limitControl(request.headers);
  if (!isAllowed) {
    return res.tooManyRequests({
      message: "请求过于频繁",
      error: { code: "RATE_LIMITED", message: "请求过于频繁，请稍后再试" },
    }) as Response;
  }

  try {
    // 验证 JWT
    const payload = jwtTokenVerify<{
      noticeId: string;
      userUid: number;
    }>(token);

    if (!payload || !payload.noticeId || !payload.userUid) {
      return res.badRequest({
        message: "无效的通知令牌",
        error: { code: "INVALID_TOKEN", message: "通知令牌格式不正确" },
      }) as Response;
    }

    // 查询通知
    const notice = await prisma.notice.findUnique({
      where: { id: payload.noticeId },
      select: {
        id: true,
        link: true,
        userUid: true,
        isRead: true,
      },
    });

    if (!notice) {
      return res.notFound({
        message: "通知不存在",
        error: { code: "NOTICE_NOT_FOUND", message: "未找到对应的通知" },
      }) as Response;
    }

    // 验证通知所属用户
    if (notice.userUid !== payload.userUid) {
      return res.forbidden({
        message: "通知令牌与用户不匹配",
        error: { code: "USER_MISMATCH", message: "通知令牌与用户不匹配" },
      }) as Response;
    }

    // 标记通知为已读
    if (!notice.isRead) {
      await prisma.notice.update({
        where: { id: notice.id },
        data: { isRead: true },
      });
    }

    // 重定向到目标链接或通知中心
    // 安全校验：只允许站内相对路径，防止开放重定向攻击
    const rawLink = notice.link || "/notifications";
    let redirectUrl: string;
    try {
      const parsed = new URL(rawLink, request.url);
      const requestOrigin = new URL(request.url).origin;
      // 只使用路径部分进行重定向，即使 origin 匹配也只取 pathname+search+hash
      redirectUrl =
        parsed.origin === requestOrigin
          ? `${parsed.pathname}${parsed.search}${parsed.hash}`
          : "/notifications";
    } catch {
      redirectUrl = "/notifications";
    }
    return NextResponse.redirect(new URL(redirectUrl, request.url), {
      status: 302,
    });
  } catch (error) {
    console.error("通知重定向失败:", error);
    return res.badRequest({
      message: "令牌验证失败或已过期",
      error: { code: "TOKEN_VERIFICATION_FAILED", message: "JWT 令牌验证失败" },
    }) as Response;
  }
}
