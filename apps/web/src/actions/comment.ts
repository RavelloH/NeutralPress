"use server";

import type {
  CommentHistoryPoint,
  CommentItem,
  CommentListResponse,
  CommentsAdminListResponse,
  CommentStats,
  CommentStatus,
  CreateComment,
  DeleteComments,
  DeleteOwnComment,
  DeleteOwnCommentResponse,
  DirectChildrenResponse,
  GetCommentHistory,
  GetCommentReplies,
  GetCommentsAdmin,
  GetCommentStats,
  GetDirectChildren,
  GetPostComments,
  LikeComment,
  LikeCommentResponse,
  UnlikeComment,
  UnlikeCommentResponse,
  UpdateCommentStatus,
} from "@repo/shared-types/api/comment";
import {
  CreateCommentSchema,
  DeleteCommentsSchema,
  DeleteOwnCommentSchema,
  GetCommentHistorySchema,
  GetCommentRepliesSchema,
  GetCommentsAdminSchema,
  GetCommentStatsSchema,
  GetDirectChildrenSchema,
  GetPostCommentsSchema,
  LikeCommentSchema,
  UnlikeCommentSchema,
  UpdateCommentStatusSchema,
} from "@repo/shared-types/api/comment";
import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import { headers } from "next/headers";
import type { NextResponse } from "next/server";
import { after } from "next/server";

import {
  checkSpam as akismetCheckSpam,
  type CommentData,
  isAkismetEnabled,
} from "@/lib/server/akismet";
import { logAuditEvent } from "@/lib/server/audit";
import type { UserRole } from "@/lib/server/auth-verify";
import { authVerify } from "@/lib/server/auth-verify";
import { generateCacheKey, getCache, setCache } from "@/lib/server/cache";
import { verifyToken } from "@/lib/server/captcha";
import { getConfig, getConfigs } from "@/lib/server/config-cache";
import { calculateMD5 } from "@/lib/server/crypto";
import { getClientIP } from "@/lib/server/get-client-info";
import { resolveIpLocation } from "@/lib/server/ip-utils";
import {
  normalizePageSlug,
  resolvePageAllowComments,
} from "@/lib/server/page-comments";
import prisma from "@/lib/server/prisma";
import limitControl from "@/lib/server/rate-limit";
import ResponseBuilder from "@/lib/server/response";
import { validateData } from "@/lib/server/validator";

import type { Prisma } from ".prisma/client";

const COMMENT_ROLES: UserRole[] = ["USER", "ADMIN", "EDITOR", "AUTHOR"];

type CommentTarget =
  | {
      type: "post";
      id: number;
      slug: string;
      title: string;
      allowComments: boolean;
      ownerUid: number | null;
      updatedAt: Date | null;
    }
  | {
      type: "page";
      id: string;
      slug: string;
      title: string;
      allowComments: boolean;
      ownerUid: number | null;
      updatedAt: Date | null;
    };

function toAbsolutePath(pathname: string): string {
  return normalizePageSlug(pathname);
}

function joinSiteUrl(siteUrl: string, pathname: string): string {
  const base = siteUrl.replace(/\/+$/, "");
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${base}${path}`;
}

function isLikelyPageSlug(slug: string): boolean {
  return slug.trim().startsWith("/");
}

function buildTargetPath(target: CommentTarget): string {
  if (target.type === "post") {
    return `/posts/${target.slug}`;
  }
  return toAbsolutePath(target.slug);
}

function buildCommentPermalink(
  siteUrl: string,
  target: CommentTarget,
  commentId: string,
): string {
  const contentPath = buildTargetPath(target);
  return `${joinSiteUrl(siteUrl, contentPath)}#comment-${commentId}`;
}

function buildCommentTargetWhere(
  target: CommentTarget,
): Prisma.CommentWhereInput {
  return target.type === "post" ? { postId: target.id } : { pageId: target.id };
}

function resolveTargetFromRelations(relations: {
  post: { slug: string; title?: string | null } | null;
  page: { slug: string; title?: string | null } | null;
}): {
  type: "post" | "page";
  slug: string;
  title: string | null;
} | null {
  if (relations.post) {
    return {
      type: "post",
      slug: relations.post.slug,
      title: relations.post.title ?? null,
    };
  }

  if (relations.page) {
    return {
      type: "page",
      slug: toAbsolutePath(relations.page.slug),
      title: relations.page.title ?? null,
    };
  }

  return null;
}

async function loadCommentTarget(
  slugInput: string,
): Promise<CommentTarget | null> {
  const slug = slugInput.trim();
  if (!slug) return null;

  const shouldCheckPageFirst = isLikelyPageSlug(slug);
  const normalizedPageSlug = toAbsolutePath(slug);

  if (shouldCheckPageFirst) {
    const page = await prisma.page.findUnique({
      where: {
        slug: normalizedPageSlug,
        status: "ACTIVE",
        deletedAt: null,
        contentType: { in: ["MARKDOWN", "MDX", "HTML"] },
      },
      select: {
        id: true,
        slug: true,
        title: true,
        config: true,
        userUid: true,
        updatedAt: true,
      },
    });

    if (page) {
      return {
        type: "page",
        id: page.id,
        slug: page.slug,
        title: page.title,
        allowComments: resolvePageAllowComments(page.config),
        ownerUid: page.userUid,
        updatedAt: page.updatedAt,
      };
    }
  }

  const post = await prisma.post.findUnique({
    where: { slug, status: "PUBLISHED", deletedAt: null },
    select: {
      id: true,
      slug: true,
      title: true,
      allowComments: true,
      userUid: true,
      publishedAt: true,
    },
  });

  if (post) {
    return {
      type: "post",
      id: post.id,
      slug: post.slug,
      title: post.title,
      allowComments: post.allowComments,
      ownerUid: post.userUid,
      updatedAt: post.publishedAt,
    };
  }

  if (!shouldCheckPageFirst) {
    const fallbackPage = await prisma.page.findFirst({
      where: {
        slug: { in: [slug, normalizedPageSlug] },
        status: "ACTIVE",
        deletedAt: null,
        contentType: { in: ["MARKDOWN", "MDX", "HTML"] },
      },
      select: {
        id: true,
        slug: true,
        title: true,
        config: true,
        userUid: true,
        updatedAt: true,
      },
    });

    if (fallbackPage) {
      return {
        type: "page",
        id: fallbackPage.id,
        slug: fallbackPage.slug,
        title: fallbackPage.title,
        allowComments: resolvePageAllowComments(fallbackPage.config),
        ownerUid: fallbackPage.userUid,
        updatedAt: fallbackPage.updatedAt,
      };
    }
  }

  return null;
}

/**
 * 发送评论通知的辅助函数
 * 只有当评论状态为 APPROVED 时才调用此函数
 */
