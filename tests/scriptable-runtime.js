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
  const alerts = [];
  const alertResponses = Array.isArray(options.alertResponses)
    ? options.alertResponses.map((response) => clone(response))
    : [];
  const fileManager = new TestFileManager(documentsDirectory);
  const keychainValues = clone(options.keychainValues || {});
  const keychainFailures = {
    contains: Boolean(options.keychainFailures?.contains),
    get: Boolean(options.keychainFailures?.get),
    set: Boolean(options.keychainFailures?.set),
    remove: Boolean(options.keychainFailures?.remove)
  };
  const scriptState = {
    completed: false,
    widget: null
  };

  WebView.instances = [];

  /**
   * 按测试选项注入 Keychain 操作失败。
   *
   * 使用场景：验证生产脚本在 Scriptable 安全存储不可用时的回退逻辑。入参为
   * `contains`、`get`、`set` 或 `remove`；无返回值。仅当对应布尔开关为 true 时
   * 抛出固定错误，调用方应自行处理该异常。
   */
  function throwKeychainFailure(operation) {
    // 每种操作独立注入失败，保证测试能精确覆盖不同的安全存储异常分支。
    if (keychainFailures[operation]) {
      throw new Error(`Mock Keychain ${operation} failed`);
    }
  }

  const Keychain = {
    /**
     * 查询当前隔离存储是否存在指定键。
     *
     * 使用场景：Scriptable 脚本在读取前判断配置是否已保存。入参为字符串键名，
     * 返回布尔值；故障注入开启时抛出固定测试错误。
     */
    contains(key) {
      throwKeychainFailure("contains");
      return Object.hasOwn(keychainValues, key);
    },

    /**
     * 读取当前隔离存储中的指定值。
     *
     * 使用场景：加载已保存的敏感配置。入参为字符串键名，返回对应值；键不存在时
     * 抛出 `Missing keychain value`，故障注入开启时优先抛出固定测试错误。
     */
    get(key) {
      throwKeychainFailure("get");
      // 与真实安全存储一样，缺失值不是空字符串，调用方必须显式处理该异常。
      if (!Object.hasOwn(keychainValues, key)) {
        throw new Error("Missing keychain value");
      }
      return keychainValues[key];
    },

    /**
     * 在本次 runtime 调用隔离的安全存储中写入值。
     *
     * 使用场景：保存配置向导已校验的用户输入。入参为键名和值，无返回值；故障
     * 注入开启时不写入并抛出固定测试错误。
     */
    set(key, value) {
      throwKeychainFailure("set");
      keychainValues[key] = value;
    },

    /**
     * 从本次 runtime 调用隔离的安全存储中移除指定键。
     *
     * 使用场景：清除或迁移过期配置。入参为键名，无返回值；不存在的键按 JavaScript
     * `delete` 语义静默处理，故障注入开启时抛出固定测试错误。
     */
    remove(key) {
      throwKeychainFailure("remove");
      delete keychainValues[key];
    }
  };

  class Alert {
    /**
     * 创建可观测的 Scriptable Alert 实例。
     *
     * 使用场景：模拟配置、确认和错误提示等原生弹窗。无入参；实例保存标题、消息、
     * 动作和文本框，展示时把不可变快照写入 runtime 结果。
     */
    constructor() {
      this.title = "";
      this.message = "";
      this.actions = [];
      this.cancelAction = null;
      this.textFields = [];
      this.response = null;
    }

    /**
     * 添加普通确认动作。
     *
     * 使用场景：为 Alert 或 Action Sheet 注册可选择的业务动作。入参为动作标题，
     * 无返回值；标题按传入值保留，展示时由响应中的 index 选择。
     */
    addAction(title) {
      this.actions.push(title);
    }

    /**
     * 添加取消动作。
     *
     * 使用场景：允许用户退出当前提示。入参为取消动作标题，无返回值；无论传入的
     * 取消响应形式如何，展示方法统一返回 -1。
     */
    addCancelAction(title) {
      this.cancelAction = title;
    }

    /**
     * 添加普通文本输入框。
     *
     * 使用场景：收集 API 地址等可见配置。入参分别为占位文本和初始值，无返回值；
     * 展示后的值由当前编排响应的 `textFields` 覆盖。
     */
    addTextField(placeholder = "", value = "") {
      this.textFields.push({ placeholder, value });
    }

    /**
     * 添加安全文本输入框。
     *
     * 使用场景：收集 API Key 等敏感配置。入参分别为占位文本和初始值，无返回值；
     * 记录 `secure` 标记以便测试验证字段类型，实际返回值规则与普通文本框一致。
     */
    addSecureTextField(placeholder = "", value = "") {
      this.textFields.push({ placeholder, secure: true, value });
    }

    /**
     * 以 Alert 样式展示当前实例并获取编排响应。
     *
     * 使用场景：模拟 Scriptable 的 `presentAlert()`。无入参，返回 Promise<number>；
     * 响应不足时抛出 `Missing alert response`，取消或无效 index 统一解析为 -1。
     */
    presentAlert() {
      return this.present("alert");
    }

    /**
     * 以 Action Sheet 样式展示当前实例并获取编排响应。
     *
     * 使用场景：模拟 Scriptable 的 `presentSheet()`。无入参，返回 Promise<number>；
     * 响应不足时抛出 `Missing alert response`，取消或无效 index 统一解析为 -1。
     */
    presentSheet() {
      return this.present("sheet");
    }

    /**
     * 返回当前已展示响应中指定文本框的输入值。
     *
     * 使用场景：用户选择保存动作后读取配置表单。入参为从 0 开始的字段索引，
     * 返回对应响应值或 undefined；未展示前不返回初始值，避免把默认值误认为输入。
     */
    textFieldValue(index) {
      return this.response?.textFields?.[index];
    }

    /**
     * 消费一次编排响应并保存当前弹窗的展示快照。
     *
     * 使用场景：供两种展示 API 统一执行，入参为 `alert` 或 `sheet` 展示类型，
     * 返回 Promise<number>。每次调用严格消费一个响应；响应不足或消费到取消响应时
     * 分别抛错或返回 -1，避免测试静默选择默认动作。
     */
    async present(presentation) {
      // 不允许没有测试编排的交互继续执行，否则会掩盖遗漏的配置向导分支。
      if (alertResponses.length === 0) {
        throw new Error("Missing alert response");
      }

      const response = alertResponses.shift();
      this.response = response && typeof response === "object" ? response : {};
      alerts.push({
        actions: clone(this.actions),
        cancelAction: this.cancelAction,
        message: this.message,
        presentation,
        textFields: clone(this.textFields),
        title: this.title
      });

      // Scriptable 仅用非负整数代表动作下标，所有取消或异常响应都统一映射为 -1。
      return Number.isInteger(this.response.index) && this.response.index >= 0
        ? this.response.index
        : -1;
    }
  }

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
    Alert,
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
    Keychain,
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
    alerts: clone(alerts),
    documentsDirectory,
    keychain: clone(keychainValues),
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
