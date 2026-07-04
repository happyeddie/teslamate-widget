const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class Size {
  constructor(width, height) {
    this.width = width;
    this.height = height;
  }
}

class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}

class Rect {
  constructor(x, y, width, height) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
  }
}

class Color {
  constructor(hex, alpha = 1) {
    this.hex = hex;
    this.alpha = alpha;
  }

  static black() { return new Color("#000000"); }
  static blue() { return new Color("#0000ff"); }
  static gray() { return new Color("#808080"); }
  static green() { return new Color("#00aa00"); }
  static lightGray() { return new Color("#d3d3d3"); }
  static red() { return new Color("#ff0000"); }
  static white() { return new Color("#ffffff"); }
  static yellow() { return new Color("#ffff00"); }
}

class Font {
  static mediumSystemFont(size) { return { family: "system", weight: "medium", size }; }
  static regularMonospacedSystemFont(size) { return { family: "monospace", weight: "regular", size }; }
}

class Image {
  constructor(meta = {}) {
    this.meta = meta;
  }

  static fromData(data) {
    return new Image({ kind: "data", data });
  }
}

class Data {
  static fromBase64String(value) {
    return { kind: "base64", length: value.length };
  }
}

class Path {
  constructor() {
    this.operations = [];
  }

  addRoundedRect(rect, width, height) {
    this.operations.push({ op: "addRoundedRect", rect, width, height });
  }

  addLines(points) {
    this.operations.push({ op: "addLines", points });
  }
}

class DrawContext {
  constructor() {
    this.operations = [];
    this.opaque = true;
    this.size = null;
  }

  record(op, payload = {}) {
    this.operations.push({ op, ...payload });
  }

  addPath(pathValue) { this.record("addPath", { path: pathValue }); }
  drawImageAtPoint(image, point) { this.record("drawImageAtPoint", { image, point }); }
  drawText(text, point) { this.record("drawText", { text, point }); }
  fillEllipse(rect) { this.record("fillEllipse", { rect }); }
  fillPath() { this.record("fillPath"); }
  setFillColor(color) { this.record("setFillColor", { color }); }
  setFont(font) { this.record("setFont", { font }); }
  setLineWidth(width) { this.record("setLineWidth", { width }); }
  setStrokeColor(color) { this.record("setStrokeColor", { color }); }
  setTextAlignedCenter() { this.record("setTextAlignedCenter"); }
  setTextColor(color) { this.record("setTextColor", { color }); }
  strokeEllipse(rect) { this.record("strokeEllipse", { rect }); }

  getImage() {
    return new Image({
      kind: "draw-context",
      opaque: this.opaque,
      size: this.size,
      operations: this.operations
    });
  }
}

class WidgetElement {
  constructor(type, value) {
    this.type = type;
    this.children = [];
    if (value !== undefined) {
      this.value = value;
    }
  }

  addDate(date) {
    const child = new WidgetElement("date", date.toISOString());
    this.children.push(child);
    return child;
  }

  addImage(image) {
    const child = new WidgetElement("image", image);
    this.children.push(child);
    return child;
  }

  addSpacer(length = null) {
    const child = new WidgetElement("spacer", length);
    this.children.push(child);
    return child;
  }

  addStack() {
    const child = new WidgetElement("stack");
    this.children.push(child);
    return child;
  }

  addText(text) {
    const child = new WidgetElement("text", text);
    child.text = text;
    this.children.push(child);
    return child;
  }

  applyTimerStyle() { this.timerStyle = true; }
  bottomAlignContent() { this.verticalAlignment = "bottom"; }
  centerAlignContent() { this.verticalAlignment = "center"; }
  centerAlignImage() { this.horizontalAlignment = "center"; }
  applyFillingContentMode() { this.contentMode = "fill"; }
  applyFittingContentMode() { this.contentMode = "fit"; }
  leftAlignText() { this.textAlignment = "left"; }
  layoutHorizontally() { this.layout = "horizontal"; }
  layoutVertically() { this.layout = "vertical"; }
  rightAlignImage() { this.horizontalAlignment = "right"; }
  rightAlignText() { this.textAlignment = "right"; }
  setPadding(top, leading, bottom, trailing) {
    this.padding = { top, leading, bottom, trailing };
  }
  topAlignContent() { this.verticalAlignment = "top"; }
  useDefaultPadding() { this.padding = "default"; }
}

class ListWidget extends WidgetElement {
  constructor() {
    super("widget");
  }

  presentAccessoryCircular() {
    this.presented = "accessoryCircular";
    return Promise.resolve();
  }

  presentAccessoryInline() {
    this.presented = "accessoryInline";
    return Promise.resolve();
  }

  presentAccessoryRectangular() {
    this.presented = "accessoryRectangular";
    return Promise.resolve();
  }

  presentMedium() {
    this.presented = "medium";
    return Promise.resolve();
  }

