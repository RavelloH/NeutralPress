"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Image from "next/image";
import { usePathname } from "next/navigation";

import { LoginButton as UserInfo } from "@/components/client/layout/user/UserInfo";
import { useConfig } from "@/context/ConfigContext";
import { useBroadcast } from "@/hooks/use-broadcast";
import { useMobile } from "@/hooks/use-mobile";
import { useConsoleStore } from "@/store/console-store";
import { useMenuStore } from "@/store/menu-store";
import { AutoTransition } from "@/ui/AutoTransition";

// Type
interface TransitionMessage {
  type: "page-transition";
  direction: "left" | "right" | "up" | "down" | "unknown";
  targetPath?: string;
}

interface TitleTransitionProps {
  children: React.ReactNode;
  direction: "left" | "right" | "up" | "down" | "unknown";
  isVisible: boolean;
}

// Components
// 加载指示器组件
function LoadingIndicator() {
  return (
    <div className="flex space-x-1">
      {Array.from({ length: 10 }, (_, i) => (
        <motion.span
          key={i}
          className="text-foreground"
          animate={{
            opacity: [0.5, 1, 0.5],
          }}
          transition={{
            duration: 0.8,
            repeat: Infinity,
            delay: i * 0.08,
            ease: "easeInOut",
          }}
        >
          /
        </motion.span>
      ))}
    </div>
  );
}

