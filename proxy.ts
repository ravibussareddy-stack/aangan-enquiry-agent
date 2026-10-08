import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth/server";

const protect = auth.middleware({ loginUrl: "/auth/sign-in" });

export default function proxy(req: NextRequest) {
  // Local preview only (see lib/auth/viewer.ts devViewerEnabled).
  if (process.env.NODE_ENV === "development" && process.env.DEV_VIEWER_ROLE === "founder") return NextResponse.next();
  return protect(req);
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
