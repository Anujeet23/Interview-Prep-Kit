import { NextResponse } from 'next/server';

/**
 * First line of defence for pages: no session cookie -> sign-in page.
 * (The API still verifies the token on every request; this just avoids flashing a
 * protected page at a signed-out visitor.)
 */
export function middleware(req) {
  if (!req.cookies.get('ipk_session')) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(req.nextUrl.pathname)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/kits/:path*'] };
