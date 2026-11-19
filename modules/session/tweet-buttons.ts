import { HoverButtonHost } from '@/components/hover-button-host';
import { listTweets } from '@/modules/tweet/tweet-detector';

const BUTTON_SIZE = 32;
const RIGHT_OFFSET = 88;
const TOP_OFFSET = 10;
const SCAN_DELAY = 120;

export interface TweetButtonCallbacks {
  onCapture: (article: HTMLElement) => void;
  onOpenToolbar: (article: HTMLElement) => void;
  shouldOpenToolbar: () => boolean;
}

/**
 * 为页面上每条推文挂载一个常驻的截图按钮。
 * 按钮是推文卡片的子元素（绝对定位），滚动时随推文移动。
 * X 的虚拟列表增删推文时由 MutationObserver 增量同步。
 */
export class TweetButtonManager {
  private readonly buttons = new Map<HTMLElement, HoverButtonHost>();
  private readonly patchedPositions = new Set<HTMLElement>();
  private observer: MutationObserver | null = null;
  private scanTimer: number | null = null;
  private active = false;

  constructor(private readonly callbacks: TweetButtonCallbacks) {}

  start(): void {
    if (this.active) return;
    this.active = true;
    this.observer = new MutationObserver(() => this.scheduleScan());
    if (document.body) {
      this.observer.observe(document.body, { childList: true, subtree: true });
    }
    this.scheduleScan();
  }

  stop(): void {
    this.active = false;
    this.observer?.disconnect();
    this.observer = null;
    if (this.scanTimer !== null) {
      window.clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }
    for (const [article, host] of this.buttons) {
      host.detach();
      this.restorePosition(article);
    }
    this.buttons.clear();
  }

  setHidden(hidden: boolean): void {
    for (const host of this.buttons.values()) host.setHidden(hidden);
  }

  private scheduleScan(): void {
    if (!this.active || this.scanTimer !== null) return;
    this.scanTimer = window.setTimeout(() => {
      this.scanTimer = null;
      this.scan();
    }, SCAN_DELAY);
  }

  private scan(): void {
    if (!this.active) return;
    const seen = new Set<HTMLElement>();
    for (const article of listTweets()) {
      seen.add(article);
      let host = this.buttons.get(article);
      if (!host) {
        host = new HoverButtonHost({
          onQuickCapture: () => this.callbacks.onCapture(article),
          onOpenToolbar: () => this.callbacks.onOpenToolbar(article),
          shouldOpenToolbar: () => this.callbacks.shouldOpenToolbar(),
        });
        this.buttons.set(article, host);
      }
      if (host.host.parentElement !== article) {
        this.mount(article, host);
      } else {
        this.updatePosition(article, host);
      }
    }
    for (const [article, host] of this.buttons) {
      if (seen.has(article) && article.isConnected) continue;
      host.detach();
      this.restorePosition(article);
      this.buttons.delete(article);
    }
  }

  private mount(article: HTMLElement, host: HoverButtonHost): void {
    if (getComputedStyle(article).position === 'static') {
      article.style.position = 'relative';
      this.patchedPositions.add(article);
    }
    host.attach(article);
    this.updatePosition(article, host);
    host.setTheme(detectTheme());
  }

  private updatePosition(article: HTMLElement, host: HoverButtonHost): void {
    const articleRect = article.getBoundingClientRect();
    if (articleRect.width < 1) return;
    // absolute 定位以 article 的 padding box 为原点
    const originLeft = articleRect.left + article.clientLeft;
    const originTop = articleRect.top + article.clientTop;
    const anchor = article.querySelector<HTMLElement>(
      '[aria-label*="Grok" i], [data-testid="caret"]',
    );
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const top = rect.top - originTop + (rect.height - BUTTON_SIZE) / 2;
        const left = rect.left - originLeft - BUTTON_SIZE - 4;
        host.setPosition(Math.max(4, top), Math.max(4, left));
        host.setTheme(detectTheme());
        return;
      }
    }
    // 操作按钮尚未渲染时的回退位置
    host.setPosition(
      TOP_OFFSET,
      Math.max(8, articleRect.width - BUTTON_SIZE - RIGHT_OFFSET),
    );
    host.setTheme(detectTheme());
  }

  private restorePosition(article: HTMLElement): void {
    if (this.patchedPositions.delete(article) && article.isConnected) {
      article.style.removeProperty('position');
    }
  }
}

function detectTheme(): 'light' | 'dark' {
  try {
    const background = getComputedStyle(document.body).backgroundColor;
    const match = background.match(/\d+(?:\.\d+)?/g);
    if (!match || match.length < 3) return 'light';
    const r = Number(match[0] ?? 0);
    const g = Number(match[1] ?? 0);
    const b = Number(match[2] ?? 0);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance < 0.5 ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}