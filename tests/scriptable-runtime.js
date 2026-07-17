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

/**
 * 在隔离的 Node VM 中执行原始 Scriptable 脚本，并返回可供测试断言的运行快照。
 *
 * 使用场景：本项目的生产脚本依赖 iOS Scriptable 全局 API，无法直接在 Node 环境
 * 运行；测试通过本方法提供受控的 API stub、网络响应、文件目录和用户交互编排，验证
 * widget、缓存及配置流程的业务结果。入参 `options` 可覆盖脚本路径、documents
 * 目录、网络/定位响应、运行上下文，以及 `keychainValues`、`keychainFailures`、
 * `failImages` 和 `alertResponses`；未传入的可选项使用测试安全的默认值。
 * `keychainFailures.<operation>` 与 `failImages` 可传布尔值或 Error：true 使用向后兼容
 * 的固定 Mock Error，Error 实例则原样抛出，供安全测试携带虚构敏感信息。成功时返回
 * documents 路径、请求/日志/Widget/WebView 快照，以及最终 Keychain 和 Alert 观测
 * 结果；返回值均不持有内部可变集合。读取脚本、创建临时目录、VM 执行或被测脚本中的
 * 异常会原样向调用方抛出，交互响应不足也使用固定错误供测试精确断言。
 */
async function runScriptableScript(options = {}) {
  const scriptPath = options.scriptPath || path.join(__dirname, "..", "Telsa Car.js");
  const source = fs.readFileSync(scriptPath, "utf8");
  const documentsDirectory = options.documentsDirectory || fs.mkdtempSync(path.join(os.tmpdir(), "scriptable-docs-"));
  const requestLog = [];
  const logs = [];
  /**
   * 维护当前运行的用户交互状态和安全配置状态。
   *
   * 使用场景：配置向导测试既要模拟用户按顺序点击弹窗，也要在单个运行内读写敏感
   * 配置。入参来自 `options.alertResponses`、`options.keychainValues` 和
   * `options.keychainFailures`；`alerts` 与最终 Keychain 值会作为结果快照返回，
   * `alertResponses` 仅供消费而不返回。响应仅在数组输入时逐项克隆，否则按空队列
   * 处理：这是为了让缺失编排在 Alert 展示时抛出固定错误，而不是静默选取动作。
   * Keychain 失败配置被规整为完整的四个字段，保留调用方 Error 实例，并让未声明的
   * 操作使用 false；克隆初始值避免被测脚本修改调用方传入的配置对象。
   */
  const alerts = [];
  const alertResponses = Array.isArray(options.alertResponses)
    ? options.alertResponses.map((response) => clone(response))
    : [];
  const fileManager = new TestFileManager(documentsDirectory);
  const keychainValues = clone(options.keychainValues || {});
  const keychainFailures = {
    contains: options.keychainFailures?.contains || false,
    get: options.keychainFailures?.get || false,
    set: options.keychainFailures?.set || false,
    remove: options.keychainFailures?.remove || false
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
   * `contains`、`get`、`set` 或 `remove`；无返回值。对应配置为 Error 时原样抛出，
   * 为其他真值时抛出固定错误，调用方应自行处理该异常。
   */
  function throwKeychainFailure(operation) {
    /**
     * 判断当前 Keychain 调用是否命中故障注入。
     *
     * 使用场景：通过单独开启 `contains`、`get`、`set` 或 `remove`，复现安全存储
     * 在对应 API 调用处失败的业务分支。入参为经过内部调用限定的操作名；无正常
     * 返回值。对应配置是 Error 时原样抛出，使安全测试能够验证含 sentinel 的异常不会
     * 泄漏；其他真值抛出向后兼容的固定错误，false 或未配置时直接返回，让实际内存
     * 存储操作继续执行。
     */
    const configuredFailure = keychainFailures[operation];
    // Error 必须优先于普通真值处理，否则会丢失测试刻意注入的敏感消息。
    if (configuredFailure instanceof Error) {
      throw configuredFailure;
    }
    // 既有布尔 true 和其他真值继续使用固定消息，保持旧测试与调用方兼容。
    if (configuredFailure) {
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
      /**
       * 区分“键不存在”与“键已保存但值为假值”。
       *
       * 使用场景：配置初始化要能可靠识别未保存的配置，不能把空字符串、0 或 false
       * 误判为缺失。入参为请求读取的键名；键存在时本方法随后返回原始存储值，键不
       * 存在时没有正常出参并抛出 `Missing keychain value`。此处使用 `Object.hasOwn`
       * 而不是值的真值判断，分支依据是 Keychain 的存在性而非配置内容。
       */
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
     * 分别抛错或返回 -1；只有现有动作范围内的非负整数才会返回，避免测试静默选择
     * 不存在的默认动作。
     */
    async present(presentation) {
      /**
       * 拒绝没有测试编排的弹窗展示。
       *
       * 使用场景：每个 Alert/Sheet 展示都代表一次需要测试明确选择的用户交互；入参
       * 是调用开始时的剩余 `alertResponses` 队列。队列为空时没有正常动作下标或文本
       * 字段出参，必须抛出 `Missing alert response`；队列非空时才消费一个响应并继续
       * 记录展示快照。以队列长度作为分支依据可防止新增提示框后测试静默走默认路径。
       */
      if (alertResponses.length === 0) {
        throw new Error("Missing alert response");
      }

      /**
       * 消费恰好一个响应并规范化为可安全读取字段的对象。
       *
       * 使用场景：弹窗展示成功后，`textFieldValue()` 和动作下标都要读取同一份当前
       * 响应。入参为队首响应，可为测试传入的任意 JSON 值；出参写入 `this.response`
       * 并随后写入 Alert 快照。响应是对象时保留其 `index` 与 `textFields`，否则使用
       * 空对象：分支依据是只有对象可承载字段，非对象不应导致 stub 的属性访问异常，
       * 但仍已被严格消费，最终会按取消语义返回 -1。
       */
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

      // 仅接受已注册动作的下标；负数、非整数及越过动作数组长度的响应都按取消处理。
      if (Number.isInteger(this.response.index) &&
        this.response.index >= 0 &&
        this.response.index < this.actions.length) {
        return this.response.index;
      }
      return -1;
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
      // 自定义 Error 原样抛出，让脱敏测试可携带虚构 Key 与完整 URL 并观察生产降级。
      if (options.failImages instanceof Error) {
        throw options.failImages;
      }
      // 布尔 true 保持历史固定错误，避免改变既有 runtime 测试接口。
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
