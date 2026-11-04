// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  limit: vi.fn(),
  read: vi.fn(),
  credentials: vi.fn(),
  save: vi.fn(),
  verify: vi.fn(),
}));
vi.mock("@/lib/server/auth-verify", () => ({ authVerify: mocks.auth }));
vi.mock("@/lib/server/rate-limit", () => ({ default: mocks.limit }));
vi.mock("@/lib/server/cloudflare-cache-config", () => ({
  getCloudflareCacheSettings: mocks.read,
  getCloudflareCacheCredentials: mocks.credentials,
  saveCloudflareCacheSettings: mocks.save,
  testCloudflareCacheCredentials: mocks.verify,
}));

import { GET, POST } from "@/app/api/public/admin/settings/cdn/route";

const ZONE = "763e43ff82498affce6fafc1648f69cb";
const TOKEN = "test-cloudflare-purge-token-123456789";
const SITE = "https://example.com";
function request(method: "GET" | "POST", body?: unknown, origin = SITE) {
  return new NextRequest(SITE + "/api/public/admin/settings/cdn", {
    method,
    headers: {
      origin: origin,
      "content-type": "application/json",
    },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
}

describe("Cloudflare CDN admin settings API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.limit.mockResolvedValue(true);
    mocks.auth.mockResolvedValue({ role: "ADMIN" });
    mocks.credentials.mockResolvedValue({
      zone: ZONE,
      token: TOKEN,
      siteUrl: SITE,
      source: "environment",
    });
    mocks.read.mockResolvedValue({
      zoneId: ZONE,
      siteUrl: SITE,
      tokenConfigured: true,
      source: "database",
    });
    mocks.verify.mockResolvedValue(true);
    mocks.save.mockResolvedValue(undefined);
  });

  it("does not reveal plaintext tokens in the admin GET response", async () => {
    const response = await GET(request("GET"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(JSON.stringify(await response.json())).not.toContain(TOKEN);
    expect(mocks.auth).toHaveBeenCalledWith({ allowedRoles: ["ADMIN"] });
  });

  it("does not expose config to anonymous or non-admin users", async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await GET(request("GET"));
    expect(response.status).toBe(401);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(
      (
        await POST(
          request("POST", { action: "save", zoneId: ZONE, siteUrl: SITE }),
        )
      ).status,
    ).toBe(401);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("rejects cross-origin requests and arbitrary/legacy fields", async () => {
    const settings = { action: "save", zoneId: ZONE, siteUrl: SITE };
    expect(
      (await POST(request("POST", settings, "https://attacker.example")))
        .status,
    ).toBe(403);
    expect(
      (await POST(request("POST", { ...settings, access_token: TOKEN })))
        .status,
    ).toBe(400);
    expect(
      (await POST(request("POST", { ...settings, debug: true }))).status,
    ).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("tests and saves a replacement token without echoing it", async () => {
    const result = await POST(
      request("POST", {
        action: "save",
        zoneId: ZONE,
        siteUrl: SITE,
        token: TOKEN,
      }),
    );
    expect(result.status).toBe(200);
    expect(mocks.verify).toHaveBeenCalledWith({
      zoneId: ZONE,
      siteUrl: SITE,
      token: TOKEN,
    });
    expect(mocks.save).toHaveBeenCalledWith({
      zoneId: ZONE,
      siteUrl: SITE,
      token: TOKEN,
    });
    expect(JSON.stringify(await result.json())).not.toContain(TOKEN);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
  });

  it("retains the existing credential when the token field is left blank", async () => {
    const result = await POST(
      request("POST", { action: "save", zoneId: ZONE, siteUrl: SITE }),
    );
    expect(result.status).toBe(200);
    expect(mocks.verify).toHaveBeenCalledWith({
      zoneId: ZONE,
      siteUrl: SITE,
      token: TOKEN,
    });
    expect(mocks.save).toHaveBeenCalledWith({
      zoneId: ZONE,
      siteUrl: SITE,
      token: undefined,
    });
  });

  it("does not write invalid or unverified credentials", async () => {
    mocks.verify.mockResolvedValue(false);
    const response = await POST(
      request("POST", {
        action: "save",
        zoneId: ZONE,
        siteUrl: SITE,
        token: TOKEN,
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
