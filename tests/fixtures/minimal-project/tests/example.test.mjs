import assert from "node:assert/strict";
import test from "node:test";

import {add} from "../src/example.mjs";

test("adds finite numbers", () => {
  assert.equal(add(2, 3), 5);
});
