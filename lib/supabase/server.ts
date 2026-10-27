import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

import { getSupabaseConfig } from "./config"

export async function createClient() {
  const cookieStore = await cookies()
  const { url, publishableKey } = getSupabaseConfig()

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options)
          })
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.startsWith(
              "Cookies can only be modified in a Server Action or Route Handler.",
            )
          ) {
            // proxy.ts refreshes cookies before read-only Server Components render.
            return
          }

          throw error
        }
      },
    },
  })
}
