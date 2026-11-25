import { NextResponse, type NextRequest } from "next/server";

/**
 * The UAR app is a single-route Next.js app — all navigation is hash-based
 * (#/programs/food-security, #/food-assistance/apply, #/admin/...).
 *
 * People (and printed QR codes / shared links) naturally type the path form
 * (e.g. /food-assistance/apply), which would otherwise 404. This middleware
 * redirects any clean path to its hash equivalent so both URL styles work:
 *   /food-assistance/apply   →  /#/food-assistance/apply
 *   /programs/food-security  →  /#/programs/food-security
 *   /admin/food              →  /#/admin/food
 *
 * API routes, Next internals and real files (uploads, favicon) pass through.
 */
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (pathname === "/") return NextResponse.next();
  return NextResponse.redirect(new URL(`/#${pathname}${search}`, req.url));
}

export const config = {
  matcher: ["/((?!api|_next|favicon.ico|robots.txt|sitemap.xml|.*\\..*).*)"],
};
