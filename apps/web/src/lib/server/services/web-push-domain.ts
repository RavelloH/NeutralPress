import "server-only";

import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import { headers } from "next/headers";
import type { NextResponse } from "next/server";

import { authVerify } from "@/lib/server/auth-verify";
import { getConfig } from "@/lib/server/config-cache";
import { sendNotice } from "@/lib/server/notice";
import prisma from "@/lib/server/prisma";
import limitControl from "@/lib/server/rate-limit";
import ResponseBuilder from "@/lib/server/response";
import { assertPublicHttpUrl } from "@/lib/server/url-security";

type WebPushActionEnvironment = "serverless" | "serveraction";
type WebPushActionConfig = { environment?: WebPushActionEnvironment };
type ActionResult<T extends ApiResponseData> =
  | ApiResponse<T>
  | NextResponse<ApiResponse<T>>;

/**
 * 订阅 Web Push
 */
export async function subscribeToWebPush(
  data: {
    endpoint: string;
    p256dh: string;
    auth: string;
    deviceName: string;
    userAgent?: string;
    browser?: string;
    os?: string;
  },
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<{ message: string } | null>>>;
export async function subscribeToWebPush(
  data: {
    endpoint: string;
    p256dh: string;
    auth: string;
    deviceName: string;
    userAgent?: string;
    browser?: string;
    os?: string;
  },
  serverConfig?: WebPushActionConfig,
): Promise<ApiResponse<{ message: string } | null>>;
export async function subscribeToWebPush(
  data: {
    endpoint: string;
    p256dh: string;
    auth: string;
    deviceName: string;
    userAgent?: string;
    browser?: string;
    os?: string;
  },
  serverConfig?: WebPushActionConfig,
): Promise<ActionResult<{ message: string } | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "subscribeToWebPush"))) {
    return response.tooManyRequests();
  }

  const user = await authVerify({
    allowedRoles: ["USER", "ADMIN", "EDITOR", "AUTHOR"],
  });

  if (!user) {
    return response.unauthorized({ message: "未登录" });
  }

  let endpoint: string;
  try {
    endpoint = (
      await assertPublicHttpUrl(data.endpoint, { requireHttps: true })
    ).url.toString();
  } catch (error) {
    return response.badRequest({
      message: "订阅地址无效",
      error: {
        code: "INVALID_ENDPOINT",
        message: error instanceof Error ? error.message : "订阅地址无效",
      },
    });
  }

  try {
    // 检查订阅数量限制
    const count = await prisma.pushSubscription.count({
      where: { userUid: user.uid, isActive: true },
    });

    const maxSubscriptions = await getConfig("notice.webPush.maxPerUser");

    if (count >= maxSubscriptions) {
      return response.badRequest({
        message: `最多只能订阅 ${maxSubscriptions} 个设备`,
      });
    }

    // 检查订阅是否已存在
    const existing = await prisma.pushSubscription.findUnique({
      where: { endpoint },
      select: {
        id: true,
        userUid: true,
      },
    });

    if (existing) {
      if (existing.userUid !== user.uid) {
        return response.forbidden({
          message: "无权更新该订阅",
          error: {
            code: "FORBIDDEN",
            message: "订阅不属于当前用户",
          },
        });
      }

      // 更新现有订阅
      await prisma.pushSubscription.update({
        where: { id: existing.id },
        data: {
          p256dh: data.p256dh,
          auth: data.auth,
          deviceName: data.deviceName,
          isActive: true,
          lastUsedAt: new Date(),
        },
      });

      return response.ok({
        message: "订阅已更新",
        data: { message: "订阅已更新" },
      });
    }

    // 创建新订阅
    await prisma.pushSubscription.create({
      data: {
        userUid: user.uid,
        endpoint,
        p256dh: data.p256dh,
        auth: data.auth,
        deviceName: data.deviceName,
        userAgent: data.userAgent,
        browser: data.browser,
        os: data.os,
      },
    });

    return response.ok({ message: "订阅成功", data: { message: "订阅成功" } });
  } catch (error) {
    console.error("[WebPush] Subscribe failed:", error);
    return response.serverError({
      message: "订阅失败",
      error: {
        code: "SERVER_ERROR",
        message: "订阅失败",
      },
    });
  }
}

