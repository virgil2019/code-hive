export type SessionTool = "claude-code" | "codex";

export type SessionStatus = "working" | "waiting" | "stopped" | "done";

export interface Session {
  id: string;
  tool: SessionTool;
  project: string;
  projectName: string;
  status: SessionStatus;
  sessionName?: string;
  startedAt: string; // ISO 8601
  lastActivity: string; // ISO 8601
  pid?: number;
  tty?: string; // e.g. "/dev/ttys014"
  waitReason?: string; // e.g. "permission_prompt", "idle_prompt"
  acknowledged?: boolean; // true after user has seen a stopped session
}

export const HIVE_DIR = `${process.env.HOME}/.code-hive`;
export const SESSIONS_DIR = `${HIVE_DIR}/sessions`;
export const HISTORY_DIR = `${HIVE_DIR}/history`;
