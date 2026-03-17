"use server";

import type { ApiResponse } from "@repo/shared-types/api/common";
import { createHash } from "crypto";
import { cookies, headers } from "next/headers";

import { logAuditEvent } from "@/lib/server/audit";
import { verifyToken } from "@/lib/server/captcha";
import { getClientIP, getClientUserAgent } from "@/lib/server/get-client-info";
import {
  type AccessTokenPayload,
  jwtTokenSign,
  jwtTokenVerify,
  type TotpTokenPayload,
} from "@/lib/server/jwt";
import { verifyPassword } from "@/lib/server/password";
import prisma from "@/lib/server/prisma";
import limitControl from "@/lib/server/rate-limit";
import ResponseBuilder from "@/lib/server/response";
import {
  checkTotpFailCount,
  decryptBackupCode,
  decryptTotpSecret,
  incrementTotpFailCount,
  isValidBackupCodeFormat,
  resetTotpFailCount,
  verifyTotpCode,
} from "@/lib/server/totp";

const REAUTH_TOKEN_EXPIRY = 600; // 10 分钟

type ReauthTokenPayload = {
  uid: number;
  type?: string;
  exp: number;
  ipHash?: string;
  userAgentHash?: string;
};

function hashTokenBindingValue(value: string): string | undefined {
  const normalizedValue = value.trim().toLowerCase();
  if (!normalizedValue || normalizedValue === "unknown") {
    return undefined;
  }
  return createHash("sha256")
    .update(normalizedValue)
    .digest("hex")
    .slice(0, 32);
}

async function getReauthTokenBindings(): Promise<{
  ipHash?: string;
  userAgentHash?: string;
}> {
  const [ip, userAgent] = await Promise.all([
    getClientIP(),
    getClientUserAgent(),
  ]);
  return {
    ipHash: hashTokenBindingValue(ip),
    userAgentHash: hashTokenBindingValue(userAgent),
  };
}

/**
 * 检查是否有有效的 REAUTH_TOKEN，并绑定当前登录用户
 */
export async function checkReauthToken(expectedUid?: number): Promise<boolean> {
  try {
    const cookieStore = await cookies();
    const reauthToken = cookieStore.get("REAUTH_TOKEN")?.value;

    if (!reauthToken) {
      return false;
    }

    // 验证 token 是否有效
    const decoded = jwtTokenVerify<ReauthTokenPayload>(reauthToken);
    if (!decoded) {
      return false;
    }

    // 校验 token 类型
    if (decoded.type !== "reauth") {
      cookieStore.delete("REAUTH_TOKEN");
      return false;
    }

    // 检查是否过期
    const now = Math.floor(Date.now() / 1000);
    if (decoded.exp < now) {
      cookieStore.delete("REAUTH_TOKEN");
      return false;
    }

    let verifyUid = expectedUid;

    if (!verifyUid) {
      const accessToken = cookieStore.get("ACCESS_TOKEN")?.value || "";
      const accessDecoded = jwtTokenVerify<AccessTokenPayload>(accessToken);
      if (!accessDecoded?.uid) {
        return false;
      }
      verifyUid = accessDecoded.uid;
    }

    const isMatched = decoded.uid === verifyUid;
    if (!isMatched) {
      cookieStore.delete("REAUTH_TOKEN");
      return false;
    }

    if (decoded.ipHash || decoded.userAgentHash) {
      const currentBindings = await getReauthTokenBindings();
      if (decoded.ipHash && decoded.ipHash !== currentBindings.ipHash) {
        cookieStore.delete("REAUTH_TOKEN");
        return false;
      }
      if (
        decoded.userAgentHash &&
        decoded.userAgentHash !== currentBindings.userAgentHash
      ) {
        cookieStore.delete("REAUTH_TOKEN");
        return false;
      }
    }

    return true;
  } catch (error) {
    console.error("Check reauth token error:", error);
    return false;
  }
}

/**
 * 获取当前用户信息（用于 reauth 页面）
 */
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
    const decoded = jwtTokenVerify<AccessTokenPayload>(token);

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

/**
 * 通过密码验证身份并设置 REAUTH_TOKEN
 */
