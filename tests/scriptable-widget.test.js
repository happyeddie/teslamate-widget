const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { collectByType, runScriptableScript } = require("./scriptable-runtime");

const RUNTIME_CONFIG_KEY = "teslamate-widget.config.v1";
const SCRIPT_PATH = path.join(__dirname, "..", "Telsa Car.js");
const SENTINEL_AMAP_API_KEY = "sentinel-amap-key-never-real";
const SENTINEL_API_BASE_URL = "https://api.example.test";
const SENTINEL_WEB_URL = "https://web.example.test";
const ICLOUD_CONFIG_PATH = "teslamate/config.v1.json";
const ICLOUD_PENDING_PATH = "teslamate/config.v1.pending.json";
const ICLOUD_BACKUP_PATH = "teslamate/config.v1.backup.json";

/**
 * 将测试配置序列化为生产脚本使用的单键 Keychain 值。
 *
 * 使用场景：缺失配置门禁和正常 Widget 流程都需要构造不含真实凭据的 schema v1
 * 配置。入参 `overrides` 可覆盖任意配置字段；返回完整配置的 JSON 字符串。测试只
 * 使用保留域名和虚构 Key，不会读写外部安全存储；不可序列化值会由 JSON.stringify
 * 原样抛出，使测试立即失败。
 */
function runtimeConfigJson(overrides = {}) {
  return JSON.stringify({
    schemaVersion: 1,
    amapApiKey: SENTINEL_AMAP_API_KEY,
    teslaMateApiBaseUrl: `${SENTINEL_API_BASE_URL}///`,
    teslaMateWebUrl: `${SENTINEL_WEB_URL}///`,
    ...overrides
  });
}

/**
 * 构造只含固定五字段的 iCloud 配置 envelope。
 *
 * 使用场景：所有正常运行、读取状态与备份恢复测试都通过同一 fixture 注入虚构配置，
 * 避免测试间出现时间格式或字段白名单差异。入参 `overrides` 可覆盖任意字段以制造无效
 * 内容；返回 JSON 字符串。固定时间为规范 ISO，三个业务值均为保留域名或 sentinel。
 */
function iCloudConfigJson(overrides = {}) {
  return JSON.stringify({
    schemaVersion: 1,
    updatedAt: "2026-07-18T08:00:00.000Z",
    amapApiKey: SENTINEL_AMAP_API_KEY,
    teslaMateApiBaseUrl: SENTINEL_API_BASE_URL,
    teslaMateWebUrl: SENTINEL_WEB_URL,
    ...overrides
  });
}

/**
 * 返回正常运行所需的已下载 iCloud 配置 fixture。
 *
 * 使用场景：中号、锁屏、App、WebView、缓存和网络降级测试需要统一从正式 iCloud 文件
 * 进入 ready。无入参；返回可展开到 runtime options 的新对象，调用方可继续覆盖其他选项。
 */
function readyICloudFixture() {
  return {
    iCloudFiles: { [ICLOUD_CONFIG_PATH]: iCloudConfigJson() },
    iCloudDownloadedFiles: [ICLOUD_CONFIG_PATH]
  };
}

/**
 * 从 runtime 隔离的 iCloud documents 中读取测试配置 JSON。
 *
 * 使用场景：保存事务必须验证正式文件实际只含五个白名单字段，而 runtime 观测为安全起见
 * 不返回正文。入参为执行结果与相对路径；返回解析后的对象。该 helper 只读取测试创建的
 * 临时目录，路径由固定常量提供，不接触用户真实 iCloud。
 */
function readICloudConfig(result, relativePath = ICLOUD_CONFIG_PATH) {
  return JSON.parse(fs.readFileSync(
    path.join(result.iCloudDocumentsDirectory, relativePath),
    "utf8"
  ));
}

/**
 * 注册 runtime 本地与 iCloud 两个隔离目录的统一清理。
 *
 * 使用场景：配置读取和事务测试都会同时创建两类临时 documents。入参为 node:test 上下文
 * 与执行结果；无返回值。无论测试通过或失败，回调都递归删除隔离目录。
 */
function cleanupRuntimeDirectories(t, result) {
  t.after(() => {
    fs.rmSync(result.documentsDirectory, { recursive: true, force: true });
    fs.rmSync(result.iCloudDocumentsDirectory, { recursive: true, force: true });
  });
}

/**
 * 静态验证成功 runtime 结果只能通过统一 helper 清理 local 与 iCloud 两个临时根。
 *
 * 使用场景：`runScriptableScript()` 即使测试未显式传 iCloud fixture，也会创建默认 iCloud
 * documents；只删除 local 会持续泄漏临时目录。无业务入参；测试读取当前测试文件，要求
 * `fs.rmSync(result.*DocumentsDirectory)` 各只在 `cleanupRuntimeDirectories()` 中出现一次。
 */
test("所有 runtime 结果统一清理 local 与 iCloud 临时目录", () => {
  const source = fs.readFileSync(__filename, "utf8");
  const localCleanupCalls = source.match(/fs\.rmSync\(result\.documentsDirectory/g) || [];
  const iCloudCleanupCalls = source.match(/fs\.rmSync\(result\.iCloudDocumentsDirectory/g) || [];
  const readyFixtureTestBlocks = source.split("\ntest(")
    .filter((testBlock) => testBlock.includes("readyICloudFixture()"));
  const runtimeTestBlocks = source.split("\ntest(")
    .filter((testBlock) => testBlock.includes("runScriptableScript("));

  assert.equal(localCleanupCalls.length, 1, "仍存在绕过统一 helper 的 local runtime 清理");
  assert.equal(iCloudCleanupCalls.length, 1, "仍存在绕过统一 helper 的 iCloud runtime 清理");
  // 每个使用 ready fixture 的测试块都必须显式注册统一清理，覆盖自定义 local 根场景。
  for (const testBlock of readyFixtureTestBlocks) {
    assert.equal(testBlock.includes("cleanupRuntimeDirectories("), true,
      "readyICloudFixture 测试缺少统一 runtime 目录清理");
  }
  // 抛错前无法取得 result 的测试必须预先创建并注册两个根；其余测试统一从 result 清理。
  for (const testBlock of runtimeTestBlocks) {
    const cleansSuccessfulResult = testBlock.includes("cleanupRuntimeDirectories(");
    const preallocatesFailureRoots = testBlock.includes("createRuntimeDocumentsDirectory(") &&
      testBlock.includes("createRuntimeICloudDocumentsDirectory(");
    assert.equal(cleansSuccessfulResult || preallocatesFailureRoots, true,
      "runtime 测试既未统一清理结果，也未预分配两个故障目录");
  }
});

function deepMerge(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      target[key] = deepMerge(target[key] || {}, value);
    }
    else {
      target[key] = value;
    }
  }
  return target;
}

function carStatus(state = "online", overrides = {}) {
  return deepMerge({
    display_name: "Model Y",
    state,
    state_since: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    battery_details: {
      battery_level: 67,
      rated_battery_range: 331.2
    },
    car_geodata: {
      latitude: 31.2304,
      longitude: 121.4737
    },
    car_status: {
      doors_open: false,
      is_user_present: false,
      locked: true,
      sentry_mode: false,
      windows_open: false
    },
    car_versions: {
      update_available: false
    },
    charging_details: {
      charge_limit_soc: 80,
      charger_power: 0,
      time_to_full_charge: 0
    },
    climate_details: {
      is_climate_on: false
    },
    driving_details: {
      heading: 92,
      speed: 0
    },
    tpms_details: {
      tpms_pressure_fl: 2.6,
      tpms_pressure_fr: 2.6,
      tpms_pressure_rl: 2.6,
      tpms_pressure_rr: 2.6
    }
  }, overrides);
}

function apiResponse(status) {
  return { data: { status } };
}

function textValues(widget) {
  return collectByType(widget, "text").map((item) => item.text || item.value || "");
}

function mapImages(widget) {
  return collectByType(widget, "image").filter((item) => item.url?.startsWith("http://maps.apple.com/"));
}

/**
 * 断言敏感 sentinel 不会进入脚本日志、Alert 消息或 Widget 可见文案。
 *
 * 使用场景：网络和配置存储故障测试需要同时覆盖三个用户可观测输出面。入参为
 * runtime 结果和待保护字符串数组；无返回值。只检查 Alert 的标题与消息，不检查
 * 配置表单文本框，因为表单在用户主动管理配置时必须回显已保存值；任一输出包含
 * 完整 sentinel 时由 node:assert 立即报告泄漏来源。
 */
function assertSensitiveValuesAbsent(result, sensitiveValues) {
  const logOutput = result.logs.join("\n");
  const alertOutput = result.alerts
    .map((alert) => `${alert.title}\n${alert.message}`)
    .join("\n");
  const widgetOutput = textValues(result.widget).join("\n");

  // 每个 sentinel 都必须独立检查，避免一个安全值掩盖另一个完整 URL 或 Key 泄漏。
  for (const sensitiveValue of sensitiveValues) {
    assert.equal(logOutput.includes(sensitiveValue), false, "日志包含敏感 sentinel");
    assert.equal(alertOutput.includes(sensitiveValue), false, "Alert 消息包含敏感 sentinel");
    assert.equal(widgetOutput.includes(sensitiveValue), false, "Widget 文案包含敏感 sentinel");
  }
}

/**
 * 执行预期失败的 Scriptable 脚本，并取得 runtime 附加的脱敏快照。
 *
 * 使用场景：生产代码必须抛出固定错误，同时测试仍需检查失败前日志、Alert 和 Widget
 * 没有回显异常中的虚构私密 URL 或 Key。入参为 `runScriptableScript` 的 options；返回
 * 被捕获的 Error。脚本意外成功时立即触发断言失败；错误没有 `runtimeResult` 时同样失败，
 * 因为这表示 runtime 无法支持安全回归测试所需的可观测性。
 */
async function captureRuntimeFailure(options) {
  try {
    await runScriptableScript(options);
  }
  catch (error) {
    assert.ok(error.runtimeResult, "失败错误必须附带 runtime 脱敏快照");
    return error;
  }
  assert.fail("预期 Scriptable 脚本抛出错误");
}

/**
 * 判断源码是否包含未通过词法声明引入的 carId 写操作。
 *
 * 使用场景：静态审计必须识别块内直接赋值、复合赋值、自增自减，以及
 * `globalThis.carId`、`globalThis["carId"]` 等全局属性写入。入参为待审计源码字符串；
 * 命中任一常见写操作返回 true，否则返回 false。方法先移除合法的 const/let/var
 * 声明标记，再检查所有剩余 carId 赋值，避免把 main 内的局部常量误判为隐式全局。
 */
function containsImplicitCarIdWrite(source) {
  const assignmentOperator = "(?:\\*\\*=|>>>=|<<=|>>=|&&=|\\|\\|=|\\?\\?=|\\+=|-=|\\*=|/=|%=|&=|\\|=|\\^=|=(?!=)|\\+\\+|--)";
  const sourceWithoutDeclarations = source.replace(
    /\b(?:const|let|var)\s+carId\s*(?==)/g,
    ""
  );
  const directWrite = new RegExp(`\\bcarId\\s*${assignmentOperator}`);
  const computedGlobalWrite = new RegExp(
    `\\b(?:globalThis|this|window)\\s*\\[\\s*["']carId["']\\s*\\]\\s*${assignmentOperator}`
  );

  return directWrite.test(sourceWithoutDeclarations) ||
    computedGlobalWrite.test(sourceWithoutDeclarations);
}

/**
 * 为 runtime 能力测试创建临时 Scriptable 脚本。
 *
 * 使用场景：测试尚未被主脚本使用的 Scriptable 全局 API，避免为了测试 stub
 * 而修改生产脚本。入参为测试上下文和完整脚本源码；无返回值。临时目录由
 * `t.after()` 在测试结束后删除，写入异常会直接使当前测试失败。
 */
function writeRuntimeTestScript(t, source) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "scriptable-runtime-script-"));
  const scriptPath = path.join(directory, "runtime-test.js");
  fs.writeFileSync(scriptPath, source, "utf8");
  t.after(() => {
    // 测试结束后删除临时脚本，避免失败路径也在系统临时目录留下测试产物。
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return scriptPath;
}

/**
 * 为可能抛错的 runtime 调用预先分配并注册清理 documents 目录。
 *
 * 使用场景：`runScriptableScript()` 抛错时不会返回结果对象，测试无法从结果中取得
 * 默认目录。入参为测试上下文；返回临时目录绝对路径。无论断言通过或异常，注册的
 * 清理回调都会删除目录，目录创建异常直接使测试失败。
 */
function createRuntimeDocumentsDirectory(t) {
  const documentsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "scriptable-runtime-documents-"));
  t.after(() => {
    // 故障注入测试也必须释放 documents 目录，防止测试运行持续累积临时文件。
    fs.rmSync(documentsDirectory, { recursive: true, force: true });
  });
  return documentsDirectory;
}

/**
 * 为 iCloud FileManager 故障测试分配并注册清理隔离 documents 目录。
 *
 * 使用场景：iCloud 操作故障会让 `runScriptableScript()` 抛错，调用方只能从异常快照读取
 * 目录，不能依赖成功结果。入参为 node:test 上下文；返回独立临时目录绝对路径，并在测试
 * 完成时递归删除。此目录只用于 runtime stub，不会接触用户真实的 iCloud documents。
 */
function createRuntimeICloudDocumentsDirectory(t) {
  const documentsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "scriptable-runtime-icloud-documents-"));
  t.after(() => {
    // 故障断言结束后释放 iCloud stub 根，避免临时文件长期积累。
    fs.rmSync(documentsDirectory, { recursive: true, force: true });
  });
  return documentsDirectory;
}

/**
 * 断言配置不可用的 Widget 在文件与网络副作用发生前安全结束。
 *
 * 使用场景：复用中号与锁屏 Widget 对正式文件缺失、未下载、内容损坏、schema 不兼容、
 * 字段非法和 iCloud 异常的共同验收规则。入参为 runtime 执行快照；无返回值。提示
 * 文案、请求数量、完成状态或缓存目录任一不符时，node:assert 会抛出断言错误。
 */
function assertUnavailableConfigWidget(result) {
  assert.ok(textValues(result.widget).some((text) =>
    text.includes("等待 iCloud 配置同步")
  ));
  assert.equal(result.requests.length, 0);
  assert.equal(result.script.completed, true);
  assert.equal(fs.existsSync(path.join(result.documentsDirectory, "tesla")), false);
}

/**
 * 覆盖所有读取失败与校验失败输入，并在两类 Widget family 上验证统一门禁。
 *
 * 使用场景：任何不可用配置都必须在创建 FileManager 缓存目录和 Request 之前结束。
 * 入参为 node:test 上下文；无返回值。每个场景按自身 iCloud 文件和故障开关运行
 * 中号及 accessoryCircular Widget，执行异常或副作用断言失败均由测试框架报告。
 */
