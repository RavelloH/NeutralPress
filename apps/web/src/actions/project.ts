"use server";
import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type {
  CreateProject,
  CreateProjectResult,
  DeleteProjects,
  GetProjectDetail,
  GetProjectsList,
  GetProjectsTrends,
  ProjectDetail,
  ProjectListItem,
  ProjectTrendItem,
  SyncProjectsGithub,
  SyncProjectsGithubResult,
  UpdateProject,
  UpdateProjectResult,
  UpdateProjects,
} from "@repo/shared-types/api/project";
import {
  CreateProjectSchema,
  DeleteProjectsSchema,
  GetProjectDetailSchema,
  GetProjectsListSchema,
  GetProjectsTrendsSchema,
  SyncProjectsGithubSchema,
  UpdateProjectSchema,
  UpdateProjectsSchema,
} from "@repo/shared-types/api/project";
import { updateTag } from "next/cache";
import { headers } from "next/headers";
import type { NextResponse } from "next/server";

import { logAuditEvent } from "@/lib/server/audit";
import { authVerify } from "@/lib/server/auth-verify";
import { getConfig } from "@/lib/server/config-cache";
import { runProjectsGithubSync } from "@/lib/server/cron-task-runner";
import { generateSignature } from "@/lib/server/image-crypto";
import {
  findMediaIdByUrl,
  getAllFeaturedImageUrls,
  getFeaturedImageUrl,
} from "@/lib/server/media-reference";
import prisma from "@/lib/server/prisma";
import { PUBLIC_PROJECT_STATUSES } from "@/lib/server/project-public";
import limitControl from "@/lib/server/rate-limit";
import ResponseBuilder from "@/lib/server/response";
import { slugify } from "@/lib/server/slugify";
import { validateData } from "@/lib/server/validator";
import { MEDIA_SLOTS } from "@/types/media";

function isPublicProjectStatus(status: string): boolean {
  return PUBLIC_PROJECT_STATUSES.some(
    (publicStatus) => publicStatus === status,
  );
}

