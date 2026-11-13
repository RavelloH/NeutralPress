import "server-only";

import type { ApiResponse } from "@repo/shared-types/api/common";
import { cookies } from "next/headers";

import { verifyAccessToken } from "@/lib/server/auth-verify";
import prisma from "@/lib/server/prisma";
import ResponseBuilder from "@/lib/server/response";
export async function getCurrentUserForReauth(): Promise<
  ApiResponse<{
    uid: number;
    username: string;
    email: string;
    hasPassword: boolean;
    linkedProviders: string[];
    hasTotpEnabled: boolean;
  }>
> {
  const response = new ResponseBuilder("serveraction");

  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("ACCESS_TOKEN")?.value || "";
    const decoded = await verifyAccessToken(token);

    if (!decoded) {
      return response.unauthorized({
        message: "请先登录",
      }) as unknown as ApiResponse<{
        uid: number;
        username: string;
        email: string;
        hasPassword: boolean;
        linkedProviders: string[];
        hasTotpEnabled: boolean;
      }>;
    }

    const { uid } = decoded;

    const user = await prisma.user.findUnique({
      where: { uid },
      select: {
        uid: true,
        username: true,
        email: true,
        password: true,
        totpSecret: true,
        accounts: {
          select: {
            provider: true,
          },
        },
      },
    });

    if (!user) {
      return response.unauthorized({
        message: "用户不存在",
      }) as unknown as ApiResponse<{
        uid: number;
        username: string;
        email: string;
        hasPassword: boolean;
        linkedProviders: string[];
        hasTotpEnabled: boolean;
      }>;
    }

    return response.ok({
      message: "获取成功",
      data: {
        uid: user.uid,
        username: user.username,
        email: user.email,
        hasPassword: !!user.password,
        linkedProviders: user.accounts.map((acc) => acc.provider.toLowerCase()),
        hasTotpEnabled: !!user.totpSecret,
      },
    }) as unknown as ApiResponse<{
      uid: number;
      username: string;
      email: string;
      hasPassword: boolean;
      linkedProviders: string[];
      hasTotpEnabled: boolean;
    }>;
  } catch (error) {
    console.error("Get current user for reauth error:", error);
    return response.serverError({
      message: "获取用户信息失败",
      error: {
        code: "SERVER_ERROR",
        message: "获取用户信息失败",
      },
    }) as unknown as ApiResponse<{
      uid: number;
      username: string;
      email: string;
      hasPassword: boolean;
      linkedProviders: string[];
      hasTotpEnabled: boolean;
    }>;
  }
}
