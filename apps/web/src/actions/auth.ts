"use server";

import type {
  ChangePassword,
  ChangePasswordSuccessResponse,
  EmailVerification,
  EmailVerifySuccessResponse,
  GetSessionsSuccessResponse,
  Login,
  LoginSuccessResponse,
  Logout,
  PasswordResetRequestSuccessResponse,
  RefreshToken,
  Register,
  RegisterSuccessResponse,
  RequestPasswordReset,
  ResendEmailVerification,
  ResendEmailVerificationSuccessResponse,
  ResetPassword,
  ResetPasswordSuccessResponse,
  RevokeSession,
  RevokeSessionSuccessResponse,
} from "@repo/shared-types/api/auth";
import {
  ChangePasswordSchema,
  EmailVerificationSchema,
  LoginSchema,
  LogoutSchema,
  RefreshTokenSchema,
  RegisterUserSchema,
  RequestPasswordResetSchema,
  ResendEmailVerificationSchema,
  ResetPasswordSchema,
  RevokeSessionSchema,
} from "@repo/shared-types/api/auth";
import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import { cookies, headers } from "next/headers";
import type { NextResponse } from "next/server";
import { after } from "next/server";

import { logAuditEvent } from "@/lib/server/audit";
import { verifyAccessToken, verifySession } from "@/lib/server/auth-verify";
import { verifyToken } from "@/lib/server/captcha";
import { getConfig, getConfigs } from "@/lib/server/config-cache";
import emailUtils from "@/lib/server/email";
import { getClientIP, getClientUserAgent } from "@/lib/server/get-client-info";
import {
  jwtTokenSign,
  jwtTokenVerify,
  type RefreshTokenPayload,
} from "@/lib/server/jwt";
import { hashPassword, verifyPassword } from "@/lib/server/password";
import prisma from "@/lib/server/prisma";
import limitControl from "@/lib/server/rate-limit";
import ResponseBuilder from "@/lib/server/response";
import * as sessionService from "@/lib/server/services/session-domain";
import { validateData } from "@/lib/server/validator";

type AuthActionEnvironment = "serverless" | "serveraction";
type AuthActionConfig = { environment?: AuthActionEnvironment };
type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

