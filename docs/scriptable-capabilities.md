# Scriptable 能力与开发依据

本文档整理 Scriptable 作为本项目基座的能力边界。后续 AI 修改 `Telsa Car.js` 前应先阅读本文件。

## 官方依据

- 官方文档首页：https://docs.scriptable.app/
- 官方产品页：https://scriptable.app/
- `config` 运行上下文：https://docs.scriptable.app/config/
- `ListWidget` widget API：https://docs.scriptable.app/listwidget/
- `Script` 生命周期：https://docs.scriptable.app/script/
- `FileManager` 文件系统：https://docs.scriptable.app/filemanager/
- `Keychain` 凭据安全存储：https://docs.scriptable.app/keychain/
- `Alert` 原生弹窗、表单和 Action Sheet：https://docs.scriptable.app/alert/
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
- `Keychain.set()` 只接受字符串值，并将其存入加密数据库；`Keychain.get()` 在键不存在时会抛错，因此读取前必须调用 `Keychain.contains()`，同时仍需捕获系统异常。
- `Alert` 文本框只能用于 alert 展示，不能用于 action sheet；取消动作统一返回 `-1`。Widget 刷新不应展示交互式 Alert，配置表单只在 `config.runsInApp` 路径使用。

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
| `config.runsInApp` | App 内配置管理或打开 TeslaMate WebView | `Telsa Car.js:1231` |
| `config.runsInAccessoryWidget` | 锁屏 widget 分支 | `Telsa Car.js:1237` |
| `Keychain.contains()` / `get()` / `set()` | 读取和保存单个版本化运行配置 | `Telsa Car.js:185`, `Telsa Car.js:220` |
| `Alert` | App 内操作菜单、安全配置表单和状态提示 | `Telsa Car.js:238`, `Telsa Car.js:274`, `Telsa Car.js:398` |
| `FileManager.local()` | 配置门禁通过后缓存车辆数据、地图和地理编码 | `Telsa Car.js:323` |
| `Request.loadJSON()` | 拉取 TeslaMateApi 车辆状态 | `Telsa Car.js:539` |
| `Request.loadImage()` | 拉取高德静态地图 | `Telsa Car.js:639` |
| `Location.reverseGeocode()` | 车辆坐标反向地理编码 | `Telsa Car.js:603` |
| `ListWidget` / `WidgetStack` | 构建配置提示、桌面和锁屏 widget | `Telsa Car.js:329`, `Telsa Car.js:342` |
| `DrawContext` / `Path` | 绘制电池、圆形电量、地图方向箭头 | `Telsa Car.js:436`, `Telsa Car.js:943`, `Telsa Car.js:1160` |
| `SFSymbol` | 显示车辆状态、锁、车窗、空调等图标 | `Telsa Car.js:827`, `Telsa Car.js:846`, `Telsa Car.js:1064` |
| `Script.setWidget()` / `Script.complete()` | 向系统提交 widget 并结束脚本 | `Telsa Car.js:347`, `Telsa Car.js:472` |
| `WebView` | App 内展示 TeslaMate 原页面 | `Telsa Car.js:369` |

## 对开发的直接约束

- Widget 代码应优先减少网络请求和大图内存占用，地图和车辆数据必须保留缓存回退路径。
- 所有 `SFSymbol.named()` 理论上可能返回 `null`，新增图标时需要考虑老 iOS 或 SF Symbols 不支持的情况。
- 新增文件读写必须使用 `FileManager.joinPath()` 生成路径，避免手写路径分隔符。
- 使用 WebView 注入网页脚本时，要记住这段代码运行在 TeslaMate 页面里，不在 Scriptable 主运行时里。
- 私人配置只允许进入 Scriptable Keychain；仓库源码、iCloud 脚本文本、日志、Widget 文案和测试产物都不得保存或回显 Key、完整私有 URL 或原始异常对象。
- 任何网络、文件缓存或正常 Widget 初始化都必须位于配置门禁之后；配置缺失时 App 可展示 Alert，Widget 只能渲染静态提示并结束。
- 自动测试只能证明脚本逻辑和 widget 树结构可执行，不能证明 iOS 原生渲染像素完全一致；最终视觉必须使用真实运行截图脚本确认。
