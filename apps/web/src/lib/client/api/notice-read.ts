import type { ApiResponse } from "@repo/shared-types/api/common";
import type { GetNoticesSuccessResponse } from "@repo/shared-types/api/notice";

import { fetchPublicRead } from "@/lib/client/api/read";

/** Read current user's paginated notifications without Server Action serialization. */
export function getReadNotices(
  skip: number,
  limit = 10,
  signal?: AbortSignal,
): Promise<ApiResponse<GetNoticesSuccessResponse["data"]>> {
  return fetchPublicRead(
    "/api/public/account/notifications/read",
    { skip, limit },
    signal,
  );
}
