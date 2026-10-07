---
name: fix-health-check
description: Diagnose and fix failures or warnings from the daily "Scraper health" GitHub Actions workflow (scraper-health.yml). Uses the gh CLI to pull the run's results, then works out per company or scraper whether a board moved, a company vanished, a scraper broke, or the run just flaked, and fixes the seed data or scraper accordingly. Use for /fix-health-check, "the health check failed", or a pasted run URL/log.
---

The `Scraper health` workflow (`.github/workflows/scraper-health.yml`) runs daily and on `workflow_dispatch`. It has two steps that each run even if the other fails:

1. **Scraper deep check**: `bun run test src/__tests__/scrapers.test.ts -t 'Ensure Scrapers work'`. For one hand-picked company per scraper class (`TEST_COMPANIES`), it lists jobs, fetches the first job's content, and checks the job shape via `testScraper` (`src/__tests__/testScraper.ts`). A failure here usually means a **scraper** broke.
2. **Board sweep**: `bun run check-boards` (`src/scripts/checkBoards.ts`). It lists jobs for every company in `src/companies.seed.ts`. Output lines:
   - `FAIL <name> (<scraper>, <slug>): Threw: ...`: the board errored after one retry, or returned a non-array. This fails the run.
   - `WARN <name> (<scraper>, <slug>): No real jobs listed`: the board answered but had no real postings, even on the full list. This is a warning only.
   - `N/M boards OK, X failed, Y with no jobs`

A failure in the sweep usually means a **company's seed entry** is stale.

The argument is optional: a run id or URL. Without one, use the latest run.

Requires the `gh` CLI, authenticated for this repo (`gh auth status`). If it isn't, ask the user to run `! gh auth login`.

## Step 1: Pull the results

```sh
gh run list --workflow scraper-health.yml -L 5
RUN=<id>   # the latest run, or the one the user named
gh run view $RUN --json conclusion,jobs --jq '{conclusion, failed: [.jobs[].steps[] | select(.conclusion=="failure") | .name]}'
```

Only failed steps show up in `--log-failed`. To also catch warnings from a green run, grep the full log:

```sh
gh run view $RUN --log > "$TMPDIR/health.log"
grep -E "FAIL |WARN |boards OK|\(fail\)|error:" "$TMPDIR/health.log" | cut -c1-300
```

Never read the whole log into context; it's long.

Before investigating anything, check the findings against the current seed. The run may predate a fix that's already on `main`, or the fix may be committed locally and not pushed. In that case `git log origin/main..main` shows it, and the answer is "push". Also check the **Known warnings** list at the bottom.

## Step 2: Triage each finding

Reproduce locally first, scoped to the companies involved:

```sh
TEST_COMPANIES="Amplitude, Postman" bun run test src/__tests__/scrapers.test.ts -t 'Ensure Scrapers work' > "$TMPDIR/t.log" 2>&1
grep -E "\((pass|fail)\)|^ *[0-9]+ (pass|fail)|error" "$TMPDIR/t.log"
```

`TEST_COMPANIES` takes any seeded company names, not just the default picks. Then match the symptom:

| Symptom                                                                  | Likely cause                                                                   | Go to               |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ------------------- |
| Sweep `FAIL` with `404`                                                  | Company moved boards, or the board is gone                                     | Step 3              |
| Sweep `WARN` no real jobs                                                | No openings right now, **or** the company moved and left an empty board behind | Step 3, then decide |
| `429` / timeouts / `5xx`, passes locally                                 | Rate limiting or a flake                                                       | Step 5              |
| Deep check fails, or many companies on the **same scraper** fail at once | The board's API changed and the scraper broke                                  | Step 4              |

## Step 3: Find where a company's jobs live now

Probe the slug-based boards that have JSON APIs, counting real postings rather than trusting the HTTP status. SmartRecruiters returns 200 with `totalFound: 0` for any name, and Ashby answers 200 for an empty board:

```sh
for s in SLUG1 SLUG2; do echo "$s gh=$(curl -s https://boards-api.greenhouse.io/v1/boards/$s/jobs | grep -o '"absolute_url"' | wc -l | tr -d ' ') ashby=$(curl -s https://api.ashbyhq.com/posting-api/job-board/$s | grep -o '"title"' | wc -l | tr -d ' ') lever=$(curl -s "https://api.lever.co/v0/postings/$s?mode=json" | grep -o '"hostedUrl"' | wc -l | tr -d ' ') sr=$(curl -s "https://api.smartrecruiters.com/v1/companies/$s/postings?limit=1" | grep -o '"totalFound":[0-9]*') workable=$(curl -s https://apply.workable.com/api/v1/widget/accounts/$s | grep -o '"shortcode"' | wc -l | tr -d ' ')"; done
```

