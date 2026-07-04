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
