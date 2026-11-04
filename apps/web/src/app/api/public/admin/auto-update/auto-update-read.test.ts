// @vitest-environment node
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST as overviewPost } from "@/app/api/public/admin/auto-update/overview/route";
import { GET as runtimeGet } from "@/app/api/public/admin/auto-update/runtime/route";
import * as service from "@/lib/server/services/auto-update-domain";

vi.mock("@/lib/server/services/auto-update-domain", () => ({
  getAutoUpdateOverview: vi.fn(),
  getRuntimeVersionInfo: vi.fn(),
}));
function post(body: unknown = {}, headers: Record<string, string> = {}) {
  return new NextRequest(
    "https://example.com/api/public/admin/auto-update/overview",
    {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    },
  );
}
const runtimeRequest = (q = "") =>
  new NextRequest(
    "https://example.com/api/public/admin/auto-update/runtime" + q,
  );

describe("Auto Update private ADMIN reads", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects PAT fields, access tokens and cross-origin POST before any service call", async () => {
    expect((await overviewPost(post({ access_token: "secret" }))).status).toBe(
      400,
    );
    expect((await overviewPost(post({ pat: "secret" }))).status).toBe(400);
    expect(
      (await overviewPost(post({}, { origin: "https://evil.example" }))).status,
    ).toBe(403);
    expect(
      (await overviewPost(post({}, { "sec-fetch-site": "cross-site" }))).status,
    ).toBe(403);
    expect(service.getAutoUpdateOverview).not.toHaveBeenCalled();
  });

  it("keeps the original ADMIN overview private and uncached despite containing config", async () => {
    vi.mocked(service.getAutoUpdateOverview).mockResolvedValueOnce(
      NextResponse.json({
        success: true,
        data: { config: { mode: "REPOSITORY" } },
      }) as never,
    );
    const response = await overviewPost(
      post({}, { origin: "https://example.com" }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    );
    expect(service.getAutoUpdateOverview).toHaveBeenCalledWith(
      {},
      { environment: "serverless" },
    );
  });

  it("preserves unauthorized, rate-limited and failed overview status codes", async () => {
    for (const code of [401, 429, 500]) {
      vi.mocked(service.getAutoUpdateOverview).mockResolvedValueOnce(
        NextResponse.json({ success: false }, { status: code }) as never,
      );
      const result = await overviewPost(post());
      expect(result.status).toBe(code);
      expect(result.headers.get("cache-control")).toBe("private, no-store");
    }
  });

  it("rejects all runtime GET parameters including credentials", async () => {
    for (const q of ["?access_token=secret", "?uid=1", "?mode=REPOSITORY"]) {
      expect((await runtimeGet(runtimeRequest(q))).status).toBe(400);
    }
    expect(service.getRuntimeVersionInfo).not.toHaveBeenCalled();
  });

  it("retains ADMIN runtime GET and no-store semantics", async () => {
    vi.mocked(service.getRuntimeVersionInfo).mockResolvedValueOnce(
      NextResponse.json({
        success: true,
        data: { appVersion: "5.1.2" },
      }) as never,
    );
    const response = await runtimeGet(runtimeRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(service.getRuntimeVersionInfo).toHaveBeenCalledWith(
      {},
      { environment: "serverless" },
    );
  });
});
