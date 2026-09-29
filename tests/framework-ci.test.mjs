import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

test("framework CI runs fixed contracts map constraints and whitespace checks", () => {
  const workflow = fs.readFileSync(path.join(ROOT, ".github", "workflows", "framework-checks.yml"), "utf8");
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /push:/);
  assert.match(workflow, /branches:\s*\[main\]/);
  assert.match(workflow, /node --test tests\/\*\.test\.mjs/);
  assert.match(workflow, /check-architecture-map\.mjs --project \./);
  assert.match(workflow, /project-constraints\.mjs/);
  assert.match(workflow, /git diff --check/);
  assert.doesNotMatch(workflow, /workflow_dispatch:/);
});
