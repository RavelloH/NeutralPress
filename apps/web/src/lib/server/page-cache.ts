import "server-only";

import fs from "fs";
import { unstable_cache } from "next/cache";
import path from "path";

import type { AllBlockConfigs } from "@/blocks/core/types/base";
import { LISTABLE_POST_PUBLISHED_WHERE } from "@/lib/server/post-access";
import prisma from "@/lib/server/prisma";

// 自定义 JSON 类型定义（避免与 Prisma 的 JsonValue 冲突）
type CustomJsonValue =
  | string
  | number
  | boolean
  | null
  | CustomJsonObject
  | CustomJsonArray;
type CustomJsonObject = { [key: string]: CustomJsonValue };
type CustomJsonArray = CustomJsonValue[];

// 页面组件类型定义
export interface PageComponent {
  id: string;
  value:
    | {
        header?: string;
        content?: string;
        description?: string;
      }
    | {
        content: string[];
        footer?: {
          link: string;
          description: string;
        };
      };
  description: string;
}

// 系统页面配置类型定义
export interface SystemPageConfig {
  blocks?: AllBlockConfigs[];
  components?: PageComponent[];
}

// 通用页面配置类型（可以是任何 JSON 值）
type PageConfig = SystemPageConfig | CustomJsonObject | CustomJsonValue;

// 页面对象类型定义
export interface PageItem {
  id: string;
  title: string;
  slug: string;
  content: string;
  contentType: "MARKDOWN" | "HTML" | "MDX" | "BLOCK" | "BUILDIN";
  config: PageConfig;
  status: "ACTIVE" | "SUSPENDED";
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  isSystemPage: boolean;
  metaDescription: string | null;
  metaKeywords: string | null;
  robotsIndex: boolean;
  userUid: number | null;
}

// 页面匹配结果类型定义
export interface PageMatch {
  page: PageItem;
  params: {
    url: string;
    page?: number;
    slug?: string;
  };
}

// 缓存文件路径
const CACHE_FILE_PATH = path.join(process.cwd(), ".cache", ".page-cache.json");
const STATIC_PARAM_SUPPORTED_CONTENT_TYPES = [
  "BLOCK",
  "MDX",
  "MARKDOWN",
  "HTML",
] as const;
const PAGE_PLACEHOLDER_SEGMENT = "/page/:page";

export interface MainRouteStaticParam {
  slug: string[];
}

const getAllCategoryFullSlugs = unstable_cache(
  async () => {
    const categories = await prisma.category.findMany({
      select: { fullSlug: true },
    });

    return categories
      .map((category) => category.fullSlug.trim())
      .filter((slug) => slug.length > 0);
  },
  ["page-cache-category-full-slugs"],
  {
    tags: ["categories"],
    revalidate: false,
  },
);

const getAllTagSlugs = unstable_cache(
  async () => {
    const tags = await prisma.tag.findMany({
      select: { slug: true },
    });

    return tags.map((tag) => tag.slug.trim()).filter((slug) => slug.length > 0);
  },
  ["page-cache-tag-slugs"],
  {
    tags: ["tags"],
    revalidate: false,
  },
);

function normalizePagePath(pathname: string): string {
  const trimmed = pathname.trim();
  if (!trimmed || trimmed === "/") return "/";

  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const normalized = withLeadingSlash.replace(/\/{2,}/g, "/");
  const withoutTrailingSlash = normalized.replace(/\/+$/g, "");

  return withoutTrailingSlash || "/";
}

function pathToSlugSegments(pathname: string): string[] {
  const normalized = normalizePagePath(pathname);
  if (normalized === "/") return [];
  return normalized.slice(1).split("/").filter(Boolean);
}

function toPositivePageSize(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.floor(value);
}

function resolvePageSizeFromConfig(config: unknown): number {
  if (!config || typeof config !== "object") {
    return 20;
  }

  const configRecord = config as Record<string, unknown>;

  const topLevelPageSize = toPositivePageSize(configRecord.pageSize);
  if (topLevelPageSize) {
    return topLevelPageSize;
  }

  const blocks = configRecord.blocks;
  if (!Array.isArray(blocks)) {
    return 20;
  }

  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;

    const content = (block as { content?: unknown }).content;
    if (!content || typeof content !== "object") continue;

    const blockPageSize = toPositivePageSize(
      (content as Record<string, unknown>).pageSize,
    );
    if (blockPageSize) {
      return blockPageSize;
    }
  }

  return 20;
}

function parseCategoryAncestorIds(pathValue: string): number[] {
  return pathValue
    .split("/")
    .map((segment) => Number.parseInt(segment, 10))
    .filter((id) => Number.isInteger(id) && id > 0);
}

function appendPaginatedPaths(
  pathSet: Set<string>,
  basePath: string,
  totalPages: number,
) {
  const normalizedBasePath = normalizePagePath(basePath);
  const safeTotalPages = Math.max(1, totalPages);

  pathSet.add(normalizedBasePath);
  for (let page = 1; page <= safeTotalPages; page++) {
    pathSet.add(`${normalizedBasePath}/page/${page}`);
  }
}

function isPageTemplate(pathname: string): boolean {
  return pathname.endsWith(PAGE_PLACEHOLDER_SEGMENT);
}

/**
 * 生成 main catch-all 路由的静态参数
 * - 仅处理 BLOCK/MDX/MARKDOWN/HTML 页面
 * - 根据页面模板自动展开 posts/tags/categories 的动态分页 slug
 */
export async function getMainRouteStaticParams(): Promise<
  MainRouteStaticParam[]
