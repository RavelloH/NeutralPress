"use server";

import {
  type ConfirmTotp,
  ConfirmTotpSchema,
  type LoginSuccessResponse,
  type TotpBackupCodesResponse,
  type TotpSetupResponse,
  type TotpStatusResponse,
  type VerifyTotp,
  VerifyTotpSchema,
} from "@repo/shared-types/api/auth";
import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import { cookies, headers } from "next/headers";
import { after, type NextResponse } from "next/server";

import { logAuditEvent } from "@/lib/server/audit";
import { verifyAccessToken, verifySession } from "@/lib/server/auth-verify";
import { generateCacheKey } from "@/lib/server/cache";
import { getConfig } from "@/lib/server/config-cache";
import { getClientIP, getClientUserAgent } from "@/lib/server/get-client-info";
import {
  jwtTokenSign,
  jwtTokenVerify,
  type TotpTokenPayload,
} from "@/lib/server/jwt";
import prisma from "@/lib/server/prisma";
import limitControl from "@/lib/server/rate-limit";
import redis, { ensureRedisConnection } from "@/lib/server/redis";
import ResponseBuilder from "@/lib/server/response";
import * as totpStatusService from "@/lib/server/services/totp-status-domain";
import {
  decryptBackupCode,
  decryptTotpSecret,
  encryptBackupCode,
  encryptTotpSecret,
  generateBackupCodes,
  generateTotpSecret,
  generateTotpUri,
  isValidBackupCodeFormat,
  reserveTotpAttempt,
  resetTotpFailCount,
  verifyTotpCode,
} from "@/lib/server/totp";
import { validateData } from "@/lib/server/validator";

import type { Prisma } from ".prisma/client";

type AuthActionEnvironment = "serverless" | "serveraction";
type AuthActionConfig = { environment?: AuthActionEnvironment };
type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 获取备份码剩余数量
 */
// ============================================================================
// verifyTotp - 验证 TOTP 并完成登录
// ============================================================================

