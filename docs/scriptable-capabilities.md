# Scriptable 能力与开发依据

本文档整理 Scriptable 作为本项目基座的能力边界。后续 AI 修改 `Telsa Car.js` 前应先阅读本文件。

## 官方依据

- 官方文档首页：https://docs.scriptable.app/
- 官方产品页：https://scriptable.app/
- `config` 运行上下文：https://docs.scriptable.app/config/
- `ListWidget` widget API：https://docs.scriptable.app/listwidget/
- `Script` 生命周期：https://docs.scriptable.app/script/
- `FileManager` 文件系统：https://docs.scriptable.app/filemanager/
- `Request` HTTP 请求：https://docs.scriptable.app/request/
- `Location` 定位与反向地理编码：https://docs.scriptable.app/location/
- `DrawContext` 绘图：https://docs.scriptable.app/drawcontext/
- `SFSymbol` 系统图标：https://docs.scriptable.app/sfsymbol/
- `WidgetStack` 布局容器：https://docs.scriptable.app/widgetstack/
- `WidgetImage` 图片元素：https://docs.scriptable.app/widgetimage/

## 运行时边界

- Scriptable 使用 Apple JavaScriptCore，官方文档说明支持 ECMAScript 6。
- Scriptable 不是浏览器环境，普通脚本中没有 `document` 等 DOM 对象；只有 `WebView.evaluateJavaScript()` 内部执行的字符串才运行在网页上下文。
- iOS widget 存在内存限制；官方 `ListWidget` 文档明确提示使用过多内存会导致 widget 崩溃或无法正确渲染。
- `ListWidget.refreshAfterDate` 表示最早可刷新时间，不保证 iOS 会在该时间点刷新。
- 锁屏 accessory widget 从 iOS 16 开始可用，`config.widgetFamily` 可能是 `accessoryCircular`、`accessoryInline`、`accessoryRectangular` 等。

## 官方 API 能力总览

按官方文档索引，Scriptable 暴露的主要能力包括：

- 基础输入与运行上下文：`args`、`config`、`console`、`module`、`importModule`、`Script`。
- UI 与交互：`Alert`、`DatePicker`、`DocumentPicker`、`QuickLook`、`ShareSheet`、`UITable`、`UITableCell`、`UITableRow`、`WebView`。
- Widget：`ListWidget`、`WidgetStack`、`WidgetText`、`WidgetImage`、`WidgetDate`、`WidgetSpacer`。
- 绘图与视觉：`Color`、`Font`、`Image`、`Data`、`DrawContext`、`LinearGradient`、`Path`、`Point`、`Rect`、`Size`、`SFSymbol`。
- 文件与数据：`FileManager`、`Keychain`、`Pasteboard`、`Request`、`XMLParser`、`UUID`。
- iOS 系统服务：`Calendar`、`CalendarEvent`、`Reminder`、`Contact`、`ContactsContainer`、`ContactsGroup`、`Location`、`Notification`、`Photos`、`Safari`、`Speech`、`Dictation`、`Device`、`Timer`。
- 集成入口：`CallbackURL`、`URLScheme`、Siri Shortcuts、Share Sheet Extension、x-callback-url。

## 本项目实际使用的 API

| 能力 | 当前用途 | 代码位置 |
| --- | --- | --- |
| `args.widgetParameter` | 解析车 ID 和主题参数 | `Telsa Car.js:4` |
| `config.runsInApp` | App 内打开 TeslaMate WebView | `Telsa Car.js:35` |
| `config.runsInAccessoryWidget` | 锁屏 widget 分支 | `Telsa Car.js:56` |
| `FileManager.local()` | 本地缓存车辆数据、地图和地理编码 | `Telsa Car.js:26` |
| `Request.loadJSON()` | 拉取 TeslaMateApi 车辆状态 | `Telsa Car.js:184` |
| `Request.loadImage()` | 拉取高德静态地图 | `Telsa Car.js:246` |
| `Location.reverseGeocode()` | 车辆坐标反向地理编码 | `Telsa Car.js:217` |
| `ListWidget` / `WidgetStack` | 构建桌面和锁屏 widget | `Telsa Car.js:32`, `Telsa Car.js:361` |
| `DrawContext` / `Path` | 绘制电池、圆形电量、地图方向箭头 | `Telsa Car.js:77`, `Telsa Car.js:512`, `Telsa Car.js:720` |
| `SFSymbol` | 显示车辆状态、锁、车窗、空调等图标 | `Telsa Car.js:403`, `Telsa Car.js:421`, `Telsa Car.js:432` |
| `Script.setWidget()` / `Script.complete()` | 向系统提交 widget 并结束脚本 | `Telsa Car.js:123`, `Telsa Car.js:767` |
| `WebView` | App 内展示 TeslaMate 原页面 | `Telsa Car.js:37` |

## 对开发的直接约束

- Widget 代码应优先减少网络请求和大图内存占用，地图和车辆数据必须保留缓存回退路径。
- 所有 `SFSymbol.named()` 理论上可能返回 `null`，新增图标时需要考虑老 iOS 或 SF Symbols 不支持的情况。
- 新增文件读写必须使用 `FileManager.joinPath()` 生成路径，避免手写路径分隔符。
- 使用 WebView 注入网页脚本时，要记住这段代码运行在 TeslaMate 页面里，不在 Scriptable 主运行时里。
- 自动测试只能证明脚本逻辑和 widget 树结构可执行，不能证明 iOS 原生渲染像素完全一致；最终视觉必须使用真实运行截图脚本确认。
