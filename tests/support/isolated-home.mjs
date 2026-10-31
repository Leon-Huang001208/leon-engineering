// Each worker owns its test home; an enabled user policy must never enroll fixtures
// into the real host ledger or leave abandoned fixture leases there.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {beforeEach, afterEach} from "node:test";

let previousHome;
let fixtureHome;
beforeEach(() => {
  previousHome = process.env.HOME;
  fixtureHome = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "leon-test-home-"));
  process.env.HOME = fixtureHome;
});
afterEach(() => {
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  fs.rmSync(fixtureHome, {recursive: true, force: true});
});
