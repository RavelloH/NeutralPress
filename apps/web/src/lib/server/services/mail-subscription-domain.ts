import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { headers } from "next/headers";

import { MailSubscriptionVerifyEmail } from "@/emails/templates/MailSubscriptionVerifyEmail";
import { PostSubscriptionEmail } from "@/emails/templates/PostSubscriptionEmail";
import { renderEmail } from "@/emails/utils";
import { logAuditEvent } from "@/lib/server/audit";
import { authVerify } from "@/lib/server/auth-verify";
import { verifyToken as verifyCaptchaToken } from "@/lib/server/captcha";
import { getConfig, getConfigs } from "@/lib/server/config-cache";
import { sendEmail } from "@/lib/server/email";
import { jwtTokenSign, jwtTokenVerify } from "@/lib/server/jwt";
import { getFeaturedImageUrl } from "@/lib/server/media-reference";
import { PUBLIC_POST_PUBLISHED_WHERE } from "@/lib/server/post-access";
import prisma from "@/lib/server/prisma";
import limitControl from "@/lib/server/rate-limit";
import ResponseBuilder from "@/lib/server/response";
import type {
  DispatchFailureItem,
  DispatchLatestPostMailData,
  DispatchLatestPostMailParams,
  DispatchOverviewData,
  GetMailSubscriptionListParams,
  MailSubscriptionActionResult,
  MailSubscriptionListData,
  MailSubscriptionListItem,
  MailSubscriptionListSortField,
  MailSubscriptionStatus,
  MailSubscriptionStatusDistributionItem,
  SubscriptionActionData,
} from "@/lib/shared/mail-subscription-types";

const VERIFY_EXPIRE_MS = 30 * 60 * 1000;
const DISPATCH_BATCH_MIN = 1;
const DISPATCH_BATCH_MAX = 50;
const DEFAULT_DISPATCH_BATCH = 1;
const LIST_PAGE_SIZE_MIN = 10;
const LIST_PAGE_SIZE_MAX = 200;
const LIST_DEFAULT_PAGE_SIZE = 25;
const LIST_SORT_FIELDS: MailSubscriptionListSortField[] = [
  "id",
  "createdAt",
  "updatedAt",
  "lastSentAt",
];

type MailSubscriptionCountArgs = NonNullable<
  Parameters<typeof prisma.mailSubscription.count>[0]
>;
type MailSubscriptionFindManyArgs = NonNullable<
  Parameters<typeof prisma.mailSubscription.findMany>[0]
>;
type MailSubscriptionWhereInput = NonNullable<
  MailSubscriptionCountArgs["where"]
>;
type MailSubscriptionOrderByInput = NonNullable<
  MailSubscriptionFindManyArgs["orderBy"]
>;

function hasValidSmtpConfig(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  const smtp = value as {
    user?: unknown;
    host?: unknown;
    port?: unknown;
    password?: unknown;
  };

  const user =
    typeof smtp.user === "string"
      ? smtp.user.trim()
      : typeof smtp.user === "number"
        ? String(smtp.user)
        : "";
  const host =
    typeof smtp.host === "string"
      ? smtp.host.trim()
      : typeof smtp.host === "number"
        ? String(smtp.host)
        : "";
  const port =
    typeof smtp.port === "string"
      ? smtp.port.trim()
      : typeof smtp.port === "number"
        ? String(smtp.port)
        : "";
  const password =
    typeof smtp.password === "string"
      ? smtp.password.trim()
      : typeof smtp.password === "number"
        ? String(smtp.password)
        : "";

  return !!(user && host && port && password);
}

function unwrapDefaultValue(value: unknown): unknown {
  let current = value;
  for (let i = 0; i < 4; i += 1) {
    if (
      current &&
      typeof current === "object" &&
      !Array.isArray(current) &&
      "default" in (current as Record<string, unknown>)
    ) {
      current = (current as Record<string, unknown>).default;
      continue;
    }
    break;
  }
  return current;
}

function toBoolean(value: unknown): boolean {
  const normalized = unwrapDefaultValue(value);
  if (typeof normalized === "boolean") {
    return normalized;
  }
  if (typeof normalized === "string") {
    const text = normalized.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(text)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(text)) {
      return false;
    }
  }
  if (typeof normalized === "number") {
    return normalized !== 0;
  }
  return false;
}

function toOptionalString(value: unknown): string {
  const normalized = unwrapDefaultValue(value);
  if (typeof normalized === "string") {
    return normalized.trim();
  }
  if (typeof normalized === "number") {
    return String(normalized);
  }
  return "";
}

async function checkMailDeliveryAvailability(): Promise<{
  available: boolean;
  message?: string;
}> {
  const [noticeEnabled, fromEmail, resendApiKey, smtpConfig] = await getConfigs(
    [
      "notice.enable",
      "notice.email",
      "notice.email.resend.apiKey",
      "notice.email.smtp",
    ],
  );

  const enabled = toBoolean(noticeEnabled);
  const normalizedFromEmail = toOptionalString(fromEmail);
  const normalizedResendApiKey = toOptionalString(resendApiKey);
  const normalizedSmtpConfig = unwrapDefaultValue(smtpConfig);

  if (!enabled) {
    return {
      available: false,
      message: "全局通知开关（notice.enable）已关闭",
    };
  }

  if (!normalizedFromEmail) {
    return {
      available: false,
      message: "未配置发信地址（notice.email）",
    };
  }

  const hasResend = normalizedResendApiKey.length > 0;
  const hasSmtp = hasValidSmtpConfig(normalizedSmtpConfig);

  if (!hasResend && !hasSmtp) {
    return {
      available: false,
      message: "未配置邮件发送服务（请配置 Resend API Key 或 SMTP）",
    };
  }

  return { available: true };
}

