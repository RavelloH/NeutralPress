// SEO 相关库
import type { Metadata } from "next";
import { unstable_cache } from "next/cache";

import { findCategoryByPath } from "@/lib/server/category-utils";
import { getConfigs } from "@/lib/server/config-cache";
import { LISTABLE_POST_PUBLISHED_WHERE } from "@/lib/server/post-access";
import prisma from "@/lib/server/prisma";

// 基础静态配置（不依赖数据库的固定值）
const STATIC_METADATA = {
  generator: "NeutralPress",
  referrer: "strict-origin-when-cross-origin" as const,
  classification: "CMS",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  alternates: {
    types: {
      "application/rss+xml": "/feed.xml",
      "application/feed+json": "/feed.json",
    },
  },
  robots: {
    index: true,
    follow: true,
    nocache: false,
    googleBot: {
      index: true,
      follow: true,
      noimageindex: false,
      "max-video-preview": -1,
      "max-image-preview": "large" as const,
      "max-snippet": -1,
    },
  },
  icons: {
    icon: [
      { url: "/icon/16x", sizes: "16x16", type: "image/png" },
      { url: "/icon/32x", sizes: "32x32", type: "image/png" },
      { url: "/icon/96x", sizes: "96x96", type: "image/png" },
    ],
    shortcut: "/icon/16x",
    apple: [
      { url: "/icon/144x", sizes: "144x144", type: "image/png" },
      { url: "/icon/192x", sizes: "192x192", type: "image/png" },
    ],
    other: [
      { rel: "icon", url: "/icon/48x", sizes: "48x48", type: "image/png" },
      { rel: "icon", url: "/icon/72x", sizes: "72x72", type: "image/png" },
      { rel: "icon", url: "/icon/128x", sizes: "128x128", type: "image/png" },
      { rel: "icon", url: "/icon/256x", sizes: "256x256", type: "image/png" },
      { rel: "icon", url: "/icon/384x", sizes: "384x384", type: "image/png" },
      { rel: "icon", url: "/icon/512x", sizes: "512x512", type: "image/png" },
    ],
  },
  manifest: "/manifest.webmanifest",
  verification: {
    google: "",
    yandex: "",
    yahoo: "",
    other: { me: [""] },
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

// SEO配置映射表
const seoConfigMap = {
  metadataBase: "site.url",
  title: "site.title",
  subtitle: "site.subtitle",
  titleTemplate: "site.title.template",
  description: "seo.description",
  keywords: "seo.keywords",
  author: "author.name",
  twitterSite: "seo.twitter_site",
  twitterCreator: "seo.twitter_creator",
  googleVerification: "seo.google_verification",
  category: "seo.category",
  country: "seo.country",
  imageCardEnable: "seo.imageCard.enable",
  indexEnable: "seo.index.enable",
} as const;

// JSON-LD 类型定义
export type JsonLdPageKind =
  | "site"
  | "webpage"
  | "article"
  | "project"
  | "gallery"
  | "photo";

export interface JsonLdNode extends Record<string, unknown> {
  "@id"?: string;
  "@type"?: string | string[];
}

export type JsonLdGraph = JsonLdNode[];

export interface JsonLdBreadcrumbItem {
  name: string;
  item?: string;
}

export interface JsonLdImage {
  url: string;
  width?: number;
  height?: number;
  alt?: string;
}

export interface JsonLdAuthor {
  name: string;
  url?: string;
  type?: "Person" | "Organization";
}

export interface JsonLdGalleryItem {
  name?: string;
  url: string;
  image?: string | JsonLdImage;
  description?: string;
}

export interface JsonLdItemListEntry {
  name: string;
  url: string;
  description?: string;
  image?: string | JsonLdImage;
  datePublished?: Date | string | null;
  dateModified?: Date | string | null;
  authors?: JsonLdAuthor[];
}

export interface JsonLdMenuNavigationItem {
  name: string;
  slug?: string | null;
  link?: string | null;
  page?: {
    slug?: string | null;
  } | null;
}

export interface JsonLdGraphInput {
  kind: JsonLdPageKind;
  pathname?: string;
  title?: string;
  description?: string;
  keywords?: string[] | string | null;
  robots?: Metadata["robots"];
  breadcrumb?: JsonLdBreadcrumbItem[];
  publishedAt?: Date | string | null;
  updatedAt?: Date | string | null;
  authors?: JsonLdAuthor[];
  images?: Array<string | JsonLdImage>;
  includeWebSite?: boolean;
  includeOrganization?: boolean;
  pageType?: "WebPage" | "CollectionPage";
  article?: {
    section?: string;
    tags?: string[];
  };
  project?: {
    links?: string[];
    categories?: string[];
    techStack?: string[];
  };
  gallery?: {
    items?: JsonLdGalleryItem[];
  };
  photo?: {
    caption?: string | null;
  };
  itemList?: {
    idSuffix?: string;
    name?: string;
    itemType?: "BlogPosting" | "CreativeWork" | "WebPage";
    items?: JsonLdItemListEntry[];
  };
}

function toPlainSerializable(value: unknown): unknown {
  if (value instanceof URL) {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => toPlainSerializable(item));
  }

  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      result[key] = toPlainSerializable(nested);
    }
    return result;
  }

  return value;
}

// 辅助函数：获取字符串配置值
export function getStringValue(
  configValue: unknown,
  fallback: string = "",
): string {
  return typeof configValue === "string" ? configValue : fallback;
}

// 辅助函数：获取字符串数组配置值
export function getStringArrayValue(
  configValue: unknown,
  fallback: string[] = [],
): string[] {
  if (Array.isArray(configValue)) return configValue;
  if (typeof configValue === "string") {
    return configValue.split(",").map((k) => k.trim());
  }
  return fallback;
}

// 辅助函数：获取布尔配置值
export function getBooleanValue(
  configValue: unknown,
  fallback: boolean = false,
): boolean {
  return typeof configValue === "boolean" ? configValue : fallback;
}

export function parseMetadataBase(url: string): URL | undefined {
  const normalized = url.trim();
  if (!normalized) return undefined;

  try {
    return new URL(normalized);
  } catch {
    console.warn(`[SEO] Invalid site.url config: ${normalized}`);
    return undefined;
  }
}

export function normalizeCanonicalPath(pathname: string): string {
  let normalized = pathname.trim();
  if (!normalized) return "/";

  normalized = normalized.startsWith("/") ? normalized : `/${normalized}`;
  normalized = normalized.replace(/\/{2,}/g, "/");
  normalized = normalized.replace(/\/+$/, "");
  normalized = normalized.replace(/\/page\/1$/i, "");

  return normalized || "/";
}

