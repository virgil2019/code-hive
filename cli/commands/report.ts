import chalk from "chalk";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HIVE_DIR } from "../../shared/types.js";

const CLAUDE_DIR = join(process.env.HOME!, ".claude");
const REPORTS_DIR = join(HIVE_DIR, "reports");

interface ConversationSummary {
  project: string;
  sessionId: string;
  userMessages: string[];
}

function findActiveConversations(fromTime: Date, toTime: Date): ConversationSummary[] {
  const projectsDir = join(CLAUDE_DIR, "projects");
  if (!existsSync(projectsDir)) return [];

  const results: ConversationSummary[] = [];

  for (const projDir of readdirSync(projectsDir)) {
    const projPath = join(projectsDir, projDir);
    const jsonlFiles = readdirSync(projPath).filter(f => f.endsWith(".jsonl"));

    for (const jsonlFile of jsonlFiles) {
      const filePath = join(projPath, jsonlFile);
      const content = readFileSync(filePath, "utf-8");
      const lines = content.trim().split("\n");

      const userMessages: string[] = [];
      let hasActivityInWindow = false;

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          // Check timestamp
          if (entry.timestamp) {
            const t = new Date(entry.timestamp);
            if (t >= fromTime && t <= toTime) {
              hasActivityInWindow = true;
            }
          }
          // Extract user prompts (non-meta)
          if (entry.type === "user" && !entry.isMeta && entry.message?.content) {
            const t = entry.timestamp ? new Date(entry.timestamp) : null;
            if (t && t >= fromTime && t <= toTime) {
              const content = entry.message.content;
              if (typeof content === "string") {
                // Skip empty or command-only messages
                const clean = content.replace(/<[^>]+>/g, "").trim();
                if (clean && clean.length > 2) userMessages.push(clean);
              } else if (Array.isArray(content)) {
                for (const block of content) {
                  if (block.type === "text" && block.text) {
                    const clean = block.text.replace(/<[^>]+>/g, "").trim();
                    if (clean && clean.length > 2) userMessages.push(clean);
                  }
                }
              }
            }
          }
        } catch {}
      }

      if (hasActivityInWindow && userMessages.length > 0) {
        // Decode project name from dir name
        const project = projDir.replace(/^-/, "/").replace(/-/g, "/");
        results.push({ project, sessionId: jsonlFile.replace(".jsonl", ""), userMessages });
      }
    }
  }

  return results;
}

async function summarizeWithClaude(conversations: ConversationSummary[]): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not set. Export it in your shell or add to ~/.code-hive/config");
  }

  const client = new Anthropic({ apiKey });

  // Build conversation digest
  let digest = "";
  for (const conv of conversations) {
    digest += `\n## Project: ${conv.project}\n`;
    // Limit to last 30 user messages per project to avoid token overflow
    const msgs = conv.userMessages.slice(-30);
    for (const msg of msgs) {
      // Truncate very long messages
      const truncated = msg.length > 300 ? msg.slice(0, 300) + "..." : msg;
      digest += `- ${truncated}\n`;
    }
  }

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: [{
      role: "user",
      content: `Based on the following user prompts from today's Claude Code sessions, generate a concise daily work report in Chinese. Group by project. For each project, summarize what was accomplished in 1-3 bullet points. Focus on WHAT was done, not how long it took. Use clear, professional language.

${digest}

Format:
## 项目名
- 完成的工作1
- 完成的工作2

## 总结
一句话总结今日工作重点。`
    }],
  });

  const text = response.content[0];
  if (text.type === "text") return text.text;
  return "Failed to generate summary.";
}

export async function reportCommand(opts: { from?: string; to?: string }) {
  const now = new Date();
  let toTime: Date;
  let fromTime: Date;

  if (opts.from && opts.to) {
    fromTime = new Date(opts.from);
    toTime = new Date(opts.to);
  } else {
    toTime = new Date(now);
    toTime.setHours(21, 0, 0, 0);
    if (toTime > now) toTime = now;
    fromTime = new Date(toTime);
    fromTime.setDate(fromTime.getDate() - 1);
    fromTime.setHours(21, 0, 0, 0);
  }

  const fromStr = fromTime.toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" });
  console.log(chalk.bold(`\n📋 Generating work report — ${fromStr}\n`));

  // Find conversations
  const conversations = findActiveConversations(fromTime, toTime);

  if (conversations.length === 0) {
    console.log(chalk.dim("  No conversations found in this period.\n"));
    return;
  }

  console.log(chalk.dim(`  Found ${conversations.length} session(s) across ${new Set(conversations.map(c => c.project)).size} project(s)`));
  console.log(chalk.dim("  Summarizing with Claude...\n"));

  try {
    const summary = await summarizeWithClaude(conversations);

    console.log(summary);
    console.log();

    // Save report
    mkdirSync(REPORTS_DIR, { recursive: true });
    const dateStr = fromTime.toISOString().slice(0, 10);
    const reportPath = join(REPORTS_DIR, `${dateStr}.md`);
    writeFileSync(reportPath, `# Daily Report — ${fromStr}\n\n${summary}\n`);
    console.log(chalk.dim(`  Saved to ${reportPath}\n`));
  } catch (err: any) {
    console.error(chalk.red(`  Error: ${err.message}\n`));
    if (err.message.includes("ANTHROPIC_API_KEY")) {
      console.log(chalk.dim("  Set your API key:"));
      console.log(chalk.dim("    export ANTHROPIC_API_KEY=sk-ant-...\n"));
    }
  }
}
