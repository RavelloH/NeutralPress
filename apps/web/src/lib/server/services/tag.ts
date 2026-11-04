import "server-only";

import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type {
  CreateTag,
  DeleteTags,
  GetTagDetail,
  GetTagsDistribution,
  GetTagsList,
  SearchTagItem,
  SearchTags,
  TagDetail,
  TagDistributionItem,
  TagListItem,
  UpdateTag,
} from "@repo/shared-types/api/tag";
import {
  CreateTagSchema,
  DeleteTagsSchema,
  GetTagDetailSchema,
  GetTagsDistributionSchema,
  GetTagsListSchema,
  SearchTagsSchema,
  UpdateTagSchema,
} from "@repo/shared-types/api/tag";
import { headers } from "next/headers";
import type { NextResponse } from "next/server";

import { logAuditEvent } from "@/lib/server/audit";
import { authVerify } from "@/lib/server/auth-verify";
import { expireCacheTag as updateTags } from "@/lib/server/isr-invalidation";
import {
  findMediaIdByUrl,
  getFeaturedImageUrl,
  mediaRefsInclude,
  updateFeaturedImageRef,
} from "@/lib/server/media-reference";
import { LISTABLE_POST_PUBLISHED_WHERE } from "@/lib/server/post-access";
import prisma from "@/lib/server/prisma";
import limitControl from "@/lib/server/rate-limit";
import ResponseBuilder from "@/lib/server/response";
import {
  generateUniqueSlug,
  isValidSlug,
  sanitizeUserSlug,
  slugify,
} from "@/lib/server/slugify";
import { validateData } from "@/lib/server/validator";

type ActionEnvironment = "serverless" | "serveraction";
type ActionConfig = { environment?: ActionEnvironment };
type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

async function getPublishedPostSlugsByTagSlugs(
  tagSlugs: readonly string[],
): Promise<Set<string>> {
  if (tagSlugs.length === 0) {
    return new Set<string>();
  }

  const posts = await prisma.post.findMany({
    where: {
      ...LISTABLE_POST_PUBLISHED_WHERE,
      tags: {
        some: {
          slug: {
            in: Array.from(new Set(tagSlugs)),
          },
        },
      },
    },
    select: {
      slug: true,
    },
  });

  return new Set(posts.map((post) => post.slug));
}

function updatePostCacheTagsBySlugs(slugs: Iterable<string>): void {
  for (const slug of slugs) {
    updateTags(`posts/${slug}`);
  }
}