async function sendCommentNotification(params: {
  commentId: string;
  target: CommentTarget;
  parentId: string | null;
  currentUid: number | null;
  commenterName: string;
  commenterEmail: string | null;
  content: string;
}): Promise<void> {
  try {
    const { sendNotice } = await import("@/lib/server/notice");
    const { sendEmail } = await import("@/lib/server/email");
    const { renderEmail } = await import("@/emails/utils");
    const NotificationEmail = (await import("@/emails/templates"))
      .NotificationEmail;

    const [noticeEnabled, siteUrl] = await getConfigs([
      "notice.enable",
      "site.url",
    ]);
    if (!noticeEnabled) return;

    const commentLink = buildCommentPermalink(
      siteUrl,
      params.target,
      params.commentId,
    );
    const truncatedContent =
      params.content.length > 50
        ? params.content.slice(0, 50) + "..."
        : params.content;

    // 场景1：页面/文章被评论（无 parentId）
    if (!params.parentId) {
      const postsNoticeEnabled = await getConfig("notice.posts.enable");
      if (!postsNoticeEnabled) return;

      // 如果是自己评论自己的内容，不通知
      if (params.currentUid && params.currentUid === params.target.ownerUid) {
        return;
      }

      if (!params.target.ownerUid) return;

      const noticeTitle = `${params.commenterName} 评论了《${params.target.title}》`;
      const noticeContent = `${params.commenterName} 在《${params.target.title}》评论："${truncatedContent}"`;

      // 发送站内通知
      await sendNotice(
        params.target.ownerUid,
        noticeTitle,
        noticeContent,
        commentLink,
      );
    }
    // 场景2：评论被回复（有 parentId）
    else {
      const [commentNoticeEnabled, anonCommentNoticeEnabled] = await getConfigs(
        [
          "comment.email.notice.enable",
          "comment.anonymous.email.notice.enable",
        ],
      );

      if (!commentNoticeEnabled && !anonCommentNoticeEnabled) return;

      // 获取父评论信息
      const parentComment = await prisma.comment.findUnique({
        where: { id: params.parentId },
        select: {
          content: true,
          userUid: true,
          authorEmail: true,
          authorName: true,
          user: {
            select: {
              uid: true,
              username: true,
              nickname: true,
              email: true,
              emailVerified: true,
            },
          },
        },
      });
      if (!parentComment) return;

      // 如果是自己回复自己，不通知
      const isSameUser =
        params.currentUid &&
        parentComment.userUid &&
        params.currentUid === parentComment.userUid;
      const isSameEmail =
        params.commenterEmail &&
        parentComment.authorEmail &&
        params.commenterEmail.toLowerCase().trim() ===
          parentComment.authorEmail.toLowerCase().trim();

      if (isSameUser || isSameEmail) return;

      const truncatedParentContent =
        parentComment.content.length > 50
          ? parentComment.content.slice(0, 50) + "..."
          : parentComment.content;

      const noticeTitle = `${params.commenterName} 回复了您`;
      const noticeContent = `您在《${params.target.title}》发布的评论\n"${truncatedParentContent}"\n被 ${params.commenterName} 回复了：\n"${truncatedContent}"`;

      // 登录用户：发送站内通知
      if (parentComment.userUid && commentNoticeEnabled) {
        await sendNotice(
          parentComment.userUid,
          noticeTitle,
          noticeContent,
          commentLink,
        );
      }
      // 匿名用户：只发送邮件
      else if (
        !parentComment.userUid &&
        parentComment.authorEmail &&
        anonCommentNoticeEnabled
      ) {
        const siteName = await getConfig("site.title");

        const emailComponent = NotificationEmail({
          username: parentComment.authorName || "匿名用户",
          title: noticeTitle,
          content: noticeContent,
          link: commentLink,
          siteName,
          siteUrl,
        });

        const { html, text } = await renderEmail(emailComponent);
        const emailSubject = noticeTitle || "您有一条新通知";

        await sendEmail({
          to: parentComment.authorEmail,
          subject: emailSubject,
          html,
          text,
        });
      }
    }
  } catch (error) {
    console.error("发送评论通知失败:", error);
  }
}

/**
 * 通知管理员有新评论待审核
 */
async function notifyAdminPendingComments(): Promise<void> {
  try {
    const notifyEnabled = await getConfig("comment.review.notifyAdmin.enable");
    if (!notifyEnabled) return;

    const threshold = await getConfig("comment.review.notifyAdmin.threshold");

    // 统计待审核评论数量
    const pendingCount = await prisma.comment.count({
      where: {
        status: "PENDING",
        deletedAt: null,
      },
    });

    // 如果未达到阈值，不发送通知
    if (pendingCount < threshold) return;

    const { sendNotice } = await import("@/lib/server/notice");

    // 获取应该接收通知的用户 UID 列表
    const notifyUids = await getConfig("comment.review.notifyAdmin.uid");

    const siteUrl = await getConfig("site.url");

    const adminLink = `${siteUrl}/admin/comments?status=PENDING`;
    const noticeTitle = `有 ${pendingCount} 条评论待审核`;
    const noticeContent = `当前有 ${pendingCount} 条评论正在等待审核，请及时处理。`;

    // 如果指定了特定用户，只通知这些用户
    if (notifyUids && notifyUids.length > 0) {
      for (const uidStr of notifyUids) {
        const uid = parseInt(uidStr, 10);
        if (!isNaN(uid)) {
          await sendNotice(uid, noticeTitle, noticeContent, adminLink);
        }
      }
    }
    // 否则通知所有管理员和编辑
    else {
      const admins = await prisma.user.findMany({
        where: {
          role: { in: ["ADMIN", "EDITOR"] },
          deletedAt: null,
        },
        select: { uid: true },
      });

      for (const admin of admins) {
        await sendNotice(admin.uid, noticeTitle, noticeContent, adminLink);
      }
    }

    console.log(`已通知管理员：${pendingCount} 条评论待审核`);
  } catch (error) {
    console.error("通知管理员失败:", error);
  }
}

type ActionEnvironment = "serverless" | "serveraction";
type ActionConfig = { environment?: ActionEnvironment };
type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

function buildPaginationMeta({
  page,
  pageSize,
  total,
  hasNext,
}: {
  page: number;
  pageSize: number;
  total: number;
  hasNext: boolean;
}) {
  const totalPages = total > 0 ? Math.ceil(total / pageSize) : 0;
  return {
    page,
    pageSize,
    total,
    totalPages,
    hasNext,
    hasPrev: page > 1,
  };
}

const commentSelect = {
  id: true,
  content: true,
  status: true,
  createdAt: true,
  parentId: true,
  postId: true,
  pageId: true,
  post: {
    select: {
      slug: true,
      title: true,
      publishedAt: true,
    },
  },
  page: {
    select: {
      slug: true,
      title: true,
      updatedAt: true,
    },
  },
  userUid: true,
  authorName: true,
  authorEmail: true,
  authorWebsite: true,
  ipAddress: true,
  userAgent: true,
  // 层级树形结构字段
  depth: true,
  path: true,
  sortKey: true,
  replyCount: true,
  // 点赞相关
  likeCount: true,
  user: {
    select: {
      uid: true,
      username: true,
      nickname: true,
      avatar: true,
      website: true,
    },
  },
  parent: {
    select: {
      id: true,
      content: true,
      authorName: true,
      user: { select: { nickname: true, username: true } },
    },
  },
} satisfies Prisma.CommentSelect;

type PublicComment = Prisma.CommentGetPayload<{
  select: typeof commentSelect;
}>;
const adminCommentSelect = commentSelect;
type AdminComment = Prisma.CommentGetPayload<{
  select: typeof adminCommentSelect;
}>;

async function mapCommentToItem(
  comment: PublicComment,
  currentUid: number | null,
  showLocation: boolean,
  maxDepth?: number, // 用于判断是否有更多深层子评论
  isLiked?: boolean, // 当前用户是否已点赞
): Promise<CommentItem> {
  const target = resolveTargetFromRelations({
    post: comment.post,
    page: comment.page,
  });
  if (!target) {
    throw new Error(`评论 ${comment.id} 缺少归属对象`);
  }

  const displayName =
    comment.user?.nickname ||
    comment.user?.username ||
    comment.authorName ||
    "匿名";

  // 解析 IP 归属地
  const locationData = showLocation
    ? resolveIpLocation(comment.ipAddress)
    : null;
  const location = locationData
    ? [locationData.country, locationData.region, locationData.city]
        .filter(Boolean)
        .join(" ") || null
    : null;

  // 计算邮箱的 MD5 值
  const emailMd5 = comment.authorEmail
    ? calculateMD5(comment.authorEmail)
    : null;

  // 判断是否有未加载的子评论
  // maxDepth = 0 表示不预加载任何子评论，只要有子评论就标记为 hasMore
  // maxDepth = 1 表示只加载当前层级，有子评论就标记为 hasMore
  // maxDepth > 1 时，按原逻辑判断深层子评论
  const hasMore =
    maxDepth !== undefined &&
    comment.replyCount > 0 &&
    (maxDepth <= 1 || comment.depth >= maxDepth - 1);

  const targetWhere: Prisma.CommentWhereInput =
    comment.postId !== null
      ? { postId: comment.postId }
      : { pageId: comment.pageId };

  // 从数据库查询此评论的所有后代数量（使用 path 前缀匹配）
  const descendantCount = await prisma.comment.count({
    where: {
      ...targetWhere,
      path: { startsWith: comment.path + "/" },
      deletedAt: null,
      OR: [
        { status: "APPROVED" },
        ...(currentUid ? [{ userUid: currentUid }] : []),
      ],
    },
  });

  return {
    id: comment.id,
    postSlug: target.slug,
    parentId: comment.parentId,
    content: comment.content,
    status: comment.status,
    createdAt: comment.createdAt.toISOString(),
    mine: comment.userUid !== null && comment.userUid === currentUid,
    replyCount: comment.replyCount,
    author: {
      uid: comment.user?.uid ?? null,
      username: comment.user?.username ?? null,
      nickname: comment.user?.nickname ?? null,
      avatar: comment.user?.avatar ?? null,
      website: comment.user?.website ?? comment.authorWebsite ?? null,
      displayName,
      isAnonymous: !comment.user,
      emailMd5,
    },
    location,
    replyTo: comment.parent
      ? {
          id: comment.parent.id,
          authorName:
            comment.parent.user?.nickname ||
            comment.parent.user?.username ||
            comment.parent.authorName ||
            "匿名",
          content: comment.parent.content,
        }
      : null,
    // 层级树形结构字段
    depth: comment.depth,
    path: comment.path,
    sortKey: comment.sortKey,
    hasMore,
    descendantCount,
    // 点赞相关
    likeCount: comment.likeCount,
    isLiked: currentUid !== null ? isLiked : undefined,
  };
}

