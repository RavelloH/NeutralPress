import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/public/admin/media/[operation]/route";
import { authVerify } from "@/lib/server/auth-verify";
import * as service from "@/lib/server/services/media-domain";

vi.mock("@/lib/server/auth-verify", () => ({ authVerify: vi.fn() }));
vi.mock("@/lib/server/services/media-domain", () => ({
  getMediaList: vi.fn(),
  getMediaDetail: vi.fn(),
  getMediaStats: vi.fn(),
  getMediaTrends: vi.fn(),
  getAccessibleFolders: vi.fn(),
  getFolderBreadcrumb: vi.fn(),
  getMediaExplorerPage: vi.fn(),
}));

function request(op: string, input?: unknown, suffix = "") {
  const url = new URL("https://example.com/api/public/admin/media/" + op);
  if (input !== undefined)
    url.searchParams.set("params", JSON.stringify(input));
  return new NextRequest(url.toString() + suffix);
}
const context = (operation: string) => ({
  params: Promise.resolve({ operation }),
});

describe("GET /api/public/admin/media/[operation]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authVerify).mockResolvedValue({
      role: "ADMIN",
      uid: 42,
    } as never);
  });
  it("rejects unknown operations, malformed input and credential leakage", async () => {
    expect((await GET(request("delete"), context("delete"))).status).toBe(400);
    const op = "list";
    const malformed = new NextRequest(
      "https://example.com/api/public/admin/media/" + op + "?params=%7Bbroken",
    );
    expect((await GET(malformed, context(op))).status).toBe(400);
    expect(
      (await GET(request(op, { access_token: "forbidden" }), context(op)))
        .status,
    ).toBe(400);
    expect(
      (await GET(request(op, {}, "&access_token=bad"), context(op))).status,
    ).toBe(400);
    expect(vi.mocked(service.getMediaList)).not.toHaveBeenCalled();
    expect(vi.mocked(service.getMediaDetail)).not.toHaveBeenCalled();
    expect(vi.mocked(service.getMediaStats)).not.toHaveBeenCalled();
    expect(vi.mocked(service.getMediaTrends)).not.toHaveBeenCalled();
  });
  it("preserves authentication errors and disables proxy caching", async () => {
    vi.mocked(service.getMediaList).mockResolvedValueOnce(
      NextResponse.json({ success: false }, { status: 403 }) as never,
    );
    const response = await GET(request("list", {}), context("list"));
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("routes list to the server-only getMediaList service", async () => {
    vi.mocked(service.getMediaList).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: [] }) as never,
    );
    const response = await GET(request("list", {}), context("list"));
    expect(vi.mocked(service.getMediaList)).toHaveBeenCalledWith(
      expect.objectContaining({}),
      { environment: "serverless" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("routes detail to the server-only getMediaDetail service", async () => {
    vi.mocked(service.getMediaDetail).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: [] }) as never,
    );
    const response = await GET(request("detail", { id: 1 }), context("detail"));
    expect(vi.mocked(service.getMediaDetail)).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      { environment: "serverless" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("routes stats to the server-only getMediaStats service", async () => {
    vi.mocked(service.getMediaStats).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: [] }) as never,
    );
    const response = await GET(request("stats", {}), context("stats"));
    expect(vi.mocked(service.getMediaStats)).toHaveBeenCalledWith(
      expect.objectContaining({}),
      { environment: "serverless" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("routes trends to the server-only getMediaTrends service", async () => {
    vi.mocked(service.getMediaTrends).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: [] }) as never,
    );
    const response = await GET(request("trends", {}), context("trends"));
    expect(vi.mocked(service.getMediaTrends)).toHaveBeenCalledWith(
      expect.objectContaining({}),
      { environment: "serverless" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("returns a private 401 for unauthenticated folder reads", async () => {
    vi.mocked(authVerify).mockResolvedValueOnce(null);
    const response = await GET(
      request("folders", { parentId: 11 }),
      context("folders"),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(service.getAccessibleFolders).not.toHaveBeenCalled();
  });
  it("uses a verified session identity, never a user role or token from GET", async () => {
    vi.mocked(service.getAccessibleFolders).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: [] }) as never,
    );
    const response = await GET(
      request("folders", { parentId: 11 }),
      context("folders"),
    );
    expect(response.status).toBe(200);
    expect(service.getAccessibleFolders).toHaveBeenCalledWith(
      { access_token: "", userRole: "ADMIN", userUid: 42, parentId: 11 },
      { environment: "serverless" },
    );
    expect(
      (
        await GET(
          request("folders", { userRole: "ADMIN", userUid: 1 }),
          context("folders"),
        )
      ).status,
    ).toBe(400);
  });
  it("routes breadcrumb to authenticated media service", async () => {
    vi.mocked(service.getFolderBreadcrumb).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: [] }) as never,
    );
    const response = await GET(
      request("breadcrumb", { folderId: 5 }),
      context("breadcrumb"),
    );
    expect(service.getFolderBreadcrumb).toHaveBeenCalledWith(
      { access_token: "", folderId: 5 },
      { environment: "serverless" },
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("passes validated Explorer pagination without URL credentials", async () => {
    vi.mocked(service.getMediaExplorerPage).mockResolvedValueOnce(
      NextResponse.json({ success: true, data: {} }) as never,
    );
    const response = await GET(
      request("explorer", { currentFolderId: 5, page: 2 }),
      context("explorer"),
    );
    expect(service.getMediaExplorerPage).toHaveBeenCalledWith(
      expect.objectContaining({
        currentFolderId: 5,
        page: 2,
        access_token: "",
      }),
      { environment: "serverless" },
    );
    expect(response.status).toBe(200);
    expect(
      (await GET(request("explorer", { folderId: 5 }), context("explorer")))
        .status,
    ).toBe(400);
  });
});