> {
  const pages = await prisma.page.findMany({
    where: {
      deletedAt: null,
      status: "ACTIVE",
      contentType: {
        in: [...STATIC_PARAM_SUPPORTED_CONTENT_TYPES],
      },
    },
    select: {
      slug: true,
      config: true,
    },
    orderBy: {
      slug: "asc",
    },
  });

  if (pages.length === 0) {
    return [{ slug: [] }];
  }

  const normalizedPages = pages.map((page) => ({
    slug: normalizePagePath(page.slug),
    config: page.config,
  }));

  const hasPostsTemplates = normalizedPages.some((page) => {
    const lowerSlug = page.slug.toLowerCase();
    return (
      lowerSlug.includes("posts") &&
      isPageTemplate(page.slug) &&
      !page.slug.includes(":slug")
    );
  });
  const hasTagTemplates = normalizedPages.some((page) => {
    const lowerSlug = page.slug.toLowerCase();
    return (
      lowerSlug.includes("tags") &&
      page.slug.includes(":slug") &&
      !page.slug.includes(":slug...")
    );
  });
  const hasCategoryTemplates = normalizedPages.some((page) => {
    const lowerSlug = page.slug.toLowerCase();
    return lowerSlug.includes("categories") && page.slug.includes(":slug...");
  });
  const needPostStats =
    hasPostsTemplates || hasTagTemplates || hasCategoryTemplates;

  const [tags, categories, publishedPosts] = await Promise.all([
    hasTagTemplates
      ? prisma.tag.findMany({
          select: { slug: true },
          orderBy: { slug: "asc" },
        })
      : Promise.resolve([] as Array<{ slug: string }>),
    hasCategoryTemplates
      ? prisma.category.findMany({
          select: { id: true, fullSlug: true, path: true },
          orderBy: { fullSlug: "asc" },
        })
      : Promise.resolve(
          [] as Array<{ id: number; fullSlug: string; path: string }>,
        ),
    needPostStats
      ? prisma.post.findMany({
          where: {
            ...LISTABLE_POST_PUBLISHED_WHERE,
          },
          select: {
            tags: { select: { slug: true } },
            categories: { select: { id: true } },
          },
        })
      : Promise.resolve(
          [] as Array<{
            tags: Array<{ slug: string }>;
            categories: Array<{ id: number }>;
          }>,
        ),
  ]);

  const tagPostCountMap = new Map<string, number>();
  if (hasTagTemplates) {
    for (const post of publishedPosts) {
      const seenTags = new Set<string>();
      for (const tag of post.tags) {
        if (seenTags.has(tag.slug)) continue;
        seenTags.add(tag.slug);
        tagPostCountMap.set(tag.slug, (tagPostCountMap.get(tag.slug) ?? 0) + 1);
      }
    }
  }

  const categoryPostCountMap = new Map<number, number>();
  if (hasCategoryTemplates) {
    const categoryAncestorsMap = new Map<number, number[]>();

    for (const category of categories) {
      const ancestorIds = parseCategoryAncestorIds(category.path);
      categoryAncestorsMap.set(category.id, [...ancestorIds, category.id]);
    }

    for (const post of publishedPosts) {
      const affectedCategoryIds = new Set<number>();

      for (const category of post.categories) {
        const categoryIds = categoryAncestorsMap.get(category.id) ?? [
          category.id,
        ];
        categoryIds.forEach((id) => affectedCategoryIds.add(id));
      }

      affectedCategoryIds.forEach((categoryId) => {
        categoryPostCountMap.set(
          categoryId,
          (categoryPostCountMap.get(categoryId) ?? 0) + 1,
        );
      });
    }
  }

  const pathnameSet = new Set<string>();

  for (const page of normalizedPages) {
    const template = page.slug;
    const lowerTemplate = template.toLowerCase();

    if (!template.includes(":")) {
      pathnameSet.add(template);
      continue;
    }

    const pageSize = resolvePageSizeFromConfig(page.config);

    if (
      lowerTemplate.includes("posts") &&
      isPageTemplate(template) &&
      !template.includes(":slug")
    ) {
      const basePath =
        template.slice(0, -PAGE_PLACEHOLDER_SEGMENT.length) || "/";
      const totalPages = Math.max(
        1,
        Math.ceil(publishedPosts.length / pageSize),
      );
      appendPaginatedPaths(pathnameSet, basePath, totalPages);
      continue;
    }

    if (
      lowerTemplate.includes("tags") &&
      template.includes(":slug") &&
      !template.includes(":slug...")
    ) {
      const isPagedTemplate = isPageTemplate(template);
      const baseTemplate = isPagedTemplate
        ? template.slice(0, -PAGE_PLACEHOLDER_SEGMENT.length)
        : template;

      for (const tag of tags) {
        const basePath = normalizePagePath(
          baseTemplate.replace(":slug", tag.slug),
        );
        if (isPagedTemplate) {
          const totalPages = Math.max(
            1,
            Math.ceil((tagPostCountMap.get(tag.slug) ?? 0) / pageSize),
          );
          appendPaginatedPaths(pathnameSet, basePath, totalPages);
        } else {
          pathnameSet.add(basePath);
        }
      }
      continue;
    }

    if (lowerTemplate.includes("categories") && template.includes(":slug...")) {
      const isPagedTemplate = isPageTemplate(template);
      const baseTemplate = isPagedTemplate
        ? template.slice(0, -PAGE_PLACEHOLDER_SEGMENT.length)
        : template;

      for (const category of categories) {
        const fullSlug = category.fullSlug.trim();
        if (!fullSlug) continue;

        const basePath = normalizePagePath(
          baseTemplate.replace(":slug...", fullSlug),
        );

        if (isPagedTemplate) {
          const totalPages = Math.max(
            1,
            Math.ceil((categoryPostCountMap.get(category.id) ?? 0) / pageSize),
          );
          appendPaginatedPaths(pathnameSet, basePath, totalPages);
        } else {
          pathnameSet.add(basePath);
        }
      }
    }
  }

  if (pathnameSet.size === 0) {
    return [{ slug: [] }];
  }

  return Array.from(pathnameSet)
    .sort((a, b) => a.localeCompare(b))
    .map((pathname) => ({
      slug: pathToSlugSegments(pathname),
    }));
}