export function normalizePathname(pathname?: string): string | undefined {
  if (!pathname) return undefined;

  const normalized = pathname.trim();
  if (!normalized) return undefined;
  if (/^https?:\/\//i.test(normalized)) {
    try {
      const parsed = new URL(normalized);
      parsed.pathname = normalizeCanonicalPath(parsed.pathname);
      return parsed.toString();
    } catch {
      console.warn(`[SEO] Invalid absolute pathname: ${normalized}`);
      return undefined;
    }
  }

  return normalizeCanonicalPath(normalized);
}

function buildOpenGraphUrl(
  metadataBase: URL | undefined,
  pathname: string | undefined,
): string | undefined {
  if (!pathname) return undefined;

  try {
    if (/^https?:\/\//i.test(pathname)) {
      return new URL(pathname).toString();
    }

    if (!metadataBase) return undefined;
    return new URL(pathname, metadataBase).toString();
  } catch {
    console.warn(
      `[SEO] Failed to build openGraph.url for pathname: ${pathname}`,
    );
    return undefined;
  }
}

function buildCanonicalUrl(
  metadataBase: URL | undefined,
  pathname: string | undefined,
): string | undefined {
  if (!pathname) return undefined;

  try {
    if (/^https?:\/\//i.test(pathname)) {
      return new URL(pathname).toString();
    }

    if (!metadataBase) return undefined;
    return new URL(pathname, metadataBase).toString();
  } catch {
    console.warn(`[SEO] Failed to build canonical for pathname: ${pathname}`);
    return undefined;
  }
}

function buildSocialImageUrl(
  metadataBase: URL | undefined,
  pathname?: string,
): string | undefined {
  if (!metadataBase) return undefined;

  try {
    const normalizedPath = pathname
      ? normalizeCanonicalPath(extractPathnameForRule(pathname))
      : "/";
    const slugSegments = normalizedPath
      .split("/")
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment));
    const relativePath = `/social-image${
      slugSegments.length > 0 ? `/${slugSegments.join("/")}` : ""
    }`;
    const imageUrl = new URL(relativePath, metadataBase);

    return imageUrl.toString();
  } catch {
    console.warn("[SEO] Failed to build social image url");
    return undefined;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof URL)
  );
}

export function deepMergeMetadataValue(
  base: unknown,
  override: unknown,
): unknown {
  if (override === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(override)) return override;

  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    merged[key] = deepMergeMetadataValue(merged[key], value);
  }

  return merged;
}

const DEEP_MERGE_METADATA_KEYS = [
  "alternates",
  "robots",
  "openGraph",
  "twitter",
  "verification",
  "other",
  "pagination",
] as const;

export function mergeMetadata(
  base: Metadata,
  overrides: Partial<Metadata>,
): Metadata {
  const merged: Metadata = {
    ...base,
    ...overrides,
  };

  for (const key of DEEP_MERGE_METADATA_KEYS) {
    const overrideValue = overrides[key];
    if (overrideValue === undefined) continue;

    const baseValue = base[key];
    (merged as Record<string, unknown>)[key] = deepMergeMetadataValue(
      baseValue,
      overrideValue,
    );
  }

  return merged;
}

/**
 * 解析标题模板
 * 模板格式: {pageTitle} | {title}( - {subtitle})
 * - {pageTitle}: 页面标题（如果有）
 * - {title}: 站点标题
 * - {subtitle}: 站点子标题
 * - (): 括号及其内部内容在 subtitle 为空时会被移除
 *
 * @param template 标题模板字符串
 * @param title 站点标题
 * @param subtitle 站点子标题（可选）
 * @param pageTitle 页面标题（可选）
 * @returns 解析后的标题字符串
 */
export function parseTitleTemplate(
  template: string,
  title: string,
  subtitle?: string,
  pageTitle?: string,
): string {
  let result = template;

  // 可选语法：仅处理包含 {subtitle} 的括号段
  if (!subtitle || subtitle.trim() === "") {
    result = result.replace(/\(([^)]*\{subtitle\}[^)]*)\)/g, "");
  } else {
    result = result.replace(/\(([^)]*\{subtitle\}[^)]*)\)/g, "$1");
  }

  // 替换占位符
  result = result
    .replace(/\{pageTitle\}/g, pageTitle || "")
    .replace(/\{title\}/g, title)
    .replace(/\{subtitle\}/g, subtitle || "")
    // 清理多余的空格和分隔符
    .replace(/\s+\|\s*$/g, "")
    .replace(/^\s*\|\s+/g, "")
    .replace(/\s+-\s*$/g, "")
    .replace(/^\s*-\s+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return result;
}

/**
 * 生成 Next.js Metadata 的标题对象
 * 如果提供了模板，返回 { template, default } 格式
 * 否则返回简单的字符串或 undefined
 */
function generateTitleMetadata(
  template: string | undefined,
  title: string,
  subtitle?: string,
): { template: string; default: string } | string | undefined {
  if (!title) return undefined;

  // 如果有模板，生成标题对象
  if (template) {
    // 将 {pageTitle} 替换为 %s 以符合 Next.js 格式
    const nextjsTemplate = template.replace(/\{pageTitle\}/g, "%s");

    return {
      template: parseTitleTemplate(nextjsTemplate, title, subtitle, "%s"),
      default: parseTitleTemplate(template, title, subtitle),
    };
  }

  // 没有模板时，如果有子标题则拼接
  if (subtitle && subtitle.trim() !== "") {
    return `${title} - ${subtitle}`;
  }

  return title;
}

type MetadataTitleValue = Metadata["title"] | undefined;

function extractTitleText(title: MetadataTitleValue): string {
  if (!title) return "";
  if (typeof title === "string") return title;
  if (typeof title !== "object") return "";

  if ("absolute" in title && typeof title.absolute === "string") {
    return title.absolute;
  }

  if ("default" in title && typeof title.default === "string") {
    return title.default;
  }

  return "";
}

function buildSocialImageAlt(
  title: MetadataTitleValue,
  description?: string,
): string {
  const titleText = extractTitleText(title);
  const parts = [titleText, description].filter(
    (part): part is string => !!part && part.trim() !== "",
  );

  return parts.join(" - ") || "NeutralPress";
}

type PaginationLinkValue = string | URL | null;

interface ExtendedPagination {
  previous?: PaginationLinkValue;
  next?: PaginationLinkValue;
  prev?: PaginationLinkValue;
}

