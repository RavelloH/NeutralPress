import rehypeStringify from "rehype-stringify";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

import { batchGetCategoryPaths } from "@/lib/server/category-utils";
import { type ConfigItem, getRawConfig } from "@/lib/server/config-cache";
import { getFeaturedImageUrl } from "@/lib/server/media-reference";
import { LISTABLE_POST_PUBLISHED_WHERE } from "@/lib/server/post-access";
import prisma from "@/lib/server/prisma";
import {
  markdownRehypePlugins,
  markdownRemarkPlugins,
} from "@/lib/shared/mdx-config-shared";

export type FeedPost = {
  title: string;
  slug: string;
  excerpt: string | null;
  content: string;
  publishedAt: Date | null;
  updatedAt: Date;
  author: {
    nickname: string | null;
    username: string;
  };
  categories: {
    name: string;
  }[];
  featuredImage: string | null;
};

export type SiteConfig = {
  url: string;
  title: string;
  description: string;
  author: string;
};

export type FeedPage = {
  title: string;
  slug: string;
  updatedAt: Date;
};

export type FeedCategory = {
  slug: string;
  updatedAt: Date;
};

export type FeedTag = {
  slug: string;
  updatedAt: Date;
};

export interface FeedData {
  posts: FeedPost[];
  pages: FeedPage[];
  categories: FeedCategory[];
  tags: FeedTag[];
  siteConfig: SiteConfig;
  rssConfig: {
    enabled: boolean;
    postCount: number;
    showFullContent: boolean;
    autoGenerateExcerpt: boolean;
    maxExcerptLength: number;
  };
}