/**
 * 生成 main catch-all 路由的顶级静态参数
 * - 仅包含首页与一级路径
 * - 对固定路径分页模板（如 /posts/page/:page）补充其基路径（/posts）
 */
export async function getMainRouteTopLevelStaticParams(): Promise<
  MainRouteStaticParam[]
> {
  const pages = await prisma.page.findMany({
    where: {
      deletedAt: null,
      status: "ACTIVE",
      contentType: {
        in: [...STATIC_PARAM_SUPPORTED_CONTENT_TYPES],
      },
    },
    select: {
      slug: true,
    },
    orderBy: {
      slug: "asc",
    },
  });

  const pathnameSet = new Set<string>(["/"]);

  for (const page of pages) {
    const normalizedPath = normalizePagePath(page.slug);
    if (normalizedPath.includes(":")) {
      const hasPageSuffix = normalizedPath.endsWith(PAGE_PLACEHOLDER_SEGMENT);
      if (!hasPageSuffix) continue;

      const templateBasePath = normalizePagePath(
        normalizedPath.slice(0, -PAGE_PLACEHOLDER_SEGMENT.length) || "/",
      );

      // 仅处理固定基路径分页模板，排除 /tags/:slug/page/:page 这类动态模板
      if (templateBasePath.includes(":")) continue;

      const baseSegments = pathToSlugSegments(templateBasePath);
      if (baseSegments.length <= 1) {
        pathnameSet.add(templateBasePath);
      }
      continue;
    }

    const slugSegments = pathToSlugSegments(normalizedPath);
    if (slugSegments.length <= 1) {
      pathnameSet.add(normalizedPath);
    }
  }

  return Array.from(pathnameSet)
    .sort((a, b) => a.localeCompare(b))
    .map((pathname) => ({
      slug: pathToSlugSegments(pathname),
    }));
}

/**
 * 基于关键词的资源存在性校验
 * 规则（简化版）：
 * - 仅当路径包含 "categories" 或 "tags" 且存在 slug 参数时才校验
 * - categories: 按层级路径查分类是否存在
 * - tags: 按 slug 查标签是否存在
 */
async function validateKeywordBoundResource(params: {
  candidatePath: string;
  pageSlug: string;
  slug?: string;
}): Promise<boolean> {
  const slug = params.slug?.trim();
  if (!slug) return true;

  const routeSignature =
    `${params.candidatePath} ${params.pageSlug}`.toLowerCase();
  const hasCategoryKeyword = routeSignature.includes("categories");
  const hasTagKeyword = routeSignature.includes("tags");

  if (hasCategoryKeyword) {
    const normalizedSlug = slug
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean)
      .join("/");

    if (!normalizedSlug) return true;

    const categoryFullSlugs = await getAllCategoryFullSlugs();
    return categoryFullSlugs.includes(normalizedSlug);
  }

  if (hasTagKeyword) {
    const tagSlugs = await getAllTagSlugs();
    return tagSlugs.includes(slug);
  }

  return true;
}

/**
 * 核心路由匹配逻辑
 * 根据 URL slug 并行查询多种可能的路径模式
 */
