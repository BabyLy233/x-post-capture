import { isOwnElement, TWEET_ARTICLE_SELECTOR } from '@/modules/tweet/tweet-detector'

import { resolvePickTarget } from './dom-filter'

export interface ElementPickerOptions {
  getArticle: () => HTMLElement | null
  onHighlight: (rect: DOMRect | null, element: HTMLElement | null) => void
  onPick: (element: HTMLElement) => void
  onExit: () => void
}

/**
 * 元素选择模式：高亮鼠标下的推文内部节点，点击后交给调用方屏蔽。
 * 使用捕获阶段拦截点击，避免触发 X 自身的交互。
 */
export class ElementPicker {
  private active = false
  private hovered: HTMLElement | null = null

  private readonly handlePointerMove = (event: PointerEvent) => {
    if (!this.active) return
    const candidate = this.resolveEventTarget(event)
    if (candidate === this.hovered) return
    this.hovered = candidate
    this.options.onHighlight(candidate ? candidate.getBoundingClientRect() : null, candidate)
  }

  private readonly handleClick = (event: MouseEvent) => {
    if (!this.active) return
    if (this.isOwnEvent(event)) return
    const candidate = this.resolveEventTarget(event)
    if (!candidate) return
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    this.options.onPick(candidate)
  }

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (!this.active) return
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    this.exit()
  }

  constructor(private readonly options: ElementPickerOptions) {}

  get isActive(): boolean {
    return this.active
  }

  start(): void {
    if (this.active) return
    this.active = true
    document.addEventListener('pointermove', this.handlePointerMove, true)
    document.addEventListener('click', this.handleClick, true)
    document.addEventListener('keydown', this.handleKeyDown, true)
    document.documentElement.style.setProperty('cursor', 'crosshair', 'important')
  }

  exit(): void {
    if (!this.active) return
    this.active = false
    document.removeEventListener('pointermove', this.handlePointerMove, true)
    document.removeEventListener('click', this.handleClick, true)
    document.removeEventListener('keydown', this.handleKeyDown, true)
    document.documentElement.style.removeProperty('cursor')
    this.hovered = null
    this.options.onHighlight(null, null)
    this.options.onExit()
  }

  private isOwnEvent(event: Event): boolean {
    return event.composedPath().some((node) => node instanceof Element && isOwnElement(node))
  }

  private resolveEventTarget(event: Event): HTMLElement | null {
    const article = this.options.getArticle()
    if (!article) return null
    const path = event.composedPath()
    for (const node of path) {
      if (!(node instanceof Element)) continue
      if (isOwnElement(node)) return null
      if (!article.contains(node)) continue
      const resolved = resolvePickTarget(node, article)
      if (!resolved) return null
      if (resolved === article) {
        // 整个推文根节点不允许被屏蔽，继续向内寻找可命中的子节点
        continue
      }
      return resolved
    }
    return null
  }
}

export function pickTweetArticleAtPoint(x: number, y: number): HTMLElement | null {
  const element = document.elementFromPoint(x, y)
  if (!element || isOwnElement(element)) return null
  const article = element.closest(TWEET_ARTICLE_SELECTOR)
  return article instanceof HTMLElement ? article : null
}
