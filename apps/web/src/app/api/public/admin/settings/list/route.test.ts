// @vitest-environment node
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/public/admin/settings/list/route";
import { getSettings } from "@/lib/server/services/settings-read-domain";

vi.mock("@/lib/server/services/settings-read-domain", () => ({
  getSettings: vi.fn(),
}));
function request(body: unknown = {}, headers: Record<string, string> = {}) {
  return new NextRequest("https://example.com/api/public/admin/settings/list", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
describe("ADMIN full config list JSON POST", () => {
  beforeEach(() => vi.clearAllMocks());

  it("never accepts access tokens, filter fields, or cross-origin browser requests", async () => {
    expect((await POST(request({ access_token: "secret" }))).status).toBe(400);
    expect((await POST(request({ key: "site.jwtSecret" }))).status).toBe(400);
    expect(
      (await POST(request({}, { origin: "https://attacker.example" }))).status,
    ).toBe(403);
    expect(
      (await POST(request({}, { "sec-fetch-site": "cross-site" }))).status,
    ).toBe(403);
    expect(getSettings).not.toHaveBeenCalled();
  });

  it("keeps all configuration values private and requires ADMIN service validation", async () => {
    vi.mocked(getSettings).mockResolvedValueOnce(
      NextResponse.json({
        success: true,
        data: [{ key: "site.url", value: "https://example.com" }],
      }) as never,
    );
    const response = await POST(request({}, { origin: "https://example.com" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    );
    expect(getSettings).toHaveBeenCalledWith({}, { environment: "serverless" });
  });

  it("preserves unauthorized and rate-limit status codes", async () => {
    vi.mocked(getSettings).mockResolvedValueOnce(
      NextResponse.json({ success: false }, { status: 401 }) as never,
    );
    expect((await POST(request())).status).toBe(401);
    vi.mocked(getSettings).mockResolvedValueOnce(
      NextResponse.json({ success: false }, { status: 429 }) as never,
    );
    expect((await POST(request())).status).toBe(429);
  });
});
