// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: red; icon-glyph: car-side;
const params = parseWidgetParameters(args.widgetParameter);

const MEDIUM_WIDGET_HEIGHT = 176;
const MAP_PANEL_SIZE = 176;
const RUNTIME_CONFIG_KEY = "teslamate-widget.config.v1";

/**
 * 解析 Scriptable Widget 参数为去除空白的非空标记列表。
 *
 * 使用场景：主题标记和车辆 ID 可以按任意顺序写入 `args.widgetParameter`。入参为
 * Scriptable 提供的字符串或空值；返回字符串数组。空值返回空数组，不抛异常；非空
 * 值按逗号拆分，空片段被过滤，后续业务按独立规则选择需要的标记。
 */
function parseWidgetParameters(widgetParameter) {
  // 未设置参数时使用默认车辆 ID；分支依据是 Scriptable 可能传入 null 或空字符串。
  if (!widgetParameter) {
    return [];
  }
  return widgetParameter.split(",").map((item) => item.trim()).filter(Boolean);
}

/**
 * 校验 HTTP authority 中显式端口是否为可用的十进制端口号。
 *
 * 使用场景：normalizeHttpBaseUrl 在普通 host 或 IPv6 host 后发现冒号端口时调用。
 * 入参为不含冒号的字符串；仅当内容全部为十进制数字且数值位于 1..65535 时返回
 * true，其余类型、空值、符号、小数和越界值返回 false。方法不抛异常、不记录输入，
 * 避免错误路径泄露完整私有 URL。
 */
function isValidHttpPort(value) {
  // 先约束为非空纯数字字符串，避免 parseInt 接受 `80abc`、符号或小数等前缀输入。
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    return false;
  }

  const port = parseInt(value, 10);
  // TCP/UDP 端口 0 不可作为远端服务端口，65535 是允许的最大值。
  return port >= 1 && port <= 65535;
}

/**
 * 标准化并验证 HTTP(S) 基础 URL。
 *
 * 使用场景：Keychain 读取和配置保存都必须得到可安全拼接路径的基础地址。入参可为
 * 任意值；成功返回 `{ ok: true, value }`，其中 value 已去除全部末尾斜杠；
 * 失败返回不含原始输入的 `{ ok: false, message }`。authority 只接受非空 host 和
 * 可选的 1..65535 纯数字端口；本方法不依赖 JavaScriptCore 可能未提供的 URL 全局
 * 对象，也不发起网络请求。
 */
function normalizeHttpBaseUrl(value) {
  // URL 字段必须是字符串；其他类型不能安全执行后续显式字符串规则。
  if (typeof value !== "string") {
    return { ok: false, message: "URL 必须是字符串" };
  }

  const normalizedValue = value;
  // 只允许小写 HTTP(S) 协议；分支依据是配置只支持这两类网络端点。
  const protocol = normalizedValue.indexOf("https://") === 0
    ? "https://"
    : normalizedValue.indexOf("http://") === 0
      ? "http://"
      : null;
  if (!protocol) {
    return { ok: false, message: "URL 仅支持 http 或 https 协议" };
  }

  // 任意内部空白、query 或 hash 都会破坏基础地址拼接，因此统一拒绝且不回显输入。
  if (/\s/.test(normalizedValue) || normalizedValue.indexOf("?") >= 0 ||
    normalizedValue.indexOf("#") >= 0) {
    return { ok: false, message: "URL 不能包含空白、查询参数或片段" };
  }

  const authorityAndPath = normalizedValue.slice(protocol.length);
  const firstPathSeparator = authorityAndPath.indexOf("/");
  const authority = firstPathSeparator >= 0
    ? authorityAndPath.slice(0, firstPathSeparator)
    : authorityAndPath;
  const hostAndPort = authority.slice(authority.lastIndexOf("@") + 1);
  let host = "";
  let authorityIsValid = true;
  // IPv6 host 必须包含成对方括号，右括号后只能为空或跟随单个合法冒号端口。
  if (hostAndPort.charAt(0) === "[") {
    const closingBracketIndex = hostAndPort.indexOf("]");
    host = closingBracketIndex > 1 ? hostAndPort.slice(1, closingBracketIndex) : "";
    const suffix = closingBracketIndex >= 0
      ? hostAndPort.slice(closingBracketIndex + 1)
      : "";
    // 空后缀表示未指定端口；非空后缀必须是 `:` 加合法端口，其他文字一律拒绝。
    if (suffix && (suffix.charAt(0) !== ":" || !isValidHttpPort(suffix.slice(1)))) {
      authorityIsValid = false;
    }
  }
  // 普通 host 最多包含一个端口分隔冒号；多个冒号必须使用上方 IPv6 方括号格式。
  else {
    const firstPortSeparator = hostAndPort.indexOf(":");
    const lastPortSeparator = hostAndPort.lastIndexOf(":");
    host = firstPortSeparator >= 0
      ? hostAndPort.slice(0, firstPortSeparator)
      : hostAndPort;
    // 发现端口时必须只有一个分隔冒号，且冒号后的端口满足纯数字和范围规则。
    if (firstPortSeparator >= 0 &&
      (firstPortSeparator !== lastPortSeparator ||
        !isValidHttpPort(hostAndPort.slice(firstPortSeparator + 1)))) {
      authorityIsValid = false;
    }
  }
  // 协议后、首个路径前必须存在 host；空值同时覆盖 `https:///path` 和 `http://:8080`。
  if (!host) {
    return { ok: false, message: "URL 必须包含主机地址" };
  }
  // host 存在但端口或 IPv6 后缀非法时返回固定消息，不包含原始 authority。
  if (!authorityIsValid) {
    return { ok: false, message: "URL 端口或主机格式无效" };
  }

  let baseUrl = normalizedValue;
  // 逐个移除末尾斜杠，保证后续固定以单个 `/api/...` 路径拼接且不产生双斜杠。
  while (baseUrl.charAt(baseUrl.length - 1) === "/") {
    baseUrl = baseUrl.slice(0, -1);
  }
  return { ok: true, value: baseUrl };
}

/**
 * 验证并标准化完整的 schema v1 运行配置。
 *
 * 使用场景：不信任 Keychain JSON 和 App 表单输入，任何数据进入请求链前都调用本
 * 方法。入参为任意值；成功返回只包含四个规范字段的 `{ ok: true, value }`，失败
 * 返回脱敏错误。对象结构、schema、空 Key 或任一 URL 非法均不抛异常，而是返回首个
 * 可操作错误；原对象中的额外字段不会进入保存结果。
 */
