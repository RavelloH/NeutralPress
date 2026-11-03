import "server-only";

import type {
  ApiResponse,
  ApiResponseData,
  PaginationMeta,
} from "@repo/shared-types/api/common";
import type {
  CheckFriendLinks,
  CheckFriendLinksResult,
  CreateFriendLinkByAdmin,
  CreateFriendLinkByAdminResult,
  DeleteFriendLinkByAdmin,
  DeleteFriendLinkByAdminResult,
  DeleteOwnFriendLink,
  DeleteOwnFriendLinkResult,
  FriendLinkCheckHistoryItem,
  FriendLinkIssueType,
  FriendLinkListItem,
  FriendLinksStats,
  FriendLinkStatus,
  FriendLinkTrendItem,
  GetFriendLinkDetail,
  GetFriendLinksList,
  GetFriendLinksStats,
  GetFriendLinksTrends,
  GetOwnFriendLink,
  ParseFriendLinkByAdmin,
  ParseFriendLinkByAdminResult,
  ReviewFriendLink,
  ReviewFriendLinkResult,
  SubmitFriendLinkApplication,
  SubmitFriendLinkApplicationResult,
  UpdateFriendLinkByAdmin,
  UpdateFriendLinkByAdminResult,
  UpdateOwnFriendLink,
  UpdateOwnFriendLinkResult,
} from "@repo/shared-types/api/friendlink";
import {
  CheckFriendLinksSchema,
  CreateFriendLinkByAdminSchema,
  DeleteFriendLinkByAdminSchema,
  DeleteOwnFriendLinkSchema,
  GetFriendLinkDetailSchema,
  GetFriendLinksListSchema,
  GetFriendLinksStatsSchema,
  GetFriendLinksTrendsSchema,
  GetOwnFriendLinkSchema,
  ParseFriendLinkByAdminSchema,
  ReviewFriendLinkSchema,
  SubmitFriendLinkApplicationSchema,
  UpdateFriendLinkByAdminSchema,
  UpdateOwnFriendLinkSchema,
} from "@repo/shared-types/api/friendlink";
import { updateTag } from "next/cache";
import { headers } from "next/headers";
import type { NextResponse } from "next/server";

import { logAuditEvent } from "@/lib/server/audit";
import type { UserRole } from "@/lib/server/auth-verify";
import { authVerify } from "@/lib/server/auth-verify";
import { verifyToken } from "@/lib/server/captcha";
import { getConfig, getConfigs } from "@/lib/server/config-cache";
import { runFriendLinksCheck } from "@/lib/server/cron-task-runner";
import { sendNotice } from "@/lib/server/notice";
import prisma from "@/lib/server/prisma";
import limitControl from "@/lib/server/rate-limit";
import ResponseBuilder from "@/lib/server/response";
import { fetchPublicHttpUrlBuffer } from "@/lib/server/url-security";
import { validateData } from "@/lib/server/validator";

import type { Prisma } from ".prisma/client";

type ActionEnvironment = "serverless" | "serveraction";
type ActionConfig = { environment?: ActionEnvironment };
type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

const USER_ROLES: UserRole[] = ["USER", "ADMIN", "EDITOR", "AUTHOR"];
const ADMIN_ROLES: UserRole[] = ["ADMIN"];
const BACKLINK_CHECK_MAX_REDIRECTS = 3;
const BACKLINK_CHECK_MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2MB

function invalidateFriendLinkCache(): void {
  updateTag("friend-links");
}

const FAILURE_ISSUE_TYPES: FriendLinkIssueType[] = [
  "DISCONNECT",
  "NO_BACKLINK",
];

type FriendLinkRecordWithUsers = Prisma.FriendLinkGetPayload<{
  include: {
    owner: {
      select: {
        uid: true;
        username: true;
        nickname: true;
      };
    };
    auditor: {
      select: {
        uid: true;
        username: true;
        nickname: true;
      };
    };
  };
}>;

type ParseCheckHistoryOptions = {
  url?: string | null;
  friendLinkUrl?: string | null;
  defaultCheckType?: "url" | "backlink";
  defaultTargetUrl?: string | null;
};

function getPaginationMeta(
  page: number,
  pageSize: number,
  total: number,
): PaginationMeta {
  const totalPages = Math.ceil(total / pageSize);
  return {
    page,
    pageSize,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getDomainFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

function parseCheckHistory(
  rawHistory: Prisma.JsonValue,
  options: ParseCheckHistoryOptions = {},
): FriendLinkCheckHistoryItem[] {
  if (!Array.isArray(rawHistory)) return [];

  const normalized: FriendLinkCheckHistoryItem[] = [];

  for (const item of rawHistory) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      continue;
    }

    const obj = item as Record<string, unknown>;
    const issueType = String(obj.issueType || "NONE");
    const normalizedIssueType = FAILURE_ISSUE_TYPES.includes(
      issueType as FriendLinkIssueType,
    )
      ? (issueType as FriendLinkIssueType)
      : "NONE";
    const statusCode =
      typeof obj.statusCode === "number" ? Math.round(obj.statusCode) : null;
    const hasBacklink =
      typeof obj.hasBacklink === "boolean" ? obj.hasBacklink : undefined;
    const explicitCheckType =
      obj.checkType === "backlink" || obj.checkType === "url"
        ? obj.checkType
        : null;
    const checkType =
      explicitCheckType ||
      options.defaultCheckType ||
      (typeof hasBacklink === "boolean" ? "backlink" : "url");
    const targetUrl =
      typeof obj.targetUrl === "string" && obj.targetUrl.trim().length > 0
        ? obj.targetUrl
        : options.defaultTargetUrl ||
          (checkType === "backlink"
            ? options.friendLinkUrl || options.url || ""
            : options.url || "");
    const ok =
      typeof obj.ok === "boolean" ? obj.ok : normalizedIssueType === "NONE";
    const note =
      typeof obj.note === "string"
        ? obj.note
        : normalizedIssueType === "DISCONNECT"
          ? statusCode == null
            ? "请求失败"
            : `HTTP 状态码 ${statusCode}`
          : normalizedIssueType === "NO_BACKLINK"
            ? "未在友链页面中检测到本站域名"
            : undefined;

    normalized.push({
      time: String(obj.time || new Date(0).toISOString()),
      checkType,
      targetUrl,
      responseTime:
        typeof obj.responseTime === "number"
          ? Math.max(0, Math.round(obj.responseTime))
          : null,
      statusCode,
      ok,
      hasBacklink,
      issueType: normalizedIssueType,
      note,
    });
  }

  return normalized;
}

function toFriendLinkListItem(
  record: FriendLinkRecordWithUsers,
  options?: {
    includeHistory?: boolean;
  },
): FriendLinkListItem {
  const history = parseCheckHistory(record.checkHistory, {
    url: record.url,
    friendLinkUrl: record.friendLinkUrl,
  });
  const recentSampleCount = history.length;
  const recentSuccessCount = history.filter(
    (item) => item.issueType === "NONE",
  ).length;
  const recentSuccessRate =
    recentSampleCount > 0
      ? Number(((recentSuccessCount / recentSampleCount) * 100).toFixed(1))
      : null;

  return {
    id: record.id,
    name: record.name,
    url: record.url,
    avatar: record.avatar,
    slogan: record.slogan,
    friendLinkUrl: record.friendLinkUrl,
    ignoreBacklink: record.ignoreBacklink,
    group: record.group,
    order: record.order,
    status: record.status as FriendLinkStatus,
    checkSuccessCount: record.checkSuccessCount,
    checkFailureCount: record.checkFailureCount,
    recentSuccessRate,
    recentSampleCount,
    lastCheckedAt: record.lastCheckedAt?.toISOString() || null,
    avgResponseTime: record.avgResponseTime,
    applyNote: record.applyNote,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    publishedAt: record.publishedAt?.toISOString() || null,
    owner: record.owner
      ? {
          uid: record.owner.uid,
          username: record.owner.username,
          nickname: record.owner.nickname,
        }
      : null,
    auditor: record.auditor
      ? {
          uid: record.auditor.uid,
          username: record.auditor.username,
          nickname: record.auditor.nickname,
        }
      : null,
    checkHistory: options?.includeHistory === false ? [] : history,
  };
}

