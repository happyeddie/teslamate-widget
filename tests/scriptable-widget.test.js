const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { collectByType, runScriptableScript } = require("./scriptable-runtime");

const RUNTIME_CONFIG_KEY = "teslamate-widget.config.v1";

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
    amapApiKey: "test-amap-key",
    teslaMateApiBaseUrl: "https://teslamate-api.example.test///",
    teslaMateWebUrl: "https://teslamate.example.test///",
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
    request.url === "https://teslamate-api.example.test/api/v1/cars/1/status"
  ));
  assert.ok(fs.existsSync(path.join(result.documentsDirectory, "tesla", "car_data_1.json")));
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

test("App 内运行时打开 TeslaMate WebView 并隐藏非当前车辆卡片", async (t) => {
  const result = await runScriptableScript({
    jsonResponse: apiResponse(carStatus("online")),
    keychainValues: { [RUNTIME_CONFIG_KEY]: runtimeConfigJson() },
    runsInApp: true,
    widgetParameter: "1"
  });
  t.after(() => fs.rmSync(result.documentsDirectory, { recursive: true, force: true }));

  assert.equal(result.webViews.length, 1);
  assert.equal(result.webViews[0].loadedURL, "https://teslamate.example.test");
  assert.equal(result.webViews[0].presented, true);
  assert.equal(result.webViews[0].evaluatedJavaScript.length, 3);
  assert.ok(result.webViews[0].evaluatedJavaScript[0].includes("#car_2"));
});

/**
 * 验证 App 配置路径始终返回可观察的 Keychain 与 Alert 空状态。
 *
 * 使用场景：生产脚本尚未触发配置弹窗时，测试仍能读取 runtime 的稳定结果结构。
 * 入参为 node:test 上下文；无返回值。运行或断言异常由测试框架报告。
 */
test("App 配置场景暴露隔离的 Keychain 与 Alert 观测结果", async (t) => {
  const result = await runScriptableScript({
    alertResponses: [{ index: -1 }],
    keychainValues: {},
    runsInApp: true
  });
  t.after(() => {
    // 当前 App 路径未消费响应，仍需清理本次 runtime 的默认 documents 目录。
    fs.rmSync(result.documentsDirectory, { recursive: true, force: true });
  });

  assert.deepEqual(result.alerts, []);
  assert.deepEqual(result.keychain, {});
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
