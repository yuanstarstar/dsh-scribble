import fs from 'node:fs'
import path from 'node:path'
import { cwdOf, newId, outputsDir, recordDrawing, safeName, writeOutputs } from './storage.js'
import { numericStyle, PRESETS, STYLE_NAMES, styleSummary } from './style.js'
import { renderScene, renderText } from './render.js'
import { buildAnimation } from './animation.js'
import { TEMPLATES, templateList } from './templates.js'
import { installGlyphs, unsupportedChars } from './glyphs.js'
import { hasCjk, loadHanziText } from './hanzi.js'
import { vectorizePng } from './vectorize.js'
import {
  activeProfile,
  applyFeedback,
  captureProfile,
  captureProfileFromImage,
  deleteProfile,
  getProfile,
  historyWithRatings,
  learnProfile,
  listProfiles,
  profileExport,
  profilePathFor,
  profileSummary,
  resetActive,
  setActiveProfile,
} from './profiles.js'

const MAX_TEXT = 2000
const MAX_POINTS = 200_000

function fail(message) {
  return { text: `❌ ${message}` }
}

function lossless(value) {
  if (Array.isArray(value)) return value.map(lossless).filter((item) => item !== undefined)
  if (value && typeof value === 'object') {
    const out = {}
    for (const [key, item] of Object.entries(value)) {
      const safe = lossless(item)
      if (safe !== undefined) out[key] = safe
    }
    return out
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'bigint') return String(value)
  if (typeof value === 'function' || typeof value === 'symbol') return undefined
  return value
}

function textTool(name, description, parameters, execute) {
  return {
    name,
    description,
    parameters,
    output: {
      schema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
        additionalProperties: true,
      },
      render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }],
    },
    execute,
  }
}

const IMAGE_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    drawingId: { type: 'string' },
    profileId: { type: 'string' },
    pngPath: { type: 'string' },
    svgPath: { type: 'string' },
    apngPath: { type: 'string' },
    steps: { type: 'number' },
    width: { type: 'number' },
    height: { type: 'number' },
    seed: { type: 'number' },
    imageCapable: { type: 'boolean' },
    image: {
      type: 'object',
      properties: {
        attachmentId: { type: 'string' },
        mediaType: { type: 'string' },
        bytes: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
        name: { type: 'string' },
      },
      required: ['attachmentId', 'mediaType', 'bytes', 'width', 'height'],
      additionalProperties: true,
    },
    animation: {
      type: 'object',
      properties: {
        attachmentId: { type: 'string' },
        mediaType: { type: 'string' },
        bytes: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
        name: { type: 'string' },
      },
      required: ['attachmentId', 'mediaType', 'bytes', 'width', 'height'],
      additionalProperties: true,
    },
  },
  required: ['text'],
  additionalProperties: true,
}

const IMAGE_OUTPUT = {
  schema: IMAGE_SCHEMA,
  render: (_args, value) => {
    const blocks = [{ type: 'text', text: String(value?.text ?? '') }]
    if (value?.imageCapable === true && value.animation?.attachmentId) {
      blocks.push({
        type: 'image',
        attachment: {
          attachmentId: value.animation.attachmentId,
          mediaType: value.animation.mediaType,
          bytes: value.animation.bytes,
          width: value.animation.width,
          height: value.animation.height,
          ...(value.animation.name ? { name: value.animation.name } : {}),
        },
      })
    }
    if (value?.imageCapable === true && value.image?.attachmentId) {
      blocks.push({
        type: 'image',
        attachment: {
          attachmentId: value.image.attachmentId,
          mediaType: value.image.mediaType,
          bytes: value.image.bytes,
          width: value.image.width,
          height: value.image.height,
          ...(value.image.name ? { name: value.image.name } : {}),
        },
      })
    }
    return blocks
  },
}

function imageTool(name, description, parameters, execute) {
  return { name, description, parameters, output: IMAGE_OUTPUT, execute }
}