function validateRuntimeConfig(input) {
  // 配置必须是普通非数组对象；分支依据是后续要按固定字段读取 schema。
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, message: "运行配置格式无效" };
  }

  // 当前脚本只理解 schema v1；其他版本必须显式拒绝，避免误读未来数据结构。
  if (input.schemaVersion !== 1) {
    return { ok: false, message: "运行配置版本不受支持" };
  }

  const amapApiKey = typeof input.amapApiKey === "string" ? input.amapApiKey.trim() : "";
  // 高德 Key 去除首尾空白后必须非空；错误消息不得包含敏感 Key。
  if (!amapApiKey) {
    return { ok: false, message: "高德 API Key 不能为空" };
  }

  const apiBaseUrlResult = normalizeHttpBaseUrl(input.teslaMateApiBaseUrl);
  // TeslaMateApi URL 失败时只返回字段级通用提示，不传播可能含输入的下层信息。
  if (!apiBaseUrlResult.ok) {
    return { ok: false, message: "TeslaMateApi 基础 URL 无效" };
  }

  const webUrlResult = normalizeHttpBaseUrl(input.teslaMateWebUrl);
  // TeslaMate Web URL 使用相同规则，但独立提示便于用户定位需要修改的字段。
  if (!webUrlResult.ok) {
    return { ok: false, message: "TeslaMate Web URL 无效" };
  }

  return {
    ok: true,
    value: {
      schemaVersion: 1,
      amapApiKey,
      teslaMateApiBaseUrl: apiBaseUrlResult.value,
      teslaMateWebUrl: webUrlResult.value
    }
  };
}

/**
 * 从固定 Keychain 键读取并验证版本化运行配置。
 *
 * 使用场景：main 在创建文件缓存或网络请求前执行配置门禁。无入参；成功返回标准化
 * 配置，键缺失、JSON 损坏、schema/字段非法或 Keychain API 异常均返回 null。读取
 * 与解析异常只记录固定分类日志，不泄露 Key、URL 或原始 JSON。
 */
function loadRuntimeConfig() {
  try {
    // contains 为 false 表示设备尚未配置，不调用 get，避免 Scriptable 对缺失键抛错。
    if (!Keychain.contains(RUNTIME_CONFIG_KEY)) {
      return null;
    }

    const storedValue = Keychain.get(RUNTIME_CONFIG_KEY);
    const validationResult = validateRuntimeConfig(JSON.parse(storedValue));
    // Keychain 中的内容即使可解析也必须重新验证；非法配置按读取失败统一降级。
    if (!validationResult.ok) {
      console.log("运行配置读取失败");
      return null;
    }
    return validationResult.value;
  }
  catch (error) {
    // 固定日志刻意不记录异常对象，防止解析错误或系统错误间接包含敏感配置。
    console.log("运行配置读取失败");
    return null;
  }
}

/**
 * 验证后将完整 schema v1 配置原子写入单个 Keychain 键。
 *
 * 使用场景：Task 3 的 App 配置表单保存用户输入。入参为任意配置候选；验证成功且
 * Keychain.set 完成时返回 `{ ok: true, value }`，校验失败返回对应脱敏错误，写入异常
 * 返回通用失败。只序列化验证结果，额外字段、未标准化值和原始异常均不会写入或抛出。
 */
function saveRuntimeConfig(input) {
  const validationResult = validateRuntimeConfig(input);
  // 校验失败时不得调用 Keychain.set，保证已有配置保持不变。
  if (!validationResult.ok) {
    return validationResult;
  }

  try {
    Keychain.set(RUNTIME_CONFIG_KEY, JSON.stringify(validationResult.value));
    return validationResult;
  }
  catch (error) {
    // 保存异常只返回固定消息，不记录错误对象或配置内容。
    return { ok: false, message: "运行配置保存失败" };
  }
}

/**
 * 使用独立原生 Alert 展示不含敏感配置值的状态消息。
 *
 * 使用场景：配置校验失败、Keychain 写入失败或保存成功后，需要等待用户明确确认再
 * 继续或结束流程。入参 `title` 和 `message` 只能由调用方传入固定业务文案；无业务
 * 返回值，Alert 展示异常原样抛出。该方法不接收配置对象，避免误把 Key 或私有 URL
 * 拼接进提示内容。
 */
async function presentMessage(title, message) {
  const alert = new Alert();
  alert.title = title;
  alert.message = message;
  alert.addAction("确定");
  await alert.presentAlert();
}

/**
 * 循环展示单脚本运行配置表单，并在用户确认后校验和保存完整 schema v1 配置。
 *
 * 使用场景：首次运行缺少配置时直接调用，或从 App 操作菜单进入管理配置时调用。
 * 入参 `initialConfig` 为已验证配置或 null；成功保存返回标准化配置，取消、保存失败
 * 返回 null。文本框固定按高德 Key、TeslaMateApi URL、TeslaMate Web URL 排列，Key
 * 使用安全文本框；校验失败会保留本次原始输入重试，所有状态提示均使用固定脱敏
 * 文案。Alert 或 Keychain 之外的意外异常原样抛出。
 */
async function presentConfigForm(initialConfig) {
  let formValues;
  // 已配置入口预填当前标准化值，首次配置入口使用空值；分支只处理可信配置或 null。
  if (initialConfig) {
    formValues = {
      amapApiKey: initialConfig.amapApiKey,
      teslaMateApiBaseUrl: initialConfig.teslaMateApiBaseUrl,
      teslaMateWebUrl: initialConfig.teslaMateWebUrl
    };
  }
  else {
    formValues = {
      amapApiKey: "",
      teslaMateApiBaseUrl: "",
      teslaMateWebUrl: ""
    };
  }

  // 只有校验失败需要回到表单；取消、保存成功或存储失败都会从对应分支明确返回。
  while (true) {
    const form = new Alert();
    form.title = "管理配置";
    form.message = "配置将保存在 iOS Keychain 中";
    form.addSecureTextField("高德 API Key", formValues.amapApiKey);
    form.addTextField("TeslaMateApi 基础 URL", formValues.teslaMateApiBaseUrl);
    form.addTextField("TeslaMate Web URL", formValues.teslaMateWebUrl);
    form.addAction("保存");
    form.addCancelAction("取消");

    const actionIndex = await form.presentAlert();
    // 只有固定下标 0 表示保存；取消或无效下标不得读取、校验或写入表单内容。
    if (actionIndex !== 0) {
      return null;
    }

    const candidate = {
      schemaVersion: 1,
      amapApiKey: form.textFieldValue(0),
      teslaMateApiBaseUrl: form.textFieldValue(1),
      teslaMateWebUrl: form.textFieldValue(2)
    };
    const validationResult = validateRuntimeConfig(candidate);
    // 校验失败时保留未标准化原始输入，方便用户只修正错误字段；提示不回显具体值。
    if (!validationResult.ok) {
      formValues = candidate;
      await presentMessage("配置无效", "请检查所有配置项后重试");
      continue;
    }

    const saveResult = saveRuntimeConfig(validationResult.value);
    // 候选已通过校验，此处失败只代表 Keychain 写入异常；旧值由配置核心保证不变。
    if (!saveResult.ok) {
      await presentMessage("保存失败", "无法保存配置，请稍后重试");
      return null;
    }

    await presentMessage("保存成功", "配置已安全保存");
    return saveResult.value;
  }
}