// 扩展的 Metadata 类型，兼容旧分页字段
interface ExtendedMetadata extends Metadata {
  pagination?: ExtendedPagination;
}

function normalizePagination(
  pagination: ExtendedPagination | undefined,
): Metadata["pagination"] | undefined {
  if (!pagination) return undefined;

  const previous = pagination.previous ?? pagination.prev;
  const next = pagination.next;
  if (!previous && !next) return undefined;

  return {
    ...(previous ? { previous } : {}),
    ...(next ? { next } : {}),
  };
}

function normalizeMetadataOverrides(
  overrides: Partial<ExtendedMetadata>,
): Partial<Metadata> {
  const { pagination, ...rest } = overrides;
  const normalized: Partial<Metadata> = { ...rest };

  const normalizedRobots = normalizeRobotsOverride(normalized.robots);
  if (normalizedRobots !== undefined) {
    normalized.robots = normalizedRobots;
  }

  const normalizedPagination = normalizePagination(pagination);
  if (normalizedPagination) {
    normalized.pagination = normalizedPagination;
  }

  return normalized;
}

function normalizeRobotsOverride(
  robots: Metadata["robots"] | undefined,
): Metadata["robots"] | undefined {
  if (robots === undefined) return undefined;
  if (!robots || typeof robots === "string") return robots;

  const normalized = { ...robots } as Record<string, unknown>;
  const googleBot = normalized.googleBot;

  if (typeof googleBot === "string") {
    return normalized as Metadata["robots"];
  }

  const normalizedGoogleBot =
    googleBot && typeof googleBot === "object"
      ? { ...(googleBot as Record<string, unknown>) }
      : {};

  if (
    typeof normalized.index === "boolean" &&
    normalizedGoogleBot.index === undefined
  ) {
    normalizedGoogleBot.index = normalized.index;
  }

  if (
    typeof normalized.follow === "boolean" &&
    normalizedGoogleBot.follow === undefined
  ) {
    normalizedGoogleBot.follow = normalized.follow;
  }

  if (Object.keys(normalizedGoogleBot).length > 0) {
    normalized.googleBot = normalizedGoogleBot;
  }

  return normalized as Metadata["robots"];
}

const FORCE_NOINDEX_PREFIXES = [
  "/admin",
  "/login",
  "/register",
  "/reset-password",
  "/email-verify",
  "/logout",
  "/messages",
  "/notifications",
  "/reauth",
  "/settings",
  "/search",
] as const;

function extractPathnameForRule(pathname: string): string {
  if (!/^https?:\/\//i.test(pathname)) {
    return pathname;
  }

  try {
    return new URL(pathname).pathname || "/";
  } catch {
    return pathname;
  }
}