export async function getMatchingPage(
  slugSegments: string[] = [],
): Promise<PageMatch | null> {
  const currentPath =
    slugSegments.length > 0 ? "/" + slugSegments.join("/") : "/";

  // 1. 预处理：识别分页参数和基路径
  let pageVal = 1;
  let isExplicitPage = false;
  let basePathSegments = slugSegments;

  // 检查是否以 /page/N 结尾
  if (
    slugSegments.length >= 2 &&
    slugSegments[slugSegments.length - 2] === "page"
  ) {
    const lastSegment = slugSegments[slugSegments.length - 1];
    if (lastSegment) {
      const p = parseInt(lastSegment, 10);
      if (!isNaN(p)) {
        pageVal = p;
        isExplicitPage = true;
        basePathSegments = slugSegments.slice(0, -2);
      }
    }
  }

  const basePath =
    basePathSegments.length > 0 ? "/" + basePathSegments.join("/") : "";

  // 2. 构建候选匹配模式
  const candidates: {
    type: string;
    path: string;
    getParams: () => { page?: number; slug?: string };
  }[] = [];

  // Priority 1: 精确匹配 (Exact)
  candidates.push({
    type: "exact",
    path: currentPath,
    getParams: () => ({}),
  });

  // Priority 2: 固定基路径 + 分页 (Fixed Base + Page)
  // 覆盖显式 (/page/2) 和 隐式 (/) 分页
  // Example: /categories/design -> /categories/design/page/:page (page=1)
  const fixedPagePath = (basePath === "" ? "" : basePath) + "/page/:page";
  candidates.push({
    type: "fixed_page",
    path: fixedPagePath,
    getParams: () => ({ page: pageVal }),
  });

  // Priority 3: 通配符基路径 + 分页 (Variable Slug + Page)
  // Example: /categories/design -> /categories/:slug/page/:page (slug=design, page=1)
  if (basePathSegments.length > 0) {
    const parentSegments = basePathSegments.slice(0, -1);
    const slugValue = basePathSegments[basePathSegments.length - 1];
    const parentPath =
      parentSegments.length > 0 ? "/" + parentSegments.join("/") : "";

    const variablePagePath = parentPath + "/:slug/page/:page";

    candidates.push({
      type: "variable_slug_page",
      path: variablePagePath,
      getParams: () => ({ page: pageVal, slug: slugValue }),
    });
  }

  // Priority 4: 纯通配符 (Variable Slug)
  // Example: /posts/hello-world -> /posts/:slug (slug=hello-world)
  // 仅在非显式分页时尝试，避免 /page/2 被误认为 slug
  if (!isExplicitPage && slugSegments.length > 0) {
    const parentSegments = slugSegments.slice(0, -1);
    const slugValue = slugSegments[slugSegments.length - 1];
    const parentPath =
      parentSegments.length > 0 ? "/" + parentSegments.join("/") : "";

    const variableSlugPath = parentPath + "/:slug";

    candidates.push({
      type: "variable_slug",
      path: variableSlugPath,
      getParams: () => ({ slug: slugValue }),
    });
  }

  // Priority 5: 捕获所有 (Catch-all)
  // Example: /categories/a/b/c -> /categories/:slug... (slug=a/b/c)
  // 支持 /:slug... 和 /:slug.../page/:page
  // 从最长匹配开始尝试，以保证优先级 (Specific > Generic)
  // 优化: 限制最大查找深度为 3 层 (即只检查根路径长度为 0, 1, 2 的情况)
  // 防止恶意长路径导致大量数据库查询 (DoS 风险)
  const maxCatchAllDepth = 2; // 0, 1, 2 共三层
  const startDepth = Math.min(basePathSegments.length - 1, maxCatchAllDepth);

  for (let i = startDepth; i >= 0; i--) {
    const rootSegments = basePathSegments.slice(0, i);
    const catchAllSegments = basePathSegments.slice(i);
    const slugValue = catchAllSegments.join("/");

    const rootPath =
      rootSegments.length > 0 ? "/" + rootSegments.join("/") : "";

    // 5.1: Catch-all + Page
    // Example: /categories/:slug.../page/:page
    const catchAllPagePath = rootPath + "/:slug.../page/:page";
    candidates.push({
      type: "catch_all_page",
      path: catchAllPagePath,
      getParams: () => ({ page: pageVal, slug: slugValue }),
    });

    // 5.2: Catch-all (仅在非显式分页时尝试)
    // Example: /categories/:slug...
    if (!isExplicitPage) {
      const catchAllPath = rootPath + "/:slug...";
      candidates.push({
        type: "catch_all",
        path: catchAllPath,
        getParams: () => ({ slug: slugValue }),
      });
    }
  }

  // 3. 并行查询 (利用 getRawPage 的缓存)
  // 提取所有可能的 path
  const distinctPaths = Array.from(new Set(candidates.map((c) => c.path)));

  // 并行调用 getRawPage
  const pageResults = await Promise.all(
    distinctPaths.map(async (path) => {
      try {
        const page = await getRawPage(path);
        // 确保页面存在且状态为 ACTIVE 且未删除
        if (page && page.status === "ACTIVE" && !page.deletedAt) {
          return page;
        }
        return null;
      } catch (error) {
        console.error(`Failed to fetch page for path ${path}:`, error);
        return null;
      }
    }),
  );

  // 构建 Map (slug -> PageItem)
  const pageMap = new Map<string, PageItem>();
  pageResults.forEach((page) => {
    if (page) {
      pageMap.set(page.slug, page);
    }
  });

  // 4. 按优先级匹配
  // 这里的顺序很重要，必须与 candidates 的 push 顺序一致
  // 因为 candidates 数组本身是有序的，所以直接遍历查找即可
  for (const candidate of candidates) {
    const page = pageMap.get(candidate.path);
    if (page) {
      const resolvedParams = candidate.getParams();
      const isValid = await validateKeywordBoundResource({
        candidatePath: candidate.path,
        pageSlug: page.slug,
        slug: resolvedParams.slug,
      });

      if (!isValid) {
        continue;
      }

      return {
        page,
        params: {
          url: currentPath,
          ...resolvedParams,
        },
      };
    }
  }

  return null;
}

/**
 * 获取原始页面项
 * - 如果缓存文件存在，从缓存文件读取（构建阶段）
 * - 否则使用 unstable_cache 从数据库读取（开发/生产环境）
 */
export async function getRawPage(slug: string): Promise<PageItem | null> {
  // 开发环境：跳过文件缓存，直接从数据库读取
  if (process.env.NODE_ENV !== "production") {
    // 先从数据库读取页面，获取 id
    const page = await getPageFromDatabase(slug);
    if (!page) return null;

    // 使用 id 作为缓存标签
    const getCachedData = unstable_cache(
      async () => {
        return page; // 直接返回已读取的页面
      },
      [`page-${slug}`],
      {
        tags: ["pages", `pages/${page.id}`],
        revalidate: false,
      },
    );
    return await getCachedData();
  }

  // 生产环境：如果缓存文件存在，从缓存读取（构建阶段）
  if (
    process.env.NEUTRALPRESS_BUILD_CACHE_SNAPSHOT === "1" &&
    fs.existsSync(CACHE_FILE_PATH)
  ) {
    const page = getPageFromCache(slug);
    if (page) {
      return page;
    }
  }

  // 缓存文件不存在或未找到页面，使用 unstable_cache 从数据库读取
  const page = await getPageFromDatabase(slug);
  if (!page) return null;

  const getCachedData = unstable_cache(
    async () => {
      return page;
    },
    [`page-${slug}`],
    {
      tags: ["pages", `pages/${page.id}`],
      revalidate: false,
    },
  );

  return await getCachedData();
}

/**
 * 通过 ID 获取原始页面项
 */
export async function getRawPageById(id: string): Promise<PageItem | null> {
  // 开发环境：跳过文件缓存，直接从数据库读取
  if (process.env.NODE_ENV !== "production") {
    const getCachedData = unstable_cache(
      async (pageId: string) => {
        return await getPageByIdFromDatabase(pageId);
      },
      [`page-id-${id}`],
      {
        tags: ["pages", `pages/${id}`],
        revalidate: false,
      },
    );
    return await getCachedData(id);
  }

  // 生产环境：如果缓存文件存在，从缓存读取（构建阶段）
  if (
    process.env.NEUTRALPRESS_BUILD_CACHE_SNAPSHOT === "1" &&
    fs.existsSync(CACHE_FILE_PATH)
  ) {
    const page = getPageByIdFromCache(id);
    if (page) {
      return page;
    }
  }

  // 缓存文件不存在或未找到页面，使用 unstable_cache 从数据库读取
  const getCachedData = unstable_cache(
    async (pageId: string) => {
      return await getPageByIdFromDatabase(pageId);
    },
    [`page-id-${id}`],
    {
      tags: ["pages", `pages/${id}`],
      revalidate: false,
    },
  );

  return await getCachedData(id);
}

