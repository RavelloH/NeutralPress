// @vitest-environment node
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/public/admin/pages/block-data/route";
import { fetchBlockData } from "@/lib/server/services/page-domain";

vi.mock("@/lib/server/services/page-domain", () => ({
  fetchBlockData: vi.fn(),
}));
const mocked = vi.mocked(fetchBlockData);
const url = "https://example.com/api/public/admin/pages/block-data";
const block = { id: "block-1", block: "markdown", content: "Hello" };

function request(
  body: unknown = { block },
  headers: Record<string, string> = {},
) {
  return new NextRequest(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("POST /api/public/admin/pages/block-data", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.mockResolvedValue(NextResponse.json({ success: true }) as never);
  });

  it("does not allow cross-origin POSTs with cookies", async () => {
    for (const headers of [
      { origin: "https://evil.example" },
      { "sec-fetch-site": "cross-site" },
    ] as Array<Record<string, string>>) {
      const response = await POST(request({ block }, headers));
      expect(response.status).toBe(403);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(mocked).not.toHaveBeenCalled();
  });

  it("rejects tokens, malformed blocks and missing JSON headers", async () => {
    for (const bad of [
      { block, access_token: "do-not-log" },
      { block: { id: "1", content: "x" } },
      { block: { block: "markdown", content: "x" } },
    ]) {
      const response = await POST(request(bad));
      expect(response.status).toBe(400);
    }
    expect(
      (await POST(request({ block }, { "Content-Type": "text/plain" }))).status,
    ).toBe(400);
    expect(
      (await POST(request({ block }, { "Content-Length": String(150000) })))
        .status,
    ).toBe(413);
    expect(mocked).not.toHaveBeenCalled();
  });

  it("calls the admin-protected service without accepting a browser-provided token", async () => {
    mocked.mockResolvedValueOnce(
      NextResponse.json({ success: true, data: { block: {} } }) as never,
    );
    const response = await POST(
      request({ block }, { origin: "https://example.com" }),
    );
    expect(mocked).toHaveBeenCalledWith(
      { access_token: "", block },
      { environment: "serverless" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("preserves ADMIN authentication failures", async () => {
    mocked.mockResolvedValueOnce(
      NextResponse.json({ success: false }, { status: 401 }) as never,
    );
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