test("iCloud 配置不可用时 Widget 显示同步提示且不产生副作用", async (t) => {
  const invalidConfigCases = [
    { name: "正式文件缺失" },
    {
      name: "正式文件未下载",
      iCloudFiles: { [ICLOUD_CONFIG_PATH]: iCloudConfigJson() }
    },
    {
      name: "正式文件 JSON 损坏",
      iCloudFiles: { [ICLOUD_CONFIG_PATH]: "{" },
      iCloudDownloadedFiles: [ICLOUD_CONFIG_PATH]
    },
    {
      name: "schema 不兼容",
      iCloudFiles: { [ICLOUD_CONFIG_PATH]: iCloudConfigJson({ schemaVersion: 2 }) },
      iCloudDownloadedFiles: [ICLOUD_CONFIG_PATH]
    },
    {
      name: "更新时间不是字符串",
      iCloudFiles: { [ICLOUD_CONFIG_PATH]: iCloudConfigJson({ updatedAt: 1 }) },
      iCloudDownloadedFiles: [ICLOUD_CONFIG_PATH]
    },
    {
      name: "更新时间不是规范 ISO",
      iCloudFiles: {
        [ICLOUD_CONFIG_PATH]: iCloudConfigJson({ updatedAt: "2026-07-18T08:00:00Z" })
      },
      iCloudDownloadedFiles: [ICLOUD_CONFIG_PATH]
    },
    {
      name: "高德 Key 为空",
      iCloudFiles: { [ICLOUD_CONFIG_PATH]: iCloudConfigJson({ amapApiKey: "   " }) },
      iCloudDownloadedFiles: [ICLOUD_CONFIG_PATH]
    },
    {
      name: "TeslaMateApi URL 非法",
      iCloudFiles: {
        [ICLOUD_CONFIG_PATH]: iCloudConfigJson({
          teslaMateApiBaseUrl: "ftp://teslamate-api.example.test"
        })
      },
      iCloudDownloadedFiles: [ICLOUD_CONFIG_PATH]
    },
    {
      name: "正式文件读取失败",
      iCloudFiles: { [ICLOUD_CONFIG_PATH]: iCloudConfigJson() },
      iCloudDownloadedFiles: [ICLOUD_CONFIG_PATH],
      iCloudFailures: { readString: true }
    },
    {
      name: "下载状态检查失败",
      iCloudFiles: { [ICLOUD_CONFIG_PATH]: iCloudConfigJson() },
      iCloudFailures: { downloadState: true }
    },
    {
      name: "正式文件存在性检查失败",
      iCloudFailures: { fileExists: true }
    },
    {
      name: "正式文件无效且备份存在",
      iCloudFiles: {
        [ICLOUD_CONFIG_PATH]: "{",
        [ICLOUD_BACKUP_PATH]: iCloudConfigJson()
      },
      iCloudDownloadedFiles: [ICLOUD_CONFIG_PATH, ICLOUD_BACKUP_PATH]
    }
  ];
  const widgetContexts = [
    { name: "中号", runsInWidget: true, widgetFamily: "medium" },
    {
      name: "锁屏圆形",
      runsInAccessoryWidget: true,
      widgetFamily: "accessoryCircular"
    }
  ];

  // 每项无效配置都必须在两个入口触发相同门禁，场景名用于定位异步子测试失败来源。
  for (const invalidConfigCase of invalidConfigCases) {
    for (const widgetContext of widgetContexts) {
      await t.test(`${invalidConfigCase.name} - ${widgetContext.name}`, async (subtest) => {
        const result = await runScriptableScript({
          iCloudFailures: invalidConfigCase.iCloudFailures,
          iCloudFiles: invalidConfigCase.iCloudFiles,
          iCloudDownloadedFiles: invalidConfigCase.iCloudDownloadedFiles,
          jsonResponse: apiResponse(carStatus("online")),
          widgetParameter: "1",
          ...widgetContext
        });
        cleanupRuntimeDirectories(subtest, result);

        assertUnavailableConfigWidget(result);
        assert.equal(result.iCloudFileObservations.downloadCalls, 0);
      });
    }
  }
});

/**
 * 验证正式配置缺失或无效时，App 可恢复完整备份，而 Widget 不触碰备份内容。
 *
 * 使用场景：保存事务被系统中断后 backup 可能成为唯一有效副本。App 允许下载、验证、
 * 安装备份并进入 ready 菜单；Widget 只能静态降级。入参为 node:test 上下文；无返回值。
 */
test("iCloud 配置读取可由 App 恢复有效备份且 Widget 只降级", async (t) => {
  const recoveryCases = [
    { name: "正式缺失", configFiles: {} },
    { name: "正式无效", configFiles: { [ICLOUD_CONFIG_PATH]: "{" } }
  ];

  for (const recoveryCase of recoveryCases) {
    await t.test(`${recoveryCase.name} - App`, async (subtest) => {
      const result = await runScriptableScript({
        alertResponses: [{ index: -1 }],
        iCloudFiles: {
          ...recoveryCase.configFiles,
          [ICLOUD_BACKUP_PATH]: iCloudConfigJson()
        },
        runsInApp: true
      });
      cleanupRuntimeDirectories(subtest, result);

      assert.equal(result.alerts[0].title, "TeslaMate Widget");
      assert.equal(fs.existsSync(path.join(result.iCloudDocumentsDirectory, ICLOUD_CONFIG_PATH)), true);
      assert.equal(fs.existsSync(path.join(result.iCloudDocumentsDirectory, ICLOUD_BACKUP_PATH)), false);
      assert.equal(result.requests.length, 0);
      assert.equal(result.iCloudFileObservations.downloadCalls,
        recoveryCase.name === "正式无效" ? 2 : 1);
    });

    await t.test(`${recoveryCase.name} - Widget`, async (subtest) => {
      const result = await runScriptableScript({
        iCloudFiles: {
          ...recoveryCase.configFiles,
          [ICLOUD_BACKUP_PATH]: iCloudConfigJson()
        },
        iCloudDownloadedFiles: [ICLOUD_CONFIG_PATH, ICLOUD_BACKUP_PATH],
        runsInWidget: true
      });
      cleanupRuntimeDirectories(subtest, result);

      assertUnavailableConfigWidget(result);
      assert.equal(result.iCloudFileObservations.downloadCalls, 0);
      assert.equal(result.iCloudFileObservations.readCalls, recoveryCase.name === "正式无效" ? 1 : 0);
    });
  }
});

/**
 * 验证 App 下载正式 iCloud 配置失败时仅提供不可用状态交互。
 *
 * 使用场景：正式文件是云端占位但系统下载暂时失败。入参为 node:test 上下文；无返回值。
 * 测试断言错误消息脱敏、零业务请求，且不会回退到 Keychain 或创建本地车辆缓存。
 */
test("App iCloud 配置读取下载失败时安全降级", async (t) => {
  const result = await runScriptableScript({
    alertResponses: [{ index: -1 }],
    iCloudFailures: { download: new Error(`download ${SENTINEL_API_BASE_URL}`) },
    iCloudFiles: { [ICLOUD_CONFIG_PATH]: iCloudConfigJson() },
    keychainFailures: { contains: new Error(`legacy ${SENTINEL_AMAP_API_KEY}`) },
    runsInApp: true
  });
  cleanupRuntimeDirectories(t, result);

  assert.deepEqual(result.alerts[0].actions, ["重试同步"]);
  assert.equal(result.requests.length, 0);
  assert.equal(fs.existsSync(path.join(result.documentsDirectory, "tesla")), false);
  assertSensitiveValuesAbsent(result, [SENTINEL_API_BASE_URL, SENTINEL_AMAP_API_KEY]);
});

/**
 * 验证 iCloud `readString()` 返回非字符串时属于存储暂不可用，而不是用户配置内容无效。
 *
 * 使用场景：Scriptable/iCloud 桥接层可能在未抛异常时返回 null 或其他非字符串值。入参为
 * node:test 上下文；无返回值。表驱动要求 App 只提供“重试同步”，不能暴露会覆盖云端
 * 文件的“修复配置”，同时保持零 Request、零车辆缓存和固定脱敏日志。
 */
test("App iCloud readString 返回 null 或非字符串时按 unavailable 降级", async (t) => {
  for (const readValueCase of [
    { name: "null", value: null },
    { name: "数字", value: 7 },
    { name: "对象", value: { unexpected: true } }
  ]) {
    await t.test(readValueCase.name, async (subtest) => {
      const result = await runScriptableScript({
        alertResponses: [{ index: -1 }],
        iCloudFiles: { [ICLOUD_CONFIG_PATH]: iCloudConfigJson() },
        iCloudReadOverrides: { [ICLOUD_CONFIG_PATH]: [readValueCase.value] },
        runsInApp: true
      });
      cleanupRuntimeDirectories(subtest, result);

      assert.deepEqual(result.alerts[0].actions, ["重试同步"]);
      assert.equal(result.alerts[0].actions.includes("修复配置"), false);
      assert.equal(result.logs.includes("运行配置读取暂时不可用"), true);
      assert.equal(result.requests.length, 0);
      assert.equal(fs.existsSync(path.join(result.documentsDirectory, "tesla")), false);
    });
  }
});

test("中号桌面 widget 可以用在线车辆数据完成渲染并写入缓存", async (t) => {
  const result = await runScriptableScript({
    ...readyICloudFixture(),
    jsonResponse: apiResponse(carStatus("online")),
    runsInWidget: true,
    widgetParameter: "1"
  });
  cleanupRuntimeDirectories(t, result);

  assert.equal(result.script.completed, true);
  assert.equal(result.widget.presented, "medium");
  assert.ok(textValues(result.widget).some((text) => text.includes("Model Y")));
  assert.ok(textValues(result.widget).some((text) => text.includes("331")));
  assert.ok(result.requests.some((request) =>
    request.url === "https://api.example.test/api/v1/cars/1/status"
  ));
  assert.ok(fs.existsSync(path.join(result.documentsDirectory, "tesla", "car_data_1.json")));
});

/**
 * 验证第二辆车完整沿用显式配置链，并把所有车辆相关缓存隔离到 ID 2。
 *
 * 使用场景：同一 Scriptable 脚本通过 Widget 参数服务多辆车。入参为 node:test
 * 上下文；无返回值。测试使用全新 documents 目录，精确断言 TeslaMateApi 请求、
 * 高德 Key、车辆链接和三类缓存文件，且不得创建任何 ID 1 缓存。
 */
test("车 ID 2 使用配置请求、车辆链接和独立缓存", async (t) => {
  const result = await runScriptableScript({
    ...readyICloudFixture(),
    jsonResponse: apiResponse(carStatus("online", { display_name: "Sentinel Car 2" })),
    runsInWidget: true,
    widgetParameter: "dark,2"
  });
  cleanupRuntimeDirectories(t, result);

  const cacheRoot = path.join(result.documentsDirectory, "tesla");
  const vehicleName = collectByType(result.widget, "text")
    .find((item) => item.text?.includes("Sentinel Car 2"));
  const amapRequest = result.requests.find((request) =>
    request.url.startsWith("https://restapi.amap.com/v3/staticmap?")
  );

  assert.ok(result.requests.some((request) =>
    request.url === "https://api.example.test/api/v1/cars/2/status"
  ));
  assert.ok(amapRequest);
  assert.ok(amapRequest.url.includes(`key=${SENTINEL_AMAP_API_KEY}`));
  assert.equal(vehicleName?.url, SENTINEL_WEB_URL);

  // 车辆数据、地理文字和地图图片必须共享同一个显式 ID，不能回落到默认车辆 1。
  for (const filename of ["car_data_2.json", "car_map_2.json", "car_map_2.png"]) {
    assert.equal(fs.existsSync(path.join(cacheRoot, filename)), true);
  }
  for (const filename of ["car_data_1.json", "car_map_1.json", "car_map_1.png"]) {
    assert.equal(fs.existsSync(path.join(cacheRoot, filename)), false);
  }
});

/**
 * 静态审计生产脚本不再声明旧配置全局或隐式全局车辆 ID。
 *
 * 使用场景：运行测试只能覆盖已执行分支，源码断言用于阻止旧变量名或调用签名回归。
 * 无业务入参；测试直接读取固定入口文件。读取失败、旧标识出现或关键函数丢失显式
 * 参数时均由 node:assert 报错。
 */
