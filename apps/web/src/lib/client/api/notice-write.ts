import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type {
  MarkAllNoticesAsReadSuccessResponse,
  MarkNoticesAsReadSuccessResponse,
} from "@repo/shared-types/api/notice";

async function noticePost<T extends ApiResponseData>(
  operation: string,
  params: object,
): Promise<ApiResponse<T>> {
  const response = await fetch(
    "/api/public/account/notifications/" + operation,
    {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    },
  );
  if (response.status >= 500) throw new Error("更新通知失败");
  return (await response.json()) as ApiResponse<T>;
}

/** Retains the original user-restricted UPDATE + unread count broadcast service. */
export function markNoticesAsRead(
  noticeIds: string[],
): Promise<ApiResponse<MarkNoticesAsReadSuccessResponse["data"]>> {
  return noticePost("mark", { noticeIds });
}

export function markAllNoticesAsRead(): Promise<
  ApiResponse<MarkAllNoticesAsReadSuccessResponse["data"]>
> {
  return noticePost("mark-all", {});
}