/**
 * 惰性创建正常 Widget 所需的文件缓存与渲染对象。
 *
 * 使用场景：仅在运行配置通过门禁后调用，确保首次未配置或读取失败不会创建 tesla
 * 缓存目录。无入参；返回 `{ fm, fileRoot, widget }`。FileManager 或目录创建异常原样
 * 抛出交由 Scriptable 报告，因为此时配置已有效且无法安全继续正常渲染。
 */
function createRuntimeContext() {
  const fm = FileManager.local();
  const fileRoot = fm.joinPath(fm.documentsDirectory(), "tesla");
  // 仅在缓存根目录不存在时创建；已有目录必须复用以支持离线车辆与地图缓存。
  if (!fm.isDirectory(fileRoot)) {
    fm.createDirectory(fileRoot);
  }
  const widget = new ListWidget();
  widget.setPadding(0, 0, 0, 0);
  return { fm, fileRoot, widget };
}

/**
 * 渲染配置不可用时的无副作用 Widget 提示并结束脚本。
 *
 * 使用场景：中号桌面和 accessoryCircular 锁屏入口在 Keychain 配置不可用时调用。
 * 入参为当前 widget family；返回创建的 ListWidget，便于调用方或测试观察。该方法只
 * 创建提示 Widget，不访问 FileManager 或网络；Scriptable API 异常原样抛出。
 */
function renderMissingConfigWidget(widgetFamily) {
  const widget = new ListWidget();
  widget.setPadding(12, 12, 12, 12);
  const message = widget.addText("请在 Scriptable 中运行脚本完成配置");
  message.font = Font.mediumSystemFont(12);
  message.lineLimit = 3;
  Script.setWidget(widget);

  // 锁屏圆形 family 沿用 small 预览，其余 Widget 入口使用中号预览。
  if (widgetFamily === "accessoryCircular") {
    widget.presentSmall();
  }
  else {
    widget.presentMedium();
  }
  Script.complete();
  return widget;
}

/**
 * 使用已验证的 TeslaMate Web 地址打开车辆页面并隐藏其他车辆卡片。
 *
 * 使用场景：配置有效且 Scriptable 在 App 内运行。入参为标准化 runtimeConfig 和
 * 当前 carId；无返回值。WebView 加载或脚本执行异常原样抛出，URL 与车辆 ID 均只从
 * 显式参数读取，不依赖可变全局配置。
 */
async function openTeslaMateWebView(runtimeConfig, carId) {
  
  let wv = new WebView();
  await wv.loadURL(runtimeConfig.teslaMateWebUrl);
  
  // TeslaMate 页面当前按 1 到 4 号车辆卡片组织；逐项注入样式，仅保留当前车辆。
  for (var i = 1; i < 5; i++) {
    // 只隐藏非当前车辆卡片；分支依据是循环车辆编号与显式 carId 是否不同。
    if (i != carId) {
      await wv.evaluateJavaScript(`
        (() => {
          const style = document.createElement('style');
          style.textContent = '#car_${i}, div.navbar-brand, footer {display: none}';
          document.head.appendChild(style);
        })()
      `)
    }
  }
  
  wv.present(); 
}

/**
 * 展示已配置 App 的操作菜单，并按固定动作下标打开页面或进入配置管理。
 *
 * 使用场景：Scriptable 在 App 内运行且 Keychain 配置已验证。入参为标准化
 * `runtimeConfig` 和当前 `carId`；无业务返回值。菜单固定使用 sheet，动作下标 0
 * 调用 WebView，下标 1 调用配置表单，取消或任何其他返回值直接结束；下游异常原样
 * 抛出，调用方负责完成 Script 生命周期。
 */
async function presentAppMenu(runtimeConfig, carId) {
  const menu = new Alert();
  menu.title = "TeslaMate Widget";
  menu.message = "请选择要执行的操作";
  menu.addAction("打开 TeslaMate");
  menu.addAction("管理配置");
  menu.addCancelAction("取消");

  const actionIndex = await menu.presentSheet();
  // 固定下标 0 只负责打开 TeslaMate，不允许同时进入配置表单。
  if (actionIndex === 0) {
    await openTeslaMateWebView(runtimeConfig, carId);
    return;
  }
  // 固定下标 1 进入已预填表单；取消和越界下标不执行任何业务动作。
  if (actionIndex === 1) {
    await presentConfigForm(runtimeConfig);
  }
}

/**
 * 渲染锁屏圆形电量 Widget。
 *
 * 使用场景：配置有效且 runsInAccessoryWidget 为真。入参为惰性 runtimeContext、标准
 * 化 runtimeConfig 和 carId；无返回值。车辆请求失败时由缓存加载链处理，最终无法
 * 获得数据则原样抛出；缓存、请求和 Widget 均来自显式参数链。
 */
