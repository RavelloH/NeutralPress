// @vitest-environment node
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/public/admin/cron/config/route";
import { getCronConfig } from "@/lib/server/services/cron-domain";

vi.mock("@/lib/server/services/cron-domain", () => ({
  getCronConfig: vi.fn(),
}));
const request = (query = "") =>
  new NextRequest("https://example.com/api/public/admin/cron/config" + query);

describe("ADMIN Cron config GET", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects arbitrary params, access tokens, and mutating query flags", async () => {
    for (const query of ["?access_token=secret", "?trigger=true", "?uid=1"]) {
      expect((await GET(request(query))).status).toBe(400);
    }
    expect(getCronConfig).not.toHaveBeenCalled();
  });

  it("preserves service ADMIN authorization and private cache semantics", async () => {
    vi.mocked(getCronConfig).mockResolvedValueOnce(
      NextResponse.json({ success: false }, { status: 401 }) as never,
    );
    const denied = await GET(request());
    expect(denied.status).toBe(401);
    expect(denied.headers.get("cache-control")).toBe("private, no-store");
    expect(getCronConfig).toHaveBeenCalledWith(
      {},
      { environment: "serverless" },
    );
  });

  it("preserves rate limits, no-store and strict content headers", async () => {
    vi.mocked(getCronConfig).mockResolvedValueOnce(
      NextResponse.json({ success: false }, { status: 429 }) as never,
    );
    expect((await GET(request())).status).toBe(429);
    vi.mocked(getCronConfig).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: { enabled: true } }) as never,
    );
    const result = await GET(request());
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(result.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