/*
  getTagsList - 获取标签列表
*/
export async function getTagsList(
  params: GetTagsList,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<TagListItem[] | null>>>;
export async function getTagsList(
  params: GetTagsList,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<TagListItem[] | null>>;
export async function getTagsList(
  {
    access_token,
    page = 1,
    pageSize = 25,
    sortBy = "postCount",
    sortOrder = "desc",
    search,
    postIds,
    hasZeroPosts,
    createdAtStart,
    createdAtEnd,
    updatedAtStart,
    updatedAtEnd,
  }: GetTagsList,
  serverConfig?: ActionConfig,
): Promise<ActionResult<TagListItem[] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getTagsList"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      page,
      pageSize,
      sortBy,
      sortOrder,
      search,
      postIds,
      hasZeroPosts,
      createdAtStart,
      createdAtEnd,
      updatedAtStart,
      updatedAtEnd,
    },
    GetTagsListSchema,
  );

  if (validationError) return response.badRequest(validationError);

  // 身份验证
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
    const where: {
      AND?: Array<{
        name?: { contains: string; mode: "insensitive" };
        posts?: { none: object } | { some: { id: { in: number[] } } };
        createdAt?: { gte?: Date; lte?: Date };
        updatedAt?: { gte?: Date; lte?: Date };
      }>;
    } = {};

    const conditions = [];

    // 搜索条件
    if (search && search.trim()) {
      conditions.push({
        name: {
          contains: search.trim(),
          mode: "insensitive" as const,
        },
      });
    }

    // 筛选包含指定文章的标签
    if (postIds && postIds.length > 0) {
      conditions.push({
        posts: {
          some: {
            id: {
              in: postIds,
            },
          },
        },
      });
    }

    // 筛选无文章关联的标签
    if (hasZeroPosts !== undefined) {
      if (hasZeroPosts) {
        conditions.push({
          posts: { none: {} },
        });
      }
    }

    // 时间范围筛选
    if (createdAtStart || createdAtEnd) {
      const createdAtCondition: { createdAt: { gte?: Date; lte?: Date } } = {
        createdAt: {},
      };
      if (createdAtStart) {
        createdAtCondition.createdAt.gte = new Date(createdAtStart);
      }
      if (createdAtEnd) {
        createdAtCondition.createdAt.lte = new Date(createdAtEnd);
      }
      conditions.push(createdAtCondition);
    }

    if (updatedAtStart || updatedAtEnd) {
      const updatedAtCondition: { updatedAt: { gte?: Date; lte?: Date } } = {
        updatedAt: {},
      };
      if (updatedAtStart) {
        updatedAtCondition.updatedAt.gte = new Date(updatedAtStart);
      }
      if (updatedAtEnd) {
        updatedAtCondition.updatedAt.lte = new Date(updatedAtEnd);
      }
      conditions.push(updatedAtCondition);
    }

    if (conditions.length > 0) {
      where.AND = conditions;
    }

    // 获取标签及关联的文章数量
    const tags = await prisma.tag.findMany({
      where,
      skip,
      take: pageSize,
      include: {
        ...mediaRefsInclude,
        posts: {
          where: {
            deletedAt: null,
          },
          select: {
            id: true,
          },
        },
      },
    });

    // 转换为响应格式
    const tagList: TagListItem[] = tags.map((tag) => ({
      slug: tag.slug,
      name: tag.name,
      description: tag.description,
      featuredImage: getFeaturedImageUrl(tag.mediaRefs),
      postCount: tag.posts.length,
      createdAt: tag.createdAt.toISOString(),
      updatedAt: tag.updatedAt.toISOString(),
    }));

    // 根据 sortBy 排序
    if (sortBy === "postCount") {
      tagList.sort((a, b) => {
        if (sortOrder === "asc") {
          return a.postCount - b.postCount;
        }
        return b.postCount - a.postCount;
      });
    } else if (sortBy === "slug") {
      tagList.sort((a, b) => {
        if (sortOrder === "asc") {
          return a.slug.localeCompare(b.slug);
        }
        return b.slug.localeCompare(a.slug);
      });
    } else if (sortBy === "name") {
      tagList.sort((a, b) => {
        if (sortOrder === "asc") {
          return a.name.localeCompare(b.name);
        }
        return b.name.localeCompare(a.name);
      });
    } else if (sortBy === "createdAt") {
      tagList.sort((a, b) => {
        if (sortOrder === "asc") {
          return (
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          );
        }
        return (
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      });
    } else if (sortBy === "updatedAt") {
      tagList.sort((a, b) => {
        if (sortOrder === "asc") {
          return (
            new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
          );
        }
        return (
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
      });
    }

    // 获取总数
    const total = await prisma.tag.count({ where });

    return response.ok({
      data: tagList,
      meta: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
        hasNext: page < Math.ceil(total / pageSize),
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    console.error("GetTagsList error:", error);
    return response.serverError();
  }
}

/*
  getTagDetail - 获取标签详情
*/
export async function getTagDetail(
  params: GetTagDetail,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<TagDetail | null>>>;
export async function getTagDetail(
  params: GetTagDetail,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<TagDetail | null>>;
export async function getTagDetail(
  { access_token, slug }: GetTagDetail,
  serverConfig?: ActionConfig,
): Promise<ActionResult<TagDetail | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getTagDetail"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      slug,
    },
    GetTagDetailSchema,
  );

  if (validationError) return response.badRequest(validationError);

  // 身份验证
  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    const tag = await prisma.tag.findUnique({
      where: { slug },
      include: {
        ...mediaRefsInclude,
        posts: {
          where: {
            deletedAt: null,
          },
          select: {
            id: true,
            title: true,
            slug: true,
            status: true,
          },
        },
      },
    });

    if (!tag) {
      return response.notFound({ message: `标签 "${slug}" 不存在` });
    }

    const tagDetail: TagDetail = {
      slug: tag.slug,
      name: tag.name,
      description: tag.description,
      featuredImage: getFeaturedImageUrl(tag.mediaRefs),
      postCount: tag.posts.length,
      createdAt: tag.createdAt.toISOString(),
      updatedAt: tag.updatedAt.toISOString(),
      posts: tag.posts.map((post) => ({
        id: post.id,
        title: post.title,
        slug: post.slug,
        status: post.status,
      })),
    };

    return response.ok({
      data: tagDetail,
    });
  } catch (error) {
    console.error("GetTagDetail error:", error);
    return response.serverError();
  }
}