test("源码只使用显式 runtime 配置与车辆 ID 参数链", () => {
  const source = fs.readFileSync(SCRIPT_PATH, "utf8");
  const legacyGlobals = [
    "AMAP_API_KEY",
    "TESLA_MATE_API_URL",
    "TESLA_MATE_URL",
    "TESLA_MATE_CAR_ID"
  ];

  // 每个历史标识都必须从生产源码完全消失，注释或兼容别名同样会形成回归入口。
  for (const legacyGlobal of legacyGlobals) {
    assert.equal(source.includes(legacyGlobal), false, `仍存在遗留全局 ${legacyGlobal}`);
  }

  assert.match(source, /async function getCarData\(runtimeConfig, carId\)/);
  assert.match(source, /async function getCarGeo\(runtimeContext, runtimeConfig, carId,/);
  assert.match(source, /async function loadCarContext\(runtimeContext, runtimeConfig, carId\)/);
  assert.match(source, /async function renderMediumWidget\(runtimeContext, runtimeConfig, carId\)/);
  assert.match(source, /function renderCarInfo\(left, car, runtimeConfig\)/);
  assert.equal(containsImplicitCarIdWrite(source), false);
  assert.doesNotMatch(
    source,
    /console\.log\s*\([^)]*\b(?:error|err|exception|e)\b[^)]*\)/
  );
  assert.doesNotMatch(source, /new Request\(url\);\s*try\s*\{/);
  assert.doesNotMatch(
    source,
    /if \(image == null \|\| hasCarMoved\(car\)\) \{\s*let url =/
  );
});

/**
 * 验证 carId 静态门禁能区分合法词法声明和常见隐式全局写入。
 *
 * 使用场景：防止后续格式调整把赋值移入代码块后绕过行首正则。无业务入参；测试以
 * 最小源码片段覆盖直接赋值、复合赋值、自增自减、点属性和计算属性写入，并保留
 * `const/let/var carId` 与函数参数的合法样例。任一分类错误均由 node:assert 报告。
 */
test("隐式 carId 门禁覆盖块内、复合赋值和全局属性写入", () => {
  const implicitWriteCases = [
    "if (enabled) { carId = 2; }",
    "function update() { carId += 1; }",
    "while (ready) { carId++; }",
    "globalThis.carId = 2;",
    "globalThis['carId'] ||= 2;",
    "this[\"carId\"] = 2;",
    "window.carId--"
  ];
  const lexicalCases = [
    "const carId = 2;",
    "let carId = 2;",
    "var carId = 2;",
    "function render(carId) { return carId; }"
  ];

  // 每个危险片段必须独立命中，避免某一种赋值语法覆盖不足却被其他样例掩盖。
  for (const source of implicitWriteCases) {
    assert.equal(containsImplicitCarIdWrite(source), true, `未识别隐式写入：${source}`);
  }
  // 合法局部声明与参数读取不得误报，否则生产源码中的显式参数链无法通过审计。
  for (const source of lexicalCases) {
    assert.equal(containsImplicitCarIdWrite(source), false, `误报合法 carId：${source}`);
  }
});

test("中号桌面 widget 地图图片填满右侧容器", async (t) => {
  const result = await runScriptableScript({
    ...readyICloudFixture(),
    jsonResponse: apiResponse(carStatus("online")),
    runsInWidget: true,
    widgetParameter: "1"
  });
  cleanupRuntimeDirectories(t, result);

  const maps = mapImages(result.widget);
  assert.equal(maps.length, 1);
  assert.deepEqual(maps[0].imageSize, { width: 176, height: 176 });
  assert.equal(maps[0].contentMode, "fill");
  assert.equal(maps[0].cornerRadius, 0);
});

test("充电状态显示充电功率、目标电量，并使用 30 秒刷新窗口", async (t) => {
  const startedAt = Date.now();
  const result = await runScriptableScript({
    ...readyICloudFixture(),
    jsonResponse: apiResponse(carStatus("charging", {
      battery_details: { battery_level: 42, rated_battery_range: 208.5 },
      charging_details: {
        charge_limit_soc: 90,
        charger_power: 11,
        time_to_full_charge: 1.5
      }
    })),
    runsInWidget: true,
    widgetParameter: "1"
  });
  cleanupRuntimeDirectories(t, result);

  const refreshAt = new Date(result.widget.refreshAfterDate).getTime();
  assert.ok(refreshAt - startedAt >= 29_000);
  assert.ok(refreshAt - startedAt <= 31_500);
  assert.ok(textValues(result.widget).some((text) => text.includes("11kW")));
  assert.ok(textValues(result.widget).some((text) => text.includes("90%")));
});

test("行驶状态使用 10 秒刷新窗口并显示速度", async (t) => {
  const startedAt = Date.now();
  const result = await runScriptableScript({
    ...readyICloudFixture(),
    jsonResponse: apiResponse(carStatus("driving", {
      driving_details: {
        heading: 180,
        speed: 72
      }
    })),
    runsInWidget: true,
    widgetParameter: "1"
  });
  cleanupRuntimeDirectories(t, result);

  const refreshAt = new Date(result.widget.refreshAfterDate).getTime();
  assert.ok(refreshAt - startedAt >= 9_000);
  assert.ok(refreshAt - startedAt <= 11_500);
  assert.ok(textValues(result.widget).some((text) => text === "72"));
});

test("锁屏 accessory widget 可以完成圆形电量图渲染", async (t) => {
  const result = await runScriptableScript({
    ...readyICloudFixture(),
    jsonResponse: apiResponse(carStatus("asleep", {
      battery_details: {
        battery_level: 88,
        rated_battery_range: 420.1
      }
    })),
    runsInAccessoryWidget: true,
    widgetFamily: "accessoryCircular",
    widgetParameter: "1"
  });
  cleanupRuntimeDirectories(t, result);

  assert.equal(result.script.completed, true);
  assert.equal(result.widget.presented, "small");
  assert.equal(collectByType(result.widget, "image").length, 1);
});

/**
 * 验证已配置 App 菜单的打开动作使用标准化配置进入指定车辆 WebView。
 *
 * 使用场景：用户在 Scriptable 内运行脚本并从操作菜单选择打开 TeslaMate。入参为
 * node:test 上下文；无返回值。测试断言菜单展示样式、固定动作顺序以及 WebView
 * 车辆筛选结果，任一交互或页面行为不符时由 node:assert 抛出。
 */
test("App 操作菜单选择打开 TeslaMate 时展示当前车辆 WebView", async (t) => {
  const result = await runScriptableScript({
    ...readyICloudFixture(),
    alertResponses: [{ index: 0 }],
    jsonResponse: apiResponse(carStatus("online")),
    runsInApp: true,
    widgetParameter: "1"
  });
  cleanupRuntimeDirectories(t, result);

  assert.deepEqual(result.alerts[0], {
    actions: ["打开 TeslaMate", "管理配置"],
    cancelAction: "取消",
    message: "请选择要执行的操作",
    presentation: "sheet",
    textFields: [],
    title: "TeslaMate Widget"
  });
  assert.equal(result.webViews.length, 1);
  assert.equal(result.webViews[0].loadedURL, SENTINEL_WEB_URL);
  assert.equal(result.webViews[0].presented, true);
  assert.equal(result.webViews[0].evaluatedJavaScript.length, 3);
  assert.ok(result.webViews[0].evaluatedJavaScript[0].includes("#car_2"));
});

/**
 * 验证 WebView 关闭前不会结束 Scriptable 生命周期。
 *
 * 使用场景：Scriptable 的 `WebView.present()` 是异步操作；如果生产代码漏写 await，
 * runtime 的微任务会让 `script.complete` 出现在展示完成前。入参为 node:test 上下文；
 * 无返回值。测试通过严格生命周期顺序验证页面展示完成后才完成脚本。
 */
test("App 打开 TeslaMate 时等待 WebView 展示完成再结束脚本", async (t) => {
  const result = await runScriptableScript({
    ...readyICloudFixture(),
    alertResponses: [{ index: 0 }],
    runsInApp: true,
    widgetParameter: "1"
  });
  cleanupRuntimeDirectories(t, result);

  assert.deepEqual(result.lifecycle, [
    "webview.present:start",
    "webview.present:complete",
    "script.complete"
  ]);
  assert.equal(result.script.completed, true);
});

/**
 * 验证 runtime 会把遗漏 await 的 WebView 展示稳定暴露为错误生命周期顺序。
 *
 * 使用场景：上一项生产路径测试依赖此行为来阻止 `await wv.present()` 被误删。入参为
 * node:test 上下文；无返回值。临时脚本故意不等待 `present()` 并立即完成；由于 runtime
 * 使用下一事件循环而非微任务延迟，快照必须先记录 `script.complete`。测试末尾主动等待
 * 一轮事件循环，让故意遗留的展示 Promise 完成，避免影响后续 runtime 的静态状态。
 */
test("runtime 可稳定识别未等待的 WebView 展示", async (t) => {
  const result = await runScriptableScript({
    scriptPath: writeRuntimeTestScript(t, `
      const webView = new WebView();
      webView.present();
      Script.complete();
    `)
  });
  cleanupRuntimeDirectories(t, result);

  assert.deepEqual(result.lifecycle, ["webview.present:start", "script.complete"]);
  await new Promise((resolve) => setImmediate(resolve));
});

/**
 * 验证 WebView 各阶段失败都会转换为固定脱敏错误。
 *
 * 使用场景：页面加载、样式注入和展示关闭都可能抛出带私有 Web 地址或 API Key 的系统
 * Error。入参为 node:test 上下文；无返回值。每个阶段注入独立 sentinel，断言调用方
 * 只收到固定错误，日志、Alert 和 Widget 可见输出也不包含 sentinel。
 */
test("WebView 失败不会泄露完整 URL 或 Key", async (t) => {
  const failureStages = ["load", "evaluate", "present"];

  for (const stage of failureStages) {
    await t.test(stage, async (subtest) => {
      const sentinelWebUrl = `https://private-${stage}.example.test/hidden-path`;
      const sentinelKey = `sentinel-webview-${stage}-key`;
      const error = await captureRuntimeFailure({
        ...readyICloudFixture(),
        alertResponses: [{ index: 0 }],
        runsInApp: true,
        webViewFailures: {
          [stage]: new Error(`WebView ${stage} failed: ${sentinelWebUrl}?key=${sentinelKey}`)
        },
        widgetParameter: "1"
      });
      const result = error.runtimeResult;
      cleanupRuntimeDirectories(subtest, result);

      assert.equal(error.message, "TeslaMate 页面打开失败");
      assert.ok(result.logs.includes("TeslaMate 页面打开失败"));
      assert.equal(result.script.completed, false);
      assert.equal(result.widget, null);
      assertSensitiveValuesAbsent(result, [sentinelWebUrl, sentinelKey]);
      assert.equal(error.message.includes(sentinelWebUrl), false);
      assert.equal(error.message.includes(sentinelKey), false);
    });
  }
});

/**
 * 验证已配置 App 菜单可以进入预填表单，并允许用户取消而不改动 iCloud 正式文件。
 *
 * 使用场景：用户只想查看现有配置但不保存。入参为 node:test 上下文；无返回值。
 * 测试精确断言字段顺序、Key 安全输入属性、已标准化初始值和旧 JSON 不变。
 */
test("App 操作菜单选择管理配置时预填安全表单且取消不保存", async (t) => {
  const existingJson = iCloudConfigJson();
  const result = await runScriptableScript({
    alertResponses: [{ index: 1 }, { index: -1 }],
    iCloudFiles: { [ICLOUD_CONFIG_PATH]: existingJson },
    iCloudDownloadedFiles: [ICLOUD_CONFIG_PATH],
    runsInApp: true
  });
  cleanupRuntimeDirectories(t, result);

  assert.equal(result.alerts[0].presentation, "sheet");
  assert.deepEqual(result.alerts[1], {
    actions: ["保存"],
    cancelAction: "取消",
    message: "配置将保存在 iCloud Drive 中",
    presentation: "alert",
    textFields: [
      { placeholder: "高德 API Key", secure: true, value: SENTINEL_AMAP_API_KEY },
      {
        placeholder: "TeslaMateApi 基础 URL",
        value: SENTINEL_API_BASE_URL
      },
      { placeholder: "TeslaMate Web URL", value: SENTINEL_WEB_URL }
    ],
    title: "管理配置"
  });
  assert.equal(
    fs.readFileSync(path.join(result.iCloudDocumentsDirectory, ICLOUD_CONFIG_PATH), "utf8"),
    existingJson
  );
  assert.deepEqual(result.keychain, {});
  assert.equal(result.webViews.length, 0);
});

/**
 * 验证已配置 App 菜单取消后直接结束，不打开页面也不进入配置表单。
 *
 * 使用场景：用户误触运行脚本后关闭操作菜单。入参为 node:test 上下文；无返回值。
 * 测试断言只展示一个 sheet、保留原始 iCloud 正式文件，并完成 Script 生命周期。
 */
test("App 操作菜单取消时不执行任何动作", async (t) => {
  const existingJson = iCloudConfigJson();
  const result = await runScriptableScript({
    alertResponses: [{ index: -1 }],
    iCloudFiles: { [ICLOUD_CONFIG_PATH]: existingJson },
    iCloudDownloadedFiles: [ICLOUD_CONFIG_PATH],
    runsInApp: true
  });
  cleanupRuntimeDirectories(t, result);

  assert.equal(result.alerts.length, 1);
  assert.equal(result.alerts[0].presentation, "sheet");
  assert.equal(
    fs.readFileSync(path.join(result.iCloudDocumentsDirectory, ICLOUD_CONFIG_PATH), "utf8"),
    existingJson
  );
  assert.equal(result.webViews.length, 0);
  assert.equal(result.script.completed, true);
});

/**
 * 验证 App 缺少正式与备份配置时先展示明确的 missing 状态菜单。
 *
 * 使用场景：首次安装或 iCloud 尚未同步。入参为 node:test 上下文；无返回值。测试以
 * 取消响应结束，精确断言首屏不自动进入空表单，也没有创建配置目录或本地车辆缓存。
 */
test("App iCloud 配置 missing 首屏只提供重试、创建和取消", async (t) => {
  const result = await runScriptableScript({
    alertResponses: [{ index: -1 }],
    runsInApp: true
  });
  cleanupRuntimeDirectories(t, result);

  assert.deepEqual(result.alerts[0].actions, ["重试同步", "创建新配置"]);
  assert.equal(result.alerts[0].cancelAction, "取消");
  assert.equal(result.alerts[0].presentation, "sheet");
  assert.deepEqual(result.alerts[0].textFields, []);
  assert.deepEqual(result.keychain, {});
  assert.equal(fs.existsSync(path.join(result.iCloudDocumentsDirectory, "teslamate")), false);
  assert.equal(fs.existsSync(path.join(result.documentsDirectory, "tesla")), false);
});

/**
 * 验证 missing 的重试仍缺失时用循环重新展示同一菜单。
 *
 * 使用场景：用户希望等待 iCloud 同步但正式与备份仍未出现。入参为 node:test 上下文；
 * 无返回值。两次菜单必须动作完全一致，且重试不能递归进入表单或创建配置目录。
 */
test("App iCloud 配置 missing 重试后仍缺失会重新展示菜单", async (t) => {
  const result = await runScriptableScript({
    alertResponses: [{ index: 0 }, { index: -1 }],
    runsInApp: true
  });
  cleanupRuntimeDirectories(t, result);

  assert.equal(result.alerts.length, 2);
  assert.deepEqual(result.alerts[0].actions, ["重试同步", "创建新配置"]);
  assert.deepEqual(result.alerts[1].actions, result.alerts[0].actions);
  assert.equal(fs.existsSync(path.join(result.iCloudDocumentsDirectory, "teslamate")), false);
});

/**
 * 验证 invalid 状态只有用户明确选择修复才进入空白表单。
 *
 * 使用场景：正式 iCloud 文件已下载但 envelope 内容非法且没有可恢复备份。入参为
 * node:test 上下文；无返回值。取消分支只显示菜单；修复分支的第二个 Alert 才有三个空字段。
 */
test("App iCloud 配置 invalid 只允许重试读取、修复或取消", async (t) => {
  for (const actionCase of [
    { name: "取消", responses: [{ index: -1 }], expectedAlerts: 1 },
    { name: "修复", responses: [{ index: 1 }, { index: -1 }], expectedAlerts: 2 }
  ]) {
    await t.test(actionCase.name, async (subtest) => {
      const result = await runScriptableScript({
        alertResponses: actionCase.responses,
        iCloudFiles: { [ICLOUD_CONFIG_PATH]: iCloudConfigJson({ schemaVersion: 2 }) },
        iCloudDownloadedFiles: [ICLOUD_CONFIG_PATH],
        runsInApp: true
      });
      cleanupRuntimeDirectories(subtest, result);

      assert.deepEqual(result.alerts[0].actions, ["重试读取", "修复配置"]);
      assert.equal(result.alerts[0].cancelAction, "取消");
      assert.equal(result.alerts.length, actionCase.expectedAlerts);
      if (actionCase.name === "修复") {
        assert.deepEqual(result.alerts[1].textFields, [
          { placeholder: "高德 API Key", secure: true, value: "" },
          { placeholder: "TeslaMateApi 基础 URL", value: "" },
          { placeholder: "TeslaMate Web URL", value: "" }
        ]);
      }
      assert.equal(result.requests.length, 0);
      assert.equal(fs.existsSync(path.join(result.documentsDirectory, "tesla")), false);
    });
  }
});

/**
 * 验证用户明确选择修复后，可以用已完整校验的 pending 替换无效正式或无效备份。
 *
 * 使用场景：上次事务遗留的 backup 自身损坏时，普通恢复不能接管，但用户仍必须能通过
 * “修复配置”解除死锁。入参为 node:test 上下文；无返回值。表驱动覆盖正式缺失和正式
 * 无效两种初态，成功后只留下规范五字段正式文件，且本次运行不使用候选发起业务请求。
 */
test("App 显式修复可替换无效正式文件和无效备份", async (t) => {
  const invalidFormal = "{invalid-formal";
  const invalidBackup = "{invalid-backup";
  const repairCases = [
    {
      name: "正式缺失且备份无效",
      files: { [ICLOUD_BACKUP_PATH]: invalidBackup }
    },
    {
      name: "正式与备份都无效",
      files: {
        [ICLOUD_CONFIG_PATH]: invalidFormal,
        [ICLOUD_BACKUP_PATH]: invalidBackup
      }
    }
  ];

  for (const repairCase of repairCases) {
    await t.test(repairCase.name, async (subtest) => {
      const result = await runScriptableScript({
        alertResponses: [
          { index: 1 },
          {
            index: 0,
            textFields: [
              " repaired-amap-key ",
              "https://repaired-api.example.test///",
              "https://repaired-web.example.test///"
            ]
          },
          { index: 0 }
        ],
        iCloudFiles: repairCase.files,
        runsInApp: true
      });
      cleanupRuntimeDirectories(subtest, result);

      const savedConfig = readICloudConfig(result);
      assert.deepEqual(Object.keys(savedConfig).sort(), [
        "amapApiKey",
        "schemaVersion",
        "teslaMateApiBaseUrl",
        "teslaMateWebUrl",
        "updatedAt"
      ]);
      assert.equal(savedConfig.amapApiKey, "repaired-amap-key");
      assert.equal(savedConfig.teslaMateApiBaseUrl, "https://repaired-api.example.test");
      assert.equal(savedConfig.teslaMateWebUrl, "https://repaired-web.example.test");
      assert.equal(new Date(savedConfig.updatedAt).toISOString(), savedConfig.updatedAt);
      assert.equal(fs.existsSync(path.join(result.iCloudDocumentsDirectory, ICLOUD_PENDING_PATH)), false);
      assert.equal(fs.existsSync(path.join(result.iCloudDocumentsDirectory, ICLOUD_BACKUP_PATH)), false);
      assert.equal(result.alerts.at(-1).title, "保存成功");
      assert.equal(result.requests.length, 0);
      assert.equal(fs.existsSync(path.join(result.documentsDirectory, "tesla")), false);
    });
  }
});

/**
 * 验证显式修复只有在 pending 完整校验后才允许删除无效旧工件。
 *
 * 使用场景：修复候选写入后可能因损坏或同步窗口无法通过复读。入参为 node:test 上下文；
 * 无返回值。两种无效初态都必须逐字保留原工件、清理 pending，并以固定失败提示结束；
 * 候选和无效备份均不得进入业务链或初始化本地车辆缓存。
 */
test("App 显式修复的 pending 校验失败时保留无效旧工件", async (t) => {
  const invalidFormal = "{invalid-formal-preserved";
  const invalidBackup = "{invalid-backup-preserved";
  const repairCases = [
    {
      name: "正式缺失且备份无效",
      files: { [ICLOUD_BACKUP_PATH]: invalidBackup }
    },
    {
      name: "正式与备份都无效",
      files: {
        [ICLOUD_CONFIG_PATH]: invalidFormal,
        [ICLOUD_BACKUP_PATH]: invalidBackup
      }
    }
  ];

  for (const repairCase of repairCases) {
    await t.test(repairCase.name, async (subtest) => {
      const result = await runScriptableScript({
        alertResponses: [
          { index: 1 },
          {
            index: 0,
            textFields: [
              "failed-repair-key",
              "https://failed-repair-api.example.test",
              "https://failed-repair-web.example.test"
            ]
          },
          { index: 0 }
        ],
        iCloudFiles: repairCase.files,
        iCloudReadOverrides: { [ICLOUD_PENDING_PATH]: ["{"] },
        runsInApp: true
      });
      cleanupRuntimeDirectories(subtest, result);

      const formalPath = path.join(result.iCloudDocumentsDirectory, ICLOUD_CONFIG_PATH);
      const backupPath = path.join(result.iCloudDocumentsDirectory, ICLOUD_BACKUP_PATH);
      assert.equal(result.alerts.at(-1).title, "保存失败");
      assert.equal(fs.existsSync(formalPath), Boolean(repairCase.files[ICLOUD_CONFIG_PATH]));
      if (repairCase.files[ICLOUD_CONFIG_PATH]) {
        assert.equal(fs.readFileSync(formalPath, "utf8"), invalidFormal);
      }
      assert.equal(fs.readFileSync(backupPath, "utf8"), invalidBackup);
      assert.equal(fs.existsSync(path.join(result.iCloudDocumentsDirectory, ICLOUD_PENDING_PATH)), false);
      assert.equal(result.requests.length, 0);
      assert.equal(fs.existsSync(path.join(result.documentsDirectory, "tesla")), false);
      assertSensitiveValuesAbsent(result, [
        "failed-repair-key",
        "https://failed-repair-api.example.test",
        "https://failed-repair-web.example.test"
      ]);
    });
  }
});

/**
 * 验证显式修复在清理无效工件后安装候选失败时，不会回退使用无效 backup。
 *
 * 使用场景：pending 已完整校验且旧工件已确认无效，但最终移动仍可能失败。入参为
 * node:test 上下文；无返回值。失败后正式、backup、pending 都不得成为本次业务配置，
 * 脚本只显示固定失败提示并保持零 Request、零车辆缓存。
 */
test("App 显式修复安装候选失败时不恢复无效备份", async (t) => {
  const result = await runScriptableScript({
    alertResponses: [
      { index: 1 },
      {
        index: 0,
        textFields: [
          "move-failed-repair-key",
          "https://move-failed-api.example.test",
          "https://move-failed-web.example.test"
        ]
      },
      { index: 0 }
    ],
    iCloudFailures: { moveAtCall: 1 },
    iCloudFiles: {
      [ICLOUD_CONFIG_PATH]: "{invalid-formal-before-move",
      [ICLOUD_BACKUP_PATH]: "{invalid-backup-before-move"
    },
    runsInApp: true
  });
  cleanupRuntimeDirectories(t, result);

  assert.equal(result.alerts.at(-1).title, "保存失败");
  assert.equal(fs.existsSync(path.join(result.iCloudDocumentsDirectory, ICLOUD_CONFIG_PATH)), false);
  assert.equal(fs.existsSync(path.join(result.iCloudDocumentsDirectory, ICLOUD_BACKUP_PATH)), false);
  assert.equal(fs.existsSync(path.join(result.iCloudDocumentsDirectory, ICLOUD_PENDING_PATH)), false);
  assert.equal(result.requests.length, 0);
  assert.equal(fs.existsSync(path.join(result.documentsDirectory, "tesla")), false);
  assertSensitiveValuesAbsent(result, [
    "move-failed-repair-key",
    "https://move-failed-api.example.test",
    "https://move-failed-web.example.test"
  ]);
});

/**
 * 验证旧 Keychain 内容无效时使用可辨识的 legacy 修复来源，并能创建新的 iCloud 正式配置。
 *
 * 使用场景：正式与 backup 均缺失，但旧键可能是 schema 不兼容、业务字段无效或 JSON 损坏。
 * 入参为 node:test 上下文；无返回值。三种来源都必须进入 invalid 菜单；用户明确修复后先
 * 完整验证 pending、重新确认 iCloud 工件仍缺失、安装并重读正式文件，最后才删除旧键。
 */
test("App 可显式修复 schema 字段或 JSON 无效的旧 Keychain", async (t) => {
  const legacyInvalidCases = [
    { name: "schema 无效", value: runtimeConfigJson({ schemaVersion: 2 }) },
    { name: "业务字段无效", value: runtimeConfigJson({ amapApiKey: "   " }) },
    { name: "JSON 无效", value: "{" }
  ];

  for (const legacyInvalidCase of legacyInvalidCases) {
    await t.test(legacyInvalidCase.name, async (subtest) => {
      const result = await runScriptableScript({
        alertResponses: [
          { index: 1 },
          {
            index: 0,
            textFields: [
              " repaired-legacy-key ",
              "https://repaired-legacy-api.example.test///",
              "https://repaired-legacy-web.example.test///"
            ]
          },
          { index: 0 }
        ],
        keychainValues: { [RUNTIME_CONFIG_KEY]: legacyInvalidCase.value },
        runsInApp: true
      });
      cleanupRuntimeDirectories(subtest, result);

      assert.deepEqual(result.alerts[0].actions, ["重试读取", "修复配置"]);
      assert.equal(result.alerts.at(-1).title, "保存成功");
      const savedConfig = readICloudConfig(result);
      assert.equal(savedConfig.amapApiKey, "repaired-legacy-key");
      assert.equal(savedConfig.teslaMateApiBaseUrl, "https://repaired-legacy-api.example.test");
      assert.equal(savedConfig.teslaMateWebUrl, "https://repaired-legacy-web.example.test");
      assert.equal(Object.hasOwn(result.keychain, RUNTIME_CONFIG_KEY), false);
      assert.equal(result.iCloudFileObservations.downloadCalls, 1);
      assert.equal(fs.existsSync(path.join(result.iCloudDocumentsDirectory, ICLOUD_BACKUP_PATH)), false);
      assert.equal(fs.existsSync(path.join(result.iCloudDocumentsDirectory, ICLOUD_PENDING_PATH)), false);
      assert.equal(result.requests.length, 0);
      assert.equal(fs.existsSync(path.join(result.documentsDirectory, "tesla")), false);
    });
  }
});

/**
 * 验证 legacy invalid 修复安装候选失败时保留旧键，且候选不进入业务链。
 *
 * 使用场景：pending 已校验且 iCloud 正式/backup 仍缺失，但 pending 移动为正式文件失败。
 * 入参为 node:test 上下文；无返回值。测试要求确实尝试一次安装，随后清理 pending、保留
 * 旧无效 Keychain，并以固定失败提示安全结束。
 */
test("App 修复旧 Keychain 时安装候选失败会保留旧键", async (t) => {
  const invalidLegacyJson = runtimeConfigJson({ schemaVersion: 2 });
  const result = await runScriptableScript({
    alertResponses: [
      { index: 1 },
      {
        index: 0,
        textFields: [
          "legacy-install-failure-key",
          "https://legacy-install-failure-api.example.test",
          "https://legacy-install-failure-web.example.test"
        ]
      },
      { index: 0 }
    ],
    iCloudFailures: { moveAtCall: 1 },
    keychainValues: { [RUNTIME_CONFIG_KEY]: invalidLegacyJson },
    runsInApp: true
  });
  cleanupRuntimeDirectories(t, result);

  assert.equal(result.alerts.at(-1).title, "保存失败");
  assert.equal(result.iCloudFileObservations.moveCalls, 1);
  assert.equal(result.keychain[RUNTIME_CONFIG_KEY], invalidLegacyJson);
  assert.equal(fs.existsSync(path.join(result.iCloudDocumentsDirectory, ICLOUD_CONFIG_PATH)), false);
  assert.equal(fs.existsSync(path.join(result.iCloudDocumentsDirectory, ICLOUD_PENDING_PATH)), false);
  assert.equal(result.requests.length, 0);
  assert.equal(fs.existsSync(path.join(result.documentsDirectory, "tesla")), false);
});

/**
 * 验证 legacy invalid 修复在正式文件复读成功后才删除旧键，删除失败不回滚有效 iCloud。
 *
 * 使用场景：Keychain.remove 可能暂时失败。入参为 node:test 上下文；无返回值。第一次运行
 * 必须保留已验证正式文件和旧键并显示固定修复失败；第二次运行注入 contains 故障，仍只靠
 * 正式 iCloud 进入 ready，证明旧键已经不可达且不会再次阻断运行。
 */
test("App 修复旧 Keychain 后删除旧键失败会保留有效 iCloud", async (t) => {
  const invalidLegacyJson = "{invalid-legacy-json";
  const firstResult = await runScriptableScript({
    alertResponses: [
      { index: 1 },
      {
        index: 0,
        textFields: [
          "legacy-remove-failure-key",
          "https://legacy-remove-failure-api.example.test",
          "https://legacy-remove-failure-web.example.test"
        ]
      },
      { index: 0 }
    ],
    keychainFailures: { remove: true },
    keychainValues: { [RUNTIME_CONFIG_KEY]: invalidLegacyJson },
    runsInApp: true
  });
  cleanupRuntimeDirectories(t, firstResult);

  const installedConfig = fs.readFileSync(
    path.join(firstResult.iCloudDocumentsDirectory, ICLOUD_CONFIG_PATH),
    "utf8"
  );
  assert.equal(firstResult.alerts.at(-1).title, "修复失败");
  assert.equal(firstResult.keychain[RUNTIME_CONFIG_KEY], invalidLegacyJson);
  assert.equal(firstResult.iCloudFileObservations.downloadCalls, 1);
  assert.equal(firstResult.requests.length, 0);
  assert.equal(fs.existsSync(path.join(firstResult.documentsDirectory, "tesla")), false);

  const secondResult = await runScriptableScript({
    alertResponses: [{ index: -1 }],
    iCloudFiles: { [ICLOUD_CONFIG_PATH]: installedConfig },
    iCloudDownloadedFiles: [ICLOUD_CONFIG_PATH],
    keychainFailures: { contains: new Error("unreachable-invalid-legacy-sentinel") },
    keychainValues: { [RUNTIME_CONFIG_KEY]: invalidLegacyJson },
    runsInApp: true
  });
  cleanupRuntimeDirectories(t, secondResult);

  assert.equal(secondResult.alerts[0].title, "TeslaMate Widget");
  assert.equal(secondResult.logs.some((line) =>
    line.includes("unreachable-invalid-legacy-sentinel")), false);
});

/**
 * 验证明确创建的新配置通过 iCloud 事务保存为五字段 envelope。
 *
 * 使用场景：全新安装用户从 missing 菜单选择创建，并提交带空白或尾斜杠的业务值。
 * 入参为 node:test 上下文；无返回值。测试读取隔离 iCloud 正式文件，精确断言字段白名单、
 * 标准化值与规范时间，并确认成功后不遗留 pending/backup、也不宣称同步已经完成。
 */
test("iCloud 保存事务成功写入规范五字段 envelope 并清理工件", async (t) => {
  const result = await runScriptableScript({
    alertResponses: [
      { index: 1 },
      {
        index: 0,
        textFields: [
          "  saved-amap-key  ",
          "https://api.saved.example.test:8080///",
          "http://web.saved.example.test///"
        ]
      },
      { index: 0 }
    ],
    runsInApp: true
  });
  cleanupRuntimeDirectories(t, result);

  const savedConfig = readICloudConfig(result);
  assert.deepEqual(Object.keys(savedConfig).sort(), [
    "amapApiKey",
    "schemaVersion",
    "teslaMateApiBaseUrl",
    "teslaMateWebUrl",
    "updatedAt"
  ]);
  assert.deepEqual({
    schemaVersion: savedConfig.schemaVersion,
    amapApiKey: savedConfig.amapApiKey,
    teslaMateApiBaseUrl: savedConfig.teslaMateApiBaseUrl,
    teslaMateWebUrl: savedConfig.teslaMateWebUrl
  }, {
    schemaVersion: 1,
    amapApiKey: "saved-amap-key",
    teslaMateApiBaseUrl: "https://api.saved.example.test:8080",
    teslaMateWebUrl: "http://web.saved.example.test"
  });
  assert.equal(new Date(savedConfig.updatedAt).toISOString(), savedConfig.updatedAt);
  assert.equal(fs.existsSync(path.join(result.iCloudDocumentsDirectory, ICLOUD_PENDING_PATH)), false);
  assert.equal(fs.existsSync(path.join(result.iCloudDocumentsDirectory, ICLOUD_BACKUP_PATH)), false);
  assert.deepEqual(result.alerts[2], {
    actions: ["确定"],
    cancelAction: null,
    message: "已保存到 iCloud Drive，将由系统同步到其他设备",
    presentation: "alert",
    textFields: [],
    title: "保存成功"
  });
  assert.equal(result.alerts[2].message.includes("同步完成"), false);
  assert.equal(result.keychainSetCalls.length, 0);
});

/**
 * 验证保存事务每个阶段失败都使用双标志精确恢复旧正式文件。
 *
 * 使用场景：pending 写入/校验、正式备份、候选安装、最终复读或恢复移动可能独立失败。
 * 入参为 node:test 上下文；无返回值。每个子场景均提交新的虚构敏感值，断言固定失败提示、
 * 零业务请求、零本地缓存、候选不被继续使用，并检查候选尚未安装时不会删除正式文件。
 */
test("iCloud 保存事务阶段失败时恢复或保留旧正式配置", async (t) => {
  const oldConfigJson = iCloudConfigJson({ amapApiKey: "old-transaction-key" });
  const newKey = "new-transaction-key";
  const newApiUrl = "https://new-transaction-api.example.test";
  const newWebUrl = "https://new-transaction-web.example.test";
  const failureCases = [
    {
      name: "pending 写入失败",
      options: { iCloudFailures: { writeString: true } },
      responses: [{ index: 1 }],
      expectedFormal: null
    },
    {
      name: "pending 读取失败",
      options: { iCloudFailures: { readString: true } },
      responses: [{ index: 1 }],
      expectedFormal: null
    },
    {
      name: "旧正式移到备份失败",
      options: {
        iCloudFailures: { moveAtCall: 1 },
        iCloudFiles: { [ICLOUD_CONFIG_PATH]: oldConfigJson },
        iCloudDownloadedFiles: [ICLOUD_CONFIG_PATH]
      },
      responses: [{ index: 1 }],
      expectedFormal: oldConfigJson
    },
    {
      name: "遗留 pending 清理失败",
      options: {
        iCloudFailures: { remove: true },
        iCloudFiles: {
          [ICLOUD_CONFIG_PATH]: oldConfigJson,
          [ICLOUD_PENDING_PATH]: iCloudConfigJson({ amapApiKey: "stale-pending-key" })
        },
        iCloudDownloadedFiles: [ICLOUD_CONFIG_PATH, ICLOUD_PENDING_PATH]
      },
      responses: [{ index: 1 }],
      expectedFormal: oldConfigJson,
      expectedPending: true
    },
    {
      name: "pending 安装失败",
      options: {
        iCloudFailures: { moveAtCall: 2 },
        iCloudFiles: { [ICLOUD_CONFIG_PATH]: oldConfigJson },
        iCloudDownloadedFiles: [ICLOUD_CONFIG_PATH]
      },
      responses: [{ index: 1 }],
      expectedFormal: oldConfigJson
    },
    {
      name: "正式写后读不一致",
      options: {
        iCloudFiles: { [ICLOUD_CONFIG_PATH]: oldConfigJson },
        iCloudDownloadedFiles: [ICLOUD_CONFIG_PATH],
        iCloudReadOverrides: { [ICLOUD_CONFIG_PATH]: [oldConfigJson, "{"] }
      },
      responses: [{ index: 1 }],
      expectedFormal: oldConfigJson
    },
    {
      name: "恢复移动失败",
      options: {
        iCloudFailures: { moveAtCall: 3 },
        iCloudFiles: { [ICLOUD_CONFIG_PATH]: oldConfigJson },
        iCloudDownloadedFiles: [ICLOUD_CONFIG_PATH],
        iCloudReadOverrides: { [ICLOUD_CONFIG_PATH]: [oldConfigJson, "{"] }
      },
      responses: [{ index: 1 }],
      expectedFormal: null,
      expectedBackup: oldConfigJson
    },
    {
      name: "旧 backup 清理后正式备份移动失败",
      options: {
        iCloudFailures: { moveAtCall: 1 },
        iCloudFiles: {
          [ICLOUD_CONFIG_PATH]: oldConfigJson,
          [ICLOUD_BACKUP_PATH]: iCloudConfigJson({ amapApiKey: "stale-backup-key" })
        },
        iCloudDownloadedFiles: [ICLOUD_CONFIG_PATH, ICLOUD_BACKUP_PATH]
      },
      responses: [{ index: 1 }],
      expectedFormal: oldConfigJson
    }
  ];

  for (const failureCase of failureCases) {
    await t.test(failureCase.name, async (subtest) => {
      const startsConfigured = Boolean(failureCase.options.iCloudFiles?.[ICLOUD_CONFIG_PATH]);
      const result = await runScriptableScript({
        ...failureCase.options,
        alertResponses: [
          ...failureCase.responses,
          {
            index: 0,
            textFields: [newKey, newApiUrl, newWebUrl]
          },
          { index: 0 }
        ],
        runsInApp: true
      });
      cleanupRuntimeDirectories(subtest, result);

      const formalPath = path.join(result.iCloudDocumentsDirectory, ICLOUD_CONFIG_PATH);
      const backupPath = path.join(result.iCloudDocumentsDirectory, ICLOUD_BACKUP_PATH);
      assert.equal(result.alerts.at(-1).title, "保存失败");
      assert.equal(result.requests.length, 0);
      assert.equal(fs.existsSync(path.join(result.documentsDirectory, "tesla")), false);
      assert.equal(
        fs.existsSync(path.join(result.iCloudDocumentsDirectory, ICLOUD_PENDING_PATH)),
        Boolean(failureCase.expectedPending)
      );
      assertSensitiveValuesAbsent(result, [newKey, newApiUrl, newWebUrl]);
      assert.equal(fs.existsSync(formalPath), failureCase.expectedFormal !== null);
      if (failureCase.expectedFormal !== null) {
        assert.equal(fs.readFileSync(formalPath, "utf8"), failureCase.expectedFormal);
      }
      assert.equal(fs.existsSync(backupPath), Boolean(failureCase.expectedBackup));
      if (failureCase.expectedBackup) {
        assert.equal(fs.readFileSync(backupPath, "utf8"), failureCase.expectedBackup);
      }
      // 已配置场景必须先进入管理配置；全新场景必须先从 missing 菜单明确选择创建。
      assert.equal(result.alerts[0].presentation, "sheet");
      assert.equal(startsConfigured ? result.alerts[0].title : result.alerts[0].actions[1],
        startsConfigured ? "TeslaMate Widget" : "创建新配置");
    });
  }
});

/**
 * 验证保存准备阶段恢复无效正式文件失败时，不会继续安装新候选。
 *
 * 使用场景：用户打开管理表单后，正式配置在下一次读取时变为无效且同时存在有效备份。
 * 入参为 node:test 上下文；无返回值。表驱动覆盖删除无效正式、移动备份及恢复后复读失败，
 * 每项都必须停在保存失败、保留可恢复工件并保持零 Request/零本地缓存。
 */
test("iCloud 保存事务准备阶段的备份恢复失败时停止保存", async (t) => {
  const oldConfigJson = iCloudConfigJson({ amapApiKey: "old-recovery-key" });
  const backupConfigJson = iCloudConfigJson({ amapApiKey: "backup-recovery-key" });
  const newKey = "new-recovery-key";
  const newApiUrl = "https://new-recovery-api.example.test";
  const newWebUrl = "https://new-recovery-web.example.test";
  const failureCases = [
    { name: "删除无效正式失败", failures: { remove: true }, overrides: [oldConfigJson, "{"], formalExists: true },
    { name: "移动备份失败", failures: { moveAtCall: 1 }, overrides: [oldConfigJson, "{"], formalExists: false },
    { name: "恢复后重读失败", failures: {}, overrides: [oldConfigJson, "{", "{"], formalExists: true }
  ];

  for (const failureCase of failureCases) {
    await t.test(failureCase.name, async (subtest) => {
      const result = await runScriptableScript({
        alertResponses: [
          { index: 1 },
          { index: 0, textFields: [newKey, newApiUrl, newWebUrl] },
          { index: 0 }
        ],
        iCloudFailures: failureCase.failures,
        iCloudFiles: {
          [ICLOUD_CONFIG_PATH]: oldConfigJson,
          [ICLOUD_BACKUP_PATH]: backupConfigJson
        },
        iCloudDownloadedFiles: [ICLOUD_CONFIG_PATH, ICLOUD_BACKUP_PATH],
        iCloudReadOverrides: { [ICLOUD_CONFIG_PATH]: failureCase.overrides },
        runsInApp: true
      });
      cleanupRuntimeDirectories(subtest, result);

      assert.equal(result.alerts.at(-1).title, "保存失败");
      assert.equal(result.requests.length, 0);
      assert.equal(fs.existsSync(path.join(result.documentsDirectory, "tesla")), false);
      assert.equal(
        fs.existsSync(path.join(result.iCloudDocumentsDirectory, ICLOUD_CONFIG_PATH)),
        failureCase.formalExists
      );
      assertSensitiveValuesAbsent(result, [newKey, newApiUrl, newWebUrl]);
    });
  }
});

/**
 * 验证非法表单显示脱敏通用错误，并把本次输入保留到下一轮表单后允许重新保存。
 *
 * 使用场景：用户首次输入的 TeslaMateApi URL 不合法。入参为 node:test 上下文；无
 * 返回值。测试断言错误提示不含任何敏感输入、重试表单完整保留原值，最终只保存
 * 第二次合法输入的标准化结果。
 */
test("App 配置表单非法输入后显示通用错误并保留输入重试", async (t) => {
  const sensitiveKey = "retry-secret-key";
  const invalidApiUrl = "ftp://private-api.invalid/path";
  const firstWebUrl = "https://private-web.example.test///";
  const result = await runScriptableScript({
    alertResponses: [
      { index: 1 },
      { index: 0, textFields: [sensitiveKey, invalidApiUrl, firstWebUrl] },
      { index: 0 },
      {
        index: 0,
        textFields: [
          " final-key ",
          "https://api.final.example.test///",
          "https://web.final.example.test///"
        ]
      },
      { index: 0 }
    ],
    runsInApp: true
  });
  cleanupRuntimeDirectories(t, result);

  assert.deepEqual(result.alerts[2], {
    actions: ["确定"],
    cancelAction: null,
    message: "请检查所有配置项后重试",
    presentation: "alert",
    textFields: [],
    title: "配置无效"
  });
  assert.deepEqual(result.alerts[3].textFields, [
    { placeholder: "高德 API Key", secure: true, value: sensitiveKey },
    { placeholder: "TeslaMateApi 基础 URL", value: invalidApiUrl },
    { placeholder: "TeslaMate Web URL", value: firstWebUrl }
  ]);
  assert.equal(JSON.stringify(result.alerts).includes(sensitiveKey), true);
  assert.equal(result.alerts[2].message.includes(sensitiveKey), false);
  assert.equal(result.alerts[2].message.includes(invalidApiUrl), false);
  assert.equal(result.logs.some((line) =>
    line.includes(sensitiveKey) || line.includes(invalidApiUrl)
  ), false);
  const savedConfig = readICloudConfig(result);
  assert.equal(savedConfig.amapApiKey, "final-key");
  assert.equal(savedConfig.teslaMateApiBaseUrl, "https://api.final.example.test");
  assert.equal(savedConfig.teslaMateWebUrl, "https://web.final.example.test");
});

/**
 * 验证配置表单取消不会创建 iCloud 配置，也不会额外展示消息。
 *
 * 使用场景：首次配置用户暂不保存。入参为 node:test 上下文；无返回值。测试断言
 * 取消后仅保留一次表单交互，且脚本正常完成、WebView 未打开。
 */
test("App 配置表单取消时不写入 iCloud", async (t) => {
  const result = await runScriptableScript({
    alertResponses: [{ index: 1 }, { index: -1 }],
    runsInApp: true
  });
  cleanupRuntimeDirectories(t, result);

  assert.equal(result.alerts.length, 2);
  assert.deepEqual(result.keychain, {});
  assert.equal(fs.existsSync(path.join(result.iCloudDocumentsDirectory, ICLOUD_CONFIG_PATH)), false);
  assert.equal(result.webViews.length, 0);
  assert.equal(result.script.completed, true);
});

/**
 * 验证 iCloud pending 写入异常显示脱敏失败提示，且原有正式配置保持逐字不变。
 *
 * 使用场景：用户管理配置时 iCloud 文件暂时不可写。入参为 node:test 上下文；无
 * 返回值。测试给出新的敏感输入但注入 iCloud 写入异常，随后比较旧值并检查提示与日志均
 * 不包含新旧 Key 或私有 URL。
 */
test("App 配置表单 iCloud 写入失败时显示通用错误且不改变旧值", async (t) => {
  const existingJson = iCloudConfigJson({ amapApiKey: "existing-secret-key" });
  const newKey = "replacement-secret-key";
  const newApiUrl = "https://replacement-api.example.test";
  const result = await runScriptableScript({
    alertResponses: [
      { index: 1 },
      {
        index: 0,
        textFields: [newKey, newApiUrl, "https://replacement-web.example.test"]
      },
      { index: 0 }
    ],
    iCloudFailures: { writeString: true },
    iCloudFiles: { [ICLOUD_CONFIG_PATH]: existingJson },
    iCloudDownloadedFiles: [ICLOUD_CONFIG_PATH],
    runsInApp: true
  });
  cleanupRuntimeDirectories(t, result);

  assert.equal(
    fs.readFileSync(path.join(result.iCloudDocumentsDirectory, ICLOUD_CONFIG_PATH), "utf8"),
    existingJson
  );
  assert.deepEqual(result.alerts[2], {
    actions: ["确定"],
    cancelAction: null,
    message: "无法保存配置，请稍后重试",
    presentation: "alert",
    textFields: [],
    title: "保存失败"
  });
  assert.equal(result.alerts[2].message.includes(newKey), false);
  assert.equal(result.alerts[2].message.includes(newApiUrl), false);
  assert.equal(result.logs.some((line) =>
    line.includes(newKey) || line.includes(newApiUrl) || line.includes("existing-secret-key")
  ), false);
});

/**
 * 验证旧 Keychain schema v1 经确认后一次性迁移为五字段 iCloud envelope。
 *
 * 使用场景：升级用户尚无正式/备份文件但保留旧键。入参为 node:test 上下文；无返回值。
 * 旧 fixture 注入额外字段，成功后正式文件只能保留五个白名单字段、URL 标准化、时间规范，
 * 并且必须在再次读取正式文件一致后删除旧键；本次运行保持零业务请求和零本地缓存。
 */
test("Keychain 迁移确认后写入 iCloud 五字段 envelope 并删除旧键", async (t) => {
  const legacyJson = runtimeConfigJson({ ignoredExtraField: "must-not-migrate" });
  const result = await runScriptableScript({
    alertResponses: [{ index: 0 }, { index: 0 }],
    keychainValues: { [RUNTIME_CONFIG_KEY]: legacyJson },
    runsInApp: true
  });
  cleanupRuntimeDirectories(t, result);

  assert.deepEqual(result.alerts[0].actions, ["迁移到 iCloud Drive"]);
  assert.equal(result.alerts[0].cancelAction, "取消");
  const migratedConfig = readICloudConfig(result);
  assert.deepEqual(Object.keys(migratedConfig).sort(), [
    "amapApiKey",
    "schemaVersion",
    "teslaMateApiBaseUrl",
    "teslaMateWebUrl",
    "updatedAt"
  ]);
  assert.equal(migratedConfig.amapApiKey, SENTINEL_AMAP_API_KEY);
  assert.equal(migratedConfig.teslaMateApiBaseUrl, SENTINEL_API_BASE_URL);
  assert.equal(migratedConfig.teslaMateWebUrl, SENTINEL_WEB_URL);
  assert.equal(new Date(migratedConfig.updatedAt).toISOString(), migratedConfig.updatedAt);
  assert.equal(Object.hasOwn(result.keychain, RUNTIME_CONFIG_KEY), false);
  assert.equal(result.requests.length, 0);
  assert.equal(fs.existsSync(path.join(result.documentsDirectory, "tesla")), false);
});

/**
 * 验证迁移取消和 iCloud 保存失败都保留旧 Keychain 且不创建业务副作用。
 *
 * 使用场景：用户暂不迁移，或 pending 无法写入。入参为 node:test 上下文；无返回值。
 * 取消不得改任何存储；失败显示固定脱敏提示、正式文件不存在、旧键逐字保留。
 */
test("Keychain 迁移取消或写入失败时保留旧键", async (t) => {
  const legacyJson = runtimeConfigJson();
  const cases = [
    { name: "取消", responses: [{ index: -1 }], iCloudFailures: {}, expectedAlerts: 1 },
    {
      name: "写入失败",
      responses: [{ index: 0 }, { index: 0 }],
      iCloudFailures: { writeString: true },
      expectedAlerts: 2
    }
  ];

  for (const migrationCase of cases) {
    await t.test(migrationCase.name, async (subtest) => {
      const result = await runScriptableScript({
        alertResponses: migrationCase.responses,
        iCloudFailures: migrationCase.iCloudFailures,
        keychainValues: { [RUNTIME_CONFIG_KEY]: legacyJson },
        runsInApp: true
      });
      cleanupRuntimeDirectories(subtest, result);

      assert.deepEqual(result.alerts[0].actions, ["迁移到 iCloud Drive"]);
      assert.equal(result.alerts[0].cancelAction, "取消");
      assert.equal(result.keychain[RUNTIME_CONFIG_KEY], legacyJson);
      assert.equal(result.alerts.length, migrationCase.expectedAlerts);
      assert.equal(fs.existsSync(path.join(result.iCloudDocumentsDirectory, ICLOUD_CONFIG_PATH)), false);
      assert.equal(result.requests.length, 0);
      assert.equal(fs.existsSync(path.join(result.documentsDirectory, "tesla")), false);
      assertSensitiveValuesAbsent(result, [SENTINEL_AMAP_API_KEY, SENTINEL_API_BASE_URL, SENTINEL_WEB_URL]);
      if (migrationCase.name === "写入失败") {
        assert.equal(result.alerts.at(-1).title, "迁移失败");
      }
    });
  }
});

/**
 * 验证迁移完成后删除旧键失败不会回滚有效正式文件，且下一次运行完全不碰 Keychain。
 *
 * 使用场景：iCloud 保存和复读均成功，但 Keychain.remove 暂时失败。入参为 node:test 上下文；
 * 无返回值。第一次保留有效正式文件和不可达旧键并安全结束；第二次注入 contains sentinel，
 * 仍应只靠正式 iCloud 配置进入 ready App 菜单。
 */
test("Keychain 迁移删除旧键失败时保留有效正式文件且下次只读 iCloud", async (t) => {
  const legacyJson = runtimeConfigJson();
  const firstResult = await runScriptableScript({
    alertResponses: [{ index: 0 }, { index: 0 }],
    keychainFailures: { remove: true },
    keychainValues: { [RUNTIME_CONFIG_KEY]: legacyJson },
    runsInApp: true
  });
  cleanupRuntimeDirectories(t, firstResult);

  const installedConfig = fs.readFileSync(
    path.join(firstResult.iCloudDocumentsDirectory, ICLOUD_CONFIG_PATH),
    "utf8"
  );
  assert.equal(firstResult.keychain[RUNTIME_CONFIG_KEY], legacyJson);
  assert.equal(firstResult.alerts.at(-1).title, "迁移失败");
  assert.equal(firstResult.requests.length, 0);

  const secondResult = await runScriptableScript({
    alertResponses: [{ index: -1 }],
    iCloudFiles: { [ICLOUD_CONFIG_PATH]: installedConfig },
    iCloudDownloadedFiles: [ICLOUD_CONFIG_PATH],
    keychainFailures: { contains: new Error("unreachable-legacy-sentinel") },
    keychainValues: { [RUNTIME_CONFIG_KEY]: legacyJson },
    runsInApp: true
  });
  cleanupRuntimeDirectories(t, secondResult);
  assert.equal(secondResult.alerts[0].title, "TeslaMate Widget");
  assert.equal(secondResult.logs.some((line) => line.includes("unreachable-legacy-sentinel")), false);
});

/**
 * 验证有效 iCloud 正式配置在 App 与 Widget 都没有任何旧 Keychain 读取路径。
 *
 * 使用场景：迁移后的日常运行即使 Keychain.contains 会抛出含 sentinel 的异常，也必须正常
 * 工作。入参为 node:test 上下文；无返回值。App 正常展示菜单，Widget 正常请求车辆数据，
 * 日志不包含 sentinel，证明 ready 路径没有触碰旧键。
 */
test("有效 iCloud 配置永不读取 Keychain", async (t) => {
  const contexts = [
    { name: "App", options: { alertResponses: [{ index: -1 }], runsInApp: true } },
    {
      name: "Widget",
      options: {
        jsonResponse: apiResponse(carStatus("online")),
        runsInWidget: true,
        widgetParameter: "1"
      }
    }
  ];

  for (const context of contexts) {
    await t.test(context.name, async (subtest) => {
      const result = await runScriptableScript({
        ...readyICloudFixture(),
        ...context.options,
        keychainFailures: { contains: new Error("forbidden-keychain-read-sentinel") }
      });
      cleanupRuntimeDirectories(subtest, result);

      assert.equal(result.script.completed, true);
      assert.equal(result.logs.some((line) => line.includes("forbidden-keychain-read-sentinel")), false);
      if (context.name === "Widget") {
        assert.ok(result.requests.some((request) => request.url.includes("/api/v1/cars/1/status")));
      }
    });
  }
});

/**
 * 静态验证旧 Keychain 候选只从 App 缺失 iCloud 分支调用。
 *
 * 使用场景：运行测试无法穷举未来重构后的所有调用路径。无业务入参；测试读取生产源码，
 * 断言候选函数只有定义和 `runsInApp ? ... : missing` 调用两个出现位置，阻止 Widget 回归。
 */
test("Keychain 迁移候选只在 App 的 iCloud 缺失分支调用", () => {
  const source = fs.readFileSync(SCRIPT_PATH, "utf8");
  const calls = source.match(/loadLegacyMigrationCandidate\s*\(/g) || [];
  assert.equal(calls.length, 2);
  assert.match(source, /return runsInApp \? loadLegacyMigrationCandidate\(\) : \{ status: "missing" \}/);
});

/**
 * 验证 Keychain 读写删除仅影响本次 runtime，并可通过结果快照检查。
 *
 * 使用场景：配置向导保存或迁移安全配置后的回归测试。入参为 node:test 上下文；
 * 无返回值。临时脚本主动抛出的业务错误或断言失败均应使测试失败。
 */
test("Keychain 在单次 runtime 内保存变更并返回最终克隆", async (t) => {
  const result = await runScriptableScript({
    keychainValues: { existing: "initial", removeMe: "discard" },
    scriptPath: writeRuntimeTestScript(t, `
      // 读取前必须识别预置键，缺失代表 runtime 未隔离地注入初始安全存储。
      if (!Keychain.contains("existing")) throw new Error("existing key is unavailable");
      // 预置值必须保持原样，避免配置加载阶段读取到错误数据。
      if (Keychain.get("existing") !== "initial") throw new Error("unexpected existing value");
      // 保存新配置并删除迁移后不再使用的旧配置。
      Keychain.set("added", "new value");
      Keychain.remove("removeMe");
      Script.complete();
    `)
  });
  cleanupRuntimeDirectories(t, result);

  assert.deepEqual(result.keychain, { added: "new value", existing: "initial" });
});

/**
 * 验证 runtime 将本地缓存目录与 iCloud 配置目录完全隔离，并以脱敏快照提供下载观测。
 *
 * 使用场景：后续配置加载逻辑需要先判断并下载 iCloud 文件，测试环境不能把配置正文或
 * 文件根目录混入本地车辆缓存。入参为 node:test 上下文；运行时预置虚构配置文件，成功
 * 返回的快照只允许暴露下载次数和文件元数据，任何正文泄漏或下载状态错误都会使测试失败。
 */
test("runtime 将本地缓存与 iCloud 配置隔离并提供脱敏文件观测", async (t) => {
  const result = await runScriptableScript({
    iCloudFiles: { "teslamate/config.v1.json": "sentinel-config-body" },
    iCloudDownloadedFiles: [],
    scriptPath: writeRuntimeTestScript(t, `
      const local = FileManager.local();
      const cloud = FileManager.iCloud();
      const target = cloud.joinPath(cloud.documentsDirectory(), "teslamate/config.v1.json");
      if (cloud.isFileDownloaded(target)) throw new Error("unexpected download state");
      await cloud.downloadFileFromiCloud(target);
      if (!cloud.isFileDownloaded(target)) throw new Error("download did not complete");
      if (local.documentsDirectory() === cloud.documentsDirectory()) throw new Error("roots overlap");
      Script.complete();
    `)
  });
  cleanupRuntimeDirectories(t, result);

  assert.equal(result.iCloudFileObservations.downloadCalls, 1);
  assert.equal(JSON.stringify(result.iCloudFileObservations).includes("sentinel-config-body"), false);
});

/**
 * 验证每个带路径的 FileManager I/O 都拒绝把另一实例的 documents 路径当作自身文件。
 *
 * 使用场景：runtime 同时暴露 local 和 iCloud FileManager；若任意入口没有集中校验根目录，
 * 被测脚本就可能跨越缓存与配置隔离边界。入参为 node:test 上下文；每个子场景将 iCloud
 * 路径传给 local 实例的一个 I/O API，预期固定拒绝错误且不会执行外部文件系统操作。
 */
test("FileManager 全部文件 I/O 拒绝跨 local/iCloud 根目录", async (t) => {
  const operationCases = [
    { name: "createDirectory", source: "local.createDirectory(cloudTarget);" },
    { name: "fileExists", source: "local.fileExists(cloudTarget);" },
    { name: "isDirectory", source: "local.isDirectory(cloudTarget);" },
    { name: "readImage", source: "local.readImage(cloudTarget);" },
    { name: "readString", source: "local.readString(cloudTarget);" },
    {
      name: "writeImage",
      source: "local.writeImage(cloudTarget, Image.fromData(Data.fromBase64String(\"AA==\")));"
    },
    { name: "writeString", source: "local.writeString(cloudTarget, \"safe\");" },
    { name: "remove", source: "local.remove(cloudTarget);" },
    { name: "isFileDownloaded", source: "local.isFileDownloaded(cloudTarget);" },
    { name: "downloadFileFromiCloud", source: "await local.downloadFileFromiCloud(cloudTarget);" },
    {
      name: "move source",
      source: "local.move(cloudTarget, local.joinPath(local.documentsDirectory(), \"target.json\"));"
    },
    {
      name: "move destination",
      source: `
        const localSource = local.joinPath(local.documentsDirectory(), "source.json");
        local.writeString(localSource, "safe");
        local.move(localSource, cloudTarget);
      `
    }
  ];

  for (const operationCase of operationCases) {
    await t.test(operationCase.name, async (subtest) => {
      const runtimeError = await captureRuntimeFailure({
        documentsDirectory: createRuntimeDocumentsDirectory(subtest),
        iCloudDocumentsDirectory: createRuntimeICloudDocumentsDirectory(subtest),
        iCloudFiles: { "teslamate/config.v1.json": "sentinel-config-body" },
        scriptPath: writeRuntimeTestScript(subtest, `
          const local = FileManager.local();
          const cloud = FileManager.iCloud();
          const cloudTarget = cloud.joinPath(cloud.documentsDirectory(), "teslamate/config.v1.json");
          ${operationCase.source}
        `)
      });

      assert.match(runtimeError.message, /Mock FileManager local rejected path outside documents directory/);
    });
  }
});

/**
 * 验证 iCloud 文件操作拒绝 `..` 与 local 路径，且失败快照绝不产生越界观测。
 *
 * 使用场景：观测在故障注入前记录调用，必须先完成路径校验，否则相对化跨根路径会产生
 * `../` 条目并可能读取 local 缓存元数据。入参为 node:test 上下文；临时脚本以 iCloud
 * 实例尝试访问 local 文件，预期获得固定拒绝错误，观测只保留 iCloud 根内的预置文件。
 */
test("iCloud 路径校验阻止越界观测和跨根文件元数据读取", async (t) => {
  const runtimeError = await captureRuntimeFailure({
    documentsDirectory: createRuntimeDocumentsDirectory(t),
    iCloudDocumentsDirectory: createRuntimeICloudDocumentsDirectory(t),
    iCloudFiles: { "teslamate/config.v1.json": "sentinel-config-body" },
    scriptPath: writeRuntimeTestScript(t, `
      const local = FileManager.local();
      const cloud = FileManager.iCloud();
      const localTarget = local.joinPath(local.documentsDirectory(), "local-only.json");
      local.writeString(localTarget, "sentinel-local-body");
      cloud.fileExists(localTarget);
    `)
  });

  assert.match(runtimeError.message, /Mock FileManager iCloud rejected path outside documents directory/);
  assert.deepEqual(runtimeError.runtimeResult.iCloudFileObservations.files, [{
    path: "teslamate/config.v1.json",
    exists: true,
    length: "sentinel-config-body".length
  }]);
  assert.equal(
    runtimeError.runtimeResult.iCloudFileObservations.files.some((file) => file.path.startsWith("..")),
    false
  );
  assert.equal(JSON.stringify(runtimeError.runtimeResult.iCloudFileObservations).includes("sentinel-local-body"), false);
});

/**
 * 验证 joinPath 得到的 `..` 路径同样在 I/O 边界被拒绝。
 *
 * 使用场景：Scriptable 的 joinPath 不负责授权校验，调用方可合法拼出上级目录；真正读写前
 * 必须由 FileManager 集中拒绝。入参为 node:test 上下文；无正常业务返回，越界未抛错或
 * 快照出现 `..` 路径都表示隔离回归。
 */
test("FileManager 拒绝 documents 根外的 .. 路径", async (t) => {
  const runtimeError = await captureRuntimeFailure({
    documentsDirectory: createRuntimeDocumentsDirectory(t),
    iCloudDocumentsDirectory: createRuntimeICloudDocumentsDirectory(t),
    scriptPath: writeRuntimeTestScript(t, `
      const cloud = FileManager.iCloud();
      const escaped = cloud.joinPath(cloud.documentsDirectory(), "../outside.json");
      cloud.readString(escaped);
    `)
  });

  assert.match(runtimeError.message, /Mock FileManager iCloud rejected path outside documents directory/);
  assert.equal(
    runtimeError.runtimeResult.iCloudFileObservations.files.some((file) => file.path.startsWith("..")),
    false
  );
});

/**
 * 验证 iCloud FileManager 能按相对路径依次消费任意读取覆盖值，并禁止将正文写入快照。
 *
 * 使用场景：配置保存事务需要稳定模拟“首次校验成功、正式安装后复读损坏”的竞态。入参
 * 为 node:test 上下文；测试预置原始文件、两次覆盖正文和 null，临时脚本必须依序原样
 * 读取三个覆盖值。返回观测只能包含相对路径、文件存在性、长度和次数，正文进入快照即失败。
 */
test("iCloud readString 支持按读取次数消费脱敏覆盖值", async (t) => {
  const result = await runScriptableScript({
    iCloudFiles: { "teslamate/config.v1.json": "sentinel-stored-body" },
    iCloudReadOverrides: {
      "teslamate/config.v1.json": ["sentinel-first-read", "sentinel-second-read", null]
    },
    scriptPath: writeRuntimeTestScript(t, `
      const cloud = FileManager.iCloud();
      const target = cloud.joinPath(cloud.documentsDirectory(), "teslamate/config.v1.json");
      if (cloud.readString(target) !== "sentinel-first-read") throw new Error("first override mismatch");
      if (cloud.readString(target) !== "sentinel-second-read") throw new Error("second override mismatch");
      if (cloud.readString(target) !== null) throw new Error("null override mismatch");
      Script.complete();
    `)
  });
  cleanupRuntimeDirectories(t, result);

  assert.equal(result.iCloudFileObservations.readCalls, 3);
  assert.equal(JSON.stringify(result.iCloudFileObservations).includes("sentinel-first-read"), false);
  assert.equal(JSON.stringify(result.iCloudFileObservations).includes("sentinel-second-read"), false);
});

/**
 * 验证 iCloud FileManager 各阶段都可注入自定义故障，且失败快照不保存错误或配置正文。
 *
 * 使用场景：生产层需要分别处理下载、读取、写入、存在性检查、移动和清理失败。入参为
 * node:test 上下文；每个子场景调用一个目标 API 并注入含 sentinel 的 Error，移动场景
 * 则在第 1、2、3 次调用失败以覆盖备份、候选安装和恢复阶段。所有失败均保留原 Error，
 * 快照只允许出现固定相对路径、长度和调用次数。
 */
test("iCloud FileManager 支持脱敏故障注入与分阶段移动失败", async (t) => {
  const sentinelErrorText = "sentinel-iCloud-failure-body";
  const operationCases = [
    {
      name: "download",
      failureKey: "download",
      source: "await cloud.downloadFileFromiCloud(target);",
      callField: "downloadCalls"
    },
    {
      name: "readString",
      failureKey: "readString",
      source: "cloud.readString(target);",
      callField: "readCalls"
    },
    {
      name: "writeString",
      failureKey: "writeString",
      source: 'cloud.writeString(target, "sentinel-written-body");',
      callField: "writeCalls"
    },
    {
      name: "fileExists",
      failureKey: "fileExists",
      source: "cloud.fileExists(target);",
      callField: "fileExistsCalls"
    },
    {
      name: "remove",
      failureKey: "remove",
      source: "cloud.remove(target);",
      callField: "removeCalls"
    }
  ];

  for (const operationCase of operationCases) {
    await t.test(operationCase.name, async (subtest) => {
      const error = new Error(`${sentinelErrorText}-${operationCase.name}`);
      const runtimeError = await captureRuntimeFailure({
        documentsDirectory: createRuntimeDocumentsDirectory(subtest),
        iCloudDocumentsDirectory: createRuntimeICloudDocumentsDirectory(subtest),
        iCloudFailures: { [operationCase.failureKey]: error },
        iCloudFiles: { "teslamate/config.v1.json": "sentinel-config-body" },
        scriptPath: writeRuntimeTestScript(subtest, `
          const cloud = FileManager.iCloud();
          const target = cloud.joinPath(cloud.documentsDirectory(), "teslamate/config.v1.json");
          ${operationCase.source}
        `)
      });

      assert.equal(runtimeError, error);
      const observations = runtimeError.runtimeResult.iCloudFileObservations;
      assert.equal(observations[operationCase.callField], 1);
      assert.equal(JSON.stringify(observations).includes(sentinelErrorText), false);
      assert.deepEqual(observations.files, [{
        path: "teslamate/config.v1.json",
        exists: true,
        length: "sentinel-config-body".length
      }]);
    });
  }

  for (const failureAtCall of [1, 2, 3]) {
    await t.test(`moveAtCall ${failureAtCall}`, async (subtest) => {
      const iCloudFiles = {};
      for (let index = 1; index <= failureAtCall; index += 1) {
        iCloudFiles[`teslamate/source-${index}.json`] = `sentinel-source-${index}`;
      }
      const runtimeError = await captureRuntimeFailure({
        documentsDirectory: createRuntimeDocumentsDirectory(subtest),
        iCloudDocumentsDirectory: createRuntimeICloudDocumentsDirectory(subtest),
        iCloudFailures: { moveAtCall: failureAtCall },
        iCloudFiles,
        scriptPath: writeRuntimeTestScript(subtest, `
          const cloud = FileManager.iCloud();
          for (let index = 1; index <= ${failureAtCall}; index += 1) {
            const source = cloud.joinPath(cloud.documentsDirectory(), "teslamate/source-" + index + ".json");
            const target = cloud.joinPath(cloud.documentsDirectory(), "teslamate/target-" + index + ".json");
            cloud.move(source, target);
          }
        `)
      });

      assert.match(runtimeError.message, new RegExp(`Mock iCloud FileManager move failed at call ${failureAtCall}`));
      assert.equal(runtimeError.runtimeResult.iCloudFileObservations.moveCalls, failureAtCall);
      assert.equal(JSON.stringify(runtimeError.runtimeResult.iCloudFileObservations).includes("sentinel-source"), false);
    });
  }
});

/**
 * 验证四个 Keychain 操作都能独立注入固定错误。
 *
 * 使用场景：配置读取、保存与清除各自的异常分支回归。入参为 node:test 上下文；
 * 无返回值。任一操作未抛出对应固定错误即使测试失败。
 */
test("Keychain 对四类配置失败操作抛出固定测试错误", async (t) => {
  const documentsDirectory = createRuntimeDocumentsDirectory(t);
  const iCloudDocumentsDirectory = createRuntimeICloudDocumentsDirectory(t);
  // 每个临时脚本只调用一个 API，以验证对应 keychainFailures 布尔开关的独立语义。
  const failureCases = [
    { operation: "contains", source: "Keychain.contains(\"configured\");" },
    { operation: "get", source: "Keychain.get(\"configured\");" },
    { operation: "set", source: "Keychain.set(\"configured\", \"value\");" },
    { operation: "remove", source: "Keychain.remove(\"configured\");" }
  ];

  // 每轮只开启一个故障开关，保证断言可定位到具体 Scriptable API 操作。
  for (const failureCase of failureCases) {
    await assert.rejects(
      runScriptableScript({
        documentsDirectory,
        iCloudDocumentsDirectory,
        keychainFailures: { [failureCase.operation]: true },
        scriptPath: writeRuntimeTestScript(t, failureCase.source)
      }),
      new Error(`Mock Keychain ${failureCase.operation} failed`)
    );
  }
});

/**
 * 验证 Keychain contains/get/set 可直接抛出调用方提供的 Error。
 *
 * 使用场景：安全测试需要让异常消息真实携带虚构 Key 和完整 URL，证明生产代码不会
 * 打印异常对象。入参为 node:test 上下文；无返回值。每个操作使用独立 sentinel Error
 * 和临时脚本，runtime 若改写为默认 Mock 错误或吞掉原错误，assert.rejects 会失败。
 */
test("Keychain 故障注入支持 contains、get、set 自定义 Error", async (t) => {
  const documentsDirectory = createRuntimeDocumentsDirectory(t);
  const iCloudDocumentsDirectory = createRuntimeICloudDocumentsDirectory(t);
  const failureCases = [
    { operation: "contains", source: "Keychain.contains(\"configured\");" },
    { operation: "get", source: "Keychain.get(\"configured\");" },
    { operation: "set", source: "Keychain.set(\"configured\", \"value\");" }
  ];

  // 自定义消息同时携带虚构 Key 与完整 URL，确保接口满足后续脱敏业务测试的输入要求。
  for (const failureCase of failureCases) {
    const customError = new Error(
      `sentinel ${failureCase.operation}: ${SENTINEL_AMAP_API_KEY} ${SENTINEL_API_BASE_URL}`
    );
    await assert.rejects(
      runScriptableScript({
        documentsDirectory,
        iCloudDocumentsDirectory,
        keychainFailures: { [failureCase.operation]: customError },
        keychainValues: { configured: "value" },
        scriptPath: writeRuntimeTestScript(t, failureCase.source)
      }),
      customError
    );
  }
});

/**
 * 验证图片请求故障同时兼容默认 Mock Error 和调用方自定义 Error。
 *
 * 使用场景：高德脱敏测试需要让 Request.loadImage() 抛出含 Key 与完整 URL 的 Error，
 * 既有测试仍依赖 `failImages: true` 的固定错误。入参为 node:test 上下文；无返回值。
 * 两种配置分别运行同一临时脚本，错误类型或消息不符会由 assert.rejects 报告。
 */
test("图片请求故障注入支持自定义 Error 并兼容默认错误", async (t) => {
  const requestUrl = `https://maps.example.test/static?key=${SENTINEL_AMAP_API_KEY}`;
  const iCloudDocumentsDirectory = createRuntimeICloudDocumentsDirectory(t);
  const scriptPath = writeRuntimeTestScript(t, `
    const request = new Request("${requestUrl}");
    await request.loadImage();
  `);

  await assert.rejects(
    runScriptableScript({
      documentsDirectory: createRuntimeDocumentsDirectory(t),
      iCloudDocumentsDirectory,
      failImages: true,
      scriptPath
    }),
    new Error("Mock image request failed")
  );

  const customError = new Error(`sentinel image failure: ${requestUrl}`);
  await assert.rejects(
    runScriptableScript({
      documentsDirectory: createRuntimeDocumentsDirectory(t),
      iCloudDocumentsDirectory,
      failImages: customError,
      scriptPath
    }),
    customError
  );
});

/**
 * 验证未保存的 Keychain 键不会被解释为空配置。
 *
 * 使用场景：配置首次运行时区分“未配置”和“配置为空”的业务分支。入参为 node:test
 * 上下文；无返回值。若未抛出缺失值错误，测试框架将报告失败。
 */
test("Keychain 读取缺失键时抛出固定错误", async (t) => {
  await assert.rejects(
    runScriptableScript({
      documentsDirectory: createRuntimeDocumentsDirectory(t),
      iCloudDocumentsDirectory: createRuntimeICloudDocumentsDirectory(t),
      scriptPath: writeRuntimeTestScript(t, "Keychain.get(\"missing\");")
    }),
    new Error("Missing keychain value")
  );
});

/**
 * 验证响应下标只能选择已注册的动作。
 *
 * 使用场景：测试编排传入过期或错误的动作下标时，runtime 必须按取消处理而非返回
 * 不存在的动作。入参为 node:test 上下文；无返回值。越界下标被接受会由临时脚本抛错。
 */
test("Alert 对大于等于动作数量的响应下标返回取消", async (t) => {
  const result = await runScriptableScript({
    alertResponses: [{ index: 1 }],
    scriptPath: writeRuntimeTestScript(t, `
      const alert = new Alert();
      alert.addAction("保存");
      // 当前 Alert 只有下标 0 的动作；下标 1 必须按取消处理。
      if (await alert.presentAlert() !== -1) throw new Error("out-of-range response index was accepted");
      Script.complete();
    `)
  });
  cleanupRuntimeDirectories(t, result);

  assert.equal(result.script.completed, true);
});

/**
 * 验证 Alert 记录展示信息，严格消费响应，并返回当前文本框输入。
 *
 * 使用场景：配置向导的保存与确认提示回归。入参为 node:test 上下文；无返回值；
 * 临时脚本中任意响应、文本值或取消语义不符都会抛出业务错误。
 */
test("Alert 记录展示信息、按顺序消费响应并返回文本框输入", async (t) => {
  const result = await runScriptableScript({
    alertResponses: [
      { index: 0, textFields: ["fake-amap-key"] },
      { index: -1 }
    ],
    scriptPath: writeRuntimeTestScript(t, `
      const setup = new Alert();
      setup.title = "配置 TeslaMate";
      setup.message = "请填写连接信息";
      setup.addAction("保存");
      setup.addCancelAction("取消");
      setup.addTextField("高德 Key", "");
      // 第一份响应选择保存，且其文本框值应在展示后可读取。
      if (await setup.presentAlert() !== 0) throw new Error("unexpected setup response");
      if (setup.textFieldValue(0) !== "fake-amap-key") throw new Error("unexpected text field value");

      const confirmation = new Alert();
      confirmation.title = "保存成功";
      confirmation.addAction("确定");
      // 第二份响应显式取消保存成功提示，取消值必须统一为 -1。
      if (await confirmation.presentSheet() !== -1) throw new Error("unexpected cancellation response");
      Script.complete();
    `)
  });
  cleanupRuntimeDirectories(t, result);

  assert.deepEqual(result.alerts, [
    {
      actions: ["保存"],
      cancelAction: "取消",
      message: "请填写连接信息",
      presentation: "alert",
      textFields: [{ placeholder: "高德 Key", value: "" }],
      title: "配置 TeslaMate"
    },
    {
      actions: ["确定"],
      cancelAction: null,
      message: "",
      presentation: "sheet",
      textFields: [],
      title: "保存成功"
    }
  ]);
});

/**
 * 验证没有编排响应时 Alert 不会静默选择默认动作。
 *
 * 使用场景：后续配置向导新增弹窗却遗漏测试响应时，尽早暴露测试编排缺口。入参为
 * node:test 上下文；无返回值。仅接受固定的响应不足错误。
 */
test("Alert 响应不足时明确报错，避免静默选择默认动作", async (t) => {
  await assert.rejects(
    runScriptableScript({
      documentsDirectory: createRuntimeDocumentsDirectory(t),
      iCloudDocumentsDirectory: createRuntimeICloudDocumentsDirectory(t),
      scriptPath: writeRuntimeTestScript(t, `
        const alert = new Alert();
        // 未传入 alertResponses 时，展示必须抛出固定错误而非选择任意动作。
        await alert.presentAlert();
      `)
    }),
    new Error("Missing alert response")
  );
});

test("TeslaMate API 失败时可以读取已有车辆缓存继续渲染", async (t) => {
  const documentsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "scriptable-cache-"));
  t.after(() => fs.rmSync(documentsDirectory, { recursive: true, force: true }));
  const cacheRoot = path.join(documentsDirectory, "tesla");
  fs.mkdirSync(cacheRoot, { recursive: true });
  fs.writeFileSync(
    path.join(cacheRoot, "car_data_1.json"),
    JSON.stringify(apiResponse(carStatus("offline"))),
    "utf8"
  );

  const result = await runScriptableScript({
    ...readyICloudFixture(),
    documentsDirectory,
    failJSON: true,
    runsInWidget: true,
    widgetParameter: "1"
  });
  cleanupRuntimeDirectories(t, result);

  assert.equal(result.script.completed, true);
  assert.equal(result.widget.presented, "medium");
  assert.ok(textValues(result.widget).some((text) => text.includes("Model Y")));
});

