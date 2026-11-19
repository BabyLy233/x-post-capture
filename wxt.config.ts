import { defineConfig } from 'wxt';

// See https://wxt.dev/api/reference/wxt/interfaces/inlineconfig.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // 项目内的 modules/ 存放业务代码，避免被 WXT 当作扩展模块加载
  modulesDir: 'wxt-modules',
  manifest: {
    name: 'X Post Capture',
    description:
      '按浏览器真实渲染结果截取 X（Twitter）推文，支持复制 PNG 到剪贴板与下载到本地。',
    version: '0.1.0',
    // debugger 不能声明为可选权限（见 Chrome permissions API 文档），
    // 因此将其作为安装时权限；content script 需要 X 域名的 host 权限。
    permissions: [
      'storage',
      'activeTab',
      'offscreen',
      'clipboardWrite',
      'debugger',
    ],
    // 与 content script 的 matches 保持一致，便于后台读取当前标签页 URL
    host_permissions: ['*://*.x.com/*', '*://*.twitter.com/*'],
    optional_permissions: ['downloads'],
    // 由用户在弹出层主动授权，启用后 captureVisibleTab 不再依赖 activeTab
    optional_host_permissions: ['<all_urls>'],
    minimum_chrome_version: '116',
  },
});