/**
 * 获取 VAPID 公钥
 */
export async function getVapidPublicKey(serverConfig: {
  environment: "serverless";
}): Promise<NextResponse<ApiResponse<{ publicKey: string } | null>>>;
export async function getVapidPublicKey(
  serverConfig?: WebPushActionConfig,
): Promise<ApiResponse<{ publicKey: string } | null>>;
export async function getVapidPublicKey(
  serverConfig?: WebPushActionConfig,
): Promise<ActionResult<{ publicKey: string } | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  try {
    const vapidKeys = await getConfig("notice.webPush.vapidKeys");

    if (!vapidKeys?.publicKey) {
      return response.serviceUnavailable({
        message: "Web Push 未配置",
        error: {
          code: "WEB_PUSH_NOT_CONFIGURED",
          message: "VAPID keys not configured",
        },
      });
    }

    return response.ok({
      message: "获取成功",
      data: { publicKey: vapidKeys.publicKey },
    });
  } catch (error) {
    console.error("[WebPush] Get VAPID key failed:", error);
    return response.serverError({
      message: "获取 VAPID 公钥失败",
      error: {
        code: "SERVER_ERROR",
        message: "获取失败",
      },
    });
  }
}

/**
 * 获取用户的所有订阅
 */
export async function getUserPushSubscriptions(serverConfig: {
  environment: "serverless";
}): Promise<
  NextResponse<
    ApiResponse<{
      subscriptions: Array<{
        id: string;
        deviceName: string;
        browser: string | null;
        os: string | null;
        isActive: boolean;
        createdAt: Date;
        lastUsedAt: Date;
        endpoint: string;
      }>;
    } | null>
  >
>;
export async function getUserPushSubscriptions(
  serverConfig?: WebPushActionConfig,
): Promise<
  ApiResponse<{
    subscriptions: Array<{
      id: string;
      deviceName: string;
      browser: string | null;
      os: string | null;
      isActive: boolean;
      createdAt: Date;
      lastUsedAt: Date;
      endpoint: string;
    }>;
  } | null>
>;
export async function getUserPushSubscriptions(
  serverConfig?: WebPushActionConfig,
): Promise<
  ActionResult<{
    subscriptions: Array<{
      id: string;
      deviceName: string;
      browser: string | null;
      os: string | null;
      isActive: boolean;
      createdAt: Date;
      lastUsedAt: Date;
      endpoint: string;
    }>;
  } | null>
> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getUserPushSubscriptions"))) {
    return response.tooManyRequests();
  }

  const user = await authVerify({
    allowedRoles: ["USER", "ADMIN", "EDITOR", "AUTHOR"],
  });

  if (!user) {
    return response.unauthorized({ message: "未登录" });
  }

  try {
    const subscriptions = await prisma.pushSubscription.findMany({
      where: { userUid: user.uid },
      select: {
        id: true,
        deviceName: true,
        browser: true,
        os: true,
        isActive: true,
        createdAt: true,
        lastUsedAt: true,
        endpoint: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return response.ok({
      message: "获取成功",
      data: { subscriptions },
    });
  } catch (error) {
    console.error("[WebPush] Get subscriptions failed:", error);
    return response.serverError({
      message: "获取订阅列表失败",
      error: {
        code: "SERVER_ERROR",
        message: "获取失败",
      },
    });
  }
}

/**
 * 删除订阅
 */
export async function deleteWebPushSubscription(
  endpoint: string,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<{ message: string } | null>>>;
export async function deleteWebPushSubscription(
  endpoint: string,
  serverConfig?: WebPushActionConfig,
): Promise<ApiResponse<{ message: string } | null>>;
export async function deleteWebPushSubscription(
  endpoint: string,
  serverConfig?: WebPushActionConfig,
): Promise<ActionResult<{ message: string } | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "deleteWebPushSubscription"))) {
    return response.tooManyRequests();
  }

  const user = await authVerify({
    allowedRoles: ["USER", "ADMIN", "EDITOR", "AUTHOR"],
  });

  if (!user) {
    return response.unauthorized({ message: "未登录" });
  }

  try {
    await prisma.pushSubscription.deleteMany({
      where: {
        endpoint,
        userUid: user.uid,
      },
    });

    return response.ok({
      message: "订阅已删除",
      data: { message: "订阅已删除" },
    });
  } catch (error) {
    console.error("[WebPush] Delete subscription failed:", error);
    return response.serverError({
      message: "删除订阅失败",
      error: {
        code: "SERVER_ERROR",
        message: "删除失败",
      },
    });
  }
}

