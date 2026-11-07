import { cookies, headers } from "next/headers";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getConfig } from "@/lib/server/config-cache";
import {
  type AccessTokenPayload,
  jwtTokenSign,
  jwtTokenVerify,
} from "@/lib/server/jwt";
import {
  generateState,
  getAuthorizationUrl,
  isOAuthEnabled,
  type OAuthProvider,
} from "@/lib/server/oauth";
import { resolveOAuthRedirectUrl } from "@/lib/server/oauth-redirect";
import limitControl from "@/lib/server/rate-limit";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const siteUrl = await getConfig("site.url");

  // 速率限制检查
  if (!(await limitControl(await headers(), "sso_login"))) {
    return NextResponse.redirect(
      resolveOAuthRedirectUrl(
        `/login?error=${encodeURIComponent("请求过于频繁，请稍后再试")}`,
        siteUrl,
      ),
    );
  }

  const { provider } = await params;
  const { searchParams } = new URL(request.url);
  const redirect_to = searchParams.get("redirect_to");
  const mode = searchParams.get("mode") || "login"; // login, bind, 或 reauth

  const cookieStore = await cookies();

  // 如果是绑定模式，验证用户是否已登录
  if (mode === "bind") {
    const accessToken = cookieStore.get("ACCESS_TOKEN")?.value;
    if (!accessToken) {
      return NextResponse.redirect(
        resolveOAuthRedirectUrl(
          `/login?error=${encodeURIComponent("请先登录")}`,
          siteUrl,
        ),
      );
    }

    const currentUser = jwtTokenVerify<AccessTokenPayload>(accessToken);
    if (!currentUser) {
      return NextResponse.redirect(
        resolveOAuthRedirectUrl(
          `/login?error=${encodeURIComponent("请先登录")}`,
          siteUrl,
        ),
      );
    }

    // 检查是否有有效的 REAUTH_TOKEN
    const { checkReauthToken } = await import("@/actions/reauth");
    const hasReauthToken = await checkReauthToken(currentUser.uid);
    if (!hasReauthToken) {
      // 没有 REAUTH_TOKEN，重定向到 settings 页面，由前端处理 reauth
      return NextResponse.redirect(
        resolveOAuthRedirectUrl(
          `/settings?error=${encodeURIComponent("需要重新验证身份")}&trigger_reauth=bind_sso&provider=${provider}`,
          siteUrl,
        ),
      );
    }

    // 使用 JWT 存储用户 uid，防止伪造
    // 因为 ACCESS_TOKEN 是 sameSite=strict，在 OAuth 重定向回来时无法访问
    const bindToken = jwtTokenSign({
      inner: {
        uid: currentUser.uid,
        purpose: "oauth_bind",
        provider,
      },
      expired: "10m",
    });

    cookieStore.set(`oauth_bind_token_${provider}`, bindToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600, // 10 分钟
      path: "/",
      priority: "high",
    });
  }

  // 如果是 reauth 模式，验证用户是否已登录
  if (mode === "reauth") {
    const accessToken = cookieStore.get("ACCESS_TOKEN")?.value;
    if (!accessToken) {
      return NextResponse.redirect(
        resolveOAuthRedirectUrl(
          `/login?error=${encodeURIComponent("请先登录")}`,
          siteUrl,
        ),
      );
    }

    const currentUser = jwtTokenVerify<AccessTokenPayload>(accessToken);
    if (!currentUser) {
      return NextResponse.redirect(
        resolveOAuthRedirectUrl(
          `/login?error=${encodeURIComponent("请先登录")}`,
          siteUrl,
        ),
      );
    }

    // 使用 JWT 存储用户 uid，防止伪造
    const reauthToken = jwtTokenSign({
      inner: {
        uid: currentUser.uid,
        purpose: "oauth_reauth",
        provider,
      },
      expired: "10m",
    });

    cookieStore.set(`oauth_reauth_token_${provider}`, reauthToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600, // 10 分钟
      path: "/",
      priority: "high",
    });
  }

  // 验证 provider
  const validProviders: OAuthProvider[] = ["google", "github", "microsoft"];
  if (!validProviders.includes(provider as OAuthProvider)) {
    const redirectUrl = mode === "bind" ? "/settings" : "/login";
    return NextResponse.redirect(
      resolveOAuthRedirectUrl(
        `${redirectUrl}?error=${encodeURIComponent("不支持的登录方式")}`,
        siteUrl,
      ),
    );
  }

  const oauthProvider = provider as OAuthProvider;

  // 检查是否启用
  const enabled = await isOAuthEnabled(oauthProvider);
  if (!enabled) {
    const redirectUrl = mode === "bind" ? "/settings" : "/login";
    return NextResponse.redirect(
      resolveOAuthRedirectUrl(
        `${redirectUrl}?error=${encodeURIComponent(`${provider.toUpperCase()} 登录未启用`)}`,
        siteUrl,
      ),
    );
  }

  try {
    // 生成 state 用于 CSRF 防护
    const stateValue = generateState();

    // 使用 JWT 包装 state，添加过期时间和绑定信息
    const stateToken = jwtTokenSign({
      inner: {
        state: stateValue,
        mode,
        provider: oauthProvider,
        timestamp: Date.now(),
      },
      expired: "10m",
    });

    // 获取授权 URL
    const { url, codeVerifier } = await getAuthorizationUrl(
      oauthProvider,
      stateValue,
    );

    // 根据模式使用不同的 cookie 前缀
    let cookiePrefix = "oauth";
    if (mode === "bind") {
      cookiePrefix = "oauth_bind";
    } else if (mode === "reauth") {
      cookiePrefix = "oauth_reauth";
    }

    // 将 JWT state token 和 codeVerifier（如果有）存储到 cookie
    cookieStore.set(`${cookiePrefix}_state_${provider}`, stateToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600, // 10 分钟
      path: "/",
      priority: "high",
    });

    if (codeVerifier) {
      cookieStore.set(`${cookiePrefix}_verifier_${provider}`, codeVerifier, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 600, // 10 分钟
        path: "/",
        priority: "high",
      });
    }

    // 存储重定向目标（验证必须为相对路径，防止开放重定向）
    if (
      redirect_to &&
      redirect_to.startsWith("/") &&
      !redirect_to.startsWith("//")
    ) {
      cookieStore.set(`${cookiePrefix}_redirect_to`, redirect_to, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 600, // 10 分钟
        path: "/",
        priority: "high",
      });
    }

    // 存储模式标识
    cookieStore.set(`oauth_mode_${provider}`, mode, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600, // 10 分钟
      path: "/",
      priority: "high",
    });

    // 重定向到 OAuth 提供商
    return NextResponse.redirect(url);
  } catch (error) {
    console.error("SSO login error:", error);
    const redirectUrl = mode === "bind" ? "/settings" : "/login";
    return NextResponse.redirect(
      resolveOAuthRedirectUrl(
        `${redirectUrl}?error=${encodeURIComponent(error instanceof Error ? error.message : "登录失败")}`,
        siteUrl,
      ),
    );
  }
}
