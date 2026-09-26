# Migrate WebView + vanilla-JS frontend to a unified React + NativeWind codebase

## Context

Today the gateway UI is a hand-rolled vanilla-JS/HTML SPA (`src/gateway/gui/frontend/`, ~4,700 lines across `main.js` + 18 `render*.js` files) that gets string-concatenated by `scripts/build-frontend.mjs` into `frontend.generated.ts`, served as one big HTML string by the Hono route in `src/gateway/gui/routes.ts:30-32`. The mobile app (`mobile/App.tsx`) doesn't have its own UI at all — it just points a `WebView` at the same locally-running backend (`http://127.0.0.1:3000`) and gets the identical page. Native device access (SMS, contacts, photos) is bolted on through a fragile `window.AndroidSms` / `window._pdhRN` `postMessage` bridge injected into the WebView.

We want the mobile app to have real native screens instead of a WebView, while still sharing one UI codebase with the web gateway. The chosen approach is React + `react-native-web`, with **NativeWind** for styling rather than Tamagui — the existing frontend already uses Tailwind utility classes extensively (Material 3 color tokens, 600+ class usages), and NativeWind lets that carry over largely as-is instead of hand-porting every class to a props API.

Two things were explicitly verified during research and drive decisions below:
- **`frontend.generated.ts` is still needed**, just produced differently: it's the only mechanism by which the Hono server (and, critically, the *mobile-embedded copy* of that same server) gets a servable page with zero filesystem/static-asset infrastructure. We keep the "one generated string" contract, just generate it with Vite instead of manual concatenation.
- **Secrets handling is completely unaffected.** `scripts/bundle-mobile.cjs` bakes Gmail/Calendar OAuth `clientId`/`clientSecret` from `hub-config.yaml` into the *backend* bundle (`src/android.ts`/`src/ios.ts`) via esbuild `--define`, entirely separate from frontend generation. Nothing in this migration touches that file or mechanism — it needs no changes and no new method.

## Approach

### Serving mechanism (replaces `build-frontend.mjs`)
Use **Vite + `vite-plugin-singlefile`** to produce one self-contained `dist/index.html` (JS+CSS inlined, only the Google Fonts CDN link remains external). A new `scripts/generate-frontend.mjs` reads that file and writes `frontend.generated.ts` with the same `export function getIndexHtml(): string` shape as today — `routes.ts` doesn't change at all. Rejected alternative: Hono `serveStatic` on a `dist/` folder — would require inventing a way to copy a static tree into the mobile APK/IPA and resolve it from nodejs-mobile's filesystem, for no benefit (no real static assets exist today; the whole point of the current design is "one string, no I/O").

Side benefit: killing the Tailwind CDN `<script src="cdn.tailwindcss.com">` tag (replaced by build-time NativeWind/Tailwind) means the page no longer needs network access to render — good for mobile.

### Workspace layout
Turn the repo into npm workspaces (`"workspaces": ["packages/*", "mobile"]` in root `package.json`) and add:
- **`packages/ui`** (`@pdh/ui`) — shared React components/hooks/API client, ships as source (no build step; both Vite and Metro transpile TS/TSX directly).
- **`src/gateway/gui/frontend-web/`** — thin Vite web shell (`index.html`, `main.tsx`, `vite.config.ts`) that mounts `<App/>` from `@pdh/ui`. Replaces `src/gateway/gui/frontend/`.
- `mobile/` becomes a workspace member so it can import `@pdh/ui` directly instead of relative-path hacks.

```
packages/ui/src/
  tabs/            # ported render*Tab.js → OverviewTab.tsx, GmailTab.tsx, ...
  components/      # ported render*Card.js etc.
  hooks/           # useAppState (ported main.js state/routing), useSms, useChat, ...
  api/client.ts    # fetch wrapper; api/baseUrl.web.ts returns '', api/baseUrl.native.ts returns 'http://127.0.0.1:3000'
  device/
    deviceBridge.ts         # shared interface
    deviceBridge.native.ts  # calls NativeModules.SmsModule/ContactsModule/PhotosModule directly
    deviceBridge.web.ts     # "unavailable on web" stubs
  theme/tailwind.tokens.ts  # Material3 palette ported from index.html's tailwind.config
  App.tsx          # shared tab router
```