async function renderAccessoryWidget(runtimeContext, runtimeConfig, carId) {
  const { fm, fileRoot, widget } = runtimeContext;
  
  let filename = `car_data_${carId}.json`;
  let file = fm.joinPath(fileRoot, filename);

  const data = await loadCarDataWithCache(runtimeContext, runtimeConfig, carId, file);
  
  const car = data.data.status;
  
  // 在独立绘图上下文中绘制电量环和状态图标，再作为单张图片写入锁屏 Widget。
  {  
    let circle = new DrawContext();
    circle.size = new Size(100, 100);
    circle.opaque = false;
      
    circle.setStrokeColor(Color.black());
    circle.setLineWidth(10);
    circle.strokeEllipse(new Rect(5, 5, 90, 90));
      
    let power = car.battery_details.battery_level;
    circle.setFillColor(Color.white())
      
    let width = 8;
    // 电量百分比按 360 度线性换算弧长，每度绘制一个圆点形成连续进度环。
    for (let angle = 0; angle <= 360 / 100 * power; angle += 1) {
      let loc = calculateSidesLength(45, angle, 50)
      let rect = new Rect(loc[0] - width/2, loc[1] - width/2, width, width);
      circle.fillEllipse(rect);
    }
      
      
    circle.setTextColor(Color.white())
    circle.setFont(Font.regularMonospacedSystemFont(12))
    let iconData = Data.fromBase64String("iVBORw0KGgoAAAANSUhEUgAAACgAAAAgCAYAAABgrToAAAAAAXNSR0IArs4c6QAAAKZlWElmTU0AKgAAAAgABgESAAMAAAABAAEAAAEaAAUAAAABAAAAVgEbAAUAAAABAAAAXgEoAAMAAAABAAIAAAExAAIAAAAVAAAAZodpAAQAAAABAAAAfAAAAAAAAABIAAAAAQAAAEgAAAABUGl4ZWxtYXRvciBQcm8gMi4wLjEAAAADoAEAAwAAAAEAAQAAoAIABAAAAAEAAAAooAMABAAAAAEAAAAgAAAAACk56h4AAAAJcEhZcwAACxMAAAsTAQCanBgAAAOVaVRYdFhNTDpjb20uYWRvYmUueG1wAAAAAAA8eDp4bXBtZXRhIHhtbG5zOng9ImFkb2JlOm5zOm1ldGEvIiB4OnhtcHRrPSJYTVAgQ29yZSA2LjAuMCI+CiAgIDxyZGY6UkRGIHhtbG5zOnJkZj0iaHR0cDovL3d3dy53My5vcmcvMTk5OS8wMi8yMi1yZGYtc3ludGF4LW5zIyI+CiAgICAgIDxyZGY6RGVzY3JpcHRpb24gcmRmOmFib3V0PSIiCiAgICAgICAgICAgIHhtbG5zOmV4aWY9Imh0dHA6Ly9ucy5hZG9iZS5jb20vZXhpZi8xLjAvIgogICAgICAgICAgICB4bWxuczp0aWZmPSJodHRwOi8vbnMuYWRvYmUuY29tL3RpZmYvMS4wLyIKICAgICAgICAgICAgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIj4KICAgICAgICAgPGV4aWY6UGl4ZWxZRGltZW5zaW9uPjMyPC9leGlmOlBpeGVsWURpbWVuc2lvbj4KICAgICAgICAgPGV4aWY6UGl4ZWxYRGltZW5zaW9uPjQwPC9leGlmOlBpeGVsWERpbWVuc2lvbj4KICAgICAgICAgPGV4aWY6Q29sb3JTcGFjZT4xPC9leGlmOkNvbG9yU3BhY2U+CiAgICAgICAgIDx0aWZmOlhSZXNvbHV0aW9uPjcyMDAwMC8xMDAwMDwvdGlmZjpYUmVzb2x1dGlvbj4KICAgICAgICAgPHRpZmY6UmVzb2x1dGlvblVuaXQ+MjwvdGlmZjpSZXNvbHV0aW9uVW5pdD4KICAgICAgICAgPHRpZmY6WVJlc29sdXRpb24+NzIwMDAwLzEwMDAwPC90aWZmOllSZXNvbHV0aW9uPgogICAgICAgICA8dGlmZjpPcmllbnRhdGlvbj4xPC90aWZmOk9yaWVudGF0aW9uPgogICAgICAgICA8eG1wOkNyZWF0b3JUb29sPlBpeGVsbWF0b3IgUHJvIDIuMC4xPC94bXA6Q3JlYXRvclRvb2w+CiAgICAgICAgIDx4bXA6TWV0YWRhdGFEYXRlPjIwMjMtMTAtMjBUMDY6NDc6NTlaPC94bXA6TWV0YWRhdGFEYXRlPgogICAgICA8L3JkZjpEZXNjcmlwdGlvbj4KICAgPC9yZGY6UkRGPgo8L3g6eG1wbWV0YT4K1tP74wAAA1JJREFUWAnNmEtsTUEYx+9VfSglQrDwTFQEtUETj6pFGwuJhCBo0mUTibDxSoQlYmFt0RVqITREohJCiNQlaUKJ2ltWIl5tPa/f/+bMzXfnnHtuNffRL/nd+eabb2a+mTkzZ85NJsYh6XR6JW4bYCnMgGlQC9VQFZAkFU7SKH/hD/yGXzAGIzAMryCVTCZlm5gQ2DK4AqWS5zR8YELRUbERUqWKzGv3WL4g7ZJkfags+03YHRgfkt6AD/AZvsPPAC2fllJoWSVuuZW6R6AGXY9GA8yDLXAUnGxkuVMuE5sSYJsZYT/67NgKEyyk3dOmn55xN0Oly6Zi17gr/qcjfcyE16avJX4TU3yDKmHT9EuGoDejleCHJf1Csw9M0zuMnlFDAWLdBqszpYnESxr5GOilSu6ZhtuNHq0yg5fMlHdGexXPSl+1MGj61AbKStQMbs6WcpAavSQqK/SDhgdM45uMnphqM4yikXyzsc3Btpa8jgb3BnFvER0bqi80UDdYHS3uuNFbxL5JFIwYCfhK+g10VDlZj3LbZXICxLjdFQRpv5cvR7aFSalnZjWI7KgTGNeRP1SOCAr0sZXyczk+BDcLnsJkkg4F6Z6bs+gtOVFXPnOc2VpYxY82xvXKxxOKYAGWUc3g3lDR5DHs1C7W5vDlPYZu0Havgy44AlGi12Gc6NjRhdeXZxguwCCsgFPQBlaatHsHInbGCeslHZ+rnl8Hed2qCwp+y6HPq99kK1K2CN54Pml1POQbyYdGjG2f8csepLaTOJ26u0z9+1G+lF8zPhlVz2AoGGzTIxqwtuqI8kImW6c+j3PY7kcc5LtJ3RGkWW6AR0GZSw6jzAeVxaEzthkeg5U9NkgKWm2h05NSrKPRb6HfAb17D0IrFFvO06A2iY66/bAKciQuwBzHSmWyy1ipAAr1O+kD9K9bdkAvyOiuprugdtcaKKboZaArlT5hx6AdQhIXYC93souuBntJ37d1Bh0bNSC72tFquBXRxtN3sruw6htaf324C+tYcJPGlHkJzCUZzmS8n7gAc1xpUJ1ptKJsohFrqqNEAZVL8valAN/mieJdHnvRzazOJxp9EtWwlvgkjIJuFApYS3iXSn2k5RTdls7AYtANSB/1Pf8A3AR4UkXSi9oAAAAASUVORK5CYII=");
    // 充电状态使用闪电图标，其他车辆状态使用默认车辆图标。
    if (car.state === "charging") {
      iconData = Data.fromBase64String("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");
    }
    
    circle.drawImageAtPoint(Image.fromData(iconData), new Point(30, 34))

    let image = widget.addImage(circle.getImage(iconData));
    image.borderWidth=0;
  }
    
  
    
  Script.setWidget(widget)
  widget.presentSmall()
  Script.complete();
}

function isLocationOutOfChina(latitude, longitude) {
  if (longitude < 72.004 || longitude > 137.8347 || latitude < 0.8293 || latitude > 55.8271)
    return true;
  return false;
}