function normalizeSiteUrl(siteUrl: string): string {
  return siteUrl.replace(/\/+$/, "");
}

function toAbsoluteUrl(siteUrl: string, pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }

  const normalizedSiteUrl = normalizeSiteUrl(siteUrl);
  const normalizedPath = pathOrUrl.startsWith("/")
    ? pathOrUrl
    : `/${pathOrUrl}`;
  return `${normalizedSiteUrl}${normalizedPath}`;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

function safeEqualText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

function sanitizeBatchSize(batchSize?: number): number {
  if (!Number.isFinite(batchSize)) {
    return DEFAULT_DISPATCH_BATCH;
  }

  const parsed = Math.floor(batchSize ?? DEFAULT_DISPATCH_BATCH);
  if (parsed < DISPATCH_BATCH_MIN) {
    return DISPATCH_BATCH_MIN;
  }
  if (parsed > DISPATCH_BATCH_MAX) {
    return DISPATCH_BATCH_MAX;
  }
  return parsed;
}

function sanitizeCursor(cursorId?: number): number {
  if (!Number.isFinite(cursorId) || (cursorId ?? 0) < 0) {
    return 0;
  }
  return Math.floor(cursorId ?? 0);
}

function sanitizePage(page?: number): number {
  if (!Number.isFinite(page) || (page ?? 0) < 1) {
    return 1;
  }
  return Math.floor(page ?? 1);
}

function sanitizePageSize(pageSize?: number): number {
  if (!Number.isFinite(pageSize)) {
    return LIST_DEFAULT_PAGE_SIZE;
  }
  const parsed = Math.floor(pageSize ?? LIST_DEFAULT_PAGE_SIZE);
  if (parsed < LIST_PAGE_SIZE_MIN) {
    return LIST_PAGE_SIZE_MIN;
  }
  if (parsed > LIST_PAGE_SIZE_MAX) {
    return LIST_PAGE_SIZE_MAX;
  }
  return parsed;
}

function sanitizeSortField(
  sortBy?: MailSubscriptionListSortField,
): MailSubscriptionListSortField {
  if (sortBy && LIST_SORT_FIELDS.includes(sortBy)) {
    return sortBy;
  }
  return "id";
}

function sanitizeSortOrder(sortOrder?: "asc" | "desc"): "asc" | "desc" {
  return sortOrder === "desc" ? "desc" : "asc";
}

function sanitizeStatusArray(
  status?: MailSubscriptionStatus[],
): MailSubscriptionStatus[] {
  if (!Array.isArray(status)) {
    return [];
  }
  return status.filter((item): item is MailSubscriptionStatus =>
    ["PENDING_VERIFY", "ACTIVE", "UNSUBSCRIBED"].includes(item),
  );
}

function stripContentToText(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#>*_~-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildPostExcerpt(post: {
  excerpt: string | null;
  plain: string | null;
  content: string;
}): string {
  if (post.excerpt && post.excerpt.trim().length > 0) {
    return post.excerpt.trim();
  }

  if (post.plain && post.plain.trim().length > 0) {
    const plain = post.plain.trim();
    return plain.length > 220 ? `${plain.slice(0, 220)}...` : plain;
  }

  const fallback = stripContentToText(post.content);
  if (fallback.length === 0) {
    return "点击查看最新文章内容。";
  }

  return fallback.length > 220 ? `${fallback.slice(0, 220)}...` : fallback;
}

function buildVerifyToken(subscriptionId: number, secret: string): string {
  return `${subscriptionId}.${secret}`;
}

function parseVerifyToken(
  token: string,
): { subscriptionId: number; secret: string } | null {
  const separatorIndex = token.indexOf(".");
  if (separatorIndex <= 0 || separatorIndex >= token.length - 1) {
    return null;
  }

  const idText = token.slice(0, separatorIndex);
  const secret = token.slice(separatorIndex + 1);
  const subscriptionId = Number.parseInt(idText, 10);
  if (!Number.isFinite(subscriptionId) || subscriptionId <= 0) {
    return null;
  }

  return { subscriptionId, secret };
}

function buildUnsubscribeToken(
  subscriptionId: number,
  version: number,
): string {
  return jwtTokenSign({
    inner: {
      sid: subscriptionId,
      v: version,
    },
    expired: "180d",
  });
}