async function ensureCaptcha(token?: string) {
  if (!token) return { success: false };
  return verifyToken(token);
}

export async function getPostComments(
  params: GetPostComments,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CommentListResponse["data"] | null>>>;
export async function getPostComments(
  params: GetPostComments,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CommentListResponse["data"] | null>>;
export async function getPostComments(
  params: GetPostComments,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CommentListResponse["data"] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getPostComments"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(params, GetPostCommentsSchema);
  if (validationError) return response.badRequest(validationError);

  const { slug, pageSize, cursor } = params;

  const commentEnabled = await getConfig("comment.enable");
  if (!commentEnabled) {
    return response.forbidden({ message: "评论功能已关闭" });
  }

  const target = await loadCommentTarget(slug);
  if (!target) {
    return response.notFound({ message: "评论目标不存在或不可访问" });
  }
  if (!target.allowComments) {
    return response.forbidden({ message: "该内容未开启评论" });
  }

  const authUser = await authVerify({ allowedRoles: COMMENT_ROLES });
  const currentUid = authUser?.uid ?? null;

  // 只获取顶级评论（分页），不再自动加载子评论
  const rootWhere: Prisma.CommentWhereInput = {
    ...buildCommentTargetWhere(target),
    deletedAt: null,
    parentId: null, // 仅顶级评论
    OR: [
      { status: "APPROVED" },
      ...(currentUid ? [{ userUid: currentUid }] : []),
    ],
    ...(cursor ? { sortKey: { gt: cursor } } : {}),
  };

  const [rootComments, showLocation, totalComments] = await Promise.all([
    prisma.comment.findMany({
      where: rootWhere,
      orderBy: { sortKey: "asc" },
      take: pageSize + 1,
      select: commentSelect,
    }),
    getConfig("comment.locate.enable"),
    prisma.comment.count({
      where: {
        ...buildCommentTargetWhere(target),
        deletedAt: null,
        OR: [
          { status: "APPROVED" },
          ...(currentUid ? [{ userUid: currentUid }] : []),
        ],
      },
    }),
  ]);

  const hasNext = rootComments.length > pageSize;
  const slicedRoots = rootComments.slice(0, pageSize);

  if (slicedRoots.length === 0) {
    return response.ok({
      data: [] as unknown as CommentListResponse["data"],
      meta: {
        page: 1,
        pageSize,
        total: totalComments,
        totalPages: 0,
        hasNext: false,
        hasPrev: false,
      },
    });
  }

  // 预加载子评论：每个主评论最多5条一级子评论，每个一级子评论最多5条二级子评论
  const PRELOAD_LIMIT = 5;
  const rootIds = slicedRoots.map((c) => c.id);

  // 获取一级子评论（parentId 在 rootIds 中）
  const level1Comments = await prisma.comment.findMany({
    where: {
      parentId: { in: rootIds },
      deletedAt: null,
      OR: [
        { status: "APPROVED" },
        ...(currentUid ? [{ userUid: currentUid }] : []),
      ],
    },
    orderBy: { sortKey: "asc" },
    select: commentSelect,
  });

  // 按父评论分组，每个父评论最多取5条
  const level1ByParent = new Map<string, PublicComment[]>();
  for (const c of level1Comments) {
    if (!c.parentId) continue;
    const list = level1ByParent.get(c.parentId) || [];
    if (list.length < PRELOAD_LIMIT) {
      list.push(c);
      level1ByParent.set(c.parentId, list);
    }
  }

  // 获取需要预加载二级子评论的一级评论ID
  const level1Ids: string[] = [];
  for (const list of level1ByParent.values()) {
    for (const c of list) {
      level1Ids.push(c.id);
    }
  }

  // 获取二级子评论（parentId 在 level1Ids 中）
  const level2Comments =
    level1Ids.length > 0
      ? await prisma.comment.findMany({
          where: {
            parentId: { in: level1Ids },
            deletedAt: null,
            OR: [
              { status: "APPROVED" },
              ...(currentUid ? [{ userUid: currentUid }] : []),
            ],
          },
          orderBy: { sortKey: "asc" },
          select: commentSelect,
        })
      : [];

  // 按父评论分组，每个父评论最多取5条
  const level2ByParent = new Map<string, PublicComment[]>();
  for (const c of level2Comments) {
    if (!c.parentId) continue;
    const list = level2ByParent.get(c.parentId) || [];
    if (list.length < PRELOAD_LIMIT) {
      list.push(c);
      level2ByParent.set(c.parentId, list);
    }
  }

  // 收集所有评论ID用于批量查询点赞状态
  const allCommentIds: string[] = [...rootIds, ...level1Ids];
  for (const list of level2ByParent.values()) {
    for (const c of list) {
      allCommentIds.push(c.id);
    }
  }

  // 如果用户已登录，批量查询点赞状态
  let likedCommentIds: Set<string> = new Set();
  if (currentUid && allCommentIds.length > 0) {
    const likes = await prisma.commentLike.findMany({
      where: {
        commentId: { in: allCommentIds },
        userUid: currentUid,
      },
      select: { commentId: true },
    });
    likedCommentIds = new Set(likes.map((like) => like.commentId));
  }

  // 转换为响应格式
  // 构建扁平化的评论列表，按 sortKey 排序
  const allCommentsToProcess: PublicComment[] = [];

  // 添加主评论及其预加载的子评论
  for (const root of slicedRoots) {
    allCommentsToProcess.push(root);
    const level1List = level1ByParent.get(root.id) || [];
    for (const l1 of level1List) {
      allCommentsToProcess.push(l1);
      const level2List = level2ByParent.get(l1.id) || [];
      for (const l2 of level2List) {
        allCommentsToProcess.push(l2);
      }
    }
  }

  // 按 sortKey 排序确保正确的显示顺序
  allCommentsToProcess.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  const data: CommentItem[] = [];
  for (const c of allCommentsToProcess) {
    // maxDepth = 3 表示预加载到第三层（depth 0, 1, 2），更深的标记为 hasMore
    data.push(
      await mapCommentToItem(
        c,
        currentUid,
        showLocation,
        3, // 预加载三层评论
        likedCommentIds.has(c.id),
      ),
    );
  }

  // 计算分页元数据
  const lastRoot = slicedRoots[slicedRoots.length - 1];
  const nextCursor = hasNext ? lastRoot?.sortKey : undefined;

  const meta = {
    page: cursor ? 2 : 1,
    pageSize,
    total: totalComments,
    totalPages: hasNext ? 2 : 1,
    hasNext,
    hasPrev: !!cursor,
    nextCursor,
  };

  return response.ok({
    data: data as unknown as CommentListResponse["data"],
    meta,
  });
}

export async function getCommentReplies(
  params: GetCommentReplies,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CommentListResponse["data"] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getCommentReplies"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(params, GetCommentRepliesSchema);
  if (validationError) return response.badRequest(validationError);

  const { commentId, maxDepth } = params;

  // 获取父评论信息
  const parent = await prisma.comment.findUnique({
    where: { id: commentId, deletedAt: null },
    select: {
      id: true,
      depth: true,
      path: true,
    },
  });
  if (!parent) return response.notFound({ message: "评论不存在" });

  const authUser = await authVerify({ allowedRoles: COMMENT_ROLES });
  const currentUid = authUser?.uid ?? null;
  const showLocation = await getConfig("comment.locate.enable");

  // 获取该评论下所有深层子评论（相对深度限制）
  const maxAbsoluteDepth = parent.depth + maxDepth;
  const pathPrefix = parent.path ? `${parent.path}/` : `${parent.id}/`;

  const where: Prisma.CommentWhereInput = {
    deletedAt: null,
    path: { startsWith: pathPrefix },
    depth: { gt: parent.depth, lte: maxAbsoluteDepth },
    OR: [
      { status: "APPROVED" },
      ...(currentUid ? [{ userUid: currentUid }] : []),
    ],
  };

  const rawComments = await prisma.comment.findMany({
    where,
    orderBy: { sortKey: "asc" },
    select: commentSelect,
  });

  // 批量查询点赞状态
  let likedCommentIds: Set<string> = new Set();
  if (currentUid && rawComments.length > 0) {
    const commentIds = rawComments.map((c) => c.id);
    const likes = await prisma.commentLike.findMany({
      where: {
        commentId: { in: commentIds },
        userUid: currentUid,
      },
      select: { commentId: true },
    });
    likedCommentIds = new Set(likes.map((like) => like.commentId));
  }

  const data: CommentItem[] = [];
  for (const c of rawComments) {
    data.push(
      await mapCommentToItem(
        c,
        currentUid,
        showLocation,
        maxAbsoluteDepth,
        likedCommentIds.has(c.id),
      ),
    );
  }

  const meta = buildPaginationMeta({
    page: 1,
    pageSize: data.length || 1,
    total: data.length,
    hasNext: false,
  });

  return response.ok({
    data: data as unknown as CommentListResponse["data"],
    meta,
  });
}

// 获取直接子评论（分页，并预加载下三层）
export async function getDirectChildren(
  params: GetDirectChildren,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<DirectChildrenResponse["data"] | null>>>;
export async function getDirectChildren(
  params: GetDirectChildren,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<DirectChildrenResponse["data"] | null>>;
export async function getDirectChildren(
  params: GetDirectChildren,
  serverConfig?: ActionConfig,
): Promise<ActionResult<DirectChildrenResponse["data"] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getDirectChildren"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(params, GetDirectChildrenSchema);
  if (validationError) return response.badRequest(validationError);

  const { parentId, postSlug, pageSize, cursor } = params;

  const commentEnabled = await getConfig("comment.enable");
  if (!commentEnabled) {
    return response.forbidden({ message: "评论功能已关闭" });
  }

  const target = await loadCommentTarget(postSlug);
  if (!target) {
    return response.notFound({ message: "评论目标不存在或不可访问" });
  }
  if (!target.allowComments) {
    return response.forbidden({ message: "该内容未开启评论" });
  }

  const authUser = await authVerify({ allowedRoles: COMMENT_ROLES });
  const currentUid = authUser?.uid ?? null;

  // 获取父评论信息（如果有）
  let parentDepth = -1; // -1 表示查询主级评论
  if (parentId) {
    const parent = await prisma.comment.findUnique({
      where: { id: parentId, deletedAt: null },
      select: { depth: true, postId: true, pageId: true },
    });
    if (!parent) {
      return response.notFound({ message: "父评论不存在" });
    }
    const sameTarget =
      (target.type === "post" && parent.postId === target.id) ||
      (target.type === "page" && parent.pageId === target.id);
    if (!sameTarget) {
      return response.badRequest({ message: "父评论不属于当前内容" });
    }
    parentDepth = parent.depth;
  }

  // 构建查询条件：只查询直接子评论（depth = parentDepth + 1）
  const where: Prisma.CommentWhereInput = {
    ...buildCommentTargetWhere(target),
    deletedAt: null,
    parentId: parentId, // null 表示主级评论
    depth: parentDepth + 1,
    OR: [
      { status: "APPROVED" },
      ...(currentUid ? [{ userUid: currentUid }] : []),
    ],
    ...(cursor ? { sortKey: { gt: cursor } } : {}),
  };

  const [rawComments, showLocation] = await Promise.all([
    prisma.comment.findMany({
      where,
      orderBy: { sortKey: "asc" },
      take: pageSize + 1,
      select: commentSelect,
    }),
    getConfig("comment.locate.enable"),
  ]);

  const hasNext = rawComments.length > pageSize;
  const slicedComments = rawComments.slice(0, pageSize);

  if (slicedComments.length === 0) {
    return response.ok({
      data: [] as unknown as DirectChildrenResponse["data"],
      meta: {
        page: 1,
        pageSize,
        total: 0,
        totalPages: 0,
        hasNext: false,
        hasPrev: !!cursor,
      },
    });
  }

  // ========== 预加载下三层子评论（与 getPostComments 相同的逻辑） ==========
  const PRELOAD_LIMIT = 5;
  const level0Ids = slicedComments.map((c) => c.id); // 第一层（直接子评论）

  // 获取第二层子评论（parentId 在 level0Ids 中）
  const level1Comments = await prisma.comment.findMany({
    where: {
      parentId: { in: level0Ids },
      deletedAt: null,
      OR: [
        { status: "APPROVED" },
        ...(currentUid ? [{ userUid: currentUid }] : []),
      ],
    },
    orderBy: { sortKey: "asc" },
    select: commentSelect,
  });

  // 按父评论分组，每个父评论最多取 5 条
  const level1ByParent = new Map<string, PublicComment[]>();
  for (const c of level1Comments) {
    if (!c.parentId) continue;
    const list = level1ByParent.get(c.parentId) || [];
    if (list.length < PRELOAD_LIMIT) {
      list.push(c);
      level1ByParent.set(c.parentId, list);
    }
  }

  // 获取需要预加载第三层子评论的第二层评论 ID
  const level1Ids: string[] = [];
  for (const list of level1ByParent.values()) {
    for (const c of list) {
      level1Ids.push(c.id);
    }
  }

  // 获取第三层子评论（parentId 在 level1Ids 中）
  const level2Comments =
    level1Ids.length > 0
      ? await prisma.comment.findMany({
          where: {
            parentId: { in: level1Ids },
            deletedAt: null,
            OR: [
              { status: "APPROVED" },
              ...(currentUid ? [{ userUid: currentUid }] : []),
            ],
          },
          orderBy: { sortKey: "asc" },
          select: commentSelect,
        })
      : [];

  // 按父评论分组，每个父评论最多取 5 条
  const level2ByParent = new Map<string, PublicComment[]>();
  for (const c of level2Comments) {
    if (!c.parentId) continue;
    const list = level2ByParent.get(c.parentId) || [];
    if (list.length < PRELOAD_LIMIT) {
      list.push(c);
      level2ByParent.set(c.parentId, list);
    }
  }

  // 收集所有评论 ID 用于批量查询点赞状态
  const allCommentIds: string[] = [...level0Ids, ...level1Ids];
  for (const list of level2ByParent.values()) {
    for (const c of list) {
      allCommentIds.push(c.id);
    }
  }

  // 如果用户已登录，批量查询点赞状态
  let likedCommentIds: Set<string> = new Set();
  if (currentUid && allCommentIds.length > 0) {
    const likes = await prisma.commentLike.findMany({
      where: {
        commentId: { in: allCommentIds },
        userUid: currentUid,
      },
      select: { commentId: true },
    });
    likedCommentIds = new Set(likes.map((like) => like.commentId));
  }

  // 构建扁平化的评论列表，按 sortKey 排序
  const allCommentsToProcess: PublicComment[] = [];

  // 添加第一层评论及其预加载的子评论
  for (const level0 of slicedComments) {
    allCommentsToProcess.push(level0);
    const level1List = level1ByParent.get(level0.id) || [];
    for (const l1 of level1List) {
      allCommentsToProcess.push(l1);
      const level2List = level2ByParent.get(l1.id) || [];
      for (const l2 of level2List) {
        allCommentsToProcess.push(l2);
      }
    }
  }

  // 按 sortKey 排序确保正确的显示顺序
  allCommentsToProcess.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  // 转换为响应格式
  const data: CommentItem[] = [];
  // 计算 maxDepth：基于父评论的 depth + 3 层
  const maxAbsoluteDepth = parentDepth + 4; // parentDepth + 1 (第一层) + 3 (预加载三层)
  for (const c of allCommentsToProcess) {
    data.push(
      await mapCommentToItem(
        c,
        currentUid,
        showLocation,
        maxAbsoluteDepth, // 预加载三层评论
        likedCommentIds.has(c.id),
      ),
    );
  }

  // 计算分页元数据
  const lastComment = slicedComments[slicedComments.length - 1];
  const nextCursor = hasNext ? lastComment?.sortKey : undefined;

  const meta = {
    page: cursor ? 2 : 1,
    pageSize,
    total: data.length,
    totalPages: hasNext ? 2 : 1,
    hasNext,
    hasPrev: !!cursor,
    nextCursor,
  };

  return response.ok({
    data: data as unknown as DirectChildrenResponse["data"],
    meta,
  });
}

export async function createComment(
  params: CreateComment,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CommentItem | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "createComment"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(params, CreateCommentSchema);
  if (validationError) return response.badRequest(validationError);

  const captchaResult = await ensureCaptcha(params.captcha_token);
  if (!captchaResult?.success) {
    return response.badRequest({ message: "安全验证失败，请重试" });
  }

  const {
    slug,
    content,
    parentId,
    authorName,
    authorEmail,
    authorWebsite,
    access_token,
  } = params;

  const commentEnabled = await getConfig("comment.enable");
  if (!commentEnabled) {
    return response.forbidden({ message: "评论功能已关闭" });
  }

  const [
    allowAnonymous,
    requireAnonEmail,
    allowAnonWebsite,
    reviewAll,
    reviewAnon,
  ] = await getConfigs([
    "comment.anonymous.enable",
    "comment.anonymous.email.required",
    "comment.anonymous.website.enable",
    "comment.review.enable",
    "comment.anonymous.review.enable",
  ]);

  const target = await loadCommentTarget(slug);
  if (!target) {
    return response.notFound({ message: "评论目标不存在或不可访问" });
  }
  if (!target.allowComments) {
    return response.forbidden({ message: "该内容未开启评论" });
  }

  const authUser = await authVerify({
    allowedRoles: COMMENT_ROLES,
    accessToken: access_token,
  });
  const currentUid = authUser?.uid ?? null;

  if (!currentUid && !allowAnonymous) {
    return response.unauthorized({ message: "请登录后再评论" });
  }

  if (!currentUid && requireAnonEmail && !authorEmail) {
    return response.badRequest({ message: "请填写邮箱后再提交评论" });
  }

  if (parentId) {
    const parentComment = await prisma.comment.findUnique({
      where: { id: parentId, deletedAt: null },
      select: {
        postId: true,
        pageId: true,
        depth: true,
        path: true,
        sortKey: true,
      },
    });
    const parentMatchesTarget =
      !!parentComment &&
      ((target.type === "post" && parentComment.postId === target.id) ||
        (target.type === "page" && parentComment.pageId === target.id));
    if (!parentMatchesTarget) {
      return response.badRequest({ message: "回复目标不存在" });
    }
  }

  // 获取客户端 IP 地址和 User Agent
  const ipAddress = await getClientIP();
  const headersList = await headers();
  const userAgent = headersList.get("user-agent") || undefined;

  // 检查是否启用 Akismet
  const akismetEnabled = await isAkismetEnabled();

  // AUTHOR、EDITOR、ADMIN 角色豁免 Akismet 检查
  const isPrivilegedUser =
    authUser &&
    (authUser.role === "AUTHOR" ||
      authUser.role === "EDITOR" ||
      authUser.role === "ADMIN");

  // 计算"正常情况下"应该的状态（用于返回给用户，实现影子封禁）
  const normalStatus: CommentStatus =
    reviewAll || (!currentUid && reviewAnon) ? "PENDING" : "APPROVED";

  // 如果启用了 Akismet 且用户不是特权用户，实际存储时统一使用 PENDING，等待异步检查
  // 特权用户（AUTHOR/EDITOR/ADMIN）豁免检查，直接使用正常状态
  const status: CommentStatus =
    akismetEnabled && !isPrivilegedUser ? "PENDING" : normalStatus;

  const dbUser = currentUid
    ? await prisma.user.findUnique({
        where: { uid: currentUid },
        select: {
          uid: true,
          username: true,
          nickname: true,
          email: true,
          avatar: true,
          website: true,
        },
      })
    : null;

  // 计算层级树形结构字段
  let depth = 0;
  let path = "";
  const sortKey = "pending";
  let parentSortKey = "";

  if (parentId) {
    const parentComment = await prisma.comment.findUnique({
      where: { id: parentId },
      select: { depth: true, path: true, sortKey: true },
    });
    if (!parentComment) {
      return response.badRequest({
        message: "父评论不存在",
      });
    }

    depth = parentComment.depth + 1;
    parentSortKey = parentComment.sortKey;
  }

  const record = await prisma.comment.create({
    data: {
      content,
      status,
      parentId: parentId || null,
      postId: target.type === "post" ? target.id : null,
      pageId: target.type === "page" ? target.id : null,
      userUid: dbUser?.uid ?? null,
      authorName: dbUser?.nickname || dbUser?.username || authorName || "匿名",
      authorEmail: dbUser?.email || authorEmail || null,
      authorWebsite:
        dbUser?.website || (allowAnonWebsite ? authorWebsite || null : null),
      ipAddress,
      userAgent,
      depth,
      path: "", // 先创建记录，稍后更新 path
      sortKey,
      replyCount: 0,
    },
    select: { id: true },
  });

  // 更新 path（需要包含自身 id）
  if (parentId) {
    const parentComment = await prisma.comment.findUnique({
      where: { id: parentId },
      select: { path: true },
    });
    path = parentComment?.path
      ? `${parentComment.path}/${record.id}`
      : `${parentId}/${record.id}`;
  } else {
    path = record.id;
  }

  // 更新评论的 path
  const finalSortKey = parentId
    ? `${parentSortKey}.${String(record.id).padStart(10, "0")}`
    : String(record.id).padStart(10, "0");

  await prisma.comment.update({
    where: { id: record.id },
    data: { path, sortKey: finalSortKey },
  });

  // 更新父评论的 replyCount
  if (parentId) {
    await prisma.comment.update({
      where: { id: parentId },
      data: { replyCount: { increment: 1 } },
    });
  }

  // 重新获取完整记录
  const fullRecord = await prisma.comment.findUnique({
    where: { id: record.id },
    select: commentSelect,
  });

  if (!fullRecord) {
    return response.serverError();
  }

  const showLocation = await getConfig("comment.locate.enable");

  // 新创建的评论，当前用户肯定没有点赞
  const mapped = await mapCommentToItem(
    fullRecord,
    currentUid,
    showLocation,
    undefined,
    false,
  );

  // Shadown ban
  const mappedWithFakeStatus = {
    ...mapped,
    status: akismetEnabled && !isPrivilegedUser ? normalStatus : mapped.status,
  };

  // 获取 referrer 用于 Akismet 检查
  const referrer = headersList.get("referer") || undefined;

  // Akismet
  after(async () => {
    try {
      // 只有启用了 Akismet 才进行检查
      if (!akismetEnabled) return;

      // 特权用户（AUTHOR/EDITOR/ADMIN）豁免检查
      if (isPrivilegedUser) {
        console.log(
          `评论 ${record.id} 来自特权用户（${authUser?.role}），豁免 Akismet 检查`,
        );
        return;
      }

      // 获取站点 URL 用于生成 permalink
      const siteUrl = await getConfig("site.url");

      // 构建评论数据
      const commentData: CommentData = {
        userIp: ipAddress || "",
        userAgent,
        referrer,
        permalink: buildCommentPermalink(siteUrl, target, record.id),
        commentType: "comment",
        commentAuthor: dbUser?.nickname || dbUser?.username || authorName,
        commentAuthorEmail: dbUser?.email || authorEmail || undefined,
        commentAuthorUrl:
          dbUser?.website ||
          (allowAnonWebsite ? authorWebsite || undefined : undefined),
        commentContent: content,
        commentDateGmt: new Date(),
        userRole: currentUid ? (dbUser ? "user" : undefined) : undefined,
        isTest: process.env.NODE_ENV === "development",
      };

      // 调用 Akismet 检查
      const isSpam = await akismetCheckSpam(commentData);

      // 根据检查结果更新评论状态
      if (isSpam) {
        // 如果是垃圾评论，标记为 SPAM（影子封禁，用户看不到，但发布者以为成功了）
        await prisma.comment.update({
          where: { id: record.id },
          data: { status: "SPAM" },
        });
        console.log(`评论 ${record.id} 被 Akismet 标记为垃圾评论`);
      } else {
        // 如果通过 Akismet 检查，使用正常状态（normalStatus）
        await prisma.comment.update({
          where: { id: record.id },
          data: { status: normalStatus },
        });
        console.log(
          `评论 ${record.id} 通过 Akismet 检查，状态更新为 ${normalStatus}`,
        );

        // 只有状态变为 APPROVED 时才发送通知
        if (normalStatus === "APPROVED") {
          await sendCommentNotification({
            commentId: record.id,
            target,
            parentId: parentId || null,
            currentUid,
            commenterName:
              dbUser?.nickname || dbUser?.username || authorName || "匿名用户",
            commenterEmail: dbUser?.email || authorEmail || null,
            content,
          });
        } else if (normalStatus === "PENDING") {
          // 如果状态为 PENDING（需要人工审核），通知管理员
          await notifyAdminPendingComments();
        }
      }
    } catch (error) {
      console.error("Akismet 异步检查失败:", error);
      // 发生错误时，为了安全起见，保持 PENDING 状态，由管理员人工审核
    }
  });

  // 对于未启用 Akismet 或特权用户的情况，立即发送通知（如果状态为 APPROVED）
  // 启用 Akismet 的普通用户，通知会在异步检查通过后发送
  if ((!akismetEnabled || isPrivilegedUser) && status === "APPROVED") {
    after(async () => {
      await sendCommentNotification({
        commentId: record.id,
        target,
        parentId: parentId || null,
        currentUid,
        commenterName:
          dbUser?.nickname || dbUser?.username || authorName || "匿名用户",
        commenterEmail: dbUser?.email || authorEmail || null,
        content,
      });
    });
  }

  // 如果评论状态为 PENDING（未启用 Akismet 但开启了人工审核），通知管理员
  if ((!akismetEnabled || isPrivilegedUser) && status === "PENDING") {
    after(async () => {
      await notifyAdminPendingComments();
    });
  }

  return response.created({
    data: mappedWithFakeStatus as unknown as CommentItem,
  });
}

export async function updateCommentStatus(
  params: UpdateCommentStatus,
  serverConfig?: ActionConfig,
): Promise<ActionResult<null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "updateCommentStatus"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(params, UpdateCommentStatusSchema);
  if (validationError) return response.badRequest(validationError);

  const authUser = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR", "AUTHOR"],
  });
  if (!authUser) return response.unauthorized();

  const { ids, status } = params;

  // 构建权限过滤条件
  const whereCondition: Prisma.CommentWhereInput = {
    id: { in: ids },
    deletedAt: null,
  };

  // AUTHOR 角色只能管理自己文章下的评论
  if (authUser.role === "AUTHOR") {
    whereCondition.post = { userUid: authUser.uid };
  }

  // 获取评论的旧状态和完整信息（用于 Akismet 报告和通知补发）
  const oldComments = await prisma.comment.findMany({
    where: whereCondition,
    select: {
      id: true,
      status: true,
      content: true,
      ipAddress: true,
      authorName: true,
      authorEmail: true,
      authorWebsite: true,
      createdAt: true,
      parentId: true,
      userUid: true,
      post: {
        select: {
          id: true,
          slug: true,
          title: true,
          publishedAt: true,
          userUid: true, // 确保获取文章作者ID
        },
      },
      page: {
        select: {
          id: true,
          slug: true,
          title: true,
          updatedAt: true,
          userUid: true,
        },
      },
      user: {
        select: {
          uid: true,
          nickname: true,
          username: true,
          email: true,
          website: true,
        },
      },
    },
  });
  const oldStatuses = [...new Set(oldComments.map((c) => c.status))];

  // 只有找到的评论才更新（避免 AUTHOR 尝试更新不属于自己的评论）
  const foundIds = oldComments.map((c) => c.id);
  if (foundIds.length === 0) {
    return response.ok({ message: "没有可更新的评论" });
  }

  await prisma.comment.updateMany({
    where: { id: { in: foundIds }, deletedAt: null }, // 使用 foundIds 确保安全性
    data: { status },
  });

  // 记录审计日志
  await logAuditEvent({
    user: {
      uid: String(authUser.uid),
    },
    details: {
      action: "UPDATE",
      resourceType: "COMMENT",
      resourceId: ids.join(","),
      value: {
        old: { status: oldStatuses },
        new: { status },
      },
      description: `批量更新评论状态: ${oldStatuses.join("/")} -> ${status} (${ids.length} 条)`,
    },
  });

  // Akismet 报告（异步执行，不阻塞响应）
  after(async () => {
    try {
      // 只有启用了 Akismet 报告功能才执行
      const reportEnabled = await getConfig("comment.akismet.report.enable");
      if (!reportEnabled) return;

      const akismetEnabled = await isAkismetEnabled();
      if (!akismetEnabled) return;

      const { submitSpam, submitHam } = await import("@/lib/server/akismet");

      // 获取站点 URL
      const siteUrl = await getConfig("site.url");

      for (const comment of oldComments) {
        // 只处理状态发生变化的评论
        if (comment.status === status) continue;

        const rawTarget = resolveTargetFromRelations({
          post: comment.post,
          page: comment.page,
        });
        if (!rawTarget) continue;

        let target: CommentTarget;
        if (rawTarget.type === "post") {
          if (!comment.post) continue;
          target = {
            type: "post",
            id: comment.post.id,
            slug: rawTarget.slug,
            title: rawTarget.title || "文章",
            allowComments: true,
            ownerUid: comment.post.userUid ?? null,
            updatedAt: comment.post.publishedAt ?? null,
          };
        } else {
          if (!comment.page) continue;
          target = {
            type: "page",
            id: comment.page.id,
            slug: rawTarget.slug,
            title: rawTarget.title || "页面",
            allowComments: true,
            ownerUid: comment.page.userUid ?? null,
            updatedAt: comment.page.updatedAt ?? null,
          };
        }

        // 构建评论数据
        const commentData: CommentData = {
          userIp: comment.ipAddress || "",
          permalink: buildCommentPermalink(siteUrl, target, comment.id),
          commentType: "comment",
          commentAuthor:
            comment.user?.nickname ||
            comment.user?.username ||
            comment.authorName ||
            undefined,
          commentAuthorEmail:
            comment.user?.email || comment.authorEmail || undefined,
          commentAuthorUrl:
            comment.user?.website || comment.authorWebsite || undefined,
          commentContent: comment.content,
          commentDateGmt: comment.createdAt,
          commentPostModifiedGmt: target.updatedAt || undefined,
          isTest: process.env.NODE_ENV === "development",
        };

        // 如果从非 SPAM 状态改为 SPAM 状态，向 Akismet 提交垃圾评论
        if (comment.status !== "SPAM" && status === "SPAM") {
          await submitSpam(commentData);
          console.log(`已向 Akismet 报告垃圾评论: ${comment.id}`);
        }
        // 如果从 SPAM 状态改为非 SPAM 状态，向 Akismet 提交正常评论
        else if (comment.status === "SPAM" && status !== "SPAM") {
          await submitHam(commentData);
          console.log(`已向 Akismet 报告正常评论: ${comment.id}`);
        }
      }
    } catch (error) {
      console.error("向 Akismet 报告评论状态失败:", error);
    }
  });

  // 补发通知：当管理员将评论从其他状态改为 APPROVED 时，发送通知
  after(async () => {
    try {
      // 只处理状态变为 APPROVED 的评论
      if (status !== "APPROVED") return;

      for (const comment of oldComments) {
        // 只处理状态发生变化的评论（从非 APPROVED 变为 APPROVED）
        if (comment.status === "APPROVED") continue;

        const rawTarget = resolveTargetFromRelations({
          post: comment.post,
          page: comment.page,
        });
        if (!rawTarget) continue;

        let target: CommentTarget;
        if (rawTarget.type === "post") {
          if (!comment.post) continue;
          target = {
            type: "post",
            id: comment.post.id,
            slug: rawTarget.slug,
            title: rawTarget.title || "文章",
            allowComments: true,
            ownerUid: comment.post.userUid ?? null,
            updatedAt: comment.post.publishedAt ?? null,
          };
        } else {
          if (!comment.page) continue;
          target = {
            type: "page",
            id: comment.page.id,
            slug: rawTarget.slug,
            title: rawTarget.title || "页面",
            allowComments: true,
            ownerUid: comment.page.userUid ?? null,
            updatedAt: comment.page.updatedAt ?? null,
          };
        }

        // 发送通知
        await sendCommentNotification({
          commentId: comment.id,
          target,
          parentId: comment.parentId,
          currentUid: comment.userUid,
          commenterName:
            comment.user?.nickname ||
            comment.user?.username ||
            comment.authorName ||
            "匿名用户",
          commenterEmail: comment.user?.email || comment.authorEmail || null,
          content: comment.content,
        });

        console.log(`已补发评论 ${comment.id} 的通知`);
      }
    } catch (error) {
      console.error("补发评论通知失败:", error);
    }
  });

  return response.ok({ message: "更新成功" });
}

