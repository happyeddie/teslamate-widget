const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const DEFAULT_OUTPUT_DIR = "test-results";
const DEFAULT_PREFIX = "iphone-mirroring";
const DEFAULT_WIDGET_PREFIX = "iphone-widget";

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

let rawWindows = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as? [[String: Any]] ?? []
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
FileHandle.standardOutput.write(try encoder.encode(windows))
`;

function usage() {
  return [
    "用法: node scripts/capture-iphone-mirroring.js [options]",
    "",
    "选项:",
    `  --out <dir>          输出目录，默认 ${DEFAULT_OUTPUT_DIR}`,
    `  --prefix <name>      PNG 文件名前缀，默认 ${DEFAULT_PREFIX}`,
    "  --window-id <id>     只截取指定 WindowServer 窗口 ID",
    "  --crop-widget        从镜像截图中裁剪 TeslaMate 中号 widget",
    "  --widget-index <n>   只输出第 n 个检测到的 TeslaMate widget，默认输出全部",
    "  --list              只列出匹配到的 iPhone 镜像窗口，不截图",
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
    windowId: null,
    cropWidget: false,
    widgetIndex: 0,
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
    else if (arg === "--window-id") {
      const windowId = Number.parseInt(readValue(argv, i, arg), 10);
      if (!Number.isFinite(windowId) || windowId <= 0) {
        throw new Error("--window-id 必须是正整数");
      }
      options.windowId = windowId;
      i += 1;
    }
    else if (arg === "--crop-widget") {
      options.cropWidget = true;
    }
    else if (arg === "--widget-index") {
      const widgetIndex = Number.parseInt(readValue(argv, i, arg), 10);
      if (!Number.isFinite(widgetIndex) || widgetIndex <= 0) {
        throw new Error("--widget-index 必须是正整数");
      }
      options.widgetIndex = widgetIndex;
      options.cropWidget = true;
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
  return JSON.parse(runSwift(WINDOW_LIST_SWIFT));
}

function compactText(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, "");
}

function isIphoneMirroringOwner(owner) {
  const value = compactText(owner);
  return value === "iphone镜像"
    || value === "iphonemirroring"
    || value === "screencontinuity";
}

function isIphoneMirroringWindow(windowInfo) {
  const bounds = windowInfo.bounds || {};
  const ratio = bounds.width > 0 ? bounds.height / bounds.width : 0;
  return isIphoneMirroringOwner(windowInfo.owner)
    && windowInfo.alpha > 0
    && bounds.width >= 250
    && bounds.height >= 500
    && ratio >= 1.5;
}

function sortMirroringWindows(windows) {
  return [...windows].sort((a, b) => {
    const areaA = (a.bounds?.width || 0) * (a.bounds?.height || 0);
    const areaB = (b.bounds?.width || 0) * (b.bounds?.height || 0);
    return areaB - areaA || a.id - b.id;
  });
}

function selectWindows(allWindows, windowId) {
  if (windowId) {
    const selected = allWindows.find((windowInfo) => windowInfo.id === windowId);
    if (!selected) {
      throw new Error(`没有找到 WindowServer 窗口 ID: ${windowId}`);
    }
    return [selected];
  }
  return sortMirroringWindows(allWindows.filter(isIphoneMirroringWindow));
}

function printWindow(windowInfo, index = 0) {
  const bounds = windowInfo.bounds || {};
  return `[${index + 1}] id=${windowInfo.id} owner=${windowInfo.owner} name=${windowInfo.name} bounds=${bounds.width}x${bounds.height}+${bounds.x}+${bounds.y}`;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function outputPathFor(options, windowInfo, count, index) {
  const suffix = count === 1 ? "" : `-${String(index + 1).padStart(2, "0")}-window-${windowInfo.id}`;
  return path.join(options.outputDir, `${options.prefix}${suffix}-${timestamp()}.png`);
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

function cropWidgets(imagePath, options) {
  const args = [
    path.join(__dirname, "crop-iphone-mirroring-widget.py"),
    imagePath,
    options.outputDir,
    "--prefix",
    DEFAULT_WIDGET_PREFIX
  ];
  if (options.widgetIndex) {
    args.push("--index", String(options.widgetIndex));
  }

  const result = spawnSync("python3", args, {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "widget 裁剪失败").trim());
  }

  const parsed = JSON.parse(result.stdout);
  if (!parsed.captures.length) {
    throw new Error([
      "没有从 iPhone 镜像截图中检测到 TeslaMate 中号 widget。",
      "请确认 iPhone Mirroring 当前已经连接，并且窗口里显示的是包含 TeslaMate widget 的负一屏。",
      "如果镜像窗口显示“连接暂停”，需要先恢复连接后再运行本命令。"
    ].join("\n"));
  }
  return parsed.captures;
}

function captureIphoneMirroring(options) {
  const allWindows = listWindows();
  const targets = selectWindows(allWindows, options.windowId);

  if (targets.length === 0) {
    throw new Error([
      "没有找到可捕获的 iPhone 镜像窗口。",
      "请先打开系统应用 iPhone Mirroring，并确保已经连接到 iPhone。",
      "可以运行 `node scripts/capture-iphone-mirroring.js --list` 查看当前窗口。"
    ].join("\n"));
  }

  if (options.list) {
    targets.forEach((windowInfo, index) => console.log(printWindow(windowInfo, index)));
    return { windows: targets, captures: [] };
  }

  fs.mkdirSync(options.outputDir, { recursive: true });
  const captures = targets.map((windowInfo, index) => {
    const outputPath = outputPathFor(options, windowInfo, targets.length, index);
    const bytes = captureWindow(windowInfo, outputPath);
    console.log(`${printWindow(windowInfo, index)} -> ${outputPath}`);
    const widgetCaptures = options.cropWidget ? cropWidgets(outputPath, options) : [];
    for (const widget of widgetCaptures) {
      console.log(`widget ${widget.index} -> ${widget.outputPath}`);
    }
    return { window: windowInfo, outputPath, bytes, widgetCaptures };
  });

  const manifestPath = path.join(options.outputDir, `${options.prefix}-manifest.json`);
  fs.writeFileSync(manifestPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    command: "node scripts/capture-iphone-mirroring.js",
    captures
  }, null, 2), "utf8");
  console.log(`已写入清单: ${manifestPath}`);

  return { windows: targets, captures, manifestPath };
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      process.exit(0);
    }
    captureIphoneMirroring(options);
  }
  catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}

module.exports = {
  DEFAULT_OUTPUT_DIR,
  DEFAULT_PREFIX,
  DEFAULT_WIDGET_PREFIX,
  parseArgs,
  isIphoneMirroringOwner,
  isIphoneMirroringWindow,
  sortMirroringWindows,
  selectWindows,
  outputPathFor,
  printWindow
};
