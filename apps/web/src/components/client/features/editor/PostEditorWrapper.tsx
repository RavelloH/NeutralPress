"use client";

import { useCallback, useEffect, useState } from "react";

import { createPost, updatePost } from "@/actions/post";
import { CategoryInput } from "@/components/client/features/categories/CategoryInput";
import { EditorCore } from "@/components/client/features/editor/EditorCore";
import MediaSelector from "@/components/client/features/media/MediaSelector";
import {
  getPostAccessControlLabel,
  normalizePasswordLines,
  PostAccessControlFields,
  type PostAccessFormValue,
  validatePostAccessForm,
} from "@/components/client/features/posts/PostAccessControlFields";
import PostLicensePicker from "@/components/client/features/posts/PostLicensePicker";
import type { SelectedTag } from "@/components/client/features/tags/TagInput";
import { TagInput } from "@/components/client/features/tags/TagInput";
import { useNavigateWithTransition } from "@/components/ui/Link";
import { getLatestMailDispatchOverview } from "@/lib/client/api/mail-subscription-read";
import {
  clearEditorContent,
  flushEditorContentSave,
  loadEditorContent,
  saveEditorContent,
} from "@/lib/client/editor-persistence";
import {
  fromStoredPostLicense,
  getPostLicenseSelectionLabel,
  type PostLicenseSelection,
} from "@/lib/shared/post-license";
import type {
  EditorInitialData,
  EditorMode,
  StatusBarActionConfig,
} from "@/types/editor-config";
import { Button } from "@/ui/Button";
import { Checkbox } from "@/ui/Checkbox";
import { Dialog } from "@/ui/Dialog";
import { Input } from "@/ui/Input";
import { Select } from "@/ui/Select";
import { useToast } from "@/ui/Toast";

/**
 * Post 表单数据类型
 */
interface PostFormData {
  title: string;
  slug: string;
  excerpt: string;
  status: string;
  isPinned: boolean;
  allowComments: boolean;
  accessMode: "PUBLIC" | "ROLE" | "PASSWORD";
  minRole: "USER" | "ADMIN" | "EDITOR" | "AUTHOR" | null;
  accessPasswords: string[];
  accessPasswordText: string;
  robotsIndex: boolean;
  metaDescription: string;
  metaKeywords: string;
  featuredImage: string;
  license: PostLicenseSelection;
  category: string | null;
  tags: SelectedTag[];
}

/**
 * PostEditorWrapper Props
 */
interface PostEditorWrapperProps {
  // 编辑器基础配置
  content: string;
  storageKey: string;
  isEditMode?: boolean;
  initialData?: EditorInitialData;

  // 可用的编辑器模式
  availableModes?: EditorMode[];
  defaultMode?: EditorMode;

  // 成功后重定向路径
  successRedirectPath?: string;
}

/**
 * 创建默认 Post 表单数据
 */
function createDefaultPostFormData(): PostFormData {
  return {
    title: "",
    slug: "",
    excerpt: "",
    status: "DRAFT",
    isPinned: false,
    allowComments: true,
    accessMode: "PUBLIC",
    minRole: null,
    accessPasswords: [],
    accessPasswordText: "",
    robotsIndex: true,
    metaDescription: "",
    metaKeywords: "",
    featuredImage: "",
    license: "default",
    category: null,
    tags: [],
  };
}

/**
 * 从 EditorInitialData 初始化表单数据
 */
function initializeFormData(initialData?: EditorInitialData): PostFormData {
  const defaultData = createDefaultPostFormData();

  if (!initialData) {
    return defaultData;
  }

  return {
    ...defaultData,
    title: initialData.title || "",
    slug: initialData.slug || "",
    excerpt: initialData.excerpt || "",
    status: initialData.status || "DRAFT",
    isPinned: initialData.isPinned ?? false,
    allowComments: initialData.allowComments ?? true,
    accessMode: initialData.accessMode || "PUBLIC",
    minRole: initialData.minRole ?? null,
    accessPasswords: initialData.accessPasswords || [],
    accessPasswordText: (initialData.accessPasswords || []).join("\n"),
    robotsIndex: initialData.robotsIndex ?? true,
    metaDescription: initialData.metaDescription || "",
    metaKeywords: initialData.metaKeywords || "",
    featuredImage: initialData.featuredImage || "",
    license: fromStoredPostLicense(initialData.license),
    category: initialData.categories?.[0] || null,
    tags: initialData.tags
      ? initialData.tags.map((name) => ({
          name,
          slug: name.toLowerCase().replace(/\s+/g, "-"),
          isNew: false,
        }))
      : [],
  };
}

