import { watch } from "node:fs";
import chalk from "chalk";
import { SESSIONS_DIR } from "../../shared/types.js";
import { listSessions, cleanStaleSessions } from "../registry.js";
import { mkdirSync, existsSync } from "node:fs";

export function watchCommand() {
  if (!existsSync(SESSIONS_DIR)) {
    mkdirSync(SESSIONS_DIR, { recursive: true });
  }

  console.log(chalk.bold("🐝 Code Hive — watching sessions...\n"));
  printStatus();

  // Real debounce: cancel previous timer on each event
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  watch(SESSIONS_DIR, { recursive: false }, (_event: string, _filename: string | null) => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      console.clear();
      console.log(chalk.bold("🐝 Code Hive — watching sessions...\n"));
      printStatus();
    }, 200);
  });

  // Periodic stale cleanup every 30s
  setInterval(() => {
    cleanStaleSessions();
  }, 30000);

  console.log(chalk.dim("\nPress Ctrl+C to stop watching."));
}

function printStatus() {
  const sessions = listSessions();

  if (sessions.length === 0) {
    console.log(chalk.dim("  No active sessions."));
    return;
  }

  const order = { waiting: 0, working: 1, stopped: 2, done: 3 } as const;
  sessions.sort((a, b) => order[a.status] - order[b.status]);

  for (const s of sessions) {
    const icon = s.status === "working" ? chalk.green("●")
      : s.status === "waiting" ? chalk.yellow("●")
      : chalk.gray("●");
    const dur = Math.floor((Date.now() - new Date(s.startedAt).getTime()) / 60000);
    const wait = s.waitReason ? chalk.yellow(` ⚠ ${s.waitReason}`) : "";
    console.log(`  ${icon} ${chalk.cyan(s.tool)} · ${chalk.bold(s.projectName)}  ${chalk.dim(dur + "m")}  ${s.status}${wait}`);
  }

  const waitingCount = sessions.filter(s => s.status === "waiting").length;
  if (waitingCount > 0) {
    console.log(chalk.yellow(`\n  ⚠ ${waitingCount} session(s) waiting for your attention!`));
  }
}