export async function deleteComments(
  params: DeleteComments,
  serverConfig?: ActionConfig,
): Promise<ActionResult<null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "deleteComments"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(params, DeleteCommentsSchema);
  if (validationError) return response.badRequest(validationError);

  const authUser = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR", "AUTHOR"],
  });
  if (!authUser) return response.unauthorized();

  const { ids } = params;

  // 构建权限过滤条件
  const whereCondition: Prisma.CommentWhereInput = {
    id: { in: ids },
    deletedAt: null,
  };

  // AUTHOR 角色只能删除自己的评论或自己文章下的评论
  if (authUser.role === "AUTHOR") {
    whereCondition.OR = [
      // 自己发表的评论
      { userUid: authUser.uid },
      // 自己文章下的评论
      { post: { userUid: authUser.uid } },
    ];
  }

  const commentsToDelete = await prisma.comment.findMany({
    where: whereCondition,
    select: { id: true },
  });
  const deletedIds = commentsToDelete.map((c) => c.id);

  if (deletedIds.length > 0) {
    await prisma.comment.updateMany({
      where: { id: { in: deletedIds } },
      data: { deletedAt: new Date() },
    });

    // 记录审计日志
    await logAuditEvent({
      user: {
        uid: String(authUser.uid),
      },
      details: {
        action: "DELETE",
        resourceType: "COMMENT",
        resourceId: deletedIds.join(","),
        value: {
          old: { ids: deletedIds },
          new: { deletedAt: new Date() },
        },
        description: `批量删除评论: ${deletedIds.length} 条`,
      },
    });
  }

  return response.ok({ message: "删除成功" });
}

