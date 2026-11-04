// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/public/account/security/reauth-profile/route";
import { getCurrentUserForReauth } from "@/lib/server/services/reauth-profile-domain";

vi.mock("@/lib/server/services/reauth-profile-domain", () => ({
  getCurrentUserForReauth: vi.fn(),
}));
const request = (query = "") =>
  new NextRequest(
    "https://example.com/api/public/account/security/reauth-profile" + query,
  );

describe("current-user reauth GET", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects all client-supplied user identities or credentials", async () => {
    for (const query of [
      "?uid=2",
      "?access_token=secret",
      "?email=a%40example.com",
    ]) {
      expect((await GET(request(query))).status).toBe(400);
    }
    expect(getCurrentUserForReauth).not.toHaveBeenCalled();
  });

  it("returns only existing user profile flags; no password or TOTP secret", async () => {
    vi.mocked(getCurrentUserForReauth).mockResolvedValueOnce({
      success: true,
      data: {
        uid: 9,
        username: "test",
        email: "test@example.com",
        hasPassword: true,
        hasTotpEnabled: true,
        linkedProviders: ["github"],
      },
    } as never);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const body = await response.json();
    expect(body.data).not.toHaveProperty("password");
    expect(body.data).not.toHaveProperty("totpSecret");
    expect(getCurrentUserForReauth).toHaveBeenCalledTimes(1);
  });

  it("responds 401 for unauthorized and 500 for backend failure", async () => {
    vi.mocked(getCurrentUserForReauth).mockResolvedValueOnce({
      success: false,
      error: { code: "UNAUTHORIZED" },
    } as never);
    expect((await GET(request())).status).toBe(401);
    vi.mocked(getCurrentUserForReauth).mockResolvedValueOnce({
      success: false,
      error: { code: "SERVER_ERROR" },
    } as never);
    expect((await GET(request())).status).toBe(500);
  });
});