/**
 * 验证 TeslaMate 请求异常只输出固定分类日志，并继续使用指定车辆缓存。
 *
 * 使用场景：私有 API 地址可能被 Request 异常对象携带，日志不得输出该对象。入参为
 * node:test 上下文；无返回值。测试预置车 ID 2 缓存并注入请求失败，断言固定日志、
 * 缓存渲染和三个用户可见输出面均不含完整 sentinel 配置。
 */
test("TeslaMate 请求失败日志不泄露 Key 或完整 URL", async (t) => {
  const documentsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "scriptable-api-redaction-"));
  t.after(() => fs.rmSync(documentsDirectory, { recursive: true, force: true }));
  const cacheRoot = path.join(documentsDirectory, "tesla");
  fs.mkdirSync(cacheRoot, { recursive: true });
  fs.writeFileSync(
    path.join(cacheRoot, "car_data_2.json"),
    JSON.stringify(apiResponse(carStatus("offline", { display_name: "Cached Car 2" }))),
    "utf8"
  );

  const result = await runScriptableScript({
    ...readyICloudFixture(),
    documentsDirectory,
    jsonResponse(request) {
      // 异常显式携带生产请求的完整 URL，确保打印异常对象会被下方 sentinel 断言捕获。
      throw new Error(`sentinel TeslaMate request failed: ${request.url}`);
    },
    runsInWidget: true,
    widgetParameter: "2"
  });
  cleanupRuntimeDirectories(t, result);

  assert.ok(result.logs.includes("车辆状态请求失败，尝试读取缓存"));
  assert.ok(textValues(result.widget).some((text) => text.includes("Cached Car 2")));
  assertSensitiveValuesAbsent(result, [
    SENTINEL_AMAP_API_KEY,
    `${SENTINEL_API_BASE_URL}/api/v1/cars/2/status`,
    SENTINEL_WEB_URL
  ]);
});