/**
 * 获取页面配置值的辅助函数
 */
async function getPageConfigValue(
  slug: string,
  defaultValue?: unknown,
  field?: string,
): Promise<unknown> {
  const page = await getRawPage(slug);

  // 如果页面不存在,返回默认值
  if (!page?.config) {
    return defaultValue;
  }

  const pageConfig = page.config;

  // 如果指定了字段名且配置值是对象,尝试获取指定字段
  if (field && typeof pageConfig === "object" && pageConfig !== null) {
    return (pageConfig as CustomJsonObject)[field] ?? defaultValue;
  }

  // 如果配置值是对象,返回整个对象
  if (typeof pageConfig === "object" && pageConfig !== null) {
    return pageConfig;
  }

  // 返回配置值本身
  return pageConfig;
}

/**
 * 获取页面配置(带泛型支持)
 * @param slug 页面 slug
 * @param defaultValue 默认值
 * @param field 可选的字段名,用于从对象配置中获取特定字段
 * @returns 配置值
 */
export async function getPageConfig<T = unknown>(
  slug: string,
  defaultValue?: T,
  field?: string,
): Promise<T> {
  const value = await getPageConfigValue(slug, defaultValue, field);
  return value as T;
}

/**
 * 获取系统页面配置（类型安全）
 * @param page 页面对象（来自 getRawPage 的结果）
 * @returns 系统页面配置对象
 */
export function getSystemPageConfig(
  page: PageItem | null,
): SystemPageConfig | null {
  if (!page?.config || typeof page.config !== "object") {
    return null;
  }

  // 检查是否为 SystemPageConfig 类型
  const config = page.config as CustomJsonObject;

  if (config.blocks || config.components) {
    return {
      blocks: config.blocks as AllBlockConfigs[] | undefined,
      components: config.components as PageComponent[] | undefined,
    };
  }

  return null;
}

/**
 * 从数据库获取页面
 */
async function getPageFromDatabase(slug: string): Promise<PageItem | null> {
  try {
    const { default: prisma } = await import("./prisma");
    const page = await prisma.page.findUnique({
      where: {
        slug,
        deletedAt: null, // 确保不返回已删除的页面
      },
      include: {
        author: {
          select: {
            uid: true,
            username: true,
            nickname: true,
            avatar: true,
          },
        },
      },
    });

    if (!page) {
      return null;
    }

    return {
      id: page.id,
      title: page.title,
      slug: page.slug,
      content: page.content,
      contentType: page.contentType as
        | "MARKDOWN"
        | "HTML"
        | "MDX"
        | "BLOCK"
        | "BUILDIN",
      config: page.config as PageConfig,
      status: page.status as "ACTIVE" | "SUSPENDED",
      deletedAt: page.deletedAt,
      createdAt: page.createdAt,
      updatedAt: page.updatedAt,
      isSystemPage: page.isSystemPage,
      metaDescription: page.metaDescription,
      metaKeywords: page.metaKeywords,
      robotsIndex: page.robotsIndex,
      userUid: page.userUid,
    };
  } catch (error) {
    console.error("从数据库获取页面失败:", error);
    return null;
  }
}

/**
 * 从数据库通过 ID 获取页面
 */
async function getPageByIdFromDatabase(id: string): Promise<PageItem | null> {
  try {
    const { default: prisma } = await import("./prisma");
    const page = await prisma.page.findUnique({
      where: {
        id,
        deletedAt: null, // 确保不返回已删除的页面
      },
      include: {
        author: {
          select: {
            uid: true,
            username: true,
            nickname: true,
            avatar: true,
          },
        },
      },
    });

    if (!page) {
      return null;
    }

    return {
      id: page.id,
      title: page.title,
      slug: page.slug,
      content: page.content,
      contentType: page.contentType as
        | "MARKDOWN"
        | "HTML"
        | "MDX"
        | "BLOCK"
        | "BUILDIN",
      config: page.config as PageConfig,
      status: page.status as "ACTIVE" | "SUSPENDED",
      deletedAt: page.deletedAt,
      createdAt: page.createdAt,
      updatedAt: page.updatedAt,
      isSystemPage: page.isSystemPage,
      metaDescription: page.metaDescription,
      metaKeywords: page.metaKeywords,
      robotsIndex: page.robotsIndex,
      userUid: page.userUid,
    };
  } catch (error) {
    console.error("从数据库获取页面失败:", error);
    return null;
  }
}

/**
 * 从缓存文件获取页面
 */
function getPageFromCache(slug: string): PageItem | null {
  try {
    if (!fs.existsSync(CACHE_FILE_PATH)) {
      console.warn("页面缓存文件不存在:", CACHE_FILE_PATH);
      return null;
    }

    const cacheData = fs.readFileSync(CACHE_FILE_PATH, "utf-8");
    const pages: Record<string, PageItem> = JSON.parse(cacheData);

    const page = pages[slug];
    if (!page) {
      return null;
    }

    // 确保 updatedAt 和 deletedAt 是 Date 对象
    return {
      ...page,
      deletedAt: page.deletedAt ? new Date(page.deletedAt) : null,
      createdAt: new Date(page.createdAt),
      updatedAt: new Date(page.updatedAt),
    };
  } catch (error) {
    console.error("从缓存文件读取页面失败:", error);
    return null;
  }
}

/**
 * 从缓存文件通过 ID 获取页面
 */
