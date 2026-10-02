# bizbell

한국 정부지원·입찰 공고(창업지원·나라장터 입찰·기업지원·R&D)를 조회하는 [BizBell 공고 API](https://bizbell.site/docs/api) CLI 입니다. MCP 서버와 Agent Skill 을 함께 제공합니다.

## 설치

```bash
npx skills add https://bizbell.site                                           # 에이전트에 스킬 설치
npx -y https://bizbell.site/cli/bizbell-0.1.0.tgz login                              # 구글 로그인 → API 키 저장
npx -y https://bizbell.site/cli/bizbell-0.1.0.tgz search "AI 바우처" -c support --json
```

스킬은 GitHub 레포에서도 설치할 수 있습니다: `npx skills add bizbell-site/bizbell-cli`. 스킬은 `bizbell-notices`(공고 검색·조회)와 `bizbell-alerts`(즐겨찾기·키워드 알림) 두 개입니다.

## 예시

```bash
bizbell search -c bid --region 서울 --budget-min 100000000 --sort deadline_asc   # 서울 1억 이상 입찰, 마감 순
bizbell show "nara:R26BK01752060" --json                                          # 공고 1건
bizbell fav add "nara:R26BK01752060" --memo "3월 신청 검토"                         # 즐겨찾기
bizbell alerts add --name "AI 바우처" -c support --include "AI,바우처" --region 서울   # 키워드 알림
```

- `bizbell` 은 위 `npx -y …tgz` 실행 형태를 줄여 쓴 것입니다. 전체 명령: `bizbell --help`
- 환경 변수: `BIZBELL_API_KEY`, `BIZBELL_API_BASE`
- MCP: `claude mcp add bizbell -- npx -y https://bizbell.site/cli/bizbell-0.1.0.tgz mcp`

## 출처 표기

공고를 다시 보여 줄 때는 공고마다 응답의 `attribution.text` 출처(예: "출처: 조달청 나라장터(공공데이터포털)")와 `source_url` 원문 링크를 함께 표시해야 합니다. 원천 API 이용 조건입니다. `--fields` 로 필드를 골라도 `attribution`·`source_url` 은 항상 옵니다. `attribution.license` 가 `KOGL-3`(공공누리 제3유형: 출처표시·변경금지, 예: 기업마당)인 공고는 제목·요약을 바꾸거나 번역하지 말고 그대로 인용하세요. 마감·자격은 바뀔 수 있으니 `source_url` 원문에서 확인하세요.

## 원본과 동기화

이 CLI 의 원본은 BizBell 모노레포(비공개)의 `packages/cli` 입니다. 공개 레포 [bizbell-site/bizbell-cli](https://github.com/bizbell-site/bizbell-cli) 는 그 디렉토리를 한 방향으로 복사한 미러입니다.

- 변경은 모노레포 `packages/cli` 에서 하고 공개 레포로 복사합니다. 공개 레포에서 직접 고치지 않습니다.
- 공개 레포에 온 이슈·PR 은 모노레포에 옮겨 반영한 뒤 다음 동기화로 들어갑니다.
- 공개 레포에만 있는 파일은 `.github/workflows/`(테스트·npm 게시)뿐입니다.

## 라이선스

MIT
