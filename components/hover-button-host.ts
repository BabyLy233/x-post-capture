import { OWN_ATTRIBUTE } from '@/modules/tweet/tweet-detector';

const BUTTON_STYLES = `
:host {
  all: initial;
}
* {
  box-sizing: border-box;
}
.xpc-hover-btn {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: #536471;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  pointer-events: auto;
  box-shadow: none;
  padding: 0;
  margin: 0;
  transition:
    background 0.15s ease,
    color 0.15s ease;
}
.xpc-hover-btn:hover {
  background: rgba(15, 20, 25, 0.1);
  color: #0f1419;
}
.xpc-hover-btn[data-theme='dark'] {
  background: transparent;
  color: #e7e9ea;
}
.xpc-hover-btn[data-theme='dark']:hover {
  background: rgba(239, 243, 244, 0.1);
}
.xpc-hover-btn svg {
  width: 18px;
  height: 18px;
  display: block;
}
`;

const CAMERA_SVG = `
<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <path d="M4 7.5h2.6l1.2-2h8.4l1.2 2H20a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
  <circle cx="12" cy="12.5" r="3.4" stroke="currentColor" stroke-width="1.7"/>
</svg>
`;

export interface HoverButtonCallbacks {
  onQuickCapture: () => void;
  onOpenToolbar: () => void;
  shouldOpenToolbar: () => boolean;
}

/**
 * 悬浮截图按钮。宿主元素被插入推文卡片内部并使用绝对定位，
 * 因此滚动、X 重排时都会跟随对应的推文，而不是依赖每帧计算 fixed 坐标。
 */
export class HoverButtonHost {
  readonly host: HTMLElement;
  private readonly button: HTMLButtonElement;

  constructor(callbacks: HoverButtonCallbacks) {
    this.host = document.createElement('div');
    this.host.className = 'xpc-hover-host';
    this.host.setAttribute(OWN_ATTRIBUTE, 'true');
    this.host.style.cssText =
      'position:absolute;display:block;z-index:5;pointer-events:none;';
    this.host.style.display = 'none';

    const shadow = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = BUTTON_STYLES;

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'xpc-hover-btn';
    this.button.title = '点击立即截图；按住 Alt 点击可打开工具栏并屏蔽元素';
    this.button.innerHTML = CAMERA_SVG;
    this.button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (
        event.altKey ||
        event.metaKey ||
        event.shiftKey ||
        callbacks.shouldOpenToolbar()
      ) {
        callbacks.onOpenToolbar();
      } else {
        callbacks.onQuickCapture();
      }
    });

    shadow.append(style, this.button);
  }

  attach(article: HTMLElement): void {
    if (this.host.parentElement !== article) {
      article.appendChild(this.host);
    }
    this.host.style.display = 'block';
  }

  detach(): void {
    this.host.style.display = 'none';
    this.host.remove();
  }

  get connected(): boolean {
    return this.host.isConnected;
  }

  setPosition(top: number, left: number): void {
    this.host.style.top = `${Math.round(top)}px`;
    this.host.style.left = `${Math.round(left)}px`;
  }

  setTheme(theme: 'light' | 'dark'): void {
    this.button.dataset.theme = theme;
  }

  setHidden(hidden: boolean): void {
    this.host.style.visibility = hidden ? 'hidden' : '';
  }
}