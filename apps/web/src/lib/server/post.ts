import { unstable_cache } from "next/cache";
import { notFound } from "next/navigation";

import { getFeaturedImageUrl } from "@/lib/server/media-reference";
import {
  LISTABLE_POST_PUBLISHED_WHERE,
  LISTABLE_POST_VISIBLE_WHERE,
  PUBLIC_POST_STATUSES,
  PUBLIC_VISIBLE_POST_WHERE,
} from "@/lib/server/post-access";
import prisma from "@/lib/server/prisma";
import { MEDIA_SLOTS } from "@/types/media";

export interface PostData {
  id?: number;
  title: string;
  slug: string;
  content?: string;
  excerpt: string | null;
  status?: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  isPinned: boolean;
  allowComments?: boolean;
  publishedAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
  featuredImage?: string | null;
  license?: string | null;
  metaDescription?: string | null;
  metaKeywords?: string | null;
  robotsIndex?: boolean;
  postMode?: "MARKDOWN" | "MDX";
  accessMode?: "PUBLIC" | "ROLE" | "PASSWORD";
  minRole?: "USER" | "ADMIN" | "EDITOR" | "AUTHOR" | null;
  // 为搜索结果添加的额外属性
  summary?: string; // PostCard 需要的摘要属性
  cover?:
    | Array<{
        url: string;
        width?: number;
        height?: number;
        blur?: string;
      }>
    | string; // PostCard 需要的封面属性
  author?: {
    uid: number;
    username: string;
    nickname: string | null;
  };
  categories?: Array<{
    id?: number;
    name: string;
    slug?: string;
  }>;
  tags?: Array<{
    name: string;
    slug: string;
  }>;
  _count?: {
    comments: number;
  };
  viewCount?: number;
}

export type FullPostData = Omit<PostData, "categories" | "tags" | "author"> & {
  id: number;
  content: string;
  allowComments: boolean;
  accessMode: "PUBLIC" | "ROLE" | "PASSWORD";
  minRole: "USER" | "ADMIN" | "EDITOR" | "AUTHOR" | null;
  author: NonNullable<PostData["author"]>;
  categories: Array<{
    id: number;
    name: string;
    slug?: string;
  }>;
  tags: NonNullable<PostData["tags"]>;
  createdAt: Date;
  updatedAt: Date;
};

export interface LatestPostJsonLdItem {
  title: string;
  slug: string;
  excerpt: string | null;
  metaDescription: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  featuredImage: string | null;
  author: {
    name: string;
    profilePath: string;
  } | null;
}

export interface PostShellData {
  id: number;
  title: string;
  slug: string;
  excerpt: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  featuredImage: string | null;
  metaDescription: string | null;
  metaKeywords: string | null;
  robotsIndex: boolean;
  allowComments: boolean;
  license: string | null;
  accessMode: "PUBLIC" | "ROLE" | "PASSWORD";
  minRole: "USER" | "ADMIN" | "EDITOR" | "AUTHOR" | null;
  contentLength: number;
  viewCount: number;
  categories: Array<{
    id: number;
    name: string;
    slug?: string;
  }>;
  tags: Array<{
    name: string;
    slug: string;
  }>;
  _count: {
    comments: number;
  };
  author: {
    uid: number;
    username: string;
    nickname: string | null;
  };
}

export interface RenderedContent {
  content: string;
  mode: "markdown" | "mdx";
}

/**
 * 获取公开的文章数据
 * 返回已发布或已归档且未被删除的文章
 */
export async function getPublishedPost(slug: string): Promise<FullPostData> {
  const getCachedData = unstable_cache(
    async (s: string) => {
      const post = await prisma.post.findFirst({
        where: {
          slug: s,
          ...PUBLIC_VISIBLE_POST_WHERE,
        },
        select: {
          id: true,
          title: true,
          slug: true,
          content: true,
          excerpt: true,
          status: true,
          isPinned: true,
          allowComments: true,
          publishedAt: true,
          createdAt: true,
          updatedAt: true,
          metaDescription: true,
          metaKeywords: true,
          robotsIndex: true,
          postMode: true,
          license: true,
          accessMode: true,
          minRole: true,
          author: {
            select: {
              uid: true,
              username: true,
              nickname: true,
            },
          },
          categories: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
          tags: {
            select: {
              name: true,
              slug: true,
            },
          },
          _count: {
            select: {
              comments: {
                where: {
                  status: "APPROVED",
                  deletedAt: null,
                },
              },
            },
          },
          viewCount: {
            select: {
              cachedCount: true,
            },
          },
          mediaRefs: {
            include: {
              media: {
                select: {
                  shortHash: true,
                  width: true,
                  height: true,
                  blur: true,
                },
              },
            },
          },
        },
      });

      if (!post) {
        return null;
      }

      // 提取特色图片URL
      const featuredImage = getFeaturedImageUrl(post.mediaRefs);

      return {
        ...post,
        viewCount: post.viewCount?.cachedCount || 0,
        featuredImage,
      } as FullPostData;
    },
    [`public-post-${slug}`],
    {
      tags: ["posts/list", `posts/${slug}`],
      revalidate: false,
    },
  );

  const result = await getCachedData(slug);

  if (!result) {
    notFound();
  }

  return result;
}

