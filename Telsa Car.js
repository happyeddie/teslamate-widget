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
 * 使用场景：iCloud 正式配置、旧 Keychain 迁移候选和表单保存都必须得到可安全拼接
 * 路径的基础地址。入参可为
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
 * 验证并标准化三个业务配置字段。
 *
 * 使用场景：App 表单、旧 Keychain 迁移候选和 iCloud envelope 共用同一业务规则。
 * 入参为任意值；成功返回只含 `amapApiKey`、`teslaMateApiBaseUrl`、
 * `teslaMateWebUrl` 的 `{ ok: true, value }`，失败返回不含原始输入的固定消息。
 * 额外字段会被白名单过滤，方法不读取 schema、时间或任何存储。
 */
function validateBusinessConfig(input) {
  // 业务配置必须是普通非数组对象；否则不能安全读取固定白名单字段。
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, message: "运行配置格式无效" };
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
      amapApiKey,
      teslaMateApiBaseUrl: apiBaseUrlResult.value,
      teslaMateWebUrl: webUrlResult.value
    }
  };
}

/**
 * 验证 iCloud 正式文件使用的五字段 schema v1 envelope。
 *
 * 使用场景：正式、候选和备份文件在进入业务链或事务移动前都调用本方法。入参为任意
 * 值；成功返回只含固定五字段的 `{ ok: true, value }`。schema、规范 ISO 时间或业务
 * 字段非法时返回固定脱敏消息；额外字段不会进入结果。
 */
function validateICloudConfigEnvelope(input) {
  // envelope 必须是普通非数组对象，避免数组或原始值伪装成可读取配置。
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, message: "运行配置格式无效" };
  }
  // 当前仅理解 schema v1；未来版本必须由新代码显式迁移，不能猜测兼容。
  if (input.schemaVersion !== 1) {
    return { ok: false, message: "运行配置版本不受支持" };
  }
  // 更新时间必须先是字符串，才能安全传给 Date 并做逐字规范性比较。
  if (typeof input.updatedAt !== "string") {
    return { ok: false, message: "运行配置更新时间无效" };
  }
  const parsedUpdatedAt = new Date(input.updatedAt);
  // 仅接受 Date 可解析且 `toISOString()` 逐字相同的 UTC 规范时间。
  if (Number.isNaN(parsedUpdatedAt.getTime()) || parsedUpdatedAt.toISOString() !== input.updatedAt) {
    return { ok: false, message: "运行配置更新时间无效" };
  }

  const businessResult = validateBusinessConfig(input);
  // 业务字段错误已经是字段级脱敏消息，直接返回给 App 修复流程。
  if (!businessResult.ok) {
    return businessResult;
  }
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      updatedAt: input.updatedAt,
      amapApiKey: businessResult.value.amapApiKey,
      teslaMateApiBaseUrl: businessResult.value.teslaMateApiBaseUrl,
      teslaMateWebUrl: businessResult.value.teslaMateWebUrl
    }
  };
}

/**
 * 创建一次 iCloud 配置操作使用的固定路径集合。
 *
 * 使用场景：读取、恢复和保存事务必须共享同一个 `FileManager.iCloud()` 实例与目录，
 * 避免分别拼接路径造成跨根或文件名不一致。无入参；返回 manager、目录及正式、候选、
 * 备份三个固定路径。Scriptable API 异常由调用方外层 catch 统一脱敏。
 */
function createICloudConfigStorage() {
  const fm = FileManager.iCloud();
  const directoryPath = fm.joinPath(fm.documentsDirectory(), "teslamate");
  return {
    fm,
    directoryPath,
    configPath: fm.joinPath(directoryPath, "config.v1.json"),
    pendingPath: fm.joinPath(directoryPath, "config.v1.pending.json"),
    backupPath: fm.joinPath(directoryPath, "config.v1.backup.json")
  };
}

/**
 * 读取一个 iCloud 配置文件并区分内容无效与存储暂不可用。
 *
 * 使用场景：正式、备份、候选安装后的写后读校验均复用本边界。入参为所属 iCloud
 * manager 和文件绝对路径；成功返回 `{ status: "ready", value }`，JSON/schema/时间/
 * 业务字段内容错误返回 `invalid`，底层读取异常返回 `unavailable`。日志只记录固定分类。
 */
function readAndValidateICloudConfig(fm, filePath) {
  let serializedConfig;
  try {
    serializedConfig = fm.readString(filePath);
  }
  catch (error) {
    // 只有底层读取错误属于同步暂不可用；异常可能含路径或正文，日志保持固定分类。
    console.log("运行配置读取暂时不可用");
    return { status: "unavailable" };
  }

  // Scriptable/iCloud 桥接层未抛异常但返回非字符串，同样表示读取边界不可用；不能把
  // null 等值交给 JSON.parse 隐式转换，否则会误导用户进入可覆盖云端文件的修复流程。
  if (typeof serializedConfig !== "string") {
    console.log("运行配置读取暂时不可用");
    return { status: "unavailable" };
  }

  try {
    const parsed = JSON.parse(serializedConfig);
    const validationResult = validateICloudConfigEnvelope(parsed);
    // 可解析但不符合 envelope 规则属于用户可修复的 invalid，而不是同步暂不可用。
    if (!validationResult.ok) {
      console.log("运行配置内容无效");
      return { status: "invalid" };
    }
    return { status: "ready", value: validationResult.value };
  }
  catch (error) {
    // 文件已成功读取但 JSON 无法解析属于可修复内容错误，不能误报为下载暂不可用。
    console.log("运行配置内容无效");
    return { status: "invalid" };
  }
}

/**
 * 只读旧 Keychain 配置并返回一次性迁移候选状态。
 *
 * 使用场景：仅由 App 在正式与备份文件都缺失时调用；Widget 永无调用路径。无入参；
 * 有效旧 schema v1 返回只含三个业务字段的 `legacyMigrationRequired`；缺键返回 `missing`；
 * schema、字段、JSON 或非字符串正文无效返回带 `source: "legacy"` 的 `invalid`；Keychain
 * API 异常返回 `unavailable`。本方法绝不删除旧键，也不访问 iCloud 文件。
 */
