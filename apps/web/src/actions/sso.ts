"use server";

import type { ApiResponse } from "@repo/shared-types/api/common";
import { cookies } from "next/headers";
import { after } from "next/server";

import { logAuditEvent } from "@/lib/server/audit";
import { verifyAccessToken, verifySession } from "@/lib/server/auth-verify";
import { getConfig, getConfigs } from "@/lib/server/config-cache";
import { getClientIP, getClientUserAgent } from "@/lib/server/get-client-info";
import { jwtTokenSign, jwtTokenVerify } from "@/lib/server/jwt";
import type { OAuthProvider } from "@/lib/server/oauth";
import { hashPassword } from "@/lib/server/password";
import prisma from "@/lib/server/prisma";
import ResponseBuilder from "@/lib/server/response";

/**
 * Prisma AccountProvider 枚举类型
 */
type AccountProvider = "GOOGLE" | "GITHUB" | "MICROSOFT";

/**
 * 用户信息类型
 */
interface UserInfo {
  uid: number;
  username: string;
  nickname: string | null;
  email: string;
  avatar: string | null;
  role: string;
  exp: string;
}

/**
 * 将 OAuthProvider 转换为 Prisma AccountProvider 枚举
 */
function toAccountProvider(provider: OAuthProvider): AccountProvider {
  return provider.toUpperCase() as AccountProvider;
}

function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) {
    return "密码至少需要 8 个字符";
  }

  if (password.length > 100) {
    return "密码不能超过 100 个字符";
  }

  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasDigit = /\d/.test(password);

  if (!hasUppercase || !hasLowercase || !hasDigit) {
    return "密码需包含大写字母、小写字母和数字";
  }

  return null;
}

/**
 * 解绑 SSO 账户
 */
export async function unlinkSSO({
  provider,
}: {
  provider: OAuthProvider;
}): Promise<ApiResponse<null>> {
  const response = new ResponseBuilder("serveraction");

  try {
    // 从 cookie 获取当前用户的 access token
    const cookieStore = await cookies();
    const token = cookieStore.get("ACCESS_TOKEN")?.value || "";
    const decoded = await verifyAccessToken(token);

    if (!decoded) {
      return response.unauthorized({
        message: "请先登录",
      }) as unknown as ApiResponse<null>;
    }

    const { uid } = decoded;

    const { checkReauthToken } = await import("./reauth");
    const hasReauthToken = await checkReauthToken(uid);
    if (!hasReauthToken) {
      return response.forbidden({
        message: "需要重新验证身份",
        error: {
          code: "NEED_REAUTH",
          message: "需要重新验证身份",
        },
      }) as unknown as ApiResponse<null>;
    }

    // 查找用户
    const user = await prisma.user.findUnique({
      where: { uid },
      select: {
        uid: true,
        password: true,
        accounts: true,
      },
    });

    if (!user) {
      return response.unauthorized({
        message: "用户不存在",
      }) as unknown as ApiResponse<null>;
    }

    // 检查是否只有一个 SSO 账户且没有密码
    if (user.accounts.length === 1 && !user.password) {
      return response.badRequest({
        message: "解绑最后一个登录方式前，请先设置密码",
        error: {
          code: "PASSWORD_REQUIRED",
          message: "解绑最后一个登录方式前，请先设置密码",
        },
      }) as unknown as ApiResponse<null>;
    }

    // 查找要解绑的账户
    const account = await prisma.account.findUnique({
      where: {
        userUid_provider: {
          userUid: user.uid,
          provider: toAccountProvider(provider),
        },
      },
    });

    if (!account) {
      return response.badRequest({
        message: `未绑定 ${provider.toUpperCase()} 账户`,
        error: {
          code: "NOT_LINKED",
          message: `未绑定 ${provider.toUpperCase()} 账户`,
        },
      }) as unknown as ApiResponse<null>;
    }

    // 删除绑定
    await prisma.account.delete({
      where: { id: account.id },
    });

    // 获取客户端信息用于审计日志
    // 记录审计日志
    after(async () => {
      try {
        await logAuditEvent({
          user: {
            uid: user.uid.toString(),
          },
          details: {
            action: "DELETE",
            resourceType: "ACCOUNT",
            resourceId: account.id,
            value: {
              old: {
                provider: provider.toUpperCase(),
              },
              new: null,
            },
            description: `解绑 ${provider.toUpperCase()} 账户`,
          },
        });
      } catch (error) {
        console.error("Failed to log audit event:", error);
      }
    });

    // 发送 SSO 解绑通知邮件
    after(async () => {
      try {
        const userWithEmail = await prisma.user.findUnique({
          where: { uid: user.uid },
          select: { email: true, username: true, nickname: true },
        });

        if (!userWithEmail?.email) {
          return;
        }

        const { sendEmail } = await import("@/lib/server/email");
        const { renderEmail } = await import("@/emails/utils");
        const { SSOUnlinkedTemplate } = await import("@/emails/templates");
        const [siteName, siteUrl] = await getConfigs([
          "site.title",
          "site.url",
        ]);

        const emailComponent = SSOUnlinkedTemplate({
          username: userWithEmail.nickname || userWithEmail.username,
          provider: provider.toUpperCase(),
          unlinkedAt: new Date().toISOString(),
          siteName,
          siteUrl,
        });

        const { html, text } = await renderEmail(emailComponent);

        await sendEmail({
          to: userWithEmail.email,
          subject: `${provider.toUpperCase()} 账户解绑成功`,
          html,
          text,
        });
      } catch (error) {
        console.error("发送 SSO 解绑通知邮件失败:", error);
      }
    });

    return response.ok({
      message: `成功解绑 ${provider.toUpperCase()} 账户`,
      data: null,
    }) as unknown as ApiResponse<null>;
  } catch (error) {
    console.error("Unlink SSO error:", error);
    return response.serverError({
      message: "解绑失败，请稍后重试",
      error: {
        code: "SERVER_ERROR",
        message: "解绑失败，请稍后重试",
      },
    }) as unknown as ApiResponse<null>;
  }
}

