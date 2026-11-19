import { browser } from 'wxt/browser';

import {
  CAPTURE_ERROR,
  type CaptureErrorCode,
  type CaptureGeometry,
  type CaptureResult,
  type CaptureStage,
  type Measurement,
  type OutputStatus,
  type StitchPlan,
  type StitchSegment,
} from '@/types/capture';
import type { CaptureRequestMessage, OffscreenRequest } from '@/types/messages';
import type { CaptureSettings } from '@/types/settings';
import { buildFileName } from '@/modules/output/file-name';
import { isXPage } from '@/modules/tweet/tweet-detector';

const DEBUGGER_PROTOCOL_VERSION = '1.3';
const MAX_CAPTURE_PIXELS = 80_000_000;
const MAX_CAPTURE_SIDE = 16_000;
const CAPTURE_VISIBLE_MIN_INTERVAL = 550;

interface ActiveCapture {
  tabId: number;
  cancelled: boolean;
}

let activeCapture: ActiveCapture | null = null;
let lastCaptureVisibleAt = 0;
let offscreenCreating: Promise<void> | null = null;

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object') return false;
    if ((message as { target?: string }).target === 'offscreen') return false;
    const type = (message as { type?: unknown }).type;
    if (typeof type !== 'string' || !type.startsWith('XPC_')) return false;
    handleRuntimeMessage(
      message as CaptureRequestMessage | { type: string },
      sender,
    ).then(sendResponse, (error: unknown) => {
      sendResponse({
        ok: false,
        error: { code: CAPTURE_ERROR.CAPTURE_FAILED, message: errorMessage(error) },
      });
    });
    return true;
  });

  browser.debugger?.onDetach.addListener((source, reason) => {
    if (activeCapture && source.tabId === activeCapture.tabId) {
      console.warn('[xpc] debugger detached', reason);
    }
  });
});

async function handleRuntimeMessage(
  message: CaptureRequestMessage | { type: string },
  sender: { tab?: { id?: number } },
): Promise<unknown> {
  switch (message.type) {
    case 'XPC_CAPTURE_REQUEST': {
      const tabId = sender.tab?.id;
      if (typeof tabId !== 'number') {
        return failure('CAPTURE_FAILED', '无法确定当前标签页');
      }
      return runCapture(tabId, (message as CaptureRequestMessage).settings);
    }
    case 'XPC_CANCEL_CAPTURE':
      if (activeCapture) activeCapture.cancelled = true;
      return { ok: true };
    default:
      return false;
  }
}

