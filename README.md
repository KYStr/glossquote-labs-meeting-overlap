# Meeting overlap · 會議空檔交集

Find the continuous windows when everyone is available on one day. Enter each person's availability in the same time basis and a meeting length, then read the common windows and latest possible start times. Chinese is `/index.html`; English is `/en/index.html`.

Intervals include their start and exclude their end. Each person's overlapping or touching intervals merge before the all-person intersection. A window remains only if the full meeting fits. Start ranges include both ends, in whole minutes. `24:00` is an end time for the selected day, never a start or a time-zone conversion.

This page does not read calendars, send invitations, save schedules, convert time zones or daylight saving time, copy to the clipboard, download, print, or share. Inputs and reports stay in the current page's memory. Editing clears the old result; clearing or switching language asks before discarding work. Leaving clears inputs, and a restored page starts empty. The first visit still needs the website files; permanent offline loading is not promised.

## Run and verify

Use Node.js 24 or newer. No package installation or external dependency is needed.

```sh
npm test
npm run check
npm run build
npm run dev
```

The noindex development preview binds only to `127.0.0.1:4214`. Each new workspace has an empty date and shared time basis, a 60-minute length, and two blank participants with one blank interval each.

```sh
npm run build:production
npm run check:production
npm run release:check
npm run preview:production
```

Production output is separate in `dist-production/`. The sibling `dist-production.manifest.json` stays outside the deployable assets. The production HTTP model binds only to `127.0.0.1:5214`; it checks the exact files/bytes, GET/HEAD/MIME, SEO, JSON-LD hashes, security headers, canonical redirects, closed routing, 404/405 and Host restrictions. The model rejects query routes deliberately. CDN query behavior and default/redirect headers need hosting acceptance; Cloudflare applies `_redirects` before `_headers`.

The configured production origin is `https://meet.glossquote.com`. Publishing this source does not establish a deployed or verified live site. Hosting and homepage integration are separate stages. The static-assets-only configuration has no Worker script, binding, secret, build hook, external asset or runtime dependency. Observability, logs, traces, workers.dev, preview URLs and CLI metrics are disabled in the reviewed configuration.

## Data contract

The four pure exports are in `public/js/core/meeting-overlap.mjs`: `validateDraft`, `calculateMeetingWindows`, `formatClock`, and `buildPlainTextReport`. The exact schema, error precedence and report templates are in `TECHNICAL.md` at the source repository root.

Use 2–20 participants, 1–12 intervals each, at most 240 intervals, and a meeting length of 1–1440 whole minutes. Dates are real Gregorian `yyyy-mm-dd` labels from year 0001 through 9999. Times are ASCII `HH:MM`; all inputs already share one time basis. Names and the shared-basis label are trimmed plain Unicode text, bounded and never treated as markup. Validation rejects unknown keys, accessors, holes, non-plain records, controls and unpaired surrogates without echoing values. Array length resource gates reject excess people or intervals before enumerating indexes. Proxy safety is not claimed.

## Verification limits

The frozen M1 source passed 310 offline tests and primary isolated-browser checks of both languages, exact results/errors, invalidation, clear/language confirmation, protocol keyboard focus, 320 CSS px/dense 20-person and 240-interval operation, no-JS behavior, initial-load through hidden/pagehide Network/Storage, and real BFCache reset. The real BFCache result observed `pageshow.persisted=true` in both languages. These are local preview observations, not production-host evidence.

Real Chinese IME, an actual screen reader, physical iOS/Android or low-end devices, virtual keyboards and native 200% browser zoom remain unverified manual exclusions. CSS text enlargement and synthetic composition retain narrower scopes. No external review completion or live-site acceptance is claimed by this source release.

繁中：手動輸入同一天、同一時間基準的空檔，找出所有人皆可出席且足以容納整場會議的窗口。本工具不連接行事曆、不轉換時區、不傳送邀請或保存資料；來源公開與正式上線分開驗收。