export function shouldForceNoIndex(pathname?: string): boolean {
  if (!pathname) return false;
  const normalizedPath = extractPathnameForRule(pathname).toLowerCase();

  return FORCE_NOINDEX_PREFIXES.some(
    (prefix) =>
      normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`),
  );
}

function enforceNoIndexRobots(metadata: Metadata): Metadata {
  const robots = metadata.robots;
  const normalized =
    robots && typeof robots === "object"
      ? ({ ...robots } as Record<string, unknown>)
      : {};

  normalized.index = false;
  normalized.follow = false;

  const googleBot = normalized.googleBot;
  if (googleBot && typeof googleBot === "object") {
    normalized.googleBot = {
      ...(googleBot as Record<string, unknown>),
      index: false,
      follow: false,
    };
  } else {
    normalized.googleBot = {
      index: false,
      follow: false,
    };
  }

  return {
    ...metadata,
    robots: normalized as Metadata["robots"],
  };
}

interface JsonLdSiteContext {
  metadataBase: URL | undefined;
  siteUrl: string;
  siteTitle: string;
  siteDescription: string;
  authorName: string;
  logoUrl: string | undefined;
  indexEnabled: boolean;
}

const getJsonLdSiteContext = unstable_cache(
  async (): Promise<JsonLdSiteContext> => {
    const [
      metadataBaseConfig,
      titleConfig,
      descriptionConfig,
      authorConfig,
      avatarConfig,
      indexEnableConfig,
    ] = await getConfigs([
      seoConfigMap.metadataBase,
      seoConfigMap.title,
      seoConfigMap.description,
      seoConfigMap.author,
      "site.avatar",
      seoConfigMap.indexEnable,
    ]);

    const rawSiteUrl = getStringValue(metadataBaseConfig);
    const metadataBase = parseMetadataBase(rawSiteUrl);
    const siteUrl = (metadataBase?.toString() || rawSiteUrl || "").replace(
      /\/+$/,
      "",
    );
    const siteTitle = getStringValue(titleConfig, "NeutralPress");
    const siteDescription = getStringValue(descriptionConfig, "");
    const authorName = getStringValue(authorConfig, "");
    const avatarPath = getStringValue(avatarConfig).trim() || "/icon/512x";
    const logoUrl = buildCanonicalUrl(
      metadataBase,
      normalizePathname(avatarPath),
    );
    const indexEnabled = getBooleanValue(indexEnableConfig, true);

    return {
      metadataBase,
      siteUrl,
      siteTitle,
      siteDescription,
      authorName,
      logoUrl,
      indexEnabled,
    };
  },
  ["jsonld-site-context"],
  {
    tags: [
      "config/site.url",
      "config/site.title",
      "config/seo.description",
      "config/author.name",
      "config/site.avatar",
      "config/seo.index.enable",
    ],
    revalidate: false,
  },
);

export function normalizeKeywordList(
  keywords: string[] | string | null | undefined,
): string[] {
  if (!keywords) return [];
  if (Array.isArray(keywords)) {
    return keywords.map((keyword) => keyword.trim()).filter(Boolean);
  }

  return keywords
    .split(",")
    .map((keyword) => keyword.trim())
    .filter(Boolean);
}

export function normalizeDateValue(
  date: Date | string | null | undefined,
): string | null {
  if (!date) return null;
  const parsed = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function normalizeImageList(
  images: Array<string | JsonLdImage> | undefined,
  metadataBase: URL | undefined,
): JsonLdImage[] {
  if (!images || images.length === 0) return [];

  return images
    .map((image) => {
      if (typeof image === "string") {
        const absUrl = buildAbsoluteUrl(image, metadataBase);
        if (!absUrl) return null;
        return { url: absUrl } satisfies JsonLdImage;
      }

      const absUrl = buildAbsoluteUrl(image.url, metadataBase);
      if (!absUrl) return null;

      return {
        url: absUrl,
        width: image.width,
        height: image.height,
        alt: image.alt,
      } satisfies JsonLdImage;
    })
    .filter((image): image is JsonLdImage => image !== null);
}

function normalizeAuthorList(
  authors: JsonLdAuthor[] | undefined,
  metadataBase: URL | undefined,
  fallbackAuthorName: string,
): JsonLdAuthor[] {
  const normalized =
    authors
      ?.map((author) => ({
        name: author.name.trim(),
        url: author.url
          ? buildAbsoluteUrl(author.url, metadataBase)
          : undefined,
        type: author.type || "Person",
      }))
      .filter((author) => author.name.length > 0) ?? [];

  if (normalized.length > 0) return normalized;

  if (!fallbackAuthorName.trim()) return [];
  return [{ name: fallbackAuthorName.trim(), type: "Person" }];
}

export function resolveRobotsNoIndex(
  robots: Metadata["robots"] | undefined,
): boolean {
  if (!robots) return false;
  if (typeof robots === "string") {
    return /noindex/i.test(robots);
  }

  if (robots.index === false) return true;
  if (!robots.googleBot) return false;
  if (typeof robots.googleBot === "string") {
    return /noindex/i.test(robots.googleBot);
  }

  return robots.googleBot.index === false;
}

export function shouldEmitJsonLd(options: {
  pathname?: string;
  robots?: Metadata["robots"];
  forceNoIndex?: boolean;
}): boolean {
  const normalizedPathname = normalizePathname(options.pathname);
  const forcedNoIndex =
    options.forceNoIndex ?? shouldForceNoIndex(normalizedPathname);
  if (forcedNoIndex) return false;
  if (resolveRobotsNoIndex(options.robots)) return false;
  return true;
}

export function buildAbsoluteUrl(
  pathnameOrUrl: string | undefined,
  metadataBase: URL | undefined,
): string | undefined {
  const normalized = normalizePathname(pathnameOrUrl);
  return buildCanonicalUrl(metadataBase, normalized);
}

function buildWebSiteJsonLd(site: JsonLdSiteContext): JsonLdNode {
  return {
    "@id": `${site.siteUrl}/#website`,
    "@type": "WebSite",
    url: site.siteUrl,
    name: site.siteTitle,
    description: site.siteDescription || undefined,
    inLanguage: "zh-CN",
    potentialAction: {
      "@type": "SearchAction",
      target: `${site.siteUrl}/search?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}

function buildOrganizationJsonLd(site: JsonLdSiteContext): JsonLdNode {
  return {
    "@id": `${site.siteUrl}/#organization`,
    "@type": "Organization",
    url: site.siteUrl,
    name: site.siteTitle,
    description: site.siteDescription || undefined,
    logo: site.logoUrl
      ? {
          "@type": "ImageObject",
          url: site.logoUrl,
        }
      : undefined,
  };
}

function buildBreadcrumbJsonLd(
  items: JsonLdBreadcrumbItem[] | undefined,
  metadataBase: URL | undefined,
  canonicalUrl: string | undefined,
): JsonLdNode | null {
  if (!items || items.length === 0) return null;

  const listItems = items
    .map((item, index) => {
      const name = item.name.trim();
      if (!name) return null;

      const absoluteItem =
        buildAbsoluteUrl(item.item, metadataBase) ||
        (index === items.length - 1 ? canonicalUrl : undefined);

      return {
        "@type": "ListItem",
        position: index + 1,
        name,
        item: absoluteItem,
      };
    })
    .filter(
      (
        item,
      ): item is {
        "@type": "ListItem";
        position: number;
        name: string;
        item: string | undefined;
      } => item !== null,
    );

  if (listItems.length === 0) return null;

  return {
    "@type": "BreadcrumbList",
    itemListElement: listItems,
  };
}

function normalizeMenuPath(path: string | null | undefined): string | null {
  if (!path) return null;
  const trimmed = path.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return null;
  if (trimmed.startsWith("#")) return null;

  const withoutHash = trimmed.split("#")[0];
  const withoutQuery = withoutHash?.split("?")[0] ?? "";
  if (!withoutQuery) return null;

  const normalized = withoutQuery.startsWith("/")
    ? withoutQuery
    : `/${withoutQuery}`;
  const compacted = normalized.replace(/\/{2,}/g, "/").replace(/\/+$/, "");

  return compacted || "/";
}

export function buildMainMenuJsonLdBreadcrumb(
  menus: JsonLdMenuNavigationItem[] | undefined,
  options?: {
    homeName?: string;
    maxItems?: number;
  },
): JsonLdBreadcrumbItem[] {
  const homeName = options?.homeName?.trim() || "首页";
  const maxItems =
    typeof options?.maxItems === "number" && Number.isFinite(options.maxItems)
      ? Math.max(1, Math.floor(options.maxItems))
      : 12;

  const breadcrumb: JsonLdBreadcrumbItem[] = [{ name: homeName, item: "/" }];
  const seen = new Set<string>(["/"]);

  for (const menu of menus ?? []) {
    if (breadcrumb.length >= maxItems) break;

    const name = menu.name.trim();
    if (!name) continue;

    const path = normalizeMenuPath(menu.page?.slug || menu.slug || menu.link);
    if (!path || seen.has(path)) continue;

    seen.add(path);
    breadcrumb.push({
      name,
      item: path,
    });
  }

  return breadcrumb;
}

function buildThingList(names: string[]): JsonLdNode[] {
  return names
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({
      "@type": "Thing",
      name,
    }));
}

