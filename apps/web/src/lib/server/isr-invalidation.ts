import "server-only";

import { revalidatePath, revalidateTag } from "next/cache";

import { scheduleCdnCacheRefresh } from "@/lib/server/cdn-cache-pipeline";

/**
 * Immediately expire public Data Cache entries and the affected Full Route Cache.
 *
 * Unlike updateTag, this also works when a domain service is invoked from a
 * Route Handler or a scheduled task. There is no scheduled TTL.
 *
 * The catch-all path pattern covers configurable collection blocks. A future
 * dependency registry can narrow this to the exact configured page URLs.
 */
export function expireCacheTag(tag: string): void {
  revalidateTag(tag, { expire: 0 });

  if (tag === "posts/list") {
    revalidatePath("/", "page");
    revalidatePath("/posts", "page");
    revalidatePath("/feed.xml");
    revalidatePath("/feed.json");
    revalidatePath("/sitemap.xml");
    revalidatePath("/[[...slug]]", "page");
  } else if (tag.startsWith("posts/")) {
    revalidatePath(`/posts/${tag.slice("posts/".length)}`);
  } else if (tag === "projects/list") {
    revalidatePath("/projects", "page");
    revalidatePath("/sitemap.xml");
    revalidatePath("/[[...slug]]", "page");
  } else if (tag.startsWith("projects/")) {
    revalidatePath(`/projects/${tag.slice("projects/".length)}`);
  } else if (tag === "pages" || tag.startsWith("pages/")) {
    revalidatePath("/[[...slug]]", "page");
    revalidatePath("/sitemap.xml");
  } else if (tag === "menus" || tag === "config" || tag.startsWith("config/")) {
    revalidatePath("/", "layout");
  } else if (tag === "gallery/list") {
    revalidatePath("/gallery", "page");
    revalidatePath("/[[...slug]]", "page");
  } else if (tag.startsWith("photos/")) {
    revalidatePath(`/gallery/photo/${tag.slice("photos/".length)}`);
    revalidatePath("/[[...slug]]", "page");
  } else if (tag.startsWith("tags/") || tag.startsWith("categories/")) {
    revalidatePath("/[[...slug]]", "page");
  } else if (tag === "friend-links") {
    revalidatePath("/friends", "page");
    revalidatePath("/[[...slug]]", "page");
  } else if (tag === "users" || tag.startsWith("users/")) {
    revalidatePath("/", "layout");
  }

  // The CDN is deliberately more restrictive than the ISR cache.
  if (tag === "posts/list") {
    scheduleCdnCacheRefresh(["/", "/posts"]);
  } else if (tag === "projects/list") {
    scheduleCdnCacheRefresh(["/", "/projects"]);
  } else if (
    tag === "gallery/list" ||
    tag === "friend-links" ||
    tag === "pages" ||
    tag.startsWith("pages/")
  ) {
    scheduleCdnCacheRefresh(["/", "/gallery"]);
  } else if (
    tag === "menus" ||
    tag === "config" ||
    tag.startsWith("config/") ||
    tag === "users" ||
    tag.startsWith("users/")
  ) {
    scheduleCdnCacheRefresh(["/", "/posts", "/projects", "/gallery"]);
  }
}
