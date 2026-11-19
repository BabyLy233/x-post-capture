function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

export async function waitFrames(count = 2): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await nextFrame()
  }
}

/**
 * 等待目标子树短暂安静下来。X 页面持续有动画时，安静期无法满足，
 * 由 maxWait 兜底，避免无限等待。
 */
export async function waitForDomStability(
  root: Node,
  options: { quietMs?: number; maxWaitMs?: number } = {},
): Promise<void> {
  const quietMs = options.quietMs ?? 180
  const maxWaitMs = options.maxWaitMs ?? 1200
  await new Promise<void>((resolve) => {
    let finished = false
    let quietTimer: ReturnType<typeof setTimeout> | null = null

    const finish = () => {
      if (finished) return
      finished = true
      observer.disconnect()
      if (quietTimer) clearTimeout(quietTimer)
      clearTimeout(maxTimer)
      resolve()
    }

    const bump = () => {
      if (quietTimer) clearTimeout(quietTimer)
      quietTimer = setTimeout(finish, quietMs)
    }

    const observer = new MutationObserver(bump)
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    })
    const maxTimer = setTimeout(finish, maxWaitMs)
    bump()
  })
}

export async function waitForFonts(timeoutMs = 2000): Promise<void> {
  if (!('fonts' in document) || !document.fonts) return
  try {
    await Promise.race([document.fonts.ready, delay(timeoutMs)])
  } catch {
    // 字体加载失败不应阻塞截图
  }
}

/**
 * 等待推文内图片加载完成，超时后放弃等待但不会阻断流程。
 */
export async function waitForImages(root: ParentNode, timeoutMs = 2500): Promise<void> {
  const images = Array.from(root.querySelectorAll('img')).filter(
    (img): img is HTMLImageElement => img instanceof HTMLImageElement && !img.complete,
  )
  if (images.length === 0) return
  const waiting = Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          const done = () => {
            img.removeEventListener('load', done)
            img.removeEventListener('error', done)
            resolve()
          }
          img.addEventListener('load', done, { once: true })
          img.addEventListener('error', done, { once: true })
        }),
    ),
  )
  await Promise.race([waiting, delay(timeoutMs)])
}

/** 截图前统一的页面稳定检查 */
export async function preparePageForCapture(root: Element): Promise<void> {
  await waitFrames(2)
  await Promise.all([waitForFonts(), waitForImages(root)])
  await waitForDomStability(root)
  await waitFrames(1)
}

export { delay }
