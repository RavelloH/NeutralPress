import "server-only";

import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";

import MessagesModal from "@/app/@modal/(.)messages/MessagesModal";
import { authVerify } from "@/lib/server/auth-verify";
import { getConversations } from "@/lib/server/services/message-domain";

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

interface MessagesInterceptPageProps {
  searchParams?: Promise<SearchParamsRecord>;
}

export default async function MessagesInterceptPage({
  searchParams,
}: MessagesInterceptPageProps) {
  const resolvedSearchParams = await searchParams;
  const redirectTarget = buildMessagesRedirectPath(resolvedSearchParams);

  // 检查登录状态
  const cookieStore = await cookies();
  const token = cookieStore.get("ACCESS_TOKEN")?.value;
  const user = await authVerify({
    allowedRoles: ["USER", "ADMIN", "EDITOR", "AUTHOR"],
    accessToken: token,
  });

  if (!user) {
    return (
      <MessagesModal
        key={randomUUID()}
        initialConversations={[]}
        initialTotal={0}
        initialHasMore={false}
        currentUserId={0}
        isAuthenticated={false}
        redirectTarget={redirectTarget}
      />
    );
  }

  // 获取初始会话列表
  const result = await getConversations(undefined, 0, 20);

  if (!result.success || !result.data) {
    return null;
  }

  const { conversations, hasMore, total } = result.data;

  return (
    <MessagesModal
      key={randomUUID()}
      initialConversations={conversations}
      initialTotal={total}
      initialHasMore={hasMore}
      currentUserId={user.uid}
      redirectTarget={redirectTarget}
    />
  );
}
