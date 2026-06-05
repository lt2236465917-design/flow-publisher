/**
 * 视频数据采集服务
 *
 * 从各平台抓取已发布视频的播放数据（播放量、点赞、评论、分享），
 * 并存储到 analytics_snapshots 表用于统计分析。
 */

import { logger } from '../../utils/logger'
import { getAnalyticsRepository, getAccountRepository, getPublishRecordRepository, saveDatabase } from '../database'
import { getAdapter } from '../platform-adapters/PlatformAdapterRegistry'
import { HttpClient } from '../http/HttpClient'
import { CookieStore } from '../browser/CookieStore'
import type { CollectResult } from '../../../shared/types/analytics'

export class AnalyticsCollectorService {

  private cookieStore = new CookieStore()

  /**
   * 创建 HttpClient（通过 CookieStore 加载并解密 cookies）
   */
  private createClient(platform: string, accountId: string): HttpClient {
    const accountRepo = getAccountRepository()
    const account = accountRepo.getById(accountId)
    if (!account) {
      throw new Error(`账号 ${accountId} 不存在`)
    }

    // Use CookieStore to decrypt and format cookies (handles encrypted storage)
    const cookieStr = this.cookieStore.getCookieString(accountId)
    if (!cookieStr) {
      throw new Error(`账号 ${accountId} 缺少有效 cookies`)
    }

    return new HttpClient({
      cookies: cookieStr,
      platform,
      accountId
    })
  }

  /**
   * 采集单个账号下所有已发布视频的数据
   */
  async collectAccountData(accountId: string): Promise<CollectResult> {
    const result: CollectResult = {
      totalRecords: 0,
      updatedRecords: 0,
      newSnapshots: 0,
      errors: []
    }

    try {
      const accountRepo = getAccountRepository()
      const publishRecordRepo = getPublishRecordRepository()
      const analyticsRepo = getAnalyticsRepository()

      const account = accountRepo.getById(accountId)
      if (!account) {
        result.errors.push(`账号 ${accountId} 不存在`)
        return result
      }

      const adapter = getAdapter(account.platform as any)
      if (!adapter || !adapter.getVideoList) {
        result.errors.push(`平台 ${account.platform} 不支持数据采集`)
        return result
      }

      const client = this.createClient(account.platform, accountId)

      // 获取该账号所有已完成的发布记录
      const records = publishRecordRepo.getByAccount(accountId)
      const doneRecords = records.filter(r => r.status === 'done')
      result.totalRecords = doneRecords.length

      // 构建 contentId -> record 的映射
      const contentIdMap = new Map<string, typeof doneRecords[0]>()
      for (const record of doneRecords) {
        const contentId = (record as any).content_id
        if (contentId) {
          contentIdMap.set(contentId, record)
        }
      }

      // 从平台获取视频列表
      let cursor = ''
      let hasMore = true
      let fetchCount = 0
      const maxFetches = 10 // 防止无限循环

      // 记录数据库中的标题用于调试
      logger.info(`[AnalyticsCollector] 数据库标题: ${doneRecords.map(r => `"${r.title}"`).join(', ')}`)

      while (hasMore && fetchCount < maxFetches) {
        try {
          const listResult = await adapter.getVideoList(client, { cursor, pageSize: 20 })

          // 记录平台返回的标题用于调试
          if (fetchCount === 0) {
            logger.info(`[AnalyticsCollector] 平台标题: ${listResult.items.map(i => `"${i.title}"`).join(', ')}`)
          }

          for (const item of listResult.items) {
            // 先通过 contentId 匹配
            let record = contentIdMap.get(item.contentId)

            // 如果没有 contentId 匹配，尝试标题匹配（包含匹配）
            if (!record && item.title?.trim()) {
              const platformTitle = item.title.trim().toLowerCase()
              // 先尝试精确匹配
              record = doneRecords.find(r => r.title?.trim().toLowerCase() === platformTitle)
              // 如果没有精确匹配，尝试包含匹配（平台标题包含数据库标题）
              if (!record) {
                record = doneRecords.find(r => {
                  const dbTitle = r.title?.trim().toLowerCase()
                  return dbTitle && (platformTitle.startsWith(dbTitle) || platformTitle.includes(dbTitle))
                })
              }
              if (record) {
                // 标题匹配成功，更新 content_id
                analyticsRepo.updateRecordContentId(record.id, item.contentId)
                logger.info(`[AnalyticsCollector] 标题匹配成功: "${item.title}" -> "${record.title}" (${record.id})`)
              }
            }

            if (!record) continue

            // 创建快照
            analyticsRepo.createSnapshot({
              recordId: record.id,
              platform: account.platform,
              views: item.views,
              likes: item.likes,
              comments: item.comments,
              shares: item.shares,
              followers: item.favorites
            })
            result.newSnapshots++
            result.updatedRecords++
          }

          cursor = listResult.cursor
          hasMore = listResult.hasMore
          fetchCount++
        } catch (err: any) {
          const errorMsg = `采集 ${account.platform} 数据失败: ${err.message}`
          logger.error(errorMsg, err)
          result.errors.push(errorMsg)
          break
        }
      }

      saveDatabase()
      logger.info(`[AnalyticsCollector] 采集完成: ${account.platform} - 匹配 ${result.updatedRecords}/${result.totalRecords} 条记录, 新增 ${result.newSnapshots} 个快照`)
    } catch (err: any) {
      const errorMsg = `采集账号 ${accountId} 数据失败: ${err.message}`
      logger.error(errorMsg, err)
      result.errors.push(errorMsg)
    }

    return result
  }

