import "server-only";

import type { ApiResponse } from "@repo/shared-types/api/common";

import { authVerify } from "@/lib/server/auth-verify";
import { assertPasskeyEnabledAndLimit } from "@/lib/server/passkey";
import prisma from "@/lib/server/prisma";
import ResponseBuilder from "@/lib/server/response";

export async function listUserPasskeys(): Promise<
  ApiResponse<{
    items: Array<{
      credentialId: string;
      name: string;
      deviceType: string | null;
      browser: string | null;
      createdAt: string;
      lastUsedAt: string | null;
    }>;
  }>
> {
  const response = new ResponseBuilder("serveraction");
  try {
    // 使用统一的 authVerify 进行身份验证
    const authUser = await authVerify({
      allowedRoles: ["USER", "ADMIN", "EDITOR", "AUTHOR"],
    });
    if (!authUser)
      return response.unauthorized({
        message: "请先登录",
      }) as unknown as ApiResponse<{
        items: Array<{
          credentialId: string;
          name: string;
          deviceType: string | null;
          browser: string | null;
          createdAt: string;
          lastUsedAt: string | null;
        }>;
      }>;
    await assertPasskeyEnabledAndLimit();
    const items = await prisma.passkey.findMany({
      where: { userUid: authUser.uid },
      orderBy: { createdAt: "desc" },
      select: {
        credentialId: true,
        name: true,
        deviceType: true,
        browser: true,
        createdAt: true,
        lastUsedAt: true,
      },
    });
    return response.ok({
      message: "获取成功",
      data: {
        items: items.map((i) => ({
          credentialId: i.credentialId,
          name: i.name,
          deviceType: i.deviceType ?? null,
          browser: i.browser ?? null,
          createdAt: i.createdAt.toISOString(),
          lastUsedAt: i.lastUsedAt ? i.lastUsedAt.toISOString() : null,
        })),
      },
    }) as unknown as ApiResponse<{
      items: Array<{
        credentialId: string;
        name: string;
        deviceType: string | null;
        browser: string | null;
        createdAt: string;
        lastUsedAt: string | null;
      }>;
    }>;
  } catch (error) {
    console.error("listUserPasskeys error:", error);
    return response.serverError({
      message: "获取失败",
      error: { code: "SERVER_ERROR", message: "获取失败" },
    }) as unknown as ApiResponse<{
      items: Array<{
        credentialId: string;
        name: string;
        deviceType: string | null;
        browser: string | null;
        createdAt: string;
        lastUsedAt: string | null;
      }>;
    }>;
  }
}
