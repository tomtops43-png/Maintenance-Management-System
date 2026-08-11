# Maintenance Management System (MMS ENC H9)

BM (แจ้งซ่อม) + PM (บำรุงรักษาเชิงป้องกัน) สำหรับไลน์ผลิต ENC H9

**Stack:** Vanilla HTML/CSS/JS (ไม่มี framework/build step) on GitHub Pages · Google Apps Script backend (`gas/Code.gs`) · Google Sheets as DB · Google Drive for photos · LINE Notify for alerts.

## Git workflow — commit & push automatically, no need to ask

The owner wants every completed, verified change **committed and pushed to `origin/main` automatically** — don't stop to ask "should I push?" each time. This repo is the deployed artifact (GitHub Pages serves directly from it), so pushing is the normal, low-risk last step of a task, not a separate decision.

Do still apply judgment:
- Run the relevant validation first (see below) before committing.
- Use a clear, descriptive commit message explaining *why*, following the style of existing commits (`git log --oneline` to match tone).
- Still pause and ask before anything genuinely destructive (force-push, `git reset --hard`, rewriting history) — that guidance is unchanged. Routine `git add` / `git commit` / `git push origin main` on new work is pre-authorized.
- If a change is large/risky/ambiguous in intent, it's fine to summarize what you're about to push before doing it — just don't block on a yes/no.

## Before committing frontend changes

1. **Syntax-check every touched `.js` file**: `node --check js/whatever.js`
2. **Check HTML div balance** after editing markup (mismatched tags are easy to introduce silently):
   ```bash
   echo "<div>=$(grep -o '<div' file.html | wc -l) </div>=$(grep -o '</div>' file.html | wc -l)"
   ```
3. **Bump the cache-busting version** on every page if you touched any `css/*.css` or `js/*.js` file. All `<link>`/`<script>` tags across all 7 pages carry a shared `?v=N` query string — GitHub Pages/browsers cache these aggressively otherwise, and the owner has hit "why don't I see my changes" repeatedly when this was missed:
   ```bash
   # find current version first: grep -o '?v=[0-9]*' index.html | head -1
   sed -i 's/?v=OLD/?v=NEW/g' *.html   # every page shares one version — don't list files by hand
   ```
4. **Run the test suite** if you touched `gas/Code.gs` — it covers sheet
   routing, the auth check, CONFIG migrations and the MTTR/MTBF maths:
   ```bash
   node test/run.js
   ```
5. If you touched `gas/Code.gs`, syntax-check it too (Apps Script has no `.gs` runner locally — copy to a `.js` temp file and `node --check` that):
   ```bash
   cp gas/Code.gs "$TEMP/Code.js" && node --check "$TEMP/Code.js"
   ```

## Backend deploys are NOT automatic — always call this out

Pushing to GitHub instantly updates the live GitHub Pages site (frontend). It does **not** touch the Google Apps Script backend — that lives in the user's Apps Script editor, outside git, and Claude has no access to deploy it. **Whenever `gas/Code.gs` changes, end the response by telling the user explicitly**:
1. Copy `gas/Code.gs` into the Apps Script editor (paste over the whole file)
2. `Deploy ▸ Manage deployments ▸ ✏️ ▸ Version: New version ▸ Deploy` (reuses the existing URL — do **not** create a brand-new deployment, that mints a different URL and requires updating `js/config.js`)
3. If sheet structure changed, mention running `ensureSheets` once from the editor's function dropdown

Frontend-only changes need none of this — just push and tell the user to refresh (no hard-refresh needed once cache-busting is bumped correctly).

## Production areas ("books") — more than one line group lives here now

BM data is split per production area, each with its own sheet pair, MT Job No.
prefix and Drive photo folder. The `BOOKS` map at the top of `gas/Code.gs` is
the single source of truth:

| Area | Lines | Request sheet | Repair sheet | เลขงาน | รูป |
|---|---|---|---|---|---|
| `ENC` (default) | Line 1 / 4 / 5 | `Record แจ้งซ่อม H9` | `Record ซ่อม H9` | `06082026-1` | `Maintenance_Photos/ENC H9/…` |
| `ASSY` | Assembly M/C | `Record แจ้งซ่อม ASSY` | `Record ซ่อม ASSY` | `AS-06082026-1` | `Maintenance_Photos/Assembly M-C/…` |

**`Record แจ้งซ่อม ` and `Record ซ่อม` are read-only archives now.** They predate
this app (legacy A–J columns; the repair one is a Google Form response sheet)
and the app no longer writes to either. ENC's book names them as `reqArchive` /
`repArchive`, and `bookRequestSheets()` / `bookRepairSheets()` return the live
sheet *first* — every reader dedupes by MT Job No. and takes the first hit, so
`migrateH9ToOwnSheets()` copying rather than moving never double-counts.
Don't reorder those lists, and don't start writing to an archive.

Rules to keep intact when touching this:
- **Every non-default book needs a unique non-empty MT prefix.** `bookForMTJob()`
  resolves a job back to its sheet from the number alone, which is why
  `updateBMStatus`/`closeBM`/`getRepairDetail` don't need the client to say
  which area a job belongs to.