function getPageByIdFromCache(id: string): PageItem | null {
  try {
    if (!fs.existsSync(CACHE_FILE_PATH)) {
      console.warn("页面缓存文件不存在:", CACHE_FILE_PATH);
      return null;
    }

    const cacheData = fs.readFileSync(CACHE_FILE_PATH, "utf-8");
    const pages: Record<string, PageItem> = JSON.parse(cacheData);

    // 通过 ID 查找页面
    const page = Object.values(pages).find((p) => p.id === id);
    if (!page) {
      return null;
    }

    // 确保 updatedAt 和 deletedAt 是 Date 对象
    return {
      ...page,
      deletedAt: page.deletedAt ? new Date(page.deletedAt) : null,
      createdAt: new Date(page.createdAt),
      updatedAt: new Date(page.updatedAt),
    };
  } catch (error) {
    console.error("从缓存文件读取页面失败:", error);
    return null;
  }
}

/**
 * 获取所有活跃页面（主要用于客户端）
 * 只返回 ACTIVE 状态且未删除的页面
 */
export async function getAllActivePages(): Promise<Record<string, PageItem>> {
  // 开发环境：跳过文件缓存，直接从数据库读取
  if (process.env.NODE_ENV !== "production") {
    const getCachedData = unstable_cache(
      async () => {
        const allPages = await getAllPagesFromDatabase();
        return filterActivePages(allPages);
      },
      ["all-active-pages"],
      {
        tags: ["pages"],
        revalidate: false,
      },
    );
    return await getCachedData();
  }

  // 生产环境：如果缓存文件存在，从缓存读取（构建阶段）
  if (
    process.env.NEUTRALPRESS_BUILD_CACHE_SNAPSHOT === "1" &&
    fs.existsSync(CACHE_FILE_PATH)
  ) {
    const allPages = getAllPagesFromCache();
    if (Object.keys(allPages).length > 0) {
      return filterActivePages(allPages);
    }
  }

  // 缓存文件不存在或为空，使用 unstable_cache 从数据库读取
  const getCachedData = unstable_cache(
    async () => {
      const allPages = await getAllPagesFromDatabase();
      return filterActivePages(allPages);
    },
    ["all-active-pages"],
    {
      tags: ["pages"],
      revalidate: false,
    },
  );

  return await getCachedData();
}

/**
 * 过滤活跃页面
 * 只返回 ACTIVE 状态且未删除的页面
 */
function filterActivePages(
  pages: Record<string, PageItem>,
): Record<string, PageItem> {
  const filteredPages: Record<string, PageItem> = {};

  Object.entries(pages).forEach(([slug, page]) => {
    // 跳过已删除、非活跃状态的页面
    if (page.deletedAt || page.status !== "ACTIVE") {
      return;
    }

    filteredPages[slug] = page;
  });

  return filteredPages;
}

/**
 * 从数据库获取所有页面
 */
async function getAllPagesFromDatabase(): Promise<Record<string, PageItem>> {
  try {
    const { default: prisma } = await import("./prisma");
    const pages = await prisma.page.findMany({
      where: {
        deletedAt: null, // 不返回已删除的页面
      },
      orderBy: { title: "asc" },
      include: {
        author: {
          select: {
            uid: true,
            username: true,
            nickname: true,
            avatar: true,
          },
        },
      },
    });

    const result: Record<string, PageItem> = {};

    pages.forEach(
      (page: {
        id: string;
        title: string;
        slug: string;
        content: string;
        contentType: string;
        config: unknown;
        status: string;
        deletedAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
        isSystemPage: boolean;
        metaDescription: string | null;
        metaKeywords: string | null;
        robotsIndex: boolean;
        userUid: number | null;
      }) => {
        result[page.slug] = {
          id: page.id,
          title: page.title,
          slug: page.slug,
          content: page.content,
          contentType: page.contentType as
            | "MARKDOWN"
            | "HTML"
            | "MDX"
            | "BLOCK"
            | "BUILDIN",
          config: page.config as PageConfig,
          status: page.status as "ACTIVE" | "SUSPENDED",
          deletedAt: page.deletedAt,
          createdAt: page.createdAt,
          updatedAt: page.updatedAt,
          isSystemPage: page.isSystemPage,
          metaDescription: page.metaDescription,
          metaKeywords: page.metaKeywords,
          robotsIndex: page.robotsIndex,
          userUid: page.userUid,
        };
      },
    );

    return result;
  } catch (error) {
    console.error("从数据库获取所有页面失败:", error);
    return {};
  }
}

/**
 * 从缓存文件获取所有页面
 */
function getAllPagesFromCache(): Record<string, PageItem> {
  try {
    if (!fs.existsSync(CACHE_FILE_PATH)) {
      console.warn("页面缓存文件不存在:", CACHE_FILE_PATH);
      return {};
    }

    const cacheData = fs.readFileSync(CACHE_FILE_PATH, "utf-8");
    const pages: Record<string, PageItem> = JSON.parse(cacheData);

    // 确保所有日期字段都是 Date 对象
    const result: Record<string, PageItem> = {};

    Object.entries(pages).forEach(([slug, page]) => {
      result[slug] = {
        ...page,
        deletedAt: page.deletedAt ? new Date(page.deletedAt) : null,
        createdAt: new Date(page.createdAt),
        updatedAt: new Date(page.updatedAt),
      };
    });

    return result;
  } catch (error) {
    console.error("从缓存文件读取所有页面失败:", error);
    return {};
  }
}

/**
 * 根据状态获取页面
 */
