import { app, ipcMain, nativeImage } from "electron";
import { menubar } from "menubar";
import { watch } from "chokidar";
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, unlinkSync, renameSync } from "node:fs";
import { exec, execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const HIVE_DIR = join(app.getPath("home"), ".code-hive");
const SESSIONS_DIR = join(HIVE_DIR, "sessions");
const HISTORY_DIR = join(HIVE_DIR, "history");

mkdirSync(SESSIONS_DIR, { recursive: true });
mkdirSync(HISTORY_DIR, { recursive: true });

interface Session {
  id: string;
  tool: string;
  project: string;
  projectName: string;
  status: string;
  startedAt: string;
  lastActivity: string;
  waitReason?: string;
  tty?: string;
  acknowledged?: boolean;
}

// Validate session ID: only alphanumeric and hyphens
function isValidId(id: string): boolean {
  return /^[a-zA-Z0-9-]+$/.test(id);
}

// Sanitize tty: must match /dev/ttysNNN pattern
function sanitizeTty(tty: string): string | null {
  const match = tty.match(/^\/dev\/ttys\d+$/);
  return match ? match[0] : null;
}

function safeReadJson(filePath: string): Session | null {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function atomicWrite(filePath: string, data: string) {
  const tmp = filePath + ".tmp";
  writeFileSync(tmp, data, "utf-8");
  renameSync(tmp, filePath);
}

function isClaudeOnTty(tty: string): boolean {
  const safeTty = sanitizeTty(tty);
  if (!safeTty) return false;
  try {
    const shortTty = safeTty.replace("/dev/", "");
    execSync(
      `ps -eo tty=,command= | grep "^${shortTty} " | grep -q "claude"`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: 3000 }
    );
    return true;
  } catch {
    return false;
  }
}

// Stale cleanup — run periodically, not on every read
let lastCleanup = 0;
function cleanStaleSessionsIfNeeded() {
  const now = Date.now();
  if (now - lastCleanup < 15000) return; // At most every 15s
  lastCleanup = now;

  if (!existsSync(SESSIONS_DIR)) return;
  const files = readdirSync(SESSIONS_DIR).filter(f => f.endsWith(".json") && !f.endsWith(".tmp"));
  for (const f of files) {
    try {
      const filePath = join(SESSIONS_DIR, f);
      const session = safeReadJson(filePath);
      if (!session) continue;

      let alive = true;
      if (session.tty) {
        alive = isClaudeOnTty(session.tty);
      } else {
        const lastActivity = new Date(session.lastActivity).getTime();
        if (now - lastActivity > 60 * 60 * 1000) alive = false;
      }

      if (!alive) {
        session.status = "done";
        session.lastActivity = new Date().toISOString();
        mkdirSync(HISTORY_DIR, { recursive: true });
        atomicWrite(join(HISTORY_DIR, f), JSON.stringify(session, null, 2));
        try { unlinkSync(filePath); } catch {}
      } else if (session.status === "waiting") {
        // Auto-reset stale waiting: if waiting > 3 min with no update, reset to stopped
        const lastActivity = new Date(session.lastActivity).getTime();
        if (now - lastActivity > 3 * 60 * 1000) {
          session.status = "stopped";
          session.waitReason = undefined;
          session.lastActivity = new Date().toISOString();
          atomicWrite(filePath, JSON.stringify(session, null, 2));
        }
      }
    } catch {}
  }
}

function readSessions(): Session[] {
  cleanStaleSessionsIfNeeded();
  if (!existsSync(SESSIONS_DIR)) return [];
  const files = readdirSync(SESSIONS_DIR).filter(f => f.endsWith(".json") && !f.endsWith(".tmp"));
  return files
    .map(f => safeReadJson(join(SESSIONS_DIR, f)))
    .filter((s): s is Session => s !== null);
}

function readHistory(limit = 5): Session[] {
  if (!existsSync(HISTORY_DIR)) return [];
  const files = readdirSync(HISTORY_DIR).filter(f => f.endsWith(".json") && !f.endsWith(".tmp"));
  return files
    .map(f => safeReadJson(join(HISTORY_DIR, f)))
    .filter((s): s is Session => s !== null)
    .sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime())
    .slice(0, limit);
}

