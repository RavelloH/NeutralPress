// @vitest-environment node
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/public/admin/search/[operation]/route";
import * as service from "@/lib/server/services/search-admin-domain";

vi.mock("@/lib/server/services/search-admin-domain", () => ({
  getCustomWords: vi.fn(),
  getIndexStatus: vi.fn(),
  getPostTokenDetails: vi.fn(),
  getSearchLogs: vi.fn(),
}));

const ctx = (operation: string) => ({ params: Promise.resolve({ operation }) });
function request(
  operation: string,
  body: unknown = {},
  headers: Record<string, string> = {},
  query = "",
) {
  return new NextRequest(
    "https://example.com/api/public/admin/search/" + operation + query,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    },
  );
}
describe("Admin search management native JSON POST", () => {
  beforeEach(() => vi.clearAllMocks());

  it("blocks all mutating operations and unknown query-string credentials", async () => {
    for (const op of [
      "indexPosts",
      "deleteIndex",
      "addCustomWord",
      "deleteCustomWord",
      "testTokenize",
    ]) {
      expect((await POST(request(op), ctx(op))).status).toBe(400);
    }
    expect(
      (
        await POST(
          request("words", {}, {}, "?access_token=secret"),
          ctx("words"),
        )
      ).status,
    ).toBe(400);
    expect(service.getCustomWords).not.toHaveBeenCalled();
  });

  it("enforces same-origin access, strict schemas and bounded pagination", async () => {
    expect(
      (await POST(request("words", { access_token: "secret" }), ctx("words")))
        .status,
    ).toBe(400);
    expect(
      (await POST(request("words", { extra: "bad" }), ctx("words"))).status,
    ).toBe(400);
    expect(
      (
        await POST(
          request("index-status", { pageSize: 501 }),
          ctx("index-status"),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          request("index-status", { page: 10001 }),
          ctx("index-status"),
        )
      ).status,
    ).toBe(400);
    expect(
      (await POST(request("tokens", { slug: "x".repeat(513) }), ctx("tokens")))
        .status,
    ).toBe(400);
    expect(
      (await POST(request("logs", { query: "x".repeat(301) }), ctx("logs")))
        .status,
    ).toBe(400);
    expect(
      (
        await POST(
          request("logs", {}, { origin: "https://attacker.example" }),
          ctx("logs"),
        )
      ).status,
    ).toBe(403);
    expect(service.getSearchLogs).not.toHaveBeenCalled();
  });

  it("routes custom words and index status only to existing ADMIN/EDITOR services", async () => {
    vi.mocked(service.getCustomWords).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: [] }) as never,
    );
    vi.mocked(service.getIndexStatus).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: [] }) as never,
    );
    const words = await POST(request("words", {}), ctx("words"));
    const index = await POST(
      request("index-status", { page: 2, pageSize: 25 }),
      ctx("index-status"),
    );
    expect(words.status).toBe(200);
    expect(index.status).toBe(200);
    expect(words.headers.get("cache-control")).toBe("private, no-store");
    expect(index.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    );
    expect(service.getCustomWords).toHaveBeenCalledWith(
      {},
      { environment: "serverless" },
    );
    expect(service.getIndexStatus).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2, pageSize: 25 }),
      { environment: "serverless" },
    );
  });

  it("keeps private post slugs and search terms in JSON bodies instead of URLs", async () => {
    vi.mocked(service.getPostTokenDetails).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: {} }) as never,
    );
    vi.mocked(service.getSearchLogs).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: [] }) as never,
    );
    const tokensRequest = request("tokens", { slug: "draft-private-post" });
    const logsRequest = request("logs", { query: "private search term" });
    expect(tokensRequest.nextUrl.href).not.toContain("draft-private-post");
    expect(logsRequest.nextUrl.href).not.toContain("private search term");
    expect((await POST(tokensRequest, ctx("tokens"))).status).toBe(200);
    expect((await POST(logsRequest, ctx("logs"))).status).toBe(200);
    expect(service.getPostTokenDetails).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "draft-private-post" }),
      { environment: "serverless" },
    );
    expect(service.getSearchLogs).toHaveBeenCalledWith(
      expect.objectContaining({ query: "private search term" }),
      { environment: "serverless" },
    );
  });

  it("preserves protected service authorization failures and rate limits", async () => {
    vi.mocked(service.getSearchLogs).mockResolvedValueOnce(
      NextResponse.json({ success: false }, { status: 401 }) as never,
    );
    const denied = await POST(request("logs", {}), ctx("logs"));
    expect(denied.status).toBe(401);
    expect(denied.headers.get("cache-control")).toBe("private, no-store");
    vi.mocked(service.getIndexStatus).mockResolvedValueOnce(
      NextResponse.json({ success: false }, { status: 429 }) as never,
    );
    expect(
      (await POST(request("index-status", {}), ctx("index-status"))).status,
    ).toBe(429);
  });
});
