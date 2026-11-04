// @vitest-environment node
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/public/account/notifications/[operation]/route";
import * as service from "@/lib/server/services/notice-domain";

vi.mock("@/lib/server/services/notice-domain", () => ({
  markNoticesAsRead: vi.fn(),
  markAllNoticesAsRead: vi.fn(),
}));

const context = (operation: string) => ({
  params: Promise.resolve({ operation }),
});
function request(
  operation: string,
  body: unknown = {},
  headers: Record<string, string> = {},
  query = "",
) {
  return new NextRequest(
    "https://example.com/api/public/account/notifications/" + operation + query,
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", ...headers },
    },
  );
}
describe("current-user notification JSON mutation API", () => {
  beforeEach(() => vi.clearAllMocks());

  it("never permits mutations through arbitrary operation names or input URL credentials", async () => {
    expect((await POST(request("delete", {}), context("delete"))).status).toBe(
      400,
    );
    expect(
      (
        await POST(
          request("mark", { noticeIds: ["id"] }, {}, "?access_token=x"),
          context("mark"),
        )
      ).status,
    ).toBe(400);
    expect(service.markNoticesAsRead).not.toHaveBeenCalled();
  });

  it("rejects CSRF, unknown fields, spoofed UID and oversized ID batches", async () => {
    expect(
      (
        await POST(
          request(
            "mark",
            { noticeIds: ["n1"] },
            { origin: "https://evil.example" },
          ),
          context("mark"),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await POST(
          request("mark", { noticeIds: ["n1"], uid: 2 }),
          context("mark"),
        )
      ).status,
    ).toBe(400);
    expect(
      (await POST(request("mark", { noticeIds: [] }), context("mark"))).status,
    ).toBe(400);
    expect(
      (
        await POST(
          request("mark", { noticeIds: Array(101).fill("n1") }),
          context("mark"),
        )
      ).status,
    ).toBe(400);
    expect(
      (await POST(request("mark-all", { uid: 2 }), context("mark-all"))).status,
    ).toBe(400);
    expect(service.markNoticesAsRead).not.toHaveBeenCalled();
    expect(service.markAllNoticesAsRead).not.toHaveBeenCalled();
  });

  it("delegates user-locked marking and preserves HTTP statuses and private headers", async () => {
    vi.mocked(service.markNoticesAsRead).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: { message: "ok" } }) as never,
    );
    const response = await POST(
      request("mark", { noticeIds: ["n1"] }, { origin: "https://example.com" }),
      context("mark"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(service.markNoticesAsRead).toHaveBeenCalledWith(["n1"], {
      environment: "serverless",
    });
    vi.mocked(service.markAllNoticesAsRead).mockResolvedValueOnce(
      NextResponse.json({ success: false }, { status: 401 }) as never,
    );
    expect(
      (await POST(request("mark-all", {}), context("mark-all"))).status,
    ).toBe(401);
  });

  it("permits mark-all only with an empty body and no shared caching", async () => {
    vi.mocked(service.markAllNoticesAsRead).mockResolvedValueOnce(
      NextResponse.json({ success: true }) as never,
    );
    const response = await POST(request("mark-all", {}), context("mark-all"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(service.markAllNoticesAsRead).toHaveBeenCalledWith({
      environment: "serverless",
    });
  });
});
