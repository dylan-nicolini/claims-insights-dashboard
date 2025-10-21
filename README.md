# Claims Insights Dashboard

A lightweight Angular app for monitoring API health across multiple environments (Development / Test / Staging / Production).  
The dashboard renders immediately from `assets/apis.json`, then runs parallel health checks in the background (Web Worker).  
An API details dialog shows **HTTP status code**, selected **response headers**, and a **history of the last 5 checks**.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Development Server](#development-server)
- [Development Proxy (avoid CORS locally)](#development-proxy-avoid-cors-locally)
- [Editing `assets/apis.json`](#editing-assetsapisjson)
  - [Single-env entries](#singleenv-entries)
  - [Multi-env mapping (DRY)](#multienv-mapping-dry)
  - [Absolute URL overrides](#absolute-url-overrides)
  - [Validating your changes](#validating-your-changes)
- [Code Scaffolding](#code-scaffolding)
- [Building](#building)
- [Running Unit Tests](#running-unit-tests)
- [Project Structure](#project-structure)
- [Branding & Theming](#branding--theming)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

- **Node.js**: v20.19+ (or v22.12+)  
  Check:
  ```bash
  node -v
  ```
- **Angular CLI**: v20.x  
  Install/Update:
  ```bash
  npm i -g @angular/cli@20
  ```

> **Windows & Node versions**  
> To manage Node versions on Windows, install **nvm-windows** (Corey Butler).  
> ```powershell
> nvm install 20.19.0
> nvm use 20.19.0
> node -v
> ```

---

## Quick Start

```bash
# From the project folder:
npm ci          # or: npm install

# Start the dev server with the proxy (recommended):
ng serve --proxy-config ./proxy.conf.json

# Open the app:
http://localhost:4200/
```

The app hot-reloads when source files change.

---

## Development Server

```bash
ng serve
```
Open `http://localhost:4200/`.  
If you call remote APIs from the browser, use the **dev proxy** (next section) to avoid CORS issues.

---

## Development Proxy (avoid CORS locally)

During development, the UI calls **relative** paths such as `/qa-api/claims/api/...`.  
The proxy rewrites those to your real targets and sets `changeOrigin`, so CORS is not required on the remote side.

**`proxy.conf.json`**
```json
{
  "/dev-api":  { "target": "https://services-claims-dev.selective.com",     "secure": true, "changeOrigin": true, "pathRewrite": { "^/dev-api": "" },  "logLevel": "debug" },
  "/qa-api":   { "target": "https://services-claims-qa.selective.com",      "secure": true, "changeOrigin": true, "pathRewrite": { "^/qa-api": "" },   "logLevel": "debug" },
  "/stg-api":  { "target": "https://services-claims-staging.selective.com", "secure": true, "changeOrigin": true, "pathRewrite": { "^/stg-api": "" },  "logLevel": "debug" },
  "/prod-api": { "target": "https://services-claims.selective.com",         "secure": true, "changeOrigin": true, "pathRewrite": { "^/prod-api": "" }, "logLevel": "debug" },

  "/httpbin":  { "target": "https://httpbin.org", "secure": true, "changeOrigin": true, "pathRewrite": { "^/httpbin": "" }, "logLevel": "debug" }
}
```

Run with:
```bash
ng serve --proxy-config ./proxy.conf.json
```

**Where are proxy logs?**  
In the **same terminal** running `ng serve`. You’ll see messages (and errors like `getaddrinfo ENOTFOUND …`) whenever requests are forwarded.

> In hosted environments the proxy does **not** exist. Ensure your real APIs allow the app origin or are deployed under the same domain.

---

## Editing `assets/apis.json`

The dashboard reads `src/assets/apis.json`, renders rows immediately, and then performs health checks in parallel.

### Single-env entries

```json
{
  "environments": {
    "Development": { "base": "/dev-api/claims/api" },
    "Test":        { "base": "/qa-api/claims/api" },
    "Staging":     { "base": "/stg-api/claims/api" },
    "Production":  { "base": "/prod-api/claims/api" },
    "Sandbox":     { "base": "/httpbin" }
  },

  "endpoints": [
    {
      "name": "Policy • Process (QA)",
      "method": "GET",
      "environment": "Test",
      "path": "/process/policy/health"
    },
    {
      "name": "HTTPBin • 200 OK",
      "method": "GET",
      "environment": "Sandbox",
      "path": "/status/200"
    }
  ]
}
```

The app builds final URLs as **base + path** using the selected environment’s base.

### Multi-env mapping (DRY)

Avoid duplicating similar rows by mapping a single endpoint to **multiple environments**:

```json
{
  "name": "Policy • Process",
  "method": "GET",
  "environments": {
    "Development": { "path": "/process/policy/health" },
    "Test":        { "path": "/process/policy/health" },
    "Staging":     { "path": "/process/policy/health" },
    "Production":  { "path": "/process/policy/health" }
  }
}
```

The app expands this into four internal rows (one per environment).  
You can also override a specific environment with a full `url` if needed.

### Absolute URL overrides

If you need a one-off entry that bypasses `base + path`, specify `url`:

```json
{
  "name": "Identity • Token (QA override)",
  "method": "GET",
  "environment": "Test",
  "url": "https://httpbin.org/get?svc=identity&ep=token&env=test"
}
```

### Validating your changes

1. Edit `src/assets/apis.json` and save.  
2. Reload the app (hot reload usually suffices).  
3. The new row shows immediately; health and latency fill in as checks complete.  
4. Click **Details** (info icon) → **Re-check (detailed)** to capture **HTTP code**, **headers**, and update **Last 5 checks**.

**Status rules (defaults):**
- **UP** – HTTP success and latency under threshold  
- **DEGRADED** – HTTP success but high latency  
- **DOWN** – HTTP error / timeout / network failure

---

## Code Scaffolding

```bash
ng generate component component-name
# For more options:
ng generate --help
```

---

## Building

```bash
ng build
# or production:
ng build --configuration production
```
Build artifacts land in `dist/`.

---

## Running Unit Tests

```bash
ng test
```

---

## Project Structure

```
src/
  app/
    features/
      api/
        api.component.ts
        api.component.html
        api.component.scss
        api-details.dialog.ts
        api-details.dialog.html
        api-details.dialog.scss
      dashboard/
        dashboard.component.ts
        dashboard.component.html
        dashboard.component.scss
        dashboard-health.service.ts
  assets/
    apis.json                 <-- edit your endpoints here
  theme/
    selective.css             <-- brand tokens / global styling
```

- **Dashboard**: tiles (UP / DEGRADED / DOWN / TOTAL), optional latency insight.  
- **API**: searchable grid with status pills, latency, and actions (Details / Open / Re-check).  
- **Details dialog**: shows environment, method, URL, last latency, selected response headers, and the last 5 checks.

---

## Branding & Theming

Brand tokens live in `src/theme/selective.css` (CSS variables) and drive:

- Typography, colors, borders, radii, shadows  
- Material component accents (buttons, inputs, progress, chips)  
- Status colors for **UP**, **DEGRADED**, **DOWN**

Adjust variables like:
- `--sel-ink`, `--sel-muted`, `--sel-accent`, `--sel-divider`
- `--sel-radius-md`, `--sel-radius-lg`, `--sel-shadow-card`

---

## Troubleshooting

**Node.js version error**  
> “The Angular CLI requires a minimum Node.js version of v20.19 or v22.12.”  
Install a newer Node version (see prerequisites).

**`assets/apis.json` 404 or parse error**  
- Ensure the file exists at `src/assets/apis.json`.  
- In `angular.json`, the app’s build options should include:
  ```json
  "assets": ["src/favicon.ico", "src/assets"]
  ```
- Validate JSON (no trailing commas or missing braces).

**Proxy doesn’t seem to run**  
- Start the server **with** the proxy flag:  
  `ng serve --proxy-config ./proxy.conf.json`  
- Look for proxy logs/errors in the **terminal** running `ng serve`.  
- Ensure your `base` values start with the configured prefixes (e.g., `/qa-api`, `/httpbin`).

**CORS in production**  
The dev proxy only exists locally. In hosted environments, APIs must (a) share origin with the app or (b) allow the app’s origin via CORS.

**Dialog overflow / horizontal scroll**  
The dialog forces vertical scrolling and wraps long values. If you still see horizontal scroll, update the dialog SCSS and ensure long URLs/headers use `word-break: break-all;`.