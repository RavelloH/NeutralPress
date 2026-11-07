import { cookies, headers } from "next/headers";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { handleSSOBind, handleSSOCallback } from "@/actions/sso";
import { getConfig } from "@/lib/server/config-cache";
import { jwtTokenVerify } from "@/lib/server/jwt";
import { type OAuthProvider } from "@/lib/server/oauth";
import { resolveOAuthRedirectUrl } from "@/lib/server/oauth-redirect";
import limitControl from "@/lib/server/rate-limit";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const siteUrl = await getConfig("site.url");

  // 速率限制检查
  if (!(await limitControl(await headers(), "sso_callback"))) {
    const cookieStore = await cookies();
    cookieStore.set("sso_login_error", "请求过于频繁，请稍后再试", {
      httpOnly: false, // 客户端需要读取
      maxAge: 60,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
    });
    return NextResponse.redirect(
      resolveOAuthRedirectUrl("/login?sso=error", siteUrl),
    );
  }

  const { provider } = await params;
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  const cookieStore = await cookies();

  // OAuth 提供商返回错误
  if (error) {
    // 限制 error 内容长度并移除潜在的恶意字符
    const sanitizedError = String(error)
      .slice(0, 200)
      .replace(/[<>"'&]/g, "");
    cookieStore.set("sso_login_error", `授权失败: ${sanitizedError}`, {
      httpOnly: false, // 客户端需要读取
      maxAge: 60, // 1分钟过期
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
    });
    return NextResponse.redirect(
      resolveOAuthRedirectUrl("/login?sso=error", siteUrl),
    );
  }

  // 缺少必要参数
  if (!code || !state) {
    cookieStore.set("sso_login_error", "缺少必要的授权信息", {
      httpOnly: false, // 客户端需要读取
      maxAge: 60,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
    });
    return NextResponse.redirect(
      resolveOAuthRedirectUrl("/login?sso=error", siteUrl),
    );
  }

  // 读取模式标识
  const mode = cookieStore.get(`oauth_mode_${provider}`)?.value || "login";

  // 根据模式使用不同的 cookie 前缀
  let cookiePrefix = "oauth";
  if (mode === "bind") {
    cookiePrefix = "oauth_bind";
  } else if (mode === "reauth") {
    cookiePrefix = "oauth_reauth";
  }

  // 获取 codeVerifier
  const codeVerifier =
    cookieStore.get(`${cookiePrefix}_verifier_${provider}`)?.value || undefined;

  try {
    if (mode === "reauth") {
      // Reauth 模式 - 验证身份并设置 REAUTH_TOKEN
      const reauthTokenCookie = cookieStore.get(
        `oauth_reauth_token_${provider}`,
      )?.value;
      if (!reauthTokenCookie) {
        return NextResponse.redirect(
          resolveOAuthRedirectUrl(
            `/reauth?error=${encodeURIComponent("验证失败：缺少认证信息")}`,
            siteUrl,
          ),
        );
      }

      // 验证 JWT token
      const reauthTokenPayload = jwtTokenVerify<{
        uid: number;
        purpose: string;
        provider: string;
      }>(reauthTokenCookie);

      if (
        !reauthTokenPayload ||
        reauthTokenPayload.purpose !== "oauth_reauth" ||
        reauthTokenPayload.provider !== provider
      ) {
        return NextResponse.redirect(
          resolveOAuthRedirectUrl(
            `/reauth?error=${encodeURIComponent("验证失败：认证信息无效")}`,
            siteUrl,
          ),
        );
      }

      const uid = reauthTokenPayload.uid;

      // 验证 state（CSRF 防护）- 使用 JWT
      const storedStateToken = cookieStore.get(
        `${cookiePrefix}_state_${provider}`,
      )?.value;
      if (!storedStateToken) {
        // 清除相关 cookies
        cookieStore.delete(`${cookiePrefix}_state_${provider}`);
        cookieStore.delete(`${cookiePrefix}_verifier_${provider}`);
        cookieStore.delete(`oauth_mode_${provider}`);
        cookieStore.delete(`oauth_reauth_token_${provider}`);

        return NextResponse.redirect(
          resolveOAuthRedirectUrl(
            `/reauth?error=${encodeURIComponent("验证失败：缺少 state")}`,
            siteUrl,
          ),
        );
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
        statePayload.mode !== "reauth" ||
        statePayload.provider !== provider
      ) {
        // 清除相关 cookies
        cookieStore.delete(`${cookiePrefix}_state_${provider}`);
        cookieStore.delete(`${cookiePrefix}_verifier_${provider}`);
        cookieStore.delete(`oauth_mode_${provider}`);
        cookieStore.delete(`oauth_reauth_token_${provider}`);

        return NextResponse.redirect(
          resolveOAuthRedirectUrl(
            `/reauth?error=${encodeURIComponent("验证失败：state 不匹配")}`,
            siteUrl,
          ),
        );
      }

      // 完成 OAuth 流程，获取用户信息
      let oauthUserInfo;
      try {
        const { validateOAuthCallback } = await import("@/lib/server/oauth");
        oauthUserInfo = await validateOAuthCallback(
          provider as OAuthProvider,
          code,
          codeVerifier,
        );
      } catch (error) {
        console.error("OAuth validation error:", error);

        // 清除相关 cookies
        cookieStore.delete(`${cookiePrefix}_state_${provider}`);
        cookieStore.delete(`${cookiePrefix}_verifier_${provider}`);
        cookieStore.delete(`oauth_mode_${provider}`);
        cookieStore.delete(`oauth_reauth_token_${provider}`);

        return NextResponse.redirect(
          resolveOAuthRedirectUrl(
            `/reauth?error=${encodeURIComponent(
              error instanceof Error ? error.message : "OAuth 验证失败",
            )}`,
            siteUrl,
          ),
        );
      }

      // 调用 verifySSOForReauth，传入 providerAccountId 进行账户绑定验证
      const { verifySSOForReauth } = await import("@/actions/reauth");
      const result = await verifySSOForReauth({
        uid,
        provider,
        providerAccountId: oauthUserInfo.providerAccountId,
      });

      // 清除相关 cookies
      cookieStore.delete(`${cookiePrefix}_state_${provider}`);
      cookieStore.delete(`${cookiePrefix}_verifier_${provider}`);
      cookieStore.delete(`oauth_mode_${provider}`);
      cookieStore.delete(`oauth_reauth_token_${provider}`);

      if (!result.success) {
        return NextResponse.redirect(
          resolveOAuthRedirectUrl(
            `/reauth?error=${encodeURIComponent(result.message || "验证失败")}`,
            siteUrl,
          ),
        );
      }

      // Reauth 成功，重定向回 /reauth 页面
      // 页面会通过 BroadcastChannel 通知父窗口并关闭自己
      return NextResponse.redirect(
        resolveOAuthRedirectUrl(
          `/reauth?success=${encodeURIComponent("验证成功")}`,
          siteUrl,
        ),
      );
    } else if (mode === "bind") {
      // 绑定模式
      const result = await handleSSOBind({
        provider,
        code,
        state,
        codeVerifier,
      });

      if (!result.success) {
        return NextResponse.redirect(
          resolveOAuthRedirectUrl(
            `/settings?error=${encodeURIComponent(result.message || "绑定失败")}`,
            siteUrl,
          ),
        );
      }

      // 绑定成功，获取重定向目标（验证必须为安全的相对路径）
      let redirectTo =
        cookieStore.get(`${cookiePrefix}_redirect_to`)?.value || "/settings";

      // 防止开放重定向：必须以 / 开头且不以 // 开头
      if (!redirectTo.startsWith("/") || redirectTo.startsWith("//")) {
        redirectTo = "/settings";
      }

      // 清除相关 cookies
      cookieStore.delete(`${cookiePrefix}_state_${provider}`);
      cookieStore.delete(`${cookiePrefix}_verifier_${provider}`);
      cookieStore.delete(`${cookiePrefix}_redirect_to`);
      cookieStore.delete(`oauth_mode_${provider}`);
      cookieStore.delete(`oauth_bind_token_${provider}`); // 清除绑定时存储的 JWT token

      // 跳转到目标页面
      return NextResponse.redirect(
        resolveOAuthRedirectUrl(
          `${redirectTo}?success=${encodeURIComponent(result.message)}`,
          siteUrl,
        ),
      );
    } else {
      // 登录模式
      const result = await handleSSOCallback({
        provider,
        code,
        state,
        codeVerifier,
      });

      if (!result.success) {
        // 清除 OAuth 流程相关的 cookies
        cookieStore.delete(`oauth_state_${provider}`);
        cookieStore.delete(`oauth_verifier_${provider}`);
        cookieStore.delete(`oauth_mode_${provider}`);

        cookieStore.set("sso_login_error", result.message || "登录失败", {
          httpOnly: false, // 客户端需要读取
          maxAge: 60,
          sameSite: "lax",
          path: "/",
          secure: process.env.NODE_ENV === "production",
        });
        return NextResponse.redirect(
          resolveOAuthRedirectUrl("/login?sso=error", siteUrl),
        );
      }

      const { action, userInfo } = result.data!;

      if (action === "login") {
        // 登录成功，设置结果 Cookie
        cookieStore.set(
          "sso_login_result",
          JSON.stringify({
            success: true,
            userInfo,
            message: "登录成功",
          }),
          {
            httpOnly: false, // 客户端需要读取
            maxAge: 60, // 1分钟过期
            sameSite: "lax",
            path: "/",
            secure: process.env.NODE_ENV === "production",
          },
        );

        // 清除 OAuth 流程相关的 cookies
        cookieStore.delete(`oauth_state_${provider}`);
        cookieStore.delete(`oauth_verifier_${provider}`);
        cookieStore.delete(`oauth_mode_${provider}`);

        // ACCESS_TOKEN 和 REFRESH_TOKEN 已经在 handleSSOCallback 中设置
        return NextResponse.redirect(
          resolveOAuthRedirectUrl("/login?sso=success", siteUrl),
        );
      } else {
        // 未知的 action
        cookieStore.set("sso_login_error", "未知的操作类型", {
          httpOnly: false, // 客户端需要读取
          maxAge: 60,
          sameSite: "lax",
          path: "/",
          secure: process.env.NODE_ENV === "production",
        });
        return NextResponse.redirect(
          resolveOAuthRedirectUrl("/login?sso=error", siteUrl),
        );
      }
    }
  } catch (error) {
    console.error("SSO callback error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "操作失败，请稍后重试";

    // 清除 OAuth 流程相关的 cookies
    cookieStore.delete(`oauth_state_${provider}`);
    cookieStore.delete(`oauth_verifier_${provider}`);
    cookieStore.delete(`oauth_mode_${provider}`);

    if (mode === "bind") {
      cookieStore.delete(`oauth_bind_token_${provider}`);
      return NextResponse.redirect(
        resolveOAuthRedirectUrl(
          `/settings?error=${encodeURIComponent(errorMessage)}`,
          siteUrl,
        ),
      );
    } else if (mode === "reauth") {
      cookieStore.delete(`oauth_reauth_token_${provider}`);
      return NextResponse.redirect(
        resolveOAuthRedirectUrl(
          `/reauth?error=${encodeURIComponent(errorMessage)}`,
          siteUrl,
        ),
      );
    } else {
      cookieStore.set("sso_login_error", errorMessage, {
        httpOnly: false, // 客户端需要读取
        maxAge: 60,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      });
      return NextResponse.redirect(
        resolveOAuthRedirectUrl("/login?sso=error", siteUrl),
      );
    }
  }
}
