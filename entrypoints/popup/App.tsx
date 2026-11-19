import { useEffect, useMemo, useState } from 'react'
import { browser } from 'wxt/browser'

import {
  CAPTURE_MODES,
  type CaptureMode,
  type CaptureSettings,
  type DomFilterRule,
} from '@/types/settings'
import { isXPage } from '@/modules/tweet/tweet-detector'
import { loadRules, loadSettings, saveRules, saveSettings } from '@/modules/settings-store'

import './App.css'

export default function App() {
  const [settings, setSettings] = useState<CaptureSettings | null>(null)
  const [rules, setRules] = useState<DomFilterRule[]>([])
  const [url, setUrl] = useState<string | null>(null)
  const [allSitesGranted, setAllSitesGranted] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [storedSettings, storedRules, tabs, granted] = await Promise.all([
        loadSettings(),
        loadRules(),
        browser.tabs.query({ active: true, currentWindow: true }),
        browser.permissions.contains({ origins: ['<all_urls>'] }),
      ])
      if (cancelled) return
      setSettings(storedSettings)
      setRules(storedRules)
      setUrl(tabs[0]?.url ?? null)
      setAllSitesGranted(granted)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const supported = useMemo(() => (url ? isXPage(url) : false), [url])
  const hasOutput = Boolean(settings && (settings.copyToClipboard || settings.downloadToLocal))

  function updateSettings(patch: Partial<CaptureSettings>) {
    if (!settings) return
    const next: CaptureSettings = { ...settings, ...patch, version: 1 }
    setSettings(next)
    void saveSettings(next).catch(() => {
      setNotice('设置保存失败，请重试')
    })
  }

  async function handleToggleDownload(checked: boolean) {
    if (!settings) return
    // 先保存设置：权限确认可能导致 popup 失去焦点而关闭
    updateSettings({ downloadToLocal: checked })
    if (!checked) return
    let granted = false
    try {
      granted = await browser.permissions.request({
        permissions: ['downloads'] as unknown as Parameters<
          typeof browser.permissions.request
        >[0]['permissions'],
      })
    } catch {
      granted = false
    }
    if (!granted) {
      updateSettings({ downloadToLocal: false })
      setNotice('未获得「管理下载」权限，暂时无法开启下载到本地。')
    }
  }

  async function handleToggleAllSites(checked: boolean) {
    if (checked) {
      let granted = false
      try {
        granted = await browser.permissions.request({
          origins: ['<all_urls>'],
        })
      } catch {
        granted = false
      }
      setAllSitesGranted(granted)
      if (!granted) {
        setNotice('未授予所有站点访问权限，无感截图未启用。')
      }
      return
    }
    try {
      await browser.permissions.remove({ origins: ['<all_urls>'] })
    } catch {
      // 权限可能已被浏览器回收
    }
    setAllSitesGranted(false)
  }

  async function updateRules(next: DomFilterRule[]) {
    setRules(next)
    try {
      await saveRules(next)
    } catch {
      setNotice('过滤规则保存失败')
    }
  }

  if (!settings) {
    return (
      <div className="popup popup-loading">
        <div className="spinner" />
        正在加载…
      </div>
    )
  }

  return (
    <div className="popup">
      <header className="header">
        <div className="logo">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M4 7.5h2.6l1.2-2h8.4l1.2 2H20a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinejoin="round"
            />
            <circle cx="12" cy="12.5" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.7" />
          </svg>
        </div>
        <div>
          <h1>X Post Capture</h1>
          <p className="subtitle">点击推文上的相机按钮即可截图</p>
        </div>
      </header>

      <div className={`page-status ${supported ? 'supported' : 'unsupported'}`}>
        {url === null ? (
          <span>打开 x.com 或 twitter.com 后可直接截图</span>
        ) : supported ? (
          <>
            <span className="status-dot" />
            <span>已就绪：{new URL(url).hostname}</span>
          </>
        ) : (
          <span>打开 x.com 或 twitter.com 后可直接截图</span>
        )}
      </div>

      <div className="quick-tip">
        <strong>快速截图</strong>
        <p>
          在 X 页面上把鼠标移到推文，点击右侧相机按钮立即截图； 按住 <kbd>Alt</kbd>（macOS 为{' '}
          <kbd>Option</kbd>）点击可打开工具栏， 在截图前屏蔽推文中的元素。
        </p>
      </div>

      <section className="section">
        <label className="section-label" htmlFor="capture-mode">
          截图方式
        </label>
        <select
          id="capture-mode"
          className="field-select"
          value={settings.captureMode}
          onChange={(event) => updateSettings({ captureMode: event.target.value as CaptureMode })}
        >
          {CAPTURE_MODES.map((mode) => (
            <option key={mode.value} value={mode.value}>
              {mode.label}
            </option>
          ))}
        </select>
        <p className="mode-description">
          {CAPTURE_MODES.find((mode) => mode.value === settings.captureMode)?.description}
        </p>
        {settings.captureMode !== 'stitched' && settings.captureMode !== 'viewport' && (
          <p className="permission-note">
            完整截图使用已声明的 <code>debugger</code> 权限，仅对当前标签页调用 Chrome
            截图接口，不会上传任何页面数据。
          </p>
        )}
      </section>

      <section className="section">
        <span className="section-label">输出</span>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.copyToClipboard}
            onChange={(event) => updateSettings({ copyToClipboard: event.target.checked })}
          />
          <span>
            复制到剪贴板
            <small>截图后可直接粘贴到聊天软件</small>
          </span>
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.downloadToLocal}
            onChange={(event) => void handleToggleDownload(event.target.checked)}
          />
          <span>
            下载到本地
            <small>保存 PNG 到浏览器默认下载目录</small>
          </span>
        </label>
        {!hasOutput && <p className="warning">至少需要启用一种输出方式，否则截图按钮将被禁用。</p>}
      </section>

      <section className="section">
        <span className="section-label">快捷操作</span>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.openToolbarOnClick}
            onChange={(event) => updateSettings({ openToolbarOnClick: event.target.checked })}
          />
          <span>
            点击按钮时打开工具栏
            <small>
              便于先屏蔽推文中的元素再截图；关闭时点击按钮直接截图，按住 Alt 点击仍可打开工具栏。
            </small>
          </span>
        </label>
      </section>

      <section className="section">
        <span className="section-label">截图权限</span>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={allSitesGranted}
            onChange={(event) => void handleToggleAllSites(event.target.checked)}
          />
          <span>
            无感截图
            <small>
              导航后无需点击扩展图标，也不会出现调试提示条。需要授予所有站点访问权限， 扩展实际只在
              X 页面运行。
            </small>
          </span>
        </label>
        {allSitesGranted && (
          <p className="mode-description">
            已启用：截图使用浏览器原生接口，速度更快且不会触发调试提示。
          </p>
        )}
      </section>

      <section className="section">
        <div className="section-heading">
          <span className="section-label">已保存的过滤规则</span>
          <span className="count-pill">{rules.length}</span>
        </div>
        {rules.length === 0 ? (
          <p className="empty-rules">在推文工具栏中屏蔽元素并点击「保存规则」后，会出现在这里。</p>
        ) : (
          <ul className="rules">
            {rules.map((rule) => (
              <li key={rule.id} className="rule">
                <label className="rule-toggle">
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={() =>
                      void updateRules(
                        rules.map((item) =>
                          item.id === rule.id ? { ...item, enabled: !item.enabled } : item,
                        ),
                      )
                    }
                  />
                  <span className="rule-name">{rule.name}</span>
                </label>
                <code className="rule-selector" title={rule.selector}>
                  {rule.selector}
                </code>
                <button
                  type="button"
                  className="rule-delete"
                  title="删除规则"
                  onClick={() => void updateRules(rules.filter((item) => item.id !== rule.id))}
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {notice && <div className="notice">{notice}</div>}

      <footer className="footer">设置会立即生效 · 所有截图均在本地处理</footer>
    </div>
  )
}
