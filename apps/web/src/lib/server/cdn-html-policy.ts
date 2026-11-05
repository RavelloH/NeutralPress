/**
 * Public HTML cache policy. The same response-level marker governs every ISR
 * page, while the Cloudflare Cache Rule only determines request eligibility.
 *
 * A non-public or unknown route is NEVER marked shareable.
 */
import { createHash } from "node:crypto";

export const PUBLIC_HTML_CACHE_CONTROL =
  "public, max-age=60, stale-while-revalidate=60, stale-if-error=60";
export const PRIVATE_HTML_CACHE_CONTROL = "private, no-store";
export const HTML_CACHE_TAG = "np-isr-html";
export const HTML_CACHE_TAG_PREFIX = "np-isr-path-";

/**
 * A full-page HTML response can also be requested by a monitoring tool using
 * a wildcard Accept header (or no Accept). This is not a reliable RSC discriminator:
 * Next.js App Router RSC fetches normally use the same wildcard Accept. The CDN and the Proxy
 * must independently exclude the RSC protocol headers and _rsc query.
 *
 * This deliberately rejects JSON, text/x-component, and other Accept values.
 */
export function allowsHtmlDocumentAccept(accept: string | null): boolean {
  if (accept === null || accept.trim() === "") return true;
  const normalized = accept.trim().toLowerCase();
  return (
    normalized === "*/*" ||
    /(?:^|,)\s*text\/html\s*(?:;[^,]*)?(?=,|$)/.test(normalized)
  );
}

const BLOCKED_ROOTS = new Set([
  "admin",
  "api",
  "internal",
  "_next",
  "user",
  "settings",
  "login",
  "logout",
  "register",
  "reauth",
  "reset-password",
  "email-verify",
  "notifications",
  "messages",
  "subscribe",
  "privacy",
  "auth",
]);

const PUBLIC_ROOTS = new Set([
  "posts",
  "projects",
  "gallery",
  "search",
  "tags",
  "categories",
  "archive",
  "friends",
  "guestbook",
  "about",
]);

export function normalizeHtmlPath(path: string): string | null {
  if (
    !path.startsWith("/") ||
    path.includes("?") ||
    path.includes("#") ||
    path.includes("\\") ||
    path.includes("//") ||
    path.length > 2048
  ) {
    return null;
  }
  if (/%2f|%5c|%00|%2e/i.test(path)) return null;
  try {
    const clean = decodeURIComponent(path);
    if (!/^\/[a-zA-Z0-9/_\-.\u00c0-\uffff]*$/.test(clean)) return null;
    const segments = clean.split("/");
    if (segments.some((part) => part === "." || part === "..")) return null;
    return clean.length > 1 ? clean.replace(/\/$/, "") : "/";
  } catch {
    return null;
  }
}

export function isDeniedHtmlPath(path: string): boolean {
  const clean = normalizeHtmlPath(path);
  if (!clean) return true;
  const segments = clean.split("/").filter(Boolean);
  const root = segments[0]?.toLowerCase();
  if (!root) return false;
  if (BLOCKED_ROOTS.has(root) || root.startsWith(".")) return true;
  if (root === "friends" && segments[1] === "new") return true;
  if (
    clean.endsWith(".xml") ||
    clean.endsWith(".json") ||
    clean.endsWith(".webmanifest") ||
    clean.endsWith(".txt")
  )
    return true;
  if (/\.[a-zA-Z0-9]{2,6}$/.test(clean)) return true;
  return false;
}

export function publicHtmlRouteKind(
  path: string,
): "blocked" | "post" | "project" | "photo" | "page" {
  const clean = normalizeHtmlPath(path);
  if (!clean || isDeniedHtmlPath(clean)) return "blocked";
  const segments = clean.split("/").filter(Boolean);
  if (
    segments[0] === "posts" &&
    segments.length === 2 &&
    segments[1] !== "page"
  )
    return "post";
  if (segments[0] === "projects" && segments.length === 2) return "project";
  if (
    segments[0] === "gallery" &&
    segments[1] === "photo" &&
    segments.length === 3
  )
    return "photo";
  return "page";
}

export function htmlPathCacheTag(path: string): string {
  return (
    HTML_CACHE_TAG_PREFIX +
    createHash("sha256").update(path).digest("hex").slice(0, 24)
  );
}

export function cacheTagsForPublicPath(path: string): string {
  return [HTML_CACHE_TAG, htmlPathCacheTag(path)].join(",");
}

export function isPublicRoot(path: string): boolean {
  const clean = normalizeHtmlPath(path);
  if (!clean || isDeniedHtmlPath(clean)) return false;
  if (clean === "/") return true;
  return PUBLIC_ROOTS.has(clean.split("/")[1]?.toLowerCase() ?? "");
}
