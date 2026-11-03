"use client";

import { useCallback, useEffect, useState } from "react";
import type { AnalyticsStatsData, GetAnalyticsStats } from "@repo/shared-types";

import AnalyticsOverview from "@/app/(admin)/admin/analytics/AnalyticsOverview";
import AnalyticsTrendChart from "@/app/(admin)/admin/analytics/AnalyticsTrendChart";
import DimensionStats from "@/app/(admin)/admin/analytics/DimensionStats";
import PageViewTable, {
  type AnalyticsFilterSummary,
  type AnalyticsQuickFilterField,
  type AnalyticsQuickFilterRequest,
  type AnalyticsTableQuery,
} from "@/app/(admin)/admin/analytics/PageViewTable";
import PathStatsChart from "@/app/(admin)/admin/analytics/PathStatsChart";
import type { TimeRangeValue } from "@/app/(admin)/admin/analytics/TimeRangeSelector";
import PathTrendChart from "@/app/(admin)/admin/analytics/VisitTrendChart";
import RowGrid from "@/components/client/layout/RowGrid";
import { useMainColor } from "@/components/client/layout/ThemeProvider";
import { getAnalyticsStats } from "@/lib/client/api/analytics-read";
import generateComplementary from "@/lib/shared/complementary";
import generateGradient from "@/lib/shared/gradient";

function isSameTableQuery(
  prev: AnalyticsTableQuery,
  next: AnalyticsTableQuery,
): boolean {
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const key of keys) {
    const typedKey = key as keyof AnalyticsTableQuery;
    if (prev[typedKey] !== next[typedKey]) {
      return false;
    }
  }
  return true;
}

