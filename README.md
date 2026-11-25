# X Post Capture

一个基于 [WXT](https://wxt.dev) + React + TypeScript 的 Chrome / Edge 扩展（Manifest V3），
用于把 X（`x.com` / `twitter.com`）中的推文按浏览器当前真实渲染结果截取为 PNG。

开发方案见 [`x-post-capture-development-plan.md`](./x-post-capture-development-plan.md)。

## 功能

- **页面内直接截图**：打开 X 页面后，鼠标悬停在推文上即可点击相机按钮截图，
  无需先打开扩展弹出层。按住 Alt（macOS Option）点击可打开工具栏，先屏蔽元素再截图。
- **完整推文截图**：支持超出浏览器视口的长推文。
- **保留真实渲染结果**：直接使用 Chromium 的页面渲染，不重新解析 CSS 重绘页面，
  因此翻译扩展插入推文 DOM 中的文字会随截图保留。
- **四种截图方式**：
  - 自动（优先 CDP，失败回退滚动拼接）
  - CDP 完整截图（`chrome.debugger` + `Page.captureScreenshot`）
  - 滚动拼接（`tabs.captureVisibleTab` + Canvas 拼接）
  - 当前可视区域（只截当前屏幕可见部分）
- **DOM 节点屏蔽**：在页面中进入元素选择模式，点击推文内节点即可临时隐藏
  （支持「隐藏并移除占位」/「隐藏但保留占位」两种策略），可恢复，也可保存为过滤规则。
- **输出配置**：复制到系统剪贴板、下载 PNG 到本地，两者可独立开关。
- **集中权限**：content script 仅在 `x.com` / `twitter.com` 上运行；不读取其他网站，
  不上传任何页面内容。`downloads` 为可选权限，仅在开启下载时申请。

## 开发

```bash
pnpm install
pnpm dev            # 启动开发服务器（加载 .output/chrome-mv3-dev）
pnpm build          # 生产构建，输出到 .output/chrome-mv3
pnpm compile        # TypeScript 类型检查
pnpm lint           # oxlint 检查
pnpm format         # oxfmt 格式化
pnpm crx            # 构建并打包 .output/chrome-mv3.crx
```

安装到浏览器：

1. 打开 `chrome://extensions`（Edge 为 `edge://extensions`）。
2. 开启「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择 `.output/chrome-mv3` 目录。

## 打包 CRX

```bash
pnpm crx
```

会先执行生产构建，然后调用本机 Chrome 打包为 `.output/chrome-mv3.crx`：

- 首次运行会生成签名私钥 `.output/chrome-mv3.pem`，扩展 ID 由该私钥决定；
- 之后运行会复用同一私钥，扩展 ID 保持不变；
- 私钥不要提交或分享，丢失后重新打包会变成新的扩展 ID；
- 可通过环境变量 `CHROME_BIN=/path/to/chrome` 指定浏览器。

安装：打开 `chrome://extensions`，开启开发者模式，把 `.crx` 拖入页面；若被拦截，
也可以直接「加载已解压的扩展程序」选择 `.output/chrome-mv3`。

## 使用

1. 打开一条推文所在页面（时间线、搜索、个人主页或推文详情页）。
   扩展会在页面加载后自动就绪。
2. 把鼠标移到推文上，点击右侧出现的相机按钮，立即按当前设置截图。
3. 需要屏蔽推文中的元素时，按住 `Alt`（macOS 为 `Option`）点击相机按钮，
   在工具栏中选择「屏蔽元素」，再点击推文中不需要的节点（按 `Esc` 退出选择模式）。
   在「已屏蔽」面板中可以恢复单个节点、全部恢复，或把屏蔽保存为可复用的规则，
   然后点击「截图」。
4. 截图方式与输出方式（复制 / 下载）在扩展弹出层中修改，设置立即生效。

截图结束后会按照输出配置复制到剪贴板 / 下载 PNG，并恢复被屏蔽的 DOM 与滚动位置。

## 目录结构

```text
entrypoints/
  background.ts        # Service Worker：权限、CDP、滚动拼接、输出调度
  content.ts           # Content Script：会话、几何测量、消息处理
  popup/               # 扩展弹出层（React）
  offscreen/           # Offscreen Document：Canvas 拼接/裁剪、剪贴板
components/
  SessionApp.tsx       # 页面内工具栏、悬浮按钮、元素选择高亮
  mount-session.tsx    # Shadow DOM 挂载
modules/
  tweet/               # 推文识别与元数据（选择器适配层）
  filter/              # DOM 屏蔽与元素选择
  capture/             # 截图几何与拼接计划
  page/                # DOM 稳定性、滚动、固定元素抑制
  output/              # 文件名
  session/             # 页面会话控制器
  settings-store.ts    # 设置与规则持久化
types/                 # 共享类型与消息协议
```

## 已知限制

- 首期仅面向 Chrome / Edge（Manifest V3），不保证 Firefox 的 CDP 截图能力。
- 滚动拼接受 `captureVisibleTab()` 频率限制，长推文截图需要数秒；拼接期间页面滚动
  可能触发 X 的懒加载或虚拟列表更新，极端情况下可能产生错位。
- 推文位于高度受限的内部滚动容器且高度大于容器时，CDP 无法一次截取被裁剪的部分。
- 截图期间会临时隐藏扩展自身的 UI，以及 X 顶部的「有新帖子」提示等悬浮浮层；
  CDP 模式会附加调试器，浏览器可能短暂显示调试提示条
  并改变页面视口；截图前会等待页面重新布局、字体与图片加载完成，再重新测量并截图。
- 翻译内容只有位于推文 DOM 子树内才会进入截图；独立浮层或 iframe 中的翻译不保证包含。

## 权限说明

- **运行站点**：content script 仅在 `x.com` / `twitter.com` 上运行（安装时会显示对应的站点访问提示），
  不在其他网站运行。
- `storage`：保存截图配置与过滤规则。
- `activeTab`：在点击扩展图标后，允许 `captureVisibleTab` 作为 CDP 不可用时的回退；
  页面内快捷键截图默认使用 CDP，不依赖 activeTab。
- `debugger`：CDP 截图需要向后端调试协议发送截图命令。Chrome 不允许把
  `debugger` 声明为可选权限，因此它在安装时声明；扩展只在截图时附加当前标签页，
  并在截图结束后立即 `detach`。
- `clipboardWrite`：把 PNG 写入系统剪贴板（无权限警告）。
- `offscreen`：在 Offscreen Document 中做 Canvas 拼接与剪贴板兼容处理。
- `downloads`：可选权限，仅在「下载到本地」开启时申请。

扩展不读取浏览历史，不上传推文内容或截图。

## 隐私

所有截图与图片处理都在本地浏览器内完成，不上传推文内容、页面 HTML 或图片。
扩展不读取登录 Cookie / 认证令牌，也不会触发发布、点赞、转发等操作。