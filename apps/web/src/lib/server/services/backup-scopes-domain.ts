import "server-only";

import type { GetBackupScopes } from "@repo/shared-types/api/backup";
import { GetBackupScopesSchema } from "@repo/shared-types/api/backup";
import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import { headers } from "next/headers";
import type { NextResponse } from "next/server";

import { authVerify } from "@/lib/server/auth-verify";
import { getBackupScopes as getBackupScopesService } from "@/lib/server/backup";
import limitControl from "@/lib/server/rate-limit";
import ResponseBuilder from "@/lib/server/response";
import { validateData } from "@/lib/server/validator";

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}

type ActionEnvironment = "serverless" | "serveraction";
type ActionConfig = { environment?: ActionEnvironment };
type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

export async function getBackupScopes(
  params: GetBackupScopes,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<ApiResponse<ReturnType<typeof getBackupScopesService> | null>>
>;

export async function getBackupScopes(
  params: GetBackupScopes,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<ReturnType<typeof getBackupScopesService> | null>>;

export async function getBackupScopes(
  { access_token }: GetBackupScopes,
  serverConfig?: ActionConfig,
): Promise<ActionResult<ReturnType<typeof getBackupScopesService> | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getBackupScopes"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
    },
    GetBackupScopesSchema,
  );
  if (validationError) return response.badRequest(validationError);

  const user = await authVerify({
    allowedRoles: ["ADMIN"],
    accessToken: access_token,
  });
  if (!user) {
    return response.unauthorized();
  }

  try {
    return response.ok({
      data: getBackupScopesService(),
    });
  } catch (error) {
    console.error("Get backup scopes error:", error);
    return response.serverError({
      message: toErrorMessage(error, "获取备份分组失败"),
    });
  }
}
