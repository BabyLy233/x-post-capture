import type { CaptureMode } from './settings';

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ViewportInfo {
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  dpr: number;
}

export interface CaptureMetadata {
  tweetId?: string;
  author?: string;
  authorName?: string;
  sourceUrl: string;
  capturedAt: number;
}

export interface CaptureGeometry {
  metadata: CaptureMetadata;
  /** 目标推文在文档坐标系中的矩形 */
  pageRect: Rect;
  /** 目标推文在视口坐标系中的矩形 */
  viewportRect: Rect;
  viewport: ViewportInfo;
}

export interface Measurement {
  /** 目标推文在视口坐标系中的矩形 */
  targetRect: Rect;
  /** 当前帧中目标可被截取的区域（视口坐标），为空表示不可见 */
  clipRect: Rect | null;
  viewport: ViewportInfo;
}

export interface StitchPlan {
  kind: 'window' | 'element';
  /** 需要滚动到的位置序列（window 为 scrollY，element 为容器 scrollTop） */
  positions: number[];
  maxScroll: number;
}

export interface StitchSegment {
  dataUrl: string;
  /** 截图时内容视口的 CSS 宽度，用于计算图片与 CSS 像素的比例 */
  viewportWidth: number;
  /** 目标推文在截图中（视口坐标）的矩形 */
  targetRect: Rect;
  /** 需要截取的可见区域（视口坐标） */
  clipRect: Rect;
}

export type OutputStatus = 'ok' | 'failed' | 'skipped';

export interface CaptureErrorInfo {
  code: string;
  message: string;
}

export interface CaptureResult {
  ok: boolean;
  modeUsed?: CaptureMode;
  width?: number;
  height?: number;
  partial?: boolean;
  clipboard?: OutputStatus;
  clipboardError?: string;
  download?: OutputStatus;
  downloadError?: string;
  error?: CaptureErrorInfo;
  warnings?: string[];
}

export type CaptureStage =
  | 'detecting'
  | 'waiting-stable'
  | 'capturing'
  | 'stitching'
  | 'clipboard'
  | 'downloading'
  | 'done'
  | 'error';

export const CAPTURE_ERROR = {
  NOT_SUPPORTED_PAGE: 'NOT_SUPPORTED_PAGE',
  NO_TWEET_SELECTED: 'NO_TWEET_SELECTED',
  TWEET_NOT_FOUND: 'TWEET_NOT_FOUND',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  DEBUGGER_CONFLICT: 'DEBUGGER_CONFLICT',
  CAPTURE_FAILED: 'CAPTURE_FAILED',
  IMAGE_TOO_LARGE: 'IMAGE_TOO_LARGE',
  CLIPBOARD_FAILED: 'CLIPBOARD_FAILED',
  DOWNLOAD_FAILED: 'DOWNLOAD_FAILED',
  OFFSCREEN_UNAVAILABLE: 'OFFSCREEN_UNAVAILABLE',
  NO_OUTPUT: 'NO_OUTPUT',
  CANCELLED: 'CANCELLED',
} as const;

export type CaptureErrorCode =
  (typeof CAPTURE_ERROR)[keyof typeof CAPTURE_ERROR];