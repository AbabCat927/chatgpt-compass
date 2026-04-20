# ChatGPT Compass

ChatGPT Compass is a lightweight browser extension for Edge and Chrome that adds two high-value upgrades to the ChatGPT web app:

- a lightweight round navigator on the right side of the page for jumping across long chats
- click-to-copy LaTeX / Markdown-style math source from rendered formulas
- a clean, non-intrusive enhancement layer that stays out of the way until needed

It is designed as a publishable Manifest V3 extension with a small footprint, no build step, and sync-friendly settings stored in `chrome.storage.sync`.

## Why This Project

This project is inspired by the excellent interaction ideas in [gemini-voyager](https://github.com/Nagi-ovo/gemini-voyager), especially:

- timeline-style message navigation
- content-script-driven page enhancement
- browser-extension-first project organization
- SPA-aware injection and update handling

This implementation is adapted specifically for ChatGPT and intentionally keeps the first version focused on export and round navigation instead of trying to replicate Voyager's full product surface.

## Features

### 1. Round navigator

- Adds a compact right-side navigation bar
- Each user-led round maps to one dot
- Current reading position auto-highlights
- Click a dot to jump to that round
- Preview appears only while hovering a dot
- Updates when ChatGPT adds new responses
- Supports SPA route changes

### 2. Sync-friendly settings

- Toggle the round navigator
- Settings are stored with `chrome.storage.sync`
- Chromium browsers can sync settings across devices when browser sync is enabled

### 3. Formula copy

- Click a rendered math formula to copy Markdown-ready math
- Double-click a rendered math formula to copy raw LaTeX source
- Prioritizes original TeX annotations when available
- Works with common KaTeX-style math rendering used in ChatGPT

## Screenshots

- `docs/screenshot-main.png` placeholder: main conversation view with round navigator
- `docs/screenshot-popup.png` placeholder: extension popup

This repository does not include screenshots yet. Add them before public release.

## Repository Structure

```text
chatgpt-compass/
├── assets/
│   └── icon.svg
├── popup/
│   ├── popup.css
│   ├── popup.html
│   └── popup.js
├── background.js
├── content.js
├── manifest.json
├── styles.css
├── CHANGELOG.md
├── LICENSE
├── README.md
└── .gitignore
```

## Installation

### Edge

1. Download or clone this repository.
2. Open `edge://extensions/`.
3. Enable `Developer mode`.
4. Click `Load unpacked`.
5. Select the project folder.

### Chrome

1. Open `chrome://extensions/`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select the project folder.

## Usage

### Round navigator

- Use the right-side dots to jump through rounds
- Hover a dot to preview the round text
- Moving the pointer away hides the preview again
- The active dot tracks your current scroll position

### Popup

Click the extension icon to:

- view the current conversation title
- see round and message counts
- turn the navigator on or off

### Formula copy

- Single-click a rendered formula to copy Markdown math with `$...$` or `$$...$$`
- Double-click a rendered formula to copy raw LaTeX source
- Inline and block formulas use different hover styles
- A toast appears after copying succeeds

## Permissions

This extension requests:

- `storage`: save synced settings
- `activeTab`: talk to the active ChatGPT tab from the popup
- `scripting`: reserved for future enhancements and safe page integration
- host access to:
  - `https://chatgpt.com/*`
  - `https://chat.openai.com/*`

It does not send conversation data to any external server.

## Sync Across Devices

### Edge / Chrome extension sync

If you install the extension on multiple devices and sign into the same browser account:

- browser installation can be restored more easily through browser account history or store install history
- extension settings in `chrome.storage.sync` can sync automatically when browser sync is enabled

What usually syncs:

- navigator enabled or disabled

What does not automatically sync:

- unpacked local extension files
- manual Git clones or local development copies

For the best multi-device experience after first release:

1. publish to Edge Add-ons and Chrome Web Store
2. install it from the store on each device
3. keep settings in `chrome.storage.sync`

### If you used a userscript instead

This project intentionally does not use Tampermonkey for the first release. A userscript version is possible, but cross-device re-enablement is less polished because:

- script managers sync inconsistently across browsers
- permissions and update channels differ by manager
- project-level release and store distribution are weaker than an extension

## Development

This is a no-build project to keep local disk usage low.

### Local development

1. load the extension as unpacked
2. edit files directly
3. reload the extension from the browser extensions page
4. refresh ChatGPT

### Files of interest

- `content.js`: DOM observation, round navigation, and formula copy
- `styles.css`: in-page UI styling
- `popup/popup.js`: popup stats and synced settings
- `background.js`: install defaults

## Known Issues

- ChatGPT DOM can change at any time, so selectors may need maintenance.
- Very unusual conversation layouts, custom GPT panels, or future UI experiments may require selector adjustments.

## Roadmap

- branch-aware conversation navigation
- richer formula handling for more renderer variants
- optional compact mode for the navigator
- quote-reply helpers
- per-site appearance settings
- internationalized UI

## License

This project uses the MIT License for easier public reuse, contribution, and redistribution.

## Acknowledgements

- [Nagi-ovo/gemini-voyager](https://github.com/Nagi-ovo/gemini-voyager)
- [Reborn14/chatgpt-conversation-timeline](https://github.com/Reborn14/chatgpt-conversation-timeline)
