"use client";

import { useEffect, useState } from "react";
import { RiRefreshLine } from "@remixicon/react";
import type { GetUsersStatsSuccessResponse } from "@repo/shared-types/api/stats";

import ErrorPage from "@/components/ui/Error";
import Link from "@/components/ui/Link";
import { getUsersStats } from "@/lib/client/api/stats";
import { AutoTransition } from "@/ui/AutoTransition";
import Clickable from "@/ui/Clickable";
import { LoadingIndicator } from "@/ui/LoadingIndicator";

type stats = GetUsersStatsSuccessResponse["data"] | null;

export default function DashboardUsersStats() {
  const [result, setResult] = useState<stats>(null);
  const [isCache, setIsCache] = useState(true);
  const [refreshTime, setRefreshTime] = useState<Date | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = async (forceRefresh: boolean = false) => {
    if (forceRefresh) {
      setResult(null);
    }
    setError(null);
    const res = await getUsersStats({ force: forceRefresh });
    if (!res.success) {
      setError(new Error(res.message || "获取用户统计数据失败"));
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
    const { admin, editor, author, user, total } = result.total;
    const roles = [
      admin && ` ${admin} 名管理员`,
      editor && ` ${editor} 名编辑`,
      author && ` ${author} 名作者`,
      user && ` ${user} 名访客`,
    ].filter(Boolean);

    return (
      <>
        共 {total} 名用户，其中{roles.join("、")}。
      </>
    );
  };

  return (
    <div className="p-10 h-full">
      <AutoTransition className="h-full" type="scale">
        {result ? (
          <div key="content" className="flex flex-col justify-between h-full">
            <div>
              <div className="text-2xl py-2">
                <Link href="/admin/users" presets={["hover-underline"]}>
                  用户管理
                </Link>
              </div>
              <div>{getSummary(result)}</div>
            </div>
            <div className="grid grid-cols-[auto_auto_auto_auto] gap-x-8 w-fit">
              <span className="text-right">活跃用户:</span>
              <span>今日: {result.active.lastDay}</span>
              <span>近7日: {result.active.last7Days}</span>
              <span>近30日: {result.active.last30Days}</span>

              <span className="text-right">新增用户:</span>
              <span>今日: {result.new.lastDay}</span>
              <span>近7日: {result.new.last7Days}</span>
              <span>近30日: {result.new.last30Days}</span>
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
  );
}
