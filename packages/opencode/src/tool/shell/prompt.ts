import { Schema } from "effect"
import DESCRIPTION from "./shell.txt"
import { PositiveInt } from "@opencode-ai/core/schema"
import { Global } from "@opencode-ai/core/global"
import { ShellID } from "./id"

const PS = new Set(["powershell", "pwsh"])
const CMD = new Set(["cmd"])

export type Limits = {
  maxLines: number
  maxBytes: number
}

export function parameterSchema() {
  return Schema.Struct({
    command: Schema.String.annotate({ description: "要执行的命令" }),
    timeout: Schema.optional(PositiveInt).annotate({ description: "可选的超时时间（毫秒）" }),
    workdir: Schema.optional(Schema.String).annotate({
      description: `运行命令的工作目录。默认为当前目录，需要时请使用该参数代替在命令内写 'cd'。`,
    }),
  })
}

export const Parameters = parameterSchema()
export type Parameters = Schema.Schema.Type<typeof Parameters>

function renderPrompt(template: string, values: Record<string, string>) {
  return template.replace(/\$\{(\w+)\}/g, (_, key: string) => {
    const value = values[key]
    if (value === undefined) throw new Error(`Missing shell prompt value: ${key}`)
    return value
  })
}

function shellDisplayName(name: string) {
  if (name === "pwsh") return "PowerShell (7+)"
  if (name === "powershell") return "Windows PowerShell (5.1)"
  if (name === "cmd") return "cmd.exe"
  return name
}

const ENCODING_RULES = `# 编码安全
- PowerShell 的文件 cmdlet 默认编码与文件实际编码错配时会静默损坏文件（编码翻转、BOM 注入、孤立字节丢失），覆写后无法恢复；\`Get-Content\` 默认按 ANSI/CP936 解读无 BOM 的 UTF-8 文件。
- 禁止在 shell 中修改或生成文本文件内容：不用 Set-Content、Out-File、\`>\` 重定向、here-string 写文件，不用 \`(Get-Content ...)\` 管道改写文件。
- 修改/创建文件内容一律用 edit / write 工具（UTF-8 无 BOM，字节精确）。
- 确需在 shell 读写文件：读用 \`[IO.File]::ReadAllText($path)\`（自动 BOM 检测）；写用 \`[IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding $false))\`（UTF-8 无 BOM）。`

const EXECUTION_RULES = (timeoutMs: number) => `# 执行与等待
- 单条命令只做一件事、尽快产生输出；避免在一次调用里写长多行脚本（遍历大量文件、对大文件做正则等）。重活拆成多条小命令，或收窄范围（-Path/-Depth 限定范围，用 Glob/Grep 替代递归扫描）。
- 不指定超时的命令将在 ${timeoutMs}ms 后超时。慢任务（编译、全量测试、网络下载、递归扫描）请自行传入合适的 timeout；宁可多条快命令，不要一条命令静默等到超时。
- 可能等待交互输入的命令（ssh、openssl、首次初始化等）必须加非交互参数（-o BatchMode=yes、-y、--no-input 等），否则会无输出挂到超时。
- 命令无输出或报错时先分析原因修正写法，不要盲目重跑同一条命令。
# 转义
- 字面量优先用单引号；只有需要变量插值/命令替换才用双引号；PowerShell 避免用反引号转义引号、$、反斜杠。
- 写文件/长文本用 edit / write 工具（字节精确、无转义问题）；shell 只用来执行程序。`

function powershellNotes(name: string) {
  if (name === "pwsh") {
    return `# PowerShell (7+) shell 注意事项
- 该跨平台 shell 支持管道链操作符（\`&&\` 和 \`||\`）。
- 插值字符串用双引号（\`"Hello $name"\`），原样字符串用单引号。
- 优先用完整 cmdlet 名称（如 \`Get-ChildItem\`、\`Set-Content\`、\`Remove-Item\`、\`New-Item\`），不要用别名。
- 子表达式用 \`$(...)\`，数组表达式用 \`@(...)\`。
- 调用路径含空格的原生可执行文件时用调用运算符：\`& "path/to/exe" args\`。
- 用反引号字符转义特殊字符。
${ENCODING_RULES}`
  }
  if (name === "powershell") {
    return `# Windows PowerShell (5.1) shell 注意事项
- 用 \`cmd1; if ($?) { cmd2 }\` 链接有依赖的命令。
- 插值字符串用双引号（\`"Hello $name"\`），原样字符串用单引号。
- 优先用完整 cmdlet 名称（如 \`Get-ChildItem\`、\`Set-Content\`、\`Remove-Item\`、\`New-Item\`），不要用别名。
- 子表达式用 \`$(...)\`，数组表达式用 \`@(...)\`。
- 调用路径含空格的原生可执行文件时用调用运算符：\`& "path/to/exe" args\`。
- 用反引号字符转义特殊字符。
${ENCODING_RULES}`
  }
  return ""
}

