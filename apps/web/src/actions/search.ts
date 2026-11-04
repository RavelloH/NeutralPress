"use server";

import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type {
  AddCustomWord,
  AddCustomWordResult,
  CustomWordItem,
  DeleteCustomWord,
  DeleteCustomWordResult,
  DeleteIndex,
  DeleteIndexResult,
  GetCustomWords,
  GetIndexStatus,
  GetPostTokenDetails,
  GetSearchIndexStats,
  GetSearchLogs,
  GetSearchLogStats,
  IndexPosts,
  IndexPostsResult,
  IndexStatusItem,
  PostTokenDetails,
  SearchIndexStatsResult,
  SearchLogItem,
  SearchLogStatsResult,
  SearchPosts,
  SearchPostsResult,
  TestTokenize,
  TestTokenizeResult,
} from "@repo/shared-types/api/search";
import type { NextResponse } from "next/server";

import type {
  SearchSiteParams,
  SearchSiteResult,
} from "@/lib/shared/search-site";

export type {
  SearchSiteParams,
  SearchSitePostItem,
  SearchSiteProjectItem,
  SearchSiteTagItem,
  SearchSiteCategoryItem,
  SearchSitePhotoItem,
  SearchSiteResult,
} from "@/lib/shared/search-site";

import * as service from "@/lib/server/services/search-admin-domain";

type ActionEnvironment = "serverless" | "serveraction";

type ActionConfig = { environment?: ActionEnvironment };

type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

export async function testTokenize(
  params: Omit<TestTokenize, "access_token">,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<TestTokenizeResult | null>>>;
export async function testTokenize(
  params: Omit<TestTokenize, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<TestTokenizeResult | null>>;
export async function testTokenize(
  params0: Omit<TestTokenize, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ActionResult<TestTokenizeResult | null>> {
  return service.testTokenize(params0, serverConfig);
}

export async function addCustomWord(
  params: Omit<AddCustomWord, "access_token">,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<AddCustomWordResult | null>>>;
export async function addCustomWord(
  params: Omit<AddCustomWord, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<AddCustomWordResult | null>>;
export async function addCustomWord(
  params0: Omit<AddCustomWord, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ActionResult<AddCustomWordResult | null>> {
  return service.addCustomWord(params0, serverConfig);
}

export async function getCustomWords(
  params: Omit<GetCustomWords, "access_token">,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CustomWordItem[] | null>>>;
export async function getCustomWords(
  params: Omit<GetCustomWords, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CustomWordItem[] | null>>;
export async function getCustomWords(
  _params: Omit<GetCustomWords, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CustomWordItem[] | null>> {
  return service.getCustomWords(_params, serverConfig);
}

export async function deleteCustomWord(
  params: Omit<DeleteCustomWord, "access_token">,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<DeleteCustomWordResult | null>>>;
export async function deleteCustomWord(
  params: Omit<DeleteCustomWord, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<DeleteCustomWordResult | null>>;
export async function deleteCustomWord(
  params0: Omit<DeleteCustomWord, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ActionResult<DeleteCustomWordResult | null>> {
  return service.deleteCustomWord(params0, serverConfig);
}

export async function indexPosts(
  params: Omit<IndexPosts, "access_token">,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<IndexPostsResult | null>>>;
export async function indexPosts(
  params: Omit<IndexPosts, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<IndexPostsResult | null>>;
export async function indexPosts(
  params0: Omit<IndexPosts, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ActionResult<IndexPostsResult | null>> {
  return service.indexPosts(params0, serverConfig);
}

export async function deleteIndex(
  params: Omit<DeleteIndex, "access_token">,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<DeleteIndexResult | null>>>;
export async function deleteIndex(
  params: Omit<DeleteIndex, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<DeleteIndexResult | null>>;
export async function deleteIndex(
  params0: Omit<DeleteIndex, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ActionResult<DeleteIndexResult | null>> {
  return service.deleteIndex(params0, serverConfig);
}

export async function getIndexStatus(
  params: Omit<GetIndexStatus, "access_token">,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<IndexStatusItem[] | null>>>;
export async function getIndexStatus(
  params: Omit<GetIndexStatus, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<IndexStatusItem[] | null>>;
export async function getIndexStatus(
  params0: Omit<GetIndexStatus, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ActionResult<IndexStatusItem[] | null>> {
  return service.getIndexStatus(params0, serverConfig);
}

export async function searchPosts(
  params: SearchPosts,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<SearchPostsResult | null>>>;
export async function searchPosts(
  params: SearchPosts,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<SearchPostsResult | null>>;
export async function searchPosts(
  params: SearchPosts,
  serverConfig?: ActionConfig,
): Promise<ActionResult<SearchPostsResult | null>> {
  return service.searchPosts(params, serverConfig);
}

export async function searchSite(
  params: SearchSiteParams,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<SearchSiteResult | null>>>;
export async function searchSite(
  params: SearchSiteParams,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<SearchSiteResult | null>>;
export async function searchSite(
  params: SearchSiteParams,
  serverConfig?: ActionConfig,
): Promise<ActionResult<SearchSiteResult | null>> {
  return service.searchSite(params, serverConfig);
}

export async function getPostTokenDetails(
  params: Omit<GetPostTokenDetails, "access_token">,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<PostTokenDetails | null>>>;
export async function getPostTokenDetails(
  params: Omit<GetPostTokenDetails, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<PostTokenDetails | null>>;
export async function getPostTokenDetails(
  params0: Omit<GetPostTokenDetails, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ActionResult<PostTokenDetails | null>> {
  return service.getPostTokenDetails(params0, serverConfig);
}

export async function getSearchIndexStats(
  params: Omit<GetSearchIndexStats, "access_token">,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<SearchIndexStatsResult | null>>>;
export async function getSearchIndexStats(
  params: Omit<GetSearchIndexStats, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<SearchIndexStatsResult | null>>;
export async function getSearchIndexStats(
  params: Omit<GetSearchIndexStats, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ActionResult<SearchIndexStatsResult | null>> {
  return service.getSearchIndexStats(params, serverConfig);
}

export async function getSearchLogStats(
  params: Omit<GetSearchLogStats, "access_token">,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<SearchLogStatsResult | null>>>;
export async function getSearchLogStats(
  params: Omit<GetSearchLogStats, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<SearchLogStatsResult | null>>;
export async function getSearchLogStats(
  params: Omit<GetSearchLogStats, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ActionResult<SearchLogStatsResult | null>> {
  return service.getSearchLogStats(params, serverConfig);
}

export async function getSearchLogs(
  params: Omit<GetSearchLogs, "access_token">,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<SearchLogItem[] | null>>>;
export async function getSearchLogs(
  params: Omit<GetSearchLogs, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<SearchLogItem[] | null>>;
export async function getSearchLogs(
  params0: Omit<GetSearchLogs, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ActionResult<SearchLogItem[] | null>> {
  return service.getSearchLogs(params0, serverConfig);
}
