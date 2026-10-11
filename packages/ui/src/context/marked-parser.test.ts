import { expect, test } from "bun:test"
import { createMarkdownParser } from "./marked-parser"

const parser = createMarkdownParser((code, language) => `<pre data-language="${language}">${code}</pre>`)

test("renders links with application attributes", async () => {
  expect(await parser.parse("[OpenCode](https://opencode.ai)")).toBe(
    '<p><a href="https://opencode.ai" class="external-link" target="_blank" rel="noopener noreferrer">OpenCode</a></p>\n',
  )
})

test("renders inline and block math", async () => {
  expect(await parser.parse("\\(x^2\\)")).toContain('<span class="katex">')
  expect(await parser.parse("$x^2$")).toContain('<span class="katex">')
  expect(await parser.parse("before $$x^2$$ after")).toContain('<span class="katex-display">')
  expect(await parser.parse("\\[x^2\\]")).toContain('<span class="katex-display">')
  expect(await parser.parse("$$\nx^2\n$$\n")).toContain('<span class="katex-display">')
  expect(await parser.parse("$$\nA=\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}\n$$\n")).toContain(
    '<span class="katex-display">',
  )
  expect(await parser.parse("The price is \\$5.")).not.toContain('<span class="katex">')
})

test("marks local images for application resolution", async () => {
  expect(await parser.parse("![plot](/tmp/plot.png)")).toContain(
    '<img data-markdown-image-src="/tmp/plot.png" alt="plot">',
  )
  expect(await parser.parse("![plot](file:///tmp/plot.png)")).toContain(
    '<img data-markdown-image-src="file:///tmp/plot.png" alt="plot">',
  )
  expect(await parser.parse("![plot](https://example.com/plot.png)")).toContain(
    '<img src="https://example.com/plot.png" data-markdown-image-src="https://example.com/plot.png" alt="plot">',
  )
})

test("uses the configured code highlighter", async () => {
  expect(await parser.parse("```ts\nconst value = 1\n```\n")).toBe('<pre data-language="ts">const value = 1</pre>\n')
})
