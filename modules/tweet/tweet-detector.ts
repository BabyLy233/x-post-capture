/**
 * X 页面推文定位的适配层。
 *
 * 这里的 DOM 选择器会随 X 改版而变化，所有选择器集中在此文件，
 * 业务代码不得直接依赖具体的 data-testid。
 */

export const TWEET_ARTICLE_SELECTOR = 'article[data-testid="tweet"]'

export const TWEET_TEXT_SELECTOR = '[data-testid="tweetText"]'

export const TWEET_USER_NAME_SELECTOR = '[data-testid="User-Name"]'

export const TWEET_TIME_SELECTOR = 'time[datetime]'

export const STATUS_LINK_SELECTOR = 'a[href*="/status/"]'

/** 扩展自身注入的节点标记，推文识别与元素选择时必须排除 */
export const OWN_ATTRIBUTE = 'data-xpc-owned'

export function isOwnElement(node: Element | null): boolean {
  if (!node) return false
  return Boolean(node.closest(`[${OWN_ATTRIBUTE}="true"]`))
}

export function asTweetArticle(node: Element | null): HTMLElement | null {
  if (!node) return null
  const article = node.closest(TWEET_ARTICLE_SELECTOR)
  return article instanceof HTMLElement ? article : null
}

export function findTweetFromEvent(event: Event): HTMLElement | null {
  const path = event.composedPath()
  for (const node of path) {
    if (node instanceof Element) {
      if (isOwnElement(node)) return null
      const article = asTweetArticle(node)
      if (article) return article
    }
  }
  return null
}

export function listTweets(root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TWEET_ARTICLE_SELECTOR)).filter(
    (article) => !isOwnElement(article),
  )
}

export function isXPage(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url)
    return (
      (protocol === 'https:' || protocol === 'http:') &&
      (hostname === 'x.com' ||
        hostname.endsWith('.x.com') ||
        hostname === 'twitter.com' ||
        hostname.endsWith('.twitter.com'))
    )
  } catch {
    return false
  }
}

export interface TweetIdentity {
  key: string
  article: HTMLElement
  statusId?: string
}

export function getTweetIdentity(article: HTMLElement): TweetIdentity {
  const statusId = getStatusId(article)
  if (statusId) {
    return { key: `status:${statusId}`, article, statusId }
  }
  return { key: buildFallbackKey(article), article }
}

export function getStatusId(article: HTMLElement): string | undefined {
  const timeLink = article.querySelector(`${STATUS_LINK_SELECTOR} time`)?.closest('a')
  const candidates = [
    timeLink instanceof HTMLAnchorElement ? timeLink.href : null,
    ...Array.from(article.querySelectorAll<HTMLAnchorElement>(STATUS_LINK_SELECTOR)).map(
      (anchor) => anchor.href,
    ),
  ]
  for (const href of candidates) {
    if (!href) continue
    const match = href.match(/\/status(?:es)?\/(\d+)/)
    if (match) return match[1]
  }
  return undefined
}

function buildFallbackKey(article: HTMLElement): string {
  const tweets = listTweets()
  const index = tweets.indexOf(article)
  if (index >= 0) return `index:${index}`
  if (!article.dataset.xpcRef) {
    article.dataset.xpcRef = `ref-${Math.random().toString(36).slice(2, 10)}`
  }
  return `ref:${article.dataset.xpcRef}`
}

/** 查找目标元素最近的、真正可滚动的祖先容器（不含 document） */
export function findScrollContainer(element: HTMLElement): HTMLElement | null {
  let parent = element.parentElement
  while (parent && parent !== document.body && parent !== document.documentElement) {
    const style = getComputedStyle(parent)
    const overflowY = style.overflowY
    const scrollable = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay'
    if (scrollable && parent.scrollHeight > parent.clientHeight + 1) {
      return parent
    }
    parent = parent.parentElement
  }
  return null
}
