import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, unlinkSync, renameSync } from "node:fs";
import { join, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { Session, SessionStatus, SessionTool, SESSIONS_DIR, HISTORY_DIR } from "../shared/types.js";

// Validate session ID: only alphanumeric and hyphens
function isValidId(id: string): boolean {
  return /^[a-zA-Z0-9-]+$/.test(id);
}

function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function sessionPath(id: string): string {
  if (!isValidId(id)) throw new Error(`Invalid session ID: ${id}`);
  return join(SESSIONS_DIR, `${id}.json`);
}

function atomicWrite(filePath: string, data: string) {
  const tmp = filePath + ".tmp";
  writeFileSync(tmp, data, "utf-8");
  renameSync(tmp, filePath);
}

function safeReadJson(filePath: string): Session | null {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

export function createSession(opts: {
  tool: SessionTool;
  project: string;
  sessionName?: string;
  pid?: number;
}): Session {
  ensureDir(SESSIONS_DIR);
  const now = new Date().toISOString();
  const session: Session = {
    id: randomUUID().slice(0, 8),
    tool: opts.tool,
    project: opts.project,
    projectName: opts.project.split("/").pop() || opts.project,
    status: "working",
    sessionName: opts.sessionName,
    startedAt: now,
    lastActivity: now,
    pid: opts.pid,
  };
  atomicWrite(sessionPath(session.id), JSON.stringify(session, null, 2));
  return session;
}

export function updateSession(id: string, updates: Partial<Pick<Session, "status" | "lastActivity" | "waitReason" | "sessionName">>) {
  if (!isValidId(id)) return null;
  const filePath = sessionPath(id);

  const session = safeReadJson(filePath);
  if (!session) return null;

  Object.assign(session, updates, { lastActivity: new Date().toISOString() });

  try {
    if (updates.status === "done") {
      ensureDir(HISTORY_DIR);
      atomicWrite(join(HISTORY_DIR, `${id}.json`), JSON.stringify(session, null, 2));
      try { unlinkSync(filePath); } catch {}
    } else {
      atomicWrite(filePath, JSON.stringify(session, null, 2));
    }
  } catch {
    return null;
  }
  return session;
}

export function getSession(id: string): Session | null {
  if (!isValidId(id)) return null;
  return safeReadJson(sessionPath(id));
}

export function listSessions(): Session[] {
  ensureDir(SESSIONS_DIR);
  const files = readdirSync(SESSIONS_DIR).filter(f => f.endsWith(".json") && !f.endsWith(".tmp"));
  return files
    .map(f => safeReadJson(join(SESSIONS_DIR, f)))
    .filter((s): s is Session => s !== null);
}

export function listHistory(limit = 10): Session[] {
  ensureDir(HISTORY_DIR);
  const files = readdirSync(HISTORY_DIR).filter(f => f.endsWith(".json") && !f.endsWith(".tmp"));
  return files
    .map(f => safeReadJson(join(HISTORY_DIR, f)))
    .filter((s): s is Session => s !== null)
    .sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime())
    .slice(0, limit);
}

// Sanitize tty: must match /dev/ttysNNN pattern
function sanitizeTty(tty: string): string | null {
  const match = tty.match(/^\/dev\/ttys\d+$/);
  return match ? match[0] : null;
}

function isClaudeOnTty(tty: string): boolean {
  const safeTty = sanitizeTty(tty);
  if (!safeTty) return false;
  try {
    const shortTty = safeTty.replace("/dev/", "");
    const result = execSync(
      `ps -eo tty=,command= | grep "^${shortTty} " | grep -q "claude"`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: 3000 }
    );
    return true;
  } catch {
    return false;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function cleanStaleSessions() {
  for (const session of listSessions()) {
    let alive = true;

    if (session.tty) {
      alive = isClaudeOnTty(session.tty);
    } else if (session.pid) {
      alive = isProcessAlive(session.pid);
    } else {
      const lastActivity = new Date(session.lastActivity).getTime();
      if (Date.now() - lastActivity > 60 * 60 * 1000) {
        alive = false;
      }
    }

    if (!alive) {
      updateSession(session.id, { status: "done" });
    } else if (session.status === "waiting") {
      // Auto-reset stale waiting: if waiting > 3 min with no update, reset to stopped
      const lastActivity = new Date(session.lastActivity).getTime();
      if (Date.now() - lastActivity > 3 * 60 * 1000) {
        updateSession(session.id, { status: "stopped", waitReason: undefined });
      }
    }
  }
}