export async function verifyTotp(
  params: VerifyTotp,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<LoginSuccessResponse>>>;
export async function verifyTotp(
  params: VerifyTotp,
  serverConfig?: AuthActionConfig,
): Promise<ApiResponse<LoginSuccessResponse>>;
export async function verifyTotp(
  { totp_code, backup_code, token_transport }: VerifyTotp,
  serverConfig?: AuthActionConfig,
): Promise<ActionResult<LoginSuccessResponse | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  // 速率控制
  if (!(await limitControl(await headers(), "verifyTotp"))) {
    return response.tooManyRequests();
  }

  // 验证输入参数
  const validationError = validateData(
    { totp_code, backup_code, token_transport },
    VerifyTotpSchema,
  );
  if (validationError) return response.badRequest(validationError);

  // 必须提供 totp_code 或 backup_code 其中之一
  if (!totp_code && !backup_code) {
    return response.badRequest({
      message: "请提供验证码或备份码",
    });
  }

  try {
    // 从 cookie 或请求体中获取 TOTP Token
    const cookieStore = await cookies();
    const totpToken = cookieStore.get("TOTP_TOKEN")?.value;

    if (!totpToken) {
      return response.unauthorized({
        message: "验证超时，请重新登录",
      });
    }

    // 验证 TOTP Token
    const decoded = jwtTokenVerify<TotpTokenPayload>(totpToken);
    if (
      !decoded ||
      decoded.type !== "totp_verification" ||
      decoded.purpose !== "login"
    ) {
      return response.unauthorized({
        message: "无效的验证令牌",
      });
    }

    const { uid } = decoded;

    // 检查是否超过失败次数限制
    if (!(await reserveTotpAttempt(uid))) {
      // 清除 TOTP Token
      cookieStore.delete("TOTP_TOKEN");
      return response.unauthorized({
        message: "验证失败次数过多，请稍后重试",
        error: {
          code: "TOTP_VERIFICATION_FAILED",
          message: "验证失败次数过多，请稍后重试",
        },
      });
    }

    // 查询用户
    const user = await prisma.user.findUnique({
      where: { uid },
      select: {
        uid: true,
        username: true,
        nickname: true,
        role: true,
        avatar: true,
        email: true,
        totpSecret: true,
        totpBackupCodes: true,
        status: true,
        deletedAt: true,
      },
    });

    if (!user || user.status !== "ACTIVE" || user.deletedAt) {
      return response.unauthorized({ message: "该账户已被禁用" });
    }

    if (!user.totpSecret) {
      return response.badRequest({
        message: "TOTP 未启用",
        error: {
          code: "TOTP_NOT_ENABLED",
          message: "TOTP 未启用",
        },
      });
    }

    // 解密 TOTP secret
    const secret = decryptTotpSecret(user.totpSecret);
    if (!secret) {
      return response.serverError({
        message: "TOTP 配置错误，请联系管理员",
      });
    }

    let verified = false;

    // 验证 TOTP 码
    if (totp_code) {
      verified = verifyTotpCode(secret, totp_code);
    }
    // 验证备份码
    else if (backup_code && user.totpBackupCodes) {
      if (!isValidBackupCodeFormat(backup_code)) {
        return response.badRequest({
          message: "备份码格式错误",
        });
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
      return response.badRequest({
        message: "验证码错误，请重试",
      });
    }

    // 验证成功，重置失败次数
    await resetTotpFailCount(uid);

    // 清除 TOTP Token
    cookieStore.delete("TOTP_TOKEN");

    // 继续完成登录流程（与 auth.ts 中的 login 逻辑相同）
    const expiredAtSeconds = 30 * 24 * 60 * 60; // 30天
    const expiredAt = new Date(Date.now() + expiredAtSeconds * 1000);
    const expiredAtUnix = Math.floor(expiredAt.getTime() / 1000);

    const clientIP = await getClientIP();
    const clientUserAgent = await getClientUserAgent();

    // 向数据库记录 refresh token
    const dbRefreshToken = await prisma.refreshToken.create({
      data: {
        userUid: user.uid,
        expiresAt: expiredAt,
        ipAddress: clientIP,
        userAgent: clientUserAgent,
        lastUsedAt: new Date(),
      },
    });

    const activeSessionUser = await verifySession(dbRefreshToken.id, user.uid);
    if (!activeSessionUser) {
      await prisma.refreshToken.delete({ where: { id: dbRefreshToken.id } });
      return response.unauthorized({ message: "该账户已被禁用" });
    }

    // 分发令牌
    const refreshToken = jwtTokenSign({
      inner: {
        uid: user.uid,
        tokenId: dbRefreshToken.id,
        exp: expiredAtUnix,
      },
      expired: "30d",
    });

    const accessToken = jwtTokenSign({
      inner: {
        type: "access",
        uid: user.uid,
        sessionId: dbRefreshToken.id,
        username: activeSessionUser.username,
        nickname: activeSessionUser.nickname ?? activeSessionUser.username,
        role: activeSessionUser.role,
      },
      expired: "10m",
    });

    // 设置 HttpOnly Cookie
    if (token_transport === "cookie") {
      cookieStore.set({
        name: "REFRESH_TOKEN",
        value: refreshToken,
        httpOnly: true,
        maxAge: expiredAtSeconds,
        sameSite: "strict",
        path: "/",
        secure: process.env.NODE_ENV === "production",
        priority: "high",
      });
      cookieStore.set({
        name: "ACCESS_TOKEN",
        value: accessToken,
        httpOnly: true,
        maxAge: 600,
        sameSite: "strict",
        path: "/",
        secure: process.env.NODE_ENV === "production",
        priority: "high",
      });
    }

    after(async () => {
      // 更新最后登录时间
      await prisma.user.update({
        where: { uid: user.uid },
        data: {
          lastUseAt: new Date(),
        },
      });
    });

    try {
      await logAuditEvent({
        user: {
          uid: user.uid.toString(),
        },
        details: {
          action: "LOGIN",
          resourceType: "AUTH",
          resourceId: user.uid.toString(),
          value: {
            old: { authenticated: false, requiresTotp: true },
            new: {
              authenticated: true,
              method: backup_code ? "backup_code" : "totp_code",
              tokenTransport: token_transport,
            },
          },
          description: `用户通过 TOTP 完成登录 - uid: ${user.uid}`,
          metadata: {
            useBackupCode: Boolean(backup_code),
          },
        },
      });
    } catch (error) {
      console.error("Failed to log audit event:", error);
    }

    // 返回成功结果
    return response.ok({
      message: "登录成功",
      data: {
        userInfo: {
          uid: user.uid,
          username: user.username,
          nickname: user.nickname ?? "",
          role: user.role,
          exp: expiredAt.toISOString(),
          avatar: user.avatar ?? null,
          email: user.email ?? null,
        },
        ...(token_transport === "body" && { access_token: accessToken }),
        ...(token_transport === "body" && { refresh_token: refreshToken }),
      },
    }) as unknown as ActionResult<LoginSuccessResponse | null>;
  } catch (error) {
    console.error("Verify TOTP error:", error);
    return response.serverError({
      message: "验证失败，请稍后重试",
    });
  }
}

// ============================================================================
// enableTotp - 启用 TOTP（生成 secret）
// ============================================================================

export async function enableTotp(serverConfig: {
  environment: "serverless";
}): Promise<NextResponse<ApiResponse<TotpSetupResponse["data"]>>>;
export async function enableTotp(
  serverConfig?: AuthActionConfig,
): Promise<ApiResponse<TotpSetupResponse["data"]>>;
export async function enableTotp(
  serverConfig?: AuthActionConfig,
): Promise<ActionResult<TotpSetupResponse["data"] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  // 速率控制
  if (!(await limitControl(await headers(), "enableTotp"))) {
    return response.tooManyRequests();
  }

  // 检查是否有有效的 REAUTH_TOKEN
  const { checkReauthToken } = await import("./reauth");
  const hasReauthToken = await checkReauthToken();
  if (!hasReauthToken) {
    return response.forbidden({
      message: "需要重新验证身份",
      error: {
        code: "NEED_REAUTH",
        message: "需要重新验证身份",
      },
    });
  }

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

    // 检查是否已启用 TOTP
    const user = await prisma.user.findUnique({
      where: { uid },
      select: {
        uid: true,
        username: true,
        totpSecret: true,
      },
    });

    if (!user) {
      return response.unauthorized({
        message: "用户不存在",
      });
    }

    if (user.totpSecret) {
      return response.badRequest({
        message: "TOTP 已启用",
        error: {
          code: "TOTP_ALREADY_ENABLED",
          message: "TOTP 已启用",
        },
      });
    }

    // 生成 TOTP secret
    const secret = generateTotpSecret();

    // 获取站点名称
    const siteName = await getConfig("site.title");
    // 生成 TOTP URI（用于 QR 码）
    const qrCodeUri = generateTotpUri(secret, user.username, siteName);

    // 临时存储到 Redis（5分钟过期）
    await ensureRedisConnection();
    await redis.setex(
      generateCacheKey("auth", "totp", "setup", uid),
      300,
      JSON.stringify({
        secret,
        createdAt: Date.now(),
      }),
    );

    return response.ok({
      message: "TOTP Secret 生成成功",
      data: {
        secret,
        qrCodeUri,
      },
    });
  } catch (error) {
    console.error("Enable TOTP error:", error);
    return response.serverError({
      message: "启用失败，请稍后重试",
    });
  }
}