/*
  辅助函数：处理内容中的图片并提取引用关系
*/
async function processContentImagesAndExtractReferences(
  content: string,
  prismaClient: typeof prisma,
): Promise<{ processedContent: string; mediaIds: number[] }> {
  let processedContent = content;
  const mediaIds = new Set<number>();

  // 1. 提取所有已存在的 /p/ 链接
  const shortLinkRegex = /\/p\/([a-zA-Z0-9_-]{12})/g;
  const shortLinkMatches = [...content.matchAll(shortLinkRegex)];

  // 2. 提取所有可能的图片 URL
  const urlRegex =
    /https?:\/\/[^\s<>"{}|\\^`[\]]+?\.(jpg|jpeg|png|gif|webp|avif|svg|bmp|tiff|ico)/gi;
  const urlMatches = [...content.matchAll(urlRegex)];

  // 3. 批量查询数据库中的媒体
  const urlsToCheck = urlMatches.map((m) => m[0]);
  const shortHashesToCheck = shortLinkMatches.map((m) => m[1]!.substring(0, 8));

  const [mediaByUrl, mediaByShortHash] = await Promise.all([
    urlsToCheck.length > 0
      ? prismaClient.media.findMany({
          where: { storageUrl: { in: urlsToCheck } },
          select: { id: true, storageUrl: true, shortHash: true },
        })
      : Promise.resolve([]),
    shortHashesToCheck.length > 0
      ? prismaClient.media.findMany({
          where: { shortHash: { in: shortHashesToCheck } },
          select: { id: true, shortHash: true },
        })
      : Promise.resolve([]),
  ]);

  // 4. 替换存储源 URL 为 /p/ 格式
  for (const media of mediaByUrl) {
    if (media.storageUrl && media.shortHash) {
      const signature = generateSignature(media.shortHash);
      const shortLink = `/p/${media.shortHash}${signature}`;
      processedContent = processedContent.replaceAll(
        media.storageUrl,
        shortLink,
      );
      mediaIds.add(media.id);
    }
  }

  // 5. 收集所有 /p/ 格式的图片 ID
  for (const media of mediaByShortHash) {
    mediaIds.add(media.id);
  }

  return {
    processedContent,
    mediaIds: Array.from(mediaIds),
  };
}

/*
  辅助函数：根据路径查找或创建分类
*/
async function findOrCreateCategoryByPath(
  categoryPath: string,
): Promise<number> {
  const parts = categoryPath
    .split("/")
    .map((p) => p.trim())
    .filter((p) => p);

  if (parts.length === 0) {
    throw new Error("Invalid category path");
  }

  let currentParentId: number | null = null;
  let currentParentPath = "";
  let currentParentDepth = -1;
  let currentParentFullSlug = "";
  let currentCategoryId: number | null = null;
  type CategoryPathNode = {
    id: number;
    slug: string;
    path: string;
    depth: number;
    fullSlug: string;
  };

  for (const name of parts) {
    let category: CategoryPathNode | null = (await prisma.category.findFirst({
      where: {
        name,
        parentId: currentParentId,
      },
      select: {
        id: true,
        slug: true,
        path: true,
        depth: true,
        fullSlug: true,
      },
    })) as CategoryPathNode | null;

    if (!category) {
      const slug = await slugify(name);
      const depth = currentParentDepth + 1;
      const fullSlug = currentParentFullSlug
        ? `${currentParentFullSlug}/${slug}`
        : slug;

      const createdCategory: CategoryPathNode = (await prisma.category.create({
        data: {
          name,
          slug,
          parentId: currentParentId,
          path: "",
          depth,
          fullSlug,
        },
        select: {
          id: true,
          slug: true,
          path: true,
          depth: true,
          fullSlug: true,
        },
      })) as CategoryPathNode;

      const correctPath = currentParentPath
        ? `${currentParentPath}/${createdCategory.id}`
        : `${createdCategory.id}`;

      category = (await prisma.category.update({
        where: { id: createdCategory.id },
        data: { path: correctPath },
        select: {
          id: true,
          slug: true,
          path: true,
          depth: true,
          fullSlug: true,
        },
      })) as CategoryPathNode;
    } else {
      const expectedPath: string = currentParentPath
        ? `${currentParentPath}/${category.id}`
        : `${category.id}`;
      const expectedDepth = currentParentDepth + 1;
      const expectedFullSlug: string = currentParentFullSlug
        ? `${currentParentFullSlug}/${category.slug}`
        : category.slug;

      if (
        category.path !== expectedPath ||
        category.depth !== expectedDepth ||
        category.fullSlug !== expectedFullSlug
      ) {
        category = (await prisma.category.update({
          where: { id: category.id },
          data: {
            path: expectedPath,
            depth: expectedDepth,
            fullSlug: expectedFullSlug,
          },
          select: {
            id: true,
            slug: true,
            path: true,
            depth: true,
            fullSlug: true,
          },
        })) as CategoryPathNode;
      }
    }

    currentCategoryId = category.id;
    currentParentId = category.id;
    currentParentPath = category.path;
    currentParentDepth = category.depth;
    currentParentFullSlug = category.fullSlug;
  }

  if (currentCategoryId === null) {
    throw new Error("Failed to create category");
  }

  return currentCategoryId;
}

/*
  辅助函数：获取或创建"未分类"分类
*/
async function getOrCreateUncategorizedCategory(): Promise<number> {
  const uncategorizedName = "未分类";
  const uncategorizedSlug = "uncategorized";

  let category = await prisma.category.findFirst({
    where: {
      slug: uncategorizedSlug,
      parentId: null,
    },
    select: {
      id: true,
      path: true,
      depth: true,
      fullSlug: true,
    },
  });

  if (!category) {
    const createdCategory = await prisma.category.create({
      data: {
        name: uncategorizedName,
        slug: uncategorizedSlug,
        description: "自动分配给未指定分类的内容",
        parentId: null,
        path: "",
        depth: 0,
        fullSlug: uncategorizedSlug,
      },
      select: {
        id: true,
        path: true,
        depth: true,
        fullSlug: true,
      },
    });

    category = await prisma.category.update({
      where: { id: createdCategory.id },
      data: { path: `${createdCategory.id}` },
      select: {
        id: true,
        path: true,
        depth: true,
        fullSlug: true,
      },
    });
  } else {
    const expectedPath = `${category.id}`;
    if (
      category.path !== expectedPath ||
      category.depth !== 0 ||
      category.fullSlug !== uncategorizedSlug
    ) {
      category = await prisma.category.update({
        where: { id: category.id },
        data: {
          path: expectedPath,
          depth: 0,
          fullSlug: uncategorizedSlug,
        },
        select: {
          id: true,
          path: true,
          depth: true,
          fullSlug: true,
        },
      });
    }
  }

  return category.id;
}

type ActionEnvironment = "serverless" | "serveraction";
type ActionConfig = { environment?: ActionEnvironment };
type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

interface ProjectTagRelation {
  slug: string;
}

interface ProjectCategoryRelation {
  fullSlug: string;
}

interface ProjectCacheRelationInput {
  tags?: readonly ProjectTagRelation[];
  categories?: readonly ProjectCategoryRelation[];
}

function addProjectTagSlug(
  target: Set<string>,
  slug: string | null | undefined,
): void {
  if (slug) {
    target.add(slug);
  }
}

function addProjectCategoryPathTags(
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

function collectProjectRelatedCacheTags(
  tagSlugs: Set<string>,
  categoryPaths: Set<string>,
  project: ProjectCacheRelationInput,
): void {
  for (const tag of project.tags ?? []) {
    addProjectTagSlug(tagSlugs, tag.slug);
  }

  for (const category of project.categories ?? []) {
    addProjectCategoryPathTags(categoryPaths, category.fullSlug);
  }
}

function updateProjectCacheTagsBySlugs(slugs: Iterable<string>): void {
  for (const slug of slugs) {
    updateTag(`projects/${slug}`);
  }
}

function updateTagCacheTagsBySlugs(slugs: Iterable<string>): void {
  for (const slug of slugs) {
    updateTag(`tags/${slug}`);
  }
}

function updateCategoryCacheTagsByPaths(paths: Iterable<string>): void {
  for (const path of paths) {
    updateTag(`categories/${path}`);
  }
}

/*
  辅助函数：从 GitHub API 获取仓库信息
  用于自动填充 description 和 startedAt
*/
async function fetchGithubRepoInfo(
  repoPath: string,
  githubToken?: string | null,
): Promise<{
  description: string | null;
  createdAt: string | null;
  error?: string;
}> {
  try {
    // 校验 repoPath 格式：必须为 owner/repo，且只包含合法字符
    if (!/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(repoPath)) {
      return {
        description: null,
        createdAt: null,
        error: "仓库路径格式不正确，应为 owner/repo",
      };
    }
    const [owner, repo] = repoPath.split("/");
    if (!owner || !repo) {
      return {
        description: null,
        createdAt: null,
        error: "仓库路径格式不正确",
      };
    }

    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "NeutralPress-CMS",
    };

    if (githubToken) {
      headers.Authorization = `Bearer ${githubToken}`;
    }

    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}`,
      { headers },
    );

    if (!response.ok) {
      return {
        description: null,
        createdAt: null,
        error: `GitHub API 错误: ${response.status}`,
      };
    }

    const data = await response.json();

    return {
      description: data.description || null,
      createdAt: data.created_at || null,
    };
  } catch (error) {
    console.error("Fetch GitHub repo info error:", error);
    return {
      description: null,
      createdAt: null,
      error: error instanceof Error ? error.message : "未知错误",
    };
  }
}

/*
  辅助函数：执行单个项目的 GitHub 同步
  返回同步结果
*/
async function syncSingleProjectGithub(
  projectId: number,
  repoPath: string,
  enableConentSync: boolean,
  githubToken?: string | null,
): Promise<{
  success: boolean;
  error?: string;
  stars?: number;
  forks?: number;
}> {
  try {
    // 校验 repoPath 格式
    if (!/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(repoPath)) {
      return { success: false, error: "仓库路径格式不正确，应为 owner/repo" };
    }
    const [owner, repo] = repoPath.split("/");
    if (!owner || !repo) {
      return { success: false, error: "仓库路径格式不正确" };
    }

    const apiHeaders: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "NeutralPress-CMS",
    };

    if (githubToken) {
      apiHeaders.Authorization = `Bearer ${githubToken}`;
    }

    // 获取仓库信息
    const repoResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}`,
      { headers: apiHeaders },
    );

    if (!repoResponse.ok) {
      return {
        success: false,
        error: `GitHub API 错误: ${repoResponse.status} ${repoResponse.statusText}`,
      };
    }

    const repoData = await repoResponse.json();

    // 获取语言信息
    const languagesResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/languages`,
      { headers: apiHeaders },
    );

    let languages: Record<string, number> | null = null;
    if (languagesResponse.ok) {
      languages = await languagesResponse.json();
    }

    // 准备更新数据
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = {
      stars: repoData.stargazers_count || 0,
      forks: repoData.forks_count || 0,
      languages,
      license: repoData.license?.spdx_id || null,
    };

    // 如果启用了内容同步，获取 README
    if (enableConentSync) {
      const readmeResponse = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/readme`,
        {
          headers: {
            ...apiHeaders,
            Accept: "application/vnd.github.v3.raw",
          },
        },
      );

      if (readmeResponse.ok) {
        const readmeContent = await readmeResponse.text();
        updateData.content = readmeContent;
      }
    }

    // 更新项目
    await prisma.project.update({
      where: { id: projectId, deletedAt: null },
      data: updateData,
    });

    return {
      success: true,
      stars: updateData.stars,
      forks: updateData.forks,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "未知错误",
    };
  }
}

