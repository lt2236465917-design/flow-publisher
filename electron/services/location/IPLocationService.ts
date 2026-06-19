import axios from 'axios'
import { logger } from '../../utils/logger'

export interface IPLocationResult {
  lat: number
  lng: number
  city?: string
  province?: string
  country?: string
}

/**
 * IP定位服务
 * 通过IP地址获取用户大致位置
 */
export class IPLocationService {
  private cachedLocation: IPLocationResult | null = null
  private cacheTime = 0
  private readonly CACHE_TTL = 5 * 60 * 1000 // 5分钟缓存

  /**
   * 获取当前IP定位信息
   * 使用支持 HTTPS 的定位服务，失败时回退到备用服务
   */
  async getLocation(): Promise<IPLocationResult> {
    // 检查缓存
    if (this.cachedLocation && Date.now() - this.cacheTime < this.CACHE_TTL) {
      logger.debug('[IPLocationService] Using cached location')
      return this.cachedLocation
    }

    // 尝试多个IP定位服务
    const providers = [
      this.getFromIpSb.bind(this),
      this.getFromIpApiCo.bind(this)
    ]

    for (const provider of providers) {
      try {
        const location = await provider()
        if (location) {
          this.cachedLocation = location
          this.cacheTime = Date.now()
          logger.info(`[IPLocationService] Location obtained: ${location.city}, ${location.province}`)
          return location
        }
      } catch (err) {
        logger.warn('[IPLocationService] Provider failed:', err)
        continue
      }
    }

    // 所有服务都失败，返回默认位置（北京）
    logger.warn('[IPLocationService] All providers failed, using default location')
    return {
      lat: 39.9042,
      lng: 116.4074,
      city: '北京',
      province: '北京市',
      country: '中国'
    }
  }

  /**
   * 使用 ipapi.co 获取定位（HTTPS）
   */
  private async getFromIpApiCo(): Promise<IPLocationResult | null> {
    try {
      const response = await axios.get<{
        latitude: number
        longitude: number
        city: string
        region: string
        country_name: string
        error?: boolean
      }>('https://ipapi.co/json/', {
        timeout: 5000
      })

      if (!response.data.error && response.data.latitude && response.data.longitude) {
        return {
          lat: response.data.latitude,
          lng: response.data.longitude,
          city: response.data.city,
          province: response.data.region,
          country: response.data.country_name
        }
      }
      return null
    } catch (err) {
      logger.debug('[IPLocationService] ipapi.co failed:', err)
      return null
    }
  }

  /**
   * 使用ip.sb获取定位（备用）
   */
  private async getFromIpSb(): Promise<IPLocationResult | null> {
    try {
      const response = await axios.get<{
        latitude: number
        longitude: number
        city: string
        region: string
        country: string
      }>('https://api.ip.sb/geoip', {
        timeout: 5000
      })

      if (response.data.latitude && response.data.longitude) {
        return {
          lat: response.data.latitude,
          lng: response.data.longitude,
          city: response.data.city,
          province: response.data.region,
          country: response.data.country
        }
      }
      return null
    } catch (err) {
      logger.debug('[IPLocationService] ip.sb failed:', err)
      return null
    }
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cachedLocation = null
    this.cacheTime = 0
  }
}

// 单例实例
export const ipLocationService = new IPLocationService()
