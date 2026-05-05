import { useEffect } from 'react'
import { useAccountStore } from '@/stores/accountStore'

export function useQrCodeListener() {
  const setQrDataUrl = useAccountStore((s) => s.setQrDataUrl)

  useEffect(() => {
    const unsubscribe = window.electron.ipcRenderer.on(
      'account:qr-code',
      (data: { accountId: string; platformId: string; qrDataUrl: string }) => {
        setQrDataUrl(data.platformId, data.qrDataUrl)
      }
    )
    return unsubscribe
  }, [setQrDataUrl])
}
