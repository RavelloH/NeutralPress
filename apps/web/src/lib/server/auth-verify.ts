import "server-only";

import { cookies } from "next/headers";

import type { AccessTokenPayload } from "@/lib/server/jwt";
import { jwtTokenVerify } from "@/lib/server/jwt";
import prisma from "@/lib/server/prisma";

/**
 * 用户角色类型
 */
export type UserRole = "USER" | "ADMIN" | "EDITOR" | "AUTHOR";

/**
 * 身份验证选项
 */
export interface AuthVerifyOptions {
  /** 允许的用户角色列表 */
  allowedRoles: UserRole[];
  /** 可选的访问令牌,未提供则从 cookie 中读取 */
  accessToken?: string;
}

export type ActiveSessionUser = {
  uid: number;
  username: string;
  nickname: string | null;
  role: string;
};

export async function verifySession(
  sessionId: string,
  uid: number,
): Promise<ActiveSessionUser | null> {
  if (!sessionId || !Number.isInteger(uid)) {
    return null;
  }

  try {
    const session = await prisma.refreshToken.findUnique({
      where: { id: sessionId },
      select: {
        userUid: true,
        expiresAt: true,
        revokedAt: true,
        user: {
          select: {
            uid: true,
            username: true,
            nickname: true,
            role: true,
            status: true,
            deletedAt: true,
          },
        },
      },
    });

    if (
      !session ||
      session.userUid !== uid ||
      session.revokedAt !== null ||
      session.expiresAt <= new Date() ||
      session.user.uid !== uid ||
      session.user.status !== "ACTIVE" ||
      session.user.deletedAt !== null
    ) {
      return null;
    }

    return {
      uid: session.user.uid,
      username: session.user.username,
      nickname: session.user.nickname,
      role: session.user.role,
    };
  } catch {
    return null;
  }
}

/**
 * 验证访问令牌并读取当前会话和用户状态。
 */
export async function verifyAccessToken(
  token: string,
): Promise<AccessTokenPayload | null> {
  const payload = jwtTokenVerify<AccessTokenPayload>(token);
  if (
    !payload ||
    payload.type !== "access" ||
    !Number.isInteger(payload.uid) ||
    typeof payload.sessionId !== "string" ||
    !payload.sessionId
  ) {
    return null;
  }

  const user = await verifySession(payload.sessionId, payload.uid);
  if (!user) {
    return null;
  }

  return {
    ...payload,
    uid: user.uid,
    username: user.username,
    nickname: user.nickname || user.username,
    role: user.role,
  };
}

/**
 * 验证用户身份和权限
 *
 * @param options - 验证选项
 * @returns 验证成功返回用户信息,失败返回 null
 *
 */
export async function authVerify(
  options: AuthVerifyOptions,
): Promise<AccessTokenPayload | null> {
  const { allowedRoles, accessToken } = options;

  // 获取 token
  let token = accessToken;
  if (!token) {
    const cookieStore = await cookies();
    token = cookieStore.get("ACCESS_TOKEN")?.value;
  }

  // 验证 token 是否存在
  if (!token) {
    return null;
  }

  // 验证 token 有效性
  const user = await verifyAccessToken(token);
  if (!user) {
    return null;
  }

  // 验证用户角色权限
  if (!allowedRoles.includes(user.role as UserRole)) {
    return null;
  }

  return user;
}