/**
 * 验证没有车辆缓存时，TeslaMate 请求异常不会原样暴露给 Scriptable。
 *
 * 使用场景：首次运行或缓存被清理后，Request Error 可能包含完整私有 API URL。入参为
 * node:test 上下文；无返回值。测试注入带 URL 和 Key 的 sentinel Error，断言业务仍以
 * “车辆状态加载失败”结束，同时所有已产生的日志、Alert 与 Widget 输出均不含敏感值。
 */
test("无车辆缓存时 TeslaMate 请求失败抛出固定脱敏错误", async (t) => {
  const sentinelApiUrl = "https://private-api.example.test/secret/status";
  const sentinelKey = "sentinel-request-key-never-real";
  const error = await captureRuntimeFailure({
    ...readyICloudFixture(),
    jsonResponse() {
      throw new Error(`TeslaMate request failed: ${sentinelApiUrl}?key=${sentinelKey}`);
    },
    runsInWidget: true,
    widgetParameter: "1"
  });
  const result = error.runtimeResult;
  cleanupRuntimeDirectories(t, result);

  assert.equal(error.message, "车辆状态加载失败");
  assert.deepEqual(result.logs, ["车辆状态请求失败，尝试读取缓存"]);
  assert.equal(result.widget, null);
  assert.equal(result.alerts.length, 0);
  assert.equal(result.script.completed, false);
  assertSensitiveValuesAbsent(result, [sentinelApiUrl, sentinelKey]);
  assert.equal(error.message.includes(sentinelApiUrl), false);
  assert.equal(error.message.includes(sentinelKey), false);
});

