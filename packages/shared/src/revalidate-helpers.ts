import { revalidatePath } from 'next/cache'

const LOCALES = ['zh', 'en', 'fr'] as const

/**
 * Revalidate all locale versions of a crag detail page + home pages.
 * Call after any crag/route/face mutation.
 */
export function revalidateCragPages(cragId: string) {
  for (const locale of LOCALES) {
    revalidatePath(`/${locale}/crag/${cragId}`)
    revalidatePath(`/${locale}`)
    revalidatePath(`/${locale}/route`)
  }
}

/**
 * Revalidate all locale home pages.
 * Call after city/prefecture mutations that affect the home page listing.
 */
export function revalidateHomePage() {
  for (const locale of LOCALES) {
    revalidatePath(`/${locale}`)
  }
}