// 标题过渡组件
function TitleTransition({
  children,
  direction,
  isVisible,
}: TitleTransitionProps) {
  const getAnimationProps = () => {
    // 映射左右方向到上下方向
    const mappedDirection =
      direction === "left" ? "up" : direction === "right" ? "down" : direction;

    switch (mappedDirection) {
      case "up":
        // 向上方向：从下向上移动，退出时也向上消失
        return {
          initial: { y: 20, opacity: 0 },
          animate: { y: 0, opacity: 1 },
          exit: { y: -20, opacity: 0 },
        };
      case "down":
        // 向下方向：从上向下移动，退出时也向下消失
        return {
          initial: { y: -20, opacity: 0 },
          animate: { y: 0, opacity: 1 },
          exit: { y: 20, opacity: 0 },
        };
      case "unknown":
      default:
        return {
          initial: { opacity: 0 },
          animate: { opacity: 1 },
          exit: { opacity: 0 },
        };
    }
  };

  const { initial, animate, exit } = getAnimationProps();

  return (
    <AnimatePresence mode="wait">
      {isVisible && (
        <motion.div
          className="absolute inset-0 flex items-center justify-center"
          initial={initial}
          animate={animate}
          exit={exit}
          transition={{
            duration: 0.3,
            ease: "easeInOut",
          }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// 菜单按钮组件
function MenuButton({
  isOpen,
  onClick,
}: {
  isOpen: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="flex flex-col justify-center items-center w-full h-full relative group"
      aria-label="菜单"
      onClick={onClick}
    >
      <motion.div
        className="relative w-8 h-8 flex flex-col justify-center items-center"
        animate={{ rotate: isOpen ? 180 : 0 }}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        transition={{
          duration: 0.5,
          ease: "easeInOut",
          scale: { duration: 0.2 },
        }}
      >
        <svg
          width="2em"
          height="2em"
          viewBox="0 0 24 24"
          className="absolute transition-colors duration-200 group-hover:text-foreground group-hover:cursor-pointer"
          fill="none"
        >
          <motion.path
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            d="M4 6h16"
            style={{ transformOrigin: "4px 6px" }}
            animate={{
              rotate: isOpen ? 45 : 0,
              y: isOpen ? 6 : 0,
            }}
            transition={{
              duration: 0.5,
              ease: [0.4, 0, 0.2, 1],
              delay: isOpen ? 0.2 : 0.2,
            }}
          />
          <motion.path
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            d="M4 12h16"
            animate={{
              opacity: isOpen ? 0 : 1,
            }}
            transition={{
              duration: 0.3,
              ease: [0.4, 0, 0.2, 1],
              delay: isOpen ? 0 : 0.2,
            }}
          />
          <motion.path
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            d="M4 18h16"
            style={{ transformOrigin: "4px 18px" }}
            animate={{
              rotate: isOpen ? -45 : 0,
              y: isOpen ? -6 : 0,
            }}
            transition={{
              duration: 0.5,
              ease: [0.4, 0, 0.2, 1],
              delay: isOpen ? 0.2 : 0.2,
            }}
          />
        </svg>
      </motion.div>
    </button>
  );
}

// Main
export default function HeaderWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const configuredAvatar = useConfig("site.avatar");
  const avatarSrc = configuredAvatar?.trim() ? configuredAvatar : "/avatar.jpg";
  const { isMenuOpen, setMenuOpen, toggleMenu } = useMenuStore();
  const { setConsoleOpen } = useConsoleStore();
  const headerRef = useRef<HTMLElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const pathname = usePathname();
  const previousPathname = useRef<string>("");
  const [displayTitle, setDisplayTitle] = useState("NeutralPress");
  const [showTitle, setShowTitle] = useState(true);
  const [showLoading, setShowLoading] = useState(false);
  const [transitionDirection, setTransitionDirection] = useState<
    "left" | "right" | "up" | "down" | "unknown"
  >("unknown");
  const [transitionState, setTransitionState] = useState<
    "idle" | "exiting" | "entering"
  >("idle");
  const isMobile = useMobile();
  const headerHeight = isMobile ? "6em" : "5em";
  const headerOffsetY = isMobile ? 112 : 80;
  const shouldShowMobileUserInfo = isMobile && isMenuOpen;

  // 监听广播消息
  useBroadcast((message: TransitionMessage) => {
    if (message?.type === "page-transition") {
      const { direction } = message;
      setTransitionDirection(direction);
      startTransition();
    } else if (message?.type === "menu-close") {
      if (isMenuOpen) {
        setMenuOpen(false);
      }
    }
  });

  // 开始过渡动画
  const startTransition = () => {
    if (transitionState !== "idle") return;

    setTransitionState("exiting");
    setShowTitle(false);

    setTimeout(() => {
      setShowLoading(true);
    }, 200);
  };

  // 更新标题
  const updateTitle = useCallback(() => {
    if (typeof document === "undefined") return;

    const documentTitle = document.title || "";
    const cleanTitle = documentTitle.includes(" | ")
      ? documentTitle.split(" | ")[0] || "NeutralPress"
      : documentTitle || "NeutralPress";

    setDisplayTitle((previousTitle) =>
      previousTitle === cleanTitle ? previousTitle : cleanTitle,
    );
  }, []);

  // 监听 pathname 变化（页面加载完成）
  useEffect(() => {
    if (pathname === previousPathname.current) return;

    if (isMenuOpen) {
      setMenuOpen(false);
    }

    if (transitionState === "exiting" && showLoading) {
      // 页面已经加载完成，切换到新title
      updateTitle();
      setShowLoading(false);
      setTransitionState("entering");
      setShowTitle(true);

      setTimeout(() => {
        setTransitionState("idle");
      }, 100);
    } else if (transitionState === "idle") {
      // 没有过渡动画时，直接更新标题
      updateTitle();
    }

    previousPathname.current = pathname;
  }, [
    pathname,
    isMenuOpen,
    setMenuOpen,
    transitionState,
    showLoading,
    updateTitle,
  ]);

  // 监听 document.title 变化（包含 Next.js 替换 <title> 节点的情况）
  useEffect(() => {
    if (typeof document === "undefined") return;

    let rafId: number | null = null;
    const syncTitle = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }

      rafId = requestAnimationFrame(() => {
        updateTitle();
        rafId = null;
      });
    };

    const observer = new MutationObserver(syncTitle);

    // 监听 head，确保 title 节点被替换时也能捕获
    observer.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // 初始化同步一次，避免首屏拿到旧值
    syncTitle();

    return () => {
      observer.disconnect();
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [updateTitle]);

  // 监听加载完成事件
  useEffect(() => {
    const handleLoadingComplete = () => {
      setIsLoaded(true);
    };

    window.addEventListener("loadingComplete", handleLoadingComplete);

    return () => {
      window.removeEventListener("loadingComplete", handleLoadingComplete);
    };
  }, []);

  const renderHeaderAvatar = () => (
    <div
      key="site-avatar"
      className="flex items-center justify-center w-full h-full"
    >
      <Image
        src={avatarSrc}
        width={100}
        height={100}
        alt="Logo"
        className="h-full w-auto"
      />
    </div>
  );

  return (
    <>
      <motion.header
        ref={headerRef}
        className={`w-full text-foreground bg-background border-y border-border flex fixed top-0 left-0 z-50`}
        style={{ height: headerHeight }}
        initial={{ y: -headerOffsetY }}
        animate={{
          y: isMenuOpen
            ? `calc(100vh - ${headerHeight})`
            : isLoaded
              ? 0
              : -headerOffsetY,
        }}
        transition={{
          type: "spring",
          damping: 35,
          stiffness: 280,
          mass: 1,
          restDelta: 0.01,
          restSpeed: 0.01,
        }}
      >
        <div
          className="flex items-center justify-center border-r border-border"
          style={{ width: headerHeight }}
        >
          <div className="h-full aspect-square">
            <AutoTransition
              type="scale"
              duration={0.25}
              className="w-full h-full"
            >
              {shouldShowMobileUserInfo ? (
                <div
                  key="mobile-user-info"
                  className="flex items-center justify-center w-full h-full"
                >
                  <Suspense fallback={renderHeaderAvatar()}>
                    <UserInfo />
                  </Suspense>
                </div>
              ) : (
                renderHeaderAvatar()
              )}
            </AutoTransition>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center relative h-full">
          <TitleTransition
            direction={transitionDirection}
            isVisible={showTitle}
          >
            <h1>{displayTitle}</h1>
          </TitleTransition>
          <TitleTransition
            direction={transitionDirection}
            isVisible={showLoading}
          >
            <LoadingIndicator />
          </TitleTransition>
        </div>
        <div
          className="h-full border-l border-border flex items-center justify-center"
          style={{ width: headerHeight }}
        >
          <MenuButton
            isOpen={isMenuOpen}
            onClick={() => {
              // 先关闭Footer的控制台面板
              setConsoleOpen(false);
              // 然后切换菜单状态
              toggleMenu();
            }}
          />
        </div>
      </motion.header>

      <AnimatePresence>
        {isMenuOpen && (
          <motion.div
            className="fixed inset-0 bg-background z-40"
            initial={{ y: `calc(-100% + ${headerHeight})` }}
            animate={{ y: 0 }}
            exit={{ y: `calc(-100% + ${headerHeight})` }}
            transition={{
              type: "spring",
              damping: 35,
              stiffness: 280,
              mass: 1,
              restDelta: 0.01,
              restSpeed: 0.01,
            }}
          >
            <div className="h-full" style={{ paddingBottom: headerHeight }}>
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