/*
  createTag - 创建标签
*/
export async function createTag(
  params: CreateTag,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<
    ApiResponse<{
      slug: string;
      name: string;
      description: string | null;
      featuredImage: string | null;
      createdAt: string;
      updatedAt: string;
    } | null>
  >
>;
export async function createTag(
  params: CreateTag,
  serverConfig?: ActionConfig,
): Promise<
  ApiResponse<{
    slug: string;
    name: string;
    description: string | null;
    featuredImage: string | null;
    createdAt: string;
    updatedAt: string;
  } | null>
>;
export async function createTag(
  { access_token, name, slug: userSlug, description, featuredImage }: CreateTag,
  serverConfig?: ActionConfig,
): Promise<
  ActionResult<{
    slug: string;
    name: string;
    description: string | null;
    featuredImage: string | null;
    createdAt: string;
    updatedAt: string;
  } | null>
> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "createTag"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      name,
      slug: userSlug,
      description,
      featuredImage,
    },
    CreateTagSchema,
  );

  if (validationError) return response.badRequest(validationError);

  // 身份验证 - 允许 AUTHOR、EDITOR、ADMIN 创建标签
  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR", "AUTHOR"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    // 生成或清理 slug
    let finalSlug: string;

    if (userSlug && userSlug.trim()) {
      // 用户提供了 slug，进行清理
      finalSlug = sanitizeUserSlug(userSlug);

      if (!finalSlug) {
        return response.badRequest({
          message: "提供的 slug 无效，请使用小写字母、数字和连字符",
        });
      }

      if (!isValidSlug(finalSlug)) {
        return response.badRequest({ message: "提供的 slug 格式无效" });
      }
    } else {
      // 用户未提供 slug，从 name 自动生成
      finalSlug = await slugify(name);

      if (!finalSlug) {
        return response.badRequest({ message: "无法从标签名生成有效的 slug" });
      }
    }

    // 检查 slug 是否已存在，如果存在则生成唯一的 slug
    const existingTagBySlug = await prisma.tag.findUnique({
      where: { slug: finalSlug },
    });

    if (existingTagBySlug) {
      // 获取所有存在的 slugs
      const allTags = await prisma.tag.findMany({
        select: { slug: true },
      });
      const existingSlugs = allTags.map((t) => t.slug);

      // 生成唯一的 slug
      finalSlug = generateUniqueSlug(finalSlug, existingSlugs);
    }

    // 检查标签名是否已存在
    const existingTagByName = await prisma.tag.findUnique({
      where: { name },
    });

    if (existingTagByName) {
      return response.badRequest({ message: `标签名 "${name}" 已存在` });
    }

    // 如果提供了 featuredImage，验证媒体是否存在
    let mediaId: number | undefined;
    if (featuredImage) {
      // 使用 findMediaIdByUrl 支持多种 URL 格式
      const foundMediaId = await findMediaIdByUrl(prisma, featuredImage);

      if (!foundMediaId) {
        return response.badRequest({
          message: "特色图片不存在",
        });
      }

      mediaId = foundMediaId;
    }

    // 创建标签
    const newTag = await prisma.tag.create({
      data: {
        slug: finalSlug,
        name,
        description: description || null,
        ...(mediaId
          ? {
              mediaRefs: {
                create: {
                  mediaId: mediaId,
                  slot: "featuredImage",
                },
              },
            }
          : {}),
      },
      include: mediaRefsInclude,
    });

    // 记录审计日志
    const { after } = await import("next/server");
    after(async () => {
      await logAuditEvent({
        user: {
          uid: String(user.uid),
        },
        details: {
          action: "CREATE_TAG",
          resourceType: "Tag",
          resourceId: newTag.slug,
          value: {
            old: null,
            new: {
              slug: newTag.slug,
              name: newTag.name,
              description: newTag.description,
              featuredImage: getFeaturedImageUrl(newTag.mediaRefs),
            },
          },
          description: "创建标签",
        },
      });
    });

    // 刷新缓存标签
    updateTags("tags/list");
    updateTags(`tags/${newTag.slug}`);

    return response.ok({
      data: {
        slug: newTag.slug,
        name: newTag.name,
        description: newTag.description,
        featuredImage: getFeaturedImageUrl(newTag.mediaRefs),
        createdAt: newTag.createdAt.toISOString(),
        updatedAt: newTag.updatedAt.toISOString(),
      },
      message: "标签创建成功",
    });
  } catch (error) {
    console.error("CreateTag error:", error);
    return response.serverError();
  }
}