function buildGenericItemListJsonLd(
  itemList: JsonLdGraphInput["itemList"] | undefined,
  metadataBase: URL | undefined,
  canonicalUrl: string | undefined,
  fallbackAuthorName: string,
): JsonLdNode | null {
  if (!itemList?.items || itemList.items.length === 0) return null;

  const itemType = itemList.itemType || "WebPage";
  const itemListElements = itemList.items
    .slice(0, 20)
    .map((entry, index) => {
      const name = entry.name.trim();
      if (!name) return null;

      const itemUrl = buildAbsoluteUrl(entry.url, metadataBase);
      if (!itemUrl) return null;

      const imageUrl =
        typeof entry.image === "string"
          ? buildAbsoluteUrl(entry.image, metadataBase)
          : buildAbsoluteUrl(entry.image?.url, metadataBase);
      const datePublished = normalizeDateValue(entry.datePublished);
      const dateModified = normalizeDateValue(entry.dateModified);
      const normalizedAuthors = normalizeAuthorList(
        entry.authors,
        metadataBase,
        fallbackAuthorName,
      );

      const itemEntity: JsonLdNode = {
        "@type": itemType,
        url: itemUrl,
        description: entry.description,
        ...(itemType === "BlogPosting" ? { headline: name } : { name }),
        ...(itemType === "BlogPosting" && normalizedAuthors.length > 0
          ? {
              author: normalizedAuthors.map((author) => ({
                "@type": author.type || "Person",
                name: author.name,
                url: author.url,
              })),
            }
          : {}),
        ...(imageUrl ? { image: imageUrl } : {}),
        ...(datePublished ? { datePublished } : {}),
        ...(dateModified ? { dateModified } : {}),
      };

      return {
        "@type": "ListItem",
        position: index + 1,
        name,
        url: itemUrl,
        item: itemEntity,
      };
    })
    .filter(
      (
        item,
      ): item is {
        "@type": "ListItem";
        position: number;
        name: string;
        url: string;
        item: JsonLdNode;
      } => item !== null,
    );

  if (itemListElements.length === 0) return null;

  return {
    "@id": canonicalUrl
      ? `${canonicalUrl}#${itemList.idSuffix || "itemlist"}`
      : undefined,
    "@type": "ItemList",
    name: itemList.name,
    itemListOrder: "https://schema.org/ItemListOrderDescending",
    numberOfItems: itemListElements.length,
    itemListElement: itemListElements,
  };
}

function buildMainEntityJsonLd(
  input: JsonLdGraphInput,
  site: JsonLdSiteContext,
  canonicalUrl: string | undefined,
): { entity: JsonLdNode | null; extra: JsonLdNode[] } {
  const title = input.title?.trim() || site.siteTitle;
  const description =
    input.description?.trim() || site.siteDescription || undefined;
  const keywords = normalizeKeywordList(input.keywords);
  const publishedAt = normalizeDateValue(input.publishedAt);
  const updatedAt = normalizeDateValue(input.updatedAt);
  const normalizedImages = normalizeImageList(input.images, site.metadataBase);
  const normalizedAuthors = normalizeAuthorList(
    input.authors,
    site.metadataBase,
    site.authorName,
  );

  if (input.kind === "article") {
    return {
      entity: {
        "@id": canonicalUrl ? `${canonicalUrl}#article` : undefined,
        "@type": "BlogPosting",
        mainEntityOfPage: canonicalUrl,
        url: canonicalUrl,
        headline: title,
        description,
        inLanguage: "zh-CN",
        datePublished: publishedAt || undefined,
        dateModified: updatedAt || publishedAt || undefined,
        author:
          normalizedAuthors.length > 0
            ? normalizedAuthors.map((author) => ({
                "@type": author.type || "Person",
                name: author.name,
                url: author.url,
              }))
            : undefined,
        publisher: {
          "@id": `${site.siteUrl}/#organization`,
        },
        image:
          normalizedImages.length > 0
            ? normalizedImages.map((image) => image.url)
            : undefined,
        keywords: keywords.length > 0 ? keywords : undefined,
        articleSection: input.article?.section,
        about:
          input.article?.tags && input.article.tags.length > 0
            ? buildThingList(input.article.tags)
            : undefined,
        isPartOf: {
          "@id": `${site.siteUrl}/#website`,
        },
      },
      extra: [],
    };
  }

  if (input.kind === "project") {
    const categories = input.project?.categories ?? [];
    const techStack = input.project?.techStack ?? [];

    return {
      entity: {
        "@id": canonicalUrl ? `${canonicalUrl}#project` : undefined,
        "@type": "CreativeWork",
        url: canonicalUrl,
        mainEntityOfPage: canonicalUrl,
        name: title,
        description,
        inLanguage: "zh-CN",
        datePublished: publishedAt || undefined,
        dateModified: updatedAt || publishedAt || undefined,
        author:
          normalizedAuthors.length > 0
            ? normalizedAuthors.map((author) => ({
                "@type": author.type || "Person",
                name: author.name,
                url: author.url,
              }))
            : undefined,
        image:
          normalizedImages.length > 0
            ? normalizedImages.map((image) => image.url)
            : undefined,
        keywords: keywords.length > 0 ? keywords : undefined,
        genre: categories.length > 0 ? categories : undefined,
        about: techStack.length > 0 ? buildThingList(techStack) : undefined,
        sameAs:
          input.project?.links && input.project.links.length > 0
            ? input.project.links
                .map((link) => buildAbsoluteUrl(link, site.metadataBase))
                .filter((link): link is string => !!link)
            : undefined,
        isPartOf: {
          "@id": `${site.siteUrl}/#website`,
        },
      },
      extra: [],
    };
  }

  if (input.kind === "photo") {
    const image = normalizedImages[0];

    return {
      entity: {
        "@id": canonicalUrl ? `${canonicalUrl}#photo` : undefined,
        "@type": "ImageObject",
        url: canonicalUrl,
        name: title,
        description,
        caption: input.photo?.caption || description,
        contentUrl: image?.url || canonicalUrl,
        datePublished: publishedAt || undefined,
        dateModified: updatedAt || publishedAt || undefined,
        creator:
          normalizedAuthors.length > 0
            ? {
                "@type": normalizedAuthors[0]?.type || "Person",
                name: normalizedAuthors[0]?.name,
                url: normalizedAuthors[0]?.url,
              }
            : undefined,
        width: image?.width,
        height: image?.height,
        inLanguage: "zh-CN",
        isPartOf: {
          "@id": `${site.siteUrl}/#website`,
        },
      },
      extra: [],
    };
  }

  if (input.kind === "gallery") {
    const galleryItems = input.gallery?.items ?? [];
    const itemListElements = galleryItems.slice(0, 12).map((item, index) => {
      const itemPageUrl = buildAbsoluteUrl(item.url, site.metadataBase);
      const imageUrl =
        typeof item.image === "string"
          ? buildAbsoluteUrl(item.image, site.metadataBase)
          : buildAbsoluteUrl(item.image?.url, site.metadataBase);

      return {
        "@type": "ListItem",
        position: index + 1,
        name: item.name || undefined,
        url: itemPageUrl,
        item: imageUrl
          ? {
              "@type": "ImageObject",
              contentUrl: imageUrl,
              url: itemPageUrl || imageUrl,
              name: item.name || undefined,
              description: item.description,
            }
          : itemPageUrl,
      };
    });

    const itemListNode: JsonLdNode | null =
      itemListElements.length > 0
        ? {
            "@id": canonicalUrl ? `${canonicalUrl}#itemlist` : undefined,
            "@type": "ItemList",
            itemListOrder: "https://schema.org/ItemListOrderAscending",
            numberOfItems: itemListElements.length,
            itemListElement: itemListElements,
          }
        : null;

    return {
      entity: {
        "@id": canonicalUrl ? `${canonicalUrl}#gallery` : undefined,
        "@type": "CollectionPage",
        url: canonicalUrl,
        mainEntityOfPage: canonicalUrl,
        name: title,
        description,
        inLanguage: "zh-CN",
        keywords: keywords.length > 0 ? keywords : undefined,
        datePublished: publishedAt || undefined,
        dateModified: updatedAt || publishedAt || undefined,
        isPartOf: {
          "@id": `${site.siteUrl}/#website`,
        },
        mainEntity: itemListNode ? { "@id": itemListNode["@id"] } : undefined,
      },
      extra: itemListNode ? [itemListNode] : [],
    };
  }

  const pageType =
    input.pageType || (input.kind === "site" ? "CollectionPage" : "WebPage");
  const genericItemListNode = buildGenericItemListJsonLd(
    input.itemList,
    site.metadataBase,
    canonicalUrl,
    site.authorName,
  );
  const mainEntityRef =
    genericItemListNode && typeof genericItemListNode["@id"] === "string"
      ? ({ "@id": genericItemListNode["@id"] } as JsonLdNode)
      : genericItemListNode || undefined;

  return {
    entity: {
      "@id": canonicalUrl ? `${canonicalUrl}#webpage` : undefined,
      "@type": pageType,
      url: canonicalUrl,
      name: title,
      description,
      inLanguage: "zh-CN",
      keywords: keywords.length > 0 ? keywords : undefined,
      datePublished: publishedAt || undefined,
      dateModified: updatedAt || publishedAt || undefined,
      isPartOf: {
        "@id": `${site.siteUrl}/#website`,
      },
      primaryImageOfPage:
        normalizedImages.length > 0
          ? {
              "@type": "ImageObject",
              url: normalizedImages[0]?.url,
            }
          : undefined,
      mainEntity: mainEntityRef,
    },
    extra: genericItemListNode ? [genericItemListNode] : [],
  };
}

