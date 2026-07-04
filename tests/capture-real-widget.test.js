const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  DEFAULT_RELOAD_WAIT_MS,
  FULL_COLOR_WIDGET_APPEARANCE,
  isNotificationCenterOwner,
  isScriptableRunScriptWidget,
  parseArgs,
  printWindow,
  selectWindows,
  sortWidgetWindows,
  widgetFilename
} = require("../scripts/capture-real-widget");

function windowInfo(overrides = {}) {
  return {
    id: 28,
    owner: "通知中心",
    name: "Run Script",
    layer: -2147483601,
    alpha: 1,
    bounds: {
      x: 2119,
      y: 595,
      width: 360,
      height: 180
    },
    ...overrides
  };
}

test("识别中英文通知中心窗口所有者", () => {
  assert.equal(isNotificationCenterOwner("通知中心"), true);
  assert.equal(isNotificationCenterOwner("Notification Center"), true);
  assert.equal(isNotificationCenterOwner("NotificationCenter"), true);
  assert.equal(isNotificationCenterOwner("UserNotificationCenter"), false);
});

test("只匹配通知中心里的 Run Script widget 窗口", () => {
  assert.equal(isScriptableRunScriptWidget(windowInfo()), true);
  assert.equal(isScriptableRunScriptWidget(windowInfo({ owner: "Codex" })), false);
  assert.equal(isScriptableRunScriptWidget(windowInfo({ name: "天气预报" })), false);
  assert.equal(isScriptableRunScriptWidget(windowInfo({ alpha: 0 })), false);
  assert.equal(isScriptableRunScriptWidget(windowInfo({
    bounds: { x: 0, y: 0, width: 64, height: 64 }
  })), false);
});

test("widget 窗口按屏幕位置稳定排序", () => {
  const windows = [
    windowInfo({ id: 29, bounds: { x: 2119, y: 775, width: 360, height: 180 } }),
    windowInfo({ id: 28, bounds: { x: 2119, y: 595, width: 360, height: 180 } }),
    windowInfo({ id: 30, bounds: { x: 2299, y: 595, width: 180, height: 180 } })
  ];

  assert.deepEqual(sortWidgetWindows(windows).map((item) => item.id), [28, 30, 29]);
});

test("可以按窗口 ID 选择单个窗口", () => {
  const selected = selectWindows([
    windowInfo({ id: 28 }),
    windowInfo({ id: 29 })
  ], 29);

  assert.equal(selected.length, 1);
  assert.equal(selected[0].id, 29);
});

test("解析 CLI 参数", () => {
  const options = parseArgs([
    "--out", "tmp/widgets",
    "--prefix", "runtime",
    "--reload",
    "--full-color",
    "--window-id", "29"
  ], "/repo");

  assert.equal(options.outputDir, path.resolve("/repo", "tmp/widgets"));
  assert.equal(options.prefix, "runtime");
  assert.equal(options.reload, true);
  assert.equal(options.fullColor, true);
  assert.equal(options.waitMs, DEFAULT_RELOAD_WAIT_MS);
  assert.equal(options.windowId, 29);
  assert.equal(FULL_COLOR_WIDGET_APPEARANCE, 1);
});

test("多窗口输出文件名包含序号和窗口 ID", () => {
  assert.equal(widgetFilename("real-widget", 0, 1, 28), "real-widget.png");
  assert.equal(widgetFilename("real-widget", 1, 2, 29), "real-widget-02-window-29.png");
});

test("窗口列表输出包含关键定位信息", () => {
  assert.equal(
    printWindow(windowInfo({ id: 29 }), 1),
    "[2] id=29 owner=通知中心 name=Run Script bounds=360x180+2119+595"
  );
});
