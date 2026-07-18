# 自动化测试机制

## 目标

本项目无法在 macOS 上直接调用真实 Scriptable iOS 渲染器，因此自动化测试采用“Scriptable runtime stub + 原脚本执行”的方式，覆盖脚本逻辑效果：

- 桌面中号 widget 是否能完成构建。
- 锁屏 accessory widget 是否能完成圆形电量图构建。
- 充电、行驶、在线、离线等状态分支是否可执行。
- TeslaMateApi 失败时是否能读取车辆缓存。
- TeslaMateApi 返回可解析但缺少 `data.status` 的错误 JSON 时，是否拒绝进入渲染并安全回退缓存。
- App 内 WebView 分支是否打开 TeslaMate 页面并注入隐藏其他车辆的脚本。
- 已配置 Widget 的点击 URL 是否携带来源标记，并在进入 App 后跳过管理菜单直接打开 WebView。
- iOS 尚未刷新点击 URL 的旧 Widget 快照，是否仍能通过 Widget 参数跳过管理菜单。

## 运行命令

```bash
npm test
```

只运行 Scriptable widget 测试：

```bash
npm run test:scriptable
```

代码完成后的验收必须重新运行测试。不要使用 `screencapture`、不要激活 Scriptable、不要移动或遮挡用户当前窗口。推荐流程：

```bash
mkdir -p test-results
npm test 2>&1 | tee test-results/latest.txt
```

视觉验收必须使用真实运行截图脚本，不能使用模拟生成图或手工拼图替代真实效果。`test-results/` 是本地验收产物目录，不提交到 git。

## 真实 macOS widget 截图

在用户明确允许真实截图时，可以运行：

```bash
npm run capture:widget
```

该命令会先请求 WidgetKit 刷新 `RunScriptWidget`，然后从 WindowServer 中查找 `通知中心` / `Notification Center` 下名为 `Run Script` 的真实桌面 widget 窗口，并通过窗口 ID 截图。它不会激活 Scriptable、不会显示桌面、不会移动或隐藏用户窗口；输出文件写入 `test-results/real-widget-*.png`，同时写入 `test-results/real-widget-manifest.json`。

如果需要在不点击桌面的情况下生成彩色截图，可以运行：

```bash
npm run capture:widget:color
```

该命令会在截图期间临时把 `com.apple.widgets widgetAppearance` 切到 `1`（Full-color），截图后立即恢复原值并请求 WidgetKit 重新刷新。它仍然不会激活 App 或显示桌面，但会短暂改写 macOS 的全局 widget 外观偏好。

只查看当前可捕获的 Scriptable widget 窗口：

```bash
node scripts/capture-real-widget.js --list
```

只截取指定窗口：

```bash
node scripts/capture-real-widget.js --window-id 29
```

## 真实 iPhone 截图

如果 Mac 上已经打开系统应用 iPhone Mirroring，可以优先使用镜像窗口截图：

```bash
npm run capture:iphone:mirror
```

该命令从 WindowServer 查找 `iPhone镜像` / `iPhone Mirroring` 主窗口，并通过窗口 ID 截图。它不需要开启 iPhone Developer Mode，也不会激活、移动或显示其他 Mac 窗口；但它依赖 iPhone Mirroring 已经连接，并且截图内容是镜像窗口当前显示的画面。

只裁剪 iPhone 镜像里的 TeslaMate widget：

```bash
npm run capture:iphone:mirror:widget
```

该命令会先生成镜像窗口截图，再自动定位右半边为地图的中号 TeslaMate 卡片，并输出 `test-results/iphone-widget-*.png`。如果当前负一屏有多个 TeslaMate widget，会按从上到下的顺序输出多个文件；也可以用 `node scripts/capture-iphone-mirroring.js --crop-widget --widget-index 1` 只输出指定序号。

如果 iPhone Mirroring 窗口显示“连接暂停”，需要先恢复连接并让镜像窗口显示负一屏，再运行裁剪命令。