async function runCapture(tabId: number, settings: CaptureSettings): Promise<CaptureResult> {
  if (!settings.copyToClipboard && !settings.downloadToLocal) {
    return failure(CAPTURE_ERROR.NO_OUTPUT, '请至少启用一种输出方式');
  }
  if (activeCapture) {
    return failure(CAPTURE_ERROR.CAPTURE_FAILED, '已有截图任务正在进行');
  }
  const capture: ActiveCapture = { tabId, cancelled: false };
  activeCapture = capture;
  const warnings: string[] = [];
  let modeUsed = settings.captureMode;
  setBadge('…', tabId);

  try {
    const tab = await browser.tabs.get(tabId);
    // 没有 tabs 权限时 tab.url 可能为空；能收到内容脚本消息本身就说明页面受支持
    if (tab.url && !isXPage(tab.url)) {
      return failure(CAPTURE_ERROR.NOT_SUPPORTED_PAGE, '当前标签页不是受支持的 X 页面');
    }

    const geometry = await requestGeometry(tabId, capture);
    if (!geometry) {
      return failure(CAPTURE_ERROR.TWEET_NOT_FOUND, '未能识别目标推文节点');
    }
    validateCaptureSize(geometry);

    await hideOverlay(tabId, true);
    sendStatus(tabId, 'capturing', '正在截图…');

    let dataUrl: string | null = null;
    if (settings.captureMode === 'viewport') {
      dataUrl = await captureViewportRegion(tabId, geometry, capture);
      modeUsed = 'viewport';
    } else if (settings.captureMode === 'cdp' || settings.captureMode === 'auto') {
      const hasDebugger = await hasPermission('debugger');
      if (settings.captureMode === 'cdp' && !hasDebugger) {
        return failure(
          CAPTURE_ERROR.PERMISSION_DENIED,
          'CDP 截图需要 debugger 权限。请在扩展弹出层重新进入截图模式并授权。',
        );
      }
      if (hasDebugger) {
        try {
          dataUrl = await captureWithCdp(tabId, geometry, capture);
          modeUsed = 'cdp';
        } catch (error) {
          if (settings.captureMode === 'cdp') throw error;
          if (capture.cancelled) throw new CaptureCancelled();
          warnings.push(`CDP 截图失败，已回退滚动拼接：${errorMessage(error)}`);
        }
      }
      if (!dataUrl) {
        if (settings.captureMode === 'auto' && !hasDebugger) {
          warnings.push('未获得 debugger 权限，使用滚动拼接。');
        }
        dataUrl = await captureStitched(tabId, capture, warnings, false);
        modeUsed = 'stitched';
      }
    } else {
      // 滚动拼接模式刻意不使用 debugger，只依赖 captureVisibleTab
      dataUrl = await captureStitched(tabId, capture, warnings, false);
      modeUsed = 'stitched';
    }

    if (!dataUrl) {
      return failure(CAPTURE_ERROR.CAPTURE_FAILED, '截图未生成有效图片');
    }
    if (capture.cancelled) throw new CaptureCancelled();

    const output = await deliverOutput(dataUrl, geometry, settings, tabId);

    const allFailed =
      (settings.copyToClipboard && output.clipboard === 'failed') &&
      (settings.downloadToLocal && output.download === 'failed');
    const result: CaptureResult = {
      ok: !allFailed,
      modeUsed,
      clipboard: output.clipboard,
      clipboardError: output.clipboardError,
      download: output.download,
      downloadError: output.downloadError,
      partial: modeUsed === 'viewport',
      warnings,
      error: allFailed
        ? {
            code: CAPTURE_ERROR.CAPTURE_FAILED,
            message: '图片已生成，但剪贴板和下载都失败了',
          }
        : undefined,
    };
    sendStatus(tabId, result.ok ? 'done' : 'error', result.ok ? '截图完成' : '输出失败');
    return result;
  } catch (error) {
    if (error instanceof CaptureCancelled || capture.cancelled) {
      sendStatus(tabId, 'error', '截图已取消');
      return failure(CAPTURE_ERROR.CANCELLED, '截图已取消');
    }
    const code = error instanceof CaptureFailure ? error.code : CAPTURE_ERROR.CAPTURE_FAILED;
    sendStatus(tabId, 'error', errorMessage(error));
    return failure(code, errorMessage(error), warnings);
  } finally {
    await hideOverlay(tabId, false);
    setBadge(null, tabId);
    if (activeCapture === capture) activeCapture = null;
  }
}

function setBadge(text: string | null, tabId: number): void {
  try {
    void browser.action.setBadgeBackgroundColor({ color: '#1d9bf0', tabId });
    void browser.action.setBadgeText({ text: text ?? '', tabId });
  } catch {
    // badge 只是辅助反馈，失败不影响截图
  }
}

class CaptureCancelled extends Error {
  constructor() {
    super('capture cancelled');
    this.name = 'CaptureCancelled';
  }
}

class CaptureFailure extends Error {
  constructor(
    readonly code: CaptureErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CaptureFailure';
  }
}

function failure(code: CaptureErrorCode, message: string, warnings?: string[]): CaptureResult {
  return { ok: false, error: { code, message }, warnings };
}

