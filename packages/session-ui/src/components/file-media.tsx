import type { FileContent } from "@opencode-ai/sdk/v2"
import { createEffect, createMemo, Match, on, onCleanup, Show, Switch, untrack, type JSX } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useI18n } from "@opencode-ai/ui/context/i18n"
import { Icon } from "@opencode-ai/ui/icon"
import {
  dataUrlFromMediaValue,
  hasMediaValue,
  isBinaryContent,
  mediaKindFromPath,
  normalizeMimeType,
  previewKindFromPath,
  svgTextFromValue,
} from "../pierre/media"
import { DocxPreview } from "./docx-preview"

export type FileMediaOptions = {
  mode?: "auto" | "off"
  path?: string
  current?: unknown
  before?: unknown
  after?: unknown
  deleted?: boolean
  readFile?: (path: string) => Promise<FileContent | undefined>
  openWithSystem?: (path: string) => void | Promise<void>
  onLoad?: () => void
  onError?: (ctx: { kind: "image" | "audio" | "svg" | "pdf" | "docx" }) => void
}

function mediaValue(cfg: FileMediaOptions, mode: "image" | "audio") {
  if (cfg.current !== undefined) return cfg.current
  if (mode === "image") return cfg.after ?? cfg.before
  return cfg.after ?? cfg.before
}

