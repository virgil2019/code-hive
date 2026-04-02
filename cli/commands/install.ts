import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, chmodSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { HIVE_DIR } from "../../shared/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLAUDE_SETTINGS_PATH = join(process.env.HOME!, ".claude", "settings.json");
const HOOK_SCRIPT_SRC = join(__dirname, "..", "..", "..", "hooks", "claude-code-hook.sh");
const HOOK_SCRIPT_DEST = join(HIVE_DIR, "bin", "claude-code-hook.sh");

const HOOKS_CONFIG = {
  SessionStart: [
    { matcher: "", hooks: [{ type: "command", command: `${HOOK_SCRIPT_DEST}` }] }
  ],
  Notification: [
    { matcher: "", hooks: [{ type: "command", command: `${HOOK_SCRIPT_DEST}` }] }
  ],
  Stop: [
    { matcher: "", hooks: [{ type: "command", command: `${HOOK_SCRIPT_DEST}`, async: true }] }
  ],
  PreToolUse: [
    { matcher: "", hooks: [{ type: "command", command: `${HOOK_SCRIPT_DEST}` }] }
  ],
  SessionEnd: [
    { matcher: "", hooks: [{ type: "command", command: `${HOOK_SCRIPT_DEST}` }] }
  ],
};

export function installCommand() {
  console.log(chalk.bold("🐝 Installing Code Hive hooks...\n"));

  // 1. Copy hook script to ~/.code-hive/bin/
  const binDir = join(HIVE_DIR, "bin");
  mkdirSync(binDir, { recursive: true });
  copyFileSync(HOOK_SCRIPT_SRC, HOOK_SCRIPT_DEST);
  chmodSync(HOOK_SCRIPT_DEST, 0o755);
  console.log(chalk.green("  ✓") + ` Hook script → ${HOOK_SCRIPT_DEST}`);

  // 2. Create sessions & history dirs
  mkdirSync(join(HIVE_DIR, "sessions"), { recursive: true });
  mkdirSync(join(HIVE_DIR, "history"), { recursive: true });
  console.log(chalk.green("  ✓") + ` Data dirs → ${HIVE_DIR}/sessions/, history/`);

  // 3. Merge hooks into Claude Code settings
  let settings: Record<string, unknown> = {};
  if (existsSync(CLAUDE_SETTINGS_PATH)) {
    settings = JSON.parse(readFileSync(CLAUDE_SETTINGS_PATH, "utf-8"));
  } else {
    mkdirSync(join(process.env.HOME!, ".claude"), { recursive: true });
  }

  const existingHooks = (settings.hooks || {}) as Record<string, unknown[]>;

  // Merge: add our hooks alongside existing ones
  for (const [event, config] of Object.entries(HOOKS_CONFIG)) {
    const existing = existingHooks[event] || [];
    // Check if we already installed (avoid duplicates)
    const alreadyInstalled = existing.some((entry: any) =>
      entry.hooks?.some((h: any) => h.command?.includes("claude-code-hook.sh"))
    );
    if (!alreadyInstalled) {
      existingHooks[event] = [...existing, ...config];
    }
  }

  settings.hooks = existingHooks;
  // Atomic write to avoid corrupting settings on crash
  const tmp = CLAUDE_SETTINGS_PATH + ".tmp";
  writeFileSync(tmp, JSON.stringify(settings, null, 2));
  renameSync(tmp, CLAUDE_SETTINGS_PATH);
  console.log(chalk.green("  ✓") + ` Hooks added → ${CLAUDE_SETTINGS_PATH}`);

  console.log(chalk.bold("\n✅ Done! Claude Code sessions will now be tracked."));
  console.log(chalk.dim("  Run `hive list` to see active sessions."));
  console.log(chalk.dim("  Run `hive watch` for live monitoring."));
}