/*
  updateTag - 更新标签
*/
export async function updateTag(
  params: UpdateTag,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<
    ApiResponse<{
      slug: string;
      name: string;
      description: string | null;
      featuredImage: string | null;
      updatedAt: string;
    } | null>
  >
>;
export async function updateTag(
  params: UpdateTag,
  serverConfig?: ActionConfig,
): Promise<
  ApiResponse<{
    slug: string;
    name: string;
    description: string | null;
    updatedAt: string;
  } | null>
>;
export async function updateTag(
  {
    access_token,
    slug,
    newSlug,
    newName,
    description,
    featuredImage,
  }: UpdateTag,
  serverConfig?: ActionConfig,
): Promise<
  ActionResult<{
    slug: string;
    name: string;
    description: string | null;
    updatedAt: string;
  } | null>
> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "updateTag"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      slug,
      newSlug,
      newName,
      description,
      featuredImage,
    },
    UpdateTagSchema,
  );

  if (validationError) return response.badRequest(validationError);

  // 身份验证
  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    // 检查标签是否存在
    const existingTag = await prisma.tag.findUnique({
      where: { slug },
      include: mediaRefsInclude,
    });

    if (!existingTag) {
      return response.notFound({ message: `标签 "${slug}" 不存在` });
    }

    const relatedPostSlugs = await getPublishedPostSlugsByTagSlugs([slug]);

    // 如果要修改 slug，进行处理和验证
    let finalNewSlug: string | undefined;
    if (newSlug && newSlug !== slug) {
      // 清理用户输入的 slug
      finalNewSlug = sanitizeUserSlug(newSlug);

      if (!finalNewSlug) {
        return response.badRequest({
          message: "新的 slug 无效，请使用小写字母、数字和连字符",
        });
      }

      if (!isValidSlug(finalNewSlug)) {
        return response.badRequest({ message: "新的 slug 格式无效" });
      }

      // 检查新 slug 是否已被使用
      const tagWithNewSlug = await prisma.tag.findUnique({
        where: { slug: finalNewSlug },
      });

      if (tagWithNewSlug) {
        return response.badRequest({
          message: `Slug "${finalNewSlug}" 已被使用`,
        });
      }
    }

    // 如果要修改名称，检查新名称是否已被使用
    if (newName && newName !== existingTag.name) {
      const tagWithNewName = await prisma.tag.findUnique({
        where: { name: newName },
      });

      if (tagWithNewName) {
        return response.badRequest({ message: `标签名 "${newName}" 已被使用` });
      }
    }

    // 如果提供了 featuredImage，验证媒体是否存在
    let mediaId: number | null | undefined;
    if (featuredImage !== undefined) {
      if (featuredImage === null) {
        mediaId = null;
      } else {
        // 使用 findMediaIdByUrl 支持多种 URL 格式
        const foundMediaId = await findMediaIdByUrl(prisma, featuredImage);

        if (!foundMediaId) {
          return response.badRequest({
            message: "特色图片不存在",
          });
        }

        mediaId = foundMediaId;
      }
    }

    // 更新标签
    const updatedTag = await prisma.tag.update({
      where: { slug },
      data: {
        ...(finalNewSlug ? { slug: finalNewSlug } : {}),
        ...(newName && newName !== existingTag.name ? { name: newName } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(mediaId !== undefined
          ? {
              mediaRefs: updateFeaturedImageRef(mediaId, "tag"),
            }
          : {}),
      },
      include: mediaRefsInclude,
    });

    // 记录审计日志
    const auditOldValue: Record<string, string | null> = {};
    const auditNewValue: Record<string, string | null> = {};

    if (slug !== updatedTag.slug) {
      auditOldValue.slug = existingTag.slug;
      auditNewValue.slug = updatedTag.slug;
    }
    if (existingTag.name !== updatedTag.name) {
      auditOldValue.name = existingTag.name;
      auditNewValue.name = updatedTag.name;
    }
    if (existingTag.description !== updatedTag.description) {
      auditOldValue.description = existingTag.description;
      auditNewValue.description = updatedTag.description;
    }

    const oldFeaturedImage = getFeaturedImageUrl(existingTag.mediaRefs);
    const newFeaturedImage = getFeaturedImageUrl(updatedTag.mediaRefs);
    if (oldFeaturedImage !== newFeaturedImage) {
      auditOldValue.featuredImage = oldFeaturedImage;
      auditNewValue.featuredImage = newFeaturedImage;
    }

    if (Object.keys(auditNewValue).length > 0) {
      const { after } = await import("next/server");
      after(async () => {
        await logAuditEvent({
          user: {
            uid: String(user.uid),
          },
          details: {
            action: "UPDATE_TAG",
            resourceType: "Tag",
            resourceId: slug,
            value: {
              old: auditOldValue,
              new: auditNewValue,
            },
            description: "更新标签",
          },
        });
      });
    }

    // 刷新缓存标签
    updateTags("tags/list");
    updateTags(`tags/${slug}`);
    updateTags(`tags/${updatedTag.slug}`);
    updatePostCacheTagsBySlugs(relatedPostSlugs);
    if (relatedPostSlugs.size > 0) {
      updateTags("posts/list");
    }

    return response.ok({
      data: {
        slug: updatedTag.slug,
        name: updatedTag.name,
        description: updatedTag.description,
        featuredImage: getFeaturedImageUrl(updatedTag.mediaRefs),
        updatedAt: updatedTag.updatedAt.toISOString(),
      },
      message: "标签更新成功",
    });
  } catch (error) {
    console.error("UpdateTag error:", error);
    return response.serverError();
  }
}

