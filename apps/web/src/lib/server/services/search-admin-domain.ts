import "server-only";

import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type {
  AddCustomWord,
  AddCustomWordResult,
  CustomWordItem,
  DeleteCustomWord,
  DeleteCustomWordResult,
  DeleteIndex,
  DeleteIndexResult,
  GetCustomWords,
  GetIndexStatus,
  GetPostTokenDetails,
  GetSearchIndexStats,
  GetSearchLogs,
  GetSearchLogStats,
  IndexPosts,
  IndexPostsResult,
  IndexStatusItem,
  PostTokenDetails,
  SearchIndexStatsResult,
  SearchLogItem,
  SearchLogStatsResult,
  SearchPosts,
  SearchPostsResult,
  TestTokenize,
  TestTokenizeResult,
} from "@repo/shared-types/api/search";
import {
  AddCustomWordSchema,
  DeleteCustomWordSchema,
  DeleteIndexSchema,
  GetIndexStatusSchema,
  GetPostTokenDetailsSchema,
  GetSearchLogsSchema,
  IndexPostsSchema,
  TestTokenizeSchema,
} from "@repo/shared-types/api/search";
import { headers } from "next/headers";
import type { NextResponse } from "next/server";

import { logAuditEvent } from "@/lib/server/audit";
import { authVerify } from "@/lib/server/auth-verify";
import { resolveIpLocation } from "@/lib/server/ip-utils";
import { expireCacheTag as updateTag } from "@/lib/server/isr-invalidation";
import prisma from "@/lib/server/prisma";
import limitControl from "@/lib/server/rate-limit";
import ResponseBuilder from "@/lib/server/response";
import { markdownToPlainText } from "@/lib/server/search";
import {
  getSearchIndexStats as getSearchIndexStatsService,
  getSearchLogStats as getSearchLogStatsService,
} from "@/lib/server/services/search-stats";
import { analyzeText } from "@/lib/server/tokenizer";
import { validateData } from "@/lib/server/validator";
import type {
  SearchSiteParams,
  SearchSiteResult,
} from "@/lib/shared/search-site";
export type {
  SearchSiteParams,
  SearchSitePostItem,
  SearchSiteProjectItem,
  SearchSiteTagItem,
  SearchSiteCategoryItem,
  SearchSitePhotoItem,
  SearchSiteResult,
} from "@/lib/shared/search-site";
import { sanitizeTsqueryToken } from "@/lib/server/search-token";
import {
  searchPosts as searchPostsService,
  searchSite as searchSiteService,
} from "@/lib/server/services/search";

type ActionEnvironment = "serverless" | "serveraction";
type ActionConfig = { environment?: ActionEnvironment };
type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

/**
 * 辅助函数：解析文章内容并提取纯文本
 * text-version v2: content 字段已经是最新内容
 */
async function extractTextFromContent(content: string): Promise<string> {
  // 第二步：将 Markdown/MDX 转换为纯文本
  return await markdownToPlainText(content);
}

export async function testTokenize(
  params: Omit<TestTokenize, "access_token">,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<TestTokenizeResult | null>>>;
export async function testTokenize(
  params: Omit<TestTokenize, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<TestTokenizeResult | null>>;
export async function testTokenize(
  { text }: Omit<TestTokenize, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ActionResult<TestTokenizeResult | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "testTokenize"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      text,
    },
    TestTokenizeSchema.omit({ access_token: true }),
  );

  if (validationError) return response.badRequest(validationError);

  // 从 cookies 获取 access token
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  const access_token = cookieStore.get("ACCESS_TOKEN")?.value;

  if (!access_token) {
    return response.unauthorized({ message: "请先登录" });
  }

  // 身份验证 - 仅管理员和编辑可以使用
  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    // 执行分词并记录时间
    const startTime = performance.now();
    const tokens = await analyzeText(text);
    const endTime = performance.now();
    const duration = Math.round((endTime - startTime) * 1000); // 转换为微秒

    return response.ok({
      data: {
        text,
        tokens,
        count: tokens.length,
        duration,
      },
    });
  } catch (error) {
    console.error("分词测试失败:", error);
    return response.serverError({ message: "分词测试失败" });
  }
}