function dedupeJsonLdGraph(nodes: JsonLdGraph): JsonLdGraph {
  const idSet = new Set<string>();
  const fallbackSet = new Set<string>();
  const result: JsonLdGraph = [];

  for (const node of nodes) {
    const id = typeof node["@id"] === "string" ? node["@id"] : null;
    if (id) {
      if (idSet.has(id)) continue;
      idSet.add(id);
      result.push(node);
      continue;
    }

    const signature = JSON.stringify(node);
    if (fallbackSet.has(signature)) continue;
    fallbackSet.add(signature);
    result.push(node);
  }

  return result;
}

export async function generateJsonLdGraph(
  input: JsonLdGraphInput,
): Promise<JsonLdGraph> {
  const site = await getJsonLdSiteContext();
  if (!site.siteUrl || !site.indexEnabled) return [];

  const normalizedPathname = normalizePathname(input.pathname);
  const canonicalUrl = buildCanonicalUrl(site.metadataBase, normalizedPathname);
  const forceNoIndex = shouldForceNoIndex(normalizedPathname);

  if (
    !shouldEmitJsonLd({
      pathname: normalizedPathname,
      robots: input.robots,
      forceNoIndex,
    })
  ) {
    return [];
  }

  const { entity, extra } = buildMainEntityJsonLd(input, site, canonicalUrl);
  const breadcrumbNode = buildBreadcrumbJsonLd(
    input.breadcrumb,
    site.metadataBase,
    canonicalUrl,
  );

  const graph: JsonLdGraph = [];

  if (input.includeWebSite !== false) {
    graph.push(buildWebSiteJsonLd(site));
  }

  if (input.includeOrganization !== false) {
    graph.push(buildOrganizationJsonLd(site));
  }

  if (entity) {
    graph.push(entity);
  }

  if (extra.length > 0) {
    graph.push(...extra);
  }

  if (breadcrumbNode) {
    graph.push(breadcrumbNode);
  }

  return dedupeJsonLdGraph(graph);
}

export function serializeJsonLdGraph(graph: JsonLdGraph): string {
  if (graph.length === 0) return "";

  const payload: Record<string, unknown> =
    graph.length === 1
      ? {
          "@context": "https://schema.org",
          ...graph[0],
        }
      : {
          "@context": "https://schema.org",
          "@graph": graph,
        };

  return JSON.stringify(payload).replace(/</g, "\\u003c");
}

