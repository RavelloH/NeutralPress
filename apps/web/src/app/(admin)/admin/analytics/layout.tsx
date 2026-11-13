import { cookies } from "next/headers";

import ForbiddenPage from "@/app/forbidden";
import UnauthorizedPage from "@/app/unauthorized";
import { verifyAccessToken } from "@/lib/server/auth-verify";

const allowedRoles = ["ADMIN"];

export default async function AnalyticsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const token = cookieStore.get("ACCESS_TOKEN")?.value;

  if (!token) {
    return <UnauthorizedPage />;
  }

  try {
    const decoded = await verifyAccessToken(token);
    if (!decoded) {
      return <UnauthorizedPage />;
    }
    const userRole = decoded.role;

    if (!allowedRoles.includes(userRole)) {
      return <ForbiddenPage role={userRole} allowRoles={allowedRoles} />;
    }
  } catch (error) {
    console.error("Token verification failed:", error);
    return <UnauthorizedPage />;
  }

  return <>{children}</>;
}
