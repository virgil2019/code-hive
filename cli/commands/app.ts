import { execSync, spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function appCommand() {
  // Find the electron binary
  const electronPath = join(__dirname, "..", "..", "node_modules", ".bin", "electron");
  const appRoot = join(__dirname, "..", "..");

  const child = spawn(electronPath, [appRoot], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  console.log("🐝 Code Hive menubar app launched.");
}
