import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/public/friends/[operation]/route";
import * as service from "@/lib/server/services/friendlink-domain";

vi.mock("@/lib/server/services/friendlink-domain", () => ({
  getOwnFriendLink: vi.fn(),
}));

function request(operation: string, input?: unknown, extra = "") {
  const url = new URL("https://example.com/api/public/friends/" + operation);
  if (input !== undefined)
    url.searchParams.set("params", JSON.stringify(input));
  return new NextRequest(url.toString() + extra);
}
const context = (operation: string) => ({
  params: Promise.resolve({ operation }),
});

describe("GET /api/public/friends/[operation]", () => {
  beforeEach(() => vi.clearAllMocks());
  it("rejects unknown methods, malformed queries, credential injection and duplicate params", async () => {
    expect((await GET(request("delete"), context("delete"))).status).toBe(400);
    const op = "own";
    const malformed = new NextRequest(
      "https://example.com/api/public/friends/" + op + "?params=%7Bbroken",
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
    expect(service.getOwnFriendLink).not.toHaveBeenCalled();
  });
  it("preserves an authorization failure and prohibits shared caches", async () => {
    vi.mocked(service.getOwnFriendLink).mockResolvedValueOnce(
      NextResponse.json({ success: false }, { status: 403 }) as never,
    );
    const response = await GET(request("own", {}), context("own"));
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("dispatches own directly to the protected server-only getOwnFriendLink service", async () => {
    vi.mocked(service.getOwnFriendLink).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: {} }) as never,
    );
    const response = await GET(request("own", {}), context("own"));
    expect(vi.mocked(service.getOwnFriendLink)).toHaveBeenCalledWith(
      expect.objectContaining({}),
      { environment: "serverless" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