function loadLegacyMigrationCandidate() {
  let serializedConfig;
  try {
    // 旧键不存在表示全新安装；不调用 get，避免 Scriptable 对缺失键抛异常。
    if (!Keychain.contains(RUNTIME_CONFIG_KEY)) {
      return { status: "missing" };
    }
    serializedConfig = Keychain.get(RUNTIME_CONFIG_KEY);
  }
  catch (error) {
    // Keychain API 异常表示安全存储暂不可用，不得误导用户覆盖或删除旧键。
    console.log("旧运行配置读取失败");
    return { status: "unavailable" };
  }

  let parsed;
  try {
    // Keychain 正常契约返回字符串；非字符串属于旧内容无效，不能交给 JSON.parse 隐式转换。
    if (typeof serializedConfig !== "string") {
      throw new Error("legacy-config-not-string");
    }
    parsed = JSON.parse(serializedConfig);
  }
  catch (error) {
    // JSON 或类型错误是用户可明确修复的 legacy invalid；日志不包含旧配置正文。
    console.log("旧运行配置内容无效");
    return { status: "invalid", source: "legacy" };
  }

  const businessResult = validateBusinessConfig(parsed);
  // 旧数据必须明确是 schema v1 且业务字段有效；来源标记让 App 选择专用修复事务。
  if (!parsed || parsed.schemaVersion !== 1 || !businessResult.ok) {
    console.log("旧运行配置内容无效");
    return { status: "invalid", source: "legacy" };
  }
  return { status: "legacyMigrationRequired", value: businessResult.value };
}

/**
 * 在 App 内验证并把唯一有效备份恢复为正式配置。
 *
 * 使用场景：正式文件缺失或内容无效且 backup 存在时，由 `loadRuntimeConfig(true)` 调用。
 * 入参 `storage` 为同一 iCloud manager 路径集合；`invalidConfigInstalled` 指示是否需要先
 * 删除无效正式文件。成功移动后必须重读正式文件；任一下载、删除、移动异常返回
 * `unavailable`，备份内容无效或恢复后内容无效返回 `invalid`。绝不检查 Keychain。
 */
async function restoreBackupConfigInApp(storage, invalidConfigInstalled) {
  try {
    await storage.fm.downloadFileFromiCloud(storage.backupPath);
    const backupResult = readAndValidateICloudConfig(storage.fm, storage.backupPath);
    // 备份未通过完整读取校验时不得删除现有正式文件或移动任何工件。
    if (backupResult.status !== "ready") {
      return backupResult.status === "invalid"
        ? { status: "invalid", source: "iCloud" }
        : backupResult;
    }
    // 只有已验证备份可接管时才删除无效正式文件，避免恢复失败扩大数据损失。
    if (invalidConfigInstalled) {
      storage.fm.remove(storage.configPath);
    }
    storage.fm.move(storage.backupPath, storage.configPath);
    const restoredResult = readAndValidateICloudConfig(storage.fm, storage.configPath);
    return restoredResult.status === "invalid"
      ? { status: "invalid", source: "iCloud" }
      : restoredResult;
  }
  catch (error) {
    // 文件系统异常不携带到日志或 UI，调用方只获得暂不可用状态。
    console.log("运行配置恢复失败");
    return { status: "unavailable" };
  }
}

/**
 * 从 iCloud 固定正式文件加载运行配置状态。
 *
 * 使用场景：`main()` 的首个业务步骤，在任何本地缓存、Request 或 WebView 之前执行。
 * 入参 `runsInApp` 决定是否允许下载、恢复备份及只读旧 Keychain 候选；Widget 仅读取已
 * 下载正式文件，任何非 ready 状态都零下载、零 Keychain。外层 catch 覆盖 manager、
 * 路径、存在性、下载状态和备份检查异常，并统一返回 `unavailable`。
 */
async function loadRuntimeConfig(runsInApp) {
  try {
    const storage = createICloudConfigStorage();
    // 正式缺失时仅 App 可恢复备份或读取旧迁移候选，Widget 直接静态降级。
    if (!storage.fm.fileExists(storage.configPath)) {
      if (storage.fm.fileExists(storage.backupPath)) {
        return runsInApp
          ? await restoreBackupConfigInApp(storage, false)
          : { status: "unavailable" };
      }
      return runsInApp ? loadLegacyMigrationCandidate() : { status: "missing" };
    }
    // App 主动请求系统下载；Widget 不触发下载，只接受系统已同步到本机的文件。
    if (runsInApp) {
      await storage.fm.downloadFileFromiCloud(storage.configPath);
    }
    else if (!storage.fm.isFileDownloaded(storage.configPath)) {
      return { status: "unavailable" };
    }

    const configResult = readAndValidateICloudConfig(storage.fm, storage.configPath);
    // 内容无效且存在备份时仅 App 可恢复；Widget 不读取备份，避免同步副作用。
    if (configResult.status === "invalid" && storage.fm.fileExists(storage.backupPath)) {
      return runsInApp
        ? await restoreBackupConfigInApp(storage, true)
        : { status: "unavailable" };
    }
    return configResult.status === "invalid"
      ? { status: "invalid", source: "iCloud" }
      : configResult;
  }
  catch (error) {
    // 任何 iCloud API 异常都只记录固定分类，错误对象可能包含路径或文件内容。
    console.log("运行配置暂时不可用");
    return { status: "unavailable" };
  }
}

/**
 * 用已验证业务配置和规范时间创建五字段 iCloud envelope。
 *
 * 使用场景：保存事务只允许把白名单字段写入 pending。入参 `input` 为
 * `validateBusinessConfig()` 的 value，`updatedAt` 为当前规范 ISO 字符串；返回显式
 * 五字段对象。方法不使用对象展开，兼容 Scriptable JavaScriptCore ES6。
 */