export function normalizeFeedText(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;|&#60;/gi, "<")
    .replace(/&gt;|&#62;/gi, ">")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;|&#38;/gi, "&")
    .replace(/&[a-zA-Z0-9#]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripLeadingMarkdownTitle(
  markdown: string,
  title: string,
): string {
  const normalizedTitle = normalizeFeedText(title);
  if (!normalizedTitle) {
    return markdown;
  }

  const atxHeadingMatch = markdown.match(
    /^\uFEFF?\s*#\s+(.+?)\s*#*\s*(?:\r?\n)+/,
  );
  if (
    atxHeadingMatch &&
    normalizeFeedText(atxHeadingMatch[1] ?? "") === normalizedTitle
  ) {
    return markdown.slice(atxHeadingMatch[0].length).trimStart();
  }

  const setextHeadingMatch = markdown.match(
    /^\uFEFF?\s*([^\r\n]+)\r?\n=+\s*(?:\r?\n)+/,
  );
  if (
    setextHeadingMatch &&
    normalizeFeedText(setextHeadingMatch[1] ?? "") === normalizedTitle
  ) {
    return markdown.slice(setextHeadingMatch[0].length).trimStart();
  }

  return markdown;
}

export function stripLeadingHtmlTitle(html: string, title: string): string {
  const normalizedTitle = normalizeFeedText(title);
  if (!normalizedTitle) {
    return html;
  }

  const headingMatch = html.match(/^\s*<h1\b[^>]*>([\s\S]*?)<\/h1>\s*/i);
  if (
    headingMatch &&
    normalizeFeedText(headingMatch[1] ?? "") === normalizedTitle
  ) {
    return html.slice(headingMatch[0].length).trimStart();
  }

  return html;
}

export function buildFeedLeadHtml(postUrl: string): string {
  return `<p class="feed-lead">前往 <a href="${postUrl}">${postUrl}</a> 查看以获得最佳体验。</p>`;
}

export function prependFeedLead(content: string, postUrl: string): string {
  const leadHtml = buildFeedLeadHtml(postUrl);
  return content ? `${leadHtml}\n${content}` : leadHtml;
}

export async function getFeedData(): Promise<FeedData> {
  const [
    urlConfig,
    titleConfig,
    descConfig,
    authorConfig,
    rssEnabledConfig,
    rssPostCountConfig,
    rssShowFullContentConfig,
    rssAutoGenerateExcerptConfig,
    rssMaxExcerptLengthConfig,
  ] = await Promise.all([
    getRawConfig("site.url"),
    getRawConfig("site.title"),
    getRawConfig("seo.description"),
    getRawConfig("author.name"),
    getRawConfig("content.rss.enabled"),
    getRawConfig("content.rss.postCount"),
    getRawConfig("content.rss.showFullContent"),
    getRawConfig("content.rss.autoGenerateExcerpt"),
    getRawConfig("content.rss.maxExcerptLength"),
  ]);

  const getValue = (config: ConfigItem | null, defaultVal: string): string => {
    if (!config?.value) return defaultVal;
    const value = config.value;
    if (typeof value === "object" && value !== null && "default" in value) {
      const defaultValue = (value as Record<string, unknown>).default;
      if (typeof defaultValue === "string") return defaultValue;
    }
    if (typeof value === "string") return value;
    return defaultVal;
  };

  const getBoolValue = (
    config: ConfigItem | null,
    defaultVal: boolean,
  ): boolean => {
    if (!config?.value) return defaultVal;
    const value = config.value;
    if (typeof value === "object" && value !== null && "default" in value) {
      return Boolean((value as Record<string, unknown>).default);
    }
    return Boolean(value);
  };

  const getIntValue = (
    config: ConfigItem | null,
    defaultVal: number,
  ): number => {
    if (!config?.value) return defaultVal;
    const value = config.value;
    if (typeof value === "object" && value !== null && "default" in value) {
      const val = Number((value as Record<string, unknown>).default);
      return isNaN(val) ? defaultVal : val;
    }
    const val = Number(value);
    return isNaN(val) ? defaultVal : val;
  };

  const rssConfig = {
    enabled: getBoolValue(rssEnabledConfig, true),
    postCount: getIntValue(rssPostCountConfig, 10),
    showFullContent: getBoolValue(rssShowFullContentConfig, true),
    autoGenerateExcerpt: getBoolValue(rssAutoGenerateExcerptConfig, true),
    maxExcerptLength: getIntValue(rssMaxExcerptLengthConfig, 200),
  };

  const siteConfig: SiteConfig = {
    url: getValue(urlConfig, "https://neutralpress.com"),
    title: getValue(titleConfig, "NeutralPress"),
    description: getValue(descConfig, ""),
    author: getValue(authorConfig, "Admin"),
  };

  // 如果 RSS 未启用，直接返回空列表，route.ts 会处理
  if (!rssConfig.enabled) {
    return {
      posts: [],
      pages: [],
      categories: [],
      tags: [],
      siteConfig,
      rssConfig,
    };
  }

  const posts = await prisma.post.findMany({
    where: {
      ...LISTABLE_POST_PUBLISHED_WHERE,
      publishedAt: { not: null },
    },
    orderBy: {
      publishedAt: "desc",
    },
    take: rssConfig.postCount,
    select: {
      title: true,
      slug: true,
      excerpt: true,
      content: true,
      publishedAt: true,
      updatedAt: true,
      accessMode: true,
      author: {
        select: {
          nickname: true,
          username: true,
        },
      },
      categories: {
        select: {
          name: true,
        },
      },
      mediaRefs: {
        include: {
          media: {
            select: {
              shortHash: true,
            },
          },
        },
      },
    },
  });

  const pages = await prisma.page.findMany({
    where: {
      status: "ACTIVE",
      deletedAt: null,
    },
    select: {
      title: true,
      slug: true,
      updatedAt: true,
    },
  });

  const [allCategories, allTags] = await Promise.all([
    prisma.category.findMany({
      select: {
        id: true,
        slug: true,
        updatedAt: true,
      },
    }),
    prisma.tag.findMany({
      select: {
        slug: true,
        updatedAt: true,
      },
    }),
  ]);

  const categoryPathsMap = await batchGetCategoryPaths(
    allCategories.map((c) => c.id),
  );

  const formattedCategories: FeedCategory[] = allCategories.map((c) => {
    const path = categoryPathsMap.get(c.id);
    const fullSlug = path?.[path.length - 1]?.slug;
    return {
      slug: fullSlug ?? c.slug,
      updatedAt: c.updatedAt,
    };
  });

  const formattedTags: FeedTag[] = allTags.map((t) => ({
    slug: t.slug,
    updatedAt: t.updatedAt,
  }));

  const markdownToHtml = async (markdown: string) => {
    try {
      const file = await unified()
        .use(remarkParse)
        .use(markdownRemarkPlugins)
        .use(remarkRehype, { allowDangerousHtml: true })
        .use(markdownRehypePlugins)
        .use(rehypeStringify, { allowDangerousHtml: true })
        .process(markdown);
      return String(file);
    } catch (e) {
      console.error("Markdown conversion failed", e);
      return markdown;
    }
  };

  const formattedPosts: FeedPost[] = await Promise.all(
    posts.map(async (post) => {
      const postUrl = `${siteConfig.url}/posts/${post.slug}`;
      const isProtectedPost = post.accessMode !== "PUBLIC";
      const featuredImage = getFeaturedImageUrl(post.mediaRefs);

      if (isProtectedPost) {
        return {
          title: post.title,
          slug: post.slug,
          excerpt: post.excerpt,
          content: buildFeedLeadHtml(postUrl),
          publishedAt: post.publishedAt,
          updatedAt: post.updatedAt,
          author: post.author,
          categories: post.categories,
          featuredImage,
        };
      }

      // text-version v2: content 字段已经是最新内容
      const latestContent = post.content;

      let content = latestContent;
      const excerpt = post.excerpt;

      if (rssConfig.showFullContent) {
        // 转换为 HTML
        const markdownWithoutTitle = stripLeadingMarkdownTitle(
          latestContent,
          post.title,
        );
        content = await markdownToHtml(markdownWithoutTitle);
        content = stripLeadingHtmlTitle(content, post.title);
      } else {
        content = ""; // 不显示全文
        if (!excerpt && rssConfig.autoGenerateExcerpt) {
          // 简单截取摘要并转换为 HTML
          const truncatedMarkdown =
            latestContent.substring(0, rssConfig.maxExcerptLength) + "...";
          content = await markdownToHtml(truncatedMarkdown);
        } else {
          content = excerpt || "";
        }
      }

      content = prependFeedLead(content, postUrl);

      return {
        title: post.title,
        slug: post.slug,
        excerpt: excerpt,
        content: content,
        publishedAt: post.publishedAt,
        updatedAt: post.updatedAt,
        author: post.author,
        categories: post.categories,
        featuredImage,
      };
    }),
  );

  return {
    posts: formattedPosts,
    pages,
    categories: formattedCategories,
    tags: formattedTags,
    siteConfig,
    rssConfig,
  };
}
