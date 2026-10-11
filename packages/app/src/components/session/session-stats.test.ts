import { describe, expect, test } from "bun:test"
import type { AssistantMessage, Message, Part, Session } from "@opencode-ai/sdk/v2/client"
import { buildSessionStatsLine, formatTokens, type SessionStatsI18n } from "./session-stats"

const en: Record<string, string> = {
  "session.stats.turns.one": "1 turn",
  "session.stats.turns.other": "{{count}} turns",
  "session.stats.steps.one": "1 step",
  "session.stats.steps.other": "{{count}} steps",
  "session.stats.llm": "LLM {{duration}}",
  "session.stats.tools": "tools {{duration}}",
  "session.stats.ttft": "TTFT {{duration}}",
  "session.stats.pp": "PP {{speed}} tok/s",
  "session.stats.tg": "TG {{speed}} tok/s",
  "session.stats.cache": "cache {{percent}}%",
  "session.stats.tokens": "in {{inTok}} · out {{outTok}} tokens",
}

function resolve(text: string, params?: Record<string, string | number | boolean>) {
  if (!params) return text
  return text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(params[key] ?? ""))
}

const i18n: SessionStatsI18n = {
  t: (key, params) => resolve(en[key] ?? key, params),
  plural: (key, count, params) => {
    const category = count === 1 ? "one" : "other"
    return resolve(en[`${key}.${category}`] ?? en[`${key}.other`] ?? `${key}.other`, { ...params, count })
  },
}

function user(id: string): Message {
  return {
    id,
    sessionID: "s1",
    role: "user",
    time: { created: 0 },
  } as unknown as Message
}

function assistant(id: string, overrides?: Partial<AssistantMessage>): Message {
  return {
    id,
    sessionID: "s1",
    role: "assistant",
    time: { created: 1000, completed: 5000 },
    parentID: "u1",
    modelID: "m",
    providerID: "p",
    mode: "default",
    agent: "build",
    path: { cwd: "/w", root: "/r" },
    cost: 0,
    tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 90, write: 10 } },
    ...overrides,
  } as unknown as Message
}

function stepFinish(id: string, messageID: string): Part {
  return {
    id,
    sessionID: "s1",
    messageID,
    type: "step-finish",
    reason: "stop",
    cost: 0,
    tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 90, write: 10 } },
  } as unknown as Part
}

function tool(id: string, messageID: string, start: number, end: number): Part {
  return {
    id,
    sessionID: "s1",
    messageID,
    type: "tool",
    callID: "c1",
    tool: "bash",
    state: { status: "completed", input: {}, output: "ok", title: "bash", metadata: {}, time: { start, end } },
  } as unknown as Part
}

