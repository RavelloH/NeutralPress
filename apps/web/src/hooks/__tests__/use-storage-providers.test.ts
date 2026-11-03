import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useStorageProviders } from "@/hooks/use-storage-providers";

// Mock the GET client adapter
vi.mock("@/lib/client/api/storage-read", () => ({
  getStorageList: vi.fn(),
}));

import { getStorageList } from "@/lib/client/api/storage-read";

const mockGetStorageList = vi.mocked(getStorageList);

describe("useStorageProviders", () => {
  const mockProviders = [
    {
      id: "prov-1",
      name: "local",
      displayName: "本地存储",
      type: "LOCAL",
      isDefault: true,
    },
    {
      id: "prov-2",
      name: "s3",
      displayName: "S3 存储",
      type: "AWS_S3",
      isDefault: false,
    },
    {
      id: "prov-3",
      name: "external-url",
      displayName: "外部 URL",
      type: "EXTERNAL",
      isDefault: false,
    },
  ] as any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStorageList.mockResolvedValue({
      success: true,
      data: mockProviders,
    } as any);
  });

  it("禁用时不加载数据", async () => {
    const { result } = renderHook(() =>
      useStorageProviders({ enabled: false }),
    );

    expect(result.current.providers).toEqual([]);
    expect(result.current.selectedId).toBe("");
    expect(result.current.loading).toBe(false);
    expect(mockGetStorageList).not.toHaveBeenCalled();
  });

  it("启用时加载存储提供商列表", async () => {
    const { result } = renderHook(() => useStorageProviders({ enabled: true }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.providers).toEqual(mockProviders);
    expect(mockGetStorageList).toHaveBeenCalledWith({
      access_token: "",
      page: 1,
      pageSize: 100,
      sortBy: "createdAt",
      sortOrder: "desc",
      isActive: true,
    });
  });

  it("自动选择默认存储提供商", async () => {
    const { result } = renderHook(() => useStorageProviders({ enabled: true }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.selectedId).toBe("prov-1");
  });

  it("没有默认提供商时选择第一个", async () => {
    const providersWithoutDefault = [
      {
        id: "prov-1",
        name: "s3",
        displayName: "S3",
        type: "AWS_S3",
        isDefault: false,
      },
      {
        id: "prov-2",
        name: "local",
        displayName: "本地",
        type: "LOCAL",
        isDefault: false,
      },
    ] as any;

    mockGetStorageList.mockResolvedValue({
      success: true,
      data: providersWithoutDefault,
    } as any);

    const { result } = renderHook(() => useStorageProviders({ enabled: true }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.selectedId).toBe("prov-1");
  });

  it("空列表时 selectedId 保持空字符串", async () => {
    mockGetStorageList.mockResolvedValue({
      success: true,
      data: [],
    } as any);

    const { result } = renderHook(() => useStorageProviders({ enabled: true }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.providers).toEqual([]);
    expect(result.current.selectedId).toBe("");
  });

  it("过滤虚拟存储提供商", async () => {
    const { result } = renderHook(() =>
      useStorageProviders({ enabled: true, filterVirtual: true }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.providers).toHaveLength(2);
    expect(
      result.current.providers.find((p) => p.name === "external-url"),
    ).toBeUndefined();
  });

  it("不过滤虚拟存储提供商（默认行为）", async () => {
    const { result } = renderHook(() => useStorageProviders({ enabled: true }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.providers).toHaveLength(3);
    expect(
      result.current.providers.find((p) => p.name === "external-url"),
    ).toBeDefined();
  });

  it("setSelectedId 更新选中的 ID", async () => {
    const { result } = renderHook(() => useStorageProviders({ enabled: true }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.setSelectedId("prov-2");
    });

    expect(result.current.selectedId).toBe("prov-2");
  });

  it("API 返回失败时 providers 为空", async () => {
    mockGetStorageList.mockResolvedValue({
      success: false,
      data: null,
    } as any);

    const { result } = renderHook(() => useStorageProviders({ enabled: true }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.providers).toEqual([]);
  });

  it("API 抛出错误时 providers 为空", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetStorageList.mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useStorageProviders({ enabled: true }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.providers).toEqual([]);
    consoleSpy.mockRestore();
  });

  it("加载中显示 loading 状态", async () => {
    let resolvePromise: (value: unknown) => void;
    const pendingPromise = new Promise((resolve) => {
      resolvePromise = resolve;
    });

    mockGetStorageList.mockReturnValue(pendingPromise as any);

    const { result } = renderHook(() => useStorageProviders({ enabled: true }));

    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolvePromise!({
        success: true,
        data: mockProviders,
      });
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it("禁用时重置状态", async () => {
    const { result, rerender } = renderHook(
      (props) => useStorageProviders(props),
      {
        initialProps: { enabled: true },
      },
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.providers).toHaveLength(3);

    rerender({ enabled: false });

    expect(result.current.providers).toEqual([]);
    expect(result.current.selectedId).toBe("");
  });

  it("filterVirtual 变化时重新加载", async () => {
    const { result, rerender } = renderHook(
      (props) => useStorageProviders(props),
      {
        initialProps: { enabled: true, filterVirtual: false },
      },
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.providers).toHaveLength(3);

    rerender({ enabled: true, filterVirtual: true });

    await waitFor(() => {
      expect(result.current.providers).toHaveLength(2);
    });
  });

  it("过滤后没有默认提供商时选择第一个", async () => {
    // external-url is the default but gets filtered
    const providersWithVirtualDefault = [
      {
        id: "prov-1",
        name: "external-url",
        displayName: "外部URL",
        type: "EXTERNAL",
        isDefault: true,
      },
      {
        id: "prov-2",
        name: "s3",
        displayName: "S3",
        type: "AWS_S3",
        isDefault: false,
      },
    ] as any;

    mockGetStorageList.mockResolvedValue({
      success: true,
      data: providersWithVirtualDefault,
    } as any);

    const { result } = renderHook(() =>
      useStorageProviders({ enabled: true, filterVirtual: true }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // After filtering, only s3 remains, and it's not default
    expect(result.current.providers).toHaveLength(1);
    expect(result.current.selectedId).toBe("prov-2");
  });
});
