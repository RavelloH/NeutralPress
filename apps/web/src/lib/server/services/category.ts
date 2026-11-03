import "server-only";

import type {
  CategoryDetail,
  CategoryDistributionItem,
  CategoryListItem,
  CategoryTreeNode,
  CreateCategory,
  DeleteCategories,
  GetCategoriesDistribution,
  GetCategoriesList,
  GetCategoriesTree,
  GetCategoryDetail,
  MoveCategories,
  SearchCategories,
  SearchCategoryItem,
  UpdateCategory,
} from "@repo/shared-types/api/category";
import {
  CreateCategorySchema,
  DeleteCategoriesSchema,
  GetCategoriesDistributionSchema,
  GetCategoriesListSchema,
  GetCategoriesTreeSchema,
  GetCategoryDetailSchema,
  MoveCategoriesSchema,
  SearchCategoriesSchema,
  UpdateCategorySchema,
} from "@repo/shared-types/api/category";
import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import { updateTag } from "next/cache";
import { headers } from "next/headers";
import type { NextResponse } from "next/server";

import { logAuditEvent } from "@/lib/server/audit";
import { authVerify } from "@/lib/server/auth-verify";
import {
  batchGetCategoryPaths,
  buildCategoryTree,
  calculateCategoryDepth,
  checkCategoryUniqueness,
  countAllDescendants,
  countCategoryPosts,
  countDirectChildren,
  findCategoryByPath,
  getAllDescendantIds,
  getCategoryPath,
  validateCategoryMove,
} from "@/lib/server/category-utils";
import {
  findMediaIdByUrl,
  getFeaturedImageUrl,
} from "@/lib/server/media-reference";
import prisma from "@/lib/server/prisma";
import limitControl from "@/lib/server/rate-limit";
import ResponseBuilder from "@/lib/server/response";
import { isValidSlug, sanitizeUserSlug, slugify } from "@/lib/server/slugify";
import { validateData } from "@/lib/server/validator";
import { MEDIA_SLOTS } from "@/types/media";

type ActionEnvironment = "serverless" | "serveraction";
type ActionConfig = { environment?: ActionEnvironment };
type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

function addCategoryPathTags(
  target: Set<string>,
  fullSlug: string | null | undefined,
): void {
  if (!fullSlug) {
    return;
  }

  const segments = fullSlug
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) {
    return;
  }

  for (let index = 1; index <= segments.length; index += 1) {
    target.add(segments.slice(0, index).join("/"));
  }
}

function updateCategoryCacheTagsByPaths(paths: Iterable<string>): void {
  for (const path of paths) {
    updateTag(`categories/${path}`);
  }
}

