import "server-only";

import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type {
  PostStatus,
  SearchPosts,
  SearchPostsResult,
  SearchPostsResultItem,
} from "@repo/shared-types/api/search";
import { SearchPostsSchema } from "@repo/shared-types/api/search";
import { headers } from "next/headers";
import type { NextResponse } from "next/server";

import { getClientIP } from "@/lib/server/get-client-info";
import { generateSignature } from "@/lib/server/image-crypto";
import prisma from "@/lib/server/prisma";
import limitControl from "@/lib/server/rate-limit";
import ResponseBuilder from "@/lib/server/response";
import { generateSmartExcerpt, highlightTitle } from "@/lib/server/search";
import { sanitizeTsqueryToken } from "@/lib/server/search-token";
import { analyzeText } from "@/lib/server/tokenizer";
import { validateData } from "@/lib/server/validator";
import type {
  SearchSiteCategoryItem,
  SearchSiteParams,
  SearchSitePhotoItem,
  SearchSitePostItem,
  SearchSiteProjectItem,
  SearchSiteResult,
  SearchSiteTagItem,
} from "@/lib/shared/search-site";
import { SearchSiteSchema } from "@/lib/shared/search-site";

type ActionEnvironment = "serverless" | "serveraction";
type ActionConfig = { environment?: ActionEnvironment };
type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

function createEmptySearchSiteResult(query: string): SearchSiteResult {
  return {
    query,
    posts: [],
    projects: [],
    tags: [],
    categories: [],
    photos: [],
    counts: {
      posts: 0,
      projects: 0,
      tags: 0,
      categories: 0,
      photos: 0,
      total: 0,
    },
  };
}

