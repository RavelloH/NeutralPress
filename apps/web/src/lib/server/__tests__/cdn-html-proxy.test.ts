// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  posts: vi.fn(),
  projects: vi.fn(),
  photos: vi.fn(),
  pages: vi.fn(),
}));
const revocationMock = vi.hoisted(() => vi.fn(async () => false));
vi.mock("@/lib/server/cdn-cache-pipeline", () => ({
  isPublicHtmlRevoking: revocationMock,
}));
vi.mock("@/lib/server/prisma", () => ({
  default: {
    post: { findFirst: mocks.posts },
    project: { findFirst: mocks.projects },
    photo: { findUnique: mocks.photos },
    page: { findFirst: mocks.pages },
  },
}));
vi.mock("next/server", () => ({
  NextResponse: { next: () => ({ headers: new Headers() }) },
}));

import { proxy } from "@/proxy";

function request(
  path: string,
  opts?: {
    method?: string;
    cookie?: string;
    accept?: string | null;
    search?: string;
    rsc?: boolean;
    prefetch?: boolean;
    routerState?: boolean;
  },
) {
  const headers = new Headers();
  if (opts?.accept !== null) headers.set("accept", opts?.accept ?? "text/html");
  if (opts?.cookie) headers.set("cookie", opts.cookie);
  if (opts?.rsc) headers.set("RSC", "1");
  if (opts?.prefetch) headers.set("Next-Router-Prefetch", "1");
  if (opts?.routerState) headers.set("Next-Router-State-Tree", "[]");
  return {
    method: opts?.method ?? "GET",
    headers,
    nextUrl: { pathname: path, search: opts?.search ?? "" },
  } as Parameters<typeof proxy>[0];
}

const policy = async (path: string, opts?: Parameters<typeof request>[1]) => {
  const response = await proxy(request(path, opts));
  return {
    cdn: response.headers.get("Cloudflare-CDN-Cache-Control"),
    tags: response.headers.get("Cache-Tag"),
  };
};

describe("unified ISR HTML response eligibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    revocationMock.mockResolvedValue(false);
    mocks.posts.mockResolvedValue({ accessMode: "PUBLIC" });
    mocks.projects.mockResolvedValue({ id: 1 });
    mocks.photos.mockResolvedValue({ id: 2 });
    mocks.pages.mockResolvedValue({ id: "page-id" });
  });

  it("marks verified anonymous ISR pages public with identical TTL and Cache-Tag", async () => {
    for (const path of [
      "/",
      "/posts",
      "/projects/demo",
      "/gallery/photo/pic",
      "/tags",
      "/categories/css/page/3",
      "/my-custom-page",
    ]) {
      const result = await policy(path);
      expect(result.cdn, path).toBe(
        "public, max-age=60, stale-while-revalidate=60, stale-if-error=60",
      );
      expect(result.tags, path).toMatch(
        /^np-isr-html,np-isr-path-[a-f0-9]{24}$/,
      );
    }
  });

  it("marks ordinary probe GET/HEAD with wildcard or absent Accept as shareable HTML", async () => {
    for (const opts of [
      { accept: "*/*" },
      { accept: null },
      { method: "HEAD", accept: "*/*" },
    ]) {
      const result = await policy("/posts", opts);
      expect(result.cdn).toContain("public, max-age=60");
      expect(result.tags).toContain("np-isr-html");
    }
  });

  it("keeps RSC, prefetch and other structured content out of public HTML caching", async () => {
    for (const opts of [
      { accept: "*/*", rsc: true },
      { accept: "*/*", routerState: true },
      { accept: "*/*", prefetch: true },
      { accept: "*/*", search: "?_rsc=hash" },
      { accept: "text/x-component" },
      { accept: "application/json" },
    ]) {
      const result = await policy("/posts", opts);
      expect(result.cdn).toBe("private, no-store");
      expect(result.tags).toBeNull();
    }
  });

  it("does not cache password/role protected article HTML", async () => {
    for (const accessMode of ["ROLE", "PASSWORD"]) {
      mocks.posts.mockResolvedValueOnce({ accessMode });
      const value = await policy("/posts/protected");
      expect(value.cdn).toBe("private, no-store");
      expect(value.tags).toBeNull();
    }
  });

  it("blocks in-flight public-to-private article from refilling the CDN", async () => {
    revocationMock.mockResolvedValueOnce(true);
    const result = await policy("/posts/now-protected");
    expect(result.cdn).toBe("private, no-store");
    expect(result.tags).toBeNull();
  });

  it("does not cache deleted or unpublished articles and projects", async () => {
    mocks.posts.mockResolvedValueOnce(null);
    expect((await policy("/posts/removed")).cdn).toBe("private, no-store");
    mocks.projects.mockResolvedValueOnce(null);
    expect((await policy("/projects/draft")).cdn).toBe("private, no-store");
  });

  it("fails closed for admin, account, API, user identity and query routes", async () => {
    for (const path of [
      "/admin",
      "/settings",
      "/messages",
      "/user/12",
      "/subscribe",
      "/friends/new",
      "/api/private",
    ]) {
      expect((await policy(path)).cdn, path).toBe("private, no-store");
    }
    expect((await policy("/posts", { cookie: "session=1" })).cdn).toBe(
      "private, no-store",
    );
    expect((await policy("/posts", { method: "POST" })).cdn).toBe(
      "private, no-store",
    );
    expect((await policy("/posts", { search: "?preview=1" })).cdn).toBe(
      "private, no-store",
    );
  });

  it("fails closed when the database is unavailable", async () => {
    mocks.posts.mockRejectedValueOnce(new Error("DB unavailable"));
    const result = await policy("/posts/demo");
    expect(result.cdn).toBe("private, no-store");
    expect(result.tags).toBeNull();
  });
});