function chainGuidance(name: string) {
  if (name === "powershell") {
    return "如果命令之间有依赖、必须顺序执行，由于 Windows PowerShell (5.1) 不支持 '&&'，请改用 PowerShell 条件式，如 `cmd1; if ($?) { cmd2 }`，让后续命令依赖前面的成功。"
  }
  if (PS.has(name)) {
    return "如果命令之间有依赖、必须顺序执行，请在一次 bash 工具调用中用 '&&' 把它们链接起来（例如 `git add . && git commit -m \"message\" && git push`）。例如某操作必须在另一操作开始前完成（如 New-Item 在 Copy-Item 之前、写文件在 git 操作之前、git add 在 git commit 之前），就按顺序执行这些操作。"
  }
  if (CMD.has(name)) {
    return "如果命令之间有依赖、必须顺序执行，请在一次 bash 工具调用中用 `&&` 把它们链接起来（例如 `mkdir out && dir out`）。如果某操作必须在另一操作开始前完成，就按顺序执行这些操作。"
  }
  return "如果命令之间有依赖、必须顺序执行，请在一次 Bash 调用中用 '&&' 把它们链接起来（例如 `git add . && git commit -m \"message\" && git push`）。例如某操作必须在另一操作开始前完成（如 mkdir 在 cp 之前、写文件在 git 操作之前、git add 在 git commit 之前），就按顺序执行这些操作。"
}

function bashCommandSection(chain: string, limits: Limits, defaultTimeoutMs: number) {
  return `执行命令前，请遵循以下步骤：

1. 目录确认：
   - 如果命令会创建新目录或新文件，先用 \`ls\` 确认父目录存在且位置正确
   - 例如，运行 "mkdir foo/bar" 之前，先用 \`ls foo\` 检查 "foo" 存在且是预期的父目录

2. 命令执行：
   - 含空格的文件路径始终用双引号包裹（例如 rm "path with spaces/file.txt"）
   - 正确引号的示例：
     - mkdir "/Users/name/My Documents"（正确）
     - mkdir /Users/name/My Documents（错误 - 会失败）
     - python "/path/with spaces/script.py"（正确）
     - python /path/with spaces/script.py（错误 - 会失败）
   - 确保引号正确后执行命令。
   - 捕获命令的输出。

用法说明：
  - command 参数必填。
  - 可以指定可选的超时时间（毫秒）。不指定时，命令将在 ${defaultTimeoutMs}ms 后超时。
  - 如果输出超过 ${limits.maxLines} 行或 ${limits.maxBytes} 字节，会被截断，完整输出会写入文件。可以用 Read 的 offset/limit 读取指定区段，或用 Grep 搜索完整内容。不要用 \`head\`、\`tail\` 或其他截断命令限制输出；完整输出已经写入文件，便于更精确地搜索。

  - 除非明确指示或任务确实需要，避免用 Bash 执行 \`find\`、\`grep\`、\`cat\`、\`head\`、\`tail\`、\`sed\`、\`awk\` 或 \`echo\` 命令；这些操作优先使用专门的工具：
    - 查找文件：用 Glob（不用 find 或 ls）
    - 搜索内容：用 Grep（不用 grep 或 rg）
    - 读文件：用 Read（不用 cat/head/tail）
    - 编辑文件：用 Edit（不用 sed/awk）
    - 写文件：用 Write（不用 echo >/cat <<EOF）
    - 与用户交流：直接输出文本（不用 echo/printf）
  - 一次发出多条命令时：
    - 如果命令互相独立、可以并行，就在一条消息里发出多个 bash 工具调用。例如需要运行 "git status" 和 "git diff"，就在一条消息里发两个并行的 bash 调用。
    - ${chain}
    - 只有在需要顺序执行且不关心前面命令是否失败时才用 ';'
    - 不要用换行分隔命令（引号字符串内的换行可以）
  - 避免使用 \`cd <directory> && <command>\`，改用 \`workdir\` 参数切换目录。
    <good-example>
    workdir="/foo/bar" + command: pytest tests
    </good-example>
    <bad-example>
    cd /foo/bar && pytest tests
    </bad-example>
${EXECUTION_RULES(defaultTimeoutMs)}`
}

