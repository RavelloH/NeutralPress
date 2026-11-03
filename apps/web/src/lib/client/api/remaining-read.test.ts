import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getConversationMessages,
  getConversations,
} from "@/lib/client/api/message-read";
import { fetchBlockData } from "@/lib/client/api/page-read";
import { getUserActivity, getUserProfile } from "@/lib/client/api/user-read";

describe("remaining public API client reads", () => {
  afterEach(() => vi.unstubAllGlobals());

  function mockFetch() {
    const spy = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ success: true, data: {} }),
    });
    vi.stubGlobal("fetch", spy);
    return spy;
  }

  it("serializes message polling timestamps into cancellable same-origin GET", async () => {
    const spy = mockFetch();
    const date = new Date("2026-11-03T09:00:00.000Z");
    await getConversations(date, 0, 20);
    const [url, options] = spy.mock.calls[0]!;
    const params = JSON.parse(new URL(url).searchParams.get("params")!);
    expect(params).toEqual({
      lastPolledAt: date.toISOString(),
      skip: 0,
      take: 20,
    });
    expect(options).toEqual(
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
      }),
    );
  });

  it("never puts private message content into a GET URL", async () => {
    const spy = mockFetch();
    await getConversationMessages(
      "00000000-0000-4000-8000-000000000001",
      0,
      25,
    );
    const [url] = spy.mock.calls[0]!;
    expect(url).toContain("/api/public/messages/thread");
    expect(url).not.toContain("message.content");
  });

  it("does not allow an unauthenticated client to supply its own guest policy", async () => {
    const spy = mockFetch();
    await getUserActivity(42, 5, 20, false);
    const [url] = spy.mock.calls[0]!;
    const params = JSON.parse(new URL(url).searchParams.get("params")!);
    expect(params).toEqual({ uid: 42, offset: 5, limit: 20 });
    await getUserProfile();
    expect(spy.mock.calls[1]![0]).toContain("/api/public/users/self");
  });

  it("sends editor block data as JSON POST without a credential in the body", async () => {
    const spy = mockFetch();
    await fetchBlockData({
      access_token: "never-log",
      block: { id: 1, block: "markdown", content: "hello" },
    });
    const [url, options] = spy.mock.calls[0]!;
    expect(url).toBe("/api/public/admin/pages/block-data");
    expect(options).toEqual(
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
    expect(JSON.parse(options.body)).toEqual({
      block: { id: 1, block: "markdown", content: "hello" },
    });
    expect(options.body).not.toContain("never-log");
  });
});