Try the obvious variants too: `company`, `companyinc`, `company-labs`, `companyhq`, and a subsidiary form such as `neteasegames`.

Then check the company's own careers page. Use `curl -sL -w '%{url_effective}'`, since a careers subdomain often redirects straight to the board: `careers.console.com` redirects to `jobs.ashbyhq.com/console`. Sniff the HTML with the package's own detector rather than a hand-rolled regex:

```sh
curl -sL -A 'Mozilla/5.0' "https://example.com/careers" -o "$TMPDIR/p.html"
bun --conditions=job-scraper-source -e "
  import { findBoardsInPage } from './src/sniff.ts';
  console.log(findBoardsInPage(await Bun.file('$TMPDIR/p.html').text()));
"
```

It can return several candidates, ranked by hits. Probe each one, since a page can mention a sibling company's board: `weekend.com/careers` also references `volleythat`.

`resolveCompany` won't help for a company that's already seeded: it trusts the seed entry and returns the stale board.

Watch for these:

- **A non-empty board can still be dead.** A board whose only posting is years old (check `publishedAt` / `updated_at`) is a forgotten trial account, not where the company hires.
- **A subsidiary board** (e.g. NetEase Games on Greenhouse for NetEase) covers only part of the company. Rename the seed entry to match what the board covers, and confirm with the user first.
- **A careers page that renders with JavaScript** shows no board links to `curl`. Ask the user to open it in a browser and paste a job posting URL; `parseJobUrl` turns that into scraper and slug (Postman's Workday board was found this way). Don't drive a browser to scrape it yourself.
- **A bespoke careers site with no supported board** needs a new scraper. That's the `create-scraper` skill, not this one.

## Step 4: Fix

**Seed data** (`src/companies.seed.ts`):

- To move a company, change `scraper` and `slug`, plus `homepage` / `domains` if they changed.
- For a Workday or other URL-derived slug, get it from a real posting URL:
  ```sh
  bun --conditions=job-scraper-source -e "import { parseJobUrl } from './src/resolve.ts'; console.log(parseJobUrl('<posting url>'))"
  ```
- Remove a company only when no live board can be found. Confirm removals and renames with the user first; moving a company to a board you verified with real postings doesn't need confirmation.
- Keep the list sorted by name. `bun run test` checks that names stay unique once normalized.

**Broken scraper** (deep check, or a whole scraper class failing): inspect the board's current API response with `curl`, then fix the scraper class in `src/scrapers/`. Keep `ListedJob` / `Job` shapes intact. If a `TEST_COMPANIES` pick itself went stale, replace it with another seeded company on the same scraper. A test enforces that every scraper stays covered.

**Script/workflow bug**: fix it in `src/scripts/checkBoards.ts` or the workflow. Zero real jobs must stay a warning, and errors must stay failures; the user decided both.

## Step 5: Flakes and rate limits

If a failure is a `429`, a timeout or a `5xx` and passes when re-run locally:

1. Re-run the workflow: `gh run rerun $RUN --failed` (or `gh workflow run scraper-health.yml`), then `gh run watch`.
2. If the same board flakes across several runs, fix the cause in `checkBoards.ts` rather than the seed. The sweep retries once after a 2s delay, so the usual fix is a longer delay or a backoff for `429`.

## Step 6: Verify and hand off

```sh
TEST_COMPANIES="<changed companies>" bun run test src/__tests__/scrapers.test.ts -t 'Ensure Scrapers work'
bun run test && bun run lint && bun run typecheck
```

Optionally run the whole `bun run check-boards` locally. It hits every board, so pipe it to a file and grep the `FAIL`, `WARN` and summary lines. Avoid running it repeatedly; some boards rate-limit (NVIDIA has returned 429s).

Commit each logical fix separately. Don't push unless the user asks. Report per company: what was wrong, the evidence (job counts, redirect, posting URL), and the fix. List anything left as a warning and why.

When a `WARN` company is confirmed to be on its correct board with genuinely no openings, add it to **Known warnings** below with the date, so the next run doesn't re-investigate it. Remove an entry once that company has jobs again or has been moved.

## Known warnings

Each of these was verified as the company's correct board, with no openings at the time:

- **Console** (Ashby `console`), 2026-10-07: `careers.console.com` redirects to this board.
- **Weekend** (Ashby `weekend`), 2026-10-07: `weekend.com/careers` embeds this board.
- **Kinelo** (Greenhouse `kinelo`), 2026-10-07: the board exists. No other board was found, but the careers page shows no board links in its HTML, so a JS-rendered board wasn't ruled out. Re-check if it stays empty for weeks.