function wgs2gcj(latitude, longitude) {
  var lat = "";
  var lon = "";
  var ee = 0.00669342162296594323;
  var a = 6378245.0;
  var pi = 3.14159265358979324;

  if (isLocationOutOfChina(latitude, longitude)) {
    lat = latitude;
    lon = longitude;
  }
  else {
    var adjustLat = transformLatWithXY(longitude - 105.0, latitude - 35.0);
    var adjustLon = transformLonWithXY(longitude - 105.0, latitude - 35.0);
    var radLat = latitude / 180.0 * pi;
    var magic = Math.sin(radLat);
    magic = 1 - ee * magic * magic;
    var sqrtMagic = Math.sqrt(magic);
    adjustLat = (adjustLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * pi);
    adjustLon = (adjustLon * 180.0) / (a / sqrtMagic * Math.cos(radLat) * pi);
    latitude = latitude + adjustLat;
    longitude = longitude + adjustLon;
  }
  return { latitude: latitude, longitude: longitude };

}

function transformLatWithXY(x, y) {
  var pi = 3.14159265358979324;
  var lat = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  lat += (20.0 * Math.sin(6.0 * x * pi) + 20.0 * Math.sin(2.0 * x * pi)) * 2.0 / 3.0;
  lat += (20.0 * Math.sin(y * pi) + 40.0 * Math.sin(y / 3.0 * pi)) * 2.0 / 3.0;
  lat += (160.0 * Math.sin(y / 12.0 * pi) + 320 * Math.sin(y * pi / 30.0)) * 2.0 / 3.0;
  return lat;
}

function transformLonWithXY(x, y) {
  var pi = 3.14159265358979324;
  var lon = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  lon += (20.0 * Math.sin(6.0 * x * pi) + 20.0 * Math.sin(2.0 * x * pi)) * 2.0 / 3.0;
  lon += (20.0 * Math.sin(x * pi) + 40.0 * Math.sin(x / 3.0 * pi)) * 2.0 / 3.0;
  lon += (150.0 * Math.sin(x / 12.0 * pi) + 300.0 * Math.sin(x / 30.0 * pi)) * 2.0 / 3.0;
  return lon;
}

/**
 * 请求指定车辆的 TeslaMateApi 状态数据。
 *
 * 使用场景：正常 Widget 优先获取最新车辆状态。入参为已验证 runtimeConfig 和数字
 * 或数字字符串 carId；返回 Request.loadJSON() 的 Promise 结果。网络、HTTP 或 JSON
 * 异常原样抛给缓存回退层；请求 URL 由基础地址和车辆 ID 现场拼接。
 */
async function getCarData(runtimeConfig, carId) {
  const url = `${runtimeConfig.teslaMateApiBaseUrl}/api/v1/cars/${carId}/status`;
  let req = await new Request(url);
  return await req.loadJSON();
}

/**
 * 优先请求最新车辆状态，并在请求失败时读取指定缓存文件。
 *
 * 使用场景：中号和锁屏 Widget 共用离线回退策略。入参为 runtimeContext、标准化
 * runtimeConfig、carId 和缓存文件绝对路径；成功返回 TeslaMateApi 响应对象。网络
 * 异常且缓存不存在时重抛原异常，缓存读取或 JSON 解析异常原样抛出。
 */
async function loadCarDataWithCache(runtimeContext, runtimeConfig, carId, file) {
  const { fm } = runtimeContext;
  try {
    return await getCarData(runtimeConfig, carId);
  }
  catch (error) {
    // Request 异常可能携带完整私有 URL，只记录固定分类并保留 error 供下方控制流重抛。
    console.log("车辆状态请求失败，尝试读取缓存");
    // 只有已有缓存时才能离线回退；不存在缓存时保留原始请求失败语义。
    if (!fm.fileExists(file)) {
      throw error;
    }
    const json = await fm.readString(file);
    return JSON.parse(json);
  }
}

function hasCarMoved(car) {
  return !car.prev_geodata ||
    car.car_geodata.latitude !== car.prev_geodata.latitude ||
    car.car_geodata.longitude !== car.prev_geodata.longitude;
}

/**
 * 加载车辆位置描述和高德静态地图，并维护按车辆隔离的缓存。
 *
 * 使用场景：中号 Widget 渲染地图面板。入参为 runtimeContext、标准化 runtimeConfig、
 * carId、车辆状态及原始纬经度；返回包含地理描述、坐标和 Image 的对象。定位或地图
 * 请求失败时沿用已有缓存/占位图策略；缓存文件名和地图 Key 均来自显式参数。
 */
async function getCarGeo(runtimeContext, runtimeConfig, carId, car, lat, lng) {
  const { fm, fileRoot } = runtimeContext;
  let geo = wgs2gcj(lat, lng)
  let filename = "";
  let file = null;
  
  let json;
  filename = `car_map_${carId}.json`;
  file = fm.joinPath(fileRoot, filename);
  
  // 已有地理文字缓存时先读取，车辆未移动即可复用并跳过定位服务。
  if (fm.fileExists(file)) {
    json = await fm.readString(file);
    json = JSON.parse(json);
    console.log("Read Geo From Disk");
  }
  
  // 没有文字缓存或车辆坐标变化时重新反向地理编码，避免展示过期位置。
  if (json == null || hasCarMoved(car)) {
    // 地址文字优先使用 iOS reverseGeocode；高德 Key 仅用于下方静态地图请求。
    //let req = await new Request(url);
    //json = await req.loadString();
    
    try {
      let location = await Location.reverseGeocode(geo.latitude, geo.longitude, "zh-CN");
      json = JSON.stringify(location);
      
      //console.log(json)
      
      fm.writeString(file, json);
      json = JSON.parse(json);
      console.log("Write Geo To Disk");
    } catch (e) {
      // 定位异常可能包含坐标或系统上下文，日志只暴露固定故障分类。
      console.log("地理编码失败")
      // 定位失败且没有旧缓存时使用固定占位位置，保证 Widget 仍可完成渲染。
      if (json == null) {
        json = [{ name: "未知位置" }];
      }
    }
  }
	
  let image;
  let zoom = car.state === "driving" ? 14 : 14;
  filename = `car_map_${carId}.png`;
  file = fm.joinPath(fileRoot, filename);    
	
  // 已有地图图片缓存时先加载；车辆未移动时后续可直接复用。
  if (fm.fileExists(file)){
    image = await fm.readImage(file);
    console.log("Read Map From Disk");
  }
  

  // 缓存缺失或车辆移动时才请求新静态地图，降低高德接口调用频率。
  if (image == null || hasCarMoved(car)) {
    try {
      // URL 拼接、Request 构造和加载共享脱敏边界，任一阶段失败都不能暴露完整 URL。
      let url = `https://restapi.amap.com/v3/staticmap?scale=2&location=${geo.longitude},${geo.latitude}&zoom=${zoom}&size=150*150&key=${runtimeConfig.amapApiKey}`
      let req = await new Request(url);
      image = await req.loadImage();
      fm.writeImage(file, image);
      console.log("Write Map To Disk");
    } catch (e) {
      // Request 异常可能包含带高德 Key 的完整 query，禁止打印异常对象。
      console.log("静态地图加载失败")
    }
  }

  // 地图请求失败且无缓存时创建透明占位图，避免右侧布局因空 Image 中断。
  if (image == null) {
    let placeholder = new DrawContext();
    placeholder.size = new Size(300, 300);
    placeholder.opaque = false;
    image = placeholder.getImage();
  }

  let geofence = "未知位置";
  // iOS reverseGeocode 返回数组，高德兼容缓存返回对象；按数据形态提取位置名称。
  if (Array.isArray(json)) {
    geofence = json[0]?.name || json[0]?.thoroughfare || geofence;
  }
  else {
    geofence = json?.regeocode?.pois[0]?.name || geofence;
  }

  return {
//    "geofence" : JSON.parse(json).regeocode.addressComponent.neighborhood.name,
    "geofence" : geofence,
    "latitude" : geo.latitude,
    "longitude" : geo.longitude,
    "lat" : lat,
    "lng" : lng,
    "image" : image
  };
}