// ============================================================================
// confirmTotp - 确认启用 TOTP
// ============================================================================

export async function confirmTotp(
  params: ConfirmTotp,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<TotpBackupCodesResponse["data"]>>>;
export async function confirmTotp(
  params: ConfirmTotp,
  serverConfig?: AuthActionConfig,
): Promise<ApiResponse<TotpBackupCodesResponse["data"]>>;
export async function confirmTotp(
  { totp_code }: ConfirmTotp,
  serverConfig?: AuthActionConfig,
): Promise<ActionResult<TotpBackupCodesResponse["data"] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  // 速率控制
  if (!(await limitControl(await headers(), "confirmTotp"))) {
    return response.tooManyRequests();
  }

  // 验证输入参数
  const validationError = validateData({ totp_code }, ConfirmTotpSchema);
  if (validationError) return response.badRequest(validationError);

  // 检查是否有有效的 REAUTH_TOKEN
  const { checkReauthToken } = await import("./reauth");
  const hasReauthToken = await checkReauthToken();
  if (!hasReauthToken) {
    return response.forbidden({
      message: "需要重新验证身份",
      error: {
        code: "NEED_REAUTH",
        message: "需要重新验证身份",
      },
    });
  }

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

    // 从 Redis 获取临时存储的 secret
    await ensureRedisConnection();
    const setupData = await redis.get(
      generateCacheKey("auth", "totp", "setup", uid),
    );
    if (!setupData) {
      return response.badRequest({
        message: "TOTP 设置已过期，请重新开始",
      });
    }

    const { secret } = JSON.parse(setupData) as {
      secret: string;
      createdAt: number;
    };

    // 验证 TOTP 码
    const verified = verifyTotpCode(secret, totp_code);
    if (!verified) {
      return response.badRequest({
        message: "验证码错误，请重试",
      });
    }

    // 加密 secret
    const encryptedSecret = encryptTotpSecret(secret);

    // 生成备份码
    const backupCodes = generateBackupCodes(8);
    const encryptedBackupCodes = backupCodes.map((code) => ({
      code: encryptBackupCode(code),
      used: false,
      usedAt: null,
    }));

    const backupCodesData = {
      codes: encryptedBackupCodes,
      generatedAt: new Date().toISOString(),
    };

    // 保存到数据库
    await prisma.user.update({
      where: { uid },
      data: {
        totpSecret: encryptedSecret,
        totpBackupCodes: backupCodesData,
      },
    });

    // 清除 Redis 中的临时数据
    after(async () => {
      await redis.del(generateCacheKey("auth", "totp", "setup", uid));
    });

    // 获取客户端信息用于审计日志
    // 记录审计日志
    after(async () => {
      try {
        await logAuditEvent({
          user: {
            uid: uid.toString(),
          },
          details: {
            action: "CREATE",
            resourceType: "TOTP",
            resourceId: uid.toString(),
            value: {
              old: null,
              new: { totpEnabled: true },
            },
            description: `用户启用 TOTP 两步验证 - uid: ${uid}`,
          },
        });
      } catch (error) {
        console.error("Failed to log audit event:", error);
      }
    });

    return response.ok({
      message: "TOTP 启用成功",
      data: {
        backupCodes, // 返回明文备份码，仅此一次
      },
    });
  } catch (error) {
    console.error("Confirm TOTP error:", error);
    return response.serverError({
      message: "确认失败，请稍后重试",
    });
  }
}