export async function verifyPasswordForReauth({
  password,
  captcha_token,
}: {
  password: string;
  captcha_token: string;
}): Promise<ApiResponse<null>> {
  const response = new ResponseBuilder("serveraction");

  // 速率控制（与登录一致）
  if (!(await limitControl(await headers(), "reauth"))) {
    return response.tooManyRequests() as unknown as ApiResponse<null>;
  }

  // 验证码验证（与登录一致）
  if (!(await verifyToken(captcha_token)).success) {
    return response.unauthorized({
      message: "安全验证失败，请刷新页面重试",
    }) as unknown as ApiResponse<null>;
  }

  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("ACCESS_TOKEN")?.value || "";
    const decoded = jwtTokenVerify<AccessTokenPayload>(token);

    if (!decoded) {
      return response.unauthorized({
        message: "请先登录",
      }) as unknown as ApiResponse<null>;
    }

    const { uid } = decoded;

    const user = await prisma.user.findUnique({
      where: { uid },
      select: {
        uid: true,
        password: true,
        totpSecret: true,
      },
    });

    if (!user) {
      return response.unauthorized({
        message: "用户不存在",
      }) as unknown as ApiResponse<null>;
    }

    if (!user.password) {
      return response.badRequest({
        message: "此账户未设置密码",
        error: {
          code: "NO_PASSWORD_SET",
          message: "此账户未设置密码",
        },
      }) as unknown as ApiResponse<null>;
    }

    // 验证密码
    const isPasswordValid = await verifyPassword(user.password, password);
    if (!isPasswordValid.isValid) {
      return response.badRequest({
        message: "密码错误",
        error: {
          code: "INVALID_PASSWORD",
          message: "密码错误",
        },
      }) as unknown as ApiResponse<null>;
    }

    // 检查是否启用了 TOTP
    if (user.totpSecret) {
      // 用户启用了 TOTP，签发临时 TOTP Token
      const totpToken = jwtTokenSign({
        inner: {
          uid: user.uid,
          type: "totp_verification",
        },
        expired: "5m",
      });

      // 设置 TOTP Token Cookie
      cookieStore.set({
        name: "TOTP_TOKEN",
        value: totpToken,
        httpOnly: true,
        maxAge: 300, // 5分钟
        sameSite: "strict",
        path: "/",
        secure: process.env.NODE_ENV === "production",
        priority: "high",
      });

      // 重置 TOTP 验证失败次数
      await resetTotpFailCount(user.uid);
      try {
        await logAuditEvent({
          user: {
            uid: user.uid.toString(),
          },
          details: {
            action: "VERIFY",
            resourceType: "REAUTH_PASSWORD",
            resourceId: user.uid.toString(),
            value: {
              old: { reauthVerified: false },
              new: { reauthVerified: false, requiresTotp: true },
            },
            description: `用户通过密码完成首段二次验证，等待 TOTP - uid: ${user.uid}`,
            metadata: {
              requiresTotp: true,
            },
          },
        });
      } catch (error) {
        console.error("Failed to log audit event:", error);
      }

      // 返回需要 TOTP 验证的响应
      return response.ok({
        message: "密码验证成功，请输入两步验证码",
        data: {
          requiresTotp: true,
        },
      }) as unknown as ApiResponse<null>;
    }

    // 如果没有启用 TOTP，直接生成 REAUTH_TOKEN

    const bindings = await getReauthTokenBindings();

    // 生成 REAUTH_TOKEN
    const expiredAtUnix = Math.floor(Date.now() / 1000) + REAUTH_TOKEN_EXPIRY;
    const reauthToken = jwtTokenSign({
      inner: {
        uid: user.uid,
        type: "reauth",
        exp: expiredAtUnix,
        ...bindings,
      },
      expired: `${REAUTH_TOKEN_EXPIRY}s`,
    });

    // 设置 REAUTH_TOKEN cookie
    cookieStore.set("REAUTH_TOKEN", reauthToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: REAUTH_TOKEN_EXPIRY,
      path: "/",
      priority: "high",
    });

    try {
      await logAuditEvent({
        user: {
          uid: user.uid.toString(),
        },
        details: {
          action: "VERIFY",
          resourceType: "REAUTH_PASSWORD",
          resourceId: user.uid.toString(),
          value: {
            old: { reauthVerified: false },
            new: { reauthVerified: true, requiresTotp: false },
          },
          description: `用户通过密码完成二次验证 - uid: ${user.uid}`,
          metadata: {
            requiresTotp: false,
          },
        },
      });
    } catch (error) {
      console.error("Failed to log audit event:", error);
    }

    return response.ok({
      message: "验证成功",
      data: null,
    }) as unknown as ApiResponse<null>;
  } catch (error) {
    console.error("Verify password for reauth error:", error);
    return response.serverError({
      message: "验证失败，请稍后重试",
      error: {
        code: "SERVER_ERROR",
        message: "验证失败，请稍后重试",
      },
    }) as unknown as ApiResponse<null>;
  }
}

/**
 * 通过 TOTP 验证身份并设置 REAUTH_TOKEN（用于 Reauth 流程）
 */