function calculateSidesLength(length, angle, size) {
      
    // 角度转换为弧度
    var angleA = 90;
    var angleB = 90 - angle;
    var angleC = angle;
    angleA = angleA * Math.PI / 180;
    angleB = angleB * Math.PI / 180;
    angleC = angleC * Math.PI / 180;

    // 使用正弦定理计算其他两边的长度
    var y = length * Math.sin(angleB) / Math.sin(angleA);
    var x = length * Math.sin(angleC) / Math.sin(angleA);
    
    return [size + parseInt(x.toFixed(0)), size - parseInt(y.toFixed(0))];
}

/**
 * 组装中号 Widget 使用的车辆、历史坐标、刷新时间和地图上下文。
 *
 * 使用场景：renderMediumWidget 在布局前准备完整 car 模型。入参为惰性
 * runtimeContext、标准化 runtimeConfig 和 carId；返回补充 `prev_geodata` 与
 * `car_geo` 的车辆对象。请求、缓存、定位或 JSON 异常遵循各下层方法规则并原样传播。
 */
async function loadCarContext(runtimeContext, runtimeConfig, carId) {
  const { fm, fileRoot, widget } = runtimeContext;
  
  // load pre data
  let filename = `car_data_${carId}.json`;
  let file = fm.joinPath(fileRoot, filename);

  const data = await loadCarDataWithCache(runtimeContext, runtimeConfig, carId, file);
  
  const car = data.data.status;
  
  // 已有车辆缓存时读取上一坐标，用于判断地图和地理信息是否需要刷新。
  if (fm.fileExists(file)) {
    try {
      let prevData = await fm.readString(file);
      prevData = JSON.parse(prevData);
      // 只有成功解析出旧响应对象时才附加上一坐标，空缓存按无历史数据处理。
      if (prevData) {
        car.prev_geodata = prevData.data.status.car_geodata;
      }
    } catch (e) {
      // 损坏缓存内容或文件异常不应进入日志，只记录可用于排障的固定分类。
      console.log("车辆缓存读取失败")
    }
  }
  // 首次运行没有历史坐标时以当前坐标初始化，避免误判车辆已移动。
  if (!car.prev_geodata) {
    car.prev_geodata = car.car_geodata;
  }

  // 行驶时需要最高刷新频率，以 10 秒最早刷新窗口更新速度与位置。
  if (car.state === "driving") {
    widget.refreshAfterDate = new Date(Date.now() + 1000 * 10);
  }
  // 充电变化慢于行驶，以 30 秒窗口更新功率和预计完成时间。
  else if (car.state === "charging") {
    widget.refreshAfterDate = new Date(Date.now() + 1000 * 30);
  }
  // 静止、睡眠等其他状态以 60 秒窗口降低无效请求频率。
  else {
    widget.refreshAfterDate = new Date(Date.now() + 1000 * 60);
  }
  
  let geo = await getCarGeo(
    runtimeContext,
    runtimeConfig,
    carId,
    car,
    car.car_geodata.latitude,
    car.car_geodata.longitude
  )
  car.car_geo = geo;

  console.log("Write Data to Disk")
  fm.writeString(file, JSON.stringify(data));

  return car;
}

/**
 * 渲染中号 TeslaMate 桌面 Widget。
 *
 * 使用场景：配置有效且非 accessory Widget 时调用。入参为惰性 runtimeContext、
 * 标准化 runtimeConfig 和 carId；无返回值。数据准备失败时异常原样传播；所有缓存、
 * URL 和 Widget 对象通过显式调用链传入，内部布局保持原有视觉结构。
 */