async function routeSupportsImage(ctx, exec) {
  const llm = ctx.get('llm')
  if (!llm) return false
  const routed = exec?.agent?.session?.requestHeader?.()?.config
  const provider = routed?.provider ?? exec?.agent?.options?.provider
  const model = routed?.model ?? exec?.agent?.options?.model
  if (!provider || !model) return false
  try {
    const info = await llm.resolveModelInfo(provider, model, exec?.signal)
    return Array.isArray(info?.inputModalities) && info.inputModalities.includes('image')
  } catch {
    return false
  }
}

function profileArg(args) {
  if (args.profile === 'none') return null
  if (args.profile) {
    const profile = getProfile(String(args.profile))
    if (!profile) throw new Error(`PROFILE_NOT_FOUND: 找不到风格 ${args.profile}`)
    return profile
  }
  return activeProfile()
}

function styleArgs(args) {
  const profile = profileArg(args)
  return { profile, profileId: profile?.id || null }
}

async function deliver(ctx, exec, rendered, meta) {
  const drawingId = newId('draw')
  const fileName = `${safeName(meta.slug || 'scribble')}`
  const files = writeOutputs(exec, rendered, { filename: fileName, outputDir: meta.outputDir })
  let apngPath = ''
  if (meta.animation?.apng) {
    apngPath = files.pngPath.replace(/\.png$/i, '-steps.png')
    fs.writeFileSync(apngPath, meta.animation.apng)
  }
  let image = null
  let animation = null
  let attachmentWarning = ''
  let attachments = null
  try {
    attachments = ctx.get('attachments')
    if (attachments) {
      const ref = await attachments.saveImage({
        data: rendered.png,
        mediaType: 'image/png',
        name: path.basename(files.pngPath),
      })
      if (ref?.attachmentId) {
        image = {
          attachmentId: String(ref.attachmentId),
          mediaType: ref.mediaType || 'image/png',
          bytes: Number(ref.bytes) || rendered.png.length,
          width: Number(ref.width) || rendered.width,
          height: Number(ref.height) || rendered.height,
          ...(ref.name ? { name: String(ref.name) } : {}),
        }
      }
      if (meta.animation?.apng) {
        const refAnim = await attachments.saveImage({
          data: meta.animation.apng,
          mediaType: 'image/png',
          name: path.basename(apngPath),
        })
        if (refAnim?.attachmentId) {
          animation = {
            attachmentId: String(refAnim.attachmentId),
            mediaType: refAnim.mediaType || 'image/png',
            bytes: Number(refAnim.bytes) || meta.animation.apng.length,
            width: Number(refAnim.width) || meta.animation.width,
            height: Number(refAnim.height) || meta.animation.height,
            ...(refAnim.name ? { name: String(refAnim.name) } : {}),
          }
        }
      }
    } else {
      attachmentWarning = '附件服务不可用，图片只写了工作区文件。'
    }
  } catch (error) {
    attachmentWarning = `保存附件失败：${error instanceof Error ? error.message : String(error)}`
  }
  const imageCapable = image || animation ? await routeSupportsImage(ctx, exec) : false
  const style = { preset: rendered.style.preset, ...numericStyle(rendered.style) }
  recordDrawing(
    {
      drawingId,
      tool: meta.tool,
      label: meta.label || '',
      text: meta.text || '',
      template: meta.template || null,
      style,
      seed: rendered.seed,
      width: rendered.width,
      height: rendered.height,
      pngPath: files.pngPath,
      svgPath: files.svgPath,
      apngPath: apngPath || null,
      profileId: meta.profileId || null,
      createdAt: new Date().toISOString(),
    },
    meta.snapshot || null,
  )
  const lines = [
    `✅ 画好了：${meta.label || meta.tool}`,
    `PNG：${files.pngPath}`,
    `SVG：${files.svgPath}`,
    `尺寸：${rendered.width}×${rendered.height}，seed=${rendered.seed}${meta.profileId ? `，风格=${meta.profileId}` : ''}`,
  ]
  if (apngPath) lines.push(`分步手写：${apngPath}（${meta.animation.frames} 帧，循环播放）`)
  if (meta.extra) lines.push(meta.extra)
  if (attachmentWarning) lines.push(`⚠️ ${attachmentWarning}`)
  else if (!imageCapable) lines.push('（当前模型路由不支持图片输入，图已写文件；可直接打开 PNG 看。）')
  return lossless({
    text: lines.join('\n'),
    drawingId,
    ...(meta.profileId ? { profileId: meta.profileId } : {}),
    pngPath: files.pngPath,
    svgPath: files.svgPath,
    ...(apngPath ? { apngPath, steps: meta.animation.frames } : {}),
    width: rendered.width,
    height: rendered.height,
    seed: rendered.seed,
    imageCapable,
    ...(animation ? { animation } : {}),
    ...(image ? { image } : {}),
  })
}

