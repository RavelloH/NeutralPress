import type { ApiResponse } from "@repo/shared-types/api/common";
import type {
  DoctorHistoryItem,
  DoctorTrendItem,
  GetDoctorHistory,
  GetDoctorTrends,
} from "@repo/shared-types/api/doctor";

import { fetchPublicRead } from "@/lib/client/api/read";

export function getDoctorHistory(
  params: GetDoctorHistory,
  signal?: AbortSignal,
): Promise<ApiResponse<DoctorHistoryItem[] | null>> {
  return fetchPublicRead("/api/public/admin/doctor/history", params, signal);
}
export function getDoctorTrends(
  params: GetDoctorTrends,
  signal?: AbortSignal,
): Promise<ApiResponse<DoctorTrendItem[] | null>> {
  return fetchPublicRead("/api/public/admin/doctor/trends", params, signal);
}