- **Area → book mapping lives in CONFIG** (`Type=Area`, `Value=<ไลน์หลัก>`,
  `Parent=<book key>`), not in code, so an admin can add an area. Anything
  unmapped falls back to `ENC`.
- **Reads merge every book, writes route to one.** `apiGetBMJobs({})` and
  `readRepairRowsFull()` loop over `allBooks()`, so the job board, Dashboard and
  ประวัติ keep showing one combined picture across areas.
- Both request sheets use the **same 20-column layout**, so nothing below the
  routing layer branches per area. The newer sheet just leaves the legacy
  A–J columns (Job order No. / No. / 1%) blank. Don't "clean that up" by
  giving an area its own layout — every reader assumes the shared one.

## Machine selection is three levels, identical for every area

```
ไลน์หลัก (Area)   ไลน์ / เครื่องหลัก (Line)   M/C No. / Station (Station)
ENC H9        ->  Line 1 / 4 / 5          ->  Station 1..21
Assembly M/C  ->  Arc chute, GV.2         ->  Arc chute 06 / 07 / 08
```

All three come from CONFIG, each row naming its parent — adding an area, a
line or a machine is a spreadsheet edit, never a code change:

| Type | Value | Parent |
|---|---|---|
| `Area` | ไลน์หลัก | book key (`ASSY`); blank = default book |
| `Line` | ไลน์/เครื่องหลัก | its area |
| `Station` | M/C | its line — **or blank = shared by every line in `DefaultArea`** |

That blank-Parent case is what keeps ENC H9 working: `Station 1..21` have
always been shared across Line 1/4/5, and still are. **Only the default area
gets that fallback** — any other area must declare its own machines, and until
it does, the line stands in as its own single option (that's why `GV.2` is
currently pickable but has no sub-machines).

Levels 2 and 3 are stored in the columns they always used (`Production line`,
`M/C No.`); only the new level 1 needed a column (`Area`, T). **A blank `Area`
cell means the default area** — that's how every record written before areas
existed still reads correctly, so don't "fix" those blanks by backfilling.

`apiGetConfig` returns the flat `Line` / `Station` / `AllMachines` lists
unchanged *plus* `LinesByArea` / `StationsByLine` / `SharedStations` /
`AreaOfLine` / `DefaultArea` — screens that only need "pick a machine" (KB
articles, PM plans) keep using the flat lists.

## CONFIG is cached in sessionStorage — it survives F5

`API.getConfig()` caches for `CONFIG_CACHE_MINUTES` (10) in **sessionStorage**,
which a page reload does *not* clear. Editing CONFIG in Google Sheets and then
refreshing shows the old dropdowns — this has already burned the owner once.
Saving from the Settings page calls `API.clearConfigCache()` automatically;
a sheet edit needs the "🔄 โหลดค่าใหม่จากชีต" button there (or closing the tab).

## Never trust the `user` object on a request

The Web App is deployed "Anyone" and its URL ships in `js/config.js` on a public
site, so `req.user` is entirely attacker-controlled — a claimed `role: 'Admin'`
used to be enough to wipe USERS/CONFIG. Anything destructive must call
`requireAdmin(user)` / `resolveUser(user)`, which look the caller up by the
session token this script issued at login and read their real role out of the
USERS sheet. **Never re-introduce a check that reads `user.role` directly.**

Sessions live in the `SESSIONS` sheet (30 days, purged by `dailyScan`), with a
6h CacheService layer in front. The token is stored client-side inside the
existing `mms_user` blob, so it rides along on every request already;
`Auth.isLoggedIn()` treats a stored login without one as signed out.

## Known fragile spots (learned the hard way this project)

- **`USERS` sheet columns are read by header name, not position** (`userColMap()` in Code.gs) — this was added after someone manually deleted the "Line" column and broke login for every account by shifting PIN into the wrong slot. Don't reintroduce fixed-index reads (`row[4]` etc.) against USERS.
- **Google Sheets silently converts numeric-looking text to numbers**, dropping leading zeros (`"0001"` → `1`). Emp_ID/PIN comparisons go through `stripLeadingZeros()` / `normalizePin()` to stay tolerant of this regardless of how the sheet stores them.
- **`Record ซ่อม` began as a Google Form response sheet** — a column per issue
  type (`Machanical`/`Electrical`/`Software`/`Camera&Vision`) plus Thai
  date/time headers, where the app writes a flat `Main_Issue`+`Issue` pair.
  That's why it's an archive now rather than a write target.
  `readRepairRowsFromSheet()` reads both shapes and must keep doing so — its
  header matching is all one block, so extend that, not the callers.
- **Anything that writes to a sheet this spreadsheet owns should go through
  `writeRowsChunked()` / `withSheetRetry()`.** The file carries enough
  dependent formulas that Sheets throws "Service Spreadsheets timed out" on
  plain large writes — it has, twice, mid-migration. Write in blocks, retry
  the transient failure, and order operations so an interrupted run leaves
  something valid behind.
- **Role-based access** (`js/auth.js` `roleGroup()`) collapses messy real-world role strings (`"Leader Technician A"`, `"Leader B"`, etc.) into 3 functional groups: `admin` / `tech` (ผู้ซ่อม) / `leader` (หัวหน้ากะ). Match order matters — "Technician" must be checked before "Leader" since "Leader Technician" contains both words.
