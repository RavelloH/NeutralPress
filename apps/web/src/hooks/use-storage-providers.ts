"use client";

import { useEffect, useState } from "react";

import { getStorageList } from "@/lib/client/api/storage-read";

export interface StorageProvider {
  id: string;
  name: string;
  displayName: string;
  type: string;
  isDefault: boolean;
}

interface UseStorageProvidersOptions {
  /** 是否启用加载（根据用户角色和模式决定） */
  enabled: boolean;
  /** 是否过滤虚拟存储（导入模式需要过滤 external-url） */
  filterVirtual?: boolean;
}

interface UseStorageProvidersReturn {
  providers: StorageProvider[];
  selectedId: string;
  setSelectedId: (id: string) => void;
  loading: boolean;
}

/**
 * 加载存储提供商列表的 Hook
 */
export function useStorageProviders(
  options: UseStorageProvidersOptions,
): UseStorageProvidersReturn {
  const { enabled, filterVirtual = false } = options;
  const [providers, setProviders] = useState<StorageProvider[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setProviders([]);
      setSelectedId("");
      return;
    }

    setLoading(true);

    getStorageList({
      access_token: "", // GET 适配层不会将 token 加入 URL，由 Cookie 完成身份验证
      page: 1,
      pageSize: 100,
      sortBy: "createdAt",
      sortOrder: "desc",
      isActive: true,
    })
      .then((response) => {
        if (response.success && response.data) {
          let providersList = response.data as StorageProvider[];

          // 过滤虚拟存储提供商（external-url）
          if (filterVirtual) {
            providersList = providersList.filter(
              (provider) => provider.name !== "external-url",
            );
          }

          setProviders(providersList);

          // 自动选择默认存储提供商
          const defaultStorage = providersList.find((s) => s.isDefault);
          if (defaultStorage) {
            setSelectedId(defaultStorage.id);
          } else if (providersList.length > 0 && providersList[0]) {
            setSelectedId(providersList[0].id);
          }
        }
      })
      .catch((err) => console.error("Failed to fetch storage providers:", err))
      .finally(() => setLoading(false));
  }, [enabled, filterVirtual]);

  return {
    providers,
    selectedId,
    setSelectedId,
    loading,
  };
}