async function getAdminUids(): Promise<number[]> {
  const admins = await prisma.user.findMany({
    where: {
      role: "ADMIN",
      deletedAt: null,
    },
    select: {
      uid: true,
    },
  });

  return admins.map((admin) => admin.uid);
}

async function notifyManyUsers(
  userUids: number[],
  title: string,
  content: string,
  link?: string,
): Promise<void> {
  for (const uid of userUids) {
    try {
      await sendNotice(uid, title, content, link);
    } catch (error) {
      console.error(`[FriendLink] 向用户 ${uid} 发送通知失败:`, error);
    }
  }
}

async function notifyAdminsForApplication(params: {
  applicantUid: number;
  applicantUsername: string;
  applicantNickname?: string | null;
  friendLinkId: number;
  name: string;
  url: string;
  friendLinkUrl: string;
  slogan: string;
  applyNote?: string | null;
  siteUrl: string;
}): Promise<void> {
  const adminUids = await getAdminUids();
  if (adminUids.length === 0) return;

  const applicantDisplayName =
    params.applicantNickname?.trim() || params.applicantUsername;
  const adminLink = `${params.siteUrl}/admin/friends?status=PENDING&search=${encodeURIComponent(params.name)}`;
  const title = `新的友链申请：${params.name}`;
  const content = [
    `申请人：${applicantDisplayName}（UID: ${params.applicantUid}）`,
    `站点地址：${params.url}`,
    `友链页面：${params.friendLinkUrl}`,
    `站点标语：${params.slogan}`,
    `申请备注：${params.applyNote?.trim() || "无"}`,
    `记录 ID：${params.friendLinkId}`,
  ].join("\n");

  await notifyManyUsers(adminUids, title, content, adminLink);
}

async function requestUrlWithTiming(url: string): Promise<{
  ok: boolean;
  statusCode: number | null;
  responseTime: number | null;
  html: string | null;
  finalUrl: string | null;
  errorMessage?: string;
}> {
  const start = performance.now();

  try {
    const fetched = await fetchPublicHttpUrlBuffer(url.trim(), {
      method: "GET",
      timeoutMs: 10000,
      maxBytes: BACKLINK_CHECK_MAX_RESPONSE_BYTES,
      maxRedirects: BACKLINK_CHECK_MAX_REDIRECTS,
      headers: {
        "User-Agent": "NeutralPress FriendLinkChecker/1.0",
      },
    });
    const end = performance.now();
    const responseTime = Math.max(0, Math.round(end - start));

    return {
      ok: fetched.status >= 200 && fetched.status < 300,
      statusCode: fetched.status,
      responseTime,
      html: fetched.body.toString("utf-8"),
      finalUrl: fetched.finalUrl,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "请求失败，未知错误";
    return {
      ok: false,
      statusCode: null,
      responseTime: null,
      html: null,
      finalUrl: null,
      errorMessage: message,
    };
  }
}

function hasBacklinkInHtml(html: string, siteDomain: string): boolean {
  const escapedDomain = escapeRegex(siteDomain);

  const domainRegex = new RegExp(
    `https?:\\/\\/(?:[^"'>\\s]*\\.)?${escapedDomain}(?:[\\/"'\\s]|$)`,
    "i",
  );
  if (domainRegex.test(html)) return true;

  const plainDomainRegex = new RegExp(`\\b${escapedDomain}\\b`, "i");
  return plainDomainRegex.test(html);
}

function normalizeSiteUrlInput(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error("站点 URL 不能为空");
  }

  const withProtocol = /^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  const parsed = new URL(withProtocol);

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("仅支持 http/https 协议");
  }

  parsed.hash = "";
  return parsed.toString();
}

function decodeHtmlEntities(text: string): string {
  if (!text) return "";

  const namedEntities: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&nbsp;": " ",
  };

  let decoded = text.replace(
    /&(amp|lt|gt|quot|#39|apos|nbsp);/gi,
    (entity) => namedEntities[entity.toLowerCase()] || entity,
  );

  decoded = decoded.replace(/&#(\d+);/g, (_, num) => {
    const codePoint = Number.parseInt(num, 10);
    if (!Number.isFinite(codePoint)) return _;
    return String.fromCodePoint(codePoint);
  });

  decoded = decoded.replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
    const codePoint = Number.parseInt(hex, 16);
    if (!Number.isFinite(codePoint)) return _;
    return String.fromCodePoint(codePoint);
  });

  return decoded;
}

function cleanParsedText(text: string): string {
  return decodeHtmlEntities(text).replace(/\s+/g, " ").trim();
}

function extractHtmlAttribute(tag: string, attribute: string): string | null {
  const quotedRegex = new RegExp(
    `${attribute}\\s*=\\s*(['"])([\\s\\S]*?)\\1`,
    "i",
  );
  const quotedMatch = tag.match(quotedRegex);
  if (quotedMatch?.[2]) {
    return cleanParsedText(quotedMatch[2]);
  }

  const unquotedRegex = new RegExp(`${attribute}\\s*=\\s*([^\\s"'>]+)`, "i");
  const unquotedMatch = tag.match(unquotedRegex);
  if (unquotedMatch?.[1]) {
    return cleanParsedText(unquotedMatch[1]);
  }

  return null;
}