/*
  getProjectsTrends - 获取项目趋势数据
*/
export async function getProjectsTrends(
  params: GetProjectsTrends,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<ProjectTrendItem[] | null>>>;
export async function getProjectsTrends(
  params: GetProjectsTrends,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<ProjectTrendItem[] | null>>;
export async function getProjectsTrends(
  { access_token, days = 365, count = 30 }: GetProjectsTrends,
  serverConfig?: ActionConfig,
): Promise<ActionResult<ProjectTrendItem[] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getProjectsTrends"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      days,
      count,
    },
    GetProjectsTrendsSchema,
  );

  if (validationError) return response.badRequest(validationError);

  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR", "AUTHOR"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    const now = new Date();
    const daysAgo = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    const recentProjects = await prisma.project.findMany({
      where: {
        deletedAt: null,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: count,
      select: {
        createdAt: true,
      },
    });

    let startDate = daysAgo;
    if (recentProjects.length === count) {
      const oldestRecentProject = recentProjects[recentProjects.length - 1];
      if (oldestRecentProject && oldestRecentProject.createdAt < daysAgo) {
        startDate = oldestRecentProject.createdAt;
      }
    }

    const actualDays = Math.ceil(
      (now.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000),
    );

    const datePoints: Date[] = [];
    for (let i = 0; i <= actualDays; i++) {
      datePoints.push(new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000));
    }

    const allTrendData: ProjectTrendItem[] = await Promise.all(
      datePoints.map(async (date, index) => {
        const prevDate =
          index > 0
            ? datePoints[index - 1]
            : new Date(date.getTime() - 24 * 60 * 60 * 1000);

        const [totalProjects, myProjects, newProjects] = await Promise.all([
          prisma.project.count({
            where: {
              createdAt: { lte: date },
              deletedAt: null,
            },
          }),
          prisma.project.count({
            where: {
              createdAt: { lte: date },
              userUid: user.uid,
              deletedAt: null,
            },
          }),
          prisma.project.count({
            where: {
              createdAt: {
                gt: prevDate,
                lte: date,
              },
              deletedAt: null,
            },
          }),
        ]);

        return {
          time: date.toISOString(),
          data: {
            total: totalProjects,
            personal: myProjects,
            new: newProjects,
          },
        };
      }),
    );

    return response.ok({ data: allTrendData });
  } catch (error) {
    console.error("Get projects trends error:", error);
    return response.serverError();
  }
}