/**
 * 验证高德静态地图失败时使用固定日志和占位图片，不回显请求配置。
 *
 * 使用场景：地图请求 URL 含高德 Key、坐标和完整 query，异常对象不得进入日志。
 * 入参为 node:test 上下文；无返回值。测试确认请求确实使用 sentinel Key，同时日志、
 * Alert 消息及 Widget 文案保持脱敏，渲染生命周期仍正常完成。
 */
test("高德地图图片失败日志不泄露 Key 或完整 URL", async (t) => {
  const sentinelAmapUrl = `https://restapi.amap.com/v3/staticmap?sentinel=1&key=${SENTINEL_AMAP_API_KEY}`;
  const result = await runScriptableScript({
    ...readyICloudFixture(),
    failImages: new Error(`sentinel Amap image failure: ${sentinelAmapUrl}`),
    jsonResponse: apiResponse(carStatus("online")),
    runsInWidget: true,
    widgetParameter: "1"
  });
  cleanupRuntimeDirectories(t, result);

  const amapRequest = result.requests.find((request) =>
    request.url.startsWith("https://restapi.amap.com/v3/staticmap?")
  );
  assert.ok(amapRequest);
  assert.ok(amapRequest.url.includes(`key=${SENTINEL_AMAP_API_KEY}`));
  assert.ok(result.logs.includes("静态地图加载失败"));
  assert.equal(result.logs.some((line) => line.includes("Mock image request failed")), false);
  assert.equal(result.script.completed, true);
  assertSensitiveValuesAbsent(result, [SENTINEL_AMAP_API_KEY, sentinelAmapUrl, amapRequest.url]);
});

