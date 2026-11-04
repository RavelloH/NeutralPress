// @vitest-environment node
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/public/admin/system/info/route";
import { getSystemInfo } from "@/lib/server/services/system-domain";

vi.mock("@/lib/server/services/system-domain", () => ({
  getSystemInfo: vi.fn(),
}));
const request = (query = "") =>
  new NextRequest("https://example.com/api/public/admin/system/info" + query);

describe("ADMIN system monitor GET", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not accept an access token, UID or any query parameter", async () => {
    for (const query of ["?access_token=secret", "?uid=2", "?debug=1"]) {
      expect((await GET(request(query))).status).toBe(400);
    }
    expect(getSystemInfo).not.toHaveBeenCalled();
  });

  it("keeps sensitive host/IP/CPU telemetry private", async () => {
    vi.mocked(getSystemInfo).mockResolvedValueOnce(
      NextResponse.json({
        success: true,
        data: { os: { hostname: "private-host" } },
      }) as never,
    );
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    );
    expect(getSystemInfo).toHaveBeenCalledWith(
      {},
      { environment: "serverless" },
    );
  });

  it("preserves 401 and 429 from existing ADMIN authorization and rate limit", async () => {
    vi.mocked(getSystemInfo).mockResolvedValueOnce(
      NextResponse.json({ success: false }, { status: 401 }) as never,
    );
    expect((await GET(request())).status).toBe(401);
    vi.mocked(getSystemInfo).mockResolvedValueOnce(
      NextResponse.json({ success: false }, { status: 429 }) as never,
    );
    expect((await GET(request())).status).toBe(429);
  });
});
