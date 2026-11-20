import { HoverButtonHost } from '@/components/hover-button-host'
import {
  TWEET_ACTION_LIKE_SELECTOR,
  TWEET_HEADER_ANCHOR_SELECTOR,
  isOwnElement,
  listTweets,
} from '@/modules/tweet/tweet-detector'

const BUTTON_SIZE = 32
const RIGHT_OFFSET = 88
const TOP_OFFSET = 10
/** 与 header 行按钮保持的水平间距 */
const HEADER_GAP = 6
/** 与操作栏末尾按钮保持的水平间距 */
const ACTION_GAP = 6
/** 按钮到卡片内边缘的最小留白 */
const CARD_INSET = 4
/** 真正会接收点击的控件；用户名等文本链接不算遮挡 */
const CONTROL_SELECTOR = 'button, [role="button"]'
const SCAN_DELAY = 120

/** 相对推文卡片 padding box 的停靠点 */
interface DockSpot {
  left: number
  top: number
}

export interface TweetButtonCallbacks {
  onCapture: (article: HTMLElement) => void
  onOpenToolbar: (article: HTMLElement) => void
  shouldOpenToolbar: () => boolean
}

/**
 * 为页面上每条推文挂载一个常驻的截图按钮。
 * 按钮是推文卡片的子元素（绝对定位），滚动时随推文移动。
 * X 的虚拟列表增删推文时由 MutationObserver 增量同步。
 */
export class TweetButtonManager {
  private readonly buttons = new Map<HTMLElement, HoverButtonHost>()
  private readonly patchedPositions = new Set<HTMLElement>()
  private observer: MutationObserver | null = null
  private scanTimer: number | null = null
  private active = false

  constructor(private readonly callbacks: TweetButtonCallbacks) {}

  start(): void {
    if (this.active) return
    this.active = true
    this.observer = new MutationObserver(() => this.scheduleScan())
    if (document.body) {
      this.observer.observe(document.body, { childList: true, subtree: true })
    }
    this.scheduleScan()
  }

  stop(): void {
    this.active = false
    this.observer?.disconnect()
    this.observer = null
    if (this.scanTimer !== null) {
      window.clearTimeout(this.scanTimer)
      this.scanTimer = null
    }
    for (const [article, host] of this.buttons) {
      host.detach()
      this.restorePosition(article)
    }
    this.buttons.clear()
  }

  setHidden(hidden: boolean): void {
    for (const host of this.buttons.values()) host.setHidden(hidden)
  }

  private scheduleScan(): void {
    if (!this.active || this.scanTimer !== null) return
    this.scanTimer = window.setTimeout(() => {
      this.scanTimer = null
      this.scan()
    }, SCAN_DELAY)
  }

  private scan(): void {
    if (!this.active) return
    const seen = new Set<HTMLElement>()
    for (const article of listTweets()) {
      seen.add(article)
      let host = this.buttons.get(article)
      if (!host) {
        host = new HoverButtonHost({
          onQuickCapture: () => this.callbacks.onCapture(article),
          onOpenToolbar: () => this.callbacks.onOpenToolbar(article),
          shouldOpenToolbar: () => this.callbacks.shouldOpenToolbar(),
        })
        this.buttons.set(article, host)
      }
      if (host.host.parentElement !== article) {
        this.mount(article, host)
      } else {
        this.updatePosition(article, host)
      }
    }
    for (const [article, host] of this.buttons) {
      if (seen.has(article) && article.isConnected) continue
      host.detach()
      this.restorePosition(article)
      this.buttons.delete(article)
    }
  }

  private mount(article: HTMLElement, host: HoverButtonHost): void {
    if (getComputedStyle(article).position === 'static') {
      article.style.position = 'relative'
      this.patchedPositions.add(article)
    }
    host.attach(article)
    this.updatePosition(article, host)
    host.setTheme(detectTheme())
  }

  private updatePosition(article: HTMLElement, host: HoverButtonHost): void {
    const articleRect = article.getBoundingClientRect()
    if (articleRect.width < 1) return
    // absolute 定位以 article 的 padding box 为原点
    const originLeft = articleRect.left + article.clientLeft
    const originTop = articleRect.top + article.clientTop

    // 首选 header 行按钮左侧；该位置被「关注」等按钮占用时（例如详情页主推文）
    // 会让开并停靠到操作栏末尾按钮右侧的空白处。
    const headerSpot = this.headerSpot(article, originLeft, originTop)
    if (
      headerSpot &&
      !this.hitsTweetControl(article, originLeft + headerSpot.left, originTop + headerSpot.top)
    ) {
      this.applySpot(host, headerSpot)
      return
    }

    const actionSpot = this.actionSpot(article, originLeft, originTop)
    if (
      actionSpot &&
      !this.hitsTweetControl(article, originLeft + actionSpot.left, originTop + actionSpot.top)
    ) {
      this.applySpot(host, actionSpot)
      return
    }

    // 操作按钮尚未渲染时的回退位置
    host.setPosition(TOP_OFFSET, Math.max(8, articleRect.width - BUTTON_SIZE - RIGHT_OFFSET))
    host.setTheme(detectTheme())
  }