async function renderMediumWidget(runtimeContext, runtimeConfig, carId) {
const { widget } = runtimeContext;
widget.backgroundColor = new Color("#292929", 100);
const car = await loadCarContext(runtimeContext, runtimeConfig, carId);

// Widget UI
function createMediumLayout(widget) {
let layout = widget.addStack();
layout.layoutVertically();
//layout.setPadding(0, 0, 0, 0)

let main = layout.addStack();
main.layoutHorizontally();
//main.setPadding(0, 0, 0, 0)

let left = main.addStack();
left.layoutVertically();
left.size = new Size(190, MEDIUM_WIDGET_HEIGHT)
left.setPadding(15, 25, 15, 25)

main.addSpacer(10)

let right = main.addStack();
right.layoutVertically();
right.size = new Size(MAP_PANEL_SIZE, MEDIUM_WIDGET_HEIGHT)
right.setPadding(0, 0, 0, 0)

return { left, right };
}

const { left, right } = createMediumLayout(widget);

// Car Info
/**
 * 在中号 Widget 左侧渲染车辆名称、状态与告警信息。
 *
 * 使用场景：车辆上下文完成后构建首行信息。入参为目标 Stack、车辆对象和标准化
 * runtimeConfig；无返回值。车辆字段不完整时沿用现有 Scriptable 渲染异常语义；
 * 车辆名称链接只使用显式配置的 TeslaMate Web URL。
 */
function renderCarInfo(left, car, runtimeConfig) {
  
  let stack = left.addStack()
  stack.centerAlignContent();
  stack.setPadding(0, 0, 0, 0);
  stack.size = new Size(150, 20)
  
  // Car Name
  {
    let text = stack.addText(car.display_name + '                  ')
    text.font = Font.mediumSystemFont(16)
    text.lineLimit = 1;
    text.url=runtimeConfig.teslaMateWebUrl
  }
  
  stack.addSpacer(3)
  
  // update available
  {
    // 仅当 TeslaMate 明确标记有可用更新时显示礼物图标，false 时保持首行紧凑。
    if (car.car_versions.update_available) {
      let img = stack.addImage(SFSymbol.named("gift.circle").image);
      img.tintColor = Color.green();
      img.imageSize = new Size(18, 18);
    }
  }
  
  // Car State
  {
    //car.state = "suspended";
    
    // Tire
    {  
      // 任一胎压低于 2.45 时展示黄色告警；无胎压数据时跳过，避免访问缺失字段。
      if (car.tpms_details && (
        car.tpms_details.tpms_pressure_rl < 2.45 || 
        car.tpms_details.tpms_pressure_fl < 2.45 || 
        car.tpms_details.tpms_pressure_rr < 2.45 || 
        car.tpms_details.tpms_pressure_fr < 2.45
      )) {
        let symbol = SFSymbol.named("exclamationmark.tirepressure");
        let img = stack.addImage(symbol.image);
        img.tintColor = Color.yellow();
        img.imageSize = new Size(16, 16);
      }
    }
    
    stack.addSpacer(5)
    let symbol = null
    let color = Color.white();
    
    // 根据 TeslaMate 状态选择图标和颜色；未知状态保留 null 供下方回退为原始文字。
    switch (car.state) {
      case "asleep": {
        symbol = SFSymbol.named("moon.circle");
        color = Color.gray();
        break;
      }
      case "suspended": {
        symbol = SFSymbol.named("parkingsign.circle");
        color = Color.white();
        break;
      }
      case "online": {
        symbol = SFSymbol.named("parkingsign.circle");
        color = Color.green();
        break;
      }
      case "driving": {
        symbol = SFSymbol.named("car.circle");
        color = Color.green();
        break;
      }
      case "charging": {
        symbol = SFSymbol.named("bolt.circle");
        color = Color.green();
        break;
      }
      case "offline": {
        symbol = SFSymbol.named("wifi.exclamationmark.circle");
        color = Color.red();
        break;
      }
      case "updating": {
        symbol = SFSymbol.named("arrow.up.circle");
        color = Color.yellow();
        break;
      }
      default: {
        console.log(car.state)
      }
    }
    
    // Sentry Mode
    // 哨兵模式的红色录制图标优先于普通车辆状态，突出当前安全监控状态。
    if (car.car_status.sentry_mode === true) {
      symbol = SFSymbol.named("record.circle");
      color = Color.red()
    }
    
    // 未识别状态没有匹配图标时显示原始状态文本，否则渲染选定的 SF Symbol。
    if (symbol === null) {
      let text = stack.addText(car.state);
    }
    else {
      let img = stack.addImage(symbol.image);
      img.tintColor = color;
      img.imageSize = new Size(18, 18);
    }
    
  }
  
  stack.addSpacer(4)
  // 只有行驶状态展示实时速度，其他状态不占用首行空间。
  if (car.state === "driving") {
    let text = stack.addText(`${car.driving_details.speed}`)
    text.font = Font.mediumSystemFont(12)
    text.textColor = Color.green();
  }
 

}

renderCarInfo(left, car, runtimeConfig);

// Battery Info
function renderBatteryInfo(left, car) {
  
  left.addSpacer(15)
  
  let stack = left.addStack();
  stack.centerAlignContent();
  
  let height = 14;
  
  {
    
    let battery = new DrawContext();
    {
      battery.opaque = false;
      battery.size = new Size(50, 16);
      let path = new Path();
      path.addRoundedRect(new Rect(0, 0, 42, height), 2, 2);
      path.addRoundedRect(new Rect(43, height / 4, 3, height / 2), 1, 1);
      battery.addPath(path)
      battery.setFillColor(car.state === "charging" ? Color.green() : Color.white());
      battery.fillPath();
    }
    
    {
      
      let width = (100 - car.charging_details.charge_limit_soc) / 100 * 40;
      
      let draw = new DrawContext();
      draw.opaque = false;
      draw.size = new Size(42, height - 2);
      let path = new Path();
      path.addRoundedRect(new Rect(0, 0, width, height - 2), 1, 1);
      draw.addPath(path)
      draw.setFillColor(Color.black());
      draw.fillPath();
      
      battery.drawImageAtPoint(draw.getImage(), new Point(41 - width, 1));
    }
    
    {
      
      let width = (car.charging_details.charge_limit_soc - car.battery_details.battery_level) / 100 * 40;
      let x = car.battery_details.battery_level / 100 * 40 + 1;
      
      let draw = new DrawContext();
      draw.opaque = false;
      draw.size = new Size(42, height - 2);
      let path = new Path();
      path.addRoundedRect(new Rect(0, 0, width, height - 2), 1, 1);
      draw.addPath(path)
      draw.setFillColor(car.state === "charging" ? Color.yellow() : Color.lightGray());
      draw.fillPath();
      
      battery.drawImageAtPoint(draw.getImage(), new Point(x, 1));
      battery.setFont(Font.mediumSystemFont(11))
      battery.setTextAlignedCenter();
      battery.setTextColor(car.state === "charging" ? Color.white() : Color.black());
      
      battery.drawText(`${car.battery_details.battery_level}`, new Point(14, 0))
      
    }
    
    let image = stack.addImage(battery.getImage())
    image.imageSize = new Size(50, height)
  }
  
  {
    stack.addSpacer(5);
    stack.centerAlignContent();
    let km = `${car.battery_details.rated_battery_range}`.split('.')[0];
    let text = stack.addText(`${km}             `)
    text.textColor = car.state === "charging" ? Color.green() : Color.white();
    text.font = Font.mediumSystemFont(12)
    text.leftAlignText();
  }
  
  {
    let time = stack.addDate(new Date());
    time.size = new Size(30, 20)
    time.applyTimerStyle();
    time.minimumScaleFactor = 0.5
    time.font = Font.mediumSystemFont(12);
    time.lineLimit = 1;
    time.textColor = Color.gray();
    time.rightAlignText();
  }
  
}

renderBatteryInfo(left, car);

// Charging Status
function renderChargingStatus(left, car) {
  if (car.state === "charging") {

    let time = Math.floor(car.charging_details.time_to_full_charge * 60);
    let hour = Math.floor(time / 60);
    let min  = time - hour * 60;
    let timeText = "";
    if (hour > 0) {
      timeText = `${hour}h`;
    }
    if (min > 0) {
      timeText = timeText + `${min}m`;
    }
    
    left.addSpacer(8)
    let line1 = left.addText(` ${car.charging_details.charger_power}kW → ${car.charging_details.charge_limit_soc}% · ${timeText}         `)
    line1.lineLimit = 1;
    line1.font = Font.mediumSystemFont(12)
    line1.textColor = Color.green();

  }
}

renderChargingStatus(left, car);

// Car Status
function renderCarStatus(left, car) {
  left.addSpacer(15)
  
  let stack = left.addStack();
  
  let iconSize = new Size(20, 16);
  let spacerSize = 12;
  
  // Lock State
  {
    let symbol = null
    
    switch (car.car_status.locked) {
      case true: {
        symbol = SFSymbol.named("lock.fill");
        break;
      }
      default: {
        symbol = SFSymbol.named("lock.open.fill");
      }
    }
    
    let img = stack.addImage(symbol.image);
    img.tintColor = Color.white()
    img.imageSize = iconSize;
    img.rightAlignImage();
    stack.addSpacer(spacerSize);
  }
  
  {
    let symbol = SFSymbol.named("person.fill");
    let img = stack.addImage(symbol.image);
    img.imageSize = iconSize;
    img.tintColor = car.car_status.is_user_present === true ? Color.white() : Color.gray();
    stack.addSpacer(spacerSize);
  }
  
  {
    let symbol = SFSymbol.named("car.window.right");
    let img = stack.addImage(symbol.image);
    img.imageSize = iconSize;
    img.tintColor = car.car_status.windows_open === true ? Color.white() : Color.gray();
    //img.url = "scriptable:///run?scriptName=" + encodeURIComponent(Script.name()) + '&ctrl=' + (car.car_status.windows_open === true ? 'window_close' : 'window_open');
    stack.addSpacer(spacerSize);
  }
  
  {
    let symbol = SFSymbol.named("fan.fill");
    let img = stack.addImage(symbol.image);
    img.imageSize = iconSize;
    img.tintColor = car.climate_details.is_climate_on === true ? Color.white() : Color.gray();
    stack.addSpacer(spacerSize); 
  }
  
  {
    let symbol = SFSymbol.named("car.top.door.front.left.and.front.right.and.rear.left.and.rear.right.open.fill");
    let img = stack.addImage(symbol.image);
    img.imageSize = iconSize;
    img.tintColor = car.car_status.doors_open === true ? Color.white() : Color.gray();
  }
}

renderCarStatus(left, car);

// Location Info
function renderLocationInfo(left, car) {
  
  left.addSpacer(15)
 
  
  // Data Time
  {
    
    let stack = left.addStack();
    
    let text = stack.addText("")
  
    let desc = "long long ago"
    let time = new Date(car.state_since);
    let sec = Math.floor((new Date().getTime() - time.getTime()) / 1000);
    if (sec < 60) {
      desc = sec + 's';
    }
    else if (sec < 3600) {
      desc = Math.floor(sec / 60) + 'm';
    }
    else {
      desc = Math.floor(sec / 3600) + 'h';
    }

    text.text = desc + ' · ' + car.car_geo.geofence
    text.font = Font.mediumSystemFont(12)
    text.textColor = Color.gray();
    text.lineLimit = 2;
    //text.url = `http://maps.apple.com/?ll=${car.car_geo.latitude},${car.car_geo.longitude}&q=` + encodeURI(car.display_name);
  }
  
  
}

renderLocationInfo(left, car);


// Map
function renderMap(right, car) {
  let stack = right.addStack();
  stack.setPadding(0, 0, 0, 0)
  stack.size = new Size(MAP_PANEL_SIZE, MEDIUM_WIDGET_HEIGHT)
  {
    
    let map = new DrawContext();
    map.opaque = false;
    map.size = new Size(300, 300);
    map.drawImageAtPoint(car.car_geo.image, new Point(0, 0))
    
    let angle = car.driving_details.heading;
    let arrow = new DrawContext();
    arrow.size = new Size(40, 40);
    arrow.opaque = false;
    let size = 16;
    
    {
      let path = new Path();
      path.addLines([
        new Point(calculateSidesLength(20, angle, size)[0], calculateSidesLength(20, angle, size)[1]), 
        new Point(calculateSidesLength(20, angle + 130, size)[0], calculateSidesLength(20, angle + 130, size)[1]), 
        new Point(calculateSidesLength(8, angle + 180, size)[0], calculateSidesLength(8, angle + 180, size)[1]),      
        new Point(calculateSidesLength(20, angle - 130, size)[0], calculateSidesLength(20, angle - 130, size)[1]), 
      ]);
      arrow.addPath(path)
      arrow.setFillColor(Color.white());
      arrow.fillPath();
    }

    {
      let path = new Path();
      path.addLines([
        new Point(calculateSidesLength(14, angle, size)[0], calculateSidesLength(14, angle, size)[1]), 
        new Point(calculateSidesLength(14, angle + 130, size)[0], calculateSidesLength(14, angle + 130, size)[1]), 
        new Point(calculateSidesLength(4, angle + 180, size)[0], calculateSidesLength(4, angle + 180, size)[1]),      
        new Point(calculateSidesLength(14, angle - 130, size)[0], calculateSidesLength(14, angle - 130, size)[1]), 
      ]);
      arrow.addPath(path)
      arrow.setFillColor(Color.blue());
      arrow.fillPath();
    }
    
    map.drawImageAtPoint(arrow.getImage(), new Point(130, 130))
    
    let image = stack.addImage(map.getImage());
    image.rightAlignImage();
    image.imageSize = new Size(MAP_PANEL_SIZE, MEDIUM_WIDGET_HEIGHT);
    image.applyFillingContentMode();
    image.cornerRadius = 0;
    image.url = `http://maps.apple.com/?ll=${car.car_geo.latitude},${car.car_geo.longitude}&q=` + encodeURI(car.display_name);
  }
    
}

renderMap(right, car);

Script.setWidget(widget)
widget.presentMedium()
Script.complete();
}

