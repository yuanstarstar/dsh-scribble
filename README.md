# dsh-scribble

DSH 的手写字体与简笔画插件。用自绘的单线字形出图，也能从你画过的画里学习你的手写风格。

当前版本 **0.3.3（Host-only）**：已实现 M1 + S1 + S2，并新增 `capture_image`（从 PNG 手写图学风格）、汉字笔画、一笔一画的 APNG 动画和 `messy` 歪扭预设。TTF 导出和常驻 UI 尚未做。

本地 bundle 名为 `@local/dsh-scribble`（源目录就是本目录）。

## 安装

解压发布包后，把整个 `dsh-scribble-0.3.3` 目录装进 DSH：

```text
plugin_manager install_bundle target:"link:<解压目录的绝对路径>"
```

安装后重开一个会话，工具名以 `scribble_` 开头。若升级后仍看到旧行为，是 Host 模块缓存；换一个新 bundle id 或重启 DSH 桌面端即可。

本版重点：
- 文字和模板默认生成 **一笔一画的 APNG 动画**（`animate:true`）：每条笔画沿长度逐渐画出，不是整笔突然出现，也不是逐字跳。
- 新增 `roughness` 参数和 `messy` 预设，模板不再像印刷体；默认 write roughness=1.8、draw=1.25。
- 中文默认用 **纯单线笔画**（`cjkStyle:"line"`）：等宽、圆头、没有楷体的锋顿，而且默认比之前更歪扭；需要原来的轮廓填充时传 `cjkStyle:"outline"`。
- 中文单线的抖动单独收敛，保证“歪”但仍可读；小字号会按比例收住，不会抖断。

## 工具

| 工具 | 作用 |
|---|---|
| `scribble_write` | 把一段文字画成 PNG/SVG，并生成一笔一画的 APNG（手写标题、便签、台词卡） |
| `scribble_draw` | 画简笔画：火柴人、猫、狗、鸟、房子、树、太阳云、花、爱心/星星/箭头、对话泡、公园小景，或自由笔画/图元；同样带一笔一画动画 |
| `scribble_templates` | 列出模板和参数 |
| `scribble_style` | 看历史、捕获风格、切换/学习/导出画像 |
| `scribble_feedback` | 用「太乱/太整齐/太斜/太细…」反馈微调风格 |
| `scribble_font` | 字体信息、风格样张；TTF 导出在 M2 |

## 快速用法

```text
scribble_write text:"HELLO DSH" style:"pencil" size:160
scribble_draw template:"stick_figure" params:{pose:"wave",mood:"happy"}
scribble_draw template:"scene_park" params:{text:"HI"}
```

歪扭 + 一笔一画：

```text
scribble_write text:"你好 DSH 2026" style:"messy" size:150 animate:true
scribble_draw template:"cat" style:"messy" profile:"none" animate:true
```

- `animate:false` 只出最终图。
- `steps` 可手动指定帧数（4–160）；省略时按笔画自动，每条笔画约 3 帧，最多 160 帧。
- `roughness` 0.4–2.5，越大越抖/越歪；`messy` 预设是“明显手写但别散架”的起点。
- 简笔画默认 `roughness=1.25`：想更干净用 `1.0`，想更毛用 `1.5`；中文单线默认比之前更歪，想收一点用 `roughness:1.2`。
- APNG 文件是 `*-steps.png`，和最终 PNG/SVG 放在同一目录。

风格学习：

```text
scribble_write text:"DRAW EVERY DAY" style:"child"
scribble_style action:"history"
scribble_style action:"capture" drawingIds:["draw_..."] name:"my hand"
scribble_write text:"NEXT ONE"        # 自动使用当前风格
scribble_feedback drawingId:"draw_..." rating:1 tags:["too_messy"]
```

从以前的手写图学（目前只收 PNG；JPEG 先转 PNG）：

```text
scribble_style action:"capture_image" imagePath:"my-handwriting.png" name:"my hand 2024"
scribble_write text:"NEXT ONE"        # 自动使用刚学到的画像
```

`capture_image` 会做：PNG 解码 → 二值化 → 去噪 → 骨架化 → 追踪折线 → 估计倾斜/粗细/抖动/基线跳动/字距。它只学“线条手感”，不复制具体字形，也不做 OCR。

中文写法：

```text
scribble_write text:"你好 世界" size:140 cjkStyle:"line"
```

`cjkStyle` 默认 `line`：用 `hanzi-writer-data` 的 `medians` 中心线，等宽圆头，刻意不要楷体的起笔/收笔和粗细变化。想要原来的轮廓楷体，传 `cjkStyle:"outline"`（轮廓本身仍带锋顿）。

汉字按需从 `hanzi-writer-data@2.0.1` 下载到 `~/.dsh/scribble/hanzi/`（首次需要联网，之后离线可用），不是随插件打包的字体。它给的是标准字形，不是用户自己的字形；画像只改变倾斜、抖动、字距等手感参数，不能把标准汉字变成用户的手写体。

## 实现

- 纯 JavaScript，无原生依赖；PNG 由 `node:zlib` 直接编码，SVG 同步输出；APNG 由自写的小编码器拼帧，不依赖第三方库。
- 一笔一画动画不是把最终图淡入：渲染器给每次 `stroke`/`fill` 编号，每帧只画到“第 N 笔的 P%”；开放/闭合笔画按折线长度截断，中文单线同样沿中心线截断。默认每笔约 3 帧，因此第一帧通常只有一小段起笔。
- 拉丁/数字/标点为单线中心线（Hershey Sans 1-stroke，187 个字形），加笔宽/倾斜/抖动/压感，不是系统字体。
- 汉字默认用 `hanzi-writer-data@2.0.1` 的 `medians` 中心线，等宽圆头，没有锋顿；`cjkStyle:"outline"` 才用笔顺轮廓填充。首次按字下载并缓存，不随插件打包。坐标 y 向上（不是 Make Me a Hanzi 的 y 向下），渲染时直接按 em 比例缩放。
- 画像只学数值参数（抖动、粗细、倾斜、间距等），不复制字形，不训练大模型。中文单线的粗细由 `weight` 和统一线宽决定，画像主要影响倾斜/抖动/字距。
- `capture_image` 的 PNG 解码、Zhang-Suen 骨架化和特征估计全部纯 JS，不新增依赖；支持 8-bit 灰度/RGB/RGBA、非隔行 PNG。

## 文档

- 方案：[docs/方案-v0.1.md](docs/方案-v0.1.md)（v0.2）
- 风格训练与反馈：[docs/风格训练与反馈-方案-v0.1.md](docs/风格训练与反馈-方案-v0.1.md)
- PoC：[poc/render-demo.cjs](poc/render-demo.cjs)，样例：[poc/dsh-scribble-demo.png](poc/dsh-scribble-demo.png)

## 许可

插件代码 MIT；`lib/hershey.json` 的 Hershey 字形数据遵循其宽松许可，署名与限制见 [NOTICE](NOTICE)。中文笔画数据来自 `hanzi-writer-data`，按 Arphic Public License 使用，只在运行时按需下载、不随插件打包；详见 [NOTICE](NOTICE) 与 `docs/方案-v0.1.md` 的许可证章节。
