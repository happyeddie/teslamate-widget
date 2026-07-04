# TeslaMate Scriptable Widget

基于 [Scriptable](https://scriptable.app/) 的 TeslaMate 小组件脚本，用于在 iOS 桌面和锁屏显示车辆状态、续航、充电、位置和地图信息。

![asleep](./docs/asleep.jpg)

![charging](./docs/charging.jpg)

![lock screen](./docs/lock_screen.png)

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
- 需独立部署 [TeslaMate](https://github.com/adriankumpf/teslamate) & [TeslaMateApi](https://github.com/tobiasehlert/teslamateapi)

## 安装与配置

1. 将 `Telsa Car.js` 复制到 Scriptable。
2. 在脚本顶部配置：
   - `AMAP_API_KEY`
   - `TESLA_MATE_API_URL`
   - `TESLA_MATE_URL`
3. 在 Scriptable Widget 的参数中传入车辆 ID，例如 `1`。
4. 如需保留主题标记，可传入 `dark,1` 或 `1,dark`。

缓存文件会写入 Scriptable documents 目录下的 `tesla/` 文件夹。

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
