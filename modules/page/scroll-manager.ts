import { findScrollContainer } from '@/modules/tweet/tweet-detector'

import { nextFrame, waitFrames } from './dom-stability'

export interface ScrollSnapshot {
  windowX: number
  windowY: number
  containers: Array<{ element: HTMLElement; scrollTop: number; scrollLeft: number }>
}

export function captureScrollSnapshot(article?: HTMLElement): ScrollSnapshot {
  const containers: ScrollSnapshot['containers'] = []
  if (article) {
    let parent = article.parentElement
    while (parent) {
      if (
        parent.scrollTop > 0 ||
        parent.scrollLeft > 0 ||
        parent.scrollHeight > parent.clientHeight
      ) {
        const style = getComputedStyle(parent)
        if (
          style.overflowY === 'auto' ||
          style.overflowY === 'scroll' ||
          style.overflowX === 'auto' ||
          style.overflowX === 'scroll'
        ) {
          containers.push({
            element: parent,
            scrollTop: parent.scrollTop,
            scrollLeft: parent.scrollLeft,
          })
        }
      }
      parent = parent.parentElement
    }
  }
  return {
    windowX: window.scrollX,
    windowY: window.scrollY,
    containers,
  }
}

export function restoreScrollSnapshot(snapshot: ScrollSnapshot): void {
  for (const container of snapshot.containers) {
    if (!container.element.isConnected) continue
    container.element.scrollTop = container.scrollTop
    container.element.scrollLeft = container.scrollLeft
  }
  window.scrollTo(snapshot.windowX, snapshot.windowY)
}

export async function scrollWindowTo(y: number): Promise<void> {
  window.scrollTo({ top: y, left: window.scrollX, behavior: 'instant' as ScrollBehavior })
  await nextFrame()
  await waitFrames(2)
}

export async function scrollElementTo(element: HTMLElement, top: number): Promise<void> {
  element.scrollTop = top
  await nextFrame()
  await waitFrames(2)
}

/**
 * 让内部滚动容器中的目标推文尽量完整地出现在容器视口内。
 * 用于 CDP 截图：被容器裁掉的部分不会出现在页面渲染结果中。
 */
export function alignContainerForArticle(article: HTMLElement): {
  container: HTMLElement | null
  clipped: boolean
} {
  const container = findScrollContainer(article)
  if (!container) return { container: null, clipped: false }
  const articleRect = article.getBoundingClientRect()
  const containerRect = container.getBoundingClientRect()
  const visibleHeight = container.clientHeight
  const canFit = articleRect.height <= visibleHeight + 1
  const currentTop = container.scrollTop
  const desiredTop = currentTop + (articleRect.top - containerRect.top) - 8
  const maxTop = Math.max(0, container.scrollHeight - container.clientHeight)
  container.scrollTop = Math.max(0, Math.min(desiredTop, maxTop))
  return { container, clipped: !canFit }
}

export function getScrollContainerFor(article: HTMLElement): HTMLElement | null {
  return findScrollContainer(article)
}
