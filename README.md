# Prompt Vault - AI 提示词金库 🌌

Prompt Vault 是一个以侧边栏 (Side Panel) 形式常驻的 Chrome 扩展程序，专为高频使用 AI (如 ChatGPT, Claude, Gemini 等) 的用户设计。它允许用户高效存储、分类管理和一键复制提示词，并支持无损保存无限尺寸的截图。

---

## 🎨 核心特性 (Features)

1. **原生侧边栏架构**：基于 Chrome 最新的 Manifest V3 `sidePanel` API 开发，无需切换标签页，始终在浏览器侧边陪伴。
2. **多模态内容储存**：
   * 支持长文本 Prompt 的高效存取和分类。
   * **突破性图片存储**：使用本地 IndexedDB 存储 Base64 图片，突破了传统扩展 `chrome.storage` 单个项目 8MB 的配额限制，支持拖拽无损存取**任意尺寸的大面积截图**。
3. **极光丝滑 UI**：
   * 无任何第三方 UI 框架负担，采用纯手写 CSS。
   * 实现玻璃拟态 (Glassmorphism)、暗黑模式为主轴的极客美学，内置平滑的弹性物理动画。
   * 支持“搜索词实时高亮”，“一键复制”带徽章反馈。
4. **全自动 GitHub 云同步 (Geek Sync)**：
   * 基于纯净的 **GitHub REST API** 开发的去中心化同步功能。
   * 用户提供 Classic Token 后，扩展会**自动在云端创建**私有数据库 (`prompt-vault-data`)。
   * 实现文本结构的 JSON 化，并将图库单独拆分成二进制碎片存储至云端。实现了设备间的无缝跨端数据继承。

---

## 🛠 技术栈 (Tech Stack)

*   **框架选型**：Vanilla JavaScript (原生 ES6+ Modules)，无框架，极致轻量，秒开无延迟。
*   **浏览器标准**：Google Chrome Extension Manifest V3。
*   **本地存储**：`chrome.storage.local` (存储结构文本与配置) + `IndexedDB` (基于原生 API 封装，存放大体积图片 Blob/Base64)。
*   **云端存储**：GitHub REST API (通讯层使用 Fetch，授权鉴权基于 Personal Access Token)。

---

## 📁 核心文件结构

```text
prompt-vault/
├── manifest.json       # 扩展注册清单，声明权限与侧边栏常驻行为
├── background.js       # Service Worker，负责监听点击插件图标并唤醒侧边栏
├── sidepanel.html      # 侧边栏所有 UI 的骨架结构，包含全部模态框（DOM）
├── sidepanel.css       # 样式与物理动画，统一定义了所有的 CSS 变量和主题 
├── sidepanel.js        # 应用层主逻辑：分发事件，状态管理，DOM 渲染，模态框控制
├── db.js               # 数据库代理层：封装 IndexedDB 初始化与图片增删改查逻辑
├── github_sync.js      # 云同步驱动层：处理 GitHub Auth、仓库空转检测与读写操作
└── icons/              # AI 生成的专属 3D 拟态紫色金库图标 (16/32/48/128 px)
```

---

## 💡 架构亮点随笔 (复盘重点)

### 1. 为什么不用 React / Vue？
作为一个工具型侧边栏，核心追求是**热启动性能**与**极致的宿主侵入度（体积小）**。当前 Vanilla JS 采用 `state` 驱动的单向渲染模式 (`renderPromptList()`) 已经足够应对百条级别的 Prompt 列表重绘，不会在浏览器开销上留下任何包袱。

### 2. IndexedDB + LocalStorage 大小切分架构
初版开发时易陷入 `chrome.storage.local` 或 `sync` 装载图片的陷阱。单图大小极易触碰 `QuotaExceededError`。本作的解法是：**结构与二进制分离**。文本元数据通过 chrome API 秒级存取；遇到图片则生成 UUID 占位符，由 `db.js` 处理异步持久化拉取。此方案可保证列表滚动与渲染丝般顺滑。

### 3. GitHub API 建库细节 (`auto_init`)
通过 `/user/repos` POST 请求隐蔽建库时，如果是纯空库（没有任何 commit），后续通过 PUT 更新内容会因缺少分支（branch）而报 `409 Conflict` 错误。我们通过传入 `"auto_init": true` 参数规避了这一风险，确保了小白用户一键完成“无中生有”的云同步设置。

---

## 🚀 开发者选项 & 安装指南

### 安装到本地
1. 克隆或下载本仓库代码到本地文件夹。
2. 打开 Chrome，地址栏输入 `chrome://extensions/`。
3. 开启右上角的 **“开发者模式”**。
4. 点击左上角的 **“加载已解压的扩展程序”**，选择本仓库所在文件夹即可。

### 配置同步
1. 前往 GitHub -> Settings -> Developer Settings -> Personal access tokens (classic)。
2. 生成一个带有 `repo` 权限的 Token。
3. 回到 Prompt Vault 侧边栏，点击 ⚙️ 获取同步菜单，粘贴 Token，点击“保存”即可开启你跨设备漫游的 Prompt 之旅。
