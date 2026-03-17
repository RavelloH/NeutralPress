"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useInView } from "react-intersection-observer";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import {
  RiArrowRightSLine,
  RiArrowUpLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiHeartFill,
  RiHeartLine,
  RiMapPin2Line,
  RiMarkdownLine,
  RiQuillPenLine,
  RiRefreshLine,
  RiReplyLine,
  RiSpyLine,
} from "@remixicon/react";
import type { CommentItem } from "@repo/shared-types/api/comment";
import { AnimatePresence, motion } from "framer-motion";
import rehypeKatex from "rehype-katex";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import {
  createComment,
  deleteOwnComment,
  getDirectChildren,
  getPostComments,
  likeComment,
  unlikeComment,
} from "@/actions/comment";
import { CaptchaButton } from "@/components/ui/CaptchaButton";
import { useNavigateWithTransition } from "@/components/ui/Link";
import UserAvatar from "@/components/ui/UserAvatar";
import { useConfig } from "@/context/ConfigContext";
import { useBroadcast, useBroadcastSender } from "@/hooks/use-broadcast";
import { resolveApiResponse } from "@/lib/client/run-with-auth";
import { formatDateTime } from "@/lib/shared/date-format";
import { highlightCode } from "@/lib/shared/mdx-config";
import type { ConfigType } from "@/types/config";
import { AlertDialog } from "@/ui/AlertDialog";
import { AutoResizer } from "@/ui/AutoResizer";
import { AutoTransition } from "@/ui/AutoTransition";
import { Button } from "@/ui/Button";
import Clickable from "@/ui/Clickable";
import { Input } from "@/ui/Input";
import { LoadingIndicator } from "@/ui/LoadingIndicator";
import { useToast } from "@/ui/Toast";
import { Tooltip } from "@/ui/Tooltip";
// ============ 类型定义 ============
interface CommentConfig {
  placeholder: string;
  anonymousEnabled: boolean;
  anonymousEmailRequired: boolean;
  anonymousWebsiteEnabled: boolean;
  reviewAll: boolean;
  reviewAnonymous: boolean;
  locateEnabled: boolean;
}

interface CommentsSectionProps {
  slug: string;
  allowComments: boolean;
  authorUid?: number | null;
  commentConfig: CommentConfig;
}

interface AnonymousUserInfo {
  authorName: string;
  authorEmail: string;
  authorWebsite: string;
}

interface LocalPendingComment {
  localId: string;
  slug: string;
  content: string;
  parentId?: string;
  authorName: string;
  authorEmail?: string;
  authorWebsite?: string;
  createdAt: string;
  replyToAuthorName?: string;
}

interface ChildPaginationState {
  cursor?: string;
  hasNext: boolean;
  loading: boolean;
  expanded: boolean;
}

// ============ 常量 ============
const ANONYMOUS_USER_KEY = "anonymous_comment_user";
const LOCAL_PENDING_COMMENTS_KEY = "local_pending_comments";
const levelColors = ["text-primary/80"];

