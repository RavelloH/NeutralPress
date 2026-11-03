"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { RiRefreshLine } from "@remixicon/react";

import { GridItem } from "@/components/client/layout/RowGrid";
import ErrorPage from "@/components/ui/Error";
import { useBroadcastSender } from "@/hooks/use-broadcast";
import { getCommentStats } from "@/lib/client/api/comment-read";
import { AutoTransition } from "@/ui/AutoTransition";
import Clickable from "@/ui/Clickable";
import { LoadingIndicator } from "@/ui/LoadingIndicator";

interface ReportData {
  updatedAt: string;
  cache: boolean;
  total: number;
  approved: number;
  pending: number;
  rejected: number;
  spam: number;
  lastCommentAt: string | null;
  new?: {
    lastDay: number;
    last7Days: number;
    last30Days: number;
  };
}

const getDaysSince = (dateString: string | null): number | null => {
  if (!dateString) return null;
  const date = new Date(dateString);
  const now = new Date();
  const diffTime = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
};

const getNewCommentsDescription = (
  lastDay: number,
  last7Days: number,
  last30Days: number,
) => {
  // 如果都是0
  if (lastDay === 0 && last7Days === 0 && last30Days === 0) {
    return "近30天没有新增评论";
  }

  // 构建描述
  const parts: string[] = [];

  if (lastDay > 0) {
    parts.push(`最近24小时新增了 ${lastDay} 条`);
  }

  if (last7Days > lastDay) {
    parts.push(`最近一周共新增 ${last7Days} 条`);
  } else if (last7Days > 0 && lastDay === 0) {
    parts.push(`最近一周新增了 ${last7Days} 条`);
  }

  if (last30Days > last7Days) {
    parts.push(`近30天累计新增 ${last30Days} 条`);
  } else if (last30Days > 0 && last7Days === 0) {
    parts.push(`近30天新增了 ${last30Days} 条`);
  }

  return parts.join("，");
};

export default function CommentsReport() {
  const [result, setResult] = useState<ReportData | null>(null);
  const [refreshTime, setRefreshTime] = useState<Date | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const { broadcast } = useBroadcastSender<{ type: "comments-refresh" }>();

  const fetchData = useCallback(
    async (forceRefresh: boolean = false) => {
      if (forceRefresh) {
        setResult(null);
      }
      setError(null);
      const res = await getCommentStats({ force: forceRefresh });
      if (!res.success) {
        setError(new Error(res.message || "获取评论统计失败"));
        return;
      }
      if (!res.data) return;
      setResult(res.data);
      setRefreshTime(new Date(res.data.updatedAt));

      // 刷新成功后广播消息,通知其他组件更新
      if (forceRefresh) {
        await broadcast({ type: "comments-refresh" });
      }
    },
    [broadcast],
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <GridItem areas={[1, 2, 3, 4]} width={3} height={0.8}>
      <AutoTransition type="scale" className="h-full">
        {result ? (
          <div
            className="flex flex-col justify-between p-10 h-full"
            key="content"
          >
            <div>
              <div className="text-2xl py-2">评论统计</div>
              <div>
                当前共有 {result.total} 条评论
                {result.total > 0 && (
                  <>
                    ，其中{" "}
                    {[
                      result.approved > 0 && (
                        <span key="approved">{result.approved} 条已通过</span>
                      ),
                      result.rejected > 0 && (
                        <span key="rejected">{result.rejected} 条已拒绝</span>
                      ),
                      result.spam > 0 && (
                        <span key="spam">{result.spam} 条垃圾评论</span>
                      ),
                    ]
                      .filter(Boolean)
                      .map((item, idx) => (
                        <Fragment key={(item as React.ReactElement).key || idx}>
                          {idx > 0 && "、"}
                          {item}
                        </Fragment>
                      ))}
                  </>
                )}
                。
              </div>
            </div>
            <div>
              {result.pending > 0 && (
                <div className="text-warning">
                  {result.pending} 条评论待审核。
                </div>
              )}
              {result.new && (
                <div>
                  {getNewCommentsDescription(
                    result.new.lastDay ?? 0,
                    result.new.last7Days ?? 0,
                    result.new.last30Days ?? 0,
                  )}
                  。
                </div>
              )}
              {result.lastCommentAt && (
                <div>
                  最新评论于 {new Date(result.lastCommentAt).toLocaleString()}
                  {(() => {
                    const days = getDaysSince(result.lastCommentAt);
                    if (days === null) return null;
                    if (days === 0) return "（今天）";
                    if (days === 1) return "（昨天）";
                    return `（${days} 天前）`;
                  })()}
                  。
                </div>
              )}
              {!result.lastCommentAt && result.total === 0 && (
                <div className="text-muted-foreground">暂无评论数据。</div>
              )}
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
  );
}