如果需要验证 iPhone 负一屏里的真实 widget 效果，可以在 iPhone 通过 USB 连接、已信任本机，并停留在负一屏时运行：

```bash
npm run capture:iphone
```

该命令会检测 USB 设备、检查 Developer Mode、自动挂载 Developer Disk Image，然后抓取 iPhone 当前屏幕到 `test-results/iphone-screen-*.png`。iOS 真机截图依赖 Apple 的开发者服务，因此 iPhone 必须开启 Developer Mode；如果未开启，可以先运行：

```bash
npm run capture:iphone -- --reveal-dev-mode
```

然后在 iPhone 上打开“设置 -> 隐私与安全性 -> 开发者模式”，开启后按提示重启并确认。该脚本只抓取当前 iPhone 屏幕，不负责自动把手机滑到负一屏。

## 测试文件

- `tests/scriptable-runtime.js`：Scriptable API stub 和脚本执行器。
- `tests/scriptable-widget.test.js`：业务场景测试。
- `scripts/capture-real-widget.js`：按 WindowServer 窗口 ID 生成真实 macOS widget 截图。
- `scripts/capture-iphone-screen.js`：通过 USB 抓取 iPhone 当前屏幕截图。
- `scripts/capture-iphone-mirroring.js`：抓取 Mac 上 iPhone Mirroring 窗口截图。
- `scripts/crop-iphone-mirroring-widget.py`：从 iPhone Mirroring 截图中裁剪 TeslaMate widget。

## 当前覆盖场景

| 场景 | 验证内容 |
| --- | --- |
| 在线车辆桌面 widget | 能完成渲染、写入车辆缓存、显示名称与续航 |
| 充电状态 | 显示功率和目标电量，刷新窗口约 30 秒 |
| 行驶状态 | 显示速度，刷新窗口约 10 秒 |
| 锁屏 accessory widget | 生成一个圆形电量图片元素 |
| App 内 WebView | 打开 TeslaMate URL，隐藏非当前车辆卡片 |
| API 失败缓存回退 | 读取 `car_data_<carId>.json` 继续渲染 |

## 新增测试的规则

1. 新增 Scriptable API 用法时，先在 `tests/scriptable-runtime.js` 增加对应 stub。
2. 新增车辆状态分支时，在 `tests/scriptable-widget.test.js` 增加状态数据。
3. 不要让测试访问真实 TeslaMate、Amap、Apple 定位服务或用户本机 Scriptable 目录。
4. 测试应检查行为结果，例如 widget 文本、刷新时间、缓存文件、WebView 调用，而不是检查大量内部实现细节。

## 已知限制

- Node stub 不做像素级渲染，不能证明最终 iOS 视觉完全一致。
- `SFSymbol.named()` 在测试中默认返回假图标，不能发现老 iOS 不支持某个符号的问题。
- `Location.reverseGeocode()` 和 Amap 静态地图请求在测试中是模拟结果，真机权限、网络、Key 配额仍需人工确认。
- 真机发布前必须用真实截图脚本验证中号 widget 和锁屏 accessory widget 的视觉效果。

## iCloud 跨设备真实验收清单

以下项目只记录通过/未通过；不要粘贴配置内容、配置路径正文、包含隐私位置的截图或系统日志原文。Node runtime stub 不能证明 iCloud 上传、占位文件回收、冲突处理或跨设备传播，发布前请在真实设备上完成此清单。

- [ ] 已配置设备在 App 内确认迁移，随后仍能正常打开 TeslaMate。
- [ ] 第二台同账户设备不输入业务参数即可读取配置。
- [ ] 系统仍保留已下载本地副本时，配置在离线状态可读取。
- [ ] 配置从未下载或本地副本已被系统回收时，离线状态显示同步提示且不请求车辆接口。
- [ ] 两台设备依次修改后，最终读取 iCloud 当前可见版本。
