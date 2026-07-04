const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  DEFAULT_WIDGET_PREFIX,
  isIphoneMirroringOwner,
  isIphoneMirroringWindow,
  outputPathFor,
  parseArgs,
  selectWindows,
  sortMirroringWindows
} = require("../scripts/capture-iphone-mirroring");

function windowInfo(overrides = {}) {
  return {
    id: 7543,
    owner: "iPhone镜像",
    name: "iPhone镜像",
    layer: 0,
    alpha: 1,
    bounds: {
      x: 213,
      y: 339,
      width: 456,
      height: 1002
    },
    ...overrides
  };
}

test("识别中英文 iPhone 镜像窗口所有者", () => {
  assert.equal(isIphoneMirroringOwner("iPhone镜像"), true);
  assert.equal(isIphoneMirroringOwner("iPhone Mirroring"), true);
  assert.equal(isIphoneMirroringOwner("ScreenContinuity"), true);
  assert.equal(isIphoneMirroringOwner("Codex"), false);
});

test("只匹配纵向 iPhone 镜像主窗口", () => {
  assert.equal(isIphoneMirroringWindow(windowInfo()), true);
  assert.equal(isIphoneMirroringWindow(windowInfo({ owner: "Codex" })), false);
  assert.equal(isIphoneMirroringWindow(windowInfo({ alpha: 0 })), false);
  assert.equal(isIphoneMirroringWindow(windowInfo({
    name: "欢迎使用iPhone镜像",
    bounds: { x: 930, y: 405, width: 640, height: 662 }
  })), false);
});

test("按窗口面积选择最可能的镜像主窗口", () => {
  const selected = selectWindows([
    windowInfo({ id: 1, bounds: { x: 0, y: 0, width: 54, height: 54 } }),
    windowInfo({ id: 2 }),
    windowInfo({
      id: 3,
      bounds: { x: 200, y: 200, width: 320, height: 700 }
    })
  ]);

  assert.deepEqual(selected.map((item) => item.id), [2, 3]);
  assert.deepEqual(sortMirroringWindows(selected).map((item) => item.id), [2, 3]);
});

test("解析 iPhone 镜像截图 CLI 参数", () => {
  const options = parseArgs([
    "--out", "tmp/mirror",
    "--prefix", "today",
    "--window-id", "7543",
    "--widget-index", "2"
  ], "/repo");

  assert.equal(options.outputDir, path.resolve("/repo", "tmp/mirror"));
  assert.equal(options.prefix, "today");
  assert.equal(options.windowId, 7543);
  assert.equal(options.cropWidget, true);
  assert.equal(options.widgetIndex, 2);
  assert.equal(DEFAULT_WIDGET_PREFIX, "iphone-widget");
});

test("输出路径包含前缀、窗口序号和 PNG 后缀", () => {
  const options = parseArgs(["--out", "tmp", "--prefix", "mirror"], "/repo");
  const outputPath = outputPathFor(options, windowInfo({ id: 7543 }), 2, 0);

  assert.equal(path.dirname(outputPath), path.resolve("/repo", "tmp"));
  assert.equal(path.basename(outputPath).startsWith("mirror-01-window-7543-"), true);
  assert.equal(path.extname(outputPath), ".png");
});
