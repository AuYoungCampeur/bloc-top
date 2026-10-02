/** Bind an online image to the revision of its accompanying reading data.
 * Offline images already have their own offlineRevision and never use this helper.
 */
export function withMediaRevision(url: string, mediaRevision?: string): string {
  if (!mediaRevision) return url
  const result = new URL(url)
  result.searchParams.set('mr', mediaRevision)
  return result.href
}