/*
  searchPosts - 搜索文章
*/
export async function searchPosts(
  params: SearchPosts,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<SearchPostsResult | null>>>;
export async function searchPosts(
  params: SearchPosts,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<SearchPostsResult | null>>;
export async function searchPosts(
  {
    query,
    page = 1,
    pageSize = 10,
    searchIn = "both",
    status,
    sessionId,
    visitorId,
  }: SearchPosts,
  serverConfig?: ActionConfig,
): Promise<ActionResult<SearchPostsResult | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "searchPosts"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      query,
      page,
      pageSize,
      searchIn,
      status,
    },
    SearchPostsSchema,
  );

  if (validationError) return response.badRequest(validationError);

  try {
    // 记录搜索开始时间
    const searchStartTime = performance.now();

    // 1. 对搜索词进行分词
    const tokens = await analyzeText(query);

    if (tokens.length === 0) {
      // 即使没有分词结果，也要记录搜索日志
      const searchEndTime = performance.now();
      const durationMs = Math.round(searchEndTime - searchStartTime);

      // 获取客户端 IP
      const clientIP = await getClientIP();

      const { after } = await import("next/server");
      after(async () => {
        await prisma.searchLog.create({
          data: {
            query,
            tokens: [],
            resultCount: 0,
            durationMs,
            ip: clientIP,
            sessionId: sessionId || null,
            visitorId: visitorId || null,
          },
        });
      });

      return response.ok({
        data: {
          posts: [],
          total: 0,
          query,
          tokensUsed: [],
        },
      });
    }

    // 2. 安全转义 token 以便用于 PostgreSQL tsquery（移除所有运算符）
    const escapedTokens = tokens
      .map(sanitizeTsqueryToken)
      .filter((t) => t.length > 0);

    if (escapedTokens.length === 0) {
      // 分词后无有效 token，返回空结果
      const searchEndTime = performance.now();
      const durationMs = Math.round(searchEndTime - searchStartTime);
      const clientIP = await getClientIP();
      const { after } = await import("next/server");
      after(async () => {
        await prisma.searchLog.create({
          data: {
            query,
            tokens: [],
            resultCount: 0,
            durationMs,
            ip: clientIP,
            sessionId: sessionId || null,
            visitorId: visitorId || null,
          },
        });
      });
      return response.ok({
        data: {
          posts: [],
          total: 0,
          query,
          tokensUsed: tokens,
        },
      });
    }

    // 3. 准备查询字符串
    // OR 查询：用于 WHERE 过滤（保证召回率）和基础相关性
    const orQueryStr = escapedTokens.join(" | ");
    // AND 查询：用于排序加分，奖励包含所有词的文章
    const andQueryStr = escapedTokens.join(" & ");
    // PHRASE 查询：用于排序加分，奖励包含连续短语的文章
    const phraseQueryStr = escapedTokens.join(" <-> ");

    // 3. 根据 searchIn 参数决定搜索字段和排名计算
    // 我们将使用三个参数 $1(OR), $2(AND), $3(PHRASE)
    // 基础权重配置
    const weights = {
      title: {
        or: 2.0,
        and: 5.0,
        phrase: 10.0,
      },
      content: {
        or: 1.0,
        and: 2.0,
        phrase: 5.0,
      },
    };

    let whereClause = "";
    let rankExpression = "";

    if (searchIn === "title") {
      whereClause = `"titleSearchVector" @@ to_tsquery('simple', $1)`;
      rankExpression = `
        (
          ts_rank_cd("titleSearchVector", to_tsquery('simple', $1)) * ${weights.title.or} +
          ts_rank_cd("titleSearchVector", to_tsquery('simple', $2)) * ${weights.title.and} +
          ts_rank_cd("titleSearchVector", to_tsquery('simple', $3)) * ${weights.title.phrase}
        )
      `;
    } else if (searchIn === "content") {
      whereClause = `"contentSearchVector" @@ to_tsquery('simple', $1)`;
      rankExpression = `
        (
          ts_rank_cd("contentSearchVector", to_tsquery('simple', $1), 32) * ${weights.content.or} +
          ts_rank_cd("contentSearchVector", to_tsquery('simple', $2), 32) * ${weights.content.and} +
          ts_rank_cd("contentSearchVector", to_tsquery('simple', $3), 32) * ${weights.content.phrase}
        )
      `;
    } else {
      // both
      whereClause = `("titleSearchVector" @@ to_tsquery('simple', $1) OR "contentSearchVector" @@ to_tsquery('simple', $1))`;
      rankExpression = `
        (
          -- 标题得分 (高权重，无归一化)
          ts_rank_cd("titleSearchVector", to_tsquery('simple', $1)) * ${weights.title.or} +
          ts_rank_cd("titleSearchVector", to_tsquery('simple', $2)) * ${weights.title.and} +
          ts_rank_cd("titleSearchVector", to_tsquery('simple', $3)) * ${weights.title.phrase} +
          -- 内容得分 (低权重，有归一化)
          ts_rank_cd("contentSearchVector", to_tsquery('simple', $1), 32) * ${weights.content.or} +
          ts_rank_cd("contentSearchVector", to_tsquery('simple', $2), 32) * ${weights.content.and} +
          ts_rank_cd("contentSearchVector", to_tsquery('simple', $3), 32) * ${weights.content.phrase}
        )
      `;
    }

    // 4. 构建完整的 WHERE 条件
    // 参数索引偏移：搜索相关参数占用了 $1, $2, $3
    // 如果有 status，它是 $4
    const statusFilter = status ? ` AND "status" = $4` : "";
    const fullWhereClause = `${whereClause}${statusFilter} AND "deletedAt" IS NULL AND "accessMode" = 'PUBLIC'`;

    // 5. 计算总数
    // count 查询只需要 $1 (OR query) 和 status (如果有)
    const countQuery = `
        SELECT COUNT(*)::bigint as count
        FROM "Post"
        WHERE ${whereClause}${status ? ` AND "status" = $2` : ""} AND "deletedAt" IS NULL AND "accessMode" = 'PUBLIC'
      `;

    const countParams = status ? [orQueryStr, status] : [orQueryStr];

    const countResult = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      countQuery,
      ...countParams,
    );

    const total = Number(countResult[0]?.count || 0);

    if (total === 0) {
      // 即使没有搜索结果，也要记录搜索日志
      const searchEndTime = performance.now();
      const durationMs = Math.round(searchEndTime - searchStartTime);

      // 获取客户端 IP
      const clientIP = await getClientIP();

      const { after } = await import("next/server");
      after(async () => {
        await prisma.searchLog.create({
          data: {
            query,
            tokens,
            resultCount: 0,
            durationMs,
            ip: clientIP,
            sessionId: sessionId || null,
            visitorId: visitorId || null,
          },
        });
      });

      return response.ok({
        data: {
          posts: [],
          total: 0,
          query,
          tokensUsed: tokens,
        },
      });
    }

    // 6. 执行搜索查询（限制最多20条）
    const skip = (page - 1) * pageSize;
    const effectivePageSize = Math.min(pageSize, 20); // 限制最多20条

    // 参数索引:
    // $1: orQuery
    // $2: andQuery
    // $3: phraseQuery
    // $4: status (optional)
    // Next: limit, offset

    // 根据是否有 status 决定 limit/offset 的索引
    const limitIdx = status ? 5 : 4;
    const offsetIdx = status ? 6 : 5;

    const searchQuery = `
      SELECT
        p.id,
        p.slug,
        p.title,
        p.status,
        p."publishedAt",
        p."createdAt",
        p."updatedAt",
        p."userUid",
        p."isPinned",
        (${rankExpression}) as rank,
        p.plain
      FROM "Post" p
      WHERE ${fullWhereClause}
      ORDER BY rank DESC, p."updatedAt" DESC
      LIMIT $${limitIdx}
      OFFSET $${offsetIdx}
    `;

    const searchParams: (string | number)[] = [
      orQueryStr,
      andQueryStr,
      phraseQueryStr,
    ];
    if (status) searchParams.push(status);
    searchParams.push(effectivePageSize, skip);

    const rawPosts = await prisma.$queryRawUnsafe<
      Array<{
        id: number;
        slug: string;
        title: string;
        status: string;
        publishedAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
        userUid: number;
        isPinned: boolean;
        rank: number;
        plain: string | null;
      }>
    >(searchQuery, ...searchParams);

    // 7. 使用 Prisma 关系查询获取完整的文章信息（包括分类、标签、封面）
    const postIds = rawPosts.map((p) => p.id);

    const posts = await prisma.post.findMany({
      where: {
        id: { in: postIds },
        accessMode: "PUBLIC",
      },
      select: {
        id: true,
        slug: true,
        title: true,
        excerpt: true,
        status: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true,
        isPinned: true,
        userUid: true,
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
        mediaRefs: {
          where: {
            slot: "featuredImage",
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
          take: 1,
        },
      },
    });

    // 构建 postId 到 rank 和 highlight 的映射
    const postMetaMap = new Map(
      rawPosts.map((p) => [
        p.id,
        {
          rank: p.rank,
          titleHighlight: highlightTitle(p.title, tokens),
          excerptHighlight: p.plain
            ? generateSmartExcerpt(p.plain, tokens)
            : null,
        },
      ]),
    );

    // 8. 获取作者信息
    const userUids = posts.map((p) => p.userUid);
    const users = await prisma.user.findMany({
      where: {
        uid: { in: userUids },
      },
      select: {
        uid: true,
        username: true,
        nickname: true,
      },
    });

    const userMap = new Map(users.map((u) => [u.uid, u]));

    // 9. 组装结果
    // 关键修正：必须遍历 rawPosts (有序) 而不是 posts (无序)，以保持搜索排名
    const postsMap = new Map(posts.map((p) => [p.id, p]));

    // 收集所有分类 ID 批量获取路径
    const allCategoryIds = new Set<number>();
    posts.forEach((p) => {
      p.categories.forEach((cat) => allCategoryIds.add(cat.id));
    });

    const { batchGetCategoryPaths } = await import(
      "@/lib/server/category-utils"
    );
    const categoryPathsMap = await batchGetCategoryPaths(
      Array.from(allCategoryIds),
    );

    const result = rawPosts
      .map((rawPost) => {
        const post = postsMap.get(rawPost.id);
        if (!post) return null;

        // 展开分类并去重
        const expandedCategories: { name: string; slug: string }[] = [];
        const seenSlugs = new Set<string>();

        post.categories.forEach((cat) => {
          const fullPath = categoryPathsMap.get(cat.id) || [];
          fullPath.forEach((pathItem) => {
            if (!seenSlugs.has(pathItem.slug)) {
              seenSlugs.add(pathItem.slug);
              expandedCategories.push(pathItem);
            }
          });
        });

        const author = userMap.get(post.userUid) || {
          uid: post.userUid,
          username: "unknown",
          nickname: null,
        };

        const postMeta = postMetaMap.get(post.id) || {
          rank: 0,
          titleHighlight: post.title,
          excerptHighlight: null,
        };

        const mediaRef = post.mediaRefs[0];
        const coverData = mediaRef
          ? {
              url: `/p/${mediaRef.media.shortHash}${generateSignature(mediaRef.media.shortHash)}`,
              width: mediaRef.media.width,
              height: mediaRef.media.height,
              blur: mediaRef.media.blur,
            }
          : undefined;

        return {
          id: post.id,
          slug: post.slug,
          title: post.title,
          excerpt: post.excerpt,
          status: post.status as PostStatus,
          publishedAt: post.publishedAt?.toISOString() || null,
          createdAt: post.createdAt.toISOString(),
          updatedAt: post.updatedAt.toISOString(),
          author,
          rank: postMeta.rank,
          isPinned: post.isPinned,
          categories: expandedCategories,
          tags: post.tags,
          coverData,
          titleHighlight: postMeta.titleHighlight,
          excerptHighlight: postMeta.excerptHighlight,
        } as SearchPostsResultItem;
      })
      .filter((item): item is SearchPostsResultItem => item !== null);

    // 10. 记录搜索日志
    const searchEndTime = performance.now();
    const durationMs = Math.round(searchEndTime - searchStartTime);

    // 获取客户端 IP
    const clientIP = await getClientIP();

    const { after } = await import("next/server");
    after(async () => {
      await prisma.searchLog.create({
        data: {
          query,
          tokens,
          resultCount: total,
          durationMs,
          ip: clientIP,
          sessionId: sessionId || null,
          visitorId: visitorId || null,
        },
      });
    });

    // 11. 返回结果
    const meta = {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      hasNext: page < Math.ceil(total / pageSize),
      hasPrev: page > 1,
    };

    return response.ok({
      data: {
        posts: result,
        total,
        query,
        tokensUsed: tokens,
      },
      meta,
    });
  } catch (error) {
    console.error("搜索文章失败:", error);
    return response.serverError({ message: "搜索文章失败" });
  }
}

