# TeslaMate Scriptable Widget

语言：[English](./README.md) | **简体中文**

基于 [Scriptable](https://scriptable.app/) 的 TeslaMate 小组件脚本，用于在 iOS 桌面和锁屏显示车辆状态、续航、充电、位置和地图信息。

![休眠状态](./docs/asleep.jpg)

![充电状态](./docs/charging.jpg)

![锁屏 widget](./docs/lock_screen.png)

## 目录

- [功能](#功能)
- [依赖](#依赖)
- [安装与配置](#安装与配置)
- [本地自动化测试](#本地自动化测试)
- [AI 开发文档](#ai-开发文档)
- [我的引荐链接](#我的引荐链接)

## 功能

- 车辆名称
- 车辆状态（在线 / 哨兵 / 休眠 / 进入休眠 / 驾驶中 / 充电中 / 更新中 / 离线）
- 电池状态（剩余电量比例 / 剩余里程数 / 充电上限阈值）
- 充电状态（功率 / 充电上限 / 剩余时间）
- 控制状态（车锁 / 主驾有人 / 车窗 / 空调 / 车门）
- Widget 最后更新时间
- 当前位置地名
- 当前位置地图（高德地图）
- 当前朝向
- 锁屏 Widget 显示电量

## 依赖

- 此脚本需搭配 [Scriptable](http://scriptable.app) 使用
- 需申请 [高德地图开发者账号](https://lbs.amap.com/api/webservice/guide/create-project/get-key)
- 需独立部署 [TeslaMate](https://github.com/adriankumpf/teslamate) 和 [TeslaMateApi](https://github.com/tobiasehlert/teslamateapi)

## 安装与配置

1. 将 `Telsa Car.js` 复制到 Scriptable。
2. 打开 Scriptable 并首次运行脚本。脚本会直接显示配置表单，此时不会发起网络请求。
3. 填写以下配置并点击“保存”：
   - **高德 API Key**：高德 Web 服务静态地图请求使用的 Key。
   - **TeslaMateApi 基础 URL**：只填写服务基础地址，例如 `https://api.example.com`；不要追加 `/api/v1/cars/1/status`，脚本会根据车辆 ID 自动拼接接口路径。
   - **TeslaMate Web URL**：TeslaMate Web 页面基础地址，例如 `https://teslamate.example.com`。
4. 在 Scriptable Widget 的参数中传入车辆 ID，例如 `1`。
5. 如需保留主题标记，可传入 `dark,1` 或 `1,dark`。

三项配置会作为一个带版本号的配置文件保存在 Scriptable 的 iCloud Drive documents 中，不会写入脚本。项目不额外设置应用“主密码”：访问控制由 Apple Account 与受信任设备负责；应将所有登录该 Apple Account 的受信任设备视为能够读取此配置。

需要修改现有配置时，在 Scriptable App 内运行脚本，选择“管理配置”，修改后保存。已完成配置时，同一菜单还可选择“打开 TeslaMate”。Widget 刷新过程不会弹出配置表单。

缓存文件会写入 Scriptable documents 目录下的 `tesla/` 文件夹。

### iCloud 同步、迁移与安全边界

当各设备登录同一 Apple Account、开启 iCloud Drive 且允许 Scriptable 使用 iCloud 时，配置会通过 iCloud Drive 共享。Apple 说明 [iCloud Drive 的变更会自动出现在你的设备上](https://support.apple.com/guide/icloud/what-you-can-do-with-icloud-drive-mm19ef899373/1.0/icloud/1.0)；但脚本无法观测或承诺系统何时已经上传或传播某次修改，请等待系统同步完成后再依赖另一台设备。

如果从旧的仅 Keychain 版本升级，请在**原来已经配置的旧设备**中打开 Scriptable App 运行新脚本，查看迁移提示并在 App 内确认。只有迁移写入并校验成功后，旧 Keychain 项才会删除；不要先手动删除旧项。Widget 不会迁移配置，也不会显示迁移表单。

同一 Apple Account 的第二台设备需要先安装脚本，并在 Scriptable App 内运行一次，再添加或刷新 Widget。配置到达后无需再次输入业务参数。Widget 有意不下载 iCloud 占位文件：配置尚未下载时只显示同步提示，且不会请求车辆接口。已经下载过的配置在离线时仍可读取；从未下载的设备在离线时仍保持安全提示状态。

只支持单设备依次修改配置，不支持并发编辑：项目没有合并界面；依次保存后，各设备只读取 iCloud 当前可见的版本。这是使用边界，并不表示脚本能够确认同步已经完成。

Apple 的[普通数据保护](https://support.apple.com/en-us/102651)会在传输和静态存储时加密 iCloud 数据，加密密钥由 Apple 数据中心保管；可选的[高级数据保护](https://support.apple.com/en-us/102651)会让 iCloud Drive 使用端到端加密，密钥只在受信任设备上，并有更严格的恢复要求。高级数据保护不是本组件的前置条件；无论采用哪种设置，都不要在不受信任设备上登录 Apple Account。请参阅 Apple 的 [iCloud Drive 设置要求](https://support.apple.com/guide/icloud/set-up-icloud-drive-mm203b05aec8/icloud) 与 Scriptable 的 [iCloud FileManager 文档](https://docs.scriptable.app/filemanager/)。

## 本地自动化测试

本项目提供 Node 版 Scriptable runtime stub，用于在本地执行原始脚本并验证主要运行效果。

```bash
npm test
```

测试覆盖桌面 widget、锁屏 widget、充电状态、行驶状态、WebView 分支和 API 失败缓存回退。详见 [docs/testing.md](./docs/testing.md)。

在 macOS 桌面已添加 Scriptable `Run Script` widget，且用户允许真实截图时，生成真实 WidgetKit 运行截图：

```bash
npm run capture:widget
```

生成彩色真实截图：

```bash
npm run capture:widget:color
```

在 iPhone 已通过 USB 连接、已信任本机，并停留在负一屏时，抓取真机当前屏幕：

```bash
npm run capture:iphone
```

如果已经打开 iPhone Mirroring，可直接抓取镜像窗口：

```bash
npm run capture:iphone:mirror
```

只裁剪镜像里的 TeslaMate widget：

```bash
npm run capture:iphone:mirror:widget
```

## AI 开发文档

- [AGENTS.md](./AGENTS.md)：AI 协作约定。
- [docs/scriptable-capabilities.md](./docs/scriptable-capabilities.md)：Scriptable 能力清单和开发依据。
- [docs/architecture.md](./docs/architecture.md)：项目结构、数据流和缓存策略。
- [docs/code-review.md](./docs/code-review.md)：当前代码审查记录。
- [docs/testing.md](./docs/testing.md)：自动化测试机制。

## 我的引荐链接

[http://ts.la/pcmg48082](http://ts.la/pcmg48082)
