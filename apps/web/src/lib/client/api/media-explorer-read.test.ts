import { afterEach, describe, expect, it, vi } from "vitest";

import { getMediaExplorerPage } from "@/lib/client/api/media-read";

describe("Media Explorer native GET client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("preserves pagination, sorting, folder and all filter fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({
        success: true,
        data: { media: [], folders: [], breadcrumb: [] },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const params = {
      page: 2,
      pageSize: 50,
      sortBy: "createdAt" as const,
      sortOrder: "desc" as const,
      search: "test",
      mediaType: "IMAGE" as const,
      userUid: 42,
      sizeMin: 1024,
      sizeMax: 10240,
      inGallery: true,
      isOptimized: false,
      hasReferences: true,
      createdAtStart: "2026-01-01T00:00:00.000Z",
      createdAtEnd: "2026-10-01T00:00:00.000Z",
      currentFolderId: 23,
    };
    await getMediaExplorerPage(params);
    const [path, options] = fetchMock.mock.calls[0]!;
    const url = new URL(path, "https://example.com");
    expect(url.pathname).toBe("/api/public/admin/media/explorer");
    expect(JSON.parse(url.searchParams.get("params")!)).toEqual(params);
    expect(options).toEqual(
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
  });
});
