import chalk from "chalk";
import { listSessions, listHistory, cleanStaleSessions } from "../registry.js";
import type { Session, SessionStatus } from "../../shared/types.js";

const STATUS_ICON: Record<SessionStatus, string> = {
  working: chalk.green("●"),
  waiting: chalk.yellow("●"),
  stopped: chalk.gray("●"),
  done: chalk.dim("○"),
};

const STATUS_LABEL: Record<SessionStatus, string> = {
  working: chalk.green("working"),
  waiting: chalk.yellow("waiting"),
  stopped: chalk.gray("stopped"),
  done: chalk.dim("done"),
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function duration(startIso: string): string {
  const diff = Date.now() - new Date(startIso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hours}h${remainMins > 0 ? remainMins + "m" : ""}`;
}

function printSession(s: Session) {
  const icon = STATUS_ICON[s.status];
  const label = STATUS_LABEL[s.status];
  const tool = chalk.cyan(s.tool);
  const project = chalk.bold(s.projectName);
  const dur = s.status === "done" ? timeAgo(s.lastActivity) : duration(s.startedAt);
  const name = s.sessionName ? chalk.dim(` (${s.sessionName})`) : "";
  const wait = s.waitReason ? chalk.yellow(` ⚠ ${s.waitReason}`) : "";

  console.log(`  ${icon} ${tool} · ${project}${name}  ${chalk.dim(dur)}  ${label}${wait}`);
}

export function listCommand(opts: { all?: boolean }) {
  cleanStaleSessions();
  const sessions = listSessions();

  if (sessions.length === 0 && !opts.all) {
    console.log(chalk.dim("  No active sessions."));
    console.log(chalk.dim("  Start a Claude Code session and it will appear here."));
    return;
  }

  if (sessions.length > 0) {
    // Sort: waiting first, then active, then idle
    const order: Record<SessionStatus, number> = { waiting: 0, working: 1, stopped: 2, done: 3 };
    sessions.sort((a, b) => order[a.status] - order[b.status]);

    const waitingCount = sessions.filter(s => s.status === "waiting").length;
    const header = waitingCount > 0
      ? chalk.bold(`Active Sessions`) + chalk.yellow(` (${waitingCount} waiting)`)
      : chalk.bold(`Active Sessions`);
    console.log(`\n${header}\n`);
    sessions.forEach(printSession);
  }

  if (opts.all) {
    const history = listHistory(10);
    if (history.length > 0) {
      console.log(`\n${chalk.bold("Recent History")}\n`);
      history.forEach(printSession);
    }
  }

  console.log();
}
