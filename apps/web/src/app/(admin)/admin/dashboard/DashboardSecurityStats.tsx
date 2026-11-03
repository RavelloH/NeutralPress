"use client";

import { useEffect, useState } from "react";
import { RiRefreshLine } from "@remixicon/react";
import type { SecurityOverviewData } from "@repo/shared-types/api/security";

import ErrorPage from "@/components/ui/Error";
import Link from "@/components/ui/Link";
import { getSecurityOverview } from "@/lib/client/api/security-read";
import { AutoTransition } from "@/ui/AutoTransition";
import Clickable from "@/ui/Clickable";
import { LoadingIndicator } from "@/ui/LoadingIndicator";

// 格式化数字
const formatNumber = (num: number | undefined): string => {
  if (num === undefined || num === 0) return "0";
  return num.toLocaleString();
};

// 计算错误率
const calcErrorRate = (
  success: number | undefined,
  error: number | undefined,
): string => {
  const s = success || 0;
  const e = error || 0;
  const total = s + e;
  if (total === 0) return "0%";
  return ((e / total) * 100).toFixed(2) + "%";
};

export default function DashboardSecurityStats() {
  const [result, setResult] = useState<SecurityOverviewData | null>(null);
  const [refreshTime, setRefreshTime] = useState<Date | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = async (forceRefresh: boolean = false) => {
    if (forceRefresh) {
      setResult(null);
    }
    setError(null);
    try {
      const res = await getSecurityOverview({ force: forceRefresh });
      if (!res.success) {
        setError(new Error(res.message || "获取安全概览失败"));
        return;
      }
      if (!res.data) return;
      setResult(res.data);
      setRefreshTime(new Date(res.data.updatedAt));
    } catch (error) {
      setError(error instanceof Error ? error : new Error("获取安全概览失败"));
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // 计算状态描述
  const getStatusDescription = () => {
    if (!result) return "";
    const issues = [];
    if (result.bannedIPs > 0) {
      issues.push(`${result.bannedIPs} 个IP被封禁`);
    }
    if (result.rateLimitedIPs > 0) {
      issues.push(`${result.rateLimitedIPs} 个IP接近限流`);
    }
    if (issues.length === 0) {
      return "系统运行正常。";
    }
    return issues.join("，") + "。";
  };

  // 生成统计描述
  const getStatsDescription = () => {
    if (!result) return null;

    const totalSuccess = result.totalSuccess || 0;
    const totalError = result.totalError || 0;
    const totalRequests = totalSuccess + totalError;

    const last24hSuccess = result.last24hSuccess || 0;
    const last24hError = result.last24hError || 0;
    const last24hTotal = last24hSuccess + last24hError;
    const last24hActiveHours = result.last24hActiveHours || 0;

    const last30dSuccess = result.last30dSuccess || 0;
    const last30dError = result.last30dError || 0;
    const last30dTotal = last30dSuccess + last30dError;
    const last30dActiveDays = result.last30dActiveDays || 0;

    // 计算平均值时使用实际有数据的时间段
    const avgPerHour =
      last24hActiveHours > 0
        ? Math.round(last24hTotal / last24hActiveHours)
        : 0;
    const avgPerDay =
      last30dActiveDays > 0 ? Math.round(last30dTotal / last30dActiveDays) : 0;

    return (
      <div className="leading-relaxed">
        <p>
          共处理 {formatNumber(totalRequests)} 个请求，
          {formatNumber(totalError)} 个超过速率限制，错误率{" "}
          {calcErrorRate(totalSuccess, totalError)}。
        </p>
        <p>
          最近 24 小时处理 {formatNumber(last24hTotal)} 个请求，平均每小时{" "}
          {formatNumber(avgPerHour)} 个。
        </p>
        <p>
          最近 30 天处理 {formatNumber(last30dTotal)} 个请求，平均每天{" "}
          {formatNumber(avgPerDay)} 个。
        </p>
      </div>
    );
  };

  return (
    <AutoTransition type="scale" className="h-full">
      {result ? (
        <div
          className="flex flex-col justify-between p-10 h-full"
          key="content"
        >
          <div>
            <div className="text-2xl py-2">
              <Link href="/admin/security" presets={["hover-underline"]}>
                安全中心
              </Link>
            </div>
            <div>{getStatusDescription()}</div>
            {getStatsDescription()}
          </div>
          <div>
            {refreshTime && (
              <div className="inline-flex items-center gap-2">
                {result.cache ? "统计缓存于" : "数据刷新于"}:{" "}
                {refreshTime.toLocaleString()}
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
