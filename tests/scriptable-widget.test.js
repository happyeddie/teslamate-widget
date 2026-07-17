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
 * 使用场景：网络和 Keychain 故障测试需要同时覆盖三个用户可观测输出面。入参为
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
 * 断言配置不可用的 Widget 在文件与网络副作用发生前安全结束。
 *
 * 使用场景：复用中号与锁屏 Widget 对空 Keychain、损坏 JSON、schema 不兼容、字段
 * 非法和 Keychain 异常的共同验收规则。入参为 runtime 执行快照；无返回值。提示
 * 文案、请求数量、完成状态或缓存目录任一不符时，node:assert 会抛出断言错误。
 */
function assertMissingConfigWidget(result) {
  assert.ok(textValues(result.widget).some((text) =>
    text.includes("请在 Scriptable 中运行脚本完成配置")
  ));
  assert.equal(result.requests.length, 0);
  assert.equal(result.script.completed, true);
  assert.equal(fs.existsSync(path.join(result.documentsDirectory, "tesla")), false);
}

/**
 * 覆盖所有读取失败与校验失败输入，并在两类 Widget family 上验证统一门禁。
 *
 * 使用场景：任何不可用配置都必须在创建 FileManager 缓存目录和 Request 之前结束。
 * 入参为 node:test 上下文；无返回值。每个场景按自身 Keychain 初始值和故障开关运行
 * 中号及 accessoryCircular Widget，执行异常或副作用断言失败均由测试框架报告。
 */
test("配置缺失、损坏或读取失败时 Widget 显示配置提示且不产生副作用", async (t) => {
  const invalidConfigCases = [
    { name: "空 Keychain", keychainValues: {} },
    { name: "损坏 JSON", keychainValues: { [RUNTIME_CONFIG_KEY]: "{" } },
    {
      name: "schema 不兼容",
      keychainValues: { [RUNTIME_CONFIG_KEY]: runtimeConfigJson({ schemaVersion: 2 }) }
    },
    {
      name: "高德 Key 为空",
      keychainValues: { [RUNTIME_CONFIG_KEY]: runtimeConfigJson({ amapApiKey: "   " }) }
    },
    {
      name: "TeslaMateApi URL 非法",
      keychainValues: {
        [RUNTIME_CONFIG_KEY]: runtimeConfigJson({
          teslaMateApiBaseUrl: "ftp://teslamate-api.example.test"
        })
      }
    },
    {
      name: "TeslaMateApi URL 缺少 host",
      keychainValues: {
        [RUNTIME_CONFIG_KEY]: runtimeConfigJson({ teslaMateApiBaseUrl: "http://:8080" })
      }
    },
    {
      name: "TeslaMateApi IPv6 host 方括号不完整",
      keychainValues: {
        [RUNTIME_CONFIG_KEY]: runtimeConfigJson({ teslaMateApiBaseUrl: "http://[abc" })
      }
    },
    {
      name: "TeslaMateApi IPv6 host 包含非法后缀",
      keychainValues: {
        [RUNTIME_CONFIG_KEY]: runtimeConfigJson({ teslaMateApiBaseUrl: "http://[::1]oops" })
      }
    },
    {
      name: "TeslaMateApi 端口不是纯数字",
      keychainValues: {
        [RUNTIME_CONFIG_KEY]: runtimeConfigJson({
          teslaMateApiBaseUrl: "http://example.test:not-a-port"
        })
      }
    },
    {
      name: "TeslaMateApi 端口小于合法范围",
      keychainValues: {
        [RUNTIME_CONFIG_KEY]: runtimeConfigJson({ teslaMateApiBaseUrl: "http://example.test:0" })
      }
    },
    {
      name: "TeslaMateApi 端口大于合法范围",
      keychainValues: {
        [RUNTIME_CONFIG_KEY]: runtimeConfigJson({
          teslaMateApiBaseUrl: "http://example.test:65536"
        })
      }
    },
    {
      name: "TeslaMate Web URL 包含空白",
      keychainValues: {
        [RUNTIME_CONFIG_KEY]: runtimeConfigJson({
          teslaMateWebUrl: " https://teslamate.example.test"
        })
      }
    },
    {
      name: "Keychain contains 异常",
      keychainFailures: { contains: true },
      keychainValues: {}
    },
    {
      name: "Keychain get 异常",
      keychainFailures: { get: true },
      keychainValues: { [RUNTIME_CONFIG_KEY]: runtimeConfigJson() }
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
          jsonResponse: apiResponse(carStatus("online")),
          keychainFailures: invalidConfigCase.keychainFailures,
          keychainValues: invalidConfigCase.keychainValues,
          widgetParameter: "1",
          ...widgetContext
        });
        subtest.after(() => {
          // 每次 runtime 使用独立 documents 目录；成功或断言失败后都递归清理。
          fs.rmSync(result.documentsDirectory, { recursive: true, force: true });
        });

        assertMissingConfigWidget(result);
      });
    }
  }
});

