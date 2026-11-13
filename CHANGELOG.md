# Changelog

## 0.3.3 — 2026-11-13

- 简笔画默认 `roughness` 从 2.0 降到 1.25，减少“毛发状”过度抖动；仍可用 `roughness` 调回更粗犷的效果。
- 中文单线（`cjkStyle:"line"`）加强抖动与单字小幅旋转，小字号自动限幅，避免抖断。
- 新增 `LICENSE` 与打包清单；README 补充安装与调参说明。

## 0.3.2 — 2026-11-13

- 中文默认改用 `cjkStyle:"line"`：`hanzi-writer-data` 的 `medians` 等宽圆头单线，不再默认使用楷体轮廓。
- 保留 `cjkStyle:"outline"` 作为轮廓填充模式。

## 0.3.1 — 2026-11-13

- APNG 动画从“整笔/整字出现”改为沿每条笔画长度逐步绘制。
- 新增 `trimPolyline`、按 median 截断的轮廓填充，以及按 op 进度的 `revealOp`/`revealProgress`。

## 0.3.0 — 2026-11-13

- 新增 `messy` 预设与 `roughness` 参数。
- 新增一笔一画 APNG 动画（`animate:true`、`steps`），以及 `*-steps.png` 输出。
- 模板与文字都可生成动画，并在聊天中先返回动画、再返回最终图。

## 0.2.0 — 2026-11-13

- 接入按需下载的 `hanzi-writer-data`，支持中文与中英混排。
- 新增 `lib/hanzi.js`、汉字轮廓解析、CJK 排版与按字缓存。
- 中文数据不随插件打包，遵循 Arphic Public License。

## 0.1.6 — 2026-11-13

- 新增 `scribble_style action:"capture_image"`，从 PNG 手写图估计线条风格（不复制字形、不做 OCR）。
- 新增纯 JS PNG 解码、二值化、Zhang-Suen 骨架化、折线追踪与风格特征估计。

## 0.1.0 — 2026-11-13

- 首个可用版本：单线拉丁/数字/标点、简笔画模板、PNG/SVG 输出。
- 六个工具：`scribble_write`、`scribble_draw`、`scribble_templates`、`scribble_style`、`scribble_feedback`、`scribble_font`。
- 风格画像捕获、反馈微调、激活画像；Hershey 单线字形数据与 NOTICE。