function buildPendingDispatchWhere(latestPostId: number) {
  return {
    status: "ACTIVE" as const,
    OR: [{ lastSentPostId: null }, { lastSentPostId: { not: latestPostId } }],
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRateLimitErrorMessage(message?: string): boolean {
  if (!message) {
    return false;
  }

  const text = message.toLowerCase();
  return (
    text.includes("too many requests") ||
    text.includes("rate limit") ||
    text.includes("requests per second") ||
    text.includes("请求过于频繁")
  );
}

export async function subscribeMail(params: {
  email?: string;
  captcha_token: string;
}): Promise<MailSubscriptionActionResult<SubscriptionActionData | null>> {
  const response = new ResponseBuilder("serveraction");

  if (!(await limitControl(await headers(), "subscribeMail"))) {
    return response.tooManyRequests() as MailSubscriptionActionResult<null>;
  }

  if (!params.captcha_token) {
    return response.badRequest({
      message: "缺少安全验证信息",
    }) as MailSubscriptionActionResult<null>;
  }

  const captchaResult = await verifyCaptchaToken(params.captcha_token);
  if (!captchaResult.success) {
    return response.badRequest({
      message: "安全验证失败，请刷新后重试",
    }) as MailSubscriptionActionResult<null>;
  }

  const [
    mailSubscriptionEnabled,
    anonymousEnabled,
    checkEnabled,
    siteTitle,
    siteUrl,
  ] = await getConfigs([
    "notice.mailSubscription.enable",
    "notice.mailSubscription.anonymous.enable",
    "notice.mailSubscription.check.enable",
    "site.title",
    "site.url",
  ]);

  if (!mailSubscriptionEnabled) {
    return response.serviceUnavailable({
      message: "站点暂未开启邮件订阅",
    }) as MailSubscriptionActionResult<null>;
  }

  const deliveryAvailability = await checkMailDeliveryAvailability();
  if (!deliveryAvailability.available) {
    return response.serviceUnavailable({
      message: deliveryAvailability.message || "邮件发送服务不可用",
    }) as MailSubscriptionActionResult<null>;
  }

  const currentUser = await authVerify({
    allowedRoles: ["USER", "ADMIN", "EDITOR", "AUTHOR"],
  });

  let normalizedEmail = "";
  let userUid: number | null = null;

  if (currentUser) {
    const currentDbUser = await prisma.user.findUnique({
      where: { uid: currentUser.uid },
      select: { uid: true, email: true },
    });

    if (!currentDbUser) {
      return response.unauthorized({
        message: "登录状态已失效，请重新登录后重试",
      }) as MailSubscriptionActionResult<null>;
    }

    userUid = currentDbUser.uid;
    normalizedEmail = normalizeEmail(currentDbUser.email);
  } else {
    if (!anonymousEnabled) {
      return response.unauthorized({
        message: "当前站点不允许匿名订阅，请先登录",
      }) as MailSubscriptionActionResult<null>;
    }

    const rawEmail = params.email?.trim() || "";
    if (!rawEmail) {
      return response.badRequest({
        message: "请填写邮箱地址",
      }) as MailSubscriptionActionResult<null>;
    }

    normalizedEmail = normalizeEmail(rawEmail);
    if (!isValidEmail(normalizedEmail)) {
      return response.badRequest({
        message: "请输入有效的邮箱地址",
      }) as MailSubscriptionActionResult<null>;
    }
  }

  const requireVerify = !currentUser && checkEnabled;
  const now = new Date();
  const tokenSecret = requireVerify ? randomBytes(24).toString("hex") : null;
  const tokenHash = tokenSecret ? hashToken(tokenSecret) : null;
  const tokenExpiresAt = tokenSecret
    ? new Date(now.getTime() + VERIFY_EXPIRE_MS)
    : null;

  const existing = await prisma.mailSubscription.findUnique({
    where: { email: normalizedEmail },
    select: {
      id: true,
      status: true,
      userUid: true,
      verifyTokenHash: true,
      verifyTokenExpiresAt: true,
      verifiedAt: true,
      unsubscribedAt: true,
    },
  });

  let subscriptionId = 0;
  let createdNewSubscription = false;
  let resultStatus: "PENDING_VERIFY" | "ACTIVE";
  let resultMessage = "订阅成功";

  if (existing) {
    const nextStatus = requireVerify ? "PENDING_VERIFY" : "ACTIVE";

    const updated = await prisma.mailSubscription.update({
      where: { id: existing.id },
      data: {
        userUid: userUid ?? existing.userUid,
        status: nextStatus,
        verifyTokenHash: tokenHash,
        verifyTokenExpiresAt: tokenExpiresAt,
        verifiedAt: requireVerify
          ? existing.verifiedAt
          : (existing.verifiedAt ?? now),
        unsubscribedAt: null,
      },
      select: {
        id: true,
        status: true,
      },
    });

    subscriptionId = updated.id;
    resultStatus = updated.status as "PENDING_VERIFY" | "ACTIVE";

    if (requireVerify) {
      resultMessage = "确认邮件已发送，请前往邮箱完成订阅";
    } else if (existing.status === "ACTIVE") {
      resultMessage = "该邮箱已订阅，无需重复操作";
    }
  } else {
    const created = await prisma.mailSubscription.create({
      data: {
        email: normalizedEmail,
        userUid,
        status: requireVerify ? "PENDING_VERIFY" : "ACTIVE",
        verifyTokenHash: tokenHash,
        verifyTokenExpiresAt: tokenExpiresAt,
        verifiedAt: requireVerify ? null : now,
      },
      select: {
        id: true,
        status: true,
      },
    });

    subscriptionId = created.id;
    createdNewSubscription = true;
    resultStatus = created.status as "PENDING_VERIFY" | "ACTIVE";
    resultMessage = requireVerify
      ? "确认邮件已发送，请前往邮箱完成订阅"
      : "订阅成功";
  }

  if (requireVerify && tokenSecret) {
    const normalizedSiteUrl = normalizeSiteUrl(siteUrl);
    const verifyToken = buildVerifyToken(subscriptionId, tokenSecret);
    const confirmUrl = `${normalizedSiteUrl}/subscribe/confirm?token=${encodeURIComponent(
      verifyToken,
    )}`;
    const emailComponent = MailSubscriptionVerifyEmail({
      email: normalizedEmail,
      confirmUrl,
      siteName: siteTitle,
      siteUrl: normalizedSiteUrl,
    });
    const { html, text } = await renderEmail(emailComponent);
    const emailResult = await sendEmail({
      to: normalizedEmail,
      subject: "请确认你的邮件订阅",
      html,
      text,
    });

    if (!emailResult.success) {
      if (createdNewSubscription) {
        await prisma.mailSubscription.delete({
          where: { id: subscriptionId },
        });
      } else if (existing) {
        await prisma.mailSubscription.update({
          where: { id: existing.id },
          data: {
            userUid: existing.userUid,
            status: existing.status,
            verifyTokenHash: existing.verifyTokenHash,
            verifyTokenExpiresAt: existing.verifyTokenExpiresAt,
            verifiedAt: existing.verifiedAt,
            unsubscribedAt: existing.unsubscribedAt,
          },
        });
      }

      return response.serverError({
        message: emailResult.error || "确认邮件发送失败，请稍后重试",
      }) as MailSubscriptionActionResult<null>;
    }
  }

  return response.ok({
    message: resultMessage,
    data: {
      status: resultStatus,
    },
  }) as MailSubscriptionActionResult<SubscriptionActionData>;
}

export async function confirmMailSubscription(params: {
  token: string;
}): Promise<MailSubscriptionActionResult<{ status: "ACTIVE" } | null>> {
  const response = new ResponseBuilder("serveraction");

  if (!(await limitControl(await headers(), "confirmMailSubscription"))) {
    return response.tooManyRequests() as MailSubscriptionActionResult<null>;
  }

  const token = params.token?.trim() || "";
  if (!token) {
    return response.badRequest({
      message: "缺少确认令牌",
    }) as MailSubscriptionActionResult<null>;
  }

  const parsed = parseVerifyToken(token);
  if (!parsed) {
    return response.badRequest({
      message: "确认链接无效",
    }) as MailSubscriptionActionResult<null>;
  }

  const subscription = await prisma.mailSubscription.findUnique({
    where: { id: parsed.subscriptionId },
    select: {
      id: true,
      status: true,
      verifyTokenHash: true,
      verifyTokenExpiresAt: true,
      verifiedAt: true,
    },
  });

  if (!subscription) {
    return response.badRequest({
      message: "确认链接已失效，请重新订阅",
    }) as MailSubscriptionActionResult<null>;
  }

  if (!subscription.verifyTokenHash || !subscription.verifyTokenExpiresAt) {
    if (subscription.status === "ACTIVE") {
      return response.ok({
        message: subscription.verifiedAt
          ? "邮箱已完成验证，请勿重复操作"
          : "邮箱验证成功，你已完成订阅",
        data: {
          status: "ACTIVE",
        },
      }) as MailSubscriptionActionResult<{ status: "ACTIVE" }>;
    }

    return response.badRequest({
      message: "确认链接已失效，请重新订阅",
    }) as MailSubscriptionActionResult<null>;
  }

  if (subscription.verifyTokenExpiresAt.getTime() < Date.now()) {
    return response.badRequest({
      message: "确认链接已过期，请重新订阅",
    }) as MailSubscriptionActionResult<null>;
  }

  const incomingHash = hashToken(parsed.secret);
  if (!safeEqualText(subscription.verifyTokenHash, incomingHash)) {
    return response.badRequest({
      message: "确认链接无效",
    }) as MailSubscriptionActionResult<null>;
  }

  await prisma.mailSubscription.update({
    where: { id: subscription.id },
    data: {
      status: "ACTIVE",
      verifiedAt: new Date(),
      verifyTokenHash: null,
      verifyTokenExpiresAt: null,
      unsubscribedAt: null,
    },
  });

  return response.ok({
    message: "邮箱验证成功，你已完成订阅",
    data: {
      status: "ACTIVE",
    },
  }) as MailSubscriptionActionResult<{ status: "ACTIVE" }>;
}

export async function unsubscribeMailSubscription(params: {
  token: string;
}): Promise<MailSubscriptionActionResult<{ status: "UNSUBSCRIBED" } | null>> {
  const response = new ResponseBuilder("serveraction");

  if (!(await limitControl(await headers(), "unsubscribeMailSubscription"))) {
    return response.tooManyRequests() as MailSubscriptionActionResult<null>;
  }

  const token = params.token?.trim() || "";
  if (!token) {
    return response.badRequest({
      message: "缺少退订令牌",
    }) as MailSubscriptionActionResult<null>;
  }

  const payload = jwtTokenVerify<{
    sid: number;
    v: number;
  }>(token);

  if (!payload || !payload.sid || !payload.v) {
    return response.badRequest({
      message: "退订链接无效或已过期",
    }) as MailSubscriptionActionResult<null>;
  }

  const subscription = await prisma.mailSubscription.findUnique({
    where: { id: payload.sid },
    select: {
      id: true,
      unsubscribeVersion: true,
      status: true,
    },
  });

  if (!subscription) {
    return response.badRequest({
      message: "退订链接无效或已失效",
    }) as MailSubscriptionActionResult<null>;
  }

  if (payload.v !== subscription.unsubscribeVersion) {
    return response.badRequest({
      message: "退订链接已失效，请使用最新邮件中的链接",
    }) as MailSubscriptionActionResult<null>;
  }

  await prisma.mailSubscription.update({
    where: { id: subscription.id },
    data: {
      status: "UNSUBSCRIBED",
      unsubscribedAt: new Date(),
      unsubscribeVersion: {
        increment: 1,
      },
      verifyTokenHash: null,
      verifyTokenExpiresAt: null,
    },
  });

  return response.ok({
    message: "已成功退订邮件通知",
    data: {
      status: "UNSUBSCRIBED",
    },
  }) as MailSubscriptionActionResult<{ status: "UNSUBSCRIBED" }>;
}

export async function getMailSubscriptionList(
  params: GetMailSubscriptionListParams = {},
): Promise<MailSubscriptionActionResult<MailSubscriptionListData | null>> {
  const response = new ResponseBuilder("serveraction");

  if (!(await limitControl(await headers(), "getMailSubscriptionList"))) {
    return response.tooManyRequests() as MailSubscriptionActionResult<null>;
  }

  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR"],
  });

  if (!user) {
    return response.unauthorized({
      message: "未登录或无权访问",
    }) as MailSubscriptionActionResult<null>;
  }

  const page = sanitizePage(params.page);
  const pageSize = sanitizePageSize(params.pageSize);
  const sortBy = sanitizeSortField(params.sortBy);
  const sortOrder = sanitizeSortOrder(params.sortOrder);
  const search = params.search?.trim() || "";
  const statusFilter = sanitizeStatusArray(params.status);
  const pendingOnly = params.pendingOnly === true;

  const latestPost = await prisma.post.findFirst({
    where: {
      ...PUBLIC_POST_PUBLISHED_WHERE,
      publishedAt: { not: null },
    },
    orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
    select: { id: true },
  });
  const latestPostId = latestPost?.id ?? null;

  const whereAnd: MailSubscriptionWhereInput[] = [];

  if (statusFilter.length > 0) {
    whereAnd.push({
      status: {
        in: statusFilter,
      },
    });
  }

  if (Array.isArray(params.boundUser) && params.boundUser.length === 1) {
    const boundUser = params.boundUser[0];
    if (boundUser === true) {
      whereAnd.push({
        userUid: { not: null },
      });
    } else {
      whereAnd.push({
        userUid: null,
      });
    }
  }

  if (pendingOnly) {
    if (latestPostId) {
      whereAnd.push(buildPendingDispatchWhere(latestPostId));
    } else {
      whereAnd.push({
        id: -1,
      });
    }
  }

  if (search.length > 0) {
    whereAnd.push({
      OR: [
        {
          email: {
            contains: search,
            mode: "insensitive",
          },
        },
        {
          user: {
            is: {
              username: {
                contains: search,
                mode: "insensitive",
              },
            },
          },
        },
        {
          user: {
            is: {
              nickname: {
                contains: search,
                mode: "insensitive",
              },
            },
          },
        },
      ],
    });
  }

  const where: MailSubscriptionWhereInput =
    whereAnd.length > 0
      ? {
          AND: whereAnd,
        }
      : {};

  const skip = (page - 1) * pageSize;
  const total = await prisma.mailSubscription.count({ where });

  const orderBy =
    sortBy === "lastSentAt"
      ? [{ lastSentAt: sortOrder }, { id: "desc" }]
      : [{ [sortBy]: sortOrder }, { id: "desc" }];

  const list = await prisma.mailSubscription.findMany({
    where,
    skip,
    take: pageSize,
    orderBy: orderBy as MailSubscriptionOrderByInput,
    select: {
      id: true,
      email: true,
      userUid: true,
      status: true,
      verifiedAt: true,
      unsubscribedAt: true,
      lastSentPostId: true,
      lastSentAt: true,
      createdAt: true,
      updatedAt: true,
      user: {
        select: {
          uid: true,
          username: true,
          nickname: true,
        },
      },
    },
  });

  const items: MailSubscriptionListItem[] = list.map((item) => ({
    id: item.id,
    email: item.email,
    userUid: item.userUid,
    username: item.user?.username ?? null,
    nickname: item.user?.nickname ?? null,
    status: item.status,
    verifiedAt: item.verifiedAt?.toISOString() ?? null,
    unsubscribedAt: item.unsubscribedAt?.toISOString() ?? null,
    lastSentPostId: item.lastSentPostId,
    lastSentAt: item.lastSentAt?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    isPendingForLatest: latestPostId
      ? item.lastSentPostId !== latestPostId
      : false,
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
    data: {
      latestPostId,
      items,
    },
    meta,
  }) as MailSubscriptionActionResult<MailSubscriptionListData>;
}

export async function updateMailSubscriptionStatusByAdmin(params: {
  id: number;
  status: "ACTIVE" | "UNSUBSCRIBED";
}): Promise<
  MailSubscriptionActionResult<{
    id: number;
    status: MailSubscriptionStatus;
  } | null>
> {
  const response = new ResponseBuilder("serveraction");

  if (
    !(await limitControl(
      await headers(),
      "updateMailSubscriptionStatusByAdmin",
    ))
  ) {
    return response.tooManyRequests() as MailSubscriptionActionResult<null>;
  }

  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR"],
  });
  if (!user) {
    return response.unauthorized({
      message: "未登录或无权访问",
    }) as MailSubscriptionActionResult<null>;
  }

  const id = Math.floor(params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return response.badRequest({
      message: "订阅 ID 无效",
    }) as MailSubscriptionActionResult<null>;
  }

  const targetStatus = params.status;
  if (!["ACTIVE", "UNSUBSCRIBED"].includes(targetStatus)) {
    return response.badRequest({
      message: "目标状态无效",
    }) as MailSubscriptionActionResult<null>;
  }

  const existing = await prisma.mailSubscription.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      verifiedAt: true,
    },
  });

  if (!existing) {
    return response.notFound({
      message: "订阅记录不存在",
    }) as MailSubscriptionActionResult<null>;
  }

  if (existing.status === targetStatus) {
    return response.ok({
      message: "状态未变化",
      data: {
        id: existing.id,
        status: existing.status,
      },
    }) as MailSubscriptionActionResult<{
      id: number;
      status: MailSubscriptionStatus;
    }>;
  }

  const updated =
    targetStatus === "ACTIVE"
      ? await prisma.mailSubscription.update({
          where: { id: existing.id },
          data: {
            status: "ACTIVE",
            unsubscribedAt: null,
            verifyTokenHash: null,
            verifyTokenExpiresAt: null,
            verifiedAt: existing.verifiedAt ?? new Date(),
          },
          select: {
            id: true,
            status: true,
          },
        })
      : await prisma.mailSubscription.update({
          where: { id: existing.id },
          data: {
            status: "UNSUBSCRIBED",
            unsubscribedAt: new Date(),
            unsubscribeVersion: {
              increment: 1,
            },
            verifyTokenHash: null,
            verifyTokenExpiresAt: null,
          },
          select: {
            id: true,
            status: true,
          },
        });

  try {
    await logAuditEvent({
      user: {
        uid: user.uid.toString(),
      },
      details: {
        action: "UPDATE",
        resourceType: "MAIL_SUBSCRIPTION",
        resourceId: String(updated.id),
        value: {
          old: { status: existing.status },
          new: { status: updated.status },
        },
        description: `管理员更新邮件订阅状态: #${updated.id} ${existing.status} -> ${updated.status}`,
      },
    });
  } catch (error) {
    console.error("记录审计日志失败:", error);
  }

  return response.ok({
    message: targetStatus === "ACTIVE" ? "已设为生效订阅" : "已设为退订状态",
    data: {
      id: updated.id,
      status: updated.status,
    },
  }) as MailSubscriptionActionResult<{
    id: number;
    status: MailSubscriptionStatus;
  }>;
}

