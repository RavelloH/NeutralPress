import "server-only";

import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import NotificationsModal from "@/app/@modal/(.)notifications/NotificationsModal";
import { authVerify } from "@/lib/server/auth-verify";
import { getNotices } from "@/lib/server/services/notice-domain";

export default async function NotificationsInterceptPage() {
  // 检查登录状态
  const cookieStore = await cookies();
  const token = cookieStore.get("ACCESS_TOKEN")?.value;
  const user = await authVerify({
    allowedRoles: ["USER", "ADMIN", "EDITOR", "AUTHOR"],
    accessToken: token,
  });
  if (!user) {
    redirect("/login?redirect=/notifications");
  }

  // 获取通知数据
  const result = await getNotices();

  if (!result.success || !result.data) {
    return null;
  }

  const { unread, read, hasMoreRead, total, unreadCount } = result.data;
  const totalReadCount = total - unreadCount; // 计算已读通知总数

  return (
    <NotificationsModal
      key={randomUUID()}
      unreadNotices={unread}
      readNotices={read}
      totalReadCount={totalReadCount}
      hasMoreRead={hasMoreRead}
    />
  );
}
