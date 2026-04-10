#!/bin/bash
# Code Hive — Claude Code session tracking hook
# Reads JSON from stdin, updates session state in ~/.code-hive/sessions/

HIVE_DIR="$HOME/.code-hive"
SESSIONS_DIR="$HIVE_DIR/sessions"
HISTORY_DIR="$HIVE_DIR/history"
EVENTS_DIR="$HIVE_DIR/events"
mkdir -p "$SESSIONS_DIR" "$HISTORY_DIR" "$EVENTS_DIR"

# Parse JSON from stdin safely (no eval)
INPUT=$(cat)
SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty')
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty')
EVENT=$(printf '%s' "$INPUT" | jq -r '.hook_event_name // empty')
NTYPE=$(printf '%s' "$INPUT" | jq -r '.notification_type // empty')

[ -z "$SESSION_ID" ] && exit 0

# Sanitize SHORT_ID: only allow alphanumeric and hyphens
SHORT_ID=$(printf '%s' "${SESSION_ID:0:8}" | tr -cd 'a-zA-Z0-9-')
[ -z "$SHORT_ID" ] && exit 0

SESSION_FILE="$SESSIONS_DIR/$SHORT_ID.json"
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
PROJECT_NAME=$(basename "$CWD")

# Find the tty by walking up the process tree
find_tty() {
  local PID="$$"
  for i in 1 2 3 4 5; do
    PID=$(ps -o ppid= -p "$PID" 2>/dev/null | tr -d ' ')
    [ -z "$PID" ] && return
    local T=$(ps -o tty= -p "$PID" 2>/dev/null | tr -d ' ')
    if [ -n "$T" ] && [ "$T" != "??" ]; then
      echo "/dev/$T"
      return
    fi
  done
}

# Ensure tty is set in session file (backfill for existing sessions)
ensure_tty() {
  if [ -f "$SESSION_FILE" ]; then
    local CURRENT_TTY=$(jq -r '.tty // ""' "$SESSION_FILE")
    if [ -z "$CURRENT_TTY" ]; then
      local TTY=$(find_tty)
      if [ -n "$TTY" ]; then
        jq --arg tty "$TTY" '.tty=$tty' "$SESSION_FILE" > "$SESSION_FILE.tmp" && mv "$SESSION_FILE.tmp" "$SESSION_FILE"
      fi
    fi
  fi
}

# Safe notification: use jq to escape strings for AppleScript
notify() {
  local title="$1"
  local message="$2"
  # Escape backslashes and double quotes for AppleScript
  title=$(printf '%s' "$title" | sed 's/\\/\\\\/g; s/"/\\"/g')
  message=$(printf '%s' "$message" | sed 's/\\/\\\\/g; s/"/\\"/g')
  osascript -e "display notification \"$message\" with title \"Code Hive\" subtitle \"$title\"" 2>/dev/null &
}

# Log event for daily reports (append to daily log file)
LOG_DATE=$(date -u +"%Y-%m-%d")
printf '%s\t%s\t%s\t%s\n' "$NOW" "$EVENT" "$PROJECT_NAME" "$SHORT_ID" >> "$EVENTS_DIR/$LOG_DATE.log" 2>/dev/null

case "$EVENT" in
  SessionStart)
    TTY=$(find_tty)
    # Use jq to build JSON safely (no string interpolation)
    jq -n \
      --arg id "$SHORT_ID" \
      --arg sid "$SESSION_ID" \
      --arg project "$CWD" \
      --arg pname "$PROJECT_NAME" \
      --arg now "$NOW" \
      --arg tty "$TTY" \
      '{id:$id,fullSessionId:$sid,tool:"claude-code",project:$project,projectName:$pname,status:"stopped",acknowledged:true,startedAt:$now,lastActivity:$now,tty:$tty}' \
      > "$SESSION_FILE.tmp" && mv "$SESSION_FILE.tmp" "$SESSION_FILE"
    ;;

  Notification)
    ensure_tty
    case "$NTYPE" in
      permission_prompt)
        [ -f "$SESSION_FILE" ] && jq --arg now "$NOW" --arg reason "$NTYPE" \
          '.status="waiting"|.lastActivity=$now|.waitReason=$reason' \
          "$SESSION_FILE" > "$SESSION_FILE.tmp" && mv "$SESSION_FILE.tmp" "$SESSION_FILE"
        notify "$PROJECT_NAME" "Needs permission approval"
        ;;
      idle_prompt)
        notify "$PROJECT_NAME" "Waiting for your input"
        ;;
      *)
        notify "$PROJECT_NAME" "Needs your attention"
        ;;
    esac
    ;;

  Stop|StopFailure)
    ensure_tty
    [ -f "$SESSION_FILE" ] && jq --arg now "$NOW" \
      '.status="stopped"|.lastActivity=$now|.waitReason=null|.acknowledged=false' \
      "$SESSION_FILE" > "$SESSION_FILE.tmp" && mv "$SESSION_FILE.tmp" "$SESSION_FILE"
    if [ "$EVENT" = "StopFailure" ]; then
      notify "$PROJECT_NAME" "Task failed"
    else
      notify "$PROJECT_NAME" "Task finished"
    fi
    ;;

  UserPromptSubmit|PreToolUse)
    ensure_tty
    [ -f "$SESSION_FILE" ] && jq --arg now "$NOW" \
      '.status="working"|.lastActivity=$now|.waitReason=null|.acknowledged=null' \
      "$SESSION_FILE" > "$SESSION_FILE.tmp" && mv "$SESSION_FILE.tmp" "$SESSION_FILE"
    ;;

  PostToolUse)
    ensure_tty
    # Only set working if currently waiting (after permission approval)
    # Don't overwrite stopped (Stop may have fired already)
    if [ -f "$SESSION_FILE" ]; then
      CURRENT=$(jq -r '.status' "$SESSION_FILE")
      if [ "$CURRENT" = "waiting" ]; then
        jq --arg now "$NOW" \
          '.status="working"|.lastActivity=$now|.waitReason=null|.acknowledged=null' \
          "$SESSION_FILE" > "$SESSION_FILE.tmp" && mv "$SESSION_FILE.tmp" "$SESSION_FILE"
      fi
    fi
    ;;

  SessionEnd)
    [ -f "$SESSION_FILE" ] && {
      jq --arg now "$NOW" '.status="done"|.lastActivity=$now|.waitReason=null' \
        "$SESSION_FILE" > "$HISTORY_DIR/$SHORT_ID.json"
      rm -f "$SESSION_FILE"
    }
    ;;
esac

exit 0