### Key technical decisions
- **NativeWind v4 + Tailwind v3** (NativeWind v4 requires Tailwind v3, not v4 — pin explicitly).
- Verify `react-native-web` compatibility with RN 0.86 + React 19.2.3 first (Phase 0) — the one real compatibility risk.
- Raw inline `<svg>` icons in the current render files → standardize on `react-native-svg` components, shared across web/native.
- Metro (`mobile/metro.config.js`) needs `watchFolders` including `packages/ui`, plus NativeWind's `withNativeWind` wrapper and `nativewind/babel` in `mobile/babel.config.js`. Keep the existing `nodejs-assets/.*` blockList entry as-is.
- Vite dev server proxies `/api` → `http://localhost:3000`, giving real HMR for the frontend for the first time (today frontend changes require manually rerunning `build-frontend.mjs`).

### Native bridge replacement (mobile only)
The `SmsModule`/`ContactsModule`/`PhotosModule` native modules themselves don't change — only the JS calling convention does: `window.AndroidSms.getMessages(reqId,...)` + postMessage round-trip becomes a direct `await NativeModules.SmsModule.getMessages(...)` call from `deviceBridge.native.ts`. OAuth deep-link handling moves from `injectJavaScript(window.handlePdhOAuthDeepLink())` to `mobile/App.tsx`'s `Linking` listener calling a shared `useOAuthDeepLink()` hook directly. The WebView's `onShouldStartLoadWithRequest` browser-escape hack for github.com/oauth links goes away entirely — native buttons just call `Linking.openURL()`.

### Migration phasing (strangler pattern — ship incrementally, not big-bang)
This is a working production app; each phase should be independently testable and mergeable.

1. **Phase 0 — Scaffolding.** Set up workspaces, empty `packages/ui` + `frontend-web` skeletons, verify `react-native-web` renders under both Vite and Metro, port Material3 tokens, get NativeWind rendering one styled `<View>` on an emulator, get Vite+singlefile producing a working `frontend.generated.ts`. Nothing user-facing changes.
2. **Phase 1 — Overview tab via strangler route.** `routes.ts` keeps `GET /` on the old page; add temporary `GET /next` serving the new React build. Port `renderOverviewTab.js` and the top-level `state`/`switchTab` logic into `packages/ui` as the template for every later tab (`<div>`→`<View>`, `onclick`→`onPress`, inline styles → NativeWind classNames). Mobile untouched (still WebView → `/`).
3. **Phase 2 — Data-only tabs.** Gmail, Calendar, GitHub tabs + their filter/pill card helpers — chosen next because they're pure fetch/render with no device bridge. Still behind `/next`, mobile still untouched.
4. **Phase 3 — Device-bridge tabs + mobile cutover.** Port SMS, Photo, Contacts tabs *and* build the real `deviceBridge` (native/web split) simultaneously, since these are exactly the tabs that exercise the bridge. Remove `WebView`/`SMS_BRIDGE`/`onMessage`/`injectJavaScript` from `mobile/App.tsx`; mobile now renders `<App/>` from `@pdh/ui` as a native tree, still starting the local Node backend via `nodejs.start()` for API calls. Highest-risk phase — test permission flows and OAuth deep links on a real/emulated device.
5. **Phase 4 — Remaining tabs.** AI/Chat, Memory, Skills, Settings, Onboarding — saved for last since they're most stateful (chat streaming, skill logic-tree editor, onboarding wizard) and the AI tab's device-capability checks depend on Phase 3's `deviceBridge`.
6. **Phase 5 — Cutover and cleanup.** Flip `GET /` to the new build, delete `GET /next`, delete `src/gateway/gui/frontend/`, `scripts/build-frontend.mjs`, `react-native-webview` dependency, and grep-verify zero remaining `window.AndroidSms`/`window._pdhRN` references. Update `build`/`dev` npm scripts to use `generate-frontend.mjs`. Run `npm run build:mobile` once as a smoke test to confirm secret-baking still works untouched.

## Critical files
- `src/gateway/gui/routes.ts` — HTML-serving route, unchanged contract
- `scripts/build-frontend.mjs` → replaced by `scripts/generate-frontend.mjs`
- `src/gateway/gui/frontend/` (all 19 JS files + `index.html`/`style.css`) — source being ported, then deleted in Phase 5
- `mobile/App.tsx` — WebView + bridge removal, native `<App/>` mount
- `mobile/metro.config.js`, `mobile/babel.config.js` — NativeWind + workspace wiring
- `scripts/bundle-mobile.cjs` — confirmed unaffected, do not modify

