import "server-only";

import type { TotpStatusResponse } from "@repo/shared-types/api/auth";
import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

import { verifyAccessToken } from "@/lib/server/auth-verify";
import prisma from "@/lib/server/prisma";
import ResponseBuilder from "@/lib/server/response";

type AuthActionEnvironment = "serverless" | "serveraction";

type AuthActionConfig = { environment?: AuthActionEnvironment };

type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

function getBackupCodesRemaining(backupCodesData: unknown): number {
  if (!backupCodesData || typeof backupCodesData !== "object") {
    return 0;
  }

  const data = backupCodesData as {
    codes?: Array<{ code: string; used: boolean }>;
  };

  if (!Array.isArray(data.codes)) {
    return 0;
  }

  return data.codes.filter((c) => !c.used).length;
}

export async function getTotpStatus(serverConfig: {
  environment: "serverless";
}): Promise<NextResponse<ApiResponse<TotpStatusResponse["data"]>>>;

export async function getTotpStatus(
  serverConfig?: AuthActionConfig,
): Promise<ApiResponse<TotpStatusResponse["data"]>>;

export async function getTotpStatus(
  serverConfig?: AuthActionConfig,
): Promise<ActionResult<TotpStatusResponse["data"] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  try {
    // 从 ACCESS_TOKEN 中获取用户 UID
    const cookieStore = await cookies();
    const accessToken = cookieStore.get("ACCESS_TOKEN")?.value;
    if (!accessToken) {
      return response.unauthorized({
        message: "未登录",
      });
    }

    const decoded = await verifyAccessToken(accessToken);
    if (!decoded) {
      return response.unauthorized({
        message: "未登录",
      });
    }

    const { uid } = decoded;

    // 查询用户 TOTP 状态
    const user = await prisma.user.findUnique({
      where: { uid },
      select: {
        totpSecret: true,
        totpBackupCodes: true,
      },
    });

    if (!user) {
      return response.unauthorized({
        message: "用户不存在",
      });
    }

    const enabled = !!user.totpSecret;
    const backupCodesRemaining = getBackupCodesRemaining(user.totpBackupCodes);

    return response.ok({
      message: "获取 TOTP 状态成功",
      data: {
        enabled,
        backupCodesRemaining,
      },
    });
  } catch (error) {
    console.error("Get TOTP status error:", error);
    return response.serverError({
      message: "获取状态失败，请稍后重试",
    });
  }
}
