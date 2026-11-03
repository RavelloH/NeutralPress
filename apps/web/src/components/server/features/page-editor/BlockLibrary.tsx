import React, { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  RiAddLine,
  RiCodeBoxLine,
  RiLayoutGridLine,
  RiLayoutMasonryLine,
  RiQuestionLine,
} from "@remixicon/react";

import type {
  ResolvedBlock,
  RuntimeBlockInput,
} from "@/blocks/core/definition";
import { getAllBlockFormConfigs } from "@/blocks/core/registry";
import type { BlockFormConfig } from "@/blocks/core/types/field-config";
import { SingleBlockRenderer } from "@/components/server/features/page-editor/VisualBlockRenderer";
import Link from "@/components/ui/Link";
import { fetchBlockData } from "@/lib/client/api/page-read";
import runWithAuth from "@/lib/client/run-with-auth";
import { AutoTransition } from "@/ui/AutoTransition";
import { Button } from "@/ui/Button";
import Clickable from "@/ui/Clickable";
import { LoadingIndicator } from "@/ui/LoadingIndicator";
import { Tooltip } from "@/ui/Tooltip";

// 分类配置
const THEMES_CONFIG: Record<
  string,
  { label: string; icon: React.ElementType }
> = {
  neutral: {
    label: "Neutral",
    icon: RiLayoutMasonryLine,
  },
  unset: {
    label: "未知主题",
    icon: RiQuestionLine,
  },
  import: {
    label: "导入",
    icon: RiCodeBoxLine,
  },
};

const DEFAULT_THEME_ICON = RiLayoutGridLine;

