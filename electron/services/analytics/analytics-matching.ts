import type { VideoListItem } from '../../../shared/types/analytics'

export interface MatchablePublishRecord {
  id: string
  title: string
  created_at: string
  content_id: string | null
  publish_url: string | null
}

export function extractContentIdFromPublishUrl(platform: string, publishUrl?: string | null): string | null {
  if (!publishUrl) return null

  const patterns: Record<string, RegExp[]> = {
    douyin: [/\/video\/(\d+)/, /[?&](?:aweme_id|item_id)=(\d+)/],
    xiaohongshu: [/\/explore\/([^/?#]+)/, /\/discovery\/item\/([^/?#]+)/],
    'wechat-channels': [/\/post\/([^/?#]+)/, /[?&](?:objectId|feedId)=([^&#]+)/]
  }

  for (const pattern of patterns[platform] || []) {
    const match = publishUrl.match(pattern)
    if (match?.[1]) return decodeURIComponent(match[1])
  }
  return null
}

function normalizeTitle(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
}

function platformTitleWithoutHashtags(value: string): string {
  return normalizeTitle(value.split('#', 1)[0])
}

function titleMatches(recordTitle: string, platformTitle: string): boolean {
  const record = normalizeTitle(recordTitle)
  const platform = platformTitleWithoutHashtags(platformTitle)
  if (!record || !platform) return false
  if (record === platform) return true
  // Longer titles may have a description appended by the platform. Avoid
  // fuzzy matching very short names such as “测试”, which creates collisions.
  return record.length >= 4 && platform.startsWith(record)
}

export function chooseRecordForVideo(
  item: VideoListItem,
  records: MatchablePublishRecord[],
  usedRecordIds: Set<string>
): MatchablePublishRecord | null {
  const candidates = records.filter((record) =>
    !usedRecordIds.has(record.id) &&
    !record.content_id &&
    titleMatches(record.title, item.title)
  )
  if (candidates.length === 0) return null

  if (item.publishTime > 0) {
    const itemTime = item.publishTime * 1000
    candidates.sort((a, b) =>
      Math.abs(Date.parse(a.created_at) - itemTime) - Math.abs(Date.parse(b.created_at) - itemTime)
    )
  } else {
    candidates.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  }
  return candidates[0]
}
