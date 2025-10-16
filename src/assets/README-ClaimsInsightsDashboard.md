# ClaimsInsightsDashboard

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 20.3.2.  
It’s a branded Angular Material app that monitors API health across environments (Dev / Test / Staging / Prod).  
The dashboard renders immediately from `assets/apis.json`, then runs parallel health checks in the background.  
An API details dialog provides **HTTP status code**, a small set of **response headers**, and a **history of the last 5 checks**.

---

## Table of Contents

- [Prerequisites](#prerequisites)  
- [Quick Start (Clone & Run)](#quick-start-clone--run)  
- [Development Server](#development-server)  
- [Editing `assets/apis.json` (Add Your URLs)](#editing-assetsapisjson-add-your-urls)  
  - [Selective QA Health URL Example](#selective-qa-health-url-example)  
  - [Multiple Environments Example](#multiple-environments-example)  
  - [Verifying Your Endpoint](#verifying-your-endpoint)  
- [Code Scaffolding](#code-scaffolding)  
- [Building](#building)  
- [Running Unit Tests](#running-unit-tests)  
- [Running End-to-End Tests](#running-end-to-end-tests)  
- [Project Structure](#project-structure)  
- [Branding & Theming](#branding--theming)  
- [Troubleshooting](#troubleshooting)  
- [Additional Resources](#additional-resources)

---

## Prerequisites

- **Node.js**: v20.19+ (or v22.12+).  
  Check:
  ```bash
  node -v
  ```
- **Angular CLI**: v20.x  
  Install/Update:
  ```bash
  npm i -g @angular/cli@20
  ```
- **Git**: any recent version.

> **Windows & Node versions**  
> If you need to manage Node versions on Windows, install **nvm-windows**:  
> https://github.com/coreybutler/nvm-windows  
> ```powershell
> nvm install 20.19.0
> nvm use 20.19.0
> node -v
> ```

---

## Quick Start (Clone & Run)

```bash
git clone https://github.com/dylan-nicolini/claimsinsightshub.git
cd claimsinsightshub
npm ci      # or: npm install
ng serve
```

Open: **http://localhost:4200**

---

## Development Server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`.  
The application will automatically reload whenever you modify any of the source files.

---

## Editing `assets/apis.json` (Add Your URLs)

The dashboard reads `src/assets/apis.json`, renders the list immediately, and then performs health checks in parallel.

**File path:** `src/assets/apis.json`

**Shape:**
```json
{
  "endpoints": [
    {
      "name": "Service • Endpoint (Env)",
      "method": "GET",
      "url": "https://example.org/health",
      "environment": "Production"
    }
  ]
}
```

> **Notes**
>
> - `method` supports: `GET | POST | PUT | DELETE | PATCH | HEAD` (most health URLs are `GET`).
> - `environment` is optional, but recommended to display environment-specific tiles & filters.
> - Status rules:
>   - **UP**: HTTP success and latency under a threshold.
>   - **DEGRADED**: HTTP success but high latency (~>1200 ms by default).
>   - **DOWN**: HTTP error/timeout/fetch failure.
> - The **Details** dialog supports a “Re-check (detailed)” that captures **HTTP code** and a few **headers** for the last 5 checks.

### Selective QA Health URL Example

If your health endpoint is:

```
https://services-claims-qa.selective.com/claims/apis/process/policy/health
```

Add it like this:

```json
{
  "endpoints": [
    {
      "name": "Policy • Process (QA)",
      "method": "GET",
      "url": "https://services-claims-qa.selective.com/claims/apis/process/policy/health",
      "environment": "Test"
    }
  ]
}
```

This endpoint should return **HTTP 200 OK**; the body may include a keyword like “health” or “OK”.  
(The app primarily evaluates HTTP success and latency. DEGRADED uses latency thresholds.)

### Multiple Environments Example

```json
{
  "endpoints": [
    {
      "name": "Policy • Process (Dev)",
      "method": "GET",
      "url": "https://services-claims-dev.selective.com/claims/apis/process/policy/health",
      "environment": "Development"
    },
    {
      "name": "Policy • Process (QA)",
      "method": "GET",
      "url": "https://services-claims-qa.selective.com/claims/apis/process/policy/health",
      "environment": "Test"
    },
    {
      "name": "Policy • Process (Staging)",
      "method": "GET",
      "url": "https://services-claims-stg.selective.com/claims/apis/process/policy/health",
      "environment": "Staging"
    },
    {
      "name": "Policy • Process (Prod)",
      "method": "GET",
      "url": "https://services-claims.selective.com/claims/apis/process/policy/health",
      "environment": "Production"
    }
  ]
}
```

> **Tip:** Keep names consistent: `Domain • Endpoint (Env)` reads well in the table and dialog.

### Verifying Your Endpoint

1. Edit `src/assets/apis.json` and save.  
2. Reload the app (auto-reload usually suffices).  
3. The new row appears immediately; health/latency fill in as checks complete.  
4. Click the **info** icon to open the **Details** dialog and press **Re-check (detailed)** to capture **HTTP code** and **headers**.

> **CORS**  
> If your endpoint doesn’t allow requests from `http://localhost:4200`, the browser will block it and you’ll see **DOWN**.  
> For internal environments, add CORS for the app origin or proxy through an internal gateway.

---

## Code Scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

---

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory.  
By default, the production build optimizes your application for performance and speed.

**Production build:**
```bash
ng build --configuration production
```

---

## Running Unit Tests

To execute unit tests with the [Karma](https://karma-runner.github.io) test runner, use:

```bash
ng test
```

---

## Running End-to-End Tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

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
    apis.json                 <-- add/edit your endpoints here
  theme/
    selective.css             <-- brand tokens / global styling
```

- **Dashboard**: Executive tiles (UP / DEGRADED / DOWN / Success Rate / Avg & p95 Latency) and a latency **sparkline** for the latest sweep.  
- **API**: Branded grid of endpoints with **status pills**, **latency**, and action buttons (Open / Re-check / Details).  
- **Details dialog**: Shows **HTTP code**, a small set of **response headers**, and **Last 5 checks** with timestamps.

---

## Branding & Theming

Brand tokens live in `src/theme/selective.css` (plain CSS variables), which drive:

- Toolbar, sidenav, cards, borders, shadows, radii  
- Material controls (buttons, inputs, progress, chips)  
- Status colors: **UP**, **DEGRADED**, **DOWN**

To align tighter with selective.com, adjust:
- Colors: `--sel-ink`, `--sel-muted`, `--sel-accent`, `--sel-divider`
- Shape/elevation: `--sel-radius-md`, `--sel-radius-lg`, `--sel-shadow-card`

---

## Troubleshooting

**Node.js version error**  
> *“The Angular CLI requires a minimum Node.js version of v20.19 or v22.12.”*  
Use `nvm` to install/use Node 20.19+ (or upgrade your local Node installation).

**`assets/apis.json` 404**  
- Ensure `src/assets/apis.json` exists.  
- In `angular.json`, verify:
  ```json
  "assets": ["src/favicon.ico", "src/assets"]
  ```

**Slow first paint**  
- The app renders **before** checks begin; if it still feels slow, ensure endpoints are reachable and consider lowering sweep concurrency in the service (default ~6).

**CORS / 401 / 403**  
- Browser-based fetching requires CORS; expose a non-auth health path or proxy the calls.

**Dialog overflow / horizontal scroll**  
- The dialog CSS forces **vertical-only** scroll and wraps long URLs/headers; ensure you have the latest `api-details.dialog.scss`.

---

## Additional Resources

- [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli)  
- [Angular Material](https://material.angular.io/)  
- [CORS Guide (MDN)](https://developer.mozilla.org/docs/Web/HTTP/CORS)

---
