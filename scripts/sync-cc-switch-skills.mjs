import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";

export const LEON_ENGINEERING_PLUGIN = "leon-engineering@leon-local";
export const LEON_ENGINEERING_SKILLS = [
  "agent-routing",
  "bugfix-evidence",
  "feature-loop",
  "logging-observability",
  "project-adapter",
  "project-bootstrap",
  "project-constraints",
  "project-harness",
  "review-ship",
  "skill-health"
];

function parseArguments(args) {
  const options = {apply: false};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--apply") {
      options.apply = true;
      continue;
    }
    if (["--db", "--claude-skills", "--codex-skills", "--backup-dir", "--plugin-enabled"].includes(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`missing value for ${argument}`);
      options[argument.slice(2).replaceAll("-", "_")] = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${argument}`);
  }
  return options;
}

function readDirectoryNames(directory) {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new Error(`missing skills directory: ${directory}`);
  }
  return new Set(
    fs.readdirSync(directory, {withFileTypes: true})
      .filter(entry => !entry.name.startsWith("."))
      .filter(entry => entry.isDirectory() || entry.isSymbolicLink())
      .map(entry => entry.name)
  );
}

function readPluginEnabled() {
  const output = execFileSync("claude", ["plugin", "list"], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]});
  const start = output.indexOf(LEON_ENGINEERING_PLUGIN);
  if (start === -1) return false;
  return /Status:\s*.*enabled/i.test(output.slice(start, start + 240));
}

function readRows(database) {
  if (!fs.existsSync(database) || !fs.statSync(database).isFile()) {
    throw new Error(`missing CC-Switch database: ${database}`);
  }
  const output = execFileSync(
    "sqlite3",
    ["-json", database, "SELECT id, directory, enabled_claude, enabled_codex FROM skills ORDER BY id;"],
    {encoding: "utf8"}
  );
  return JSON.parse(output || "[]");
}

export function buildReconciliation({rows, claudeDirectories, codexDirectories, pluginEnabled}) {
  const pluginSkills = new Set(LEON_ENGINEERING_SKILLS);
  const changes = [];
  let claudeEnabled = 0;
  let codexEnabled = 0;

  for (const row of rows) {
    const desiredClaude = Number(
      claudeDirectories.has(row.directory) || (pluginEnabled && pluginSkills.has(row.directory))
    );
    const desiredCodex = Number(codexDirectories.has(row.directory));
    claudeEnabled += desiredClaude;
    codexEnabled += desiredCodex;
    if (Number(row.enabled_claude) !== desiredClaude || Number(row.enabled_codex) !== desiredCodex) {
      changes.push({
        id: row.id,
        before: {claude: Number(row.enabled_claude), codex: Number(row.enabled_codex)},
        after: {claude: desiredClaude, codex: desiredCodex}
      });
    }
  }
  return {changes, counts: {claude: claudeEnabled, codex: codexEnabled}};
}

export function buildPluginAdditions({rows, pluginSkills = LEON_ENGINEERING_SKILLS, pluginEnabled, claudeDirectories, codexDirectories}) {
  if (!pluginEnabled) return [];
  const knownDirectories = new Set(rows.map(row => row.directory));
  return pluginSkills
    .filter(directory => !knownDirectories.has(directory))
    .map(directory => ({
      id: `local:${directory}`,
      name: directory,
      directory,
      enabledClaude: 1,
      enabledCodex: Number(codexDirectories.has(directory))
    }));
}

function escapeSql(value) {
  return String(value).replaceAll("'", "''");
}

function applyChanges(database, backupDirectory, changes, additions) {
  if (changes.length === 0 && additions.length === 0) return null;
  fs.mkdirSync(backupDirectory, {recursive: true, mode: 0o700});
  const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const backup = path.join(backupDirectory, `cc-switch.db.${timestamp}.before`);
  fs.copyFileSync(database, backup, fs.constants.COPYFILE_EXCL);
  const updates = changes.map(change => (
    `UPDATE skills SET enabled_claude = ${change.after.claude}, enabled_codex = ${change.after.codex}, updated_at = CAST(strftime('%s','now') AS INTEGER) WHERE id = '${escapeSql(change.id)}';`
  ));
  const inserts = additions.map(addition => (
    `INSERT INTO skills (id, name, directory, enabled_claude, enabled_codex, installed_at, updated_at) VALUES ('${escapeSql(addition.id)}', '${escapeSql(addition.name)}', '${escapeSql(addition.directory)}', ${addition.enabledClaude}, ${addition.enabledCodex}, CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER));`
  ));
  execFileSync("sqlite3", [database, `BEGIN IMMEDIATE;\n${[...updates, ...inserts].join("\n")}\nCOMMIT;`], {encoding: "utf8"});
  return backup;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const home = os.homedir();
  const database = options.db ?? path.join(home, ".cc-switch", "cc-switch.db");
  const claudeSkills = options.claude_skills ?? path.join(home, ".claude", "skills");
  const codexSkills = options.codex_skills ?? path.join(home, ".codex", "skills");
  const backupDirectory = options.backup_dir ?? path.join(home, ".cc-switch", "backups", "leon-engineering-sync");
  const pluginEnabled = options.plugin_enabled === undefined
    ? readPluginEnabled()
    : options.plugin_enabled === "true";
  if (options.plugin_enabled !== undefined && !["true", "false"].includes(options.plugin_enabled)) {
    throw new Error("--plugin-enabled must be true or false");
  }
  const rows = readRows(database);
  const claudeDirectories = readDirectoryNames(claudeSkills);
  const codexDirectories = readDirectoryNames(codexSkills);
  const reconciliation = buildReconciliation({
    rows,
    claudeDirectories,
    codexDirectories,
    pluginEnabled
  });
  const additions = buildPluginAdditions({rows, pluginEnabled, claudeDirectories, codexDirectories});
  reconciliation.counts.claude += additions.reduce((total, addition) => total + addition.enabledClaude, 0);
  reconciliation.counts.codex += additions.reduce((total, addition) => total + addition.enabledCodex, 0);
  const backup = options.apply ? applyChanges(database, backupDirectory, reconciliation.changes, additions) : null;
  process.stdout.write(`${JSON.stringify({
    applied: options.apply,
    pluginEnabled,
    ...reconciliation,
    additions,
    backup
  })}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`cc-switch skill sync failed: ${error.message}\n`);
    process.exit(1);
  }
}