/*
  getCategoriesList - 获取分类列表
*/
export async function getCategoriesList(
  params: GetCategoriesList,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CategoryListItem[] | null>>>;
export async function getCategoriesList(
  params: GetCategoriesList,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CategoryListItem[] | null>>;
export async function getCategoriesList(
  {
    access_token,
    page = 1,
    pageSize = 25,
    sortBy = "totalPostCount",
    sortOrder = "desc",
    search,
    parentId,
    parentSlug,
    postIds,
    hasZeroPosts,
    createdAtStart,
    createdAtEnd,
    updatedAtStart,
    updatedAtEnd,
  }: GetCategoriesList,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CategoryListItem[] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getCategoriesList"))) {
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
      parentId,
      parentSlug,
      postIds,
      hasZeroPosts,
      createdAtStart,
      createdAtEnd,
      updatedAtStart,
      updatedAtEnd,
    },
    GetCategoriesListSchema,
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

    // 如果提供了 parentSlug，查找对应的 parentId
    let resolvedParentId = parentId;
    if (parentSlug !== undefined && parentId === undefined) {
      const parentCategory = await prisma.category.findFirst({
        where: { slug: parentSlug },
        select: { id: true },
      });
      if (!parentCategory) {
        return response.badRequest({ message: "父分类不存在" });
      }
      resolvedParentId = parentCategory.id;
    }

    // 构建查询条件
    const where: {
      AND?: Array<{
        name?: { contains: string; mode: "insensitive" };
        parentId?: number | null;
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

    // 父分类筛选
    if (resolvedParentId !== undefined) {
      conditions.push({
        parentId: resolvedParentId,
      });
    }

    // 筛选包含指定文章的分类
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

    // 筛选无文章关联的分类
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

    // 获取分类及关联信息（分页）
    const categories = await prisma.category.findMany({
      where,
      skip,
      take: pageSize,
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        parentId: true,
        createdAt: true,
        updatedAt: true,
        parent: {
          select: {
            slug: true,
            name: true,
          },
        },
        posts: {
          where: {
            deletedAt: null,
          },
          select: {
            id: true,
          },
        },
        children: {
          select: {
            id: true,
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

    // 收集所有需要统计的分类ID（当前页分类 + 其子孙分类）
    const categoryIdsToProcess = new Set<number>();
    categories.forEach((category) => {
      categoryIdsToProcess.add(category.id);
      category.children.forEach((child) => {
        categoryIdsToProcess.add(child.id);
      });
    });

    // 一次性获取所有相关分类的完整数据
    const allRelevantCategories = await prisma.category.findMany({
      where: {
        id: { in: Array.from(categoryIdsToProcess) },
      },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        parentId: true,
        createdAt: true,
        updatedAt: true,
        posts: {
          where: {
            deletedAt: null,
          },
          select: {
            id: true,
          },
        },
        children: {
          select: {
            id: true,
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

    // 批量获取路径信息（只需1次额外查询）
    const categoryPathsMap = await batchGetCategoryPaths(
      Array.from(categoryIdsToProcess),
    );

    // 构建分类映射
    const categoryMap = new Map<number, (typeof allRelevantCategories)[0]>();
    allRelevantCategories.forEach((category) => {
      categoryMap.set(category.id, category);
    });

    // 辅助函数：递归计算总文章数（使用内存数据）
    const calculateTotalPosts = (categoryId: number): number => {
      const category = categoryMap.get(categoryId);
      if (!category) return 0;

      const directPosts = category.posts.length;
      const childPosts = category.children.reduce(
        (sum, child) => sum + calculateTotalPosts(child.id),
        0,
      );

      return directPosts + childPosts;
    };

    // 辅助函数：递归计算总子分类数
    const calculateTotalChildren = (categoryId: number): number => {
      const category = categoryMap.get(categoryId);
      if (!category) return 0;

      const directChildren = category.children.length;
      const grandChildren = category.children.reduce(
        (sum, child) => sum + calculateTotalChildren(child.id),
        0,
      );

      return directChildren + grandChildren;
    };

    // 处理每个分类的统计数据（使用内存数据，无需额外查询）
    const categoryList: CategoryListItem[] = categories.map((category) => {
      const directPostCount = category.posts.length;
      const directChildCount = category.children.length;

      // 使用内存数据计算统计信息
      const totalPostCount = calculateTotalPosts(category.id);
      const totalChildCount = calculateTotalChildren(category.id);

      // 获取路径和深度
      const path = categoryPathsMap.get(category.id) || [];
      const depth = path.length;

      return {
        id: category.id,
        slug: category.slug,
        name: category.name,
        description: category.description,
        featuredImage: getFeaturedImageUrl(category.mediaRefs),
        parentId: category.parentId,
        parentSlug: category.parent?.slug || null,
        parentName: category.parent?.name || null,
        directPostCount,
        totalPostCount,
        directChildCount,
        totalChildCount,
        depth,
        path: path.map((item) => item.slug),
        createdAt: category.createdAt.toISOString(),
        updatedAt: category.updatedAt.toISOString(),
      };
    });

    // 内存排序（因为某些字段是计算出来的）
    categoryList.sort((a, b) => {
      let aValue: string | number | null = a[
        sortBy as keyof CategoryListItem
      ] as string | number | null;
      let bValue: string | number | null = b[
        sortBy as keyof CategoryListItem
      ] as string | number | null;

      // 处理 null 值
      if (aValue === null && bValue === null) return 0;
      if (aValue === null) return sortOrder === "asc" ? 1 : -1;
      if (bValue === null) return sortOrder === "asc" ? -1 : 1;

      // 处理日期字符串
      if (sortBy === "createdAt" || sortBy === "updatedAt") {
        aValue = new Date(aValue as string | number).getTime();
        bValue = new Date(bValue as string | number).getTime();
      }

      if (sortOrder === "asc") {
        return aValue > bValue ? 1 : -1;
      } else {
        return aValue < bValue ? 1 : -1;
      }
    });

    return response.ok({
      data: categoryList,
    });
  } catch (error) {
    console.error("GetCategoriesList error:", error);
    return response.serverError();
  }
}

/*
  getCategoryDetail - 获取分类详情
*/
export async function getCategoryDetail(
  params: GetCategoryDetail,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CategoryDetail | null>>>;
export async function getCategoryDetail(
  params: GetCategoryDetail,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CategoryDetail | null>>;
export async function getCategoryDetail(
  { access_token, slug, path: pathArray }: GetCategoryDetail,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CategoryDetail | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getCategoryDetail"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      slug,
      path: pathArray,
    },
    GetCategoryDetailSchema,
  );

  if (validationError) return response.badRequest(validationError);

  // 身份验证（允许作者查看）
  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR", "AUTHOR"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    // 查找分类
    let category: {
      id: number;
      slug: string;
      name: string;
      description: string | null;
      parentId: number | null;
      createdAt: Date;
      updatedAt: Date;
      mediaRefs?: Array<{
        slot: string;
        media: { shortHash: string };
      }>;
      parent?: { slug: string; name: string } | null;
      children?: Array<{
        id: number;
        slug: string;
        name: string;
        _count: { posts: number };
      }>;
      posts?: Array<{
        id: number;
        title: string;
        slug: string;
        status: string;
      }>;
    } | null = null;

    if (pathArray && pathArray.length > 0) {
      // 使用路径查找
      const foundCategory = await findCategoryByPath(pathArray);
      if (foundCategory) {
        // 获取完整的分类信息，包括关联数据
        category = await prisma.category.findUnique({
          where: { id: foundCategory.id },
          select: {
            id: true,
            slug: true,
            name: true,
            description: true,
            parentId: true,
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
            parent: {
              select: {
                slug: true,
                name: true,
              },
            },
            children: {
              select: {
                id: true,
                slug: true,
                name: true,
                _count: {
                  select: {
                    posts: {
                      where: {
                        deletedAt: null,
                      },
                    },
                  },
                },
              },
            },
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
      }
    } else {
      // 使用 slug 查找
      category = await prisma.category.findFirst({
        where: { slug },
        select: {
          id: true,
          slug: true,
          name: true,
          description: true,
          parentId: true,
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
          parent: {
            select: {
              slug: true,
              name: true,
            },
          },
          children: {
            select: {
              id: true,
              slug: true,
              name: true,
              _count: {
                select: {
                  posts: {
                    where: {
                      deletedAt: null,
                    },
                  },
                },
              },
            },
          },
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
    }

    if (!category) {
      return response.notFound({ message: "分类不存在" });
    }

    // 统计数据
    const directPostCount = await prisma.post.count({
      where: {
        categories: {
          some: {
            id: category.id,
          },
        },
        deletedAt: null,
      },
    });

    const totalPostCount = await countCategoryPosts(category.id);
    const directChildCount = await countDirectChildren(category.id);
    const totalChildCount = await countAllDescendants(category.id);
    const path = await getCategoryPath(category.id);
    const depth = await calculateCategoryDepth(category.id);

    const categoryDetail: CategoryDetail = {
      id: category.id,
      slug: category.slug,
      name: category.name,
      description: category.description,
      featuredImage: getFeaturedImageUrl(category.mediaRefs),
      parentId: category.parentId,
      parentSlug: category.parent?.slug || null,
      parentName: category.parent?.name || null,
      directPostCount,
      totalPostCount,
      directChildCount,
      totalChildCount,
      depth,
      path,
      createdAt: category.createdAt.toISOString(),
      updatedAt: category.updatedAt.toISOString(),
      children:
        category.children?.map(
          (child: {
            id: number;
            slug: string;
            name: string;
            _count: { posts: number };
          }) => ({
            id: child.id,
            slug: child.slug,
            name: child.name,
            postCount: child._count.posts,
          }),
        ) || [],
      posts:
        category.posts?.map((post) => ({
          id: post.id,
          title: post.title,
          slug: post.slug,
          status: post.status as "DRAFT" | "PUBLISHED" | "ARCHIVED",
        })) || [],
    };

    return response.ok({
      data: categoryDetail,
    });
  } catch (error) {
    console.error("GetCategoryDetail error:", error);
    return response.serverError();
  }
}

/*
  createCategory - 创建分类
*/
export async function createCategory(
  params: CreateCategory,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<
    ApiResponse<{
      id: number;
      slug: string;
      name: string;
      description: string | null;
      parentId: number | null;
      createdAt: string;
      updatedAt: string;
    } | null>
  >
>;
export async function createCategory(
  params: CreateCategory,
  serverConfig?: ActionConfig,
): Promise<
  ApiResponse<{
    id: number;
    slug: string;
    name: string;
    description: string | null;
    parentId: number | null;
    createdAt: string;
    updatedAt: string;
  } | null>
>;
export async function createCategory(
  {
    access_token,
    name,
    slug: userSlug,
    description,
    featuredImage,
    parentId,
    parentSlug,
  }: CreateCategory,
  serverConfig?: ActionConfig,
): Promise<
  ActionResult<{
    id: number;
    slug: string;
    name: string;
    description: string | null;
    parentId: number | null;
    createdAt: string;
    updatedAt: string;
  } | null>
> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "createCategory"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      name,
      slug: userSlug,
      description,
      featuredImage,
      parentId,
      parentSlug,
    },
    CreateCategorySchema,
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
    // 如果提供了 parentSlug，查找对应的 parentId
    let resolvedParentId = parentId;
    if (parentSlug !== undefined && parentId === undefined) {
      const parentCategory = await prisma.category.findFirst({
        where: { slug: parentSlug },
        select: { id: true },
      });
      if (!parentCategory) {
        return response.badRequest({ message: "父分类不存在" });
      }
      resolvedParentId = parentCategory.id;
    }

    // 如果指定了父分类，验证父分类存在
    if (resolvedParentId !== null && resolvedParentId !== undefined) {
      const parentCategory = await prisma.category.findUnique({
        where: { id: resolvedParentId },
      });
      if (!parentCategory) {
        return response.badRequest({ message: "父分类不存在" });
      }
    }

    // 处理 slug
    let finalSlug: string;
    if (userSlug && userSlug.trim()) {
      // 用户提供了 slug，清理并验证
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
        return response.badRequest({ message: "无法从分类名生成有效的 slug" });
      }
    }

    // 检查同级唯一性
    const { slugExists, nameExists } = await checkCategoryUniqueness(
      name,
      finalSlug,
      resolvedParentId ?? null,
    );

    if (slugExists) {
      // 生成唯一 slug
      finalSlug = await generateUniqueCategorySlug(
        finalSlug,
        resolvedParentId ?? null,
      );
    }

    if (nameExists) {
      return response.badRequest({
        message: "同一父分类下已存在相同名称的分类",
      });
    }

    // 创建分类
    const categoryData: {
      slug: string;
      name: string;
      description: string | null;
      parentId: number | null;
      path: string;
      depth: number;
      fullSlug: string;
    } = {
      slug: finalSlug,
      name,
      description: description ?? null,
      parentId: resolvedParentId ?? null,
      path: "",
      depth: 0,
      fullSlug: finalSlug,
    };

    // 保存父分类信息，用于创建后更新 path
    let parentInfo: {
      path: string | null;
      depth: number;
      fullSlug: string | null;
    } | null = null;

    // 计算深度和 fullSlug（path 稍后更新）
    if (resolvedParentId) {
      const parent = await prisma.category.findUnique({
        where: { id: resolvedParentId },
        select: { path: true, depth: true, id: true, fullSlug: true },
      });
      if (parent) {
        parentInfo = parent;
        categoryData.depth = parent.depth + 1;
        // 构建 fullSlug：父分类的 fullSlug + "/" + 当前 slug
        categoryData.fullSlug = parent.fullSlug
          ? `${parent.fullSlug}/${finalSlug}`
          : finalSlug;
      }
    }

    // 如果提供了 featuredImage URL，查找对应的 mediaId
    let featuredImageMediaId: number | null = null;
    if (featuredImage !== undefined && featuredImage !== null) {
      featuredImageMediaId = await findMediaIdByUrl(prisma, featuredImage);
    }

    // 创建分类（path 稍后更新）
    const category = await prisma.category.create({
      data: categoryData,
      include: {
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

    // 更新 path（现在知道了新分类的 ID）
    if (parentInfo) {
      const correctPath = parentInfo.path
        ? `${parentInfo.path}/${category.id}`
        : `${category.id}`;
      await prisma.category.update({
        where: { id: category.id },
        data: { path: correctPath },
      });
    } else {
      // 根分类
      await prisma.category.update({
        where: { id: category.id },
        data: { path: `${category.id}` },
      });
    }

    // 如果有 featuredImage，创建关联
    if (featuredImageMediaId !== null) {
      await prisma.mediaReference.create({
        data: {
          mediaId: featuredImageMediaId,
          categoryId: category.id,
          slot: MEDIA_SLOTS.CATEGORY_FEATURED_IMAGE,
        },
      });
    }

    // 重新获取分类以包含 mediaRefs
    const categoryWithMedia = await prisma.category.findUnique({
      where: { id: category.id },
      include: {
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

    // 审计日志
    const { after } = await import("next/server");
    after(async () => {
      await logAuditEvent({
        user: {
          uid: String(user.uid),
        },
        details: {
          action: "CREATE_CATEGORY",
          resourceType: "CATEGORY",
          resourceId: category.id.toString(),
          value: {
            old: null,
            new: {
              name: category.name,
              slug: category.slug,
              parentId: category.parentId,
            },
          },
          description: "创建分类",
        },
      });
    });

    // 刷新缓存标签
    const categoryDetailTagsToRefresh = new Set<string>();
    addCategoryPathTags(categoryDetailTagsToRefresh, category.fullSlug);
    updateTag("categories/list");
    updateCategoryCacheTagsByPaths(categoryDetailTagsToRefresh);

    return response.ok({
      data: {
        id: category.id,
        slug: category.slug,
        name: category.name,
        description: category.description,
        featuredImage: getFeaturedImageUrl(categoryWithMedia?.mediaRefs),
        parentId: category.parentId,
        createdAt: category.createdAt.toISOString(),
        updatedAt: category.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("CreateCategory error:", error);
    return response.serverError();
  }
}

/*
  updateCategory - 更新分类
*/
export async function updateCategory(
  params: UpdateCategory,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<
    ApiResponse<{
      id: number;
      slug: string;
      name: string;
      description: string | null;
      featuredImage: string | null;
      parentId: number | null;
      updatedAt: string;
    } | null>
  >
>;
export async function updateCategory(
  params: UpdateCategory,
  serverConfig?: ActionConfig,
): Promise<
  ApiResponse<{
    id: number;
    slug: string;
    name: string;
    description: string | null;
    parentId: number | null;
    updatedAt: string;
  } | null>
>;
export async function updateCategory(
  {
    access_token,
    id,
    slug,
    newSlug,
    newName,
    description,
    featuredImage,
    parentId,
    parentSlug,
  }: UpdateCategory,
  serverConfig?: ActionConfig,
): Promise<
  ActionResult<{
    id: number;
    slug: string;
    name: string;
    description: string | null;
    parentId: number | null;
    updatedAt: string;
  } | null>
> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "updateCategory"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      id,
      slug,
      newSlug,
      newName,
      description,
      featuredImage,
      parentId,
      parentSlug,
    },
    UpdateCategorySchema,
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
    // 查找分类
    let category;
    if (id) {
      category = await prisma.category.findUnique({ where: { id } });
    } else if (slug) {
      category = await prisma.category.findFirst({ where: { slug } });
    }

    if (!category) {
      return response.notFound({ message: "分类不存在" });
    }

    // 如果提供了 parentSlug，查找对应的 parentId
    let resolvedParentId = parentId;
    if (parentSlug !== undefined && parentId === undefined) {
      if (parentSlug === null) {
        resolvedParentId = null;
      } else {
        const parentCategory = await prisma.category.findFirst({
          where: { slug: parentSlug },
          select: { id: true },
        });
        if (!parentCategory) {
          return response.badRequest({ message: "父分类不存在" });
        }
        resolvedParentId = parentCategory.id;
      }
    }

    // 如果要移动分类，验证不会造成循环引用
    if (
      resolvedParentId !== undefined &&
      resolvedParentId !== category.parentId
    ) {
      const willCycle = await validateCategoryMove(
        category.id,
        resolvedParentId,
      );
      if (willCycle) {
        return response.badRequest({ message: "无法移动分类：会造成循环引用" });
      }

      // 如果指定了新父分类，验证父分类存在
      if (resolvedParentId !== null) {
        const parentCategory = await prisma.category.findUnique({
          where: { id: resolvedParentId },
        });
        if (!parentCategory) {
          return response.badRequest({ message: "父分类不存在" });
        }
      }
    }

    // 构建更新数据
    const updateData: {
      slug?: string;
      name?: string;
      description?: string | null;
      parentId?: number | null;
      path?: string;
      depth?: number;
      fullSlug?: string;
    } = {};

    // 处理 slug 更新
    if (newSlug) {
      // 检查是否为"未分类"分类，禁止修改其 slug
      if (category.slug === "uncategorized" && newSlug !== category.slug) {
        return response.badRequest({
          message: "不允许修改系统分类的 slug",
        });
      }

      const sanitizedSlug = sanitizeUserSlug(newSlug);
      if (!isValidSlug(sanitizedSlug)) {
        return response.badRequest({ message: "Slug 格式不正确" });
      }

      // 检查同级唯一性（排除自己）
      const targetParentId =
        resolvedParentId !== undefined ? resolvedParentId : category.parentId;
      const { slugExists } = await checkCategoryUniqueness(
        newName || category.name,
        sanitizedSlug,
        targetParentId,
        category.id,
      );

      if (slugExists) {
        return response.badRequest({
          message: "同一父分类下已存在相同 slug 的分类",
        });
      }

      updateData.slug = sanitizedSlug;

      // 重新计算 fullSlug
      if (category.parentId) {
        const parent = await prisma.category.findUnique({
          where: { id: category.parentId },
          select: { fullSlug: true },
        });
        if (parent) {
          updateData.fullSlug = parent.fullSlug
            ? `${parent.fullSlug}/${sanitizedSlug}`
            : sanitizedSlug;
        } else {
          updateData.fullSlug = sanitizedSlug;
        }
      } else {
        updateData.fullSlug = sanitizedSlug;
      }
    }

    // 处理名称更新
    if (newName) {
      const targetParentId =
        resolvedParentId !== undefined ? resolvedParentId : category.parentId;
      const { nameExists } = await checkCategoryUniqueness(
        newName,
        updateData.slug || category.slug,
        targetParentId,
        category.id,
      );

      if (nameExists) {
        return response.badRequest({
          message: "同一父分类下已存在相同名称的分类",
        });
      }

      updateData.name = newName;
    }

    // 处理描述更新
    if (description !== undefined) {
      updateData.description = description;
    }

    // 处理父分类更新
    let updateDescendants = false;
    let newPathPrefix = "";
    let oldPathPrefix = "";
    let oldFullSlugPrefix = "";
    let newFullSlugPrefix = "";
    let depthChange = 0;

    if (
      resolvedParentId !== undefined &&
      resolvedParentId !== category.parentId
    ) {
      // 检查是否为"未分类"分类，禁止设置父分类
      if (category.slug === "uncategorized" && resolvedParentId !== null) {
        return response.badRequest({
          message: "不允许移动系统分类到其他分类下",
        });
      }

      updateData.parentId = resolvedParentId;

      // 准备更新子孙分类的路径
      // path 格式：包含自己的 ID，格式如 "5/10/15"（与 Comment 一致）
      updateDescendants = true;
      oldPathPrefix = `${category.path}/`;
      // fullSlug 已经包含了当前分类的 slug，不需要重复添加
      oldFullSlugPrefix = `${category.fullSlug}/`;

      if (resolvedParentId === null) {
        // 移动到根
        newPathPrefix = `${category.id}/`;
        newFullSlugPrefix = "";
        updateData.path = `${category.id}`;
        updateData.depth = 0;
        updateData.fullSlug = category.slug;
      } else {
        // 移动到新父级
        const newParent = await prisma.category.findUnique({
          where: { id: resolvedParentId },
          select: { path: true, depth: true, id: true, fullSlug: true },
        });

        if (!newParent) {
          return response.badRequest({ message: "新父分类不存在" });
        }

        // path 格式：包含自己的 ID，格式如 "5/10/15"（与 Comment 一致）
        updateData.path = newParent.path
          ? `${newParent.path}/${category.id}`
          : `${category.id}`;
        updateData.depth = newParent.depth + 1;
        newPathPrefix = `${updateData.path}/`;
        updateData.fullSlug = newParent.fullSlug
          ? `${newParent.fullSlug}/${category.slug}`
          : category.slug;
        newFullSlugPrefix = `${updateData.fullSlug}/`;
      }

      depthChange = updateData.depth - category.depth;
    }

    const categoryDetailTagsToRefresh = new Set<string>();
    addCategoryPathTags(categoryDetailTagsToRefresh, category.fullSlug);
    if (typeof updateData.fullSlug === "string") {
      addCategoryPathTags(categoryDetailTagsToRefresh, updateData.fullSlug);
    }

    // 执行更新（事务处理，确保原子性）
    const updatedCategory = await prisma.$transaction(async (tx) => {
      // 1. 更新当前分类
      const updated = await tx.category.update({
        where: { id: category.id },
        data: updateData,
      });

      // 2. 如果路径改变，更新所有子孙分类
      if (updateDescendants) {
        // 查找所有受影响的子孙
        const descendants = await tx.category.findMany({
          where: {
            path: { startsWith: oldPathPrefix },
          },
          select: {
            id: true,
            path: true,
            depth: true,
            fullSlug: true,
            slug: true,
          },
        });

        for (const desc of descendants) {
          // 替换 path 前缀
          const newPath =
            newPathPrefix + desc.path.substring(oldPathPrefix.length);
          const newDepth = desc.depth + depthChange;
          // 替换 fullSlug 前缀
          const newFullSlug = desc.fullSlug.startsWith(oldFullSlugPrefix)
            ? newFullSlugPrefix +
              desc.fullSlug.substring(oldFullSlugPrefix.length)
            : desc.fullSlug;
          addCategoryPathTags(categoryDetailTagsToRefresh, desc.fullSlug);
          addCategoryPathTags(categoryDetailTagsToRefresh, newFullSlug);

          await tx.category.update({
            where: { id: desc.id },
            data: {
              path: newPath,
              depth: newDepth,
              fullSlug: newFullSlug,
            },
          });
        }
      }

      // 3. 如果 slug 改变但路径未变，更新所有子孙的 fullSlug
      if (newSlug && !updateDescendants) {
        const oldFullSlugPrefix = `${category.fullSlug}/`;
        const newFullSlugPrefix = `${updateData.fullSlug}/`;

        // path 格式：包含自己的 ID，格式如 "5/10/15"（与 Comment 一致）
        // category.path 已经包含了自己的 ID，直接添加 "/" 即可
        const allDescendants = await tx.category.findMany({
          where: {
            path: { startsWith: `${category.path}/` },
          },
          select: { id: true, fullSlug: true },
        });

        for (const desc of allDescendants) {
          const newFullSlug = desc.fullSlug.startsWith(oldFullSlugPrefix)
            ? newFullSlugPrefix +
              desc.fullSlug.substring(oldFullSlugPrefix.length)
            : desc.fullSlug;
          addCategoryPathTags(categoryDetailTagsToRefresh, desc.fullSlug);
          addCategoryPathTags(categoryDetailTagsToRefresh, newFullSlug);

          await tx.category.update({
            where: { id: desc.id },
            data: { fullSlug: newFullSlug },
          });
        }
      }

      return updated;
    });

    // 处理特色图片更新
    if (featuredImage !== undefined) {
      // 删除旧的特色图片引用
      await prisma.mediaReference.deleteMany({
        where: {
          categoryId: category.id,
          slot: MEDIA_SLOTS.CATEGORY_FEATURED_IMAGE,
        },
      });

      // 如果提供了新的 featuredImage URL，创建新引用
      if (featuredImage !== null) {
        const mediaId = await findMediaIdByUrl(prisma, featuredImage);
        if (mediaId) {
          await prisma.mediaReference.create({
            data: {
              mediaId,
              categoryId: category.id,
              slot: MEDIA_SLOTS.CATEGORY_FEATURED_IMAGE,
            },
          });
        }
      }
    }

    // 重新获取分类以包含 mediaRefs
    const updatedCategoryWithMedia = await prisma.category.findUnique({
      where: { id: category.id },
      include: {
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

    // 审计日志 - 使用自动对象比对功能
    const oldCategoryData = {
      slug: category.slug,
      name: category.name,
      description: category.description,
      parentId: category.parentId,
    };

    const newCategoryData = {
      slug: updatedCategory.slug,
      name: updatedCategory.name,
      description: updatedCategory.description,
      parentId: updatedCategory.parentId,
    };

    const { after } = await import("next/server");
    after(async () => {
      await logAuditEvent({
        user: {
          uid: String(user.uid),
        },
        details: {
          action: "UPDATE_CATEGORY",
          resourceType: "CATEGORY",
          resourceId: updatedCategory.id.toString(),
          value: {
            old: oldCategoryData,
            new: newCategoryData,
          },
          description: "更新分类",
        },
      });
    });

    // 刷新缓存标签
    updateTag("categories/list");
    updateCategoryCacheTagsByPaths(categoryDetailTagsToRefresh);
    updateTag("posts/list");

    return response.ok({
      data: {
        id: updatedCategory.id,
        slug: updatedCategory.slug,
        name: updatedCategory.name,
        description: updatedCategory.description,
        featuredImage: getFeaturedImageUrl(updatedCategoryWithMedia?.mediaRefs),
        parentId: updatedCategory.parentId,
        updatedAt: updatedCategory.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("UpdateCategory error:", error);
    return response.serverError();
  }
}

/*
  deleteCategories - 批量删除分类（级联删除）
*/
export async function deleteCategories(
  params: DeleteCategories,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<
    ApiResponse<{
      deleted: number;
      ids: number[];
      cascadeDeleted: number;
    } | null>
  >
>;
export async function deleteCategories(
  params: DeleteCategories,
  serverConfig?: ActionConfig,
): Promise<
  ApiResponse<{
    deleted: number;
    ids: number[];
    cascadeDeleted: number;
  } | null>
>;
export async function deleteCategories(
  { access_token, ids }: DeleteCategories,
  serverConfig?: ActionConfig,
): Promise<
  ActionResult<{
    deleted: number;
    ids: number[];
    cascadeDeleted: number;
  } | null>
> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "deleteCategories"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      ids,
    },
    DeleteCategoriesSchema,
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
    // 检查是否包含"未分类"分类，禁止删除
    const uncategorizedCategories = await prisma.category.findMany({
      where: {
        id: { in: ids },
        slug: "uncategorized",
      },
      select: { id: true, name: true },
    });

    if (uncategorizedCategories.length > 0) {
      return response.badRequest({
        message: `不允许删除系统保留分类"${uncategorizedCategories[0]?.name}"`,
      });
    }

    // 统计将要级联删除的所有分类 ID（包含自己和子孙）
    const allIdsToDelete = new Set<number>();
    for (const id of ids) {
      allIdsToDelete.add(id);
      const descendants = await getAllDescendantIds(id);
      descendants.forEach((dId) => allIdsToDelete.add(dId));
    }
    const cascadeDeleted = allIdsToDelete.size - ids.length;

    const categoryDetailTagsToRefresh = new Set<string>();
    const categoriesToDelete = await prisma.category.findMany({
      where: {
        id: {
          in: Array.from(allIdsToDelete),
        },
      },
      select: {
        fullSlug: true,
      },
    });
    for (const category of categoriesToDelete) {
      addCategoryPathTags(categoryDetailTagsToRefresh, category.fullSlug);
    }

    // 获取受影响的文章 ID
    const affectedPosts = await prisma.post.findMany({
      where: {
        categories: {
          some: { id: { in: Array.from(allIdsToDelete) } },
        },
      },
      select: { id: true },
    });
    const affectedPostIds = affectedPosts.map((p) => p.id);

    // 获取或创建"未分类"分类
    let uncategorized = await prisma.category.findFirst({
      where: { slug: "uncategorized" },
      select: { id: true },
    });

    if (!uncategorized) {
      uncategorized = await prisma.category.create({
        data: {
          name: "未分类",
          slug: "uncategorized",
          description: "自动分配给未指定分类的文章",
          path: "",
          depth: 0,
          fullSlug: "uncategorized",
        },
        select: { id: true },
      });
    }

    const uncategorizedId = uncategorized.id;

    // 执行删除和重新分配（事务）
    const deleteResult = await prisma.$transaction(async (tx) => {
      // 1. 删除分类
      const result = await tx.category.deleteMany({
        where: { id: { in: ids } },
      });

      // 2. 检查受影响的文章，如果已无分类，关联到"未分类"
      if (affectedPostIds.length > 0) {
        // 查找现在没有分类的文章
        const orphanedPosts = await tx.post.findMany({
          where: {
            id: { in: affectedPostIds },
            categories: { none: {} },
          },
          select: { id: true },
        });

        const orphanedPostIds = orphanedPosts.map((p) => p.id);

        if (orphanedPostIds.length > 0) {
          // 批量关联到未分类
          // Prisma 不支持直接对 findMany 结果进行多对多 connect
          // 需要循环或者使用 updateMany（但 updateMany 不支持关系操作）
          // 这里使用循环更新
          for (const postId of orphanedPostIds) {
            await tx.post.update({
              where: { id: postId },
              data: {
                categories: {
                  connect: { id: uncategorizedId },
                },
              },
            });
          }
        }
      }

      return result;
    });

    // 审计日志
    const { after } = await import("next/server");
    after(async () => {
      await logAuditEvent({
        user: {
          uid: String(user.uid),
        },
        details: {
          action: "DELETE_CATEGORIES",
          resourceType: "CATEGORY",
          resourceId: ids.join(","),
          value: {
            old: { categoryIds: ids, cascadeDeleted },
            new: null,
          },
          description: "批量删除分类",
        },
      });
    });

    // 刷新缓存标签
    updateTag("categories/list");
    updateCategoryCacheTagsByPaths(categoryDetailTagsToRefresh);
    updateTag("posts/list");

    return response.ok({
      data: {
        deleted: deleteResult.count,
        ids,
        cascadeDeleted,
      },
    });
  } catch (error) {
    console.error("DeleteCategories error:", error);
    return response.serverError();
  }
}

/*
  moveCategories - 批量移动分类到同一父分类
*/
export async function moveCategories(
  params: MoveCategories,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<
    ApiResponse<{
      moved: number;
      ids: number[];
      targetParentId: number | null;
    } | null>
  >
>;
export async function moveCategories(
  params: MoveCategories,
  serverConfig?: ActionConfig,
): Promise<
  ApiResponse<{
    moved: number;
    ids: number[];
    targetParentId: number | null;
  } | null>
>;
export async function moveCategories(
  { access_token, ids, targetParentId, targetParentSlug }: MoveCategories,
  serverConfig?: ActionConfig,
): Promise<
  ActionResult<{
    moved: number;
    ids: number[];
    targetParentId: number | null;
  } | null>
> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "moveCategories"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      ids,
      targetParentId,
      targetParentSlug,
    },
    MoveCategoriesSchema,
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
    // 检查是否包含"未分类"分类，禁止移动
    const uncategorizedCategories = await prisma.category.findMany({
      where: {
        id: { in: ids },
        slug: "uncategorized",
      },
      select: { id: true, name: true },
    });

    if (uncategorizedCategories.length > 0) {
      return response.badRequest({
        message: `不允许移动系统保留分类"${uncategorizedCategories[0]?.name}"`,
      });
    }
    // 如果提供了 targetParentSlug，查找对应的 targetParentId
    let resolvedTargetParentId = targetParentId;
    if (targetParentSlug !== undefined && targetParentId === undefined) {
      if (targetParentSlug === null) {
        resolvedTargetParentId = null;
      } else {
        const parentCategory = await prisma.category.findFirst({
          where: { slug: targetParentSlug },
          select: { id: true },
        });
        if (!parentCategory) {
          return response.badRequest({ message: "目标父分类不存在" });
        }
        resolvedTargetParentId = parentCategory.id;
      }
    }

    // 如果指定了目标父分类，验证父分类存在
    if (resolvedTargetParentId !== null) {
      const parentCategory = await prisma.category.findUnique({
        where: { id: resolvedTargetParentId },
      });
      if (!parentCategory) {
        return response.badRequest({ message: "目标父分类不存在" });
      }
    }

    // 验证每个分类的移动是否安全
    for (const id of ids) {
      const willCycle = await validateCategoryMove(id, resolvedTargetParentId);
      if (willCycle) {
        return response.badRequest({
          message: `无法移动分类 ID ${id}：会造成循环引用`,
        });
      }

      // 检查同级唯一性
      const category = await prisma.category.findUnique({
        where: { id },
        select: { name: true, slug: true },
      });

      if (category) {
        const { slugExists, nameExists } = await checkCategoryUniqueness(
          category.name,
          category.slug,
          resolvedTargetParentId,
          id,
        );

        if (slugExists || nameExists) {
          return response.badRequest({
            message: `无法移动分类 "${category.name}"：目标位置已存在相同名称或 slug 的分类`,
          });
        }
      }
    }

    // 获取移动前的 parentId 信息用于审计日志
    const oldCategories = await prisma.category.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        parentId: true,
        path: true,
        depth: true,
        slug: true,
        fullSlug: true,
      },
    });

    const oldParentIds = oldCategories.map((c) => ({
      id: c.id,
      parentId: c.parentId,
    }));
    const categoryDetailTagsToRefresh = new Set<string>();
    for (const category of oldCategories) {
      addCategoryPathTags(categoryDetailTagsToRefresh, category.fullSlug);
    }

    // 准备目标父级信息
    let targetPath = "";
    let targetFullSlug = ""; // 添加目标父级的 fullSlug
    let targetDepth = -1; // 根级深度为-1，这样+1后为0

    if (resolvedTargetParentId !== null) {
      const targetParent = await prisma.category.findUnique({
        where: { id: resolvedTargetParentId },
        select: { path: true, depth: true, id: true, fullSlug: true },
      });
      if (targetParent) {
        // path 格式：包含自己的 ID，格式如 "5/10/15"（与 Comment 一致）
        // targetPath 就是目标父级的完整 path（已经包含父级自己的 ID）
        targetPath = targetParent.path;
        targetFullSlug = targetParent.fullSlug || "";
        targetDepth = targetParent.depth;
      }
    }

    // 批量更新（事务）
    await prisma.$transaction(async (tx) => {
      for (const cat of oldCategories) {
        // 1. 计算新信息
        const newPath = targetPath ? `${targetPath}/${cat.id}` : `${cat.id}`;
        // fullSlug = 目标父级的 fullSlug + 当前分类的 slug
        const newFullSlug = targetFullSlug
          ? `${targetFullSlug}/${cat.slug}`
          : cat.slug;
        addCategoryPathTags(categoryDetailTagsToRefresh, newFullSlug);
        const newDepth = targetDepth + 1;

        // 2. 更新当前分类
        await tx.category.update({
          where: { id: cat.id },
          data: {
            parentId: resolvedTargetParentId,
            path: newPath,
            fullSlug: newFullSlug, // 更新 fullSlug
            depth: newDepth,
          },
        });

        // 3. 更新子孙分类
        // path 格式：包含自己的 ID，格式如 "5/10/15"（与 Comment 一致）
        const oldPathPrefix = `${cat.path}/`;
        const newPathPrefix = `${newPath}/`;
        const oldFullSlugPrefix = `${cat.fullSlug}/`;
        const newFullSlugPrefix = `${newFullSlug}/`;
        const depthChange = newDepth - cat.depth;

        // 查找所有子孙
        const descendants = await tx.category.findMany({
          where: {
            path: { startsWith: oldPathPrefix },
          },
          select: { id: true, path: true, depth: true, fullSlug: true },
        });

        for (const desc of descendants) {
          const descNewPath =
            newPathPrefix + desc.path.substring(oldPathPrefix.length);
          const descNewDepth = desc.depth + depthChange;
          // 更新 fullSlug
          const descNewFullSlug = desc.fullSlug.startsWith(oldFullSlugPrefix)
            ? newFullSlugPrefix +
              desc.fullSlug.substring(oldFullSlugPrefix.length)
            : desc.fullSlug;
          addCategoryPathTags(categoryDetailTagsToRefresh, desc.fullSlug);
          addCategoryPathTags(categoryDetailTagsToRefresh, descNewFullSlug);

          await tx.category.update({
            where: { id: desc.id },
            data: {
              path: descNewPath,
              depth: descNewDepth,
              fullSlug: descNewFullSlug,
            },
          });
        }
      }
    });

    // 批量更新（由于已经在事务中逐个更新，这里只需要返回结果）
    // 为了保持返回值一致，我们构造一个结果对象
    const updateResult = { count: ids.length };

    // 审计日志
    const { after } = await import("next/server");
    after(async () => {
      await logAuditEvent({
        user: {
          uid: String(user.uid),
        },
        details: {
          action: "MOVE_CATEGORIES",
          resourceType: "CATEGORY",
          resourceId: ids.join(","),
          value: {
            old: { categories: oldParentIds },
            new: { targetParentId: resolvedTargetParentId },
          },
          description: "批量移动分类",
        },
      });
    });

    // 刷新缓存标签
    updateTag("categories/list");
    updateCategoryCacheTagsByPaths(categoryDetailTagsToRefresh);
    updateTag("posts/list");

    return response.ok({
      data: {
        moved: updateResult.count,
        ids,
        targetParentId: resolvedTargetParentId,
      },
    });
  } catch (error) {
    console.error("MoveCategories error:", error);
    return response.serverError();
  }
}

/*
  searchCategories - 轻量级分类搜索（支持路径搜索和子分类展示）
*/
export async function searchCategories(
  params: SearchCategories,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<SearchCategoryItem[] | null>>>;
export async function searchCategories(
  params: SearchCategories,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<SearchCategoryItem[] | null>>;
export async function searchCategories(
  { access_token, query, limit = 10, parentId }: SearchCategories,
  serverConfig?: ActionConfig,
): Promise<ActionResult<SearchCategoryItem[] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "searchCategories"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      query,
      limit,
      parentId,
    },
    SearchCategoriesSchema,
  );

  if (validationError) return response.badRequest(validationError);

  // 身份验证
  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR", "AUTHOR"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    const trimmedQuery = query.trim();
    // 定义中间结果类型（包含需要用于构建最终结果的字段）
    type IntermediateCategory = {
      id: number;
      slug: string;
      name: string;
      parentId: number | null;
      _count: { posts: number };
    };
    const searchResultsMap = new Map<number, IntermediateCategory>();

    // 检查是否是路径搜索
    const isPathSearch = /[/／]/.test(trimmedQuery);

    // 构建基础查询
    const baseWhere: { parentId?: number | null } = {
      ...(parentId !== undefined && { parentId }),
    };

    if (isPathSearch) {
      const pathParts = trimmedQuery
        .split(/[/／]/)
        .map((part) => part.trim())
        .filter(Boolean);

      if (pathParts.length > 0) {
        // 搜索最后一个部分
        const lastPart = pathParts[pathParts.length - 1];
        const categories = await prisma.category.findMany({
          where: {
            ...baseWhere,
            OR: [
              { name: { contains: lastPart, mode: "insensitive" } },
              { slug: { contains: lastPart, mode: "insensitive" } },
            ],
          },
          select: {
            id: true,
            slug: true,
            name: true,
            parentId: true,
            _count: { select: { posts: { where: { deletedAt: null } } } },
          },
          take: limit * 2,
        });
        categories.forEach((c) => searchResultsMap.set(c.id, c));
      }
    } else {
      const categories = await prisma.category.findMany({
        where: {
          ...baseWhere,
          OR: [
            { name: { contains: trimmedQuery, mode: "insensitive" } },
            { slug: { contains: trimmedQuery, mode: "insensitive" } },
          ],
        },
        select: {
          id: true,
          slug: true,
          name: true,
          parentId: true,
          _count: { select: { posts: { where: { deletedAt: null } } } },
        },
        take: limit * 2,
      });
      categories.forEach((c) => searchResultsMap.set(c.id, c));

      // 自动带出子分类（可选增强）
      if (categories.length > 0) {
        const children = await prisma.category.findMany({
          where: { parentId: { in: categories.map((c) => c.id) } },
          select: {
            id: true,
            slug: true,
            name: true,
            parentId: true,
            _count: { select: { posts: { where: { deletedAt: null } } } },
          },
          take: limit,
        });
        children.forEach((c) => searchResultsMap.set(c.id, c));
      }
    }

    const allFoundCategories = Array.from(searchResultsMap.values());
    if (allFoundCategories.length === 0) return response.ok({ data: [] });

    // 批量获取路径（核心优化）
    const categoryPathsMap = await batchGetCategoryPaths(
      allFoundCategories.map((c) => c.id),
    );

    const finalResults: SearchCategoryItem[] = allFoundCategories.map(
      (category) => {
        const fullPathObjects = categoryPathsMap.get(category.id) || [];
        // 这里的 path 数组应该只包含祖先名字
        const parentNamePath = fullPathObjects
          .slice(0, -1) // 排除自己
          .map((p) => p.name);

        return {
          id: category.id,
          slug: category.slug,
          name: category.name,
          parentId: category.parentId,
          postCount: category._count.posts,
          path: parentNamePath,
        };
      },
    );

    // 排序
    finalResults.sort((a, b) => {
      // 构建完整路径用于比较
      const aFullPath =
        a.path.length > 0 ? `${a.path.join(" / ")} / ${a.name}` : a.name;
      const bFullPath =
        b.path.length > 0 ? `${b.path.join(" / ")} / ${b.name}` : b.name;

      // 格式化搜索查询（统一为 "A / B" 格式）
      const normalizedQuery = trimmedQuery
        .split(/[/／]/)
        .map((p) => p.trim())
        .filter(Boolean)
        .join(" / ")
        .toLowerCase();

      const aFullPathLower = aFullPath.toLowerCase();
      const bFullPathLower = bFullPath.toLowerCase();
      const aNameLower = a.name.toLowerCase();
      const bNameLower = b.name.toLowerCase();

      // 1. 优先显示完整路径完全匹配的
      const aPathMatch = aFullPathLower === normalizedQuery;
      const bPathMatch = bFullPathLower === normalizedQuery;
      if (aPathMatch && !bPathMatch) return -1;
      if (!aPathMatch && bPathMatch) return 1;

      // 2. 优先显示名称完全匹配的
      const aNameMatch = aNameLower === trimmedQuery.toLowerCase();
      const bNameMatch = bNameLower === trimmedQuery.toLowerCase();
      if (aNameMatch && !bNameMatch) return -1;
      if (!aNameMatch && bNameMatch) return 1;

      // 3. 完整路径以搜索词开头的优先
      const aPathStartsWith = aFullPathLower.startsWith(normalizedQuery);
      const bPathStartsWith = bFullPathLower.startsWith(normalizedQuery);
      if (aPathStartsWith && !bPathStartsWith) return -1;
      if (!aPathStartsWith && bPathStartsWith) return 1;

      // 4. 名称以搜索词开头的优先
      const aStartsWith = aNameLower.startsWith(trimmedQuery.toLowerCase());
      const bStartsWith = bNameLower.startsWith(trimmedQuery.toLowerCase());
      if (aStartsWith && !bStartsWith) return -1;
      if (!aStartsWith && bStartsWith) return 1;

      // 5. 路径层级少的优先（更简洁的分类）
      const aDepth = a.path.length;
      const bDepth = b.path.length;
      if (aDepth !== bDepth) return aDepth - bDepth;

      // 6. 文章数量多的优先
      if (a.postCount !== b.postCount) {
        return b.postCount - a.postCount;
      }

      // 7. 最后按名称排序
      return a.name.localeCompare(b.name);
    });

    // 截取 limit 数量
    const limitedResults = finalResults.slice(0, limit);

    return response.ok({
      data: limitedResults,
    });
  } catch (error) {
    console.error("SearchCategories error:", error);
    return response.serverError();
  }
}

/*
  getCategoriesDistribution - 获取分类分布（用于环形图）
*/
export async function getCategoriesDistribution(
  params: GetCategoriesDistribution,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CategoryDistributionItem[] | null>>>;
export async function getCategoriesDistribution(
  params: GetCategoriesDistribution,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CategoryDistributionItem[] | null>>;
export async function getCategoriesDistribution(
  { access_token, parentId, parentSlug, limit = 10 }: GetCategoriesDistribution,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CategoryDistributionItem[] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getCategoriesDistribution"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      parentId,
      parentSlug,
      limit,
    },
    GetCategoriesDistributionSchema,
  );

  if (validationError) return response.badRequest(validationError);

  // 身份验证
  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR", "AUTHOR"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    // 如果提供了 parentSlug，查找对应的 parentId
    let resolvedParentId = parentId;
    if (parentSlug !== undefined && parentId === undefined) {
      const parentCategory = await prisma.category.findFirst({
        where: { slug: parentSlug },
        select: { id: true },
      });
      if (!parentCategory) {
        return response.badRequest({ message: "父分类不存在" });
      }
      resolvedParentId = parentCategory.id;
    }

    // 查询指定父分类下的所有子分类
    const categories = await prisma.category.findMany({
      where: {
        parentId: resolvedParentId,
      },
      select: {
        id: true,
        slug: true,
        name: true,
      },
    });

    // 统计每个分类的总文章数（含子孙分类）
    const distributionData = await Promise.all(
      categories.map(async (category) => {
        const totalPostCount = await countCategoryPosts(category.id);
        return {
          id: category.id,
          slug: category.slug,
          name: category.name,
          totalPostCount,
        };
      }),
    );

    // 按文章数排序并取前 N 个
    distributionData.sort((a, b) => b.totalPostCount - a.totalPostCount);
    const topCategories = distributionData.slice(0, limit);

    // 计算总文章数
    const totalPosts = topCategories.reduce(
      (sum, cat) => sum + cat.totalPostCount,
      0,
    );

    // 计算百分比
    const distribution: CategoryDistributionItem[] = topCategories.map(
      (category) => ({
        id: category.id,
        slug: category.slug,
        name: category.name,
        totalPostCount: category.totalPostCount,
        percentage:
          totalPosts > 0 ? (category.totalPostCount / totalPosts) * 100 : 0,
      }),
    );

    return response.ok({
      data: distribution,
    });
  } catch (error) {
    console.error("GetCategoriesDistribution error:", error);
    return response.serverError();
  }
}

/*
  getCategoriesTree - 获取分类树形结构
*/
export async function getCategoriesTree(
  params: GetCategoriesTree,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CategoryTreeNode[] | null>>>;
export async function getCategoriesTree(
  params: GetCategoriesTree,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CategoryTreeNode[] | null>>;
export async function getCategoriesTree(
  { access_token, parentId, maxDepth }: GetCategoriesTree,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CategoryTreeNode[] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getCategoriesTree"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      parentId,
      maxDepth,
    },
    GetCategoriesTreeSchema,
  );

  if (validationError) return response.badRequest(validationError);

  // 身份验证
  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR", "AUTHOR"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    const tree = await buildCategoryTree(parentId ?? null, maxDepth);

    const treeData: CategoryTreeNode[] = tree.map((node) => ({
      id: node.id,
      slug: node.slug,
      name: node.name,
      description: node.description,
      parentId: node.parentId,
      postCount: node.postCount,
      createdAt: node.createdAt.toISOString(),
      updatedAt: node.updatedAt.toISOString(),
      children: node.children,
    }));

    return response.ok({
      data: treeData,
    });
  } catch (error) {
    console.error("GetCategoriesTree error:", error);
    return response.serverError();
  }
}

/*
  辅助函数：生成同级唯一的 slug
*/
async function generateUniqueCategorySlug(
  baseSlug: string,
  parentId: number | null,
): Promise<string> {
  let slug = baseSlug;
  let counter = 1;

  while (true) {
    const existing = await prisma.category.findFirst({
      where: {
        slug,
        parentId,
      },
    });

    if (!existing) {
      return slug;
    }

    slug = `${baseSlug}-${counter}`;
    counter++;
  }
}
