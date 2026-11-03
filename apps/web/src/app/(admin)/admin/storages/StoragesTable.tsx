"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  RiCheckLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiEditLine,
  RiEyeLine,
  RiEyeOffLine,
  RiStarFill,
  RiStarLine,
} from "@remixicon/react";
import type { StorageListItem } from "@repo/shared-types/api/storage";

import {
  deleteStorage,
  setDefaultStorage,
  toggleStorageStatus,
  updateStorage,
} from "@/actions/storage";
import type { StorageConfigValues } from "@/app/(admin)/admin/storages/StorageConfigFields";
import {
  createStorageConfigValues,
  StorageConfigFields,
  storageConfigValuesToPayload,
} from "@/app/(admin)/admin/storages/StorageConfigFields";
import type { ActionButton, FilterConfig } from "@/components/ui/GridTable";
import GridTable from "@/components/ui/GridTable";
import { useBroadcast } from "@/hooks/use-broadcast";
import {
  getStorageDetail,
  getStorageList,
} from "@/lib/client/api/storage-read";
import runWithAuth, { resolveApiResponse } from "@/lib/client/run-with-auth";
import type { StorageProviderType } from "@/template/storages";
import { AlertDialog } from "@/ui/AlertDialog";
import { AutoResizer } from "@/ui/AutoResizer";
import { AutoTransition } from "@/ui/AutoTransition";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Input } from "@/ui/Input";
import { LoadingIndicator } from "@/ui/LoadingIndicator";
import type { SelectOption } from "@/ui/Select";
import { Switch } from "@/ui/Switch";
import type { TableColumn } from "@/ui/Table";
import { useToast } from "@/ui/Toast";

// 虚拟存储提供商的名称（与后端保持一致）
const VIRTUAL_STORAGE_NAME = "external-url";

// 检查是否为虚拟存储
function isVirtualStorage(storage: StorageListItem): boolean {
  return storage.name === VIRTUAL_STORAGE_NAME;
}

interface StorageFormState {
  name: string;
  displayName: string;
  baseUrl: string;
  isActive: boolean;
  isDefault: boolean;
  maxFileSize: number;
  pathTemplate: string;
  config: StorageConfigValues;
}

const STORAGE_TYPES: SelectOption[] = [
  { value: "LOCAL", label: "本地存储" },
  { value: "AWS_S3", label: "AWS S3" },
  { value: "GITHUB_PAGES", label: "GitHub Pages" },
  { value: "VERCEL_BLOB", label: "Vercel Blob" },
];

