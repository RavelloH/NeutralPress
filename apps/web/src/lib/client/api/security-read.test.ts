import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getEndpointStats,
  getIPList,
  getRequestTrends,
  getSecurityOverview,
} from "@/lib/client/api/security-read";

describe("Security HTTP client privacy", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses GET for non-identifying aggregate reads and strips tokens", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ success: true, data: {} }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await getSecurityOverview({ force: true, access_token: "secret" } as never);
    await getEndpointStats({ hours: 24 });
    await getRequestTrends({ hours: 720, granularity: "hour" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [url, options] of fetchMock.mock.calls) {
      expect(String(url)).not.toContain("secret");
      expect(options.method).toBe("GET");
      expect(options.credentials).toBe("same-origin");
      expect(options.cache).toBe("no-store");
    }
  });

  it("uses JSON POST for IP list searches and never serializes IPs into the URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ success: true, data: { items: [] } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await getIPList({
      page: 1,
      pageSize: 20,
      filter: "all",
      sortBy: "ip",
      sortOrder: "desc",
      search: "203.0.113.9",
    });
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/public/admin/security/ips");
    expect(url).not.toContain("203.0.113.9");
    expect(options).toEqual(
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
    expect(options.body).toContain("203.0.113.9");
  });
});
