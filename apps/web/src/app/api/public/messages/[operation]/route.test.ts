import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/public/messages/[operation]/route";
import * as service from "@/lib/server/services/message-domain";

vi.mock("@/lib/server/services/message-domain", () => ({
  getConversations: vi.fn(),
  getConversationMessages: vi.fn(),
  searchUsers: vi.fn(),
  checkMessagePermission: vi.fn(),
}));

function request(operation: string, input?: unknown, extra = "") {
  const url = new URL("https://example.com/api/public/messages/" + operation);
  if (input !== undefined)
    url.searchParams.set("params", JSON.stringify(input));
  return new NextRequest(url.toString() + extra);
}
const context = (operation: string) => ({
  params: Promise.resolve({ operation }),
});

describe("GET /api/public/messages/[operation]", () => {
  beforeEach(() => vi.clearAllMocks());
  it("rejects unknown methods, malformed queries, credential injection and duplicate params", async () => {
    expect((await GET(request("delete"), context("delete"))).status).toBe(400);
    const op = "conversations";
    const malformed = new NextRequest(
      "https://example.com/api/public/messages/" + op + "?params=%7Bbroken",
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
    expect(service.getConversations).not.toHaveBeenCalled();
    expect(service.getConversationMessages).not.toHaveBeenCalled();
    expect(service.searchUsers).not.toHaveBeenCalled();
    expect(service.checkMessagePermission).not.toHaveBeenCalled();
  });
  it("preserves an authorization failure and prohibits shared caches", async () => {
    vi.mocked(service.getConversations).mockResolvedValueOnce(
      NextResponse.json({ success: false }, { status: 403 }) as never,
    );
    const response = await GET(
      request("conversations", { skip: 0, take: 20 }),
      context("conversations"),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("dispatches conversations directly to the protected server-only getConversations service", async () => {
    vi.mocked(service.getConversations).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: {} }) as never,
    );
    const response = await GET(
      request("conversations", { skip: 0, take: 20 }),
      context("conversations"),
    );
    expect(vi.mocked(service.getConversations).mock.calls[0]).toEqual([
      undefined,
      0,
      20,
      { environment: "serverless" },
    ]);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("dispatches thread directly to the protected server-only getConversationMessages service", async () => {
    vi.mocked(service.getConversationMessages).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: {} }) as never,
    );
    const response = await GET(
      request("thread", {
        conversationId: "00000000-0000-4000-8000-000000000001",
        skip: 0,
        take: 25,
      }),
      context("thread"),
    );
    expect(vi.mocked(service.getConversationMessages).mock.calls[0]).toEqual([
      "00000000-0000-4000-8000-000000000001",
      0,
      25,
      { environment: "serverless" },
    ]);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("dispatches users directly to the protected server-only searchUsers service", async () => {
    vi.mocked(service.searchUsers).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: {} }) as never,
    );
    const response = await GET(
      request("users", { query: "test" }),
      context("users"),
    );
    expect(vi.mocked(service.searchUsers).mock.calls[0]).toEqual([
      "test",
      { environment: "serverless" },
    ]);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("dispatches permission directly to the protected server-only checkMessagePermission service", async () => {
    vi.mocked(service.checkMessagePermission).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: {} }) as never,
    );
    const response = await GET(
      request("permission", { targetUid: 42 }),
      context("permission"),
    );
    expect(vi.mocked(service.checkMessagePermission).mock.calls[0]).toEqual([
      42,
      { environment: "serverless" },
    ]);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("rejects invalid timestamps and malformed private conversation ids", async () => {
    expect(
      (
        await GET(
          request("conversations", {
            lastPolledAt: "nonsense",
            skip: 0,
            take: 20,
          }),
          context("conversations"),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await GET(
          request("thread", { conversationId: "bad", skip: 0, take: 25 }),
          context("thread"),
        )
      ).status,
    ).toBe(400);
    expect(
      (await GET(request("users", { query: "" }), context("users"))).status,
    ).toBe(400);
    expect(
      (
        await GET(
          request("permission", { targetUid: -2 }),
          context("permission"),
        )
      ).status,
    ).toBe(400);
  });
  it("rejects fractional pagination for private conversations", async () => {
    expect(
      (
        await GET(
          request("conversations", { skip: 0.5, take: 20 }),
          context("conversations"),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await GET(
          request("thread", {
            conversationId: "00000000-0000-4000-8000-000000000001",
            skip: 0,
            take: 2.5,
          }),
          context("thread"),
        )
      ).status,
    ).toBe(400);
    expect(service.getConversations).not.toHaveBeenCalled();
    expect(service.getConversationMessages).not.toHaveBeenCalled();
  });
});
