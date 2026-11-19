import type {
  CaptureErrorInfo,
  CaptureGeometry,
  CaptureResult,
  CaptureStage,
  Measurement,
  StitchPlan,
  StitchSegment,
} from './capture'
import type { CaptureSettings } from './settings'

/** Content -> Background：执行截图 */
export interface CaptureRequestMessage {
  type: 'XPC_CAPTURE_REQUEST'
  settings: CaptureSettings
}

/** Content -> Background：取消正在执行的截图 */
export interface CancelCaptureMessage {
  type: 'XPC_CANCEL_CAPTURE'
}

/** Background -> Content：请求当前几何信息 */
export interface GetGeometryMessage {
  type: 'XPC_GET_GEOMETRY'
}

export interface GetStitchPlanMessage {
  type: 'XPC_GET_STITCH_PLAN'
}

export interface ScrollToMessage {
  type: 'XPC_SCROLL_TO'
  kind: 'window' | 'element'
  value: number
}

export interface MeasureMessage {
  type: 'XPC_MEASURE'
}

export interface RestoreScrollMessage {
  type: 'XPC_RESTORE_SCROLL'
}

export interface HideOverlayMessage {
  type: 'XPC_HIDE_OVERLAY'
  hidden: boolean
}

/** Background -> Content：在页面上下文中写入剪贴板（页面拥有焦点） */
export interface WriteClipboardMessage {
  type: 'XPC_WRITE_CLIPBOARD'
  dataUrl: string
}

/** Background -> Content：附加调试器后等待页面重新稳定 */
export interface PrepareCaptureMessage {
  type: 'XPC_PREPARE_CAPTURE'
}

/** Background -> Content：滚动拼接每帧等待图片与布局稳定 */
export interface SettleFrameMessage {
  type: 'XPC_SETTLE_FRAME'
}

/** Background -> Content：截图进度 */
export interface StatusMessage {
  type: 'XPC_STATUS'
  stage: CaptureStage
  message?: string
}

/** Background -> Content：截图结果 */
export interface ResultMessage {
  type: 'XPC_RESULT'
  result: CaptureResult
}

export type ToContentMessage =
  | GetGeometryMessage
  | GetStitchPlanMessage
  | ScrollToMessage
  | MeasureMessage
  | RestoreScrollMessage
  | HideOverlayMessage
  | WriteClipboardMessage
  | PrepareCaptureMessage
  | SettleFrameMessage
  | StatusMessage
  | ResultMessage

export type ToBackgroundMessage = CaptureRequestMessage | CancelCaptureMessage

export interface GeometryResponse {
  ok: true
  geometry: CaptureGeometry
}

export interface StitchPlanResponse {
  ok: true
  plan: StitchPlan
}

export interface MeasurementResponse {
  ok: true
  measurement: Measurement
}

export interface SimpleResponse {
  ok: boolean
  error?: string
}

export type MessageResponse<T> = { ok: true; data: T } | { ok: false; error: CaptureErrorInfo }

/** Background -> Offscreen */
export type OffscreenRequest =
  | { target: 'offscreen'; type: 'XPC_OFFSCREEN_CLIPBOARD'; dataUrl: string }
  | {
      target: 'offscreen'
      type: 'XPC_OFFSCREEN_CROP'
      dataUrl: string
      viewportWidth: number
      clipRect: { left: number; top: number; width: number; height: number }
    }
  | {
      target: 'offscreen'
      type: 'XPC_OFFSCREEN_STITCH'
      targetWidthCss: number
      targetHeightCss: number
      segments: StitchSegment[]
    }

export interface OffscreenClipboardResponse {
  ok: boolean
  error?: string
}

export interface OffscreenImageResponse {
  ok: boolean
  dataUrl?: string
  width?: number
  height?: number
  error?: string
}

export type OffscreenResponse = OffscreenClipboardResponse | OffscreenImageResponse

/** 内容脚本内部 UI 状态 */
export interface MaskedItemInfo {
  id: string
  label: string
  source: 'manual' | 'rule'
  saved: boolean
}
