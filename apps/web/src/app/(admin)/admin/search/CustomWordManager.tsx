"use client";

import { useEffect, useState } from "react";
import { RiBook2Line, RiBookLine, RiCloseLine } from "@remixicon/react";
import type { CustomWordItem } from "@repo/shared-types/api/search";
import { AnimatePresence, motion } from "framer-motion";

import { addCustomWord, deleteCustomWord, indexPosts } from "@/actions/search";
import { GridItem } from "@/components/client/layout/RowGrid";
import { getCustomWords } from "@/lib/client/api/search-admin-read";
import { AlertDialog } from "@/ui/AlertDialog";
import { AutoResizer } from "@/ui/AutoResizer";
import { AutoTransition } from "@/ui/AutoTransition";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Input } from "@/ui/Input";
import { LoadingIndicator } from "@/ui/LoadingIndicator";
import { useToast } from "@/ui/Toast";

export default function CustomWordManager() {
  const toast = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [word, setWord] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [words, setWords] = useState<CustomWordItem[]>([]);
  const [loadingWords, setLoadingWords] = useState(true);

  // 刷新提示对话框状态
  const [refreshDialogOpen, setRefreshDialogOpen] = useState(false);
  const [affectedPosts, setAffectedPosts] = useState<
    Array<{ slug: string; title: string }>
  >([]);
  const [refreshing, setRefreshing] = useState(false);

  // 加载词典列表
  const loadWords = async () => {
    setLoadingWords(true);
    try {
      const result = await getCustomWords();
      if (result.success && result.data) {
        setWords(result.data);
      }
    } catch (error) {
      console.error("加载自定义词典失败:", error);
    } finally {
      setLoadingWords(false);
    }
  };

  useEffect(() => {
    if (dialogOpen) {
      loadWords();
    }
  }, [dialogOpen]);

  const handleAdd = async () => {
    if (!word.trim()) {
      toast.error("请输入要添加的词汇");
      return;
    }

    setIsLoading(true);
    try {
      const result = await addCustomWord({
        word: word.trim(),
      });

      if (result.success && result.data) {
        toast.success(`词汇 "${word.trim()}" 已添加到自定义词典`);
        setWord("");

        // 重新加载词典列表
        await loadWords();

        // 如果有受影响的文章，显示刷新提示
        if (result.data.affectedPosts && result.data.affectedPosts.length > 0) {
          setAffectedPosts(result.data.affectedPosts);
          setRefreshDialogOpen(true);
        }
      } else {
        toast.error(result.message || "添加失败");
      }
    } catch (error) {
      console.error("添加自定义词典失败:", error);
      toast.error("添加失败，请稍后重试");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (id: number, word: string) => {
    setIsLoading(true);
    try {
      const result = await deleteCustomWord({ id });

      if (result.success && result.data) {
        toast.success(`词汇 "${word}" 已从自定义词典中删除`);

        // 重新加载词典列表
        await loadWords();

        // 如果有受影响的文章，显示刷新提示
        if (result.data.affectedPosts && result.data.affectedPosts.length > 0) {
          setAffectedPosts(result.data.affectedPosts);
          setRefreshDialogOpen(true);
        }
      } else {
        toast.error(result.message || "删除失败");
      }
    } catch (error) {
      console.error("删除自定义词典失败:", error);
      toast.error("删除失败，请稍后重试");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefreshIndex = async () => {
    setRefreshing(true);
    try {
      const slugs = affectedPosts.map((post) => post.slug);
      const result = await indexPosts({ slugs });

      if (result.success && result.data) {
        toast.success(
          `重建索引完成：${result.data.indexed} 成功，${result.data.failed} 失败`,
        );
        setRefreshDialogOpen(false);
        setAffectedPosts([]);
      } else {
        toast.error(result.message || "重建索引失败");
      }
    } catch (error) {
      console.error("重建索引失败:", error);
      toast.error("重建索引失败，请稍后重试");
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <>
      <GridItem areas={[9, 10]} width={6} height={0.2}>
        <button
          onClick={() => setDialogOpen(true)}
          className="h-full w-full flex gap-2 items-center justify-center text-2xl hover:bg-primary hover:text-primary-foreground transition-all cursor-pointer"
        >
          <RiBookLine size="1.1em" /> 自定义词典
        </button>
      </GridItem>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="自定义词典管理"
        size="md"
      >
        <div className="px-6 py-6 space-y-6">
          <div className="space-y-4">
            <Input
              label="添加新词汇"
              value={word}
              onChange={(e) => setWord(e.target.value)}
              size="sm"
              helperText="添加后，分词器会将该词汇识别为一个完整的词"
              onKeyDown={(e) => {
                if (e.key === "Enter" && word.trim()) {
                  handleAdd();
                }
              }}
            />

            <div className="py-2 text-sm text-muted-foreground">
              自定义词典用于强制分词器将特定的专有名词或术语视为整体，添加词汇后，需要重新索引相关文章才能生效。
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
              已有词汇 ({words.length})
            </h3>
            <AutoResizer>
              <div className="min-h-24 max-h-64 overflow-y-auto">
                <AutoTransition>
                  {loadingWords ? (
                    <div
                      className="flex items-center justify-center py-12"
                      key="loading"
                    >
                      <LoadingIndicator />
                    </div>
                  ) : words.length === 0 ? (
                    <div
                      className="text-center py-12 text-muted-foreground flex flex-col items-center gap-2"
                      key="empty"
                    >
                      <RiBook2Line size="4em" className="opacity-70" />
                      暂无自定义词汇
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2 p-2" key="words-list">
                      <AnimatePresence>
                        {words.map((item) => (
                          <motion.div
                            key={item.id}
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.8 }}
                            transition={{ duration: 0.2 }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary/20 text-primary border border-primary/30 rounded-sm text-sm"
                          >
                            <span className="font-medium">{item.word}</span>
                            <motion.button
                              type="button"
                              onClick={() => handleDelete(item.id, item.word)}
                              disabled={isLoading}
                              className="ml-0.5 -mr-1 p-0.5 rounded-full hover:bg-primary/30 transition-colors focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
                              whileHover={{ scale: 1.1 }}
                              whileTap={{ scale: 0.9 }}
                              aria-label={`删除词汇 ${item.word}`}
                            >
                              <RiCloseLine size="1em" />
                            </motion.button>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  )}
                </AutoTransition>
              </div>
            </AutoResizer>
          </div>

          <div className="flex justify-end gap-4 pt-4 border-t border-foreground/10">
            <Button
              label="关闭"
              variant="ghost"
              onClick={() => setDialogOpen(false)}
              size="sm"
              disabled={isLoading}
            />
            <Button
              label="添加词汇"
              variant="primary"
              onClick={handleAdd}
              loading={isLoading}
              disabled={!word.trim()}
              size="sm"
            />
          </div>
        </div>
      </Dialog>

      {/* 索引刷新提示对话框 */}
      <AlertDialog
        open={refreshDialogOpen}
        onClose={() => {
          setRefreshDialogOpen(false);
          setAffectedPosts([]);
        }}
        onConfirm={handleRefreshIndex}
        title="需要重建索引"
        description={`检测到 ${affectedPosts.length} 篇文章包含此词汇，是否立即重建这些文章的搜索索引？\n\n受影响的文章：${affectedPosts
          .slice(0, 5)
          .map((p) => p.title)
          .join(
            "、",
          )}${affectedPosts.length > 5 ? ` 等 ${affectedPosts.length} 篇` : ""}`}
        confirmText="立即重建"
        cancelText="稍后处理"
        variant="info"
        loading={refreshing}
      />
    </>
  );
}
