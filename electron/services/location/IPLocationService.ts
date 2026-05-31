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
   * 优先使用ip-api.com，失败时回退到其他服务
   */
  async getLocation(): Promise<IPLocationResult> {
    // 检查缓存
    if (this.cachedLocation && Date.now() - this.cacheTime < this.CACHE_TTL) {
      logger.debug('[IPLocationService] Using cached location')
      return this.cachedLocation
    }

    // 尝试多个IP定位服务
    const providers = [
      this.getFromIpApi.bind(this),
      this.getFromIpSb.bind(this)
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
   * 使用ip-api.com获取定位
   */
  private async getFromIpApi(): Promise<IPLocationResult | null> {
    try {
      const response = await axios.get<{
        status: string
        lat: number
        lon: number
        city: string
        regionName: string
        country: string
      }>('http://ip-api.com/json/?lang=zh-CN', {
        timeout: 5000
      })

      if (response.data.status === 'success') {
        return {
          lat: response.data.lat,
          lng: response.data.lon,
          city: response.data.city,
          province: response.data.regionName,
          country: response.data.country
        }
      }
      return null
    } catch (err) {
      logger.debug('[IPLocationService] ip-api.com failed:', err)
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