/*
  addCustomWord - 添加自定义词典
*/
export async function addCustomWord(
  params: Omit<AddCustomWord, "access_token">,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<AddCustomWordResult | null>>>;
export async function addCustomWord(
  params: Omit<AddCustomWord, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<AddCustomWordResult | null>>;
export async function addCustomWord(
  { word }: Omit<AddCustomWord, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ActionResult<AddCustomWordResult | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "addCustomWord"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      word,
    },
    AddCustomWordSchema.omit({ access_token: true }),
  );

  if (validationError) return response.badRequest(validationError);

  // 检查词汇是否包含空格
  if (word.includes(" ")) {
    return response.badRequest({ message: "自定义词汇中不能含有空格" });
  }

  // 从 cookies 获取 access token
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  const access_token = cookieStore.get("ACCESS_TOKEN")?.value;

  if (!access_token) {
    return response.unauthorized({ message: "请先登录" });
  }

  // 身份验证 - 仅管理员可以添加
  const user = await authVerify({
    allowedRoles: ["ADMIN"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    // 检查词汇是否已存在
    const existing = await prisma.customDictionary.findUnique({
      where: { word },
    });

    if (existing) {
      return response.conflict({ message: "该词汇已存在于自定义词典中" });
    }

    // 在添加到数据库之前，先搜索可能受影响的文章
    // 对词汇进行分词，找出当前分词结果中包含这些子词的文章
    const tokens = await analyzeText(word);

    // 安全转义 token 以便用于 PostgreSQL tsquery（移除所有运算符）
    const escapedTokens = tokens
      .map(sanitizeTsqueryToken)
      .filter((t) => t.length > 0);

    let affectedPosts: Array<{ slug: string; title: string }> = [];

    // 只有在存在有效 token 时才进行搜索
    if (escapedTokens.length > 0) {
      // 构建搜索查询：使用 OR 连接所有子词
      const searchQuery = escapedTokens.join(" | ");

      affectedPosts = await prisma.$queryRawUnsafe<
        Array<{ slug: string; title: string }>
      >(
        `
        SELECT DISTINCT slug, title
        FROM "Post"
        WHERE
          "titleSearchVector" @@ to_tsquery('simple', $1)
          OR "contentSearchVector" @@ to_tsquery('simple', $1)
        ORDER BY slug
        LIMIT 100
      `,
        searchQuery,
      );
    }

    // 添加到数据库
    await prisma.customDictionary.create({
      data: { word },
    });

    // 清除词典缓存，强制重新加载
    updateTag("custom-dictionary");

    // 记录审计日志
    const { after } = await import("next/server");
    after(async () => {
      await logAuditEvent({
        user: {
          uid: String(user.uid),
        },
        details: {
          action: "ADD_CUSTOM_WORD",
          resourceType: "SEARCH",
          value: {
            old: null,
            new: word,
          },
          description: `添加自定义词典：${word}`,
        },
      });
    });

    return response.ok({
      data: {
        word,
        added: true,
        affectedPosts: affectedPosts.length > 0 ? affectedPosts : undefined,
      },
    });
  } catch (error) {
    console.error("添加自定义词典失败:", error);
    return response.serverError({ message: "添加自定义词典失败" });
  }
}

/*
  getCustomWords - 获取自定义词典列表
*/
export async function getCustomWords(
  params: Omit<GetCustomWords, "access_token">,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CustomWordItem[] | null>>>;
export async function getCustomWords(
  params: Omit<GetCustomWords, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CustomWordItem[] | null>>;
export async function getCustomWords(
  _params: Omit<GetCustomWords, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CustomWordItem[] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getCustomWords"))) {
    return response.tooManyRequests();
  }

  // 从 cookies 获取 access token
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  const access_token = cookieStore.get("ACCESS_TOKEN")?.value;

  if (!access_token) {
    return response.unauthorized({ message: "请先登录" });
  }

  // 身份验证 - 仅管理员和编辑可以查看
  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    const words = await prisma.customDictionary.findMany({
      orderBy: {
        createdAt: "desc",
      },
      select: {
        id: true,
        word: true,
        createdAt: true,
      },
    });

    return response.ok({
      data: words.map((w) => ({
        id: w.id,
        word: w.word,
        createdAt: w.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("获取自定义词典失败:", error);
    return response.serverError({ message: "获取自定义词典失败" });
  }
}

/*
  deleteCustomWord - 删除自定义词典
*/
export async function deleteCustomWord(
  params: Omit<DeleteCustomWord, "access_token">,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<DeleteCustomWordResult | null>>>;
export async function deleteCustomWord(
  params: Omit<DeleteCustomWord, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<DeleteCustomWordResult | null>>;
export async function deleteCustomWord(
  { id }: Omit<DeleteCustomWord, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ActionResult<DeleteCustomWordResult | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "deleteCustomWord"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      id,
    },
    DeleteCustomWordSchema.omit({ access_token: true }),
  );

  if (validationError) return response.badRequest(validationError);

  // 从 cookies 获取 access token
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  const access_token = cookieStore.get("ACCESS_TOKEN")?.value;

  if (!access_token) {
    return response.unauthorized({ message: "请先登录" });
  }

  // 身份验证 - 仅管理员可以删除
  const user = await authVerify({
    allowedRoles: ["ADMIN"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    // 获取词汇信息
    const wordData = await prisma.customDictionary.findUnique({
      where: { id },
    });

    if (!wordData) {
      return response.notFound({ message: "词汇不存在" });
    }

    // 在删除之前，先搜索包含该词汇的文章
    // 搜索现有索引中包含该完整词汇的文章
    // 安全转义词汇以便用于 PostgreSQL tsquery（移除所有运算符）
    const escapedWord = sanitizeTsqueryToken(wordData.word);

    const affectedPosts = await prisma.$queryRawUnsafe<
      Array<{ slug: string; title: string }>
    >(
      `
      SELECT DISTINCT slug, title
      FROM "Post"
      WHERE
        "titleSearchVector" @@ to_tsquery('simple', $1)
        OR "contentSearchVector" @@ to_tsquery('simple', $1)
      ORDER BY slug
      LIMIT 100
    `,
      escapedWord,
    );

    // 删除词汇
    await prisma.customDictionary.delete({
      where: { id },
    });

    // 清除词典缓存，强制重新加载
    updateTag("custom-dictionary");

    // 记录审计日志
    const { after } = await import("next/server");
    after(async () => {
      await logAuditEvent({
        user: {
          uid: String(user.uid),
        },
        details: {
          action: "DELETE_CUSTOM_WORD",
          resourceType: "SEARCH",
          resourceId: String(id),
          value: {
            old: wordData.word,
            new: null,
          },
          description: `删除自定义词典：${wordData.word}`,
        },
      });
    });

    return response.ok({
      data: {
        id,
        word: wordData.word,
        deleted: true,
        affectedPosts: affectedPosts.length > 0 ? affectedPosts : undefined,
      },
    });
  } catch (error) {
    console.error("删除自定义词典失败:", error);
    return response.serverError({ message: "删除自定义词典失败" });
  }
}

/*
  indexPosts - 创建/更新文章索引
*/
export async function indexPosts(
  params: Omit<IndexPosts, "access_token">,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<IndexPostsResult | null>>>;
export async function indexPosts(
  params: Omit<IndexPosts, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<IndexPostsResult | null>>;
export async function indexPosts(
  { slugs }: Omit<IndexPosts, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ActionResult<IndexPostsResult | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "indexPosts"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      slugs,
    },
    IndexPostsSchema.omit({ access_token: true }),
  );

  if (validationError) return response.badRequest(validationError);

  // 从 cookies 获取 access token
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  const access_token = cookieStore.get("ACCESS_TOKEN")?.value;

  if (!access_token) {
    return response.unauthorized({ message: "请先登录" });
  }

  // 身份验证 - 仅管理员和编辑可以操作
  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    // 构建查询条件
    const whereCondition =
      slugs && slugs.length > 0 ? { slug: { in: slugs } } : {};

    // 获取需要索引的文章
    const posts = await prisma.post.findMany({
      where: whereCondition,
      select: {
        id: true,
        slug: true,
        title: true,
        content: true,
        postMode: true,
      },
    });

    if (posts.length === 0) {
      return response.notFound({ message: "未找到需要索引的文章" });
    }

    let indexed = 0;
    let failed = 0;
    const errors: Array<{ slug: string; error: string }> = [];

    // 逐个处理文章索引
    for (const post of posts) {
      try {
        // 1. 提取标题分词
        const titleTokens = await analyzeText(post.title);

        // 2. 根据 postMode 提取内容纯文本
        const plainText = await extractTextFromContent(post.content);

        // 3. 提取内容分词
        const contentTokens = await analyzeText(plainText);

        // 4. 将分词结果用空格连接成字符串
        const titleTokensStr = titleTokens.join(" ");
        const contentTokensStr = contentTokens.join(" ");

        // 5. 使用 PostgreSQL 的 to_tsvector() 函数创建全文搜索索引
        // 使用 'simple' 配置，因为我们已经通过自定义分词器完成了分词
        await prisma.$executeRaw`
          UPDATE "Post"
          SET
            "titleSearchVector" = to_tsvector('simple', ${titleTokensStr}),
            "contentSearchVector" = to_tsvector('simple', ${contentTokensStr}),
            "plain" = ${plainText},
            "tokenizedAt" = NOW()
          WHERE "id" = ${post.id}
        `;

        indexed++;
      } catch (error) {
        console.error(`索引文章 ${post.slug} 失败:`, error);
        failed++;
        errors.push({
          slug: post.slug,
          error: error instanceof Error ? error.message : "未知错误",
        });
      }
    }

    // 记录审计日志
    const { after } = await import("next/server");
    after(async () => {
      await logAuditEvent({
        user: {
          uid: String(user.uid),
        },
        details: {
          action: "INDEX_POSTS",
          resourceType: "SEARCH",
          resourceId: slugs?.join(","),
          value: {
            old: null,
            new: {
              total: posts.length,
              indexed,
              failed,
            },
          },
          description: `创建文章索引：${indexed} 成功，${failed} 失败，共 ${posts.length} 篇`,
        },
      });
    });

    return response.ok({
      data: {
        total: posts.length,
        indexed,
        failed,
        errors: errors.length > 0 ? errors : undefined,
      },
    });
  } catch (error) {
    console.error("创建文章索引失败:", error);
    return response.serverError({ message: "创建文章索引失败" });
  }
}

/*
  deleteIndex - 删除文章索引
*/
export async function deleteIndex(
  params: Omit<DeleteIndex, "access_token">,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<DeleteIndexResult | null>>>;
export async function deleteIndex(
  params: Omit<DeleteIndex, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<DeleteIndexResult | null>>;
export async function deleteIndex(
  { slugs }: Omit<DeleteIndex, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ActionResult<DeleteIndexResult | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "deleteIndex"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      slugs,
    },
    DeleteIndexSchema.omit({ access_token: true }),
  );

  if (validationError) return response.badRequest(validationError);

  // 从 cookies 获取 access token
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  const access_token = cookieStore.get("ACCESS_TOKEN")?.value;

  if (!access_token) {
    return response.unauthorized({ message: "请先登录" });
  }

  // 身份验证 - 仅管理员和编辑可以操作
  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    // 获取需要删除索引的文章
    const posts = await prisma.post.findMany({
      where: { slug: { in: slugs } },
      select: {
        id: true,
        slug: true,
        title: true,
      },
    });

    if (posts.length === 0) {
      return response.notFound({ message: "未找到需要删除索引的文章" });
    }

    let deleted = 0;
    let failed = 0;
    const errors: Array<{ slug: string; error: string }> = [];

    // 逐个删除文章索引
    for (const post of posts) {
      try {
        // 清空搜索向量和分词时间
        await prisma.$executeRaw`
          UPDATE "Post"
          SET
            "titleSearchVector" = NULL,
            "contentSearchVector" = NULL,
            "plain" = NULL,
            "tokenizedAt" = NULL
          WHERE "id" = ${post.id}
        `;

        deleted++;
      } catch (error) {
        console.error(`删除文章 ${post.slug} 索引失败:`, error);
        failed++;
        errors.push({
          slug: post.slug,
          error: error instanceof Error ? error.message : "未知错误",
        });
      }
    }

    // 记录审计日志
    const { after } = await import("next/server");
    after(async () => {
      await logAuditEvent({
        user: {
          uid: String(user.uid),
        },
        details: {
          action: "DELETE_INDEX",
          resourceType: "SEARCH",
          resourceId: slugs?.join(","),
          value: {
            old: {
              total: posts.length,
              deleted,
              failed,
            },
            new: null,
          },
          description: `删除文章索引：${deleted} 成功，${failed} 失败，共 ${posts.length} 篇`,
        },
      });
    });

    return response.ok({
      data: {
        total: posts.length,
        deleted,
        failed,
        errors: errors.length > 0 ? errors : undefined,
      },
    });
  } catch (error) {
    console.error("删除文章索引失败:", error);
    return response.serverError({ message: "删除文章索引失败" });
  }
}

/*
  getIndexStatus - 获取文章索引状态
*/
export async function getIndexStatus(
  params: Omit<GetIndexStatus, "access_token">,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<IndexStatusItem[] | null>>>;
export async function getIndexStatus(
  params: Omit<GetIndexStatus, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<IndexStatusItem[] | null>>;
export async function getIndexStatus(
  {
    page = 1,
    pageSize = 25,
    sortBy = "updatedAt",
    sortOrder = "desc",
    status,
  }: Omit<GetIndexStatus, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ActionResult<IndexStatusItem[] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getIndexStatus"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      page,
      pageSize,
      sortBy,
      sortOrder,
      status,
    },
    GetIndexStatusSchema.omit({ access_token: true }),
  );

  if (validationError) return response.badRequest(validationError);

  // 从 cookies 获取 access token
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  const access_token = cookieStore.get("ACCESS_TOKEN")?.value;

  if (!access_token) {
    return response.unauthorized({ message: "请先登录" });
  }

  // 身份验证 - 仅管理员和编辑可以查看
  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    // 构建查询条件
    const skip = (page - 1) * pageSize;

    // 获取文章列表基本信息
    const posts = await prisma.post.findMany({
      skip,
      take: pageSize,
      orderBy: {
        [sortBy]: sortOrder,
      },
      select: {
        id: true,
        slug: true,
        title: true,
        updatedAt: true,
        tokenizedAt: true,
      },
    });

    // 使用原生查询获取分词信息
    const postIds = posts.map((p) => p.id);
    const tokenData = await prisma.$queryRaw<
      Array<{
        id: number;
        titleSearchVector: string | null;
        contentSearchVector: string | null;
      }>
    >`SELECT id, "titleSearchVector"::text as "titleSearchVector", "contentSearchVector"::text as "contentSearchVector" FROM "Post" WHERE id = ANY(${postIds}::int[])`;

    // 创建 tokenData 的映射
    const tokenMap = new Map(tokenData.map((t) => [t.id, t]));

    // 计算索引状态
    const items: IndexStatusItem[] = posts.map((post) => {
      const isOutdated = post.tokenizedAt
        ? post.tokenizedAt < post.updatedAt
        : true;

      let indexStatus: "outdated" | "up-to-date" | "never-indexed";
      if (!post.tokenizedAt) {
        indexStatus = "never-indexed";
      } else if (isOutdated) {
        indexStatus = "outdated";
      } else {
        indexStatus = "up-to-date";
      }

      // 计算分词体积和词元数
      let tokenSize = 0;
      let tokenCount = 0;

      const tokens = tokenMap.get(post.id);
      if (tokens && (tokens.titleSearchVector || tokens.contentSearchVector)) {
        // PostgreSQL 的 tsvector 类型存储为字符串，计算其占用的字节数
        const titleSearchVectorStr = tokens.titleSearchVector || "";
        const contentSearchVectorStr = tokens.contentSearchVector || "";

        // 计算字节大小（UTF-8 编码）
        tokenSize =
          new Blob([titleSearchVectorStr]).size +
          new Blob([contentSearchVectorStr]).size;

        // 计算词元数（tsvector 格式为 'word':position 的形式）
        // 使用正则表达式提取词元
        const titleTokenMatches = titleSearchVectorStr.match(/'[^']+'/g) || [];
        const contentTokenMatches =
          contentSearchVectorStr.match(/'[^']+'/g) || [];
        tokenCount = titleTokenMatches.length + contentTokenMatches.length;
      }

      return {
        id: post.id,
        slug: post.slug,
        title: post.title,
        updatedAt: post.updatedAt.toISOString(),
        tokenizedAt: post.tokenizedAt?.toISOString() || null,
        status: indexStatus,
        tokenSize: tokenSize > 0 ? tokenSize : undefined,
        tokenCount: tokenCount > 0 ? tokenCount : undefined,
      };
    });

    // 根据 status 参数过滤
    const filteredItems = status
      ? items.filter((item) => item.status === status)
      : items;

    // 获取总数
    const total = await prisma.post.count();

    // 计算分页元数据
    const totalPages = Math.ceil(total / pageSize);
    const meta = {
      page,
      pageSize,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    };

    return response.ok({
      data: filteredItems,
      meta,
    });
  } catch (error) {
    console.error("获取索引状态失败:", error);
    return response.serverError({ message: "获取索引状态失败" });
  }
}

/*
  searchPosts - compatibility Server Action; business logic lives in server/services/search.
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
  params: SearchPosts,
  serverConfig?: ActionConfig,
): Promise<ActionResult<SearchPostsResult | null>> {
  return searchPostsService(params, serverConfig);
}

/*
  searchSite - compatibility Server Action; the GET API calls the service directly.
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
  params: SearchSiteParams,
  serverConfig?: ActionConfig,
): Promise<ActionResult<SearchSiteResult | null>> {
  return searchSiteService(params, serverConfig);
}

/*
  getPostTokenDetails - 获取文章分词详情
*/
export async function getPostTokenDetails(
  params: Omit<GetPostTokenDetails, "access_token">,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<PostTokenDetails | null>>>;
export async function getPostTokenDetails(
  params: Omit<GetPostTokenDetails, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<PostTokenDetails | null>>;
export async function getPostTokenDetails(
  { slug }: Omit<GetPostTokenDetails, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ActionResult<PostTokenDetails | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getPostTokenDetails"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      slug,
    },
    GetPostTokenDetailsSchema.omit({ access_token: true }),
  );

  if (validationError) return response.badRequest(validationError);

  // 从 cookies 获取 access token
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  const access_token = cookieStore.get("ACCESS_TOKEN")?.value;

  if (!access_token) {
    return response.unauthorized({ message: "请先登录" });
  }

  // 身份验证 - 仅管理员和编辑可以查看
  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    // 获取文章基本信息
    const post = await prisma.post.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        title: true,
        tokenizedAt: true,
      },
    });

    if (!post) {
      return response.notFound({ message: "文章不存在" });
    }

    // 使用原生查询获取分词信息
    const tokenData = await prisma.$queryRaw<
      Array<{
        titleSearchVector: string | null;
        contentSearchVector: string | null;
      }>
    >`SELECT "titleSearchVector"::text as "titleSearchVector", "contentSearchVector"::text as "contentSearchVector" FROM "Post" WHERE id = ${post.id}`;

    if (
      !tokenData[0] ||
      (!tokenData[0].titleSearchVector && !tokenData[0].contentSearchVector)
    ) {
      return response.notFound({ message: "该文章尚未建立索引" });
    }

    // 解析 tsvector 格式的分词数据
    const titleSearchVectorStr = tokenData[0].titleSearchVector || "";
    const contentSearchVectorStr = tokenData[0].contentSearchVector || "";

    // 从 tsvector 格式中提取词元并按位置排序
    // tsvector 格式示例：'中国':1 '人民':2 '共和国':3
    // 或带多个位置：'中国':1,5 '人民':2
    const extractTokensWithFrequency = (tsvectorStr: string) => {
      const matches = tsvectorStr.match(/'([^']+)':[\d,]+/g) || [];

      // 提取词元和它们的所有位置
      const tokensWithPos = matches
        .map((match) => {
          const tokenMatch = match.match(/'([^']+)':([\d,]+)/);
          if (!tokenMatch || !tokenMatch[1] || !tokenMatch[2]) return null;

          const token = tokenMatch[1];
          const positions = tokenMatch[2].split(",").map(Number);

          return { token, positions };
        })
        .filter(
          (item): item is { token: string; positions: number[] } =>
            item !== null,
        );

      // 展开所有位置，形成 (token, position) 对，以便完整展示所有分词
      const allOccurrences: { token: string; position: number }[] = [];
      tokensWithPos.forEach(({ token, positions }) => {
        positions.forEach((pos) => {
          allOccurrences.push({ token, position: pos });
        });
      });

      // 按位置排序
      allOccurrences.sort((a, b) => a.position - b.position);

      // 返回按位置排序的词元列表
      const orderedTokens = allOccurrences.map((item) => item.token);

      // 统计词频（去除单字符）
      const wordFrequency = new Map<string, number>();
      tokensWithPos.forEach(({ token, positions }) => {
        // 只统计长度大于1的词
        if (token.length > 1) {
          wordFrequency.set(token, positions.length);
        }
      });

      // 按出现次数排序
      const wordCloud = Array.from(wordFrequency.entries())
        .map(([word, count]) => ({ word, count }))
        .sort((a, b) => b.count - a.count);

      return { orderedTokens, wordCloud };
    };

    const titleResult = extractTokensWithFrequency(titleSearchVectorStr);
    const contentResult = extractTokensWithFrequency(contentSearchVectorStr);

    const titleTokens = titleResult.orderedTokens;
    const contentTokens = contentResult.orderedTokens;

    // 合并标题和内容的词云，重新统计
    const combinedWordFrequency = new Map<string, number>();

    [...titleResult.wordCloud, ...contentResult.wordCloud].forEach(
      ({ word, count }) => {
        const currentCount = combinedWordFrequency.get(word) || 0;
        combinedWordFrequency.set(word, currentCount + count);
      },
    );

    const wordCloud = Array.from(combinedWordFrequency.entries())
      .map(([word, count]) => ({ word, count }))
      .sort((a, b) => b.count - a.count);

    // 计算分词体积
    const tokenSize =
      new Blob([titleSearchVectorStr]).size +
      new Blob([contentSearchVectorStr]).size;

    return response.ok({
      data: {
        slug: post.slug,
        title: post.title,
        titleTokens,
        contentTokens,
        titleTokenCount: titleTokens.length,
        contentTokenCount: contentTokens.length,
        totalTokenCount: titleTokens.length + contentTokens.length,
        tokenSize,
        tokenizedAt: post.tokenizedAt?.toISOString() || null,
        wordCloud,
      },
    });
  } catch (error) {
    console.error("获取文章分词详情失败:", error);
    return response.serverError({ message: "获取文章分词详情失败" });
  }
}

