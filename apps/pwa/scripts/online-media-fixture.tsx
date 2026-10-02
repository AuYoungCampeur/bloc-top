/** Browser source fixture. Not a production route; all data/media is loopback HTTP. */
import { createRoot } from 'react-dom/client'
import { useEffect, useMemo, useState } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { FaceImageProvider } from '@/components/face-image-provider'
import { FaceThumbnailStrip } from '@/components/face-thumbnail-strip'
import { RouteDetailDrawer } from '@/components/route-detail-drawer'
import { CoverCarousel } from '@/components/cover-carousel'
import { OfflineBrowser } from '@/components/offline-browser'
import { useOnlineCragContent } from '@/hooks/use-online-crag-content'
import { getCragCoverImages } from '@/lib/crag-cover-images'
import { collectRouteFaces } from '@/lib/route-face-filter'
import { downloadOfflineSnapshot } from '@/lib/offline-download'
import { getCragOffline, type OfflineCragData } from '@/lib/offline-storage'
import type { OnlineCragContent } from '@/lib/online-crag-content'
import messages from '../messages/zh.json'

declare global {
  interface Window {
    onlineMediaFixture: {
      seed: OnlineCragContent[]
      download: () => Promise<void>
      readDownload: () => Promise<OfflineCragData | null>
    }
  }
}

function Fixture() {
  const [cragId, setCragId] = useState('media-a')
  const seed = useMemo(() => window.onlineMediaFixture.seed.find(packet => packet.crag.id === cragId)!, [cragId])
  const content = useOnlineCragContent(cragId, seed) ?? seed
  const [routeId, setRouteId] = useState<number | null>(null)
  const [offlineData, setOfflineData] = useState<OfflineCragData | null>(null)
  const offlinePage = window.location.pathname.endsWith('/offline')
  useEffect(() => {
    if (offlinePage) void getCragOffline('media-a').then(data => setOfflineData(data ?? null))
  }, [offlinePage])
  if (offlinePage) return offlineData ? <OfflineBrowser data={offlineData} routeId={routeId ?? undefined} onRouteSelect={setRouteId} onBack={() => setRouteId(null)} /> : <p>Reading download</p>
  const route = content.routes.find(item => item.id === routeId) ?? null
  return <>
    <button onClick={() => { setCragId(cragId === 'media-a' ? 'media-b' : 'media-a'); setRouteId(null) }}>Switch crag</button>
    <output id="reading-packet">{JSON.stringify(content)}</output>
    <section id="covers" style={{ width: 240, height: 192 }}><CoverCarousel images={getCragCoverImages(content.crag)} alt="online cover" /></section>
    <section id="thumbnails"><FaceThumbnailStrip faces={collectRouteFaces(content.routes, cragId)} selectedCrag={cragId} selectedFace={null} onFaceSelect={() => {}} mediaRevision={content.crag.mediaRevision} /></section>
    <section>{content.routes.map(item => <button key={item.id} onClick={() => setRouteId(item.id)}>Show {item.name}</button>)}</section>
    <RouteDetailDrawer isOpen={route !== null} route={route} crag={content.crag} readingContent={content} onClose={() => setRouteId(null)} onRouteChange={item => setRouteId(item.id)} />
  </>
}

Object.assign(window.onlineMediaFixture, {
  download: async () => { await downloadOfflineSnapshot('media-a', () => {}) },
  readDownload: () => getCragOffline('media-a'),
})

createRoot(document.getElementById('fixture-root')!).render(<NextIntlClientProvider locale="zh" messages={messages}>
  <FaceImageProvider><Fixture /></FaceImageProvider>
</NextIntlClientProvider>)