// ============================================================================
// disableTotp - 禁用 TOTP
// ============================================================================

export async function disableTotp(serverConfig: {
  environment: "serverless";
}): Promise<NextResponse<ApiResponse<null>>>;
export async function disableTotp(
  serverConfig?: AuthActionConfig,
): Promise<ApiResponse<null>>;
export async function disableTotp(
  serverConfig?: AuthActionConfig,
): Promise<ActionResult<null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  // 速率控制
  if (!(await limitControl(await headers(), "disableTotp"))) {
    return response.tooManyRequests();
  }

  // 检查是否有有效的 REAUTH_TOKEN（已包含 TOTP 验证）
  const { checkReauthToken } = await import("./reauth");
  const hasReauthToken = await checkReauthToken();
  if (!hasReauthToken) {
    return response.forbidden({
      message: "需要重新验证身份",
      error: {
        code: "NEED_REAUTH",
        message: "需要重新验证身份",
      },
    });
  }

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

    // 检查是否已启用 TOTP
    const user = await prisma.user.findUnique({
      where: { uid },
      select: {
        uid: true,
        totpSecret: true,
      },
    });

    if (!user) {
      return response.unauthorized({
        message: "用户不存在",
      });
    }

    if (!user.totpSecret) {
      return response.badRequest({
        message: "TOTP 未启用",
        error: {
          code: "TOTP_NOT_ENABLED",
          message: "TOTP 未启用",
        },
      });
    }

    // 禁用 TOTP
    await prisma.user.update({
      where: { uid },
      data: {
        totpSecret: null,
        totpBackupCodes: null as unknown as Prisma.InputJsonValue,
      },
    });

    // 获取客户端信息用于审计日志
    // 记录审计日志
    after(async () => {
      try {
        await logAuditEvent({
          user: {
            uid: uid.toString(),
          },
          details: {
            action: "DELETE",
            resourceType: "TOTP",
            resourceId: uid.toString(),
            value: {
              old: { totpEnabled: true },
              new: { totpEnabled: false },
            },
            description: `用户禁用 TOTP 两步验证 - uid: ${uid}`,
          },
        });
      } catch (error) {
        console.error("Failed to log audit event:", error);
      }
    });

    return response.ok({
      message: "TOTP 已禁用",
      data: null,
    });
  } catch (error) {
    console.error("Disable TOTP error:", error);
    return response.serverError({
      message: "禁用失败，请稍后重试",
    });
  }
}