export async function resetMailSubscriptionLastSentByAdmin(params: {
  id: number;
}): Promise<
  MailSubscriptionActionResult<{
    id: number;
    lastSentPostId: number | null;
  } | null>
> {
  const response = new ResponseBuilder("serveraction");

  if (
    !(await limitControl(
      await headers(),
      "resetMailSubscriptionLastSentByAdmin",
    ))
  ) {
    return response.tooManyRequests() as MailSubscriptionActionResult<null>;
  }

  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR"],
  });
  if (!user) {
    return response.unauthorized({
      message: "未登录或无权访问",
    }) as MailSubscriptionActionResult<null>;
  }

  const id = Math.floor(params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return response.badRequest({
      message: "订阅 ID 无效",
    }) as MailSubscriptionActionResult<null>;
  }

  const existing = await prisma.mailSubscription.findUnique({
    where: { id },
    select: { id: true, lastSentPostId: true },
  });
  if (!existing) {
    return response.notFound({
      message: "订阅记录不存在",
    }) as MailSubscriptionActionResult<null>;
  }

  const updated = await prisma.mailSubscription.update({
    where: { id: existing.id },
    data: {
      lastSentPostId: null,
      lastSentAt: null,
    },
    select: {
      id: true,
      lastSentPostId: true,
    },
  });

  try {
    await logAuditEvent({
      user: {
        uid: user.uid.toString(),
      },
      details: {
        action: "UPDATE",
        resourceType: "MAIL_SUBSCRIPTION",
        resourceId: String(updated.id),
        value: {
          old: { lastSentPostId: existing.lastSentPostId },
          new: { lastSentPostId: updated.lastSentPostId },
        },
        description: `管理员重置邮件订阅发送标记: #${updated.id}`,
      },
    });
  } catch (error) {
    console.error("记录审计日志失败:", error);
  }

  return response.ok({
    message: "已清空发送标记",
    data: {
      id: updated.id,
      lastSentPostId: updated.lastSentPostId,
    },
  }) as MailSubscriptionActionResult<{
    id: number;
    lastSentPostId: number | null;
  }>;
}