/*
  getSearchIndexStats - legacy Server Action compatibility wrapper
*/
export async function getSearchIndexStats(
  params: Omit<GetSearchIndexStats, "access_token">,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<SearchIndexStatsResult | null>>>;
export async function getSearchIndexStats(
  params: Omit<GetSearchIndexStats, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<SearchIndexStatsResult | null>>;
export async function getSearchIndexStats(
  params: Omit<GetSearchIndexStats, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ActionResult<SearchIndexStatsResult | null>> {
  return getSearchIndexStatsService(params, serverConfig);
}

/*
  getSearchLogStats - legacy Server Action compatibility wrapper
*/
export async function getSearchLogStats(
  params: Omit<GetSearchLogStats, "access_token">,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<SearchLogStatsResult | null>>>;
export async function getSearchLogStats(
  params: Omit<GetSearchLogStats, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<SearchLogStatsResult | null>>;
export async function getSearchLogStats(
  params: Omit<GetSearchLogStats, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ActionResult<SearchLogStatsResult | null>> {
  return getSearchLogStatsService(params, serverConfig);
}

/*
  getSearchLogs - 获取搜索日志列表
*/
export async function getSearchLogs(
  params: Omit<GetSearchLogs, "access_token">,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<SearchLogItem[] | null>>>;
export async function getSearchLogs(
  params: Omit<GetSearchLogs, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<SearchLogItem[] | null>>;
export async function getSearchLogs(
  {
    page = 1,
    pageSize = 25,
    sortBy = "createdAt",
    sortOrder = "desc",
    query: queryFilter,
    minResultCount,
    maxResultCount,
    hasZeroResults,
    dateFrom,
    dateTo,
  }: Omit<GetSearchLogs, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ActionResult<SearchLogItem[] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getSearchLogs"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      page,
      pageSize,
      sortBy,
      sortOrder,
      query: queryFilter,
      minResultCount,
      maxResultCount,
      hasZeroResults,
      dateFrom,
      dateTo,
    },
    GetSearchLogsSchema.omit({ access_token: true }),
  );

  if (validationError) return response.badRequest(validationError);

  // 从 cookies 获取 access token
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  const access_token = cookieStore.get("ACCESS_TOKEN")?.value;

  if (!access_token) {
    return response.unauthorized({ message: "请先登录" });
  }

  // 身份验证 - 仅管理员和编辑可以查看
  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    const skip = (page - 1) * pageSize;

    // 构建查询条件
    const where: Record<string, unknown> = {};

    if (queryFilter) {
      where.query = {
        contains: queryFilter,
        mode: "insensitive",
      };
    }

    if (minResultCount !== undefined || maxResultCount !== undefined) {
      where.resultCount = {};
      if (minResultCount !== undefined) {
        (where.resultCount as Record<string, unknown>).gte = minResultCount;
      }
      if (maxResultCount !== undefined) {
        (where.resultCount as Record<string, unknown>).lte = maxResultCount;
      }
    }

    if (hasZeroResults !== undefined) {
      where.resultCount = hasZeroResults ? 0 : { gt: 0 };
    }

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) {
        (where.createdAt as Record<string, unknown>).gte = new Date(dateFrom);
      }
      if (dateTo) {
        (where.createdAt as Record<string, unknown>).lte = new Date(
          dateTo + "T23:59:59.999Z",
        );
      }
    }

    // 获取搜索日志
    const logs = await prisma.searchLog.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: {
        [sortBy]: sortOrder,
      },
    });

    // 获取总数
    const total = await prisma.searchLog.count({ where });

    // 计算分页元数据
    const totalPages = Math.ceil(total / pageSize);
    const meta = {
      page,
      pageSize,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    };

    // 转换为返回格式
    const items: SearchLogItem[] = logs.map((log) => ({
      id: log.id,
      query: log.query,
      tokens: log.tokens,
      resultCount: log.resultCount,
      durationMs: log.durationMs,
      createdAt: log.createdAt.toISOString(),
      ip: log.ip,
      sessionId: log.sessionId,
      visitorId: log.visitorId,
      location: log.ip ? resolveIpLocation(log.ip) : null,
    }));

    return response.ok({
      data: items,
      meta,
    });
  } catch (error) {
    console.error("获取搜索日志列表失败:", error);
    return response.serverError({ message: "获取搜索日志列表失败" });
  }
}