/*
  getProjectsList - 获取项目列表
*/
export async function getProjectsList(
  params: GetProjectsList,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<ProjectListItem[] | null>>>;
export async function getProjectsList(
  params: GetProjectsList,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<ProjectListItem[] | null>>;
export async function getProjectsList(
  {
    access_token,
    page = 1,
    pageSize = 25,
    sortBy = "id",
    sortOrder = "desc",
    status,
    search,
    id,
    authorUid,
    enableGithubSync,
    isFeatured,
    publishedAtStart,
    publishedAtEnd,
    updatedAtStart,
    updatedAtEnd,
    createdAtStart,
    createdAtEnd,
  }: GetProjectsList,
  serverConfig?: ActionConfig,
): Promise<ActionResult<ProjectListItem[] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getProjectsList"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      page,
      pageSize,
      sortBy,
      sortOrder,
      status,
      search,
      id,
      authorUid,
      enableGithubSync,
      isFeatured,
      publishedAtStart,
      publishedAtEnd,
      updatedAtStart,
      updatedAtEnd,
      createdAtStart,
      createdAtEnd,
    },
    GetProjectsListSchema,
  );

  if (validationError) return response.badRequest(validationError);

  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR", "AUTHOR"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    const skip = (page - 1) * pageSize;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
      deletedAt: null,
    };

    // AUTHOR 只能查看自己的项目
    if (user.role === "AUTHOR") {
      where.userUid = user.uid;
    } else if (authorUid !== undefined) {
      where.userUid = authorUid;
    }

    if (id !== undefined) {
      where.id = id;
    }

    if (status && status.length > 0) {
      where.status = { in: status };
    }

    if (enableGithubSync && enableGithubSync.length === 1) {
      where.enableGithubSync = enableGithubSync[0];
    }

    if (isFeatured !== undefined) {
      where.isFeatured = isFeatured;
    }

    if (publishedAtStart || publishedAtEnd) {
      where.publishedAt = {};
      if (publishedAtStart) where.publishedAt.gte = new Date(publishedAtStart);
      if (publishedAtEnd) where.publishedAt.lte = new Date(publishedAtEnd);
    }

    if (updatedAtStart || updatedAtEnd) {
      where.updatedAt = {};
      if (updatedAtStart) where.updatedAt.gte = new Date(updatedAtStart);
      if (updatedAtEnd) where.updatedAt.lte = new Date(updatedAtEnd);
    }

    if (createdAtStart || createdAtEnd) {
      where.createdAt = {};
      if (createdAtStart) where.createdAt.gte = new Date(createdAtStart);
      if (createdAtEnd) where.createdAt.lte = new Date(createdAtEnd);
    }

    if (search && search.trim()) {
      where.OR = [
        { title: { contains: search.trim(), mode: "insensitive" } },
        { slug: { contains: search.trim(), mode: "insensitive" } },
        { description: { contains: search.trim(), mode: "insensitive" } },
      ];
    }

    const total = await prisma.project.count({ where });

    const orderBy = [{ [sortBy]: sortOrder }];

    const projects = await prisma.project.findMany({
      where,
      skip,
      take: pageSize,
      orderBy,
      select: {
        id: true,
        title: true,
        slug: true,
        description: true,
        status: true,
        demoUrl: true,
        repoUrl: true,
        urls: true,
        techStack: true,
        repoPath: true,
        stars: true,
        forks: true,
        languages: true,
        license: true,
        enableGithubSync: true,
        enableConentSync: true,
        isFeatured: true,
        sortOrder: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true,
        startedAt: true,
        completedAt: true,
        author: {
          select: {
            uid: true,
            username: true,
            nickname: true,
          },
        },
        categories: {
          select: {
            name: true,
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
              },
            },
          },
        },
      },
    });

    const data: ProjectListItem[] = projects.map((project) => ({
      id: project.id,
      title: project.title,
      slug: project.slug,
      description: project.description,
      status: project.status,
      demoUrl: project.demoUrl,
      repoUrl: project.repoUrl,
      urls: project.urls,
      techStack: project.techStack as string[] | null,
      repoPath: project.repoPath,
      stars: project.stars,
      forks: project.forks,
      languages: project.languages as Record<string, number> | null,
      license: project.license,
      enableGithubSync: project.enableGithubSync,
      enableConentSync: project.enableConentSync,
      isFeatured: project.isFeatured,
      sortOrder: project.sortOrder,
      publishedAt: project.publishedAt?.toISOString() || null,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      startedAt: project.startedAt?.toISOString() || null,
      completedAt: project.completedAt?.toISOString() || null,
      featuredImage: getFeaturedImageUrl(project.mediaRefs),
      featuredImages: getAllFeaturedImageUrls(project.mediaRefs),
      author: {
        uid: project.author.uid,
        username: project.author.username,
        nickname: project.author.nickname,
      },
      categories: project.categories.map((cat) => cat.name),
      tags: project.tags.map((tag) => ({ name: tag.name, slug: tag.slug })),
    }));

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
      data,
      meta,
    });
  } catch (error) {
    console.error("Get projects list error:", error);
    return response.serverError();
  }
}

/*
  getProjectDetail - 获取项目详情
*/
export async function getProjectDetail(
  params: GetProjectDetail,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<ProjectDetail | null>>>;
export async function getProjectDetail(
  params: GetProjectDetail,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<ProjectDetail | null>>;
export async function getProjectDetail(
  { access_token, slug }: GetProjectDetail,
  serverConfig?: ActionConfig,
): Promise<ActionResult<ProjectDetail | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getProjectDetail"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      slug,
    },
    GetProjectDetailSchema,
  );

  if (validationError) return response.badRequest(validationError);

  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR", "AUTHOR"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    const project = await prisma.project.findUnique({
      where: {
        slug,
        deletedAt: null,
      },
      select: {
        id: true,
        title: true,
        slug: true,
        description: true,
        content: true,
        status: true,
        demoUrl: true,
        repoUrl: true,
        urls: true,
        techStack: true,
        repoPath: true,
        stars: true,
        forks: true,
        languages: true,
        license: true,
        enableGithubSync: true,
        enableConentSync: true,
        isFeatured: true,
        sortOrder: true,
        metaDescription: true,
        metaKeywords: true,
        robotsIndex: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true,
        startedAt: true,
        completedAt: true,
        userUid: true,
        author: {
          select: {
            uid: true,
            username: true,
            nickname: true,
          },
        },
        categories: {
          select: {
            name: true,
          },
        },
        tags: {
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

    if (!project) {
      return response.notFound({ message: "项目不存在" });
    }

    // AUTHOR 只能查看自己的项目
    if (user.role === "AUTHOR" && project.userUid !== user.uid) {
      return response.forbidden({ message: "无权访问此项目" });
    }

    const data: ProjectDetail = {
      id: project.id,
      title: project.title,
      slug: project.slug,
      description: project.description,
      content: project.content,
      status: project.status,
      demoUrl: project.demoUrl,
      repoUrl: project.repoUrl,
      urls: project.urls,
      techStack: project.techStack as string[] | null,
      repoPath: project.repoPath,
      stars: project.stars,
      forks: project.forks,
      languages: project.languages as Record<string, number> | null,
      license: project.license,
      enableGithubSync: project.enableGithubSync,
      enableConentSync: project.enableConentSync,
      isFeatured: project.isFeatured,
      sortOrder: project.sortOrder,
      metaDescription: project.metaDescription,
      metaKeywords: project.metaKeywords,
      robotsIndex: project.robotsIndex,
      publishedAt: project.publishedAt?.toISOString() || null,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      startedAt: project.startedAt?.toISOString() || null,
      completedAt: project.completedAt?.toISOString() || null,
      featuredImage: getFeaturedImageUrl(project.mediaRefs),
      featuredImages: getAllFeaturedImageUrls(project.mediaRefs),
      author: {
        uid: project.author.uid,
        username: project.author.username,
        nickname: project.author.nickname,
      },
      categories: project.categories.map((cat) => cat.name),
      tags: project.tags.map((tag) => tag.name),
    };

    return response.ok({ data });
  } catch (error) {
    console.error("Get project detail error:", error);
    return response.serverError();
  }
}