export async function getLatestMailDispatchOverview(): Promise<
  MailSubscriptionActionResult<DispatchOverviewData | null>
> {
  const response = new ResponseBuilder("serveraction");

  if (!(await limitControl(await headers(), "getLatestMailDispatchOverview"))) {
    return response.tooManyRequests() as MailSubscriptionActionResult<null>;
  }

  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR"],
  });

  if (!user) {
    return response.unauthorized({
      message: "未登录或无权访问",
    }) as MailSubscriptionActionResult<null>;
  }

  const isEnabled = await getConfig("notice.mailSubscription.enable");

  if (!isEnabled) {
    return response.badRequest({
      message: "邮件订阅功能未开启",
    }) as MailSubscriptionActionResult<null>;
  }

  const latestPost = await prisma.post.findFirst({
    where: {
      ...PUBLIC_POST_PUBLISHED_WHERE,
      publishedAt: { not: null },
    },
    orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      title: true,
      slug: true,
      publishedAt: true,
    },
  });

  const totalActive = await prisma.mailSubscription.count({
    where: { status: "ACTIVE" },
  });

  let pendingTotal = 0;
  if (latestPost) {
    pendingTotal = await prisma.mailSubscription.count({
      where: buildPendingDispatchWhere(latestPost.id),
    });
  }

  return response.ok({
    data: {
      latestPost: latestPost
        ? {
            id: latestPost.id,
            title: latestPost.title,
            slug: latestPost.slug,
            publishedAt: latestPost.publishedAt?.toISOString() || null,
          }
        : null,
      totalActive,
      pendingTotal,
    },
  }) as MailSubscriptionActionResult<DispatchOverviewData>;
}

