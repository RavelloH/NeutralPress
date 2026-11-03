import "server-only";

import { RiQuestionAnswerLine } from "@remixicon/react";
import { cookies } from "next/headers";
import Link from "next/link";

import MessagesClient from "@/components/client/features/chat/MessagesClient";
import ErrorPage from "@/components/ui/Error";
import { authVerify } from "@/lib/server/auth-verify";
import { generateMetadata } from "@/lib/server/seo";
import { getConversations } from "@/lib/server/services/message-domain";

export const metadata = await generateMetadata(
  {
    title: "私信",
    description: "查看和发送私信",
    robots: {
      index: false,
      follow: false,
    },
  },
  { pathname: "/messages" },
);

type SearchParamsRecord = Record<string, string | string[] | undefined>;

function getFirstParam(value: string | string[] | undefined): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (Array.isArray(value) && value.length > 0) {
    return value[0] ?? null;
  }
  return null;
}

function buildMessagesRedirectPath(searchParams?: SearchParamsRecord): string {
  const uid = getFirstParam(searchParams?.uid);
  const conversation = getFirstParam(searchParams?.conversation);
  const params = new URLSearchParams();

  if (uid) {
    params.set("uid", uid);
  }

  if (conversation) {
    params.set("conversation", conversation);
  }

  const query = params.toString();
  return query ? `/messages?${query}` : "/messages";
}

interface MessagesPageProps {
  searchParams?: Promise<SearchParamsRecord>;
}

export default async function MessagesPage({
  searchParams,
}: MessagesPageProps) {
  const resolvedSearchParams = await searchParams;

  // 检查登录状态
  const cookieStore = await cookies();
  const token = cookieStore.get("ACCESS_TOKEN")?.value;
  const user = await authVerify({
    allowedRoles: ["USER", "ADMIN", "EDITOR", "AUTHOR"],
    accessToken: token,
  });

  if (!user) {
    const redirectPath = encodeURIComponent(
      buildMessagesRedirectPath(resolvedSearchParams),
    );
    const loginHref = `/login?redirect=${redirectPath}`;
    const registerHref = `/register?redirect=${redirectPath}`;

    return (
      <div className="flex h-full bg-background">
        {/* 左侧：会话列表空态 */}
        <div className="flex-shrink-0 w-96 border-r border-foreground/10 bg-background">
          <div className="flex h-full flex-col">
            <div className="flex-shrink-0 px-6 py-4 border-b border-foreground/10">
              <h2 className="text-xl font-bold text-foreground">私信</h2>
            </div>
            <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
              <p className="text-sm text-muted-foreground">
                私信功能需要登录后使用
              </p>
            </div>
          </div>
        </div>

        {/* 右侧：聊天窗口空态 */}
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground px-6 text-center">
          <RiQuestionAnswerLine size="4em" className="mb-4" />
          <p className="text-lg">私信功能需要登录后使用</p>
          <div className="mt-4 flex items-center gap-3">
            <Link
              href={loginHref}
              className="inline-flex items-center justify-center rounded-sm px-4 py-1.5 text-md bg-foreground text-background transition-opacity duration-200 hover:opacity-80"
            >
              登录
            </Link>
            <Link
              href={registerHref}
              className="inline-flex items-center justify-center rounded-sm bg-primary px-4 py-1.5 text-md text-primary-foreground transition-opacity duration-200 hover:opacity-80"
            >
              注册
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // 获取初始会话列表
  const result = await getConversations(undefined, 0, 20);

  if (!result.success || !result.data) {
    return (
      <ErrorPage
        reason={
          new Error("无法加载会话列表：" + (result.message || "未知错误"))
        }
      />
    );
  }

  const { conversations, hasMore, total } = result.data;

  return (
    <div className="h-full">
      <MessagesClient
        initialConversations={conversations}
        initialTotal={total}
        initialHasMore={hasMore}
        currentUserId={user.uid}
        isModal={false}
      />
    </div>
  );
}