async function runWrite(ctx, exec, args) {
  let text = String(args.text ?? '')
  if (!text.trim()) return fail('text 不能为空：写一句话或一个词')
  if (text.length > MAX_TEXT) return fail(`text 太长（${text.length} 字），最多 ${MAX_TEXT} 字`)
  if (hasCjk(text)) {
    try {
      const glyphs = await loadHanziText(text)
      installGlyphs(glyphs)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return fail(`中文笔画数据加载失败：${message}。首次使用需要联网下载 hanzi-writer-data，之后会缓存。`)
    }
  }
  const bad = unsupportedChars(text)
  if (bad.length) {
    return fail(
      `暂不支持这些字符：${bad.slice(0, 20).join(' ')}。当前覆盖拉丁字母、数字、常用标点，以及按需下载的常用汉字。`,
    )
  }
  const { profile, profileId } = styleArgs(args)
  try {
    const renderArgs = { ...args, text, profile, roughness: args.roughness == null ? 1.8 : args.roughness }
    const rendered = renderText(renderArgs)
    let animation = null
    let animationError = ''
    if (args.animate !== false) {
      try {
        animation = buildAnimation('text', renderArgs, rendered.ops, {
          maxFrames: Number(args.steps) > 0 ? Number(args.steps) : Math.min(160, Math.max(12, rendered.ops * 3)),
          width: Math.min(720, rendered.width),
        })
      } catch (error) {
        animationError = error instanceof Error ? error.message : String(error)
      }
    }
    return await deliver(ctx, exec, rendered, {
      tool: 'scribble_write',
      label: `文字「${text.slice(0, 24)}${text.length > 24 ? '…' : ''}」`,
      text,
      slug: text,
      outputDir: args.outputDir,
      profileId,
      animation,
      snapshot: { kind: 'write', text, style: args.style || profile?.basePreset || null, seed: rendered.seed },
      extra: `风格：${profile ? profileSummary(profile) : args.style || '内置预设'}；${styleSummary(rendered.style)}${animationError ? `；分步动画失败：${animationError}` : ''}`,
    })
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error))
  }
}

async function runDraw(ctx, exec, args) {
  const template = args.template ? String(args.template) : null
  if (template && !TEMPLATES[template]) return fail(`没有模板 ${template}；可用：${Object.keys(TEMPLATES).join(', ')}`)
  const strokes = Array.isArray(args.strokes) ? args.strokes : []
  if (strokes.length > 5000) return fail('strokes 最多 5000 条')
  let points = 0
  for (const stroke of strokes) if (Array.isArray(stroke?.points)) points += stroke.points.length
  if (points > MAX_POINTS) return fail(`笔画点太多（${points}），最多 ${MAX_POINTS}`)
  const { profile, profileId } = styleArgs(args)
  try {
    const renderArgs = {
      ...args,
      template: template || (args.elements || strokes.length ? null : 'scene_park'),
      profile,
      roughness: args.roughness == null ? 1.25 : args.roughness,
    }
    const rendered = renderScene(renderArgs)
    let animation = null
    let animationError = ''
    if (args.animate !== false) {
      try {
        animation = buildAnimation('scene', renderArgs, rendered.ops, {
          maxFrames: Number(args.steps) > 0 ? Number(args.steps) : Math.min(160, Math.max(12, rendered.ops * 3)),
          width: Math.min(720, rendered.width),
        })
      } catch (error) {
        animationError = error instanceof Error ? error.message : String(error)
      }
    }
    return await deliver(ctx, exec, rendered, {
      tool: 'scribble_draw',
      label: template ? `简笔画 ${TEMPLATES[template].title}` : '自由简笔画',
      slug: template || 'doodle',
      template,
      outputDir: args.outputDir,
      profileId,
      animation,
      snapshot: {
        kind: 'draw',
        template,
        params: args.params || null,
        elements: args.elements || null,
        strokes: strokes.length ? strokes : null,
        caption: args.caption || null,
        seed: rendered.seed,
      },
      extra: `风格：${profile ? profileSummary(profile) : args.style || '内置预设'}；${styleSummary(rendered.style)}${animationError ? `；分步动画失败：${animationError}` : ''}`,
    })
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error))
  }
}