function createICloudConfigEnvelope(input, updatedAt) {
  return {
    schemaVersion: 1,
    updatedAt,
    amapApiKey: input.amapApiKey,
    teslaMateApiBaseUrl: input.teslaMateApiBaseUrl,
    teslaMateWebUrl: input.teslaMateWebUrl
  };
}

/**
 * 逐字段比较两个已验证 iCloud envelope。
 *
 * 使用场景：pending 与正式文件写后读必须和本次候选完全一致，JSON 字段顺序或额外字段
 * 不应影响比较。入参为两个 envelope；五字段均严格相等时返回 true，否则返回 false。
 */
function configsEqual(left, right) {
  return left.schemaVersion === right.schemaVersion &&
    left.updatedAt === right.updatedAt &&
    left.amapApiKey === right.amapApiKey &&
    left.teslaMateApiBaseUrl === right.teslaMateApiBaseUrl &&
    left.teslaMateWebUrl === right.teslaMateWebUrl;
}

/**
 * 尽力删除保存事务工件且不传播底层错误。
 *
 * 使用场景：成功清理 backup、失败清理 candidate 或 finally 清理 pending。入参为 iCloud
 * manager 和固定工件路径；无返回值。文件不存在时不调用 remove；检查或删除失败只记录
 * 固定分类，因为清理失败不能覆盖事务的主返回结果。
 */
function tryRemoveConfigArtifact(fm, filePath) {
  try {
    // 只删除确实存在的固定工件，避免无意义的 FileManager 异常扩大失败面。
    if (fm.fileExists(filePath)) {
      fm.remove(filePath);
    }
  }
  catch (error) {
    // 文件路径或系统错误可能含隐私，只保留固定清理分类。
    console.log("运行配置工件清理失败");
  }
}

/**
 * 在写入新 pending 前收敛上次中断留下的事务工件。
 *
 * 使用场景：`saveRuntimeConfig()` 每次保存的第一步。入参为同一 iCloud 存储集合与修复
 * 模式；返回 Promise<void>。方法创建固定目录、严格清理旧 pending。普通模式继续收敛或
 * 恢复既有事务工件；`iCloudInvalid`、`legacyInvalid` 与 `legacyMigration` 都把来源约束
 * 延后到 pending 完整校验之后，防止候选未验证时删除旧文件或错误套用其他来源规则。
 */
async function prepareICloudSave(storage, repairMode) {
  // 配置目录只在 App 明确保存时创建，Widget 读取路径永不创建目录。
  if (!storage.fm.isDirectory(storage.directoryPath)) {
    storage.fm.createDirectory(storage.directoryPath, true);
  }
  // 遗留 pending 必须在新写入前严格删除；清理失败时停止事务，不能依赖覆盖语义。
  if (storage.fm.fileExists(storage.pendingPath)) {
    storage.fm.remove(storage.pendingPath);
  }

  // 显式修复或迁移必须先写入并复读 pending；现有工件的检查与删除由后置边界统一完成。
  if (repairMode) {
    return;
  }

  const configExists = storage.fm.fileExists(storage.configPath);
  const backupExists = storage.fm.fileExists(storage.backupPath);
  // 正式与备份并存代表上次事务可能中断；必须依据正式文件完整校验决定清理或恢复。
  if (configExists && backupExists) {
    const configResult = readAndValidateICloudConfig(storage.fm, storage.configPath);
    if (configResult.status === "ready") {
      // 正式文件有效时 backup 是过期工件；删除失败必须停止，防止后续 move 覆盖旧工件。
      storage.fm.remove(storage.backupPath);
      return;
    }
    // 正式文件只有内容明确 invalid 才允许由备份接管；读取 unavailable 时停止以免误删。
    if (configResult.status !== "invalid") {
      throw new Error("config-read-unavailable");
    }
    const restoreResult = await restoreBackupConfigInApp(storage, true);
    // 恢复不是 ready 时不得继续写 pending 或安装新候选。
    if (restoreResult.status !== "ready") {
      throw new Error("backup-restore-failed");
    }
    return;
  }
  // 正式缺失而 backup 存在时，先恢复上次事务的有效旧值，再开始本次保存。
  if (!configExists && backupExists) {
    const restoreResult = await restoreBackupConfigInApp(storage, false);
    if (restoreResult.status !== "ready") {
      throw new Error("backup-restore-failed");
    }
  }
}

/**
 * 在 pending 已完整校验后重新确认 legacy 保存仍没有任何 iCloud 配置工件。
 *
 * 使用场景：有效旧配置迁移确认期间或无效旧配置修复表单期间，iCloud 仍可能同步出正式
 * 文件或 backup。入参为同一 iCloud 存储集合；无正常返回值。两个固定工件都缺失时允许
 * 继续安装候选；任一存在都抛固定内部错误，并保留云端正文、旧键及未安装候选。
 */
function verifyICloudArtifactsMissingForLegacySave(storage) {
  const configExists = storage.fm.fileExists(storage.configPath);
  const backupExists = storage.fm.fileExists(storage.backupPath);
  // legacy 保存没有替换 iCloud 工件的授权；发现任一文件都必须停止而不能判断或删除内容。
  if (configExists || backupExists) {
    throw new Error("legacy-save-artifacts-appeared");
  }
}

/**
 * 判断保存来源是否只能创建全新的 iCloud 正式文件。
 *
 * 使用场景：有效旧 Keychain 迁移与无效旧 Keychain 显式修复都只在初始双缺失状态获得
 * 创建授权，不能进入普通配置的覆盖事务。入参为 `saveRuntimeConfig()` 的可选模式字符串；
 * `legacyInvalid` 或 `legacyMigration` 返回 true，其余模式返回 false。方法不访问存储。
 */
function isLegacyConfigSaveMode(repairMode) {
  return repairMode === "legacyInvalid" || repairMode === "legacyMigration";
}

