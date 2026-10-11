import type { FileContent } from "@opencode-ai/sdk/v2"
import DOMPurify from "dompurify"
import { useI18n } from "@opencode-ai/ui/context/i18n"
import { createMemo, createResource, Show } from "solid-js"
import "./docx-preview.css"

type MammothModule = typeof import("mammoth")

const sanitizeConfig = {
  USE_PROFILES: { html: true },
  ADD_ATTR: ["style"],
}

async function loadMammoth(): Promise<MammothModule> {
  const mod = await import("mammoth")
  return (mod as unknown as { default: MammothModule }).default
}

function decodeBase64(value: string): Uint8Array | undefined {
  if (!value) return
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function DocxPreview(props: {
  content: FileContent | undefined
  onError?: () => void
}) {
  const i18n = useI18n()
  const bytes = createMemo(() => {
    const value = props.content
    if (!value || value.type !== "binary") return
    return decodeBase64(value.content)
  })

  const [html] = createResource(bytes, async (value): Promise<string> => {
    if (!value) return ""
    try {
      const mammoth = await loadMammoth()
      const result = await mammoth.convertToHtml(
        { arrayBuffer: (value.buffer as ArrayBufferLike) as ArrayBuffer },
        { includeDefaultStyleMap: true, convertImage: mammoth.images.dataUri },
      )
      return DOMPurify.sanitize(result.value, sanitizeConfig) as string
    } catch {
      props.onError?.()
      return ""
    }
  })

  return (
    <div data-component="docx-preview">
      <Show
        when={html()}
        fallback={
          <div class="flex min-h-60 items-center justify-center text-14-regular text-text-weak">
            {i18n.t("ui.fileMedia.state.loading", { kind: "DOCX" })}
          </div>
        }
      >
        {(value) => {
          if (value().length === 0)
            return (
              <div class="flex min-h-60 items-center justify-center text-14-regular text-text-weak">
                {i18n.t("ui.fileMedia.state.unavailable", { kind: "DOCX" })}
              </div>
            )
          return <div class="docx-preview-content" innerHTML={value()} />
        }}
      </Show>
    </div>
  )
}