function textResult(lines) {
  return { text: Array.isArray(lines) ? lines.join('\n') : String(lines) }
}

function styleHistory(args) {
  const limit = Math.max(1, Math.min(100, Number(args.limit) || 15))
  const rows = historyWithRatings(limit)
  if (!rows.length) return textResult('还没有绘画记录。先用 scribble_write 或 scribble_draw 画一张。')
  return textResult([
    `最近 ${rows.length} 张画：`,
    ...rows.map(
      (row, index) =>
        `${index + 1}. ${row.drawingId}  ${row.label || row.tool}  ${row.createdAt || ''}${
          row.rating == null ? '' : `  rating=${row.rating}`
        }${row.feedbackTags?.length ? `  tags=${row.feedbackTags.join(',')}` : ''}\n   ${row.pngPath}`,
    ),
    '',
    '想学这张的风格：scribble_style action:"capture" drawingIds:["上面的 id"]',
  ])
}

function styleList() {
  const rows = listProfiles()
  if (!rows.length) return textResult('还没有风格画像。先画一张，再 scribble_style action:"capture"。')
  return textResult([
    `风格画像 ${rows.length} 个：`,
    ...rows.map(
      (row) =>
        `${row.active ? '★ ' : '  '}${row.id}  ${row.name}  样本 ${row.stats?.samples ?? 0}  置信度 ${(
          Number(row.confidence || 0) * 100
        ).toFixed(0)}%  ${row.updatedAt || ''}`,
    ),
  ])
}

function styleGet(args) {
  const profile = args.id ? getProfile(String(args.id)) : activeProfile()
  if (!profile) return textResult('没有找到风格。先 capture 一个。')
  return textResult([
    `风格：${profile.name}（${profile.id}）`,
    `基础预设：${profile.basePreset}`,
    `置信度：${(Number(profile.confidence || 0) * 100).toFixed(0)}%  样本：${profile.stats?.samples ?? 0}`,
    `参数：${JSON.stringify(profile.style || {}, null, 2)}`,
    `档案：${profilePathFor(profile.id)}`,
  ])
}

function styleCapture(args) {
  const result = captureProfile({
    name: args.name,
    drawingIds: args.drawingIds,
    limit: args.limit,
    weights: args.weights,
    basePreset: args.basePreset,
    note: args.note,
    activate: args.activate !== false,
  })
  return textResult([
    `✅ 学会了风格：${result.profile.name}（${result.profile.id}）`,
    `样本 ${result.samples} 张，置信度 ${(result.profile.confidence * 100).toFixed(0)}%`,
    `参数：${JSON.stringify(result.profile.style, null, 2)}`,
    `已设为当前风格；之后 scribble_write / scribble_draw 会自动使用。`,
  ])
}