app.whenReady().then(() => {
  app.dock?.hide();

  const indexPath = join(__dirname, "..", "..", "renderer", "index.html");

  ipcMain.handle("get-sessions", () => {
    return { sessions: readSessions(), history: readHistory() };
  });

  // Acknowledge: validate session ID, atomic write
  ipcMain.handle("acknowledge", (_event, sessionId: string) => {
    if (!isValidId(sessionId)) return;
    const filePath = join(SESSIONS_DIR, `${sessionId}.json`);
    const session = safeReadJson(filePath);
    if (session) {
      session.acknowledged = true;
      atomicWrite(filePath, JSON.stringify(session, null, 2));
    }
  });

  // Open project: sanitize tty for AppleScript, sanitize path for Finder
  ipcMain.handle("open-project", (_event, projectPath: string, tty?: string) => {
    if (tty) {
      const safeTty = sanitizeTty(tty);
      if (!safeTty) return;
      const script = `tell application "iTerm2"
  activate
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        if tty of s is "${safeTty}" then
          select t
          set index of w to 1
          return "found"
        end if
      end repeat
    end repeat
  end repeat
  return "not_found"
end tell`;
      exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, (_err, stdout) => {
        if (stdout?.trim() === "not_found") {
          exec(`osascript -e 'tell application "iTerm2" to activate'`);
        }
      });
    } else {
      // No tty — open in Finder. Validate path exists.
      if (existsSync(projectPath)) {
        exec(`open ${JSON.stringify(projectPath)}`);
      }
    }
  });

  // nativeImage automatically picks up @2x for Retina displays
  const iconPath = join(__dirname, "..", "..", "renderer", "iconTemplate.png");
  const trayIcon = nativeImage.createFromPath(iconPath);
  trayIcon.setTemplateImage(true);

  const mb = menubar({
    index: `file://${indexPath}`,
    icon: trayIcon,
    preloadWindow: true,
    browserWindow: {
      width: 360,
      height: 460,
      webPreferences: {
        preload: join(__dirname, "..", "..", "electron", "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
      },
      skipTaskbar: true,
      resizable: false,
    },
    showDockIcon: false,
  });

  mb.on("ready", () => {
    console.log("Code Hive menubar ready");

    const watcher = watch(SESSIONS_DIR, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
    });

    // Debounced push: avoid rapid-fire redraws
    let pushTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedPush = () => {
      if (pushTimer) clearTimeout(pushTimer);
      pushTimer = setTimeout(() => {
        const sessions = readSessions();
        const history = readHistory();
        mb.window?.webContents.send("sessions-update", { sessions, history });

        const attentionCount = sessions.filter(s =>
          s.status === "waiting" || (s.status === "stopped" && !s.acknowledged)
        ).length;
        if (mb.tray) {
          mb.tray.setTitle(attentionCount > 0 ? ` ${attentionCount}` : "");
        }
      }, 100);
    };

    watcher.on("add", debouncedPush);
    watcher.on("change", debouncedPush);
    watcher.on("unlink", debouncedPush);

    const historyWatcher = watch(HISTORY_DIR, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
    });
    historyWatcher.on("add", debouncedPush);
    historyWatcher.on("change", debouncedPush);

    // Panel opened: send with forceSort flag
    mb.on("show", () => {
      const sessions = readSessions();
      const history = readHistory();
      mb.window?.webContents.send("sessions-update", { sessions, history, forceSort: true });

      const attentionCount = sessions.filter(s =>
        s.status === "waiting" || (s.status === "stopped" && !s.acknowledged)
      ).length;
      if (mb.tray) {
        mb.tray.setTitle(attentionCount > 0 ? ` ${attentionCount}` : "");
      }
    });
  });
});
