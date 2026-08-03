import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {installProjectConstraints, previewProjectConstraintsInstall} from "../scripts/install-project-constraints.mjs";

function makeFixture(t) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "leon-constraints-install-"));
  t.after(() => fs.rmSync(project, {recursive: true, force: true}));
  return project;
}

test("previews without creating project files and installs only after explicit write", t => {
  const project = makeFixture(t);
  const preview = previewProjectConstraintsInstall({projectRoot: project});
  const destination = path.join(fs.realpathSync(project), ".agents", "project-constraints.mjs");

  assert.equal(preview.destination, destination);
  assert.match(preview.sourceChecksum, /^[0-9a-f]{64}$/);
  assert.equal(fs.existsSync(path.join(project, ".agents")), false);

  const installed = installProjectConstraints({projectRoot: project});
  assert.equal(installed.destination, destination);
  assert.equal(fs.readFileSync(destination, "utf8"), fs.readFileSync(preview.source, "utf8"));
  assert.equal(installed.sourceChecksum, crypto.createHash("sha256").update(fs.readFileSync(destination)).digest("hex"));
  assert.throws(() => installProjectConstraints({projectRoot: project}), /existing project constraints checker/);
  assert.doesNotThrow(() => installProjectConstraints({projectRoot: project, replace: true}));
});

test("refuses a symbolic-link .agents directory", t => {
  const project = makeFixture(t);
  const external = fs.mkdtempSync(path.join(os.tmpdir(), "leon-constraints-external-"));
  t.after(() => fs.rmSync(external, {recursive: true, force: true}));
  fs.symlinkSync(external, path.join(project, ".agents"));

  assert.throws(() => previewProjectConstraintsInstall({projectRoot: project}), /invalid project constraints directory/);
});
