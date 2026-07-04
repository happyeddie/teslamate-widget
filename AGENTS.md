# AI 开发约定

## 工作语言

- 与用户沟通、文档、审查结论和提交信息默认使用中文。
- README 面向用户的内容默认使用简体中文。
- 代码注释只在能降低理解成本时添加，避免解释显而易见的语句。

## 项目定位

- 这是一个基于 [Scriptable](https://scriptable.app/) 的 TeslaMate 小组件脚本项目。
- 运行入口是仓库根目录的 `Telsa Car.js`，文件名当前保持历史拼写，不要在未同步安装说明和用户设备脚本名的情况下重命名。
- `README.md` 是中文用户文档，`docs/` 存放 README 使用的截图和项目说明。
- 脚本依赖 iOS Scriptable 桥接 API，不能直接当作普通浏览器或 Node 脚本运行。

## 关键运行环境

- Scriptable 使用 JavaScriptCore，官方文档说明支持 ECMAScript 6；不要默认使用需要 Babel 或 bundler 的语法。
- 脚本依赖 `args`、`config`、`ListWidget`、`FileManager`、`Request`、`WebView`、`DrawContext`、`SFSymbol`、`Location`、`Script`、`Color`、`Font`、`Image`、`Data`、`Size`、`Rect`、`Point`、`Path` 等 Scriptable 全局 API。
- 不要引入 Node-only API、浏览器 DOM API、bundler、import/module 语法，除非项目明确迁移运行方式。
- 脚本会在三类上下文运行：
  - `config.runsInApp`：打开 TeslaMate WebView。
  - `config.runsInAccessoryWidget`：渲染锁屏圆形电量 widget。
  - 其他 widget 场景：渲染中号桌面 widget。
- Scriptable widget 刷新频率由 iOS 决定，`refreshAfterDate` 只是最早刷新时间，不保证准点刷新。

## 配置与数据

- 用户需要在 `Telsa Car.js` 顶部配置：
  - `AMAP_API_KEY`
  - `TESLA_MATE_API_URL`
  - `TESLA_MATE_URL`
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

## 修改原则

- 修改 UI 前先看 `docs/scriptable-capabilities.md` 和 `docs/architecture.md`。
- 新增 Scriptable API 用法时，同步扩展 `tests/scriptable-runtime.js` 的 stub，并增加测试覆盖。
- 保持 `Telsa Car.js` 顶部配置变量清晰可见，不要把必填配置隐藏到生成文件里。
- 不要把真实车辆接口地址、Amap Key、VIN、坐标、token、截图中的隐私位置提交进仓库。
- README 截图应保持体积合理，并与 README 内容相关。
- 不要主动 push。

## Git 协作

- 开始和结束前检查 `git status --short --branch`。
- 避免使用 `ls -R` 或 `grep -R` 做大范围扫描，优先使用 `rg`、`find` 或有目标的命令。
- 提交应聚焦，提交信息使用中文并遵循标准 git commit 规范。