  /**
   * 采集所有已登录账号的数据
   */
  async collectAllAccounts(): Promise<CollectResult> {
    const result: CollectResult = {
      totalRecords: 0,
      updatedRecords: 0,
      newSnapshots: 0,
      errors: []
    }

    try {
      const accountRepo = getAccountRepository()
      const accounts = accountRepo.getAll().filter(a => a.session_status === 'logged_in')

      for (const account of accounts) {
        const accountResult = await this.collectAccountData(account.id)
        result.totalRecords += accountResult.totalRecords
        result.updatedRecords += accountResult.updatedRecords
        result.newSnapshots += accountResult.newSnapshots
        result.errors.push(...accountResult.errors)
      }

      logger.info(`[AnalyticsCollector] 全部采集完成: 更新 ${result.updatedRecords} 条记录, 新增 ${result.newSnapshots} 个快照`)
    } catch (err: any) {
      const errorMsg = `采集所有账号数据失败: ${err.message}`
      logger.error(errorMsg, err)
      result.errors.push(errorMsg)
    }

    return result
  }

  /**
   * 采集单条发布记录的数据
   */
  async collectRecordData(recordId: string): Promise<CollectResult> {
    const result: CollectResult = {
      totalRecords: 1,
      updatedRecords: 0,
      newSnapshots: 0,
      errors: []
    }

    try {
      const publishRecordRepo = getPublishRecordRepository()
      const analyticsRepo = getAnalyticsRepository()

      const record = publishRecordRepo.getById(recordId)
      if (!record) {
        result.errors.push(`记录 ${recordId} 不存在`)
        return result
      }

      if (record.status !== 'done') {
        result.errors.push(`记录 ${recordId} 状态不是已完成`)
        return result
      }

      let contentId = (record as any).content_id

      // 如果没有 content_id，尝试通过平台视频列表匹配
      if (!contentId) {
        logger.info(`[AnalyticsCollector] 记录 ${recordId} 没有 content_id，尝试通过平台列表匹配...`)
        const matchedId = await this.findContentIdByTitle(record)
        if (matchedId) {
          contentId = matchedId
          // 保存匹配到的 content_id
          analyticsRepo.updateRecordContentId(recordId, contentId)
          logger.info(`[AnalyticsCollector] 通过标题匹配到 content_id: ${contentId}`)
        } else {
          result.errors.push(`记录 ${recordId} 没有平台内容ID，且无法通过标题匹配`)
          return result
        }
      }

      const adapter = getAdapter(record.platform as any)
      if (!adapter) {
        result.errors.push(`平台 ${record.platform} 不支持`)
        return result
      }

      // 优先使用 getVideoDetail，如果没有则使用 getVideoList 匹配
      const client = this.createClient(record.platform, record.account_id)

      if (adapter.getVideoDetail) {
        const detail = await adapter.getVideoDetail(client, contentId)
        if (detail) {
          analyticsRepo.createSnapshot({
            recordId: record.id,
            platform: record.platform,
            views: detail.views,
            likes: detail.likes,
            comments: detail.comments,
            shares: detail.shares,
            followers: detail.favorites
          })
          result.newSnapshots = 1
          result.updatedRecords = 1
          saveDatabase()
        }
      } else if (adapter.getVideoList) {
        // 从视频列表中查找匹配的视频
        const listResult = await adapter.getVideoList(client, { pageSize: 50 })
        const matched = listResult.items.find(item => item.contentId === contentId)
        if (matched) {
          analyticsRepo.createSnapshot({
            recordId: record.id,
            platform: record.platform,
            views: matched.views,
            likes: matched.likes,
            comments: matched.comments,
            shares: matched.shares,
            followers: matched.favorites
          })
          result.newSnapshots = 1
          result.updatedRecords = 1
          saveDatabase()
        } else {
          result.errors.push(`在平台视频列表中未找到匹配的视频`)
        }
      } else {
        result.errors.push(`平台 ${record.platform} 不支持数据采集`)
      }
    } catch (err: any) {
      const errorMsg = `采集记录 ${recordId} 数据失败: ${err.message}`
      logger.error(errorMsg, err)
      result.errors.push(errorMsg)
    }

    return result
  }

