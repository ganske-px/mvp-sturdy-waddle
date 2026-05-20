import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';
import type { Database } from './types';
import { supabaseEnv } from './env';

const PUBLIC_PATHS = ['/login', '/auth', '/access-denied'];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(supabaseEnv.url(), supabaseEnv.anonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  if (user && !isPublic) {
    // Allowlist check: the trigger on auth.users creates the mirror row, but
    // a row may have been deleted by the admin to revoke access. RLS allows
    // the user to read only their own row, so an empty result means revoked.
    const { data: allowlistRow } = await supabase
      .from('users')
      .select('id')
      .eq('id', user.id)
      .maybeSingle();

    if (!allowlistRow) {
      const url = request.nextUrl.clone();
      url.pathname = '/access-denied';
      return NextResponse.redirect(url);
    }
  }

  if (user && pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  return response;
}