export async function getCommentsAdmin(
  params: GetCommentsAdmin,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CommentsAdminListResponse["data"] | null>>>;
export async function getCommentsAdmin(
  params: GetCommentsAdmin,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CommentsAdminListResponse["data"] | null>>;
export async function getCommentsAdmin(
  params: GetCommentsAdmin,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CommentsAdminListResponse["data"] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getCommentsAdmin"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(params, GetCommentsAdminSchema);
  if (validationError) return response.badRequest(validationError);

  const authUser = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR", "AUTHOR"],
  });
  if (!authUser) return response.unauthorized();

  const {
    page = 1,
    pageSize = 25,
    sortBy = "createdAt",
    sortOrder = "desc",
    status,
    slug,
    uid,
    search,
    parentOnly,
  } = params;

  const whereConditions: Prisma.CommentWhereInput[] = [{ deletedAt: null }];

  // AUTHOR 角色只能查看自己文章下的评论，不包含页面评论
  if (authUser.role === "AUTHOR") {
    whereConditions.push({ post: { userUid: authUser.uid } });
  }

  if (uid) {
    whereConditions.push({ userUid: uid });
  }
  if (parentOnly) {
    whereConditions.push({ parentId: null });
  }
  if (status?.length) {
    whereConditions.push({ status: { in: status } });
  }
  if (slug) {
    const normalizedPageSlug = toAbsolutePath(slug);
    whereConditions.push({
      OR: [{ post: { slug } }, { page: { slug: normalizedPageSlug } }],
    });
  }
  if (search) {
    whereConditions.push({
      OR: [
        { content: { contains: search } },
        { authorName: { contains: search } },
        { authorEmail: { contains: search } },
        { authorWebsite: { contains: search } },
        { user: { username: { contains: search } } },
        { user: { nickname: { contains: search } } },
      ],
    });
  }

  const where: Prisma.CommentWhereInput = { AND: whereConditions };

  const [total, rows] = await Promise.all([
    prisma.comment.count({ where }),
    prisma.comment.findMany({
      where,
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: adminCommentSelect,
    }),
  ]);

  const meta = buildPaginationMeta({
    page,
    pageSize,
    total,
    hasNext: page * pageSize < total,
  });

  // 批量查询点赞状态
  let likedCommentIds: Set<string> = new Set();
  if (rows.length > 0) {
    const commentIds = rows.map((r) => r.id);
    const likes = await prisma.commentLike.findMany({
      where: {
        commentId: { in: commentIds },
        userUid: authUser.uid,
      },
      select: { commentId: true },
    });
    likedCommentIds = new Set(likes.map((like) => like.commentId));
  }

  const data = await Promise.all(
    rows.map(async (row) => {
      const mapped = await mapCommentToItem(
        row as AdminComment,
        authUser.uid,
        true,
        undefined,
        likedCommentIds.has(row.id),
      );
      const target = resolveTargetFromRelations({
        post: row.post,
        page: row.page,
      });
      return {
        ...mapped,
        postTitle: target?.title ?? null,
        email: row.authorEmail,
        ipAddress: row.ipAddress,
        userAgent: row.userAgent,
      };
    }),
  );

  return response.ok({
    data: data as unknown as CommentsAdminListResponse["data"],
    meta,
  });
}

