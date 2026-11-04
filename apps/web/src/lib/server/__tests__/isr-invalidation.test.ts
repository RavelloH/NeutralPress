import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("next/cache", () => mocks);

import { expireCacheTag } from "@/lib/server/isr-invalidation";

describe("event-driven ISR invalidation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("expires post lists immediately and refreshes dependent static pages and feeds", () => {
    expireCacheTag("posts/list");
    expect(mocks.revalidateTag).toHaveBeenCalledWith("posts/list", {
      expire: 0,
    });
    for (const path of ["/", "/posts", "/[[...slug]]"]) {
      expect(mocks.revalidatePath).toHaveBeenCalledWith(path, "page");
    }
    for (const path of ["/feed.xml", "/feed.json", "/sitemap.xml"]) {
      expect(mocks.revalidatePath).toHaveBeenCalledWith(path);
    }
  });

  it("invalidates only the named article for an article tag", () => {
    expireCacheTag("posts/test-slug");
    expect(mocks.revalidateTag).toHaveBeenCalledWith("posts/test-slug", {
      expire: 0,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/posts/test-slug");
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(1);
  });

  it("invalidates project details and project indices", () => {
    expireCacheTag("projects/demo");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/projects/demo");
    vi.clearAllMocks();
    expireCacheTag("projects/list");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/projects", "page");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/[[...slug]]", "page");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/sitemap.xml");
  });

  it("invalidates all page variants after site config changes", () => {
    expireCacheTag("config/site.title");
    expect(mocks.revalidateTag).toHaveBeenCalledWith("config/site.title", {
      expire: 0,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("refreshes gallery and taxonomy pages", () => {
    expireCacheTag("gallery/list");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/gallery", "page");
    vi.clearAllMocks();
    expireCacheTag("photos/my-photo");
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/gallery/photo/my-photo",
    );
    vi.clearAllMocks();
    expireCacheTag("tags/nextjs");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/[[...slug]]", "page");
  });

  it("expires unknown data tags without invalidating unrelated pages", () => {
    expireCacheTag("custom-dictionary");
    expect(mocks.revalidateTag).toHaveBeenCalledWith("custom-dictionary", {
      expire: 0,
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("refreshes configurable homepage blocks for gallery and friend-link changes", () => {
    for (const tag of ["gallery/list", "photos/example", "friend-links"]) {
      vi.clearAllMocks();
      expireCacheTag(tag);
      expect(mocks.revalidatePath).toHaveBeenCalledWith("/[[...slug]]", "page");
    }
  });

  it("invalidates shared author metadata after a user profile change", () => {
    expireCacheTag("users/42");
    expect(mocks.revalidateTag).toHaveBeenCalledWith("users/42", { expire: 0 });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
});