export async function getMailSubscriptionStatusDistribution(): Promise<
  MailSubscriptionActionResult<MailSubscriptionStatusDistributionItem[] | null>
> {
  const response = new ResponseBuilder("serveraction");

  if (
    !(await limitControl(
      await headers(),
      "getMailSubscriptionStatusDistribution",
    ))
  ) {
    return response.tooManyRequests() as MailSubscriptionActionResult<null>;
  }

  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR"],
  });

  if (!user) {
    return response.unauthorized({
      message: "未登录或无权访问",
    }) as MailSubscriptionActionResult<null>;
  }

  const grouped = await prisma.mailSubscription.groupBy({
    by: ["status"],
    _count: {
      _all: true,
    },
  });

  const countMap = new Map<MailSubscriptionStatus, number>();
  for (const item of grouped) {
    countMap.set(item.status as MailSubscriptionStatus, item._count._all);
  }

  const statuses: MailSubscriptionStatus[] = [
    "ACTIVE",
    "PENDING_VERIFY",
    "UNSUBSCRIBED",
  ];

  const total = statuses.reduce(
    (sum, status) => sum + (countMap.get(status) ?? 0),
    0,
  );

  const items: MailSubscriptionStatusDistributionItem[] = statuses.map(
    (status) => {
      const count = countMap.get(status) ?? 0;
      return {
        status,
        count,
        percentage: total > 0 ? Number(((count / total) * 100).toFixed(1)) : 0,
      };
    },
  );

  return response.ok({
    data: items,
  }) as MailSubscriptionActionResult<MailSubscriptionStatusDistributionItem[]>;
}