export async function getPostShell(slug: string): Promise<PostShellData> {
  const getCachedData = unstable_cache(
    async (s: string) => {
      const post = await prisma.post.findFirst({
        where: {
          slug: s,
          status: {
            in: [...PUBLIC_POST_STATUSES],
          },
          deletedAt: null,
        },
        select: {
          id: true,
          title: true,
          slug: true,
          content: true,
          excerpt: true,
          publishedAt: true,
          createdAt: true,
          updatedAt: true,
          metaDescription: true,
          metaKeywords: true,
          robotsIndex: true,
          allowComments: true,
          license: true,
          accessMode: true,
          minRole: true,
          categories: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
          tags: {
            select: {
              name: true,
              slug: true,
            },
          },
          _count: {
            select: {
              comments: {
                where: {
                  status: "APPROVED",
                  deletedAt: null,
                },
              },
            },
          },
          viewCount: {
            select: {
              cachedCount: true,
            },
          },
          author: {
            select: {
              uid: true,
              username: true,
              nickname: true,
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

      if (!post) {
        return null;
      }

      const { mediaRefs, content, viewCount, ...rest } = post;
      return {
        ...rest,
        featuredImage: getFeaturedImageUrl(mediaRefs),
        contentLength: content.length,
        viewCount: viewCount?.cachedCount || 0,
      };
    },
    [`post-shell-${slug}`],
    {
      tags: ["posts/list", `posts/${slug}`],
      revalidate: false,
    },
  );

  const result = await getCachedData(slug);

  if (!result) {
    notFound();
  }

  return result;
}

export async function getLatestPublishedPostsForJsonLd(
  limit: number = 10,
): Promise<LatestPostJsonLdItem[]> {
  const normalizedLimit =
    Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 20) : 10;

  const getCachedData = unstable_cache(
    async (take: number) => {
      const posts = await prisma.post.findMany({
        where: {
          ...LISTABLE_POST_PUBLISHED_WHERE,
        },
        select: {
          title: true,
          slug: true,
          excerpt: true,
          metaDescription: true,
          publishedAt: true,
          createdAt: true,
          updatedAt: true,
          mediaRefs: {
            include: {
              media: {
                select: {
                  shortHash: true,
                },
              },
            },
          },
          author: {
            select: {
              uid: true,
              username: true,
              nickname: true,
            },
          },
        },
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
        take,
      });

      return posts.map((post) => ({
        title: post.title,
        slug: post.slug,
        excerpt: post.excerpt,
        metaDescription: post.metaDescription,
        publishedAt: post.publishedAt,
        createdAt: post.createdAt,
        updatedAt: post.updatedAt,
        featuredImage: getFeaturedImageUrl(post.mediaRefs),
        author: post.author
          ? {
              name: post.author.nickname || post.author.username,
              profilePath: `/user/${post.author.uid}`,
            }
          : null,
      }));
    },
    [`latest-posts-jsonld-${normalizedLimit}`],
    {
      tags: ["posts/list"],
      revalidate: false,
    },
  );

  return getCachedData(normalizedLimit);
}

/**
 * 渲染文章内容
 */
export async function renderPostContent(
  post: PostData,
): Promise<RenderedContent> {
  // text-version v2: 直接使用 content 字段（已经是最新内容）
  const latestContent = post.content || "";

  if (post.postMode === "MARKDOWN") {
    // Markdown 模式：直接返回原始内容，由 react-markdown 在组件中渲染
    return { content: latestContent, mode: "markdown" };
  } else if (post.postMode === "MDX") {
    // MDX 模式：直接返回原始内容，由 MDXRemote 在组件中编译和渲染
    // MDXRemote (RSC) 会自己处理编译，不需要提前 serialize
    return { content: latestContent, mode: "mdx" };
  } else {
    throw new Error(`Unsupported post mode: ${post.postMode}`);
  }
}

export interface AdjacentPostData {
  title: string;
  slug: string;
  publishedAt: Date | null;
  categories: Array<{
    name: string;
    slug: string;
  }>;
  tags: Array<{
    name: string;
    slug: string;
  }>;
  excerpt: string | null;
  isPinned: boolean;
  mediaRefs: Array<{
    slot: string;
    media: { shortHash: string };
  }>;
}

export interface AdjacentPosts {
  previous: AdjacentPostData | null;
  next: AdjacentPostData | null;
}

export interface RecommendedPostData {
  title: string;
  slug: string;
  excerpt: string | null;
  publishedAt: Date | null;
  featuredImage?: string | null;
  categories: Array<{
    name: string;
    slug: string;
  }>;
  tags: Array<{
    name: string;
    slug: string;
  }>;
  recommendationScore: number;
  matchedKeywords: string[];
}

const RECOMMENDATION_DEFAULT_LIMIT = 6;
const RECOMMENDATION_DEFAULT_CANDIDATE_LIMIT = 80;

function toSafePositiveInt(
  value: number,
  fallback: number,
  max: number,
): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  const integer = Math.trunc(value);
  if (integer <= 0) {
    return fallback;
  }

  return Math.min(integer, max);
}

/**
 * 获取相邻的文章（上一篇和下一篇）
 * 基于发布时间排序
 */
export async function getAdjacentPosts(
  currentSlug: string,
): Promise<AdjacentPosts> {
  const getCachedData = unstable_cache(
    async (slug: string) => {
      // 首先获取当前文章的发布时间
      const currentPost = await prisma.post.findUnique({
        where: {
          slug,
          ...LISTABLE_POST_VISIBLE_WHERE,
        },
        select: { publishedAt: true },
      });

      if (!currentPost?.publishedAt) {
        return { previous: null, next: null };
      }

      const baseWhere = {
        ...LISTABLE_POST_VISIBLE_WHERE,
        publishedAt: { not: null },
      };

      // 获取上一篇文章（发布时间早于当前文章的最新一篇）
      const previousPost = await prisma.post.findFirst({
        where: {
          ...baseWhere,
          publishedAt: { lt: currentPost.publishedAt },
        },
        orderBy: { publishedAt: "desc" },
        select: {
          title: true,
          slug: true,
          publishedAt: true,
          excerpt: true,
          isPinned: true,
          categories: {
            select: {
              name: true,
              slug: true,
            },
          },
          tags: {
            select: {
              name: true,
              slug: true,
            },
          },
          mediaRefs: {
            include: {
              media: {
                select: {
                  shortHash: true,
                  width: true,
                  height: true,
                  blur: true,
                },
              },
            },
          },
        },
      });

      // 获取下一篇文章（发布时间晚于当前文章的最早一篇）
      const nextPost = await prisma.post.findFirst({
        where: {
          ...baseWhere,
          publishedAt: { gt: currentPost.publishedAt },
        },
        orderBy: { publishedAt: "asc" },
        select: {
          title: true,
          slug: true,
          publishedAt: true,
          excerpt: true,
          isPinned: true,
          categories: {
            select: {
              name: true,
              slug: true,
            },
          },
          tags: {
            select: {
              name: true,
              slug: true,
            },
          },
          mediaRefs: {
            include: {
              media: {
                select: {
                  shortHash: true,
                  width: true,
                  height: true,
                  blur: true,
                },
              },
            },
          },
        },
      });

      return {
        previous: previousPost,
        next: nextPost,
      };
    },
    [`adjacent-posts-${currentSlug}`],
    {
      tags: ["posts/list"],
      revalidate: false,
    },
  );

  const cachedAdjacentPosts = await getCachedData(currentSlug);

  const normalizeAdjacentPost = (
    post: AdjacentPostData | null,
  ): AdjacentPostData | null => {
    if (!post) {
      return null;
    }

    return {
      ...post,
      publishedAt: post.publishedAt ? new Date(post.publishedAt) : null,
    };
  };

  return {
    previous: normalizeAdjacentPost(cachedAdjacentPosts.previous),
    next: normalizeAdjacentPost(cachedAdjacentPosts.next),
  };
}

/**
 * 获取推荐文章
 * 推荐维度：分类、标签
 */
export async function getRecommendedPosts(
  currentPost: Pick<FullPostData, "slug" | "categories" | "tags">,
  options?: {
    limit?: number;
    candidateLimit?: number;
  },
): Promise<RecommendedPostData[]> {
  const limit = toSafePositiveInt(
    options?.limit ?? RECOMMENDATION_DEFAULT_LIMIT,
    RECOMMENDATION_DEFAULT_LIMIT,
    12,
  );
  const candidateLimit = toSafePositiveInt(
    options?.candidateLimit ?? RECOMMENDATION_DEFAULT_CANDIDATE_LIMIT,
    RECOMMENDATION_DEFAULT_CANDIDATE_LIMIT,
    200,
  );

  const getCachedData = unstable_cache(
    async (): Promise<RecommendedPostData[]> => {
      const currentCategoryIds = new Set(
        currentPost.categories
          .filter(
            (category) =>
              typeof category.slug === "string" &&
              category.slug !== "uncategorized",
          )
          .map((c) => c.id),
      );
      const currentTagSlugs = new Set(currentPost.tags.map((t) => t.slug));
      const relationQueryTake = Math.min(
        candidateLimit,
        Math.max(limit * 6, 24),
      );

      // 精确推荐：仅当存在有效分类（排除未分类）或标签时才推荐
      if (currentCategoryIds.size === 0 && currentTagSlugs.size === 0) {
        return [];
      }

      const postSelect = {
        title: true,
        slug: true,
        excerpt: true,
        publishedAt: true,
        createdAt: true,
        mediaRefs: {
          where: {
            slot: MEDIA_SLOTS.POST_FEATURED_IMAGE,
          },
          include: {
            media: {
              select: {
                shortHash: true,
                width: true,
                height: true,
                blur: true,
              },
            },
          },
        },
        categories: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        tags: {
          select: {
            name: true,
            slug: true,
          },
        },
      };

      const baseWhere = {
        ...LISTABLE_POST_VISIBLE_WHERE,
      };

      const relationWhereClauses: Array<Record<string, unknown>> = [];
      if (currentCategoryIds.size > 0) {
        relationWhereClauses.push({
          categories: {
            some: {
              id: {
                in: Array.from(currentCategoryIds),
              },
            },
          },
        });
      }
      if (currentTagSlugs.size > 0) {
        relationWhereClauses.push({
          tags: {
            some: {
              slug: {
                in: Array.from(currentTagSlugs),
              },
            },
          },
        });
      }

      const relationCandidates = await prisma.post.findMany({
        where: {
          ...baseWhere,
          slug: { not: currentPost.slug },
          OR: relationWhereClauses,
        },
        select: postSelect,
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
        take: relationQueryTake,
      });

      const scoredPosts = relationCandidates.map((candidate) => {
        const matchedCategoryCount = candidate.categories.reduce(
          (count, cat) => {
            return count + (currentCategoryIds.has(cat.id) ? 1 : 0);
          },
          0,
        );
        const matchedTagCount = candidate.tags.reduce((count, tag) => {
          return count + (currentTagSlugs.has(tag.slug) ? 1 : 0);
        }, 0);
        const recommendationScore =
          matchedCategoryCount * 12 + matchedTagCount * 8;

        return {
          ...candidate,
          recommendationScore,
          matchedKeywords: [],
        };
      });

      scoredPosts.sort((a, b) => {
        if (b.recommendationScore !== a.recommendationScore) {
          return b.recommendationScore - a.recommendationScore;
        }

        const bPublished = b.publishedAt?.getTime() || 0;
        const aPublished = a.publishedAt?.getTime() || 0;
        return bPublished - aPublished;
      });

      const selected = scoredPosts
        .filter((post) => post.recommendationScore > 0)
        .slice(0, limit);

      return selected.map((post) => ({
        title: post.title,
        slug: post.slug,
        excerpt: post.excerpt,
        publishedAt: post.publishedAt,
        featuredImage: getFeaturedImageUrl(post.mediaRefs),
        categories: post.categories.map((category) => ({
          name: category.name,
          slug: category.slug,
        })),
        tags: post.tags,
        recommendationScore: post.recommendationScore,
        matchedKeywords: post.matchedKeywords.slice(0, 5),
      }));
    },
    [`recommended-posts-${currentPost.slug}-${limit}-${candidateLimit}`],
    {
      tags: ["posts/list", `posts/${currentPost.slug}`],
      revalidate: false,
    },
  );

  return getCachedData();
}