function toPostAccessFormValue(formData: PostFormData): PostAccessFormValue {
  return {
    accessMode: formData.accessMode,
    minRole: formData.minRole,
    accessPasswords:
      formData.accessMode === "PASSWORD"
        ? normalizePasswordLines(formData.accessPasswordText)
        : formData.accessPasswords,
  };
}

/**
 * PostEditorWrapper - Post 业务逻辑包装器
 *
 * 职责：
 * - 管理 Post 特定的字段状态
 * - 渲染对话框内容
 * - 处理保存/发布逻辑
 * - 验证表单数据
 */
export function PostEditorWrapper({
  content,
  storageKey,
  isEditMode = false,
  initialData,
  availableModes = ["visual", "markdown", "mdx"],
  defaultMode = "visual",
  successRedirectPath = "/admin/posts",
}: PostEditorWrapperProps) {
  // ==================== 状态管理 ====================
  const [formData, setFormData] = useState<PostFormData>(() =>
    initializeFormData(initialData),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [mailDispatchDialogOpen, setMailDispatchDialogOpen] = useState(false);
  const [activeSubscriberCount, setActiveSubscriberCount] = useState(0);
  const [confirmAction, setConfirmAction] = useState<
    "draft" | "publish" | null
  >(null);
  const [commitMessage, _setCommitMessage] = useState("");

  const toast = useToast();
  const navigate = useNavigateWithTransition();

  const navigateToDefaultSuccessPage = useCallback(() => {
    setTimeout(() => {
      navigate(successRedirectPath);
    }, 1000);
  }, [navigate, successRedirectPath]);

  const checkMailDispatchPrompt = useCallback(async (): Promise<number> => {
    try {
      const result = await getLatestMailDispatchOverview();
      if (!result.success || !result.data) {
        return 0;
      }
      return result.data.totalActive > 0 ? result.data.totalActive : 0;
    } catch (error) {
      console.error("检查邮件分发提示失败:", error);
      return 0;
    }
  }, []);

  // ==================== 初始化表单数据 ====================
  useEffect(() => {
    if (initialData) {
      setFormData(initializeFormData(initialData));
    }
  }, [initialData]);

  // ==================== 处理表单字段变化 ====================
  const handleFieldChange = useCallback(
    (
      field: keyof PostFormData,
      value: string | boolean | string[] | SelectedTag[] | null,
    ) => {
      setFormData((prev) => ({
        ...prev,
        [field]: value,
      }));
    },
    [],
  );

  const handleEditorTitleChange = useCallback((nextTitle: string) => {
    setFormData((prev) => {
      if (prev.title === nextTitle) {
        return prev;
      }

      return {
        ...prev,
        title: nextTitle,
      };
    });
  }, []);

  // ==================== 保存详细信息 ====================
  const handleSaveDetails = async () => {
    if (!formData.title.trim()) {
      toast.error("请填写文章标题");
      return;
    }

    const accessValidationMessage = validatePostAccessForm(
      toPostAccessFormValue(formData),
    );
    if (accessValidationMessage) {
      toast.error(accessValidationMessage);
      return;
    }

    setIsSubmitting(true);
    try {
      flushEditorContentSave(storageKey);

      // 保存配置到 localStorage
      const editorData = loadEditorContent(storageKey);
      if (editorData) {
        saveEditorContent(
          editorData.content,
          { ...formData, editorType: editorData.config?.editorType },
          true,
          storageKey,
        );
      }

      toast.success("详细信息已保存");
      setDetailsDialogOpen(false);
    } catch (error) {
      console.error("保存详细信息失败:", error);
      toast.error("保存失败，请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  // ==================== 最终保存/发布操作 ====================
  const handleFinalSubmit = async () => {
    if (!formData.title.trim()) {
      toast.error("请填写文章标题");
      return;
    }

    const accessValidationMessage = validatePostAccessForm(
      toPostAccessFormValue(formData),
    );
    if (accessValidationMessage) {
      toast.error(accessValidationMessage);
      return;
    }

    setIsSubmitting(true);
    try {
      flushEditorContentSave(storageKey);

      // 创建新标签
      const newTags = formData.tags.filter((tag) => tag.isNew);
      if (newTags.length > 0) {
        const accessToken = localStorage.getItem("access_token");
        const { createTag } = await import("@/actions/tag");

        await Promise.all(
          newTags.map(async (tag) => {
            try {
              await createTag({
                access_token: accessToken || undefined,
                name: tag.name,
              });
            } catch (error) {
              console.error(`创建标签 "${tag.name}" 失败:`, error);
            }
          }),
        );
      }

      // 获取当前编辑器内容
      // 确定编辑器模式
      const editorData = loadEditorContent(storageKey);
      const editorType = editorData?.config?.editorType || "visual";
      const postMode: "MARKDOWN" | "MDX" =
        editorType === "visual" || editorType === "markdown"
          ? "MARKDOWN"
          : "MDX";

      // 构建保存数据
      const tagNames = formData.tags.map((tag) => tag.name);
      const normalizedAccessPasswords =
        formData.accessMode === "PASSWORD"
          ? normalizePasswordLines(formData.accessPasswordText)
          : [];
      const normalizedMinRole =
        formData.accessMode === "ROLE" ? formData.minRole : null;

      let result;
      if (isEditMode) {
        const updateData = {
          slug: storageKey,
          title: formData.title,
          newSlug: formData.slug !== storageKey ? formData.slug : undefined,
          content: loadEditorContent(storageKey)?.content || "",
          status: formData.status,
          categories: formData.category ? [formData.category] : undefined,
          tags: tagNames.length > 0 ? tagNames : undefined,
          excerpt: formData.excerpt || undefined,
          featuredImage: formData.featuredImage || undefined,
          license: formData.license,
          isPinned: formData.isPinned,
          allowComments: formData.allowComments,
          accessMode: formData.accessMode,
          minRole: normalizedMinRole,
          accessPasswords: normalizedAccessPasswords,
          metaDescription: formData.metaDescription || undefined,
          metaKeywords: formData.metaKeywords || undefined,
          robotsIndex: formData.robotsIndex,
          postMode,
          commitMessage: commitMessage || undefined,
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        result = await updatePost(updateData as any, {});
      } else {
        const createData = {
          title: formData.title,
          slug: formData.slug,
          content: loadEditorContent(storageKey)?.content || "",
          status: confirmAction === "publish" ? "PUBLISHED" : "DRAFT",
          categories: formData.category ? [formData.category] : undefined,
          tags: tagNames.length > 0 ? tagNames : undefined,
          excerpt: formData.excerpt || undefined,
          featuredImage: formData.featuredImage || undefined,
          license: formData.license,
          isPinned: formData.isPinned,
          allowComments: formData.allowComments,
          accessMode: formData.accessMode,
          minRole: normalizedMinRole,
          accessPasswords: normalizedAccessPasswords,
          metaDescription: formData.metaDescription || undefined,
          metaKeywords: formData.metaKeywords || undefined,
          robotsIndex: formData.robotsIndex,
          postMode,
          commitMessage: commitMessage || undefined,
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        result = await createPost(createData as any, {});
      }

      // 处理结果
      let response;
      if (result instanceof Response) {
        response = await result.json();
      } else {
        response = result;
      }

      if (response.success) {
        const isPublishSuccess = isEditMode
          ? initialData?.status !== "PUBLISHED" &&
            formData.status === "PUBLISHED"
          : confirmAction === "publish";

        if (isEditMode) {
          const statusText =
            formData.status === "PUBLISHED"
              ? "已发布"
              : formData.status === "ARCHIVED"
                ? "已归档"
                : "草稿";
          toast.success(
            `文章已保存为${statusText}`,
            commitMessage ? `提交信息：${commitMessage}` : undefined,
          );
        } else {
          toast.success(
            confirmAction === "publish" ? "文章已发布" : "草稿已保存",
            commitMessage ? `提交信息：${commitMessage}` : undefined,
          );
        }

        // 清除草稿
        clearEditorContent(storageKey);
        setConfirmDialogOpen(false);

        if (isPublishSuccess) {
          const activeCount = await checkMailDispatchPrompt();
          if (activeCount > 0) {
            setActiveSubscriberCount(activeCount);
            setMailDispatchDialogOpen(true);
            return;
          }
        }

        navigateToDefaultSuccessPage();
      } else {
        toast.error(response.message || "操作失败，请稍后重试");
      }
    } catch (error) {
      console.error("保存失败:", error);
      toast.error("操作失败，请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  // ==================== 状态栏操作按钮配置 ====================
  const statusBarActions: StatusBarActionConfig[] = [
    {
      id: "details",
      label: isEditMode ? "更改详细信息" : "设置详细信息",
      variant: "ghost",
      onClick: () => {
        setDetailsDialogOpen(true);
      },
    },
    ...(isEditMode
      ? [
          {
            id: "save",
            label: "保存",
            variant: "primary" as const,
            onClick: () => {
              setConfirmAction("draft");
              setConfirmDialogOpen(true);
            },
          },
        ]
      : [
          {
            id: "save-draft",
            label: "保存为草稿",
            variant: "ghost" as const,
            onClick: () => {
              setConfirmAction("draft");
              setConfirmDialogOpen(true);
            },
          },
          {
            id: "publish",
            label: "发布",
            variant: "primary" as const,
            onClick: () => {
              setConfirmAction("publish");
              setConfirmDialogOpen(true);
            },
          },
        ]),
  ];

  // ==================== 渲染详细信息对话框内容 ====================
  const renderDetailsDialogContent = () => (
    <div className="px-6 py-6 space-y-6">
      {/* 基本信息 */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
          基本信息
        </h3>
        <div className="grid grid-cols-2 gap-6">
          <Input
            label="标题"
            value={formData.title}
            onChange={(e) => handleFieldChange("title", e.target.value)}
            required
            size="sm"
          />
          <Input
            label="Slug"
            value={formData.slug}
            onChange={(e) => handleFieldChange("slug", e.target.value)}
            size="sm"
            helperText="URL 路径，例如：my-first-post。留空将从标题自动生成"
          />
          <Input
            label="摘要"
            value={formData.excerpt}
            onChange={(e) => handleFieldChange("excerpt", e.target.value)}
            rows={3}
            size="sm"
            className="col-span-2"
          />
        </div>
      </div>

      {/* 分类与标签 */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
          分类与标签
        </h3>
        <div className="grid grid-cols-1 gap-6">
          <CategoryInput
            label="分类"
            value={formData.category}
            onChange={(category) => handleFieldChange("category", category)}
            size="sm"
          />
          <TagInput
            label="标签"
            value={formData.tags}
            onChange={(tags) => handleFieldChange("tags", tags)}
            helperText="输入关键词搜索现有标签，或直接创建新标签"
            size="sm"
          />
        </div>
      </div>

      {/* 发布设置 */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
          发布设置
        </h3>
        <div className="space-y-3">
          {isEditMode && (
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-2">
                文章状态
              </label>
              <Select
                value={formData.status}
                onChange={(value) => handleFieldChange("status", String(value))}
                options={[
                  { value: "DRAFT", label: "草稿" },
                  { value: "PUBLISHED", label: "已发布" },
                  { value: "ARCHIVED", label: "已归档" },
                ]}
                size="sm"
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-6">
            <Checkbox
              label="置顶文章"
              checked={formData.isPinned}
              onChange={(e) => handleFieldChange("isPinned", e.target.checked)}
            />
            <Checkbox
              label="允许评论"
              checked={formData.allowComments}
              onChange={(e) =>
                handleFieldChange("allowComments", e.target.checked)
              }
            />
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
          访问控制
        </h3>
        <PostAccessControlFields
          value={toPostAccessFormValue(formData)}
          onChange={(nextValue) =>
            setFormData((prev) => ({
              ...prev,
              ...nextValue,
            }))
          }
          passwordText={formData.accessPasswordText}
          onPasswordTextChange={(nextValue) =>
            setFormData((prev) => ({
              ...prev,
              accessPasswordText: nextValue,
            }))
          }
        />
      </div>

      {/* 版权许可 */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
          版权许可
        </h3>
        <PostLicensePicker
          value={formData.license}
          onChange={(license) => handleFieldChange("license", license)}
          disabled={isSubmitting}
        />
      </div>

      {/* SEO 设置 */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
          SEO 设置
        </h3>
        <div className="grid grid-cols-1 gap-6">
          <Input
            label="SEO 描述"
            value={formData.metaDescription}
            onChange={(e) =>
              handleFieldChange("metaDescription", e.target.value)
            }
            rows={2}
            size="sm"
            helperText="留空则使用文章摘要"
          />
          <Input
            label="SEO 关键词"
            value={formData.metaKeywords}
            onChange={(e) => handleFieldChange("metaKeywords", e.target.value)}
            size="sm"
            helperText="多个关键词用逗号分隔"
          />
          <Checkbox
            label="允许搜索引擎索引"
            checked={formData.robotsIndex}
            onChange={(e) => handleFieldChange("robotsIndex", e.target.checked)}
          />
        </div>
      </div>

      {/* 特色图片 */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
          特色图片
        </h3>
        <MediaSelector
          label="特色图片"
          value={formData.featuredImage}
          onChange={(urls) =>
            handleFieldChange(
              "featuredImage",
              Array.isArray(urls) ? urls[0] || "" : urls || "",
            )
          }
          helperText="选择或上传文章特色图片"
        />
      </div>

      {/* 操作按钮 */}
      <div className="flex justify-end gap-4 pt-4 border-t border-foreground/10">
        <Button
          label="取消"
          variant="ghost"
          onClick={() => setDetailsDialogOpen(false)}
          size="sm"
          disabled={isSubmitting}
        />
        <Button
          label="保存"
          variant="primary"
          onClick={handleSaveDetails}
          size="sm"
          loading={isSubmitting}
          disabled={!formData.title.trim()}
        />
      </div>
    </div>
  );

  // ==================== 渲染确认对话框内容 ====================
  const renderConfirmDialogContent = () => (
    <div className="px-6 py-6 space-y-6">
      <p className="text-sm text-muted-foreground mb-4">
        请确认以下信息无误后继续。<span className="text-error">标题</span>
        为必填项。
      </p>

      {/* 基本信息 */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
          基本信息
        </h3>
        <div className="grid grid-cols-1 gap-4 bg-muted/30 p-4 rounded-sm">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              标题 <span className="text-error">*</span>
            </label>
            <p
              className={`text-sm ${formData.title ? "text-foreground" : "text-foreground/80"}`}
            >
              {formData.title ||
                `（未设置，请点击"${isEditMode ? "更改" : "设置"}详细信息"填写）`}
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Slug
            </label>
            <p className="text-sm font-mono text-foreground/80">
              {formData.slug || "（未设置，将从标题自动生成）"}
            </p>
          </div>
          {isEditMode && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                文章状态
              </label>
              <p className="text-sm text-foreground/80">
                {formData.status === "DRAFT"
                  ? "草稿"
                  : formData.status === "PUBLISHED"
                    ? "已发布"
                    : "已归档"}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* 发布设置 */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
          发布设置
        </h3>
        <div className="grid grid-cols-2 gap-4 bg-muted/30 p-4 rounded-sm">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              状态
            </label>
            <p className="text-sm text-foreground/80">
              {confirmAction === "publish"
                ? "已发布"
                : formData.status === "PUBLISHED"
                  ? "已发布"
                  : formData.status === "DRAFT"
                    ? "草稿"
                    : "已归档"}
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              置顶
            </label>
            <p className="text-sm text-foreground/80">
              {formData.isPinned ? "是" : "否"}
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              允许评论
            </label>
            <p className="text-sm text-foreground/80">
              {formData.allowComments ? "是" : "否"}
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              访问控制
            </label>
            <p className="text-sm text-foreground/80">
              {getPostAccessControlLabel(formData)}
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              搜索引擎索引
            </label>
            <p className="text-sm text-foreground/80">
              {formData.robotsIndex ? "允许" : "禁止"}
            </p>
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-foreground mb-1">
              版权许可
            </label>
            <p className="text-sm text-foreground/80">
              {getPostLicenseSelectionLabel(formData.license)}
            </p>
          </div>
        </div>
      </div>

      {/* 特色图片 */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
          特色图片
        </h3>
        <div className="bg-muted/30 p-4 rounded-sm">
          {formData.featuredImage ? (
            <div className="space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={formData.featuredImage}
                alt="特色图片预览"
                className="w-full max-h-[20em] rounded-md object-cover"
              />
              <p className="text-xs text-foreground/60 break-all">
                {formData.featuredImage}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">（未设置）</p>
          )}
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="flex justify-between gap-4 pt-4 border-t border-foreground/10">
        <Button
          label="取消"
          variant="ghost"
          onClick={() => setConfirmDialogOpen(false)}
          size="sm"
          disabled={isSubmitting}
        />
        <div className="flex gap-2">
          <Button
            label={isEditMode ? "更改详细信息" : "设置详细信息"}
            variant="ghost"
            onClick={() => {
              setConfirmDialogOpen(false);
              setDetailsDialogOpen(true);
            }}
            size="sm"
            disabled={isSubmitting}
          />
          <Button
            label={
              isEditMode
                ? "保存"
                : confirmAction === "publish"
                  ? "发布"
                  : "保存为草稿"
            }
            variant="primary"
            onClick={handleFinalSubmit}
            size="sm"
            loading={isSubmitting}
            disabled={!formData.title.trim()}
          />
        </div>
      </div>
    </div>
  );

  const renderMailDispatchDialogContent = () => (
    <div className="px-6 py-6 space-y-6">
      <p className="text-sm text-muted-foreground">
        当前站点已开启邮箱订阅，且有 {activeSubscriberCount}{" "}
        位活跃订阅者。是否前往邮件发送页面，向订阅者发送最新文章通知？
      </p>
      <div className="flex justify-end gap-2">
        <Button
          label="暂不发送"
          variant="ghost"
          size="sm"
          onClick={() => {
            setMailDispatchDialogOpen(false);
            navigateToDefaultSuccessPage();
          }}
        />
        <Button
          label="前往发送页面"
          variant="primary"
          size="sm"
          onClick={() => {
            setMailDispatchDialogOpen(false);
            navigate("/admin/mail-subscriptions");
          }}
        />
      </div>
    </div>
  );

  // ==================== 渲染 ====================
  return (
    <>
      <EditorCore
        content={content}
        storageKey={storageKey}
        title={formData.title}
        onTitleChange={handleEditorTitleChange}
        availableModes={availableModes}
        defaultMode={defaultMode}
        dialogs={[]}
        statusBarActions={statusBarActions}
        onSave={() => {
          setConfirmAction("draft");
          setConfirmDialogOpen(true);
        }}
        onPublish={() => {
          setConfirmAction("publish");
          setConfirmDialogOpen(true);
        }}
      />

      {/* 详细信息对话框 */}
      <Dialog
        open={detailsDialogOpen}
        onClose={() => setDetailsDialogOpen(false)}
        title="文章详细信息"
        size="lg"
      >
        {renderDetailsDialogContent()}
      </Dialog>

      {/* 确认对话框 */}
      <Dialog
        open={confirmDialogOpen}
        onClose={() => setConfirmDialogOpen(false)}
        title={
          isEditMode
            ? "确认保存"
            : confirmAction === "publish"
              ? "确认发布"
              : "确认保存为草稿"
        }
        size="lg"
      >
        {renderConfirmDialogContent()}
      </Dialog>

      <Dialog
        open={mailDispatchDialogOpen}
        onClose={() => {
          setMailDispatchDialogOpen(false);
          navigateToDefaultSuccessPage();
        }}
        title="发布成功，是否发送邮件通知"
        size="md"
      >
        {renderMailDispatchDialogContent()}
      </Dialog>
    </>
  );
}
