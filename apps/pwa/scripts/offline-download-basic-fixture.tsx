/** Browser-only test harness. Never registered as a production application route. */
import { createRoot } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { ToastProvider } from '@/components/ui/toast'
import { OfflineDownloadProvider, useOfflineDownloadContext } from '@/components/offline-download-provider'
import { DownloadButton } from '@/components/download-button'
import { getCragOffline, OFFLINE_IMAGE_CACHE_NAME } from '@/lib/offline-storage'
import type { Crag } from '@/types'
import messages from '../messages/zh.json'

const id = 'download-fixture'
const crag: Crag = { id, name: '离线下载测试岩场', cityId: 'fixture-city', location: '本地', developmentTime: '2026', description: '卡片裁剪内容', approach: '' }

function Fixture() {
  const offline = useOfflineDownloadContext()
  return <main>
    <h1>{crag.name}</h1>
    {offline.isSupported && <DownloadButton crag={crag} routes={[]} isDownloaded={offline.isDownloaded(id)} progress={offline.downloadProgress} onDownload={offline.downloadCrag} onDelete={offline.deleteCrag} updateInfo={offline.getUpdateInfo(id)} />}
    <button type="button" onClick={() => void offline.deleteCrag(id)}>Delete fixture</button>
    <output data-testid="progress">{JSON.stringify(offline.downloadProgress)}</output>
    <output data-testid="downloads">{JSON.stringify(offline.offlineCrags)}</output>
    <a href={`/zh/offline?offlineCrag=${id}`}>Read offline fixture</a>
  </main>
}

Object.assign(window, {
  offlineFixture: {
    inspect: async () => ({ snapshot: await getCragOffline(id), images: (await (await caches.open(OFFLINE_IMAGE_CACHE_NAME)).keys()).map(request => request.url) }),

  },
})

createRoot(document.getElementById('fixture-root')!).render(
  <NextIntlClientProvider locale="zh" messages={messages}>
    <ToastProvider><OfflineDownloadProvider><Fixture /></OfflineDownloadProvider></ToastProvider>
  </NextIntlClientProvider>,
)
