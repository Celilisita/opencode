import type { AssistantMessage, Message, Part, Session } from "@opencode-ai/sdk/v2/client"

export type SessionStatsI18n = {
  t: (key: string, params?: Record<string, string | number | boolean>) => string
  plural: (key: string, count: number, params?: Record<string, string | number | boolean>) => string
}

function formatDuration(ms: number): string {
  const secs = ms / 1000
  if (secs <= 0) return ""
  const round1 = (value: number) => String(Math.round(value * 10) / 10)
  if (secs < 60) return `${round1(secs)}s`
  if (secs < 3600) {
    const mins = Math.floor(secs / 60)
    const remaining = round1(secs % 60)
    return remaining === "0" ? `${mins}m` : `${mins}m ${remaining}s`
  }
  if (secs < 86400) {
    const hours = Math.floor(secs / 3600)
    const remaining = Math.floor((secs % 3600) / 60)
    return remaining > 0 ? `${hours}h ${remaining}m` : `${hours}h`
  }
  if (secs < 604800) {
    const days = Math.floor(secs / 86400)
    return days === 1 ? "~1 day" : `~${days} days`
  }
  const weeks = Math.floor(secs / 604800)
  return weeks === 1 ? "~1 week" : `~${weeks} weeks`
}

function formatSpeed(tps: number): string {
  if (!Number.isFinite(tps) || tps <= 0) return "0"
  if (tps < 100) return tps.toFixed(1)
  if (tps < 1000) return String(Math.round(tps))
  if (tps < 100000) {
    const value = tps / 1000
    return value >= 100 ? `${Math.round(value)}K` : `${(Math.round(value * 10) / 10)}K`
  }
  const value = tps / 1000000
  return value >= 100 ? `${Math.round(value)}M` : `${(Math.round(value * 10) / 10)}M`
}

export function formatTokens(n: number): string {
  const scaled = (value: number) => (value >= 100 ? String(Math.round(value)) : `${Math.round(value * 10) / 10}`)
  if (!Number.isFinite(n) || n < 0) return "0"
  if (n < 1_000) return String(Math.round(n))
  if (n < 1_000_000) return `${scaled(n / 1_000)}K`
  return `${scaled(n / 1_000_000)}M`
}

export interface SessionStatsInput {
  messages: Message[]
  parts: (messageID: string) => Part[] | undefined
  session?: Session | undefined
  firstDelta: Map<string, number>
  i18n: SessionStatsI18n
}

/**
 * Session-wide stats strip, e.g.
 * `12 turns · 644 steps | LLM 7h 32m · tools 1h 53m | TTFT 15.2s · PP 8.4K tok/s · TG 26.0 tok/s | cache 99% | in 89.9M · out 449K tokens`
 * Token/cache groups prefer the server-side session aggregate (whole session,
 * survives compaction); fall back to the loaded window when the session row
 * has no aggregate. Wall times and turn/step counts fold the loaded window.
 * TTFT/TG/PP need client-side first-token sampling (firstDelta); a message
 * without one simply drops out of those figures. PP only counts fresh prompt
 * tokens (cached prefix excluded), and TG sums per-step output while
 * excluding tool time from the decode window.
 */
