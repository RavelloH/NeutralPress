"use client";

import { useCallback, useEffect, useState } from "react";
import { RiRefreshLine } from "@remixicon/react";
import type { FriendLinksStats } from "@repo/shared-types/api/friendlink";

import ErrorPage from "@/components/ui/Error";
import Link from "@/components/ui/Link";
import { getFriendLinksStats } from "@/lib/client/api/friendlink-read";
import { AutoTransition } from "@/ui/AutoTransition";
import Clickable from "@/ui/Clickable";
import { LoadingIndicator } from "@/ui/LoadingIndicator";

function buildSummary(stats: FriendLinksStats): string[] {
  const lines: string[] = [];
  lines.push(`当前共 ${stats.total} 条友链记录。`);
  lines.push(
    `可展示链接 ${stats.published + stats.whitelist} 条（发布 ${stats.published}，白名单 ${stats.whitelist}），绑定申请人 ${stats.withOwner} 条。`,
  );
  lines.push(
    `异常链接 ${stats.problematic} 条（无法访问 ${stats.disconnect}，无回链 ${stats.noBacklink}）。已拒绝 ${stats.rejected} 条，已拉黑 ${stats.blocked} 条。`,
  );
  return lines;
}

export default function DashboardFriendsStats() {
  const [stats, setStats] = useState<FriendLinksStats | null>(null);
  const [refreshTime, setRefreshTime] = useState<Date | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const fetchStats = useCallback(async (forceRefresh: boolean = false) => {
    if (forceRefresh) {
      setStats(null);
    }

    setError(null);
    try {
      const result = await getFriendLinksStats({ force: forceRefresh });
      if (!result.success || !result.data) {
        setError(new Error(result.message || "获取统计失败"));
        return;
      }

      setStats(result.data);
      setRefreshTime(new Date(result.data.updatedAt));
    } catch (fetchError) {
      console.error("[DashboardFriendsStats] 获取统计失败:", fetchError);
      setError(new Error("获取统计失败"));
    }
  }, []);

  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  return (
    <AutoTransition type="scale" className="h-full">
      {stats ? (
        <div className="flex h-full flex-col justify-between p-10" key="stats">
          <div>
            <div className="py-2 text-2xl">
              <Link presets={["hover-underline"]} href="/admin/friends">
                友情链接统计
              </Link>
            </div>
            <div className="space-y-1">
              {buildSummary(stats).map((line) => (
                <div key={line}>{line}</div>
              ))}
              {stats.pending > 0 && (
                <div className="text-warning">
                  {stats.pending} 条友链待审核。
                </div>
              )}
            </div>
          </div>
          <div className="inline-flex items-center gap-2">
            {stats.cache ? "统计缓存于" : "数据刷新于"}:{" "}
            {new Date(refreshTime ?? stats.updatedAt).toLocaleString("zh-CN")}
            <Clickable onClick={() => void fetchStats(true)}>
              <RiRefreshLine size="1em" />
            </Clickable>
          </div>
        </div>
      ) : error ? (
        <div className="h-full px-10" key="error">
          <ErrorPage reason={error} reset={() => void fetchStats(true)} />
        </div>
      ) : (
        <div className="h-full" key="loading">
          <LoadingIndicator />
        </div>
      )}
    </AutoTransition>
  );
}