test("中号桌面 widget 可以用在线车辆数据完成渲染并写入缓存", async (t) => {
  const result = await runScriptableScript({
    jsonResponse: apiResponse(carStatus("online")),
    keychainValues: { [RUNTIME_CONFIG_KEY]: runtimeConfigJson() },
    runsInWidget: true,
    widgetParameter: "1"
  });
  t.after(() => fs.rmSync(result.documentsDirectory, { recursive: true, force: true }));

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
    jsonResponse: apiResponse(carStatus("online", { display_name: "Sentinel Car 2" })),
    keychainValues: { [RUNTIME_CONFIG_KEY]: runtimeConfigJson() },
    runsInWidget: true,
    widgetParameter: "dark,2"
  });
  t.after(() => fs.rmSync(result.documentsDirectory, { recursive: true, force: true }));

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
  assert.doesNotMatch(source, /^\s*(?:id|carId)\s*=/m);
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

test("中号桌面 widget 地图图片填满右侧容器", async (t) => {
  const result = await runScriptableScript({
    jsonResponse: apiResponse(carStatus("online")),
    keychainValues: { [RUNTIME_CONFIG_KEY]: runtimeConfigJson() },
    runsInWidget: true,
    widgetParameter: "1"
  });
  t.after(() => fs.rmSync(result.documentsDirectory, { recursive: true, force: true }));

  const maps = mapImages(result.widget);
  assert.equal(maps.length, 1);
  assert.deepEqual(maps[0].imageSize, { width: 176, height: 176 });
  assert.equal(maps[0].contentMode, "fill");
  assert.equal(maps[0].cornerRadius, 0);
});

test("充电状态显示充电功率、目标电量，并使用 30 秒刷新窗口", async (t) => {
  const startedAt = Date.now();
  const result = await runScriptableScript({
    jsonResponse: apiResponse(carStatus("charging", {
      battery_details: { battery_level: 42, rated_battery_range: 208.5 },
      charging_details: {
        charge_limit_soc: 90,
        charger_power: 11,
        time_to_full_charge: 1.5
      }
    })),
    keychainValues: { [RUNTIME_CONFIG_KEY]: runtimeConfigJson() },
    runsInWidget: true,
    widgetParameter: "1"
  });
  t.after(() => fs.rmSync(result.documentsDirectory, { recursive: true, force: true }));

  const refreshAt = new Date(result.widget.refreshAfterDate).getTime();
  assert.ok(refreshAt - startedAt >= 29_000);
  assert.ok(refreshAt - startedAt <= 31_500);
  assert.ok(textValues(result.widget).some((text) => text.includes("11kW")));
  assert.ok(textValues(result.widget).some((text) => text.includes("90%")));
});

test("行驶状态使用 10 秒刷新窗口并显示速度", async (t) => {
  const startedAt = Date.now();
  const result = await runScriptableScript({
    jsonResponse: apiResponse(carStatus("driving", {
      driving_details: {
        heading: 180,
        speed: 72
      }
    })),
    keychainValues: { [RUNTIME_CONFIG_KEY]: runtimeConfigJson() },
    runsInWidget: true,
    widgetParameter: "1"
  });
  t.after(() => fs.rmSync(result.documentsDirectory, { recursive: true, force: true }));

  const refreshAt = new Date(result.widget.refreshAfterDate).getTime();
  assert.ok(refreshAt - startedAt >= 9_000);
  assert.ok(refreshAt - startedAt <= 11_500);
  assert.ok(textValues(result.widget).some((text) => text === "72"));
});

