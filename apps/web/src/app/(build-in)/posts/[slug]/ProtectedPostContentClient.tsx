"use client";

import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { RiLock2Line, RiShieldKeyholeLine } from "@remixicon/react";
import type { ProtectedPostContent } from "@repo/shared-types/api/post";

import { unlockProtectedPost } from "@/actions/post";
import CommentsSection from "@/components/client/features/posts/CommentsSection";
import PostToc from "@/components/client/features/posts/PostToc";
import MarkdownClientRenderer from "@/components/client/renderer/MarkdownClientRenderer";
import MDXClientRenderer from "@/components/client/renderer/MDXClientRenderer";
import { CaptchaButton } from "@/components/ui/CaptchaButton";
import { useNavigateWithTransition } from "@/components/ui/Link";
import { useConfig } from "@/context/ConfigContext";
import { useBroadcast, useBroadcastSender } from "@/hooks/use-broadcast";
import { getProtectedPostContent } from "@/lib/client/api/post-read";
import { resolveApiResponse } from "@/lib/client/run-with-auth";
import { prepareRichTextSource } from "@/lib/shared/rich-text-source";
import type { MDXContentMessage } from "@/types/broadcast-messages";
import type { ConfigType } from "@/types/config";
import { AutoResizer } from "@/ui/AutoResizer";
import { AutoTransition } from "@/ui/AutoTransition";
import { Button } from "@/ui/Button";
import { Input } from "@/ui/Input";
import { LoadingIndicator } from "@/ui/LoadingIndicator";
import { useToast } from "@/ui/Toast";

type CommentConfig = {
  placeholder: string;
  anonymousEnabled: boolean;
  anonymousEmailRequired: boolean;
  anonymousWebsiteEnabled: boolean;
  reviewAll: boolean;
  reviewAnonymous: boolean;
  locateEnabled: boolean;
};

interface ProtectedPostContentClientProps {
  slug: string;
  accessMode: "ROLE" | "PASSWORD";
  minRole: "USER" | "ADMIN" | "EDITOR" | "AUTHOR" | null;
  authorUid: number;
  excerpt?: string | null;
  commentEnabled: boolean;
  commentConfig: CommentConfig;
  children?: ReactNode;
}

const ROLE_LABELS: Record<
  NonNullable<ProtectedPostContentClientProps["minRole"]>,
  string
> = {
  USER: "登录用户及以上",
  AUTHOR: "作者及以上",
  EDITOR: "编辑及以上",
  ADMIN: "管理员",
};

type ProtectedPostBroadcastMessage =
  | MDXContentMessage
  | {
      type: "captcha-reset" | "captcha-error" | "captcha-solved";
      captchaKey?: string;
      token?: string;
    };