/**
 * 仅在正式文件仍逐字段等于本事务候选时尽力移除 legacy candidate。
 *
 * 使用场景：非覆盖 copy 成功后若 backup 出现、最终复读失败或远端替换正式文件，legacy
 * 保存必须中止；但失败清理不能无条件删除可能已被远端替换的正式正文。入参为同一 iCloud
 * 存储集合与已验证候选；无业务返回值。方法重新读取并完整验证正式文件，只有 ready 且
 * 五字段严格相等时才删除；内容不同、无效、暂不可读或删除失败都保留现状并记录固定日志。
 */
function tryRemoveLegacyCandidateIfStillCurrent(storage, candidate) {
  try {
    const currentResult = readAndValidateICloudConfig(storage.fm, storage.configPath);
    // 读到本事务候选才拥有删除授权；远端替换、损坏或暂不可读都不得触碰正式路径。
    if (currentResult.status === "ready" && configsEqual(currentResult.value, candidate)) {
      storage.fm.remove(storage.configPath);
    }
  }
  catch (error) {
    // 清理失败不能传播路径或正文，也不能转而删除 backup 或其他云端工件。
    console.log("legacy 运行配置候选清理失败");
  }
}

/**
 * 在 pending 已完整校验后验证并删除用户明确授权替换的无效工件。
 *
 * 使用场景：App 的“修复配置”入口允许解除无效 backup 导致的普通事务死锁。入参为同一
 * iCloud 存储集合；返回 Promise<void>。方法先下载并完整读取所有仍存在的正式和 backup，
 * 只有它们全部明确为 `invalid` 且至少存在一个工件时才开始删除；`ready`、`unavailable`
 * 或文件已全部消失都抛固定内部错误。删除失败可留下部分无效工件，但调用方不得安装候选、
 * 不得恢复或使用旧 backup，pending 由保存事务 finally 清理。
 */
async function removeInvalidConfigArtifactsForRepair(storage) {
  const configExists = storage.fm.fileExists(storage.configPath);
  const backupExists = storage.fm.fileExists(storage.backupPath);
  // 从 invalid 菜单进入后若工件已被系统全部移除，状态已经变化，应停止而不是猜测创建。
  if (!configExists && !backupExists) {
    throw new Error("repair-artifacts-missing");
  }

  if (configExists) {
    await storage.fm.downloadFileFromiCloud(storage.configPath);
    const configResult = readAndValidateICloudConfig(storage.fm, storage.configPath);
    // 只允许替换内容明确无效的正式文件；有效或暂不可读都必须逐字保留。
    if (configResult.status !== "invalid") {
      throw new Error("repair-config-not-invalid");
    }
  }
  if (backupExists) {
    await storage.fm.downloadFileFromiCloud(storage.backupPath);
    const backupResult = readAndValidateICloudConfig(storage.fm, storage.backupPath);
    // 无效 backup 不能作为恢复源，但也只有明确 invalid 时才属于用户本次替换授权。
    if (backupResult.status !== "invalid") {
      throw new Error("repair-backup-not-invalid");
    }
  }

  // 所有仍存在工件均完成校验后才开始删除，确保 pending 校验失败时旧内容完全不变。
  if (configExists) {
    storage.fm.remove(storage.configPath);
  }
  if (backupExists) {
    storage.fm.remove(storage.backupPath);
  }
}

/**
 * 通过 pending/backup 双标志事务保存 iCloud 运行配置。
 *
 * 使用场景：App 表单或旧 Keychain 迁移经用户确认后调用。入参为任意业务配置和可选修复
 * 来源模式；普通保存省略，iCloud 无效工件传 `iCloudInvalid`，旧 Keychain 无效且 iCloud
 * 工件缺失传 `legacyInvalid`，有效旧 Keychain 确认迁移传 `legacyMigration`。两个 legacy
 * 模式都必须在 pending 完整校验后重新确认云端工件仍全部缺失，再以非覆盖 copy 安装，
 * 与普通 backup/move 替换事务完全互斥；copy 后还要在返回成功前复查 backup。
 * 成功返回 `{ ok: true, value }`，value 是完成两次写后读校验的五字段 envelope；校验或
 * 任何 iCloud 步骤失败返回固定脱敏结果。
 * `backupCreatedByTransaction` 仅在正式成功移到 backup 后置位，
 * `candidateInstalled` 仅在 pending 成功安装后置位，失败清理严格依据本次事务状态，绝不
 * 误删未安装候选前的正式文件。方法不使用 Node API，不访问 Keychain。
 */