  private applySpot(host: HoverButtonHost, spot: DockSpot): void {
    host.setPosition(Math.max(CARD_INSET, spot.top), Math.max(CARD_INSET, spot.left))
    host.setTheme(detectTheme())
  }

  /**
   * header 行按钮组最左侧按钮（「关注」/「订阅」等）左边的空白。
   * 例如详情页主推文那一行是 [关注][Grok][更多]，停靠在 Grok 左侧会压住关注按钮，
   * 因此要找到整组按钮的最左端再向左让开。
   */
  private headerSpot(article: HTMLElement, originLeft: number, originTop: number): DockSpot | null {
    const anchor = article.querySelector<HTMLElement>(TWEET_HEADER_ANCHOR_SELECTOR)
    if (!anchor) return null
    const anchorRect = anchor.getBoundingClientRect()
    if (anchorRect.width < 1 || anchorRect.height < 1) return null

    let leftmost: DOMRect = anchorRect
    for (const control of article.querySelectorAll<HTMLElement>(CONTROL_SELECTOR)) {
      if (isOwnElement(control)) continue
      const rect = control.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) continue
      // 只看与锚点处于同一行的按钮
      if (rect.bottom <= anchorRect.top || rect.top >= anchorRect.bottom) continue
      if (rect.left < leftmost.left) leftmost = rect
    }

    return {
      left: leftmost.left - originLeft - BUTTON_SIZE - HEADER_GAP,
      top: anchorRect.top - originTop + (anchorRect.height - BUTTON_SIZE) / 2,
    }
  }

  private actionSpot(article: HTMLElement, originLeft: number, originTop: number): DockSpot | null {
    const like = article.querySelector<HTMLElement>(TWEET_ACTION_LIKE_SELECTOR)
    const group = like?.closest<HTMLElement>('[role="group"]')
    if (!group) return null
    const controls = group.querySelectorAll<HTMLElement>(CONTROL_SELECTOR)
    // 取操作栏里最后一个真正渲染出来的按钮（分享），跳过无障碍用的隐藏节点
    let anchor: DOMRect | null = null
    for (let index = controls.length - 1; index >= 0; index -= 1) {
      const candidate = controls[index]?.getBoundingClientRect()
      if (candidate && candidate.width > 1 && candidate.height > 1) {
        anchor = candidate
        break
      }
    }
    if (!anchor) return null
    const left = anchor.right - originLeft + ACTION_GAP
    // 操作栏末尾按钮右侧没有足够空间时放弃该停靠点
    const paddingBoxWidth = article.clientWidth
    if (left + BUTTON_SIZE > paddingBoxWidth - CARD_INSET) return null
    return {
      left,
      top: anchor.top - originTop + (anchor.height - BUTTON_SIZE) / 2,
    }
  }

  /** 停靠点（视口坐标）是否与推文内按钮重叠 */
  private hitsTweetControl(
    article: HTMLElement,
    viewportLeft: number,
    viewportTop: number,
  ): boolean {
    const right = viewportLeft + BUTTON_SIZE
    const bottom = viewportTop + BUTTON_SIZE
    for (const control of article.querySelectorAll<HTMLElement>(CONTROL_SELECTOR)) {
      if (isOwnElement(control)) continue
      const rect = control.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) continue
      if (rect.right <= viewportLeft || rect.left >= right) continue
      if (rect.bottom <= viewportTop || rect.top >= bottom) continue
      return true
    }
    return false
  }

  private restorePosition(article: HTMLElement): void {
    if (this.patchedPositions.delete(article) && article.isConnected) {
      article.style.removeProperty('position')
    }
  }
}

function detectTheme(): 'light' | 'dark' {
  try {
    const background = getComputedStyle(document.body).backgroundColor
    const match = background.match(/\d+(?:\.\d+)?/g)
    if (!match || match.length < 3) return 'light'
    const r = Number(match[0] ?? 0)
    const g = Number(match[1] ?? 0)
    const b = Number(match[2] ?? 0)
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    return luminance < 0.5 ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}