test("锁屏 accessory widget 可以完成圆形电量图渲染", async (t) => {
  const result = await runScriptableScript({
    jsonResponse: apiResponse(carStatus("asleep", {
      battery_details: {
        battery_level: 88,
        rated_battery_range: 420.1
      }
    })),
    keychainValues: { [RUNTIME_CONFIG_KEY]: runtimeConfigJson() },
    runsInAccessoryWidget: true,
    widgetFamily: "accessoryCircular",
    widgetParameter: "1"
  });
  t.after(() => fs.rmSync(result.documentsDirectory, { recursive: true, force: true }));

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
    alertResponses: [{ index: 0 }],
    jsonResponse: apiResponse(carStatus("online")),
    keychainValues: { [RUNTIME_CONFIG_KEY]: runtimeConfigJson() },
    runsInApp: true,
    widgetParameter: "1"
  });
  t.after(() => fs.rmSync(result.documentsDirectory, { recursive: true, force: true }));

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
 * 验证已配置 App 菜单可以进入预填表单，并允许用户取消而不改动安全存储。
 *
 * 使用场景：用户只想查看现有配置但不保存。入参为 node:test 上下文；无返回值。
 * 测试精确断言字段顺序、Key 安全输入属性、已标准化初始值和旧 JSON 不变。
 */
