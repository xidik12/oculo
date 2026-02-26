import React, { useState, useEffect } from 'react'

interface DownloadItem {
  id: string
  filename: string
  url: string
  savePath: string
  totalBytes: number
  receivedBytes: number
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted'
  startTime: number
}

interface DownloadsPanelProps {
  isOpen: boolean
  onClose: () => void
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

export default function DownloadsPanel({ isOpen, onClose }: DownloadsPanelProps) {
  const [downloads, setDownloads] = useState<DownloadItem[]>([])

  useEffect(() => {
    if (!isOpen) return
    loadDownloads()
    const interval = setInterval(loadDownloads, 1000)
    return () => clearInterval(interval)
  }, [isOpen])

  async function loadDownloads() {
    const api = (window as any).oculo
    if (!api?.downloadsList) return
    const list = await api.downloadsList()
    setDownloads(list || [])
  }

  async function handleOpen(savePath: string) {
    const api = (window as any).oculo
    api?.downloadsOpen?.(savePath)
  }

  async function handleCancel(id: string) {
    const api = (window as any).oculo
    api?.downloadsCancel?.(id)
  }

  if (!isOpen) return null

  return (
    <div className="absolute left-[var(--sidebar-expanded)] top-0 bottom-0 w-[300px] bg-white dark:bg-surface-dark-0 border-r border-surface-3 dark:border-surface-dark-3 z-40 flex flex-col shadow-xl">
      {/* Header */}
      <div className="flex items-center h-[48px] px-3 border-b border-surface-3 dark:border-surface-dark-3 flex-shrink-0">
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex-1">Downloads</span>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded hover:bg-surface-3 dark:hover:bg-surface-dark-3 text-gray-500">
          <svg width="10" height="10" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1 1l6 6M7 1L1 7" /></svg>
        </button>
      </div>

      {/* Downloads list */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {downloads.length === 0 ? (
          <div className="flex items-center justify-center h-[100px] text-sm text-gray-400">
            No downloads
          </div>
        ) : (
          downloads.map(dl => {
            const progress = dl.totalBytes > 0 ? (dl.receivedBytes / dl.totalBytes) * 100 : 0
            return (
              <div key={dl.id} className="mb-2 p-2 rounded-md bg-surface-2 dark:bg-surface-dark-2">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-900 dark:text-gray-100 truncate font-medium">{dl.filename}</p>
                    {dl.state === 'progressing' && (
                      <>
                        <div className="mt-1 h-[3px] bg-surface-3 dark:bg-surface-dark-3 rounded-full overflow-hidden">
                          <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${progress}%` }} />
                        </div>
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          {formatBytes(dl.receivedBytes)} / {formatBytes(dl.totalBytes)}
                        </p>
                      </>
                    )}
                    {dl.state === 'completed' && (
                      <p className="text-[10px] text-emerald-500 mt-0.5">{formatBytes(dl.totalBytes)} - Complete</p>
                    )}
                    {dl.state === 'cancelled' && (
                      <p className="text-[10px] text-gray-400 mt-0.5">Cancelled</p>
                    )}
                    {dl.state === 'interrupted' && (
                      <p className="text-[10px] text-red-400 mt-0.5">Failed</p>
                    )}
                  </div>
                  <div className="flex-shrink-0">
                    {dl.state === 'progressing' ? (
                      <button onClick={() => handleCancel(dl.id)} className="w-6 h-6 flex items-center justify-center rounded hover:bg-surface-3 dark:hover:bg-surface-dark-3 text-gray-400" title="Cancel">
                        <svg width="10" height="10" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1 1l6 6M7 1L1 7" /></svg>
                      </button>
                    ) : dl.state === 'completed' ? (
                      <button onClick={() => handleOpen(dl.savePath)} className="w-6 h-6 flex items-center justify-center rounded hover:bg-surface-3 dark:hover:bg-surface-dark-3 text-accent" title="Open file">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" /></svg>
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
