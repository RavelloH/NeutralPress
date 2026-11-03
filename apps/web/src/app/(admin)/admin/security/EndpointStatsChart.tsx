"use client";

import { useCallback, useEffect, useState } from "react";
import type { EndpointStat } from "@repo/shared-types/api/security";

import { GridItem } from "@/components/client/layout/RowGrid";
import { useMainColor } from "@/components/client/layout/ThemeProvider";
import ErrorPage from "@/components/ui/Error";
import { useBroadcast } from "@/hooks/use-broadcast";
import { getEndpointStats } from "@/lib/client/api/security-read";
import generateComplementary from "@/lib/shared/complementary";
import generateGradient from "@/lib/shared/gradient";
import { AutoTransition } from "@/ui/AutoTransition";
import { LoadingIndicator } from "@/ui/LoadingIndicator";

export default function EndpointStatsChart() {
  const mainColor = useMainColor().primary;
  const [endpoints, setEndpoints] = useState<EndpointStat[]>([]);
  const [totalRequests, setTotalRequests] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await getEndpointStats({ hours: 24 });
      if (!res.success) {
        setError(new Error(res.message || "获取端点统计失败"));
        return;
      }
      if (res.data) {
        setEndpoints(res.data.endpoints);
        setTotalRequests(res.data.totalRequests);
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error("获取端点统计失败"));
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 监听广播刷新消息
  useBroadcast<{ type: string }>(async (message) => {
    if (message.type === "security-refresh") {
      setRefreshTrigger((prev) => prev + 1);
    }
  });

  useEffect(() => {
    fetchData();
  }, [refreshTrigger, fetchData]);

  // 生成循环滚动渐变色（1 2 3 2 1 2 3 ...）
  const colors = (() => {
    const gradient = generateGradient(
      mainColor,
      generateComplementary(mainColor),
      Math.max(Math.ceil(endpoints.length / 2), 5),
    );
    // 构建循环滚动色：正向 + 反向（去掉首尾避免重复）+ 正向 ...
    const forward = [...gradient];
    const backward = gradient.slice(1, -1).reverse();
    const cycle = [...forward, ...backward];
    return cycle;
  })();

  const getBarColor = (index: number) => {
    return colors[index % colors.length] || mainColor;
  };

  return (
    <GridItem
      areas={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]}
      width={1}
      height={0.8}
    >
      <AutoTransition type="slideUp" className="h-full">
        {isLoading ? (
          <LoadingIndicator key="loading" />
        ) : error ? (
          <div key="error" className="px-10 h-full">
            <ErrorPage reason={error} reset={() => fetchData()} />
          </div>
        ) : (
          <div className="flex flex-col h-full p-10" key="content">
            <div className="text-2xl mb-4">
              API端点请求统计（24小时）
              <span className="text-base text-muted-foreground ml-4">
                总计 {totalRequests} 次请求
              </span>
            </div>

            {endpoints.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                暂无端点统计数据
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto pr-2">
                <div className="space-y-3">
                  {endpoints.map((endpoint, index) => (
                    <div
                      key={endpoint.endpoint}
                      className="flex items-center gap-4"
                    >
                      <div
                        className="w-48 truncate text-sm"
                        title={endpoint.endpoint}
                      >
                        {endpoint.endpoint}
                      </div>
                      <div className="flex-1 h-6 bg-muted/50 rounded-sm overflow-hidden">
                        <div
                          className="h-full rounded-sm transition-all duration-300"
                          style={{
                            width: `${Math.max(endpoint.percentage, 1)}%`,
                            backgroundColor: getBarColor(index),
                          }}
                        />
                      </div>
                      <div className="w-20 text-right text-sm">
                        {endpoint.count}
                      </div>
                      <div className="w-16 text-right text-sm text-muted-foreground">
                        {endpoint.percentage.toFixed(1)}%
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </AutoTransition>
    </GridItem>
  );
}