export async function login(
  params: Login,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<LoginSuccessResponse>>>;
export async function login(
  params: Login,
  serverConfig?: AuthActionConfig,
): Promise<ApiResponse<LoginSuccessResponse>>;
export async function login(
  { username, password, token_transport, captcha_token }: Login,
  serverConfig?: AuthActionConfig,
): Promise<ActionResult<LoginSuccessResponse | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  // 速率控制
  if (!(await limitControl(await headers(), "login"))) {
    return response.tooManyRequests();
  }

  // 验证输入参数
  const validationError = validateData(
    {
      username,
      password,
      token_transport,
      captcha_token,
    },
    LoginSchema,
  );

  if (validationError) return response.badRequest(validationError);

  if (!(await verifyToken(captcha_token)).success)
    return response.unauthorized({
      message: "安全验证失败，请刷新页面重试",
    });

  try {
    // 检查用户名或邮箱是否已存在
    const user = await prisma.user.findFirst({
      where: {
        username,
      },
      select: {
        password: true,
        accounts: true,
        username: true,
        nickname: true,
        uid: true,
        role: true,
        avatar: true,
        email: true,
        emailVerified: true,
        deletedAt: true,
        status: true,
        totpSecret: true,
      },
    });

    if (!user) {
      return response.badRequest({
        message: "用户名或密码错误",
        error: {
          code: "INVALID_CREDENTIALS",
          message: "用户名或密码错误",
        },
      });
    }

    // 检查用户状态
    if (user.deletedAt || user.status === "SUSPENDED") {
      return response.forbidden({
        message: "该账户已被禁用，如有疑问请联系管理员",
        error: {
          code: "ACCOUNT_DISABLED",
          message: "该账户已被禁用，如有疑问请联系管理员",
        },
      });
    }

    // 检查是否是需要更新的账户
    if (user.status === "NEEDS_UPDATE") {
      // 自动发送密码重置邮件
      after(async () => {
        try {
          // 删除该用户的所有旧重置记录
          await prisma.passwordReset.deleteMany({
            where: {
              userUid: user.uid,
            },
          });

          // 创建新的密码重置记录
          const passwordReset = await prisma.passwordReset.create({
            data: {
              userUid: user.uid,
            },
          });

          // 发送密码重置邮件
          const { sendEmail } = await import("@/lib/server/email");
          const { renderEmail } = await import("@/emails/utils");
          const { PasswordResetTemplate } = await import("@/emails/templates");
          const [siteName, siteUrl] = await getConfigs([
            "site.title",
            "site.url",
          ]);

          const emailComponent = PasswordResetTemplate({
            username: user.nickname || user.username,
            resetUrl: `${siteUrl}/reset-password?code=${passwordReset.id}&reason=NEEDS_UPDATE`,
            siteName,
            siteUrl,
          });

          const { html, text } = await renderEmail(emailComponent);

          await sendEmail({
            to: user.email,
            subject: "重置您的密码",
            html,
            text,
          });
        } catch (error) {
          console.error("发送密码重置邮件失败:", error);
        }
      });

      return response.forbidden({
        message: "站点安全策略已更新，密码重置邮件已发送至您的邮箱",
        error: {
          code: "PASSWORD_RESET_REQUIRED",
          message: "站点安全策略已更新，密码重置邮件已发送至您的邮箱",
        },
      });
    }

    // 检测是否SSO登录
    if (!user.password) {
      return response.badRequest({
        message: "该用户通过第三方登录，请使用对应的登录方式",
        error: {
          code: "SSO_USER",
          message: "该用户通过第三方登录，请使用对应的登录方式",
          details: user.accounts?.map((account) => ({
            provider: account.provider,
          })),
        },
      });
    }

    // 检测是否已验证邮箱
    const emailVerificationRequired = await getConfig(
      "user.email.verification.required",
    );

    if (emailVerificationRequired && !user.emailVerified) {
      return response.badRequest({
        message: "请先验证邮箱后再登录",
        error: {
          code: "EMAIL_NOT_VERIFIED",
          message: "请先验证邮箱后再登录",
        },
      });
    }

    // 验证密码
    const isPasswordValid = await verifyPassword(user.password, password);
    if (!isPasswordValid.isValid) {
      return response.badRequest({
        message: "用户名或密码错误",
        error: {
          code: "INVALID_CREDENTIALS",
          message: "用户名或密码错误",
        },
      });
    }

    // 检查是否启用了 TOTP
    if (user.totpSecret) {
      // 用户启用了 TOTP，签发临时 TOTP Token
      const totpToken = jwtTokenSign({
        inner: {
          uid: user.uid,
          type: "totp_verification",
          purpose: "login",
        },
        expired: "5m",
      });

      // 设置 TOTP Token Cookie
      if (token_transport === "cookie") {
        const cookieStore = await cookies();
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
      }

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
              old: { authenticated: false },
              new: {
                authenticated: true,
                requiresTotp: true,
                tokenTransport: token_transport,
              },
            },
            description: `用户登录通过密码验证，等待二次验证 - uid: ${user.uid}`,
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
          ...(token_transport === "body" && { totp_token: totpToken }),
        },
      }) as unknown as ActionResult<LoginSuccessResponse | null>;
    }

    // 如果没有启用 TOTP，继续正常的登录流程

    const expiredAtSeconds = 30 * 24 * 60 * 60; // 30天
    const expiredAt = new Date(Date.now() + expiredAtSeconds * 1000);
    const expiredAtUnix = Math.floor(expiredAt.getTime() / 1000); // 转换为Unix时间戳

    const clientIP = await getClientIP();
    const clientUserAgent = await getClientUserAgent();

    // 向数据库记录refresh token
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
      return response.forbidden({ message: "该账户已被禁用，请重新登录" });
    }

    // 分发令牌
    // Refresh Token
    const refreshToken = jwtTokenSign({
      inner: {
        uid: user.uid,
        tokenId: dbRefreshToken.id,
        exp: expiredAtUnix,
      },
      expired: "30d",
    });
    // Access Token
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

    // 设置HttpOnly Cookie
    if (token_transport === "cookie") {
      const cookieStore = await cookies();
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
            old: { authenticated: false },
            new: {
              authenticated: true,
              refreshTokenId: dbRefreshToken.id,
              tokenTransport: token_transport,
            },
          },
          description: `用户登录成功 - uid: ${user.uid}`,
          metadata: {
            refreshTokenId: dbRefreshToken.id,
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
      ...(token_transport === "cookie" && {
        customHeaders: new Headers([
          [
            "set-cookie",
            `REFRESH_TOKEN=${refreshToken}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${expiredAtSeconds}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
          ],
          [
            "set-cookie",
            `ACCESS_TOKEN=${accessToken}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${10 * 60}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
          ],
        ]),
      }),
    }) as unknown as ActionResult<LoginSuccessResponse | null>;
  } catch (error) {
    console.error("Login error:", error);
    return response.serverError({
      message: "登录失败，请稍后重试",
      error: {
        code: "SERVER_ERROR",
        message: "登录失败，请稍后重试",
      },
    });
  }
}

