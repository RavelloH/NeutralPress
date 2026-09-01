import { cacheLife, cacheTag } from "next/cache";

import { batchGetCategoryPaths } from "@/lib/server/category-utils";
import { type ConfigItem, getRawConfig } from "@/lib/server/config-cache";
import { PUBLIC_VISIBLE_POST_WHERE } from "@/lib/server/post-access";
import prisma from "@/lib/server/prisma";
import { PUBLIC_PROJECT_STATUSES } from "@/lib/server/project-public";

export interface SitemapDataItem {
  slug: string;
  updatedAt: Date;
}

export interface SitemapData {
  baseUrl: string;
  posts: SitemapDataItem[];
  projects: SitemapDataItem[];
  pages: SitemapDataItem[];
  categories: SitemapDataItem[];
  tags: SitemapDataItem[];
}

const DEFAULT_SITE_URL = "https://neutralpress.com";
const PAGE_TEMPLATE_SUFFIX = "/page/:page";

function getConfigString(config: ConfigItem | null, fallback: string): string {
  const value = config?.value;

  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "object" && value !== null && "default" in value) {
    const defaultValue = (value as Record<string, unknown>).default;
    if (typeof defaultValue === "string" && defaultValue.trim()) {
      return defaultValue.trim();
    }
  }

  return fallback;
}

function normalizeBaseUrl(url: string): string {
  return (url.trim() || DEFAULT_SITE_URL).replace(/\/+$/g, "");
}

/**
 * 查询 sitemap 所需的全部公开文章。
 * 文章规则必须与公开文章路由保持一致，并额外排除 noindex 文章。
 */
async function getSitemapPosts(): Promise<SitemapDataItem[]> {
  return prisma.post.findMany({
    where: {
      ...PUBLIC_VISIBLE_POST_WHERE,
      robotsIndex: true,
      publishedAt: { not: null },
    },
    select: {
      slug: true,
      updatedAt: true,
    },
    orderBy: [{ publishedAt: "desc" }, { updatedAt: "desc" }],
  });
}

/**
 * 查询项目详情页所需的全部公开项目。
 * 状态规则复用 project-public，robotsIndex 是 sitemap 的额外 SEO 条件。
 */
async function getSitemapProjects(): Promise<SitemapDataItem[]> {
  return prisma.project.findMany({
    where: {
      deletedAt: null,
      status: { in: [...PUBLIC_PROJECT_STATUSES] },
      robotsIndex: true,
    },
    select: {
      slug: true,
      updatedAt: true,
    },
    orderBy: [{ publishedAt: "desc" }, { updatedAt: "desc" }],
  });
}

async function getSitemapPages(): Promise<SitemapDataItem[]> {
  const pages = await prisma.page.findMany({
    where: {
      status: "ACTIVE",
      deletedAt: null,
      robotsIndex: true,
    },
    select: {
      slug: true,
      updatedAt: true,
    },
    orderBy: [{ slug: "asc" }, { updatedAt: "desc" }],
  });

  const result: SitemapDataItem[] = [];

  for (const page of pages) {
    const slug = page.slug.trim();
    if (!slug.includes(":")) {
      result.push({ slug, updatedAt: page.updatedAt });
      continue;
    }

    // 固定分页模板（如 /posts/page/:page）对应的基路径是真实页面，
    // 但模板本身不能作为 sitemap URL 输出。
    if (slug.endsWith(PAGE_TEMPLATE_SUFFIX)) {
      const templateBase = slug.slice(0, -PAGE_TEMPLATE_SUFFIX.length);
      if (!templateBase.includes(":")) {
        result.push({
          slug: templateBase || "/",
          updatedAt: page.updatedAt,
        });
      }
    }
  }

  return result;
}

async function getSitemapCategories(): Promise<SitemapDataItem[]> {
  const categories = await prisma.category.findMany({
    select: {
      id: true,
      slug: true,
      updatedAt: true,
    },
    orderBy: [{ fullSlug: "asc" }, { updatedAt: "desc" }],
  });

  const categoryPaths = await batchGetCategoryPaths(
    categories.map((category) => category.id),
  );

  return categories
    .map((category) => ({
      slug:
        categoryPaths.get(category.id)?.at(-1)?.slug.trim() ||
        category.slug.trim(),
      updatedAt: category.updatedAt,
    }))
    .filter((category) => category.slug.length > 0);
}

async function getSitemapTags(): Promise<SitemapDataItem[]> {
  const tags = await prisma.tag.findMany({
    select: {
      slug: true,
      updatedAt: true,
    },
    orderBy: [{ slug: "asc" }, { updatedAt: "desc" }],
  });

  return tags
    .map((tag) => ({
      slug: tag.slug.trim(),
      updatedAt: tag.updatedAt,
    }))
    .filter((tag) => tag.slug.length > 0);
}

export async function getSitemapData(): Promise<SitemapData> {
  "use cache";

  cacheTag(
    "posts/list",
    "projects/list",
    "pages",
    "categories/list",
    "tags/list",
    "config/site.url",
  );
  cacheLife("max");

  const [siteUrlConfig, posts, projects, pages, categories, tags] =
    await Promise.all([
      getRawConfig("site.url"),
      getSitemapPosts(),
      getSitemapProjects(),
      getSitemapPages(),
      getSitemapCategories(),
      getSitemapTags(),
    ]);

  return {
    baseUrl: normalizeBaseUrl(getConfigString(siteUrlConfig, DEFAULT_SITE_URL)),
    posts,
    projects,
    pages,
    categories,
    tags,
  };
}