export async function getCommentHistory(
  params: GetCommentHistory,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CommentHistoryPoint[] | null>>>;
export async function getCommentHistory(
  params: GetCommentHistory,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CommentHistoryPoint[] | null>>;
export async function getCommentHistory(
  params: GetCommentHistory,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CommentHistoryPoint[] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getCommentHistory"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(params, GetCommentHistorySchema);
  if (validationError) return response.badRequest(validationError);

  const authUser = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR", "AUTHOR"],
    accessToken: params.access_token,
  });
  if (!authUser) return response.unauthorized();

  const now = new Date();
  const since = new Date(now.getTime() - params.days * 24 * 60 * 60 * 1000);

  const where: Prisma.CommentWhereInput = {
    createdAt: { gte: since },
    deletedAt: null,
  };

  // AUTHOR 角色只能查看自己文章下的评论统计
  if (authUser.role === "AUTHOR") {
    where.post = { userUid: authUser.uid };
  }

  const rows = await prisma.comment.findMany({
    where,
    select: {
      createdAt: true,
      status: true,
      post: { select: { slug: true, title: true } },
      page: { select: { slug: true, title: true } },
    },
  });

  const bucket = new Map<
    string,
    {
      total: number;
      approved: number;
      pending: number;
      posts: Map<string, number>;
    }
  >();
  const slugTitleMap = new Map<string, string | null>();

  rows.forEach((row) => {
    // 获取当天的起始时间（0点）作为分组键
    const date = new Date(row.createdAt);
    const dayStart = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
    );
    const dateStr = dayStart.toISOString();
    const item = bucket.get(dateStr) || {
      total: 0,
      approved: 0,
      pending: 0,
      posts: new Map<string, number>(),
    };

    const target = resolveTargetFromRelations({
      post: row.post,
      page: row.page,
    });
    if (target?.slug) {
      const targetSlug = target.slug;
      slugTitleMap.set(targetSlug, target.title ?? null);
      item.posts.set(targetSlug, (item.posts.get(targetSlug) || 0) + 1);
    }

    item.total += 1;
    if (row.status === "APPROVED") item.approved += 1;
    if (row.status === "PENDING") item.pending += 1;
    bucket.set(dateStr, item);
  });

  const data: CommentHistoryPoint[] = [];
  for (let i = params.days - 1; i >= 0; i -= 1) {
    const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const dayStart = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
    );
    const dateStr = dayStart.toISOString();
    const item = bucket.get(dateStr) || {
      total: 0,
      approved: 0,
      pending: 0,
      posts: new Map<string, number>(),
    };
    data.push({
      date: dateStr, // 返回完整 ISO 时间戳
      total: item.total,
      approved: item.approved,
      pending: item.pending,
      posts: Array.from(item.posts.entries()).map(([slug, count]) => ({
        slug,
        title: slugTitleMap.get(slug) ?? null,
        count,
      })),
    });
  }

  return response.ok({ data });
}