function styleCaptureImage(args, exec) {
  const imagePath = String(args.imagePath || '').trim()
  if (!imagePath) return fail('capture_image 需要 imagePath（PNG 路径）')
  const cwd = cwdOf(exec)
  const file = path.isAbsolute(imagePath) ? imagePath : path.resolve(cwd, imagePath)
  if (!fs.existsSync(file)) return fail(`找不到图片：${file}`)
  if (!/\.png$/i.test(file)) return fail('目前只支持 PNG；JPEG 请先转成 PNG 再导入')
  const buffer = fs.readFileSync(file)
  const result = vectorizePng(buffer, { maxDim: Number(args.maxDim) || 900 })
  const profile = captureProfileFromImage(
    result.features,
    { strokes: result.strokes.length, image: result.image },
    { name: args.name, note: args.note || `从图片学习：${path.basename(file)}`, activate: args.activate !== false },
  )
  return textResult([
    `✅ 从图片学到风格：${profile.name}（${profile.id}）`,
    `图：${result.image.width}×${result.image.height}，笔画 ${result.strokes.length} 条，置信度 ${(profile.confidence * 100).toFixed(0)}%`,
    `参数：${JSON.stringify(profile.style, null, 2)}`,
    '注意：只学线条手感（倾斜/粗细/抖动/间距），不复制具体字形，也不做 OCR。',
    '之后 scribble_write 不传 style 会自动用这个画像；想对比就传 style:"clean"。',
  ])
}

