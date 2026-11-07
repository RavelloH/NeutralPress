/**
 * OAuth 回调后的站内跳转地址。
 * 始终使用已配置的站点 URL，而非反向代理内部的 request.url。
 */
export function resolveOAuthRedirectUrl(target: string, siteUrl: string): URL {
  const configuredSiteUrl = new URL(siteUrl);
  if (
    configuredSiteUrl.protocol !== "http:" &&
    configuredSiteUrl.protocol !== "https:"
  ) {
    throw new Error("site.url 必须使用 HTTP 或 HTTPS 协议");
  }

  // 防止从 OAuth 跳转目标构造出跨站 URL，包括反斜杠和控制字符变体。
  const hasControlCharacters = Array.from(target).some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
  if (
    !target.startsWith("/") ||
    target.startsWith("//") ||
    target.includes("\\") ||
    hasControlCharacters
  ) {
    throw new Error("OAuth 跳转目标必须是站内绝对路径");
  }

  const redirectUrl = new URL(target, configuredSiteUrl.origin);
  if (redirectUrl.origin !== configuredSiteUrl.origin) {
    throw new Error("OAuth 跳转目标不允许跨站");
  }
  return redirectUrl;
}
