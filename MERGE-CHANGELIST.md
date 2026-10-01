# 上游 2.2.7 → 2.2.9 逐文件变更清单与归类

三方合并的坐标：

| 角色 | 引用 | commit |
|---|---|---|
| base（共同祖先） | 上游 tag `v2.2.7` | `3b3b0ef` |
| ours（中文增强版） | 合并前 HEAD | `38b8faf` |
| theirs（上游最新） | 上游 tag `v2.2.9` | `9fb0b7c` |
| 合并结果 | `main` | `0d4ca4d` |

清单口径：`git diff --name-status v2.2.7 v2.2.9` 共 **49** 行，本清单逐行覆盖，无遗漏、无「待定」。

---

## 一、上游独占改动（33 个）— 处理方式：直接采纳

上游单独改、中文版没碰过的文件，合并时整份取上游。

**组件与打包（9）**

| 文件 | 说明 |
|---|---|
| `src/core/feeder-release.js` | DLSS5-Feeder 0.15.1 → 1.17.0（版本、下载地址、SHA-256、体积、逐文件哈希） |
| `src/core/renodx-release.js` | 新增，RenoDX DLSS5 6.5.3 的发布信息与摘要 |
| `src/core/runtime-components.js` | dgVoodoo2 2.87.4 → 2.87.5（2.87.4 被杀软误报） |
| `src/core/optiscaler.js` | 追加 pre-SR 多通道分支 0.8.92（`RELEASES` 的 URL / SHA-256 / 许可证） |
| `scripts/collect-payload.js` | `RENODX_ADDONS` 按 SHA-256 更新；RenoDX DLSS Tool 换 2026-09-28 构建 |
| `scripts/test-optiscaler-payload.js` | 对应 0.8.92 的 payload 校验 |
| `overlay/feeder-controls.hpp` | Feeder 1.17.0 的 cfg 字段表与硬编码摘要/体积 |
| `overlay/overlay.cpp` | 叠加层随组件升级的调整 |
| `overlay/renodx-ui-bridge.hpp`、`overlay/renodx-ui-probe.hpp` | RenoDX UI 桥接与探针 |

**核心逻辑（4）**

| 文件 | 说明 |
|---|---|
| `src/core/apply.js` | 安装/还原流程适配（含 2.2.9 的备份记录恢复修复） |
| `src/core/backend-manager.js` | ReShade 代理文件变更检测 |
| `src/core/install-guards.js` | 安装守卫 |
| `src/shared/install-routes.js` | 安装路线表 |

**界面（2）**

| 文件 | 说明 |
|---|---|
| `src/renderer/theme2.css` | 新增，第二套主题（4198 行） |
| `src/renderer/theme2.js` | 新增，第二套主题的交互（命令栏、游戏整页、调色板） |

**资源（4）**

| 文件 | 说明 |
|---|---|
| `app_iocn.png`、`src/renderer/icon.png` | 图标更新 |
| `docs/screenshots/19-feature-theme2-game.png`、`20-feature-theme2-library.png`、`21-feature-theme2-settings.png` | 主题 2 截图 |

**文档（3）**

| 文件 | 说明 |
|---|---|
| `THIRD_PARTY_NOTICES.md` | 组件升级后的第三方声明 |
| `docs/releases/v2.2.7.md`、`docs/releases/v2.2.8.md` | 上游发布说明 |

**脚本与测试（10）**

| 文件 | 说明 |
|---|---|
| `scripts/shoot-theme2.js` | 新增，主题 2 截图脚本 |
| `test/release-228.test.js` | 新增，2.2.8 承诺逐条钉位（415 行） |
| `test/restore-recovery.test.js` | 新增，备份记录恢复 |
| `test/optiscaler-build-choice.test.js` | 第二个 OptiScaler 选项 |
| `test/optiscaler.test.js`、`test/multipass.test.js`、`test/consumer-conflict.test.js`、`test/install-routes.test.js`、`test/rendering-api.test.js` | 随组件与路线调整同步 |

---

## 二、双方都改（16 个）— 处理方式：逐文件合并，中文版自加功能优先保留

| 文件 | 是否冲突 | 解决方式 |
|---|---|---|
| `README.md` | **冲突** | 按既定决定只保留中文版，仅并入版本号（2.2.7 → 2.2.9、1.0.2 → 2.0.3） |
| `package.json` | **冲突** | 版本号 `1.0.2` / `2.2.9` → **`2.0.3`**；依赖取上游 |
| `package-lock.json` | **冲突** | 取上游 lockfile 结构，版本号两处统一为 `2.0.3` |
| `main.js` | **冲突** | 保留中文版 `autoUpdateCheck` / `skippedUpdates` / 教程 / 缓存清理；并入上游 `safeGraphics` / `skin` |
| `src/renderer/renderer.js` | **冲突** | 保留中文版 crashBanner 逻辑；并入上游 `RESHADE_PROXY_APIS`、`SPOKEN_JOB_CODES` |
| `src/renderer/index.html` | **冲突** | 同时保留 `tutorial.css`（中文版）与 `theme2.css`（上游），脚本同理 |
| `src/renderer/style.css` | **冲突** | 保留中文版更新对话框样式 + 上游社区标签样式 |
| `src/renderer/overlay-live.js` | **冲突** | 保留中文版 `OL_T` 三语翻译结构；`RenoDX v4.7` 改为通用 `RenoDX` |
| `src/renderer/i18n.js` | 自动 | 三方自动合并，中文词条追加在 `zh` 块尾部 |
| `preload.js` | 自动 | 中文版 `setTutorial` / `setAutoUpdateCheck` / `skipUpdate` / `downloadUpdate` / `onUpdateProgress` / `clearCache` 全部保留；并入上游 `setReshadeProxy` |
| `src/core/scan.js` | 自动 | 保留中文版 Party Animals 渲染器档案；并入上游扫描调整 |
| `src/renderer/community.js` | 自动 | 并入上游社区改动 |
| `docs/screenshots/15-feature-gpu-filter.png` 等 4 张 | 无 | 双方新增内容一致，合并后无变化 |

