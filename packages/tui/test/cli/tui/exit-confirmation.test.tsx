/** @jsxImportSource @opentui/solid */
import { TextareaRenderable } from "@opentui/core"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { onCleanup, onMount } from "solid-js"
import { tmpdir } from "../../fixture/fixture"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { confirmExit } from "../../../src/util/exit-confirmation"
import type { DialogContext } from "../../../src/ui/dialog"

async function waitResult(fn: () => boolean, timeout = 3000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

async function pump(action: () => void, done: () => boolean): Promise<boolean> {
  for (let i = 0; i < 150; i++) {
    if (done()) return true
    action()
    await Bun.sleep(20)
  }
  return false
}

async function mountGate(
  root: string,
  mode: "none" | "confirm" | "note",
  onResult: (go: boolean) => void,
  cwd: string,
  state: string,
) {
  const { DialogProvider, useDialog } = await import("../../../src/ui/dialog")
  const { KVProvider } = await import("../../../src/context/kv")
  const { ThemeProvider } = await import("../../../src/context/theme")
  const { TuiConfigProvider } = await import("../../../src/config")
  const { ToastProvider } = await import("../../../src/ui/toast")
  const { OpencodeKeymapProvider, registerOpencodeKeymap } = await import("../../../src/keymap")

  await mkdir(state, { recursive: true })
  writeFileSync(path.join(state, "kv.json"), "{}")

  function Gate() {
    const dialog = useDialog()
    onMount(() => {
      void confirmExit(dialog, mode, state, cwd).then(onResult)
    })
    return null
  }

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const resolvedConfig = createTuiResolvedConfig({ leader_timeout: 1000 })
    const off = registerOpencodeKeymap(keymap, renderer, resolvedConfig)
    onCleanup(off)

    return (
      <TestTuiContexts directory={root} paths={{ home: root, state, worktree: root }}>
        <OpencodeKeymapProvider keymap={keymap}>
          <TuiConfigProvider config={resolvedConfig}>
            <KVProvider>
              <ThemeProvider mode="dark">
                <ToastProvider>
                  <DialogProvider>
                    <Gate />
                  </DialogProvider>
                </ToastProvider>
              </ThemeProvider>
            </KVProvider>
          </TuiConfigProvider>
        </OpencodeKeymapProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { kittyKeyboard: true })
  return {
    app,
    async cleanup() {
      app.renderer.destroy()
    },
  }
}

test("exit confirmation none exits immediately without dialog", async () => {
  await using tmp = await tmpdir()
  const state = path.join(tmp.path, "state")
  const results: boolean[] = []
  const gate = await mountGate(tmp.path, "none", (v) => results.push(v), tmp.path, state)
  try {
    await waitResult(() => results.length === 1)
    expect(results).toEqual([true])
  } finally {
    await gate.cleanup()
  }
})

test("exit confirmation confirm proceeds on confirm", async () => {
  await using tmp = await tmpdir()
  const state = path.join(tmp.path, "state")
  const results: boolean[] = []
  const gate = await mountGate(tmp.path, "confirm", (v) => results.push(v), tmp.path, state)
  try {
    const confirmed = await pump(
      () => gate.app.mockInput.pressEnter(),
      () => results.length === 1,
    )
    expect(confirmed).toBe(true)
    expect(results).toEqual([true])
  } finally {
    await gate.cleanup()
  }
})

test("exit confirmation note records a note to exit-notes.log", async () => {
  await using tmp = await tmpdir()
  const state = path.join(tmp.path, "state")
  const logPath = path.join(state, "exit-notes.log")
  const results: boolean[] = []
  const gate = await mountGate(tmp.path, "note", (v) => results.push(v), tmp.path, state)
  try {
    const confirmShown = await pump(
      () => gate.app.mockInput.pressEnter(),
      () => gate.app.renderer.currentFocusedEditor instanceof TextareaRenderable,
    )
    expect(confirmShown).toBe(true)

    const textarea = gate.app.renderer.currentFocusedEditor
    if (!(textarea instanceof TextareaRenderable)) throw new Error("expected focused note textarea")
    for (const ch of "finishing up") gate.app.mockInput.pressKey(ch)

    const submitted = await pump(
      () => gate.app.mockInput.pressEnter(),
      () => results.length === 1,
    )
    expect(submitted).toBe(true)
    expect(results).toEqual([true])

    expect(existsSync(logPath)).toBe(true)
    const content = readFileSync(logPath, "utf8")
    expect(content).toContain("finishing up")
    expect(content).toContain(tmp.path)
  } finally {
    await gate.cleanup()
  }
})

test("exit confirmation cancelled via dialog dismissal does not exit", async () => {
  await using tmp = await tmpdir()
  const state = path.join(tmp.path, "state")
  const logPath = path.join(state, "exit-notes.log")
  const dismisses: (() => void)[] = []
  const dialog = {
    replace: (_content: unknown, dismiss: () => void) => {
      dismisses.push(dismiss)
    },
  } as unknown as DialogContext

  const p1 = confirmExit(dialog, "confirm", state, tmp.path)
  const d1 = dismisses.shift()
  d1?.()
  expect(await p1).toBe(false)

  const p2 = confirmExit(dialog, "note", state, tmp.path)
  const d2 = dismisses.shift()
  d2?.()
  expect(await p2).toBe(false)

  expect(existsSync(logPath)).toBe(false)
})