function powershellCommandSection(
  name: string,
  chain: string,
  pathSep: string,
  limits: Limits,
  defaultTimeoutMs: number,
) {
  return `${powershellNotes(name)}

执行命令前，请遵循以下步骤：

1. 目录确认：
   - 如果命令会创建新目录或新文件，先用 \`Test-Path -LiteralPath <父目录>\` 确认父目录存在且位置正确
   - 例如，创建 \`foo${pathSep}bar\` 之前，先用 \`Test-Path -LiteralPath "foo"\` 检查 \`foo\` 存在且是预期的父目录

2. 命令执行：
   - 含空格的文件路径始终用双引号包裹（例如 Remove-Item -LiteralPath "path with spaces${pathSep}file.txt"）
   - 正确引号的示例：
     - New-Item -ItemType Directory -Path "My Documents"（正确）
     - New-Item -ItemType Directory -Path My Documents（错误 - 路径被拆开）
     - & "path with spaces${pathSep}script.ps1"（正确）
     - path with spaces${pathSep}script.ps1（错误 - 路径被拆开且未被调用）
   - 确保引号正确后执行命令。
   - 捕获命令的输出。

用法说明：
  - command 参数必填。
  - 可以指定可选的超时时间（毫秒）。不指定时，命令将在 ${defaultTimeoutMs}ms 后超时。
  - 如果输出超过 ${limits.maxLines} 行或 ${limits.maxBytes} 字节，会被截断，完整输出会写入文件。可以用 Read 的 offset/limit 读取指定区段，或用 Grep 搜索完整内容。不要用 \`Select-Object -First\`、\`Select-Object -Last\` 或其他截断命令限制输出；完整输出已经写入文件，便于更精确地搜索。

  - 除非明确指示或任务确实需要，避免用 Shell 执行 PowerShell 的文件/内容 cmdlet；这些操作优先使用专门的工具：
    - 查找文件：用 Glob（不用 Get-ChildItem）
    - 搜索内容：用 Grep（不用 Select-String）
    - 读文件：用 Read（不用 Get-Content）
    - 编辑文件：用 Edit（不用 Set-Content）
    - 写文件：用 Write（不用 Set-Content/Out-File 或 here-string）
    - 与用户交流：直接输出文本（不用 Write-Output/Write-Host）
  - 一次发出多条命令时：
    - 如果命令互相独立、可以并行，就在一条消息里发出多个 bash 工具调用。例如需要运行 "git status" 和 "git diff"，就在一条消息里发两个并行的 bash 调用。
    - ${chain}
    - 只有在需要顺序执行且不关心前面命令是否失败时才用 \`;\`
    - 不要用换行分隔命令（引号字符串内的换行可以）
  - 不要在命令内部切换目录，改用 \`workdir\` 参数。
    <good-example>
    workdir="project${pathSep}subdir" + command: pytest tests
    </good-example>
    <bad-example>
      ${name === "powershell" ? `Set-Location -LiteralPath "project${pathSep}subdir"; if ($?) { pytest tests }` : `Set-Location -LiteralPath "project${pathSep}subdir" && pytest tests`}
      </bad-example>
${EXECUTION_RULES(defaultTimeoutMs)}`
}

function cmdCommandSection(chain: string, limits: Limits, defaultTimeoutMs: number) {
  return `# cmd.exe shell 注意事项
- 含空格的路径用双引号包裹。
- 环境变量用 %VAR%。
- 存在性检查用 \`if exist\`。
- 在批处理风格命令中调用批处理文件时用 \`call\`。

执行命令前，请遵循以下步骤：

1. 目录确认：
   - 如果命令会创建新目录或新文件，先用 \`if exist\` 确认父目录存在且位置正确
   - 例如，创建 \`foo\\bar\` 之前，先用 \`if exist "foo\\" dir "foo"\` 检查 \`foo\` 存在且是预期的父目录

2. 命令执行：
   - 含空格的文件路径始终用双引号包裹（例如 del "path with spaces\\file.txt"）
   - 正确引号的示例：
     - mkdir "My Documents"（正确）
     - mkdir My Documents（错误 - 路径被拆开）
     - call "path with spaces\\script.bat"（正确）
     - path with spaces\\script.bat（错误 - 路径被拆开且未被正确调用）
   - 确保引号正确后执行命令。
   - 捕获命令的输出。

用法说明：
  - command 参数必填。
  - 可以指定可选的超时时间（毫秒）。不指定时，命令将在 ${defaultTimeoutMs}ms 后超时。
  - 如果输出超过 ${limits.maxLines} 行或 ${limits.maxBytes} 字节，会被截断，完整输出会写入文件。可以用 Read 的 offset/limit 读取指定区段，或用 Grep 搜索完整内容。不要用 \`more\` 或其他分页命令限制输出；完整输出已经写入文件，便于更精确地搜索。

  - 除非明确指示或任务确实需要，避免用 Shell 执行 cmd.exe 的文件/内容命令；这些操作优先使用专门的工具：
    - 查找文件：用 Glob（不用 dir /s）
    - 搜索内容：用 Grep（不用 findstr）
    - 读文件：用 Read（不用 type）
    - 编辑文件：用 Edit（不用 copy）
    - 写文件：用 Write（不用 echo > 文件）
    - 与用户交流：直接输出文本（不用 echo）
  - 一次发出多条命令时：
    - 如果命令互相独立、可以并行，就在一条消息里发出多个 bash 工具调用。例如需要运行 "dir" 和 "where cmd"，就在一条消息里发两个并行的 bash 调用。
    - ${chain}
    - 只有在需要顺序执行且不关心前面命令是否失败时才用 \`&\`
    - 不要用换行分隔命令（引号字符串内的换行可以）
  - 不要在命令内部切换目录，改用 \`workdir\` 参数。
    <good-example>
    workdir="project\\subdir" + command: dir
    </good-example>
    <bad-example>
    cd /d "project\\subdir" && dir
    </bad-example>
${EXECUTION_RULES(defaultTimeoutMs)}`
}