export default function BlockLibrary({
  onAdd,
  isLoading: isAdding,
}: {
  onAdd: (type: string, data?: Partial<RuntimeBlockInput>) => Promise<void>;
  isLoading?: boolean;
}) {
  const [configs, setConfigs] = useState<BlockFormConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTheme, setSelectedCategory] = useState<string | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<BlockFormConfig | null>(
    null,
  );
  // Import state
  const [importJson, setImportJson] = useState("");

  // 预览相关状态
  const [previewBlock, setPreviewBlock] = useState<ResolvedBlock | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewScale, setPreviewScale] = useState(1);
  const [previewContentSize, setPreviewContentSize] = useState<{
    width: number | string;
    height: number | string;
  }>({
    width: "max-content",
    height: 800,
  });
  const [previewVisible, setPreviewVisible] = useState(false);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const previewContentRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);

  // 加载配置
  useEffect(() => {
    getAllBlockFormConfigs()
      .then((data) => {
        setConfigs(data);
        if (data.length > 0) {
          // 初始选中逻辑
          const firstConfig = data[0];
          const firstCat =
            firstConfig?.theme?.name === "neutral" ? "neutral" : "unset";
          setSelectedCategory(firstCat);
          setSelectedBlock(firstConfig || null);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  // 当选中 block 改变时，加载预览数据
  useEffect(() => {
    if (selectedTheme === "import") return;

    if (!selectedBlock) {
      setPreviewBlock(null);
      setPreviewVisible(false);
      return;
    }

    const loadPreviewData = async () => {
      setPreviewLoading(true);
      setPreviewVisible(false);
      try {
        // 使用 schema 中定义的 previewData 作为 content
        const previewContent = selectedBlock.previewData || {};

        // 创建临时 block 用于预览
        const tempBlock: RuntimeBlockInput = {
          id: "preview",
          block: selectedBlock.blockType,
          description: selectedBlock.displayName,
          content: previewContent,
        };

        // 调用 Server Action 获取动态数据
        const result = await runWithAuth(fetchBlockData, {
          access_token: undefined, // 使用 cookie 中的 token
          block: tempBlock,
        } as never);

        if (result && "data" in result && result.data?.block) {
          setPreviewBlock(result.data.block);
        } else {
          setPreviewBlock(null);
        }
      } catch (error) {
        console.error("加载预览数据失败:", error);
        setPreviewBlock(null);
      } finally {
        setPreviewLoading(false);
        // 延迟 300ms 后显示内容，避免跳变
        setTimeout(() => {
          setPreviewVisible(true);
        }, 300);
      }
    };

    loadPreviewData();
  }, [selectedBlock, selectedTheme]);

  // 计算预览区域的缩放比例
  useEffect(() => {
    if (!previewContainerRef.current || !measureRef.current) return;

    let rafId: number | null = null;

    const updateScale = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }

      rafId = requestAnimationFrame(() => {
        if (!previewContainerRef.current || !measureRef.current) return;

        const container = previewContainerRef.current;
        const contentWrapper = measureRef.current;
        const containerWidth = container.offsetWidth;
        const containerHeight = container.offsetHeight;

        if (containerWidth <= 0 || containerHeight <= 0) {
          return;
        }

        // 获取 block 内容的实际尺寸
        const contentWidth = contentWrapper.scrollWidth;
        const contentHeight = contentWrapper.scrollHeight;

        if (contentWidth <= 0 || contentHeight <= 0) {
          return;
        }

        // 计算缩放比例，确保内容完全显示在容器内
        const scaleX = containerWidth / contentWidth;
        const scaleY = containerHeight / contentHeight;
        const scale = Math.min(scaleX, scaleY);

        // 只在缩放比例变化超过 1% 时才更新（避免频繁更新）
        setPreviewScale((prevScale) => {
          if (Math.abs(scale - prevScale) > 0.01) {
            return scale;
          }
          return prevScale;
        });

        // 更新内容尺寸状态
        setPreviewContentSize({ width: contentWidth, height: contentHeight });
      });
    };

    // 延迟执行，等待内容渲染完成
    const timer = setTimeout(() => {
      updateScale();
    }, 150);

    // 只监听容器的大小变化，避免循环
    const resizeObserver = new ResizeObserver(() => {
      updateScale();
    });
    resizeObserver.observe(previewContainerRef.current);
    if (measureRef.current) {
      resizeObserver.observe(measureRef.current);
    }

    // 监听窗口大小变化
    window.addEventListener("resize", updateScale);

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      clearTimeout(timer);
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateScale);
    };
  }, [previewBlock]);

  // 按分类分组
  const categories = useMemo(() => {
    const groups: Record<string, BlockFormConfig[]> = {
      neutral: [],
      unset: [],
    };

    configs.forEach((config) => {
      const cat = config.theme?.name === "neutral" ? "neutral" : "unset";
      groups[cat]?.push(config);
    });

    // 过滤掉空的分类
    return Object.fromEntries(
      Object.entries(groups).filter(([_, blocks]) => blocks.length > 0),
    );
  }, [configs]);

  // 获取分类列表（按照 CATEGORY_CONFIG 顺序排列）
  const categoryList = useMemo(() => {
    return Object.keys(THEMES_CONFIG).filter(
      (cat) => cat === "import" || categories[cat],
    );
  }, [categories]);

  // 自动修正选中状态
  useEffect(() => {
    if (
      selectedTheme &&
      categories[selectedTheme] &&
      (!selectedBlock ||
        (selectedBlock.theme?.name === "neutral" ? "neutral" : "unset") !==
          selectedTheme)
    ) {
      setSelectedBlock(categories[selectedTheme]![0] || null);
    }
  }, [selectedTheme, categories, selectedBlock]);

  // 处理分类切换
  const handleCategoryClick = (cat: string) => {
    setSelectedCategory(cat);
    if (cat === "import") {
      setSelectedBlock(null);
      setPreviewBlock(null);
      setImportJson("");
      return;
    }
    if (categories[cat] && categories[cat]!.length > 0) {
      setSelectedBlock(categories[cat]![0] || null);
    }
  };

  // 监听 importJson 变化，防抖加载预览数据
  useEffect(() => {
    if (selectedTheme !== "import" || !importJson) return;

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const parsed = JSON.parse(importJson);
          if (parsed && typeof parsed === "object" && parsed.block) {
            setPreviewLoading(true);
            setPreviewVisible(false);

            try {
              // 调用 Server Action 获取动态数据
              const result = await runWithAuth(fetchBlockData, {
                access_token: undefined,
                block: parsed as RuntimeBlockInput,
              } as never);

              if (result && "data" in result && result.data?.block) {
                setPreviewBlock(result.data.block);
              } else {
                setPreviewBlock(null);
              }
            } catch (error) {
              console.error("加载预览数据失败:", error);
              setPreviewBlock(null);
            } finally {
              setPreviewLoading(false);
              setTimeout(() => {
                setPreviewVisible(true);
              }, 300);
            }
          }
        } catch (_err) {
          // Ignore parse errors
        }
      })();
    }, 500);

    return () => clearTimeout(timer);
  }, [importJson, selectedTheme]);

  const handleImportChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setImportJson(value);

    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object") {
        const blockType = parsed.block;
        const config = configs.find((c) => c.blockType === blockType);

        if (config) {
          setSelectedBlock(config);
        }
      }
    } catch (_err) {
      // Ignore parse errors
    }
  };
  if (loading) {
    return (
      <div className="flex h-[700px] items-center justify-center text-muted-foreground bg-background">
        <LoadingIndicator />
      </div>
    );
  }

  const currentCategoryBlocks = selectedTheme
    ? categories[selectedTheme] || []
    : [];

  return (
    <div className="flex h-[700px] bg-background border border-border overflow-hidden">
      {/* 1. 最左侧：分类图标栏 */}
      <div className="w-16 bg-muted/30 border-r border-border flex flex-col items-center py-4 gap-3 overflow-y-auto no-scrollbar">
        {categoryList.map((cat) => {
          const config = THEMES_CONFIG[cat];
          const Icon = config?.icon || DEFAULT_THEME_ICON;
          const isActive = selectedTheme === cat;
          return (
            <Tooltip content={config?.label || cat} key={cat} placement="left">
              <Clickable
                hoverScale={1}
                onClick={() => handleCategoryClick(cat)}
                className="relative group w-12 h-12 flex items-center justify-center transition-all duration-200"
              >
                <div
                  className={`
                  absolute left-0 bg-primary transition-all duration-200
                  ${isActive ? "h-8 w-1" : "h-2 w-1 opacity-0 group-hover:opacity-50 group-hover:h-4"}
                `}
                />
                <div
                  className={
                    isActive ? "text-primary" : "text-muted-foreground"
                  }
                >
                  <Icon size="1.25em" />
                </div>
              </Clickable>
            </Tooltip>
          );
        })}
      </div>

      {/* 2. 中间：Block 列表 (类似 Discord 频道列表/私信列表) */}
      <div className="w-96 bg-muted/10 border-r border-border flex flex-col">
        <div className="h-12 border-b border-border flex items-center px-4 font-medium text-sm">
          {selectedTheme
            ? THEMES_CONFIG[selectedTheme]?.label.toUpperCase()
            : "BLOCKS"}
        </div>
        <div className="flex-1 overflow-y-auto">
          <AutoTransition className="h-full">
            {selectedTheme === "import" ? (
              <div className="h-full overflow-hidden" key="import-blocks">
                <textarea
                  className="w-full h-full p-2 bg-background border border-border font-mono text-xs resize-none focus:outline-none focus:ring-1 text-secondary-foreground focus:ring-primary"
                  placeholder="在此粘贴 Block JSON..."
                  value={importJson}
                  onChange={handleImportChange}
                />
              </div>
            ) : (
              <Fragment key="category-blocks">
                {currentCategoryBlocks.map((block) => (
                  <button
                    key={block.blockType}
                    onClick={() => setSelectedBlock(block)}
                    className={`
                w-full text-left px-4 py-3 border-b border-border/50 transition-all duration-200 flex flex-col gap-1
                ${
                  selectedBlock?.blockType === block.blockType
                    ? "bg-primary/5 text-primary"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                }
              `}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`font-semibold text-sm truncate ${selectedBlock?.blockType === block.blockType ? "text-primary" : "text-foreground"}`}
                      >
                        {block.displayName}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                      {block.description || "暂无描述"}
                    </div>
                  </button>
                ))}
                {currentCategoryBlocks.length === 0 && (
                  <div className="p-8 text-xs text-muted-foreground text-center">
                    该分类下暂无 Block
                  </div>
                )}
              </Fragment>
            )}
          </AutoTransition>
        </div>
      </div>

      {/* 3. 右侧：详细预览区域 */}
      <div className="flex-1 bg-background flex flex-col min-w-0">
        {selectedBlock ? (
          <>
            {/* 顶部标题栏 */}
            <div className="h-12 border-b border-border flex items-center justify-between px-6 bg-card/30 flex-shrink-0">
              <div className="flex items-center gap-2 font-medium">
                <span>{selectedBlock.displayName}</span>
              </div>
            </div>

            {/* 内容区域 */}
            <div className="flex-1 overflow-y-auto">
              {/* 实时预览区域 */}
              <div className="bg-muted/30">
                <div
                  ref={previewContainerRef}
                  className="relative overflow-hidden mx-10 h-[37.5em]"
                >
                  {previewLoading ? (
                    <div className="flex items-center justify-center h-full">
                      <LoadingIndicator />
                    </div>
                  ) : previewBlock ? (
                    <div className="flex items-center justify-center h-full w-full overflow-hidden">
                      <div
                        ref={previewContentRef}
                        style={{
                          width:
                            typeof previewContentSize.width === "number"
                              ? `${previewContentSize.width}px`
                              : previewContentSize.width,
                          height:
                            typeof previewContentSize.height === "number"
                              ? `${previewContentSize.height}px`
                              : previewContentSize.height,
                          transform: `scale(${previewScale})`,
                          transformOrigin: "center center",
                          opacity: previewVisible ? 1 : 0,
                          transition: "opacity 300ms ease-in-out",
                        }}
                        className="bg-background inline-block"
                      >
                        <div ref={measureRef} className="w-fit h-full">
                          <SingleBlockRenderer block={previewBlock} />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                      暂无预览
                    </div>
                  )}
                </div>
              </div>

              {/* 区块信息 */}
              <div className="p-6">
                <div className="max-w-2xl mx-auto space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
                      区块信息
                    </h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm text-muted-foreground">
                        区块类型
                      </label>
                      <p className="text-sm font-mono">
                        {selectedBlock.blockType}
                      </p>
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground">
                        区块名称
                      </label>
                      <p className="text-sm font-mono">
                        {selectedBlock.displayName}
                      </p>
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground">
                        区块作者
                      </label>
                      <p className="text-sm font-mono">
                        {selectedBlock.author ? (
                          selectedBlock.author.url ? (
                            <Link
                              presets={["hover-underline"]}
                              href={selectedBlock.author.url}
                            >
                              @{selectedBlock.author.name}
                            </Link>
                          ) : (
                            "@" + selectedBlock.author.name
                          )
                        ) : (
                          "未知"
                        )}
                      </p>
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground">
                        区块所属主题
                      </label>
                      <p className="text-sm font-mono">
                        {selectedBlock.theme ? (
                          selectedBlock.theme.url ? (
                            <Link
                              presets={["hover-underline"]}
                              href={selectedBlock.theme.url}
                            >
                              {selectedBlock.theme.name}
                            </Link>
                          ) : (
                            selectedBlock.theme.name
                          )
                        ) : (
                          "未知"
                        )}
                      </p>
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground">
                        配置量
                      </label>
                      <p className="text-sm">
                        {selectedBlock.fields.length}个配置项，
                        {selectedBlock.groups?.length
                          ? selectedBlock.groups.length + "个分组"
                          : "未分组"}
                      </p>
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground">
                        性能影响
                      </label>
                      <p className="text-sm">
                        {selectedBlock.actions?.db || 0} DB 查询，
                        {selectedBlock.actions?.config || 0} 配置查询
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-4">
                    <div>
                      <label className="text-sm text-muted-foreground">
                        区块描述
                      </label>
                      <p className="text-sm font-mono whitespace-pre-wrap mt-1">
                        {selectedBlock.description || "暂无描述"}
                      </p>
                    </div>
                  </div>

                  {/* 添加按钮 */}
                  <div className="pt-8 border-t border-border mt-8 w-full">
                    <Button
                      size="md"
                      className="w-full"
                      fullWidth
                      onClick={() => {
                        if (selectedTheme === "import" && previewBlock) {
                          const { runtime: _runtime, ...rest } = previewBlock;
                          onAdd(selectedBlock.blockType, rest);
                        } else {
                          onAdd(selectedBlock.blockType);
                        }
                      }}
                      loading={isAdding}
                      icon={<RiAddLine size={18} />}
                      label={`添加到页面`}
                    />
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
            <RiLayoutGridLine size={48} className="mb-4 opacity-20" />
            <p>选择一个 Block 查看详情</p>
          </div>
        )}
      </div>
    </div>
  );
}