export async function verifyTotpForReauth({
  totp_code,
  backup_code,
}: {
  totp_code?: string;
  backup_code?: string;
}): Promise<ApiResponse<null>> {
  const response = new ResponseBuilder("serveraction");

  // 速率控制
  if (!(await limitControl(await headers(), "verifyTotpForReauth"))) {
    return response.tooManyRequests() as unknown as ApiResponse<null>;
  }

  // 必须提供 totp_code 或 backup_code 其中之一
  if (!totp_code && !backup_code) {
    return response.badRequest({
      message: "请提供验证码或备份码",
    }) as unknown as ApiResponse<null>;
  }

  try {
    const cookieStore = await cookies();

    // 从 cookie 中获取 TOTP Token
    const totpToken = cookieStore.get("TOTP_TOKEN")?.value;
    if (!totpToken) {
      return response.unauthorized({
        message: "验证超时，请重新验证",
      }) as unknown as ApiResponse<null>;
    }

    // 验证 TOTP Token
    const decoded = jwtTokenVerify<TotpTokenPayload>(totpToken);

    if (!decoded || decoded.type !== "totp_verification") {
      return response.unauthorized({
        message: "无效的验证令牌",
      }) as unknown as ApiResponse<null>;
    }

    const { uid } = decoded;

    // 检查是否超过失败次数限制
    if (await checkTotpFailCount(uid)) {
      // 清除 TOTP Token
      cookieStore.delete("TOTP_TOKEN");
      return response.unauthorized({
        message: "验证失败次数过多，请重新验证",
        error: {
          code: "TOTP_VERIFICATION_FAILED",
          message: "验证失败次数过多，请重新验证",
        },
      }) as unknown as ApiResponse<null>;
    }

    // 查询用户
    const user = await prisma.user.findUnique({
      where: { uid },
      select: {
        uid: true,
        totpSecret: true,
        totpBackupCodes: true,
      },
    });

    if (!user || !user.totpSecret) {
      return response.badRequest({
        message: "TOTP 未启用",
        error: {
          code: "TOTP_NOT_ENABLED",
          message: "TOTP 未启用",
        },
      }) as unknown as ApiResponse<null>;
    }

    // 解密 TOTP secret
    const secret = decryptTotpSecret(user.totpSecret);
    if (!secret) {
      return response.serverError({
        message: "TOTP 配置错误，请联系管理员",
      }) as unknown as ApiResponse<null>;
    }

    let verified = false;

    // 验证 TOTP 码
    if (totp_code) {
      verified = verifyTotpCode(secret, totp_code);
    }
    // 验证备份码
    else if (backup_code && user.totpBackupCodes) {
      if (!isValidBackupCodeFormat(backup_code)) {
        await incrementTotpFailCount(uid);
        return response.badRequest({
          message: "备份码格式错误",
        }) as unknown as ApiResponse<null>;
      }

      const backupCodesData = user.totpBackupCodes as {
        codes: Array<{ code: string; used: boolean; usedAt: string | null }>;
      };

      // 查找匹配的备份码
      for (const item of backupCodesData.codes) {
        if (item.used) continue;

        const decryptedCode = decryptBackupCode(item.code);
        if (decryptedCode === backup_code) {
          verified = true;

          // 标记备份码为已使用
          item.used = true;
          item.usedAt = new Date().toISOString();

          await prisma.user.update({
            where: { uid },
            data: {
              totpBackupCodes: backupCodesData,
            },
          });

          break;
        }
      }
    }

    if (!verified) {
      await incrementTotpFailCount(uid);
      return response.badRequest({
        message: "验证码错误，请重试",
      }) as unknown as ApiResponse<null>;
    }

    // 验证成功，重置失败次数
    await resetTotpFailCount(uid);

    // 清除 TOTP Token
    cookieStore.delete("TOTP_TOKEN");

    const bindings = await getReauthTokenBindings();

    // 生成 REAUTH_TOKEN
    const expiredAtUnix = Math.floor(Date.now() / 1000) + REAUTH_TOKEN_EXPIRY;
    const reauthToken = jwtTokenSign({
      inner: {
        uid: user.uid,
        type: "reauth",
        exp: expiredAtUnix,
        ...bindings,
      },
      expired: `${REAUTH_TOKEN_EXPIRY}s`,
    });

    // 设置 REAUTH_TOKEN cookie
    cookieStore.set("REAUTH_TOKEN", reauthToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: REAUTH_TOKEN_EXPIRY,
      path: "/",
      priority: "high",
    });

    try {
      await logAuditEvent({
        user: {
          uid: user.uid.toString(),
        },
        details: {
          action: "VERIFY",
          resourceType: "REAUTH_TOTP",
          resourceId: user.uid.toString(),
          value: {
            old: { reauthVerified: false },
            new: {
              reauthVerified: true,
              method: backup_code ? "backup_code" : "totp_code",
            },
          },
          description: `用户通过 TOTP 完成二次验证 - uid: ${user.uid}`,
          metadata: {
            useBackupCode: Boolean(backup_code),
          },
        },
      });
    } catch (error) {
      console.error("Failed to log audit event:", error);
    }

    return response.ok({
      message: "验证成功",
      data: null,
    }) as unknown as ApiResponse<null>;
  } catch (error) {
    console.error("Verify TOTP for reauth error:", error);
    return response.serverError({
      message: "验证失败，请稍后重试",
      error: {
        code: "SERVER_ERROR",
        message: "验证失败，请稍后重试",
      },
    }) as unknown as ApiResponse<null>;
  }
}

