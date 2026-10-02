import { NextResponse } from 'next/server'
import { readOfflineSnapshot } from '@/lib/offline-snapshot'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const snapshot = await readOfflineSnapshot((await params).id)
    return NextResponse.json(snapshot ? { success: true, snapshot } : { success: false }, {
      status: snapshot ? 200 : 404,
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch {
    return NextResponse.json({ success: false }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }
}
