import { describe, expect, it } from "vitest";

import { resolveOAuthRedirectUrl } from "@/lib/server/oauth-redirect";

describe("resolveOAuthRedirectUrl", () => {
  it("使用 site.url 作为浏览器跳转地址，而不是反向代理的 localhost", () => {
    expect(
      resolveOAuthRedirectUrl("/login?sso=success", "https://ravelloh.com")
        .href,
    ).toBe("https://ravelloh.com/login?sso=success");
  });

  it("支持不同模式的站内跳转，且不受 site.url 尾部斜杠影响", () => {
    expect(
      resolveOAuthRedirectUrl("/reauth?success=ok", "https://blog.example.com/")
        .href,
    ).toBe("https://blog.example.com/reauth?success=ok");
    expect(
      resolveOAuthRedirectUrl(
        "/settings?error=failed",
        "https://blog.example.com/blog",
      ).href,
    ).toBe("https://blog.example.com/settings?error=failed");
  });

  it.each([
    "https://evil.example/login",
    "//evil.example",
    "/\\evil.example",
    "login",
    "/login\r\nLocation: https://evil.example",
  ])("拒绝不安全的跳转目标 %s", (target) => {
    expect(() =>
      resolveOAuthRedirectUrl(target, "https://ravelloh.com"),
    ).toThrow();
  });

  it("拒绝非 HTTP(S) 的站点配置", () => {
    expect(() =>
      resolveOAuthRedirectUrl("/login", "javascript:alert(1)"),
    ).toThrow();
  });

  it("保留本地开发时显式配置的本地站点地址", () => {
    expect(
      resolveOAuthRedirectUrl("/login", "http://localhost:3000").href,
    ).toBe("http://localhost:3000/login");
  });
});
