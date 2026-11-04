import "server-only";

import { cookies } from "next/headers";

import NotificationsClient from "@/app/(account)/notifications/NotificationsClient";
import UnauthorizedPage from "@/app/unauthorized";
import { authVerify } from "@/lib/server/auth-verify";
import { generateMetadata } from "@/lib/server/seo";
import { getNotices } from "@/lib/server/services/notice-domain";

export const metadata = await generateMetadata(
  {
    title: "通知中心",
    robots: {
      index: false,
      follow: false,
    },
  },
  { pathname: "/notifications" },
);

export default async function NotificationsPage() {
  // 检查登录状态
  const cookieStore = await cookies();
  const token = cookieStore.get("ACCESS_TOKEN")?.value;
  const user = await authVerify({
    allowedRoles: ["USER", "ADMIN", "EDITOR", "AUTHOR"],
    accessToken: token,
  });
  if (!user) {
    return <UnauthorizedPage redirect="/notifications" />;
  }

  // 获取通知数据
  const result = await getNotices();

  if (!result.success || !result.data) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">加载通知失败</p>
      </div>
    );
  }

  const { unread, read, hasMoreRead, total, unreadCount } = result.data;
  const totalReadCount = total - unreadCount; // 计算已读通知总数

  return (
    <NotificationsClient
      unreadNotices={unread}
      readNotices={read}
      totalReadCount={totalReadCount}
      isModal={false}
      hasMoreRead={hasMoreRead}
    />
  );
}
