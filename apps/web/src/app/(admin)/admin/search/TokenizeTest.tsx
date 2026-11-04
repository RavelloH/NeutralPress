"use client";

import { useState } from "react";
import { RiSearchLine } from "@remixicon/react";

import { GridItem } from "@/components/client/layout/RowGrid";
import { testTokenize } from "@/lib/client/api/search-admin-read";
import { AutoResizer } from "@/ui/AutoResizer";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Input } from "@/ui/Input";
import { useToast } from "@/ui/Toast";

/**
 * 格式化时间，自动选择合适的单位
 * @param microseconds 微秒
 * @returns 格式化后的时间字符串
 */
function formatDuration(microseconds: number): string {
  if (microseconds < 1000) {
    // 小于 1ms，显示微秒
    return `${microseconds}μs`;
  } else if (microseconds < 1000000) {
    // 小于 1s，显示毫秒
    const ms = (microseconds / 1000).toFixed(2);
    return `${ms}ms`;
  } else {
    // 大于等于 1s，显示秒
    const s = (microseconds / 1000000).toFixed(2);
    return `${s}s`;
  }
}

export default function TokenizeTest() {
  const toast = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [text, setText] = useState("");
  const [tokens, setTokens] = useState<string[]>([]);
  const [duration, setDuration] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(false);

  const handleTest = async () => {
    if (!text.trim()) {
      toast.error("请输入要测试的文本");
      return;
    }

    setIsLoading(true);
    try {
      const result = await testTokenize({
        text: text.trim(),
      });

      if (result.success && result.data) {
        setTokens(result.data.tokens);
        setDuration(result.data.duration);
        toast.success(
          `分词成功，共 ${result.data.count} 个词，耗时 ${formatDuration(result.data.duration)}`,
        );
      } else {
        toast.error(result.message || "分词失败");
        setTokens([]);
        setDuration(0);
      }
    } catch (error) {
      console.error("测试分词失败:", error);
      toast.error("测试分词失败，请稍后重试");
      setTokens([]);
      setDuration(0);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <GridItem areas={[7, 8]} width={6} height={0.2}>
        <button
          onClick={() => setDialogOpen(true)}
          className="h-full w-full flex gap-2 items-center justify-center text-2xl hover:bg-primary hover:text-primary-foreground transition-all cursor-pointer"
        >
          <RiSearchLine size="1.1em" /> 测试分词
        </button>
      </GridItem>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="测试分词"
        size="lg"
      >
        <div className="px-6 pb-3 pt-3 space-y-6">
          <div className="space-y-4">
            <Input
              label="输入文本"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              size="sm"
              helperText="输入测试文本，以测试分词效果。"
            />
            <Button
              label="分词测试"
              variant="primary"
              onClick={handleTest}
              loading={isLoading}
              disabled={!text.trim()}
              size="md"
              fullWidth
            />
            <p className="text-sm text-muted-foreground">
              为了节省索引空间，某些低价值词将会自动过滤。如果某些词被意外切分，请考虑添加到自定义词典中。
            </p>
          </div>
          <AutoResizer>
            {tokens.length > 0 && (
              <div className="space-y-3 pb-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium text-foreground">
                    分词结果
                  </h4>
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-muted-foreground">
                      耗时 {formatDuration(duration)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      共 {tokens.length} 个词
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 py-4 overflow-y-auto">
                  {tokens.map((token, index) => (
                    <span
                      key={`${token}-${index}`}
                      className="px-3 py-1 text-sm bg-primary/10 text-primary rounded-xs font-mono"
                    >
                      {token}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </AutoResizer>
        </div>
      </Dialog>
    </>
  );
}
