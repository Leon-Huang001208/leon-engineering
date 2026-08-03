import fs from "node:fs";
import {spawnSync} from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {checkProjectConstraints} from "../scripts/project-constraints.mjs";

const sourceRoot = path.resolve(import.meta.dirname, "..");

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, content);
}

function makeFixture(t, {serviceSource = "from core.observability import get_logger\n"} = {}) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "leon-project-constraints-"));
  t.after(() => fs.rmSync(project, {recursive: true, force: true}));
  writeFile(path.join(project, "AGENTS.md"), "# 项目规则\n");
  writeFile(path.join(project, "docs", "ARCHITECTURE.md"), "# 架构\n");
  writeFile(path.join(project, "services", "work.py"), serviceSource);
  writeFile(path.join(project, ".github", "workflows", "desktop.yml"), "runs-on: windows-latest\n- run: health\n");
  writeFile(path.join(project, ".agents", "project-constraints.json"), `${JSON.stringify({
    schemaVersion: 1,
    requiredFiles: ["AGENTS.md", "docs/ARCHITECTURE.md"],
    changeRules: [{name: "服务改动需要变更日志", sourcePrefixes: ["services/"], requiredDocuments: ["docs/CHANGELOG.md"]}],
    contentRules: [{name: "服务日志与错误处理", sourcePrefixes: ["services/"], extensions: [".py"], requireAll: ["get_logger", "except "]}],
    dependencyRules: [{name: "核心层不依赖服务层", sourcePrefixes: ["core/"], extensions: [".py"], forbiddenPatterns: ["from services."]}],
    ciRules: [{name: "桌面 Windows 健康检查", workflow: ".github/workflows/desktop.yml", requireAll: ["windows-latest", "health"]}]
  }, null, 2)}\n`);
  return project;
}

test("reports machine-readable violations without writing or running project commands", t => {
  const project = makeFixture(t);
  const config = path.join(project, ".agents", "project-constraints.json");
  const before = fs.readFileSync(config, "utf8");

  const result = checkProjectConstraints({projectRoot: project, changedFiles: ["services/work.py"]});

  assert.deepEqual(result.violations.map(item => item.code), ["required_document_changed", "required_content_missing"]);
  assert.deepEqual(result.checkedFiles, ["services/work.py"]);
  assert.equal(fs.readFileSync(config, "utf8"), before);
  assert.equal(fs.existsSync(path.join(project, "command-must-not-run")), false);
});

test("passes declared checks when changed documentation, content, and CI evidence match", t => {
  const project = makeFixture(t, {serviceSource: "from core.observability import get_logger\ntry:\n  pass\nexcept Exception:\n  pass\n"});
  writeFile(path.join(project, "docs", "CHANGELOG.md"), "# 变更\n");

  const result = checkProjectConstraints({
    projectRoot: project,
    changedFiles: ["services/work.py", "docs/CHANGELOG.md"]
  });

  assert.deepEqual(result.violations, []);
});

test("reports a forbidden architecture dependency only for matching changed source", t => {
  const project = makeFixture(t);
  writeFile(path.join(project, "core", "bad.py"), "from services.work import run\n");

  const result = checkProjectConstraints({projectRoot: project, changedFiles: ["core/bad.py"]});

  assert.deepEqual(result.violations.map(item => item.code), ["forbidden_dependency"]);
  assert.equal(result.violations[0].rule, "核心层不依赖服务层");
});

test("CLI exits nonzero for violations and refuses parent traversal", t => {
  const project = makeFixture(t);
  const script = path.join(sourceRoot, "scripts", "project-constraints.mjs");

  const violation = spawnSync(process.execPath, [script, "--project", project, "--changed-file", "services/work.py"], {encoding: "utf8"});
  assert.equal(violation.status, 1, violation.stderr);
  assert.deepEqual(JSON.parse(violation.stdout).violations.map(item => item.code), ["required_document_changed", "required_content_missing"]);

  const unsafe = spawnSync(process.execPath, [script, "--project", project, "--changed-file", "../outside.py"], {encoding: "utf8"});
  assert.equal(unsafe.status, 1);
  assert.match(unsafe.stderr, /unsafe changed file/);
});

test("refuses a symbolic-link constraints file", t => {
  const project = makeFixture(t);
  const external = path.join(project, "outside.json");
  const config = path.join(project, ".agents", "project-constraints.json");
  fs.renameSync(config, external);
  fs.symlinkSync(external, config);

  assert.throws(() => checkProjectConstraints({projectRoot: project, changedFiles: []}), /invalid constraints file/);
});