test("App 操作菜单选择管理配置时预填安全表单且取消不保存", async (t) => {
  const existingJson = runtimeConfigJson();
  const result = await runScriptableScript({
    alertResponses: [{ index: 1 }, { index: -1 }],
    keychainValues: { [RUNTIME_CONFIG_KEY]: existingJson },
    runsInApp: true
  });
  t.after(() => fs.rmSync(result.documentsDirectory, { recursive: true, force: true }));

  assert.equal(result.alerts[0].presentation, "sheet");
  assert.deepEqual(result.alerts[1], {
    actions: ["保存"],
    cancelAction: "取消",
    message: "配置将保存在 iOS Keychain 中",
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
  assert.equal(result.keychain[RUNTIME_CONFIG_KEY], existingJson);
  assert.equal(result.webViews.length, 0);
});

/**
 * 验证已配置 App 菜单取消后直接结束，不打开页面也不进入配置表单。
 *
 * 使用场景：用户误触运行脚本后关闭操作菜单。入参为 node:test 上下文；无返回值。
 * 测试断言只展示一个 sheet、保留原始 Keychain JSON，并完成 Script 生命周期。
 */
test("App 操作菜单取消时不执行任何动作", async (t) => {
  const existingJson = runtimeConfigJson();
  const result = await runScriptableScript({
    alertResponses: [{ index: -1 }],
    keychainValues: { [RUNTIME_CONFIG_KEY]: existingJson },
    runsInApp: true
  });
  t.after(() => fs.rmSync(result.documentsDirectory, { recursive: true, force: true }));

  assert.equal(result.alerts.length, 1);
  assert.equal(result.alerts[0].presentation, "sheet");
  assert.equal(result.keychain[RUNTIME_CONFIG_KEY], existingJson);
  assert.equal(result.webViews.length, 0);
  assert.equal(result.script.completed, true);
});

/**
 * 验证 App 缺少有效配置时跳过操作菜单，直接展示空白配置表单。
 *
 * 使用场景：首次安装脚本或 Keychain 配置无法读取。入参为 node:test 上下文；无
 * 返回值。测试以取消响应结束，借此断言首个交互是 alert 表单且没有产生写入。
 */
test("App 配置缺失时直接进入空白配置表单", async (t) => {
  const result = await runScriptableScript({
    alertResponses: [{ index: -1 }],
    keychainValues: {},
    runsInApp: true
  });
  t.after(() => fs.rmSync(result.documentsDirectory, { recursive: true, force: true }));

  assert.equal(result.alerts.length, 1);
  assert.equal(result.alerts[0].presentation, "alert");
  assert.deepEqual(result.alerts[0].textFields, [
    { placeholder: "高德 API Key", secure: true, value: "" },
    { placeholder: "TeslaMateApi 基础 URL", value: "" },
    { placeholder: "TeslaMate Web URL", value: "" }
  ]);
  assert.deepEqual(result.keychain, {});
});

/**
 * 验证合法表单输入保存为仅含 schema v1 标准字段的规范 JSON。
 *
 * 使用场景：首次配置时用户输入带首尾空白的 Key 和带尾斜杠的基础 URL。入参为
 * node:test 上下文；无返回值。测试解析最终 Keychain 值并精确断言 trim 与 URL
 * 标准化结果，同时确认成功提示需要独立 Alert 响应。
 */
test("App 配置表单合法保存时写入标准化 JSON 并显示成功提示", async (t) => {
  const result = await runScriptableScript({
    alertResponses: [
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
    keychainValues: {},
    runsInApp: true
  });
  t.after(() => fs.rmSync(result.documentsDirectory, { recursive: true, force: true }));

  assert.deepEqual(JSON.parse(result.keychain[RUNTIME_CONFIG_KEY]), {
    schemaVersion: 1,
    amapApiKey: "saved-amap-key",
    teslaMateApiBaseUrl: "https://api.saved.example.test:8080",
    teslaMateWebUrl: "http://web.saved.example.test"
  });
  assert.deepEqual(result.alerts[1], {
    actions: ["确定"],
    cancelAction: null,
    message: "配置已安全保存",
    presentation: "alert",
    textFields: [],
    title: "保存成功"
  });
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
    keychainValues: {},
    runsInApp: true
  });
  t.after(() => fs.rmSync(result.documentsDirectory, { recursive: true, force: true }));

  assert.deepEqual(result.alerts[1], {
    actions: ["确定"],
    cancelAction: null,
    message: "请检查所有配置项后重试",
    presentation: "alert",
    textFields: [],
    title: "配置无效"
  });
  assert.deepEqual(result.alerts[2].textFields, [
    { placeholder: "高德 API Key", secure: true, value: sensitiveKey },
    { placeholder: "TeslaMateApi 基础 URL", value: invalidApiUrl },
    { placeholder: "TeslaMate Web URL", value: firstWebUrl }
  ]);
  assert.equal(JSON.stringify(result.alerts).includes(sensitiveKey), true);
  assert.equal(result.alerts[1].message.includes(sensitiveKey), false);
  assert.equal(result.alerts[1].message.includes(invalidApiUrl), false);
  assert.equal(result.logs.some((line) =>
    line.includes(sensitiveKey) || line.includes(invalidApiUrl)
  ), false);
  assert.deepEqual(JSON.parse(result.keychain[RUNTIME_CONFIG_KEY]), {
    schemaVersion: 1,
    amapApiKey: "final-key",
    teslaMateApiBaseUrl: "https://api.final.example.test",
    teslaMateWebUrl: "https://web.final.example.test"
  });
});

/**
 * 验证配置表单取消不会创建 Keychain 配置，也不会额外展示消息。
 *
 * 使用场景：首次配置用户暂不保存。入参为 node:test 上下文；无返回值。测试断言
 * 取消后仅保留一次表单交互，且脚本正常完成、WebView 未打开。
 */
test("App 配置表单取消时不写入 Keychain", async (t) => {
  const result = await runScriptableScript({
    alertResponses: [{ index: -1 }],
    keychainValues: {},
    runsInApp: true
  });
  t.after(() => fs.rmSync(result.documentsDirectory, { recursive: true, force: true }));

  assert.equal(result.alerts.length, 1);
  assert.deepEqual(result.keychain, {});
  assert.equal(result.webViews.length, 0);
  assert.equal(result.script.completed, true);
});

/**
 * 验证 Keychain 写入异常显示脱敏失败提示，且原有配置 JSON 保持逐字不变。
 *
 * 使用场景：用户管理配置时 iOS Keychain 暂时不可写。入参为 node:test 上下文；无
 * 返回值。测试给出新的敏感输入但注入 set 异常，随后比较旧值并检查提示与日志均
 * 不包含新旧 Key 或私有 URL。
 */
test("App 配置表单写入失败时显示通用错误且不改变旧值", async (t) => {
  const existingJson = runtimeConfigJson({ amapApiKey: "existing-secret-key" });
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
    keychainFailures: { set: true },
    keychainValues: { [RUNTIME_CONFIG_KEY]: existingJson },
    runsInApp: true
  });
  t.after(() => fs.rmSync(result.documentsDirectory, { recursive: true, force: true }));

  assert.equal(result.keychain[RUNTIME_CONFIG_KEY], existingJson);
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
  t.after(() => {
    // 成功路径可从结果取得目录，测试结束时释放其文件缓存。
    fs.rmSync(result.documentsDirectory, { recursive: true, force: true });
  });

  assert.deepEqual(result.keychain, { added: "new value", existing: "initial" });
});

