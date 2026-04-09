import { app, ipcMain, nativeImage, Menu } from "electron";
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

// Check if claude on this tty is actively working (CPU > 2%)
function isClaudeWorking(tty: string): boolean {
  const safeTty = sanitizeTty(tty);
  if (!safeTty) return false;
  try {
    const shortTty = safeTty.replace("/dev/", "");
    const result = execSync(
      `ps -eo tty=,pcpu=,command= | grep "^${shortTty} " | grep "claude"`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: 3000 }
    );
    const match = result.match(/^\s*\S+\s+(\d+\.?\d*)/);
    if (match) {
      return parseFloat(match[1]) > 2.0;
    }
    return false;
  } catch {
    return false;
  }
}


function readSessions(): Session[] {
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

// Single instance lock — prevent multiple apps from running
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.log("Another Code Hive instance is already running.");
  app.quit();
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

  // Load icon - nativeImage auto-picks @2x for Retina
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
      backgroundColor: "#1a1a1a",
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

    // Update badge immediately on startup
    const updateBadge = () => {
      const sessions = readSessions();
      const attentionCount = sessions.filter(s =>
        s.status === "waiting" || (s.status === "stopped" && !s.acknowledged)
      ).length;
      if (mb.tray) {
        mb.tray.setTitle(attentionCount > 0 ? ` ${attentionCount}` : "");
      }
    };
    updateBadge();

    // Right-click context menu on tray icon
    const contextMenu = Menu.buildFromTemplate([
      { label: "Open Code Hive", click: () => mb.showWindow() },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ]);
    mb.tray.on("right-click", () => {
      mb.tray.popUpContextMenu(contextMenu);
    });

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

    // Heartbeat: every 30s
    // 1. Refresh lastActivity for live sessions
    // 2. Fix stale "working" when claude is idle (Ctrl+C)
    // 3. Discover untracked claude processes and create sessions for them
    setInterval(() => {
      if (!existsSync(SESSIONS_DIR)) return;
      let changed = false;

      // Collect tracked ttys
      const files = readdirSync(SESSIONS_DIR).filter(f => f.endsWith(".json") && !f.endsWith(".tmp"));
      const trackedTtys = new Set<string>();

      for (const f of files) {
        try {
          const filePath = join(SESSIONS_DIR, f);
          const session = safeReadJson(filePath);
          if (!session || !session.tty) continue;
          trackedTtys.add(session.tty);

          if (isClaudeOnTty(session.tty)) {
            const now = new Date().toISOString();
            session.lastActivity = now;

            if (session.status === "working" && !isClaudeWorking(session.tty)) {
              session.status = "stopped";
              session.acknowledged = false;
              session.waitReason = undefined;
              changed = true;
            }

            atomicWrite(filePath, JSON.stringify(session, null, 2));
          }
        } catch {}
      }

      // Discover untracked claude processes
      try {
        const psOut = execSync(
          `ps -eo tty=,pid=,command= | grep "^ttys" | grep "claude" | grep -v grep`,
          { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: 5000 }
        );
        for (const line of psOut.trim().split("\n")) {
          const match = line.match(/^\s*(ttys\d+)\s+(\d+)\s+(.+)/);
          if (!match) continue;
          const tty = `/dev/${match[1]}`;
          const pid = parseInt(match[2]);
          if (trackedTtys.has(tty)) continue;

          // Get cwd of this claude process
          try {
            const cwdOut = execSync(
              `lsof -p ${pid} -d cwd -Fn 2>/dev/null | grep "^n/" | head -1`,
              { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: 3000 }
            );
            const cwd = cwdOut.trim().replace(/^n/, "");
            // Skip invalid paths: must be a real project directory (at least 2 levels deep)
            if (!cwd || cwd === "/" || cwd.split("/").filter(Boolean).length < 2) continue;

            const id = pid.toString(16).slice(0, 8);
            const projectName = cwd.split("/").pop() || cwd;
            const now = new Date().toISOString();
            const session: Session = {
              id,
              tool: "claude-code",
              project: cwd,
              projectName,
              status: "stopped",
              startedAt: now,
              lastActivity: now,
              tty,
              acknowledged: true,
            };
            atomicWrite(join(SESSIONS_DIR, `${id}.json`), JSON.stringify(session, null, 2));
            changed = true;
          } catch {}
        }
      } catch {}

      // Cleanup: AFTER refresh, only remove sessions that are truly dead
      // Re-read files since we may have just written new ones
      const allFiles = readdirSync(SESSIONS_DIR).filter(f => f.endsWith(".json") && !f.endsWith(".tmp"));
      const now = Date.now();
      for (const f of allFiles) {
        try {
          const filePath = join(SESSIONS_DIR, f);
          const session = safeReadJson(filePath);
          if (!session) {
            try { unlinkSync(filePath); } catch {}
            changed = true;
            continue;
          }

          const staleHours = (now - new Date(session.lastActivity).getTime()) / (60 * 60 * 1000);
          // Only clean if 24h+ stale AND no claude process on tty
          if (staleHours >= 24 && (!session.tty || !isClaudeOnTty(session.tty))) {
            session.status = "done";
            session.lastActivity = new Date().toISOString();
            mkdirSync(HISTORY_DIR, { recursive: true });
            atomicWrite(join(HISTORY_DIR, f), JSON.stringify(session, null, 2));
            try { unlinkSync(filePath); } catch {}
            changed = true;
          }

          // Auto-reset stale waiting (3 min)
          if (session.status === "waiting" && staleHours * 60 > 3) {
            session.status = "stopped";
            session.waitReason = undefined;
            session.lastActivity = new Date().toISOString();
            atomicWrite(filePath, JSON.stringify(session, null, 2));
            changed = true;
          }
        } catch {}
      }

      if (changed) debouncedPush();
    }, 30 * 1000);

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