/*
  searchSite - 全站搜索
*/
export async function searchSite(
  params: SearchSiteParams,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<SearchSiteResult | null>>>;
export async function searchSite(
  params: SearchSiteParams,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<SearchSiteResult | null>>;
export async function searchSite(
  { query, sessionId, visitorId }: SearchSiteParams,
  serverConfig?: ActionConfig,
): Promise<ActionResult<SearchSiteResult | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "searchSite"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      query,
      sessionId,
      visitorId,
    },
    SearchSiteSchema,
  );

  if (validationError) return response.badRequest(validationError);

  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    return response.ok({
      data: createEmptySearchSiteResult(""),
    });
  }

  const likePattern = `%${normalizedQuery}%`;
  const prefixPattern = `${normalizedQuery}%`;

  try {
    const [postsResponse, rawProjects, rawTags, rawCategories, rawPhotos] =
      await Promise.all([
        searchPosts({
          query: normalizedQuery,
          page: 1,
          pageSize: 20,
          searchIn: "both",
          status: "PUBLISHED",
          sessionId,
          visitorId,
        }),
        prisma.$queryRaw<
          Array<{
            id: number;
            slug: string;
            title: string;
            description: string;
          }>
        >`
          SELECT
            p."id",
            p."slug",
            p."title",
            p."description"
          FROM "Project" p
          WHERE p."status" = 'PUBLISHED'
            AND p."deletedAt" IS NULL
            AND (
              LOWER(p."title") LIKE LOWER(${likePattern})
              OR LOWER(p."slug") LIKE LOWER(${likePattern})
              OR LOWER(COALESCE(p."description", '')) LIKE LOWER(${likePattern})
            )
          ORDER BY
            CASE
              WHEN LOWER(p."title") LIKE LOWER(${prefixPattern}) THEN 0
              WHEN LOWER(p."slug") LIKE LOWER(${prefixPattern}) THEN 1
              ELSE 2
            END,
            COALESCE(p."publishedAt", p."updatedAt") DESC
          LIMIT 20
        `,
        prisma.$queryRaw<
          Array<{
            slug: string;
            name: string;
            description: string | null;
          }>
        >`
          SELECT
            t."slug",
            t."name",
            t."description"
          FROM "Tag" t
          WHERE
            LOWER(t."name") LIKE LOWER(${likePattern})
            OR LOWER(t."slug") LIKE LOWER(${likePattern})
            OR LOWER(COALESCE(t."description", '')) LIKE LOWER(${likePattern})
          ORDER BY
            CASE
              WHEN LOWER(t."name") LIKE LOWER(${prefixPattern}) THEN 0
              WHEN LOWER(t."slug") LIKE LOWER(${prefixPattern}) THEN 1
              ELSE 2
            END,
            t."updatedAt" DESC
          LIMIT 20
        `,
        prisma.$queryRaw<
          Array<{
            id: number;
            slug: string;
            name: string;
            fullSlug: string;
            description: string | null;
          }>
        >`
          SELECT
            c."id",
            c."slug",
            c."name",
            c."fullSlug",
            c."description"
          FROM "Category" c
          WHERE
            LOWER(c."name") LIKE LOWER(${likePattern})
            OR LOWER(c."slug") LIKE LOWER(${likePattern})
            OR LOWER(c."fullSlug") LIKE LOWER(${likePattern})
            OR LOWER(COALESCE(c."description", '')) LIKE LOWER(${likePattern})
          ORDER BY
            CASE
              WHEN LOWER(c."name") LIKE LOWER(${prefixPattern}) THEN 0
              WHEN LOWER(c."fullSlug") LIKE LOWER(${prefixPattern}) THEN 1
              ELSE 2
            END,
            c."depth" ASC,
            c."updatedAt" DESC
          LIMIT 20
        `,
        prisma.$queryRaw<
          Array<{
            slug: string;
            name: string;
            description: string | null;
            shortHash: string;
          }>
        >`
          SELECT
            p."slug",
            p."name",
            p."description",
            m."shortHash"
          FROM "Photo" p
          INNER JOIN "Media" m ON m."id" = p."mediaId"
          WHERE
            LOWER(p."name") LIKE LOWER(${likePattern})
            OR LOWER(p."slug") LIKE LOWER(${likePattern})
            OR LOWER(COALESCE(p."description", '')) LIKE LOWER(${likePattern})
            OR LOWER(COALESCE(m."originalName", '')) LIKE LOWER(${likePattern})
            OR LOWER(COALESCE(m."altText", '')) LIKE LOWER(${likePattern})
          ORDER BY
            CASE
              WHEN LOWER(p."name") LIKE LOWER(${prefixPattern}) THEN 0
              WHEN LOWER(p."slug") LIKE LOWER(${prefixPattern}) THEN 1
              ELSE 2
            END,
            p."sortTime" DESC
          LIMIT 20
        `,
      ]);

    const posts: SearchSitePostItem[] =
      postsResponse.success && postsResponse.data?.posts
        ? postsResponse.data.posts.map((post) => ({
            slug: post.slug,
            title: post.title,
            excerpt: post.excerpt,
            titleHighlight: post.titleHighlight,
            excerptHighlight: post.excerptHighlight,
          }))
        : [];

    const projects: SearchSiteProjectItem[] = rawProjects.map((project) => ({
      id: project.id,
      slug: project.slug,
      title: project.title,
      description: project.description,
    }));

    const tags: SearchSiteTagItem[] = rawTags.map((tag) => ({
      slug: tag.slug,
      name: tag.name,
      description: tag.description,
    }));

    const categories: SearchSiteCategoryItem[] = rawCategories.map(
      (category) => ({
        id: category.id,
        slug: category.slug,
        name: category.name,
        fullSlug: category.fullSlug || category.slug,
        description: category.description,
      }),
    );

    const photos: SearchSitePhotoItem[] = rawPhotos.map((photo) => ({
      slug: photo.slug,
      name: photo.name,
      description: photo.description,
      imageUrl: `/p/${photo.shortHash}${generateSignature(photo.shortHash)}`,
    }));

    const counts = {
      posts: posts.length,
      projects: projects.length,
      tags: tags.length,
      categories: categories.length,
      photos: photos.length,
      total:
        posts.length +
        projects.length +
        tags.length +
        categories.length +
        photos.length,
    };

    return response.ok({
      data: {
        query: normalizedQuery,
        posts,
        projects,
        tags,
        categories,
        photos,
        counts,
      },
    });
  } catch (error) {
    console.error("全站搜索失败:", error);
    return response.serverError({ message: "全站搜索失败" });
  }
}
