"use server";

import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type {
  CreateProject,
  CreateProjectResult,
  DeleteProjects,
  GetProjectDetail,
  GetProjectsList,
  GetProjectsTrends,
  ProjectDetail,
  ProjectListItem,
  ProjectTrendItem,
  SyncProjectsGithub,
  SyncProjectsGithubResult,
  UpdateProject,
  UpdateProjectResult,
  UpdateProjects,
} from "@repo/shared-types/api/project";
import type { NextResponse } from "next/server";

import * as service from "@/lib/server/services/project-domain";

type ActionEnvironment = "serverless" | "serveraction";

type ActionConfig = { environment?: ActionEnvironment };

type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

export async function getProjectsTrends(
  params: GetProjectsTrends,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<ProjectTrendItem[] | null>>>;

export async function getProjectsTrends(
  params: GetProjectsTrends,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<ProjectTrendItem[] | null>>;

export async function getProjectsTrends(
  arg0: GetProjectsTrends,
  serverConfig?: ActionConfig,
): Promise<ActionResult<ProjectTrendItem[] | null>> {
  return service.getProjectsTrends(arg0, serverConfig);
}

export async function getProjectsList(
  params: GetProjectsList,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<ProjectListItem[] | null>>>;

export async function getProjectsList(
  params: GetProjectsList,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<ProjectListItem[] | null>>;

export async function getProjectsList(
  arg0: GetProjectsList,
  serverConfig?: ActionConfig,
): Promise<ActionResult<ProjectListItem[] | null>> {
  return service.getProjectsList(arg0, serverConfig);
}

export async function getProjectDetail(
  params: GetProjectDetail,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<ProjectDetail | null>>>;

export async function getProjectDetail(
  params: GetProjectDetail,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<ProjectDetail | null>>;

export async function getProjectDetail(
  arg0: GetProjectDetail,
  serverConfig?: ActionConfig,
): Promise<ActionResult<ProjectDetail | null>> {
  return service.getProjectDetail(arg0, serverConfig);
}

export async function createProject(
  params: CreateProject,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CreateProjectResult | null>>>;

export async function createProject(
  params: CreateProject,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CreateProjectResult | null>>;

export async function createProject(
  arg0: CreateProject,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CreateProjectResult | null>> {
  return service.createProject(arg0, serverConfig);
}

export async function updateProject(
  params: UpdateProject,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<UpdateProjectResult | null>>>;

export async function updateProject(
  params: UpdateProject,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<UpdateProjectResult | null>>;

export async function updateProject(
  arg0: UpdateProject,
  serverConfig?: ActionConfig,
): Promise<ActionResult<UpdateProjectResult | null>> {
  return service.updateProject(arg0, serverConfig);
}

export async function updateProjects(
  params: UpdateProjects,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<{ updated: number } | null>>>;

export async function updateProjects(
  params: UpdateProjects,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<{ updated: number } | null>>;

export async function updateProjects(
  arg0: UpdateProjects,
  serverConfig?: ActionConfig,
): Promise<ActionResult<{ updated: number } | null>> {
  return service.updateProjects(arg0, serverConfig);
}

export async function deleteProjects(
  params: DeleteProjects,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<{ deleted: number } | null>>>;

export async function deleteProjects(
  params: DeleteProjects,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<{ deleted: number } | null>>;

export async function deleteProjects(
  arg0: DeleteProjects,
  serverConfig?: ActionConfig,
): Promise<ActionResult<{ deleted: number } | null>> {
  return service.deleteProjects(arg0, serverConfig);
}

export async function syncProjectsGithub(
  params: SyncProjectsGithub,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<SyncProjectsGithubResult | null>>>;

export async function syncProjectsGithub(
  params: SyncProjectsGithub,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<SyncProjectsGithubResult | null>>;

export async function syncProjectsGithub(
  arg0: SyncProjectsGithub,
  serverConfig?: ActionConfig,
): Promise<ActionResult<SyncProjectsGithubResult | null>> {
  return service.syncProjectsGithub(arg0, serverConfig);
}