## Verification
- Phase 0: render a test component via `npm run dev` (Vite) in a browser, and via `react-native run-android` on an emulator; confirm both pick up the same NativeWind classNames.
- Phases 1-2: for each ported tab, load `/` (old) and `/next` (new) side by side against the same live backend and confirm matching data/behavior; run existing tests (`npm test`, `mobile/` jest) after each phase.
- Phase 3: manual on-device QA — grant/deny/revoke SMS & contacts & photos permissions, send/receive a test SMS, complete a Gmail/Calendar OAuth flow via deep link (`adb shell am start -a android.intent.action.VIEW -d "pdh://oauth?..."`).
- Phase 5: full tab-by-tab manual pass on `/` (web) and on-device (mobile); run `npm run build:mobile` end-to-end and confirm `android.js`/`ios.js` still contain the baked OAuth secrets (grep the bundle for the expected client ID string) to prove the secrets mechanism survived untouched.

---

## Progress log (deviations from the original plan)

- **Phase 0 — done.** Workspaces set up (`packages/ui`, `mobile`), Vite + `react-native-web` + NativeWind pipeline verified end-to-end for the web target. Found and fixed a bug: root `tsc` was sweeping `frontend-web`'s browser/JSX code into the backend build since it lives under `src/` — excluded it in root `tsconfig.json`. Native (Metro/on-device) verification was blocked by sandbox limitations (no watchman, no Android emulator, and `react-native bundle` fails to resolve even plain `react-native` on a clean unmodified checkout) — config is wired per NativeWind's docs but unverified on-device.
- **Phase 1 — done, with a scope change.** `renderOverviewTab.js` turned out to be dead code — no nav item in `index.html` ever routes to it (live nav is only `ai`/`skill`/`memory`/`settings`; Gmail/Calendar/GitHub tabs are reachable via Settings → Integrations → "Manage", so Phase 2 is unaffected). Ported the **Gmail tab** instead as the first real template (`packages/ui/src/tabs/GmailTab.tsx`, `hooks/useAppState.ts`, `api/client.ts`, `components/FilterCards.tsx`). Wired `GET /next` for real in `routes.ts`, verified via an automated test that boots the real server and checks `/` is untouched while `/next` serves the React build. A live-browser render check (Playwright) was attempted but abandoned — Chromium download stalled on this sandbox's network egress; recommend a real browser/device check before this reaches users.
- **Phase 2 — done.** Ported **Calendar** (`packages/ui/src/tabs/CalendarTab.tsx`) and **GitHub** (`packages/ui/src/tabs/GitHubTab.tsx`, incl. per-repo permission toggles, owner grouping/filtering, and bulk-apply) tabs. Extended `api/client.ts` (`CalendarEvent`, `GithubRepo`, `getCalendarPreview`, `getGithubRepos`, `saveGithubRepos`) and `hooks/useAppState.ts` with the matching state/actions. `App.tsx` now has a minimal 3-way tab switcher (Gmail/Calendar/GitHub) so `/next` can show all three side by side with `/`. Fixed a pre-existing gap found along the way: `packages/ui/tsconfig.json` was missing `"types": ["nativewind/types"]`, so every NativeWind `className` prop failed `tsc --noEmit` (silently, since nothing had run that check before) — added `packages/ui/nativewind-env.d.ts` and the tsconfig `types` entry; `packages/ui` now typechecks clean. Full `npx vitest run` (183 tests) and the `/next` smoketest both pass against the rebuilt bundle. On-device verification (real Android device via adb) was attempted but not completed — the RN gradle build only works if `mobile/node_modules` has symlinks to several hoisted root packages (`@react-native/gradle-plugin`, `react-native`, and the rest of the `@react-native/*` scope), which isn't done anywhere in the repo/setup scripts; even after symlinking through to a successful `assembleDebug`, the adb device dropped mid-install. Worth turning the symlink workaround into a proper fix (e.g. `nohoist` for `@react-native/*` and `react-native` in root `package.json`'s workspaces config) before the next on-device pass.
