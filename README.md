# TeslaMate Scriptable Widget

Language: **English** | [Chinese](./README.zh-CN.md)

A [Scriptable](https://scriptable.app/) widget script for TeslaMate. It shows vehicle status, range, charging state, location, and map information on the iOS Home Screen and Lock Screen.

![asleep](./docs/asleep.jpg)

![charging](./docs/charging.jpg)

![lock screen](./docs/lock_screen.png)

## Table of Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation and Configuration](#installation-and-configuration)
- [Local Automated Tests](#local-automated-tests)
- [AI Development Docs](#ai-development-docs)
- [Referral Link](#referral-link)

## Features

- Vehicle name
- Vehicle state: online, sentry, asleep, suspended, driving, charging, updating, or offline
- Battery state: battery percentage, rated range, and charge limit
- Charging state: charger power, charge limit, and time remaining
- Control state: lock, driver presence, windows, climate, and doors
- Widget last update time
- Current location name
- Current location map from AMap
- Current heading
- Lock Screen widget battery display

## Requirements

- [Scriptable](http://scriptable.app)
- An [AMap developer key](https://lbs.amap.com/api/webservice/guide/create-project/get-key)
- A self-hosted [TeslaMate](https://github.com/adriankumpf/teslamate) and [TeslaMateApi](https://github.com/tobiasehlert/teslamateapi) setup

## Installation and Configuration

1. Copy `Telsa Car.js` into Scriptable.
2. Open Scriptable and run the script once. On first run, the script opens a configuration form instead of making network requests.
3. Enter the following values, then tap **Save**:
   - **AMap API Key**: the Web Service key used by the static map request.
   - **TeslaMateApi Base URL**: the service base address, for example `https://api.example.com`. Do not append `/api/v1/cars/1/status`; the script adds the vehicle path automatically.
   - **TeslaMate Web URL**: the base address of the TeslaMate web interface, for example `https://teslamate.example.com`.
4. Set the Scriptable widget parameter to the vehicle ID, for example `1`.
5. If you also want to keep the theme marker, use `dark,1` or `1,dark`.

The three configuration values are stored as one versioned entry in Scriptable Keychain. They are not stored in the script or the Scriptable documents folder. Keychain availability can differ between devices or after reinstalling/migrating Scriptable, so run the script and configure it separately on every device where the widget reports that configuration is missing.

To update an existing configuration, run the script in the Scriptable app, choose **Manage Configuration**, edit the values, and save. Running a configured script also provides **Open TeslaMate**. Configuration dialogs are never shown from a widget refresh.

Cache files are stored in the `tesla/` folder under Scriptable documents.

## Local Automated Tests

This repository includes a Node-based Scriptable runtime stub. It runs the original script locally and verifies the main behavior.

```bash
npm test
```

The tests cover the medium Home Screen widget, Lock Screen widget, charging state, driving state, WebView branch, and API failure cache fallback. See [docs/testing.md](./docs/testing.md) for details.

If a Scriptable `Run Script` widget has been added on the macOS desktop and real screenshots are allowed, capture the real WidgetKit rendering with:

```bash
npm run capture:widget
```

Capture a real full-color widget screenshot with:

```bash
npm run capture:widget:color
```

If an iPhone is connected over USB, trusted by the Mac, and showing the Today View, capture the real device screen with:

```bash
npm run capture:iphone
```

If iPhone Mirroring is already open, capture the mirroring window with:

```bash
npm run capture:iphone:mirror
```

Crop only the TeslaMate widget from the iPhone Mirroring screenshot with:

```bash
npm run capture:iphone:mirror:widget
```

## AI Development Docs

- [AGENTS.md](./AGENTS.md): AI collaboration rules.
- [docs/scriptable-capabilities.md](./docs/scriptable-capabilities.md): Scriptable API capabilities and development constraints.
- [docs/architecture.md](./docs/architecture.md): Project structure, data flow, and cache strategy.
- [docs/code-review.md](./docs/code-review.md): Current code review notes.
- [docs/testing.md](./docs/testing.md): Automated testing workflow.

## Referral Link

[http://ts.la/pcmg48082](http://ts.la/pcmg48082)
