import "server-only";

import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type { GetSettings, SettingItem } from "@repo/shared-types/api/setting";
import { GetSettingsSchema } from "@repo/shared-types/api/setting";
import { headers } from "next/headers";
import type { NextResponse } from "next/server";

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
export async function getSettings(
  params: GetSettings,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<SettingItem[] | null>>>;

export async function getSettings(
  params: GetSettings,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<SettingItem[] | null>>;

export async function getSettings(
  { access_token }: GetSettings,
  serverConfig?: ActionConfig,
): Promise<ActionResult<SettingItem[] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getSettings"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
    },
    GetSettingsSchema,
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
    // 获取所有配置项
    const configs = await prisma.config.findMany({
      orderBy: {
        createdAt: "asc",
      },
    });

    // 转换数据格式
    const data: SettingItem[] = configs.map((config) => ({
      key: config.key,
      value: config.value,
      updatedAt: config.updatedAt.toISOString(),
    }));

    return response.ok({ data });
  } catch (error) {
    console.error("Get settings error:", error);
    return response.serverError();
  }
}
