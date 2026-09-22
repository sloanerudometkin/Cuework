import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic gate only: sends visitors without a session cookie to /login before
 * any page renders. The real check (signature + membership) is in requireWorkspace().
 */
export function proxy(request: NextRequest) {
  if (!request.cookies.get("cw_session")?.value) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/overview/:path*", "/recommendations/:path*", "/plan/:path*", "/work/:path*", "/performance/:path*", "/brief/:path*", "/import/:path*", "/settings/:path*"],
};