export function registerTools(ctx) {
  const register = (definition, label) => {
    const execute = definition.execute
    const safeDefinition = {
      ...definition,
      execute: async (...args) => lossless(await execute(...args)),
    }
    ctx.effect(() => ctx.tools.register(safeDefinition), label)
  }

  register(
    imageTool(
      'scribble_write',
      [
        '用 DSH 自己的单线手写字体把一段文字画成图片（PNG + SVG）。',
        '适合：手写标题、便签、台词卡、签名、给简笔画配题词。字形不是系统字体，笔画带铅笔/毛笔/童趣风格。',
        '覆盖拉丁字母、数字、常用标点；汉字首次使用时会按需下载笔画数据并缓存，之后离线可用。',
        '想用之前画过的风格：先 scribble_style capture，之后自动或显式传 profile。',
      ].join('\n'),
      {
        type: 'object',
        properties: {
          text: { type: 'string', maxLength: MAX_TEXT, description: '要写的文字；支持 \\n 换行' },
          size: { type: 'number', minimum: 12, maximum: 480, description: '字号（像素），默认 132' },
          style: {
            anyOf: [
              { type: 'string', enum: STYLE_NAMES },
              { type: 'object', additionalProperties: true },
            ],
            description: `风格名或参数对象；预设：${STYLE_NAMES.join(' / ')}`,
          },
          profile: { type: 'string', description: '风格画像 id；默认用当前激活画像，传 none 关闭' },
          cjkStyle: { type: 'string', enum: ['line', 'outline'], description: '汉字笔画：line=纯单线（无锋顿，默认），outline=楷体轮廓（有粗细）' },
          roughness: { type: 'number', minimum: 0.4, maximum: 2.5, description: '歪扭程度；默认 1.8，越大越抖/越歪' },
          animate: { type: 'boolean', description: '是否生成一笔一画的手写 APNG 动画，默认 true' },
          steps: { type: 'number', minimum: 4, maximum: 160, description: '动画帧数；省略=按笔画自动（每笔约 3 帧）' },
          color: { type: 'string', description: '墨色，CSS 颜色；默认取风格' },
          paper: { anyOf: [{ type: 'string' }, { type: 'boolean' }], description: '纸张颜色；false=透明背景' },
          width: { type: 'number', minimum: 64, maximum: 4096, description: '画布宽；省略按文字自适应' },
          height: { type: 'number', minimum: 64, maximum: 4096, description: '画布高；省略按行数自适应' },
          align: { type: 'string', enum: ['left', 'center', 'right'], description: '对齐，默认 left' },
          seed: { type: 'number', description: '随机种子；同参数同 seed 出图完全一致' },
          outputDir: { type: 'string', description: '输出目录（相对工作区）；默认 scribble-output/' },
          filename: { type: 'string', description: '文件名前缀，可省略' },
        },
        required: ['text'],
        additionalProperties: false,
      },
      async (args, exec) => runWrite(ctx, exec, args || {}),
    ),
    'scribble: write',
  )

  register(
    imageTool(
      'scribble_draw',
      [
        '画简笔画：选一个模板（火柴人/猫/狗/鸟/房子/树/太阳云/花/爱心星星箭头/对话泡/公园小景），或给自由笔画/图元。',
        '返回 PNG + SVG，并写入工作区。',
        '模板参数见 scribble_templates；自由图元支持 line/path/circle/ellipse/rect/text/group。',
      ].join('\n'),
      {
        type: 'object',
        properties: {
          template: { type: 'string', enum: Object.keys(TEMPLATES), description: '模板 id；省略且有 strokes/elements 时画自由内容' },
          params: { type: 'object', additionalProperties: true, description: '模板参数' },
          elements: {
            type: 'array',
            items: { type: 'object', additionalProperties: true },
            description: '自由图元数组；type=line/path/circle/ellipse/rect/text/group',
          },
          strokes: {
            type: 'array',
            items: { type: 'object', additionalProperties: true },
            description: '自由笔画：[{points:[[x,y],...], width?, color?, alpha?}]',
          },
          caption: { type: 'string', maxLength: 200, description: '底部题词' },
          ground: { type: 'boolean', description: '是否画地平线，默认 true（部分模板）' },
          style: {
            anyOf: [{ type: 'string', enum: STYLE_NAMES }, { type: 'object', additionalProperties: true }],
            description: '风格名或参数对象',
          },
          profile: { type: 'string', description: '风格画像 id；默认当前激活，传 none 关闭' },
          cjkStyle: { type: 'string', enum: ['line', 'outline'], description: '题词汉字：line=纯单线（无锋顿，默认），outline=楷体轮廓' },
          roughness: { type: 'number', minimum: 0.4, maximum: 2.5, description: '歪扭程度；默认 1.25，越大越抖/越歪' },
          animate: { type: 'boolean', description: '是否生成一笔一画的手写 APNG 动画，默认 true' },
          steps: { type: 'number', minimum: 4, maximum: 160, description: '动画帧数；省略=按笔画自动（每笔约 3 帧）' },
          color: { type: 'string', description: '主墨色' },
          paper: { anyOf: [{ type: 'string' }, { type: 'boolean' }], description: '纸张颜色；false=透明' },
          width: { type: 'number', minimum: 64, maximum: 4096, description: '画布宽，默认 1200' },
          height: { type: 'number', minimum: 64, maximum: 4096, description: '画布高，默认 800' },
          seed: { type: 'number', description: '随机种子' },
          outputDir: { type: 'string', description: '输出目录（相对工作区）' },
          filename: { type: 'string', description: '文件名前缀' },
        },
        additionalProperties: false,
      },
      async (args, exec) => runDraw(ctx, exec, args || {}),
    ),
    'scribble: draw',
  )

  register(
    textTool(
      'scribble_templates',
      '列出手绘简笔画模板及其参数；也可用 id 看单个模板的完整参数定义。',
      {
        type: 'object',
        properties: {
          id: { type: 'string', description: '模板 id；省略则列出全部' },
        },
        additionalProperties: false,
      },
      async (args) => {
        const id = args?.id ? String(args.id) : null
        if (id) {
          const template = TEMPLATES[id]
          if (!template) return fail(`没有模板 ${id}；可用：${Object.keys(TEMPLATES).join(', ')}`)
          return textResult([
            `${template.id} · ${template.title}`,
            template.description,
            '参数：',
            JSON.stringify(template.params, null, 2),
          ])
        }
        return textResult([
          `共 ${Object.keys(TEMPLATES).length} 个模板：`,
          ...templateList().map(
            (template) =>
              `- ${template.id}：${template.title} — ${template.description}\n  ${Object.keys(template.params).join(', ')}`,
          ),
          '',
          '用法：scribble_draw template:"stick_figure" params:{pose:"wave",mood:"happy"}',
        ])
      },
    ),
    'scribble: templates',
  )

  register(
    textTool(
      'scribble_style',
      [
        '手写风格画像：从自己画过的画或手写照片里学风格，并管理画像。',
        'actions：history 看最近画作；list 看画像；get 看细节；capture 从一张或多张画学风格；capture_image 从 PNG 手写图学风格；',
        'activate 切换当前画像；learn 用反馈重新学习；reset 清空当前画像参数；delete 删除；export 导出 JSON。',
        '风格画像只学抖动/粗细/倾斜/间距等参数，不复制字形，也不训练大模型。',
      ].join('\n'),
      {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['history', 'list', 'get', 'capture', 'capture_image', 'activate', 'learn', 'reset', 'delete', 'export'],
            description: '要做什么',
          },
          id: { type: 'string', description: '画像 id（get/activate/delete/export 用）' },
          imagePath: {
            type: 'string',
            description: 'capture_image 用：手写照片/扫描图的 PNG 路径（相对工作区或绝对路径；JPEG 请先转 PNG）',
          },
          drawingIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'capture 用：从这些绘画 id 学；省略则用最近 limit 张',
          },
          name: { type: 'string', description: 'capture 用：画像名' },
          note: { type: 'string', description: 'capture 用：备注' },
          limit: { type: 'number', minimum: 1, maximum: 100, description: 'history/capture/learn 的样本数' },
          basePreset: { type: 'string', enum: STYLE_NAMES, description: 'capture 的基础预设' },
          activate: { type: 'boolean', description: 'capture 后是否设为当前，默认 true' },
          maxDim: { type: 'number', minimum: 200, maximum: 1600, description: 'capture_image 的降采样最长边，默认 900' },
          outputDir: { type: 'string', description: 'export 输出目录' },
        },
        required: ['action'],
        additionalProperties: false,
      },
      async (args, exec) => {
        const action = args?.action
        try {
          if (action === 'history') return styleHistory(args)
          if (action === 'list') return styleList()
          if (action === 'get') return styleGet(args)
          if (action === 'capture') return styleCapture(args)
          if (action === 'capture_image') return styleCaptureImage(args, exec)
          if (action === 'activate') {
            if (!args.id) return fail('activate 需要 id')
            const profile = setActiveProfile(String(args.id))
            return textResult(`✅ 当前风格切到：${profile.name}（${profile.id}）`)
          }
          if (action === 'learn') {
            const result = learnProfile(args)
            return textResult([
              `✅ 已用 ${result.samples} 张画重新学习：${result.profile.name}`,
              `置信度：${(result.profile.confidence * 100).toFixed(0)}%`,
              `参数：${JSON.stringify(result.profile.style, null, 2)}`,
            ])
          }
          if (action === 'reset') {
            const result = resetActive()
            return textResult(result.reset ? `✅ 已清空当前风格参数：${result.profile.name}` : '当前没有激活风格。')
          }
          if (action === 'delete') {
            if (!args.id) return fail('delete 需要 id')
            const result = deleteProfile(String(args.id))
            return textResult(`✅ 已删除风格：${result.name}（${result.id}）`)
          }
          if (action === 'export') {
            const profile = args.id ? getProfile(String(args.id)) : activeProfile()
            if (!profile) return fail('没有可导出的风格')
            const dir = outputsDir(exec, args.outputDir)
            const file = path.join(dir, `${safeName(profile.name)}-${profile.id}.json`)
            fs.writeFileSync(file, profileExport(profile))
            return textResult(`✅ 已导出：${file}`)
          }
          return fail(`未知 action：${action}`)
        } catch (error) {
          return fail(error instanceof Error ? error.message : String(error))
        }
      },
    ),
    'scribble: style',
  )

  register(
    textTool(
      'scribble_feedback',
      [
        '对一张画给反馈，让“我的手写风格”往你喜欢的方向微调。',
        'rating：1 喜欢 / 0 中性 / -1 不喜欢；tags 可写太乱/太整齐/太斜/太细/太粗/太圆/太尖/太挤/太松。',
        '需要先有激活的风格画像（scribble_style capture），否则只记录反馈、不改风格。',
      ].join('\n'),
      {
        type: 'object',
        properties: {
          drawingId: { type: 'string', description: 'scribble_write / scribble_draw 返回的 drawingId' },
          rating: { type: 'number', enum: [-1, 0, 1], description: '喜欢程度' },
          tags: {
            type: 'array',
            items: {
              type: 'string',
              enum: [
                'too_tidy',
                'too_messy',
                'too_slanted',
                'too_straight',
                'too_thin',
                'too_thick',
                'too_round',
                'too_sharp',
                'too_tight',
                'too_loose',
              ],
            },
            description: '可多选；会直接微调当前画像参数',
          },
          compareTo: { type: 'string', description: '可选：和另一张画比较' },
          preferred: { type: 'string', enum: ['current', 'other'], description: '可选：更喜欢哪张' },
          note: { type: 'string', description: '备注' },
        },
        required: ['drawingId'],
        additionalProperties: false,
      },
      async (args) => {
        try {
          const result = applyFeedback(args || {})
          return textResult([
            `✅ 已记录反馈：${args.drawingId}`,
            result.changes.length ? `这次微调：${result.changes.join('；')}` : '这次没有改参数（只记了偏好）。',
            `当前画像：${result.profile.name}，置信度 ${(result.profile.confidence * 100).toFixed(0)}%`,
            '再画一张看看变化；不满意继续 feedback，或 scribble_style action:"learn"。',
          ])
        } catch (error) {
          return fail(error instanceof Error ? error.message : String(error))
        }
      },
    ),
    'scribble: feedback',
  )

  register(
    imageTool(
      'scribble_font',
      [
        '字体工具：list 看内置预设和字体信息；specimen 用指定风格写一张样张；export 预留 TTF 导出（M2）。',
        '首版是笔画渲染，不生成可安装 TTF；导出请等 M2。',
      ].join('\n'),
      {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'info', 'specimen', 'export'], description: '要做什么' },
          text: { type: 'string', maxLength: MAX_TEXT, description: 'specimen 的文字，默认一段字母表' },
          style: {
            anyOf: [{ type: 'string', enum: STYLE_NAMES }, { type: 'object', additionalProperties: true }],
            description: 'specimen 的风格',
          },
          profile: { type: 'string', description: 'specimen 的风格画像' },
          size: { type: 'number', minimum: 12, maximum: 480, description: 'specimen 字号' },
          width: { type: 'number', minimum: 64, maximum: 4096, description: 'specimen 画布宽' },
          height: { type: 'number', minimum: 64, maximum: 4096, description: 'specimen 画布高' },
          seed: { type: 'number', description: '随机种子' },
          outputDir: { type: 'string', description: '输出目录' },
        },
        required: ['action'],
        additionalProperties: false,
      },
      async (args, exec) => {
        const action = args?.action
        if (action === 'list' || action === 'info') {
          return textResult([
            `内置字体：Hershey Sans 1-stroke（单线，187 个字形，公有领域/libre 许可，见 NOTICE）`,
            `风格预设：${STYLE_NAMES.map((name) => `${name}(${PRESETS[name].label})`).join(' / ')}`,
            `当前画像：${profileSummary(activeProfile())}`,
            action === 'info'
              ? '实现：中心线笔画 + 笔宽 + 抖动/倾斜/压感；输出 PNG/SVG。TTF 导出在 M2。'
              : '看样张：scribble_font action:"specimen" text:"..." style:"pencil"',
          ])
        }
        if (action === 'export') {
          return fail('TTF 导出还没做（M2 里程碑）。现在可以先用 scribble_write 出图，或用 scribble_style export 导出风格 JSON。')
        }
        if (action === 'specimen') {
          return runWrite(ctx, exec, {
            text: args.text || 'ABCDEFGHIJKLM\nabcdefghijklm\n0123456789 !?.,;:-',
            size: args.size,
            style: args.style,
            profile: args.profile,
            width: args.width,
            height: args.height,
            seed: args.seed,
            outputDir: args.outputDir,
          })
        }
        return fail(`未知 action：${action}`)
      },
    ),
    'scribble: font',
  )

  ctx.logger?.info?.('Scribble 已加载：scribble_write / scribble_draw / scribble_templates / scribble_style / scribble_feedback / scribble_font')
}