/**
 * 设置密码（SSO 用户首次设置）
 */
export async function setPassword({
  newPassword,
}: {
  newPassword: string;
}): Promise<ApiResponse<null>> {
  const response = new ResponseBuilder("serveraction");

  try {
    // 从 cookie 获取当前用户的 access token
    const cookieStore = await cookies();
    const token = cookieStore.get("ACCESS_TOKEN")?.value || "";
    const decoded = await verifyAccessToken(token);

    if (!decoded) {
      return response.unauthorized({
        message: "请先登录",
      }) as unknown as ApiResponse<null>;
    }

    const { uid } = decoded;

    const { checkReauthToken } = await import("./reauth");
    const hasReauthToken = await checkReauthToken(uid);
    if (!hasReauthToken) {
      return response.forbidden({
        message: "需要重新验证身份",
        error: {
          code: "NEED_REAUTH",
          message: "需要重新验证身份",
        },
      }) as unknown as ApiResponse<null>;
    }

    // 查找用户
    const user = await prisma.user.findUnique({
      where: { uid },
      select: {
        uid: true,
        password: true,
      },
    });

    if (!user) {
      return response.unauthorized({
        message: "用户不存在",
      }) as unknown as ApiResponse<null>;
    }

    // 检查是否已有密码
    if (user.password) {
      return response.badRequest({
        message: "已设置密码，请使用修改密码功能",
        error: {
          code: "PASSWORD_ALREADY_SET",
          message: "已设置密码，请使用修改密码功能",
        },
      }) as unknown as ApiResponse<null>;
    }

    const passwordStrengthError = validatePasswordStrength(newPassword);
    if (passwordStrengthError) {
      return response.badRequest({
        message: passwordStrengthError,
        error: {
          code: "WEAK_PASSWORD",
          message: passwordStrengthError,
        },
      }) as unknown as ApiResponse<null>;
    }

    // 哈希新密码
    const hashedPassword = await hashPassword(newPassword);

    // 更新密码
    await prisma.user.update({
      where: { uid: user.uid },
      data: {
        password: hashedPassword,
      },
    });

    // 获取客户端信息用于审计日志
    // 记录审计日志
    after(async () => {
      try {
        await logAuditEvent({
          user: {
            uid: user.uid.toString(),
          },
          details: {
            action: "UPDATE",
            resourceType: "USER",
            resourceId: user.uid.toString(),
            value: {
              old: { hasPassword: false },
              new: { hasPassword: true },
            },
            description: "设置密码",
          },
        });
      } catch (error) {
        console.error("Failed to log audit event:", error);
      }
    });

    // 发送密码设置通知邮件
    after(async () => {
      try {
        const userWithEmail = await prisma.user.findUnique({
          where: { uid: user.uid },
          select: { email: true, username: true, nickname: true },
        });

        if (!userWithEmail?.email) {
          return;
        }

        const { sendEmail } = await import("@/lib/server/email");
        const { renderEmail } = await import("@/emails/utils");
        const { PasswordSetTemplate } = await import("@/emails/templates");
        const [siteName, siteUrl] = await getConfigs([
          "site.title",
          "site.url",
        ]);

        const emailComponent = PasswordSetTemplate({
          username: userWithEmail.nickname || userWithEmail.username,
          setAt: new Date().toISOString(),
          siteName,
          siteUrl,
        });

        const { html, text } = await renderEmail(emailComponent);

        await sendEmail({
          to: userWithEmail.email,
          subject: "账户密码设置成功",
          html,
          text,
        });
      } catch (error) {
        console.error("发送密码设置通知邮件失败:", error);
      }
    });

    return response.ok({
      message: "密码设置成功",
      data: null,
    }) as unknown as ApiResponse<null>;
  } catch (error) {
    console.error("Set password error:", error);
    return response.serverError({
      message: "密码设置失败，请稍后重试",
      error: {
        code: "SERVER_ERROR",
        message: "密码设置失败，请稍后重试",
      },
    }) as unknown as ApiResponse<null>;
  }
}