/*
  createProject - 创建项目
*/
export async function createProject(
  params: CreateProject,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CreateProjectResult | null>>>;
export async function createProject(
  params: CreateProject,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CreateProjectResult | null>>;
export async function createProject(
  {
    access_token,
    title,
    slug: inputSlug,
    description,
    content,
    demoUrl,
    repoUrl,
    urls,
    techStack,
    repoPath,
    license,
    enableGithubSync = false,
    enableConentSync = false,
    syncImmediately = false,
    status = "DRAFT",
    isFeatured = false,
    sortOrder = 0,
    metaDescription,
    metaKeywords,
    robotsIndex = true,
    categories,
    tags,
    featuredImage,
    featuredImages,
    publishedAt,
    startedAt,
    completedAt,
  }: CreateProject,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CreateProjectResult | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "createProject"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      title,
      slug: inputSlug,
      description,
      content,
      demoUrl,
      repoUrl,
      urls,
      techStack,
      repoPath,
      license,
      enableGithubSync,
      enableConentSync,
      syncImmediately,
      status,
      isFeatured,
      sortOrder,
      metaDescription,
      metaKeywords,
      robotsIndex,
      categories,
      tags,
      featuredImage,
      featuredImages,
      publishedAt,
      startedAt,
      completedAt,
    },
    CreateProjectSchema,
  );

  if (validationError) return response.badRequest(validationError);

  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR", "AUTHOR"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    // 生成 slug
    const slug = inputSlug || (await slugify(title));

    // 检查 slug 是否已存在
    const existingProject = await prisma.project.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (existingProject) {
      return response.badRequest({
        message: "该 slug 已被使用",
      });
    }

    // 获取 GitHub Token
    const githubToken = await getConfig("content.githubAutoSync.personalKey");

    // 如果有 repoPath，尝试从 GitHub 获取缺失的 description 和 startedAt
    let finalDescription = description;
    let finalStartedAt = startedAt;

    if (repoPath && (!description || !startedAt)) {
      const githubInfo = await fetchGithubRepoInfo(repoPath, githubToken);

      if (!description && githubInfo.description) {
        finalDescription = githubInfo.description;
      }

      if (!startedAt && githubInfo.createdAt) {
        finalStartedAt = githubInfo.createdAt;
      }
    }

    // 如果没有 description，使用默认值
    if (!finalDescription) {
      finalDescription = title;
    }

    // 处理内容图片
    let processedContent = content || "";
    let contentMediaIds: number[] = [];

    if (content) {
      const result = await processContentImagesAndExtractReferences(
        content,
        prisma,
      );
      processedContent = result.processedContent;
      contentMediaIds = result.mediaIds;
    }

    // 处理分类
    let categoryConnections: { connect: { id: number }[] } | undefined;
    if (categories && categories.length > 0) {
      categoryConnections = {
        connect: await Promise.all(
          categories.map(async (categoryPath: string) => ({
            id: await findOrCreateCategoryByPath(categoryPath),
          })),
        ),
      };
    } else {
      const uncategorizedId = await getOrCreateUncategorizedCategory();
      categoryConnections = { connect: [{ id: uncategorizedId }] };
    }

    // 处理标签
    let tagConnections:
      | {
          connectOrCreate: {
            where: { name: string };
            create: { name: string; slug: string };
          }[];
        }
      | undefined;
    if (tags && tags.length > 0) {
      tagConnections = {
        connectOrCreate: await Promise.all(
          tags.map(async (tagName: string) => ({
            where: { name: tagName },
            create: {
              name: tagName,
              slug: await slugify(tagName),
            },
          })),
        ),
      };
    }

    // 创建项目
    const project = await prisma.project.create({
      data: {
        title,
        slug,
        description: finalDescription,
        content: processedContent || null,
        demoUrl: demoUrl || null,
        repoUrl: repoUrl || null,
        urls: urls || [],
        techStack: techStack && techStack.length > 0 ? techStack : undefined,
        repoPath: repoPath || null,
        license: license || null,
        enableGithubSync,
        enableConentSync,
        status,
        isFeatured,
        sortOrder,
        metaDescription: metaDescription || null,
        metaKeywords: metaKeywords || null,
        robotsIndex,
        publishedAt: publishedAt
          ? new Date(publishedAt)
          : status === "PUBLISHED"
            ? new Date()
            : null,
        startedAt: finalStartedAt ? new Date(finalStartedAt) : null,
        completedAt: completedAt ? new Date(completedAt) : null,
        userUid: user.uid,
        categories: categoryConnections,
        tags: tagConnections,
      },
      select: {
        id: true,
        slug: true,
        status: true,
        tags: {
          select: {
            slug: true,
          },
        },
        categories: {
          select: {
            fullSlug: true,
          },
        },
      },
    });

    // 处理媒体引用
    const mediaRefsData: Array<{ mediaId: number; slot: string }> = [];

    // 处理特色图片 - 支持多张
    const allFeaturedImages =
      featuredImages && featuredImages.length > 0
        ? featuredImages
        : featuredImage
          ? [featuredImage]
          : [];

    for (const imageUrl of allFeaturedImages) {
      const mediaId = await findMediaIdByUrl(prisma, imageUrl);
      if (mediaId) {
        mediaRefsData.push({
          mediaId,
          slot: MEDIA_SLOTS.PROJECT_FEATURED_IMAGE,
        });
      }
    }

    // 处理内容图片
    for (const mediaId of contentMediaIds) {
      mediaRefsData.push({
        mediaId,
        slot: MEDIA_SLOTS.PROJECT_CONTENT_IMAGE,
      });
    }

    // 批量创建媒体引用
    if (mediaRefsData.length > 0) {
      await prisma.mediaReference.createMany({
        data: mediaRefsData.map((ref) => ({
          mediaId: ref.mediaId,
          projectId: project.id,
          slot: ref.slot,
        })),
      });
    }

    // 如果开启了 GitHub 同步并且需要立即同步
    let syncResult:
      | {
          success: boolean;
          error?: string;
          stars?: number;
          forks?: number;
        }
      | undefined;

    if (syncImmediately && enableGithubSync && repoPath) {
      syncResult = await syncSingleProjectGithub(
        project.id,
        repoPath,
        enableConentSync,
        githubToken,
      );
    }

    // 更新缓存标签
    updateProjectCacheTagsBySlugs([project.slug]);
    if (isPublicProjectStatus(project.status)) {
      updateTag("projects/list");
    }

    if (project.status === "PUBLISHED") {
      const tagDetailTagsToRefresh = new Set<string>();
      const categoryDetailTagsToRefresh = new Set<string>();
      collectProjectRelatedCacheTags(
        tagDetailTagsToRefresh,
        categoryDetailTagsToRefresh,
        project,
      );
      updateTagCacheTagsBySlugs(tagDetailTagsToRefresh);
      updateCategoryCacheTagsByPaths(categoryDetailTagsToRefresh);
      updateTag("tags/list");
      updateTag("categories/list");
    }

    // 审计日志
    const { after } = await import("next/server");
    after(async () => {
      await logAuditEvent({
        user: { uid: String(user.uid) },
        details: {
          action: "CREATE",
          resourceType: "PROJECT",
          resourceId: String(project.id),
          value: { old: null, new: { title, slug, status } },
          description: `创建项目: ${title}`,
          metadata: {
            slug,
            status,
            syncImmediately,
            ...(syncResult ? { syncSuccess: syncResult.success } : {}),
          },
        },
      });
    });

    return response.ok({
      data: {
        id: project.id,
        slug: project.slug,
        syncResult,
      },
    });
  } catch (error) {
    console.error("Create project error:", error);
    return response.serverError();
  }
}

