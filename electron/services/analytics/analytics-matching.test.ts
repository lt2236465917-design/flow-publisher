import { describe, expect, it } from 'vitest'
import { chooseRecordForVideo, extractContentIdFromPublishUrl } from './analytics-matching'

describe('analytics record matching', () => {
  it('treats the publish URL content id as recoverable source data', () => {
    expect(extractContentIdFromPublishUrl(
      'douyin',
      'https://www.douyin.com/video/7650759151445953832'
    )).toBe('7650759151445953832')
  })

  it('does not treat Kuaishou short-video ids as analytics photo ids', () => {
    expect(extractContentIdFromPublishUrl(
      'kuaishou',
      'https://www.kuaishou.com/short-video/198737385978'
    )).toBeNull()
  })

  it('maps duplicate titles one-to-one using publish time proximity', () => {
    const records = [
      {
        id: 'older',
        title: '测试一条视频',
        created_at: '2026-06-10T03:38:49.621Z',
        content_id: null,
        publish_url: null
      },
      {
        id: 'newer',
        title: '测试一条视频',
        created_at: '2026-06-13T06:12:30.286Z',
        content_id: null,
        publish_url: null
      }
    ]
    const item = {
      contentId: 'video-1',
      title: '测试一条视频 #发布',
      publishTime: Date.parse('2026-06-13T06:15:00.000Z') / 1000,
      views: 10,
      likes: 2,
      comments: 0,
      shares: 0
    }
    const used = new Set<string>()

    expect(chooseRecordForVideo(item, records, used)?.id).toBe('newer')
    used.add('newer')
    expect(chooseRecordForVideo(item, records, used)?.id).toBe('older')
  })

  it('does not fuzzy-match short ambiguous titles', () => {
    const record = {
      id: 'short',
      title: '测试',
      created_at: '2026-06-12T06:05:21.801Z',
      content_id: null,
      publish_url: null
    }
    const item = {
      contentId: 'video-2',
      title: '测试一条视频',
      publishTime: 0,
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0
    }

    expect(chooseRecordForVideo(item, [record], new Set())).toBeNull()
  })
})