/**
 * 验证反向地理编码异常不打印可能携带隐私数据的错误对象。
 *
 * 使用场景：系统定位服务异常可能包含坐标或调用上下文。入参为 node:test 上下文；
 * 无返回值。拒绝 thenable 模拟带 sentinel 的异步异常，生产脚本应记录固定分类日志、
 * 使用“未知位置”回退并保持所有可见输出面不含异常详情。
 */
test("地理编码失败日志不泄露异常详情", async (t) => {
  const sentinelGeocodeError = "sentinel-geocode-private-coordinate";
  const result = await runScriptableScript({
    ...readyICloudFixture(),
    jsonResponse: apiResponse(carStatus("online")),
    reverseGeocode: {
      // Promise 同化会调用 then；只触发 reject，精确进入生产脚本的定位异常分支。
      then(resolve, reject) {
        reject(new Error(sentinelGeocodeError));
      }
    },
    runsInWidget: true,
    widgetParameter: "1"
  });
  cleanupRuntimeDirectories(t, result);

  assert.ok(result.logs.includes("地理编码失败"));
  assert.ok(textValues(result.widget).some((text) => text.includes("未知位置")));
  assertSensitiveValuesAbsent(result, [sentinelGeocodeError]);
});

/**
 * 验证损坏的旧车辆缓存只产生固定分类日志，并由在线响应覆盖修复。
 *
 * 使用场景：在线请求成功后，上一坐标缓存仍可能因截断或历史格式损坏而解析失败。
 * 入参为 node:test 上下文；无返回值。测试预置含 sentinel 的非法 JSON，断言 Widget
 * 使用在线数据完成渲染、异常详情不进入输出面，且最终缓存被有效响应替换。
 */