  /**
   * 通过标题匹配查找 content_id
   */
  private async findContentIdByTitle(record: any): Promise<string | null> {
    try {
      const adapter = getAdapter(record.platform as any)
      if (!adapter?.getVideoList) return null

      const client = this.createClient(record.platform, record.account_id)
      const listResult = await adapter.getVideoList(client, { pageSize: 50 })

      const recordTitle = record.title?.trim().toLowerCase()
      if (!recordTitle) return null

      // 尝试精确匹配
      let matched = listResult.items.find(item =>
        item.title?.trim().toLowerCase() === recordTitle
      )

      // 如果没有精确匹配，尝试包含匹配
      if (!matched) {
        matched = listResult.items.find(item => {
          const itemTitle = item.title?.trim().toLowerCase()
          return itemTitle && (itemTitle.includes(recordTitle) || recordTitle.includes(itemTitle))
        })
      }

      return matched?.contentId || null
    } catch (err) {
      logger.warn(`[AnalyticsCollector] 通过标题匹配 content_id 失败:`, err)
      return null
    }
  }

  /**
   * 从平台视频列表匹配并采集数据
   * 用于首次采集或 contentId 缺失时
   */
  async collectFromPlatformList(accountId: string): Promise<CollectResult> {
    const result: CollectResult = {
      totalRecords: 0,
      updatedRecords: 0,
      newSnapshots: 0,
      errors: []
    }

    try {
      const accountRepo = getAccountRepository()
      const publishRecordRepo = getPublishRecordRepository()
      const analyticsRepo = getAnalyticsRepository()

      const account = accountRepo.getById(accountId)
      if (!account) {
        result.errors.push(`账号 ${accountId} 不存在`)
        return result
      }

      const adapter = getAdapter(account.platform as any)
      if (!adapter || !adapter.getVideoList) {
        result.errors.push(`平台 ${account.platform} 不支持数据采集`)
        return result
      }

      const client = this.createClient(account.platform, accountId)

      // 获取该账号所有已完成的发布记录
      const records = publishRecordRepo.getByAccount(accountId)
      const doneRecords = records.filter(r => r.status === 'done')
      result.totalRecords = doneRecords.length

      // 从平台获取视频列表
      const listResult = await adapter.getVideoList(client, { pageSize: 50 })

      // 尝试匹配：先用 contentId，再用标题
      for (const item of listResult.items) {
        // 查找 contentId 匹配的记录
        let matchedRecord = doneRecords.find(r => (r as any).content_id === item.contentId)

        // 如果没有 contentId 匹配，尝试标题匹配
        if (!matchedRecord) {
          matchedRecord = doneRecords.find(r => {
            const recordTitle = r.title?.trim().toLowerCase()
            const itemTitle = item.title?.trim().toLowerCase()
            return recordTitle && itemTitle && recordTitle === itemTitle
          })

          // 如果标题匹配成功，更新 content_id
          if (matchedRecord && !(matchedRecord as any).content_id) {
            analyticsRepo.updateRecordContentId(matchedRecord.id, item.contentId)
            logger.info(`[AnalyticsCollector] 标题匹配成功: "${item.title}" -> ${matchedRecord.id}`)
          }
        }

        if (matchedRecord) {
          analyticsRepo.createSnapshot({
            recordId: matchedRecord.id,
            platform: account.platform,
            views: item.views,
            likes: item.likes,
            comments: item.comments,
            shares: item.shares,
            followers: item.favorites
          })
          result.newSnapshots++
          result.updatedRecords++
        }
      }

      saveDatabase()
      logger.info(`[AnalyticsCollector] 平台列表采集完成: ${account.platform} - 匹配 ${result.updatedRecords}/${result.totalRecords} 条记录`)
    } catch (err: any) {
      const errorMsg = `从平台列表采集数据失败: ${err.message}`
      logger.error(errorMsg, err)
      result.errors.push(errorMsg)
    }

    return result
  }
}
