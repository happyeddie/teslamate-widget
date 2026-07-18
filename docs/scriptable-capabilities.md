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
- 目标 iCloud 配置架构将使用 `FileManager.iCloud()` 获取 Scriptable iCloud documents 文件管理器；iCloud 文件可能仅有元数据而未下载，后续实现访问内容前需按运行上下文处理下载状态。
- 目标 iCloud 配置架构将由 App 使用 `downloadFileFromiCloud(path)` 等待指定文件下载完成；后续 Widget 实现不得调用，避免长时间等待占用执行预算。
- 目标 iCloud 配置架构将由 Widget 使用 `isFileDownloaded(path)` 判断正式配置是否已有本地内容；后续实现未下载时必须安全降级为 `unavailable`。
- 目标 iCloud 配置架构将使用 `move(source, destination)` 与 `remove(path)` 完成同一配置目录内的 pending/backup 保存事务与恢复；后续实现中移动和最终校验失败时只能恢复本次事务创建的 backup，并尽力清理 pending。
- 当前代码的 `Keychain.set()` 只接受字符串值，并将其存入加密数据库。目标 iCloud 配置架构实施后，Keychain 仅用于 App 一次性迁移旧配置 `teslamate-widget.config.v1` 的 `contains()`、`get()` 与迁移成功后的 `remove()`，Widget 永不访问 Keychain。
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

## 当前实现与目标 iCloud 架构 API

| 能力 | 当前用途或目标设计约定 | 当前代码位置或后续实现位置 |
| --- | --- | --- |
| `args.widgetParameter` | 解析车 ID 和主题参数 | `Telsa Car.js:4` |
| `config.runsInApp` | `main()` 中：配置缺失时进入表单；已配置时显示菜单，按用户选择管理配置或打开 TeslaMate WebView | `main()` 的 App 配置门禁与 App 菜单分支 |
| `config.runsInAccessoryWidget` | `main()` 中：通过配置门禁后进入锁屏 accessory widget 渲染分支 | `main()` 的 accessory 分支 |
| `FileManager.iCloud()` | 目标架构：构造 `teslamate/config.v1.json` 及同目录 pending/backup 配置工件路径 | 后续 `loadRuntimeConfig()` / `saveRuntimeConfig()` 实现位置 |
| `FileManager.isFileDownloaded()` | 目标架构：Widget 判断正式 iCloud 配置是否可本地读取；未下载即返回 `unavailable` | 后续 `loadRuntimeConfig()` 的 Widget 配置门禁 |
| `FileManager.downloadFileFromiCloud()` | 目标架构：App 下载正式或待恢复备份配置后再读取验证 | 后续 `loadRuntimeConfig()` 的 App 配置门禁与恢复分支 |
| `FileManager.move()` / `remove()` | 目标架构：App 保存时完成 pending、正式与 backup 的事务替换、恢复和清理 | 后续 `saveRuntimeConfig()` 实现位置 |
| `Keychain.contains()` / `get()` / `remove()` | 当前代码读取日常配置；目标架构实施后仅 App 在 iCloud 正式与备份文件均不存在时读取一次性旧配置，迁移校验成功后删除 | 当前 `Telsa Car.js:185`, `Telsa Car.js:220`；后续 `loadRuntimeConfig()` / `migrateLegacyConfig()` |
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
- 私人配置只允许进入 Scriptable iCloud documents 的 `teslamate/config.v1.json`；保存事务期间，同目录 `config.v1.pending.json` 与 `config.v1.backup.json` 是唯一允许的临时凭据工件。仓库源码、iCloud 脚本文本、日志、Widget 文案和测试产物都不得保存或回显 Key、完整私有 URL、配置正文或原始异常对象。
- iCloud 配置文件依赖 iCloud 的传输与存储加密；开启 iCloud 高级数据保护后，iCloud Drive 使用端到端加密，但同一 Apple Account 的受信任设备与可访问 Scriptable iCloud 目录的脚本仍能读取明文。本项目不把密钥与密文一起写入 iCloud，也不提供无实际安全价值的应用层混淆。
- 任何网络、车辆缓存或正常 Widget 初始化都必须位于 `ready` 配置门禁之后；任何非 `ready` Widget 只渲染静态“等待 iCloud 配置同步，请在 Scriptable 中运行脚本检查配置”提示，不下载 iCloud 文件、不读取 Keychain、不发起 Request、不创建车辆缓存。App 才可展示 Alert、下载、恢复、迁移或经用户确认创建/修复配置。
- 自动测试只能证明脚本逻辑和 widget 树结构可执行，不能证明 iOS 原生渲染像素完全一致；最终视觉必须使用真实运行截图脚本确认。