// ============ 工具函数 ============
// 纯文本转义函数，用于不经过 Markdown 解析的地方
const escapeHtml = (text: string): string => {
  const htmlEscapes: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return text.replace(/[&<>"']/g, (char) => htmlEscapes[char] ?? char);
};

const mergeBySortKey = (existing: CommentItem[], incoming: CommentItem[]) => {
  const map = new Map(existing.map((c) => [c.id, c]));
  incoming.forEach((c) => map.set(c.id, c));
  return Array.from(map.values()).sort((a, b) =>
    a.sortKey.localeCompare(b.sortKey),
  );
};

const isHiddenByCollapse = (
  comment: CommentItem,
  collapsedIds: Set<string>,
  commentsMap: Map<string, CommentItem>,
) => {
  for (const collapsedId of collapsedIds) {
    const collapsed = commentsMap.get(collapsedId);
    if (collapsed && comment.path.startsWith(collapsed.path + "/")) {
      return true;
    }
  }
  return false;
};

const getParentId = (comment: CommentItem): string | null => {
  const parts = comment.path.split("/");
  return parts.length < 2 ? null : (parts[parts.length - 2] ?? null);
};

// ============ Markdown 代码高亮组件 ============

/**
 * 行内代码组件
 */
function InlineCode({ children }: { children?: React.ReactNode }) {
  return (
    <code className="px-1.5 py-0.5 rounded bg-foreground/10 text-foreground font-mono text-sm">
      {children}
    </code>
  );
}

/**
 * 代码块组件（使用 Shiki 高亮）
 */
function CodeBlock({
  children,
  className,
  shikiTheme,
}: {
  children?: string;
  className?: string;
  shikiTheme?: { light: string; dark: string };
}) {
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(true);
  const language = className?.replace(/language-/, "") || "text";
  const code = (children || "").replace(/\n$/, "");

  useEffect(() => {
    setLoading(true);
    highlightCode(code, language, shikiTheme)
      .then((highlightedHtml) => {
        setHtml(highlightedHtml);
        setLoading(false);
      })
      .catch((err) => {
        console.error("代码高亮失败:", { error: err, language, code });
        setLoading(false);
      });
  }, [code, language, shikiTheme]);

  if (loading) {
    return (
      <div className="my-4 p-4 bg-muted rounded-lg">
        <div className="animate-pulse flex space-x-2">
          <div className="flex-1 space-y-2">
            <div className="h-4 bg-foreground/10 rounded w-3/4"></div>
            <div className="h-4 bg-foreground/10 rounded w-1/2"></div>
          </div>
        </div>
      </div>
    );
  }

  // 直接渲染 highlightCode 返回的 HTML（已包含完整的样式）
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * ReactMarkdown 组件配置
 * 包含代码高亮、链接、图片等自定义渲染
 */
const markdownComponents = (shikiTheme?: {
  light: string;
  dark: string;
}): Components => ({
  // 代码处理
  pre: ({ children }: { children?: React.ReactNode }) => {
    // 检查是否是代码块（而不是其他 pre 标签）
    const child = React.Children.only(children);
    if (React.isValidElement(child) && child.type === "code") {
      return <>{children}</>;
    }
    // 如果 pre 包含的不是 code，直接返回
    return <>{children}</>;
  },
  code: ({
    children,
    className,
    inline,
  }: {
    children?: React.ReactNode;
    className?: string;
    inline?: boolean;
  }) => {
    const code = String(children);

    // 判断是否是行内代码
    // ReactMarkdown 的行为：
    // - 行内代码 `` `code` `` → inline=true, className=undefined
    // - 代码块 ```code``` → inline=false, 可能有 className
    const isInline = inline === true;

    if (isInline) {
      return <InlineCode>{children}</InlineCode>;
    }

    // 否则是代码块（即使没有 className，也使用 text 作为默认语言）
    return (
      <CodeBlock
        className={className || "language-text"}
        shikiTheme={shikiTheme}
      >
        {code}
      </CodeBlock>
    );
  },
});

// ============ 单条评论组件 ============
interface SingleCommentProps {
  comment: CommentItem;
  onReply: (comment: CommentItem) => void;
  onToggleCollapse: (commentId: string) => void;
  onExpandChildren: (commentId: string) => void;
  onHighlight: (commentId: string | null) => void;
  onToggleLike: (commentId: string, currentIsLiked: boolean) => void;
  onDelete: (comment: CommentItem) => void;
  childPaginationState?: ChildPaginationState;
  isCollapsed: boolean;
  isHighlighted: boolean;
  isInHoverPath: boolean;
  isCurrentHovered: boolean;
  isDirectParent: boolean;
  authorUid?: number | null;
  navigate: (href: string) => void;
  components: Components;
}

const SingleComment = React.memo(function SingleComment({
  comment,
  onReply,
  onToggleCollapse,
  onExpandChildren,
  onHighlight,
  onToggleLike,
  onDelete,
  childPaginationState,
  isCollapsed,
  isHighlighted,
  isInHoverPath,
  isCurrentHovered,
  isDirectParent,
  authorUid,
  navigate,
  components,
}: SingleCommentProps) {
  const [isNameHovered, setIsNameHovered] = useState(false);

  const statusBadge =
    comment.mine && comment.status !== "APPROVED"
      ? `(${comment.status === "PENDING" ? "待审核" : "未通过"})`
      : "";

  const indent = comment.depth * 24;
  const descendantCount = comment.descendantCount ?? 0;
  const hasChildren =
    descendantCount > 0 || comment.replyCount > 0 || comment.hasMore;
  const parentId = getParentId(comment);
  const levelColor = levelColors[comment.depth % levelColors.length];
  const displayReplyCount = descendantCount || comment.replyCount || 0;
  const needsFirstExpand = hasChildren && !childPaginationState?.expanded;
  const isLoading = childPaginationState?.loading ?? false;

  const highlightParent = useCallback(() => {
    if (!parentId) return;
    onHighlight(parentId);
    const el = document.getElementById(`comment-${parentId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [parentId, onHighlight]);

  const handleAvatarClick = useCallback(() => {
    if (!comment.author.isAnonymous && comment.author.uid) {
      navigate(`/user/${comment.author.uid}`);
    }
  }, [comment.author.isAnonymous, comment.author.uid, navigate]);

  const handleAvatarHover = useCallback(
    (hovered: boolean) => {
      if (!comment.author.isAnonymous && comment.author.uid) {
        setIsNameHovered(hovered);
      }
    },
    [comment.author.isAnonymous, comment.author.uid],
  );

  return (
    <div
      id={`comment-${comment.id}`}
      className={`py-3 transition-all duration-300 border-r-primary ${
        isHighlighted ? "bg-primary/10 border-r-2 ml-2" : ""
      }`}
      style={{ paddingLeft: indent }}
    >
      <div className="group relative">
        <div className="flex gap-3">
          {/* 头像 */}
          <div
            onClick={handleAvatarClick}
            onMouseEnter={() => handleAvatarHover(true)}
            onMouseLeave={() => handleAvatarHover(false)}
            className={`flex-shrink-0 ${
              !comment.author.isAnonymous && comment.author.uid
                ? "cursor-pointer"
                : ""
            }`}
          >
            <UserAvatar
              username={comment.author.displayName}
              avatarUrl={comment.author.avatar}
              emailMd5={comment.author.emailMd5}
              size={comment.depth === 0 ? 40 : 32}
              shape="circle"
            />
          </div>

          {/* 内容区 */}
          <div className="flex-1 min-w-0">
            {/* 作者信息行 */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
              <span
                onClick={handleAvatarClick}
                onMouseEnter={() => handleAvatarHover(true)}
                onMouseLeave={() => handleAvatarHover(false)}
                className={`font-semibold text-foreground flex items-center gap-1.5 ${
                  !comment.author.isAnonymous && comment.author.uid
                    ? "cursor-pointer"
                    : ""
                }`}
              >
                <span
                  className={`relative inline ${
                    !comment.author.isAnonymous && comment.author.uid
                      ? `bg-[linear-gradient(currentColor,currentColor)] bg-left-bottom bg-no-repeat transition-[background-size] duration-300 ease-out ${
                          isNameHovered
                            ? "bg-[length:100%_2px]"
                            : "bg-[length:0%_2px]"
                        }`
                      : ""
                  }`}
                >
                  {comment.author.displayName}
                </span>
                {comment.author.isAnonymous && (
                  <Tooltip content="匿名用户">
                    <RiSpyLine
                      size="1em"
                      className="text-muted-foreground flex-shrink-0"
                    />
                  </Tooltip>
                )}
                {comment.author.uid === authorUid && (
                  <Tooltip content="文章作者">
                    <RiQuillPenLine
                      size="1em"
                      className="text-primary flex-shrink-0"
                    />
                  </Tooltip>
                )}
              </span>
              {comment.replyTo && (
                <span className="text-xs">
                  回复 @{comment.replyTo.authorName}
                </span>
              )}
              <span className="text-xs">{formatDateTime(comment.createdAt)}</span>
              {statusBadge && (
                <span className="text-xs text-error">{statusBadge}</span>
              )}
              {comment.location && (
                <span className="inline-flex items-center gap-1 text-xs">
                  <RiMapPin2Line size="1em" />
                  {comment.location}
                </span>
              )}
              {comment.depth > 0 && (
                <span
                  className={`text-xs font-medium transition-all duration-300 ${
                    isCurrentHovered
                      ? `${levelColor} font-bold`
                      : isInHoverPath
                        ? levelColor
                        : "text-muted-foreground/60"
                  }`}
                >
                  L{comment.depth}
                </span>
              )}
              {hasChildren && (
                <>
                  <span className="text-muted-foreground/30">·</span>
                  {needsFirstExpand ? (
                    <Clickable
                      onClick={() => onExpandChildren(comment.id)}
                      hoverScale={1}
                      disabled={isLoading}
                      className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {isLoading ? (
                        <LoadingIndicator size="sm" />
                      ) : (
                        <motion.div
                          animate={{ rotate: 0 }}
                          transition={{ duration: 0.2, ease: "easeInOut" }}
                        >
                          <RiArrowRightSLine size="1.2em" />
                        </motion.div>
                      )}
                      <AutoTransition>
                        {isLoading
                          ? "加载中..."
                          : `展开 ${displayReplyCount} 条回复`}
                      </AutoTransition>
                    </Clickable>
                  ) : (
                    <Clickable
                      onClick={() => onToggleCollapse(comment.id)}
                      hoverScale={1}
                      className="flex items-center gap-0.5 text-muted-foreground hover:text-foreground text-xs transition-colors"
                    >
                      <motion.div
                        animate={{ rotate: isCollapsed ? 0 : 90 }}
                        transition={{ duration: 0.2, ease: "easeInOut" }}
                      >
                        <RiArrowRightSLine size="1.2em" />
                      </motion.div>
                      <AutoTransition>
                        {isCollapsed
                          ? `展开 ${displayReplyCount} 条回复`
                          : "折叠"}
                      </AutoTransition>
                    </Clickable>
                  )}
                </>
              )}
              <AutoTransition>
                {isDirectParent && (
                  <span className="text-xs text-foreground font-bold animate-pulse flex items-center gap-1">
                    ↳ 原回复
                  </span>
                )}
              </AutoTransition>
            </div>

            {/* 评论内容 */}
            <div className="mt-1 prose prose-sm dark:prose-invert max-w-none break-words md-content mini-md-content">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]}
                rehypePlugins={[rehypeKatex]}
                components={components}
              >
                {comment.content}
              </ReactMarkdown>
            </div>

            {/* 操作栏 */}
            <div className="mt-2 flex items-center gap-3 text-xs">
              <Clickable
                onClick={() =>
                  onToggleLike(comment.id, comment.isLiked ?? false)
                }
                className={`flex items-center gap-1 transition-colors duration-300 ${
                  comment.isLiked
                    ? "text-error"
                    : "text-muted-foreground hover:text-error"
                }`}
              >
                <AutoTransition type="scale" duration={0.2} initial={false}>
                  {comment.isLiked ? (
                    <RiHeartFill size="1.25em" key="liked" />
                  ) : (
                    <RiHeartLine size="1.25em" key="unliked" />
                  )}
                </AutoTransition>
                <span className="font-mono">
                  <AutoTransition type="fade" duration={0.2} initial={false}>
                    {comment.likeCount > 0 ? comment.likeCount : "0"}
                  </AutoTransition>
                </span>
              </Clickable>
              <Clickable
                onClick={() => onReply(comment)}
                className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
              >
                <RiReplyLine size="1.25em" />
                <span>回复</span>
              </Clickable>
              {comment.mine && (
                <Clickable
                  onClick={() => onDelete(comment)}
                  className="flex items-center gap-1 text-muted-foreground hover:text-error transition-colors"
                >
                  <RiDeleteBinLine size="1.25em" />
                  <span>删除</span>
                </Clickable>
              )}
              <AutoTransition type="fade" duration={0.15}>
                {isCurrentHovered && parentId && (
                  <Clickable
                    onClick={highlightParent}
                    hoverScale={1.1}
                    className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <RiArrowUpLine size="1.25em" />
                    <span>高亮原回复</span>
                  </Clickable>
                )}
              </AutoTransition>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

// ============ 子评论加载更多按钮组件 ============
interface LoadMoreChildrenButtonProps {
  parentId: string;
  loading: boolean;
  depth: number;
  remainingCount: number;
  onLoadMore: (parentId: string) => void;
}

const LoadMoreChildrenButton = React.memo(function LoadMoreChildrenButton({
  parentId,
  loading,
  depth,
  remainingCount,
  onLoadMore,
}: LoadMoreChildrenButtonProps) {
  const indent = (depth + 1) * 24;

  return (
    <div className="py-2" style={{ paddingLeft: indent }}>
      <AutoResizer duration={0.3}>
        <AutoTransition type="fade" duration={0.2}>
          {loading ? (
            <div
              key="loading"
              className="flex items-center gap-2 py-4 text-sm text-muted-foreground w-full h-24 justify-center"
            >
              <LoadingIndicator />
            </div>
          ) : (
            <Clickable
              key="button"
              onClick={() => onLoadMore(parentId)}
              hoverScale={1}
              className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
            >
              <motion.div
                animate={{ rotate: 0 }}
                transition={{ duration: 0.2, ease: "easeInOut" }}
              >
                <RiArrowRightSLine size="1.2em" />
              </motion.div>
              <span>展开剩余 {remainingCount} 条回复</span>
            </Clickable>
          )}
        </AutoTransition>
      </AutoResizer>
    </div>
  );
});

// ============ 本地存储 Hook ============
const useLocalStorage = <T,>(key: string, initialValue: T) => {
  const [value, setValue] = useState<T>(initialValue);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = localStorage.getItem(key);
      if (saved) setValue(JSON.parse(saved) as T);
    } catch (e) {
      console.error(`恢复 ${key} 失败`, e);
    }
  }, [key]);

  const updateValue = useCallback(
    (newValue: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const updated =
          typeof newValue === "function"
            ? (newValue as (prev: T) => T)(prev)
            : newValue;
        try {
          localStorage.setItem(key, JSON.stringify(updated));
        } catch (e) {
          console.error(`保存 ${key} 失败`, e);
        }
        return updated;
      });
    },
    [key],
  );

  return [value, updateValue] as const;
};

// ============ 用户状态 Hook ============
const useUserStatus = () => {
  return useMemo(() => {
    if (typeof window === "undefined" || typeof localStorage === "undefined") {
      return { isAnonymous: true, uid: null };
    }
    const info = localStorage.getItem("user_info");
    if (!info) return { isAnonymous: true, uid: null };
    try {
      const parsed = JSON.parse(info) as { uid?: number };
      return { isAnonymous: !parsed?.uid, uid: parsed.uid ?? null };
    } catch {
      return { isAnonymous: true, uid: null };
    }
  }, []);
};

// ============ 主组件 ============

export default function CommentsSection({
  slug,
  allowComments,
  authorUid,
  commentConfig,
}: CommentsSectionProps) {
  // 从 ConfigProvider 获取 Shiki 主题配置
  const shikiTheme = useConfig(
    "site.shiki.theme",
  ) as ConfigType<"site.shiki.theme">;

  // 基础状态
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasNext, setHasNext] = useState(false);
  const [cursor, setCursor] = useState<string | undefined>();
  const [totalComments, setTotalComments] = useState(0); // 真实的评论总数
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [childPaginationMap, setChildPaginationMap] = useState<
    Map<string, ChildPaginationState>
  >(new Map());
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [hoveredPath, setHoveredPath] = useState<string[]>([]);

  // 表单状态
  const [replyTarget, setReplyTarget] = useState<CommentItem | null>(null);
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaLoaded, setCaptchaLoaded] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // 删除对话框状态
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [commentToDelete, setCommentToDelete] = useState<CommentItem | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);

  // 懒加载
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const commentsContainerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingMoreRef = useRef(false);

  // 使用 react-intersection-observer 监听触发加载的评论
  const { ref: loadMoreRef, inView } = useInView({
    threshold: 0,
    skip: !hasNext || loading, // 没有更多数据或正在加载时跳过监听
  });

  const { success: toastSuccess, error: toastError } = useToast();
  const { broadcast } = useBroadcastSender<object>();
  const navigate = useNavigateWithTransition();

  // 用户状态和本地存储
  const { isAnonymous } = useUserStatus();
  const [anonymousInfo, setAnonymousInfo] = useLocalStorage<AnonymousUserInfo>(
    ANONYMOUS_USER_KEY,
    { authorName: "", authorEmail: "", authorWebsite: "" },
  );
  const [localPendingComments, setLocalPendingComments] = useLocalStorage<
    LocalPendingComment[]
  >(LOCAL_PENDING_COMMENTS_KEY, []);

  // 从 anonymousInfo 同步到表单
  const [authorName, setAuthorName] = useState(anonymousInfo.authorName);
  const [authorEmail, setAuthorEmail] = useState(anonymousInfo.authorEmail);
  const [authorWebsite, setAuthorWebsite] = useState(
    anonymousInfo.authorWebsite,
  );

  const commentsMap = useMemo(
    () => new Map(comments.map((c) => [c.id, c])),
    [comments],
  );

  // 创建 markdown 组件配置
  const components = useMemo(
    () => markdownComponents(shikiTheme),
    [shikiTheme],
  );

  // 监听验证码消息
  useBroadcast((message: { type: string; token?: string }) => {
    if (message?.type === "captcha-solved" && message.token) {
      setCaptchaToken(message.token);
    }
  });

  // 保存匿名用户信息
  const saveAnonymousInfo = useCallback(() => {
    if (isAnonymous) {
      setAnonymousInfo({ authorName, authorEmail, authorWebsite });
    }
  }, [isAnonymous, authorName, authorEmail, authorWebsite, setAnonymousInfo]);

  // 保存和移除本地待审核评论
  const saveLocalPendingComment = useCallback(
    (comment: LocalPendingComment) => {
      setLocalPendingComments((prev) => [...prev, comment].slice(-50));
    },
    [setLocalPendingComments],
  );

  const removeLocalPendingComment = useCallback(
    (localId: string) => {
      setLocalPendingComments((prev) =>
        prev.filter((c) => c.localId !== localId),
      );
    },
    [setLocalPendingComments],
  );

  // 过滤当前文章的本地评论
  const currentSlugLocalComments = useMemo(
    () => localPendingComments.filter((c) => c.slug === slug),
    [localPendingComments, slug],
  );

  // 加载评论
  const loadComments = useCallback(
    async (cursorParam?: string) => {
      setLoading(true);
      const startTime = Date.now();
      try {
        const result = await getPostComments({
          slug,
          pageSize: 10,
          maxDepth: 1,
          cursor: cursorParam,
        });
        const response = await resolveApiResponse(result);
        if (response?.success && Array.isArray(response.data)) {
          const incoming = response.data as CommentItem[];
          setComments((prev) =>
            cursorParam ? mergeBySortKey(prev, incoming) : incoming,
          );
          setHasNext(response.meta?.hasNext ?? false);
          setCursor((response.meta as { nextCursor?: string })?.nextCursor);
          setTotalComments(response.meta?.total ?? 0); // 设置真实的评论总数

          // 广播评论数（仅在首次加载时）
          if (!cursorParam) {
            broadcast({
              type: "comment-count",
              count: response.meta?.total ?? 0,
            });
          }
        } else {
          toastError("加载评论失败", response?.message || "");
        }
      } catch (error) {
        console.error("加载评论失败", error);
        toastError("加载评论失败", "请稍后重试");
      } finally {
        const elapsed = Date.now() - startTime;
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(0, 500 - elapsed)),
        );
        setLoading(false);
      }
    },
    [slug, toastError, broadcast],
  );

  // 立即加载评论
  useEffect(() => {
    if (!commentsLoaded) {
      setCommentsLoaded(true);
      loadComments();
    }
  }, [commentsLoaded, loadComments]);

  // 当触发评论进入视口时加载更多
  useEffect(() => {
    if (inView && hasNext && !loading && !loadingMoreRef.current) {
      // 添加小延迟避免初始渲染时立即触发
      const timer = setTimeout(() => {
        if (hasNext && !loading && !loadingMoreRef.current) {
          loadingMoreRef.current = true;
          loadComments(cursor).finally(() => {
            loadingMoreRef.current = false;
          });
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [inView, hasNext, loading, cursor, loadComments]);

  // 加载直接子评论
  const loadDirectChildren = useCallback(
    async (parentId: string, cursorParam?: string) => {
      const currentState = childPaginationMap.get(parentId);
      if (currentState?.loading) return;

      setChildPaginationMap((prev) => {
        const next = new Map(prev);
        next.set(parentId, {
          ...currentState,
          cursor: currentState?.cursor,
          hasNext: currentState?.hasNext ?? false,
          loading: true,
          expanded: true,
        });
        return next;
      });

      try {
        const result = await getDirectChildren({
          parentId,
          postSlug: slug,
          pageSize: 10,
          cursor: cursorParam,
        });
        const response = await resolveApiResponse(result);

        if (response?.success && Array.isArray(response.data)) {
          const incoming = response.data as CommentItem[];
          const meta = response.meta as
            | { nextCursor?: string; hasNext?: boolean }
            | undefined;

          setComments((prev) => mergeBySortKey(prev, incoming));
          setChildPaginationMap((prev) => {
            const next = new Map(prev);
            next.set(parentId, {
              cursor: meta?.nextCursor,
              hasNext: meta?.hasNext ?? false,
              loading: false,
              expanded: true,
            });

            // 初始化预加载的子评论展开状态
            incoming.forEach((comment) => {
              if (
                (comment.replyCount > 0 || comment.hasMore) &&
                !next.has(comment.id)
              ) {
                const directChildren = incoming.filter(
                  (c) => c.parentId === comment.id,
                );
                if (directChildren.length > 0) {
                  const hasMoreChildren =
                    directChildren.length < (comment.replyCount ?? 0);
                  const lastChild = directChildren.sort((a, b) =>
                    b.sortKey.localeCompare(a.sortKey),
                  )[0];
                  next.set(comment.id, {
                    expanded: true,
                    loading: false,
                    hasNext: hasMoreChildren,
                    cursor: lastChild?.sortKey,
                  });
                }
              }
            });
            return next;
          });
        } else {
          toastError("加载回复失败", response?.message || "");
          setChildPaginationMap((prev) => {
            const next = new Map(prev);
            const state = next.get(parentId);
            if (state) next.set(parentId, { ...state, loading: false });
            return next;
          });
        }
      } catch (error) {
        console.error("加载回复失败", error);
        toastError("加载回复失败", "请稍后重试");
        setChildPaginationMap((prev) => {
          const next = new Map(prev);
          const state = next.get(parentId);
          if (state) next.set(parentId, { ...state, loading: false });
          return next;
        });
      }
    },
    [slug, childPaginationMap, toastError],
  );

  // 初始化预加载评论的展开状态
  useEffect(() => {
    if (comments.length === 0) return;

    setChildPaginationMap((prev) => {
      const next = new Map(prev);
      comments.forEach((parent) => {
        if (next.has(parent.id) || (parent.replyCount ?? 0) === 0) return;

        const directChildren = comments.filter((c) => c.parentId === parent.id);
        if (directChildren.length > 0) {
          const hasMoreChildren =
            directChildren.length < (parent.replyCount ?? 0);
          const lastChild = directChildren.sort((a, b) =>
            b.sortKey.localeCompare(a.sortKey),
          )[0];
          next.set(parent.id, {
            expanded: true,
            loading: false,
            hasNext: hasMoreChildren,
            cursor: lastChild?.sortKey,
          });
        }
      });
      return next;
    });
  }, [comments]);

  // 切换折叠和高亮
  const handleToggleCollapse = useCallback((commentId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(commentId)) {
        next.delete(commentId);
      } else {
        next.add(commentId);
      }
      return next;
    });
  }, []);

  const handleMouseEnter = useCallback((comment: CommentItem) => {
    setHoveredPath(comment.path.split("/"));
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHoveredPath([]);
  }, []);

  const handleHighlight = useCallback((commentId: string | null) => {
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = null;
    }
    setHighlightedId(commentId);
    if (commentId) {
      highlightTimerRef.current = setTimeout(() => {
        setHighlightedId((prev) => (prev === commentId ? null : prev));
        highlightTimerRef.current = null;
      }, 3000);
    }
  }, []);

  // 刷新评论
  const handleRefresh = useCallback(() => {
    if (!commentsLoaded) return;
    setComments([]);
    setCursor(undefined);
    // 不要在这里设置 hasNext，让 loadComments 负责
    // setHasNext(false);
    setCollapsedIds(new Set());
    setChildPaginationMap(new Map());
    // 重置加载状态
    loadingMoreRef.current = false;
    loadComments();
  }, [commentsLoaded, loadComments]);

  // 点赞/取消点赞
  const handleToggleLike = useCallback(
    async (commentId: string, currentIsLiked: boolean) => {
      if (isAnonymous) {
        toastError("登录后才能点赞评论");
        return;
      }

      // 乐观更新
      const updateLike = (delta: number, liked: boolean) =>
        setComments((prev) =>
          prev.map((c) =>
            c.id === commentId
              ? { ...c, likeCount: c.likeCount + delta, isLiked: liked }
              : c,
          ),
        );

      updateLike(currentIsLiked ? -1 : 1, !currentIsLiked);

      try {
        const result = currentIsLiked
          ? await unlikeComment({ commentId })
          : await likeComment({ commentId });
        const response = await resolveApiResponse(result);

        if (!response?.success) {
          updateLike(currentIsLiked ? 1 : -1, currentIsLiked);
          toastError("操作失败", response?.message || "");
        } else if (response.data) {
          const { likeCount, isLiked } = response.data;
          setComments((prev) =>
            prev.map((c) =>
              c.id === commentId ? { ...c, likeCount, isLiked } : c,
            ),
          );
        }
      } catch {
        updateLike(currentIsLiked ? 1 : -1, currentIsLiked);
        toastError("操作失败", "请稍后重试");
      }
    },
    [isAnonymous, toastError],
  );

  // 回复和删除
  const handleReply = useCallback((comment: CommentItem) => {
    setReplyTarget(comment);
    setTimeout(() => {
      inputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      // 等待滚动动画完成后再聚焦
      setTimeout(() => {
        inputRef.current?.focus();
      }, 1000);
    }, 100);
  }, []);

  const handleDeleteClick = useCallback((comment: CommentItem) => {
    setCommentToDelete(comment);
    setDeleteDialogOpen(true);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!commentToDelete) return;

    setDeleting(true);
    try {
      const result = await deleteOwnComment({ commentId: commentToDelete.id });
      const response = await resolveApiResponse(result);

      if (response?.success) {
        setComments((prev) => prev.filter((c) => c.id !== commentToDelete.id));
        toastSuccess("评论已删除");
        setDeleteDialogOpen(false);
        setCommentToDelete(null);
      } else {
        toastError("删除失败", response?.message || "");
      }
    } catch (error) {
      console.error("删除评论失败", error);
      toastError("删除失败", "请稍后重试");
    } finally {
      setDeleting(false);
    }
  }, [commentToDelete, toastSuccess, toastError]);

  // 提交评论
  const handleSubmit = async () => {
    const targetLabel = slug.startsWith("/") ? "页面" : "文章";
    // 验证
    if (!allowComments) {
      return toastError("评论已关闭", `该${targetLabel}未开启评论`);
    }
    if (!content.trim()) return toastError("评论不能为空");
    if (content.length > 1000) return toastError("评论过长", "最多 1000 字");
    if (isAnonymous && !commentConfig.anonymousEnabled)
      return toastError("请登录后再评论");
    if (
      isAnonymous &&
      commentConfig.anonymousEmailRequired &&
      !authorEmail.trim()
    ) {
      return toastError("请填写邮箱");
    }
    if (!captchaToken) return toastError("请先完成安全验证");

    if (isAnonymous) saveAnonymousInfo();

    const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const localComment: LocalPendingComment = {
      localId,
      slug,
      content: content.trim(),
      parentId: replyTarget?.id,
      authorName: authorName || "匿名",
      authorEmail: authorEmail || undefined,
      authorWebsite:
        commentConfig.anonymousWebsiteEnabled && authorWebsite
          ? authorWebsite
          : undefined,
      createdAt: new Date().toISOString(),
      replyToAuthorName: replyTarget?.author.displayName,
    };

    setSubmitting(true);
    try {
      const result = await createComment({
        slug,
        content,
        parentId: replyTarget?.id,
        authorName: isAnonymous ? authorName || "匿名" : undefined,
        authorEmail: isAnonymous ? authorEmail || undefined : undefined,
        authorWebsite:
          isAnonymous && commentConfig.anonymousWebsiteEnabled
            ? authorWebsite || undefined
            : undefined,
        captcha_token: captchaToken,
      });
      const response = await resolveApiResponse(result);
      if (response?.success && response.data) {
        const newComment = response.data as CommentItem;
        setComments((prev) => mergeBySortKey(prev, [newComment]));
        setContent("");
        setReplyTarget(null);

        if (newComment.status === "PENDING" && isAnonymous) {
          saveLocalPendingComment({
            ...localComment,
            localId: `server-${newComment.id}`,
          });
        }

        // 展开路径
        if (newComment.path) {
          const pathIds = newComment.path.split("/").slice(0, -1);
          setCollapsedIds((prev) => {
            const next = new Set(prev);
            pathIds.forEach((id) => next.delete(id));
            return next;
          });
          setChildPaginationMap((prev) => {
            const next = new Map(prev);
            pathIds.forEach((id) => {
              const existing = next.get(id);
              next.set(
                id,
                existing
                  ? { ...existing, expanded: true }
                  : {
                      hasNext: false,
                      loading: false,
                      expanded: true,
                    },
              );
            });
            return next;
          });
        }

        handleHighlight(newComment.id);
        setTimeout(() => {
          document
            .getElementById(`comment-${newComment.id}`)
            ?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 300);

        toastSuccess(
          newComment.status === "APPROVED"
            ? "评论发布成功"
            : "评论提交成功，等待审核",
        );
      } else {
        toastError("提交失败", response?.message || "");
      }
    } catch (error) {
      console.error("提交评论失败", error);
      toastError("提交评论失败", "请稍后重试");
    } finally {
      setSubmitting(false);
      setCaptchaToken("");
      setTimeout(() => {
        setCaptchaLoaded(true);
        broadcast({ type: "captcha-reset" });
      }, 100);
    }
  };

  // 将本地待审核评论转换为 CommentItem
  const localCommentsAsItems = useMemo((): CommentItem[] => {
    return currentSlugLocalComments.map((local) => ({
      id: local.localId,
      postSlug: local.slug,
      parentId: local.parentId ?? null,
      content: local.content,
      status: "PENDING",
      mine: true,
      replyCount: 0,
      depth: local.parentId ? 1 : 0,
      path: local.parentId
        ? `${local.parentId}/${local.localId}`
        : local.localId,
      sortKey: `z-local-${local.createdAt}`,
      descendantCount: 0,
      hasMore: false,
      createdAt: local.createdAt,
      location: null,
      likeCount: 0,
      isLiked: undefined,
      author: {
        uid: null,
        username: null,
        nickname: null,
        avatar: null,
        displayName: local.authorName,
        website: local.authorWebsite ?? null,
        isAnonymous: true,
        emailMd5: null,
      },
      replyTo: local.replyToAuthorName
        ? {
            id: local.localId,
            authorName: local.replyToAuthorName,
            content: "",
          }
        : null,
    }));
  }, [currentSlugLocalComments]);

  // 检查并清理已同步的本地评论
  useEffect(() => {
    if (comments.length === 0 || currentSlugLocalComments.length === 0) return;

    currentSlugLocalComments.forEach((local) => {
      if (local.localId.startsWith("server-")) {
        const serverId = local.localId.replace("server-", "");
        const matched = comments.find((c) => c.id === serverId);
        if (matched && matched.status === "APPROVED") {
          removeLocalPendingComment(local.localId);
        }
      } else {
        const matched = comments.find(
          (c) =>
            c.content === local.content &&
            c.author.displayName === local.authorName &&
            c.mine === true,
        );
        if (matched) removeLocalPendingComment(local.localId);
      }
    });
  }, [comments, currentSlugLocalComments, removeLocalPendingComment]);

  // 过滤可见评论
  const visibleComments = useMemo(() => {
    const filtered = comments.filter((c) => {
      if (isHiddenByCollapse(c, collapsedIds, commentsMap)) return false;

      const ancestorIds = c.path.split("/").slice(0, -1);
      if (ancestorIds.length > 0) {
        for (const ancestorId of ancestorIds) {
          const ancestorState = childPaginationMap.get(ancestorId);
          if (!ancestorState?.expanded) return false;
        }
      }
      return true;
    });

    const filteredLocal = localCommentsAsItems.filter((local) => {
      if (local.id.startsWith("server-")) {
        const serverId = local.id.replace("server-", "");
        if (comments.some((c) => c.id === serverId)) return false;
      }
      return !comments.some(
        (c) =>
          c.content === local.content &&
          c.author.displayName === local.author.displayName &&
          c.mine === true,
      );
    });

    return [...filtered, ...filteredLocal];
  }, [
    comments,
    collapsedIds,
    commentsMap,
    localCommentsAsItems,
    childPaginationMap,
  ]);

  // 计算最后一个直接子评论
  const lastDirectChildMap = useMemo(() => {
    const map = new Map<string, string>();
    visibleComments.forEach((c) => {
      if (c.parentId) map.set(c.parentId, c.id);
    });
    return map;
  }, [visibleComments]);

  // 路径判断
  const isInHoverPath = useCallback(
    (comment: CommentItem) => hoveredPath.includes(comment.id),
    [hoveredPath],
  );

  const isCurrentHovered = useCallback(
    (comment: CommentItem) =>
      hoveredPath.length > 0 &&
      hoveredPath[hoveredPath.length - 1] === comment.id,
    [hoveredPath],
  );

  const isDirectParent = useCallback(
    (comment: CommentItem) =>
      hoveredPath.length >= 2 &&
      hoveredPath[hoveredPath.length - 2] === comment.id,
    [hoveredPath],
  );

  // 如果不允许评论，不渲染
  if (!allowComments) {
    return null;
  }

  return (
    <div
      id="comments"
      className="max-w-5xl mx-auto pb-10 pt-8"
      ref={commentsContainerRef}
    >
      <h2
        className="text-2xl font-semibold flex items-center gap-2"
        id="comment"
      >
        评论
        <AutoTransition>
          <span key={totalComments} className="text-lg text-muted-foreground">
            {totalComments > 0 && `(${totalComments})`}
          </span>
        </AutoTransition>
      </h2>

      {/* 评论输入区 */}
      <div className="space-y-3 mb-6">
        <AutoResizer>
          <AutoTransition>
            {replyTarget && (
              <div className="bg-muted/30 p-3 border-l-4 border-muted mb-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-muted-foreground flex items-center gap-2 mb-1">
                      <RiReplyLine size={"1em"} />
                      <span>正在回复</span>
                      <span className="font-semibold text-foreground">
                        {replyTarget.author.displayName}
                      </span>
                    </div>
                    <div className="text-sm text-muted-foreground line-clamp-2 pl-5">
                      {escapeHtml(replyTarget.content).length > 100
                        ? `${escapeHtml(replyTarget.content).slice(0, 100)}...`
                        : escapeHtml(replyTarget.content)}
                    </div>
                  </div>
                  <Clickable
                    onClick={() => setReplyTarget(null)}
                    className="text-muted-foreground hover:text-foreground flex-shrink-0"
                  >
                    <RiCloseLine size="1.25em" />
                  </Clickable>
                </div>
              </div>
            )}
          </AutoTransition>
        </AutoResizer>

        <div>
          <Input
            ref={inputRef}
            label=""
            rows={4}
            size="sm"
            maxLength={1000}
            placeholder={commentConfig.placeholder}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onFocus={() => !captchaLoaded && setCaptchaLoaded(true)}
            className="mt-0 pt-0"
          />
        </div>
        {isAnonymous && commentConfig.anonymousEnabled && (
          <div
            className={`grid grid-cols-1 gap-3 ${commentConfig.anonymousWebsiteEnabled ? "md:grid-cols-3" : "md:grid-cols-2"}`}
          >
            <Input
              label="昵称"
              helperText="选填，默认为匿名"
              size="sm"
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
            />
            <Input
              label={commentConfig.anonymousEmailRequired ? "邮箱*" : "邮箱"}
              required={commentConfig.anonymousEmailRequired}
              helperText="用于头像和通知"
              size="sm"
              value={authorEmail}
              onChange={(e) => setAuthorEmail(e.target.value)}
            />
            {commentConfig.anonymousWebsiteEnabled && (
              <Input
                label="个人网站"
                helperText="选填"
                size="sm"
                value={authorWebsite}
                onChange={(e) => setAuthorWebsite(e.target.value)}
              />
            )}
          </div>
        )}

        {/* 预览区域 */}
        <AutoResizer duration={0.3}>
          <div>
            <AutoTransition type="fade" duration={0.2} initial={false}>
              {showPreview && content.trim() ? (
                <div
                  key="preview"
                  className="p-4 bg-muted/20 border border-muted rounded-sm"
                >
                  <div className="prose prose-sm dark:prose-invert max-w-none break-words md-content mini-md-content">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]}
                      rehypePlugins={[rehypeKatex]}
                      components={components}
                    >
                      {content}
                    </ReactMarkdown>
                  </div>
                </div>
              ) : (
                <div key="no-preview" style={{ height: 0 }} />
              )}
            </AutoTransition>
          </div>
        </AutoResizer>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Tooltip content="支持 Markdown 语法">
              <RiMarkdownLine size="1.25em" />
            </Tooltip>
            <Tooltip content="刷新评论">
              <Clickable onClick={handleRefresh} className="ml-auto">
                <RiRefreshLine
                  size="1.25em"
                  className="text-muted-foreground hover:text-foreground"
                />
              </Clickable>
            </Tooltip>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground font-mono">
              {content.length} / 1000
            </span>
            {/* 预览按钮 */}
            <Button
              label={showPreview ? "收起" : "预览"}
              size="sm"
              variant="secondary"
              onClick={() => setShowPreview(!showPreview)}
              disabled={!content.trim()}
            />
            {isAnonymous && (
              <Tooltip content="登录至现有账号，或使用 Github/Google/Microsoft 账号快捷登录">
                <Button
                  label="登录"
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    navigate(
                      "/login?redirect=" +
                        encodeURIComponent(window.location.pathname) +
                        "#comment",
                    )
                  }
                ></Button>
              </Tooltip>
            )}

            {captchaLoaded ? (
              <CaptchaButton
                size="sm"
                label={
                  submitting
                    ? isAnonymous
                      ? "评论发送中"
                      : "正在发送"
                    : isAnonymous
                      ? "免登录评论"
                      : "发送评论"
                }
                loading={submitting}
                verificationText={isAnonymous ? "安全验证中" : "正在验证"}
                onClick={handleSubmit}
              />
            ) : (
              <Tooltip content="请输入评论内容">
                <Button
                  size="sm"
                  variant="primary"
                  disabled
                  label={isAnonymous ? "免登录评论" : "发送评论"}
                />
              </Tooltip>
            )}
          </div>
        </div>
      </div>

      {/* 评论列表 */}
      <AutoResizer>
        <AutoTransition type="fade" duration={0.2} initial={false}>
          {!commentsLoaded ? (
            <div
              key="loading"
              className="flex items-center gap-2 py-4 text-sm text-muted-foreground w-full h-24 justify-center"
            >
              <LoadingIndicator />
            </div>
          ) : (
            <div key="loaded">
              <AnimatePresence initial={false}>
                {visibleComments.map((comment, index) => {
                  const childState = childPaginationMap.get(comment.id);
                  const parentId = comment.parentId;
                  const isLastDirectChild =
                    parentId && lastDirectChildMap.get(parentId) === comment.id;
                  const parentState = parentId
                    ? childPaginationMap.get(parentId)
                    : null;
                  const parentComment = parentId
                    ? commentsMap.get(parentId)
                    : null;
                  const showParentSentinel =
                    isLastDirectChild &&
                    parentState?.expanded &&
                    parentState.hasNext &&
                    !collapsedIds.has(parentId);

                  // 将 loadMoreRef 附加到倒数第2条评论上
                  // 这样用户接近底部时就会自动加载下一页
                  const shouldAttachLoadMoreRef =
                    hasNext &&
                    visibleComments.length > 2 &&
                    index === visibleComments.length - 2;

                  return (
                    <React.Fragment key={comment.id}>
                      <motion.div
                        ref={shouldAttachLoadMoreRef ? loadMoreRef : undefined}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{
                          height: "auto",
                          opacity: 1,
                          transition: {
                            height: { duration: 0.3, ease: "easeInOut" },
                            opacity: { duration: 0.2, delay: 0.1 },
                          },
                        }}
                        exit={{
                          height: 0,
                          opacity: 0,
                          transition: {
                            height: {
                              duration: 0.3,
                              ease: "easeInOut",
                              delay: 0.1,
                            },
                            opacity: { duration: 0.2 },
                          },
                        }}
                        style={{ overflow: "hidden" }}
                        onMouseEnter={() => handleMouseEnter(comment)}
                        onMouseLeave={handleMouseLeave}
                      >
                        <SingleComment
                          comment={comment}
                          onReply={handleReply}
                          onToggleCollapse={handleToggleCollapse}
                          onExpandChildren={loadDirectChildren}
                          onHighlight={handleHighlight}
                          onToggleLike={handleToggleLike}
                          onDelete={handleDeleteClick}
                          childPaginationState={childState}
                          isCollapsed={collapsedIds.has(comment.id)}
                          isHighlighted={highlightedId === comment.id}
                          isInHoverPath={isInHoverPath(comment)}
                          isCurrentHovered={isCurrentHovered(comment)}
                          isDirectParent={isDirectParent(comment)}
                          authorUid={authorUid}
                          navigate={navigate}
                          components={components}
                        />
                      </motion.div>
                      <AutoResizer duration={0.3}>
                        <AutoTransition type="fade" duration={0.2}>
                          {showParentSentinel && parentComment && (
                            <LoadMoreChildrenButton
                              key={`parent-loadmore-${parentId}`}
                              parentId={parentId}
                              loading={parentState?.loading ?? false}
                              depth={parentComment.depth}
                              remainingCount={
                                (parentComment.replyCount || 0) -
                                visibleComments.filter(
                                  (c) => c.parentId === parentId,
                                ).length
                              }
                              onLoadMore={(pid) =>
                                loadDirectChildren(pid, parentState?.cursor)
                              }
                            />
                          )}
                        </AutoTransition>
                      </AutoResizer>
                    </React.Fragment>
                  );
                })}
              </AnimatePresence>

              {/* 底部加载指示器 - 当还有更多评论时显示 */}
              <AutoResizer duration={0.3}>
                <AutoTransition type="fade" duration={0.2}>
                  {hasNext && (
                    <div
                      key="bottom-loading"
                      className="flex items-center gap-2 py-4 text-sm text-muted-foreground w-full h-24 justify-center"
                    >
                      <LoadingIndicator />
                    </div>
                  )}
                </AutoTransition>
              </AutoResizer>

              <AutoTransition type="fade" duration={0.3}>
                {!loading && comments.length === 0 && (
                  <div
                    key="empty"
                    className="text-muted-foreground text-sm py-8 text-center"
                  >
                    暂无评论
                  </div>
                )}
              </AutoTransition>
            </div>
          )}
        </AutoTransition>
      </AutoResizer>

      {/* 删除确认对话框 */}
      <AlertDialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={handleConfirmDelete}
        title="确认删除评论"
        description="删除后将无法恢复，确定要删除这条评论吗？"
        confirmText="删除"
        cancelText="取消"
        variant="danger"
        loading={deleting}
      />
    </div>
  );
}
