# 代码审查记录

审查基线：Scriptable 官方文档、当前 `Telsa Car.js`、本地 Node Scriptable runtime 测试。

## 已修复

- `Telsa Car.js:4` / `Telsa Car.js:14`：原先 `args.widgetParameter` 的第一个参数既被当作主题又被当作车辆 ID，`dark` 会导致车辆 ID 变成 `dark`。现在从参数中查找数字作为车 ID，`dark,1` 和 `1,dark` 都可用。
- `Telsa Car.js:27`：原先 `FileManager.joinPath()` 第二段传入 `/tesla`，容易和不同路径实现产生歧义。现在使用 `tesla`。
- `Telsa Car.js:42`：原先 WebView 注入代码把 `insertRule()` 的返回值继续当对象调用，页面脚本会失败。现在改为创建 `<style>` 注入。
- `Telsa Car.js:67` / `Telsa Car.js:312`：TeslaMateApi 失败且没有缓存时，原先会继续读不存在的缓存文件。现在明确在无缓存时抛出原始错误。
- `Telsa Car.js:190` / `Telsa Car.js:332`：首跑没有历史地理数据时，原先读取 `car.prev_geodata.latitude` 会崩溃。现在用 `hasCarMoved()` 统一判断，并在无历史数据时以当前坐标作为基线。
- `Telsa Car.js:225` / `Telsa Car.js:256`：地理编码或地图请求失败时，原先可能让后续 `json[0]` 或地图绘制崩溃。现在提供 `未知位置` 和空白地图占位图。

## 仍需后续处理

- `Telsa Car.js:12` / `Telsa Car.js:17` / `Telsa Car.js:20`：配置仍是直接改源码。建议后续把用户配置集中到一个清晰的配置块，并在 README 中给出复制模板；Scriptable 没有 `.env` 标准机制，不建议引入构建流程。
- `Telsa Car.js:6` / `Telsa Car.js:7`：`isDarkTheme` 和 `padding` 目前未参与渲染。建议后续要么接入主题样式，要么删除无效变量。
- `Telsa Car.js:99` / `Telsa Car.js:100`：锁屏 widget 中续航里程被计算后又硬编码为 `88`，且绘制文字被注释。当前不影响圆形电量图，但会误导后续维护。
- `Telsa Car.js:403` 到 `Telsa Car.js:670`：多处 `SFSymbol.named(...).image` 未处理返回 `null` 的情况。官方文档说明找不到符号会返回 `null`，老系统或符号名不支持时可能崩溃。
- `Telsa Car.js:606`：充电状态字符串中使用特殊箭头和分隔符，显示没问题；如果后续需要兼容低字体或做文本快照，需要统一格式。
- `Telsa Car.js:123` / `Telsa Car.js:767`：widget 分支里仍调用 `presentSmall()` / `presentMedium()`。这对 Scriptable App 内调试展示有帮助，但真实 widget 运行中核心动作是 `Script.setWidget()`；后续可考虑只在 `config.runsInApp` 或调试模式下 present。
- `Telsa Car.js` 整体仍是 700 多行单文件，UI 绘制、数据请求、缓存和坐标转换耦合在一起。Scriptable 支持 `importModule`，后续可拆分为 `lib/config.js`、`lib/api.js`、`lib/widget.js`，但需要同步用户安装方式。

## 自动化测试结论

已新增 Node 测试机制，当前覆盖：

- 中号桌面 widget 在线状态。
- 充电状态刷新和文案。
- 行驶状态刷新和速度。
- 锁屏 accessory widget。
- App 内 WebView。
- TeslaMateApi 失败时缓存回退。

当前命令 `npm test` 通过。
