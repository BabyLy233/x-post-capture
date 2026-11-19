import { useSyncExternalStore } from 'react';

import type { SessionController, SessionState } from '@/modules/session/session-controller';
import type { HideMode } from '@/types/settings';

import styles from './SessionApp.css?inline';

export function SessionApp({ controller }: { controller: SessionController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  if (!state.active) return null;
  return (
    <div className="xpc-root">
      <style>{styles}</style>
      {state.toolbarVisible && <Toolbar controller={controller} state={state} />}
      {state.highlight && (
        <div
          className="xpc-highlight"
          style={{
            left: state.highlight.left,
            top: state.highlight.top,
            width: state.highlight.width,
            height: state.highlight.height,
          }}
        />
      )}
      {state.maskPanelOpen && <MaskPanel controller={controller} state={state} />}
      {state.resultText && (
        <div className={`xpc-toast xpc-toast-${state.resultKind ?? 'success'}`}>
          {state.resultText}
        </div>
      )}
    </div>
  );
}

function Toolbar({
  controller,
  state,
}: {
  controller: SessionController;
  state: SessionState;
}) {
  const hasOutput = state.settings.copyToClipboard || state.settings.downloadToLocal;
  const canCapture = Boolean(state.selectedKey) && !state.busy && hasOutput;

  return (
    <div className="xpc-toolbar" role="toolbar" aria-label="X Post Capture 工具栏">
      <span className="xpc-brand">
        <span className="xpc-brand-dot" />
        X Post Capture
      </span>
      {state.selectedLabel ? (
        <span className="xpc-selection" title={state.selectedLabel}>
          <span className="xpc-selection-label">{state.selectedLabel}</span>
        </span>
      ) : (
        <span className="xpc-hint">将鼠标移到推文上，点击相机按钮选择</span>
      )}
      {state.busy ? (
        <span className="xpc-status">
          <span className="xpc-spinner" />
          {state.statusText ?? '处理中…'}
        </span>
      ) : state.pickerActive ? (
        <span className="xpc-picker-hint">点击推文内部元素以屏蔽，按 Esc 退出</span>
      ) : null}
      <div className="xpc-actions">
        <button
          type="button"
          className="xpc-btn"
          disabled={!state.selectedKey || state.busy}
          onClick={() => controller.togglePicker()}
        >
          {state.pickerActive ? '结束屏蔽' : '屏蔽元素'}
        </button>
        <button
          type="button"
          className="xpc-btn"
          disabled={!state.selectedKey || state.busy}
          onClick={() => controller.toggleMaskPanel()}
        >
          已屏蔽 {state.masks.length}
        </button>
        {state.busy ? (
          <button
            type="button"
            className="xpc-btn xpc-btn-danger"
            onClick={() => void controller.cancelCapture()}
          >
            取消
          </button>
        ) : (
          <button
            type="button"
            className="xpc-btn xpc-btn-primary"
            disabled={!canCapture}
            title={hasOutput ? undefined : '请至少启用一种输出方式'}
            onClick={() => void controller.startCapture()}
          >
            截图
          </button>
        )}
        <button
          type="button"
          className="xpc-btn xpc-btn-ghost"
          onClick={() => controller.closeToolbar()}
        >
          关闭
        </button>
      </div>
    </div>
  );
}

function MaskPanel({
  controller,
  state,
}: {
  controller: SessionController;
  state: SessionState;
}) {
  return (
    <div className="xpc-panel">
      <div className="xpc-panel-title">
        <span>已屏蔽的元素</span>
        <button type="button" className="xpc-mini-btn" onClick={() => controller.toggleMaskPanel()}>
          收起
        </button>
      </div>
      {state.masks.length === 0 ? (
        <div className="xpc-panel-empty">
          还没有屏蔽任何元素。点击「屏蔽元素」，然后点击推文中的节点。
        </div>
      ) : (
        state.masks.map((mask) => (
          <div className="xpc-mask-row" key={mask.id}>
            <span className="xpc-mask-label" title={mask.label}>
              {mask.label}
            </span>
            <span className="xpc-mask-source">{mask.source === 'rule' ? '规则' : '本次'}</span>
            <div className="xpc-mask-actions">
              <button
                type="button"
                className="xpc-mini-btn"
                disabled={mask.saved}
                onClick={() => void controller.saveMaskAsRule(mask.id)}
              >
                {mask.saved ? '已保存' : '保存规则'}
              </button>
              <button
                type="button"
                className="xpc-mini-btn"
                onClick={() => controller.restoreMaskItem(mask.id)}
              >
                恢复
              </button>
            </div>
          </div>
        ))
      )}
      <div className="xpc-panel-footer">
        <label className="xpc-hide-mode">
          <span className="xpc-hide-mode-label">屏蔽方式</span>
          <select
            className="xpc-select"
            value={state.hideMode}
            onChange={(event) => controller.setHideMode(event.target.value as HideMode)}
          >
            <option value="remove-space">隐藏并移除占位</option>
            <option value="keep-space">隐藏但保留占位</option>
          </select>
        </label>
        <button
          type="button"
          className="xpc-mini-btn"
          disabled={state.masks.length === 0}
          onClick={() => controller.restoreAllMaskItems()}
        >
          全部恢复
        </button>
      </div>
    </div>
  );
}