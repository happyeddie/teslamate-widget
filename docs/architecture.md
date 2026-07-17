# 项目架构说明

## 文件结构

```text
.
├── AGENTS.md
├── README.md
├── README.zh-CN.md
├── Telsa Car.js
├── docs/
│   ├── architecture.md
│   ├── code-review.md
│   ├── scriptable-capabilities.md
│   ├── testing.md
│   └── *.jpg / *.png
├── package.json
└── tests/
    ├── scriptable-runtime.js
    └── scriptable-widget.test.js
```

## 运行入口

`Telsa Car.js` 是唯一 Scriptable 入口。它按运行上下文分成三条路径：

1. App 内运行：先读取 Keychain。配置缺失时直接打开配置表单；配置完整时显示“打开 TeslaMate / 管理配置”菜单。
2. 锁屏 accessory widget：先执行配置门禁；配置有效时拉取或读取缓存车辆数据并绘制圆形电量图，配置无效时只显示配置提示。
3. 桌面 widget：先执行配置门禁；配置有效时拉取车辆状态、地理编码和地图并构建中号 widget，配置无效时只显示配置提示。

项目继续采用单文件分发，用户只需安装并在 Scriptable App 内运行 `Telsa Car.js` 完成配置。仓库源码和 iCloud 运行文件保持字节一致，均不保存凭据。脚本内部按职责划分为命名函数：

- `main()`：先加载运行配置，再根据 Scriptable 运行上下文分发执行路径。
- `validateRuntimeConfig()`：验证 schema v1 配置并标准化两个 HTTP(S) 基础 URL。
- `loadRuntimeConfig()` / `saveRuntimeConfig()`：通过固定 Keychain 键读写版本化配置，并对异常进行脱敏降级。
- `presentAppMenu()` / `presentConfigForm()`：在 App 内展示操作菜单和安全配置表单。
- `renderMissingConfigWidget()`：配置不可用时提交无网络、无缓存副作用的提示 Widget。
- `createRuntimeContext()`：配置门禁通过后才创建缓存目录和正常 Widget。
- `openTeslaMateWebView()`：使用显式运行配置处理 App 内 TeslaMate 页面展示。
- `loadCarDataWithCache()`：统一处理 TeslaMateApi 请求和车辆缓存回退。
- `loadCarContext()`：组合车辆数据、历史坐标、刷新时间、地理信息和地图。
- `renderAccessoryWidget()`：绘制并提交锁屏圆形 Widget。
- `renderMediumWidget()`：组织中号 Widget，并分别调用车辆、电池、充电、控制状态、位置和地图渲染函数。

这种结构不依赖 `importModule()` 或构建流程，保持单文件安装体验，同时避免运行分支、缓存逻辑和 UI 绘制继续堆叠在顶层作用域。

## 数据流

```mermaid
flowchart TD
  A["Scriptable 运行脚本"] --> B["从 Keychain 读取并验证 schema v1 配置"]
  B --> C{"配置有效？"}
  C -->|"否，App"| D["Alert 配置表单"]
  C -->|"否，Widget"| E["显示配置提示并结束"]
  D --> F["验证并保存到 Keychain"]
  C -->|"是"| G{"运行上下文"}
  G -->|"runsInApp"| H["操作菜单：打开 TeslaMate / 管理配置"]
  G -->|"runsInAccessoryWidget"| I["读取 TeslaMateApi 或车辆缓存"]
  G -->|"默认 widget"| J["读取 TeslaMateApi 或车辆缓存"]
  H --> K["按选择打开 WebView 或配置表单"]
  J --> L["Location.reverseGeocode 获取地名"]
  J --> M["Amap 静态地图"]
  L --> N["写入 tesla/ 地理缓存"]
  M --> O["写入 tesla/ 地图缓存"]
  I --> P["DrawContext 绘制锁屏电量"]
  J --> Q["ListWidget 构建中号桌面 widget"]
  P --> R["Script.setWidget"]
  Q --> R
```

## 配置项

配置不写入源码。用户首次在 Scriptable App 内运行脚本时，通过 `Alert` 表单填写以下内容：

| 字段 | 含义 |
| --- | --- |
| `amapApiKey` | 高德静态地图 Web 服务 API Key |
| `teslaMateApiBaseUrl` | TeslaMateApi 基础地址；不含 `/api/v1/cars/<carId>/status`，不含 query/hash，保存时去除末尾 `/` |
| `teslaMateWebUrl` | TeslaMate Web 基础地址；不含 query/hash，保存时去除末尾 `/` |

三项内容与 `schemaVersion: 1` 一起序列化到固定 Keychain 键 `teslamate-widget.config.v1`。读取后必须再次验证；键缺失、JSON 损坏、版本或字段非法、Keychain API 异常均按配置不可用处理。Widget 路径不会弹窗，也不会在配置门禁失败前创建缓存目录或网络请求。日志、提示和测试输出不得包含 Key、完整私有 URL 或原始异常对象。

Keychain 属于设备侧安全存储。不同设备或重新安装、迁移 Scriptable 后，用户可能需要分别运行脚本完成配置。修改配置只能从 Scriptable App 内的“管理配置”入口进行。

车辆 ID 不属于安全配置，继续从 `args.widgetParameter` 中读取；未提供有效数字时默认使用 `1`。支持示例：

- `1`：使用车辆 ID 1。
- `dark,1`：保留 dark 标记，同时使用车辆 ID 1。
- `1,dark`：同上。

## TeslaMateApi 数据契约

脚本期望接口返回：

```json
{
  "data": {
    "status": {
      "display_name": "Model Y",
      "state": "online",
      "state_since": "2026-07-04T08:00:00.000Z",
      "battery_details": {
        "battery_level": 67,
        "rated_battery_range": 331.2
      },
      "car_geodata": {
        "latitude": 31.2304,
        "longitude": 121.4737
      },
      "car_status": {
        "locked": true,
        "is_user_present": false,
        "windows_open": false,
        "doors_open": false,
        "sentry_mode": false
      },
      "charging_details": {
        "charge_limit_soc": 80,
        "charger_power": 0,
        "time_to_full_charge": 0
      },
      "climate_details": {
        "is_climate_on": false
      },
      "driving_details": {
        "heading": 92,
        "speed": 0
      },
      "car_versions": {
        "update_available": false
      },
      "tpms_details": {
        "tpms_pressure_fl": 2.6,
        "tpms_pressure_fr": 2.6,
        "tpms_pressure_rl": 2.6,
        "tpms_pressure_rr": 2.6
      }
    }
  }
}
```

## 缓存策略

- `car_data_<carId>.json`：TeslaMateApi 最近一次成功响应。
- `car_map_<carId>.json`：反向地理编码结果。
- `car_map_<carId>.png`：静态地图图片。

当 TeslaMateApi 请求失败时，脚本会尝试读取 `car_data_<carId>.json`。如果首跑没有缓存，脚本应继续抛出真实错误，避免显示伪数据。

## 本地测试架构

`tests/scriptable-runtime.js` 在 Node 中提供 Scriptable API stub：

- `FileManager` 映射到临时目录。
- `Request` 返回测试注入的 TeslaMate 响应和假图片。
- `Keychain` 提供每次运行隔离的内存存储和读写故障注入。
- `Alert` 严格消费测试编排的表单、菜单与提示响应，并记录安全字段属性。
- `ListWidget` / `WidgetStack` 记录 widget 树。
- `DrawContext` 记录绘图操作并返回假图片对象。
- `WebView` 记录打开 URL 和注入的 JavaScript。

这套机制用于证明脚本主要分支能执行、缓存可写入、关键文字和刷新时间符合预期。
