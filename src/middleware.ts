import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Todo salvo estaticos y el service worker, que tiene que servirse tal cual.
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.json|icon.svg|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
