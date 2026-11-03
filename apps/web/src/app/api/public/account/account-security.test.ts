// @vitest-environment node
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET as getTotpStatus } from "@/app/api/public/account/security/totp-status/route";
import { GET as getSessions } from "@/app/api/public/account/sessions/route";
import * as sessionsService from "@/lib/server/services/session-domain";
import * as totpService from "@/lib/server/services/totp-status-domain";

vi.mock("@/lib/server/services/session-domain", () => ({
  getSessions: vi.fn(),
}));
vi.mock("@/lib/server/services/totp-status-domain", () => ({
  getTotpStatus: vi.fn(),
}));

function request(path: string) {
  return new NextRequest("https://example.com" + path);
}

describe("account security read APIs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns current-user sessions through cookie authentication only", async () => {
    vi.mocked(sessionsService.getSessions).mockResolvedValueOnce(
      NextResponse.json(
        { success: true, data: { sessions: [] } },
        { headers: { "Cache-Control": "no-store" } },
      ) as never,
    );
    const response = await getSessions(request("/api/public/account/sessions"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(sessionsService.getSessions).toHaveBeenCalledWith({
      environment: "serverless",
    });
  });

  it("rejects session URL tokens and all other query parameters", async () => {
    expect(
      (
        await getSessions(
          request("/api/public/account/sessions?access_token=secret"),
        )
      ).status,
    ).toBe(400);
    expect(
      (await getSessions(request("/api/public/account/sessions?uid=123")))
        .status,
    ).toBe(400);
    expect(sessionsService.getSessions).not.toHaveBeenCalled();
  });

  it("preserves the session service's unauthenticated status", async () => {
    vi.mocked(sessionsService.getSessions).mockResolvedValueOnce(
      NextResponse.json(
        { success: false },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      ) as never,
    );
    expect(
      (await getSessions(request("/api/public/account/sessions"))).status,
    ).toBe(401);
  });

  it("returns TOTP status without exposing secret or backup-code contents", async () => {
    vi.mocked(totpService.getTotpStatus).mockResolvedValueOnce(
      NextResponse.json(
        { success: true, data: { enabled: true, backupCodesRemaining: 4 } },
        { headers: { "Cache-Control": "no-store" } },
      ) as never,
    );
    const response = await getTotpStatus(
      request("/api/public/account/security/totp-status"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(totpService.getTotpStatus).toHaveBeenCalledWith({
      environment: "serverless",
    });
  });

  it("rejects TOTP query parameters and preserves unauthenticated status", async () => {
    expect(
      (
        await getTotpStatus(
          request(
            "/api/public/account/security/totp-status?access_token=secret",
          ),
        )
      ).status,
    ).toBe(400);
    expect(totpService.getTotpStatus).not.toHaveBeenCalled();
    vi.mocked(totpService.getTotpStatus).mockResolvedValueOnce(
      NextResponse.json(
        { success: false },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      ) as never,
    );
    expect(
      (await getTotpStatus(request("/api/public/account/security/totp-status")))
        .status,
    ).toBe(401);
  });
});