export async function getPagesByStatus(
  status: "ACTIVE" | "SUSPENDED",
): Promise<Record<string, PageItem>> {
  // 开发环境：跳过文件缓存，直接从数据库读取
  if (process.env.NODE_ENV !== "production") {
    const getCachedData = unstable_cache(
      async (s: "ACTIVE" | "SUSPENDED") => {
        const allPages = await getAllPagesFromDatabase();
        const filteredPages: Record<string, PageItem> = {};

        Object.entries(allPages).forEach(([slug, page]) => {
          // 跳过已删除的页面
          if (page.deletedAt) {
            return;
          }

          // 只返回指定状态的页面
          if (page.status === s) {
            filteredPages[slug] = page;
          }
        });

        return filteredPages;
      },
      [`pages-by-status-${status}`],
      {
        tags: ["pages"],
        revalidate: false,
      },
    );
    return await getCachedData(status);
  }

  // 生产环境：如果缓存文件存在，从缓存读取（构建阶段）
  if (
    process.env.NEUTRALPRESS_BUILD_CACHE_SNAPSHOT === "1" &&
    fs.existsSync(CACHE_FILE_PATH)
  ) {
    const allPages = getAllPagesFromCache();
    if (Object.keys(allPages).length > 0) {
      const filteredPages: Record<string, PageItem> = {};

      Object.entries(allPages).forEach(([slug, page]) => {
        // 跳过已删除的页面
        if (page.deletedAt) {
          return;
        }

        // 只返回指定状态的页面
        if (page.status === status) {
          filteredPages[slug] = page;
        }
      });

      return filteredPages;
    }
  }

  // 缓存文件不存在或为空，使用 unstable_cache 从数据库读取
  const getCachedData = unstable_cache(
    async (s: "ACTIVE" | "SUSPENDED") => {
      const allPages = await getAllPagesFromDatabase();
      const filteredPages: Record<string, PageItem> = {};

      Object.entries(allPages).forEach(([slug, page]) => {
        // 跳过已删除的页面
        if (page.deletedAt) {
          return;
        }

        // 只返回指定状态的页面
        if (page.status === s) {
          filteredPages[slug] = page;
        }
      });

      return filteredPages;
    },
    [`pages-by-status-${status}`],
    {
      tags: ["pages"],
      revalidate: false,
    },
  );

  return await getCachedData(status);
}

/**
 * 获取系统页面
 */
export async function getSystemPages(): Promise<Record<string, PageItem>> {
  // 开发环境：跳过文件缓存，直接从数据库读取
  if (process.env.NODE_ENV !== "production") {
    const getCachedData = unstable_cache(
      async () => {
        const allPages = await getAllPagesFromDatabase();
        const systemPages: Record<string, PageItem> = {};

        Object.entries(allPages).forEach(([slug, page]) => {
          // 跳过已删除、非活跃状态、非系统页面的页面
          if (
            page.deletedAt ||
            page.status !== "ACTIVE" ||
            !page.isSystemPage
          ) {
            return;
          }

          systemPages[slug] = page;
        });

        return systemPages;
      },
      ["system-pages"],
      {
        tags: ["pages"],
        revalidate: false,
      },
    );
    return await getCachedData();
  }

  // 生产环境：如果缓存文件存在，从缓存读取（构建阶段）
  if (
    process.env.NEUTRALPRESS_BUILD_CACHE_SNAPSHOT === "1" &&
    fs.existsSync(CACHE_FILE_PATH)
  ) {
    const allPages = getAllPagesFromCache();
    if (Object.keys(allPages).length > 0) {
      const systemPages: Record<string, PageItem> = {};

      Object.entries(allPages).forEach(([slug, page]) => {
        // 跳过已删除、非活跃状态、非系统页面的页面
        if (page.deletedAt || page.status !== "ACTIVE" || !page.isSystemPage) {
          return;
        }

        systemPages[slug] = page;
      });

      return systemPages;
    }
  }

  // 缓存文件不存在或为空，使用 unstable_cache 从数据库读取
  const getCachedData = unstable_cache(
    async () => {
      const allPages = await getAllPagesFromDatabase();
      const systemPages: Record<string, PageItem> = {};

      Object.entries(allPages).forEach(([slug, page]) => {
        // 跳过已删除、非活跃状态、非系统页面的页面
        if (page.deletedAt || page.status !== "ACTIVE" || !page.isSystemPage) {
          return;
        }

        systemPages[slug] = page;
      });

      return systemPages;
    },
    ["system-pages"],
    {
      tags: ["pages"],
      revalidate: false,
    },
  );

  return await getCachedData();
}

/**
 * 获取用户创建的页面
 */
export async function getPagesByUser(
  userUid: number,
): Promise<Record<string, PageItem>> {
  // 开发环境：跳过文件缓存，直接从数据库读取
  if (process.env.NODE_ENV !== "production") {
    const getCachedData = unstable_cache(
      async (uid: number) => {
        const allPages = await getAllPagesFromDatabase();
        const userPages: Record<string, PageItem> = {};

        Object.entries(allPages).forEach(([slug, page]) => {
          // 跳过已删除的页面和系统页面
          if (page.deletedAt || page.isSystemPage) {
            return;
          }

          // 只返回指定用户的页面
          if (page.userUid === uid) {
            userPages[slug] = page;
          }
        });

        return userPages;
      },
      [`pages-by-user-${userUid}`],
      {
        tags: ["pages"],
        revalidate: false,
      },
    );
    return await getCachedData(userUid);
  }

  // 生产环境：如果缓存文件存在，从缓存读取（构建阶段）
  if (
    process.env.NEUTRALPRESS_BUILD_CACHE_SNAPSHOT === "1" &&
    fs.existsSync(CACHE_FILE_PATH)
  ) {
    const allPages = getAllPagesFromCache();
    if (Object.keys(allPages).length > 0) {
      const userPages: Record<string, PageItem> = {};

      Object.entries(allPages).forEach(([slug, page]) => {
        // 跳过已删除的页面和系统页面
        if (page.deletedAt || page.isSystemPage) {
          return;
        }

        // 只返回指定用户的页面
        if (page.userUid === userUid) {
          userPages[slug] = page;
        }
      });

      return userPages;
    }
  }

  // 缓存文件不存在或为空，使用 unstable_cache 从数据库读取
  const getCachedData = unstable_cache(
    async (uid: number) => {
      const allPages = await getAllPagesFromDatabase();
      const userPages: Record<string, PageItem> = {};

      Object.entries(allPages).forEach(([slug, page]) => {
        // 跳过已删除的页面和系统页面
        if (page.deletedAt || page.isSystemPage) {
          return;
        }

        // 只返回指定用户的页面
        if (page.userUid === uid) {
          userPages[slug] = page;
        }
      });

      return userPages;
    },
    [`pages-by-user-${userUid}`],
    {
      tags: ["pages"],
      revalidate: false,
    },
  );

  return await getCachedData(userUid);
}

