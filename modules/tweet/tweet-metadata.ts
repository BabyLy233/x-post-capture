import type { CaptureMetadata } from '@/types/capture'

import { TWEET_TIME_SELECTOR, TWEET_USER_NAME_SELECTOR, getStatusId } from './tweet-detector'

export interface TweetMetadata {
  tweetId?: string
  author?: string
  authorName?: string
}

export function extractTweetMetadata(article: HTMLElement): TweetMetadata {
  const tweetId = getStatusId(article)
  const userNameBlock = article.querySelector(TWEET_USER_NAME_SELECTOR)
  const nameAnchor =
    userNameBlock?.querySelector<HTMLAnchorElement>('a[href^="/"]:not([href*="/status/"])') ??
    userNameBlock?.querySelector<HTMLAnchorElement>('a[href^="/"]')
  const displayName = readDisplayName(userNameBlock)
  const author = readHandle(userNameBlock, nameAnchor ?? null)
  return {
    tweetId,
    author,
    authorName: displayName,
  }
}

function readDisplayName(block: Element | null): string | undefined {
  if (!block) return undefined
  const span = block.querySelector<HTMLElement>('a[href^="/"] span')
  const text = (span?.textContent ?? '').replace(/\s+/g, ' ').trim()
  return text || undefined
}

function readHandle(block: Element | null, anchor: HTMLAnchorElement | null): string | undefined {
  if (!block) return undefined
  const text = (block.textContent ?? '').replace(/\s+/g, ' ')
  const handleMatch = text.match(/@[A-Za-z0-9_]{1,30}/)
  if (handleMatch) return handleMatch[0].replace(/^@/, '')
  const href = anchor?.getAttribute('href') ?? ''
  const firstSegment = href.split('/').filter(Boolean)[0]
  if (firstSegment) return firstSegment
  return undefined
}

export function buildCaptureMetadata(article: HTMLElement): CaptureMetadata {
  const info = extractTweetMetadata(article)
  return {
    tweetId: info.tweetId,
    author: info.author,
    authorName: info.authorName,
    sourceUrl: location.href,
    capturedAt: Date.now(),
  }
}

export function getTweetLabel(article: HTMLElement): string {
  const info = extractTweetMetadata(article)
  if (info.author && info.authorName) return `${info.authorName} (@${info.author})`
  if (info.author) return `@${info.author}`
  if (info.authorName) return info.authorName
  const text = (article.querySelector('[data-testid="tweetText"]')?.textContent ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.slice(0, 60) || '这条推文'
}

export function getTweetTimeISO(article: HTMLElement): string | undefined {
  const time = article.querySelector<HTMLTimeElement>(TWEET_TIME_SELECTOR)
  return time?.dateTime
}