export function FileMedia(props: { media?: FileMediaOptions; fallback: () => JSX.Element }) {
  const i18n = useI18n()
  const [remote, setRemote] = createStore<{
    key?: string
    loading?: boolean
    error?: boolean
    src?: string
    mime?: string
  }>({})
  const cfg = () => props.media
  const kind = createMemo(() => {
    const media = cfg()
    if (!media || media.mode === "off") return
    return mediaKindFromPath(media.path)
  })

  const isBinary = createMemo(() => {
    const media = cfg()
    if (!media || media.mode === "off") return false
    if (kind()) return false
    return isBinaryContent(media.current as any)
  })

  const onLoad = () => props.media?.onLoad?.()

  const deleted = createMemo(() => {
    const media = cfg()
    const k = kind()
    if (!media || !k) return false
    if (media.deleted) return true
    if (k === "svg") return false
    if (media.current !== undefined) return false
    return !hasMediaValue(media.after as any) && hasMediaValue(media.before as any)
  })

  const direct = createMemo(() => {
    const media = cfg()
    const k = kind()
    if (!media || (k !== "image" && k !== "audio")) return
    return dataUrlFromMediaValue(mediaValue(media, k), k)
  })

  const request = createMemo(() => {
    const media = cfg()
    const k = kind()
    if (!media || (k !== "image" && k !== "audio")) return
    if (media.current !== undefined) return
    if (deleted()) return
    if (direct()) return
    if (!media.path || !media.readFile) return

    return {
      key: `${k}:${media.path}`,
      kind: k,
      path: media.path,
      readFile: media.readFile,
      onError: media.onError,
    }
  })

  createEffect(() => {
    const input = request()
    if (!input) {
      setRemote({ key: undefined, loading: false, error: false, src: undefined, mime: undefined })
      return
    }

    let active = true
    // Keep the previous media visible while re-reading the same file (e.g. a vcs
    // diff refresh); only a key change resets to the loading placeholder.
    if (untrack(() => remote.key) === input.key) setRemote({ loading: true, error: false })
    else setRemote({ key: input.key, loading: true, error: false, src: undefined, mime: undefined })
    void input.readFile(input.path).then(
      (result) => {
        if (!active) return
        const src = dataUrlFromMediaValue(result as any, input.kind)
        if (!src) {
          input.onError?.({ kind: input.kind })
          setRemote({ key: input.key, loading: false, error: true, src: undefined, mime: undefined })
          return
        }

        setRemote({
          key: input.key,
          loading: false,
          error: false,
          src,
          mime: input.kind === "audio" ? normalizeMimeType(result?.mimeType) : undefined,
        })
      },
      () => {
        if (!active) return
        input.onError?.({ kind: input.kind })
        setRemote({ key: input.key, loading: false, error: true, src: undefined, mime: undefined })
      },
    )

    onCleanup(() => {
      active = false
    })
  })

  const src = createMemo(() => {
    const input = request()
    if (!input || remote.key !== input.key || remote.error) return direct()
    return direct() ?? remote.src
  })
  const status = createMemo(() => {
    if (direct()) return "ready" as const
    const input = request()
    if (!input) return "idle" as const
    if (remote.key !== input.key || remote.loading) return "loading" as const
    if (remote.error) return "error" as const
    if (src()) return "ready" as const
    return "idle" as const
  })
  const audioMime = createMemo(() => {
    const input = request()
    if (!input || remote.key !== input.key) return
    return remote.mime
  })

  const svgSource = createMemo(() => {
    const media = cfg()
    if (!media || kind() !== "svg") return
    return svgTextFromValue(media.current as any)
  })
  const svgSrc = createMemo(() => {
    const media = cfg()
    if (!media || kind() !== "svg") return
    return dataUrlFromMediaValue(media.current as any, "svg")
  })
  const svgInvalid = createMemo(() => {
    const media = cfg()
    if (!media || kind() !== "svg") return
    if (svgSource() !== undefined) return
    if (!hasMediaValue(media.current as any)) return
    return [media.path, media.current] as const
  })

  createEffect(
    on(
      svgInvalid,
      (value) => {
        if (!value) return
        cfg()?.onError?.({ kind: "svg" })
      },
      { defer: true },
    ),
  )

  const kindLabel = (value: "image" | "audio" | "pdf" | "docx") => {
    if (value === "image") return i18n.t("ui.fileMedia.kind.image")
    if (value === "audio") return i18n.t("ui.fileMedia.kind.audio")
    return value.toUpperCase()
  }

  const previewKind = createMemo(() => {
    const media = cfg()
    if (!media || media.mode === "off" || !media.path) return
    return previewKindFromPath(media.path)
  })

  const [preview, setPreview] = createStore<{
    key?: string
    loading?: boolean
    error?: boolean
    content?: FileContent
  }>({})

  const previewRequest = createMemo(() => {
    const media = cfg()
    const k = previewKind()
    if (!media || !k) return
    const sync = media.current ?? (k === "pdf" || k === "docx" ? media.after ?? media.before : undefined)
    if (sync !== undefined) return { key: `${k}:direct:${media.path}`, sync: sync as FileContent }
    if (deleted()) return
    if (!media.readFile) return
    const p = media.path
    if (!p) return
    return { key: `${k}:remote:${p}`, path: p, readFile: media.readFile, onError: media.onError }
  })

  createEffect(() => {
    const input = previewRequest()
    if (!input) {
      setPreview({ key: undefined, loading: false, error: false, content: undefined })
      return
    }

    const sync = input.sync
    if (sync !== undefined) {
      setPreview({ key: input.key, loading: false, error: false, content: sync })
      return
    }

    let active = true
    if (untrack(() => preview.key) === input.key) setPreview({ loading: true, error: false })
    else setPreview({ key: input.key, loading: true, error: false, content: undefined })
    void input.readFile(input.path).then(
      (result) => {
        if (!active) return
        if (result === undefined) {
          input.onError?.({ kind: previewKind() === "docx" ? "docx" : "pdf" })
          setPreview({ key: input.key, loading: false, error: true, content: undefined })
          return
        }
        setPreview({ key: input.key, loading: false, error: false, content: result })
      },
      () => {
        if (!active) return
        input.onError?.({ kind: previewKind() === "docx" ? "docx" : "pdf" })
        setPreview({ key: input.key, loading: false, error: true, content: undefined })
      },
    )
    onCleanup(() => {
      active = false
    })
  })

  let pdfUrl: string | undefined
  createEffect(
    on(
      () => {
        if (previewKind() !== "pdf" || untrack(() => preview.content?.type) !== "binary") return
        const value = untrack(() => preview.content?.content)
        return typeof value === "string" && value ? value : undefined
      },
      (base64, dispose) => {
        if (dispose && pdfUrl) {
          URL.revokeObjectURL(pdfUrl)
          pdfUrl = undefined
        }
        if (!base64) return
        const binary = atob(base64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        pdfUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }))
      },
    ),
  )
  onCleanup(() => {
    if (pdfUrl) {
      URL.revokeObjectURL(pdfUrl)
      pdfUrl = undefined
    }
  })

  const openButton = () => {
    const media = cfg()
    if (!media?.openWithSystem || !media.path) return null
    const open = media.openWithSystem
    return (
      <button
        type="button"
        class="mx-auto mt-4 flex items-center gap-2 rounded-md border border-border-base bg-background-base px-3 py-1.5 text-13-regular text-text-strong"
        onClick={() => void open(media.path!)}
      >
        <Icon name="open-file" size="small" />
        {i18n.t("ui.fileMedia.openWithSystem")}
      </button>
    )
  }

  const previewContent = createMemo(() => preview.content)

  return (
    <Switch>
      <Match when={kind() === "image" || kind() === "audio"}>
        <Show
          when={src()}
          fallback={(() => {
            const media = cfg()
            const k = kind()
            if (!media || (k !== "image" && k !== "audio")) return props.fallback()
            const label = kindLabel(k)

            if (deleted()) {
              return (
                <div class="flex min-h-40 items-center justify-center px-6 py-4 text-center text-text-weak">
                  {i18n.t("ui.fileMedia.state.removed", { kind: label })}
                </div>
              )
            }
            if (status() === "loading") {
              return (
                <div class="flex min-h-40 items-center justify-center px-6 py-4 text-center text-text-weak">
                  {i18n.t("ui.fileMedia.state.loading", { kind: label })}
                </div>
              )
            }
            if (status() === "error") {
              return (
                <div class="flex min-h-40 items-center justify-center px-6 py-4 text-center text-text-weak">
                  {i18n.t("ui.fileMedia.state.error", { kind: label })}
                </div>
              )
            }
            return (
              <div class="flex min-h-40 items-center justify-center px-6 py-4 text-center text-text-weak">
                {i18n.t("ui.fileMedia.state.unavailable", { kind: label })}
              </div>
            )
          })()}
        >
          {(value) => {
            const k = kind()
            if (k !== "image" && k !== "audio") return props.fallback()
            if (k === "image") {
              return (
                <div class="flex justify-center bg-background-stronger px-6 py-4">
                  <img
                    src={value()}
                    alt={cfg()?.path}
                    class="max-h-[60vh] max-w-full rounded border border-border-weak-base bg-background-base object-contain"
                    onLoad={onLoad}
                  />
                </div>
              )
            }

            return (
              <div class="flex justify-center bg-background-stronger px-6 py-4">
                <audio class="w-full max-w-xl" controls preload="metadata" onLoadedMetadata={onLoad}>
                  <source src={value()} type={audioMime()} />
                </audio>
              </div>
            )
          }}
        </Show>
      </Match>
      <Match when={kind() === "svg"}>
        {(() => {
          if (svgSource() === undefined && svgSrc() == null) return props.fallback()

          return (
            <div class="flex flex-col gap-4 px-6 py-4">
              <Show when={svgSource() !== undefined}>{props.fallback()}</Show>
              <Show when={svgSrc()}>
                {(value) => (
                  <div class="flex justify-center">
                    <img
                      src={value()}
                      alt={cfg()?.path}
                      class="max-h-[60vh] max-w-full rounded border border-border-weak-base bg-background-base object-contain"
                      onLoad={onLoad}
                    />
                  </div>
                )}
              </Show>
            </div>
          )
        })()}
      </Match>
      <Match when={previewKind()}>
        {(() => {
          const k = previewKind()
          if (!k) return props.fallback()
          const label = kindLabel(k)
          const content = previewContent()

          if (preview.loading) {
            return (
              <div class="flex min-h-60 items-center justify-center px-6 py-4 text-center text-14-regular text-text-weak">
                {i18n.t("ui.fileMedia.state.loading", { kind: label })}
              </div>
            )
          }

          if (preview.error && !content) {
            return (
              <div class="flex min-h-60 flex-col items-center justify-center gap-2 px-6 py-4 text-center">
                <span class="text-14-regular text-text-weak">{i18n.t("ui.fileMedia.state.error", { kind: label })}</span>
                {openButton()}
              </div>
            )
          }

          if (!content) {
            return (
              <div class="flex min-h-60 flex-col items-center justify-center gap-2 px-6 py-4 text-center">
                <span class="text-14-regular text-text-weak">{i18n.t("ui.fileMedia.state.unavailable", { kind: label })}</span>
                {openButton()}
              </div>
            )
          }

          if (k === "pdf") {
            if (!pdfUrl) {
              return (
                <div class="flex min-h-60 flex-col items-center justify-center gap-2 px-6 py-4 text-center">
                  <span class="text-14-regular text-text-weak">{i18n.t("ui.fileMedia.state.unavailable", { kind: label })}</span>
                  {openButton()}
                </div>
              )
            }
            return (
              <div class="docx-pdf-frame flex justify-center bg-background-stronger px-6 py-4">
                <iframe
                  src={pdfUrl}
                  title={cfg()?.path}
                  class="h-[70vh] max-h-[80vh] w-full max-w-4xl rounded border border-border-weak-base bg-white"
                />
              </div>
            )
          }

          return (
            <div class="flex flex-col gap-4 px-4 py-4">
              <DocxPreview
                content={content}
                onError={() => {
                  cfg()?.onError?.({ kind: "docx" })
                  setPreview(
                    produce((draft) => {
                      draft.error = true
                      draft.content = undefined
                    }),
                  )
                }}
              />
            </div>
          )
        })()}
      </Match>
      <Match when={isBinary()}>
        <div class="flex min-h-56 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
          <div class="text-14-semibold text-text-strong">
            {cfg()?.path?.split("/").pop() ?? i18n.t("ui.fileMedia.binary.title")}
          </div>
          <div class="text-14-regular text-text-weak">
            {(() => {
              const path = cfg()?.path
              if (!path) return i18n.t("ui.fileMedia.binary.description.default")
              return i18n.t("ui.fileMedia.binary.description.path", { path })
            })()}
          </div>
          {openButton()}
        </div>
      </Match>
      <Match when={true}>{props.fallback()}</Match>
    </Switch>
  )
}
