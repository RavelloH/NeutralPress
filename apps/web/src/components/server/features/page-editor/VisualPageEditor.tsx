import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import {
  RiAddLine,
  RiArrowLeftLine,
  RiExpandUpDownLine,
  RiSave3Line,
} from "@remixicon/react";
import { useMotionValue, useMotionValueEvent, useSpring } from "framer-motion";

import type {
  ResolvedBlock,
  RuntimeBlockInput,
} from "@/blocks/core/definition";
import type { AllBlockConfigs } from "@/blocks/core/types/base";
import HorizontalScroll from "@/components/client/layout/HorizontalScroll";
import BlockConfigPanel from "@/components/server/features/page-editor/BlockConfigPanel";
import BlockLibrary from "@/components/server/features/page-editor/BlockLibrary";
import VisualBlockRenderer, {
  SingleBlockRenderer,
} from "@/components/server/features/page-editor/VisualBlockRenderer";
import { fetchBlockData } from "@/lib/client/api/page-read";
import runWithAuth from "@/lib/client/run-with-auth";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Drawer } from "@/ui/Drawer";
import { useToast } from "@/ui/Toast";
import { Tooltip } from "@/ui/Tooltip";

// -----------------------------------------------------------------------------
// 草稿存储工具函数
// -----------------------------------------------------------------------------
const STORAGE_KEY = "page_editor";

interface PageDraft {
  blocks: RuntimeBlockInput[];
  updatedAt: string;
}

interface AllDrafts {
  [pageId: string]: PageDraft;
}

function getDraft(pageId: string): PageDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const all = JSON.parse(raw) as AllDrafts;
    return all[pageId] || null;
  } catch (e) {
    console.error("Failed to load draft", e);
    return null;
  }
}

function saveDraft(pageId: string, blocks: ResolvedBlock[]) {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const all: AllDrafts = raw ? JSON.parse(raw) : {};

    // 剔除 runtime 字段，只保留可持久化配置
    const cleanBlocks = blocks.map(
      ({ runtime: _runtime, ...rest }) => rest,
    ) as RuntimeBlockInput[];

    all[pageId] = {
      blocks: cleanBlocks,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch (e) {
    console.error("Failed to save draft", e);
  }
}

function removeDraft(pageId: string) {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const all = JSON.parse(raw) as AllDrafts;
    if (all[pageId]) {
      delete all[pageId];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    }
  } catch (e) {
    console.error("Failed to remove draft", e);
  }
}

interface VisualPageEditorProps {
  initialBlocks: ResolvedBlock[];
  onSave: (blocks: AllBlockConfigs[]) => Promise<void>;
  onBack: () => void;
  pageTitle: string;
  pageId: string; // 新增 pageId 用于区分草稿
}