function selectFirstNonEmpty(values: Array<string | null | undefined>): string {
  for (const value of values) {
    if (value && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function toAbsoluteUrl(candidateUrl: string, baseUrl: string): string | null {
  const raw = candidateUrl.trim();
  if (!raw) return null;

  try {
    const parsed = new URL(raw, baseUrl);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== "http:" && protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function extractTitleFromHtml(html: string): string {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (!match?.[1]) return "";
  return cleanParsedText(match[1].replace(/<[^>]+>/g, ""));
}

function extractMetaMap(html: string): Map<string, string> {
  const map = new Map<string, string>();
  const tags = html.match(/<meta\b[^>]*>/gi) || [];

  for (const tag of tags) {
    const key = (
      extractHtmlAttribute(tag, "property") ||
      extractHtmlAttribute(tag, "name") ||
      extractHtmlAttribute(tag, "http-equiv")
    )
      ?.trim()
      .toLowerCase();
    const content = extractHtmlAttribute(tag, "content");

    if (!key || !content) continue;
    if (!map.has(key)) {
      map.set(key, content);
    }
  }

  return map;
}

function extractFriendLinkUrlFromHtml(html: string, baseUrl: string): string {
  const anchorRegex =
    /<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  const textKeywords = [
    "友链",
    "友情链接",
    "友人帐",
    "小伙伴",
    "friend links",
    "friend link",
    "friends",
    "blogroll",
  ];
  const pathKeywords = ["friend", "friends", "links", "blogroll", "youqing"];

  let bestCandidate = "";
  let bestScore = 0;
  let match: RegExpExecArray | null;
  while ((match = anchorRegex.exec(html)) !== null) {
    const hrefRaw = match[1] || match[2] || match[3] || "";
    const href = toAbsoluteUrl(hrefRaw, baseUrl);
    if (!href) continue;

    const text = cleanParsedText((match[4] || "").replace(/<[^>]+>/g, ""));
    const hrefLower = href.toLowerCase();
    const textLower = text.toLowerCase();

    let score = 0;
    if (textKeywords.some((keyword) => textLower.includes(keyword))) {
      score += 3;
    }
    if (pathKeywords.some((keyword) => hrefLower.includes(keyword))) {
      score += 2;
    }
    if (/\/(?:friends?|links?|blogroll)(?:\/|$)/i.test(href)) {
      score += 1;
    }

    if (score > bestScore) {
      bestScore = score;
      bestCandidate = href;
    }
  }

  return bestScore > 0 ? bestCandidate : "";
}

function extractPreferredAvatarUrl(
  html: string,
  metaMap: Map<string, string>,
  baseUrl: string,
): string {
  const linkTags = html.match(/<link\b[^>]*>/gi) || [];
  const iconCandidates: Array<{
    url: string;
    priority: number;
    size: number;
  }> = [];

  for (const tag of linkTags) {
    const rel = extractHtmlAttribute(tag, "rel")?.toLowerCase() || "";
    const hrefRaw = extractHtmlAttribute(tag, "href");
    if (!hrefRaw) continue;

    const href = toAbsoluteUrl(hrefRaw, baseUrl);
    if (!href) continue;

    let priority = 0;
    if (rel.includes("apple-touch-icon")) {
      priority = 3;
    } else if (rel.includes("shortcut icon")) {
      priority = 2;
    } else if (rel.includes("icon")) {
      priority = 1;
    }

    if (priority <= 0) continue;

    const sizesRaw = extractHtmlAttribute(tag, "sizes") || "";
    const size = sizesRaw
      .split(/\s+/)
      .map((token) => {
        const sizeMatch = token.match(/^(\d+)x(\d+)$/i);
        if (!sizeMatch) return 0;
        const width = Number.parseInt(sizeMatch[1] || "0", 10);
        const height = Number.parseInt(sizeMatch[2] || "0", 10);
        return Math.max(width, height);
      })
      .reduce((max, current) => Math.max(max, current), 0);

    iconCandidates.push({
      url: href,
      priority,
      size,
    });
  }

  iconCandidates.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return b.size - a.size;
  });

  const metaImage = selectFirstNonEmpty([
    metaMap.get("og:image"),
    metaMap.get("twitter:image"),
  ]);
  const metaImageUrl = metaImage ? toAbsoluteUrl(metaImage, baseUrl) : null;
  if (iconCandidates.length > 0) {
    return iconCandidates[0]?.url || "";
  }
  if (metaImageUrl) {
    return metaImageUrl;
  }

  try {
    const origin = new URL(baseUrl).origin;
    return new URL("/favicon.ico", origin).toString();
  } catch {
    return "";
  }
}

function parseFriendLinkFromHtml(
  html: string,
  baseUrl: string,
): {
  name: string;
  slogan: string;
  avatar: string;
  friendLinkUrl: string | null;
} {
  const metaMap = extractMetaMap(html);
  const pageTitle = extractTitleFromHtml(html);
  const hostname = getDomainFromUrl(baseUrl) || "未知站点";

  const name = selectFirstNonEmpty([
    metaMap.get("og:site_name"),
    metaMap.get("application-name"),
    metaMap.get("apple-mobile-web-app-title"),
    metaMap.get("og:title"),
    pageTitle,
    hostname,
  ]);
  const slogan = selectFirstNonEmpty([
    metaMap.get("description"),
    metaMap.get("og:description"),
    metaMap.get("twitter:description"),
    pageTitle,
    hostname,
  ]);
  const avatar = extractPreferredAvatarUrl(html, metaMap, baseUrl);
  const friendLinkUrl = extractFriendLinkUrlFromHtml(html, baseUrl);

  return {
    name: name || hostname,
    slogan: slogan || hostname,
    avatar: avatar || "",
    friendLinkUrl: friendLinkUrl || null,
  };
}

export async function submitFriendLinkApplication(
  params: SubmitFriendLinkApplication,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<SubmitFriendLinkApplicationResult | null>>>;
export async function submitFriendLinkApplication(
  params: SubmitFriendLinkApplication,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<SubmitFriendLinkApplicationResult | null>>;
export async function submitFriendLinkApplication(
  params: SubmitFriendLinkApplication,
  serverConfig?: ActionConfig,
): Promise<ActionResult<SubmitFriendLinkApplicationResult | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "submitFriendLinkApplication"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    params,
    SubmitFriendLinkApplicationSchema,
  );
  if (validationError) return response.badRequest(validationError);

  const captchaResult = await verifyToken(params.captcha_token);
  if (!captchaResult.success) {
    return response.unauthorized({
      message: "安全验证失败，请刷新页面重试",
    });
  }

  const user = await authVerify({
    accessToken: params.access_token,
    allowedRoles: USER_ROLES,
  });
  if (!user) {
    return response.unauthorized({ message: "请先登录" });
  }

  const applyEnabled = await getConfig("friendlink.apply.enable");
  if (!applyEnabled) {
    return response.forbidden({
      message: "当前站点未开启友链申请",
    });
  }

  try {
    const existing = await prisma.friendLink.findUnique({
      where: {
        ownerId: user.uid,
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (existing?.status === "BLOCKED") {
      return response.forbidden({
        message: "当前账户已被拉黑，无法继续提交友链申请",
      });
    }

    const [checkBackLinkEnabled, siteUrl] = await getConfigs([
      "friendlink.apply.checkBackLink.enable",
      "site.url",
    ]);
    if (checkBackLinkEnabled) {
      const siteDomain = getDomainFromUrl(siteUrl);
      if (!siteDomain) {
        return response.serverError({
          message: "站点配置异常，暂时无法校验回链",
        });
      }

      const backlinkResult = await requestUrlWithTiming(
        params.friendLinkUrl.trim(),
      );
      if (!backlinkResult.ok) {
        return response.badRequest({
          message:
            backlinkResult.statusCode == null
              ? "回链检查未通过：无法访问对方友链页"
              : `回链检查未通过：对方友链页返回 HTTP ${backlinkResult.statusCode}`,
        });
      }

      const hasBacklink = hasBacklinkInHtml(
        backlinkResult.html || "",
        siteDomain,
      );
      if (!hasBacklink) {
        return response.badRequest({
          message: "回链检查未通过：未在友链页面检测到本站域名",
        });
      }
    }

    const payload = {
      name: params.name.trim(),
      url: params.url.trim(),
      avatar: params.avatar.trim(),
      slogan: params.slogan.trim(),
      friendLinkUrl: params.friendLinkUrl.trim(),
      applyNote: params.applyNote?.trim() || null,
      status: "PENDING" as const,
      auditorId: null,
      publishedAt: null,
      deletedAt: null,
    };

    const friendLink = existing
      ? await prisma.friendLink.update({
          where: {
            id: existing.id,
          },
          data: payload,
          select: {
            id: true,
            status: true,
          },
        })
      : await prisma.friendLink.create({
          data: {
            ...payload,
            ownerId: user.uid,
          },
          select: {
            id: true,
            status: true,
          },
        });

    invalidateFriendLinkCache();

    await notifyAdminsForApplication({
      applicantUid: user.uid,
      applicantUsername: user.username,
      applicantNickname: user.nickname,
      friendLinkId: friendLink.id,
      name: payload.name,
      url: payload.url,
      friendLinkUrl: payload.friendLinkUrl,
      slogan: payload.slogan,
      applyNote: payload.applyNote,
      siteUrl,
    });

    return response.ok({
      message: "友链申请已提交，请等待管理员审核",
      data: {
        id: friendLink.id,
        status: friendLink.status as FriendLinkStatus,
      },
    }) as ActionResult<SubmitFriendLinkApplicationResult | null>;
  } catch (error) {
    console.error("[FriendLink] 提交申请失败:", error);
    return response.serverError({
      message: "提交申请失败，请稍后重试",
    });
  }
}

export async function getOwnFriendLink(
  params: GetOwnFriendLink,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<FriendLinkListItem | null>>>;
export async function getOwnFriendLink(
  params?: GetOwnFriendLink,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<FriendLinkListItem | null>>;
export async function getOwnFriendLink(
  params: GetOwnFriendLink = {},
  serverConfig?: ActionConfig,
): Promise<ActionResult<FriendLinkListItem | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getOwnFriendLink"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(params, GetOwnFriendLinkSchema);
  if (validationError) return response.badRequest(validationError);

  const user = await authVerify({
    accessToken: params.access_token,
    allowedRoles: USER_ROLES,
  });
  if (!user) {
    return response.unauthorized({
      message: "请先登录",
    });
  }

  try {
    const record = await prisma.friendLink.findUnique({
      where: {
        ownerId: user.uid,
        deletedAt: null,
      },
      include: {
        owner: {
          select: {
            uid: true,
            username: true,
            nickname: true,
          },
        },
        auditor: {
          select: {
            uid: true,
            username: true,
            nickname: true,
          },
        },
      },
    });

    if (!record) {
      return response.ok({
        message: "暂无友链记录",
        data: null,
      }) as ActionResult<FriendLinkListItem | null>;
    }

    return response.ok({
      message: "获取友链信息成功",
      data: toFriendLinkListItem(record),
    }) as ActionResult<FriendLinkListItem | null>;
  } catch (error) {
    console.error("[FriendLink] 获取我的友链失败:", error);
    return response.serverError({
      message: "获取友链信息失败，请稍后重试",
    });
  }
}

export async function updateOwnFriendLink(
  params: UpdateOwnFriendLink,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<UpdateOwnFriendLinkResult | null>>>;
export async function updateOwnFriendLink(
  params: UpdateOwnFriendLink,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<UpdateOwnFriendLinkResult | null>>;
export async function updateOwnFriendLink(
  params: UpdateOwnFriendLink,
  serverConfig?: ActionConfig,
): Promise<ActionResult<UpdateOwnFriendLinkResult | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "updateOwnFriendLink"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(params, UpdateOwnFriendLinkSchema);
  if (validationError) return response.badRequest(validationError);

  const user = await authVerify({
    accessToken: params.access_token,
    allowedRoles: USER_ROLES,
  });
  if (!user) {
    return response.unauthorized({
      message: "请先登录",
    });
  }

  try {
    const current = await prisma.friendLink.findUnique({
      where: {
        ownerId: user.uid,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        status: true,
      },
    });

    if (!current) {
      return response.notFound({
        message: "未找到您的友链记录",
      });
    }

    if (!["PUBLISHED", "WHITELIST"].includes(current.status)) {
      return response.forbidden({
        message: "当前状态下无法自助修改，请先通过审核",
      });
    }

    const updated = await prisma.friendLink.update({
      where: {
        id: current.id,
        deletedAt: null,
      },
      data: {
        name: params.name.trim(),
        url: params.url.trim(),
        avatar: params.avatar.trim(),
        slogan: params.slogan.trim(),
        friendLinkUrl: params.friendLinkUrl.trim(),
        applyNote: params.applyNote?.trim() || null,
      },
      select: {
        id: true,
        updatedAt: true,
      },
    });

    invalidateFriendLinkCache();

    return response.ok({
      message: "友链信息已更新",
      data: {
        id: updated.id,
        updatedAt: updated.updatedAt.toISOString(),
      },
    }) as ActionResult<UpdateOwnFriendLinkResult | null>;
  } catch (error) {
    console.error("[FriendLink] 更新友链失败:", error);
    return response.serverError({
      message: "更新失败，请稍后重试",
    });
  }
}

export async function deleteOwnFriendLink(
  params: DeleteOwnFriendLink,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<DeleteOwnFriendLinkResult | null>>>;
export async function deleteOwnFriendLink(
  params?: DeleteOwnFriendLink,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<DeleteOwnFriendLinkResult | null>>;
export async function deleteOwnFriendLink(
  params: DeleteOwnFriendLink = {},
  serverConfig?: ActionConfig,
): Promise<ActionResult<DeleteOwnFriendLinkResult | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "deleteOwnFriendLink"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(params, DeleteOwnFriendLinkSchema);
  if (validationError) return response.badRequest(validationError);

  const user = await authVerify({
    accessToken: params.access_token,
    allowedRoles: USER_ROLES,
  });
  if (!user) {
    return response.unauthorized({
      message: "请先登录",
    });
  }

  try {
    const current = await prisma.friendLink.findUnique({
      where: {
        ownerId: user.uid,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        status: true,
      },
    });

    if (!current) {
      return response.notFound({
        message: "未找到您的友链记录",
      });
    }

    if (current.status === "BLOCKED") {
      return response.forbidden({
        message: "当前账户已被拉黑，无法删除友链记录",
      });
    }

    const deletedAt = new Date();
    await prisma.friendLink.update({
      where: {
        id: current.id,
        deletedAt: null,
      },
      data: {
        deletedAt,
      },
    });

    invalidateFriendLinkCache();

    await logAuditEvent({
      user: {
        uid: String(user.uid),
      },
      details: {
        action: "DELETE",
        resourceType: "FRIEND_LINK",
        resourceId: String(current.id),
        value: {
          old: {
            id: current.id,
            name: current.name,
            ownerId: user.uid,
          },
          new: null,
        },
        description: `用户删除了友链「${current.name}」`,
        metadata: {
          id: current.id,
        },
      },
    });

    return response.ok({
      message: "友链记录已删除",
      data: {
        id: current.id,
        deletedAt: deletedAt.toISOString(),
      },
    }) as ActionResult<DeleteOwnFriendLinkResult | null>;
  } catch (error) {
    console.error("[FriendLink] 删除我的友链失败:", error);
    return response.serverError({
      message: "删除失败，请稍后重试",
    });
  }
}

export async function getFriendLinkDetail(
  params: GetFriendLinkDetail,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<FriendLinkListItem | null>>>;
export async function getFriendLinkDetail(
  params: GetFriendLinkDetail,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<FriendLinkListItem | null>>;
export async function getFriendLinkDetail(
  params: GetFriendLinkDetail,
  serverConfig?: ActionConfig,
): Promise<ActionResult<FriendLinkListItem | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getFriendLinkDetail"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(params, GetFriendLinkDetailSchema);
  if (validationError) return response.badRequest(validationError);

  const admin = await authVerify({
    accessToken: params.access_token,
    allowedRoles: ADMIN_ROLES,
  });
  if (!admin) {
    return response.unauthorized({
      message: "需要管理员权限",
    });
  }

  try {
    const record = await prisma.friendLink.findUnique({
      where: {
        id: params.id,
        deletedAt: null,
      },
      include: {
        owner: {
          select: {
            uid: true,
            username: true,
            nickname: true,
          },
        },
        auditor: {
          select: {
            uid: true,
            username: true,
            nickname: true,
          },
        },
      },
    });

    if (!record) {
      return response.notFound({
        message: "友链记录不存在",
      });
    }

    return response.ok({
      message: "获取友链详情成功",
      data: toFriendLinkListItem(record),
    }) as ActionResult<FriendLinkListItem | null>;
  } catch (error) {
    console.error("[FriendLink] 获取详情失败:", error);
    return response.serverError({
      message: "获取详情失败，请稍后重试",
    });
  }
}

export async function updateFriendLinkByAdmin(
  params: UpdateFriendLinkByAdmin,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<UpdateFriendLinkByAdminResult | null>>>;
export async function updateFriendLinkByAdmin(
  params: UpdateFriendLinkByAdmin,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<UpdateFriendLinkByAdminResult | null>>;
export async function updateFriendLinkByAdmin(
  params: UpdateFriendLinkByAdmin,
  serverConfig?: ActionConfig,
): Promise<ActionResult<UpdateFriendLinkByAdminResult | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "updateFriendLinkByAdmin"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(params, UpdateFriendLinkByAdminSchema);
  if (validationError) return response.badRequest(validationError);

  const admin = await authVerify({
    accessToken: params.access_token,
    allowedRoles: ADMIN_ROLES,
  });
  if (!admin) {
    return response.unauthorized({
      message: "需要管理员权限",
    });
  }

  try {
    const current = await prisma.friendLink.findUnique({
      where: {
        id: params.id,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        status: true,
        ownerId: true,
        publishedAt: true,
      },
    });

    if (!current) {
      return response.notFound({
        message: "友链记录不存在",
      });
    }

    const nextStatus = params.status as FriendLinkStatus;
    const nextFriendLinkUrl = params.friendLinkUrl?.trim() || null;
    const nextAvatar = params.avatar?.trim() || null;
    const nextSlogan = params.slogan?.trim() || null;
    const nextGroup = params.group?.trim() || null;
    const nextApplyNote = params.applyNote?.trim() || null;
    const requestedOwnerUid =
      typeof params.ownerUid === "number"
        ? params.ownerUid
        : params.ownerUid === null
          ? null
          : undefined;
    const shouldUpdateOwner =
      requestedOwnerUid !== undefined && requestedOwnerUid !== current.ownerId;
    const nextOwnerIdForUpdate = shouldUpdateOwner
      ? typeof requestedOwnerUid === "number"
        ? requestedOwnerUid
        : null
      : undefined;

    if (shouldUpdateOwner && typeof requestedOwnerUid === "number") {
      const targetUser = await prisma.user.findFirst({
        where: {
          uid: requestedOwnerUid,
          deletedAt: null,
        },
        select: {
          uid: true,
        },
      });
      if (!targetUser) {
        return response.badRequest({
          message: `目标用户不存在或已被删除（UID: ${requestedOwnerUid}）`,
        });
      }

      const occupied = await prisma.friendLink.findFirst({
        where: {
          ownerId: requestedOwnerUid,
          deletedAt: null,
          id: {
            not: current.id,
          },
        },
        select: {
          id: true,
          name: true,
        },
      });
      if (occupied) {
        return response.badRequest({
          message: `该用户已绑定友链「${occupied.name}」（ID: ${occupied.id}）`,
        });
      }
    }

    const updated = await prisma.friendLink.update({
      where: {
        id: current.id,
        deletedAt: null,
      },
      data: {
        name: params.name.trim(),
        url: params.url.trim(),
        avatar: nextAvatar,
        slogan: nextSlogan,
        friendLinkUrl: nextFriendLinkUrl,
        applyNote: nextApplyNote,
        ignoreBacklink: params.ignoreBacklink,
        group: nextGroup,
        order: params.order,
        status: nextStatus,
        auditorId: admin.uid,
        ...(shouldUpdateOwner ? { ownerId: nextOwnerIdForUpdate } : {}),
        ...(["PUBLISHED", "WHITELIST"].includes(nextStatus) &&
        !current.publishedAt
          ? { publishedAt: new Date() }
          : {}),
      },
      select: {
        id: true,
        status: true,
        updatedAt: true,
        ownerId: true,
      },
    });

    invalidateFriendLinkCache();

    const noticeApplicantEnabled = await getConfig(
      "friendlink.noticeApplicant.enable",
    );
    const shouldNotifyStatus =
      noticeApplicantEnabled &&
      updated.ownerId &&
      updated.status !== current.status &&
      ["PUBLISHED", "REJECTED"].includes(updated.status);
    const shouldNotifyOwnerTransfer = shouldUpdateOwner;

    if (shouldNotifyStatus || shouldNotifyOwnerTransfer) {
      const siteUrl = await getConfig("site.url");
      const userLink = `${siteUrl}/friends/new`;

      if (shouldNotifyStatus && updated.ownerId) {
        const title =
          updated.status === "PUBLISHED"
            ? "您的友链已更新为发布状态"
            : "您的友链状态已更新为拒绝";
        const content =
          updated.status === "PUBLISHED"
            ? `管理员已更新你的友链「${params.name.trim()}」，当前状态：已发布。`
            : `管理员已更新你的友链「${params.name.trim()}」，当前状态：已拒绝。`;
        await notifyManyUsers([updated.ownerId], title, content, userLink);
      }

      if (shouldNotifyOwnerTransfer) {
        const oldOwnerUid = current.ownerId;
        const newOwnerUid =
          typeof requestedOwnerUid === "number" ? requestedOwnerUid : null;
        const transferUids = [oldOwnerUid, newOwnerUid].filter(
          (uid): uid is number => typeof uid === "number",
        );
        const transferUsers =
          transferUids.length > 0
            ? await prisma.user.findMany({
                where: {
                  uid: {
                    in: transferUids,
                  },
                },
                select: {
                  uid: true,
                  username: true,
                  nickname: true,
                },
              })
            : [];
        const userNameMap = new Map(
          transferUsers.map((user) => [
            user.uid,
            user.nickname?.trim() || user.username,
          ]),
        );

        if (typeof oldOwnerUid === "number") {
          const toText =
            typeof newOwnerUid === "number"
              ? `${userNameMap.get(newOwnerUid) || `UID ${newOwnerUid}`}（UID: ${newOwnerUid}）`
              : "未绑定用户";
          await notifyManyUsers(
            [oldOwnerUid],
            "您的友链绑定已变更",
            [
              `管理员已将友链「${params.name.trim()}」（ID: ${current.id}）从您的账户转出。`,
              `当前绑定目标：${toText}。`,
            ].join("\n"),
            userLink,
          );
        }

        if (typeof newOwnerUid === "number") {
          const fromText =
            typeof oldOwnerUid === "number"
              ? `${userNameMap.get(oldOwnerUid) || `UID ${oldOwnerUid}`}（UID: ${oldOwnerUid}）`
              : "未绑定用户";
          await notifyManyUsers(
            [newOwnerUid],
            "您有新的友链绑定",
            [
              `管理员已将友链「${params.name.trim()}」（ID: ${current.id}）绑定到您的账户。`,
              `转入来源：${fromText}。`,
              "现在可以在友链页面查看和维护此记录。",
            ].join("\n"),
            userLink,
          );
        }
      }
    }

    try {
      await logAuditEvent({
        user: {
          uid: String(admin.uid),
        },
        details: {
          action: "UPDATE",
          resourceType: "FRIEND_LINK",
          resourceId: String(updated.id),
          value: {
            old: {
              name: current.name,
              status: current.status,
              ownerId: current.ownerId,
              publishedAt: current.publishedAt,
            },
            new: {
              name: params.name.trim(),
              status: updated.status,
              ownerId: updated.ownerId,
              publishedAt:
                ["PUBLISHED", "WHITELIST"].includes(updated.status) &&
                !current.publishedAt,
            },
          },
          description: `管理员更新友链「${current.name}」`,
          metadata: {
            id: updated.id,
            statusChanged: updated.status !== current.status,
            ownerChanged: updated.ownerId !== current.ownerId,
          },
        },
      });
    } catch (error) {
      console.error("[FriendLink] 写入审计日志失败:", error);
    }

    return response.ok({
      message: "友链信息已更新",
      data: {
        id: updated.id,
        status: updated.status as FriendLinkStatus,
        updatedAt: updated.updatedAt.toISOString(),
      },
    }) as ActionResult<UpdateFriendLinkByAdminResult | null>;
  } catch (error) {
    console.error("[FriendLink] 管理员更新友链失败:", error);
    return response.serverError({
      message: "更新失败，请稍后重试",
    });
  }
}

export async function deleteFriendLinkByAdmin(
  params: DeleteFriendLinkByAdmin,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<DeleteFriendLinkByAdminResult | null>>>;
export async function deleteFriendLinkByAdmin(
  params: DeleteFriendLinkByAdmin,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<DeleteFriendLinkByAdminResult | null>>;
export async function deleteFriendLinkByAdmin(
  params: DeleteFriendLinkByAdmin,
  serverConfig?: ActionConfig,
): Promise<ActionResult<DeleteFriendLinkByAdminResult | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "deleteFriendLinkByAdmin"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(params, DeleteFriendLinkByAdminSchema);
  if (validationError) return response.badRequest(validationError);

  const admin = await authVerify({
    accessToken: params.access_token,
    allowedRoles: ADMIN_ROLES,
  });
  if (!admin) {
    return response.unauthorized({
      message: "需要管理员权限",
    });
  }

  try {
    const current = await prisma.friendLink.findUnique({
      where: {
        id: params.id,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        ownerId: true,
      },
    });

    if (!current) {
      return response.notFound({
        message: "友链记录不存在",
      });
    }

    const deletedAt = new Date();
    await prisma.friendLink.update({
      where: {
        id: current.id,
        deletedAt: null,
      },
      data: {
        deletedAt,
      },
    });

    invalidateFriendLinkCache();

    const noticeApplicantEnabled = await getConfig(
      "friendlink.noticeApplicant.enable",
    );
    if (noticeApplicantEnabled && current.ownerId) {
      const siteUrl = await getConfig("site.url");
      await notifyManyUsers(
        [current.ownerId],
        "您的友链已被管理员删除",
        `友链「${current.name}」已被管理员删除，如需继续合作请重新提交申请。`,
        `${siteUrl}/friends/new`,
      );
    }

    await logAuditEvent({
      user: {
        uid: String(admin.uid),
      },
      details: {
        action: "DELETE",
        resourceType: "FRIEND_LINK",
        resourceId: String(current.id),
        value: {
          old: {
            id: current.id,
            name: current.name,
            ownerId: current.ownerId,
          },
          new: null,
        },
        description: `管理员删除了友链「${current.name}」`,
        metadata: {
          id: current.id,
          ownerId: current.ownerId || 0,
        },
      },
    });

    return response.ok({
      message: "友链记录已删除",
      data: {
        id: current.id,
        deletedAt: deletedAt.toISOString(),
      },
    }) as ActionResult<DeleteFriendLinkByAdminResult | null>;
  } catch (error) {
    console.error("[FriendLink] 管理员删除友链失败:", error);
    return response.serverError({
      message: "删除失败，请稍后重试",
    });
  }
}

export async function reviewFriendLink(
  params: ReviewFriendLink,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<ReviewFriendLinkResult | null>>>;
export async function reviewFriendLink(
  params: ReviewFriendLink,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<ReviewFriendLinkResult | null>>;
export async function reviewFriendLink(
  params: ReviewFriendLink,
  serverConfig?: ActionConfig,
): Promise<ActionResult<ReviewFriendLinkResult | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "reviewFriendLink"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(params, ReviewFriendLinkSchema);
  if (validationError) return response.badRequest(validationError);

  const admin = await authVerify({
    accessToken: params.access_token,
    allowedRoles: ADMIN_ROLES,
  });
  if (!admin) {
    return response.unauthorized({
      message: "需要管理员权限",
    });
  }

  try {
    const current = await prisma.friendLink.findUnique({
      where: {
        id: params.id,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        status: true,
        ownerId: true,
        publishedAt: true,
      },
    });

    if (!current) {
      return response.notFound({
        message: "友链记录不存在",
      });
    }

    const nextStatus = params.status as FriendLinkStatus;
    const updated = await prisma.friendLink.update({
      where: {
        id: current.id,
        deletedAt: null,
      },
      data: {
        status: nextStatus,
        auditorId: admin.uid,
        ...(nextStatus === "PUBLISHED" && !current.publishedAt
          ? { publishedAt: new Date() }
          : {}),
      },
      select: {
        id: true,
        status: true,
        updatedAt: true,
        ownerId: true,
      },
    });

    invalidateFriendLinkCache();

    const noticeApplicantEnabled = await getConfig(
      "friendlink.noticeApplicant.enable",
    );
    if (
      noticeApplicantEnabled &&
      updated.ownerId &&
      ["PUBLISHED", "REJECTED"].includes(updated.status)
    ) {
      const siteUrl = await getConfig("site.url");
      const reviewLink = `${siteUrl}/friends/new`;
      const title =
        updated.status === "PUBLISHED"
          ? "您的友链申请已通过审核"
          : "您的友链申请未通过审核";
      const content =
        updated.status === "PUBLISHED"
          ? `「${current.name}」已通过审核并可展示。`
          : `「${current.name}」未通过审核。${params.reason ? `原因：${params.reason}` : ""}`;
      await notifyManyUsers([updated.ownerId], title, content, reviewLink);
    }

    try {
      await logAuditEvent({
        user: {
          uid: String(admin.uid),
        },
        details: {
          action: "UPDATE",
          resourceType: "FRIEND_LINK",
          resourceId: String(updated.id),
          value: {
            old: { status: current.status, publishedAt: current.publishedAt },
            new: { status: updated.status },
          },
          description: `管理员审核友链「${current.name}」: ${current.status} -> ${updated.status}`,
        },
      });
    } catch (error) {
      console.error("[FriendLink] 写入审计日志失败:", error);
    }

    return response.ok({
      message: "审核状态已更新",
      data: {
        id: updated.id,
        status: updated.status as FriendLinkStatus,
        updatedAt: updated.updatedAt.toISOString(),
      },
    }) as ActionResult<ReviewFriendLinkResult | null>;
  } catch (error) {
    console.error("[FriendLink] 审核失败:", error);
    return response.serverError({
      message: "审核失败，请稍后重试",
    });
  }
}

export async function parseFriendLinkByAdmin(
  params: ParseFriendLinkByAdmin,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<ParseFriendLinkByAdminResult | null>>>;
export async function parseFriendLinkByAdmin(
  params: ParseFriendLinkByAdmin,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<ParseFriendLinkByAdminResult | null>>;
export async function parseFriendLinkByAdmin(
  params: ParseFriendLinkByAdmin,
  serverConfig?: ActionConfig,
): Promise<ActionResult<ParseFriendLinkByAdminResult | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "parseFriendLinkByAdmin"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(params, ParseFriendLinkByAdminSchema);
  if (validationError) return response.badRequest(validationError);

  const admin = await authVerify({
    accessToken: params.access_token,
    allowedRoles: ADMIN_ROLES,
  });
  if (!admin) {
    return response.unauthorized({
      message: "需要管理员权限",
    });
  }

  let normalizedUrl = "";
  try {
    normalizedUrl = normalizeSiteUrlInput(params.url);
  } catch (error) {
    return response.badRequest({
      message:
        error instanceof Error ? error.message : "请输入有效的网站地址（URL）",
    });
  }

  try {
    const requestResult = await requestUrlWithTiming(normalizedUrl);
    if (!requestResult.ok || !requestResult.html) {
      const message =
        requestResult.statusCode == null
          ? `无法访问该站点：${requestResult.errorMessage || "请求失败"}`
          : `站点访问失败，HTTP ${requestResult.statusCode}`;
      return response.badRequest({
        message,
      });
    }

    const parsedUrl = requestResult.finalUrl || normalizedUrl;
    const parsedResult = parseFriendLinkFromHtml(requestResult.html, parsedUrl);
    if (!parsedResult.name || !parsedResult.slogan || !parsedResult.avatar) {
      return response.badRequest({
        message: "解析完成，但未提取到足够信息，请手动补全",
      });
    }

    return response.ok({
      message: "站点信息解析成功",
      data: {
        url: parsedUrl,
        name: parsedResult.name,
        avatar: parsedResult.avatar,
        slogan: parsedResult.slogan,
        friendLinkUrl: parsedResult.friendLinkUrl,
      },
    }) as ActionResult<ParseFriendLinkByAdminResult | null>;
  } catch (error) {
    console.error("[FriendLink] 管理员解析友链失败:", error);
    return response.serverError({
      message: "解析失败，请稍后重试",
    });
  }
}

export async function createFriendLinkByAdmin(
  params: CreateFriendLinkByAdmin,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CreateFriendLinkByAdminResult | null>>>;
export async function createFriendLinkByAdmin(
  params: CreateFriendLinkByAdmin,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CreateFriendLinkByAdminResult | null>>;
export async function createFriendLinkByAdmin(
  params: CreateFriendLinkByAdmin,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CreateFriendLinkByAdminResult | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "createFriendLinkByAdmin"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(params, CreateFriendLinkByAdminSchema);
  if (validationError) return response.badRequest(validationError);

  const admin = await authVerify({
    accessToken: params.access_token,
    allowedRoles: ADMIN_ROLES,
  });
  if (!admin) {
    return response.unauthorized({
      message: "需要管理员权限",
    });
  }

  try {
    const status = (params.status || "PUBLISHED") as FriendLinkStatus;
    const ignoreBacklink = Boolean(params.ignoreBacklink);

    const created = await prisma.friendLink.create({
      data: {
        name: params.name.trim(),
        url: params.url.trim(),
        avatar: params.avatar.trim(),
        slogan: params.slogan.trim(),
        friendLinkUrl: params.friendLinkUrl?.trim() || null,
        applyNote: params.applyNote?.trim() || null,
        ignoreBacklink,
        status,
        auditorId: admin.uid,
        publishedAt:
          status === "PUBLISHED" || status === "WHITELIST" ? new Date() : null,
      },
      select: {
        id: true,
        status: true,
        createdAt: true,
      },
    });

    invalidateFriendLinkCache();

    try {
      await logAuditEvent({
        user: {
          uid: String(admin.uid),
        },
        details: {
          action: "CREATE",
          resourceType: "FRIEND_LINK",
          resourceId: String(created.id),
          value: {
            old: null,
            new: {
              name: params.name.trim(),
              status: created.status,
              url: params.url.trim(),
            },
          },
          description: `管理员创建友链「${params.name.trim()}」`,
          metadata: {
            id: created.id,
          },
        },
      });
    } catch (error) {
      console.error("[FriendLink] 写入审计日志失败:", error);
    }

    return response.ok({
      message: "友链已创建",
      data: {
        id: created.id,
        status: created.status as FriendLinkStatus,
        createdAt: created.createdAt.toISOString(),
      },
    }) as ActionResult<CreateFriendLinkByAdminResult | null>;
  } catch (error) {
    console.error("[FriendLink] 管理员创建友链失败:", error);
    return response.serverError({
      message: "创建友链失败，请稍后重试",
    });
  }
}

export async function getFriendLinksStats(
  params: GetFriendLinksStats,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<FriendLinksStats | null>>>;
export async function getFriendLinksStats(
  params: GetFriendLinksStats,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<FriendLinksStats | null>>;
export async function getFriendLinksStats(
  params: GetFriendLinksStats,
  serverConfig?: ActionConfig,
): Promise<ActionResult<FriendLinksStats | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getFriendLinksStats"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(params, GetFriendLinksStatsSchema);
  if (validationError) return response.badRequest(validationError);

  const admin = await authVerify({
    accessToken: params.access_token,
    allowedRoles: ADMIN_ROLES,
  });
  if (!admin) {
    return response.unauthorized({
      message: "需要管理员权限",
    });
  }

  try {
    const [
      total,
      pending,
      published,
      whitelist,
      rejected,
      blocked,
      disconnect,
      noBacklink,
      withOwner,
      problematic,
    ] = await Promise.all([
      prisma.friendLink.count({ where: { deletedAt: null } }),
      prisma.friendLink.count({
        where: { status: "PENDING", deletedAt: null },
      }),
      prisma.friendLink.count({
        where: { status: "PUBLISHED", deletedAt: null },
      }),
      prisma.friendLink.count({
        where: { status: "WHITELIST", deletedAt: null },
      }),
      prisma.friendLink.count({
        where: { status: "REJECTED", deletedAt: null },
      }),
      prisma.friendLink.count({
        where: { status: "BLOCKED", deletedAt: null },
      }),
      prisma.friendLink.count({
        where: { status: "DISCONNECT", deletedAt: null },
      }),
      prisma.friendLink.count({
        where: { status: "NO_BACKLINK", deletedAt: null },
      }),
      prisma.friendLink.count({
        where: {
          ownerId: {
            not: null,
          },
          deletedAt: null,
        },
      }),
      prisma.friendLink.count({
        where: {
          status: {
            in: ["DISCONNECT", "NO_BACKLINK"],
          },
          deletedAt: null,
        },
      }),
    ]);

    return response.ok({
      message: "获取友链统计成功",
      data: {
        updatedAt: new Date().toISOString(),
        cache: false,
        total,
        pending,
        published,
        whitelist,
        rejected,
        blocked,
        disconnect,
        noBacklink,
        withOwner,
        problematic,
      },
    }) as ActionResult<FriendLinksStats | null>;
  } catch (error) {
    console.error("[FriendLink] 获取统计失败:", error);
    return response.serverError({
      message: "获取统计失败，请稍后重试",
    });
  }
}

export async function getFriendLinksTrends(
  params: GetFriendLinksTrends,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<FriendLinkTrendItem[] | null>>>;
export async function getFriendLinksTrends(
  params: GetFriendLinksTrends,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<FriendLinkTrendItem[] | null>>;
export async function getFriendLinksTrends(
  { access_token, days = 30, count = 30 }: GetFriendLinksTrends,
  serverConfig?: ActionConfig,
): Promise<ActionResult<FriendLinkTrendItem[] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getFriendLinksTrends"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      days,
      count,
    },
    GetFriendLinksTrendsSchema,
  );
  if (validationError) return response.badRequest(validationError);

  const admin = await authVerify({
    accessToken: access_token,
    allowedRoles: ADMIN_ROLES,
  });
  if (!admin) {
    return response.unauthorized({
      message: "需要管理员权限",
    });
  }

  try {
    const now = new Date();
    const daysAgo = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const interval = Math.floor((days * 24 * 60 * 60 * 1000) / count);

    const datePoints: Date[] = [];
    for (let i = 0; i < count; i++) {
      datePoints.push(new Date(daysAgo.getTime() + i * interval));
    }
    datePoints.push(now);

    const trendData: FriendLinkTrendItem[] = await Promise.all(
      datePoints.map(async (date) => {
        const oneDayBefore = new Date(date.getTime() - 24 * 60 * 60 * 1000);

        const [total, published, newLinks] = await Promise.all([
          prisma.friendLink.count({
            where: {
              createdAt: {
                lte: date,
              },
              deletedAt: null,
            },
          }),
          prisma.friendLink.count({
            where: {
              publishedAt: {
                lte: date,
              },
              deletedAt: null,
            },
          }),
          prisma.friendLink.count({
            where: {
              createdAt: {
                gte: oneDayBefore,
                lte: date,
              },
              deletedAt: null,
            },
          }),
        ]);

        return {
          time: date.toISOString(),
          data: {
            total,
            new: newLinks,
            published,
          },
        };
      }),
    );

    return response.ok({
      message: "获取友链趋势成功",
      data: trendData,
    }) as ActionResult<FriendLinkTrendItem[] | null>;
  } catch (error) {
    console.error("[FriendLink] 获取趋势失败:", error);
    return response.serverError({
      message: "获取趋势失败，请稍后重试",
    });
  }
}

export async function getFriendLinksList(
  params: GetFriendLinksList,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<FriendLinkListItem[] | null>>>;
export async function getFriendLinksList(
  params: GetFriendLinksList,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<FriendLinkListItem[] | null>>;
export async function getFriendLinksList(
  params: GetFriendLinksList,
  serverConfig?: ActionConfig,
): Promise<ActionResult<FriendLinkListItem[] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getFriendLinksList"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(params, GetFriendLinksListSchema);
  if (validationError) return response.badRequest(validationError);

  const admin = await authVerify({
    accessToken: params.access_token,
    allowedRoles: ADMIN_ROLES,
  });
  if (!admin) {
    return response.unauthorized({
      message: "需要管理员权限",
    });
  }

  try {
    const {
      page,
      pageSize,
      sortBy,
      sortOrder,
      search,
      status,
      ownerUid,
      ignoreBacklink,
      hasIssue,
      createdAtStart,
      createdAtEnd,
      updatedAtStart,
      updatedAtEnd,
      publishedAtStart,
      publishedAtEnd,
    } = params;

    const whereConditions: Prisma.FriendLinkWhereInput[] = [
      { deletedAt: null },
    ];

    if (search) {
      whereConditions.push({
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { url: { contains: search, mode: "insensitive" } },
          { slogan: { contains: search, mode: "insensitive" } },
          { friendLinkUrl: { contains: search, mode: "insensitive" } },
        ],
      });
    }

    if (status && status.length > 0) {
      whereConditions.push({
        status: {
          in: status as FriendLinkStatus[],
        },
      });
    }

    if (typeof ownerUid === "number") {
      whereConditions.push({
        ownerId: ownerUid,
      });
    }

    if (typeof ignoreBacklink === "boolean") {
      whereConditions.push({
        ignoreBacklink,
      });
    }

    if (typeof hasIssue === "boolean") {
      whereConditions.push(
        hasIssue
          ? {
              OR: [
                { checkFailureCount: { gt: 0 } },
                { status: { in: ["DISCONNECT", "NO_BACKLINK"] } },
              ],
            }
          : {
              checkFailureCount: 0,
            },
      );
    }

    if (createdAtStart || createdAtEnd) {
      whereConditions.push({
        createdAt: {
          ...(createdAtStart ? { gte: new Date(createdAtStart) } : {}),
          ...(createdAtEnd ? { lte: new Date(createdAtEnd) } : {}),
        },
      });
    }

    if (updatedAtStart || updatedAtEnd) {
      whereConditions.push({
        updatedAt: {
          ...(updatedAtStart ? { gte: new Date(updatedAtStart) } : {}),
          ...(updatedAtEnd ? { lte: new Date(updatedAtEnd) } : {}),
        },
      });
    }

    if (publishedAtStart || publishedAtEnd) {
      whereConditions.push({
        publishedAt: {
          ...(publishedAtStart ? { gte: new Date(publishedAtStart) } : {}),
          ...(publishedAtEnd ? { lte: new Date(publishedAtEnd) } : {}),
        },
      });
    }

    const where: Prisma.FriendLinkWhereInput = { AND: whereConditions };

    const [total, records] = await Promise.all([
      prisma.friendLink.count({
        where,
      }),
      prisma.friendLink.findMany({
        where,
        orderBy: {
          [sortBy || "updatedAt"]: sortOrder || "desc",
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          owner: {
            select: {
              uid: true,
              username: true,
              nickname: true,
            },
          },
          auditor: {
            select: {
              uid: true,
              username: true,
              nickname: true,
            },
          },
        },
      }),
    ]);

    const data: FriendLinkListItem[] = records.map((record) =>
      toFriendLinkListItem(record, { includeHistory: false }),
    );

    return response.ok({
      message: "获取友链列表成功",
      data,
      meta: getPaginationMeta(page, pageSize, total),
    }) as ActionResult<FriendLinkListItem[] | null>;
  } catch (error) {
    console.error("[FriendLink] 获取列表失败:", error);
    return response.serverError({
      message: "获取列表失败，请稍后重试",
    });
  }
}

export async function checkFriendLinks(
  params: CheckFriendLinks,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CheckFriendLinksResult | null>>>;
export async function checkFriendLinks(
  params: CheckFriendLinks,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CheckFriendLinksResult | null>>;
export async function checkFriendLinks(
  params: CheckFriendLinks,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CheckFriendLinksResult | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "checkFriendLinks"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(params, CheckFriendLinksSchema);
  if (validationError) return response.badRequest(validationError);

  const admin = await authVerify({
    accessToken: params.access_token,
    allowedRoles: ADMIN_ROLES,
  });
  if (!admin) {
    return response.unauthorized({
      message: "需要管理员权限",
    });
  }

  if (!params.checkAll && (!params.ids || params.ids.length === 0)) {
    return response.badRequest({
      message: "请提供要检查的友链 ID，或设置 checkAll=true",
    });
  }

  try {
    const data = await runFriendLinksCheck({
      checkAll: Boolean(params.checkAll),
      ids: params.ids,
    });

    try {
      await logAuditEvent({
        user: {
          uid: String(admin.uid),
        },
        details: {
          action: "UPDATE",
          resourceType: "FRIEND_LINK_CHECK",
          resourceId: params.checkAll ? "ALL" : (params.ids || []).join(","),
          value: {
            old: null,
            new: {
              total: data.total,
              checked: data.checked,
              skipped: data.skipped,
              failed: data.failed,
              statusChanged: data.statusChanged,
              checkAll: Boolean(params.checkAll),
            },
          },
          description: `管理员执行友链检查（共 ${data.total} 条）`,
        },
      });
    } catch (error) {
      console.error("[FriendLink] 写入审计日志失败:", error);
    }

    return response.ok({
      message: "友链检查完成",
      data,
    }) as ActionResult<CheckFriendLinksResult | null>;
  } catch (error) {
    console.error("[FriendLink] 检查失败:", error);
    return response.serverError({
      message: "友链检查失败，请稍后重试",
    });
  }
}
