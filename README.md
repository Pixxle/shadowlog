<p align="center">
  <img src="assets/banner.png" alt="ShadowLog" width="500">
</p>

# ShadowLog

Firefox extension for selective browsing history cleanup. Define regex rules to automatically delete history entries (and optionally cookies, cache, site data) for matching URLs.

## Install

1. Open `about:debugging#/runtime/this-firefox` in Firefox (115+)
2. Click **Load Temporary Add-on**
3. Select `manifest.json` from this directory

## How It Works

- **Rules** match URLs via regex patterns (with optional exclude patterns)
- **Actions** per rule: delete history, cookies, cache, or site data
- **Timing**: ASAP on visit, on tab close, on browser close, or periodic sweep
- **Retry buffer** persists failed deletions and retries on next startup

## Usage

**Popup** — pause/resume, forget current tab, view recent deletions

**Options page** — create/edit rules, test URLs against rules, import/export

## Permissions

| Permission | Why |
|---|---|
| `history` | Delete matching history entries |
| `browsingData` | Clear cookies/cache/site data by hostname |
| `webNavigation` | Track navigations for ASAP deletion |
| `tabs` | Detect tab close events |
| `storage` | Persist rules and retry buffer |
| `alarms` | Periodic cleanup sweeps |

## Known Limitations

- **On-close is best-effort** — browser crashes bypass it; startup sweep compensates
- **Cache clearing is global** — Firefox has no per-host cache deletion API
- **Cookies/site data are origin-scoped**, not URL-precise
- **History sync conflicts** — disable sync if using ShadowLog for sensitive URLs
