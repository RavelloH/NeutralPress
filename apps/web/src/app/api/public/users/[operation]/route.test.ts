import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/public/users/[operation]/route";
import { authVerify } from "@/lib/server/auth-verify";
import * as service from "@/lib/server/services/user-domain";

vi.mock("@/lib/server/auth-verify", () => ({ authVerify: vi.fn() }));
vi.mock("@/lib/server/services/user-domain", () => ({
  getUserProfile: vi.fn(),
  getUserPublicProfile: vi.fn(),
  getUserActivity: vi.fn(),
}));

function request(operation: string, input?: unknown, extra = "") {
  const url = new URL("https://example.com/api/public/users/" + operation);
  if (input !== undefined)
    url.searchParams.set("params", JSON.stringify(input));
  return new NextRequest(url.toString() + extra);
}
const context = (operation: string) => ({
  params: Promise.resolve({ operation }),
});

describe("GET /api/public/users/[operation]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authVerify).mockResolvedValue(null);
  });
  it("rejects unknown methods, malformed queries, credential injection and duplicate params", async () => {
    expect((await GET(request("delete"), context("delete"))).status).toBe(400);
    const op = "self";
    const malformed = new NextRequest(
      "https://example.com/api/public/users/" + op + "?params=%7Bbroken",
    );
    expect((await GET(malformed, context(op))).status).toBe(400);
    expect(
      (await GET(request(op, { access_token: "secret" }), context(op))).status,
    ).toBe(400);
    expect(
      (await GET(request(op, {}, "&access_token=secret"), context(op))).status,
    ).toBe(400);
    expect(
      (await GET(request(op, {}, "&params=%7B%7D"), context(op))).status,
    ).toBe(400);
    expect(
      (await GET(request(op, { injected: "x".repeat(9000) }), context(op)))
        .status,
    ).toBe(400);
    expect(service.getUserProfile).not.toHaveBeenCalled();
    expect(service.getUserPublicProfile).not.toHaveBeenCalled();
    expect(service.getUserActivity).not.toHaveBeenCalled();
  });
  it("preserves an authorization failure and prohibits shared caches", async () => {
    vi.mocked(service.getUserProfile).mockResolvedValueOnce(
      NextResponse.json({ success: false }, { status: 403 }) as never,
    );
    const response = await GET(request("self", {}), context("self"));
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("dispatches self directly to the protected server-only getUserProfile service", async () => {
    vi.mocked(service.getUserProfile).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: {} }) as never,
    );
    const response = await GET(request("self", {}), context("self"));
    expect(vi.mocked(service.getUserProfile).mock.calls[0]).toEqual([
      { environment: "serverless" },
    ]);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("dispatches profile directly to the protected server-only getUserPublicProfile service", async () => {
    vi.mocked(service.getUserPublicProfile).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: {} }) as never,
    );
    const response = await GET(
      request("profile", { uid: 42 }),
      context("profile"),
    );
    expect(vi.mocked(service.getUserPublicProfile).mock.calls[0]).toEqual([
      42,
      { environment: "serverless" },
    ]);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("dispatches activity directly to the protected server-only getUserActivity service", async () => {
    vi.mocked(service.getUserActivity).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: {} }) as never,
    );
    const response = await GET(
      request("activity", { uid: 42, offset: 0, limit: 20 }),
      context("activity"),
    );
    expect(vi.mocked(service.getUserActivity).mock.calls[0]).toEqual([
      42,
      0,
      20,
      true,
      { environment: "serverless" },
    ]);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("derives activity guest restrictions from server authentication, not client data", async () => {
    vi.mocked(authVerify).mockResolvedValueOnce({
      uid: 100,
      role: "USER",
    } as never);
    vi.mocked(service.getUserActivity).mockResolvedValueOnce(
      NextResponse.json({ success: true }) as never,
    );
    const response = await GET(
      request("activity", { uid: 42, offset: 0, limit: 20 }),
      context("activity"),
    );
    expect(service.getUserActivity).toHaveBeenCalledWith(42, 0, 20, false, {
      environment: "serverless",
    });
    expect(response.status).toBe(200);
    expect(
      (
        await GET(
          request("activity", { uid: 42, isGuest: false }),
          context("activity"),
        )
      ).status,
    ).toBe(400);
  });
});
