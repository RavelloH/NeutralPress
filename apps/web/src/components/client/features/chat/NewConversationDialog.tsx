"use client";

import { useCallback, useEffect, useState } from "react";
import { RiSearchLine, RiUserSearchLine } from "@remixicon/react";
import type { UserSearchResult } from "@repo/shared-types/api/message";

import UserSearchItem from "@/components/client/features/chat/UserSearchItem";
import { searchUsers } from "@/lib/client/api/message-read";
import { AutoResizer } from "@/ui/AutoResizer";
import { AutoTransition } from "@/ui/AutoTransition";
import { Dialog } from "@/ui/Dialog";
import { Input } from "@/ui/Input";
import { LoadingIndicator } from "@/ui/LoadingIndicator";

interface NewConversationDialogProps {
  open: boolean;
  onClose: () => void;
  onSelectUser: (uid: number) => void;
}

export default function NewConversationDialog({
  open,
  onClose,
  onSelectUser,
}: NewConversationDialogProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // 防抖搜索
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery.trim()) {
        performSearch(searchQuery.trim());
      } else {
        setSearchResults([]);
        setHasSearched(false);
      }
    }, 300); // 300ms 防抖

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // 执行搜索
  const performSearch = async (query: string) => {
    setIsSearching(true);
    setHasSearched(true);

    try {
      const result = await searchUsers(query);

      if (result.success && result.data) {
        setSearchResults(result.data.users);
      } else {
        setSearchResults([]);
      }
    } catch (error) {
      console.error("搜索失败:", error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  // 处理用户选择
  const handleSelectUser = useCallback(
    (uid: number) => {
      onSelectUser(uid);
    },
    [onSelectUser],
  );

  return (
    <Dialog open={open} onClose={onClose} title="发起新会话" size="md">
      <div className="flex flex-col gap-4 px-6 pb-6 pt-3">
        {/* 搜索输入框 */}
        <div className="relative">
          <Input
            label="搜索用户"
            type="text"
            helperText="输入用户 UID、用户名或昵称搜索..."
            size="sm"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            icon={<RiSearchLine size="1.2em" />}
            autoFocus
          />
        </div>

        {/* 搜索结果列表 */}
        <AutoResizer>
          {/* 加载中 */}
          <div className="max-h-[400px] overflow-y-auto">
            <AutoTransition>
              {isSearching && (
                <div
                  className="flex items-center justify-center py-12"
                  key="loading"
                >
                  <LoadingIndicator size="md" />
                </div>
              )}
              {/* 搜索结果 */}
              {!isSearching && searchResults.length > 0 && (
                <div
                  className="flex flex-col gap-2"
                  key={"search-results-" + searchResults}
                >
                  {searchResults.map((user) => (
                    <UserSearchItem
                      key={user.uid}
                      user={user}
                      onSelect={handleSelectUser}
                    />
                  ))}
                </div>
              )}
              {/* 无结果 */}
              {!isSearching && hasSearched && searchResults.length === 0 && (
                <div
                  className="flex flex-col items-center justify-center py-12 text-muted-foreground"
                  key="not-found"
                >
                  <RiUserSearchLine size="3em" className="mb-3 opacity-50" />
                  <p className="text-sm">未找到匹配的用户</p>
                </div>
              )}
              {/* 初始状态 */}
              {!isSearching && !hasSearched && (
                <div
                  className="flex flex-col items-center justify-center py-12 text-muted-foreground"
                  key="initial"
                >
                  <RiSearchLine size="3em" className="mb-3 opacity-50" />
                  <p className="text-sm">输入关键词开始搜索</p>
                  <p className="text-xs mt-2">可以搜索用户 UID、用户名或昵称</p>
                </div>
              )}
            </AutoTransition>
          </div>
        </AutoResizer>
      </div>
    </Dialog>
  );
}