/*
  updateProject - 更新单个项目
*/
export async function updateProject(
  params: UpdateProject,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<UpdateProjectResult | null>>>;
export async function updateProject(
  params: UpdateProject,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<UpdateProjectResult | null>>;
export async function updateProject(
  {
    access_token,
    slug,
    title,
    newSlug,
    description,
    content,
    demoUrl,
    repoUrl,
    urls,
    techStack,
    repoPath,
    license,
    enableGithubSync,
    enableConentSync,
    status,
    isFeatured,
    sortOrder,
    metaDescription,
    metaKeywords,
    robotsIndex,
    categories,
    tags,
    featuredImage,
    featuredImages,
    publishedAt,
    startedAt,
    completedAt,
  }: UpdateProject,
  serverConfig?: ActionConfig,
): Promise<ActionResult<UpdateProjectResult | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "updateProject"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      slug,
      title,
      newSlug,
      description,
      content,
      demoUrl,
      repoUrl,
      urls,
      techStack,
      repoPath,
      license,
      enableGithubSync,
      enableConentSync,
      status,
      isFeatured,
      sortOrder,
      metaDescription,
      metaKeywords,
      robotsIndex,
      categories,
      tags,
      featuredImage,
      featuredImages,
      publishedAt,
      startedAt,
      completedAt,
    },
    UpdateProjectSchema,
  );

  if (validationError) return response.badRequest(validationError);

  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR", "AUTHOR"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    // 查找项目
    const existingProject = await prisma.project.findUnique({
      where: { slug, deletedAt: null },
      include: {
        categories: { select: { name: true, fullSlug: true } },
        tags: { select: { name: true, slug: true } },
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

    if (!existingProject) {
      return response.notFound({ message: "项目不存在" });
    }

    // AUTHOR 只能编辑自己的项目
    if (user.role === "AUTHOR" && existingProject.userUid !== user.uid) {
      return response.forbidden({ message: "无权编辑此项目" });
    }

    // 检查新 slug 是否已被使用
    if (newSlug && newSlug !== slug) {
      const slugExists = await prisma.project.findUnique({
        where: { slug: newSlug },
        select: { id: true },
      });

      if (slugExists) {
        return response.badRequest({
          message: "该 slug 已被使用",
        });
      }
    }

    // 构建更新数据
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = {};

    if (title !== undefined) updateData.title = title;
    if (newSlug !== undefined) updateData.slug = newSlug;
    if (description !== undefined) updateData.description = description;
    if (demoUrl !== undefined) updateData.demoUrl = demoUrl || null;
    if (repoUrl !== undefined) updateData.repoUrl = repoUrl || null;
    if (urls !== undefined) updateData.urls = urls || [];
    if (techStack !== undefined) updateData.techStack = techStack;
    if (repoPath !== undefined) updateData.repoPath = repoPath;
    if (license !== undefined) updateData.license = license || null;
    if (enableGithubSync !== undefined)
      updateData.enableGithubSync = enableGithubSync;
    if (enableConentSync !== undefined)
      updateData.enableConentSync = enableConentSync;
    if (isFeatured !== undefined) updateData.isFeatured = isFeatured;
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder;
    if (metaDescription !== undefined)
      updateData.metaDescription = metaDescription || null;
    if (metaKeywords !== undefined)
      updateData.metaKeywords = metaKeywords || null;
    if (robotsIndex !== undefined) updateData.robotsIndex = robotsIndex;
    if (startedAt !== undefined)
      updateData.startedAt = startedAt ? new Date(startedAt) : null;
    if (completedAt !== undefined)
      updateData.completedAt = completedAt ? new Date(completedAt) : null;

    // 处理状态和发布时间
    if (status !== undefined) {
      updateData.status = status;
      if (status === "PUBLISHED" && !existingProject.publishedAt) {
        updateData.publishedAt = publishedAt
          ? new Date(publishedAt)
          : new Date();
      } else if (publishedAt !== undefined) {
        updateData.publishedAt = new Date(publishedAt);
      }
    }

    // 处理内容
    let contentMediaIds: number[] = [];
    if (content !== undefined) {
      const result = await processContentImagesAndExtractReferences(
        content,
        prisma,
      );
      updateData.content = result.processedContent;
      contentMediaIds = result.mediaIds;
    }

    // 处理分类
    if (categories !== undefined) {
      if (categories.length > 0) {
        updateData.categories = {
          set: [],
          connect: await Promise.all(
            categories.map(async (categoryPath: string) => ({
              id: await findOrCreateCategoryByPath(categoryPath),
            })),
          ),
        };
      } else {
        const uncategorizedId = await getOrCreateUncategorizedCategory();
        updateData.categories = {
          set: [],
          connect: [{ id: uncategorizedId }],
        };
      }
    }

    // 处理标签
    if (tags !== undefined) {
      updateData.tags = {
        set: [],
        connectOrCreate: await Promise.all(
          tags.map(async (tagName: string) => ({
            where: { name: tagName },
            create: {
              name: tagName,
              slug: await slugify(tagName),
            },
          })),
        ),
      };
    }

    // 更新项目
    const updatedProject = await prisma.project.update({
      where: { slug, deletedAt: null },
      data: updateData,
      select: {
        id: true,
        slug: true,
        status: true,
        categories: {
          select: {
            fullSlug: true,
          },
        },
        tags: {
          select: {
            slug: true,
          },
        },
      },
    });

    // 更新媒体引用
    if (
      featuredImage !== undefined ||
      featuredImages !== undefined ||
      content !== undefined
    ) {
      // 删除旧的媒体引用
      await prisma.mediaReference.deleteMany({
        where: { projectId: updatedProject.id },
      });

      const mediaRefsData: Array<{ mediaId: number; slot: string }> = [];

      // 处理特色图片 - 支持多张
      const allFeaturedImages =
        featuredImages && featuredImages.length > 0
          ? featuredImages
          : featuredImage
            ? [featuredImage]
            : (existingProject.mediaRefs
                .filter(
                  (ref) => ref.slot === MEDIA_SLOTS.PROJECT_FEATURED_IMAGE,
                )
                .map((ref) => ref.media?.shortHash)
                .filter(Boolean) as string[]);

      for (const imageUrl of allFeaturedImages) {
        const mediaId = await findMediaIdByUrl(prisma, imageUrl);
        if (mediaId) {
          mediaRefsData.push({
            mediaId,
            slot: MEDIA_SLOTS.PROJECT_FEATURED_IMAGE,
          });
        }
      }

      // 处理内容图片
      for (const mediaId of contentMediaIds) {
        mediaRefsData.push({
          mediaId,
          slot: MEDIA_SLOTS.PROJECT_CONTENT_IMAGE,
        });
      }

      if (mediaRefsData.length > 0) {
        await prisma.mediaReference.createMany({
          data: mediaRefsData.map((ref) => ({
            mediaId: ref.mediaId,
            projectId: updatedProject.id,
            slot: ref.slot,
          })),
        });
      }
    }

    // 更新缓存标签
    const projectDetailTagsToRefresh = new Set<string>();
    addProjectTagSlug(projectDetailTagsToRefresh, slug);
    addProjectTagSlug(projectDetailTagsToRefresh, updatedProject.slug);
    updateProjectCacheTagsBySlugs(projectDetailTagsToRefresh);

    const tagDetailTagsToRefresh = new Set<string>();
    const categoryDetailTagsToRefresh = new Set<string>();
    collectProjectRelatedCacheTags(
      tagDetailTagsToRefresh,
      categoryDetailTagsToRefresh,
      existingProject,
    );
    collectProjectRelatedCacheTags(
      tagDetailTagsToRefresh,
      categoryDetailTagsToRefresh,
      updatedProject,
    );
    updateTagCacheTagsBySlugs(tagDetailTagsToRefresh);
    updateCategoryCacheTagsByPaths(categoryDetailTagsToRefresh);

    const wasPublic = isPublicProjectStatus(existingProject.status);
    const isPublic = isPublicProjectStatus(updatedProject.status);
    if (wasPublic || isPublic) {
      updateTag("projects/list");
    }

    if (
      (tags !== undefined ||
        categories !== undefined ||
        status !== undefined) &&
      (wasPublic || isPublic)
    ) {
      updateTag("tags/list");
      updateTag("categories/list");
    }

    // 审计日志
    const { after } = await import("next/server");
    after(async () => {
      await logAuditEvent({
        user: { uid: String(user.uid) },
        details: {
          action: "UPDATE",
          resourceType: "PROJECT",
          resourceId: String(updatedProject.id),
          value: {
            old: { title: existingProject.title, slug: existingProject.slug },
            new: {
              title: title || existingProject.title,
              slug: updatedProject.slug,
            },
          },
          description: `更新项目: ${title || existingProject.title}`,
          metadata: {
            slug: updatedProject.slug,
          },
        },
      });
    });

    return response.ok({
      data: {
        id: updatedProject.id,
        slug: updatedProject.slug,
      },
    });
  } catch (error) {
    console.error("Update project error:", error);
    return response.serverError();
  }
}

/*
  updateProjects - 批量更新项目
*/
export async function updateProjects(
  params: UpdateProjects,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<{ updated: number } | null>>>;
export async function updateProjects(
  params: UpdateProjects,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<{ updated: number } | null>>;
export async function updateProjects(
  {
    access_token,
    ids,
    status,
    enableGithubSync,
    enableConentSync,
  }: UpdateProjects,
  serverConfig?: ActionConfig,
): Promise<ActionResult<{ updated: number } | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "updateProjects"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      ids,
      status,
      enableGithubSync,
      enableConentSync,
    },
    UpdateProjectsSchema,
  );

  if (validationError) return response.badRequest(validationError);

  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR", "AUTHOR"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    // 构建 where 条件
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
      id: { in: ids },
      deletedAt: null,
    };

    // AUTHOR 只能更新自己的项目
    if (user.role === "AUTHOR") {
      where.userUid = user.uid;
    }

    // 构建更新数据
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = {};

    if (status !== undefined) {
      updateData.status = status;
      // 如果状态改为 PUBLISHED，设置发布时间
      if (status === "PUBLISHED") {
        updateData.publishedAt = new Date();
      }
    }

    if (enableGithubSync !== undefined) {
      updateData.enableGithubSync = enableGithubSync;
    }

    if (enableConentSync !== undefined) {
      updateData.enableConentSync = enableConentSync;
    }

    const projectsToUpdate = await prisma.project.findMany({
      where,
      select: {
        slug: true,
        status: true,
        tags: {
          select: {
            slug: true,
          },
        },
        categories: {
          select: {
            fullSlug: true,
          },
        },
      },
    });

    const result = await prisma.project.updateMany({
      where,
      data: updateData,
    });

    // 更新缓存标签
    const projectDetailTagsToRefresh = new Set<string>();
    const tagDetailTagsToRefresh = new Set<string>();
    const categoryDetailTagsToRefresh = new Set<string>();
    for (const project of projectsToUpdate) {
      addProjectTagSlug(projectDetailTagsToRefresh, project.slug);
      collectProjectRelatedCacheTags(
        tagDetailTagsToRefresh,
        categoryDetailTagsToRefresh,
        project,
      );
    }
    updateProjectCacheTagsBySlugs(projectDetailTagsToRefresh);
    if (projectsToUpdate.length > 0) {
      updateTag("projects/list");
    }

    if (status !== undefined) {
      updateTagCacheTagsBySlugs(tagDetailTagsToRefresh);
      updateCategoryCacheTagsByPaths(categoryDetailTagsToRefresh);
      updateTag("tags/list");
      updateTag("categories/list");
    }

    // 审计日志
    const { after } = await import("next/server");
    after(async () => {
      await logAuditEvent({
        user: { uid: String(user.uid) },
        details: {
          action: "BATCH_UPDATE",
          resourceType: "PROJECT",
          resourceId: ids.join(","),
          value: { old: null, new: updateData },
          description: `批量更新 ${result.count} 个项目`,
          metadata: {
            ids: ids.join(","),
            count: result.count,
          },
        },
      });
    });

    return response.ok({
      data: {
        updated: result.count,
      },
    });
  } catch (error) {
    console.error("Update projects error:", error);
    return response.serverError();
  }
}

