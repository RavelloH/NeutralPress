import "server-only";

import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import UserProfileModal from "@/app/@modal/(.)user/[uid]/UserProfileModal";
import ViewCountBatchLoader from "@/components/client/logic/ViewCountBatchLoader";
import { verifyAccessToken } from "@/lib/server/auth-verify";
import { getUserPublicProfile } from "@/lib/server/services/user-domain";

interface UserProfileModalPageProps {
  params: Promise<{ uid: string }>;
}

export default async function UserProfileModalPage({
  params,
}: UserProfileModalPageProps) {
  const { uid } = await params;
  const uidNumber = parseInt(uid, 10);

  // 检查 UID 是否有效
  if (isNaN(uidNumber)) {
    notFound();
  }

  // 获取当前登录用户（可能为空）
  const cookieStore = await cookies();
  const token = cookieStore.get("ACCESS_TOKEN")?.value;
  const currentUser = token ? await verifyAccessToken(token) : null;
  const isGuest = !currentUser;

  // 获取用户档案
  const profileResult = await getUserPublicProfile(uidNumber);

  if (!profileResult.success || !profileResult.data) {
    notFound();
  }

  return (
    <>
      <UserProfileModal
        key={randomUUID()}
        profile={profileResult.data}
        initialActivities={[]}
        hasMore={true}
        isGuest={isGuest}
      />
      <ViewCountBatchLoader />
    </>
  );
}