// 生成动态SEO配置的异步函数
export async function generateMetadata(
  overrides: Partial<ExtendedMetadata> = {},
  options?: {
    pathname?: string;
    seoParams?: SeoTemplateParams;
    article?: {
      publishedTime?: string;
      modifiedTime?: string;
      authors?: string[];
    };
  },
): Promise<Metadata> {
  // 批量获取所有需要的配置
  const [
    metadataBaseConfig,
    titleConfig,
    subtitleConfig,
    titleTemplateConfig,
    descriptionConfig,
    keywordsConfig,
    authorConfig,
    twitterSiteConfig,
    twitterCreatorConfig,
    googleVerificationConfig,
    categoryConfig,
    countryConfig,
    imageCardEnableConfig,
    indexEnableConfig,
  ] = await getConfigs([
    seoConfigMap.metadataBase,
    seoConfigMap.title,
    seoConfigMap.subtitle,
    seoConfigMap.titleTemplate,
    seoConfigMap.description,
    seoConfigMap.keywords,
    seoConfigMap.author,
    seoConfigMap.twitterSite,
    seoConfigMap.twitterCreator,
    seoConfigMap.googleVerification,
    seoConfigMap.category,
    seoConfigMap.country,
    seoConfigMap.imageCardEnable,
    seoConfigMap.indexEnable,
  ]);

  // 动态获取的值
  const url = getStringValue(metadataBaseConfig);
  const title = getStringValue(titleConfig);
  const subtitle = getStringValue(subtitleConfig);
  const titleTemplate = getStringValue(titleTemplateConfig);
  const description = getStringValue(descriptionConfig);
  const appName = title;
  const keywords = getStringArrayValue(keywordsConfig);
  const author = getStringValue(authorConfig);
  const twitterSite = getStringValue(twitterSiteConfig);
  const twitterCreator = getStringValue(twitterCreatorConfig);
  const googleVerification = getStringValue(googleVerificationConfig);
  const category = getStringValue(categoryConfig);
  const country = getStringValue(countryConfig);
  const imageCardEnabled = getBooleanValue(imageCardEnableConfig, true);
  const indexEnabled = getBooleanValue(indexEnableConfig, true);

  const metadataBase = parseMetadataBase(url);
  const normalizedPathname = normalizePathname(options?.pathname);
  const openGraphUrl = buildOpenGraphUrl(metadataBase, normalizedPathname);
  const canonicalUrl = buildCanonicalUrl(metadataBase, normalizedPathname);
  const forceNoIndex = shouldForceNoIndex(normalizedPathname);
  const effectiveIndexEnabled = forceNoIndex ? false : indexEnabled;

  // 生成标题元数据
  const titleMetadata = generateTitleMetadata(
    titleTemplate,
    title || "NeutralPress",
    subtitle,
  );

  // 处理页面级别的标题覆盖
  const processedOverrides: Partial<ExtendedMetadata> = { ...overrides };

  // SEO 插值处理：如果提供了 seoParams，自动对 title 和 description 进行插值
  if (options?.seoParams) {
    // 检查 title 是否包含占位符
    if (
      typeof processedOverrides.title === "string" &&
      processedOverrides.title.includes("{")
    ) {
      processedOverrides.title = await interpolateSeoTemplate(
        processedOverrides.title,
        options.seoParams,
      );
    }

    // 检查 description 是否包含占位符
    if (
      typeof processedOverrides.description === "string" &&
      processedOverrides.description.includes("{")
    ) {
      processedOverrides.description = await interpolateSeoTemplate(
        processedOverrides.description,
        options.seoParams,
      );
    }
  }

  // 如果覆盖参数中包含标题，确保使用模板格式
  if (processedOverrides.title) {
    // 如果是对象格式，保持原样（允许页面完全控制标题）
    if (typeof processedOverrides.title === "object") {
      // 已经是最终格式，不需要处理
    } else if (typeof processedOverrides.title === "string") {
      // 如果是字符串标题，应用站点标题模板
      if (titleTemplate) {
        processedOverrides.title = parseTitleTemplate(
          titleTemplate,
          title || "NeutralPress",
          subtitle,
          processedOverrides.title,
        );
      } else {
        // 没有模板时使用简单拼接
        const siteTitle = title || "NeutralPress";
        const fullTitle = subtitle ? `${siteTitle} - ${subtitle}` : siteTitle;
        processedOverrides.title = `${processedOverrides.title} | ${fullTitle}`;
      }
    }
  }

  const resolvedTitle: Metadata["title"] =
    processedOverrides.title ?? titleMetadata;
  const resolvedDescription =
    typeof processedOverrides.description === "string"
      ? processedOverrides.description
      : description || undefined;
  const socialImageAlt = buildSocialImageAlt(
    resolvedTitle,
    resolvedDescription,
  );
  const socialImageUrl = imageCardEnabled
    ? buildSocialImageUrl(metadataBase, normalizedPathname)
    : undefined;

  // 构建最终的metadata
  const dynamicMetadata: Metadata = {
    metadataBase,
    title: titleMetadata,
    description: description || undefined,
    applicationName: appName || title || undefined,
    ...STATIC_METADATA,
    authors: author ? [{ name: author }] : undefined,
    creator: author || undefined,
    publisher: author || undefined,
    category: category || undefined,
    alternates: {
      ...STATIC_METADATA.alternates,
      ...(canonicalUrl ? { canonical: canonicalUrl } : {}),
    },
    robots: {
      ...STATIC_METADATA.robots,
      index: effectiveIndexEnabled,
      follow: effectiveIndexEnabled,
      googleBot: {
        ...STATIC_METADATA.robots.googleBot,
        index: effectiveIndexEnabled,
        follow: effectiveIndexEnabled,
      },
    },
    openGraph: {
      ...(options?.article
        ? {
            type: "article" as const,
            publishedTime: options.article.publishedTime,
            modifiedTime: options.article.modifiedTime,
            authors: options.article.authors,
          }
        : { type: "website" as const }),
      locale: "zh_CN",
      title: resolvedTitle,
      description: resolvedDescription,
      siteName: appName || title || undefined,
      ...(openGraphUrl ? { url: openGraphUrl } : {}),
      countryName: country || undefined,
      images: socialImageUrl
        ? [
            {
              url: socialImageUrl,
              width: 1200,
              height: 630,
              alt: socialImageAlt,
              type: "image/png",
            },
          ]
        : undefined,
    },
    twitter: {
      card: imageCardEnabled ? "summary_large_image" : "summary",
      site: twitterSite || undefined,
      creator: twitterCreator || undefined,
      title: resolvedTitle,
      description: resolvedDescription,
      images: socialImageUrl
        ? {
            url: socialImageUrl,
            alt: socialImageAlt,
            width: 1200,
            height: 630,
          }
        : undefined,
    },
    verification: {
      ...STATIC_METADATA.verification,
      google: googleVerification || undefined,
    },
    keywords: keywords.length > 0 ? keywords : undefined,
    appleWebApp: {
      capable: true,
      title: appName || title || undefined,
      statusBarStyle: "black-translucent",
    },
    other: {
      ...STATIC_METADATA.other,
      ...(appName || title
        ? {
            "apple-mobile-web-app-title": appName || title,
            "application-name": appName || title,
          }
        : {}),
    },
  };

  const normalizedOverrides = normalizeMetadataOverrides(processedOverrides);
  const mergedMetadata = mergeMetadata(dynamicMetadata, normalizedOverrides);
  const finalMetadata = forceNoIndex
    ? enforceNoIndexRobots(mergedMetadata)
    : mergedMetadata;

  return toPlainSerializable(finalMetadata) as Metadata;
}

/**
 * 插值页面模板
 * 支持使用插值器数据（如 {tagName}, {page}, {totalPage} 等）来动态生成标题和描述
 *
 * @param template 模板字符串，如 "标签：{tagName} - 第{page}页"
 * @param data 插值器数据对象
 * @returns 插值后的字符串
 */
export function interpolatePageTemplate(
  template: string,
  data: Record<string, unknown>,
): string {
  let result = template;

  // 替换所有占位符
  for (const [key, value] of Object.entries(data)) {
    const placeholder = `{${key}}`;
    if (result.includes(placeholder)) {
      const valueStr =
        value === null || value === undefined ? "" : String(value);
      result = result.split(placeholder).join(valueStr);
    }
  }

  return result;
}

// ========== SEO 专用插值体系 ==========

/**
 * SEO 插值参数
 */
export interface SeoTemplateParams {
  slug?: string;
  page?: number;
  pageSize?: number;
}

/**
 * 检测模板中使用的占位符
 * 只返回模板中实际存在的占位符，避免不必要的数据库查询
 */
