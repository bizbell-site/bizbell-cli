---
name: bizbell-alerts
description: >-
  Manage a user's BizBell favorites (관심 공고 즐겨찾기) and keyword alerts (키워드 알림) for Korean
  government notices: 창업지원, 나라장터 입찰, 기업지원, R&D. Use when the user wants to save, list or
  remove a notice, set up keyword or region alerts, change the daily alert email, or asks
  "what new notices matched my alerts since yesterday". Requires Google sign-in.
compatibility: Requires Node.js 18+ and network access to bizbell.site. Needs a BizBell API key (Google sign-in).
metadata:
  author: bizbell
  version: "0.1.0"
---

# BizBell favorites and alerts

`bizbell` in the commands below stands for `npx -y https://bizbell.site/cli/bizbell-0.1.0.tgz`. Use `bizbell` as is only if it is already installed. Always add `--json`. Sign in first as described in the bizbell-notices skill (`bizbell whoami --json`, then `BIZBELL_API_KEY` or `bizbell login`).

## Ask before changing anything

Adding or removing favorites and alerts, and changing email settings, changes the user's account. Tell the user exactly what you are about to do and wait for a yes. Delete commands refuse to run without `--yes`; add it only after the user agreed.

## Favorites

```bash
bizbell fav ls --json                                   # --status active|expired|all
bizbell fav add "nara:R26BK01752060" --memo "3월 신청 검토" --json
bizbell fav rm "<favorite id from fav ls>" --yes --json
```

## Keyword alerts

An alert is one category (`startup`, `bid`, `support`, `rnd` or `all`), include keywords (any one matches, 2 to 50 characters each), and optional exclude keywords and regions. Matches are emailed once a day and can also be polled.

```bash
bizbell alerts ls --json            # check first and reuse a close alert instead of adding a duplicate (free plan: 5)
bizbell alerts add --name "AI 바우처" -c support --include "AI,바우처" --exclude "교육" --region 서울 --json
bizbell alerts test "<alert id>" --days 7 --json     # preview matches of the last 7 days; sends no email
bizbell alerts matches --since 2026-09-30 --json     # new matches across all alerts (keep meta.as_of)
bizbell alerts settings --json                       # read email settings
bizbell alerts settings --time 08:00 --json          # daily email time (KST); --on / --off / --email (account email only; other addresses are changed on the web)
bizbell alerts rm "<alert id>" --yes --json
```

To poll for new matches, pass the previous response's `meta.as_of` as `--since` (not the time you ran it), and skip notice ids you already reported because a notice can come again. If `meta.truncated` is true, narrow `--since` and ask again.

When you present matched notices, follow the answer rules in bizbell-notices: quote `attribution.text`, read the deadline from `deadline_date`, and tell the user to confirm it at `source_url`.
