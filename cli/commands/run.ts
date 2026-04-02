import { spawn } from "node-pty";
import { createSession, updateSession } from "../registry.js";
import type { SessionTool } from "../../shared/types.js";

const TOOL_MAP: Record<string, { command: string; toolType: SessionTool }> = {
  codex: { command: "codex", toolType: "codex" },
  claude: { command: "claude", toolType: "claude-code" },
};

export function runCommand(tool: string, args: string[]) {
  const entry = TOOL_MAP[tool];
  if (!entry) {
    console.error(`Unknown tool: ${tool}. Supported: ${Object.keys(TOOL_MAP).join(", ")}`);
    process.exit(1);
  }

  const { command, toolType } = entry;
  const cwd = process.cwd();

  // Register session
  const session = createSession({
    tool: toolType,
    project: cwd,
    pid: process.pid,
  });

  console.log(`🐝 Code Hive tracking: ${tool} [${session.id}]`);

  // Spawn with PTY for full terminal support (TUI apps like codex)
  const pty = spawn(command, args, {
    name: "xterm-256color",
    cols: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
    cwd,
    env: process.env as Record<string, string>,
  });

  // Mark as working
  updateSession(session.id, { status: "working" });

  // Pipe PTY output to stdout
  pty.onData((data) => {
    process.stdout.write(data);
  });

  // Pipe stdin to PTY
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.on("data", (data) => {
    pty.write(data.toString());
  });

  // Handle terminal resize
  process.stdout.on("resize", () => {
    pty.resize(
      process.stdout.columns || 80,
      process.stdout.rows || 24
    );
  });

  // Handle exit
  pty.onExit(({ exitCode }) => {
    updateSession(session.id, { status: "done" });
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.exit(exitCode);
  });

  // Handle signals
  const cleanup = () => {
    updateSession(session.id, { status: "done" });
    pty.kill();
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}