/*
  deleteTags - 批量删除标签
*/
export async function deleteTags(
  params: DeleteTags,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<ApiResponse<{ deleted: number; slugs: string[] } | null>>
>;
export async function deleteTags(
  params: DeleteTags,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<{ deleted: number; slugs: string[] } | null>>;
export async function deleteTags(
  { access_token, slugs }: DeleteTags,
  serverConfig?: ActionConfig,
): Promise<ActionResult<{ deleted: number; slugs: string[] } | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "deleteTags"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      slugs,
    },
    DeleteTagsSchema,
  );

  if (validationError) return response.badRequest(validationError);

  // 身份验证
  const user = await authVerify({
    allowedRoles: ["ADMIN"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    const relatedPostSlugs = await getPublishedPostSlugsByTagSlugs(slugs);

    // 删除标签（Prisma 会自动处理多对多关系）
    const result = await prisma.tag.deleteMany({
      where: {
        slug: {
          in: slugs,
        },
      },
    });

    // 记录审计日志
    const { after } = await import("next/server");
    after(async () => {
      await logAuditEvent({
        user: {
          uid: String(user.uid),
        },
        details: {
          action: "DELETE_TAGS",
          resourceType: "Tag",
          resourceId: slugs.join(", "),
          value: {
            old: { slugs, count: result.count },
            new: null,
          },
          description: "删除标签",
        },
      });
    });

    // 刷新缓存标签
    updateTags("tags/list");
    // 刷新每个被删除的标签
    slugs.forEach((slug) => {
      updateTags(`tags/${slug}`);
    });
    updatePostCacheTagsBySlugs(relatedPostSlugs);
    if (relatedPostSlugs.size > 0) {
      updateTags("posts/list");
    }

    return response.ok({
      data: {
        deleted: result.count,
        slugs: slugs,
      },
      message: `成功删除 ${result.count} 个标签`,
    });
  } catch (error) {
    console.error("DeleteTags error:", error);
    return response.serverError();
  }
}

/*
  getTagsDistribution - 获取标签分布（用于环形图）
*/
export async function getTagsDistribution(
  params: GetTagsDistribution,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<TagDistributionItem[] | null>>>;
export async function getTagsDistribution(
  params: GetTagsDistribution,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<TagDistributionItem[] | null>>;
export async function getTagsDistribution(
  { access_token, limit = 10 }: GetTagsDistribution,
  serverConfig?: ActionConfig,
): Promise<ActionResult<TagDistributionItem[] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getTagsDistribution"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      limit,
    },
    GetTagsDistributionSchema,
  );

  if (validationError) return response.badRequest(validationError);

  // 身份验证
  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    // 获取所有标签及其文章数量
    const tags = await prisma.tag.findMany({
      select: {
        name: true,
        posts: {
          where: {
            deletedAt: null,
          },
          select: {
            id: true,
          },
        },
      },
    });

    // 计算每个标签的文章数量
    const tagsWithCount = tags
      .map((tag) => ({
        name: tag.name,
        postCount: tag.posts.length,
      }))
      .filter((tag) => tag.postCount > 0) // 只统计有文章的标签
      .sort((a, b) => b.postCount - a.postCount); // 按文章数量降序排序

    // 获取前 N 个标签
    const topTags = tagsWithCount.slice(0, limit);

    // 计算所有有文章的标签的文章数总和（注意：这里会有重复计数，因为一篇文章可能有多个标签）
    const totalTaggedPosts = tagsWithCount.reduce(
      (sum, tag) => sum + tag.postCount,
      0,
    );

    // 计算百分比
    const distribution: TagDistributionItem[] = topTags.map((tag) => ({
      name: tag.name,
      postCount: tag.postCount,
      percentage:
        totalTaggedPosts > 0 ? (tag.postCount / totalTaggedPosts) * 100 : 0,
    }));

    // 如果有其他标签，添加"其他"类别
    if (tagsWithCount.length > limit) {
      const otherTags = tagsWithCount.slice(limit);
      const otherCount = otherTags.reduce((sum, tag) => sum + tag.postCount, 0);
      distribution.push({
        name: "其他",
        postCount: otherCount,
        percentage:
          totalTaggedPosts > 0 ? (otherCount / totalTaggedPosts) * 100 : 0,
      });
    }

    return response.ok({
      data: distribution,
    });
  } catch (error) {
    console.error("GetTagsDistribution error:", error);
    return response.serverError();
  }
}