test("损坏车辆缓存读取失败时记录固定脱敏日志", async (t) => {
  const sentinelCorruptCache = "sentinel-corrupt-cache-private-payload";
  const documentsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "scriptable-cache-redaction-"));
  t.after(() => fs.rmSync(documentsDirectory, { recursive: true, force: true }));
  const cacheRoot = path.join(documentsDirectory, "tesla");
  const cachePath = path.join(cacheRoot, "car_data_2.json");
  fs.mkdirSync(cacheRoot, { recursive: true });
  fs.writeFileSync(cachePath, `{${sentinelCorruptCache}`, "utf8");

  const result = await runScriptableScript({
    ...readyICloudFixture(),
    documentsDirectory,
    jsonResponse: apiResponse(carStatus("online", { display_name: "Recovered Car 2" })),
    runsInWidget: true,
    widgetParameter: "2"
  });
  cleanupRuntimeDirectories(t, result);

  assert.ok(result.logs.includes("车辆缓存读取失败"));
  assert.equal(result.logs.some((line) => line.includes("SyntaxError")), false);
  assert.ok(textValues(result.widget).some((text) => text.includes("Recovered Car 2")));
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(cachePath, "utf8")));
  assertSensitiveValuesAbsent(result, [sentinelCorruptCache]);
});

/**
 * 验证 iCloud 正式文件读取边界和 pending 写入异常均安全脱敏。
 *
 * 使用场景：FileManager 错误对象可能携带文件正文、API Key 或私有 URL。入参为 node:test
 * 上下文；无返回值。Widget 读取异常必须渲染同步提示且零副作用，App 写入异常必须显示
 * 固定失败 Alert；所有日志、Alert 与 Widget 文案均不得包含 sentinel。
 */
test("iCloud 读取和写入失败不会泄露配置", async (t) => {
  const readFailureCases = [
    {
      name: "下载状态",
      iCloudFiles: { [ICLOUD_CONFIG_PATH]: iCloudConfigJson() },
      iCloudFailures: {
        downloadState: new Error(
          `sentinel download state failure: ${SENTINEL_AMAP_API_KEY} ${SENTINEL_API_BASE_URL}`
        )
      }
    },
    {
      name: "正文读取",
      iCloudFiles: { [ICLOUD_CONFIG_PATH]: iCloudConfigJson() },
      iCloudDownloadedFiles: [ICLOUD_CONFIG_PATH],
      iCloudFailures: {
        readString: new Error(
          `sentinel read failure: ${SENTINEL_AMAP_API_KEY} ${SENTINEL_API_BASE_URL}`
        )
      }
    }
  ];

  // 下载状态与正文读取分别命中外层和读取层 catch，必须得到相同的 Widget 安全门禁。
  for (const failureCase of readFailureCases) {
    await t.test(failureCase.name, async (subtest) => {
      const result = await runScriptableScript({
        iCloudFailures: failureCase.iCloudFailures,
        iCloudFiles: failureCase.iCloudFiles,
        iCloudDownloadedFiles: failureCase.iCloudDownloadedFiles,
        runsInWidget: true,
        widgetParameter: "1"
      });
      cleanupRuntimeDirectories(subtest, result);

      assertUnavailableConfigWidget(result);
      assertSensitiveValuesAbsent(result, [
        SENTINEL_AMAP_API_KEY,
        SENTINEL_API_BASE_URL,
        SENTINEL_WEB_URL
      ]);
    });
  }

  await t.test("pending 写入", async (subtest) => {
    const newSentinelKey = "sentinel-replacement-amap-key-never-real";
    const newSentinelApiUrl = "https://replacement-api.example.test/private-base";
    const newSentinelWebUrl = "https://replacement-web.example.test/private-base";
    const result = await runScriptableScript({
      alertResponses: [
        { index: 1 },
        {
          index: 0,
          textFields: [newSentinelKey, newSentinelApiUrl, newSentinelWebUrl]
        },
        { index: 0 }
      ],
      iCloudFailures: {
        writeString: new Error(
          `sentinel write failure: ${newSentinelKey} ${newSentinelApiUrl} ${newSentinelWebUrl}`
        )
      },
      ...readyICloudFixture(),
      runsInApp: true
    });
    cleanupRuntimeDirectories(subtest, result);

    assert.equal(result.alerts[2].title, "保存失败");
    assert.equal(result.alerts[2].message, "无法保存配置，请稍后重试");
    assertSensitiveValuesAbsent(result, [
      newSentinelKey,
      newSentinelApiUrl,
      newSentinelWebUrl
    ]);
  });
});
