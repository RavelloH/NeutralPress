// @vitest-environment node
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/public/admin/backups/scopes/route";
import { getBackupScopes } from "@/lib/server/services/backup-scopes-domain";

vi.mock("@/lib/server/services/backup-scopes-domain", () => ({
  getBackupScopes: vi.fn(),
}));

function request(query = "") {
  return new NextRequest(
    "https://example.com/api/public/admin/backups/scopes" + query,
  );
}

describe("Backup scopes restricted GET", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects tokens and unknown query parameters before calling the server service", async () => {
    expect((await GET(request("?access_token=secret"))).status).toBe(400);
    expect((await GET(request("?scope=CORE_BASE"))).status).toBe(400);
    expect(getBackupScopes).not.toHaveBeenCalled();
  });

  it("passes the caller's Cookie through the server-side ADMIN check", async () => {
    vi.mocked(getBackupScopes).mockResolvedValueOnce(
      NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED" } },
        { status: 401 },
      ) as never,
    );
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(getBackupScopes).toHaveBeenCalledWith(
      {},
      { environment: "serverless" },
    );
  });

  it("keeps service rate limiting and private no-store headers", async () => {
    vi.mocked(getBackupScopes).mockResolvedValueOnce(
      NextResponse.json(
        { success: false, error: { code: "TOO_MANY_REQUESTS" } },
        { status: 429 },
      ) as never,
    );
    const response = await GET(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("returns the catalog without granting access to any backup mutation", async () => {
    vi.mocked(getBackupScopes).mockResolvedValueOnce(
      NextResponse.json({
        success: true,
        data: [{ scope: "CONTENT", label: "内容", dependsOn: [] }],
      }) as never,
    );
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ success: true });
  });
});
