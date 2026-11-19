import type {
  CaptureGeometry,
  Measurement,
  Rect,
  StitchPlan,
  ViewportInfo,
} from '@/types/capture';

import { findScrollContainer, isOwnElement } from '@/modules/tweet/tweet-detector';
import { buildCaptureMetadata } from '@/modules/tweet/tweet-metadata';

const MAX_STITCH_SEGMENTS = 30;
const STITCH_OVERLAP = 24;

export function rectFromDomRect(rect: DOMRect): Rect {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

export function getViewportInfo(): ViewportInfo {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    dpr: window.devicePixelRatio || 1,
  };
}

export function intersectRect(a: Rect, b: Rect): Rect | null {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  if (right <= left || bottom <= top) return null;
  return { left, top, width: right - left, height: bottom - top };
}

export function expandRect(rect: Rect, padding: number): Rect {
  return {
    left: rect.left - padding,
    top: rect.top - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  };
}

/**
 * 计算目标推文的截图几何信息。
 * pageRect 使用文档坐标，供 CDP 的 clip 使用；
 * viewportRect 使用视口坐标，供 captureVisibleTab 裁切使用。
 */
export function measureGeometry(article: HTMLElement): CaptureGeometry {
  const rect = article.getBoundingClientRect();
  const viewport = getViewportInfo();
  return {
    metadata: buildCaptureMetadata(article),
    viewportRect: rectFromDomRect(rect),
    pageRect: {
      left: rect.left + viewport.scrollX,
      top: rect.top + viewport.scrollY,
      width: rect.width,
      height: rect.height,
    },
    viewport,
  };
}

/**
 * 测量固定在视口顶部、会遮挡页面内容的元素高度（例如 X 的时间线 tab 栏）。
 * 通过采样视口顶部若干点，向上查找 fixed / sticky 祖先元素。
 */
export function getTopOcclusion(article: HTMLElement): number {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const articleRect = article.getBoundingClientRect();
  const left = Math.max(0, articleRect.left);
  const right = Math.min(width, articleRect.right);
  const points =
    right > left
      ? [0.5, 0.25, 0.75, 0.1, 0.9].map((ratio) => left + (right - left) * ratio)
      : [width / 2];
  const maxHeight = Math.min(240, height * 0.45);
  let bottom = 0;
  for (const x of points) {
    const elements = document.elementsFromPoint(x, 4);
    for (const element of elements) {
      if (!(element instanceof Element)) continue;
      if (isOwnElement(element)) break;
      let current: Element | null = element;
      let covered = 0;
      while (current && current !== document.body) {
        if (article.contains(current) || current.contains(article)) break;
        const style = getComputedStyle(current);
        if (style.position === 'fixed' || style.position === 'sticky') {
          const rect = current.getBoundingClientRect();
          // 排除铺满整列/整页的固定容器（例如左侧导航栏），只处理顶部横条
          if (rect.top <= 1 && rect.bottom > 0 && rect.height <= maxHeight) {
            covered = rect.bottom;
          }
          break;
        }
        current = current.parentElement;
      }
      if (covered > 0) {
        bottom = Math.max(bottom, covered);
        break;
      }
    }
  }
  return Math.min(Math.max(0, bottom), maxHeight);
}

export interface StitchContext {
  kind: 'window' | 'element';
  container: HTMLElement | null;
  /** 目标内容可以出现在截图中的区域（视口坐标） */
  visibleWindow: Rect;
}

export function getStitchContext(article: HTMLElement): StitchContext {
  const container = findScrollContainer(article);
  const viewportRect: Rect = {
    left: 0,
    top: 0,
    width: window.innerWidth,
    height: window.innerHeight,
  };
  if (container) {
    const containerRect = container.getBoundingClientRect();
    const contentRect: Rect = {
      left: containerRect.left + container.clientLeft,
      top: containerRect.top + container.clientTop,
      width: container.clientWidth,
      height: container.clientHeight,
    };
    return {
      kind: 'element',
      container,
      visibleWindow: intersectRect(contentRect, viewportRect) ?? {
        left: 0,
        top: 0,
        width: 0,
        height: 0,
      },
    };
  }
  return { kind: 'window', container: null, visibleWindow: viewportRect };
}

export function buildStitchPlan(article: HTMLElement): {
  plan: StitchPlan;
  container: HTMLElement | null;
} {
  const context = getStitchContext(article);
  const rect = article.getBoundingClientRect();
  const occlusion = getTopOcclusion(article);
  if (context.kind === 'window') {
    const targetTop = rect.top + window.scrollY;
    const maxScroll = Math.max(
      0,
      document.documentElement.scrollHeight - window.innerHeight,
    );
    const visibleHeight = Math.max(1, window.innerHeight - occlusion);
    return {
      container: null,
      plan: {
        kind: 'window',
        positions: planScrollPositions(
          targetTop,
          rect.height,
          maxScroll,
          occlusion,
          visibleHeight,
        ),
        maxScroll,
      },
    };
  }
  const container = context.container!;
  const containerRect = container.getBoundingClientRect();
  const contentTop = containerRect.top + container.clientTop;
  const contentBottom = contentTop + container.clientHeight;
  const visibleTop = Math.max(contentTop, occlusion);
  const visibleBottom = Math.min(contentBottom, window.innerHeight);
  const targetTop = container.scrollTop + (rect.top - contentTop);
  const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
  return {
    container,
    plan: {
      kind: 'element',
      positions: planScrollPositions(
        targetTop,
        rect.height,
        maxScroll,
        visibleTop - contentTop,
        Math.max(1, visibleBottom - visibleTop),
      ),
      maxScroll,
    },
  };
}

function planScrollPositions(
  targetTop: number,
  targetHeight: number,
  maxScroll: number,
  topOffset: number,
  visibleHeight: number,
): number[] {
  if (visibleHeight <= 0 || targetHeight <= 0) return [];
  const positions: number[] = [];
  let position = Math.max(0, Math.min(targetTop - topOffset, maxScroll));
  const end = targetTop + targetHeight;
  for (let index = 0; index < MAX_STITCH_SEGMENTS; index += 1) {
    positions.push(position);
    if (position + topOffset + visibleHeight >= end - 0.5) break;
    if (position >= maxScroll) break;
    const step = Math.max(24, visibleHeight - STITCH_OVERLAP);
    const next = Math.min(position + step, maxScroll);
    if (next === position) break;
    position = next;
  }
  return positions;
}

/** 测量当前滚动状态下目标推文的可见区域 */
export function measureForCapture(
  article: HTMLElement,
  container: HTMLElement | null,
): Measurement {
  const rect = article.getBoundingClientRect();
  const targetRect = rectFromDomRect(rect);
  const occlusion = getTopOcclusion(article);
  const viewportRect: Rect = {
    left: 0,
    top: occlusion,
    width: window.innerWidth,
    height: Math.max(0, window.innerHeight - occlusion),
  };
  const windowRect: Rect = container
    ? (() => {
        const containerRect = container.getBoundingClientRect();
        return {
          left: containerRect.left + container.clientLeft,
          top: containerRect.top + container.clientTop,
          width: container.clientWidth,
          height: container.clientHeight,
        };
      })()
    : viewportRect;
  const visible = intersectRect(windowRect, viewportRect);
  const clipRect = visible ? intersectRect(targetRect, visible) : null;
  return {
    targetRect,
    clipRect,
    viewport: getViewportInfo(),
  };
}

export { MAX_STITCH_SEGMENTS };