> 冲突共 **8** 个文件（`README.md`、`package.json`、`package-lock.json`、`main.js`、`src/renderer/renderer.js`、`src/renderer/index.html`、`src/renderer/style.css`、`src/renderer/overlay-live.js`），由 `git merge-tree` 复核确认。

---

## 三、上游删除（0 个）

`git diff --name-status v2.2.7 v2.2.9` 中没有 `D` 条目，本次无需处理「先搜引用再删」。

---

## 四、组件钉值（合并后实测）

| 组件 | 从 | 到 | 落点 | 实测 |
|---|---|---|---|---|
| DLSS5-Feeder | 0.15.1 | 1.17.0 | `src/core/feeder-release.js`、`overlay/feeder-controls.hpp` | `version: '1.17.0'` ✓ |
| RenoDX DLSS5 | v4.7 | 6.5.3 | `src/core/renodx-release.js`、`scripts/collect-payload.js` | `version: '6.5.3'` ✓ |
| OptiScaler（pre-SR 多通道） | — | 0.8.92-presr | `src/core/optiscaler.js` | `0.8.92-presr` + URL ✓ |
| dgVoodoo2 | 2.87.4 | 2.87.5 | `src/core/runtime-components.js` | `2.87.5` + URL ✓ |
| ReShade | 6.8.0 | 6.8.0（不变） | `src/core/scan.js` | — |
| NVIDIA DLSS 运行时 | — | 310.9.1 | 代码中无版本常量，打包时从本机采集 | — |

---

## 五、验证结果

| 判据 | 结果 |
|---|---|
| `npm test` | **326 用例 / 324 通过 / 0 失败 / 2 跳过**（跳过项为社区服务器源码不在本机，设计如此） |
| `node scripts/zh-tw-diff.js` | `total en keys: 324`、`zh-TW keys present: 324`、`missing in zh-TW: 0`、`stale keys in zh-TW: 0` |
| 简体 + 繁体词条覆盖（脚本之外补测） | 两份词典各 **324 键，missing 0 / stale 0**（`zh-tw-diff.js` 只校验繁体，简体是另测的） |
| 新键函数级实测 | `setLang('zh')` 后逐个调用 `t(key)`：`legacyRendererHint`、`legacyDownloadHint`、`driverNeuralFault`、`rivalConsumerSetAside`、`oldShaderCompiler`、`componentQuarantined`、`unsupportedRendererHint`、`setSafeGraphicsHint`、`fReshadeFile`、`reshadeProxyWrapHint`、`setSkins`、`skinTwo`、`t2SetupTitle`、`sheetSetup`、`railCollapse`、`overlayNotForRoute`、`multipassNext`、`restoreRecovered` —— 全部返回中文；`driverNeuralFault('616.64')` 占位符正确替换 |
| 中文版三个自加功能 | 教程（`tutorial.js` / `tutorial-copy.js` / `set-tutorial`）、更新检测（`UPDATE_REPO = hezhixin15/DLSS5-Swapper-Chinese`）、缓存清理（`clear-cache`）入口均在位 |
| 三处上游新功能 | 主题 2（`theme2.css` / `theme2.js`）、ReShade 文件选择（`setReshadeProxy`）、第二个 OptiScaler 选项（`0.8.92-presr`）入口均在位 |
| 六功能针对性测试 | `tutorial` / `update-check` / `clear-cache` / `release-228` / `optiscaler-build-choice` / `multipass` / `restore-recovery` / `release-227` 共 **68 用例全通过** |
| `npm run test:ui:tutorial` | **PASS** —— 首次启动引导以中文出现，翻页/跳过/完成并落盘，Esc 关闭不算决定，其他语言与已决定用户不再出现 |
| `npm run test:ui` | **PASS** —— 38 种语言的筛选与警告、库分组、可选后端、历史/复制、右键动作、键盘可达、还原守卫、**缓存清理**、明暗与 RTL 布局 |
| 界面抽查新文案为中文 | `dist/ui-tests/tutorial-zh-1.png`（教程第 1/7 步）、`settings-cache-zh.png`（清理应用缓存）、`settings-reopen-tutorial-zh.png`（设置页「主题 / 主题 1 · 经典 / 主题 2 · 光圈」——上游 2.2.8 新增项已显示为中文） |
| `npm run payload` / `npm run test:payload` | **未执行**——本机无 `payload/`、`addons/`、`overlay-bin/`，且需要联网下载组件与本机 DLSS 运行时文件 |
| `npm run overlay:build` | **未执行**——同上，属打包环节 |

---

## 六、合并后补的一处修复

`npm run test:ui` 首次运行时红，报 `TypeError: window.lab.communityOptedIn is not a function`。

- **根因**：上游在 `src/renderer/renderer.js` 新增了 `fillSheetCommunity()`，其中调用 `window.lab.communityOptedIn()`（对应上游 #358：没人打开过社区前不向服务器提问）。真实 `preload.js:86` 有暴露该方法，但中文版自有的测试替身 `test/fixtures/game-filters-preload.js` 没有跟上——属于「替身与桩随产品演进过期」。
- **修法**：在替身里补 `communityOptedIn: async () => ({ ok: true, on: false })`，与真实 IPC `community-opted-in` 在「没人用过社区」时的返回值一致。不改应用代码（应用代码是对的）。
- **结果**：`npm run test:ui` 转绿。
