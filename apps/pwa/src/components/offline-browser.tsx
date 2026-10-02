'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { Route } from '@/types'
import { getRouteFaceIdentities, getRouteTopoAnnotations } from '@bloctop/shared/face-references'
import { getFaceTopoUrl, getRouteTopoUrl } from '@/lib/constants'
import { OFFLINE_IMAGE_CACHE_NAME, type OfflineCragData } from '@/lib/offline-storage'
import { TopoLineOverlay } from '@/components/topo-line-overlay'
import { getGradeColor } from '@/lib/tokens'

function sameImage(a: string, b: string) {
  return new URL(a).origin === new URL(b).origin && new URL(a).pathname === new URL(b).pathname
}

/** Read cached bytes directly; no optimizer, network request or SW mode conversion. */
function CachedImage({ cacheUrl, alt, points, color, tension }: {
  cacheUrl: string; alt: string; points?: { x: number; y: number }[]; color?: string; tension?: number
}) {
  const t = useTranslations('Offline')
  const [image, setImage] = useState<{ key: string; src: string } | null>(null)
  const [ratio, setRatio] = useState<number | undefined>()
  useEffect(() => {
    let active = true
    let blobUrl: string | undefined
    void (async () => {
      try {
        const response = await (await caches.open(OFFLINE_IMAGE_CACHE_NAME)).match(cacheUrl)
        if (!response?.ok || response.type === 'opaque') return
        blobUrl = URL.createObjectURL(await response.blob())
        if (active) setImage({ key: cacheUrl, src: blobUrl })
        else URL.revokeObjectURL(blobUrl)
      } catch { /* Missing images remain visibly unavailable. */ }
    })()
    return () => { active = false; if (blobUrl) URL.revokeObjectURL(blobUrl) }
  }, [cacheUrl])
  const src = image?.key === cacheUrl ? image.src : null
  return src ? (
    <div className="relative w-full">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="w-full max-h-[60vh] object-contain" onLoad={event => setRatio(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)} />
      {points && points.length >= 2 && <TopoLineOverlay points={points} color={color ?? '#fff'} tension={tension} objectFit="contain" aspectRatio={ratio} />}
    </div>
  ) : <p className="text-sm py-3">{t('imageUnavailable')}</p>
}

export function OfflineBrowser({ data, routeId, onRouteSelect, onBack }: {
  data: OfflineCragData; routeId?: number; onRouteSelect: (id: number) => void; onBack: () => void
}) {
  const t = useTranslations('Offline')
  const route = data.routes.find(item => item.id === routeId)
  const cacheUrlFor = (source: string) => data.images?.find(image => sameImage(image.sourceUrl, source))?.cacheUrl ?? source
  return (
    <main className="h-dvh overflow-y-auto px-4 pt-14 pb-24">
      <button className="glass-light px-3 py-2 mb-4 rounded-lg" onClick={onBack}>{t('back')}</button>
      {data.schemaVersion !== 2 && <p role="status" className="mb-4">{t('legacyRepair')}</p>}
      <h1 className="text-2xl font-bold mb-3">{route?.name ?? data.crag.name}</h1>
      {routeId !== undefined && !route ? <p role="alert">{t('routeMissing')}</p> : route ? (
        <OfflineRoute route={route} cacheUrlFor={cacheUrlFor} />
      ) : (
        <>
          {data.images?.filter(image => new URL(image.sourceUrl).pathname.startsWith(`/CragSurface/${data.cragId}/`)).map(image => (
            <CachedImage key={image.cacheUrl} cacheUrl={image.cacheUrl} alt={data.crag.name} />
          ))}
          <p className="whitespace-pre-wrap my-4">{data.crag.description}</p>
          <p className="whitespace-pre-wrap my-4">{data.crag.approach}</p>
          <h2 className="text-lg font-semibold mb-3">{t('localRoutes', { count: data.routes.length })}</h2>
          <div className="space-y-2">
            {data.routes.map(item => <button key={item.id} className="glass w-full p-3 rounded-xl text-left" onClick={() => onRouteSelect(item.id)}>{item.grade} · {item.name}</button>)}
          </div>
        </>
      )}
    </main>
  )
}

function OfflineRoute({ route, cacheUrlFor }: { route: Route; cacheUrlFor: (source: string) => string }) {
  const t = useTranslations('Offline')
  const faces = getRouteFaceIdentities(route)
  const annotations = getRouteTopoAnnotations(route)
  const sources = faces.length ? faces.map(face => getFaceTopoUrl(face.cragId, face.area, face.faceId)) : [getRouteTopoUrl(route.cragId, route.name)]
  return <>
    <p className="mb-3">{route.grade} · {route.area}</p>
    {sources.map((source, index) => {
      const annotation = annotations.find(item => sameImage(getFaceTopoUrl(route.cragId, item.area, item.faceId), source))
      return <CachedImage key={cacheUrlFor(source)} cacheUrl={cacheUrlFor(source)} alt={`${route.name} ${index + 1}`} points={annotation?.topoLine ?? (!faces.length ? route.topoLine : undefined)} tension={annotation?.topoTension ?? route.topoTension} color={getGradeColor(route.grade)} />
    })}
    <p className="whitespace-pre-wrap my-4">{route.description}</p>
    {route.setter && <p>{route.setter}</p>}
    {route.FA && <p>FA: {route.FA}</p>}
    <p className="text-sm mt-4">{t('onlineFeaturesUnavailable')}</p>
  </>
}
