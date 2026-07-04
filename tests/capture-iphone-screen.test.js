const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  DEFAULT_XCODE_APP,
  parseArgs,
  outputPathFor
} = require("../scripts/capture-iphone-screen");

test("解析 iPhone 截图 CLI 参数", () => {
  const options = parseArgs([
    "--out", "tmp/iphone",
    "--prefix", "today-view",
    "--udid", "00008150",
    "--xcode", "/Applications/Xcode.app",
    "--skip-mount",
    "--reveal-dev-mode"
  ], "/repo");

  assert.equal(options.outputDir, path.resolve("/repo", "tmp/iphone"));
  assert.equal(options.prefix, "today-view");
  assert.equal(options.udid, "00008150");
  assert.equal(options.xcodeApp, "/Applications/Xcode.app");
  assert.equal(options.skipMount, true);
  assert.equal(options.revealDeveloperMode, true);
});

test("iPhone 截图默认使用 Xcode.app 和 test-results", () => {
  const options = parseArgs([], "/repo");

  assert.equal(options.outputDir, path.resolve("/repo", "test-results"));
  assert.equal(options.prefix, "iphone-screen");
  assert.equal(options.xcodeApp, DEFAULT_XCODE_APP);
});

test("iPhone 截图输出路径包含前缀和 PNG 后缀", () => {
  const options = parseArgs(["--out", "tmp", "--prefix", "iphone"], "/repo");
  const outputPath = outputPathFor(options);

  assert.equal(path.dirname(outputPath), path.resolve("/repo", "tmp"));
  assert.equal(path.basename(outputPath).startsWith("iphone-"), true);
  assert.equal(path.extname(outputPath), ".png");
});
