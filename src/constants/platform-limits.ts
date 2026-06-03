/**
 * 各平台标题、描述、话题标签的字数和数量限制
 * 数据来源：各平台创作者服务中心 + 蚁小二验证
 */

export interface PlatformLimits {
  /** 标题最大字数 */
  titleMaxLength: number
  /** 标题最小字数（0 = 无限制） */
  titleMinLength: number
  /** 描述最大字数 */
  descriptionMaxLength: number
  /** 话题标签单个最大字数 */
  hashtagMaxLength: number
  /** 话题标签最大数量 */
  hashtagMaxCount: number
  /** 平台提示信息 */
  tips?: {
    title?: string
    description?: string
    hashtag?: string
  }
}

/** 平台ID到中文名称的映射 */
const PLATFORM_NAMES: Record<string, string> = {
  douyin: '抖音',
  kuaishou: '快手',
  'wechat-channels': '视频号',
  xiaohongshu: '小红书',
}

export const PLATFORM_LIMITS: Record<string, PlatformLimits> = {
  douyin: {
    titleMaxLength: 55,
    titleMinLength: 0,
    descriptionMaxLength: 1000,
    hashtagMaxLength: 20,
    hashtagMaxCount: 5,
    tips: {
      title: '抖音标题建议控制在40字以内，超过会被折叠显示',
      description: '抖音描述最多1000字（含标题和话题标签）',
      hashtag: '抖音话题标签建议3-5个，每个不超过20字',
    },
  },
  kuaishou: {
    titleMaxLength: 30,
    titleMinLength: 0,
    descriptionMaxLength: 500,
    hashtagMaxLength: 15,
    hashtagMaxCount: 10,
    tips: {
      title: '快手标题最多30字',
      description: '快手描述最多500字（标题+描述合并为caption）',
      hashtag: '快手话题标签最多10个，每个不超过15字',
    },
  },
  'wechat-channels': {
    titleMaxLength: 20,
    titleMinLength: 6,
    descriptionMaxLength: 200,
    hashtagMaxLength: 10,
    hashtagMaxCount: 10,
    tips: {
      title: '视频号标题需要6-20个字',
      description: '视频号描述最多200字',
      hashtag: '视频号话题标签最多10个，每个不超过10字',
    },
  },
  xiaohongshu: {
    titleMaxLength: 20,
    titleMinLength: 0,
    descriptionMaxLength: 1500,
    hashtagMaxLength: 10,
    hashtagMaxCount: 10,
    tips: {
      title: '小红书标题最多20字',
      description: '小红书描述最多1500字',
      hashtag: '小红书话题标签最多10个，每个不超过10字',
    },
  },
}

/** 获取平台中文名称 */
export function getPlatformName(platformId: string): string {
  return PLATFORM_NAMES[platformId] || platformId
}

/**
 * 获取多平台合并后的最严格限制
 * 当用户选择多个平台时，取各平台限制的最小值
 */
export function getMergedLimits(platformIds: string[]): PlatformLimits {
  const defaultLimits: PlatformLimits = {
    titleMaxLength: 100,
    titleMinLength: 0,
    descriptionMaxLength: 2000,
    hashtagMaxLength: 30,
    hashtagMaxCount: 10,
  }

  if (!platformIds || platformIds.length === 0) {
    return defaultLimits
  }

  const limits = platformIds
    .map((id) => PLATFORM_LIMITS[id])
    .filter(Boolean)

  if (limits.length === 0) {
    return defaultLimits
  }

  return {
    titleMaxLength: Math.min(...limits.map((l) => l.titleMaxLength)),
    titleMinLength: Math.max(...limits.map((l) => l.titleMinLength)),
    descriptionMaxLength: Math.min(...limits.map((l) => l.descriptionMaxLength)),
    hashtagMaxLength: Math.min(...limits.map((l) => l.hashtagMaxLength)),
    hashtagMaxCount: Math.min(...limits.map((l) => l.hashtagMaxCount)),
  }
}

/**
 * 验证标题是否符合平台限制
 * 返回具体超出限制的平台名称和限制值
 */