/*
  searchTags - 搜索标签（轻量级，用于自动补全）
*/
export async function searchTags(
  params: SearchTags,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<SearchTagItem[] | null>>>;
export async function searchTags(
  params: SearchTags,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<SearchTagItem[] | null>>;
export async function searchTags(
  { access_token, query, limit = 10 }: SearchTags,
  serverConfig?: ActionConfig,
): Promise<ActionResult<SearchTagItem[] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "searchTags"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      query,
      limit,
    },
    SearchTagsSchema,
  );

  if (validationError) return response.badRequest(validationError);

  // 身份验证 - 允许 AUTHOR、EDITOR、ADMIN
  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR", "AUTHOR"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    // 搜索标签：支持 name 和 slug 的模糊匹配
    const tags = await prisma.tag.findMany({
      where: {
        OR: [
          {
            name: {
              contains: query.trim(),
              mode: "insensitive",
            },
          },
          {
            slug: {
              contains: query.trim(),
              mode: "insensitive",
            },
          },
        ],
      },
      take: limit,
      select: {
        slug: true,
        name: true,
        posts: {
          where: {
            deletedAt: null,
          },
          select: {
            id: true,
          },
        },
      },
      orderBy: [
        // 优先返回完全匹配的结果
        { name: "asc" },
      ],
    });

    // 转换为响应格式
    const searchResults: SearchTagItem[] = tags.map((tag) => ({
      slug: tag.slug,
      name: tag.name,
      postCount: tag.posts.length,
    }));

    // 按相似度排序：完全匹配 > 开头匹配 > 包含匹配
    const lowerQuery = query.toLowerCase().trim();
    searchResults.sort((a, b) => {
      const aNameLower = a.name.toLowerCase();
      const bNameLower = b.name.toLowerCase();

      // 完全匹配优先
      if (aNameLower === lowerQuery) return -1;
      if (bNameLower === lowerQuery) return 1;

      // 开头匹配次之
      const aStartsWith = aNameLower.startsWith(lowerQuery);
      const bStartsWith = bNameLower.startsWith(lowerQuery);
      if (aStartsWith && !bStartsWith) return -1;
      if (!aStartsWith && bStartsWith) return 1;

      // 最后按文章数量排序（更常用的标签优先）
      return b.postCount - a.postCount;
    });

    return response.ok({
      data: searchResults,
    });
  } catch (error) {
    console.error("SearchTags error:", error);
    return response.serverError();
  }
}
