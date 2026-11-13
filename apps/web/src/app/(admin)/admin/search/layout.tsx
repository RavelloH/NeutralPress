import { cookies } from "next/headers";

import ForbiddenPage from "@/app/forbidden";
import UnauthorizedPage from "@/app/unauthorized";
import { verifyAccessToken } from "@/lib/server/auth-verify";

const allowedRoles = ["ADMIN", "EDITOR"];

export default async function SearchLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const token = cookieStore.get("ACCESS_TOKEN")?.value;

  if (!token) {
    return <UnauthorizedPage />;
  }

  const user = await verifyAccessToken(token);

  if (!user) {
    return <UnauthorizedPage />;
  }

  if (!allowedRoles.includes(user.role)) {
    return <ForbiddenPage role={user.role} allowRoles={allowedRoles} />;
  }

  return <>{children}</>;
}
