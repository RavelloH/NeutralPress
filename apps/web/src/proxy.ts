import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { isPublicHtmlRevoking } from "@/lib/server/cdn-cache-pipeline";
import {
  allowsHtmlDocumentAccept,
  cacheTagsForPublicPath,
  isDeniedHtmlPath,
  isPublicRoot,
  normalizeHtmlPath,
  PRIVATE_HTML_CACHE_CONTROL,
  PUBLIC_HTML_CACHE_CONTROL,
  publicHtmlRouteKind,
} from "@/lib/server/cdn-html-policy";
import prisma from "@/lib/server/prisma";

/**
 * Cloudflare must never rely on the one-year s-maxage of the Next.js ISR
 * response. Only pages we know are anonymous public ISR get an explicit
 * short-lived CDN policy. All other HTML fails closed.
 */
async function isShareableHtml(path: string): Promise<boolean> {
  if (isDeniedHtmlPath(path)) return false;
  const kind = publicHtmlRouteKind(path);
  const parts = path.split("/").filter(Boolean);

  if (kind === "post") {
    const post = await prisma.post.findFirst({
      where: {
        slug: parts[1],
        deletedAt: null,
        status: { in: ["PUBLISHED", "ARCHIVED"] },
      },
      select: { accessMode: true },
    });
    return post?.accessMode === "PUBLIC" && !(await isPublicHtmlRevoking(path));
  }
  if (kind === "project") {
    const project = await prisma.project.findFirst({
      where: {
        slug: parts[1],
        deletedAt: null,
        status: { in: ["PUBLISHED", "DEVELOPING", "ARCHIVED"] },
      },
      select: { id: true },
    });
    return Boolean(project);
  }
  if (kind === "photo") {
    return Boolean(
      await prisma.photo.findUnique({
        where: { slug: parts[2] },
        select: { id: true },
      }),
    );
  }

  // The known landing pages and collection templates are server-side ISR.
  if (isPublicRoot(path)) {
    if (parts.length === 0) return true;
    if (parts.length === 1) return true;
  }

  // Other routes must resolve to a currently active configured Page. Match
  // exact, pagination, variable and catch-all Page templates, not user routes.
  const candidates = new Set<string>([path]);
  if (
    parts.length >= 2 &&
    parts.at(-2) === "page" &&
    /^[1-9]\d*$/.test(parts.at(-1) ?? "")
  ) {
    const base = "/" + parts.slice(0, -2).join("/");
    candidates.add(base + "/page/:page");
    candidates.add("/" + parts.slice(0, -3).join("/") + "/:slug/page/:page");
    candidates.add("/" + parts.slice(0, -2).join("/") + "/:slug.../page/:page");
  } else if (parts.length > 0) {
    candidates.add("/" + parts.slice(0, -1).join("/") + "/:slug");
    for (let depth = Math.min(parts.length - 1, 2); depth >= 0; depth--) {
      const prefix = parts.slice(0, depth).join("/");
      candidates.add("/" + (prefix ? prefix + "/" : "") + ":slug...");
    }
  }
  const configured = await prisma.page.findFirst({
    where: {
      slug: { in: [...candidates] },
      status: "ACTIVE",
      deletedAt: null,
      contentType: { in: ["BLOCK", "MARKDOWN", "MDX", "HTML"] },
    },
    select: { id: true },
  });
  return Boolean(configured);
}

export async function proxy(request: NextRequest) {
  // Default to non-shared HTML, including probe and HEAD requests.
  // Next.js may strip internal RSC Flight headers in Proxy, so the Cloudflare
  // Cache Rule must independently exclude them before looking up its cache.
  const response = NextResponse.next();
  response.headers.set(
    "Cloudflare-CDN-Cache-Control",
    PRIVATE_HTML_CACHE_CONTROL,
  );

  if (
    (request.method !== "GET" && request.method !== "HEAD") ||
    !allowsHtmlDocumentAccept(request.headers.get("accept")) ||
    request.headers.has("rsc") ||
    request.headers.has("next-router-state-tree") ||
    request.headers.has("next-router-prefetch") ||
    request.headers.has("next-router-segment-prefetch") ||
    request.headers.has("next-url") ||
    request.headers.has("next-action") ||
    request.headers.has("cookie") ||
    request.headers.has("authorization") ||
    request.nextUrl.search
  ) {
    return response;
  }

  const path = normalizeHtmlPath(request.nextUrl.pathname);
  if (!path) return response;

  try {
    if (await isShareableHtml(path)) {
      response.headers.set(
        "Cloudflare-CDN-Cache-Control",
        PUBLIC_HTML_CACHE_CONTROL,
      );
      response.headers.set("Cache-Tag", cacheTagsForPublicPath(path));
    }
  } catch (error) {
    console.error("[CDN HTML policy] Unable to classify public page", error);
    // A DB outage cannot turn a private document into a cacheable document.
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!api|internal|_next|favicon.ico|icon/|social-image/|robots.txt|sitemap.xml|manifest.webmanifest).*)",
  ],
};
