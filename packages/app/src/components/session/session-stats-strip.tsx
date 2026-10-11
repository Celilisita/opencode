import { Show, createMemo } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { useSync } from "@/context/sync"
import { useSessionLayout } from "@/pages/session/session-layout"
import { buildSessionStatsLine, type SessionStatsI18n } from "@/components/session/session-stats"

export function SessionStatsStrip() {
  const sync = useSync()
  const language = useLanguage()
  const sdk = useServerSDK()
  const { params } = useSessionLayout()

  const i18n: SessionStatsI18n = {
    t: (key, params) => language.t(key as Parameters<typeof language.t>[0], params),
    plural: (key, count, params) => language.plural(key as Parameters<typeof language.plural>[0], count, params),
  }

  const line = createMemo(() => {
    const id = params.id
    if (!id) return
    return buildSessionStatsLine({
      messages: sync().data.message[id] ?? [],
      parts: (messageID) => sync().data.part[messageID],
      session: sync().session.get(id),
      firstDelta: sdk().firstDelta,
      i18n,
    })
  })

  return (
    <Show when={line()}>
      <div
        data-component="session-stats-strip"
        class="w-full px-3 py-1 text-center text-11-regular text-text-base select-none pointer-events-none"
      >
        <span class="tabular-nums">{line()}</span>
      </div>
    </Show>
  )
}
