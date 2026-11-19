export type CaptureMode = 'auto' | 'cdp' | 'stitched' | 'viewport';

export type HideMode = 'remove-space' | 'keep-space';

export interface CaptureSettings {
  version: 1;
  captureMode: CaptureMode;
  copyToClipboard: boolean;
  downloadToLocal: boolean;
  /** 点击推文按钮时直接打开工具栏（用于屏蔽元素），而不是立即截图 */
  openToolbarOnClick: boolean;
}

export interface DomFilterRule {
  id: string;
  name: string;
  selector: string;
  enabled: boolean;
  hideMode: HideMode;
  createdAt: number;
}

export const DEFAULT_SETTINGS: CaptureSettings = {
  version: 1,
  captureMode: 'auto',
  copyToClipboard: true,
  downloadToLocal: false,
  openToolbarOnClick: false,
};

export const CAPTURE_MODES: Array<{
  value: CaptureMode;
  label: string;
  description: string;
}> = [
  {
    value: 'auto',
    label: '自动（推荐）',
    description: '优先使用 CDP 完整截图，不可用时回退滚动拼接。',
  },
  {
    value: 'cdp',
    label: 'CDP 完整截图',
    description: '通过 Chrome Debugger API 一次截取完整推文，速度快、画面连续。',
  },
  {
    value: 'stitched',
    label: '滚动拼接',
    description: '分段滚动截图后拼接，适合拒绝 debugger 权限的情况。',
  },
  {
    value: 'viewport',
    label: '当前可视区域',
    description: '只截取屏幕上当前可见的部分，不滚动页面。',
  },
];