import { browser } from 'wxt/browser';

import type { CaptureResult, CaptureStage, Rect } from '@/types/capture';
import type { MaskedItemInfo } from '@/types/messages';
import type { CaptureSettings, HideMode } from '@/types/settings';
import { createId, loadRules, saveRules } from '@/modules/settings-store';
import {
  applyMask,
  applyRulesToTweet,
  buildSelectorWithin,
  restoreAllMasks,
  restoreMask,
  type MaskRecord,
} from '@/modules/filter/dom-filter';
import { ElementPicker } from '@/modules/filter/element-picker';
import { preparePageForCapture } from '@/modules/page/dom-stability';
import {
  captureScrollSnapshot,
  restoreScrollSnapshot,
  type ScrollSnapshot,
} from '@/modules/page/scroll-manager';
import { getTweetIdentity, listTweets } from '@/modules/tweet/tweet-detector';
import { getTweetLabel } from '@/modules/tweet/tweet-metadata';
import { DEFAULT_SETTINGS } from '@/types/settings';
import { TweetButtonManager } from '@/modules/session/tweet-buttons';

export type ToastKind = 'success' | 'warning' | 'error';

export interface SessionState {
  active: boolean;
  /** 是否显示完整的页面工具栏（普通点击悬浮按钮只做快速截图） */
  toolbarVisible: boolean;
  settings: CaptureSettings;
  selectedLabel: string | null;
  selectedKey: string | null;
  pickerActive: boolean;
  hideMode: HideMode;
  masks: MaskedItemInfo[];
  maskPanelOpen: boolean;
  highlight: Rect | null;
  busy: boolean;
  stage: CaptureStage | null;
  statusText: string | null;
  resultText: string | null;
  resultKind: ToastKind | null;
}

const STAGE_LABELS: Record<CaptureStage, string> = {
  detecting: '正在识别推文…',
  'waiting-stable': '正在等待页面稳定…',
  capturing: '正在截图…',
  stitching: '正在拼接图片…',
  clipboard: '正在写入剪贴板…',
  downloading: '正在下载…',
  done: '截图完成',
  error: '截图失败',
};

const INITIAL_STATE: SessionState = {
  active: false,
  toolbarVisible: false,
  settings: { ...DEFAULT_SETTINGS },
  selectedLabel: null,
  selectedKey: null,
  pickerActive: false,
  hideMode: 'remove-space',
  masks: [],
  maskPanelOpen: false,
  highlight: null,
  busy: false,
  stage: null,
  statusText: null,
  resultText: null,
  resultKind: null,
};

export class SessionController {
  private state: SessionState = INITIAL_STATE;
  private readonly listeners = new Set<() => void>();

  private settings: CaptureSettings = { ...DEFAULT_SETTINGS };
  private selectedArticle: HTMLElement | null = null;
  private selectedKey: string | null = null;
  private masks: MaskRecord[] = [];
  private savedSnapshot: ScrollSnapshot | null = null;
  private geometrySnapshot: ScrollSnapshot | null = null;
  private toastTimer: number | null = null;
  private readonly tweetButtons: TweetButtonManager;
  private readonly picker: ElementPicker;

