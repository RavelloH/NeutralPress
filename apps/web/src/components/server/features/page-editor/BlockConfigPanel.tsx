import React, { useEffect, useState } from "react";
import {
  RiDeleteBinLine,
  RiFileCopyLine,
  RiQuestionLine,
  RiRefreshLine,
  RiShareForward2Line,
} from "@remixicon/react";
import { codeToHtml } from "shiki";

import type { ResolvedBlock } from "@/blocks/core/definition";
import { getBlockFormConfig } from "@/blocks/core/registry";
import type {
  FieldConfig,
  ImageArrayFieldConfig,
  SelectFieldConfig,
} from "@/blocks/core/types/field-config";
import type { BlockFormConfig } from "@/blocks/core/types/field-config";
import MediaSelector from "@/components/client/features/media/MediaSelector";
import Link from "@/components/ui/Link";
import { useConfig } from "@/context/ConfigContext";
import type { ConfigType } from "@/data/default-configs";
import { getAllPlaceholders } from "@/lib/client/api/page-read";
import { AlertDialog } from "@/ui/AlertDialog";
import { AutoResizer } from "@/ui/AutoResizer";
import { AutoTransition } from "@/ui/AutoTransition";
import { Button } from "@/ui/Button";
import Clickable from "@/ui/Clickable";
import { Dialog } from "@/ui/Dialog";
import { Input } from "@/ui/Input";
import { LoadingIndicator } from "@/ui/LoadingIndicator";
import { Select } from "@/ui/Select";
import { Switch } from "@/ui/Switch";
import { Table, type TableColumn } from "@/ui/Table";
import { useToast } from "@/ui/Toast";

const UNSAFE_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

function isUnsafePathSegment(segment: string): boolean {
  return UNSAFE_PATH_SEGMENTS.has(segment);
}

function isUnsafeNestedPath(path: string): boolean {
  return path.split(".").some(isUnsafePathSegment);
}

// Helper to safe access nested objects
const get = (obj: unknown, path: string, def?: unknown) => {
  if (!obj || typeof obj !== "object") {
    return def;
  }

  const keys = path.split(".");
  let result: unknown = obj;

  for (const key of keys) {
    if (
      result &&
      typeof result === "object" &&
      key in (result as Record<string, unknown>)
    ) {
      result = (result as Record<string, unknown>)[key];
    } else {
      return def;
    }
  }

  return result !== undefined ? result : def;
};

// Helper to set nested objects (immutable)
const set = (obj: unknown, path: string, value: unknown) => {
  const keys = path.split(".");
  if (keys.length === 0 || isUnsafeNestedPath(path)) {
    return JSON.parse(JSON.stringify(obj || {}));
  }

  const newObj = JSON.parse(JSON.stringify(obj || {})) as Record<
    string,
    unknown
  >;
  let current: Record<string, unknown> = newObj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]!;
    if (key === "__proto__" || key === "prototype" || key === "constructor") {
      return newObj;
    }
    // 如果中间路径不存在或者是非对象值，创建新对象
    if (
      !current[key] ||
      typeof current[key] !== "object" ||
      Array.isArray(current[key])
    ) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }

  const finalKey = keys[keys.length - 1]!;
  if (
    finalKey === "__proto__" ||
    finalKey === "prototype" ||
    finalKey === "constructor"
  ) {
    return newObj;
  }

  current[finalKey] = value;
  return newObj;
};

/**
 * JSON 代码高亮组件
 */