/*
  deleteProjects - 批量删除项目
*/
export async function deleteProjects(
  params: DeleteProjects,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<{ deleted: number } | null>>>;
export async function deleteProjects(
  params: DeleteProjects,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<{ deleted: number } | null>>;
export async function deleteProjects(
  { access_token, ids }: DeleteProjects,
  serverConfig?: ActionConfig,
): Promise<ActionResult<{ deleted: number } | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "deleteProjects"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      ids,
    },
    DeleteProjectsSchema,
  );

  if (validationError) return response.badRequest(validationError);

  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR", "AUTHOR"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    // 构建 where 条件
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
      id: { in: ids },
      deletedAt: null,
    };

    // AUTHOR 只能删除自己的项目
    if (user.role === "AUTHOR") {
      where.userUid = user.uid;
    }

    // 获取要删除的项目信息（用于审计日志）
    const projectsToDelete = await prisma.project.findMany({
      where,
      select: {
        id: true,
        slug: true,
        title: true,
        status: true,
        tags: {
          select: {
            slug: true,
          },
        },
        categories: {
          select: {
            fullSlug: true,
          },
        },
      },
    });
    // 软删除项目
    const result = await prisma.project.updateMany({
      where,
      data: {
        deletedAt: new Date(),
      },
    });

    // 更新缓存标签
    const projectDetailTagsToRefresh = new Set<string>();
    const tagDetailTagsToRefresh = new Set<string>();
    const categoryDetailTagsToRefresh = new Set<string>();
    for (const project of projectsToDelete) {
      addProjectTagSlug(projectDetailTagsToRefresh, project.slug);
      collectProjectRelatedCacheTags(
        tagDetailTagsToRefresh,
        categoryDetailTagsToRefresh,
        project,
      );
    }
    updateProjectCacheTagsBySlugs(projectDetailTagsToRefresh);

    if (projectsToDelete.length > 0) {
      updateTag("projects/list");
    }

    const hasPublishedDeletion = projectsToDelete.some(
      (project) => project.status === "PUBLISHED",
    );
    if (hasPublishedDeletion) {
      updateTagCacheTagsBySlugs(tagDetailTagsToRefresh);
      updateCategoryCacheTagsByPaths(categoryDetailTagsToRefresh);
      updateTag("tags/list");
      updateTag("categories/list");
    }

    // 审计日志
    const { after } = await import("next/server");
    after(async () => {
      await logAuditEvent({
        user: { uid: String(user.uid) },
        details: {
          action: "DELETE",
          resourceType: "PROJECT",
          resourceId: ids.join(","),
          value: {
            old: projectsToDelete.map((p) => ({
              id: p.id,
              slug: p.slug,
              title: p.title,
            })),
            new: null,
          },
          description: `删除 ${result.count} 个项目`,
          metadata: {
            ids: ids.join(","),
            count: result.count,
          },
        },
      });
    });

    return response.ok({
      data: {
        deleted: result.count,
      },
    });
  } catch (error) {
    console.error("Delete projects error:", error);
    return response.serverError();
  }
}

