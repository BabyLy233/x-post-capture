import { browser } from 'wxt/browser'

import type { Rect, StitchSegment } from '@/types/capture'
import type { OffscreenRequest } from '@/types/messages'

const MAX_CANVAS_SIDE = 16_384

interface DecodedImage {
  bitmap: ImageBitmap
  width: number
  height: number
}

async function decodeDataUrl(dataUrl: string): Promise<DecodedImage> {
  const response = await fetch(dataUrl)
  const blob = await response.blob()
  const bitmap = await createImageBitmap(blob)
  return { bitmap, width: bitmap.width, height: bitmap.height }
}

async function clipboardWrite(dataUrl: string): Promise<void> {
  const response = await fetch(dataUrl)
  const blob = await response.blob()
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
    throw new Error('当前环境不支持 Clipboard API 图片写入')
  }
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  if (width > MAX_CANVAS_SIDE || height > MAX_CANVAS_SIDE) {
    throw new Error(`图片尺寸超出浏览器画布上限（${width}×${height}）`)
  }
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return canvas
}

function canvasToPng(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png')
}

async function cropImage(dataUrl: string, viewportWidth: number, clipRect: Rect): Promise<string> {
  const image = await decodeDataUrl(dataUrl)
  try {
    const scale = image.width / viewportWidth
    const sourceWidth = Math.max(1, Math.round(clipRect.width * scale))
    const sourceHeight = Math.max(1, Math.round(clipRect.height * scale))
    const canvas = makeCanvas(sourceWidth, sourceHeight)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建 Canvas 上下文')
    context.drawImage(
      image.bitmap,
      clipRect.left * scale,
      clipRect.top * scale,
      clipRect.width * scale,
      clipRect.height * scale,
      0,
      0,
      canvas.width,
      canvas.height,
    )
    return canvasToPng(canvas)
  } finally {
    image.bitmap.close()
  }
}

async function stitchImage(
  targetWidthCss: number,
  targetHeightCss: number,
  segments: StitchSegment[],
): Promise<string> {
  const firstSegment = segments[0]
  if (!firstSegment) throw new Error('没有可用于拼接的截图片段')
  const first = await decodeDataUrl(firstSegment.dataUrl)
  const scale = first.width / firstSegment.viewportWidth
  first.bitmap.close()
  const canvas = makeCanvas(targetWidthCss * scale, targetHeightCss * scale)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法创建 Canvas 上下文')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'

  for (const segment of segments) {
    const image = await decodeDataUrl(segment.dataUrl)
    try {
      const segmentScale = image.width / segment.viewportWidth
      // 截图是整张视口，源坐标必须使用视口坐标，不能减去推文偏移
      const sourceX = segment.clipRect.left * segmentScale
      const sourceY = segment.clipRect.top * segmentScale
      const sourceWidth = segment.clipRect.width * segmentScale
      const sourceHeight = segment.clipRect.height * segmentScale
      // 目标画布以推文左上角为原点，这里才需要相对推文的偏移
      const destinationX = (segment.clipRect.left - segment.targetRect.left) * scale
      const destinationY = (segment.clipRect.top - segment.targetRect.top) * scale
      context.drawImage(
        image.bitmap,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        destinationX,
        destinationY,
        segment.clipRect.width * scale,
        segment.clipRect.height * scale,
      )
    } finally {
      image.bitmap.close()
    }
  }
  return canvasToPng(canvas)
}

async function handleMessage(
  message: OffscreenRequest,
): Promise<{ ok: boolean; dataUrl?: string; width?: number; height?: number; error?: string }> {
  try {
    switch (message.type) {
      case 'XPC_OFFSCREEN_CLIPBOARD':
        await clipboardWrite(message.dataUrl)
        return { ok: true }
      case 'XPC_OFFSCREEN_CROP':
        return {
          ok: true,
          dataUrl: await cropImage(message.dataUrl, message.viewportWidth, message.clipRect),
        }
      case 'XPC_OFFSCREEN_STITCH':
        return {
          ok: true,
          dataUrl: await stitchImage(
            message.targetWidthCss,
            message.targetHeightCss,
            message.segments,
          ),
        }
      default:
        return { ok: false, error: '未知的 offscreen 请求' }
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || (message as { target?: string }).target !== 'offscreen') return false
  handleMessage(message as OffscreenRequest).then(sendResponse, (error: unknown) => {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
  })
  return true
})
