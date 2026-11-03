"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { RiAddLine, RiPriceTag3Line } from "@remixicon/react";
import type { SearchTagItem } from "@repo/shared-types/api/tag";
import { AnimatePresence, motion } from "framer-motion";

import { TagChip } from "@/components/client/features/tags/TagChip";
import { searchTags } from "@/lib/client/api/tag";
import { AutoResizer } from "@/ui/AutoResizer";
import { AutoTransition } from "@/ui/AutoTransition";
import { Input } from "@/ui/Input";

export interface SelectedTag {
  name: string;
  slug: string;
  isNew: boolean; // 是否为新创建的标签
}

export interface TagInputProps {
  value: SelectedTag[];
  onChange: (tags: SelectedTag[]) => void;
  label?: string;
  placeholder?: string;
  helperText?: string;
  className?: string;
  disabled?: boolean;
  size?: "sm" | "md";
}

export function TagInput({
  value = [],
  onChange,
  label = "标签",
  helperText,
  className = "",
  disabled = false,
  size = "md",
}: TagInputProps) {
  const [inputValue, setInputValue] = useState("");
  const [searchResults, setSearchResults] = useState<SearchTagItem[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dropdownDirection, setDropdownDirection] = useState<"down" | "up">(
    "down",
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 过滤搜索结果，移除已选中的标签
  const filteredSearchResults = React.useMemo(() => {
    return searchResults.filter(
      (tag) => !value.some((selected) => selected.slug === tag.slug),
    );
  }, [searchResults, value]);

  // 判断是否有完全匹配的结果（在过滤后的结果中）
  const hasExactMatch = filteredSearchResults.some(
    (tag) => tag.name.toLowerCase() === inputValue.toLowerCase().trim(),
  );

  // 构建下拉列表选项
  const dropdownOptions = React.useMemo(() => {
    const options: Array<SearchTagItem | { type: "create"; name: string }> = [];

    // 如果输入不为空且没有完全匹配，添加"创建新标签"选项
    if (inputValue.trim() && !hasExactMatch) {
      options.push({ type: "create", name: inputValue.trim() });
    }

    // 添加过滤后的搜索结果
    options.push(...filteredSearchResults);

    return options;
  }, [inputValue, filteredSearchResults, hasExactMatch]);

  // 防抖搜索
  const performSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      setIsDropdownOpen(false);
      return;
    }

    setIsSearching(true);
    try {
      // 从 localStorage 获取 access_token
      const accessToken = localStorage.getItem("access_token");

      const result = await searchTags({
        access_token: accessToken || undefined,
        query: query.trim(),
        limit: 10,
      });

      if (result.success && result.data) {
        setSearchResults(result.data);
        setIsDropdownOpen(true);
        setSelectedIndex(0);
      }
    } catch (error) {
      console.error("搜索标签失败:", error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

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

  // 选择标签
  const handleSelectTag = (
    tag: SearchTagItem | { type: "create"; name: string },
  ) => {
    if ("type" in tag && tag.type === "create") {
      // 创建新标签
      // 客户端 slug 仅用于本地去重，服务器会自动生成真正的 slug
      const newTag: SelectedTag = {
        name: tag.name,
        slug: tag.name.toLowerCase().trim(), // 简单处理，仅用于本地标识
        isNew: true,
      };

      // 检查是否已存在（基于名称去重，不区分大小写）
      const alreadyExists = value.some(
        (t) => t.name.toLowerCase() === newTag.name.toLowerCase(),
      );

      if (!alreadyExists) {
        onChange([...value, newTag]);
      }
    } else {
      // 选择现有标签
      const searchTag = tag as SearchTagItem;
      const existingTag: SelectedTag = {
        name: searchTag.name,
        slug: searchTag.slug,
        isNew: false,
      };

      if (!value.some((t) => t.slug === existingTag.slug)) {
        onChange([...value, existingTag]);
      }
    }

    // 清除防抖定时器，避免后续执行干扰
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = null;
    }

    // 清空输入和搜索结果（注意顺序：先关闭下拉框，避免防抖冲突）
    setIsDropdownOpen(false);
    setSearchResults([]);
    setSelectedIndex(0);
    setInputValue("");

    // 重新聚焦输入框
    inputRef.current?.focus();
  };

  // 移除标签
  const handleRemoveTag = (slug: string) => {
    onChange(value.filter((tag) => tag.slug !== slug));
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
          handleSelectTag(dropdownOptions[selectedIndex]);
        }
        break;

      case "Escape":
        e.preventDefault();
        setIsDropdownOpen(false);
        setInputValue("");
        break;
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* 输入框 */}
      <Input
        ref={inputRef}
        label={label}
        helperText={helperText}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (inputValue.trim() && searchResults.length > 0) {
            setIsDropdownOpen(true);
          }
        }}
        disabled={disabled}
        size={size}
        labelAlwaysFloating={value.length > 0}
      />

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

                    return (
                      <motion.button
                        key={
                          isCreateOption
                            ? `create-${option.name}`
                            : (option as SearchTagItem).slug
                        }
                        type="button"
                        onClick={() => handleSelectTag(option)}
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
                              <span className="font-medium truncate">
                                创建新标签 &quot;{option.name}&quot;
                              </span>
                            </>
                          ) : (
                            <>
                              <RiPriceTag3Line
                                size={"1.25em"}
                                className="flex-shrink-0"
                              />
                              <span className="truncate">
                                {option.name}
                                <span className="text-sm opacity-70 ml-1">
                                  ({(option as SearchTagItem).slug})
                                </span>
                              </span>
                            </>
                          )}
                        </div>
                        {!isCreateOption && (
                          <span className="text-sm opacity-70 ml-2 flex-shrink-0">
                            {(option as SearchTagItem).postCount}
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

      {/* 已选标签 */}
      {value.length > 0 && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="mt-3 flex flex-wrap gap-2"
        >
          <AnimatePresence>
            {value.map((tag) => (
              <TagChip
                key={tag.slug}
                name={tag.name}
                slug={tag.slug}
                isNew={tag.isNew}
                onRemove={() => handleRemoveTag(tag.slug)}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}
