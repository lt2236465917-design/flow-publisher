import { useEffect } from 'react'
import { useAccountStore } from '@/stores/accountStore'

interface QrCodeData {
  accountId: string
  platformId: string
  qrDataUrl: string | null
  fallbackMessage?: string
}

export function useQrCodeListener() {
  const setQrDataUrl = useAccountStore((s) => s.setQrDataUrl)

  useEffect(() => {
    const unsubscribe = window.electron.ipcRenderer.on(
      'account:qr-code',
      (...args: unknown[]) => {
        const data = args[0] as QrCodeData
        setQrDataUrl(data.platformId, data.qrDataUrl, data.fallbackMessage)
      }
    )
    return unsubscribe
  }, [setQrDataUrl])
}
