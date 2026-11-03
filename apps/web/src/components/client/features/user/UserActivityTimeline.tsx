"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useInView } from "react-intersection-observer";
import { RiLockLine, RiTimeLine } from "@remixicon/react";
import type { UserActivityItem } from "@repo/shared-types/api/user";

import ActivityCard from "@/components/client/features/user/ActivityCard";
import { getUserActivity } from "@/lib/client/api/user-read";
import { AutoResizer } from "@/ui/AutoResizer";
import { AutoTransition } from "@/ui/AutoTransition";
import { LoadingIndicator } from "@/ui/LoadingIndicator";

interface UserActivityTimelineProps {
  uid: number;
  initialActivities: UserActivityItem[];
  hasMore: boolean;
  isGuest: boolean;
  onNavigate?: (path: string) => void; // 自定义导航函数
}

export default function UserActivityTimeline({
  uid,
  initialActivities,
  hasMore: initialHasMore,
  isGuest,
  onNavigate,
}: UserActivityTimelineProps) {
  const [activities, setActivities] = useState(initialActivities);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [isLoading, setIsLoading] = useState(false);
  const loadingRef = useRef(false);
  const offsetRef = useRef(initialActivities.length);
  const hasMoreRef = useRef(initialHasMore);
  const hasLoadedOnceRef = useRef(initialActivities.length > 0); // 记录是否已加载过数据

  // 懒加载触发器（每加载 20 条，在第 15 条时触发）
  const { ref: loadMoreRef, inView } = useInView({
    threshold: 0,
    skip: !hasMore || (isGuest && hasLoadedOnceRef.current), // 访客只能加载一次
  });

  // 同步 hasMore 到 ref
  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  // 加载更多活动
  const loadMoreActivities = useCallback(async () => {
    // 如果是访客且已经加载过数据，不允许再加载
    if (isGuest && hasLoadedOnceRef.current) return;
    if (loadingRef.current || !hasMoreRef.current) return;

    loadingRef.current = true;
    setIsLoading(true);

    try {
      const result = await getUserActivity(uid, offsetRef.current, 20, isGuest);

      if (result.success && result.data) {
        setActivities((prev) => {
          const newList = [...prev, ...result.data!.activities];
          offsetRef.current = newList.length;
          return newList;
        });

        const newHasMore = result.data.pagination.hasMore;
        setHasMore(newHasMore);
        hasMoreRef.current = newHasMore;
        hasLoadedOnceRef.current = true; // 标记已加载过数据
      }
    } catch (error) {
      console.error("加载更多活动失败:", error);
    } finally {
      setIsLoading(false);
      loadingRef.current = false;
    }
  }, [uid, isGuest]);

  // 初始加载：如果 initialActivities 为空且 hasMore 为 true，自动加载第一批数据
  useEffect(() => {
    if (initialActivities.length === 0 && initialHasMore) {
      loadMoreActivities();
    }
  }, [initialActivities.length, initialHasMore, loadMoreActivities]);

  // 当触发元素进入视口时加载更多
  useEffect(() => {
    if (inView && hasMoreRef.current && !loadingRef.current && !isLoading) {
      const timer = setTimeout(() => {
        if (hasMoreRef.current && !loadingRef.current) {
          loadMoreActivities();
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [inView, isLoading, loadMoreActivities]);

  // 计算哨兵位置（第 15 条）
  const shouldAttachRef = (index: number) => {
    return hasMore && index === offsetRef.current - 5;
  };

  return (
    <div className="flex flex-col">
      {/* 活动列表 */}
      <AutoResizer initial={false}>
        <AutoTransition type="fade" duration={0.3}>
          {activities.length === 0 ? (
            <div
              key="empty"
              className="flex flex-col items-center justify-center py-20"
            >
              {isLoading || hasMore ? (
                <LoadingIndicator size="lg" />
              ) : (
                <div className="text-muted-foreground">
                  <RiTimeLine size="3em" className="mb-4 mx-auto" />
                  <p className="text-sm">暂无活动记录</p>
                </div>
              )}
            </div>
          ) : (
            <div key="list">
              {activities.map((activity, index) => (
                <div
                  key={activity.id}
                  ref={shouldAttachRef(index) ? loadMoreRef : undefined}
                >
                  <ActivityCard activity={activity} onNavigate={onNavigate} />
                </div>
              ))}

              {/* 底部状态显示 */}
              {hasMore ? (
                isGuest ? (
                  // 访客提示
                  <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                    <RiLockLine size="2em" className="mb-2" />
                    <p className="text-sm">登录后查看更多活动</p>
                  </div>
                ) : (
                  // 加载指示器（有更多数据时始终显示）
                  <div className="flex items-center justify-center py-8">
                    <LoadingIndicator size="md" />
                  </div>
                )
              ) : (
                // 没有更多提示
                !isGuest && (
                  <div className="flex items-center justify-center py-8">
                    <p className="text-sm text-muted-foreground">
                      没有更多活动了
                    </p>
                  </div>
                )
              )}
            </div>
          )}
        </AutoTransition>
      </AutoResizer>
    </div>
  );
}
