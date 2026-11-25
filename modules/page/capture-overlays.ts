const HIDE_OVERLAY_STYLE_ID = 'xpc-capture-hide-overlays'

/**
 * X 顶部悬浮的新帖提示（ShowAlert，带作者头像与「已发布」标签）不属于推文子树，
 * 但它固定悬浮在时间线顶部，截图时会被叠进推文区域，因此在截图期间整体隐藏。
 *
 * 通过注入样式表而不是逐个修改内联样式：
 * 1. 浮层会被 X 重新渲染（React 重建节点），样式表对新节点同样生效；
 * 2. 使用 visibility 而不是 display，隐藏后不触发重排，已测量的截图坐标仍然有效。
 * 选择器只匹配带新帖标记的 role="status" 容器，不会影响推文正文。
 */
const HIDE_OVERLAY_CSS = `
[role="status"]:has([data-testid="pillLabel"]),
[role="status"]:has([aria-label*="新的帖子"]),
[role="status"]:has([aria-label*="new posts" i]) {
  visibility: hidden !important;
}
`

export function suppressPageOverlays(): void {
  if (document.getElementById(HIDE_OVERLAY_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = HIDE_OVERLAY_STYLE_ID
  style.textContent = HIDE_OVERLAY_CSS
  const parent = document.head ?? document.documentElement
  parent.append(style)
}

export function restorePageOverlays(): void {
  document.getElementById(HIDE_OVERLAY_STYLE_ID)?.remove()
}
