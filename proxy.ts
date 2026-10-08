import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth/server";

const protect = auth.middleware({ loginUrl: "/auth/sign-in" });

/**
 * Canonical host: Neon Auth only accepts sign-in/sign-up from trusted origins,
 * and every Vercel deployment gets its own random URL. Send anyone who lands on
 * a non-canonical *.vercel.app address to APP_BASE_URL so auth always works.
 */
function canonicalRedirect(req: NextRequest): NextResponse | null {
  const base = process.env.APP_BASE_URL;
  if (!base) return null;
  let canonical: URL;
  try {
    canonical = new URL(base);
  } catch {
    return null;
  }
  const host = req.headers.get("x-forwarded-host") ?? req.nextUrl.host;
  if (host === canonical.host || !host.endsWith(".vercel.app")) return null;
  const to = new URL(req.nextUrl.pathname + req.nextUrl.search, canonical);
  return NextResponse.redirect(to, 308);
}

export default function proxy(req: NextRequest) {
  const redirect = canonicalRedirect(req);
  if (redirect) return redirect;
  if (req.nextUrl.pathname === "/" || req.nextUrl.pathname.startsWith("/auth")) return NextResponse.next();
  // Local preview only (see lib/auth/viewer.ts devViewerEnabled).
  if (process.env.NODE_ENV === "development" && process.env.DEV_VIEWER_ROLE === "founder") return NextResponse.next();
  return protect(req);
}

export const config = {
  matcher: ["/", "/dashboard/:path*", "/auth/:path*"],
};