/*
  syncProjectsGithub - GitHub 同步
*/
export async function syncProjectsGithub(
  params: SyncProjectsGithub,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<SyncProjectsGithubResult | null>>>;
export async function syncProjectsGithub(
  params: SyncProjectsGithub,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<SyncProjectsGithubResult | null>>;
export async function syncProjectsGithub(
  { access_token, ids }: SyncProjectsGithub,
  serverConfig?: ActionConfig,
): Promise<ActionResult<SyncProjectsGithubResult | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "syncProjectsGithub"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      ids,
    },
    SyncProjectsGithubSchema,
  );

  if (validationError) return response.badRequest(validationError);

  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    const syncResult = await runProjectsGithubSync({ ids });
    const synced = syncResult.synced;
    const failed = syncResult.failed;
    const resourceIds = syncResult.results
      .map((item) => item.id)
      .filter((id) => id > 0)
      .join(",");

    // 审计日志
    const { after } = await import("next/server");
    after(async () => {
      await logAuditEvent({
        user: { uid: String(user.uid) },
        details: {
          action: "SYNC",
          resourceType: "PROJECT",
          resourceId: resourceIds || "AUTO",
          value: { old: null, new: { synced, failed } },
          description: `GitHub 同步: ${synced} 成功, ${failed} 失败`,
          metadata: {
            synced,
            failed,
          },
        },
      });
    });

    return response.ok({
      data: {
        synced,
        failed,
        results: syncResult.results,
      },
    });
  } catch (error) {
    console.error("Sync projects github error:", error);
    return response.serverError();
  }
}