function detectPlaceholders(
  template: string,
): Set<keyof SeoTemplateData | string> {
  const placeholderRegex = /\{([^}]+)\}/g;
  const placeholders = new Set<string>();

  let match;
  while ((match = placeholderRegex.exec(template)) !== null) {
    if (match[1]) {
      placeholders.add(match[1]);
    }
  }

  return placeholders;
}

/**
 * SEO 插值数据
 */
interface SeoTemplateData {
  slug?: string;
  page?: number;
  totalPage?: number;
  tag?: string;
  tagDescription?: string;
  category?: string;
  categoryDescription?: string;
}

/**
 * 根据 slug 查询标签数据（带缓存）
 */
const getCachedTagBySlug = (slug: string) =>
  unstable_cache(
    async (s: string) => {
      const tag = await prisma.tag.findUnique({
        where: { slug: s },
        select: { name: true, description: true },
      });
      return tag;
    },
    [`seo-tag-${slug}`],
    {
      tags: ["tags/list"],
      revalidate: false,
    },
  )(slug);

/**
 * 获取标签信息（按需查询）
 */
async function fetchTagData(
  slug: string | undefined,
  placeholders: Set<string>,
): Promise<{ tag?: string; tagDescription?: string }> {
  if (!slug) return {};

  // 只有当模板中包含 {tag} 或 {tagDescription} 时才查询
  const needsTag = placeholders.has("tag");
  const needsDescription = placeholders.has("tagDescription");

  if (!needsTag && !needsDescription) return {};

  try {
    const tag = await getCachedTagBySlug(slug);

    if (!tag) return {};

    return {
      tag: needsTag ? tag.name : undefined,
      tagDescription: needsDescription
        ? tag.description || undefined
        : undefined,
    };
  } catch (error) {
    console.error("[SEO] Failed to fetch tag data:", error);
    return {};
  }
}

/**
 * 获取分类信息（按需查询）
 */
async function fetchCategoryData(
  slug: string | undefined,
  placeholders: Set<string>,
): Promise<{ category?: string; categoryDescription?: string }> {
  if (!slug) return {};

  // 只有当模板中包含 {category} 或 {categoryDescription} 时才查询
  const needsCategory = placeholders.has("category");
  const needsDescription = placeholders.has("categoryDescription");

  if (!needsCategory && !needsDescription) return {};

  try {
    // 解析路径并查找分类（支持嵌套路径如 "xue-shu/shu-xue"）
    const pathSlugs = slug.split("/").filter(Boolean);
    const category =
      pathSlugs.length > 0 ? await findCategoryByPath(pathSlugs) : null;

    if (!category) return {};

    return {
      category: needsCategory ? category.name : undefined,
      categoryDescription: needsDescription
        ? category.description || undefined
        : undefined,
    };
  } catch (error) {
    console.error("[SEO] Failed to fetch category data:", error);
    return {};
  }
}

/**
 * 计算总页数（按需计算）
 */
async function calculateTotalPage(
  slug: string | undefined,
  pageSize: number = 20,
  placeholders: Set<string>,
): Promise<number | undefined> {
  // 只有当模板中包含 {totalPage} 时才计算
  if (!placeholders.has("totalPage")) return undefined;

  if (!slug) return undefined;

  try {
    let totalCount = 0;

    // 根据占位符自动判断页面类型
    const isTagPage =
      placeholders.has("tag") || placeholders.has("tagDescription");
    const isCategoryPage =
      placeholders.has("category") || placeholders.has("categoryDescription");

    if (isTagPage) {
      // 查询标签下的文章数
      const tag = await prisma.tag.findUnique({
        where: { slug },
        select: {
          _count: {
            select: {
              posts: {
                where: {
                  ...LISTABLE_POST_PUBLISHED_WHERE,
                },
              },
            },
          },
        },
      });
      totalCount = tag?._count.posts || 0;
    } else if (isCategoryPage) {
      // 查询分类下的文章数（支持嵌套路径）
      const pathSlugs = slug.split("/").filter(Boolean);
      const category =
        pathSlugs.length > 0 ? await findCategoryByPath(pathSlugs) : null;

      if (!category) {
        return 0;
      }

      // 查询分类及其所有子孙分类的文章数
      const { getAllDescendantIds } = await import(
        "@/lib/server/category-utils"
      );
      const descendantIds = await getAllDescendantIds(category.id);
      const allIds = [category.id, ...descendantIds];

      // 统计文章数
      totalCount = await prisma.post.count({
        where: {
          categories: {
            some: {
              id: { in: allIds },
            },
          },
          ...LISTABLE_POST_PUBLISHED_WHERE,
        },
      });
    }

    if (totalCount === 0) return 0;

    // 计算总页数
    return Math.ceil(totalCount / pageSize);
  } catch (error) {
    console.error("[SEO] Failed to calculate total page:", error);
    return undefined;
  }
}

/**
 * SEO 专用模板插值函数
 *
 * 支持的变量：
 * - {slug} - 路由参数中的 slug
 * - {page} - 当前页码
 * - {totalPage} - 总页数（通过数据库计数计算）
 * - {tag} - 标签名称（仅当模板包含此占位符时查询）
 * - {tagDescription} - 标签描述（仅当模板包含此占位符时查询）
 * - {category} - 分类名称（仅当模板包含此占位符时查询）
 * - {categoryDescription} - 分类描述（仅当模板包含此占位符时查询）
 *
 * @param template 模板字符串
 * @param params SEO 插值参数
 * @returns 插值后的字符串
 */
export async function interpolateSeoTemplate(
  template: string,
  params: SeoTemplateParams,
): Promise<string> {
  if (!template) return "";

  // 检测模板中使用的占位符
  const placeholders = detectPlaceholders(template);

  // 如果没有任何占位符，直接返回原模板
  if (placeholders.size === 0) return template;

  // 准备基础数据
  const data: SeoTemplateData = {
    slug: params.slug,
    page: params.page,
  };

  // 并行执行所有需要的数据查询（按需）
  const [tagData, categoryData, totalPage] = await Promise.all([
    fetchTagData(params.slug, placeholders),
    fetchCategoryData(params.slug, placeholders),
    calculateTotalPage(params.slug, params.pageSize, placeholders),
  ]);

  // 合并数据
  Object.assign(data, tagData, categoryData);
  if (totalPage !== undefined) {
    data.totalPage = totalPage;
  }

  // 执行插值
  let result = template;
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;

    const placeholder = `{${key}}`;
    if (result.includes(placeholder)) {
      result = result.split(placeholder).join(String(value));
    }
  }

  return result;
}
