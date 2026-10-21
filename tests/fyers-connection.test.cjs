const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const Module = require("node:module");
const filename = require("node:path").resolve(__dirname, "../app/lib/algo/fyersConnection.ts");
const copy = new Module(filename, module);
copy.require = id => {
  if (id === "next/headers") return { cookies: () => ({ get: () => undefined }) };
  if (id === "./signalStore") return {};
  if (id === "./accountConnections") return {};
  return require(id);
};
copy._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
const { sealFyers, openFyers } = copy.exports;
test("FYERS credentials encrypt, decrypt and use a unique IV", () => {
  process.env.ALGO_CONNECTION_ENCRYPTION_KEY = "unit-test-only-encryption-key";
  const value = { appId: "test-100", secret: "fake-secret", accessToken: "fake-token" };
  const sealed = sealFyers(value);
  assert.deepEqual(openFyers(sealed), value);
  assert.notEqual(sealFyers(value), sealed);
  assert.equal(sealed.includes("fake-secret"), false);
});
test("modified ciphertext and wrong encryption key fail closed", () => {
  process.env.ALGO_CONNECTION_ENCRYPTION_KEY = "unit-test-only-encryption-key";
  const sealed = sealFyers({ appId: "test-100", secret: "fake" });
  const bytes = Buffer.from(sealed, "base64url"); bytes[30] ^= 1;
  assert.throws(() => openFyers(bytes.toString("base64url")));
  process.env.ALGO_CONNECTION_ENCRYPTION_KEY = "another-test-key";
  assert.throws(() => openFyers(sealed));
});