function ensureNotCancelled(capture: ActiveCapture): void {
  if (capture.cancelled) throw new CaptureCancelled();
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function hideOverlay(tabId: number, hidden: boolean): Promise<void> {
  try {
    await browser.tabs.sendMessage(
      tabId,
      { type: 'XPC_HIDE_OVERLAY', hidden },
      { frameId: 0 },
    );
  } catch {
    // 内容脚本可能已断开
  }
}

function sendStatus(tabId: number, stage: CaptureStage, message?: string): void {
  browser.tabs
    .sendMessage(tabId, { type: 'XPC_STATUS', stage, message }, { frameId: 0 })
    .catch(() => {
      // 页面可能已关闭
    });
}

async function hasPermission(permission: string): Promise<boolean> {
  try {
    return await browser.permissions.contains({
      permissions: [permission] as unknown as Parameters<typeof browser.permissions.contains>[0]['permissions'],
    });
  } catch {
    return false;
  }
}

function validateCaptureSize(geometry: CaptureGeometry): void {
  const { width, height } = geometry.pageRect;
  if (width < 2 || height < 2) {
    throw new CaptureFailure(CAPTURE_ERROR.CAPTURE_FAILED, '目标推文尺寸无效，可能尚未渲染完成');
  }
  const dpr = Math.min(geometry.viewport.dpr || 1, 4);
  const pixelWidth = width * dpr;
  const pixelHeight = height * dpr;
  if (
    pixelWidth > MAX_CAPTURE_SIDE ||
    pixelHeight > MAX_CAPTURE_SIDE ||
    pixelWidth * pixelHeight > MAX_CAPTURE_PIXELS
  ) {
    throw new CaptureFailure(
      CAPTURE_ERROR.IMAGE_TOO_LARGE,
      `推文截图尺寸过大（约 ${Math.round(width)}×${Math.round(height)} CSS px），超出安全上限`,
    );
  }
}

async function requestGeometry(
  tabId: number,
  capture: ActiveCapture,
): Promise<CaptureGeometry | null> {
  ensureNotCancelled(capture);
  const response = await browser.tabs.sendMessage(
    tabId,
    { type: 'XPC_GET_GEOMETRY' },
    { frameId: 0 },
  );
  if (!response || !response.ok) return null;
  return response.geometry as CaptureGeometry;
}

async function attachDebugger(tabId: number): Promise<{ tabId: number }> {
  const target = { tabId };
  try {
    await browser.debugger.attach(target, DEBUGGER_PROTOCOL_VERSION);
  } catch (error) {
    const message = errorMessage(error);
    if (/already attached|another debugger/i.test(message)) {
      throw new CaptureFailure(
        CAPTURE_ERROR.DEBUGGER_CONFLICT,
        '浏览器调试会话被占用（可能打开了 DevTools），无法使用 CDP 截图',
      );
    }
    throw new CaptureFailure(CAPTURE_ERROR.PERMISSION_DENIED, `无法连接调试器：${message}`);
  }
  return target;
}

async function detachDebugger(target: { tabId: number }): Promise<void> {
  try {
    await browser.debugger.detach(target);
  } catch {
    // 会话可能已经被浏览器断开
  }
}

async function waitForPageAfterAttach(tabId: number): Promise<void> {
  // attach 会让浏览器显示调试提示条并改变页面视口，等待 X 重新布局与加载
  await delay(220);
  try {
    await browser.tabs.sendMessage(
      tabId,
      { type: 'XPC_PREPARE_CAPTURE' },
      { frameId: 0 },
    );
  } catch {
    // 页面可能尚未加载完内容脚本
  }
}

async function settleFrame(tabId: number): Promise<void> {
  try {
    await browser.tabs.sendMessage(
      tabId,
      { type: 'XPC_SETTLE_FRAME' },
      { frameId: 0 },
    );
  } catch {
    // 忽略
  }
}

async function captureWithCdp(
  tabId: number,
  geometry: CaptureGeometry,
  capture: ActiveCapture,
): Promise<string> {
  ensureNotCancelled(capture);
  const target = await attachDebugger(tabId);
  try {
    await waitForPageAfterAttach(tabId);
    const fresh = await requestGeometry(tabId, capture);
    const current = fresh ?? geometry;
    const metrics = (await browser.debugger.sendCommand(
      target,
      'Page.getLayoutMetrics',
    )) as { cssContentSize?: { width: number; height: number } };
    const contentWidth = metrics?.cssContentSize?.width ?? Number.MAX_SAFE_INTEGER;
    const contentHeight = metrics?.cssContentSize?.height ?? Number.MAX_SAFE_INTEGER;

    const x = Math.max(0, current.pageRect.left);
    const y = Math.max(0, current.pageRect.top);
    const width = Math.min(current.pageRect.width, contentWidth - x);
    const height = Math.min(current.pageRect.height, contentHeight - y);
    if (width < 1 || height < 1) {
      throw new CaptureFailure(CAPTURE_ERROR.CAPTURE_FAILED, '推文坐标超出页面范围');
    }

    if (capture.cancelled) throw new CaptureCancelled();
    const result = (await browser.debugger.sendCommand(
      target,
      'Page.captureScreenshot',
      {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: true,
        clip: { x, y, width, height, scale: 1 },
      },
    )) as { data?: string };
    if (!result?.data) {
      throw new CaptureFailure(CAPTURE_ERROR.CAPTURE_FAILED, 'CDP 未返回截图数据');
    }
    return `data:image/png;base64,${result.data}`;
  } catch (error) {
    if (error instanceof CaptureFailure || error instanceof CaptureCancelled) throw error;
    throw new CaptureFailure(CAPTURE_ERROR.CAPTURE_FAILED, `CDP 截图失败：${errorMessage(error)}`);
  } finally {
    await detachDebugger(target);
  }
}

async function captureViewportViaCdp(
  tabId: number,
  geometry: CaptureGeometry,
  capture: ActiveCapture,
): Promise<{ dataUrl: string; geometry: CaptureGeometry }> {
  ensureNotCancelled(capture);
  const target = await attachDebugger(tabId);
  try {
    await waitForPageAfterAttach(tabId);
    const fresh = await requestGeometry(tabId, capture);
    const result = (await browser.debugger.sendCommand(
      target,
      'Page.captureScreenshot',
      { format: 'png', fromSurface: true, captureBeyondViewport: false },
    )) as { data?: string };
    if (!result?.data) {
      throw new CaptureFailure(CAPTURE_ERROR.CAPTURE_FAILED, 'CDP 未返回视口截图数据');
    }
    return {
      dataUrl: `data:image/png;base64,${result.data}`,
      geometry: fresh ?? geometry,
    };
  } catch (error) {
    if (error instanceof CaptureFailure || error instanceof CaptureCancelled) throw error;
    throw new CaptureFailure(
      CAPTURE_ERROR.CAPTURE_FAILED,
      `CDP 视口截图失败：${errorMessage(error)}`,
    );
  } finally {
    await detachDebugger(target);
  }
}

async function captureViewportRegion(
  tabId: number,
  geometry: CaptureGeometry,
  capture: ActiveCapture,
): Promise<string> {
  ensureNotCancelled(capture);
  let dataUrl: string;
  let finalGeometry = geometry;
  try {
    // 优先使用 captureVisibleTab（不会出现调试提示条）
    dataUrl = await captureVisibleTab(tabId);
  } catch (error) {
    if (error instanceof CaptureCancelled || capture.cancelled) throw error;
    // 页面导航后 activeTab 失效，自动回退 CDP，避免每次都要点击扩展图标
    const shot = await captureViewportViaCdp(tabId, geometry, capture);
    dataUrl = shot.dataUrl;
    finalGeometry = shot.geometry;
  }
  return cropViewportImage(dataUrl, finalGeometry);
}

async function cropViewportImage(
  dataUrl: string,
  geometry: CaptureGeometry,
): Promise<string> {
  const viewport = geometry.viewport;
  const left = Math.max(0, geometry.viewportRect.left);
  const top = Math.max(0, geometry.viewportRect.top);
  const right = Math.min(
    viewport.width,
    geometry.viewportRect.left + geometry.viewportRect.width,
  );
  const bottom = Math.min(
    viewport.height,
    geometry.viewportRect.top + geometry.viewportRect.height,
  );
  const clip = { left, top, width: right - left, height: bottom - top };
  if (clip.width < 1 || clip.height < 1) {
    throw new CaptureFailure(CAPTURE_ERROR.CAPTURE_FAILED, '推文当前不可见');
  }
  const response = (await sendToOffscreen({
    target: 'offscreen',
    type: 'XPC_OFFSCREEN_CROP',
    dataUrl,
    viewportWidth: viewport.width,
    clipRect: clip,
  })) as { ok?: boolean; dataUrl?: string; error?: string };
  if (!response?.ok || !response.dataUrl) {
    throw new CaptureFailure(
      CAPTURE_ERROR.CAPTURE_FAILED,
      `图片裁切失败：${response?.error ?? '未知错误'}`,
    );
  }
  return response.dataUrl;
}

interface StitchPlanResponse {
  ok: boolean;
  plan?: StitchPlan;
  error?: string;
}

interface MeasurementResponse {
  ok: boolean;
  measurement?: Measurement;
  error?: string;
}

interface SimpleContentResponse {
  ok: boolean;
  error?: string;
}

async function fetchStitchPlan(tabId: number, warnings: string[]): Promise<StitchPlan> {
  const planResponse = (await browser.tabs.sendMessage(
    tabId,
    { type: 'XPC_GET_STITCH_PLAN' },
    { frameId: 0 },
  )) as StitchPlanResponse;
  if (!planResponse?.ok || !planResponse.plan) {
    throw new CaptureFailure(
      CAPTURE_ERROR.CAPTURE_FAILED,
      planResponse?.error ?? '无法计算滚动拼接方案',
    );
  }
  const plan = planResponse.plan;
  if (plan.positions.length === 0) {
    throw new CaptureFailure(CAPTURE_ERROR.CAPTURE_FAILED, '推文没有可截取的区域');
  }
  if (plan.positions.length > 25) {
    warnings.push(`推文较长，将分 ${plan.positions.length} 段截图，可能需要较长时间。`);
  }
  return plan;
}

async function scrollContent(
  tabId: number,
  kind: StitchPlan['kind'],
  value: number,
): Promise<void> {
  const response = (await browser.tabs.sendMessage(
    tabId,
    { type: 'XPC_SCROLL_TO', kind, value },
    { frameId: 0 },
  )) as SimpleContentResponse;
  if (!response?.ok) {
    throw new CaptureFailure(
      CAPTURE_ERROR.CAPTURE_FAILED,
      response?.error ?? '页面滚动失败',
    );
  }
}

async function restoreContentScroll(tabId: number): Promise<void> {
  try {
    await browser.tabs.sendMessage(tabId, { type: 'XPC_RESTORE_SCROLL' }, { frameId: 0 });
  } catch {
    // 页面可能已关闭
  }
}

async function fetchMeasurement(tabId: number): Promise<Measurement> {
  const response = (await browser.tabs.sendMessage(
    tabId,
    { type: 'XPC_MEASURE' },
    { frameId: 0 },
  )) as MeasurementResponse;
  if (!response?.ok || !response.measurement) {
    throw new CaptureFailure(
      CAPTURE_ERROR.CAPTURE_FAILED,
      response?.error ?? '测量推文可见区域失败',
    );
  }
  return response.measurement;
}

async function finishStitch(
  tabId: number,
  capture: ActiveCapture,
  segments: StitchSegment[],
): Promise<string> {
  ensureNotCancelled(capture);
  if (segments.length === 0) {
    throw new CaptureFailure(CAPTURE_ERROR.CAPTURE_FAILED, '没有截取到任何可见区域');
  }
  const firstSegment = segments[0]!;
  const targetWidthCss = firstSegment.targetRect.width;
  let targetHeightCss = 0;
  for (const segment of segments) {
    targetHeightCss = Math.max(
      targetHeightCss,
      segment.clipRect.top - segment.targetRect.top + segment.clipRect.height,
    );
  }
  if (targetWidthCss < 1 || targetHeightCss < 1) {
    throw new CaptureFailure(CAPTURE_ERROR.CAPTURE_FAILED, '拼接图片尺寸无效');
  }
  sendStatus(tabId, 'stitching', '正在拼接图片…');
  const response = (await sendToOffscreen({
    target: 'offscreen',
    type: 'XPC_OFFSCREEN_STITCH',
    targetWidthCss,
    targetHeightCss,
    segments,
  })) as { ok?: boolean; dataUrl?: string; error?: string };
  if (!response?.ok || !response.dataUrl) {
    throw new CaptureFailure(
      CAPTURE_ERROR.CAPTURE_FAILED,
      `图片拼接失败：${response?.error ?? '未知错误'}`,
    );
  }
  return response.dataUrl;
}

async function captureStitchedViaCdp(
  tabId: number,
  capture: ActiveCapture,
  warnings: string[],
): Promise<string> {
  const segments: StitchSegment[] = [];
  const target = await attachDebugger(tabId);
  try {
    await waitForPageAfterAttach(tabId);
    const plan = await fetchStitchPlan(tabId, warnings);
    for (let index = 0; index < plan.positions.length; index += 1) {
      ensureNotCancelled(capture);
      sendStatus(
        tabId,
        'stitching',
        `正在截取第 ${index + 1}/${plan.positions.length} 段…`,
      );
      await scrollContent(tabId, plan.kind, plan.positions[index]!);
      await settleFrame(tabId);
      const measurement = await fetchMeasurement(tabId);
      if (!measurement.clipRect) continue;
      const shot = (await browser.debugger.sendCommand(
        target,
        'Page.captureScreenshot',
        { format: 'png', fromSurface: true, captureBeyondViewport: false },
      )) as { data?: string };
      if (!shot?.data) {
        throw new CaptureFailure(CAPTURE_ERROR.CAPTURE_FAILED, 'CDP 未返回分段截图数据');
      }
      segments.push({
        dataUrl: `data:image/png;base64,${shot.data}`,
        viewportWidth: measurement.viewport.width,
        targetRect: measurement.targetRect,
        clipRect: measurement.clipRect,
      });
    }
  } finally {
    await restoreContentScroll(tabId);
    await detachDebugger(target);
  }
  return finishStitch(tabId, capture, segments);
}

async function captureStitchedViaTabs(
  tabId: number,
  capture: ActiveCapture,
  warnings: string[],
): Promise<string> {
  const plan = await fetchStitchPlan(tabId, warnings);
  const segments: StitchSegment[] = [];
  try {
    for (let index = 0; index < plan.positions.length; index += 1) {
      ensureNotCancelled(capture);
      sendStatus(
        tabId,
        'stitching',
        `正在截取第 ${index + 1}/${plan.positions.length} 段…`,
      );
      await scrollContent(tabId, plan.kind, plan.positions[index]!);
      await settleFrame(tabId);
      const measurement = await fetchMeasurement(tabId);
      if (!measurement.clipRect) continue;
      const dataUrl = await captureVisibleTab(tabId);
      segments.push({
        dataUrl,
        viewportWidth: measurement.viewport.width,
        targetRect: measurement.targetRect,
        clipRect: measurement.clipRect,
      });
    }
  } finally {
    await restoreContentScroll(tabId);
  }
  return finishStitch(tabId, capture, segments);
}

/**
 * 页面内按钮无法授予 activeTab，因此优先使用已声明的 CDP 权限。
 * captureVisibleTab 仅作为 CDP 不可用时的回退。
 */
async function captureStitched(
  tabId: number,
  capture: ActiveCapture,
  warnings: string[],
  preferCdp = true,
): Promise<string> {
  if (preferCdp) {
    try {
      return await captureStitchedViaCdp(tabId, capture, warnings);
    } catch (error) {
      if (error instanceof CaptureCancelled || capture.cancelled) throw error;
      warnings.push(`CDP 分段截图失败，尝试使用 captureVisibleTab：${errorMessage(error)}`);
    }
  }
  try {
    return await captureStitchedViaTabs(tabId, capture, warnings);
  } catch (error) {
    if (error instanceof CaptureCancelled || capture.cancelled) throw error;
    // 页面导航后 activeTab 失效时自动改用 CDP，避免用户必须重新点击扩展图标
    warnings.push('当前页面未授予 activeTab，已自动改用 CDP 完成截图。');
    return await captureStitchedViaCdp(tabId, capture, warnings);
  }
}

async function captureVisibleTab(tabId: number): Promise<string> {
  const tab = await browser.tabs.get(tabId);
  if (!tab.active) {
    throw new CaptureFailure(
      CAPTURE_ERROR.CAPTURE_FAILED,
      '目标标签页当前不是活动标签页，请切换回该页面后重试',
    );
  }
  const wait = lastCaptureVisibleAt + CAPTURE_VISIBLE_MIN_INTERVAL - Date.now();
  if (wait > 0) await delay(wait);
  lastCaptureVisibleAt = Date.now();
  try {
    return await browser.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  } catch (error) {
    throw new CaptureFailure(
      CAPTURE_ERROR.CAPTURE_FAILED,
      `截取可见区域失败：${errorMessage(error)}。若刚刚导航过页面，请先点击扩展图标再重试。`,
    );
  }
}

interface OutputResult {
  clipboard: OutputStatus;
  clipboardError?: string;
  download: OutputStatus;
  downloadError?: string;
}

async function deliverOutput(
  dataUrl: string,
  geometry: CaptureGeometry,
  settings: CaptureSettings,
  tabId: number,
): Promise<OutputResult> {
  const result: OutputResult = { clipboard: 'skipped', download: 'skipped' };
  if (settings.copyToClipboard) {
    sendStatus(tabId, 'clipboard', '正在复制到剪贴板…');
    try {
      await writeClipboard(tabId, dataUrl);
      result.clipboard = 'ok';
    } catch (error) {
      console.error('[xpc] clipboard failed', error);
      result.clipboard = 'failed';
      result.clipboardError = errorMessage(error);
    }
  }
  if (settings.downloadToLocal) {
    sendStatus(tabId, 'downloading', '正在下载 PNG…');
    try {
      await downloadImage(dataUrl, buildFileName(geometry.metadata));
      result.download = 'ok';
    } catch (error) {
      console.error('[xpc] download failed', error);
      result.download = 'failed';
      result.downloadError = errorMessage(error);
    }
  }
  return result;
}

/**
 * 依次尝试三个写入环境：
 * 1. 内容脚本所在的 X 页面（有焦点，Clipboard API 最可靠）
 * 2. Offscreen Document（受 CLIPBOARD reason 支持，但文档无法获得焦点）
 * 3. Service Worker（Chrome 116+ 且拥有 clipboardWrite 权限时可用）
 */
async function writeClipboard(tabId: number, dataUrl: string): Promise<void> {
  const errors: string[] = [];

  try {
    const response = (await browser.tabs.sendMessage(
      tabId,
      { type: 'XPC_WRITE_CLIPBOARD', dataUrl },
      { frameId: 0 },
    )) as { ok?: boolean; error?: string } | undefined;
    if (response?.ok) return;
    errors.push(`页面：${response?.error ?? '无响应'}`);
  } catch (error) {
    errors.push(`页面：${errorMessage(error)}`);
  }

  try {
    const response = (await sendToOffscreen({
      target: 'offscreen',
      type: 'XPC_OFFSCREEN_CLIPBOARD',
      dataUrl,
    })) as { ok?: boolean; error?: string } | undefined;
    if (response?.ok) return;
    errors.push(`offscreen：${response?.error ?? '无响应'}`);
  } catch (error) {
    errors.push(`offscreen：${errorMessage(error)}`);
  }

  try {
    const blob = await (await fetch(dataUrl)).blob();
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
      throw new Error('Service Worker 不支持 Clipboard API');
    }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return;
  } catch (error) {
    errors.push(`后台：${errorMessage(error)}`);
  }

  throw new Error(errors.join('；'));
}

