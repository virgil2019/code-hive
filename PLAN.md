# Code Hive — AI CLI Session Manager

macOS menubar app for unified management of AI CLI tool sessions (Claude Code, Codex, etc.).

## Core Requirements

1. **Unified visibility** — See all AI CLI session statuses at a glance from the menubar
2. **Desktop notifications** — macOS notifications when a session finishes or awaits input
3. **Session recovery** — Find and restore sessions even after closing the terminal
4. **Recent projects** — Quick overview of what you've been working on

## Architecture

```
┌─────────────────────────────────┐
│       macOS Menubar App         │
│      (Electron + React)         │
│  ┌───────────┐ ┌──────────────┐ │
│  │ Session   │ │ Notifications│ │
│  │ List UI   │ │ (native mac) │ │
│  └─────┬─────┘ └──────┬───────┘ │
│        │               │        │
│  ┌─────┴───────────────┴──────┐ │
│  │  File Watcher (chokidar)   │ │
│  │  ~/.code-hive/sessions/    │ │
│  └────────────────────────────┘ │
└─────────────────────────────────┘
         ▲                    ▲
         │                    │
┌────────┴───────┐  ┌────────┴───────┐
│ Claude Code    │  │ hive CLI       │
│ Hooks          │  │ (wrapper)      │
│ → write JSON   │  │ → wrap codex   │
│   to sessions/ │  │ → write JSON   │
└────────────────┘  └────────────────┘
```

### Three-Layer Architecture

#### Layer 1: Session Registry (Data Layer)

- Directory: `~/.code-hive/sessions/`
- One JSON file per session: `{sessionId}.json`

```jsonc
{
  "id": "abc123",
  "tool": "claude-code",        // claude-code | codex
  "project": "/path/to/project",
  "projectName": "my-app",
  "status": "waiting",          // active | waiting | idle | done
  "sessionName": "auth-refactor",
  "startedAt": "2026-04-01T10:00:00Z",
  "lastActivity": "2026-04-01T10:05:00Z",
  "pid": 12345,                 // Process PID, used to detect if still alive
  "terminal": "iTerm2"          // Terminal info, used for session recovery
}
```

#### Layer 2: Data Collection

**Claude Code — Automatic reporting via Hooks:**
- `PreToolUse` / `PostToolUse` → status = "active"
- `Notification (idle_prompt)` → status = "waiting" (triggers notification)
- `Notification (permission_prompt)` → status = "waiting" (triggers notification)
- `Stop` → status = "idle"
- Session file created on start, marked done on end

**Codex — Via `hive` CLI wrapper:**
- `hive run codex <args>` — Launches codex and monitors its stdout/process status
- Detects waiting patterns in output → updates status
- Process exit → marks done

#### Layer 3: Menubar App (Presentation Layer)

**Electron + menubar + React:**
- Uses the `menubar` npm package, lightweight
- chokidar watches the `~/.code-hive/sessions/` directory for changes
- Real-time session list updates

**UI Design:**
```
┌──────────────────────────────────┐
│ 🐝 Code Hive          3 active  │
├──────────────────────────────────┤
│                                  │
│ 🟢 claude · my-app              │
│   auth-refactor · 15min         │
│                                  │
│ 🟡 claude · backend-api         │
│   ⚠ Waiting for input · 3min    │
│                                  │
│ 🟢 codex · frontend             │
│   running · 8min                 │
│                                  │
├──────────────────────────────────┤
│ Recent Projects                  │
│   my-app          last: 2h ago   │
│   backend-api     last: 1d ago   │
│   frontend        last: 3d ago   │
├──────────────────────────────────┤
│ ⚙ Settings          Quit        │
└──────────────────────────────────┘
```

**Interactions:**
- Click a session → Open/focus its terminal window
- Click a "Waiting" session → Jump directly to it
- Click a recent project → Choose to open a new session with claude/codex
- Menubar icon shows a badge with the number of sessions awaiting attention

## Tech Stack

| Component | Technology | Reason |
|-----------|-----------|--------|
| Menubar App | Electron + menubar + React | TS ecosystem, rapid development |
| Build | electron-builder | Package as .app |
| File Watching | chokidar | Efficient cross-platform file watching |
| Notifications | Electron Notification API | Native macOS notifications |
| CLI Tool | Node.js + commander | `hive` command line |
| Process Monitoring | node child_process + ps-list | Detect session liveness |

## Project Structure

```
code-hive/
├── package.json
├── tsconfig.json
├── electron/                  # Electron main process
│   ├── main.ts                # Entry point, menubar initialization
│   ├── sessions.ts            # Session registry read/write
│   ├── watcher.ts             # chokidar file watching
│   ├── notifications.ts       # macOS notification management
│   └── terminal.ts            # Terminal focus/recovery logic
├── src/                       # React renderer process
│   ├── App.tsx                # Main UI
│   ├── components/
│   │   ├── SessionList.tsx    # Session list
│   │   ├── SessionItem.tsx    # Individual session card
│   │   └── RecentProjects.tsx # Recent projects
│   └── hooks/
│       └── useSessions.ts     # IPC communication hook
├── cli/                       # hive CLI tool
│   ├── index.ts               # CLI entry point
│   ├── commands/
│   │   ├── run.ts             # hive run claude/codex
│   │   ├── list.ts            # hive list
│   │   └── resume.ts          # hive resume
│   └── registry.ts            # Shared session registry read/write
├── hooks/                     # Claude Code hook scripts
│   └── claude-code-hook.sh    # Hook for reporting session status
└── shared/                    # Shared types
    └── types.ts               # Session and other type definitions
```

## Implementation Steps

### Phase 1: Foundation (Session Registry + CLI)
1. Initialize project (package.json, tsconfig, dependencies)
2. Define shared types (`shared/types.ts`)
3. Implement session registry read/write (`cli/registry.ts`)
4. Implement `hive list` command
5. Implement Claude Code hooks script (writes session JSON)
6. Configure Claude Code settings.json to register hooks

### Phase 2: CLI Wrapper
7. Implement `hive run claude <args>` — Launch claude and register session
8. Implement `hive run codex <args>` — Launch codex and monitor
9. Auto-cleanup session file on process exit
10. Implement `hive resume` — List recoverable sessions and restore

### Phase 3: Menubar App
11. Set up Electron + menubar base framework
12. Implement file watching (chokidar watch sessions directory)
13. React UI — Session list display
14. Native macOS notifications (when status changes to waiting)
15. Click session to jump to corresponding terminal window
16. Recent projects list
17. Menubar icon badge (shows number of sessions awaiting attention)

### Phase 4: Polish
18. electron-builder packaging as .app
19. Launch at startup
20. Automatic stale session cleanup (PID detection)
21. Settings page (notification preferences, cleanup policy, etc.)