  presentSmall() {
    this.presented = "small";
    return Promise.resolve();
  }
}

class TestFileManager {
  constructor(documentsDirectory) {
    this.documents = documentsDirectory;
  }

  cacheDirectory() { return path.join(this.documents, ".cache"); }
  createDirectory(filePath) { fs.mkdirSync(filePath, { recursive: true }); }
  documentsDirectory() { return this.documents; }
  fileExists(filePath) { return fs.existsSync(filePath); }
  isDirectory(filePath) {
    return fs.existsSync(filePath) && fs.statSync(filePath).isDirectory();
  }
  joinPath(lhsPath, rhsPath) { return path.join(lhsPath, rhsPath); }
  readImage(filePath) {
    return new Image({ kind: "file", path: filePath });
  }
  readString(filePath) { return fs.readFileSync(filePath, "utf8"); }
  temporaryDirectory() { return os.tmpdir(); }
  writeImage(filePath, image) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(image.meta));
  }
  writeString(filePath, content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf8");
  }
}

class WebView {
  constructor() {
    this.loadedURL = null;
    this.evaluatedJavaScript = [];
    this.presented = false;
    WebView.instances.push(this);
  }

  async evaluateJavaScript(source) {
    this.evaluatedJavaScript.push(source);
    return null;
  }

  async loadURL(url) {
    this.loadedURL = url;
  }

  present() {
    this.presented = true;
  }
}
WebView.instances = [];

function serialize(value) {
  return JSON.parse(JSON.stringify(value, (key, item) => {
    if (item instanceof Date) {
      return item.toISOString();
    }
    return item;
  }));
}

async function runScriptableScript(options = {}) {
  const scriptPath = options.scriptPath || path.join(__dirname, "..", "Telsa Car.js");
  const source = fs.readFileSync(scriptPath, "utf8");
  const documentsDirectory = options.documentsDirectory || fs.mkdtempSync(path.join(os.tmpdir(), "scriptable-docs-"));
  const requestLog = [];
  const logs = [];
  const fileManager = new TestFileManager(documentsDirectory);
  const scriptState = {
    completed: false,
    widget: null
  };

  WebView.instances = [];

  class Request {
    constructor(url) {
      this.url = url;
      this.method = "GET";
      this.headers = {};
      this.timeoutInterval = 60;
      requestLog.push(this);
    }

    async loadImage() {
      if (options.failImages) {
        throw new Error("Mock image request failed");
      }
      return new Image({ kind: "remote", url: this.url });
    }

    async loadJSON() {
      if (options.failJSON) {
        throw new Error("Mock JSON request failed");
      }
      if (typeof options.jsonResponse === "function") {
        return options.jsonResponse(this);
      }
      return clone(options.jsonResponse);
    }
  }

  const sandbox = {
    args: { widgetParameter: options.widgetParameter || "" },
    config: {
      runsInActionExtension: false,
      runsInApp: Boolean(options.runsInApp),
      runsInAccessoryWidget: Boolean(options.runsInAccessoryWidget),
      runsInNotification: false,
      runsInWidget: Boolean(options.runsInAccessoryWidget || options.runsInWidget),
      widgetFamily: options.widgetFamily || null
    },
    console: {
      log: (...args) => logs.push(args.map(String).join(" "))
    },
    Color,
    Data,
    DrawContext,
    FileManager: {
      local: () => fileManager,
      iCloud: () => fileManager
    },
    Font,
    Image,
    ListWidget,
    Location: {
      reverseGeocode: async () => options.reverseGeocode || [{ name: "上海超级充电站", thoroughfare: "世纪大道" }]
    },
    Path,
    Point,
    Rect,
    Request,
    SFSymbol: {
      named: (name) => ({ name, image: new Image({ kind: "sf-symbol", name }) })
    },
    Script: {
      complete: () => {
        scriptState.completed = true;
      },
      name: () => "Telsa Car",
      setWidget: (widget) => {
        scriptState.widget = widget;
      }
    },
    Size,
    WebView,
    encodeURI
  };

  const context = vm.createContext(sandbox);
  const wrapped = `(async () => {\n${source}\n})()`;
  await new vm.Script(wrapped, { filename: scriptPath }).runInContext(context, { timeout: 5000 });

  return {
    documentsDirectory,
    logs,
    requests: requestLog.map((request) => ({
      url: request.url,
      method: request.method,
      headers: request.headers,
      timeoutInterval: request.timeoutInterval
    })),
    script: scriptState,
    webViews: WebView.instances.map((webView) => serialize(webView)),
    widget: scriptState.widget ? serialize(scriptState.widget) : null
  };
}

function collectByType(node, type, result = []) {
  if (!node) {
    return result;
  }
  if (node.type === type) {
    result.push(node);
  }
  for (const child of node.children || []) {
    collectByType(child, type, result);
  }
  return result;
}

module.exports = {
  collectByType,
  runScriptableScript
};
