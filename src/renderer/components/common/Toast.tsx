import React, { useState, useEffect, useCallback } from 'react'

export interface ToastData {
  id: string
  message: string
  type: 'info' | 'success' | 'error'
  duration?: number
}

interface ToastContainerProps {
  toasts: ToastData[]
  onDismiss: (id: string) => void
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  return (
    <div className="fixed bottom-8 right-4 z-[60] flex flex-col gap-2 pointer-events-none">
      {toasts.map(toast => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

function ToastItem({ toast, onDismiss }: { toast: ToastData; onDismiss: (id: string) => void }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true))
    const timer = setTimeout(() => {
      setVisible(false)
      setTimeout(() => onDismiss(toast.id), 200)
    }, toast.duration || 4000)
    return () => clearTimeout(timer)
  }, [toast.id, toast.duration, onDismiss])

  const colors = {
    info: 'bg-surface-dark-1 border-surface-dark-3 text-gray-200',
    success: 'bg-emerald-900/80 border-emerald-700/50 text-emerald-100',
    error: 'bg-red-900/80 border-red-700/50 text-red-100'
  }

  const icons = {
    info: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
    ),
    success: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20 6L9 17l-5-5" /></svg>
    ),
    error: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><path d="M15 9l-6 6M9 9l6 6" /></svg>
    )
  }

  return (
    <div
      className={`pointer-events-auto flex items-center gap-2.5 px-3 py-2.5 rounded-lg border shadow-xl backdrop-blur-sm transition-all duration-200 ${colors[toast.type]} ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
      }`}
    >
      <span className="flex-shrink-0">{icons[toast.type]}</span>
      <span className="text-xs font-medium">{toast.message}</span>
      <button onClick={() => { setVisible(false); setTimeout(() => onDismiss(toast.id), 200) }} className="ml-1 opacity-50 hover:opacity-100 flex-shrink-0">
        <svg width="10" height="10" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1 1l6 6M7 1L1 7" /></svg>
      </button>
    </div>
  )
}

// Hook for managing toasts
export function useToasts() {
  const [toasts, setToasts] = useState<ToastData[]>([])

  const addToast = useCallback((message: string, type: ToastData['type'] = 'info', duration?: number) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    setToasts(prev => [...prev, { id, message, type, duration }])
  }, [])

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return { toasts, addToast, dismissToast }
}