export default function StoragesTable() {
  const [data, setData] = useState<StorageListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<
    "id" | "name" | "type" | "createdAt" | "updatedAt"
  >("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [filters, setFilters] = useState<Record<string, unknown>>({});
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingStorage, setEditingStorage] = useState<StorageListItem | null>(
    null,
  );
  const [formData, setFormData] = useState<StorageFormState>({
    name: "",
    displayName: "",
    baseUrl: "",
    isActive: true,
    isDefault: false,
    maxFileSize: 52428800,
    pathTemplate: "/{year}/{month}/{filename}",
    config: createStorageConfigValues("LOCAL"),
  });
  const [submitting, setSubmitting] = useState(false);
  const [configLoading, setConfigLoading] = useState(false);
  const { success: toastSuccess, error: toastError } = useToast();
  useBroadcast<{ type: "storages-refresh" }>((message) => {
    if (message?.type === "storages-refresh") {
      fetchData();
    }
  });

  // 格式化文件大小
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const typeParam =
        typeof filters.type === "string"
          ? (filters.type as
              | "LOCAL"
              | "AWS_S3"
              | "GITHUB_PAGES"
              | "VERCEL_BLOB")
          : undefined;
      const isActiveParam =
        filters.isActive !== undefined ? Boolean(filters.isActive) : undefined;
      const isDefaultParam =
        filters.isDefault !== undefined
          ? Boolean(filters.isDefault)
          : undefined;

      const result = await runWithAuth(getStorageList, {
        page,
        pageSize,
        sortBy,
        sortOrder,
        search: search || undefined,
        type: typeParam,
        isActive: isActiveParam,
        isDefault: isDefaultParam,
      });

      const response = await resolveApiResponse(result);

      if (response && response.success) {
        // API 返回遵循 shared-types 中的 Paginated Response：
        // response.data 是条目数组，分页信息在 response.meta 中
        let items = response.data as StorageListItem[];

        // 将虚拟存储排到最后
        items = items.sort((a, b) => {
          const aIsVirtual = isVirtualStorage(a);
          const bIsVirtual = isVirtualStorage(b);
          if (aIsVirtual && !bIsVirtual) return 1;
          if (!aIsVirtual && bIsVirtual) return -1;
          return 0;
        });

        setData(items);
        setTotalPages((response.meta?.totalPages as number) || 1);
        setTotalRecords((response.meta?.total as number) || 0);
      } else if (response && !response.success) {
        toastError("获取存储列表失败", response.message || "未知错误");
      }
    } catch (e: unknown) {
      console.error("获取存储列表失败:", e);
      toastError("获取存储列表失败", "请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, sortBy, sortOrder, search, filters, toastError]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleEdit = async (record: StorageListItem) => {
    // 禁止编辑虚拟存储
    if (isVirtualStorage(record)) {
      toastError("系统保护", "虚拟存储提供商不允许编辑");
      return;
    }

    setEditingStorage(record);
    // 立即设置基本表单数据（从列表项中获得）
    setFormData({
      name: record.name,
      displayName: record.displayName,
      baseUrl: record.baseUrl,
      isActive: record.isActive,
      isDefault: record.isDefault,
      maxFileSize: record.maxFileSize,
      pathTemplate: record.pathTemplate,
      config: createStorageConfigValues(record.type as StorageProviderType),
    });
    setEditDialogOpen(true);

    // 异步加载详细配置（主要是 config 字段）
    setConfigLoading(true);
    try {
      const detailResult = await runWithAuth(getStorageDetail, {
        id: record.id,
      });

      const detailResponse = await resolveApiResponse(detailResult);

      if (detailResponse && detailResponse.success && detailResponse.data) {
        const detail = detailResponse.data;
        // 只更新配置字段，保持其他字段不变
        setFormData((prev) => ({
          ...prev,
          config: createStorageConfigValues(
            detail.type as StorageProviderType,
            (detail.config as Record<string, unknown>) || {},
          ),
        }));
      } else if (detailResponse && !detailResponse.success) {
        toastError(
          "获取详细配置失败",
          detailResponse.message || "无法获取存储配置详情",
        );
      }
    } catch (error) {
      console.error("获取存储详情失败:", error);
      toastError("获取详细配置失败", "请稍后重试");
    } finally {
      setConfigLoading(false);
    }
  };

  const handleDelete = (records: StorageListItem[]) => {
    if (records.length === 0) return;
    setEditingStorage(records[0] || null);
    setDeleteDialogOpen(true);
  };

  const handleConfigValueChange = (key: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      config: {
        ...prev.config,
        [key]: value,
      },
    }));
  };

  const handleToggleStatus = async (record: StorageListItem) => {
    try {
      const result = await runWithAuth(toggleStorageStatus, {
        id: record.id,
        isActive: !record.isActive,
      });

      const response = await resolveApiResponse(result);

      if (response && response.success) {
        toastSuccess(
          record.isActive ? "存储已停用" : "存储已激活",
          `${record.displayName} 状态已更新`,
        );
        fetchData();
      } else if (response && !response.success) {
        toastError("操作失败", response.message || "无法更新存储状态");
      }
    } catch {
      toastError("操作失败", "无法更新存储状态");
    }
  };

  const handleSetDefault = async (record: StorageListItem) => {
    try {
      const result = await runWithAuth(setDefaultStorage, {
        id: record.id,
      });

      const response = await resolveApiResponse(result);

      if (response && response.success) {
        toastSuccess("默认存储已更新", `${record.displayName} 已设为默认存储`);
        fetchData();
      } else if (response && !response.success) {
        toastError("操作失败", response.message || "无法设置默认存储");
      }
    } catch {
      toastError("操作失败", "无法设置默认存储");
    }
  };

  const handleFormSubmit = async () => {
    if (!editingStorage) return;

    setSubmitting(true);
    try {
      const configValue = storageConfigValuesToPayload(formData.config);
      const result = await runWithAuth(updateStorage, {
        id: editingStorage.id,
        name: formData.name,
        displayName: formData.displayName,
        baseUrl: formData.baseUrl,
        isActive: formData.isActive,
        isDefault: formData.isDefault,
        maxFileSize: formData.maxFileSize,
        pathTemplate: formData.pathTemplate,
        config: configValue,
      });

      const response = await resolveApiResponse(result);

      if (response && response.success) {
        toastSuccess("存储已更新", `${formData.displayName} 配置已保存`);
        setEditDialogOpen(false);
        fetchData();
      } else if (response && !response.success) {
        toastError("更新失败", response.message || "无法保存存储配置");
      }
    } catch {
      toastError("更新失败", "无法保存存储配置");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!editingStorage) return;

    try {
      const result = await runWithAuth(deleteStorage, {
        ids: [editingStorage.id],
      });

      const response = await resolveApiResponse(result);

      if (response && response.success) {
        toastSuccess("存储已删除", `${editingStorage?.displayName} 已被删除`);
        setDeleteDialogOpen(false);
        setSelectedKeys([]);
        fetchData();
      } else if (response && !response.success) {
        toastError("删除失败", response.message || "无法删除存储");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toastError("删除失败", msg || "无法删除存储");
    }
  };

  const columns: TableColumn<StorageListItem>[] = [
    {
      title: "名称",
      dataIndex: "name",
      key: "name",
    },
    {
      title: "显示名称",
      dataIndex: "displayName",
      key: "displayName",
    },
    {
      title: "类型",
      dataIndex: "type",
      key: "type",
      render: (value: unknown) => {
        const type = String(value);
        const typeLabels: Record<string, string> = {
          LOCAL: "本地存储",
          AWS_S3: "AWS S3",
          GITHUB_PAGES: "GitHub Pages",
          VERCEL_BLOB: "Vercel Blob",
        };
        return typeLabels[type] || type;
      },
    },
    {
      title: "状态",
      dataIndex: "isActive",
      key: "isActive",
      render: (value: unknown) => {
        const isActive = Boolean(value);
        return (
          <div className="flex items-center gap-2">
            {isActive ? (
              <>
                <RiCheckLine className="text-green-500" size="1em" />
                <span>激活</span>
              </>
            ) : (
              <>
                <RiCloseLine className="text-red-500" size="1em" />
                <span>停用</span>
              </>
            )}
          </div>
        );
      },
    },
    {
      title: "默认",
      dataIndex: "isDefault",
      key: "isDefault",
      render: (value: unknown) => {
        const isDefault = Boolean(value);
        return (
          <div className="flex items-center gap-2">
            {isDefault ? (
              <>
                <span>是</span>
                <RiStarFill className="text-yellow-500" size="1em" />
              </>
            ) : (
              <span>否</span>
            )}
          </div>
        );
      },
    },
    {
      title: "文件数量",
      dataIndex: "mediaCount",
      key: "mediaCount",
      render: (value: unknown) => {
        const count = Number(value);
        return count.toLocaleString();
      },
    },
    {
      title: "文件总大小",
      dataIndex: "totalSize",
      key: "totalSize",
      render: (value: unknown) => {
        const size = Number(value);
        return formatFileSize(size);
      },
    },
  ];

  const filterConfig: FilterConfig[] = [
    {
      key: "type",
      label: "存储类型",
      type: "checkboxGroup",
      options: STORAGE_TYPES,
    },
    {
      key: "isActive",
      label: "状态",
      type: "checkboxGroup",
      options: [
        { value: "true", label: "激活" },
        { value: "false", label: "停用" },
      ],
    },
    {
      key: "isDefault",
      label: "默认存储",
      type: "checkboxGroup",
      options: [
        { value: "true", label: "是" },
        { value: "false", label: "否" },
      ],
    },
  ];

  const batchActions: ActionButton[] = [
    {
      label: "批量删除",
      onClick: () => {
        const records = data.filter((item) => selectedKeys.includes(item.id));
        handleDelete(records);
      },
      icon: <RiDeleteBinLine size="1em" />,
      variant: "danger",
      disabled: selectedKeys.length === 0,
    },
  ];

  const rowActions = (record: StorageListItem): ActionButton[] => {
    const isVirtual = isVirtualStorage(record);

    return [
      {
        label: "编辑",
        onClick: () => {
          void handleEdit(record);
        },
        icon: <RiEditLine size="1em" />,
        disabled: isVirtual, // 禁用虚拟存储的编辑
      },
      {
        label: record.isActive ? "停用" : "激活",
        onClick: () => {
          void handleToggleStatus(record);
        },
        icon: record.isActive ? (
          <RiEyeOffLine size="1em" />
        ) : (
          <RiEyeLine size="1em" />
        ),
        disabled: isVirtual, // 禁用虚拟存储的状态切换
      },
      {
        label: "设为默认",
        onClick: () => {
          void handleSetDefault(record);
        },
        icon: <RiStarLine size="1em" />,
        disabled: record.isDefault || isVirtual, // 禁用虚拟存储设为默认
      },
      {
        label: "删除",
        onClick: () => handleDelete([record]),
        icon: <RiDeleteBinLine size="1em" />,
        variant: "danger",
        disabled: isVirtual, // 禁用虚拟存储的删除
      },
    ];
  };

  return (
    <>
      <GridTable<StorageListItem>
        title="存储管理"
        columns={columns}
        data={data}
        loading={loading}
        rowKey="id"
        page={page}
        totalPages={totalPages}
        totalRecords={totalRecords}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        onSortChange={(key, order) => {
          if (key)
            setSortBy(
              key as "id" | "name" | "type" | "createdAt" | "updatedAt",
            );
          if (order) setSortOrder(order);
        }}
        onSearchChange={setSearch}
        searchPlaceholder="搜索存储名称或显示名称..."
        filterConfig={filterConfig}
        onFilterChange={setFilters}
        enableActions={true}
        batchActions={batchActions}
        rowActions={rowActions}
        onSelectionChange={(selectedKeys) =>
          setSelectedKeys(selectedKeys as string[])
        }
        onRowClick={(record) => {
          // 禁止点击虚拟存储行
          if (!isVirtualStorage(record)) {
            handleEdit(record);
          }
        }}
        striped
        hoverable
        bordered={false}
        size="sm"
        stickyHeader
        maxHeight="600px"
        padding={2.5}
      />

      {/* 编辑对话框 */}
      <Dialog
        open={editDialogOpen}
        onClose={() => setEditDialogOpen(false)}
        title="编辑存储配置"
        size="lg"
      >
        <AutoResizer duration={0.4} ease="easeInOut" initial={true}>
          <div className="space-y-4 p-6">
            {/* 基本字段 - 立即可见 */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">名称</label>
                <Input
                  label="存储名称"
                  size="sm"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  placeholder="存储名称"
                />
              </div>
              <div>
                <label className="text-sm font-medium">显示名称</label>
                <Input
                  label="显示名称"
                  size="sm"
                  value={formData.displayName}
                  onChange={(e) =>
                    setFormData({ ...formData, displayName: e.target.value })
                  }
                  placeholder="显示名称"
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">基础URL</label>
              <Input
                label="基础URL"
                size="sm"
                value={formData.baseUrl}
                onChange={(e) =>
                  setFormData({ ...formData, baseUrl: e.target.value })
                }
                placeholder="https://example.com"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">最大文件大小</label>
                <Input
                  label="最大文件大小"
                  size="sm"
                  type="number"
                  value={formData.maxFileSize}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      maxFileSize: parseInt(e.target.value) || 0,
                    })
                  }
                  placeholder="52428800"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  字节数，默认 50MB
                </p>
              </div>
              <div>
                <label className="text-sm font-medium">路径模板</label>
                <Input
                  size="sm"
                  label="路径模板"
                  value={formData.pathTemplate}
                  onChange={(e) =>
                    setFormData({ ...formData, pathTemplate: e.target.value })
                  }
                  placeholder="/{year}/{month}/{filename}"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Switch
                label="激活存储"
                checked={formData.isActive}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, isActive: Boolean(checked) })
                }
              />
              <br />
              <Switch
                label="设为默认存储"
                checked={formData.isDefault}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, isDefault: Boolean(checked) })
                }
              />
            </div>

            {/* 配置字段 - 异步加载 */}
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm font-medium">
                <span>配置</span>
                {configLoading && (
                  <span className="text-xs text-muted-foreground">
                    配置加载中...
                  </span>
                )}
              </div>
              <AutoTransition
                type="slideUp"
                key={configLoading ? "loading" : "loaded"}
              >
                {configLoading ? (
                  <div className="py-8">
                    <LoadingIndicator />
                  </div>
                ) : editingStorage ? (
                  <StorageConfigFields
                    type={editingStorage.type as StorageProviderType}
                    values={formData.config}
                    onChange={handleConfigValueChange}
                    disabled={false}
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    请选择要编辑的存储提供商后再调整配置。
                  </p>
                )}
              </AutoTransition>
            </div>
            <div className="flex justify-end gap-4 pt-4 border-t border-foreground/10">
              <Button
                label="取消"
                variant="ghost"
                onClick={() => setEditDialogOpen(false)}
                size="sm"
                disabled={submitting}
              />
              <Button
                label="保存"
                variant="primary"
                onClick={handleFormSubmit}
                size="sm"
                loading={submitting}
              />
            </div>
          </div>
        </AutoResizer>
      </Dialog>

      {/* 删除确认对话框 */}
      <AlertDialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={handleDeleteConfirm}
        title="确认删除存储"
        description={`确定要删除存储 "${editingStorage?.displayName}" 吗？此操作不可撤销，且只有没有关联媒体文件的存储才能被删除。`}
        confirmText="删除"
        cancelText="取消"
        variant="danger"
      />
    </>
  );
}