export async function getCommentStats(
  params: GetCommentStats,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CommentStats | null>>>;
export async function getCommentStats(
  params: GetCommentStats,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CommentStats | null>>;
export async function getCommentStats(
  { access_token, force }: GetCommentStats,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CommentStats | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getCommentStats"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    { access_token, force },
    GetCommentStatsSchema,
  );
  if (validationError) return response.badRequest(validationError);

  const authUser = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR", "AUTHOR"],
    accessToken: access_token,
  });
  if (!authUser) return response.unauthorized();

  try {
    const CACHE_KEY = generateCacheKey(
      "stats",
      "comments",
      authUser.role === "AUTHOR" ? `author-${authUser.uid}` : "global",
    );
    const CACHE_TTL = 60 * 60; // 1小时

    // 如果不是强制刷新，尝试从缓存获取
    if (!force) {
      const cachedData = await getCache<CommentStats>(CACHE_KEY, {
        ttl: CACHE_TTL,
      });

      if (cachedData) {
        return response.ok({
          data: cachedData,
        });
      }
    }

    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const baseWhere: Prisma.CommentWhereInput = { deletedAt: null };
    // AUTHOR 角色只能查看自己文章下的评论统计
    if (authUser.role === "AUTHOR") {
      baseWhere.post = { userUid: authUser.uid };
    }

    const [
      total,
      approved,
      pending,
      rejected,
      spam,
      latest,
      newLastDay,
      newLast7Days,
      newLast30Days,
    ] = await Promise.all([
      prisma.comment.count({ where: baseWhere }),
      prisma.comment.count({
        where: { ...baseWhere, status: "APPROVED" },
      }),
      prisma.comment.count({
        where: { ...baseWhere, status: "PENDING" },
      }),
      prisma.comment.count({
        where: { ...baseWhere, status: "REJECTED" },
      }),
      prisma.comment.count({
        where: { ...baseWhere, status: "SPAM" },
      }),
      prisma.comment.findFirst({
        where: baseWhere,
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
      prisma.comment.count({
        where: { ...baseWhere, createdAt: { gte: oneDayAgo } },
      }),
      prisma.comment.count({
        where: { ...baseWhere, createdAt: { gte: sevenDaysAgo } },
      }),
      prisma.comment.count({
        where: { ...baseWhere, createdAt: { gte: thirtyDaysAgo } },
      }),
    ]);

    const data: CommentStats = {
      updatedAt: now.toISOString(),
      cache: false,
      total,
      approved,
      pending,
      rejected,
      spam,
      lastCommentAt: latest?.createdAt?.toISOString() ?? null,
      new: {
        lastDay: newLastDay,
        last7Days: newLast7Days,
        last30Days: newLast30Days,
      },
    };

    // 保存到缓存（缓存1小时）
    const cacheData = { ...data, cache: true };
    await setCache(CACHE_KEY, cacheData, {
      ttl: CACHE_TTL,
    });

    return response.ok({ data });
  } catch (error) {
    console.error("GetCommentStats error:", error);
    return response.serverError();
  }
}

// 点赞评论
export async function likeComment(
  params: LikeComment,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<LikeCommentResponse["data"] | null>>>;
export async function likeComment(
  params: LikeComment,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<LikeCommentResponse["data"] | null>>;
export async function likeComment(
  params: LikeComment,
  serverConfig?: ActionConfig,
): Promise<ActionResult<LikeCommentResponse["data"] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "likeComment"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(params, LikeCommentSchema);
  if (validationError) return response.badRequest(validationError);

  // 必须登录
  const authUser = await authVerify({ allowedRoles: COMMENT_ROLES });
  if (!authUser) {
    return response.unauthorized({ message: "请登录后再点赞" });
  }

  const { commentId } = params;

  // 检查评论是否存在
  const comment = await prisma.comment.findUnique({
    where: { id: commentId, deletedAt: null },
    select: { id: true },
  });

  if (!comment) {
    return response.notFound({ message: "评论不存在" });
  }

  try {
    // 使用事务确保原子性
    const result = await prisma.$transaction(async (tx) => {
      // 检查是否已点赞
      const existingLike = await tx.commentLike.findUnique({
        where: {
          commentId_userUid: {
            commentId,
            userUid: authUser.uid,
          },
        },
      });

      if (existingLike) {
        // 已点赞，返回当前状态
        const comment = await tx.comment.findUnique({
          where: { id: commentId },
          select: { likeCount: true },
        });
        return {
          likeCount: comment?.likeCount ?? 0,
          isLiked: true,
        };
      }

      // 创建点赞记录并更新点赞数
      await tx.commentLike.create({
        data: {
          commentId,
          userUid: authUser.uid,
        },
      });

      const updatedComment = await tx.comment.update({
        where: { id: commentId },
        data: { likeCount: { increment: 1 } },
        select: { likeCount: true },
      });

      return {
        likeCount: updatedComment.likeCount,
        isLiked: true,
      };
    });

    return response.ok({ data: result });
  } catch (error) {
    console.error("LikeComment error:", error);
    return response.serverError({ message: "点赞失败，请稍后重试" });
  }
}

// 取消点赞评论
export async function unlikeComment(
  params: UnlikeComment,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<UnlikeCommentResponse["data"] | null>>>;
export async function unlikeComment(
  params: UnlikeComment,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<UnlikeCommentResponse["data"] | null>>;
export async function unlikeComment(
  params: UnlikeComment,
  serverConfig?: ActionConfig,
): Promise<ActionResult<UnlikeCommentResponse["data"] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "unlikeComment"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(params, UnlikeCommentSchema);
  if (validationError) return response.badRequest(validationError);

  // 必须登录
  const authUser = await authVerify({ allowedRoles: COMMENT_ROLES });
  if (!authUser) {
    return response.unauthorized({ message: "请登录后再操作" });
  }

  const { commentId } = params;

  try {
    // 使用事务确保原子性
    const result = await prisma.$transaction(async (tx) => {
      // 检查是否已点赞
      const existingLike = await tx.commentLike.findUnique({
        where: {
          commentId_userUid: {
            commentId,
            userUid: authUser.uid,
          },
        },
      });

      if (!existingLike) {
        // 未点赞，返回当前状态
        const comment = await tx.comment.findUnique({
          where: { id: commentId },
          select: { likeCount: true },
        });
        return {
          likeCount: comment?.likeCount ?? 0,
          isLiked: false,
        };
      }

      // 删除点赞记录并更新点赞数
      await tx.commentLike.delete({
        where: {
          commentId_userUid: {
            commentId,
            userUid: authUser.uid,
          },
        },
      });

      const updatedComment = await tx.comment.update({
        where: { id: commentId },
        data: { likeCount: { decrement: 1 } },
        select: { likeCount: true },
      });

      return {
        likeCount: updatedComment.likeCount,
        isLiked: false,
      };
    });

    return response.ok({ data: result });
  } catch (error) {
    console.error("UnlikeComment error:", error);
    return response.serverError({ message: "取消点赞失败，请稍后重试" });
  }
}

// 删除自己的评论
export async function deleteOwnComment(
  params: DeleteOwnComment,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<DeleteOwnCommentResponse["data"] | null>>>;
export async function deleteOwnComment(
  params: DeleteOwnComment,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<DeleteOwnCommentResponse["data"] | null>>;
export async function deleteOwnComment(
  params: DeleteOwnComment,
  serverConfig?: ActionConfig,
): Promise<ActionResult<DeleteOwnCommentResponse["data"] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "deleteOwnComment"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(params, DeleteOwnCommentSchema);
  if (validationError) return response.badRequest(validationError);

  // 必须登录
  const authUser = await authVerify({ allowedRoles: COMMENT_ROLES });
  if (!authUser) {
    return response.unauthorized({ message: "请登录后再操作" });
  }

  const { commentId } = params;

  // 检查评论是否存在且是当前用户的评论
  const comment = await prisma.comment.findUnique({
    where: { id: commentId, deletedAt: null },
    select: { id: true, userUid: true },
  });

  if (!comment) {
    return response.notFound({ message: "评论不存在" });
  }

  // 验证是评论的作者
  if (comment.userUid !== authUser.uid) {
    return response.forbidden({ message: "只能删除自己的评论" });
  }

  try {
    // 软删除评论
    await prisma.comment.update({
      where: { id: commentId },
      data: { deletedAt: new Date() },
    });

    return response.ok({ data: null, message: "评论已删除" });
  } catch (error) {
    console.error("DeleteOwnComment error:", error);
    return response.serverError({ message: "删除失败，请稍后重试" });
  }
}