async function downloadImage(dataUrl: string, filename: string): Promise<void> {
  const allowed = await hasPermission('downloads');
  if (!allowed) {
    throw new CaptureFailure(
      CAPTURE_ERROR.PERMISSION_DENIED,
      '下载需要 downloads 权限，请在扩展弹出层重新授权',
    );
  }
  await browser.downloads.download({
    url: dataUrl,
    filename,
    conflictAction: 'uniquify',
    saveAs: false,
  });
}

async function ensureOffscreenDocument(): Promise<void> {
  const offscreen = (browser as unknown as {
    offscreen?: {
      createDocument: (options: {
        url: string;
        reasons: string[];
        justification: string;
      }) => Promise<void>;
    };
  }).offscreen;
  if (!offscreen) {
    throw new CaptureFailure(CAPTURE_ERROR.OFFSCREEN_UNAVAILABLE, '当前浏览器不支持 offscreen 文档');
  }
  const url = browser.runtime.getURL('/offscreen.html');
  try {
    const contexts = await browser.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [url],
    });
    if (contexts.length > 0) return;
  } catch {
    // getContexts 在较旧版本不可用，直接尝试创建
  }
  if (!offscreenCreating) {
    offscreenCreating = offscreen
      .createDocument({
        url,
        reasons: ['CLIPBOARD'],
        justification: '处理截图图片并写入系统剪贴板',
      })
      .catch((error: unknown) => {
        const message = errorMessage(error);
        if (!/already|existing/i.test(message)) throw error;
      })
      .finally(() => {
        offscreenCreating = null;
      });
  }
  await offscreenCreating;
}

async function sendToOffscreen(message: OffscreenRequest): Promise<unknown> {
  await ensureOffscreenDocument();
  try {
    return await browser.runtime.sendMessage(message);
  } catch (error) {
    throw new CaptureFailure(
      CAPTURE_ERROR.OFFSCREEN_UNAVAILABLE,
      `无法与图片处理页面通信：${errorMessage(error)}`,
    );
  }
}