/**
 * 验证四个 Keychain 操作都能独立注入固定错误。
 *
 * 使用场景：配置读取、保存与清除各自的异常分支回归。入参为 node:test 上下文；
 * 无返回值。任一操作未抛出对应固定错误即使测试失败。
 */
test("Keychain 对四类配置失败操作抛出固定测试错误", async (t) => {
  const documentsDirectory = createRuntimeDocumentsDirectory(t);
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
        keychainFailures: { [failureCase.operation]: true },
        scriptPath: writeRuntimeTestScript(t, failureCase.source)
      }),
      new Error(`Mock Keychain ${failureCase.operation} failed`)
    );
  }
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
  t.after(() => {
    // 越界响应正常被转换为取消后，释放成功运行产生的 documents 目录。
    fs.rmSync(result.documentsDirectory, { recursive: true, force: true });
  });

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
  t.after(() => {
    // 断言展示快照后清理成功运行产生的 documents 目录。
    fs.rmSync(result.documentsDirectory, { recursive: true, force: true });
  });

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
    documentsDirectory,
    failJSON: true,
    keychainValues: { [RUNTIME_CONFIG_KEY]: runtimeConfigJson() },
    runsInWidget: true,
    widgetParameter: "1"
  });

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
    documentsDirectory,
    jsonResponse(request) {
      // 异常显式携带生产请求的完整 URL，确保打印异常对象会被下方 sentinel 断言捕获。
      throw new Error(`sentinel TeslaMate request failed: ${request.url}`);
    },
    keychainValues: { [RUNTIME_CONFIG_KEY]: runtimeConfigJson() },
    runsInWidget: true,
    widgetParameter: "2"
  });

  assert.ok(result.logs.includes("车辆状态请求失败，尝试读取缓存"));
  assert.ok(textValues(result.widget).some((text) => text.includes("Cached Car 2")));
  assertSensitiveValuesAbsent(result, [
    SENTINEL_AMAP_API_KEY,
    `${SENTINEL_API_BASE_URL}/api/v1/cars/2/status`,
    SENTINEL_WEB_URL
  ]);
});

/**
 * 验证高德静态地图失败时使用固定日志和占位图片，不回显请求配置。
 *
 * 使用场景：地图请求 URL 含高德 Key、坐标和完整 query，异常对象不得进入日志。
 * 入参为 node:test 上下文；无返回值。测试确认请求确实使用 sentinel Key，同时日志、
 * Alert 消息及 Widget 文案保持脱敏，渲染生命周期仍正常完成。
 */
