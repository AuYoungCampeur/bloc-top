import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getCragById, getRoutesByCragId } from '@/lib/db'
import CragDetailClient from './crag-detail-client'

// Database content is read at request time; building does not need database credentials.
export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params
  const crag = await getCragById(id)

  if (!crag) {
    return {
      title: '岩场不存在 - 寻岩记',
    }
  }

  return {
    title: `${crag.name} - 寻岩记`,
    description: crag.description.slice(0, 160),
    openGraph: {
      title: `${crag.name} - 寻岩记`,
      description: crag.description.slice(0, 160),
      type: 'article',
    },
  }
}

export default async function CragDetailPage({ params }: PageProps) {
  const { id } = await params
  const [crag, routes] = await Promise.all([
    getCragById(id),
    getRoutesByCragId(id),
  ])

  if (!crag) {
    notFound()
  }

  return <CragDetailClient crag={crag} routes={routes} />
}
