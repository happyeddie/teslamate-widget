const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { collectByType, runScriptableScript } = require("./scriptable-runtime");

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
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return scriptPath;
}

test("中号桌面 widget 可以用在线车辆数据完成渲染并写入缓存", async (t) => {
  const result = await runScriptableScript({
    jsonResponse: apiResponse(carStatus("online")),
    runsInWidget: true,
    widgetParameter: "1"
  });
  t.after(() => fs.rmSync(result.documentsDirectory, { recursive: true, force: true }));

  assert.equal(result.script.completed, true);
  assert.equal(result.widget.presented, "medium");
  assert.ok(textValues(result.widget).some((text) => text.includes("Model Y")));
  assert.ok(textValues(result.widget).some((text) => text.includes("331")));
  assert.ok(result.requests.some((request) => request.url.includes("/api/v1/cars/1/status")));
  assert.ok(fs.existsSync(path.join(result.documentsDirectory, "tesla", "car_data_1.json")));
});

test("中号桌面 widget 地图图片填满右侧容器", async (t) => {
  const result = await runScriptableScript({
    jsonResponse: apiResponse(carStatus("online")),
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
    runsInApp: true,
    widgetParameter: "1"
  });
  t.after(() => fs.rmSync(result.documentsDirectory, { recursive: true, force: true }));

  assert.equal(result.webViews.length, 1);
  assert.equal(result.webViews[0].loadedURL, "http(s)://[TeslaMate URL]");
  assert.equal(result.webViews[0].presented, true);
  assert.equal(result.webViews[0].evaluatedJavaScript.length, 3);
  assert.ok(result.webViews[0].evaluatedJavaScript[0].includes("#car_2"));
});

test("App 配置场景暴露隔离的 Keychain 与 Alert 观测结果", async (t) => {
  const result = await runScriptableScript({
    alertResponses: [{ index: -1 }],
    keychainValues: {},
    runsInApp: true
  });
  t.after(() => fs.rmSync(result.documentsDirectory, { recursive: true, force: true }));

  assert.deepEqual(result.alerts, []);
  assert.deepEqual(result.keychain, {});
});

test("Keychain 在单次 runtime 内保存变更并返回最终克隆", async (t) => {
  const result = await runScriptableScript({
    keychainValues: { existing: "initial", removeMe: "discard" },
    scriptPath: writeRuntimeTestScript(t, `
      if (!Keychain.contains("existing")) throw new Error("existing key is unavailable");
      if (Keychain.get("existing") !== "initial") throw new Error("unexpected existing value");
      Keychain.set("added", "new value");
      Keychain.remove("removeMe");
      Script.complete();
    `)
  });
  t.after(() => fs.rmSync(result.documentsDirectory, { recursive: true, force: true }));

  assert.deepEqual(result.keychain, { added: "new value", existing: "initial" });
});

test("Keychain 对配置的失败操作抛出固定测试错误", async (t) => {
  const scriptPath = writeRuntimeTestScript(t, `
    Keychain.set("configured", "value");
    Script.complete();
  `);

  await assert.rejects(
    runScriptableScript({
      keychainFailures: { set: true },
      scriptPath
    }),
    new Error("Mock Keychain set failed")
  );
});

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
      if (await setup.presentAlert() !== 0) throw new Error("unexpected setup response");
      if (setup.textFieldValue(0) !== "fake-amap-key") throw new Error("unexpected text field value");

      const confirmation = new Alert();
      confirmation.title = "保存成功";
      confirmation.addAction("确定");
      if (await confirmation.presentSheet() !== -1) throw new Error("unexpected cancellation response");
      Script.complete();
    `)
  });
  t.after(() => fs.rmSync(result.documentsDirectory, { recursive: true, force: true }));

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

test("Alert 响应不足时明确报错，避免静默选择默认动作", async (t) => {
  await assert.rejects(
    runScriptableScript({
      scriptPath: writeRuntimeTestScript(t, `
        const alert = new Alert();
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
    runsInWidget: true,
    widgetParameter: "1"
  });

  assert.equal(result.script.completed, true);
  assert.equal(result.widget.presented, "medium");
  assert.ok(textValues(result.widget).some((text) => text.includes("Model Y")));
});