function JSONHighlight({
  json,
  shikiTheme,
}: {
  json: unknown;
  shikiTheme: ConfigType<"site.shiki.theme">;
}) {
  const [html, setHtml] = useState("");

  useEffect(() => {
    const highlightCode = async () => {
      try {
        const jsonString = JSON.stringify(json, null, 2);
        const highlighted = await codeToHtml(jsonString, {
          lang: "json",
          themes: {
            light: shikiTheme.light,
            dark: shikiTheme.dark,
          },
          defaultColor: "dark",
        });
        setHtml(highlighted);
      } catch (err) {
        console.error("Shiki error:", err);
        const jsonString = JSON.stringify(json, null, 2);
        setHtml(`${jsonString.replace(/</g, "&lt;").replace(/>/g, "&gt;")}`);
      }
    };
    highlightCode();
  }, [json, shikiTheme]);

  return (
    <div className="text-xs overflow-auto max-h-[50vh] rounded-sm bg-[#1E1E1E]">
      <div
        className="shiki p-4 min-h-full"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

/**
 * 字段渲染器组件
 * 根据字段配置动态渲染对应的输入控件
 */
// 获取字段的默认值
const getFieldValue = (val: unknown, defaultValue?: unknown): unknown => {
  if (val === null || val === undefined) return defaultValue;
  return val;
};

// 对于 text/textarea/number 类型，转换为字符串显示
const getDisplayValue = (val: unknown): string => {
  if (val === null || val === undefined) return "";
  if (typeof val === "object") return "";
  return String(val);
};

// number 字段失焦后的兜底值：优先使用合法默认值，否则回退 0
const getNumberFallback = (defaultValue: unknown): number => {
  if (
    typeof defaultValue === "number" &&
    Number.isFinite(defaultValue) &&
    defaultValue >= 0
  ) {
    return defaultValue;
  }

  if (typeof defaultValue === "string" && defaultValue.trim() !== "") {
    const parsed = Number(defaultValue);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  return 0;
};

// 仅接受非负且有限数字；空字符串交给上层逻辑处理
const parseNonNegativeNumber = (rawValue: string): number | null => {
  const trimmed = rawValue.trim();
  if (trimmed === "") return null;

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
};

function StatefulInput({
  field,
  value,
  onChange,
}: {
  field: FieldConfig;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const currentValue = getFieldValue(value, field.defaultValue);
  const isNumberField = field.type === "number";
  const numberFallback = isNumberField
    ? getNumberFallback(field.defaultValue)
    : 0;
  const [keepNumberEmptyDisplay, setKeepNumberEmptyDisplay] =
    React.useState(false);
  const [inputValue, setInputValue] = React.useState(
    getDisplayValue(currentValue),
  );

  // 同步外部 value 变化到本地状态
  React.useEffect(() => {
    if (isNumberField && keepNumberEmptyDisplay) {
      const currentNum = parseNonNegativeNumber(getDisplayValue(currentValue));
      if (currentNum !== null && currentNum === numberFallback) {
        return;
      }
    }
    setInputValue(getDisplayValue(currentValue));
    if (keepNumberEmptyDisplay) {
      setKeepNumberEmptyDisplay(false);
    }
  }, [currentValue, isNumberField, keepNumberEmptyDisplay, numberFallback]);

  return (
    <div className="mt-6">
      <Input
        label={field.label}
        value={inputValue}
        onChange={(e) => {
          const newValue = e.target.value;
          setInputValue(newValue);

          if (isNumberField) {
            const trimmed = newValue.trim();
            if (trimmed === "") {
              // 清空时允许保持空白显示，同时数据按默认值/0 应用
              setKeepNumberEmptyDisplay(true);
              onChange(numberFallback);
              return;
            }

            // 输入中只实时应用合法的非负数字
            const num = parseNonNegativeNumber(trimmed);
            if (num !== null) {
              setKeepNumberEmptyDisplay(false);
              onChange(num);
            }
            return;
          }

          // 非 number 类型，直接提交
          onChange(newValue);
        }}
        onBlur={() => {
          // 失焦时格式化显示
          if (isNumberField) {
            const trimmed = inputValue.trim();
            if (trimmed === "") {
              // 空值是合法状态：显示保持为空，值按默认值/0 处理
              setKeepNumberEmptyDisplay(true);
              onChange(numberFallback);
              return;
            }

            const num = parseNonNegativeNumber(trimmed);
            if (num === null) {
              // 非法值重置到默认值或 0
              setKeepNumberEmptyDisplay(false);
              setInputValue(String(numberFallback));
              onChange(numberFallback);
              return;
            }

            // 合法值统一格式化显示
            setKeepNumberEmptyDisplay(false);
            setInputValue(String(num));
            onChange(num);
          }
        }}
        type={
          field.type === "number" || field.type === "date" ? field.type : "text"
        }
        step={field.type === "number" ? "any" : undefined}
        min={field.type === "number" ? 0 : undefined}
        helperText={field.placeholder ?? getDisplayValue(field.defaultValue)}
        size="sm"
        disabled={field.disabled}
      />
      {field.helperText && (
        <p className="text-xs text-muted-foreground mt-1">{field.helperText}</p>
      )}
    </div>
  );
}

/**
 * 字段渲染器组件
 * 根据字段配置动态渲染对应的输入控件
 */
function FieldRenderer({
  field,
  value,
  onChange,
}: {
  field: FieldConfig;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const handleChange = (newValue: unknown) => {
    onChange(newValue);
  };

  switch (field.type) {
    case "textarea": {
      const currentValue = getFieldValue(value, field.defaultValue);
      return (
        <div className="mt-6">
          <Input
            label={field.label}
            value={getDisplayValue(currentValue)}
            onChange={(e) => handleChange(e.target.value)}
            rows={3}
            helperText={
              field.placeholder ?? getDisplayValue(field.defaultValue)
            }
            size="sm"
            disabled={field.disabled}
          />
          {field.helperText && (
            <p className="text-xs text-muted-foreground mt-1">
              {field.helperText}
            </p>
          )}
        </div>
      );
    }

    case "text":
    case "number":
    case "date": {
      return (
        <StatefulInput field={field} value={value} onChange={handleChange} />
      );
    }

    case "array": {
      // 数组类型：使用 textarea，每行一个元素
      const arrayValue: unknown[] = Array.isArray(value)
        ? value
        : ((field.defaultValue as unknown[]) ?? []);
      const strValue = arrayValue.join("\n");
      return (
        <Input
          label={field.label}
          value={strValue}
          onChange={(e) => {
            const newArray = e.target.value.split("\n");
            handleChange(newArray);
          }}
          rows={4}
          helperText={field.placeholder}
          size="sm"
          disabled={field.disabled}
        />
      );
    }

    case "select": {
      const selectField = field as SelectFieldConfig;
      const currentValue = getFieldValue(value, field.defaultValue) ?? "";
      return (
        <div className="mt-6">
          <label className="text-foreground mb-2 block">{field.label}</label>
          <Select
            value={String(currentValue)}
            onChange={(val) => handleChange(val)}
            options={selectField.options}
            placeholder={field.placeholder || "请选择"}
            size="sm"
            disabled={field.disabled}
            className="w-full"
          />
          {field.helperText && (
            <p className="text-xs text-muted-foreground mt-1">
              {field.helperText}
            </p>
          )}
        </div>
      );
    }

    case "toggle": {
      const currentValue = value ?? field.defaultValue;
      return (
        <div className="mt-6 flex flex-col gap-3">
          <Switch
            label={field.label}
            checked={Boolean(currentValue)}
            onCheckedChange={handleChange}
            disabled={field.disabled}
            size="sm"
          />
          {field.helperText && (
            <p className="text-xs text-muted-foreground">{field.helperText}</p>
          )}
        </div>
      );
    }

    case "image": {
      const currentValue = value ?? field.defaultValue ?? "";
      return (
        <div className="mt-6">
          <MediaSelector
            label={field.label}
            value={String(currentValue)}
            onChange={handleChange}
            helperText={field.helperText}
          />
        </div>
      );
    }

    case "imageArray": {
      const arrayField = field as ImageArrayFieldConfig;
      const arrayValue: string[] = Array.isArray(value)
        ? value
        : ((arrayField.defaultValue as string[]) ?? []);
      return (
        <div className="mt-6">
          <MediaSelector
            label={field.label}
            value={arrayValue}
            onChange={handleChange}
            multiple
            helperText={field.helperText}
            maxCount={arrayField.maxCount}
          />
        </div>
      );
    }

    default: {
      const _exhaustiveCheck: never = field;
      return (
        <div className="text-xs text-muted-foreground">
          不支持的字段类型: {(field as FieldConfig).type}
        </div>
      );
    }
  }
}

export default function BlockConfigPanel({
  block,
  onUpdate,
  onRefreshData,
  onDelete,
}: {
  block: ResolvedBlock | null;
  onUpdate: (updates: Partial<ResolvedBlock>) => void;
  onRefreshData?: () => Promise<void>;
  onDelete?: () => void;
}) {
  const [formConfig, setFormConfig] = useState<BlockFormConfig | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // 变量占位符 Dialog 状态
  const [showPlaceholderDialog, setShowPlaceholderDialog] = useState(false);
  const [placeholders, setPlaceholders] = useState<
    { name: string; description: string; value: string; params?: string }[]
  >([]);
  const [loadingPlaceholders, setLoadingPlaceholders] = useState(false);

  // 导出 Dialog 状态
  const [showExportDialog, setShowExportDialog] = useState(false);

  // 滚动遮罩状态
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const [showTopGradient, setShowTopGradient] = useState(false);
  const [showBottomGradient, setShowBottomGradient] = useState(false);

  // 使用 ref 跟踪之前的 block 类型，避免不必要的重新加载
  const prevBlockTypeRef = React.useRef<string | null>(null);

  const toast = useToast();
  const shikiTheme = useConfig("site.shiki.theme");

  // 检查滚动状态
  const checkScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;

    // 顶部渐变：距离顶部超过 10px 时显示
    setShowTopGradient(scrollTop > 10);

    // 底部渐变：距离底部超过 10px 且内容确实溢出时显示
    const isNearBottom = scrollTop >= scrollHeight - clientHeight - 10;
    setShowBottomGradient(!isNearBottom && scrollHeight > clientHeight);
  };

  // 监听 block 和 formConfig 变化，更新滚动状态
  useEffect(() => {
    // 延迟执行以确保渲染完成
    const timer = setTimeout(checkScroll, 100);
    return () => clearTimeout(timer);
  }, [block, formConfig]);

  // 异步加载表单配置
  useEffect(() => {
    if (!block) {
      setFormConfig(null);
      prevBlockTypeRef.current = null;
      return;
    }

    const currentBlockType = block.block || null;

    // 只有当 block 类型变化时才重新加载配置
    if (currentBlockType === prevBlockTypeRef.current) {
      return;
    }

    prevBlockTypeRef.current = currentBlockType;

    setIsLoading(true);
    getBlockFormConfig(currentBlockType || "")
      .then((config) => {
        setFormConfig(config);
      })
      .catch((error) => {
        console.error("Failed to load block form config:", error);
        setFormConfig(null);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [block]);

  // 处理刷新数据
  const handleRefreshData = async () => {
    if (!onRefreshData) return;
    setIsRefreshing(true);
    try {
      await onRefreshData();
      setHasUnsavedChanges(false);
    } finally {
      setIsRefreshing(false);
    }
  };

  // 处理删除确认
  const handleDeleteConfirm = () => {
    setShowDeleteDialog(true);
  };

  // 打开变量占位符面板
  const handleOpenPlaceholders = async () => {
    setShowPlaceholderDialog(true);
    setLoadingPlaceholders(true);
    try {
      const response = await getAllPlaceholders();
      if (response.success && response.data) {
        setPlaceholders(response.data);
      }
    } catch (error) {
      console.error("Failed to load placeholders:", error);
    } finally {
      setLoadingPlaceholders(false);
    }
  };

  // 打开导出面板
  const handleOpenExport = () => {
    if (!block) return;
    setShowExportDialog(true);
  };

  // 处理复制
  const handleCopy = () => {
    if (!block) return;
    const jsonString = JSON.stringify(
      { ...block, runtime: undefined },
      null,
      2,
    );
    navigator.clipboard.writeText(jsonString).then(() => {
      toast.success("JSON 已复制到剪贴板");
    });
  };

  // 监听滚动事件更新渐变遮罩
  const handleScroll = (_e: React.UIEvent<HTMLDivElement>) => {
    checkScroll();
  };

  const handleContentChange = (path: string, value: unknown) => {
    if (!block) return;
    const newContent = set(block.content, path, value);
    setHasUnsavedChanges(true);
    onUpdate({ content: newContent });
  };

  const handleMetaChange = (field: string, value: string) => {
    if (!block) return;
    onUpdate({ [field]: value } as Partial<ResolvedBlock>);
  };

  // 检查字段是否满足显示条件
  const checkFieldCondition = (field: FieldConfig): boolean => {
    if (!field.condition || !block?.content) return true;

    const { condition } = field;
    const content = block.content as Record<string, unknown>;

    // 用于标识字段不存在的特殊值（用于条件检查）
    const MISSING_FIELD = "@@_MISSING_FIELD_@@";

    // 检查 AND 条件：所有条件都必须满足
    if (condition.and && condition.and.length > 0) {
      const andMet = condition.and.every((cond) => {
        const fieldValue = get(content, cond.field, MISSING_FIELD);
        return fieldValue === cond.value;
      });
      if (!andMet) return false;
    }

    // 检查 OR 条件：任一条件满足即可
    if (condition.or && condition.or.length > 0) {
      const orMet = condition.or.some((cond) => {
        const fieldValue = get(content, cond.field, MISSING_FIELD);
        return fieldValue === cond.value;
      });
      if (!orMet) return false;
    }

    // 检查 NOT 条件：所有条件都必须不满足
    // 特殊处理：如果使用特殊值 @@_MISSING_FIELD_@@，则要求字段必须存在（不为 undefined/null）
    if (condition.not && condition.not.length > 0) {
      const notMet = condition.not.every((cond) => {
        const fieldValue = get(content, cond.field, MISSING_FIELD);
        // 如果条件值是特殊占位符，则要求字段必须存在且有非空值
        if (cond.value === MISSING_FIELD) {
          return (
            fieldValue !== MISSING_FIELD &&
            fieldValue !== "" &&
            fieldValue !== null &&
            fieldValue !== undefined
          );
        }
        return fieldValue !== cond.value;
      });
      if (!notMet) return false;
    }

    return true;
  };

  // Placeholder Table Columns
  const placeholderColumns: TableColumn<{
    name: string;
    description: string;
    value: string;
    params?: string;
  }>[] = [
    {
      key: "name",
      title: "占位符",
      dataIndex: "name",
      width: "25%",
      mono: true,
      render: (val) => (
        <span className="text-primary font-medium">
          {val as React.ReactNode}
        </span>
      ),
    },
    {
      key: "description",
      title: "描述",
      dataIndex: "description",
      width: "20%",
    },
    {
      key: "params",
      title: "参数",
      dataIndex: "params",
      width: "5%",
      render: (val) =>
        val ? (
          <span className="text-xs text-muted-foreground">
            {val as React.ReactNode}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground/50">-</span>
        ),
    },
    {
      key: "value",
      title: "当前值",
      dataIndex: "value",
      width: "25%",
      align: "right",
      mono: true,
    },
  ];

  // 占位符分组定义
  type PlaceholderGroup = {
    title: string;
    description: string;
    placeholders: typeof placeholders;
  };

  // 根据占位符名称推断分组（不依赖 PLACEHOLDER_REGISTRY）
  const getPlaceholderGroups = (): PlaceholderGroup[] => {
    // 定义分组
    const groups: PlaceholderGroup[] = [
      {
        title: "全局统计",
        description: "无需特定上下文，可在任何页面使用。显示全局统计数据。",
        placeholders: [],
      },
      {
        title: "分类相关",
        description:
          "与分类相关的占位符。`{categories}` 显示全局分类总数；`{category*}` 系列会自动从当前页面 URL 获取 slug，也可显式指定参数如 `{category|slug=tech}`。",
        placeholders: [],
      },
      {
        title: "标签相关",
        description:
          "与标签相关的占位符。`{tags}` 显示全局标签总数；`{tag*}` 系列会自动从当前页面 URL 获取 slug，也可显式指定参数如 `{tag|slug=javascript}`。",
        placeholders: [],
      },
      {
        title: "文章列表相关",
        description:
          "文章列表页专用的占位符。包括文章链接列表、首次发布日期，以及文章列表页的分页信息（`{postsList*}` 系列）。",
        placeholders: [],
      },
      {
        title: "页面信息",
        description:
          "需要显式指定参数的占位符。例如：`{pageInfo|page=category-index}` 显示「分类列表」。支持的 page 值：category-index, category-detail, tag-index, tag-detail, posts-index, normal。",
        placeholders: [],
      },
    ];

    // 将占位符分配到对应分组
    for (const placeholder of placeholders) {
      // 提取占位符名称（去掉花括号）
      const placeholderName = placeholder.name.replace(/[{}]/g, "");

      // 根据占位符名称判断分组
      let assigned = false;

      // 全局统计占位符
      if (
        placeholderName === "posts" ||
        placeholderName === "projects" ||
        placeholderName === "lastPublishDays"
      ) {
        groups[0]?.placeholders.push(placeholder);
        assigned = true;
      }
      // 分类相关占位符（包括 category 前缀的所有字段）
      else if (
        placeholderName === "categories" ||
        placeholderName === "rootCategories" ||
        placeholderName === "childCategories" ||
        placeholderName === "categoriesList" ||
        placeholderName.startsWith("category")
      ) {
        groups[1]?.placeholders.push(placeholder);
        assigned = true;
      }
      // 标签相关占位符（包括 tag 前缀的所有字段）
      else if (
        placeholderName === "tags" ||
        placeholderName === "tagsList" ||
        placeholderName.startsWith("tag")
      ) {
        groups[2]?.placeholders.push(placeholder);
        assigned = true;
      }
      // 分页信息占位符（postsList* 和 firstPublishAt）
      else if (
        placeholderName === "firstPublishAt" ||
        placeholderName.startsWith("postsList")
      ) {
        groups[3]?.placeholders.push(placeholder);
        assigned = true;
      }
      // 页面信息占位符
      else if (placeholderName === "pageInfo") {
        groups[4]?.placeholders.push(placeholder);
        assigned = true;
      }

      // 如果仍未分配，放入全局统计分组
      if (!assigned) {
        groups[0]?.placeholders.push(placeholder);
      }
    }

    return groups;
  };

  return (
    <div className="w-full h-full flex flex-col pr-1">
      <div className="space-y-4 pb-4">
        <div className="flex items-center justify-between py-4 border-b border-border">
          <h3 className="text-lg">编辑区块</h3>
          <div className="flex items-center gap-2">
            {block && onRefreshData && (
              <Button
                variant={hasUnsavedChanges ? "primary" : "ghost"}
                size="sm"
                icon={<RiRefreshLine size={16} />}
                label="更新数据"
                onClick={handleRefreshData}
                loading={isRefreshing}
                disabled={isLoading}
              />
            )}
            {block && onDelete && (
              <Button
                variant="danger"
                size="sm"
                icon={<RiDeleteBinLine size={16} />}
                label="删除"
                onClick={handleDeleteConfirm}
                disabled={isLoading || isRefreshing}
              />
            )}
          </div>
        </div>
      </div>

      <AutoTransition className="flex-1 h-full overflow-hidden">
        {!block ? (
          <div
            key="no-block"
            className="w-full h-full flex flex-col items-center justify-center text-muted-foreground text-sm p-6"
          >
            选择一个区块以编辑属性
          </div>
        ) : isLoading ? (
          <div
            key="loading"
            className="w-full h-full flex flex-col items-center justify-center text-muted-foreground text-sm p-6"
          >
            <LoadingIndicator />
          </div>
        ) : !formConfig ? (
          <div
            key="no-config"
            className="w-full h-full flex flex-col items-center justify-center text-muted-foreground text-sm p-6"
          >
            <p>未找到 &quot;{block.block}&quot; 的配置</p>
            <p className="text-xs mt-2">
              请在该 block 的 schema 文件中定义表单配置
            </p>
          </div>
        ) : (
          <div key={block.id} className="relative h-full">
            {/* 顶部渐变遮罩 */}
            <div
              className={`absolute top-0 left-0 right-0 h-6 bg-gradient-to-b from-background via-background/80 to-transparent pointer-events-none z-10 transition-opacity duration-300 ${
                showTopGradient ? "opacity-100" : "opacity-0"
              }`}
            />

            {/* 底部渐变遮罩 */}
            <div
              className={`absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-background via-background/80 to-transparent pointer-events-none z-10 transition-opacity duration-300 ${
                showBottomGradient ? "opacity-100" : "opacity-0"
              }`}
            />

            <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className="h-full overflow-y-auto space-y-4 pb-4 scrollbar-hide"
            >
              {/* 区块信息 */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
                  区块信息
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm text-muted-foreground">
                      区块类型
                    </label>
                    <p className="text-sm font-mono">{formConfig.blockType}</p>
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground">
                      区块名称
                    </label>
                    <p className="text-sm font-mono">
                      {formConfig.displayName}
                    </p>
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground">
                      区块作者
                    </label>
                    <p className="text-sm font-mono">
                      {formConfig.author ? (
                        formConfig.author.url ? (
                          <Link
                            presets={["hover-underline"]}
                            href={formConfig.author.url}
                          >
                            @{formConfig.author.name}
                          </Link>
                        ) : (
                          "@" + formConfig.author.name
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
                      {formConfig.theme ? (
                        formConfig.theme.url ? (
                          <Link
                            presets={["hover-underline"]}
                            href={formConfig.theme.url}
                          >
                            {formConfig.theme.name}
                          </Link>
                        ) : (
                          formConfig.theme.name
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
                      {formConfig.fields.length}个配置项，
                      {formConfig.groups?.length
                        ? `${formConfig.groups.length}个分组`
                        : "未分组"}
                    </p>
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground">
                      性能影响
                    </label>
                    <p className="text-sm">
                      {formConfig.actions?.db || 0} DB 查询，
                      {formConfig.actions?.config || 0} 配置查询
                    </p>
                  </div>
                </div>
                <div className="grid gap-4">
                  <div>
                    <label className="text-sm text-muted-foreground">
                      区块描述
                    </label>
                    <p className="text-sm font-mono whitespace-pre-wrap">
                      {formConfig.description}
                    </p>
                  </div>
                </div>
                <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 py-2">
                  区块配置
                </h3>
              </div>

              <div className="space-y-6">
                {/* 通用元数据 */}
                <div className="space-y-4">
                  <Input
                    label="备注"
                    value={block.description || ""}
                    onChange={(e) =>
                      handleMetaChange("description", e.target.value)
                    }
                    size="sm"
                    helperText="用于在编辑器中标识此区块"
                  />
                </div>

                <hr className="border-border" />

                {/* 按分组渲染字段 */}
                {formConfig.groups && formConfig.groups.length > 0 ? (
                  <>
                    {formConfig.groups.map((group, groupIndex) => (
                      <React.Fragment key={groupIndex}>
                        <div className="space-y-4">
                          <div className="space-y-1">
                            <label className="text-sm font-medium">
                              {group.title}
                            </label>
                            {group.description && (
                              <p className="text-xs text-muted-foreground">
                                {group.description}
                              </p>
                            )}
                          </div>
                          {formConfig.fields
                            .filter(
                              (field) =>
                                group.fields.includes(field.path) &&
                                checkFieldCondition(field),
                            )
                            .map((field, fieldIndex) => {
                              const value = get(block.content, field.path);
                              return (
                                <FieldRenderer
                                  key={`${groupIndex}-${fieldIndex}`}
                                  field={field}
                                  value={value}
                                  onChange={(newValue) =>
                                    handleContentChange(field.path, newValue)
                                  }
                                />
                              );
                            })}
                        </div>
                        {groupIndex < formConfig.groups!.length - 1 && (
                          <hr className="border-border" />
                        )}
                      </React.Fragment>
                    ))}

                    {/* 渲染未分组的字段 */}
                    {(() => {
                      // 收集所有分组中包含的字段路径
                      const groupedFieldPaths = new Set<string>();
                      formConfig.groups?.forEach((group) => {
                        group.fields.forEach((fieldPath) => {
                          groupedFieldPaths.add(fieldPath);
                        });
                      });

                      // 找出未分组的字段
                      const ungroupedFields = formConfig.fields.filter(
                        (field) =>
                          !groupedFieldPaths.has(field.path) &&
                          checkFieldCondition(field),
                      );

                      if (ungroupedFields.length > 0) {
                        return (
                          <>
                            <hr className="border-border" />
                            <div className="space-y-4">
                              <div className="space-y-1">
                                <label className="text-sm font-medium">
                                  其他配置
                                </label>
                                <p className="text-xs text-muted-foreground">
                                  未分组的配置项
                                </p>
                              </div>
                              {ungroupedFields.map((field, index) => {
                                const value = get(block.content, field.path);
                                return (
                                  <FieldRenderer
                                    key={`ungrouped-${index}`}
                                    field={field}
                                    value={value}
                                    onChange={(newValue) =>
                                      handleContentChange(field.path, newValue)
                                    }
                                  />
                                );
                              })}
                            </div>
                          </>
                        );
                      }
                      return null;
                    })()}
                  </>
                ) : (
                  /* 无分组时直接渲染所有字段 */
                  <div className="space-y-4">
                    {formConfig.fields
                      .filter(checkFieldCondition)
                      .map((field, index) => {
                        const value = get(block.content, field.path);
                        return (
                          <FieldRenderer
                            key={index}
                            field={field}
                            value={value}
                            onChange={(newValue) =>
                              handleContentChange(field.path, newValue)
                            }
                          />
                        );
                      })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </AutoTransition>

      <div className="pt-4 mt-2 border-t border-border text-xs text-muted-foreground shrink-0 flex items-center justify-between">
        <Clickable
          onClick={handleOpenPlaceholders}
          className="flex gap-1 items-center hover:text-foreground transition-colors"
        >
          <RiQuestionLine size="1em" />
          变量占位符
        </Clickable>
        <Clickable
          onClick={handleOpenExport}
          className="flex gap-1 items-center text-primary hover:text-primary/80 transition-colors"
          disabled={!block}
        >
          导出 <RiShareForward2Line size="1em" />
        </Clickable>
      </div>

      {/* 删除确认对话框 */}
      {block && onDelete && (
        <AlertDialog
          open={showDeleteDialog}
          onClose={() => setShowDeleteDialog(false)}
          onConfirm={() => {
            setShowDeleteDialog(false);
            onDelete();
          }}
          title="删除区块"
          description={`确定要删除此区块吗？此操作无法撤销。\n\n区块类型：${block.block || "未知"}\n备注：${block.description || "无"}`}
          confirmText="确认删除"
          cancelText="取消"
          variant="danger"
        />
      )}

      {/* 变量占位符对话框 */}
      <Dialog
        open={showPlaceholderDialog}
        onClose={() => setShowPlaceholderDialog(false)}
        title="变量占位符"
        size="lg"
      >
        <div className="p-4">
          <AutoResizer>
            <AutoTransition>
              {loadingPlaceholders ? (
                <div className="py-20 flex justify-center" key="loading">
                  <LoadingIndicator />
                </div>
              ) : (
                <div className="space-y-6" key="placeholders">
                  {getPlaceholderGroups().map((group, groupIndex) => (
                    <div key={groupIndex} className="space-y-3">
                      {/* 分组标题 */}
                      <div className="space-y-1">
                        <h4 className="text-sm font-medium text-foreground">
                          {group.title}
                        </h4>
                        <p className="text-xs text-muted-foreground">
                          {group.description}
                        </p>
                      </div>

                      {/* 分组表格 */}
                      {group.placeholders.length > 0 ? (
                        <Table
                          columns={placeholderColumns}
                          data={group.placeholders}
                          striped
                          hoverable
                          onRowClick={(e) => {
                            navigator.clipboard.writeText(e.name as string);
                            toast.success("已复制占位符到剪贴板");
                          }}
                          size="sm"
                          bordered
                          emptyText="暂无可用占位符"
                        />
                      ) : (
                        <div className="text-xs text-muted-foreground text-center py-4 border border-dashed border-border rounded">
                          该分类暂无可用占位符
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </AutoTransition>
          </AutoResizer>
          <div className="mt-4 text-xs text-muted-foreground space-y-1">
            <p>
              在文本内容中使用 {`{placeholder}`}{" "}
              格式插入动态数据。不同页面的占位符可用性不同。
            </p>
            <p>输入新的占位符后，需点击&quot;更新数据&quot;才能生效。</p>
          </div>
        </div>
      </Dialog>

      {/* 导出数据对话框 */}
      <Dialog
        open={showExportDialog}
        onClose={() => setShowExportDialog(false)}
        title="导出区块数据"
        size="md"
        className="z-100"
      >
        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              以下是当前区块的完整 JSON 数据，可用于备份或迁移。
            </p>
            <Button
              size="sm"
              icon={<RiFileCopyLine size="1em" />}
              label={"复制 JSON"}
              onClick={handleCopy}
            />
          </div>
          <AutoResizer>
            {block && (
              <JSONHighlight
                json={{ ...block, runtime: undefined }}
                shikiTheme={shikiTheme}
              />
            )}
          </AutoResizer>
        </div>
      </Dialog>
    </div>
  );
}
