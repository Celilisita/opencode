import katex from "katex"
import { Marked, type MarkedExtension, type Tokens } from "marked"
import markedShiki from "marked-shiki"

export function createMarkdownParser(highlight: (code: string, language: string) => string | Promise<string>) {
  return new Marked(
    {
      renderer: {
        link({ href, title, text }) {
          const titleAttr = title ? ` title="${title}"` : ""
          return `<a href="${href}"${titleAttr} class="external-link" target="_blank" rel="noopener noreferrer">${text}</a>`
        },
        image({ href, title, text }) {
          const source = escapeAttribute(href)
          const src = remoteImageSource(href) ? ` src="${source}"` : ""
          const titleAttr = title ? ` title="${escapeAttribute(title)}"` : ""
          return `<img${src} data-markdown-image-src="${source}" alt="${escapeAttribute(text)}"${titleAttr}>`
        },
      },
    },
    katexExtension,
    markedShiki({ highlight }),
  )
}

const inlineParenMathRegex = /^\\\(((?:\\.|[^\\\n])*?)\\\)/
const inlineDollarMathRegex = /^\$(?!\$|\s)((?:\\.|[^\\$\n])+?)(?<!\s)\$(?!\$)/
const inlineDisplayDollarMathRegex = /^\$\$([^\n]+?)\$\$/
const inlineDisplayBracketMathRegex = /^\\\[([^\n]+?)\\\]/
const blockDollarMathRegex = /^\$\$[ \t]*\n([\s\S]+?)\n[ \t]*\$\$(?:\n|$)/
const blockBracketMathRegex = /^\\\[[ \t]*\n([\s\S]+?)\n[ \t]*\\\](?:\n|$)/

const katexExtension: MarkedExtension = {
  extensions: [
    {
      name: "inlineKatex",
      level: "inline",
      start(src) {
        const indexes = [src.indexOf("\\("), src.search(/(?<!\\)\$(?!\$)/)].filter((index) => index >= 0)
        if (indexes.length === 0) return undefined
        return Math.min(...indexes)
      },
      tokenizer(src) {
        const match = src.match(inlineParenMathRegex) ?? src.match(inlineDollarMathRegex)
        if (!match) return undefined
        return {
          type: "inlineKatex",
          raw: match[0],
          text: match[1].trim(),
          displayMode: false,
        }
      },
      renderer: renderKatexToken,
    },
    {
      name: "inlineDisplayKatex",
      level: "inline",
      start(src) {
        const indexes = [src.indexOf("$$"), src.indexOf("\\[")].filter((index) => index >= 0)
        if (indexes.length === 0) return undefined
        return Math.min(...indexes)
      },
      tokenizer(src) {
        const match = src.match(inlineDisplayDollarMathRegex) ?? src.match(inlineDisplayBracketMathRegex)
        if (!match) return undefined
        return {
          type: "inlineDisplayKatex",
          raw: match[0],
          text: match[1].trim(),
          displayMode: true,
        }
      },
      renderer: renderKatexToken,
    },
    {
      name: "blockKatex",
      level: "block",
      tokenizer(src) {
        const match = src.match(blockDollarMathRegex) ?? src.match(blockBracketMathRegex)
        if (!match) return undefined
        return {
          type: "blockKatex",
          raw: match[0],
          text: match[1].trim(),
          displayMode: true,
        }
      },
      renderer: renderKatexToken,
    },
  ],
}

function renderKatexToken(token: Tokens.Generic) {
  return katex.renderToString(typeof token.text === "string" ? token.text : "", {
    displayMode: token.displayMode === true,
    throwOnError: false,
  })
}

function remoteImageSource(value: string) {
  return /^(?:https?:|data:|blob:)/i.test(value) || value.startsWith("//")
}

function escapeAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}
