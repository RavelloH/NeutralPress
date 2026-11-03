"use client";

import { useEffect, useState } from "react";
import {
  RiFolderAddFill,
  RiRefreshLine,
  RiStickyNoteAddFill,
  RiUpload2Fill,
} from "@remixicon/react";
import type { GetPostsStatsSuccessResponse } from "@repo/shared-types/api/stats";

import ErrorPage from "@/components/ui/Error";
import Link from "@/components/ui/Link";
import { useMobile } from "@/hooks/use-mobile";
import { getPostsStats } from "@/lib/client/api/stats";
import { AutoTransition } from "@/ui/AutoTransition";
import Clickable from "@/ui/Clickable";
import { LoadingIndicator } from "@/ui/LoadingIndicator";

type stats = GetPostsStatsSuccessResponse["data"] | null;

const getDaysSince = (dateString: string | null): number | null => {
  if (!dateString) return null;
  const date = new Date(dateString);
  const now = new Date();

  // 将两个日期都设置为当天的0点,然后计算天数差
  const dateOnly = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const nowOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const diffTime = nowOnly.getTime() - dateOnly.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
};

export default function DashboardPostsStats() {
  const [result, setResult] = useState<stats>(null);
  const [isCache, setIsCache] = useState(true);
  const [refreshTime, setRefreshTime] = useState<Date | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const isMobile = useMobile();

  const fetchData = async (forceRefresh: boolean = false) => {
    if (forceRefresh) {
      setResult(null);
    }
    setError(null);
    const res = await getPostsStats({ force: forceRefresh });
    if (!res.success) {
      setError(new Error(res.message || "获取文章统计数据失败"));
      return;
    }
    setResult(res.data);
    setIsCache(res.data.cache);
    setRefreshTime(new Date(res.data.updatedAt));
  };

  useEffect(() => {
    fetchData();
  }, []);

  const getSummary = (result: stats) => {
    if (!result) return null;
    const { published, draft, archived, total } = result.total;

    if (total === 0) {
      return <>暂无文章。</>;
    }

    const parts = [
      published > 0 && `${published} 篇已发布`,
      draft > 0 && `${draft} 篇草稿`,
      archived > 0 && `${archived} 篇已归档`,
    ].filter(Boolean);

    return (
      <>
        共 {total} 篇文章{parts.length > 0 ? `，其中 ${parts.join("、")}` : ""}
        。
      </>
    );
  };

  const getNewPostsDescription = (result: stats) => {
    if (!result) return null;
    const { last7Days, last30Days, lastYear } = result.new;

    // 如果都是0
    if (last7Days === 0 && last30Days === 0 && lastYear === 0) {
      return "近一年没有新增文章。";
    }

    // 构建描述
    const parts: string[] = [];

    if (last7Days > 0) {
      parts.push(`最近一周新增了 ${last7Days} 篇`);
    }

    if (last30Days > last7Days) {
      parts.push(`近30天共新增 ${last30Days} 篇`);
    } else if (last30Days > 0 && last7Days === 0) {
      parts.push(`近30天新增了 ${last30Days} 篇`);
    }

    if (lastYear > last30Days) {
      parts.push(`近一年累计新增 ${lastYear} 篇`);
    } else if (lastYear > 0 && last30Days === 0) {
      parts.push(`近一年新增了 ${lastYear} 篇`);
    }

    return parts.join("，") + "。";
  };

  return (
    <div className="h-full flex">
      <div className="flex-1 p-10">
        <AutoTransition className="h-full" type="scale">
          {result ? (
            <div key="content" className="flex flex-col justify-between h-full">
              <div>
                <div className="text-2xl py-2">
                  <Link href="/admin/posts" presets={["hover-underline"]}>
                    文章管理
                  </Link>
                </div>
                <div>{getSummary(result)}</div>
              </div>
              <div className="space-y-1">
                <div>{getNewPostsDescription(result)}</div>
                {result.lastPublished && (
                  <div>
                    最后发布于 {new Date(result.lastPublished).toLocaleString()}
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
              </div>
              <div className="flex justify-between items-center">
                {refreshTime && (
                  <div className="inline-flex items-center gap-2">
                    {isCache ? "统计缓存于" : "统计刷新于"}:{" "}
                    {new Date(refreshTime).toLocaleString()}
                    <Clickable onClick={() => fetchData(true)}>
                      <RiRefreshLine size={"1em"} />
                    </Clickable>
                  </div>
                )}
              </div>
            </div>
          ) : error ? (
            <ErrorPage reason={error} reset={() => fetchData(true)} />
          ) : (
            <LoadingIndicator key="loading" size="md" />
          )}
        </AutoTransition>
      </div>
      {!isMobile && (
        <div className="h-full aspect-square flex flex-col border-border border-l text-2xl">
          <AutoTransition className="h-full flex flex-col" type="scale">
            {result ? (
              <>
                <Link
                  href="/admin/posts/new"
                  className="flex-1 flex gap-2 items-center justify-center border-border border-b hover:bg-primary hover:text-primary-foreground transition-all"
                >
                  <RiStickyNoteAddFill size="1.1em" /> 新建文章
                </Link>
                <Link
                  href="/admin/projects?action=new"
                  className="flex-1 flex gap-2 items-center justify-center border-border border-b hover:bg-primary hover:text-primary-foreground transition-all"
                >
                  <RiFolderAddFill size="1.1em" /> 新建项目
                </Link>
                <Link
                  href="/admin/media?action=upload"
                  className="flex-1 flex gap-2 items-center justify-center hover:bg-primary hover:text-primary-foreground transition-all"
                >
                  <RiUpload2Fill size="1.1em" /> 上传媒体
                </Link>
              </>
            ) : error ? (
              <div
                key="error"
                className="flex items-center justify-center h-full"
              />
            ) : (
              <div
                key="loading"
                className="flex items-center justify-center h-full"
              >
                <LoadingIndicator size="md" />
              </div>
            )}
          </AutoTransition>
        </div>
      )}
    </div>
  );
}
