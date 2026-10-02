import { toNextJsHandler } from 'better-auth/next-js'

type Auth = Parameters<typeof toNextJsHandler>[0]

/** Keep session/token responses and failures out of browser/CDN caches. */
export function createAuthRouteHandlers(getAuth: () => Promise<Auth>, label: string) {
  async function handle(req: Request, method: 'GET' | 'POST'): Promise<Response> {
    try {
      const auth = await getAuth()
      const response = await toNextJsHandler(auth)[method](req)
      // Clone headers because redirects or adapter responses may be immutable.
      const headers = new Headers(response.headers)
      headers.set('Cache-Control', 'private, no-store, max-age=0')
      return new Response(response.body, {
        status: response.status, statusText: response.statusText, headers,
      })
    } catch (error) {
      console.error(`[${label}] ${method} failed:`, error)
      return Response.json({ error: 'Auth initialization failed' }, {
        status: 500, headers: { 'Cache-Control': 'private, no-store, max-age=0' },
      })
    }
  }
  return {
    GET: (req: Request) => handle(req, 'GET'),
    POST: (req: Request) => handle(req, 'POST'),
  }
}
