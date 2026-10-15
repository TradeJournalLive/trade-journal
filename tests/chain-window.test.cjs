const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const Module = require("node:module");
const file = require("node:path").resolve(__dirname, "../app/lib/algo/chainWindow.ts");
const copy = new Module(file, module);
copy._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, file);
const { chainWindow } = copy.exports;
test("centres 21 unique strikes on nearest index strike and recentres as index moves", () => {
  const strikes = Array.from({ length: 101 }, (_, i) => 20500 + i * 50);
  const result = chainWindow([...strikes, 23000], 22997.35);
  assert.equal(result.atm, 23000); assert.equal(result.strikes.length, 21);
  assert.equal(result.strikes[0], 22500); assert.equal(result.strikes[20], 23500);
  assert.equal(chainWindow(strikes, 23052).atm, 23050);
});
test("missing prices and limited feeds never fabricate strikes", () => {
  assert.deepEqual(chainWindow([100, 150], null).strikes, []);
  assert.deepEqual(chainWindow([100, 150], 101).strikes, [100, 150]);
  assert.deepEqual(chainWindow([], 100).strikes, []);
});
