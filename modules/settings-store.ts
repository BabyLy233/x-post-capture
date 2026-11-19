import { browser } from 'wxt/browser'

import { DEFAULT_SETTINGS, type CaptureSettings, type DomFilterRule } from '@/types/settings'

const SETTINGS_KEY = 'captureSettings'
const RULES_KEY = 'domFilterRules'

function isCaptureMode(value: unknown): value is CaptureSettings['captureMode'] {
  return value === 'auto' || value === 'cdp' || value === 'stitched' || value === 'viewport'
}

export function normalizeSettings(raw: unknown): CaptureSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
  const value = raw as Record<string, unknown>
  return {
    version: 1,
    captureMode: isCaptureMode(value.captureMode)
      ? value.captureMode
      : DEFAULT_SETTINGS.captureMode,
    copyToClipboard:
      typeof value.copyToClipboard === 'boolean'
        ? value.copyToClipboard
        : DEFAULT_SETTINGS.copyToClipboard,
    downloadToLocal:
      typeof value.downloadToLocal === 'boolean'
        ? value.downloadToLocal
        : DEFAULT_SETTINGS.downloadToLocal,
    openToolbarOnClick:
      typeof value.openToolbarOnClick === 'boolean'
        ? value.openToolbarOnClick
        : DEFAULT_SETTINGS.openToolbarOnClick,
  }
}

export async function loadSettings(): Promise<CaptureSettings> {
  try {
    const stored = await browser.storage.local.get(SETTINGS_KEY)
    return normalizeSettings(stored[SETTINGS_KEY])
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export async function saveSettings(settings: CaptureSettings): Promise<void> {
  await browser.storage.local.set({ [SETTINGS_KEY]: settings })
}

export function normalizeRule(raw: unknown): DomFilterRule | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  if (typeof value.selector !== 'string' || !value.selector.trim()) return null
  return {
    id: typeof value.id === 'string' ? value.id : createId(),
    name: typeof value.name === 'string' && value.name.trim() ? value.name : value.selector,
    selector: value.selector,
    enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
    hideMode: value.hideMode === 'keep-space' ? 'keep-space' : 'remove-space',
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : Date.now(),
  }
}

export async function loadRules(): Promise<DomFilterRule[]> {
  try {
    const stored = await browser.storage.local.get(RULES_KEY)
    const raw = stored[RULES_KEY]
    if (!Array.isArray(raw)) return []
    return raw.map(normalizeRule).filter((rule): rule is DomFilterRule => rule !== null)
  } catch {
    return []
  }
}

export async function saveRules(rules: DomFilterRule[]): Promise<void> {
  await browser.storage.local.set({ [RULES_KEY]: rules })
}

export function createId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `r-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
