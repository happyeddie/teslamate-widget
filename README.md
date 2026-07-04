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
2. Configure these values near the top of the script:
   - `AMAP_API_KEY`
   - `TESLA_MATE_API_URL`
   - `TESLA_MATE_URL`
3. Set the Scriptable widget parameter to the vehicle ID, for example `1`.
4. If you also want to keep the theme marker, use `dark,1` or `1,dark`.

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
