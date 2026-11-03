"use server";

import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type {
  CreateUser,
  DeleteUsers,
  Disable2FA,
  GetUsersList,
  GetUsersTrends,
  UpdateUserProfile,
  UpdateUsers,
  UserActivityResponse,
  UserListItem,
  UserProfile,
  UserTrendItem,
} from "@repo/shared-types/api/user";
import type { NextResponse } from "next/server";

import * as service from "@/lib/server/services/user-domain";

type ActionEnvironment = "serverless" | "serveraction";

type ActionConfig = { environment?: ActionEnvironment };

type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

export async function getUsersTrends(
  params: GetUsersTrends,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<UserTrendItem[] | null>>>;

export async function getUsersTrends(
  params: GetUsersTrends,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<UserTrendItem[] | null>>;

export async function getUsersTrends(
  arg0: GetUsersTrends,
  serverConfig?: ActionConfig,
): Promise<ActionResult<UserTrendItem[] | null>> {
  return service.getUsersTrends(arg0, serverConfig);
}

export async function getUsersList(
  params: GetUsersList,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<UserListItem[] | null>>>;

export async function getUsersList(
  params: GetUsersList,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<UserListItem[] | null>>;

export async function getUsersList(
  arg0: GetUsersList,
  serverConfig?: ActionConfig,
): Promise<ActionResult<UserListItem[] | null>> {
  return service.getUsersList(arg0, serverConfig);
}

export async function createUser(
  params: CreateUser,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<
    ApiResponse<{
      uid: number;
      username: string;
      nickname: string | null;
      email: string;
      role: "USER" | "ADMIN" | "EDITOR" | "AUTHOR";
      status: "ACTIVE" | "SUSPENDED" | "NEEDS_UPDATE";
      emailVerified: boolean;
      emailNotice: boolean;
      createdAt: string;
    } | null>
  >
>;

export async function createUser(
  params: CreateUser,
  serverConfig?: ActionConfig,
): Promise<
  ApiResponse<{
    uid: number;
    username: string;
    nickname: string | null;
    email: string;
    role: "USER" | "ADMIN" | "EDITOR" | "AUTHOR";
    status: "ACTIVE" | "SUSPENDED" | "NEEDS_UPDATE";
    emailVerified: boolean;
    emailNotice: boolean;
    createdAt: string;
  } | null>
>;

export async function createUser(
  arg0: CreateUser,
  serverConfig?: ActionConfig,
): Promise<
  ActionResult<{
    uid: number;
    username: string;
    nickname: string | null;
    email: string;
    role: "USER" | "ADMIN" | "EDITOR" | "AUTHOR";
    status: "ACTIVE" | "SUSPENDED" | "NEEDS_UPDATE";
    emailVerified: boolean;
    emailNotice: boolean;
    createdAt: string;
  } | null>
> {
  return service.createUser(arg0, serverConfig);
}

export async function updateUsers(
  params: UpdateUsers,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<{ updated: number } | null>>>;

export async function updateUsers(
  params: UpdateUsers,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<{ updated: number } | null>>;

export async function updateUsers(
  arg0: UpdateUsers,
  serverConfig?: ActionConfig,
): Promise<ActionResult<{ updated: number } | null>> {
  return service.updateUsers(arg0, serverConfig);
}

export async function deleteUsers(
  params: DeleteUsers,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<{ deleted: number } | null>>>;

export async function deleteUsers(
  params: DeleteUsers,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<{ deleted: number } | null>>;

export async function deleteUsers(
  arg0: DeleteUsers,
  serverConfig?: ActionConfig,
): Promise<ActionResult<{ deleted: number } | null>> {
  return service.deleteUsers(arg0, serverConfig);
}

export async function getUserProfile(serverConfig: {
  environment: "serverless";
}): Promise<
  NextResponse<
    ApiResponse<{
      uid: number;
      username: string;
      email: string;
      nickname: string | null;
      website: string | null;
      bio: string | null;
      role: "USER" | "ADMIN" | "EDITOR" | "AUTHOR";
      createdAt: string;
      hasPassword: boolean;
      linkedAccounts: Array<{
        provider: string;
        email: string;
      }>;
    } | null>
  >
>;

export async function getUserProfile(serverConfig?: ActionConfig): Promise<
  ApiResponse<{
    uid: number;
    username: string;
    email: string;
    nickname: string | null;
    website: string | null;
    bio: string | null;
    role: "USER" | "ADMIN" | "EDITOR" | "AUTHOR";
    createdAt: string;
    hasPassword: boolean;
    linkedAccounts: Array<{
      provider: string;
      email: string;
    }>;
  } | null>
>;

export async function getUserProfile(serverConfig?: ActionConfig): Promise<
  ActionResult<{
    uid: number;
    username: string;
    email: string;
    nickname: string | null;
    website: string | null;
    bio: string | null;
    role: "USER" | "ADMIN" | "EDITOR" | "AUTHOR";
    createdAt: string;
    hasPassword: boolean;
    linkedAccounts: Array<{
      provider: string;
      email: string;
    }>;
  } | null>
> {
  return service.getUserProfile(serverConfig);
}

export async function updateUserProfile(
  params: UpdateUserProfile,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<ApiResponse<{ updated: boolean; needsLogout?: boolean } | null>>
>;

export async function updateUserProfile(
  params: UpdateUserProfile,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<{ updated: boolean; needsLogout?: boolean } | null>>;

export async function updateUserProfile(
  arg0: UpdateUserProfile,
  serverConfig?: ActionConfig,
): Promise<ActionResult<{ updated: boolean; needsLogout?: boolean } | null>> {
  return service.updateUserProfile(arg0, serverConfig);
}

export async function disable2FA(
  params: Disable2FA,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<{ success: boolean } | null>>>;

export async function disable2FA(
  params: Disable2FA,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<{ success: boolean } | null>>;

export async function disable2FA(
  arg0: Disable2FA,
  serverConfig?: ActionConfig,
): Promise<ActionResult<{ success: boolean } | null>> {
  return service.disable2FA(arg0, serverConfig);
}

export async function getUserPublicProfile(
  uid: number,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<UserProfile | null>>>;

export async function getUserPublicProfile(
  uid: number,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<UserProfile | null>>;

export async function getUserPublicProfile(
  uid: number,
  serverConfig?: ActionConfig,
): Promise<ActionResult<UserProfile | null>> {
  return service.getUserPublicProfile(uid, serverConfig);
}

export async function getUserActivity(
  uid: number,
  offset: number,
  limit: number,
  isGuest: boolean,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<UserActivityResponse | null>>>;

export async function getUserActivity(
  uid: number,
  offset?: number,
  limit?: number,
  isGuest?: boolean,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<UserActivityResponse | null>>;

export async function getUserActivity(
  uid: number,
  offset: number = 0,
  limit: number = 20,
  isGuest: boolean = false,
  serverConfig?: ActionConfig,
): Promise<ActionResult<UserActivityResponse | null>> {
  return service.getUserActivity(uid, offset, limit, isGuest, serverConfig);
}