  constructor() {
    this.tweetButtons = new TweetButtonManager({
      onCapture: (article) => void this.quickCapture(article),
      onOpenToolbar: (article) => void this.openToolbar(article),
      shouldOpenToolbar: () => this.settings.openToolbarOnClick,
    });
    this.picker = new ElementPicker({
      getArticle: () => this.resolveArticle(),
      onHighlight: (rect) => {
        this.set({
          highlight: rect
            ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
            : null,
        });
      },
      onPick: (element) => this.handlePick(element),
      onExit: () => {
        this.set({ pickerActive: false, highlight: null });
        if (!this.state.busy) this.tweetButtons.setHidden(false);
      },
    });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SessionState => this.state;

  // ---------------------------------------------------------------- session

  activate(settings: CaptureSettings): void {
    this.settings = settings;
    this.set({ active: true, settings });
    this.tweetButtons.start();
  }

  updateSettings(settings: CaptureSettings): void {
    this.settings = settings;
    this.set({ settings });
  }

  deactivate(): void {
    if (this.state.busy) {
      void this.cancelCapture();
    }
    this.picker.exit();
    this.restoreTransientState();
    this.selectedArticle = null;
    this.selectedKey = null;
    this.tweetButtons.stop();
    this.set({
      active: false,
      toolbarVisible: false,
      selectedLabel: null,
      selectedKey: null,
      pickerActive: false,
      masks: [],
      maskPanelOpen: false,
      highlight: null,
      busy: false,
      stage: null,
      statusText: null,
      resultText: null,
      resultKind: null,
    });
  }

  // ---------------------------------------------------------------- selection

  private selectInternal(article: HTMLElement): boolean {
    if (!this.state.active || !article.isConnected) return false;
    this.picker.exit();
    if (this.selectedArticle) this.clearMasks();
    this.selectedArticle = article;
    this.selectedKey = getTweetIdentity(article).key;
    this.set({
      selectedLabel: getTweetLabel(article),
      selectedKey: this.selectedKey,
      pickerActive: false,
      maskPanelOpen: false,
      resultText: null,
      resultKind: null,
    });
    return true;
  }

  /** 点击悬浮相机按钮：选中并立即截图 */
  async quickCapture(article: HTMLElement): Promise<void> {
    if (this.state.busy) return;
    if (!this.selectInternal(article)) return;
    await this.applySavedRules();
    await this.startCapture();
  }

  /** 按住 Alt 点击悬浮相机按钮：选中并打开工具栏，可屏蔽元素后再截图 */
  async openToolbar(article: HTMLElement): Promise<void> {
    if (this.state.busy) return;
    if (!this.selectInternal(article)) return;
    this.set({ toolbarVisible: true });
    await this.applySavedRules();
  }

  closeToolbar(): void {
    if (this.state.busy) {
      void this.cancelCapture();
      return;
    }
    this.picker.exit();
    this.restoreTransientState();
    this.selectedArticle = null;
    this.selectedKey = null;
    this.set({
      toolbarVisible: false,
      selectedLabel: null,
      selectedKey: null,
      pickerActive: false,
      maskPanelOpen: false,
      resultText: null,
      resultKind: null,
    });
  }

  /** 快速截图结束后清除选中状态，但保留结果提示 */
  private resetSelectionAfterQuickCapture(): void {
    this.picker.exit();
    this.selectedArticle = null;
    this.selectedKey = null;
    this.set({
      selectedLabel: null,
      selectedKey: null,
      pickerActive: false,
      maskPanelOpen: false,
    });
  }

  private resolveArticle(): HTMLElement | null {
    if (this.selectedArticle?.isConnected) return this.selectedArticle;
    if (this.selectedKey) {
      const found = listTweets().find(
        (article) => getTweetIdentity(article).key === this.selectedKey,
      );
      if (found) {
        this.selectedArticle = found;
        return found;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- filters

  setHideMode(hideMode: HideMode): void {
    this.set({ hideMode });
  }

  togglePicker(): void {
    if (this.state.busy) return;
    if (this.picker.isActive) {
      this.picker.exit();
      return;
    }
    if (!this.resolveArticle()) {
      this.showToast('请先选择一条推文，再屏蔽其中的元素', 'warning');
      return;
    }
    this.tweetButtons.setHidden(true);
    this.set({ pickerActive: true, maskPanelOpen: false, resultText: null });
    this.picker.start();
  }

  toggleMaskPanel(): void {
    this.set({ maskPanelOpen: !this.state.maskPanelOpen });
  }

  private handlePick(element: HTMLElement): void {
    if (!this.resolveArticle()?.contains(element)) return;
    const existing = this.masks.find((record) => record.element === element);
    if (existing) return;
    const record = applyMask(element, this.state.hideMode, 'manual');
    this.masks.push(record);
    this.syncMasks();
    this.set({ highlight: null });
  }

  restoreMaskItem(id: string): void {
    const index = this.masks.findIndex((record) => record.id === id);
    if (index < 0) return;
    const record = this.masks[index];
    if (!record) return;
    this.masks.splice(index, 1);
    restoreMask(record);
    this.syncMasks();
  }

  restoreAllMaskItems(): void {
    restoreAllMasks(this.masks);
    this.masks = [];
    this.syncMasks();
  }

  async saveMaskAsRule(id: string): Promise<void> {
    const record = this.masks.find((item) => item.id === id);
    const article = this.resolveArticle();
    if (!record || !article) return;
    if (record.saved) {
      this.showToast('该屏蔽项已保存为规则', 'warning');
      return;
    }
    const selector = buildSelectorWithin(record.element, article);
    if (!selector) {
      this.showToast('无法为该元素生成稳定的选择器，暂时只能用于本次截图', 'error');
      return;
    }
    const rules = await loadRules();
    rules.push({
      id: createId(),
      name: record.label,
      selector,
      enabled: true,
      hideMode: record.hideMode,
      createdAt: Date.now(),
    });
    await saveRules(rules);
    record.saved = true;
    this.syncMasks();
    this.showToast('已保存为过滤规则，下次选中同类推文会自动应用', 'success');
  }

  private async applySavedRules(): Promise<void> {
    const article = this.resolveArticle();
    if (!article) return;
    try {
      const rules = await loadRules();
      const records = applyRulesToTweet(article, rules);
      this.masks = this.masks.filter((record) => record.source === 'manual');
      this.masks.push(...records);
      this.syncMasks();
    } catch {
      // 规则应用失败不阻塞截图
    }
  }

  private clearMasks(): void {
    restoreAllMasks(this.masks);
    this.masks = [];
    this.syncMasks();
  }

  private syncMasks(): void {
    const masks: MaskedItemInfo[] = this.masks.map((record) => ({
      id: record.id,
      label: record.label,
      source: record.source,
      saved: record.saved,
    }));
    this.set({ masks });
  }

  // ---------------------------------------------------------------- capture

  async startCapture(): Promise<void> {
    if (this.state.busy || !this.state.active) return;
    const settings = this.settings;
    if (!settings.copyToClipboard && !settings.downloadToLocal) {
      this.showToast('请至少启用一种输出方式（复制到剪贴板或下载到本地）', 'error');
      return;
    }
    let article = this.resolveArticle();
    if (!article) {
      this.showToast('请先选择一条推文', 'error');
      return;
    }

    if (article !== this.selectedArticle) {
      this.selectedArticle = article;
      await this.applySavedRules();
    }

    this.picker.exit();
    this.set({
      busy: true,
      stage: 'waiting-stable',
      statusText: STAGE_LABELS['waiting-stable'],
      resultText: null,
      resultKind: null,
      maskPanelOpen: false,
    });
    this.savedSnapshot = captureScrollSnapshot(article);
    // 截图期间扩展 UI 会被隐藏，Esc 是唯一的页面内取消入口
    const handleCancelKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      void this.cancelCapture();
    };
    document.addEventListener('keydown', handleCancelKey, true);

    try {
      await preparePageForCapture(article);
      article = this.resolveArticle() ?? article;
      this.set({ stage: 'capturing', statusText: STAGE_LABELS.capturing });
      const result = (await browser.runtime.sendMessage({
        type: 'XPC_CAPTURE_REQUEST',
        settings,
      })) as CaptureResult | undefined;
      if (!result) throw new Error('后台没有返回截图结果');
      this.applyResult(result);
    } catch (error) {
      this.showToast(`截图失败：${messageOf(error)}`, 'error');
    } finally {
      document.removeEventListener('keydown', handleCancelKey, true);
      this.restoreTransientState();
      this.set({ busy: false, stage: null, statusText: null });
      if (!this.state.toolbarVisible) {
        this.resetSelectionAfterQuickCapture();
      }
    }
  }

  async cancelCapture(): Promise<void> {
    if (!this.state.busy) return;
    try {
      await browser.runtime.sendMessage({ type: 'XPC_CANCEL_CAPTURE' });
      this.set({ statusText: '正在取消…' });
    } catch {
      // 后台可能已休眠
    }
  }

  private applyResult(result: CaptureResult): void {
    const parts: string[] = [];
    if (result.clipboard === 'ok') parts.push('已复制到剪贴板');
    if (result.clipboard === 'failed') {
      parts.push(
        `复制到剪贴板失败${result.clipboardError ? `（${truncate(result.clipboardError, 120)}）` : ''}`,
      );
    }
    if (result.download === 'ok') parts.push('已下载 PNG');
    if (result.download === 'failed') {
      parts.push(
        `下载 PNG 失败${result.downloadError ? `（${truncate(result.downloadError, 120)}）` : ''}`,
      );
    }
    if (result.partial) parts.push('仅截取了当前可见部分');
    if (result.modeUsed === 'stitched') parts.push('使用滚动拼接');
    if (result.modeUsed === 'cdp') parts.push('使用 CDP 完整截图');
    if (result.modeUsed === 'viewport') parts.push('使用当前可视区域');
    const warnings = result.warnings?.length ? `；${result.warnings.join('；')}` : '';

    if (result.ok) {
      this.showToast(parts.join('，') + warnings, result.partial || warnings ? 'warning' : 'success');
      return;
    }
    const message = result.error?.message ?? '截图失败';
    this.showToast(`${message}${parts.length ? `（${parts.join('，')}）` : ''}`, 'error');
  }

  applyRemoteStatus(stage: CaptureStage, message?: string): void {
    if (!this.state.busy) return;
    this.set({
      stage,
      statusText: message ?? STAGE_LABELS[stage] ?? null,
    });
  }

  // -------------------------------------------------------- geometry helpers

  getSettings(): CaptureSettings {
    return this.settings;
  }

  getSelectedArticle(): HTMLElement | null {
    return this.resolveArticle();
  }

  getCaptureGeometry(): { article: HTMLElement } | null {
    const article = this.resolveArticle();
    return article ? { article } : null;
  }

  setGeometrySnapshot(snapshot: ScrollSnapshot): void {
    this.geometrySnapshot = snapshot;
  }

  restoreGeometrySnapshot(): void {
    if (this.geometrySnapshot) {
      restoreScrollSnapshot(this.geometrySnapshot);
      this.geometrySnapshot = null;
    }
  }

  private restoreTransientState(): void {
    if (this.savedSnapshot) {
      restoreScrollSnapshot(this.savedSnapshot);
      this.savedSnapshot = null;
    }
    this.restoreGeometrySnapshot();
    this.clearMasks();
  }

  // ------------------------------------------------------------------ toast

  showToast(text: string, kind: ToastKind, duration = 6000): void {
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.set({ resultText: text, resultKind: kind });
    this.toastTimer = window.setTimeout(() => {
      this.toastTimer = null;
      this.set({ resultText: null, resultKind: null });
    }, duration);
  }

  setUiHidden(hidden: boolean): void {
    this.tweetButtons.setHidden(hidden);
  }

  // ------------------------------------------------------------------ store

  private set(partial: Partial<SessionState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) listener();
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