export async function register(
  params: Register,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<RegisterSuccessResponse>>>;
export async function register(
  params: Register,
  serverConfig?: AuthActionConfig,
): Promise<ApiResponse<RegisterSuccessResponse>>;
export async function register(
  { username, email, password, nickname, captcha_token }: Register,
  serverConfig?: AuthActionConfig,
): Promise<ActionResult<RegisterSuccessResponse | null>> {
  // 创建响应构建器，根据配置选择环境
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  // 速率控制
  if (!(await limitControl(await headers(), "register"))) {
    return response.tooManyRequests();
  }

  const canRegister = await getConfig("user.registration.enabled");
  if (!canRegister) {
    return response.forbidden({
      message: "当前站点不允许注册新用户",
      error: {
        code: "REGISTRATION_DISABLED",
        message: "当前站点不允许注册新用户",
      },
    });
  }

  // 验证输入参数
  const validationError = validateData(
    {
      username,
      email,
      password,
      nickname,
      captcha_token,
    },
    RegisterUserSchema,
  );
  if (validationError) return response.badRequest(validationError);

  if (!(await verifyToken(captcha_token)).success)
    return response.unauthorized({
      message: "安全验证失败，请刷新页面重试",
    });

  try {
    // 检查用户名或邮箱是否已存在
    const userExists = await prisma.user.findFirst({
      where: {
        OR: [{ username }, { email }],
      },
    });

    if (userExists) {
      return response.conflict({
        message: "用户名或邮箱已存在",
        error: {
          code: "USER_EXISTS",
          message: "用户名或邮箱已存在",
        },
      });
    }

    // 创建账户
    // 生成密码哈希
    const hashedPassword = await hashPassword(password);
    // 生成邮箱验证码
    const emailVerifyCode = emailUtils.generate();

    // 获取客户端信息用于审计日志
    // 创建用户
    const user = await prisma.user.create({
      data: {
        username,
        email,
        nickname: nickname || username,
        password: hashedPassword,
        emailVerifyCode,
      },
    });

    // 记录审计日志
    after(async () => {
      try {
        await logAuditEvent({
          user: {
            uid: user.uid.toString(),
          },
          details: {
            action: "CREATE",
            resourceType: "USER",
            resourceId: user.uid.toString(),
            value: {
              old: null,
              new: {
                username: user.username,
                email: user.email,
                nickname: user.nickname,
              },
            },
            description: `用户注册成功 - ${username}`,
          },
        });
      } catch (error) {
        console.error("Failed to log audit event:", error);
      }
    });

    // 赋予第一个注册用户管理员权限
    if (user.uid === 1) {
      await prisma.user.update({
        where: { uid: user.uid },
        data: {
          role: "ADMIN",
        },
      });
    }

    // 发送验证邮件
    after(async () => {
      try {
        const { sendEmail } = await import("@/lib/server/email");
        const { renderEmail } = await import("@/emails/utils");
        const { EmailVerificationTemplate } = await import(
          "@/emails/templates"
        );
        const [siteName, siteUrl] = await getConfigs([
          "site.title",
          "site.url",
        ]);

        const emailComponent = EmailVerificationTemplate({
          username: user.nickname || user.username,
          verificationCode: emailVerifyCode.split("-")[0]!, // 只显示6位数字，不显示时间戳
          siteName,
          siteUrl,
        });

        const { html, text } = await renderEmail(emailComponent);

        await sendEmail({
          to: user.email,
          subject: "验证您的邮箱",
          html,
          text,
        });
      } catch (error) {
        console.error("发送验证邮件失败:", error);
      }
    });

    return response.ok({
      message: "注册成功，请检查邮箱以验证账户",
    });
  } catch (error) {
    console.error("Registration error:", error);
    return response.serverError({
      message: "注册失败，请稍后重试",
      error: {
        code: "SERVER_ERROR",
        message: "注册失败，请稍后重试",
      },
    });
  }
}

export async function refresh(
  params: RefreshToken,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<LoginSuccessResponse>>>;
export async function refresh(
  params: RefreshToken,
  serverConfig?: AuthActionConfig,
): Promise<ApiResponse<LoginSuccessResponse>>;
export async function refresh(
  { refresh_token, token_transport }: RefreshToken,
  serverConfig?: AuthActionConfig,
): Promise<ActionResult<LoginSuccessResponse | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  // 速率控制
  if (!(await limitControl(await headers(), "refresh"))) {
    return response.tooManyRequests();
  }

  // 验证输入参数
  const validationError = validateData(
    {
      token_transport,
      refresh_token,
    },
    RefreshTokenSchema,
  );
  if (validationError) return response.badRequest(validationError);

  try {
    const cookieStore = await cookies();
    const token = refresh_token || cookieStore.get("REFRESH_TOKEN")?.value;

    if (!token) {
      return response.unauthorized();
    }

    // 验证&解析 Refresh Token
    const decoded = jwtTokenVerify<RefreshTokenPayload>(token);
    if (!decoded) {
      return response.unauthorized();
    }

    // 数据库验证
    const { tokenId, uid } = decoded;
    const dbToken = await prisma.refreshToken.findUnique({
      where: {
        id: tokenId,
        userUid: uid,
      },
      select: {
        id: true,
        userUid: true,
        expiresAt: true,
        revokedAt: true,
        user: {
          select: {
            uid: true,
            username: true,
            nickname: true,
            role: true,
            avatar: true,
            email: true,
            status: true,
            deletedAt: true,
          },
        },
      },
    });
    if (
      !dbToken ||
      dbToken.revokedAt ||
      dbToken.expiresAt <= new Date() ||
      dbToken.user.status !== "ACTIVE" ||
      dbToken.user.deletedAt
    ) {
      return response.unauthorized();
    }

    const activeSessionUser = await verifySession(dbToken.id, dbToken.user.uid);
    if (!activeSessionUser) {
      return response.unauthorized();
    }

    // 创建新 Access Token
    const accessToken = jwtTokenSign({
      inner: {
        type: "access",
        uid: activeSessionUser.uid,
        sessionId: dbToken.id,
        username: activeSessionUser.username,
        nickname: activeSessionUser.nickname ?? activeSessionUser.username,
        role: activeSessionUser.role,
      },
      expired: "10m",
    });

    // 获取客户端信息
    const clientIP = await getClientIP();
    const clientUserAgent = await getClientUserAgent();

    after(async () => {
      // 更新当前 Refresh Token
      await prisma.refreshToken.update({
        where: { id: dbToken.id },
        data: {
          lastUsedAt: new Date(),
          ipAddress: clientIP,
          userAgent: clientUserAgent,
        },
      });
      // 更新最后登录时间
      await prisma.user.update({
        where: { uid: dbToken.user.uid },
        data: {
          lastUseAt: new Date(),
        },
      });
    });

    // 返回成功结果
    if (token_transport === "cookie") {
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

    try {
      await logAuditEvent({
        user: {
          uid: dbToken.user.uid.toString(),
        },
        details: {
          action: "REFRESH_TOKEN",
          resourceType: "AUTH",
          resourceId: dbToken.id,
          value: {
            old: { accessTokenRefreshed: false },
            new: {
              accessTokenRefreshed: true,
              tokenTransport: token_transport,
            },
          },
          description: `用户刷新访问令牌 - uid: ${dbToken.user.uid}`,
          metadata: {
            tokenId: dbToken.id,
          },
        },
      });
    } catch (error) {
      console.error("Failed to log audit event:", error);
    }

    return response.ok({
      message: "刷新成功",
      data: {
        access_token: token_transport === "body" ? accessToken : undefined,
        refresh_token: undefined,
        userInfo: {
          uid: dbToken.user.uid,
          username: dbToken.user.username,
          role: dbToken.user.role,
          nickname: dbToken.user.nickname ?? "",
          avatar: dbToken.user.avatar ?? null,
          email: dbToken.user.email ?? null,
        },
      },
      ...(token_transport === "cookie" && {
        customHeaders: {
          "set-cookie": `ACCESS_TOKEN=${accessToken}; Path=/; HttpOnly; SameSite=Strict; Max-Age=600${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
        },
      }),
    }) as unknown as ActionResult<LoginSuccessResponse | null>;
  } catch (error) {
    console.error("Login error:", error);
    return response.serverError();
  }
}

export async function verifyEmail(
  params: EmailVerification,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<EmailVerifySuccessResponse>>>;
export async function verifyEmail(
  params: EmailVerification,
  serverConfig?: AuthActionConfig,
): Promise<ApiResponse<EmailVerifySuccessResponse>>;
export async function verifyEmail(
  { code, captcha_token, email }: EmailVerification,
  serverConfig?: AuthActionConfig,
): Promise<ActionResult<EmailVerifySuccessResponse | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  // 速率控制
  if (!(await limitControl(await headers(), "verifyEmail"))) {
    return response.tooManyRequests();
  }

  // 验证输入参数
  const validationError = validateData(
    {
      code,
      captcha_token,
      email,
    },
    EmailVerificationSchema,
  );

  if (validationError) return response.badRequest(validationError);

  if (!(await verifyToken(captcha_token)).success)
    return response.unauthorized({
      message: "安全验证失败，请刷新页面重试",
    });

  try {
    // 根据邮箱查找用户
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        uid: true,
        emailVerifyCode: true,
        emailVerified: true,
      },
    });

    if (!user) {
      return response.badRequest({
        message: "邮箱已验证，无需重复验证",
        error: {
          code: "EMAIL_ALREADY_VERIFIED",
          message: "邮箱已验证，无需重复验证",
        },
      });
    }

    if (user.emailVerified) {
      return response.badRequest({
        message: "邮箱已验证，无需重复验证",
        error: {
          code: "EMAIL_ALREADY_VERIFIED",
          message: "邮箱已验证，无需重复验证",
        },
      });
    }

    if (emailUtils.verify(code, user.emailVerifyCode || "")) {
      // 更新用户状态
      await prisma.user.update({
        where: { uid: user.uid },
        data: {
          emailVerified: true,
          emailVerifyCode: null,
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
                old: { emailVerified: false },
                new: { emailVerified: true },
              },
              description: `用户邮箱验证成功 - ${email}`,
            },
          });
        } catch (error) {
          console.error("Failed to log audit event:", error);
        }
      });

      return response.ok({
        message: "邮箱验证成功",
      });
    } else {
      return response.badRequest({
        message: "验证码无效或已过期",
        error: {
          code: "INVALID_OR_EXPIRED_CODE",
          message: "验证码无效或已过期",
        },
      });
    }
  } catch (error) {
    console.error("Email verification error:", error);
    return response.serverError();
  }
}

export async function changePassword(
  params: ChangePassword,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<ChangePasswordSuccessResponse>>>;
export async function changePassword(
  params: ChangePassword,
  serverConfig?: AuthActionConfig,
): Promise<ApiResponse<ChangePasswordSuccessResponse>>;
export async function changePassword(
  { new_password, access_token }: Omit<ChangePassword, "old_password">,
  serverConfig?: AuthActionConfig,
): Promise<ActionResult<ChangePasswordSuccessResponse | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  // 速率控制
  if (!(await limitControl(await headers(), "changePassword"))) {
    return response.tooManyRequests();
  }

  // 验证输入参数 - 只验证 new_password
  const validationError = validateData(
    {
      new_password,
      access_token,
    },
    ChangePasswordSchema.omit({ old_password: true }),
  );
  if (validationError) return response.badRequest(validationError);

  try {
    // 从 cookie 或请求体中获取 Access Token
    const cookieStore = await cookies();
    const token = access_token || cookieStore.get("ACCESS_TOKEN")?.value || "";
    // 验证 Access Token
    const decoded = await verifyAccessToken(token);
    if (!decoded) {
      return response.unauthorized();
    }
    const { uid } = decoded;
    if (!uid) {
      return response.unauthorized();
    }

    // 检查是否有有效的 REAUTH_TOKEN，并绑定当前用户 UID
    const { checkReauthToken } = await import("./reauth");
    const hasReauthToken = await checkReauthToken(uid);
    if (!hasReauthToken) {
      return response.forbidden({
        message: "需要重新验证身份",
        error: {
          code: "NEED_REAUTH",
          message: "需要重新验证身份",
        },
      });
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
      return response.unauthorized();
    }

    // 检查新密码是否与旧密码相同（如果有旧密码）
    if (user.password) {
      const isSamePassword = await verifyPassword(user.password, new_password);
      if (isSamePassword.isValid) {
        return response.badRequest({
          message: "新密码不能与当前密码相同",
          error: {
            code: "PASSWORDS_IDENTICAL",
            message: "新密码不能与当前密码相同",
          },
        });
      }
    }

    // 哈希新密码
    const hashedNewPassword = await hashPassword(new_password);
    // 更新密码
    await prisma.user.update({
      where: { uid: user.uid },
      data: {
        password: hashedNewPassword,
      },
    });
    // 注销所有会话
    await prisma.refreshToken.deleteMany({
      where: { userUid: user.uid },
    });

    // 清除所有认证相关的 cookies，强制用户重新登录
    cookieStore.delete("ACCESS_TOKEN");
    cookieStore.delete("REFRESH_TOKEN");
    cookieStore.delete("REAUTH_TOKEN");

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
              old: { passwordChanged: false },
              new: { passwordChanged: true },
            },
            description: `用户修改密码 - uid: ${user.uid}`,
          },
        });
      } catch (error) {
        console.error("Failed to log audit event:", error);
      }
    });

    // 发送密码修改通知邮件
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
        const { PasswordChangedTemplate } = await import("@/emails/templates");
        const [siteName, siteUrl] = await getConfigs([
          "site.title",
          "site.url",
        ]);

        const emailComponent = PasswordChangedTemplate({
          username: userWithEmail.nickname || userWithEmail.username,
          siteName,
          siteUrl,
        });

        const { html, text } = await renderEmail(emailComponent);

        await sendEmail({
          to: userWithEmail.email,
          subject: "密码已修改",
          html,
          text,
        });
      } catch (error) {
        console.error("发送密码修改通知邮件失败:", error);
      }
    });

    // 返回成功结果
    return response.ok({
      message: "密码修改成功",
    });
  } catch (error) {
    console.error("Change password error:", error);
    return response.serverError();
  }
}

export async function requestPasswordReset(
  params: RequestPasswordReset,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<PasswordResetRequestSuccessResponse>>>;
export async function requestPasswordReset(
  params: RequestPasswordReset,
  serverConfig?: AuthActionConfig,
): Promise<ApiResponse<PasswordResetRequestSuccessResponse>>;
export async function requestPasswordReset(
  { email, captcha_token }: RequestPasswordReset,
  serverConfig?: AuthActionConfig,
): Promise<ActionResult<PasswordResetRequestSuccessResponse | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );
  // 速率控制
  if (!(await limitControl(await headers(), "requestPasswordReset"))) {
    return response.tooManyRequests();
  }
  // 验证输入参数
  const validationError = validateData(
    {
      email,
      captcha_token,
    },
    RequestPasswordResetSchema,
  );
  if (validationError) return response.badRequest(validationError);

  if (!(await verifyToken(captcha_token)).success)
    return response.unauthorized({
      message: "安全验证失败，请刷新页面重试",
    });

  try {
    // 查找用户
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        uid: true,
        email: true,
        username: true,
        nickname: true,
      },
    });

    // 防止遍历：即使用户不存在也返回成功消息
    if (!user) {
      return response.ok({
        message: "已发送重置密码链接，链接30分钟内有效",
      });
    }

    // 检查是否在30分钟内已经发送过重置邮件
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    const recentReset = await prisma.passwordReset.findFirst({
      where: {
        userUid: user.uid,
        createdAt: { gte: thirtyMinutesAgo },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // 如果30分钟内已经发送过，不再重复发送
    if (recentReset) {
      try {
        await logAuditEvent({
          user: {
            uid: user.uid.toString(),
          },
          details: {
            action: "REQUEST_PASSWORD_RESET",
            resourceType: "USER",
            resourceId: user.uid.toString(),
            value: {
              old: { resetEmailRecentlySent: false },
              new: { resetEmailRecentlySent: true },
            },
            description: `用户重复请求密码重置（30 分钟内）- uid: ${user.uid}`,
          },
        });
      } catch (error) {
        console.error("Failed to log audit event:", error);
      }

      return response.ok({
        message: "已发送重置密码链接，链接30分钟内有效",
      });
    }

    // 删除该用户的所有旧重置记录
    await prisma.passwordReset.deleteMany({
      where: {
        userUid: user.uid,
      },
    });

    // 创建新的密码重置记录
    const passwordReset = await prisma.passwordReset.create({
      data: {
        userUid: user.uid,
      },
    });

    // 统一将邮件发送逻辑放到 after 中，防止时间差泄露用户存在性
    after(async () => {
      try {
        const { sendEmail } = await import("@/lib/server/email");
        const { renderEmail } = await import("@/emails/utils");
        const { PasswordResetTemplate } = await import("@/emails/templates");
        const [siteName, siteUrl] = await getConfigs([
          "site.title",
          "site.url",
        ]);

        const emailComponent = PasswordResetTemplate({
          username: user.nickname || user.username,
          resetUrl: `${siteUrl}/reset-password?code=${passwordReset.id}`,
          siteName,
          siteUrl,
        });

        const { html, text } = await renderEmail(emailComponent);

        await sendEmail({
          to: user.email,
          subject: "重置您的密码",
          html,
          text,
        });
      } catch (error) {
        console.error("发送密码重置邮件失败:", error);
      }
    });

    // 清理30分钟之前的请求
    after(async () => {
      await prisma.passwordReset.deleteMany({
        where: {
          createdAt: { lt: thirtyMinutesAgo },
        },
      });
    });

    try {
      await logAuditEvent({
        user: {
          uid: user.uid.toString(),
        },
        details: {
          action: "REQUEST_PASSWORD_RESET",
          resourceType: "USER",
          resourceId: user.uid.toString(),
          value: {
            old: { passwordResetRequested: false },
            new: { passwordResetRequested: true },
          },
          description: `用户请求密码重置 - uid: ${user.uid}`,
        },
      });
    } catch (error) {
      console.error("Failed to log audit event:", error);
    }

    // 返回成功结果
    return response.ok({
      message: "已发送重置密码链接，链接30分钟内有效",
    });
  } catch (error) {
    console.error("Request password reset error:", error);
    return response.serverError();
  }
}

export async function resetPassword(
  params: ResetPassword,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<ResetPasswordSuccessResponse>>>;
export async function resetPassword(
  params: ResetPassword,
  serverConfig?: AuthActionConfig,
): Promise<ApiResponse<ResetPasswordSuccessResponse>>;
export async function resetPassword(
  { code, new_password, captcha_token }: ResetPassword,
  serverConfig?: AuthActionConfig,
): Promise<ActionResult<ResetPasswordSuccessResponse | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  // 速率控制
  if (!(await limitControl(await headers(), "resetPassword"))) {
    return response.tooManyRequests();
  }

  // 验证输入参数
  const validationError = validateData(
    {
      code,
      new_password,
      captcha_token,
    },
    ResetPasswordSchema,
  );
  if (validationError) return response.badRequest(validationError);

  if (!(await verifyToken(captcha_token)).success)
    return response.unauthorized({
      message: "安全验证失败，请刷新页面重试",
    });

  try {
    // 查找密码重置请求
    const passwordReset = await prisma.passwordReset.findUnique({
      where: { id: code },
      select: {
        id: true,
        userUid: true,
        createdAt: true,
        user: {
          select: {
            uid: true,
            email: true,
            username: true,
            nickname: true,
            status: true,
          },
        },
      },
    });

    if (!passwordReset) {
      return response.badRequest({
        message: "无效的重置码",
        error: {
          code: "INVALID_RESET_CODE",
          message: "无效的重置码",
        },
      });
    }

    // 检查是否过期（30分钟内有效）
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    if (passwordReset.createdAt < thirtyMinutesAgo) {
      return response.badRequest({
        message: "重置码已过期",
        error: {
          code: "EXPIRED_RESET_CODE",
          message: "重置码已过期",
        },
      });
    }

    // 更改密码
    const hashedNewPassword = await hashPassword(new_password);
    await prisma.user.update({
      where: { uid: passwordReset.userUid },
      data: {
        password: hashedNewPassword,
      },
    });

    // 更新用户状态
    if (passwordReset.user.status === "NEEDS_UPDATE") {
      await prisma.user.update({
        where: { uid: passwordReset.userUid },
        data: {
          status: "ACTIVE",
          emailVerified: true,
        },
      });
    }

    // 删除该用户的所有密码重置请求
    await prisma.passwordReset.deleteMany({
      where: { userUid: passwordReset.userUid },
    });

    // 注销所有会话
    await prisma.refreshToken.deleteMany({
      where: { userUid: passwordReset.userUid },
    });

    // 获取客户端信息用于审计日志
    // 记录审计日志
    after(async () => {
      try {
        await logAuditEvent({
          user: {
            uid: passwordReset.userUid.toString(),
          },
          details: {
            action: "UPDATE",
            resourceType: "USER",
            resourceId: passwordReset.userUid.toString(),
            value: {
              old: { passwordReset: false },
              new: { passwordReset: true },
            },
            description: `用户通过重置链接修改密码 - ${passwordReset.user.username}`,
          },
        });
      } catch (error) {
        console.error("Failed to log audit event:", error);
      }
    });

    // 发送密码修改通知邮件
    after(async () => {
      try {
        const { sendEmail } = await import("@/lib/server/email");
        const { renderEmail } = await import("@/emails/utils");
        const { PasswordChangedTemplate } = await import("@/emails/templates");
        const [siteName, siteUrl] = await getConfigs([
          "site.title",
          "site.url",
        ]);

        const emailComponent = PasswordChangedTemplate({
          username: passwordReset.user.nickname || passwordReset.user.username,
          siteName,
          siteUrl,
        });

        const { html, text } = await renderEmail(emailComponent);

        await sendEmail({
          to: passwordReset.user.email,
          subject: "密码已修改",
          html,
          text,
        });
      } catch (error) {
        console.error("发送密码修改通知邮件失败:", error);
      }
    });

    // 返回成功结果
    return response.ok({
      message: "密码重置成功",
    });
  } catch (error) {
    console.error("Reset password error:", error);
    return response.serverError();
  }
}

export async function resendEmailVerification(
  params: ResendEmailVerification,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<ResendEmailVerificationSuccessResponse>>>;
export async function resendEmailVerification(
  params: ResendEmailVerification,
  serverConfig?: AuthActionConfig,
): Promise<ApiResponse<ResendEmailVerificationSuccessResponse>>;
export async function resendEmailVerification(
  { email, captcha_token }: ResendEmailVerification,
  serverConfig?: AuthActionConfig,
): Promise<ActionResult<ResendEmailVerificationSuccessResponse | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  // 速率控制
  if (!(await limitControl(await headers(), "resendEmailVerification"))) {
    return response.tooManyRequests();
  }

  // 验证输入参数
  const validationError = validateData(
    {
      email,
      captcha_token,
    },
    ResendEmailVerificationSchema,
  );
  if (validationError) return response.badRequest(validationError);

  if (!(await verifyToken(captcha_token)).success)
    return response.unauthorized({
      message: "安全验证失败，请刷新页面重试",
    });

  try {
    // 查找用户
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        uid: true,
        email: true,
        emailVerified: true,
      },
    });

    // 防止遍历
    if (!user) {
      return response.ok({
        message: "验证码已重新发送，请检查邮箱",
      });
    }

    // 如果邮箱已验证
    if (user.emailVerified) {
      return response.ok({
        message: "验证码已重新发送，请检查邮箱",
      });
    }

    // 重新生成邮箱验证码
    const emailVerifyCode = emailUtils.generate();

    // 更新用户的验证码
    await prisma.user.update({
      where: { uid: user.uid },
      data: {
        emailVerifyCode,
      },
    });

    try {
      await logAuditEvent({
        user: {
          uid: user.uid.toString(),
        },
        details: {
          action: "RESEND_EMAIL_VERIFICATION",
          resourceType: "USER",
          resourceId: user.uid.toString(),
          value: {
            old: { emailVerifyCodeUpdated: false },
            new: { emailVerifyCodeUpdated: true },
          },
          description: `用户重新发送邮箱验证码 - uid: ${user.uid}`,
        },
      });
    } catch (error) {
      console.error("Failed to log audit event:", error);
    }

    // 统一将邮件发送逻辑放到 after 中，防止时间差泄露用户存在性
    after(async () => {
      try {
        const { sendEmail } = await import("@/lib/server/email");
        const { renderEmail } = await import("@/emails/utils");
        const { EmailVerificationTemplate } = await import(
          "@/emails/templates"
        );
        const [siteName, siteUrl] = await getConfigs([
          "site.title",
          "site.url",
        ]);

        const emailComponent = EmailVerificationTemplate({
          username: user.email,
          verificationCode: emailVerifyCode.split("-")[0]!, // 只显示6位数字，不显示时间戳
          siteName,
          siteUrl,
        });

        const { html, text } = await renderEmail(emailComponent);

        await sendEmail({
          to: user.email,
          subject: "验证您的邮箱",
          html,
          text,
        });
      } catch (error) {
        console.error("发送验证邮件失败:", error);
      }
    });

    return response.ok({
      message: "验证码已重新发送，请检查邮箱",
    });
  } catch (error) {
    console.error("Resend email verification error:", error);
    return response.serverError({
      message: "发送失败，请稍后重试",
      error: {
        code: "SERVER_ERROR",
        message: "发送失败，请稍后重试",
      },
    });
  }
}

export async function logout(
  params: Logout,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<null>>>;
export async function logout(
  params: Logout,
  serverConfig?: AuthActionConfig,
): Promise<ApiResponse<null>>;
export async function logout(
  { refresh_token }: Logout,
  serverConfig?: AuthActionConfig,
): Promise<ActionResult<null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );
  // 速率控制
  if (!(await limitControl(await headers(), "logout"))) {
    return response.tooManyRequests();
  }

  // 验证输入参数
  const validationError = validateData(
    {
      refresh_token,
    },
    LogoutSchema,
  );
  if (validationError) return response.badRequest(validationError);

  try {
    // 从 cookie 或请求体中获取 Refresh Token
    const cookieStore = await cookies();
    const token =
      refresh_token || cookieStore.get("REFRESH_TOKEN")?.value || "";

    // 清除 Cookie 的辅助函数
    const clearCookies = () => {
      cookieStore.delete("REFRESH_TOKEN");
      cookieStore.delete("ACCESS_TOKEN");
      cookieStore.delete("REAUTH_TOKEN");
    };

    // 验证 Refresh Token
    const decoded = jwtTokenVerify<RefreshTokenPayload>(token);
    if (!decoded) {
      // 认证失败时也清除 cookie
      clearCookies();
      return response.unauthorized();
    }
    const { tokenId } = decoded;
    if (!tokenId) {
      // 认证失败时也清除 cookie
      clearCookies();
      return response.unauthorized();
    }

    // 注销此会话
    await prisma.refreshToken.update({
      where: {
        id: decoded.tokenId,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    // 清除 Cookie
    clearCookies();

    if (typeof decoded.uid === "number") {
      try {
        await logAuditEvent({
          user: {
            uid: decoded.uid.toString(),
          },
          details: {
            action: "LOGOUT",
            resourceType: "AUTH",
            resourceId: decoded.tokenId,
            value: {
              old: { revokedAt: null },
              new: { revokedAt: new Date() },
            },
            description: `用户退出登录 - uid: ${decoded.uid}`,
            metadata: {
              tokenId: decoded.tokenId,
            },
          },
        });
      } catch (error) {
        console.error("Failed to log audit event:", error);
      }
    }

    return response.ok({
      message: "退出登录成功",
      data: null,
      customHeaders: new Headers([
        [
          "set-cookie",
          `REFRESH_TOKEN=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${
            process.env.NODE_ENV === "production" ? "; Secure" : ""
          }`,
        ],
        [
          "set-cookie",
          `ACCESS_TOKEN=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${
            process.env.NODE_ENV === "production" ? "; Secure" : ""
          }`,
        ],
        [
          "set-cookie",
          `REAUTH_TOKEN=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${
            process.env.NODE_ENV === "production" ? "; Secure" : ""
          }`,
        ],
      ]),
    });
  } catch (error) {
    console.error("Logout error:", error);
    // 发生错误时也清除 cookie
    const cookieStore = await cookies();
    cookieStore.delete("REFRESH_TOKEN");
    cookieStore.delete("ACCESS_TOKEN");
    cookieStore.delete("REAUTH_TOKEN");
    return response.serverError();
  }
}

/**
 * 获取当前用户的所有会话列表
 */
export async function getSessions(serverConfig: {
  environment: "serverless";
}): Promise<NextResponse<ApiResponse<GetSessionsSuccessResponse["data"]>>>;

export async function getSessions(
  serverConfig?: AuthActionConfig,
): Promise<ApiResponse<GetSessionsSuccessResponse["data"]>>;

export async function getSessions(
  serverConfig?: AuthActionConfig,
): Promise<ActionResult<GetSessionsSuccessResponse["data"] | null>> {
  return sessionService.getSessions(serverConfig);
}

/**
 * 撤销指定会话
 */
export async function revokeSession(
  params: RevokeSession,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<RevokeSessionSuccessResponse["data"]>>>;
export async function revokeSession(
  params: RevokeSession,
  serverConfig?: AuthActionConfig,
): Promise<ApiResponse<RevokeSessionSuccessResponse["data"]>>;
export async function revokeSession(
  params: RevokeSession,
  serverConfig?: AuthActionConfig,
): Promise<ActionResult<RevokeSessionSuccessResponse["data"] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  // 速率控制
  if (!(await limitControl(await headers(), "revokeSession"))) {
    return response.tooManyRequests();
  }

  // 验证输入参数
  const validationError = validateData(params, RevokeSessionSchema);
  if (validationError) return response.badRequest(validationError);

  try {
    const { sessionId } = params;

    // 从 cookie 中获取当前的 REFRESH_TOKEN
    const cookieStore = await cookies();
    const currentToken = cookieStore.get("REFRESH_TOKEN")?.value;

    let currentTokenId: string | null = null;
    if (currentToken) {
      const decoded = jwtTokenVerify<RefreshTokenPayload>(currentToken);
      currentTokenId = decoded?.tokenId || null;
    }

    // 不能撤销当前会话
    if (sessionId === currentTokenId) {
      return response.badRequest({
        message: "无法撤销当前会话，请使用退出登录功能",
        error: {
          code: "CANNOT_REVOKE_CURRENT_SESSION",
          message: "无法撤销当前会话，请使用退出登录功能",
        },
      });
    }

    // 从 ACCESS_TOKEN 中获取用户 UID
    const accessToken = cookieStore.get("ACCESS_TOKEN")?.value;
    if (!accessToken) {
      return response.unauthorized({
        message: "未登录",
      });
    }

    const decodedAccess = await verifyAccessToken(accessToken);
    if (!decodedAccess) {
      return response.unauthorized({
        message: "未登录",
      });
    }

    const { checkReauthToken } = await import("./reauth");
    const hasReauthToken = await checkReauthToken(decodedAccess.uid);
    if (!hasReauthToken) {
      return response.forbidden({
        message: "需要重新验证身份",
        error: {
          code: "NEED_REAUTH",
          message: "需要重新验证身份",
        },
      });
    }

    const { uid } = decodedAccess;

    // 查找指定的 RefreshToken
    const token = await prisma.refreshToken.findUnique({
      where: {
        id: sessionId,
      },
      select: {
        id: true,
        userUid: true,
        revokedAt: true,
      },
    });

    if (!token) {
      return response.notFound({
        message: "会话不存在",
      });
    }

    // 检查是否属于当前用户
    if (token.userUid !== uid) {
      return response.forbidden({
        message: "无权撤销此会话",
      });
    }

    // 检查是否已撤销
    if (token.revokedAt) {
      return response.badRequest({
        message: "该会话已被撤销",
      });
    }

    // 撤销会话
    await prisma.refreshToken.update({
      where: {
        id: sessionId,
      },
      data: {
        revokedAt: new Date(),
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
            resourceType: "REFRESH_TOKEN",
            resourceId: sessionId,
            value: {
              old: { revokedAt: null },
              new: { revokedAt: new Date() },
            },
            description: `用户撤销会话 - sessionId: ${sessionId}`,
          },
        });
      } catch (error) {
        console.error("Failed to log audit event:", error);
      }
    });

    return response.ok({
      message: "会话已撤销",
      data: null,
    });
  } catch (error) {
    console.error("Revoke session error:", error);
    return response.serverError({
      message: "撤销会话失败",
    });
  }
}