// ============================================================================
// regenerateBackupCodes - 重新生成备份码
// ============================================================================

export async function regenerateBackupCodes(serverConfig: {
  environment: "serverless";
}): Promise<NextResponse<ApiResponse<TotpBackupCodesResponse["data"]>>>;
export async function regenerateBackupCodes(
  serverConfig?: AuthActionConfig,
): Promise<ApiResponse<TotpBackupCodesResponse["data"]>>;
export async function regenerateBackupCodes(
  serverConfig?: AuthActionConfig,
): Promise<ActionResult<TotpBackupCodesResponse["data"] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  // 速率控制
  if (!(await limitControl(await headers(), "regenerateBackupCodes"))) {
    return response.tooManyRequests();
  }

  // 检查是否有有效的 REAUTH_TOKEN
  const { checkReauthToken } = await import("./reauth");
  const hasReauthToken = await checkReauthToken();
  if (!hasReauthToken) {
    return response.forbidden({
      message: "需要重新验证身份",
      error: {
        code: "NEED_REAUTH",
        message: "需要重新验证身份",
      },
    });
  }

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

    // 检查是否已启用 TOTP
    const user = await prisma.user.findUnique({
      where: { uid },
      select: {
        uid: true,
        totpSecret: true,
      },
    });

    if (!user) {
      return response.unauthorized({
        message: "用户不存在",
      });
    }

    if (!user.totpSecret) {
      return response.badRequest({
        message: "TOTP 未启用",
        error: {
          code: "TOTP_NOT_ENABLED",
          message: "TOTP 未启用",
        },
      });
    }

    // 生成新的备份码
    const backupCodes = generateBackupCodes(8);
    const encryptedBackupCodes = backupCodes.map((code) => ({
      code: encryptBackupCode(code),
      used: false,
      usedAt: null,
    }));

    const backupCodesData = {
      codes: encryptedBackupCodes,
      generatedAt: new Date().toISOString(),
    };

    // 保存到数据库
    await prisma.user.update({
      where: { uid },
      data: {
        totpBackupCodes: backupCodesData,
      },
    });

    // 获取客户端信息用于审计日志
    // 记录审计日志
    after(async () => {
      try {
        await logAuditEvent({
          user: {
            uid: uid.toString(),
          },
          details: {
            action: "UPDATE",
            resourceType: "TOTP",
            resourceId: uid.toString(),
            value: {
              old: {},
              new: { backupCodesRegenerated: true },
            },
            description: `用户重新生成 TOTP 备份码 - uid: ${uid}`,
          },
        });
      } catch (error) {
        console.error("Failed to log audit event:", error);
      }
    });

    return response.ok({
      message: "备份码重新生成成功",
      data: {
        backupCodes, // 返回明文备份码，仅此一次
      },
    });
  } catch (error) {
    console.error("Regenerate backup codes error:", error);
    return response.serverError({
      message: "重新生成失败，请稍后重试",
    });
  }
}

// ============================================================================
// getTotpStatus - 获取 TOTP 状态
// ============================================================================

export async function getTotpStatus(serverConfig: {
  environment: "serverless";
}): Promise<NextResponse<ApiResponse<TotpStatusResponse["data"]>>>;

export async function getTotpStatus(
  serverConfig?: AuthActionConfig,
): Promise<ApiResponse<TotpStatusResponse["data"]>>;

export async function getTotpStatus(
  serverConfig?: AuthActionConfig,
): Promise<ActionResult<TotpStatusResponse["data"] | null>> {
  return totpStatusService.getTotpStatus(serverConfig);
}