describe("components.session.session-stats", () => {
  test("formatTokens compacts counts", () => {
    expect(formatTokens(517)).toBe("517")
    expect(formatTokens(12_200)).toBe("12.2K")
    expect(formatTokens(517_000)).toBe("517K")
    expect(formatTokens(1_200_000)).toBe("1.2M")
    expect(formatTokens(89_900_000)).toBe("89.9M")
  })

  test("returns undefined without messages", () => {
    expect(
      buildSessionStatsLine({ messages: [], parts: () => undefined, firstDelta: new Map(), i18n }),
    ).toBeUndefined()
  })

  test("builds the full strip from window, session aggregate, and first-delta samples", () => {
    const message = assistant("a1")
    const parts: Record<string, Part[]> = {
      a1: [stepFinish("p1", "a1"), tool("p2", "a1", 2000, 3500)],
    }
    const session = {
      id: "s1",
      tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 900, write: 10 } },
    } as unknown as Session
    const firstDelta = new Map<string, number>([["a1", 3000]])
    const line = buildSessionStatsLine({
      messages: [user("u1"), message],
      parts: (id) => parts[id],
      session,
      firstDelta,
      i18n,
    })
    expect(line).toBe(
      "1 turn · 1 step | LLM 4s · tools 1.5s | TTFT 2s · PP 55.0 tok/s · TG 100 tok/s | cache 89% | in 1K · out 50 tokens",
    )
  })

  test("omits speed group when no first-delta sample exists", () => {
    const message = assistant("a1")
    const line = buildSessionStatsLine({
      messages: [user("u1"), message],
      parts: (id) => (id === "a1" ? [stepFinish("p1", "a1")] : undefined),
      firstDelta: new Map(),
      i18n,
    })
    expect(line).toBe("1 turn · 1 step | LLM 4s | in 200 · out 50 tokens")
  })

  test("reports live TTFT for the in-flight message and excludes it from LLM time and speeds", () => {
    const done = assistant("a1")
    const live = assistant("a2", {
      time: { created: 10_000 },
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    })
    const firstDelta = new Map<string, number>([
      ["a1", 2000],
      ["a2", 12_000],
    ])
    const line = buildSessionStatsLine({
      messages: [user("u1"), done, live],
      parts: (id) => (id === "a1" ? [stepFinish("p1", "a1")] : undefined),
      firstDelta,
      i18n,
    })
    expect(line).toBe("1 turn · 1 step | LLM 4s | TTFT 2s · PP 110 tok/s · TG 16.7 tok/s | in 200 · out 50 tokens")
  })

  test("PP counts only prompt growth over the previous same-model request", () => {
    const prev = assistant("a0", {
      time: { created: 0, completed: 4000 },
      tokens: { input: 90_000, output: 400, reasoning: 0, cache: { read: 0, write: 0 } },
    })
    const next = assistant("a1", { tokens: { input: 90_200, output: 100, reasoning: 0, cache: { read: 0, write: 0 } } })
    const firstDelta = new Map<string, number>([["a1", 3000]])
    const line = buildSessionStatsLine({
      messages: [user("u1"), prev, user("u2"), next],
      parts: () => undefined,
      firstDelta,
      i18n,
    })
    // fresh = 90_200 - 90_000 = 200 over a 2s TTFT -> 100 tok/s (a full-prompt
    // numerator would read 45.1K, inflating the warm-KV prefill speed)
    expect(line).toBe("2 turns · 2 steps | LLM 8s | TTFT 2s · PP 100 tok/s · TG 50.0 tok/s | in 180K · out 500 tokens")
  })

  test("treats a model switch as a cold cache and keeps the full prompt", () => {
    const prev = assistant("a0", {
      time: { created: 0, completed: 4000 },
      tokens: { input: 90_000, output: 400, reasoning: 0, cache: { read: 0, write: 0 } },
    })
    const next = assistant("a1", {
      modelID: "m2",
      tokens: { input: 90_200, output: 100, reasoning: 0, cache: { read: 0, write: 0 } },
    })
    const firstDelta = new Map<string, number>([["a1", 3000]])
    const line = buildSessionStatsLine({
      messages: [user("u1"), prev, user("u2"), next],
      parts: () => undefined,
      firstDelta,
      i18n,
    })
    expect(line).toBe("2 turns · 2 steps | LLM 8s | TTFT 2s · PP 45.1K tok/s · TG 50.0 tok/s | in 180K · out 500 tokens")
  })

  test("excludes provider-reported cache reads from PP", () => {
    const prev = assistant("a0", {
      time: { created: 0, completed: 4000 },
      tokens: { input: 100, output: 400, reasoning: 0, cache: { read: 89_800, write: 100 } },
    })
    const next = assistant("a1", {
      tokens: { input: 200, output: 100, reasoning: 0, cache: { read: 90_000, write: 0 } },
    })
    const firstDelta = new Map<string, number>([["a1", 3000]])
    const line = buildSessionStatsLine({
      messages: [user("u1"), prev, user("u2"), next],
      parts: () => undefined,
      firstDelta,
      i18n,
    })
    // totalNow = input + cache.write = 200; the 90K cache read stays excluded
    expect(line).toBe("2 turns · 2 steps | LLM 8s | TTFT 2s · PP 100 tok/s · TG 50.0 tok/s | in 180K · out 500 tokens")
  })

  test("falls back to assistant message count when no step-finish parts exist", () => {
    const message = assistant("a1")
    const line = buildSessionStatsLine({
      messages: [user("u1"), message],
      parts: () => [tool("p2", "a1", 1000, 2000)],
      firstDelta: new Map(),
      i18n,
    })
    expect(line).toBe("1 turn · 1 step | LLM 4s · tools 1s | in 200 · out 50 tokens")
  })
})
