const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const DEFAULT_OUTPUT_DIR = "test-results";
const DEFAULT_PREFIX = "real-widget";
const DEFAULT_RELOAD_WAIT_MS = 3000;
const FULL_COLOR_WIDGET_APPEARANCE = 1;

const WINDOW_LIST_SWIFT = `
import CoreGraphics
import Foundation

struct Bounds: Codable {
  let x: Double
  let y: Double
  let width: Double
  let height: Double
}

struct WindowInfo: Codable {
  let id: UInt32
  let owner: String
  let name: String
  let layer: Int
  let alpha: Double
  let bounds: Bounds
}

func number(_ value: Any?) -> Double {
  if let value = value as? NSNumber {
    return value.doubleValue
  }
  return 0
}

let options = CGWindowListOption(arrayLiteral: .optionAll)
let rawWindows = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] ?? []
let windows = rawWindows.compactMap { item -> WindowInfo? in
  guard let id = item[kCGWindowNumber as String] as? UInt32 else {
    return nil
  }
  let owner = item[kCGWindowOwnerName as String] as? String ?? ""
  let name = item[kCGWindowName as String] as? String ?? ""
  let layer = item[kCGWindowLayer as String] as? Int ?? 0
  let alpha = number(item[kCGWindowAlpha as String])
  let rawBounds = item[kCGWindowBounds as String] as? [String: Any] ?? [:]
  let bounds = Bounds(
    x: number(rawBounds["X"]),
    y: number(rawBounds["Y"]),
    width: number(rawBounds["Width"]),
    height: number(rawBounds["Height"])
  )
  return WindowInfo(id: id, owner: owner, name: name, layer: layer, alpha: alpha, bounds: bounds)
}

let encoder = JSONEncoder()
encoder.outputFormatting = [.sortedKeys]
let data = try encoder.encode(windows)
FileHandle.standardOutput.write(data)
`;

const RELOAD_WIDGET_SWIFT = `
import Foundation
import WidgetKit

WidgetCenter.shared.reloadTimelines(ofKind: "RunScriptWidget")
WidgetCenter.shared.reloadAllTimelines()
RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
print("requested widget reload")
`;

function usage() {
  return [
    "用法: node scripts/capture-real-widget.js [options]",
    "",
    "选项:",
    `  --out <dir>          输出目录，默认 ${DEFAULT_OUTPUT_DIR}`,
    `  --prefix <name>      PNG 文件名前缀，默认 ${DEFAULT_PREFIX}`,
    "  --reload            截图前请求 WidgetKit 刷新 RunScriptWidget",
    "  --full-color        截图期间临时切换为彩色 widget，结束后恢复原设置",
    `  --wait-ms <ms>       --reload 后等待毫秒数，默认 ${DEFAULT_RELOAD_WAIT_MS}`,
    "  --window-id <id>     只截取指定 WindowServer 窗口 ID",
    "  --list              只列出匹配到的真实 widget 窗口，不截图",
    "  --help              显示帮助"
  ].join("\n");
}

function readValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} 需要一个值`);
  }
  return value;
}

function parseArgs(argv, cwd = process.cwd()) {
  const options = {
    outputDir: path.resolve(cwd, DEFAULT_OUTPUT_DIR),
    prefix: DEFAULT_PREFIX,
    reload: false,
    fullColor: false,
    waitMs: 0,
    windowId: null,
    list: false,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--out" || arg === "--output-dir") {
      options.outputDir = path.resolve(cwd, readValue(argv, i, arg));
      i += 1;
    }
    else if (arg === "--prefix") {
      options.prefix = readValue(argv, i, arg);
      i += 1;
    }
    else if (arg === "--reload") {
      options.reload = true;
      if (options.waitMs === 0) {
        options.waitMs = DEFAULT_RELOAD_WAIT_MS;
      }
    }
    else if (arg === "--full-color") {
      options.fullColor = true;
      if (options.waitMs === 0) {
        options.waitMs = DEFAULT_RELOAD_WAIT_MS;
      }
    }
    else if (arg === "--wait-ms") {
      const waitMs = Number.parseInt(readValue(argv, i, arg), 10);
      if (!Number.isFinite(waitMs) || waitMs < 0) {
        throw new Error("--wait-ms 必须是非负整数");
      }
      options.waitMs = waitMs;
      i += 1;
    }
    else if (arg === "--window-id") {
      const windowId = Number.parseInt(readValue(argv, i, arg), 10);
      if (!Number.isFinite(windowId) || windowId <= 0) {
        throw new Error("--window-id 必须是正整数");
      }
      options.windowId = windowId;
      i += 1;
    }
    else if (arg === "--list") {
      options.list = true;
    }
    else if (arg === "--help" || arg === "-h") {
      options.help = true;
    }
    else {
      throw new Error(`未知参数: ${arg}`);
    }
  }

  return options;
}

function runSwift(source) {
  const result = spawnSync("swift", ["-"], {
    input: source,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "swift 执行失败").trim());
  }

  return result.stdout;
}

function listWindows() {
  const output = runSwift(WINDOW_LIST_SWIFT);
  return JSON.parse(output);
}

function isNotificationCenterOwner(owner) {
  const value = String(owner || "").toLowerCase();
  return value === "notification center" || value === "notificationcenter" || owner === "通知中心";
}

function isScriptableRunScriptWidget(windowInfo) {
  const bounds = windowInfo.bounds || {};
  return isNotificationCenterOwner(windowInfo.owner)
    && windowInfo.name === "Run Script"
    && windowInfo.alpha > 0
    && bounds.width >= 150
    && bounds.height >= 150;
}

function sortWidgetWindows(windows) {
  return [...windows].sort((a, b) => {
    const ay = a.bounds?.y ?? 0;
    const by = b.bounds?.y ?? 0;
    const ax = a.bounds?.x ?? 0;
    const bx = b.bounds?.x ?? 0;
    return ay - by || ax - bx || a.id - b.id;
  });
}

function widgetFilename(prefix, index, count, windowId) {
  if (count === 1) {
    return `${prefix}.png`;
  }
  return `${prefix}-${String(index + 1).padStart(2, "0")}-window-${windowId}.png`;
}

function wait(ms) {
  if (ms <= 0) {
    return;
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function reloadWidgetTimelines() {
  return runSwift(RELOAD_WIDGET_SWIFT).trim();
}

function readWidgetAppearance() {
  const result = spawnSync("defaults", ["read", "com.apple.widgets", "widgetAppearance"], {
    encoding: "utf8"
  });

  if (result.status !== 0) {
    return null;
  }

  const value = Number.parseInt(result.stdout.trim(), 10);
  return Number.isFinite(value) ? value : null;
}

function writeWidgetAppearance(value) {
  execFileSync("defaults", [
    "write",
    "com.apple.widgets",
    "widgetAppearance",
    "-int",
    String(value)
  ], {
    stdio: "pipe"
  });
}

function restoreWidgetAppearance(value) {
  if (value === null) {
    spawnSync("defaults", ["delete", "com.apple.widgets", "widgetAppearance"], {
      stdio: "ignore"
    });
  }
  else {
    writeWidgetAppearance(value);
  }
}

function captureWindow(windowInfo, outputPath) {
  execFileSync("screencapture", [
    "-x",
    "-t",
    "png",
    "-l",
    String(windowInfo.id),
    outputPath
  ], {
    stdio: "pipe"
  });

  const stats = fs.statSync(outputPath);
  if (stats.size === 0) {
    throw new Error(`截图文件为空: ${outputPath}`);
  }
  return stats.size;
}

function selectWindows(allWindows, windowId) {
  if (windowId) {
    const selected = allWindows.find((windowInfo) => windowInfo.id === windowId);
    if (!selected) {
      throw new Error(`没有找到 WindowServer 窗口 ID: ${windowId}`);
    }
    return [selected];
  }
  return sortWidgetWindows(allWindows.filter(isScriptableRunScriptWidget));
}

function printWindow(windowInfo, index = 0) {
  const bounds = windowInfo.bounds || {};
  const label = `[${index + 1}]`;
  return `${label} id=${windowInfo.id} owner=${windowInfo.owner} name=${windowInfo.name} bounds=${bounds.width}x${bounds.height}+${bounds.x}+${bounds.y}`;
}

function captureRealWidgets(options) {
  let originalWidgetAppearance = null;
  let changedWidgetAppearance = false;

  try {
    if (options.fullColor) {
      originalWidgetAppearance = readWidgetAppearance();
      writeWidgetAppearance(FULL_COLOR_WIDGET_APPEARANCE);
      changedWidgetAppearance = true;
      console.log(`临时切换 widgetAppearance: ${originalWidgetAppearance ?? "unset"} -> ${FULL_COLOR_WIDGET_APPEARANCE}`);
    }

    if (options.reload || options.fullColor) {
      const message = reloadWidgetTimelines();
      if (message) {
        console.log(message);
      }
      if (options.waitMs > 0) {
        console.log(`等待 WidgetKit 刷新 ${options.waitMs}ms...`);
        wait(options.waitMs);
      }
    }

    const allWindows = listWindows();
    const targets = selectWindows(allWindows, options.windowId);
    if (targets.length === 0) {
      throw new Error([
        "没有找到真实 Scriptable Run Script widget 窗口。",
        "请确认 macOS 桌面或通知中心里已经添加 Scriptable 的 Run Script widget。",
        "可以运行 `node scripts/capture-real-widget.js --list` 查看当前可捕获窗口。"
      ].join("\n"));
    }

    if (options.list) {
      targets.forEach((windowInfo, index) => console.log(printWindow(windowInfo, index)));
      return { windows: targets, captures: [] };
    }

    fs.mkdirSync(options.outputDir, { recursive: true });

    const captures = targets.map((windowInfo, index) => {
      const outputPath = path.join(
        options.outputDir,
        widgetFilename(options.prefix, index, targets.length, windowInfo.id)
      );
      const bytes = captureWindow(windowInfo, outputPath);
      console.log(`${printWindow(windowInfo, index)} -> ${outputPath}`);
      return { window: windowInfo, outputPath, bytes };
    });

    const manifestPath = path.join(options.outputDir, `${options.prefix}-manifest.json`);
    fs.writeFileSync(manifestPath, JSON.stringify({
      generatedAt: new Date().toISOString(),
      command: "node scripts/capture-real-widget.js",
      widgetAppearance: {
        fullColorRequested: options.fullColor,
        original: originalWidgetAppearance,
        temporary: options.fullColor ? FULL_COLOR_WIDGET_APPEARANCE : null
      },
      captures
    }, null, 2), "utf8");
    console.log(`已写入清单: ${manifestPath}`);

    return { windows: targets, captures, manifestPath };
  }
  finally {
    if (changedWidgetAppearance) {
      restoreWidgetAppearance(originalWidgetAppearance);
      console.log(`已恢复 widgetAppearance: ${originalWidgetAppearance ?? "unset"}`);
      reloadWidgetTimelines();
    }
  }
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      process.exit(0);
    }
    captureRealWidgets(options);
  }
  catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}

module.exports = {
  DEFAULT_OUTPUT_DIR,
  DEFAULT_PREFIX,
  DEFAULT_RELOAD_WAIT_MS,
  FULL_COLOR_WIDGET_APPEARANCE,
  parseArgs,
  isNotificationCenterOwner,
  isScriptableRunScriptWidget,
  sortWidgetWindows,
  widgetFilename,
  selectWindows,
  printWindow
};