export async function cleanupInvalidMailSubscriptions(): Promise<
  MailSubscriptionActionResult<{
    deleted: number;
  } | null>
> {
  const response = new ResponseBuilder("serveraction");

  if (
    !(await limitControl(await headers(), "cleanupInvalidMailSubscriptions"))
  ) {
    return response.tooManyRequests() as MailSubscriptionActionResult<null>;
  }

  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR"],
  });

  if (!user) {
    return response.unauthorized({
      message: "未登录或无权访问",
    }) as MailSubscriptionActionResult<null>;
  }

  const now = new Date();
  const result = await prisma.mailSubscription.deleteMany({
    where: {
      status: "PENDING_VERIFY",
      OR: [
        {
          verifyTokenHash: null,
        },
        {
          verifyTokenExpiresAt: null,
        },
        {
          verifyTokenExpiresAt: {
            lt: now,
          },
        },
      ],
    },
  });

  try {
    await logAuditEvent({
      user: {
        uid: user.uid.toString(),
      },
      details: {
        action: "DELETE",
        resourceType: "MAIL_SUBSCRIPTION",
        resourceId: "PENDING_VERIFY_EXPIRED",
        value: {
          old: { count: result.count },
          new: null,
        },
        description: `管理员清理失效邮件订阅: ${result.count} 条`,
        metadata: {
          deletedCount: result.count,
        },
      },
    });
  } catch (error) {
    console.error("记录审计日志失败:", error);
  }

  return response.ok({
    message:
      result.count > 0
        ? `已清理 ${result.count} 条失效订阅`
        : "没有可清理的失效订阅",
    data: {
      deleted: result.count,
    },
  }) as MailSubscriptionActionResult<{
    deleted: number;
  }>;
}