test("高德地图图片失败日志不泄露 Key 或完整 URL", async (t) => {
  const result = await runScriptableScript({
    failImages: true,
    jsonResponse: apiResponse(carStatus("online")),
    keychainValues: { [RUNTIME_CONFIG_KEY]: runtimeConfigJson() },
    runsInWidget: true,
    widgetParameter: "1"
  });
  t.after(() => fs.rmSync(result.documentsDirectory, { recursive: true, force: true }));

  const amapRequest = result.requests.find((request) =>
    request.url.startsWith("https://restapi.amap.com/v3/staticmap?")
  );
  assert.ok(amapRequest);
  assert.ok(amapRequest.url.includes(`key=${SENTINEL_AMAP_API_KEY}`));
  assert.ok(result.logs.includes("静态地图加载失败"));
  assert.equal(result.logs.some((line) => line.includes("Mock image request failed")), false);
  assert.equal(result.script.completed, true);
  assertSensitiveValuesAbsent(result, [SENTINEL_AMAP_API_KEY, amapRequest.url]);
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
    jsonResponse: apiResponse(carStatus("online")),
    keychainValues: { [RUNTIME_CONFIG_KEY]: runtimeConfigJson() },
    reverseGeocode: {
      // Promise 同化会调用 then；只触发 reject，精确进入生产脚本的定位异常分支。
      then(resolve, reject) {
        reject(new Error(sentinelGeocodeError));
      }
    },
    runsInWidget: true,
    widgetParameter: "1"
  });
  t.after(() => fs.rmSync(result.documentsDirectory, { recursive: true, force: true }));

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
    documentsDirectory,
    jsonResponse: apiResponse(carStatus("online", { display_name: "Recovered Car 2" })),
    keychainValues: { [RUNTIME_CONFIG_KEY]: runtimeConfigJson() },
    runsInWidget: true,
    widgetParameter: "2"
  });

  assert.ok(result.logs.includes("车辆缓存读取失败"));
  assert.equal(result.logs.some((line) => line.includes("SyntaxError")), false);
  assert.ok(textValues(result.widget).some((text) => text.includes("Recovered Car 2")));
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(cachePath, "utf8")));
  assertSensitiveValuesAbsent(result, [sentinelCorruptCache]);
});

/**
 * 验证 Keychain contains/get/set 三类异常均通过固定提示安全降级。
 *
 * 使用场景：安全存储错误对象可能携带键名或底层上下文。入参为 node:test 上下文；
 * 无返回值。读取异常必须渲染缺失配置 Widget，写入异常必须展示通用失败 Alert；三类
 * 场景共同检查日志、Alert 消息和 Widget 文案不含 sentinel Key 或完整 URL。
 */
test("Keychain contains、get、set 失败不会泄露配置", async (t) => {
  const readFailureCases = [
    { name: "contains", keychainFailures: { contains: true } },
    { name: "get", keychainFailures: { get: true } }
  ];

  // 两种读取 API 失败都由同一个配置门禁处理，但分别运行以证明每个异常点均被覆盖。
  for (const failureCase of readFailureCases) {
    await t.test(failureCase.name, async (subtest) => {
      const result = await runScriptableScript({
        keychainFailures: failureCase.keychainFailures,
        keychainValues: { [RUNTIME_CONFIG_KEY]: runtimeConfigJson() },
        runsInWidget: true,
        widgetParameter: "1"
      });
      subtest.after(() =>
        fs.rmSync(result.documentsDirectory, { recursive: true, force: true })
      );

      assert.deepEqual(result.logs, ["运行配置读取失败"]);
      assertMissingConfigWidget(result);
      assertSensitiveValuesAbsent(result, [
        SENTINEL_AMAP_API_KEY,
        SENTINEL_API_BASE_URL,
        SENTINEL_WEB_URL
      ]);
    });
  }

  await t.test("set", async (subtest) => {
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
      keychainFailures: { set: true },
      keychainValues: { [RUNTIME_CONFIG_KEY]: runtimeConfigJson() },
      runsInApp: true
    });
    subtest.after(() =>
      fs.rmSync(result.documentsDirectory, { recursive: true, force: true })
    );

    assert.equal(result.alerts[2].title, "保存失败");
    assert.equal(result.alerts[2].message, "无法保存配置，请稍后重试");
    assertSensitiveValuesAbsent(result, [
      newSentinelKey,
      newSentinelApiUrl,
      newSentinelWebUrl
    ]);
  });
});
