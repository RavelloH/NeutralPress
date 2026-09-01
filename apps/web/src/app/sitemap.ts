import type { MetadataRoute } from "next";

import { getSitemapData } from "@/lib/server/sitemap-data";

function normalizePath(pathname: string): string {
  const trimmed = pathname.trim();
  if (!trimmed || trimmed === "/") return "/";

  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const normalized = withLeadingSlash.replace(/\/{2,}/g, "/");
  const withoutTrailingSlash = normalized.replace(/\/+$/g, "");

  return withoutTrailingSlash || "/";
}

function isDynamicPath(pathname: string): boolean {
  return pathname.split("/").some((segment) => segment.includes(":"));
}

function createUrl(baseUrl: string, pathname: string): string | null {
  const normalizedPath = normalizePath(pathname);
  if (isDynamicPath(normalizedPath)) return null;

  return normalizedPath === "/" ? baseUrl : `${baseUrl}${normalizedPath}`;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { posts, projects, pages, categories, tags, baseUrl } =
    await getSitemapData();
  const entries = new Map<string, MetadataRoute.Sitemap[number]>();

  const addEntry = (
    pathname: string,
    lastModified: Date,
    changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"],
    priority: number,
  ) => {
    const url = createUrl(baseUrl, pathname);
    if (!url || entries.has(url)) return;

    entries.set(url, {
      url,
      lastModified,
      changeFrequency,
      priority,
    });
  };

  addEntry("/", new Date(), "daily", 1);

  for (const post of posts) {
    addEntry(`/posts/${post.slug}`, post.updatedAt, "weekly", 0.7);
  }

  for (const project of projects) {
    addEntry(`/projects/${project.slug}`, project.updatedAt, "weekly", 0.7);
  }

  for (const page of pages) {
    addEntry(page.slug, page.updatedAt, "monthly", 0.5);
  }

  for (const category of categories) {
    addEntry(`/categories/${category.slug}`, category.updatedAt, "weekly", 0.6);
  }

  for (const tag of tags) {
    addEntry(`/tags/${tag.slug}`, tag.updatedAt, "weekly", 0.6);
  }

  return Array.from(entries.values());
}
