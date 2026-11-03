"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { RiAddLine, RiCloseLine, RiFolderLine } from "@remixicon/react";
import type { SearchCategoryItem } from "@repo/shared-types/api/category";
import { AnimatePresence, motion } from "framer-motion";

import { searchCategories } from "@/lib/client/api/category";
import { AutoResizer } from "@/ui/AutoResizer";
import { AutoTransition } from "@/ui/AutoTransition";
import { Input } from "@/ui/Input";

export interface CategoryInputProps {
  value: string | null; // 单个分类路径，如 "技术/前端/React"
  onChange: (category: string | null, categoryId?: number | null) => void;
  label?: string;
  placeholder?: string;
  helperText?: string;
  className?: string;
  disabled?: boolean;
  size?: "sm" | "md";
}

export function CategoryInput({
  value = null,
  onChange,
  label = "分类",
  helperText = "搜索或创建分类，使用「/」分隔创建多层分类",
  className = "",
  disabled = false,
  size = "md",
}: CategoryInputProps) {
  const [inputValue, setInputValue] = useState("");
  const [searchResults, setSearchResults] = useState<SearchCategoryItem[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dropdownDirection, setDropdownDirection] = useState<"down" | "up">(
    "down",
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 判断是否有完全匹配的结果
  const hasExactMatch = React.useMemo(() => {
    // 格式化用户输入，统一格式为 "A / B / C"（带空格）
    const normalizeInput = (input: string) => {
      return input
        .split("/")
        .map((p) => p.trim())
        .filter(Boolean)
        .join(" / ")
        .toLowerCase();
    };

    const normalizedInput = normalizeInput(inputValue.trim());

    return searchResults.some((category) => {
      const fullPath =
        category.path.length > 0
          ? `${category.path.join(" / ")} / ${category.name}`
          : category.name;
      return fullPath.toLowerCase() === normalizedInput;
    });
  }, [searchResults, inputValue]);

  // 构建下拉列表选项
  const dropdownOptions = React.useMemo(() => {
    const options: Array<
      SearchCategoryItem | { type: "create"; name: string; displayName: string }
    > = [];

    // 如果输入不为空且没有完全匹配，添加"创建新分类"选项
    if (inputValue.trim() && !hasExactMatch) {
      const trimmedInput = inputValue.trim();
      // 检查是否包含层级分隔符
      const hasHierarchy = trimmedInput.includes("/");
      let displayName = trimmedInput;

      // 如果包含层级，格式化显示（统一为带空格的格式）
      if (hasHierarchy) {
        const parts = trimmedInput
          .split("/")
          .map((p) => p.trim())
          .filter(Boolean);
        displayName = parts.join(" / ");
      }

      options.push({
        type: "create",
        name: displayName, // 使用格式化后的名称
        displayName: displayName,
      });
    }

    // 直接添加搜索结果，不重新排序（依赖后端的智能排序）
    options.push(...searchResults);

    return options;
  }, [inputValue, searchResults, hasExactMatch]);

  // 防抖搜索
  const performSearch = useCallback(
    async (query: string) => {
      if (!query.trim() || value) {
        setSearchResults([]);
        setIsDropdownOpen(false);
        return;
      }

      setIsSearching(true);
      try {
        const result = await searchCategories({
          query: query.trim(),
          limit: 10, // 增加限制以显示更多相关结果
        });

        if (result.success && result.data) {
          setSearchResults(result.data);
          setIsDropdownOpen(true);
          setSelectedIndex(0);
        }
      } catch (error) {
        console.error("搜索分类失败:", error);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    },
    [value],
  );

  // 输入变化时，防抖搜索
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      performSearch(inputValue);
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [inputValue, performSearch]);

  // 判断下拉框方向
  useEffect(() => {
    if (isDropdownOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const isInUpperHalf = rect.top < viewportHeight / 2;
      setDropdownDirection(isInUpperHalf ? "down" : "up");
    }
  }, [isDropdownOpen]);

  // 注释掉点击外部关闭下拉框的功能，防止用户误以为输入即保存
  // useEffect(() => {
  //   const handleClickOutside = (event: MouseEvent) => {
  //     if (
  //       containerRef.current &&
  //       !containerRef.current.contains(event.target as Node)
  //     ) {
  //       setIsDropdownOpen(false);
  //     }
  //   };

  //   if (isDropdownOpen) {
  //     document.addEventListener("mousedown", handleClickOutside);
  //   }

  //   return () => {
  //     document.removeEventListener("mousedown", handleClickOutside);
  //   };
  // }, [isDropdownOpen]);

  // 选择分类
  const handleSelectCategory = (
    category:
      | SearchCategoryItem
      | { type: "create"; name: string; displayName: string },
  ) => {
    if ("type" in category && category.type === "create") {
      // 创建新分类，格式化为带空格的格式，不传递 ID（因为是新建的）
      const formattedPath = category.name
        .split("/")
        .map((p) => p.trim())
        .filter(Boolean)
        .join(" / ");
      onChange(formattedPath, null);
    } else {
      // 选择现有分类，统一为带空格的格式，并传递分类 ID
      const searchCategory = category as SearchCategoryItem;
      const fullPath =
        searchCategory.path.length > 0
          ? `${searchCategory.path.join(" / ")} / ${searchCategory.name}`
          : searchCategory.name;
      onChange(fullPath, searchCategory.id);
    }

    // 清空输入和搜索结果
    setInputValue("");
    setSearchResults([]);
    setIsDropdownOpen(false);
    setSelectedIndex(0);
  };

  // 清除选择
  const handleClear = () => {
    onChange(null, null);
    setInputValue("");
    inputRef.current?.focus();
  };

  // 键盘导航
  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    if (!isDropdownOpen || dropdownOptions.length === 0) {
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < dropdownOptions.length - 1 ? prev + 1 : 0,
        );
        break;

      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev > 0 ? prev - 1 : dropdownOptions.length - 1,
        );
        break;

      case "Enter":
        e.preventDefault();
        if (dropdownOptions[selectedIndex]) {
          handleSelectCategory(dropdownOptions[selectedIndex]);
        }
        break;

      case "Escape":
        e.preventDefault();
        setIsDropdownOpen(false);
        setInputValue("");
        break;
    }
  };

  // 计算显示值
  const displayValue = value || inputValue;

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* 输入框 */}
      <div className="relative">
        <Input
          ref={inputRef}
          label={label}
          helperText={helperText}
          value={displayValue}
          onChange={(e) => {
            if (!value) {
              setInputValue(e.target.value);
            }
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (!value && inputValue.trim() && searchResults.length > 0) {
              setIsDropdownOpen(true);
            }
          }}
          disabled={disabled}
          readOnly={!!value}
          size={size}
        />

        {/* 清除按钮 */}
        {value && !disabled && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors z-10"
            aria-label="清除选择"
          >
            <RiCloseLine size={"1.25em"} />
          </button>
        )}
      </div>

      {/* 下拉搜索结果 */}
      <AnimatePresence>
        {isDropdownOpen && (dropdownOptions.length > 0 || isSearching) && (
          <motion.div
            initial={{
              opacity: 0,
              y: dropdownDirection === "down" ? -10 : 10,
            }}
            animate={{ opacity: 1, y: 0 }}
            exit={{
              opacity: 0,
              y: dropdownDirection === "down" ? -10 : 10,
            }}
            transition={{ duration: 0.2 }}
            className={`
              absolute z-[60] w-full
              bg-background/90 border-border border-1
              backdrop-blur-sm shadow-lg rounded
              overflow-hidden
              ${dropdownDirection === "down" ? "mt-1 top-full" : "mb-1 bottom-full"}
            `}
          >
            <AutoResizer duration={0.2} className="max-h-[300px]">
              <AutoTransition duration={0.15} type="fade">
                <div className="overflow-y-auto overflow-x-hidden">
                  {dropdownOptions.map((option, index) => {
                    const isCreateOption =
                      "type" in option && option.type === "create";
                    const isSelected = index === selectedIndex;

                    // 检查是否是层级分类
                    const hasHierarchy =
                      isCreateOption &&
                      "displayName" in option &&
                      option.displayName.includes(" / ");

                    return (
                      <motion.button
                        key={
                          isCreateOption
                            ? `create-${option.name}`
                            : (option as SearchCategoryItem).id
                        }
                        type="button"
                        onClick={() => handleSelectCategory(option)}
                        className={`
                          w-full px-4 py-2.5
                          text-left
                          flex items-center justify-between
                          transition-colors
                          ${
                            isSelected
                              ? "bg-primary text-primary-foreground"
                              : "text-foreground hover:bg-primary/20"
                          }
                        `}
                        whileHover={{ scaleX: 1.02 }}
                        transition={{ duration: 0.1 }}
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          {isCreateOption ? (
                            <>
                              <RiAddLine
                                size={"1.25em"}
                                className="flex-shrink-0"
                              />
                              <div className="flex gap-0.5 min-w-0">
                                <span className="font-medium truncate">
                                  {hasHierarchy
                                    ? "创建层级分类："
                                    : "创建新分类："}
                                </span>
                                <span
                                  className={`truncate ${
                                    isSelected ? "opacity-90" : "opacity-70"
                                  }`}
                                >
                                  {"displayName" in option
                                    ? option.displayName
                                    : option}
                                </span>
                              </div>
                            </>
                          ) : (
                            <>
                              <RiFolderLine
                                size={"1.25em"}
                                className="flex-shrink-0"
                              />
                              <span className="truncate">
                                {(option as SearchCategoryItem).path.length > 0
                                  ? `${(option as SearchCategoryItem).path.join(" / ")} / ${option.name}`
                                  : option.name}
                              </span>
                            </>
                          )}
                        </div>
                        {!isCreateOption && (
                          <span className="text-sm opacity-70 ml-2 flex-shrink-0">
                            {(option as SearchCategoryItem).postCount}
                          </span>
                        )}
                      </motion.button>
                    );
                  })}
                </div>
              </AutoTransition>
            </AutoResizer>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
