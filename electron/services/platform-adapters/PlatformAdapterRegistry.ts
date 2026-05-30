import type { IPlatformAdapter } from './IPlatformAdapter'
import { logger } from '../../utils/logger'

const adapters = new Map<string, IPlatformAdapter>()

export function registerAdapter(adapter: IPlatformAdapter): void {
  adapters.set(adapter.platformId, adapter)
}

export function getAdapter(platformId: string): IPlatformAdapter | undefined {
  return adapters.get(platformId)
}

export function getAllAdapters(): IPlatformAdapter[] {
  return Array.from(adapters.values())
}

logger.info('Platform adapter registry initialized (API mode only)')
