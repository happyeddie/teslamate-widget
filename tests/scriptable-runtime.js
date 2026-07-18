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
  /**
   * 创建与 Scriptable FileManager 对应的隔离文件系统实例。
   *
   * 使用场景：同一 runtime 同时需要本地车辆缓存和 iCloud 配置文件，两者必须使用不同
   * 根目录。入参 `documentsDirectory` 是本实例唯一可操作的临时根目录；`options.kind`
   * 标记 local 或 iCloud，`downloadedFiles` 保存已下载的绝对文件路径，`observations`
   * 仅保存路径、长度和调用次数，`operationHooks` 在目标操作前后驱动确定性同步事件，
   * 绝不保存文件正文。所有可选参数均由 runtime 在本次调用内创建，避免跨测试共享可变
   * 状态。
   */
  constructor(documentsDirectory, options = {}) {
    this.documents = documentsDirectory;
    this.kind = options.kind || "local";
    this.downloadedFiles = options.downloadedFiles || new Set();
    this.failures = options.failures || {};
    this.observations = options.observations || null;
    this.observedFilePaths = new Set();
    this.operationHooks = options.operationHooks || null;
    this.readOverrides = options.readOverrides || {};
  }

  cacheDirectory() { return path.join(this.documents, ".cache"); }

  /**
   * 在当前 FileManager 实例的 documents 根内创建目录。
   *
   * 使用场景：本地缓存和 iCloud 配置都可创建其自身子目录，但不得借此跨越两类根目录。
   * 入参为目标目录路径及可选 `intermediateDirectories`；路径校验会先规范化并拒绝根外、
   * `..` 或另一实例的绝对路径。第二参数为 false 时只创建目标目录且父目录必须已存在，
   * true 时才递归创建缺失父目录。无正常返回值，拒绝错误不包含调用方传入路径。
   */
  createDirectory(filePath, intermediateDirectories = false) {
    const safePath = this.assertPathInDocuments(filePath);
    fs.mkdirSync(safePath, { recursive: intermediateDirectories });
  }
  documentsDirectory() { return this.documents; }

  /**
   * 判断当前隔离根中是否存在指定文件。
   *
   * 使用场景：配置保存事务需要检查正式、备份和候选文件的存在性。入参为文件绝对路径；
   * 调用先记录脱敏路径和次数，再按 `fileExists` 故障配置抛错，未故障时返回 Node 文件
   * 系统的存在性布尔值。故障优先于文件访问，确保测试不会因意外状态掩盖目标分支。
   */
  fileExists(filePath) {
    const safePath = this.assertPathInDocuments(filePath);
    this.operationHooks?.before("fileExists", safePath);
    this.recordFileOperation("fileExists", safePath);
    this.throwFileFailure("fileExists");
    const exists = fs.existsSync(safePath);
    // 同步事件必须在本次存在性结果确定后才落盘，使调用方本次看到旧状态、下次看到新状态。
    this.operationHooks?.after("fileExists", safePath);
    return exists;
  }

  /**
   * 判断指定路径是否为当前实例根内的目录。
   *
   * 使用场景：运行脚本只能检查自身 documents 下的目录结构，不能借 `isDirectory` 探测
   * local/iCloud 另一根目录。入参为目录绝对路径；校验通过后返回存在且为目录的布尔值，
   * 路径越界时抛固定脱敏错误而不读取目标元数据。
   */
  isDirectory(filePath) {
    const safePath = this.assertPathInDocuments(filePath);
    return fs.existsSync(safePath) && fs.statSync(safePath).isDirectory();
  }
  joinPath(lhsPath, rhsPath) { return path.join(lhsPath, rhsPath); }

  /**
   * 模拟 iCloud 文件的下载完成状态。
   *
   * 使用场景：配置读取会先判断文件是否已从 iCloud 下载。入参为绝对文件路径；每次
   * 调用先以相对路径记录观测，再返回该路径是否存在于当前实例的已下载集合。本地
   * FileManager 同样返回集合状态，以便 stub 的 API 行为保持一致。
   */
  isFileDownloaded(filePath) {
    const safePath = this.assertPathInDocuments(filePath);
    this.recordFileOperation("downloadState", safePath);
    this.throwFileFailure("downloadState");
    return this.downloadedFiles.has(safePath);
  }

  /**
   * 模拟将单个 iCloud 文件下载到当前隔离根目录。
   *
   * 使用场景：生产脚本在读取未下载配置前调用此异步 API。入参为绝对文件路径；成功
   * 时将路径写入已下载集合并返回 Promise<void>，不读取或记录任何文件正文。
   */
  async downloadFileFromiCloud(filePath) {
    const safePath = this.assertPathInDocuments(filePath);
    this.recordFileOperation("download", safePath);
    this.throwFileFailure("download");
    this.downloadedFiles.add(safePath);
  }

  /**
   * 按 Scriptable 契约把源文件非覆盖复制到目标路径。
   *
   * 使用场景：legacy 配置安装需要在 gate 后以文件系统原语拒绝覆盖刚同步出现的正式文件。
   * 入参为源、目标绝对路径；两者先通过当前 FileManager 根目录门禁，再记录目标路径与调用
   * 次数并处理故障注入。目标已存在时 `COPYFILE_EXCL` 抛错且双方正文不变；成功时源文件
   * 保留，并把源的已下载状态复制到目标。无正常返回值，正文不进入观测。
   */
  copy(sourcePath, destinationPath) {
    // 两个路径必须在事件、观测与文件系统调用前全部通过归属校验，防止半执行跨根复制。
    const safeSourcePath = this.assertPathInDocuments(sourcePath);
    const safeDestinationPath = this.assertPathInDocuments(destinationPath);
    this.operationHooks?.before("copy", safeDestinationPath);
    this.recordFileOperation("copy", safeDestinationPath);
    this.throwFileFailure("copy");
    fs.copyFileSync(safeSourcePath, safeDestinationPath, fs.constants.COPYFILE_EXCL);
    if (this.downloadedFiles.has(safeSourcePath)) {
      this.downloadedFiles.add(safeDestinationPath);
    }
    this.operationHooks?.after("copy", safeDestinationPath);
  }

  /**
   * 在 iCloud 运行时模拟原子重命名，并随文件移动迁移下载状态。
   *
   * 使用场景：配置事务依赖“正式文件备份、候选文件安装、故障恢复”三个移动阶段。入参
   * 是源、目标绝对路径；先只记录目标相对路径和调用次数，再处理固定或第 N 次移动故障。
   * 成功时创建目标父目录、同步重命名，并将已下载标记从源迁移到目标；无正常返回值。
   */
  move(sourcePath, destinationPath) {
    // 源和目标都必须先被归属校验，避免目标观测或 rename 间接读取另一实例文件。
    const safeSourcePath = this.assertPathInDocuments(sourcePath);
    const safeDestinationPath = this.assertPathInDocuments(destinationPath);
    this.recordFileOperation("move", safeDestinationPath);
    this.throwFileFailure("move");
    fs.mkdirSync(path.dirname(safeDestinationPath), { recursive: true });
    fs.renameSync(safeSourcePath, safeDestinationPath);
    if (this.downloadedFiles.delete(safeSourcePath)) {
      this.downloadedFiles.add(safeDestinationPath);
    }
  }

  /**
   * 删除当前隔离根中的文件并清除其下载状态。
   *
   * 使用场景：配置事务成功或恢复后需要清理候选、备份文件。入参为文件绝对路径；先记录
   * 脱敏观测，再按 `remove` 故障配置抛错，未故障时递归强制删除并从下载集合移除。文件
   * 不存在时保持 Node `rmSync(..., force: true)` 的静默语义。
   */
  remove(filePath) {
    const safePath = this.assertPathInDocuments(filePath);
    this.recordFileOperation("remove", safePath);
    this.throwFileFailure("remove");
    fs.rmSync(safePath, { recursive: true, force: true });
    this.downloadedFiles.delete(safePath);
  }

  /**
   * 统一校验并规范化属于当前 FileManager documents 根的路径。
   *
   * 使用场景：每个文件 I/O 与观测读取都必须通过此单一边界，防止 local 实例读取 iCloud
   * 文件、iCloud 实例读取本地缓存，或调用方用 `..` 跳出根目录。入参为待访问的文件或
   * 目录路径；返回规范化后的绝对路径。路径不是字符串、解析后等于根外路径或相对路径以
   * `..` 开头时抛固定错误，不包含原路径，因而不会把其他临时根信息写入日志或快照。
   */
  assertPathInDocuments(filePath) {
    if (typeof filePath !== "string") {
      throw new Error(`Mock FileManager ${this.kind} rejected path outside documents directory`);
    }
    const documentsRoot = path.resolve(this.documents);
    const resolvedPath = path.resolve(filePath);
    const relativePath = path.relative(documentsRoot, resolvedPath);
    if (relativePath === ".." || relativePath.startsWith(`..${path.sep}`)) {
      throw new Error(`Mock FileManager ${this.kind} rejected path outside documents directory`);
    }
    return resolvedPath;
  }

  /**
   * 记录 FileManager 文件操作的脱敏观测。
   *
   * 使用场景：runtime 测试需要确认下载流程和目标文件，但不得泄漏配置正文。入参
   * `operation` 为固定操作名、`filePath` 为实例根目录下的绝对路径；无业务返回值。
   * 没有观测对象的本地实例直接返回。路径一律转换为根目录相对值，并只更新对应的
   * 调用次数与已观测路径集合；文件内容从不进入快照。
   */
  recordFileOperation(operation, filePath) {
    if (!this.observations) {
      return;
    }
    // 观测也必须独立校验，防止未来新增调用漏过 I/O 边界而生成 `../` 快照条目。
    const safePath = this.assertPathInDocuments(filePath);
    const relativePath = path.relative(this.documents, safePath);
    this.observedFilePaths.add(relativePath);
    const counterName = {
      download: "downloadCalls",
      downloadState: "downloadStateCalls",
      copy: "copyCalls",
      fileExists: "fileExistsCalls",
      move: "moveCalls",
      readString: "readCalls",
      remove: "removeCalls",
      writeString: "writeCalls"
    }[operation] || `${operation}Calls`;
    this.observations[counterName] = (this.observations[counterName] || 0) + 1;
  }

  /**
   * 根据当前操作和调用次数执行故障注入。
   *
   * 使用场景：生产层的每个文件 I/O 分支都必须可单独验证脱敏回退。入参是内部限定的
   * 操作名；配置为 Error 时原样抛出，普通真值抛固定 Mock Error。`moveAtCall` 为正整数
   * 时仅在该次移动抛固定错误，专门覆盖备份、安装和恢复三阶段；调用记录始终在本方法
   * 之前完成，因此失败快照仍能准确反映尝试次数。
   */
  throwFileFailure(operation) {
    if (operation === "move" && Number.isInteger(this.failures.moveAtCall) &&
      this.observations?.moveCalls === this.failures.moveAtCall) {
      throw new Error(`Mock iCloud FileManager move failed at call ${this.failures.moveAtCall}`);
    }
    const configuredFailure = this.failures[operation];
    if (configuredFailure instanceof Error) {
      throw configuredFailure;
    }
    if (configuredFailure) {
      throw new Error(`Mock iCloud FileManager ${operation} failed`);
    }
  }

  /**
   * 返回当前实例根内图片文件的测试 Image 引用。
   *
   * 使用场景：本地地图缓存读取需要图片对象，而 runtime 不解析真实图像二进制。入参为图片
   * 绝对路径；先由统一边界校验拒绝跨 local/iCloud 或 `..` 路径，成功后返回仅包含规范化
   * 路径的 Image 元数据，不读取文件正文或将其写入观测。
   */
  readImage(filePath) {
    const safePath = this.assertPathInDocuments(filePath);
    return new Image({ kind: "file", path: safePath });
  }

  /**
   * 读取文本文件，必要时按相对路径和读取次数返回测试覆盖值。
   *
   * 使用场景：测试需要稳定构造 pending 校验成功、正式文件复读失败的事务窗口。入参为
   * 文件绝对路径；先记录并处理 `readString` 故障，再原样消费该相对路径覆盖数组的队首值，
   * 包括用于模拟 Scriptable 桥接异常的 null 或其他非字符串。覆盖数组耗尽或未配置时读取
   * 实际隔离文件；正文仅返回给 VM，观测中只记录最终文件长度。
   */
  readString(filePath) {
    const safePath = this.assertPathInDocuments(filePath);
    this.operationHooks?.before("readString", safePath);
    this.recordFileOperation("readString", safePath);
    this.throwFileFailure("readString");
    const relativePath = path.relative(this.documents, safePath);
    const overrides = this.readOverrides[relativePath];
    if (Array.isArray(overrides) && overrides.length > 0) {
      const overriddenValue = overrides.shift();
      // 延迟事件从 readString 完成后开始等待，确保随后生产校验已拿到本次固定返回值。
      this.operationHooks?.after("readString", safePath);
      return overriddenValue;
    }
    const content = fs.readFileSync(safePath, "utf8");
    this.operationHooks?.after("readString", safePath);
    return content;
  }

  temporaryDirectory() { return os.tmpdir(); }

  /**
   * 将图片元数据写入当前实例根内的测试文件。
   *
   * 使用场景：Scriptable runtime 以 JSON 模拟图片缓存；入参为目标绝对路径和 Image，路径
   * 必须归属当前 documents 根。校验先于创建父目录与写入，避免 local/iCloud 通过图片缓存
   * API 相互覆盖；成功时无返回值，图片内容不进入 iCloud 文件观测。
   */
  writeImage(filePath, image) {
    const safePath = this.assertPathInDocuments(filePath);
    fs.mkdirSync(path.dirname(safePath), { recursive: true });
    fs.writeFileSync(safePath, JSON.stringify(image.meta));
  }

  /**
   * 将文本写入当前 FileManager 实例根内的文件。
   *
   * 使用场景：本地车辆缓存与 iCloud 配置事务都会创建或更新文本文件。入参为目标绝对路径
   * 与文本正文；先集中校验路径，再记录脱敏观测与处理写入故障，最后创建父目录并使用 UTF-8
   * 写入。校验在观测之前，确保跨根和 `..` 输入既不写入文件也不产生越界路径、长度或正文。
   */
  writeString(filePath, content) {
    const safePath = this.assertPathInDocuments(filePath);
    this.recordFileOperation("writeString", safePath);
    this.throwFileFailure("writeString");
    fs.mkdirSync(path.dirname(safePath), { recursive: true });
    fs.writeFileSync(safePath, content, "utf8");
  }

  /**
   * 生成不含正文的 iCloud 文件元数据快照。
   *
   * 使用场景：成功和异常结果都要让测试检查文件路径、存在性与字节长度，而不得回显配置。
   * 无入参；返回按路径排序的 `{ path, exists, length }` 数组。结果同时包含实际根目录下的
   * 文件和失败前已尝试操作的路径，后者即使不存在也会以 `exists: false, length: 0` 返回。
   */
  createFileObservations() {
    const relativePaths = new Set(this.observedFilePaths);
    const collectFiles = (directoryPath) => {
      if (!fs.existsSync(directoryPath)) {
        return;
      }
      for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
        const entryPath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
          collectFiles(entryPath);
        }
        else {
          relativePaths.add(path.relative(this.documents, entryPath));
        }
      }
    };
    collectFiles(this.documents);

    return [...relativePaths].sort().map((relativePath) => {
      // 所有枚举与历史观测路径均回到统一边界，防止异常条目触发根外 exists/stat。
      const filePath = this.assertPathInDocuments(path.join(this.documents, relativePath));
      const exists = fs.existsSync(filePath);
      return {
        path: relativePath,
        exists,
        // 使用 stat 大小而非 readFile，确保正文不因观测逻辑进入内存快照。
        length: exists ? fs.statSync(filePath).size : 0
      };
    });
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
    WebView.throwConfiguredFailure("evaluate");
    return null;
  }

  async loadURL(url) {
    this.loadedURL = url;
    WebView.throwConfiguredFailure("load");
  }

  /**
   * 模拟 Scriptable WebView 的异步展示与关闭生命周期。
   *
   * 使用场景：生产脚本必须等待 `present()` 完成后才能调用 `Script.complete()`，否则
   * App 页面可能尚未关闭就结束脚本。无入参，成功返回 Promise<void>；通过运行时配置
   * 可在 load、evaluate 或 present 三阶段抛出自定义 Error。开始和完成事件写入独立
   * 生命周期数组，供测试检查顺序；中间等待的是 Node 外层的下一事件循环，而非已经
   * 排队的微任务。这能保证生产代码删掉 await 时，`Script.complete` 必然先于展示完成，
   * 从而让生命周期测试可靠暴露回归。
   */
  async present() {
    // 捕获本次实例的状态引用，避免未等待的旧展示在下一次 runtime 重置静态状态后污染新快照。
    const lifecycle = WebView.lifecycle;
    const failures = WebView.failures;
    lifecycle.push("webview.present:start");
    await WebView.waitForNextEventLoop();
    WebView.throwConfiguredFailure("present", failures);
    this.presented = true;
    lifecycle.push("webview.present:complete");
  }

  /**
   * 等待 Node 宿主的下一事件循环阶段。
   *
   * 使用场景：runtime 需要将 WebView 展示完成与生产脚本当前微任务链明确分隔，验证
   * `await wv.present()` 不是偶然依赖 Promise 调度顺序。无入参，返回会在下一轮事件
   * 循环 resolve 的 Promise；不接收或记录生产配置，因此不存在敏感值泄露路径。选择
   * `setImmediate` 而非 `Promise.resolve()` 的依据是后者仍处于同一微任务队列，删除
   * 生产 await 时可能因后续 await 链的排队顺序而产生假阳性。
   */
  static waitForNextEventLoop() {
    return new Promise((resolve) => setImmediate(resolve));
  }

  /**
   * 按当前测试配置抛出 WebView 阶段故障。
   *
   * 使用场景：安全回归测试需要让加载、脚本注入和展示分别携带虚构的 URL/Key。入参
   * `operation` 只能是 load、evaluate 或 present，`failures` 是可选的本次实例故障
   * 快照；无正常业务返回值。配置为 Error 时原样抛出，其他真值抛固定 Mock Error，
   * 未配置时不产生副作用。present 在异步等待前捕获 failures，防止下一次 runtime 的
   * 静态配置覆盖尚未完成的旧实例。
   */
  static throwConfiguredFailure(operation, failures = WebView.failures) {
    const configuredFailure = failures[operation];
    if (configuredFailure instanceof Error) {
      throw configuredFailure;
    }
    if (configuredFailure) {
      throw new Error(`Mock WebView ${operation} failed`);
    }
  }
}
WebView.instances = [];
WebView.failures = { load: false, evaluate: false, present: false };
WebView.lifecycle = [];

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
 * `iCloudFiles`、`iCloudDownloadedFiles`、`iCloudFailures`、`iCloudReadOverrides`、
 * `iCloudFileEvents`、`queryParameters`、
 * `failImages` 和 `alertResponses`；`keychainValues` 与 `keychainFailures` 仅为旧配置
 * 一次性迁移、日常路径不触碰 Keychain 的哨兵，以及 runtime API 兼容测试保留。未传入
 * 的可选项使用测试安全的默认值。
 * `keychainFailures.<operation>`、`failImages` 与 `webViewFailures.<operation>` 可传布尔
 * 值或 Error：true 使用向后兼容的固定 Mock Error，Error 实例则原样抛出，供安全测试
 * 携带虚构敏感信息。成功时返回 documents 路径、请求/日志/Widget/WebView 快照、Keychain
 * 写入的脱敏观测、生命周期、iCloud 文件元数据以及最终 Keychain 和 Alert 观测；返回值
 * `iCloudReadOverrides` 的队列值会原样返回，可包含 null 或其他非字符串以模拟桥接异常；
 * `iCloudFileEvents` 可在目标操作完成后立即写入隔离文件，或等到指定下一操作前再写入，
 * 用于稳定复现用户交互和文件校验之间的 iCloud 同步竞态。
 * 所有结果均不持有内部可变集合。iCloud 文件结果只包含路径、存在性和长度，绝不包含正文。
 * VM 异常会原样向调用方抛出，同时附加不含异常详情的 `runtimeResult` 快照，便于安全测试
 * 断言错误期间的日志、Alert 与 Widget 输出；交互响应不足仍使用固定错误供测试精确断言。
 */
