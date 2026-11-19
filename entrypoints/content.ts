import { browser } from 'wxt/browser'

import { mountSessionUi } from '@/components/mount-session'
import { buildStitchPlan, measureForCapture, measureGeometry } from '@/modules/capture/geometry'
import {
  preparePageForCapture,
  waitFrames,
  waitForDomStability,
  waitForImages,
} from '@/modules/page/dom-stability'
import {
  alignContainerForArticle,
  captureScrollSnapshot,
  scrollElementTo,
  scrollWindowTo,
} from '@/modules/page/scroll-manager'
import { SessionController } from '@/modules/session/session-controller'
import { loadSettings, normalizeSettings } from '@/modules/settings-store'
import type { ToContentMessage } from '@/types/messages'

let stitchContainer: HTMLElement | null = null

export default defineContentScript({
  matches: ['*://*.x.com/*', '*://*.twitter.com/*'],
  runAt: 'document_idle',
  main() {
    void initSession()
  },
})

async function initSession(): Promise<void> {
  if (document.getElementById('xpc-host')) return

  const controller = new SessionController()
  mountSessionUi(controller)
  bindContentMessages(controller)
  controller.activate(await loadSettings())

  // 弹出层修改设置后立即生效，无需重新进入截图模式
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes.captureSettings) return
    controller.updateSettings(normalizeSettings(changes.captureSettings.newValue))
  })

  window.addEventListener('pagehide', () => controller.deactivate())
}

function bindContentMessages(controller: SessionController): void {
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.type !== 'string' || !message.type.startsWith('XPC_')) {
      return false
    }
    handleContentMessage(message as ToContentMessage, controller).then(
      sendResponse,
      (error: unknown) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })
      },
    )
    return true
  })
}

async function handleContentMessage(
  message: ToContentMessage,
  controller: SessionController,
): Promise<unknown> {
  const host = document.getElementById('xpc-host') as HTMLElement | null
  switch (message.type) {
    case 'XPC_GET_GEOMETRY': {
      const article = controller.getSelectedArticle()
      if (!article) return { ok: false, error: '未选择目标推文' }
      const mode = controller.getSettings().captureMode
      if (mode === 'cdp' || mode === 'auto') {
        // 推文位于内部滚动容器时，被容器裁掉的区域不会出现在页面渲染结果中
        const snapshot = captureScrollSnapshot(article)
        controller.setGeometrySnapshot(snapshot)
        alignContainerForArticle(article)
        await waitFrames(1)
      }
      return { ok: true, geometry: measureGeometry(article) }
    }

    case 'XPC_GET_STITCH_PLAN': {
      const article = controller.getSelectedArticle()
      if (!article) return { ok: false, error: '未选择目标推文' }
      const snapshot = captureScrollSnapshot(article)
      controller.setGeometrySnapshot(snapshot)
      const { plan, container } = buildStitchPlan(article)
      stitchContainer = container
      return { ok: true, plan }
    }

    case 'XPC_SCROLL_TO': {
      if (message.kind === 'window') {
        await scrollWindowTo(message.value)
        return { ok: true }
      }
      if (!stitchContainer || !stitchContainer.isConnected) {
        return { ok: false, error: '滚动容器已失效，请重试' }
      }
      await scrollElementTo(stitchContainer, message.value)
      return { ok: true }
    }

    case 'XPC_MEASURE': {
      const article = controller.getSelectedArticle()
      if (!article) return { ok: false, error: '目标推文已不在页面上' }
      return {
        ok: true,
        measurement: measureForCapture(article, stitchContainer),
      }
    }

    case 'XPC_RESTORE_SCROLL':
      controller.restoreGeometrySnapshot()
      stitchContainer = null
      return { ok: true }

    case 'XPC_HIDE_OVERLAY':
      if (host) {
        host.style.visibility = message.hidden ? 'hidden' : ''
      }
      controller.setUiHidden(message.hidden)
      if (message.hidden) {
        // 等待一帧，确保扩展 UI 在截图前已经从渲染结果中消失
        await waitFrames(2)
      } else {
        controller.restoreGeometrySnapshot()
        stitchContainer = null
      }
      return { ok: true }

    case 'XPC_WRITE_CLIPBOARD':
      return writeClipboardInPage(message.dataUrl)

    case 'XPC_PREPARE_CAPTURE': {
      const article = controller.getSelectedArticle()
      if (article) await preparePageForCapture(article)
      return { ok: true }
    }

    case 'XPC_SETTLE_FRAME': {
      const article = controller.getSelectedArticle()
      if (article) {
        await Promise.all([
          waitForImages(article, 1000),
          waitForDomStability(article, { quietMs: 120, maxWaitMs: 700 }),
        ])
        await waitFrames(2)
      }
      return { ok: true }
    }

    case 'XPC_STATUS':
      controller.applyRemoteStatus(message.stage, message.message)
      return { ok: true }

    case 'XPC_RESULT':
      return { ok: true }

    default:
      return { ok: false, error: '未知消息类型' }
  }
}

async function writeClipboardInPage(dataUrl: string): Promise<{ ok: boolean; error?: string }> {
  try {
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
      return { ok: false, error: '页面不支持 Clipboard API' }
    }
    const response = await fetch(dataUrl)
    const blob = await response.blob()
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