async function saveRuntimeConfig(input, repairMode = null) {
  const businessResult = validateBusinessConfig(input);
  // 业务校验失败时不创建目录、不写任何工件，保留现有配置逐字不变。
  if (!businessResult.ok) {
    return businessResult;
  }

  const candidate = createICloudConfigEnvelope(
    businessResult.value,
    new Date().toISOString()
  );
  let storage;
  try {
    storage = createICloudConfigStorage();
  }
  catch (error) {
    // manager 或路径构造失败也必须转换为固定保存失败，不能向 UI 抛系统详情。
    console.log("运行配置保存失败");
    return { ok: false, message: "运行配置保存失败" };
  }

  let backupCreatedByTransaction = false;
  let candidateInstalled = false;
  const legacySaveMode = isLegacyConfigSaveMode(repairMode);
  try {
    await prepareICloudSave(storage, repairMode);
    storage.fm.writeString(storage.pendingPath, JSON.stringify(candidate));
    const pendingResult = readAndValidateICloudConfig(storage.fm, storage.pendingPath);
    // pending 必须内容有效且逐字段等于内存候选，任何差异都停止在安装之前。
    if (pendingResult.status !== "ready" || !configsEqual(pendingResult.value, candidate)) {
      throw new Error("pending-validation-failed");
    }

    // 只有用户明确修复且 pending 已逐字段匹配时，才验证并移除现有无效工件。
    if (repairMode === "iCloudInvalid") {
      await removeInvalidConfigArtifactsForRepair(storage);
    }
    // 两种 legacy 来源都没有替换云端工件的授权；pending 验证后必须重新确认两者仍缺失。
    else if (legacySaveMode) {
      verifyICloudArtifactsMissingForLegacySave(storage);
    }

    // legacy 只有“新建”授权，必须使用目标存在即失败的 copy，且绝不创建或接管 backup。
    if (legacySaveMode) {
      storage.fm.copy(storage.pendingPath, storage.configPath);
      candidateInstalled = true;
    }
    else {
      // 普通保存才允许把已有正式文件移为本次 backup；move 成功后置位供 catch 精确恢复。
      if (storage.fm.fileExists(storage.configPath)) {
        storage.fm.move(storage.configPath, storage.backupPath);
        backupCreatedByTransaction = true;
      }
      storage.fm.move(storage.pendingPath, storage.configPath);
      candidateInstalled = true;
    }

    const finalResult = readAndValidateICloudConfig(storage.fm, storage.configPath);
    // 正式写后读必须再次完整校验并逐字段匹配，防止同步或文件系统窗口产生静默错写。
    if (finalResult.status !== "ready" || !configsEqual(finalResult.value, candidate)) {
      throw new Error("final-validation-failed");
    }
    // copy 无法保护独立 backup 路径；legacy 返回成功前必须复查，发现即进入候选安全清理。
    if (legacySaveMode && storage.fm.fileExists(storage.backupPath)) {
      throw new Error("legacy-backup-appeared-after-copy");
    }
    // 只有普通替换事务拥有清理 backup 的授权；legacy 无论成功或失败都不得删除它。
    if (!legacySaveMode) {
      tryRemoveConfigArtifact(storage.fm, storage.backupPath);
    }
    return { ok: true, value: candidate };
  }
  catch (error) {
    // legacy 必须复读确认正式仍是本事务候选；普通事务沿用 candidateInstalled 精确清理。
    if (candidateInstalled) {
      if (legacySaveMode) {
        tryRemoveLegacyCandidateIfStillCurrent(storage, candidate);
      }
      else {
        tryRemoveConfigArtifact(storage.fm, storage.configPath);
      }
    }
    // 只有本次事务确实创建了 backup 才尝试恢复，不能移动既有或无关 backup。
    if (backupCreatedByTransaction) {
      try {
        storage.fm.move(storage.backupPath, storage.configPath);
      }
      catch (restoreError) {
        // 恢复错误不记录对象，候选也不得因恢复失败被调用方继续使用。
        console.log("运行配置恢复失败");
      }
    }
    console.log("运行配置保存失败");
    return { ok: false, message: "运行配置保存失败" };
  }
  finally {
    // pending 无论成功、失败或已移动均尽力清理；该清理不改变主事务返回值。
    tryRemoveConfigArtifact(storage.fm, storage.pendingPath);
  }
}

/**
 * 使用独立原生 Alert 展示不含敏感配置值的状态消息。
 *
 * 使用场景：配置校验失败、iCloud 保存失败或保存成功后，需要等待用户明确确认再
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
 * 使用场景：用户从创建、管理或显式修复入口进入配置表单时调用。入参 `initialConfig`
 * 为已验证配置或 null；`repairMode` 为 null、`iCloudInvalid` 或 `legacyInvalid`，仅由对应
 * App 菜单传入；成功保存返回标准化配置，取消、保存失败返回 null。文本框固定按高德 Key、
 * TeslaMateApi URL、TeslaMate Web URL 排列，Key 使用安全文本框；校验失败会保留本次原始
 * 输入重试，所有状态提示均使用固定脱敏文案。Alert 或 iCloud 事务之外的意外异常原样抛出。
 */
async function presentConfigForm(initialConfig, repairMode = null) {
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
    form.message = "配置将保存在 iCloud Drive 中";
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
    const validationResult = validateBusinessConfig(candidate);
    // 校验失败时保留未标准化原始输入，方便用户只修正错误字段；提示不回显具体值。
    if (!validationResult.ok) {
      formValues = candidate;
      await presentMessage("配置无效", "请检查所有配置项后重试");
      continue;
    }

    const saveResult = await saveRuntimeConfig(validationResult.value, repairMode);
    // 候选已通过校验，此处失败只代表 iCloud 事务失败；旧值由双标志算法尽力恢复。
    if (!saveResult.ok) {
      await presentMessage("保存失败", "无法保存配置，请稍后重试");
      return null;
    }

    // legacy invalid 修复必须重新经过正式文件加载门禁，逐字段一致后才有权删除旧键。
    if (repairMode === "legacyInvalid") {
      const verifiedResult = await loadRuntimeConfig(true);
      if (verifiedResult.status !== "ready" ||
        !configsEqual(verifiedResult.value, saveResult.value)) {
        await presentMessage("修复失败", "无法验证 iCloud 配置，请稍后重试");
        return null;
      }
      try {
        Keychain.remove(RUNTIME_CONFIG_KEY);
      }
      catch (error) {
        // 正式文件已验证有效时不回滚；旧键虽保留，但后续 ready 路径不会再访问它。
        console.log("旧运行配置清理失败");
        await presentMessage("修复失败", "iCloud 配置已保存，但旧配置清理失败");
        return null;
      }
    }

    await presentMessage("保存成功", "已保存到 iCloud Drive，将由系统同步到其他设备");
    return saveResult.value;
  }
}

/**
 * 展示正式与备份都缺失时的明确 App 创建入口。
 *
 * 使用场景：全新安装或 iCloud 尚未出现配置文件时调用。无入参；菜单固定为“重试同步 / 创建
 * 新配置 / 取消”。重试后仍 missing 会通过 while 重新展示，不递归；创建才进入空表单。
 * 返回重试得到的非 missing 状态，创建、取消或保存完成返回 null；调用方本次运行均不进入
 * 业务链，避免刚保存的内存候选绕过下一次正式读取门禁。
 */
