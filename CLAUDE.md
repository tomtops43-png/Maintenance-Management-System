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
   sed -i 's/?v=OLD/?v=NEW/g' admin.html jobs.html pm.html dashboard.html login.html history.html index.html
   ```
4. If you touched `gas/Code.gs`, syntax-check it too (Apps Script has no `.gs` runner locally — copy to a `.js` temp file and `node --check` that):
   ```bash
   cp gas/Code.gs "$TEMP/Code.js" && node --check "$TEMP/Code.js"
   ```

## Backend deploys are NOT automatic — always call this out

Pushing to GitHub instantly updates the live GitHub Pages site (frontend). It does **not** touch the Google Apps Script backend — that lives in the user's Apps Script editor, outside git, and Claude has no access to deploy it. **Whenever `gas/Code.gs` changes, end the response by telling the user explicitly**:
1. Copy `gas/Code.gs` into the Apps Script editor (paste over the whole file)
2. `Deploy ▸ Manage deployments ▸ ✏️ ▸ Version: New version ▸ Deploy` (reuses the existing URL — do **not** create a brand-new deployment, that mints a different URL and requires updating `js/config.js`)
3. If sheet structure changed, mention running `ensureSheets` once from the editor's function dropdown

Frontend-only changes need none of this — just push and tell the user to refresh (no hard-refresh needed once cache-busting is bumped correctly).

## Known fragile spots (learned the hard way this project)

- **`USERS` sheet columns are read by header name, not position** (`userColMap()` in Code.gs) — this was added after someone manually deleted the "Line" column and broke login for every account by shifting PIN into the wrong slot. Don't reintroduce fixed-index reads (`row[4]` etc.) against USERS.
- **Google Sheets silently converts numeric-looking text to numbers**, dropping leading zeros (`"0001"` → `1`). Emp_ID/PIN comparisons go through `stripLeadingZeros()` / `normalizePin()` to stay tolerant of this regardless of how the sheet stores them.
- **The legacy `Record ซ่อม` sheet** has a different column layout than what this app writes (per-type columns like `Machanical`/`Electrical` instead of a single `Main_Issue`+`Issue` pair). `readRepairRowsFull()` in Code.gs coalesces both layouts — don't assume a single fixed shape when reading that sheet.
- **Role-based access** (`js/auth.js` `roleGroup()`) collapses messy real-world role strings (`"Leader Technician A"`, `"Leader B"`, etc.) into 3 functional groups: `admin` / `tech` (ผู้ซ่อม) / `leader` (หัวหน้ากะ). Match order matters — "Technician" must be checked before "Leader" since "Leader Technician" contains both words.
