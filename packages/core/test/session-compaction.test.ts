import { expect, test } from "bun:test"
import { SessionCompaction } from "@opencode-ai/core/session/compaction"

test("compaction prompt preserves detailed work state and relevant files", () => {
  const prompt = SessionCompaction.buildPrompt({ context: ["conversation history"] })

  expect(prompt).toStartWith(
    "以下是到目前为止的对话：\n\n<conversation>\nconversation history\n</conversation>",
  )
  expect(prompt.indexOf("</conversation>")).toBeLessThan(prompt.indexOf("创建一个新的、带锚点的摘要"))
  expect(prompt).toContain("根据上方 <conversation> 标签中的对话历史")
  expect(prompt).toContain("## 工作状态\n### 已完成")
  expect(prompt).toContain("### 进行中")
  expect(prompt).toContain("### 受阻")
  expect(prompt).toContain("## 相关文件")
})

test("compaction prompt gives update instructions for a prior summary", () => {
  const prompt = SessionCompaction.buildPrompt({
    context: ["new conversation"],
    previousSummary: "existing summary",
  })

  expect(prompt.indexOf("<conversation>")).toBeLessThan(prompt.indexOf("<prior-summary>"))
  expect(prompt.indexOf("</prior-summary>")).toBeLessThan(prompt.indexOf("<prior-summary> 概括了"))
  expect(prompt).toContain(
    "即使 <conversation> 没有提及，也要从 <prior-summary> 中保留目标、约束、用户指令、决定和并行工作流",
  )
  expect(prompt).toContain('把已完成的工作从"进行中"移到"已完成"。')
  expect(prompt).toContain('更新"目标"和"下一步"以反映当前的工作状态。')
})

test("compaction describes tool media without embedding base64", () => {
  const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"
  const serialized = SessionCompaction.serializeToolContent([
    { type: "text", text: "Image read successfully" },
    {
      type: "file",
      uri: `data:image/png;base64,${base64}`,
      mime: "image/png",
      name: "pixel.png",
    },
  ])

  expect(serialized).toBe("Image read successfully\n[Attached image/png: pixel.png]")
  expect(serialized).not.toContain(base64)
})
