const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DEFAULT_OUTPUT_DIR = "test-results";
const DEFAULT_PREFIX = "iphone-screen";
const DEFAULT_XCODE_APP = "/Applications/Xcode.app";
const DEFAULT_UVX = "/opt/homebrew/bin/uvx";
const DEFAULT_IDEVICE_ID = "/opt/homebrew/bin/idevice_id";

function usage() {
  return [
    "用法: node scripts/capture-iphone-screen.js [options]",
    "",
    "选项:",
    `  --out <dir>          输出目录，默认 ${DEFAULT_OUTPUT_DIR}`,
    `  --prefix <name>      PNG 文件名前缀，默认 ${DEFAULT_PREFIX}`,
    "  --udid <udid>       指定 iPhone UDID，默认使用第一台 USB 设备",
    `  --xcode <path>      Xcode.app 路径，默认 ${DEFAULT_XCODE_APP}`,
    "  --skip-mount        跳过 Developer Disk Image 自动挂载",
    "  --reveal-dev-mode   如果开发者模式关闭，尝试在 iPhone 设置里显示该选项",
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
    udid: null,
    xcodeApp: DEFAULT_XCODE_APP,
    skipMount: false,
    revealDeveloperMode: false,
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
    else if (arg === "--udid") {
      options.udid = readValue(argv, i, arg);
      i += 1;
    }
    else if (arg === "--xcode") {
      options.xcodeApp = readValue(argv, i, arg);
      i += 1;
    }
    else if (arg === "--skip-mount") {
      options.skipMount = true;
    }
    else if (arg === "--reveal-dev-mode") {
      options.revealDeveloperMode = true;
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

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    ...options
  });

  if (result.error) {
    throw result.error;
  }

  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error([stdout, stderr].filter(Boolean).join("\n").trim() || `${command} 执行失败`);
  }

  return {
    status: result.status,
    stdout,
    stderr
  };
}

function firstUsbDeviceUdid() {
  const result = run(DEFAULT_IDEVICE_ID, ["-l"]);
  const udids = result.stdout
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (udids.length === 0) {
    throw new Error("没有找到通过 USB 连接并已信任的 iPhone。");
  }
  return udids[0];
}

function pymobiledevice3(args, options = {}) {
  return run(DEFAULT_UVX, ["pymobiledevice3", ...args], options);
}

function queryDeveloperMode(udid) {
  const result = pymobiledevice3([
    "mounter",
    "query-developer-mode-status",
    "--udid",
    udid
  ]);
  return result.stdout.trim() === "true";
}

function revealDeveloperMode(udid) {
  pymobiledevice3([
    "amfi",
    "reveal-developer-mode",
    "--udid",
    udid
  ]);
}

function autoMountDeveloperDiskImage(udid, xcodeApp) {
  return pymobiledevice3([
    "mounter",
    "auto-mount",
    "--udid",
    udid,
    "--userspace",
    "--xcode",
    xcodeApp
  ]);
}

function captureScreenshot(udid, outputPath) {
  return pymobiledevice3([
    "developer",
    "screenshot",
    "--udid",
    udid,
    "--userspace",
    outputPath
  ]);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function outputPathFor(options) {
  return path.join(options.outputDir, `${options.prefix}-${timestamp()}.png`);
}

function captureIphoneScreen(options) {
  const udid = options.udid || firstUsbDeviceUdid();
  const developerModeEnabled = queryDeveloperMode(udid);

  if (!developerModeEnabled) {
    if (options.revealDeveloperMode) {
      revealDeveloperMode(udid);
    }
    throw new Error([
      "iPhone Developer Mode 当前是关闭状态，无法通过 USB 抓取真实屏幕截图。",
      options.revealDeveloperMode ? "已经尝试让 iPhone 设置里显示“开发者模式”入口。" : "如需显示入口，可先运行 `npm run capture:iphone -- --reveal-dev-mode`。",
      "请在 iPhone 上打开：设置 -> 隐私与安全性 -> 开发者模式，开启后按提示重启并确认。",
      "完成后保持 iPhone 停在负一屏，再重新运行 `npm run capture:iphone`。"
    ].join("\n"));
  }

  if (!options.skipMount) {
    console.log("挂载 Developer Disk Image...");
    autoMountDeveloperDiskImage(udid, options.xcodeApp);
  }

  fs.mkdirSync(options.outputDir, { recursive: true });
  const png = outputPathFor(options);
  console.log("抓取 iPhone 当前屏幕...");
  captureScreenshot(udid, png);

  const stats = fs.statSync(png);
  if (stats.size === 0) {
    throw new Error(`截图文件为空: ${png}`);
  }

  const manifestPath = path.join(options.outputDir, `${options.prefix}-manifest.json`);
  fs.writeFileSync(manifestPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    command: "node scripts/capture-iphone-screen.js",
    udid,
    developerModeEnabled,
    outputPath: png,
    bytes: stats.size
  }, null, 2), "utf8");

  console.log(`已保存截图: ${png}`);
  console.log(`已写入清单: ${manifestPath}`);

  return {
    udid,
    outputPath: png,
    manifestPath,
    bytes: stats.size
  };
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      process.exit(0);
    }
    captureIphoneScreen(options);
  }
  catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}

module.exports = {
  DEFAULT_OUTPUT_DIR,
  DEFAULT_PREFIX,
  DEFAULT_XCODE_APP,
  parseArgs,
  outputPathFor
};