async function runScriptableScript(options = {}) {
  const scriptPath = options.scriptPath || path.join(__dirname, "..", "Telsa Car.js");
  const source = fs.readFileSync(scriptPath, "utf8");
  const documentsDirectory = options.documentsDirectory || fs.mkdtempSync(path.join(os.tmpdir(), "scriptable-docs-"));
  const iCloudDocumentsDirectory = options.iCloudDocumentsDirectory ||
    fs.mkdtempSync(path.join(os.tmpdir(), "scriptable-icloud-docs-"));
  const iCloudFileObservations = {
    copyCalls: 0,
    downloadCalls: 0,
    downloadStateCalls: 0,
    moveCalls: 0,
    readCalls: 0,
    removeCalls: 0,
    writeCalls: 0,
    files: []
  };
  const requestLog = [];
  const logs = [];
  const keychainSetCalls = [];
  const lifecycle = [];
  const iCloudOperationCalls = {};
  const pendingICloudFileEvents = [];
  /**
   * 维护当前运行的用户交互状态和安全配置状态。
   *
   * 使用场景：配置向导测试需要模拟用户按顺序点击弹窗；旧配置迁移和 runtime 自测还需要
   * 在单个运行内读写隔离的兼容 Keychain。入参来自 `options.alertResponses`、
   * `options.keychainValues` 和
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
  /**
   * 将测试夹具的虚构文件安全写入隔离 iCloud documents。
   *
   * 使用场景：初始 `iCloudFiles` 与运行中 `iCloudFileEvents` 共用相同路径隔离规则。入参
   * `files` 为相对路径到 UTF-8 正文的映射；无返回值。路径逃逸立即抛固定错误，正文只写
   * 临时根且不计入脱敏操作观测，避免两套夹具实现产生不同安全边界。
   */
  function materializeICloudFiles(files) {
    for (const [relativePath, content] of Object.entries(files || {})) {
      const destinationPath = path.resolve(iCloudDocumentsDirectory, relativePath);
      const resolvedRelativePath = path.relative(iCloudDocumentsDirectory, destinationPath);
      // 绝对路径或解析到根外的相对路径都可能触碰真实文件，必须在 mkdir/write 前拒绝。
      if (resolvedRelativePath === ".." || resolvedRelativePath.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativePath)) {
        throw new Error("iCloudFiles path must be relative to iCloud documents");
      }
      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
      fs.writeFileSync(destinationPath, content, "utf8");
    }
  }

  materializeICloudFiles(options.iCloudFiles);

  /**
   * 复制并验证运行中 iCloud 文件事件的最小调度字段。
   *
   * 使用场景：竞态测试按 `afterOperation` 的第 `atCall` 次完成点触发；可选
   * `relativePath` 把次数限定到单个 iCloud 路径，可选 `beforeOperation` 让文件延迟到后续
   * 目标操作开始前才出现。入参来自测试 options；返回独立事件数组，避免 runtime 消费
   * 状态反向修改调用方对象。无效事件直接抛错，防止拼写错误让安全测试静默退化。
   */
  const iCloudFileEvents = (options.iCloudFileEvents || []).map((event) => {
    if (!event || typeof event.afterOperation !== "string" ||
      !Number.isInteger(event.atCall) || event.atCall < 1 ||
      !event.files || typeof event.files !== "object") {
      throw new Error("Invalid iCloudFileEvents entry");
    }
    const relativePath = typeof event.relativePath === "string"
      ? path.normalize(event.relativePath)
      : null;
    // 路径限定只能指向 iCloud 临时根内的相对文件，不能借事件调度绕过夹具路径门禁。
    if (relativePath && (path.isAbsolute(relativePath) || relativePath === ".." ||
      relativePath.startsWith(`..${path.sep}`))) {
      throw new Error("Invalid iCloudFileEvents relativePath");
    }
    return {
      afterOperation: event.afterOperation,
      atCall: event.atCall,
      beforeOperation: typeof event.beforeOperation === "string" ? event.beforeOperation : null,
      files: { ...event.files },
      matchedCalls: 0,
      relativePath,
      triggered: false
    };
  });

  /**
   * 在目标 runtime 操作开始前落实已到期的延迟 iCloud 文件事件。
   *
   * 使用场景：pending readString 完成后需先让生产代码执行同步 envelope 校验，再在下一次
   * fileExists 前模拟 backup 出现。入参为即将开始的固定操作名；无返回值。只消费匹配的
   * 延迟事件，其余事件继续等待，文件正文不会进入观测。
   */
  function beforeRuntimeOperation(operation) {
    for (let index = pendingICloudFileEvents.length - 1; index >= 0; index -= 1) {
      const event = pendingICloudFileEvents[index];
      // 只有明确指定的后续操作可触发，避免无关日志或 UI 调用改变竞态时间点。
      if (event.beforeOperation === operation) {
        materializeICloudFiles(event.files);
        pendingICloudFileEvents.splice(index, 1);
      }
    }
  }

  /**
   * 记录目标操作完成次数，并触发对应的即时或延迟 iCloud 文件事件。
   *
   * 使用场景：Alert 确认完成、FileManager 读取或存在性检查返回前都调用本边界。入参为
   * 固定操作名和可选绝对路径；无返回值。同一事件只触发一次；带路径限定的事件独立统计
   * 该路径匹配次数，带 `beforeOperation` 的事件进入等待队列，其余事件立即写入，从而让
   * 当前操作结果保持事件发生前的状态。
   */
  function afterRuntimeOperation(operation, filePath = null) {
    iCloudOperationCalls[operation] = (iCloudOperationCalls[operation] || 0) + 1;
    for (const event of iCloudFileEvents) {
      if (event.triggered || event.afterOperation !== operation) {
        continue;
      }
      let matchedCall = iCloudOperationCalls[operation];
      if (event.relativePath) {
        // 路径事件只统计目标相对路径；其他同类操作不会提前消费其 atCall。
        if (typeof filePath !== "string" ||
          path.relative(iCloudDocumentsDirectory, filePath) !== event.relativePath) {
          continue;
        }
        event.matchedCalls += 1;
        matchedCall = event.matchedCalls;
      }
      if (event.atCall !== matchedCall) {
        continue;
      }
      event.triggered = true;
      if (event.beforeOperation) {
        pendingICloudFileEvents.push(event);
      }
      else {
        materializeICloudFiles(event.files);
      }
    }
  }
  const downloadedFiles = new Set((options.iCloudDownloadedFiles || []).map((relativePath) =>
    path.resolve(iCloudDocumentsDirectory, relativePath)
  ));
  const iCloudReadOverrides = Object.fromEntries(
    Object.entries(options.iCloudReadOverrides || {}).map(([relativePath, values]) => [
      relativePath,
      Array.isArray(values) ? [...values] : []
    ])
  );
  const localFileManager = new TestFileManager(documentsDirectory, { kind: "local" });
  const iCloudFileManager = new TestFileManager(iCloudDocumentsDirectory, {
    downloadedFiles,
    failures: options.iCloudFailures || {},
    kind: "iCloud",
    operationHooks: {
      after: afterRuntimeOperation,
      before: beforeRuntimeOperation
    },
    observations: iCloudFileObservations,
    readOverrides: iCloudReadOverrides
  });
  const keychainValues = clone(options.keychainValues || {});
  const keychainFailures = {
    contains: options.keychainFailures?.contains || false,
    get: options.keychainFailures?.get || false,
    set: options.keychainFailures?.set || false,
    remove: options.keychainFailures?.remove || false
  };
  const webViewFailures = {
    load: options.webViewFailures?.load || false,
    evaluate: options.webViewFailures?.evaluate || false,
    present: options.webViewFailures?.present || false
  };
  const scriptState = {
    completed: false,
    widget: null
  };

  WebView.instances = [];
  WebView.failures = webViewFailures;
  WebView.lifecycle = lifecycle;

  /**
   * 按测试选项注入 Keychain 操作失败。
   *
   * 使用场景：验证旧配置一次性迁移及 runtime 兼容接口在 Scriptable 安全存储不可用时的
   * 回退逻辑。入参为 `contains`、`get`、`set` 或 `remove`；无返回值。对应配置为 Error
   * 时原样抛出，为其他真值时抛出固定错误，调用方应自行处理该异常。
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
     * 使用场景：旧配置迁移在读取前判断历史键是否存在，或 runtime 自测验证 API 契约。
     * 入参为字符串键名，返回布尔值；故障注入开启时抛出固定测试错误。
     */
    contains(key) {
      throwKeychainFailure("contains");
      return Object.hasOwn(keychainValues, key);
    },

    /**
     * 读取当前隔离存储中的指定值。
     *
     * 使用场景：读取待迁移的旧配置或验证 runtime API 契约。入参为字符串键名，返回
     * 对应值；键不存在时抛出 `Missing keychain value`，故障注入开启时优先抛出固定测试错误。
     */
    get(key) {
      throwKeychainFailure("get");
      /**
       * 区分“键不存在”与“键已保存但值为假值”。
       *
       * 使用场景：一次性迁移需要可靠识别历史键的缺失，不能把空字符串、0 或 false
       * 误判为缺失。入参为请求读取的键名；键存在时本方法随后返回原始存储值，键不
       * 存在时没有正常出参并抛出 `Missing keychain value`。此处使用 `Object.hasOwn`
       * 而不是值的真值判断，分支依据是历史键是否存在而非其内容。
       */
      if (!Object.hasOwn(keychainValues, key)) {
        throw new Error("Missing keychain value");
      }
      return keychainValues[key];
    },

    /**
     * 在本次 runtime 调用隔离的安全存储中写入值。
     *
     * 使用场景：runtime API 兼容测试模拟历史安全存储写入；日常配置保存不应调用此
     * 接口。入参为键名和值，无返回值；故障注入开启时不写入并抛出固定测试错误。
     */
    set(key, value) {
      /**
       * 记录一次不包含配置内容的 Keychain.set 调用。
       *
       * 使用场景：runtime API 兼容测试需要验证调用次数和目标键而不能回显 API Key 或
       * URL。入参为 Keychain.set 的原始键和值；仅记录键和字符串长度，value 不是字符串
       * 时记录 null。记录发生在故障注入之前，因此写入失败测试也能观察到真实尝试次数。
       */
      keychainSetCalls.push({
        key,
        valueLength: typeof value === "string" ? value.length : null
      });
      throwKeychainFailure("set");
      keychainValues[key] = value;
    },

    /**
     * 从本次 runtime 调用隔离的安全存储中移除指定键。
     *
     * 使用场景：一次性迁移清除历史键或 runtime 自测删除隔离值。入参为键名，无返回值；
     * 不存在的键按 JavaScript `delete` 语义静默处理，故障注入开启时抛出固定测试错误。
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

      // 弹窗快照与用户响应都已确定后再触发同步事件，模拟配置确认期间云端文件刚好到达。
      afterRuntimeOperation("alertPresent");

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
    args: {
      queryParameters: clone(options.queryParameters || {}),
      widgetParameter: options.widgetParameter || ""
    },
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
      local: () => localFileManager,
      iCloud: () => iCloudFileManager
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
        // 记录完成时机，供 WebView 生命周期测试验证 await present 后才结束脚本。
        lifecycle.push("script.complete");
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

  /**
   * 构造不共享运行时内部集合的测试快照。
   *
   * 使用场景：成功执行直接返回，生产脚本抛错时附加到异常供脱敏断言复用。无入参；返回
   * 请求、UI、Keychain、生命周期和脱敏写入观测。Keychain 写入值始终不在观测中返回，
   * 只保留目标键与长度；完整最终 Keychain 仅保留既有测试兼容接口。
   */
  function createRuntimeResult() {
    // 每次创建快照都重新扫描隔离 iCloud 根，确保成功写入、移动或失败前操作均有最终元数据。
    iCloudFileObservations.files = iCloudFileManager.createFileObservations();
    return {
      alerts: clone(alerts),
      documentsDirectory,
      iCloudDocumentsDirectory,
      iCloudFileObservations: clone(iCloudFileObservations),
      keychain: clone(keychainValues),
      keychainSetCalls: clone(keychainSetCalls),
      lifecycle: clone(lifecycle),
      logs: clone(logs),
      requests: requestLog.map((request) => ({
        url: request.url,
        method: request.method,
        headers: request.headers,
        timeoutInterval: request.timeoutInterval
      })),
      script: clone(scriptState),
      webViews: WebView.instances.map((webView) => serialize(webView)),
      widget: scriptState.widget ? serialize(scriptState.widget) : null
    };
  }

  const context = vm.createContext(sandbox);
  const wrapped = `(async () => {\n${source}\n})()`;
  try {
    await new vm.Script(wrapped, { filename: scriptPath }).runInContext(context, { timeout: 5000 });
    return createRuntimeResult();
  }
  catch (error) {
    // 仅测试 runtime 附加观测快照；不修改生产脚本原始的固定脱敏 Error 文本。
    error.runtimeResult = createRuntimeResult();
    throw error;
  }
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
