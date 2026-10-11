import { checksum } from "@opencode-ai/core/util/encode"
import DOMPurify from "dompurify"
import { parseMarkdown } from "./markdown-worker"

export type MarkdownCacheEntry = {
  raw: string
  hash: string
  html: string
}

const max = 200
const cache = new Map<string, MarkdownCacheEntry>()
const config = {
  USE_PROFILES: { html: true, mathMl: true },
  SANITIZE_NAMED_PROPS: true,
  FORBID_TAGS: ["style"],
  FORBID_CONTENTS: ["style", "script"],
  ADD_TAGS: [
    // svg 容器
    "svg",
    // 图形
    "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
    // 结构
    "g", "defs", "symbol", "marker", "use",
    // 文本/标签
    "text", "tspan", "textPath",
    // 渐变/滤镜
    "linearGradient", "radialGradient", "stop", "filter",
    // 元数据
    "title", "desc",
  ],
  ADD_ATTR: [
    // 坐标与变换
    "d", "viewBox", "preserveAspectRatio", "xmlns", "transform",
    "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry",
    "width", "height", "points", "pathLength",
    // 外观
    "fill", "fill-opacity", "fill-rule",
    "stroke", "stroke-width", "stroke-opacity", "stroke-linecap",
    "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset",
    "opacity",
    // 渐变停靠
    "offset", "stop-color", "stop-opacity", "gradientUnits",
    "gradientTransform", "spreadMethod", "href",
    // 文本
    "text-anchor", "font-size", "font-family", "font-weight",
    "dominant-baseline", "letter-spacing",
    // 箭头 marker
    "marker-start", "marker-mid", "marker-end",
    "orient", "refX", "refY", "markerWidth", "markerHeight",
    // 其它
    "target", "data-markdown-image-src", "id", "class",
  ],
  ALLOW_DATA_ATTR: true,
}

if (typeof window !== "undefined" && DOMPurify.isSupported) {
  DOMPurify.addHook("afterSanitizeAttributes", (node: Element) => {
    if (node instanceof HTMLAnchorElement) {
      if (node.target !== "_blank") return

      const rel = node.getAttribute("rel") ?? ""
      const set = new Set(rel.split(/\s+/).filter(Boolean))
      set.add("noopener")
      set.add("noreferrer")
      node.setAttribute("rel", Array.from(set).join(" "))
    }

    // 把 SVG marker 的 url(#id) 引用同步改为 user-content- 前缀，与被重写的 id 匹配
    if (node instanceof SVGElement) {
      for (const attr of ["marker-start", "marker-mid", "marker-end"]) {
        const value = node.getAttribute(attr)
        if (value && /^url\(\s*#/.test(value)) {
          const rewritten = value.replace(
            /url\(\s*#([^)\s]+)\s*\)/g,
            (_match, id: string) => `url(#user-content-${id})`,
          )
          node.setAttribute(attr, rewritten)
        }
      }
    }
  })
}

export function sanitizeMarkdown(html: string) {
  if (!DOMPurify.isSupported) return ""
  return DOMPurify.sanitize(html, config)
}

export function getCachedMarkdown(key: string) {
  return cache.get(key)
}

export function touchCachedMarkdown(key: string, value: MarkdownCacheEntry) {
  cache.delete(key)
  cache.set(key, value)

  if (cache.size <= max) return

  const first = cache.keys().next().value
  if (!first) return
  cache.delete(first)
}

export async function preloadMarkdown(text: string, cacheKey: string) {
  const key = `${cacheKey}:0:full`
  const cached = getCachedMarkdown(key)
  if (cached?.raw === text) {
    touchCachedMarkdown(key, cached)
    return
  }
  const hash = checksum(text)
  if (!hash) return
  touchCachedMarkdown(key, {
    raw: text,
    hash,
    html: sanitizeMarkdown(await parseMarkdown(text)),
  })
}
