#!/usr/bin/env node

// Skip postinstall during npm publish or CI
if (process.env.npm_lifecycle_event === "prepublishOnly") process.exit(0);
if (process.env.CI) process.exit(0);

console.log(`
  🐝 Code Hive installed!

  Quick start:
    hive install     Install Claude Code hooks
    hive list        List active sessions
    hive app         Launch menubar app

  Run "hive install" to get started.
`);