async function presentMissingConfigMenu() {
  while (true) {
    const menu = new Alert();
    menu.title = "尚未找到 iCloud 配置";
    menu.message = "可以重试同步，或明确创建一份新配置";
    menu.addAction("重试同步");
    menu.addAction("创建新配置");
    menu.addCancelAction("取消");
    const actionIndex = await menu.presentSheet();

    // 固定下标 1 是唯一创建入口；保存结果只影响下次脚本运行。
    if (actionIndex === 1) {
      await presentConfigForm(null);
      return null;
    }
    // 取消及越界响应直接结束，不读取表单、不创建配置目录。
    if (actionIndex !== 0) {
      return null;
    }
    const retryResult = await loadRuntimeConfig(true);
    // iCloud 仍缺失时重新展示同一菜单；其他状态交回 main 的状态分派处理。
    if (retryResult.status !== "missing") {
      return retryResult;
    }
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
 * 使用场景：中号桌面和 accessoryCircular 锁屏入口在 iCloud 配置非 ready 时调用。
 * 入参为当前 widget family；返回创建的 ListWidget，便于调用方或测试观察。该方法只
 * 创建提示 Widget，不访问 FileManager 或网络；Scriptable API 异常原样抛出。
 */
function renderUnavailableConfigWidget(widgetFamily) {
  const widget = new ListWidget();
  widget.setPadding(12, 12, 12, 12);
  const message = widget.addText("等待 iCloud 配置同步，请在 Scriptable 中运行脚本检查配置");
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
 * 展示 iCloud 配置暂不可用时唯一安全的 App 菜单。
 *
 * 使用场景：下载、文件系统或恢复步骤失败后，App 不能创建或修复配置以免覆盖仍在同步的
 * 文件。无入参；菜单只提供“重试同步”和取消，选择重试返回 true，取消返回 false。
 */
async function presentUnavailableConfigMenu() {
  const menu = new Alert();
  menu.title = "iCloud 配置暂不可用";
  menu.message = "请确认 iCloud Drive 已启用并稍后重试";
  menu.addAction("重试同步");
  menu.addCancelAction("取消");
  const actionIndex = await menu.presentSheet();
  // 固定下标 0 表示显式重试；取消及越界响应均不得执行其他配置动作。
  return actionIndex === 0;
}

/**
 * 展示 iCloud 文件或旧 Keychain 内容无效时的 App 修复菜单。
 *
 * 使用场景：iCloud 正式/backup 内容无效，或两者缺失且旧 Keychain 内容无效。
 * 无入参；动作固定为“重试读取 / 修复配置 / 取消”。返回 `retry`、`repair` 或 null，
 * 调用方通过动作字符串控制循环；本方法不读取、不删除也不覆盖配置文件。
 */
async function presentInvalidConfigMenu() {
  const menu = new Alert();
  menu.title = "iCloud 配置无效";
  menu.message = "可以重试读取，或明确创建修复后的配置";
  menu.addAction("重试读取");
  menu.addAction("修复配置");
  menu.addCancelAction("取消");
  const actionIndex = await menu.presentSheet();
  // 固定下标 0 只表示重新读取，不允许同时进入修复表单。
  if (actionIndex === 0) {
    return "retry";
  }
  // 固定下标 1 是唯一修复入口；取消和越界响应统一返回 null。
  if (actionIndex === 1) {
    return "repair";
  }
  return null;
}

/**
 * 显示一次性旧 Keychain 配置迁移确认并执行验证后删除。
 *
 * 使用场景：仅 App 在正式与备份都缺失、旧 schema v1 候选有效时调用。入参
 * `legacyConfig` 是只含三个业务字段的白名单候选；用户确认后以显式 `legacyMigration`
 * 模式走完整 iCloud 保存事务，再重新从正式文件加载并与保存 envelope 逐字段比较，全部
 * 成功后才删除旧键。取消不改任何存储；保存、复读、比较或删除任一步失败都显示固定
 * “迁移失败”、保留旧键并结束，不把候选或新正式文件用于本次业务链。
 */
async function presentLegacyMigrationPrompt(legacyConfig) {
  const prompt = new Alert();
  prompt.title = "迁移旧配置";
  prompt.message = "检测到旧配置，可以迁移到 iCloud Drive";
  prompt.addAction("迁移到 iCloud Drive");
  prompt.addCancelAction("取消");
  const actionIndex = await prompt.presentAlert();
  // 只有固定下标 0 表示用户确认；取消时绝不创建目录、写文件或删除旧键。
  if (actionIndex !== 0) {
    return { status: "unavailable" };
  }

  const saveResult = await saveRuntimeConfig(legacyConfig, "legacyMigration");
  // iCloud 事务失败时旧键仍是唯一迁移源，必须保留并用固定提示结束本次运行。
  if (!saveResult.ok) {
    await presentMessage("迁移失败", "无法迁移旧配置，请稍后重试");
    return { status: "unavailable" };
  }

  const verifiedResult = await loadRuntimeConfig(true);
  // 删除旧键前必须重新通过正式读取门禁，且五字段逐项等于本次保存的候选。
  if (verifiedResult.status !== "ready" ||
    !configsEqual(verifiedResult.value, saveResult.value)) {
    await presentMessage("迁移失败", "无法验证 iCloud 配置，请稍后重试");
    return { status: "unavailable" };
  }

  try {
    Keychain.remove(RUNTIME_CONFIG_KEY);
  }
  catch (error) {
    // 正式文件已经有效时不回滚；旧键成为不可达遗留，下次 ready 路径不会再访问它。
    console.log("旧运行配置清理失败");
    await presentMessage("迁移失败", "iCloud 配置已保存，但旧配置清理失败");
    return { status: "unavailable" };
  }
  await presentMessage("迁移成功", "旧配置已迁移到 iCloud Drive");
  return { status: "ready", value: verifiedResult.value };
}

/**
 * 在 App 内通过循环分派所有非 ready 配置状态。
 *
 * 使用场景：`main()` 首次加载得到 missing、invalid、unavailable 或
 * legacyMigrationRequired 时调用。入参为初始状态结果；无业务返回值。重试通过 while
 * 更新当前状态，不递归；创建、修复、迁移、取消或重试变为 ready 后都结束本次运行，
 * 确保保存候选不会绕过下一次脚本启动的正式读取门禁。
 */
async function presentNonReadyConfigInApp(initialResult) {
  let currentResult = initialResult;
  while (currentResult.status !== "ready") {
    // missing 菜单自身负责“仍 missing”的循环，返回值只可能是其他状态或 null。
    if (currentResult.status === "missing") {
      const retryResult = await presentMissingConfigMenu();
      if (!retryResult) {
        return;
      }
      currentResult = retryResult;
      continue;
    }
    // unavailable 只能重试或取消，永远不提供创建/修复动作以免覆盖仍在同步的文件。
    if (currentResult.status === "unavailable") {
      const shouldRetry = await presentUnavailableConfigMenu();
      if (!shouldRetry) {
        return;
      }
      currentResult = await loadRuntimeConfig(true);
      continue;
    }
    // invalid 只有明确修复才打开空表单；来源决定事务能替换无效 iCloud 工件，还是只能
    // 在正式/backup 仍缺失时从 legacy 创建。重试仅重新加载并回到状态循环。
    if (currentResult.status === "invalid") {
      const invalidAction = await presentInvalidConfigMenu();
      if (invalidAction === "repair") {
        if (currentResult.source === "iCloud") {
          await presentConfigForm(null, "iCloudInvalid");
        }
        else if (currentResult.source === "legacy") {
          await presentConfigForm(null, "legacyInvalid");
        }
        return;
      }
      if (invalidAction !== "retry") {
        return;
      }
      currentResult = await loadRuntimeConfig(true);
      continue;
    }
    // 旧候选只通过确认迁移流程处理，完成或失败后本次运行都立即结束。
    if (currentResult.status === "legacyMigrationRequired") {
      await presentLegacyMigrationPrompt(currentResult.value);
      return;
    }
    // 防御未知状态：不猜测兼容、不进入业务链，直接安全结束交互。
    return;
  }
}

/**
 * 使用已验证的 TeslaMate Web 地址打开车辆页面并隐藏其他车辆卡片。
 *
 * 使用场景：配置有效且 Scriptable 在 App 内运行。入参为标准化 runtimeConfig 和
 * 当前 carId；成功时等待 WebView 被关闭后才返回。WebView 创建、加载、脚本注入或
 * 展示任一步失败时记录固定分类日志，并抛出固定 `Error("TeslaMate 页面打开失败")`；
 * 原始异常和 URL 均不会离开本方法，避免私有 Web 地址出现在 Scriptable 错误界面。
 */
async function openTeslaMateWebView(runtimeConfig, carId) {
  try {
    const wv = new WebView();
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
        `);
      }
    }

    // present 的 Promise 在页面关闭后才完成；必须等待它再允许 main 调用 Script.complete。
    await wv.present();
  }
  catch (error) {
    // WebView 异常可能携带加载 URL、注入脚本或系统上下文，只保留固定故障分类。
    console.log("TeslaMate 页面打开失败");
    throw new Error("TeslaMate 页面打开失败");
  }
}

/**
 * 展示已配置 App 的操作菜单，并按固定动作下标打开页面或进入配置管理。
 *
 * 使用场景：Scriptable 在 App 内运行且 iCloud 正式配置已验证。入参为标准化
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
 * 异常且缓存不存在时抛出固定脱敏错误，确保保留“无法取得车辆数据”的失败语义但不
 * 暴露 Request 可能携带的完整 API URL；缓存读取或 JSON 解析异常仍遵循其原有异常语义。
 */
async function loadCarDataWithCache(runtimeContext, runtimeConfig, carId, file) {
  const { fm } = runtimeContext;
  try {
    return await getCarData(runtimeConfig, carId);
  }
  catch (error) {
    // Request 异常可能携带完整私有 URL，只记录固定分类，绝不输出或继续传播该对象。
    console.log("车辆状态请求失败，尝试读取缓存");
    // 只有已有缓存时才能离线回退；不存在缓存时保留失败语义但转换为固定脱敏 Error。
    if (!fm.fileExists(file)) {
      throw new Error("车辆状态加载失败");
    }
    const json = await fm.readString(file);
    return JSON.parse(json);
  }
}

/**
 * 判断车辆是否相对上次成功缓存的位置发生移动。
 *
 * 使用场景：地理编码和静态地图缓存需要决定是否重新请求位置相关数据。入参 `car`
 * 必须包含当前 `car_geodata`，可选 `prev_geodata`；返回 true 表示无历史坐标或任一
 * 经纬度不同，返回 false 表示可复用位置缓存。该方法不进行浮点容差计算：TeslaMate
 * 返回值变化即视为位置更新；缺少当前坐标时由调用链的数据契约异常处理，方法不吞错。
 */
function hasCarMoved(car) {
  // 首次没有历史坐标必须刷新，随后分别比较纬度和经度以避免只沿单一方向移动被遗漏。
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

/**
 * 依据航向角计算地图箭头顶点在画布中的坐标。
 *
 * 使用场景：renderMap 以同一规则绘制白色外层和蓝色内层的四边箭头。入参 `length` 是
 * 从中心到顶点的长度，`angle` 是以正上方为零点的角度，`size` 是中心坐标；返回包含
 * 整数 `[x, y]` 的数组。方法通过正弦定理把极坐标投影到 Scriptable 画布坐标系，结果
 * 四舍五入以避免子像素模糊；数学输入异常（如 NaN）按 JavaScript 原始计算结果传播，
 * 因为航向由上游 TeslaMate 数据契约保证。
 */
function calculateSidesLength(length, angle, size) {
    // 先将角度换算为弧度；画布 y 轴向下，因此使用 90 度补角匹配顶部为零点的航向定义。
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
  /**
   * 创建中号 Widget 的左右两栏基础布局。
   *
   * 使用场景：车辆数据准备完成后，所有左侧状态区与右侧地图区共用这一固定容器。入参
   * `widget` 为尚未提交的 ListWidget；返回 `{ left, right }` 两个纵向 Stack，左侧宽
   * 190、高 176 并保留信息区内边距，右侧使用 176×176 地图面板。此方法只创建布局，
   * 不读取车辆数据、不发起请求；Scriptable Stack 创建异常原样传播。两栏间距固定为
   * 10，分支不存在，以确保中号尺寸下信息与地图不会相互挤压。
   */
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

  /**
   * 渲染电池图、额定续航和相对刷新时间。
   *
   * 使用场景：中号 Widget 左侧在车辆概览行后展示电量核心信息。入参 `left` 为布局
   * 左栏 Stack，`car` 为含 `battery_details` 与 `charging_details` 的车辆状态；无返回
   * 值，直接向 Stack 追加元素。电池外壳颜色按是否充电区分；黑色区域表示充电上限以
   * 上不可用部分，浅色/黄色区域表示当前电量到上限的差值，计算比例以 40 像素有效宽
   * 度换算。字段不满足 TeslaMate 数据契约时保留原有 Scriptable 异常语义。
   */
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

  /**
   * 仅在充电中展示功率、目标电量与预计剩余时间。
   *
   * 使用场景：中号 Widget 的电池信息下方补充充电过程数据。入参 `left` 为左栏 Stack，
   * `car` 为 TeslaMate 车辆状态；无返回值。只有 `car.state === "charging"` 时追加一
   * 行，其他状态不占用布局空间；剩余小时数先换算成整数分钟，再拆为小时和分钟，以
   * 避免浮点小时直接展示。充电字段缺失时沿用既有数据契约异常，不在此处猜测默认值。
   */
function renderChargingStatus(left, car) {
  // 非充电状态不显示空白占位；分支依据是该行只对实时充电过程有业务意义。
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

  /**
   * 渲染锁定、乘员、车窗、空调和车门五项状态图标。
   *
   * 使用场景：中号 Widget 左侧用紧凑图标概览车辆控制状态。入参 `left` 为左栏 Stack，
   * `car` 需包含 `car_status` 与 `climate_details`；无返回值。锁定状态使用锁/开锁图标，
   * 其余四项按布尔值选择白色（开启/有人）或灰色（关闭/无人）；该视觉规则让异常状态
   * 比默认静止状态更醒目。字段缺失时保留原始数据契约异常语义。
   */
function renderCarStatus(left, car) {
  left.addSpacer(15)

  let stack = left.addStack();

  let iconSize = new Size(20, 16);
  let spacerSize = 12;

  // Lock State
  {
    let symbol = null

    // 锁定为 true 时显示闭锁，其他值统一按未锁处理，避免不确定状态被误标为安全。
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

  /**
   * 渲染车辆状态时间与地理编码得到的位置名称。
   *
   * 使用场景：中号 Widget 左侧底部提供数据新鲜度和停车位置摘要。入参 `left` 为左栏
   * Stack，`car` 需包含 ISO 时间 `state_since` 和 `car_geo.geofence`；无返回值。状态时
   * 间距当前不足一分钟显示秒、不足一小时显示分钟、其余显示小时，避免长时间戳挤占
   * 布局；无效日期按既有 Date 行为进入小时分支，不在展示层记录或抛出敏感信息。
   */
function renderLocationInfo(left, car) {

  left.addSpacer(15)


  // Data Time
  {

    let stack = left.addStack();

    let text = stack.addText("")

    let desc = "long long ago"
    let time = new Date(car.state_since);
    let sec = Math.floor((new Date().getTime() - time.getTime()) / 1000);
    // 依时间差选择最短可读单位；分支顺序从细到粗，确保 59 秒不会被提前格式化为 0 分钟。
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


  /**
   * 渲染静态地图、车辆航向箭头及 Apple Maps 跳转链接。
   *
   * 使用场景：中号 Widget 右栏展示 getCarGeo 已准备的地图图片。入参 `right` 为右栏
   * Stack，`car` 需包含 `car_geo.image`、坐标及 `driving_details.heading`；无返回值。先
   * 在 300×300 画布合成地图和箭头，再缩放到 176×176 面板；箭头四个顶点根据航向角
   * 计算，外层白色描边与内层蓝色填充提高任何地图底色上的可见度。图片或坐标缺失时
   * 保留上游数据契约异常语义；链接仅包含运行时车辆坐标，不写入日志或持久配置。
   */
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
 * 使用场景：脚本顶层仅调用一次。无入参；无业务返回值。方法首句异步读取 iCloud 配置
 * 状态，再按 App、accessory 或中号上下文分流。只有 ready 才创建本地缓存、WebView 或
 * Request；Widget 的其余状态统一显示同步提示。App 非 ready 交互由状态分支处理并在本次
 * 运行结束后重新启动才允许进入业务链。
 */
async function main() {
  const configResult = await loadRuntimeConfig(config.runsInApp);
  const carId = params.find((item) => /^\d+$/.test(item)) || 1;

  // 非 ready 状态必须在任何业务对象创建前结束；App 按状态提供受限安全交互。
  if (configResult.status !== "ready") {
    if (config.runsInApp) {
      await presentNonReadyConfigInApp(configResult);
      Script.complete();
      return;
    }
    // 非 App 的 Widget 上下文无法交互，只渲染引导用户回到 Scriptable 的提示。
    if (config.runsInWidget || config.runsInAccessoryWidget) {
      renderUnavailableConfigWidget(config.widgetFamily);
      return;
    }
    Script.complete();
    return;
  }

  // App 路径只展示操作菜单及其下游界面，不创建 Widget 文件缓存。
  if (config.runsInApp) {
    await presentAppMenu(configResult.value, carId);
    Script.complete();
    return;
  }

  const runtimeContext = createRuntimeContext();
  // accessory Widget 使用独立圆形布局；其他 Widget family 继续渲染中号布局。
  if (config.runsInAccessoryWidget) {
    await renderAccessoryWidget(runtimeContext, configResult.value, carId);
    return;
  }

  await renderMediumWidget(runtimeContext, configResult.value, carId);
}

await main();
