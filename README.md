# Paseo Usage Sidebar 📊

<p align="center">
  <strong>A sleek and lightweight usage dashboard plugin for Paseo's sidebar.</strong>
</p>

<p align="center">
  <a href="./README.md">English</a> | <a href="./README.zh-CN.md">简体中文</a>
</p>

---

## 💡 Overview

**Paseo Usage Sidebar** is an elegant usage monitoring plugin designed for [Paseo](https://paseo.sh). It seamlessly integrates AI provider quotas and consumption tracking directly into your sidebar, featuring pinned mini progress bars and an expandable detailed panel to keep your usage visible at a glance.

**Zero configuration required**—it reads Paseo's own `provider.usage.list`, so the numbers always agree with **Settings → Usage**. No API keys, no vendor CLI, no second polling path.

<p align="center">
  <img src="images/sidebar-meter-dark.png" alt="The pinned mini meter in the sidebar" />
</p>

---

## ✨ Features

- 📊 **Pinned Mini Meters**: Compact progress bars right below the sidebar item for effortless quota monitoring without page switching, on desktop, web, and the mobile app alike.
- 🔍 **Expandable Detail Panel**: One-click access to a dashboard showing provider quotas, reset schedules, balances, and status.
- ⚡ **Zero Setup & Live Sync**: Refreshes every 60 seconds while the meter or the panel is on screen (one poll for both, paused while the window is hidden), and on demand from **Refresh**—no manual API key entry or configuration.
- 🎛️ **Pin, Hide & Reorder**: Choose exactly which quota windows live in the sidebar, and drag them into the order you want.
- 📈 **Pace Against the Clock**: `57% ▲12%` means twelve points ahead of a window only 45% elapsed; a tick on the bar marks where the clock stands. Green behind, orange 1–5 points ahead, red past that.
- 👤 **Whose Plan It Is**: Each provider is headed by its account — `Claude (you@example.com)` — and a subscription signed in on two providers, or two connected machines, renders once instead of twice.
- 🗂️ **Foldable Accounts**: Click an account heading in the sidebar meter to fold its rows away.
- 🎨 **Native Look & Feel**: Follows all seven built-in themes, picking up a theme switch without a reload.
- 🌐 **i18n Ready**: Localized into all nine languages Paseo ships—English, Simplified Chinese, Arabic, Spanish, French, Japanese, Korean, Portuguese (Brazil), and Russian.

The account address is the one thing Paseo does not report, so it is read — the address alone, read-only — from the provider CLI's own login file. See [docs/DESIGN.md](./docs/DESIGN.md) for exactly what is read, and for how pace, deduplication, and the cross-machine claim work.

---

## 📸 Preview

|           |                  Pinned Mini Meter                  |             Expandable Detail Panel             |
| :-------: | :-------------------------------------------------: | :---------------------------------------------: |
| **Light** |   ![Mini meter, Light theme](images/sidebar-meter.png)    |    ![The usage panel](images/usage-panel.png)     |
| **Dark**  | ![Mini meter, Dark theme](images/sidebar-meter-dark.png) | ![The panel on the Dark theme](images/usage-panel-dark.png) |

---

## 🚀 Quick Start

> Requires **Paseo 0.14.0 or later**. For older Paseo versions use plugin version 1.1.x.

### Installation

**Option A — From the app**

1. Open **Paseo** and go to **Settings → Plugins**.
2. Turn on **Enable plugins**.
3. Paste the repository URL into **Plugin source**:
   ```
   https://github.com/RUIIIOVO/paseo-usage-sidebar.git
   ```
4. Press **Install plugin**.

![Installing from Settings → Plugins](images/install.png)

A successful install looks like this:

![The installed plugin row](images/installed.png)

**Option B — From the command line**

```bash
paseo plugin add RUIIIOVO/paseo-usage-sidebar
```

### Usage

- **Quick Glance**: The sidebar shows a mini meter for every pinned quota window, directly under the **Plan usage** entry. Click a provider's rows, including their progress bars, to open the usage panel; keyboard users can focus them and press Enter or Space. Click the provider heading instead to fold its rows.
- **Detailed View**: Pick **Plan usage** in the sidebar, or run **Open plan usage** from the Command Center (`Cmd`/`Ctrl` + `K`).
- **Reorder & Customize**: Click the pin button on the right of a usage window to pin or unpin it. A filled pin and highlighted row indicate a pinned window on desktop and web. The same pin button in **Sidebar order** unpins a window; drag the grip or use the arrow buttons to reorder. Values and progress bars are read-only, so clicking them does not change your pins.
- **Pace**: The **Pace** button in the panel header turns the arrow and the clock tick off on both surfaces.
- **Used or remaining**: The **Percentages** switch in the panel shows each window as the share used or the share left, on both surfaces. Pace always compares spend with the clock; on a remaining bar the clock tick is mirrored so the gap still matches the arrow.

---

## 🔄 Updating

Update with:

```bash
paseo plugin update usage-sidebar
```

---

## 🤝 Contributing

Issues and Pull Requests are welcome—see [CONTRIBUTING.md](./CONTRIBUTING.md) for what to run and how commits are written. If you find this plugin helpful, please consider giving it a ⭐️.

---

## 📄 License

This project is licensed under the [MIT License](./LICENSE).