export function validateTitle(
  title: string,
  platformIds: string[]
): { valid: boolean; message?: string } {
  const trimmed = title.trim()

  if (platformIds.length === 0) {
    return { valid: true }
  }

  // 检查每个平台，找出超出限制的平台
  const exceededPlatforms: string[] = []
  let minMaxLength = Infinity
  let maxMinLength = 0

  for (const id of platformIds) {
    const limits = PLATFORM_LIMITS[id]
    if (!limits) continue

    // 检查最大字数
    if (trimmed.length > limits.titleMaxLength) {
      exceededPlatforms.push(
        `${getPlatformName(id)}(最多${limits.titleMaxLength}字)`
      )
    }
    minMaxLength = Math.min(minMaxLength, limits.titleMaxLength)

    // 检查最小字数
    if (limits.titleMinLength > 0 && trimmed.length < limits.titleMinLength) {
      exceededPlatforms.push(
        `${getPlatformName(id)}(至少${limits.titleMinLength}字)`
      )
    }
    maxMinLength = Math.max(maxMinLength, limits.titleMinLength)
  }

  if (trimmed.length > 0 && trimmed.length < maxMinLength) {
    const platforms = platformIds
      .filter((id) => PLATFORM_LIMITS[id]?.titleMinLength > 0)
      .map((id) => `${getPlatformName(id)}(至少${PLATFORM_LIMITS[id]!.titleMinLength}字)`)
      .join('、')
    return {
      valid: false,
      message: `标题不符合${platforms}的要求`,
    }
  }

  if (trimmed.length > minMaxLength) {
    return {
      valid: false,
      message: `标题超出${exceededPlatforms.join('、')}的限制`,
    }
  }

  return { valid: true }
}

/**
 * 验证描述是否符合平台限制
 * 返回具体超出限制的平台名称和限制值
 */
export function validateDescription(
  description: string,
  platformIds: string[]
): { valid: boolean; message?: string } {
  const trimmed = description.trim()

  if (platformIds.length === 0 || trimmed.length === 0) {
    return { valid: true }
  }

  // 检查每个平台，找出超出限制的平台
  const exceededPlatforms: string[] = []

  for (const id of platformIds) {
    const limits = PLATFORM_LIMITS[id]
    if (!limits) continue

    if (trimmed.length > limits.descriptionMaxLength) {
      exceededPlatforms.push(
        `${getPlatformName(id)}(最多${limits.descriptionMaxLength}字)`
      )
    }
  }

  if (exceededPlatforms.length > 0) {
    return {
      valid: false,
      message: `描述超出${exceededPlatforms.join('、')}的限制`,
    }
  }

  return { valid: true }
}

/**
 * 验证话题标签是否符合平台限制
 * 返回具体超出限制的平台名称和限制值
 */
export function validateHashtags(
  hashtags: string[],
  platformIds: string[]
): { valid: boolean; message?: string } {
  if (platformIds.length === 0 || hashtags.length === 0) {
    return { valid: true }
  }

  // 检查标签数量
  const exceededCountPlatforms: string[] = []
  for (const id of platformIds) {
    const limits = PLATFORM_LIMITS[id]
    if (!limits) continue

    if (hashtags.length > limits.hashtagMaxCount) {
      exceededCountPlatforms.push(
        `${getPlatformName(id)}(最多${limits.hashtagMaxCount}个)`
      )
    }
  }

  if (exceededCountPlatforms.length > 0) {
    return {
      valid: false,
      message: `话题标签数量超出${exceededCountPlatforms.join('、')}的限制`,
    }
  }

  // 检查每个标签的字数
  for (const tag of hashtags) {
    const exceededLengthPlatforms: string[] = []
    for (const id of platformIds) {
      const limits = PLATFORM_LIMITS[id]
      if (!limits) continue

      if (tag.length > limits.hashtagMaxLength) {
        exceededLengthPlatforms.push(
          `${getPlatformName(id)}(最多${limits.hashtagMaxLength}字)`
        )
      }
    }

    if (exceededLengthPlatforms.length > 0) {
      return {
        valid: false,
        message: `标签「${tag}」超出${exceededLengthPlatforms.join('、')}的限制`,
      }
    }
  }

  return { valid: true }
}