export default function ProtectedPostContentClient({
  slug,
  accessMode,
  minRole,
  authorUid,
  excerpt,
  commentEnabled,
  commentConfig,
  children,
}: ProtectedPostContentClientProps) {
  const [contentData, setContentData] = useState<ProtectedPostContent | null>(
    null,
  );
  const [passphrase, setPassphrase] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [requiresLogin, setRequiresLogin] = useState(false);
  const [isLoadingContent, setIsLoadingContent] = useState(
    accessMode === "ROLE" || accessMode === "PASSWORD",
  );
  const [isUnlockPending, startUnlockTransition] = useTransition();
  const toast = useToast();
  const { broadcast } = useBroadcastSender<ProtectedPostBroadcastMessage>();
  const shikiTheme = useConfig(
    "site.shiki.theme",
  ) as ConfigType<"site.shiki.theme">;

  const articleContentId = useMemo(
    () => `protected-post-article-content-${slug}`,
    [slug],
  );
  const captchaBroadcastKey = useMemo(() => `protected-post:${slug}`, [slug]);
  const contentSelector = `#${articleContentId}`;
  const loginHref = `/login?redirect=${encodeURIComponent(`/posts/${slug}`)}`;
  const navigate = useNavigateWithTransition();

  const resetCaptchaState = useCallback(() => {
    setCaptchaToken("");
    void broadcast({
      type: "captcha-reset",
      captchaKey: captchaBroadcastKey,
    });
  }, [broadcast, captchaBroadcastKey]);

  useBroadcast(
    (message: { type: string; token?: string; captchaKey?: string }) => {
      if (
        message?.type === "captcha-solved" &&
        message.token &&
        message.captchaKey === captchaBroadcastKey
      ) {
        setCaptchaToken(message.token);
      }
    },
  );

  useBroadcast((message: { type: string; captchaKey?: string }) => {
    if (
      message?.type === "captcha-error" &&
      message.captchaKey === captchaBroadcastKey
    ) {
      setCaptchaToken("");
      toast.error("安全验证失败", "请刷新页面后重试");
    }
  });

  const loadContent = useCallback(
    async (options?: { silent?: boolean; showLoadingState?: boolean }) => {
      const silent = options?.silent ?? false;
      const showLoadingState = options?.showLoadingState ?? !silent;

      if (showLoadingState) {
        setIsLoadingContent(true);
      }

      try {
        const apiResponse = await resolveApiResponse(
          await getProtectedPostContent({ slug }),
        );

        if (apiResponse?.success && apiResponse.data) {
          setContentData(apiResponse.data);
          setRequiresLogin(false);
          return true;
        }

        if (!silent || accessMode === "ROLE") {
          const errorCode = apiResponse?.error?.code;

          setRequiresLogin(errorCode === "UNAUTHORIZED");
        }
        return false;
      } catch (error) {
        console.error("加载受保护文章正文失败:", error);
        if (!silent || accessMode === "ROLE") {
          setRequiresLogin(false);
          toast.error("正文加载失败", "请稍后重试");
        }
        return false;
      } finally {
        if (showLoadingState) {
          setIsLoadingContent(false);
        }
      }
    },
    [accessMode, slug, toast],
  );

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      const shouldSilentLoad = accessMode === "PASSWORD";
      const loaded = await loadContent({ silent: shouldSilentLoad });
      if (!cancelled) {
        if (accessMode === "ROLE" && !loaded) {
          setIsLoadingContent(false);
          return;
        }

        if (accessMode === "PASSWORD") {
          setIsLoadingContent(false);
        }
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [accessMode, loadContent]);

  useEffect(() => {
    if (!contentData) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      broadcast({ type: "mdx-content-rendered" });
      broadcast({ type: "mdx-content-recheck" });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [broadcast, contentData]);

  const handleUnlock = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const normalizedPassphrase = passphrase.trim();
      if (!normalizedPassphrase) {
        toast.error("请输入访问口令");
        return;
      }

      if (!captchaToken) {
        toast.error("请先完成安全验证");
        return;
      }

      startUnlockTransition(() => {
        void (async () => {
          try {
            const apiResponse = await resolveApiResponse(
              await unlockProtectedPost({
                slug,
                passphrase: normalizedPassphrase,
                captcha_token: captchaToken,
              }),
            );

            if (!apiResponse?.success) {
              toast.error("解锁失败", apiResponse?.message || "口令验证失败");
              return;
            }

            const loaded = await loadContent({ showLoadingState: false });
            if (loaded) {
              setPassphrase("");
            }
          } catch (error) {
            console.error("解锁受保护文章失败:", error);
            toast.error("解锁失败", "请稍后重试");
          } finally {
            resetCaptchaState();
          }
        })();
      });
    },
    [captchaToken, loadContent, passphrase, resetCaptchaState, slug, toast],
  );

  const accessHint =
    accessMode === "ROLE"
      ? minRole
        ? `此文章仅限 ${ROLE_LABELS[minRole]} 查看。`
        : "此文章需要更高权限才能查看。"
      : "此文章已启用口令保护，输入任一有效口令后即可查看正文。";
  const panelTitle = accessMode === "ROLE" ? "验证访问权限" : "输入口令解锁";
  const panelIcon =
    accessMode === "ROLE" ? (
      <RiShieldKeyholeLine size="3em" className="text-primary" />
    ) : (
      <RiLock2Line size="3em" className="text-primary" />
    );

  const excerptNode = excerpt ? (
    <div className="pb-12 max-w-4xl mx-auto">
      <div className="border-l-[3px] border-primary/60 pl-4 py-1">
        <p className="leading-loose text-muted-foreground text-sm">{excerpt}</p>
      </div>
    </div>
  ) : null;
  const commentsNode = commentEnabled ? (
    <CommentsSection
      slug={slug}
      allowComments={commentEnabled}
      authorUid={authorUid}
      commentConfig={commentConfig}
    />
  ) : null;
  const processedContentSource = useMemo(() => {
    if (!contentData) {
      return null;
    }

    return prepareRichTextSource(
      contentData.content,
      contentData.postMode === "MDX" ? "mdx" : "markdown",
      { skipFirstH1: true },
    );
  }, [contentData]);
  const articleBodyNode = contentData ? (
    <div key="protected-post-content" className="w-full">
      {contentData.postMode === "MDX" ? (
        <MDXClientRenderer source={processedContentSource || ""} />
      ) : (
        <MarkdownClientRenderer
          source={processedContentSource || ""}
          shikiTheme={shikiTheme}
        />
      )}
    </div>
  ) : isLoadingContent ? (
    <div
      className="flex min-h-32 items-center justify-center w-full py-6"
      key="protected-post-loading"
    >
      <LoadingIndicator />
    </div>
  ) : null;
  const accessPanelNode =
    contentData || isLoadingContent ? null : (
      <div
        className="mx-auto w-full bg-background/70 backdrop-blur-sm rounded-sm p-6 md:p-8"
        key="protected-post-access-panel"
      >
        <div className="mb-8 flex items-center justify-between gap-5">
          <div className="space-y-2">
            <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">
              Protected Post
            </p>
            <h2 className="text-3xl font-bold text-foreground tracking-wider">
              {panelTitle}
            </h2>
            <p className="text-sm leading-7 text-muted-foreground">
              {accessHint}
            </p>
          </div>
          <div className="inline-flex h-16 w-16 items-center justify-center">
            {panelIcon}
          </div>
        </div>

        {accessMode === "ROLE" ? (
          <div className="space-y-4">
            <div className="space-y-3 pt-2">
              {requiresLogin ? (
                <Button
                  label="前往登录"
                  variant="secondary"
                  size="md"
                  fullWidth
                  onClick={() => {
                    navigate(loginHref);
                  }}
                />
              ) : (
                <Button
                  label="重新检查权限"
                  variant="secondary"
                  size="md"
                  fullWidth
                  onClick={() => void loadContent()}
                />
              )}
            </div>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={handleUnlock}>
            <Input
              label="Passphrase / 访问口令"
              value={passphrase}
              helperText="输入文章口令后即可解锁正文"
              icon={<RiLock2Line size={"1em"} />}
              onChange={(event) => {
                setPassphrase(event.target.value);
              }}
              size="md"
              type="password"
              disabled={isUnlockPending}
            />
            <div className="pt-2">
              <CaptchaButton
                label="解锁正文"
                type="submit"
                variant="secondary"
                size="md"
                fullWidth
                broadcastKey={captchaBroadcastKey}
                loading={isUnlockPending}
                verificationText="正在执行安全验证"
              />
            </div>
          </form>
        )}
      </div>
    );
  const tocItems = contentData?.tocItems ?? [];

  return (
    <div className="px-6 md:px-10 max-w-7xl mx-auto pt-10 flex gap-6 relative h-full">
      <div className="flex-[8] min-w-0">
        {excerptNode}

        <AutoResizer className="w-full" duration={0.45}>
          <div className="w-full space-y-6">
            <AutoTransition
              type="fade"
              duration={0.35}
              initial={false}
              className="w-full"
            >
              {accessPanelNode}
            </AutoTransition>

            <div id={articleContentId}>
              <AutoTransition
                type="fade"
                duration={0.35}
                initial={false}
                className="w-full"
              >
                {articleBodyNode}
              </AutoTransition>
            </div>
          </div>
        </AutoResizer>

        {children}

        {commentsNode}
      </div>

      <div className="flex-[2] hidden lg:block max-w-screen h-full sticky top-10 self-start">
        <PostToc tocItems={tocItems} contentSelector={contentSelector} />
      </div>

      <div className="lg:hidden">
        <PostToc
          tocItems={tocItems}
          isMobile={true}
          contentSelector={contentSelector}
        />
      </div>
    </div>
  );
}
