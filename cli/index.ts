#!/usr/bin/env node
import { program } from "commander";
import { listCommand } from "./commands/list.js";
import { installCommand } from "./commands/install.js";
import { watchCommand } from "./commands/watch.js";
import { runCommand } from "./commands/run.js";
import { appCommand } from "./commands/app.js";

program
  .name("hive")
  .description("🐝 AI CLI session manager")
  .version("0.1.0");

program
  .command("list")
  .alias("ls")
  .description("List active AI CLI sessions")
  .option("-a, --all", "Include completed sessions from history")
  .action(listCommand);

program
  .command("watch")
  .alias("w")
  .description("Watch sessions and notify on status changes")
  .action(watchCommand);

program
  .command("run <tool> [args...]")
  .description("Launch an AI CLI tool with session tracking (e.g. hive run codex, hive run claude)")
  .allowUnknownOption()
  .action(runCommand);

program
  .command("install")
  .description("Install hooks into Claude Code settings")
  .action(installCommand);

program
  .command("uninstall")
  .description("Remove hooks from Claude Code settings")
  .action(async () => {
    const { uninstallCommand } = await import("./commands/install.js");
    uninstallCommand();
  });

program
  .command("app")
  .description("Launch the menubar app")
  .action(appCommand);

program.parse();