/**
 * 执行 Scriptable App 或 Widget 的单一运行入口。
 *
 * 使用场景：脚本顶层仅调用一次。无入参；无业务返回值。方法先读取并验证 Keychain
 * 配置，再按 App、accessory 或中号上下文分流。配置不可用时 Widget 只显示提示，App
 * 直接进入首次配置表单；只有有效 Widget 配置才创建文件缓存运行上下文。App 已配置
 * 时先展示操作菜单，交互完成后统一结束 Script 生命周期。
 */
async function main() {
  const runtimeConfig = loadRuntimeConfig();
  const carId = params.find((item) => /^\d+$/.test(item)) || 1;

  // 配置不可用时禁止创建缓存与请求；App 直接配置，Widget 仅显示无副作用提示。
  if (!runtimeConfig) {
    // App 首次运行优先进入表单，避免依赖不存在的配置创建 WebView 或文件缓存。
    if (config.runsInApp) {
      await presentConfigForm(null);
      Script.complete();
      return;
    }
    // 非 App 的 Widget 上下文无法交互，只渲染引导用户回到 Scriptable 的提示。
    if (config.runsInWidget || config.runsInAccessoryWidget) {
      renderMissingConfigWidget(config.widgetFamily);
      return;
    }
    Script.complete();
    return;
  }

  // App 路径只展示操作菜单及其下游界面，不创建 Widget 文件缓存。
  if (config.runsInApp) {
    await presentAppMenu(runtimeConfig, carId);
    Script.complete();
    return;
  }

  const runtimeContext = createRuntimeContext();
  // accessory Widget 使用独立圆形布局；其他 Widget family 继续渲染中号布局。
  if (config.runsInAccessoryWidget) {
    await renderAccessoryWidget(runtimeContext, runtimeConfig, carId);
    return;
  }

  await renderMediumWidget(runtimeContext, runtimeConfig, carId);
}

await main();
