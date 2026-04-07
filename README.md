# Code Hive

macOS menubar app for managing multiple AI CLI sessions (Claude Code).

When you run several Claude Code sessions across iTerm2 tabs, it's easy to lose track of which ones need attention. Code Hive tracks all sessions in one place, shows their real-time status, and sends desktop notifications when a session needs you.

## Features

- **Menubar app** — Always-visible session list, click to expand
- **Real-time status** — working / waiting / stopped / done
- **Desktop notifications** — Permission prompts, task completion
- **Terminal jumping** — Click a session to jump to its iTerm2 tab
- **CLI** — `hive list`, `hive watch` for terminal-based monitoring
- **Auto-cleanup** — Detects dead sessions via TTY/process checking
- **Zero config** — One command to install, works with existing Claude Code

## Status Icons

| Status | Meaning |
|--------|---------|
| **working** | Claude is actively using tools |
| **waiting** | Needs permission approval |
| **stopped** (new) | Task just finished, needs your attention |
| **stopped** (seen) | Acknowledged, no action needed |

## Install

```bash
npm install -g code-hive
hive install
hive app
```

Or without global install:

```bash
npx code-hive install
npx code-hive app
```

`hive install` does two things:
1. Copies the hook script to `~/.code-hive/bin/`
2. Adds hooks to `~/.claude/settings.json` (non-destructive, merges with existing config)

## Usage

### CLI

```bash
hive list           # List active sessions
hive list --all     # Include history
hive watch          # Live monitoring (auto-refresh)
hive app            # Launch menubar app
hive uninstall      # Remove hooks from Claude Code
```

### Menubar App

```bash
hive app
```

- Click the menubar icon to see all sessions
- Click a session with "Jump" to switch to its iTerm2 tab
- Click "Finished" sessions to acknowledge them
- Hover "Recent" in the footer to see past sessions
- Badge shows count of sessions needing attention

## How It Works

```
Claude Code Hooks ──→ ~/.code-hive/sessions/*.json ──→ Menubar App
  (SessionStart)         (one JSON per session)         (chokidar watch)
  (PreToolUse)                                          (IPC → renderer)
  (Notification)
  (Stop)
  (SessionEnd)
```

1. **Hooks** — Claude Code fires events (start, tool use, notification, stop, end). A shell script writes session state to `~/.code-hive/sessions/`.
2. **Registry** — Each session is a JSON file with id, project, status, tty, timestamps.
3. **Menubar** — Electron app watches the sessions directory, pushes updates to the UI, manages tray badge.
4. **Terminal jump** — Sessions record their TTY. The app uses AppleScript to find and focus the matching iTerm2 tab.

## Project Structure

```
code-hive/
├── cli/                    # CLI tool (hive)
│   ├── index.ts            # Entry point
│   ├── registry.ts         # Session CRUD + stale cleanup
│   └── commands/
│       ├── list.ts         # hive list
│       ├── watch.ts        # hive watch
│       └── install.ts      # hive install
├── electron/               # Menubar app main process
│   ├── main.ts
│   └── preload.cjs
├── renderer/               # Menubar app UI
│   ├── index.html
│   └── iconTemplate.png
├── hooks/                  # Claude Code hook script
│   └── claude-code-hook.sh
└── shared/
    └── types.ts            # Shared type definitions
```

## Requirements

- macOS
- Node.js >= 20
- iTerm2 (for terminal tab jumping)
- Claude Code CLI

## License

MIT
