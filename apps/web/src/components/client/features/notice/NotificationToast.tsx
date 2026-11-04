"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RiCloseLine, RiNotification3Line } from "@remixicon/react";
import { AnimatePresence, motion } from "framer-motion";

import { useNavigateWithTransition } from "@/components/ui/Link";
import { markNoticesAsRead } from "@/lib/client/api/notice-write";
import { useFooterStore } from "@/store/footer-store";
import { AutoResizer } from "@/ui/AutoResizer";
import { AutoTransition } from "@/ui/AutoTransition";
import Clickable from "@/ui/Clickable";

/**
 * 通知项数据接口
 */
export interface NotificationItem {
  id: string;
  title: string;
  content: string;
  link: string | null;
  createdAt: string;
}

interface NotificationToastProps {
  notifications: NotificationItem[];
  onRemove: (id: string) => void;
}

/**
 * 单个通知卡片组件（导出供统一容器使用）
 */
export interface NotificationCardProps {
  notification: NotificationItem;
  onRemove: (id: string) => void;
}

export function NotificationCard({
  notification,
  onRemove,
}: NotificationCardProps) {
  const [progress, setProgress] = useState(100);
  const [isPaused, setIsPaused] = useState(false);
  const [isCardHovered, setIsCardHovered] = useState(false);
  const createTimeRef = useRef<number>(Date.now());
  const pauseTimeRef = useRef<number>(0);
  const totalPausedTimeRef = useRef<number>(0);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const navigate = useNavigateWithTransition();

  const DURATION = 60000;

  // 处理点击：标记为已读 + 跳转
  const handleClick = async () => {
    try {
      // 先标记为已读
      await markNoticesAsRead([notification.id]);

      // 再跳转（如果有链接）
      if (notification.link) {
        navigate(notification.link);
      }
    } catch (error) {
      console.error("标记通知为已读失败:", error);
    } finally {
      // 移除通知
      onRemove(notification.id);
    }
  };

  // 进度条动画
  useEffect(() => {
    const updateProgress = () => {
      if (isPaused) {
        // 暂停时不更新
        animationFrameRef.current = requestAnimationFrame(updateProgress);
        return;
      }

      const now = Date.now();
      const elapsed = now - createTimeRef.current - totalPausedTimeRef.current;
      const remaining = Math.max(0, DURATION - elapsed);
      const newProgress = (remaining / DURATION) * 100;

      setProgress(newProgress);

      if (remaining <= 0) {
        onRemove(notification.id);
      } else {
        animationFrameRef.current = requestAnimationFrame(updateProgress);
      }
    };

    animationFrameRef.current = requestAnimationFrame(updateProgress);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPaused, notification.id, onRemove]);

  // Hover 时暂停进度
  const handleMouseEnter = () => {
    pauseTimeRef.current = Date.now();
    setIsPaused(true);
    setIsCardHovered(true);
  };

  const handleMouseLeave = () => {
    // 累加暂停时长
    const pausedDuration = Date.now() - pauseTimeRef.current;
    totalPausedTimeRef.current += pausedDuration;
    setIsPaused(false);
    setIsCardHovered(false);
  };

  const formattedContent = notification.content;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{
        opacity: 1,
        y: 0,
        scale: 1,
      }}
      exit={{
        opacity: 0,
        y: 20,
        scale: 0.95,
      }}
      transition={{
        type: "spring",
        damping: 25,
        stiffness: 400,
        mass: 0.8,
      }}
      className="pointer-events-auto group relative flex w-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-lg hover:shadow-xl cursor-pointer"
      style={{
        minWidth: "20em",
        maxWidth: "25em",
      }}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* 进度背景层 */}
      <motion.div
        className="absolute inset-0 bg-primary/10 pointer-events-none"
        initial={{ width: "100%" }}
        animate={{ width: `${progress}%` }}
        transition={{ duration: 0.1, ease: "linear" }}
        style={{ transformOrigin: "left" }}
      />

      {/* 内容区域 */}
      <div className="relative flex items-center gap-3 p-4">
        {/* 图标 */}
        <div className="flex-shrink-0 flex h-5 w-5 items-center justify-center rounded-full text-primary mt-0.5">
          <RiNotification3Line size="1.25em" />
        </div>

        {/* 标题和正文 */}
        <div className="flex-1 min-w-0">
          {/* 标题 - 始终显示 */}
          <div className="text-sm font-medium text-foreground">
            {notification.title}
          </div>

          {/* 正文 - hover 时显示 */}
          <AutoResizer duration={0.25}>
            <AutoTransition type="fade" duration={0.2} initial={false}>
              {isCardHovered && (
                <div className="text-sm text-muted-foreground leading-snug mt-1 whitespace-pre-line break-words">
                  {formattedContent}
                </div>
              )}
            </AutoTransition>
          </AutoResizer>
        </div>

        {/* 关闭按钮 */}
        <Clickable
          onClick={(e) => {
            e.stopPropagation();
            onRemove(notification.id);
          }}
          className="flex-shrink-0 rounded-md p-1 text-foreground/50 opacity-0 transition-opacity hover:text-foreground focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-ring group-hover:opacity-100"
          aria-label="关闭通知"
        >
          <RiCloseLine size="1em" />
        </Clickable>
      </div>
    </motion.div>
  );
}

/**
 * 通知容器组件
 */
export default function NotificationToast({
  notifications,
  onRemove,
}: NotificationToastProps) {
  const [mounted, setMounted] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const isFooterVisible = useFooterStore((state) => state.isFooterVisible);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  // 当有通知时立即显示，当没有通知时延迟隐藏（等待动画完成）
  useEffect(() => {
    if (notifications.length > 0) {
      setShouldRender(true);
    } else {
      // 延迟 500ms 隐藏容器，让退出动画有时间播放
      const timer = setTimeout(() => {
        setShouldRender(false);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [notifications.length]);

  if (!mounted || !shouldRender) {
    return null;
  }

  // Footer 高度为 5em (80px)
  const bottomOffset = isFooterVisible ? "calc(5em + 1rem)" : "1rem";

  const toastContent = (
    <div
      className="fixed left-4 z-[10] flex max-h-screen flex-col-reverse gap-2 pointer-events-none transition-all duration-300"
      style={{
        bottom: bottomOffset,
        width: "380px",
      }}
    >
      <AnimatePresence mode="sync">
        {notifications.map((notification) => (
          <NotificationCard
            key={notification.id}
            notification={notification}
            onRemove={onRemove}
          />
        ))}
      </AnimatePresence>
    </div>
  );

  return createPortal(toastContent, document.body);
}