/**
 * 通过 SSO 验证身份并设置 REAUTH_TOKEN
 * 在 SSO 回调时调用此函数
 */
export async function verifySSOForReauth({
  uid,
  provider,
  providerAccountId,
}: {
  uid: number;
  provider: string;
  providerAccountId: string;
}): Promise<ApiResponse<null>> {
  const response = new ResponseBuilder("serveraction");

  try {
    const cookieStore = await cookies();
    const oauthReauthToken = cookieStore.get(
      `oauth_reauth_token_${provider}`,
    )?.value;

    if (!oauthReauthToken) {
      return response.unauthorized({
        message: "认证信息缺失，请重新发起验证",
      }) as unknown as ApiResponse<null>;
    }

    const oauthReauthPayload = jwtTokenVerify<{
      uid: number;
      purpose: string;
      provider: string;
    }>(oauthReauthToken);

    if (
      !oauthReauthPayload ||
      oauthReauthPayload.purpose !== "oauth_reauth" ||
      oauthReauthPayload.provider !== provider
    ) {
      return response.forbidden({
        message: "认证信息无效，请重新发起验证",
      }) as unknown as ApiResponse<null>;
    }

    if (oauthReauthPayload.uid !== uid) {
      return response.forbidden({
        message: "认证用户不匹配，请重新发起验证",
      }) as unknown as ApiResponse<null>;
    }

    const user = await prisma.user.findUnique({
      where: { uid },
      select: {
        uid: true,
        accounts: {
          where: {
            provider: provider.toUpperCase() as
              | "GOOGLE"
              | "GITHUB"
              | "MICROSOFT",
          },
        },
      },
    });

    if (!user) {
      return response.unauthorized({
        message: "用户不存在",
      }) as unknown as ApiResponse<null>;
    }

    // 验证账户绑定关系（安全关键）
    const account = user.accounts.find(
      (acc) => acc.providerAccountId === providerAccountId,
    );

    if (!account) {
      return response.forbidden({
        message: "此 SSO 账户未绑定到当前用户",
        error: {
          code: "ACCOUNT_NOT_LINKED",
          message: "此 SSO 账户未绑定到当前用户",
        },
      }) as unknown as ApiResponse<null>;
    }

    const bindings = await getReauthTokenBindings();

    // 生成 REAUTH_TOKEN
    const expiredAtUnix = Math.floor(Date.now() / 1000) + REAUTH_TOKEN_EXPIRY;
    const reauthToken = jwtTokenSign({
      inner: {
        uid: user.uid,
        type: "reauth",
        exp: expiredAtUnix,
        ...bindings,
      },
      expired: `${REAUTH_TOKEN_EXPIRY}s`,
    });

    // 设置 REAUTH_TOKEN cookie
    cookieStore.set("REAUTH_TOKEN", reauthToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: REAUTH_TOKEN_EXPIRY,
      path: "/",
      priority: "high",
    });

    try {
      await logAuditEvent({
        user: {
          uid: user.uid.toString(),
        },
        details: {
          action: "VERIFY",
          resourceType: "REAUTH_SSO",
          resourceId: `${provider}:${providerAccountId}`,
          value: {
            old: { reauthVerified: false },
            new: { reauthVerified: true, provider: provider.toUpperCase() },
          },
          description: `用户通过 ${provider.toUpperCase()} 完成二次验证 - uid: ${user.uid}`,
        },
      });
    } catch (error) {
      console.error("Failed to log audit event:", error);
    }

    return response.ok({
      message: "验证成功",
      data: null,
    }) as unknown as ApiResponse<null>;
  } catch (error) {
    console.error("Verify SSO for reauth error:", error);
    return response.serverError({
      message: "验证失败，请稍后重试",
      error: {
        code: "SERVER_ERROR",
        message: "验证失败，请稍后重试",
      },
    }) as unknown as ApiResponse<null>;
  }
}
