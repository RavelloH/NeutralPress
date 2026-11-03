import { afterEach, describe, expect, it, vi } from "vitest";

import { getCloudHistory, getCloudTrends } from "@/lib/client/api/cloud-read";

describe("Cloud HTTP client privacy", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("keeps delivery ID filters and access token out of URL", async () => {
    const spy = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ success: true, data: [] }),
    });
    vi.stubGlobal("fetch", spy);
    await getCloudHistory({
      page: 1,
      pageSize: 25,
      deliveryId: "delivery-private",
      access_token: "secret",
    });
    const [url, options] = spy.mock.calls[0]!;
    expect(url).toBe("/api/public/admin/cloud/history");
    expect(url).not.toContain("delivery-private");
    expect(options).toEqual(
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
    expect(options.body).toContain("delivery-private");
    expect(options.body).not.toContain("secret");
  });
  it("uses GET for pure trend reads", async () => {
    const spy = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ success: true, data: [] }),
    });
    vi.stubGlobal("fetch", spy);
    await getCloudTrends({ days: 30, count: 60 });
    const [url, options] = spy.mock.calls[0]!;
    expect(url).toContain("/api/public/admin/cloud/trends");
    expect(options).toEqual(
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
  });
});
