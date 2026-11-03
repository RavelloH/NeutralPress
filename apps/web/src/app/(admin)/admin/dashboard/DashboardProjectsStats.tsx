"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { RiGithubFill, RiRefreshLine } from "@remixicon/react";

import ErrorPage from "@/components/ui/Error";
import Link from "@/components/ui/Link";
import { getProjectsStats } from "@/lib/client/api/stats";
import runWithAuth from "@/lib/client/run-with-auth";
import { AutoTransition } from "@/ui/AutoTransition";
import Clickable from "@/ui/Clickable";
import { LoadingIndicator } from "@/ui/LoadingIndicator";

interface StatsData {
  updatedAt: string;
  cache: boolean;
  total: {
    total: number;
    published: number;
    draft: number;
    archived: number;
    developing: number;
  };
  github: {
    syncEnabled: number;
    totalStars: number;
    totalForks: number;
  };
  new: {
    last7Days: number;
    last30Days: number;
    lastYear: number;
  };
}

const getNewProjectsDescription = (
  last7Days: number,
  last30Days: number,
  lastYear: number,
) => {
  if (last7Days === 0 && last30Days === 0 && lastYear === 0) {
    return "近一年没有新增项目";
  }

  const parts: string[] = [];

  if (last7Days > 0) {
    parts.push(`最近一周新增了 ${last7Days} 个`);
  }

  if (last30Days > last7Days) {
    parts.push(`本月共新增 ${last30Days} 个`);
  } else if (last30Days > 0 && last7Days === 0) {
    parts.push(`本月新增了 ${last30Days} 个`);
  }

  if (lastYear > last30Days) {
    parts.push(`今年累计新增 ${lastYear} 个`);
  } else if (lastYear > 0 && last30Days === 0) {
    parts.push(`今年新增了 ${lastYear} 个`);
  }

  return parts.join("，");
};

export default function DashboardProjectsStats() {
  const [result, setResult] = useState<StatsData | null>(null);
  const [refreshTime, setRefreshTime] = useState<Date | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async (forceRefresh: boolean = false) => {
    if (forceRefresh) {
      setResult(null);
    }
    setError(null);
    const res = await runWithAuth(getProjectsStats, { force: forceRefresh });
    if (!res || !("data" in res) || !res.data) {
      setError(new Error("获取项目统计失败"));
      return;
    }
    const data = res.data;
    setResult(data);
    setRefreshTime(new Date(data.updatedAt));
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <AutoTransition type="scale" className="h-full">
      {result ? (
        <div
          className="flex flex-col justify-between p-10 h-full"
          key="content"
        >
          <div>
            <div className="text-2xl py-2 flex items-center justify-between">
              <Link presets={["hover-underline"]} href={"/admin/projects"}>
                项目统计
              </Link>
            </div>
            <div>
              当前共有 {result.total.total} 个项目
              {result.total.total > 0 && (
                <>
                  ，其中{" "}
                  {[
                    result.total.published > 0 && (
                      <span key="published">
                        {result.total.published} 个已发布
                      </span>
                    ),
                    result.total.developing > 0 && (
                      <span key="developing">
                        {result.total.developing} 个开发中
                      </span>
                    ),
                    result.total.draft > 0 && (
                      <span key="draft">{result.total.draft} 个草稿</span>
                    ),
                    result.total.archived > 0 && (
                      <span key="archived">
                        {result.total.archived} 个已归档
                      </span>
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
            <div>
              {getNewProjectsDescription(
                result.new.last7Days,
                result.new.last30Days,
                result.new.lastYear,
              )}
              。
            </div>
            {result.github.syncEnabled > 0 && (
              <div className="flex items-center gap-1">
                <RiGithubFill size="1em" />
                {result.github.syncEnabled} 个项目已启用 GitHub 同步
                {result.github.totalStars > 0 && (
                  <span>，共 {result.github.totalStars} Stars</span>
                )}
                {result.github.totalForks > 0 && (
                  <span>、{result.github.totalForks} Forks</span>
                )}
                。
              </div>
            )}
            {result.total.total === 0 && (
              <div className="text-muted-foreground">暂无项目数据。</div>
            )}
          </div>
          <div>
            {refreshTime && (
              <div className="inline-flex items-center gap-2">
                {result.cache ? "统计缓存于" : "数据刷新于"}:{" "}
                {new Date(refreshTime).toLocaleString()}
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
  );
}