/**
 * 更新订阅(重命名)
 */
export async function updateWebPushSubscription(
  data: {
    endpoint: string;
    deviceName: string;
  },
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<{ message: string } | null>>>;
export async function updateWebPushSubscription(
  data: {
    endpoint: string;
    deviceName: string;
  },
  serverConfig?: WebPushActionConfig,
): Promise<ApiResponse<{ message: string } | null>>;
export async function updateWebPushSubscription(
  data: {
    endpoint: string;
    deviceName: string;
  },
  serverConfig?: WebPushActionConfig,
): Promise<ActionResult<{ message: string } | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "updateWebPushSubscription"))) {
    return response.tooManyRequests();
  }

  const user = await authVerify({
    allowedRoles: ["USER", "ADMIN", "EDITOR", "AUTHOR"],
  });

  if (!user) {
    return response.unauthorized({ message: "未登录" });
  }

  try {
    await prisma.pushSubscription.updateMany({
      where: {
        endpoint: data.endpoint,
        userUid: user.uid,
      },
      data: {
        deviceName: data.deviceName,
      },
    });

    return response.ok({
      message: "设备名称已更新",
      data: { message: "设备名称已更新" },
    });
  } catch (error) {
    console.error("[WebPush] Update subscription failed:", error);
    return response.serverError({
      message: "更新订阅失败",
      error: {
        code: "SERVER_ERROR",
        message: "更新失败",
      },
    });
  }
}

/**
 * 发送测试通知
 */
export async function sendTestWebPush(serverConfig: {
  environment: "serverless";
}): Promise<NextResponse<ApiResponse<{ message: string } | null>>>;
export async function sendTestWebPush(
  serverConfig?: WebPushActionConfig,
): Promise<ApiResponse<{ message: string } | null>>;
export async function sendTestWebPush(
  serverConfig?: WebPushActionConfig,
): Promise<ActionResult<{ message: string } | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "sendTestWebPush"))) {
    return response.tooManyRequests();
  }

  const user = await authVerify({
    allowedRoles: ["USER", "ADMIN", "EDITOR", "AUTHOR"],
  });

  if (!user) {
    return response.unauthorized({ message: "未登录" });
  }

  try {
    // 检查是否有有效订阅
    const subscriptionCount = await prisma.pushSubscription.count({
      where: { userUid: user.uid, isActive: true },
    });

    if (subscriptionCount === 0) {
      return response.badRequest({
        message: "未找到有效订阅",
      });
    }

    // 使用 sendNotice 发送测试通知
    // 这样可以同时发送 Ably 消息（页面内通知）和 Web Push（系统通知）
    await sendNotice(
      user.uid,
      "测试通知",
      "这是一条测试通知，如果你看到这条消息，说明通知功能配置成功！",
      undefined,
      { isTest: true }, // 标记为测试通知
    );

    return response.ok({
      message: `测试通知已发送到 ${subscriptionCount} 个设备`,
      data: {
        message: `测试通知已发送到 ${subscriptionCount} 个设备`,
      },
    });
  } catch (error) {
    console.error("[WebPush] Send test notification failed:", error);
    return response.serverError({
      message: "发送测试通知失败",
      error: {
        code: "SERVER_ERROR",
        message: "发送失败",
      },
    });
  }
}
