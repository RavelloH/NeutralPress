"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { headers } from "next/headers";

import { authVerify } from "@/lib/server/auth-verify";
import {
  collectBootstrapTags,
  getCriticalRevalidatePathTargets,
} from "@/lib/server/cache-bootstrap-targets";
import limitControl from "@/lib/server/rate-limit";

export type BootstrapCacheRefreshResult = {
  refreshedTagCount: number;
  revalidatedPathCount: number;
};

export async function refreshBootstrapCaches(): Promise<BootstrapCacheRefreshResult> {
  // 认证：仅 ADMIN 可调用
  if (!(await limitControl(await headers(), "refreshBootstrapCaches"))) {
    throw new Error("请求过于频繁，请稍后再试");
  }
  const user = await authVerify({ allowedRoles: ["ADMIN"] });
  if (!user) {
    throw new Error("未授权：仅管理员可刷新缓存");
  }

  const tags = await collectBootstrapTags();
  for (const tag of tags) {
    revalidateTag(tag, { expire: 0 });
  }

  const pathTargets = getCriticalRevalidatePathTargets();
  for (const target of pathTargets) {
    revalidatePath(target.path, target.type);
  }

  return {
    refreshedTagCount: tags.length,
    revalidatedPathCount: pathTargets.length,
  };
}
