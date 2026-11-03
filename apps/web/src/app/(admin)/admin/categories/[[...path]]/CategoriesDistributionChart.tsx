"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CategoryDistributionItem } from "@repo/shared-types/api/category";

import DimensionStatsChart, {
  type DimensionStatsItem,
} from "@/components/client/charts/DimensionStatsChart";
import { GridItem } from "@/components/client/layout/RowGrid";
import { useMainColor } from "@/components/client/layout/ThemeProvider";
import ErrorPage from "@/components/ui/Error";
import { useBroadcast } from "@/hooks/use-broadcast";
import { getCategoriesDistribution } from "@/lib/client/api/category";
import generateComplementary from "@/lib/shared/complementary";
import generateGradient from "@/lib/shared/gradient";
import { AutoTransition } from "@/ui/AutoTransition";
import { LoadingIndicator } from "@/ui/LoadingIndicator";

type Props = {
  parentId: number | null;
};

export default function CategoriesDistributionChart({ parentId }: Props) {
  const mainColor = useMainColor().primary;
  const [data, setData] = useState<CategoryDistributionItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await getCategoriesDistribution({
        parentId: parentId,
        limit: 10,
      });
      if (!res.success) {
        setError(new Error(res.message || "获取分类分布数据失败"));
        return;
      }
      if (res.data) {
        setData(res.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error("获取分类分布数据失败"));
    } finally {
      setIsLoading(false);
    }
  }, [parentId]);

  // 监听广播刷新消息
  useBroadcast<{ type: string }>(async (message) => {
    if (message.type === "categories-refresh") {
      setRefreshTrigger((prev) => prev + 1); // 触发刷新
    }
  });

  useEffect(() => {
    fetchData();
  }, [refreshTrigger, fetchData]);

  // 转换数据格式为 DimensionStatsChart 需要的格式
  const chartItems: DimensionStatsItem[] = useMemo(
    () =>
      data.map((item) => ({
        name: item.name,
        count: item.totalPostCount,
        percentage: item.percentage,
      })),
    [data],
  );

  // 生成颜色
  const colors = useMemo(
    () =>
      generateGradient(
        mainColor,
        generateComplementary(mainColor),
        Math.max(data.length, 2),
      ),
    [mainColor, data.length],
  );

  return (
    <GridItem
      areas={[9, 10, 11, 12]}
      width={3}
      height={0.8}
      className="py-10"
      fixedHeight
    >
      <AutoTransition type="slideUp" className="h-full">
        {isLoading ? (
          <LoadingIndicator key="loading" />
        ) : error ? (
          <div key="error" className="px-10 h-full">
            <ErrorPage reason={error} reset={() => fetchData()} />
          </div>
        ) : (
          <div key="content" className="flex flex-col h-full px-10">
            <DimensionStatsChart
              title={parentId !== null ? "子分类文章分布" : "分类文章分布"}
              items={chartItems}
              colors={colors}
            />
          </div>
        )}
      </AutoTransition>
    </GridItem>
  );
}
