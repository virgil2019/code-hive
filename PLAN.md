# Code Hive — AI CLI 会话管理器

macOS 菜单栏应用，统一管理 Claude Code、Codex 等 AI CLI 工具的会话。

## 核心需求

1. **统一可见性** — 菜单栏一眼看到所有 AI CLI 会话状态
2. **桌面通知** — 会话完成/等待输入时弹 macOS 通知
3. **会话恢复** — 关了终端也能找回、恢复会话
4. **最近项目** — 快速查看近期在做什么

## 架构设计

```
┌─────────────────────────────────────┐
│         macOS Menubar App           │
│        (Electron + React)           │
│  ┌───────────┐  ┌────────────────┐  │
│  │ Session    │  │ Notifications  │  │
│  │ List UI    │  │ (native macOS) │  │
│  └─────┬─────┘  └───────┬────────┘  │
│        │                │           │
│  ┌─────┴────────────────┴────────┐  │
│  │   File Watcher (chokidar)     │  │
│  │   ~/.code-hive/sessions/      │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
         ▲                    ▲
         │                    │
┌────────┴───────┐  ┌────────┴───────┐
│ Claude Code    │  │ hive CLI       │
│ Hooks          │  │ (wrapper)      │
│ → write JSON   │  │ → wrap codex   │
│   to sessions/ │  │ → write JSON   │
└────────────────┘  └────────────────┘
```

### 三层架构

#### Layer 1: Session Registry（数据层）

- 目录: `~/.code-hive/sessions/`
- 每个会话一个 JSON 文件: `{sessionId}.json`

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
  "pid": 12345,                 // 进程 PID，用于检测是否还活着
  "terminal": "iTerm2"          // 终端信息，用于恢复
}
```

#### Layer 2: 数据采集

**Claude Code — 通过 Hooks 自动上报：**
- `PreToolUse` / `PostToolUse` → status = "active"
- `Notification (idle_prompt)` → status = "waiting"（弹通知）
- `Notification (permission_prompt)` → status = "waiting"（弹通知）
- `Stop` → status = "idle"
- 会话开始时创建文件，结束时标记 done

**Codex — 通过 `hive` CLI wrapper：**
- `hive run codex <args>` — 启动 codex 并监控其 stdout/进程状态
- 检测输出中的等待模式 → 更新状态
- 进程退出 → 标记 done

#### Layer 3: Menubar App（展示层）

**Electron + menubar + React：**
- 使用 `menubar` npm 包，轻量级
- chokidar 监听 `~/.code-hive/sessions/` 目录变化
- 实时更新会话列表

**UI 设计：**
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

**交互：**
- 点击会话 → 打开/聚焦对应终端窗口
- 点击 "Waiting" 的会话 → 直接跳转
- 点击最近项目 → 选择用 claude/codex 打开新会话
- 菜单栏图标显示等待数量角标

## 技术栈

| 组件 | 技术 | 理由 |
|------|------|------|
| Menubar App | Electron + menubar + React | TS 生态，快速开发 |
| 构建 | electron-builder | 打包为 .app |
| 文件监听 | chokidar | 高效跨平台 file watching |
| 通知 | Electron Notification API | 原生 macOS 通知 |
| CLI 工具 | Node.js + commander | `hive` 命令行 |
| 进程监控 | node child_process + ps-list | 检测会话存活 |

## 项目结构

```
code-hive/
├── package.json
├── tsconfig.json
├── electron/                  # Electron 主进程
│   ├── main.ts                # 入口，menubar 初始化
│   ├── sessions.ts            # Session registry 读写
│   ├── watcher.ts             # chokidar 文件监听
│   ├── notifications.ts       # macOS 通知管理
│   └── terminal.ts            # 终端聚焦/恢复逻辑
├── src/                       # React 渲染进程
│   ├── App.tsx                # 主界面
│   ├── components/
│   │   ├── SessionList.tsx    # 会话列表
│   │   ├── SessionItem.tsx    # 单个会话卡片
│   │   └── RecentProjects.tsx # 最近项目
│   └── hooks/
│       └── useSessions.ts     # IPC 通信 hook
├── cli/                       # hive CLI 工具
│   ├── index.ts               # CLI 入口
│   ├── commands/
│   │   ├── run.ts             # hive run claude/codex
│   │   ├── list.ts            # hive list
│   │   └── resume.ts          # hive resume
│   └── registry.ts            # 共享的 session registry 读写
├── hooks/                     # Claude Code hook 脚本
│   └── claude-code-hook.sh    # 上报会话状态的 hook
└── shared/                    # 共享类型
    └── types.ts               # Session 等类型定义
```

## 实现步骤

### Phase 1: 基础设施（Session Registry + CLI）
1. 初始化项目 (package.json, tsconfig, 依赖)
2. 定义共享类型 (`shared/types.ts`)
3. 实现 Session Registry 读写 (`cli/registry.ts`)
4. 实现 `hive list` 命令
5. 实现 Claude Code hooks 脚本（写入 session JSON）
6. 配置 Claude Code settings.json 注册 hooks

### Phase 2: CLI Wrapper
7. 实现 `hive run claude <args>` — 启动 claude 并注册会话
8. 实现 `hive run codex <args>` — 启动 codex 并监控
9. 进程退出时自动清理 session 文件
10. 实现 `hive resume` — 列出可恢复的会话并恢复

### Phase 3: Menubar App
11. 搭建 Electron + menubar 基础框架
12. 实现文件监听 (chokidar watch sessions 目录)
13. React UI — 会话列表展示
14. macOS 原生通知（状态变为 waiting 时）
15. 点击会话跳转到对应终端窗口
16. 最近项目列表
17. 菜单栏图标角标（显示等待数量）

### Phase 4: 打磨
18. electron-builder 打包为 .app
19. 开机自启动
20. 过期会话自动清理（PID 检测）
21. 设置页面（通知偏好、清理策略等）
