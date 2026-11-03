"use client";

import { useCallback, useEffect, useState } from "react";
import { RiRefreshLine, RiStickyNoteAddFill } from "@remixicon/react";

import { GridItem } from "@/components/client/layout/RowGrid";
import ErrorPage from "@/components/ui/Error";
import Link from "@/components/ui/Link";
import { useBroadcastSender } from "@/hooks/use-broadcast";
import { getPostsStats } from "@/lib/client/api/stats";
import runWithAuth from "@/lib/client/run-with-auth";
import { AutoTransition } from "@/ui/AutoTransition";
import Clickable from "@/ui/Clickable";
import { LoadingIndicator } from "@/ui/LoadingIndicator";

type StatsData = {
  updatedAt: string;
  cache: boolean;
  total: {
    total: number;
    published: number;
    draft: number;
    archived: number;
  };
  new: {
    last7Days: number;
    last30Days: number;
    lastYear: number;
  };
  lastPublished: string | null;
  firstPublished: string | null;
  averageDaysBetweenPosts: number | null;
};

const getDaysSince = (dateString: string | null): number | null => {
  if (!dateString) return null;
  const date = new Date(dateString);
  const now = new Date();
  const diffTime = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
};

const getNewPostsDescription = (
  last7Days: number,
  last30Days: number,
  lastYear: number,
) => {
  // 如果都是0
  if (last7Days === 0 && last30Days === 0 && lastYear === 0) {
    return "近一年没有新增文章";
  }

  // 构建描述
  const parts: string[] = [];

  if (last7Days > 0) {
    parts.push(`最近一周新增了 ${last7Days} 篇`);
  }

  if (last30Days > last7Days) {
    parts.push(`本月共新增 ${last30Days} 篇`);
  } else if (last30Days > 0 && last7Days === 0) {
    parts.push(`本月新增了 ${last30Days} 篇`);
  }

  if (lastYear > last30Days) {
    parts.push(`今年累计新增 ${lastYear} 篇`);
  } else if (lastYear > 0 && last30Days === 0) {
    parts.push(`今年新增了 ${lastYear} 篇`);
  }

  return parts.join("，");
};

export default function PostsReport() {
  const [result, setResult] = useState<StatsData | null>(null);
  const [refreshTime, setRefreshTime] = useState<Date | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const { broadcast } = useBroadcastSender<{ type: "posts-refresh" }>();

  const fetchData = useCallback(
    async (forceRefresh: boolean = false) => {
      if (forceRefresh) {
        setResult(null);
      }
      setError(null);
      const res = await runWithAuth(getPostsStats, { force: forceRefresh });
      if (!res || !("data" in res) || !res.data) {
        setError(new Error("获取文章统计失败"));
        return;
      }
      const data = res.data;
      setResult(data);
      setRefreshTime(new Date(data.updatedAt));

      // 刷新成功后广播消息,通知其他组件更新
      if (forceRefresh) {
        await broadcast({ type: "posts-refresh" });
      }
    },
    [broadcast],
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <>
      <GridItem areas={[1, 2, 3, 4, 5, 6]} width={2} height={0.8}>
        <AutoTransition type="scale" className="h-full">
          {result ? (
            <div
              className="flex flex-col justify-between p-10 h-full"
              key="content"
            >
              <div>
                <div className="text-2xl py-2">文章统计</div>
                <div>
                  当前共有 {result.total.total} 篇文章
                  {result.total.total > 0 &&
                    (() => {
                      const parts = [
                        result.total.published > 0 &&
                          `${result.total.published} 篇已发布`,
                        result.total.draft > 0 &&
                          `${result.total.draft} 篇草稿`,
                        result.total.archived > 0 &&
                          `${result.total.archived} 篇已归档`,
                      ].filter(Boolean);
                      return parts.length > 0
                        ? `，其中 ${parts.join("、")}`
                        : "";
                    })()}
                  。
                </div>
              </div>
              <div>
                <div className="space-y-2">
                  <div>
                    {getNewPostsDescription(
                      result.new.last7Days,
                      result.new.last30Days,
                      result.new.lastYear,
                    )}
                    。
                  </div>

                  {result.total.published > 0 ? (
                    <>
                      {result.firstPublished && result.lastPublished && (
                        <div>
                          发布时间跨度：从{" "}
                          {new Date(result.firstPublished).toLocaleDateString()}{" "}
                          到{" "}
                          {new Date(result.lastPublished).toLocaleDateString()}
                          {(() => {
                            const firstDate = new Date(result.firstPublished);
                            const lastDate = new Date(result.lastPublished);
                            const diffTime =
                              lastDate.getTime() - firstDate.getTime();
                            const diffDays = Math.floor(
                              diffTime / (1000 * 60 * 60 * 24),
                            );
                            if (diffDays > 0) {
                              return ` (共 ${diffDays} 天)`;
                            }
                            return "";
                          })()}
                          。
                        </div>
                      )}

                      {result.averageDaysBetweenPosts !== null &&
                        result.total.published > 1 && (
                          <div>
                            平均发布频率：每{" "}
                            {result.averageDaysBetweenPosts < 1
                              ? `${(result.averageDaysBetweenPosts * 24).toFixed(1)} 小时`
                              : result.averageDaysBetweenPosts < 7
                                ? `${result.averageDaysBetweenPosts.toFixed(1)} 天`
                                : result.averageDaysBetweenPosts < 30
                                  ? `${(result.averageDaysBetweenPosts / 7).toFixed(1)} 周`
                                  : `${(result.averageDaysBetweenPosts / 30).toFixed(1)} 个月`}{" "}
                            发布一篇文章。
                          </div>
                        )}

                      {result.lastPublished && (
                        <div>
                          最后发布于{" "}
                          {new Date(result.lastPublished).toLocaleString()}
                          {(() => {
                            const days = getDaysSince(result.lastPublished);
                            if (days === null) return null;
                            if (days === 0) return "（今天）";
                            if (days === 1) return "（昨天）";
                            return `（${days} 天前）`;
                          })()}
                          。
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-muted-foreground">
                      {result.total.total > 0
                        ? "暂无已发布的文章，发布文章后将显示更多统计信息。"
                        : "暂无文章数据。"}
                    </div>
                  )}
                </div>
              </div>
              <div>
                {refreshTime && (
                  <div className="inline-flex items-center gap-2">
                    最近更新于: {new Date(refreshTime).toLocaleString()}
                    {result.cache && " (缓存)"}
                    <Clickable onClick={() => fetchData(true)}>
                      <RiRefreshLine size={"1em"} />
                    </Clickable>
                  </div>
                )}
              </div>
            </div>
          ) : error ? (
            <div className="px-10 h-full" key="error">
              <ErrorPage reason={error} reset={() => fetchData(true)} />
            </div>
          ) : (
            <div className="h-full">
              <LoadingIndicator key="loading" />
            </div>
          )}
        </AutoTransition>
      </GridItem>
      <GridItem areas={[7, 8]} width={6} height={0.2}>
        <AutoTransition type="scale" className="h-full">
          <Link
            href="/admin/posts/new"
            className="h-full flex gap-2 items-center justify-center text-2xl hover:bg-primary hover:text-primary-foreground transition-all"
          >
            <RiStickyNoteAddFill size="1.1em" /> 新建文章
          </Link>
        </AutoTransition>
      </GridItem>
    </>
  );
}
