import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET as callbackGET } from "@/app/(account)/sso/[provider]/callback/route";
import { GET as loginGET } from "@/app/(account)/sso/[provider]/login/route";

const { mockGetConfig, mockCookieSet } = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
  mockCookieSet: vi.fn(),
}));

vi.mock("@/lib/server/config-cache", () => ({
  getConfig: mockGetConfig,
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn(() => undefined),
    set: mockCookieSet,
  })),
  headers: vi.fn(async () => new Headers()),
}));

vi.mock("@/lib/server/rate-limit", () => ({
  default: vi.fn(async () => true),
}));

vi.mock("@/actions/sso", () => ({
  handleSSOBind: vi.fn(),
  handleSSOCallback: vi.fn(),
}));

vi.mock("@/lib/server/jwt", () => ({
  jwtTokenVerify: vi.fn(),
  jwtTokenSign: vi.fn(),
}));

describe("SSO 跳转使用已配置的公网域名", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig.mockResolvedValue("https://ravelloh.com");
  });

  it("回调发生授权错误时不跳转到内部 localhost 地址", async () => {
    const response = await callbackGET(
      new NextRequest(
        "https://localhost:3000/sso/github/callback?error=access_denied",
      ),
      { params: Promise.resolve({ provider: "github" }) },
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://ravelloh.com/login?sso=error",
    );
    expect(mockCookieSet).toHaveBeenCalled();
  });

  it("缺少授权参数时同样使用公网域名", async () => {
    const response = await callbackGET(
      new NextRequest("http://127.0.0.1:3000/sso/google/callback"),
      { params: Promise.resolve({ provider: "google" }) },
    );

    expect(response.headers.get("location")).toBe(
      "https://ravelloh.com/login?sso=error",
    );
  });

  it("登录入口拒绝无效提供商时使用公网域名", async () => {
    const response = await loginGET(
      new NextRequest("http://localhost:3000/sso/unknown/login"),
      { params: Promise.resolve({ provider: "unknown" }) },
    );

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).origin).toBe(
      "https://ravelloh.com",
    );
  });

  it("绑定模式未登录时跳转到公网登录页", async () => {
    const response = await loginGET(
      new NextRequest("http://localhost:3000/sso/github/login?mode=bind"),
      { params: Promise.resolve({ provider: "github" }) },
    );

    expect(new URL(response.headers.get("location")!).origin).toBe(
      "https://ravelloh.com",
    );
  });
});
