// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/public/account/security/passkeys/route";
import { listUserPasskeys } from "@/lib/server/services/passkey-read-domain";

vi.mock("@/lib/server/services/passkey-read-domain", () => ({
  listUserPasskeys: vi.fn(),
}));
const request = (query = "") =>
  new NextRequest(
    "https://example.com/api/public/account/security/passkeys" + query,
  );

describe("Passkey metadata read-only HTTP API", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects user IDs, credential IDs, access tokens, and unknown URL parameters", async () => {
    for (const q of [
      "?uid=1",
      "?credentialId=abc",
      "?access_token=secret",
      "?refresh=true",
    ]) {
      const result = await GET(request(q));
      expect(result.status).toBe(400);
      expect(result.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(listUserPasskeys).not.toHaveBeenCalled();
  });

  it("returns 401 rather than 200 when the service denies access", async () => {
    vi.mocked(listUserPasskeys).mockResolvedValueOnce({
      success: false,
      error: { code: "UNAUTHORIZED" },
    } as never);
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("returns only the service-provided current-user metadata and disallows shared caching", async () => {
    vi.mocked(listUserPasskeys).mockResolvedValueOnce({
      success: true,
      data: {
        items: [
          {
            credentialId: "credential-1",
            name: "Laptop",
            deviceType: "platform",
            browser: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            lastUsedAt: null,
          },
        ],
      },
    } as never);
    const response = await GET(request());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    );
    expect(body.data.items[0].credentialId).toBe("credential-1");
    expect(body.data).not.toHaveProperty("challenge");
    expect(body.data).not.toHaveProperty("privateKey");
  });

  it("never transforms service-side failures into success", async () => {
    vi.mocked(listUserPasskeys).mockResolvedValueOnce({
      success: false,
      error: { code: "SERVER_ERROR" },
    } as never);
    expect((await GET(request())).status).toBe(500);
  });
});
