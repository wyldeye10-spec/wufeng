/**
 * 字符计数：
 * - 使用 Intl.Segmenter 按字形簇（grapheme）计数，中文、英文、Emoji、组合符号均按“用户可感知的一个字”计算。
 * - 退化路径使用 Array.from（码点），覆盖不支持 Segmenter 的旧浏览器。
 */
let segmenter: Intl.Segmenter | null = null

try {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    segmenter = new Intl.Segmenter('zh-Hans', { granularity: 'grapheme' })
  }
} catch {
  segmenter = null
}

export function splitGraphemes(value: string): string[] {
  if (!value) return []
  if (segmenter) {
    return Array.from(segmenter.segment(value), (part) => part.segment)
  }
  return Array.from(value)
}

export function countChars(value: string): number {
  return splitGraphemes(value).length
}

/** 截断到最多 max 个字形簇，绝不拆断 Emoji 组合或代理对。 */
export function clampChars(value: string, max: number): string {
  if (!value) return value
  const parts = splitGraphemes(value)
  if (parts.length <= max) return value
  return parts.slice(0, max).join('')
}

export function isBlank(value: string): boolean {
  return value.trim().length === 0
}