export function buildSessionStatsLine(input: SessionStatsInput): string | undefined {
  const { messages, parts, session, firstDelta, i18n } = input
  let llmMs = 0
  let toolMs = 0
  let steps = 0
  let turns = 0
  let assistantCount = 0
  let windowIn = 0
  let windowOut = 0
  let ttftMs = 0
  let ttftSteps = 0
  let ppTps: number | undefined
  let tgTps: number | undefined
  let liveTtftMs: number | undefined

  for (const message of messages) {
    if (message.role === "user") {
      turns += 1
      continue
    }
    if (message.role !== "assistant") continue
    assistantCount += 1
    if (message.time.completed) llmMs += Math.max(0, message.time.completed - message.time.created)
    windowIn += message.tokens.input + message.tokens.cache.read + message.tokens.cache.write
    windowOut += message.tokens.output + message.tokens.reasoning
    for (const part of parts(message.id) ?? []) {
      if (part.type === "step-finish") {
        steps += 1
        continue
      }
      if (part.type !== "tool") continue
      if (part.state.status !== "completed" && part.state.status !== "error") continue
      toolMs += Math.max(0, part.state.time.end - part.state.time.start)
    }
  }

  let lastAssistant: AssistantMessage | undefined
  for (const message of messages) {
    if (message.role !== "assistant") continue
    const prev = lastAssistant
    lastAssistant = message
    const first = firstDelta.get(message.id)
    if (first === undefined) continue
    const ttft = Math.max(0, first - message.time.created)
    if (ttft > 0) {
      ttftMs += ttft
      ttftSteps += 1
    }
    if (!message.time.completed) {
      if (ttft > 0) liveTtftMs = liveTtftMs === undefined ? ttft : liveTtftMs
      continue
    }
    let outTotal = 0
    let msgSteps = 0
    let toolMsMsg = 0
    for (const part of parts(message.id) ?? []) {
      if (part.type === "step-finish") {
        msgSteps += 1
        outTotal += part.tokens.output
        continue
      }
      if (part.type !== "tool") continue
      if (part.state.status !== "completed" && part.state.status !== "error") continue
      toolMsMsg += Math.max(0, part.state.time.end - part.state.time.start)
    }
    if (msgSteps === 0) outTotal = message.tokens.output
    const decodeMs = message.time.completed - first - toolMsMsg
    if (outTotal > 0 && decodeMs > 0) tgTps = outTotal / (decodeMs / 1000)
    // PP counts only fresh prompt work: provider-reported cache reads are
    // excluded, and providers without cache reporting (local engines that keep
    // their own KV cache) fall back to prompt growth over the previous
    // same-model request; any shrink (compaction, model switch) falls back to
    // the full prompt, whose cold prefill makes the TTFT large enough to keep
    // the figure sane.
    const totalNow = message.tokens.input + message.tokens.cache.write
    const prevSameModel =
      prev && prev.providerID === message.providerID && prev.modelID === message.modelID ? prev : undefined
    let promptTokens = totalNow
    if (prevSameModel) {
      const prevTotal = prevSameModel.tokens.input + prevSameModel.tokens.cache.read + prevSameModel.tokens.cache.write
      const fresh = totalNow - prevTotal
      if (fresh > 0) promptTokens = fresh
    }
    if (ttft > 0 && promptTokens > 0) ppTps = promptTokens / (ttft / 1000)
  }

  const groups: string[] = []
  const stepCount = steps > 0 ? steps : assistantCount
  if (stepCount > 0) {
    const lead = turns > 0 ? `${i18n.plural("session.stats.turns", turns)} · ` : ""
    groups.push(`${lead}${i18n.plural("session.stats.steps", stepCount)}`)
    const durations: string[] = []
    if (llmMs > 0) durations.push(i18n.t("session.stats.llm", { duration: formatDuration(llmMs) }))
    if (toolMs > 0) durations.push(i18n.t("session.stats.tools", { duration: formatDuration(toolMs) }))
    if (durations.length > 0) groups.push(durations.join(" · "))
    const speeds: string[] = []
    if (liveTtftMs !== undefined) speeds.push(i18n.t("session.stats.ttft", { duration: formatDuration(liveTtftMs) }))
    else if (ttftSteps > 0) speeds.push(i18n.t("session.stats.ttft", { duration: formatDuration(ttftMs / ttftSteps) }))
    if (ppTps !== undefined) speeds.push(i18n.t("session.stats.pp", { speed: formatSpeed(ppTps) }))
    if (tgTps !== undefined) speeds.push(i18n.t("session.stats.tg", { speed: formatSpeed(tgTps) }))
    if (speeds.length > 0) groups.push(speeds.join(" · "))
  }

  const tokens = session?.tokens
  const inTokens = tokens ? tokens.input + tokens.cache.read + tokens.cache.write : windowIn
  const outTokens = tokens ? tokens.output + tokens.reasoning : windowOut
  if (tokens && inTokens > 0) {
    groups.push(i18n.t("session.stats.cache", { percent: Math.round((tokens.cache.read / inTokens) * 100) }))
  }
  if (inTokens > 0 || outTokens > 0) {
    groups.push(i18n.t("session.stats.tokens", { inTok: formatTokens(inTokens), outTok: formatTokens(outTokens) }))
  }

  if (groups.length === 0) return undefined
  return groups.join(" | ")
}
