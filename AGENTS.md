# 项目开发约定

## 文档与注释

- 默认 README 使用纯英文；中文用户文档维护在 `README.zh-CN.md`。
- 代码注释应覆盖方法职责、使用场景和非直观的业务规则；避免只复述显而易见的语句。

## 项目定位

- 这是一个基于 [Scriptable](https://scriptable.app/) 的 TeslaMate 小组件脚本项目。
- 运行入口是仓库根目录的 `Telsa Car.js`，文件名当前保持历史拼写，不要在未同步安装说明和用户设备脚本名的情况下重命名。
- `README.md` 是默认英文用户文档，`README.zh-CN.md` 是简体中文用户文档，`docs/` 存放 README 使用的截图和项目说明。
- 脚本依赖 iOS Scriptable 桥接 API，不能直接当作普通浏览器或 Node 脚本运行。

## 关键运行环境

- Scriptable 使用 JavaScriptCore，官方文档说明支持 ECMAScript 6；不要默认使用需要 Babel 或 bundler 的语法。
- 脚本依赖 `args`、`config`、`ListWidget`、`FileManager`、`Request`、`WebView`、`DrawContext`、`SFSymbol`、`Location`、`Script`、`Color`、`Font`、`Image`、`Data`、`Size`、`Rect`、`Point`、`Path` 等 Scriptable 全局 API。
- 不要引入 Node-only API、浏览器 DOM API、bundler、import/module 语法，除非项目明确迁移运行方式。
- 脚本会在三类上下文运行：
  - `config.runsInApp`：配置缺失时先显示“重试同步 / 创建新配置 / 取消”，仅在用户选择创建后进入配置表单；旧设备显示迁移确认；已配置 Widget 保留 Scriptable 原生点击运行，通过非空 `args.widgetParameter` 直接打开 WebView，并在关闭后触发原生刷新，已归档的旧 URL 快照继续兼容查询动作；手动在 App 内运行已配置脚本时仍显示“打开 TeslaMate / 管理配置”菜单。
  - `config.runsInAccessoryWidget`：渲染锁屏圆形电量 widget。
  - 其他 widget 场景：渲染中号桌面 widget。
- Scriptable widget 刷新频率由 iOS 决定，`refreshAfterDate` 只是最早刷新时间，不保证准点刷新。

## 配置与数据

- 日常运行配置的唯一来源是 Scriptable iCloud documents 下的 `teslamate/config.v1.json`。
- 保存事务只允许临时创建同目录 `config.v1.pending.json` 和 `config.v1.backup.json`；三个固定文件是 Scriptable documents 凭据禁令的唯一例外。
- 旧 Keychain 键 `teslamate-widget.config.v1` 只允许在 App 内执行一次性迁移；Widget 永不访问，迁移成功后删除，失败时不作为运行回退。
- 仓库脚本与 iCloud `Tesla Widget.js` 仍必须字节一致，且不得包含任何个人凭据；同步脚本不得读取、覆盖或输出 `teslamate/` 配置目录内容。
- 外部服务包括 TeslaMateApi、TeslaMate Web UI、高德静态地图 API，以及 Scriptable/iOS `Location.reverseGeocode()`。
- `args.widgetParameter` 支持传入车 ID 和主题标记，例如 `1`、`dark,1` 或 `1,dark`。
- 缓存目录是 Scriptable documents 下的 `tesla/`：
  - `car_data_<carId>.json`
  - `car_map_<carId>.json`
  - `car_map_<carId>.png`

## 本地测试

- 本地测试通过 Node 的 Scriptable runtime stub 执行原始脚本，不会访问真实 TeslaMate、Amap 或 Apple 定位服务。
- 每次代码完成后的验收必须重新运行测试。
- 视觉验收必须使用真实运行截图脚本，不能使用模拟生成图或手工拼图替代真实效果。
- 视觉验收不能用激活 App、显示桌面或移动窗口的方式打扰用户工作。
- 本地验收产物默认生成到 `test-results/`，该目录不提交到 git。
- 普通 `node --check "Telsa Car.js"` 不适合作为验收方式；Scriptable 脚本包含 Node CommonJS 语法检查无法接受的顶层 `await` 和运行分支。
- 运行全部测试：

```bash
npm test
```

- 运行 Scriptable widget 测试：

```bash
npm run test:scriptable
```

- 用户明确允许真实 macOS WidgetKit 截图时，生成真实运行截图：

```bash
npm run capture:widget
```

- 用户明确允许真实彩色截图时，临时切换 widget 外观后生成彩色运行截图：

```bash
npm run capture:widget:color
```

- 用户明确要求验证 iPhone 负一屏真实效果时，抓取 USB 真机当前屏幕：

```bash
npm run capture:iphone
```

- 如果用户不想开启 iPhone Developer Mode，但已打开 iPhone Mirroring，优先抓取镜像窗口：

```bash
npm run capture:iphone:mirror
```

- 只需要 iPhone 负一屏中的 TeslaMate widget 本身时，裁剪镜像中的 widget：

```bash
npm run capture:iphone:mirror:widget
```

## 部署到 Scriptable iCloud

- macOS 上的 Scriptable iCloud documents 目录使用与用户无关的路径表示：`$HOME/Library/Mobile Documents/iCloud~dk~simonbs~Scriptable/Documents`。
- 仓库源文件是 `Telsa Car.js`，运行文件固定部署为上述目录中的 `Tesla Widget.js`；两个文件名的差异是历史兼容约定，不要擅自重命名。
- 部署前必须运行完整测试；测试通过后，使用完整文件覆盖更新运行脚本，不得保留或拼接旧脚本中的配置行：

```bash
npm test
SCRIPTABLE_DOCUMENTS="$HOME/Library/Mobile Documents/iCloud~dk~simonbs~Scriptable/Documents"
cp "Telsa Car.js" "$SCRIPTABLE_DOCUMENTS/Tesla Widget.js"
```

- 部署后必须校验仓库源文件与 iCloud 运行文件字节一致，并记录 SHA-256 校验结果：

```bash
SCRIPTABLE_DOCUMENTS="$HOME/Library/Mobile Documents/iCloud~dk~simonbs~Scriptable/Documents"
cmp -s "Telsa Car.js" "$SCRIPTABLE_DOCUMENTS/Tesla Widget.js"
shasum -a 256 "Telsa Car.js" "$SCRIPTABLE_DOCUMENTS/Tesla Widget.js"
```

- 部署只允许覆盖 `Tesla Widget.js`。不得读取、列出、复制、覆盖或输出同级 `teslamate/` 配置目录及其内容，也不得触碰 `tesla/` 车辆缓存目录。
- 文件写入完成仅表示已更新本机 iCloud Drive；跨设备到达时间由 iCloud 决定，脚本和部署流程不得宣称已经完成上传或同步。

## 修改原则

- 修改 UI 前先看 `docs/scriptable-capabilities.md` 和 `docs/architecture.md`。
- 新增 Scriptable API 用法时，同步扩展 `tests/scriptable-runtime.js` 的 stub，并增加测试覆盖。
- 配置读取、网络请求、缓存初始化都必须通过运行配置门禁；Widget 遇到任何非 `ready` 状态只显示静态 iCloud 同步提示，且不得下载 iCloud 文件、读取旧 Keychain、发起 Request 或初始化车辆缓存。App 才可下载、恢复、迁移或展示配置表单。
- 不要把真实车辆接口地址、Amap Key、VIN、坐标、token、截图中的隐私位置写入仓库、iCloud 脚本文本、日志、测试产物或提交历史。
- 代码完成、测试通过后，将仓库脚本完整覆盖同步到 iCloud `Tesla Widget.js`，并校验两者 SHA-256 一致；不得通过保留旧脚本配置行的方式同步。
- README 截图应保持体积合理，并与 README 内容相关。
- 不要主动 push。

## Git 协作

- 开始和结束前检查 `git status --short --branch`。
- 避免使用 `ls -R` 或 `grep -R` 做大范围扫描，优先使用 `rg`、`find` 或有目标的命令。
- 提交应聚焦，并遵循标准 git commit 规范。
