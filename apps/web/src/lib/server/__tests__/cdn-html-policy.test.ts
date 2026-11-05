// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  allowsHtmlDocumentAccept,
  cacheTagsForPublicPath,
  htmlPathCacheTag,
  isDeniedHtmlPath,
  normalizeHtmlPath,
  publicHtmlRouteKind,
} from "@/lib/server/cdn-html-policy";

describe("unified public ISR Cloudflare policy", () => {
  it("accepts browser HTML and safe probe Accept variants, but not RSC media types", () => {
    for (const value of [
      null,
      "",
      "*/*",
      " */* ",
      "text/html",
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "TEXT/HTML;Q=1",
    ])
      expect(allowsHtmlDocumentAccept(value)).toBe(true);

    for (const value of [
      "application/json",
      "text/x-component",
      "text/plain",
      "application/json, */*",
      "image/webp",
    ])
      expect(allowsHtmlDocumentAccept(value)).toBe(false);
  });

  it("blocks private, account, system and malformed HTML paths", () => {
    for (const path of [
      "/admin",
      "/admin/settings",
      "/user/1",
      "/login",
      "/messages",
      "/subscribe",
      "/friends/new",
      "/api/anything",
      "/internal/cache",
      "/_next/static/file.js",
      "/posts/%2fadmin",
      "/posts/../admin",
      "/posts//hello",
      "/sitemap.xml",
      "/feed.json",
    ]) {
      expect(isDeniedHtmlPath(path), path).toBe(true);
    }
  });

  it("treats all public detail route families alike", () => {
    expect(publicHtmlRouteKind("/posts/hello")).toBe("post");
    expect(publicHtmlRouteKind("/projects/hello")).toBe("project");
    expect(publicHtmlRouteKind("/gallery/photo/hello")).toBe("photo");
    expect(publicHtmlRouteKind("/tags/frontend/page/3")).toBe("page");
    expect(publicHtmlRouteKind("/some-custom-page")).toBe("page");
    expect(publicHtmlRouteKind("/settings")).toBe("blocked");
  });

  it("canonicalizes paths and supplies stable, unique HTML-only cache tags", () => {
    expect(normalizeHtmlPath("/posts/hello/")).toBe("/posts/hello");
    expect(normalizeHtmlPath("/posts/hello?secret")).toBeNull();
    const a = htmlPathCacheTag("/posts/a");
    expect(a).not.toBe(htmlPathCacheTag("/posts/b"));
    expect(cacheTagsForPublicPath("/posts/a")).toContain("np-isr-html,");
  });
});