export async function dispatchLatestPostMail(
  params: DispatchLatestPostMailParams = {},
): Promise<MailSubscriptionActionResult<DispatchLatestPostMailData | null>> {
  const response = new ResponseBuilder("serveraction");

  if (!(await limitControl(await headers(), "dispatchLatestPostMail"))) {
    return response.tooManyRequests() as MailSubscriptionActionResult<null>;
  }

  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR"],
  });

  if (!user) {
    return response.unauthorized({
      message: "未登录或无权访问",
    }) as MailSubscriptionActionResult<null>;
  }

  const [mailSubscriptionEnabled, siteTitle, rawSiteUrl] = await getConfigs([
    "notice.mailSubscription.enable",
    "site.title",
    "site.url",
  ]);

  if (!mailSubscriptionEnabled) {
    return response.badRequest({
      message: "邮件订阅功能未开启",
    }) as MailSubscriptionActionResult<null>;
  }

  const deliveryAvailability = await checkMailDeliveryAvailability();
  if (!deliveryAvailability.available) {
    return response.serviceUnavailable({
      message: deliveryAvailability.message || "邮件发送服务不可用",
    }) as MailSubscriptionActionResult<null>;
  }

  const siteUrl = normalizeSiteUrl(rawSiteUrl);
  const cursorId = sanitizeCursor(params.cursorId);
  const batchSize = sanitizeBatchSize(params.batchSize);

  const logDispatchAudit = async (payload: {
    latestPostId: number;
    pendingTotal: number;
    processed: number;
    sent: number;
    failed: number;
    nextCursor: number;
    hasMore: boolean;
    remainingAfter: number;
  }) => {
    try {
      await logAuditEvent({
        user: {
          uid: user.uid.toString(),
        },
        details: {
          action: "UPDATE",
          resourceType: "MAIL_SUBSCRIPTION_DISPATCH",
          resourceId: String(payload.latestPostId),
          value: {
            old: null,
            new: payload,
          },
          description: `管理员执行订阅邮件投递: 文章 #${payload.latestPostId}, 处理 ${payload.processed}, 成功 ${payload.sent}, 失败 ${payload.failed}`,
          metadata: {
            processed: payload.processed,
            sent: payload.sent,
            failed: payload.failed,
            hasMore: payload.hasMore,
          },
        },
      });
    } catch (error) {
      console.error("记录审计日志失败:", error);
    }
  };

  const latestPost = await prisma.post.findFirst({
    where: {
      ...PUBLIC_POST_PUBLISHED_WHERE,
      publishedAt: { not: null },
    },
    orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      title: true,
      slug: true,
      excerpt: true,
      plain: true,
      content: true,
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

  if (!latestPost) {
    return response.notFound({
      message: "当前没有可发送的已发布文章",
    }) as MailSubscriptionActionResult<null>;
  }

  if (
    params.expectedLatestPostId &&
    params.expectedLatestPostId !== latestPost.id
  ) {
    return response.conflict({
      message: "检测到最新文章已变化，请重置发送游标后重试",
    }) as MailSubscriptionActionResult<null>;
  }

  const pendingWhere = buildPendingDispatchWhere(latestPost.id);
  const pendingTotal = await prisma.mailSubscription.count({
    where: pendingWhere,
  });

  if (pendingTotal === 0) {
    await logDispatchAudit({
      latestPostId: latestPost.id,
      pendingTotal,
      processed: 0,
      sent: 0,
      failed: 0,
      nextCursor: cursorId,
      hasMore: false,
      remainingAfter: 0,
    });

    return response.ok({
      message: "所有订阅者都已收到最新文章",
      data: {
        latestPost: {
          id: latestPost.id,
          title: latestPost.title,
          slug: latestPost.slug,
        },
        pendingTotal,
        remainingAfter: 0,
        processed: 0,
        sent: 0,
        failed: 0,
        nextCursor: cursorId,
        hasMore: false,
        failures: [],
      },
    }) as MailSubscriptionActionResult<DispatchLatestPostMailData>;
  }

  const batch = await prisma.mailSubscription.findMany({
    where: {
      ...pendingWhere,
      ...(cursorId > 0 ? { id: { gt: cursorId } } : {}),
    },
    orderBy: { id: "asc" },
    take: batchSize,
    select: {
      id: true,
      email: true,
      unsubscribeVersion: true,
    },
  });

  if (batch.length === 0) {
    await logDispatchAudit({
      latestPostId: latestPost.id,
      pendingTotal,
      processed: 0,
      sent: 0,
      failed: 0,
      nextCursor: cursorId,
      hasMore: false,
      remainingAfter: pendingTotal,
    });

    return response.ok({
      message: "已到达本轮发送末尾",
      data: {
        latestPost: {
          id: latestPost.id,
          title: latestPost.title,
          slug: latestPost.slug,
        },
        pendingTotal,
        remainingAfter: pendingTotal,
        processed: 0,
        sent: 0,
        failed: 0,
        nextCursor: cursorId,
        hasMore: false,
        failures: [],
      },
    }) as MailSubscriptionActionResult<DispatchLatestPostMailData>;
  }

  const coverImage = getFeaturedImageUrl(latestPost.mediaRefs);
  const coverImageUrl = coverImage
    ? toAbsoluteUrl(siteUrl, coverImage)
    : undefined;
  const postUrl = `${siteUrl}/posts/${latestPost.slug}`;
  const postExcerpt = buildPostExcerpt(latestPost);

  let sent = 0;
  let failed = 0;
  const failures: DispatchFailureItem[] = [];

  for (const subscriber of batch) {
    const unsubscribeToken = buildUnsubscribeToken(
      subscriber.id,
      subscriber.unsubscribeVersion,
    );
    const unsubscribeUrl = `${siteUrl}/subscribe/unsubscribe?token=${encodeURIComponent(
      unsubscribeToken,
    )}`;

    const emailComponent = PostSubscriptionEmail({
      postTitle: latestPost.title,
      postExcerpt,
      postUrl,
      coverImageUrl,
      unsubscribeUrl,
      siteName: siteTitle,
      siteUrl,
    });

    const { html, text } = await renderEmail(emailComponent);
    let emailResult = await sendEmail({
      to: subscriber.email,
      subject: `新文章发布：${latestPost.title}`,
      html,
      text,
    });

    if (!emailResult.success && isRateLimitErrorMessage(emailResult.error)) {
      await sleep(1000);
      emailResult = await sendEmail({
        to: subscriber.email,
        subject: `新文章发布：${latestPost.title}`,
        html,
        text,
      });
    }

    if (!emailResult.success) {
      failed += 1;
      failures.push({
        subscriptionId: subscriber.id,
        email: subscriber.email,
        reason: emailResult.error || "发送失败",
      });
      continue;
    }

    await prisma.mailSubscription.update({
      where: { id: subscriber.id },
      data: {
        lastSentPostId: latestPost.id,
        lastSentAt: new Date(),
      },
    });

    sent += 1;
  }

  const nextCursor = batch[batch.length - 1]?.id ?? cursorId;
  const hasMore =
    (await prisma.mailSubscription.count({
      where: {
        ...pendingWhere,
        id: { gt: nextCursor },
      },
    })) > 0;

  const remainingAfter = Math.max(0, pendingTotal - sent);

  await logDispatchAudit({
    latestPostId: latestPost.id,
    pendingTotal,
    processed: batch.length,
    sent,
    failed,
    nextCursor,
    hasMore,
    remainingAfter,
  });

  return response.ok({
    message: `本次处理 ${batch.length} 条，成功 ${sent} 条，失败 ${failed} 条`,
    data: {
      latestPost: {
        id: latestPost.id,
        title: latestPost.title,
        slug: latestPost.slug,
      },
      pendingTotal,
      remainingAfter,
      processed: batch.length,
      sent,
      failed,
      nextCursor,
      hasMore,
      failures,
    },
  }) as MailSubscriptionActionResult<DispatchLatestPostMailData>;
}