export default function VisualPageEditor({
  initialBlocks,
  onSave,
  onBack,
  pageTitle,
  pageId,
}: VisualPageEditorProps) {
  const [blocks, setBlocks] = useState<ResolvedBlock[]>(initialBlocks);
  const [activeBlockId, setActiveBlockId] = useState<string | number | null>(
    null,
  );

  // 历史记录状态
  const [history, setHistory] = useState<{
    past: ResolvedBlock[][];
    future: ResolvedBlock[][];
  }>({
    past: [],
    future: [],
  });
  // 跟踪应该隐藏动画的 block IDs（编辑内容后隐藏，关闭面板后重置）
  const [hideAnimationBlockIds, setHideAnimationBlockIds] = useState<
    Set<string | number>
  >(new Set());
  const [activeDragId, setActiveDragId] = useState<string | number | null>(
    null,
  );
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isAddingBlock, setIsAddingBlock] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Base scale: 100% 容器高度对应的缩放比例 (仅在窗口大小改变时计算)
  const [baseScale, setBaseScale] = useState(1);
  // Current ratio: 用户当前的缩放倍率 (用于渲染)
  const [currentRatio, setCurrentRatio] = useState(1);

  // Motion values for smooth animation
  const userRatio = useMotionValue(1);
  const smoothRatio = useSpring(userRatio, {
    stiffness: 300,
    damping: 30,
    mass: 0.8,
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const isUndoRedoRef = useRef(false); // 标记是否正在执行撤销/重做操作
  const toast = useToast();

  // 克隆 blocks 用于历史记录快照
  const cloneBlocks = useCallback((blocksToClone: ResolvedBlock[]) => {
    return blocksToClone.map((block) => ({ ...block }));
  }, []);

  // 保存当前状态到历史记录
  const pushHistory = useCallback(
    (currentBlocks: ResolvedBlock[]) => {
      if (isUndoRedoRef.current) return; // 撤销/重做操作不记录历史
      setHistory((prev) => ({
        past: [...prev.past, cloneBlocks(currentBlocks)],
        future: [], // 新操作清空 future
      }));
    },
    [cloneBlocks],
  );

  // 撤销
  const undo = useCallback(() => {
    setHistory((prev) => {
      if (prev.past.length === 0) return prev;
      const previous = prev.past[prev.past.length - 1]!;
      const newPast = prev.past.slice(0, -1);
      isUndoRedoRef.current = true;
      setBlocks(previous);
      setTimeout(() => {
        isUndoRedoRef.current = false;
      }, 0);
      return {
        past: newPast,
        future: [cloneBlocks(blocks), ...prev.future],
      };
    });
  }, [blocks, cloneBlocks]);

  // 重做
  const redo = useCallback(() => {
    setHistory((prev) => {
      if (prev.future.length === 0) return prev;
      const next = prev.future[0]!;
      const newFuture = prev.future.slice(1);
      isUndoRedoRef.current = true;
      setBlocks(next);
      setTimeout(() => {
        isUndoRedoRef.current = false;
      }, 0);
      return {
        past: [...prev.past, cloneBlocks(blocks)],
        future: newFuture,
      };
    });
  }, [blocks, cloneBlocks]);

  // 带历史记录的 setBlocks 包装器
  const setBlocksWithHistory = useCallback(
    (
      newBlocks: ResolvedBlock[] | ((prev: ResolvedBlock[]) => ResolvedBlock[]),
    ) => {
      setBlocks((prev) => {
        const updated =
          typeof newBlocks === "function" ? newBlocks(prev) : newBlocks;
        // 检查是否真的有变化
        if (JSON.stringify(prev) === JSON.stringify(updated)) {
          return prev;
        }
        pushHistory(prev);
        return updated;
      });
    },
    [pushHistory],
  );

  useEffect(() => {
    setMounted(true);

    if (draftLoadedRef.current) return;

    // 加载草稿逻辑
    const draft = getDraft(pageId);
    if (draft) {
      draftLoadedRef.current = true;
      // 恢复草稿数据
      // 恢复草稿后，遍历所有 block 重新 fetch data。

      const hydrateDraft = async () => {
        const hydratedBlocks = await Promise.all(
          draft.blocks.map(async (block) => {
            try {
              const res = await runWithAuth(fetchBlockData, {
                access_token: undefined,
                block,
              } as never);
              if (res && "data" in res && res.data?.block) {
                return res.data.block;
              }
              return {
                ...block,
                runtime: {
                  context: {},
                  placeholders: {},
                  media: {},
                  business: {},
                  meta: { status: "ok" as const },
                },
              } as ResolvedBlock;
            } catch (e) {
              console.error("Failed to hydrate block", block.id, e);
              return {
                ...block,
                runtime: {
                  context: {},
                  placeholders: {},
                  media: {},
                  business: {},
                  meta: { status: "error" as const },
                },
              } as ResolvedBlock;
            }
          }),
        );
        setBlocks(hydratedBlocks);

        toast.info(
          "已加载草稿",
          `上次保存于 ${new Date(draft.updatedAt).toLocaleString()}`,
          10000,
          {
            label: "撤销",
            onClick: () => {
              removeDraft(pageId);
              setBlocks(initialBlocks);
              toast.success("已撤销", "草稿已删除，恢复初始状态");
            },
          },
        );
      };

      hydrateDraft();
    }
  }, [pageId, initialBlocks, toast]); // Initial load only

  // 自动保存草稿
  useEffect(() => {
    if (!mounted) return;
    // 只有当 blocks 与 initialBlocks 不同时，或者已经有变更时才保存
    // 这里简单处理：只要 blocks 变化就保存
    // 简单的防抖
    const timer = setTimeout(() => {
      saveDraft(pageId, blocks);
    }, 1000);
    return () => clearTimeout(timer);
  }, [blocks, pageId, mounted]);

  // Sync spring value to React state for rendering
  useMotionValueEvent(smoothRatio, "change", (latest) => {
    setCurrentRatio(latest);
  });

  // Calculate BASE scale (Container 100% Height vs Target Height)
  useEffect(() => {
    const updateBaseScale = () => {
      if (!containerRef.current) return;

      const remSize =
        parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const targetHeight = window.innerHeight - 10 * remSize;

      if (targetHeight <= 0) return;

      // 这里使用的是 containerRef (外层容器) 的高度，它应该是充满屏幕剩余空间的
      // 不受内部元素缩放的影响
      const containerHeight = containerRef.current.offsetHeight;

      // 计算基准缩放比例
      const newBaseScale = containerHeight / targetHeight;
      setBaseScale(newBaseScale);
    };

    updateBaseScale();

    // 只监听外层容器大小变化和窗口变化
    const observer = new ResizeObserver(updateBaseScale);
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    window.addEventListener("resize", updateBaseScale);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateBaseScale);
    };
  }, []); // Empty deps: internal logic ensures correctness

  // Derived final scale
  const finalScale = Math.min(Math.max(baseScale * currentRatio, 0.1), 1.5);

  // Auto-scroll to center the active block (Only for the last block)
  useEffect(() => {
    if (!activeBlockId) return;

    // Check if the active block is the last one
    const lastBlock = blocks[blocks.length - 1];
    const isLastBlock = lastBlock && lastBlock.id === activeBlockId;
    if (!isLastBlock) return;

    // Wait for layout updates (especially Spacer expansion)
    const timer = setTimeout(() => {
      const scrollContainer = document.getElementById(
        "editor-scroll-container",
      )?.parentElement;
      const targetEl = document.querySelector(
        `[data-draggable-id="${activeBlockId}"]`,
      );

      if (scrollContainer && targetEl) {
        const targetRect = targetEl.getBoundingClientRect();

        // Estimate Drawer width (40% of screen based on Drawer config) if open
        const drawerWidth = isDrawerOpen ? window.innerWidth * 0.4 : 0;

        // Center of the available area
        const availableCenter = (window.innerWidth - drawerWidth) / 2;

        // Current center of the target element
        const elementCenter = targetRect.left + targetRect.width / 2;

        // Calculate delta to scroll
        const deltaX = elementCenter - availableCenter;

        // Only scroll if the delta is significant to avoid jitter
        if (Math.abs(deltaX) > 10) {
          scrollContainer.scrollBy({
            left: deltaX,
            behavior: "smooth",
          });
        }
      }
    }, 300); // Delay needs to match or exceed transition durations for accurate rects

    return () => clearTimeout(timer);
  }, [activeBlockId, isDrawerOpen, blocks]);

  const draftLoadedRef = useRef(false);

  useEffect(() => {
    if (!draftLoadedRef.current) {
      setBlocks(initialBlocks);
    }
  }, [initialBlocks]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Prevent accidental drags when clicking
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(event.active.id);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = blocks.findIndex((item) => item.id === active.id);
      const newIndex = blocks.findIndex((item) => item.id === over.id);
      setBlocksWithHistory(arrayMove(blocks, oldIndex, newIndex));
    }
    // Delay clearing activeDragId to allow drop animation to finish
    // This prevents the "flicker" where the item reappears before the overlay lands
    setTimeout(() => {
      setActiveDragId(null);
    }, 250);
  };

  const handleSelectBlock = useCallback((id: string | number) => {
    setActiveBlockId(id);
    setIsDrawerOpen(true);
  }, []);

  const handleUpdateBlock = (updates: Partial<ResolvedBlock>) => {
    if (!activeBlockId) return;
    // 标记该 block 应该隐藏动画
    setHideAnimationBlockIds((prev) => new Set(prev).add(activeBlockId));
    setBlocksWithHistory(
      blocks.map((item) =>
        item.id === activeBlockId
          ? ({ ...item, ...updates } as ResolvedBlock)
          : item,
      ),
    );
  };

  // 刷新当前 Block 的数据
  const handleRefreshBlockData = async () => {
    if (!activeBlockId) return;

    const activeBlock = blocks.find((b) => b.id === activeBlockId);
    if (!activeBlock) return;

    try {
      const { runtime: _runtime, ...blockForFetch } = activeBlock;
      const result = await runWithAuth(fetchBlockData, {
        access_token: undefined,
        block: blockForFetch,
      } as never);

      if (result && "data" in result && result.data?.block) {
        handleUpdateBlock({ runtime: result.data.block.runtime });
        toast.success("数据已更新");
      } else {
        toast.error("更新失败");
      }
    } catch (error) {
      console.error("刷新 Block 数据失败:", error);
      toast.error("更新出错");
    }
  };

  // 删除当前 Block
  const handleDeleteBlock = useCallback(() => {
    if (!activeBlockId) return;
    setBlocksWithHistory((prev) => prev.filter((b) => b.id !== activeBlockId));
    setIsDrawerOpen(false);
    setActiveBlockId(null);
  }, [activeBlockId, setBlocksWithHistory]);

  const handleAddBlock = useCallback(
    async (type: string, initialData?: Partial<RuntimeBlockInput>) => {
      setIsAddingBlock(true);
      try {
        const newId = Date.now();
        const newBlock: RuntimeBlockInput = {
          id: newId,
          block: type,
          description: "",
          content: {},
          ...initialData,
        } as RuntimeBlockInput;

        // 调用 Server Action 获取数据
        const result = await runWithAuth(fetchBlockData, {
          access_token: undefined, // 使用 cookie 中的 token
          block: newBlock,
        } as never);

        const blockForInsert =
          result && "data" in result && result.data?.block
            ? result.data.block
            : ({
                ...newBlock,
                runtime: {
                  context: {},
                  placeholders: {},
                  media: {},
                  business: {},
                  meta: { status: "ok" as const },
                },
              } as ResolvedBlock);

        setBlocksWithHistory((prev) => [...prev, blockForInsert]);
        setIsLibraryOpen(false);

        // 关闭对话框后，等待渲染完成，然后滚动到最后并选中新 block
        setTimeout(() => {
          const contentEl = document.getElementById("editor-scroll-container");
          // 滚动容器通常是内容的父元素
          const scrollContainer = contentEl?.parentElement;

          if (scrollContainer) {
            // 使用平滑滚动到最右边
            scrollContainer.scrollTo({
              left: scrollContainer.scrollWidth,
              behavior: "smooth",
            });
          }

          // 再延迟一点确保滚动完成后选中
          setTimeout(() => {
            handleSelectBlock(newId);
          }, 500); // 稍微增加延迟以等待平滑滚动完成
        }, 100);
      } catch (error) {
        console.error("添加 Block 失败:", error);
      } finally {
        setIsAddingBlock(false);
      }
    },
    [handleSelectBlock, setBlocksWithHistory],
  );

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const blocksForSave = blocks.map(
        ({ runtime: _runtime, ...rest }) => rest,
      );
      await onSave(blocksForSave as AllBlockConfigs[]);
      // 保存成功后清除草稿
      removeDraft(pageId);
    } finally {
      setIsSaving(false);
    }
  };

  // 关闭编辑面板，重置 block 的动画隐藏状态
  const handleCloseDrawer = () => {
    setIsDrawerOpen(false);
    // 重置当前 block 的状态，以便下次打开时仍显示高亮动画
    if (activeBlockId) {
      setHideAnimationBlockIds((prev) => {
        const next = new Set(prev);
        next.delete(activeBlockId);
        return next;
      });
    }
    setActiveBlockId(null);
  };

  const activeBlock = blocks.find((b) => b.id === activeBlockId) || null;
  const draggingBlock = blocks.find((b) => b.id === activeDragId);

  // 键盘快捷键：Ctrl+C 复制区块，Ctrl+V 粘贴区块，Delete/Backspace/Ctrl+D 删除区块
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // 检查是否在输入框/文本域中，如果是则不触发快捷键
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      // Ctrl+C 或 Cmd+C：复制当前选中的区块
      if ((e.ctrlKey || e.metaKey) && e.key === "c" && activeBlock) {
        e.preventDefault();
        const { runtime: _runtime, ...blockToCopy } = activeBlock;
        const jsonString = JSON.stringify(blockToCopy, null, 2);
        navigator.clipboard.writeText(jsonString).then(() => {
          toast.success("区块 JSON 已复制到剪贴板");
        });
        return;
      }

      // Ctrl+Z 或 Cmd+Z：撤销
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        if (history.past.length > 0) {
          undo();
          toast.success("已撤销");
        } else {
          toast.info("没有可撤销的操作");
        }
        return;
      }

      // Ctrl+Shift+Z 或 Cmd+Shift+Z（以及 Ctrl+Y）：重做
      if (
        ((e.ctrlKey || e.metaKey) && e.key === "z" && e.shiftKey) ||
        ((e.ctrlKey || e.metaKey) && e.key === "y")
      ) {
        e.preventDefault();
        if (history.future.length > 0) {
          redo();
          toast.success("已重做");
        } else {
          toast.info("没有可重做的操作");
        }
        return;
      }

      // Ctrl+V 或 Cmd+V：粘贴区块
      if ((e.ctrlKey || e.metaKey) && e.key === "v") {
        e.preventDefault();
        navigator.clipboard
          .readText()
          .then((text) => {
            try {
              const parsed = JSON.parse(text);
              // 验证是否是有效的区块配置
              if (
                parsed &&
                typeof parsed === "object" &&
                typeof parsed.block === "string"
              ) {
                // 去掉 id，让 handleAddBlock 生成新的 id
                const { id: _id, runtime: _runtime, ...blockData } = parsed;
                handleAddBlock(parsed.block, blockData);
              } else {
                toast.error("剪贴板内容不是有效的区块 JSON");
              }
            } catch {
              toast.error("剪贴板内容不是有效的 JSON");
            }
          })
          .catch(() => {
            toast.error("无法读取剪贴板内容");
          });
        return;
      }

      // Ctrl+D 或 Cmd+D：删除当前选中的区块（比 Delete 更方便）
      if ((e.ctrlKey || e.metaKey) && e.key === "d" && activeBlockId) {
        e.preventDefault();
        setBlocksWithHistory((prev) =>
          prev.filter((b) => b.id !== activeBlockId),
        );
        setIsDrawerOpen(false);
        setActiveBlockId(null);
        return;
      }

      // Delete 或 Backspace：删除当前选中的区块（仅在面板打开时）
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        activeBlockId &&
        isDrawerOpen
      ) {
        e.preventDefault();
        setBlocksWithHistory((prev) =>
          prev.filter((b) => b.id !== activeBlockId),
        );
        setIsDrawerOpen(false);
        setActiveBlockId(null);
        return;
      }
    },
    [
      activeBlock,
      activeBlockId,
      isDrawerOpen,
      toast,
      handleAddBlock,
      history,
      undo,
      redo,
      setBlocksWithHistory,
    ],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown]);

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* Top Bar */}
      <div className="h-14 border-b border-border mb-2 flex items-center justify-between px-4 bg-background z-20 shrink-0">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            icon={<RiArrowLeftLine size={18} />}
            label="返回"
          />
          <div className="h-6 w-px bg-border" />
          <h1>布局编辑器</h1>
          <div className="h-6 w-px bg-border" />
          <div className="">{pageTitle}</div>
        </div>

        <div className="flex items-center gap-2">
          {/* Zoom Control */}
          <Tooltip content="滚动鼠标滚轮调整视图大小">
            <div
              className="group flex items-center gap-1 px-2 py-1.5 rounded-md hover:bg-muted cursor-ns-resize select-none transition-colors border border-transparent hover:border-border/50"
              onWheel={(e) => {
                // Smooth continuous scroll
                const delta = e.deltaY * -0.001;
                const current = userRatio.get();
                const newValue = Math.min(Math.max(current + delta, 0.2), 1);
                userRatio.set(newValue);
              }}
            >
              <RiExpandUpDownLine
                size={16}
                className="text-muted-foreground group-hover:text-foreground transition-colors"
              />
              <span className="text-xs font-mono text-muted-foreground group-hover:text-foreground w-8 text-center tabular-nums">
                {Math.round(currentRatio * 100)}%
              </span>
            </div>{" "}
          </Tooltip>

          <Button
            variant="secondary"
            size="sm"
            icon={<RiAddLine size="1.25em" />}
            label="添加区块"
            onClick={() => setIsLibraryOpen(true)}
            disabled={isAddingBlock}
          />
          <Button
            variant="primary"
            size="sm"
            icon={<RiSave3Line size="1.25em" />}
            label="保存更改"
            loading={isSaving || isAddingBlock}
            onClick={handleSave}
          />
        </div>
      </div>

      {/* Main Canvas */}
      <div
        ref={containerRef}
        className="flex-1 bg-muted/10 overflow-hidden relative flex flex-col justify-center"
      >
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          measuring={{
            droppable: {
              strategy: MeasuringStrategy.Always,
            },
          }}
          autoScroll={{
            threshold: {
              x: 0.1, // 10% from edge triggers scroll
              y: 0,
            },
            acceleration: 5, // smoothness
          }}
        >
          {/* 使用 motion.div 或者普通的 div 配合 state 更新来实现高度变化 */}
          <div className="w-full" style={{ height: `${currentRatio * 100}%` }}>
            <HorizontalScroll
              className="h-full"
              forceNativeScroll={true} // Enable native scroll for DnD compatibility
            >
              <div
                id="editor-scroll-container"
                className="h-full flex flex-nowrap px-10 gap-4 items-center"
                style={{
                  zoom: finalScale,
                }}
              >
                <SortableContext
                  items={blocks.map((b) => b.id)}
                  strategy={horizontalListSortingStrategy}
                >
                  <VisualBlockRenderer
                    blocks={blocks}
                    activeBlockId={activeBlockId}
                    onSelectBlock={handleSelectBlock}
                    hideAnimationBlockIds={hideAnimationBlockIds}
                    scale={finalScale}
                  />
                </SortableContext>

                {/* Empty State / Add Placeholder */}
                {blocks.length === 0 && (
                  <div className="h-[80%] w-[300px] border-2 border-dashed border-muted-foreground/30 rounded-lg flex flex-col items-center justify-center text-muted-foreground">
                    <p>页面为空</p>
                    <Button
                      variant="ghost"
                      label="添加第一个区块"
                      onClick={() => setIsLibraryOpen(true)}
                      className="mt-4"
                    />
                  </div>
                )}

                {/* Spacer to prevent Drawer from covering the last item */}
                {/* 宽度除以 finalScale 是为了抵消容器 zoom 的影响，确保在屏幕上始终占据约 45% 的物理宽度 */}
                <div
                  aria-hidden="true"
                  className="shrink-0 transition-all duration-300 ease-in-out h-px"
                  style={{
                    width: isDrawerOpen ? `calc(30vw / ${finalScale})` : "0px",
                  }}
                />
              </div>
            </HorizontalScroll>
          </div>

          {mounted &&
            createPortal(
              <DragOverlay style={{ pointerEvents: "none" }}>
                {draggingBlock ? (
                  <div
                    className="h-full border-2 border-primary shadow-2xl opacity-90 bg-background"
                    style={{
                      zoom: finalScale,
                    }}
                  >
                    <SingleBlockRenderer block={draggingBlock} />
                  </div>
                ) : null}
              </DragOverlay>,
              document.body,
            )}
        </DndContext>
      </div>

      {/* Config Drawer */}
      <Drawer
        open={isDrawerOpen}
        onClose={handleCloseDrawer}
        initialSize={0.4}
        className="z-50"
        showBackdrop={false}
      >
        <div className="h-full flex flex-col">
          <BlockConfigPanel
            block={activeBlock}
            onUpdate={handleUpdateBlock}
            onRefreshData={handleRefreshBlockData}
            onDelete={handleDeleteBlock}
          />
        </div>
      </Drawer>

      {/* Library Dialog */}
      <Dialog
        open={isLibraryOpen}
        onClose={() => setIsLibraryOpen(false)}
        title="添加区块"
        size="xl"
      >
        <div>
          <BlockLibrary onAdd={handleAddBlock} isLoading={isAddingBlock} />
        </div>
      </Dialog>
    </div>
  );
}
