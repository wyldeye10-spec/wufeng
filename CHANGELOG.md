# 变更记录 / Changelog

## 1.0.3 — 2026-11-08

### 改动

- 事项标题与正文统一换用自托管楷体「霞鹜文楷 GB / LXGW WenKai GB」，保留其温润的
  楷书笔意，接近参考图中游戏内文字的观感；编辑卷纸的标题与正文同步换用同一字体。
- 标题层级拉开：未竟/已了条目标题桌面 24px、移动端 22px，正文桌面 16px、移动端
  15px；编辑卷纸标题 32px、移动端 28px，正文 17px。标题明显大于正文，同时保持窄屏
  8 字标题不爆行。
- 新增 `src/assets/fonts/wufeng-kai.woff2`：覆盖 GB2312、界面字符与常用标点的
  WOFF2 子集（约 1.6 MB），随 Service Worker 一起离线缓存，不请求在线字体。
- 字体许可与署名补充至 `THIRD_PARTY_NOTICES.md` 和 `public/licenses/fonts.txt`；
  子集按 OFL 1.1 的 Web Font 例外处理，改名为 `Wufeng Kai`，不作为可安装桌面字体分发。
- 端到端验收新增「楷体字族 / 标题大于正文 / 编辑卷纸同用楷体」用例，并扩展离线
  字体断言；总数由 15 组增至 16 组。

### 验收

- 16 组端到端用例全部通过；详见 `tests/last-report.txt`。
- 视觉截图已重拍：`screenshots/final-desktop.png`、`final-mobile.png`、
  `final-composer.png`、`final-mobile-composer.png` 等。

## 1.0.2 — 2026-11-07

### 改动

- 删除二次确认不再「点完即闪退」：点击「抹去」后，确认层与卷纸层一起淡出
  （380ms），随后未竟/已了条目以墨迹消散（300ms），再更新列表。
- 删除数据仍先写入 IndexedDB；写入失败时确认层与卷纸保留，不会出现「界面没了、
  数据还在」的假成功。
- 端到端用例新增断言：淡出期间 alertdialog 仍在，确认层动画为 `modal-fade-out`、
  卷纸层为 `composer-fade-out`；淡出后才出现 `.memo.is-erasing`，最后才移除条目。

### 验收

- 15 组端到端用例全部通过；详见 `tests/last-report.txt`。

## 1.0.1 — 2026-11-06

### 改动

- 完成动效拆成三段：点击「了」后朱印先落定（560ms），未竟条目随即淡出消散（320ms）；
  状态切换后，同一事项在「已了之事」中以纸墨淡入的方式出现（520ms）。
- 淡出期间条目不再响应点击；已了条目淡入时保留朱印与完成态样式。
- 版本号更新为 `1.0.1`；新增 `CHANGELOG.md`、`releases/README.md` 与版本存档流程。

### 验收

- 更新后的端到端用例额外断言：淡出阶段已了列表仍为空，随后才出现带
  `.is-arriving` 的已了条目。
- 仍为 15 组用例全部通过，详情见 `tests/last-report.txt`。

## 1.0.0 — 2026-11-06

### 初次交付

- 无锋卷宗首页、未竟/已了两栏、撕纸横幅、朱印落章、卷纸编辑器、二次确认删除。
- 标题 8 字 / 内容 50 字，Unicode 字素计数，中文输入法组合保护。
- IndexedDB → localStorage → 内存三层持久化与明确降级提示。
- PWA Manifest、图标、Service Worker、离线重载。
- 自托管 Ma Shan Zheng / Noto Serif SC 字体子集，本地无外部依赖。
- 15 组端到端验收全部通过；项目存档为 Git tag `v1.0.0` 与
  `releases/wufeng-1.0.0.zip`。