/**
 * 获取 block 的动态 areas
 * 根据 header 和 footer 的存在情况动态调整 areas
 * - 如果存在 header，就不包含 area 1
 * - 如果存在 footer，就不包含 area 12
 * - 否则就是 [1,...,12]
 *
 * @param hasHeader 是否存在 header
 * @param hasFooter 是否存在 footer
 * @returns areas 数组
 */
export function getBlocksAreas(
  hasHeader: boolean,
  hasFooter: boolean,
): (1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12)[] {
  if (hasHeader && hasFooter) {
    return [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  }

  if (hasHeader) {
    return [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  }

  if (hasFooter) {
    return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  }

  return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
}

/**
 * 从配置对象中获取指定 ID 的 block
 */
export function getPageBlock(
  config: SystemPageConfig | null,
  blockId: number | string,
): AllBlockConfigs | null {
  if (!config?.blocks) {
    return null;
  }

  const block = config.blocks.find(
    (block) => String(block.id) === String(blockId),
  );
  return block || null;
}

/**
 * 从配置对象中获取指定 ID 的 component
 */
export function getPageComponent(
  config: SystemPageConfig | null,
  componentId: string,
): PageComponent | null {
  if (!config?.components) {
    return null;
  }

  const component = config.components.find(
    (component) => component.id === componentId,
  );
  return component || null;
}

/**
 * 获取 block 的字段值 (支持新结构)
 */
export function getPageBlockValue<T = unknown>(
  config: SystemPageConfig | null,
  blockId: number | string,
  fieldPath: string,
  defaultValue?: T,
): T | null {
  const block = getPageBlock(config, blockId);

  if (!block) {
    return defaultValue ?? null;
  }

  try {
    const pathParts = fieldPath.split(".");
    let currentValue: unknown = block.content;

    for (const part of pathParts) {
      if (
        currentValue &&
        typeof currentValue === "object" &&
        part in currentValue
      ) {
        currentValue = (currentValue as Record<string, unknown>)[part];
      } else {
        return defaultValue ?? null;
      }
    }

    return currentValue as T;
  } catch (error) {
    console.error(`获取页面 block 字段值失败: ${fieldPath}`, error);
    return defaultValue ?? null;
  }
}

/**
 * 获取 component 的字段值
 */
export function getPageComponentValue<T = unknown>(
  config: SystemPageConfig | null,
  componentId: string,
  fieldPath: string,
  defaultValue?: T,
): T | null {
  const component = getPageComponent(config, componentId);

  if (!component) {
    return defaultValue ?? null;
  }

  try {
    const pathParts = fieldPath.split(".");
    let currentValue: unknown = component.value;

    for (const part of pathParts) {
      if (
        currentValue &&
        typeof currentValue === "object" &&
        part in currentValue
      ) {
        currentValue = (currentValue as Record<string, unknown>)[part];
      } else {
        return defaultValue ?? null;
      }
    }

    return currentValue as T;
  } catch (error) {
    console.error(`获取页面 component 字段值失败: ${fieldPath}`, error);
    return defaultValue ?? null;
  }
}

/**
 * 页面配置构建器类
 */
export class PageConfigBuilder {
  constructor(private config: SystemPageConfig | null) {}

  getBlock(blockId: number | string) {
    return getPageBlock(this.config, blockId);
  }

  getBlockValue<T = unknown>(
    blockId: number | string,
    fieldPath: string,
    defaultValue?: T,
  ): T | null {
    return getPageBlockValue(this.config, blockId, fieldPath, defaultValue);
  }

  getComponentValue<T = unknown>(
    componentId: string,
    fieldPath: string,
    defaultValue?: T,
  ): T | null {
    return getPageComponentValue(
      this.config,
      componentId,
      fieldPath,
      defaultValue,
    );
  }

  // === 快捷方法 (适配新数据结构) ===

  getBlockTitle(blockId: number | string, defaultValue: string = ""): string {
    return (
      this.getBlockValue<string>(blockId, "title.value", defaultValue) ??
      defaultValue
    );
  }

  getBlockHeader(blockId: number | string, defaultValue: string = ""): string {
    return (
      this.getBlockValue<string>(blockId, "header.value", defaultValue) ??
      defaultValue
    );
  }

  getBlockContent(
    blockId: number | string,
    field: "top" | "bottom" = "top",
    defaultValue: string[] = [],
  ): string[] {
    return (
      this.getBlockValue<string[]>(
        blockId,
        `content.${field}.value`,
        defaultValue,
      ) ?? defaultValue
    );
  }

  getBlockFooterLink(
    blockId: number | string,
    defaultValue: string = "",
  ): string {
    return (
      this.getBlockValue<string>(blockId, "footer.link", defaultValue) ??
      defaultValue
    );
  }

  getBlockFooterText(
    blockId: number | string,
    defaultValue: string = "",
  ): string {
    return (
      this.getBlockValue<string>(blockId, "footer.text", defaultValue) ??
      defaultValue
    );
  }

  /**
   * 检查指定 block 是否存在
   */
  isBlockEnabled(blockId: number | string): boolean {
    const block = this.getBlock(blockId);
    return !!block;
  }
}

export function createPageConfigBuilder(
  config: SystemPageConfig | null,
): PageConfigBuilder {
  return new PageConfigBuilder(config);
}
