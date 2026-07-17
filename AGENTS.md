# 默认规则

- 全程使用中文与 Human 和 SubAgent 对话、编辑文档和记录结论，只说明必要信息。
- 开始项目工作前先完整阅读并理解本文件；若本文件不存在，可忽略此规则。

## 开发规范

- 所有代码开发都应按职责合理拆分模块，并优先复用已有模块。
- 每个代码块和方法都应补充足以说明使用场景、业务规则与入参/出参约束的注释；`if`、`switch`、复杂公式或算法应说明分支或计算意图，使注释可作为维护文档。

## 提交规范

- 完成检查后可以 commit；提交信息与 change log 使用中文，绝不主动 push。

## SuperPowers 使用规范

- 前端代码默认不需要 TDD。
- SuperPowers 目录默认排除在 Git 之外，不要强制提交。
- 如有必要，默认开启 SuperPowers Visual companion，无需询问。
- 自行安排 SubAgent 完成 SuperPowers 的 specs / plan 审查；确认无误后直接询问用户下一步如何推进实施。
- Finish Development Branch 时，默认在本地 commit，并通过 Git 提交 PR / MR；输出 MR 链接供用户审查。

## Codex Desktop

- 如无明确要求，浏览器操作默认使用 Codex 内置浏览器，不使用 Playwright。
- 使用 Computer Use 时默认在后台操作，不打扰用户的正常工作。

--- project-doc ---

# AI 开发约定

## 工作语言

- 与用户沟通、文档、审查结论和提交信息默认使用中文。
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
  - `config.runsInApp`：打开 TeslaMate WebView。
  - `config.runsInAccessoryWidget`：渲染锁屏圆形电量 widget。
  - 其他 widget 场景：渲染中号桌面 widget。
- Scriptable widget 刷新频率由 iOS 决定，`refreshAfterDate` 只是最早刷新时间，不保证准点刷新。

## 配置与数据

- 首次使用时，用户在 Scriptable App 内运行脚本并通过配置表单写入版本化 Keychain 配置；运行时从不在源码或 Scriptable documents 目录保存凭据。
- 仓库 `Telsa Car.js` 与 iCloud Scriptable 运行文件 `Tesla Widget.js` 必须字节一致，二者均不得包含 Amap Key、私有 TeslaMate URL、VIN、坐标、token 或其他个人凭据。
- 每台设备、重新安装或迁移 Scriptable 后都可能需要重新在对应设备的 Keychain 中完成配置。
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
- 配置读取、网络请求、缓存初始化都必须通过运行配置门禁；配置缺失时 Widget 只显示静态引导，App 内才可展示配置表单。
- 不要把真实车辆接口地址、Amap Key、VIN、坐标、token、截图中的隐私位置写入仓库、iCloud 脚本文本、日志、测试产物或提交历史。
- 代码完成、测试通过后，将仓库脚本完整覆盖同步到 iCloud `Tesla Widget.js`，并校验两者 SHA-256 一致；不得通过保留旧脚本配置行的方式同步。
- README 截图应保持体积合理，并与 README 内容相关。
- 不要主动 push。

## Git 协作

- 开始和结束前检查 `git status --short --branch`。
- 避免使用 `ls -R` 或 `grep -R` 做大范围扫描，优先使用 `rg`、`find` 或有目标的命令。
- 提交应聚焦，提交信息使用中文并遵循标准 git commit 规范。
