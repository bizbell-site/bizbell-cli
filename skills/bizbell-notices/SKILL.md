---
name: bizbell-notices
description: >-
  Search and read Korean government support and procurement notices (공고) with the BizBell CLI:
  창업지원(K-Startup), 기업입찰(조달청 나라장터), 기업지원(기업마당), R&D(IRIS·과기정통부).
  Use when the user asks about 정부지원사업, 창업지원금, 입찰공고, 조달, 나라장터, R&D 과제 공모,
  마감 임박 공고, or wants Korean public grant/tender listings filtered by keyword, region,
  organization, deadline or budget. Read-only; for favorites and alerts use bizbell-alerts.
compatibility: Requires Node.js 18+ and network access to bizbell.site. Needs a free BizBell API key (Google sign-in).
metadata:
  author: bizbell
  version: "0.1.0"
---

# BizBell notices

`bizbell` in the commands below stands for `npx -y https://bizbell.site/cli/bizbell-0.1.0.tgz`. Use `bizbell` as is only if it is already installed. Always add `--json` and parse stdout.

## Sign in

Run `bizbell whoami --json`. If it prints `"authenticated": false` (exit code 3):

- If the user already has a key, ask them to set `BIZBELL_API_KEY` in their own shell. Never ask them to paste a key into the chat.
- Otherwise run `bizbell login`. It prints a URL and a code on stderr, then waits. Show both to the user. They approve with their Google account in the browser, and the CLI saves the key.

## Search

```bash
bizbell search "AI 바우처" -c support --deadline-within 14 --limit 10 --json
bizbell search -c bid --region 서울 --budget-min 100000000 --sort deadline_asc --json
bizbell search -c rnd --updated-since 2026-09-30T00:00:00Z --fields id,title,deadline_date,deadline_at,always_open,source_url,attribution --json
```

| `-c` | 분야 | 원천 |
| --- | --- | --- |
| `startup` | 창업지원 | K-Startup |
| `bid` | 기업입찰 | 조달청 나라장터 |
| `support` | 기업지원 | 기업마당 |
| `rnd` | R&D | IRIS, 과기정통부 |

Repeat `-c` for several categories; omit it for all. `--status` defaults to `open` (`upcoming`, `closed`, `all`). For the next page pass `next_cursor` as `--cursor`. `--region` does not apply to `rnd`. If you narrow `--fields`, keep `deadline_date` and `attribution`. Run `bizbell --help` for every option.

## Read one notice

```bash
bizbell show "nara:R26BK01752060" --json
```

## Answer the user

- For each notice give the title, organization, deadline and `source_url`. The deadline is `deadline_date` (KST date). Many sources (기업마당, IRIS, most K-Startup notices) give only the date, so `deadline_at` (UTC, with time) is often null even when there is a deadline; add the time from `deadline_at` in KST only when it is set. Only when `deadline_date` is null too: say 상시 if `always_open` is true, quote `deadline_text` if present, otherwise say the deadline is not announced (미정).
- Always show where the data came from by quoting `attribution.text` (for example "출처: 조달청 나라장터(공공데이터포털)"). The API terms require it.
- Deadlines and eligibility can change. Tell the user to confirm them in the original notice at `source_url`. Never state that the user is eligible.
- Quote amounts in 원 exactly as returned.

## Errors

- Exit 3: not signed in, see above.
- Exit 4 (`quota_exceeded`, `rate_limited`): tell the user `reset_at` or `retry_after` and stop. Do not retry in a loop.
- Exit 5: the id does not exist. Search again.