/**
 * 处理 SSO 绑定回调（专门用于绑定场景）
 */
export async function handleSSOBind({
  provider,
  code,
  state,
  codeVerifier,
}: {
  provider: string;
  code: string;
  state: string;
  codeVerifier?: string;
}): Promise<ApiResponse<null>> {
  const response = new ResponseBuilder("serveraction");

  try {
    const cookieStore = await cookies();

    // 注意：不在此处检查 REAUTH_TOKEN
    // 因为 SSO 绑定流程是：settings 页面 -> reauth 验证 -> SSO 授权 -> 回调
    // 在 SSO 授权前已经完成了 reauth 验证，回调时不需要再次验证
    // 而是通过 oauth_bind_uid_${provider} cookie 来验证用户身份

    // 辅助函数：清除 OAuth cookies
    const clearOAuthCookies = () => {
      cookieStore.delete(`oauth_bind_state_${provider}`);
      cookieStore.delete(`oauth_bind_verifier_${provider}`);
      cookieStore.delete(`oauth_bind_redirect_to`);
      cookieStore.delete(`oauth_bind_token_${provider}`);
    };

    // 验证 provider
    const validProviders: OAuthProvider[] = ["google", "github", "microsoft"];
    if (!validProviders.includes(provider as OAuthProvider)) {
      clearOAuthCookies();
      return response.badRequest({
        message: "不支持的登录方式",
        error: { code: "INVALID_PROVIDER", message: "不支持的登录方式" },
      }) as unknown as ApiResponse<null>;
    }

    const oauthProvider = provider as OAuthProvider;

    // 验证 state（CSRF 防护）- 使用 JWT
    const storedStateToken = cookieStore.get(
      `oauth_bind_state_${provider}`,
    )?.value;
    if (!storedStateToken) {
      clearOAuthCookies();
      return response.badRequest({
        message: "安全验证失败，请重试",
        error: { code: "STATE_MISSING", message: "安全验证失败" },
      }) as unknown as ApiResponse<null>;
    }

    // 验证并解析 JWT state token
    const statePayload = jwtTokenVerify<{
      state: string;
      mode: string;
      provider: string;
      timestamp: number;
    }>(storedStateToken);

    if (
      !statePayload ||
      statePayload.state !== state ||
      statePayload.mode !== "bind" ||
      statePayload.provider !== provider
    ) {
      clearOAuthCookies();
      return response.badRequest({
        message: "安全验证失败，请重试",
        error: { code: "STATE_MISMATCH", message: "安全验证失败" },
      }) as unknown as ApiResponse<null>;
    }

    // 验证用户是否已登录
    // 使用 JWT token 验证身份，防止伪造
    const bindTokenCookie = cookieStore.get(
      `oauth_bind_token_${provider}`,
    )?.value;
    if (!bindTokenCookie) {
      clearOAuthCookies();
      return response.unauthorized({
        message: "请先登录",
      }) as unknown as ApiResponse<null>;
    }

    // 验证 JWT token
    const bindTokenPayload = jwtTokenVerify<{
      uid: number;
      sessionId: string;
      purpose: string;
      provider: string;
    }>(bindTokenCookie);

    if (
      !bindTokenPayload ||
      bindTokenPayload.purpose !== "oauth_bind" ||
      bindTokenPayload.provider !== provider
    ) {
      clearOAuthCookies();
      return response.unauthorized({
        message: "登录状态无效",
      }) as unknown as ApiResponse<null>;
    }

    const uid = bindTokenPayload.uid;

    const currentUser = await verifySession(bindTokenPayload.sessionId, uid);

    if (!currentUser) {
      clearOAuthCookies();
      return response.unauthorized({
        message: "用户不存在",
      }) as unknown as ApiResponse<null>;
    }

    // 验证授权码并获取用户信息
    const { validateOAuthCallback } = await import("@/lib/server/oauth");
    const oauthUser = await validateOAuthCallback(
      oauthProvider,
      code,
      codeVerifier,
    );

    // 检查当前用户是否已绑定此提供商
    const existingAccount = await prisma.account.findUnique({
      where: {
        userUid_provider: {
          userUid: currentUser.uid,
          provider: toAccountProvider(oauthProvider),
        },
      },
    });

    if (existingAccount) {
      clearOAuthCookies();
      return response.badRequest({
        message: `已绑定 ${oauthProvider.toUpperCase()} 账户`,
        error: {
          code: "ALREADY_LINKED",
          message: `已绑定 ${oauthProvider.toUpperCase()} 账户`,
        },
      }) as unknown as ApiResponse<null>;
    }

    // 检查此 SSO 账户是否已被其他用户绑定
    const matchingAccount = await prisma.account.findUnique({
      where: {
        provider_providerAccountId: {
          provider: toAccountProvider(oauthProvider),
          providerAccountId: oauthUser.providerAccountId,
        },
      },
    });

    if (matchingAccount) {
      clearOAuthCookies();
      return response.badRequest({
        message: "此 SSO 账户已被其他用户绑定",
        error: {
          code: "ACCOUNT_BOUND",
          message: "此 SSO 账户已被其他用户绑定",
        },
      }) as unknown as ApiResponse<null>;
    }

    // 创建绑定
    await prisma.account.create({
      data: {
        userUid: currentUser.uid,
        type: "oauth",
        provider: toAccountProvider(oauthProvider),
        providerAccountId: oauthUser.providerAccountId,
      },
    });

    // 获取客户端信息用于审计日志
    // 记录审计日志
    after(async () => {
      try {
        await logAuditEvent({
          user: {
            uid: currentUser.uid.toString(),
          },
          details: {
            action: "CREATE",
            resourceType: "ACCOUNT",
            resourceId: `${oauthProvider}:${oauthUser.providerAccountId}`,
            value: {
              old: null,
              new: {
                provider: oauthProvider.toUpperCase(),
                email: oauthUser.email,
              },
            },
            description: `绑定 ${oauthProvider.toUpperCase()} 账户`,
          },
        });
      } catch (error) {
        console.error("Failed to log audit event:", error);
      }
    });

    // 发送 SSO 绑定通知邮件
    after(async () => {
      try {
        const userWithEmail = await prisma.user.findUnique({
          where: { uid: currentUser.uid },
          select: { email: true, username: true, nickname: true },
        });

        if (!userWithEmail?.email) {
          return;
        }

        const { sendEmail } = await import("@/lib/server/email");
        const { renderEmail } = await import("@/emails/utils");
        const { SSOLinkedTemplate } = await import("@/emails/templates");
        const [siteName, siteUrl] = await getConfigs([
          "site.title",
          "site.url",
        ]);

        const emailComponent = SSOLinkedTemplate({
          username: userWithEmail.nickname || userWithEmail.username,
          provider: oauthProvider.toUpperCase(),
          linkedAt: new Date().toISOString(),
          siteName,
          siteUrl,
        });

        const { html, text } = await renderEmail(emailComponent);

        await sendEmail({
          to: userWithEmail.email,
          subject: `${oauthProvider.toUpperCase()} 账户绑定成功`,
          html,
          text,
        });
      } catch (error) {
        console.error("发送 SSO 绑定通知邮件失败:", error);
      }
    });

    clearOAuthCookies();

    return response.ok({
      message: `成功绑定 ${oauthProvider.toUpperCase()} 账户`,
      data: null,
    }) as unknown as ApiResponse<null>;
  } catch (error) {
    console.error("Handle SSO bind error:", error);
    return response.serverError({
      message: "绑定失败，请稍后重试",
      error: {
        code: "SERVER_ERROR",
        message: "绑定失败，请稍后重试",
      },
    }) as unknown as ApiResponse<null>;
  }
}

