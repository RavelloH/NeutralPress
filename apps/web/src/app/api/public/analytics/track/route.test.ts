// @vitest-environment node
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/public/analytics/track/route";
import { trackPageView } from "@/lib/server/services/analytics-domain";

vi.mock("@/lib/server/services/analytics-domain", () => ({
  trackPageView: vi.fn(),
}));
const payload = { path: "/posts/test", visitorId: "visitor-test" };
function request(
  body: unknown = payload,
  headers: Record<string, string> = {},
) {
  return new NextRequest("https://example.com/api/public/analytics/track", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
describe("public analytics tracking JSON POST", () => {
  beforeEach(() => vi.clearAllMocks());
  it("rejects cross-site requests, URL credentials, oversize payloads and unknown fields", async () => {
    expect(
      (await POST(request(payload, { "sec-fetch-site": "cross-site" }))).status,
    ).toBe(403);
    expect(
      (await POST(request({ ...payload, access_token: "secret" }))).status,
    ).toBe(400);
    expect((await POST(request({ ...payload, extra: "bad" }))).status).toBe(
      400,
    );
    expect(
      (await POST(request({ ...payload, referer: "x".repeat(6000) }))).status,
    ).toBe(413);
    expect(trackPageView).not.toHaveBeenCalled();
  });
  it("uses rate-limited Redis-deduplication service, not Server Action", async () => {
    vi.mocked(trackPageView).mockResolvedValueOnce(
      NextResponse.json({ success: true }) as never,
    );
    const response = await POST(
      request(payload, { origin: "https://example.com" }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(trackPageView).toHaveBeenCalledWith(payload, {
      environment: "serverless",
    });
  });
  it.each([undefined, "1"])(
    "读取没有可靠 Content-Length 的超限流时立即停止（%s）",
    async (contentLength) => {
      let produced = 0;
      let canceled = false;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          produced += 1;
          controller.enqueue(new Uint8Array(1024));
          if (produced === 128) controller.close();
        },
        cancel() {
          canceled = true;
        },
      });
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (contentLength !== undefined) {
        headers["content-length"] = contentLength;
      }
      const response = await POST(
        new NextRequest("https://example.com/api/public/analytics/track", {
          method: "POST",
          headers,
          body,
        }),
      );

      expect(response.status).toBe(413);
      expect(canceled).toBe(true);
      expect(produced).toBeLessThan(128);
      expect(trackPageView).not.toHaveBeenCalled();
    },
  );
  it("preserves service rate limit status", async () => {
    vi.mocked(trackPageView).mockResolvedValueOnce(
      NextResponse.json({ success: false }, { status: 429 }) as never,
    );
    const response = await POST(request());
    expect(response.status).toBe(429);
  });
});
