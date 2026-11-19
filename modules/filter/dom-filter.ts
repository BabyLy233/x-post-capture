import type { DomFilterRule, HideMode } from '@/types/settings'

export interface MaskRecord {
  id: string
  element: HTMLElement
  /** 屏蔽前 style 属性的快照；null 表示原本没有 style 属性 */
  originalStyle: string | null
  hideMode: HideMode
  label: string
  source: 'manual' | 'rule'
  saved: boolean
}

let maskCounter = 0

export function describeElement(element: Element): string {
  const testId = element.getAttribute('data-testid')
  if (testId) return `data-testid="${testId}"`
  const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim()
  if (text) return text.slice(0, 48)
  const tag = element.tagName.toLowerCase()
  const role = element.getAttribute('role')
  return role ? `${tag}[role="${role}"]` : tag
}

export function applyMask(
  element: HTMLElement,
  hideMode: HideMode,
  source: MaskRecord['source'],
): MaskRecord {
  const record: MaskRecord = {
    id: `mask-${++maskCounter}`,
    element,
    originalStyle: element.hasAttribute('style') ? element.getAttribute('style') : null,
    hideMode,
    label: describeElement(element),
    source,
    saved: false,
  }
  if (hideMode === 'remove-space') {
    element.style.setProperty('display', 'none', 'important')
  } else {
    element.style.setProperty('visibility', 'hidden', 'important')
  }
  return record
}

export function restoreMask(record: MaskRecord): void {
  const { element, originalStyle } = record
  if (!element.isConnected) return
  if (originalStyle === null) {
    element.removeAttribute('style')
  } else {
    element.setAttribute('style', originalStyle)
  }
}

export function restoreAllMasks(records: MaskRecord[]): void {
  for (const record of records) {
    try {
      restoreMask(record)
    } catch {
      // 元素可能已经被 X 的虚拟列表移除，忽略
    }
  }
}

const QUOTES_SELECTOR = 'a[href*="/quotes"]'

/**
 * 内置过滤：截图时默认去掉推文底部的「相关」下拉与「查看引用」入口。
 * 只匹配推文内的链接 / 按钮，不会误伤正文。
 */
export function applyBuiltinFilters(article: HTMLElement): MaskRecord[] {
  const records: MaskRecord[] = []
  const seen = new Set<HTMLElement>()
  const hide = (element: Element | null) => {
    if (!(element instanceof HTMLElement) || element === article) return
    if (seen.has(element)) return
    seen.add(element)
    records.push(applyMask(element, 'remove-space', 'rule'))
  }

  for (const link of Array.from(article.querySelectorAll<HTMLElement>(QUOTES_SELECTOR))) {
    hide(link)
  }
  for (const control of Array.from(
    article.querySelectorAll<HTMLElement>('a[role="button"], button, [role="button"]'),
  )) {
    const text = (control.textContent ?? '').replace(/\s+/g, '')
    if (!text) continue
    if (text === '相关' || text.startsWith('查看引用')) {
      hide(control)
    }
  }
  return records
}

/**
 * 在推文子树内应用已保存的过滤规则。返回本次实际应用到的记录。
 */
export function applyRulesToTweet(article: HTMLElement, rules: DomFilterRule[]): MaskRecord[] {
  const records: MaskRecord[] = []
  for (const rule of rules) {
    if (!rule.enabled) continue
    let matches: Element[] = []
    try {
      matches = Array.from(article.querySelectorAll(rule.selector))
    } catch {
      continue
    }
    for (const match of matches) {
      if (!(match instanceof HTMLElement)) continue
      if (match === article) continue
      records.push(applyMask(match, rule.hideMode, 'rule'))
    }
  }
  return records
}

/**
 * 生成只作用于目标推文子树的稳定选择器。
 * 优先使用 data-testid / role，避免依赖 X 随机哈希 class。
 */
export function buildSelectorWithin(element: HTMLElement, root: HTMLElement): string | null {
  if (element === root || !root.contains(element)) return null
  const preferred = buildPath(element, root, true)
  if (preferred && isUniqueWithin(preferred, root)) return preferred
  const fallback = buildPath(element, root, false)
  if (fallback && isUniqueWithin(fallback, root)) return fallback
  return null
}

function buildPath(
  element: HTMLElement,
  root: HTMLElement,
  preferAttributes: boolean,
): string | null {
  const parts: string[] = []
  let current: HTMLElement | null = element
  while (current && current !== root) {
    parts.unshift(selectorPart(current, preferAttributes))
    current = current.parentElement
  }
  if (current !== root || parts.length === 0) return null
  return parts.join(' > ')
}

function selectorPart(element: HTMLElement, preferAttributes: boolean): string {
  const tag = element.tagName.toLowerCase()
  if (preferAttributes) {
    const testId = element.getAttribute('data-testid')
    if (testId && /^[A-Za-z0-9_-]+$/.test(testId)) {
      return `${tag}[data-testid="${testId}"]`
    }
    const role = element.getAttribute('role')
    if (role && /^[A-Za-z-]+$/.test(role)) {
      return `${tag}[role="${role}"]`
    }
  }
  const parent = element.parentElement
  if (!parent) return tag
  const siblings = Array.from(parent.children).filter(
    (sibling) => sibling.tagName === element.tagName,
  )
  const index = siblings.indexOf(element) + 1
  return `${tag}:nth-of-type(${index})`
}

function isUniqueWithin(selector: string, root: HTMLElement): boolean {
  try {
    return root.querySelectorAll(selector).length === 1
  } catch {
    return false
  }
}

/** 从点击位置解析出应当屏蔽的块级元素 */
export function resolvePickTarget(target: Element, article: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = target instanceof HTMLElement ? target : target.parentElement
  while (current && current !== article) {
    const display = getComputedStyle(current).display
    if (
      display === 'block' ||
      display === 'flex' ||
      display === 'grid' ||
      display === 'list-item' ||
      display === 'table'
    ) {
      return current
    }
    current = current.parentElement
  }
  const fallback = target instanceof HTMLElement ? target : null
  return fallback && fallback !== article ? fallback : null
}