function profile(name: string, platform: NodeJS.Platform, limits: Limits, defaultTimeoutMs: number) {
  const isPowerShell = PS.has(name)
  const chain = chainGuidance(name)
  if (CMD.has(name)) {
    return {
      intro: `执行给定的 ${shellDisplayName(name)} 命令，支持可选超时，并保证正确的处理与安全性。`,
      workdirSection:
        "所有命令默认在当前工作目录运行。需要到其他目录运行命令时使用 `workdir` 参数。不要在命令内部切换目录 - 改用 `workdir`。",
      commandSection: cmdCommandSection(chain, limits, defaultTimeoutMs),
      gitCommands: "git 命令",
      gitCommandRestriction: "git 命令",
      createPrInstruction: "用临时 body 文件创建 PR，保持 cmd.exe 引号简单。",
      createPrExample: `(\n  echo ## Summary\n  echo - ^<1-3 条要点^>\n) > pr-body.txt\ngh pr create --title "the pr title" --body-file pr-body.txt`,
    }
  }
  if (isPowerShell) {
    return {
      intro: `执行给定的 ${shellDisplayName(name)} 命令，支持可选超时，并保证正确的处理与安全性。`,
      workdirSection:
        "所有命令默认在当前工作目录运行。需要到其他目录运行命令时使用 `workdir` 参数。不要在命令内部切换目录 - 改用 `workdir`。",
      commandSection: powershellCommandSection(
        name,
        chain,
        platform === "win32" ? "\\" : "/",
        limits,
        defaultTimeoutMs,
      ),
      gitCommands: "git 命令",
      gitCommandRestriction: "git 命令",
      createPrInstruction: "用 gh pr create 创建 PR，用 PowerShell here-string 正确传递 body。",
      createPrExample: `gh pr create --title "the pr title" --body @'
## Summary
- <1-3 条要点>
'@`,
    }
  }
  return {
    intro: "在持久 shell 会话中执行给定的 bash 命令，支持可选超时，并保证正确的处理与安全性。",
    workdirSection:
      "所有命令默认在当前工作目录运行。需要到其他目录运行命令时使用 `workdir` 参数。避免使用 `cd <directory> && <command>` 模式 - 改用 `workdir`。",
    commandSection: bashCommandSection(chain, limits, defaultTimeoutMs),
    gitCommands: "bash 命令",
    gitCommandRestriction: "git bash 命令",
    createPrInstruction: "用 gh pr create 按以下格式创建 PR。用 HEREDOC 传递 body 以保证格式正确。",
    createPrExample: `gh pr create --title "the pr title" --body "$(cat <<'EOF'
## Summary
<1-3 条要点>`,
  }
}

export function render(name: string, platform: NodeJS.Platform, limits: Limits, defaultTimeoutMs: number) {
  const selected = profile(name, platform, limits, defaultTimeoutMs)
  return {
    description: renderPrompt(DESCRIPTION, {
      intro: selected.intro,
      os: platform,
      shell: name,
      tmp: Global.Path.tmp,
      workdirSection: selected.workdirSection,
      commandSection: selected.commandSection,
      gitCommands: selected.gitCommands,
      toolName: ShellID.ToolID,
      gitCommandRestriction: selected.gitCommandRestriction,
      createPrInstruction: selected.createPrInstruction,
      createPrExample: selected.createPrExample,
    }),
    parameters: parameterSchema(),
  }
}

export * as ShellPrompt from "./prompt"
