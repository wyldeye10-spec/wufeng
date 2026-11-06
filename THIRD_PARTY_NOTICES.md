# 第三方声明 / Third-Party Notices

「无锋」本体代码为本次委托定制交付。运行时仅依赖 React 与 React DOM；字体、图标与测试工具按下列方式署名。

## 字体

### Ma Shan Zheng（马善政毛笔楷书）

- 用途：卷首「无锋」、章节标题、「已了」印章等展示文字。
- 版权：Copyright 2018 The MaShanZheng Project Authors
  (https://github.com/googlefonts/mashanzheng)
- 许可：SIL Open Font License 1.1
- 来源：https://fonts.google.com/specimen/Ma+Shan+Zheng
- 本项目使用 fontTools 对字体做子集化，只保留界面实际用到的字形，输出为
  `src/assets/fonts/wufeng-display.woff2`。子集仍受 OFL 1.1 约束。
- 应用图标中的「无」「锋」轮廓取自该字体，作为本项目图标的一部分使用。

### Noto Serif SC / Noto Serif CJK SC

- 用途：事项标题、正文、界面标签。
- 版权：© 2017–2023 Adobe (http://www.adobe.com/)
- 商标：Noto is a trademark of Google Inc.
- 许可：SIL Open Font License 1.1
- 来源：https://fonts.google.com/noto/specimen/Noto+Serif+SC
- 本项目使用 fontTools 固定字重并子集化（430 与 650 两档），覆盖 GB2312
  与界面字符，输出为 `src/assets/fonts/wufeng-serif.woff2` 与
  `wufeng-serif-bold.woff2`。子集仍受 OFL 1.1 约束。

### SIL Open Font License 1.1

完整许可见 [public/licenses/OFL-1.1.txt](public/licenses/OFL-1.1.txt)，同时会随
PWA 缓存离线保存。字体子集文件的 name 表只保留必要字段，版权与许可信息以本文件
及上述 OFL 文件为准。

## 运行与构建依赖

| 包 | 用途 | 许可 | 版权/主页 |
|---|---|---|---|
| react / react-dom | 界面运行时 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. https://react.dev |
| vite | 开发与构建 | MIT | Copyright (c) 2019-present, Yuxi (Evan) You and Vite contributors. https://vite.dev |
| typescript | 类型检查（开发） | Apache-2.0 | https://www.typescriptlang.org |
| playwright-core | 端到端测试（开发） | Apache-2.0 | Copyright (c) Microsoft Corporation. https://playwright.dev |
| sharp | 图标生成（开发） | Apache-2.0 | Copyright (c) Lovell Fuller and contributors. https://sharp.pixelplumbing.com |
| fonttools / brotli | 字体子集生成（开发） | MIT / MIT | https://github.com/fonttools/fonttools |

完整依赖树与许可文本可通过 `npm ls --all` 与各包内的 `LICENSE` 文件查看。

## 视觉素材

除字体轮廓外，界面中的撕纸、朱印、纸纹、刀痕与图标均为本项目手写 CSS /
内联 SVG / 程序化生成，不使用《影之刃零》或其他作品的 Logo、角色、界面或插画。
`参考图/` 目录中的游戏截图仅作为用户提供的设计参考，不参与构建，也不随应用发布。