/**
 * 处理 SSO 回调（用于 callback 页面）
 */
export async function handleSSOCallback({
  provider,
  code,
  state,
  codeVerifier,
}: {
  provider: string;
  code: string;
  state: string;
  codeVerifier?: string;
}): Promise<
  ApiResponse<{
    userInfo?: UserInfo;
    action: "login" | "verify" | "bind";
    verifyToken?: string;
    verifyEmail?: string;
  }>
> {
  const response = new ResponseBuilder("serveraction");

  try {
    const cookieStore = await cookies();

    // 辅助函数：设置认证 cookies
    const setAuthCookies = (refreshToken: string, accessToken: string) => {
      const expiredAtSeconds = 30 * 24 * 60 * 60;
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
    };

    // 辅助函数：清除 OAuth cookies
    const clearOAuthCookies = () => {
      cookieStore.delete(`oauth_state_${provider}`);
      cookieStore.delete(`oauth_verifier_${provider}`);
      cookieStore.delete(`oauth_redirect_to`);
    };

    // 验证 provider
    const validProviders: OAuthProvider[] = ["google", "github", "microsoft"];
    if (!validProviders.includes(provider as OAuthProvider)) {
      clearOAuthCookies();
      return response.badRequest({
        message: "不支持的登录方式",
        error: { code: "INVALID_PROVIDER", message: "不支持的登录方式" },
      }) as unknown as ApiResponse<{
        userInfo?: UserInfo;
        action: "login" | "verify" | "bind";
      }>;
    }

    const oauthProvider = provider as OAuthProvider;

    // 验证 state（CSRF 防护）- 使用 JWT
    const storedStateToken = cookieStore.get(`oauth_state_${provider}`)?.value;
    if (!storedStateToken) {
      clearOAuthCookies();
      return response.badRequest({
        message: "安全验证失败，请重试",
        error: { code: "STATE_MISSING", message: "安全验证失败" },
      }) as unknown as ApiResponse<{
        userInfo?: UserInfo;
        action: "login" | "verify" | "bind";
      }>;
    }

    // 验证并解析 JWT state token
    const statePayload = jwtTokenVerify<{
      state: string;
      mode: string;
      provider: string;
      timestamp: number;
    }>(storedStateToken);

    if (
      !statePayload ||
      statePayload.state !== state ||
      statePayload.mode !== "login" ||
      statePayload.provider !== provider
    ) {
      clearOAuthCookies();
      return response.badRequest({
        message: "安全验证失败，请重试",
        error: { code: "STATE_MISMATCH", message: "安全验证失败" },
      }) as unknown as ApiResponse<{
        userInfo?: UserInfo;
        action: "login" | "verify" | "bind";
      }>;
    }

    // 验证授权码并获取用户信息
    const { validateOAuthCallback } = await import("@/lib/server/oauth");
    const oauthUser = await validateOAuthCallback(
      oauthProvider,
      code,
      codeVerifier,
    );

    // 检查是否已登录（用于审计日志）
    const accessToken = cookieStore.get("ACCESS_TOKEN")?.value;
    const _currentUser = accessToken
      ? await verifyAccessToken(accessToken)
      : null;

    const clientIP = await getClientIP();
    const clientUserAgent = await getClientUserAgent();

    const expiredAtSeconds = 30 * 24 * 60 * 60; // 30天
    const expiredAt = new Date(Date.now() + expiredAtSeconds * 1000);
    const expiredAtUnix = Math.floor(expiredAt.getTime() / 1000);

    // 未登录场景：查找已绑定的账户
    const account = await prisma.account.findUnique({
      where: {
        provider_providerAccountId: {
          provider: toAccountProvider(oauthProvider),
          providerAccountId: oauthUser.providerAccountId,
        },
      },
      include: {
        user: {
          select: {
            uid: true,
            username: true,
            nickname: true,
            email: true,
            avatar: true,
            role: true,
            status: true,
            deletedAt: true,
          },
        },
      },
    });

    if (account) {
      const user = account.user;

      if (user.deletedAt || user.status !== "ACTIVE") {
        clearOAuthCookies();
        return response.badRequest({
          message: "该账户已被禁用",
          error: {
            code: "ACCOUNT_DISABLED",
            message: "该账户已被禁用",
          },
        }) as unknown as ApiResponse<{
          userInfo?: UserInfo;
          action: "login" | "verify" | "bind";
        }>;
      }

      const dbRefreshToken = await prisma.refreshToken.create({
        data: {
          userUid: user.uid,
          expiresAt: expiredAt,
          ipAddress: clientIP,
          userAgent: clientUserAgent,
          lastUsedAt: new Date(),
        },
      });

      const activeSessionUser = await verifySession(
        dbRefreshToken.id,
        user.uid,
      );
      if (!activeSessionUser) {
        await prisma.refreshToken.delete({ where: { id: dbRefreshToken.id } });
        clearOAuthCookies();
        return response.unauthorized({
          message: "该账户已被禁用，请重新登录",
        }) as unknown as ApiResponse<{
          userInfo?: UserInfo;
          action: "login" | "verify" | "bind";
        }>;
      }

      const refreshToken = jwtTokenSign({
        inner: {
          uid: user.uid,
          tokenId: dbRefreshToken.id,
          exp: expiredAtUnix,
        },
        expired: "30d",
      });

      const newAccessToken = jwtTokenSign({
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

      after(async () => {
        await prisma.user.update({
          where: { uid: user.uid },
          data: { lastUseAt: new Date() },
        });
      });

      // 设置认证 cookies
      setAuthCookies(refreshToken, newAccessToken);
      // 清除 OAuth cookies
      clearOAuthCookies();

      return response.ok({
        message: "登录成功",
        data: {
          action: "login" as const,
          userInfo: {
            uid: user.uid,
            username: user.username,
            nickname: user.nickname,
            email: user.email,
            avatar: user.avatar,
            role: activeSessionUser.role,
            exp: expiredAt.toISOString(),
          },
        },
      }) as unknown as ApiResponse<{
        userInfo?: UserInfo;
        action: "login" | "verify" | "bind";
      }>;
    }

    // 检查邮箱是否已存在
    const existingUser = await prisma.user.findUnique({
      where: { email: oauthUser.email },
    });

    if (existingUser) {
      // 邮箱已被使用，提示用户登录后绑定账户
      clearOAuthCookies();

      return response.badRequest({
        message: "该邮箱已被注册，请登录后在设置中绑定 SSO 账户",
        error: {
          code: "EMAIL_EXISTS",
          message: "该邮箱已被注册，请登录后在设置中绑定 SSO 账户",
        },
      }) as unknown as ApiResponse<{
        userInfo?: UserInfo;
        action: "login" | "verify" | "bind";
        verifyToken?: string;
        verifyEmail?: string;
      }>;
    }

    const canRegister = await getConfig("user.registration.enabled");
    if (!canRegister) {
      clearOAuthCookies();
      return response.forbidden({
        message: "当前站点未开放注册",
        error: {
          code: "REGISTRATION_DISABLED",
          message: "当前站点未开放注册",
        },
      }) as unknown as ApiResponse<{
        userInfo?: UserInfo;
        action: "login" | "verify" | "bind";
        verifyToken?: string;
        verifyEmail?: string;
      }>;
    }

    // 新用户：创建账户
    let username = oauthUser.email.split("@")[0]!;
    let usernameExists = await prisma.user.findUnique({ where: { username } });
    let counter = 1;
    while (usernameExists) {
      username = `${oauthUser.email.split("@")[0]}_${counter}`;
      usernameExists = await prisma.user.findUnique({ where: { username } });
      counter++;
    }

    const newUser = await prisma.user.create({
      data: {
        email: oauthUser.email,
        username,
        nickname: oauthUser.name || username,
        avatar: oauthUser.avatar || null,
        emailVerified: true,
        password: null,
        accounts: {
          create: {
            type: "oauth",
            provider: toAccountProvider(oauthProvider),
            providerAccountId: oauthUser.providerAccountId,
          },
        },
      },
    });

    if (newUser.uid === 1) {
      await prisma.user.update({
        where: { uid: newUser.uid },
        data: { role: "ADMIN" },
      });
    }

    after(async () => {
      try {
        await logAuditEvent({
          user: {
            uid: newUser.uid.toString(),
          },
          details: {
            action: "CREATE",
            resourceType: "USER",
            resourceId: newUser.uid.toString(),
            value: {
              old: null,
              new: {
                username: newUser.username,
                email: newUser.email,
                provider: oauthProvider.toUpperCase(),
              },
            },
            description: `通过 ${oauthProvider.toUpperCase()} SSO 注册`,
          },
        });
      } catch (error) {
        console.error("Failed to log audit event:", error);
      }
    });

    const dbRefreshToken = await prisma.refreshToken.create({
      data: {
        userUid: newUser.uid,
        expiresAt: expiredAt,
        ipAddress: clientIP,
        userAgent: clientUserAgent,
        lastUsedAt: new Date(),
      },
    });

    const activeSessionUser = await verifySession(
      dbRefreshToken.id,
      newUser.uid,
    );
    if (!activeSessionUser) {
      await prisma.refreshToken.delete({ where: { id: dbRefreshToken.id } });
      clearOAuthCookies();
      return response.unauthorized({
        message: "登录状态已失效，请重新登录",
      }) as unknown as ApiResponse<{
        userInfo?: UserInfo;
        action: "login" | "verify" | "bind";
      }>;
    }

    const refreshToken = jwtTokenSign({
      inner: {
        uid: newUser.uid,
        tokenId: dbRefreshToken.id,
        exp: expiredAtUnix,
      },
      expired: "30d",
    });

    const newAccessToken = jwtTokenSign({
      inner: {
        type: "access",
        uid: newUser.uid,
        sessionId: dbRefreshToken.id,
        username: activeSessionUser.username,
        nickname: activeSessionUser.nickname ?? activeSessionUser.username,
        role: activeSessionUser.role,
      },
      expired: "10m",
    });

    // 设置认证 cookies
    setAuthCookies(refreshToken, newAccessToken);
    // 清除 OAuth cookies
    clearOAuthCookies();

    return response.ok({
      message: "注册并登录成功",
      data: {
        action: "login" as const,
        userInfo: {
          uid: newUser.uid,
          username: newUser.username,
          nickname: newUser.nickname,
          email: newUser.email,
          avatar: newUser.avatar,
          role: activeSessionUser.role,
          exp: expiredAt.toISOString(),
        },
      },
    }) as unknown as ApiResponse<{
      userInfo?: UserInfo;
      action: "login" | "verify" | "bind";
    }>;
  } catch (error) {
    console.error("Handle SSO callback error:", error);
    return response.serverError({
      message: "登录失败，请稍后重试",
      error: {
        code: "SERVER_ERROR",
        message: "登录失败，请稍后重试",
      },
    }) as unknown as ApiResponse<{
      userInfo?: UserInfo;
      action: "login" | "verify" | "bind";
    }>;
  }
}
