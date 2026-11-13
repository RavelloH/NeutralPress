import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import UserProfileClient from "@/components/client/features/user/UserProfileClient";
import ViewCountBatchLoader from "@/components/client/logic/ViewCountBatchLoader";
import { verifyAccessToken } from "@/lib/server/auth-verify";
import { generateMetadata as generateSEOMetadata } from "@/lib/server/seo";
import { getUserPublicProfile } from "@/lib/server/services/user-domain";

interface UserProfilePageProps {
  params: Promise<{ uid: string }>;
}

export async function generateMetadata({
  params,
}: UserProfilePageProps): Promise<Metadata> {
  const { uid } = await params;
  const uidNumber = parseInt(uid, 10);
  const pathname = `/user/${uid}`;

  if (isNaN(uidNumber)) {
    return generateSEOMetadata(
      {
        title: "用户不存在",
        robots: {
          index: false,
          follow: false,
        },
      },
      {
        pathname,
      },
    );
  }

  // 获取用户基本信息
  const profileResult = await getUserPublicProfile(uidNumber);

  if (!profileResult.success || !profileResult.data) {
    return generateSEOMetadata(
      {
        title: "用户不存在",
        robots: {
          index: false,
          follow: false,
        },
      },
      {
        pathname,
      },
    );
  }

  const { user } = profileResult.data;
  const displayName = user.nickname || user.username;

  return generateSEOMetadata(
    {
      title: `${displayName} 的个人主页`,
      description:
        user.bio || `查看 ${displayName} 的个人资料、文章、评论和活动记录`,
      robots: {
        index: false, // 不索引用户档案页
        follow: false,
      },
    },
    {
      pathname,
    },
  );
}

export default async function UserProfilePage({
  params,
}: UserProfilePageProps) {
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
    <div className="px-6">
      <UserProfileClient
        profile={profileResult.data}
        initialActivities={[]}
        hasMore={true}
        isGuest={isGuest}
      />
      <ViewCountBatchLoader />
    </div>
  );
}
