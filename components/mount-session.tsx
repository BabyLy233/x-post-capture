import { createRoot } from 'react-dom/client'

import { OWN_ATTRIBUTE } from '@/modules/tweet/tweet-detector'
import type { SessionController } from '@/modules/session/session-controller'

import { SessionApp } from './SessionApp'

export function mountSessionUi(controller: SessionController): HTMLElement {
  const host = document.createElement('div')
  host.id = 'xpc-host'
  host.setAttribute(OWN_ATTRIBUTE, 'true')
  host.style.cssText =
    'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;'
  const shadow = host.attachShadow({ mode: 'open' })
  const mount = document.createElement('div')
  mount.setAttribute(OWN_ATTRIBUTE, 'true')
  shadow.appendChild(mount)
  document.documentElement.appendChild(host)
  createRoot(mount).render(<SessionApp controller={controller} />)
  return host
}
