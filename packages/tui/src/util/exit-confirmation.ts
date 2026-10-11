import { appendFile, mkdir } from "node:fs/promises"
import path from "node:path"
import { DialogConfirm } from "../ui/dialog-confirm"
import { DialogPrompt } from "../ui/dialog-prompt"
import type { DialogContext } from "../ui/dialog"

export type ExitConfirmationMode = "none" | "confirm" | "note"

// Gates every explicit TUI exit path (typed commands, slash commands, and the
// app.exit keybind) on the configured exit confirmation mode. Returns true when
// the exit should proceed. `none` exits immediately; `confirm` asks first;
// `note` asks and records an optional note to <state>/exit-notes.log.
export async function confirmExit(
  dialog: DialogContext,
  mode: ExitConfirmationMode,
  stateDir: string,
  cwd: string,
): Promise<boolean> {
  if (mode === "none") return true
  const confirmed = await DialogConfirm.show(
    dialog,
    "Exit opencode?",
    mode === "note"
      ? "Leave a note explaining why you're exiting, or cancel."
      : "Are you sure you want to exit opencode?",
  )
  if (!confirmed) return false
  if (mode !== "note") return true
  const note = await DialogPrompt.show(dialog, "Exit note", {
    placeholder: "Reason for exiting (optional)",
  })
  if (note === null) return false
  if (note.trim()) {
    await mkdir(stateDir, { recursive: true })
    await appendFile(
      path.join(stateDir, "exit-notes.log"),
      `${new Date().toISOString()}\t${cwd}\t${note.trim()}\n`,
      "utf8",
    ).catch(() => {})
  }
  return true
}