export default function AnalyticsStats() {
  const [data, setData] = useState<AnalyticsStatsData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [tableQuery, setTableQuery] = useState<AnalyticsTableQuery>({});
  const [filterSummary, setFilterSummary] = useState<AnalyticsFilterSummary>({
    activeCount: 0,
    text: "筛选",
  });
  const [openFilterToken, setOpenFilterToken] = useState<number | undefined>(
    undefined,
  );
  const [quickFilterRequest, setQuickFilterRequest] =
    useState<AnalyticsQuickFilterRequest | null>(null);
  const themeColor = useMainColor(); // 从 ThemeProvider 获取主题颜色

  // 从 localStorage 读取上次选择的时间段
  const [timeRange, setTimeRange] = useState<TimeRangeValue>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("analytics_timeRange");
      if (saved) {
        try {
          return JSON.parse(saved) as TimeRangeValue;
        } catch {
          // 如果解析失败，使用默认值
        }
      }
    }
    return { type: "preset", days: 30 };
  });

  // 保存时间段选择到 localStorage
  const handleTimeRangeChange = (newTimeRange: TimeRangeValue) => {
    setTimeRange(newTimeRange);
    if (typeof window !== "undefined") {
      localStorage.setItem("analytics_timeRange", JSON.stringify(newTimeRange));
    }
  };

  const handleTableQueryChange = useCallback((query: AnalyticsTableQuery) => {
    setTableQuery((prev) => (isSameTableQuery(prev, query) ? prev : query));
  }, []);

  const handleFilterSummaryChange = useCallback(
    (summary: AnalyticsFilterSummary) => {
      setFilterSummary((prev) => {
        if (
          prev.activeCount === summary.activeCount &&
          prev.text === summary.text
        ) {
          return prev;
        }
        return summary;
      });
    },
    [],
  );

  const handleOpenFilterDialog = useCallback(() => {
    setOpenFilterToken((prev) => (prev ?? 0) + 1);
  }, []);

  const handleQuickFilter = useCallback(
    (field: AnalyticsQuickFilterField, value: string) => {
      const normalizedValue = value.trim();
      if (!normalizedValue) {
        return;
      }
      setQuickFilterRequest((prev) => ({
        token: (prev?.token ?? 0) + 1,
        field,
        value: normalizedValue,
      }));
    },
    [],
  );

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      let baseParams: {
        days?: number;
        hours?: number;
        startDate?: string;
        endDate?: string;
      };
      if (timeRange.type === "preset") {
        baseParams = { days: timeRange.days };
      } else if (timeRange.type === "hours") {
        baseParams = { hours: timeRange.hours };
      } else {
        baseParams = {
          startDate: timeRange.startDate,
          endDate: timeRange.endDate,
        };
      }

      const params: GetAnalyticsStats = {
        ...baseParams,
        ...tableQuery,
      };
      const res = await getAnalyticsStats(params);
      if (!res.success) {
        setIsLoading(false);
        return;
      }
      if (res.data) {
        setData(res.data);
      }
      setIsLoading(false);
    } catch {
      // 静默处理错误，各个子组件会显示loading状态
      setIsLoading(false);
    }
  }, [timeRange, tableQuery]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 为不同维度生成不同的颜色
  const generateColorForDimension = (index: number): string => {
    const primaryColor = themeColor.primary;
    const baseGradient = generateGradient(
      primaryColor,
      generateComplementary(primaryColor),
      9,
    );
    return baseGradient[index % baseGradient.length] || primaryColor;
  };

  return (
    <>
      <RowGrid>
        <AnalyticsOverview
          overview={data?.overview || null}
          timeRange={timeRange}
          onTimeRangeChange={handleTimeRangeChange}
          filterSummaryText={filterSummary.text}
          activeFilterCount={filterSummary.activeCount}
          onOpenFilterDialog={handleOpenFilterDialog}
        />
        <PathTrendChart
          dailyTrend={data?.dailyTrend || null}
          mainColor={themeColor.primary}
          isLoading={isLoading}
          timeRange={timeRange}
        />
        <AnalyticsTrendChart
          mainColor={themeColor.primary}
          filters={tableQuery}
        />
      </RowGrid>
      <RowGrid>
        <PathStatsChart
          paths={data?.topPaths || null}
          mainColor={themeColor.primary}
          onPathClick={(path) => handleQuickFilter("path", path)}
          activePath={tableQuery.path}
        />
      </RowGrid>
      <RowGrid>
        <DimensionStats
          position="up"
          title="流量来源"
          items={data?.referers || null}
          mainColor={generateColorForDimension(0)}
          enableQuickFilter
          quickFilterField="referer"
          activeFilterValue={tableQuery.referer}
          onQuickFilter={(field, value) =>
            handleQuickFilter(field as AnalyticsQuickFilterField, value)
          }
        />
        <DimensionStats
          position="middle"
          title="浏览器"
          items={data?.browsers || null}
          mainColor={generateColorForDimension(1)}
          enableQuickFilter
          quickFilterField="browser"
          activeFilterValue={tableQuery.browser}
          onQuickFilter={(field, value) =>
            handleQuickFilter(field as AnalyticsQuickFilterField, value)
          }
        />
        <DimensionStats
          position="down"
          title="操作系统"
          items={data?.os || null}
          mainColor={generateColorForDimension(2)}
          enableQuickFilter
          quickFilterField="os"
          activeFilterValue={tableQuery.os}
          onQuickFilter={(field, value) =>
            handleQuickFilter(field as AnalyticsQuickFilterField, value)
          }
        />
        <DimensionStats
          position="up"
          title="设备类型"
          items={data?.devices || null}
          mainColor={generateColorForDimension(3)}
          enableQuickFilter
          quickFilterField="deviceType"
          activeFilterValue={tableQuery.deviceType}
          onQuickFilter={(field, value) =>
            handleQuickFilter(field as AnalyticsQuickFilterField, value)
          }
        />
        <DimensionStats
          position="middle"
          title="屏幕尺寸"
          items={data?.screenSizes || null}
          mainColor={generateColorForDimension(4)}
          enableQuickFilter
          quickFilterField="screenSize"
          activeFilterValue={tableQuery.screenSize}
          onQuickFilter={(field, value) =>
            handleQuickFilter(field as AnalyticsQuickFilterField, value)
          }
        />
        <DimensionStats
          position="down"
          title="语言"
          items={data?.languages || null}
          mainColor={generateColorForDimension(5)}
          enableQuickFilter
          quickFilterField="language"
          activeFilterValue={tableQuery.language}
          onQuickFilter={(field, value) =>
            handleQuickFilter(field as AnalyticsQuickFilterField, value)
          }
        />
        <DimensionStats
          position="up"
          title="国家分布"
          items={data?.countries || null}
          mainColor={generateColorForDimension(6)}
          enableQuickFilter
          quickFilterField="country"
          activeFilterValue={tableQuery.country}
          onQuickFilter={(field, value) =>
            handleQuickFilter(field as AnalyticsQuickFilterField, value)
          }
        />
        <DimensionStats
          position="middle"
          title="地区分布"
          items={data?.regions || null}
          mainColor={generateColorForDimension(7)}
          enableQuickFilter
          quickFilterField="region"
          activeFilterValue={tableQuery.region}
          onQuickFilter={(field, value) =>
            handleQuickFilter(field as AnalyticsQuickFilterField, value)
          }
        />
        <DimensionStats
          position="down"
          title="城市分布"
          items={data?.cities || null}
          mainColor={generateColorForDimension(8)}
          enableQuickFilter
          quickFilterField="city"
          activeFilterValue={tableQuery.city}
          onQuickFilter={(field, value) =>
            handleQuickFilter(field as AnalyticsQuickFilterField, value)
          }
        />
      </RowGrid>
      <RowGrid>
        <PageViewTable
          onQueryChange={handleTableQueryChange}
          onFilterSummaryChange={handleFilterSummaryChange}
          requestOpenFilterToken={openFilterToken}
          quickFilterRequest={quickFilterRequest}
        />
      </RowGrid>
    </>
  );
}
