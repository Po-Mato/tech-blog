---
title: "Local-First Agent는 왜 SLO 없이 무너지는가: Zero-Server 시대의 Execution Journal 설계"
date: 2026-04-08
description: "온디바이스 추론과 zero-server code intelligence가 떠오르는 지금, 실무 경쟁력은 모델 연결 수가 아니라 Agent SLO와 Execution Journal 설계에서 갈린다. 이 글은 local-first agent stack의 병목, 운영 지표, TypeScript 구현 패턴을 딥다이브한다."
tags:
  - AI Agents
  - Local-First
  - Zero-Server
  - SLO
  - Observability
  - TypeScript
---

## 배경: 왜 지금 local-first와 zero-server가 다시 뜨는가

오늘 기준 GitHub Trending에는 `google-ai-edge/gallery`, `LiteRT-LM`, `GitNexus`, `qmd` 같은 프로젝트가 강하게 올라와 있습니다. 결은 서로 달라 보여도 공통점은 분명합니다. **추론과 코드 인텔리전스를 최대한 사용자 가까이 끌어오려는 흐름**입니다. 이유는 세 가지입니다.

첫째, latency입니다. agent는 대화 한 번으로 끝나지 않고 계획, 검색, 도구 호출, 검증을 연쇄적으로 수행합니다. 매 단계가 원격 round trip을 타면 체감 속도는 급격히 나빠집니다. 둘째, privacy입니다. 코드베이스, 회의 메모, 운영 문서처럼 민감한 맥락을 로컬에 남기고 싶어 하는 팀이 많아졌습니다. 셋째, cost 구조입니다. 항상 중앙 서버를 거치지 않아도 되는 작업까지 비싼 inference path에 태우는 방식은 오래 못 갑니다.

문제는 여기서 시작됩니다. local-first agent는 빠르고 싸고 사적인 대신, **중앙 로그와 운영 통제가 약해지기 쉽습니다.** Hacker News에서 `Project Glasswing`, `GLM-5.1`, agent orchestration testbed 같은 주제가 동시에 주목받는 것도 같은 맥락입니다. 이제 시장은 capability만 보지 않습니다. 긴 실행을 얼마나 안정적으로 끝내는지, 실패를 얼마나 설명 가능하게 남기는지를 봅니다.

## 아키텍처: local-first agent stack의 실제 병목

로컬 실행이 된다고 운영이 쉬워지는 건 아닙니다. 오히려 병목은 더 숨습니다. 대표 구조는 아래와 같습니다.

```text
[UI / CLI]
   -> [Planner]
   -> [Local Context Index: files, SQLite, IndexedDB]
   -> [Tool Runtime: shell, browser, MCP, local scripts]
   -> [Verifier]
   -> [Execution Journal + Metrics]
```

이 구조에서 핵심은 model이 아니라 runtime입니다. planner가 도구를 잘 골라도 verifier가 없으면 잘못된 결과를 성공으로 착각합니다. tool runtime이 빨라도 journal이 없으면 어떤 단계에서 틀어졌는지 알 수 없습니다. 즉, zero-server agent의 경쟁력은 "로컬에서 돈다"가 아니라 **"로컬에서도 운영이 된다"** 에 있습니다.

## Agent SLO 설계: request metric이 아니라 task metric을 봐야 한다

기존 웹 서비스처럼 p95 latency와 200 응답률만 보면 반쪽짜리입니다. agent는 의미 실패가 더 많기 때문입니다. 실무에서는 아래 네 가지부터 잡는 편이 좋습니다.

- `task_success_rate`: 최종 산출물이 검증까지 통과한 비율
- `time_to_useful_action_ms`: 첫 유의미한 초안, 패치, 검색 결과를 만들기까지의 시간
- `verification_pass_rate`: verifier가 결과를 승인한 비율
- `recovery_rate`: 중간 실패 뒤 fallback 또는 재시도로 복구한 비율

추천 기준도 request가 아니라 run 단위여야 합니다.

```json
{
  "service": "local-agent-runtime",
  "window": "7d",
  "slo": {
    "task_success_rate": 0.92,
    "p95_time_to_useful_action_ms": 30000,
    "verification_pass_rate": 0.95,
    "recovery_rate": 0.60
  }
}
```

이 지표들이 중요한 이유는 간단합니다. local-first stack은 인프라 장애보다 **도구 선택 오류, 컨텍스트 누락, 검증 실패**가 더 자주 문제를 만듭니다. 그래서 runtime이 얼마나 똑똑했는지보다, 실패를 얼마나 빨리 감지하고 회복했는지가 더 큰 차이를 만듭니다.

## Execution Journal 스키마: 블랙박스를 운영 데이터로 바꾸기

Execution Journal은 에이전트의 step 로그를 단순 텍스트가 아니라 집계 가능한 구조로 남기는 방식입니다. 최소 스키마는 아래 정도면 충분합니다.

```json
{
  "runId": "run_2026_04_08_001",
  "spanId": "plan.s2.tool.browser",
  "step": 2,
  "toolCall": {
    "name": "browser.snapshot",
    "args": { "target": "host", "url": "https://github.com/trending" }
  },
  "latencyMs": 1840,
  "verification": {
    "status": "pass",
    "rule": "contains_project_names"
  },
  "recoveryHint": "snapshot 실패 시 web_fetch로 축소 수집 후 sourceConfidence를 낮춰 기록"
}
```

포인트는 다섯 가지입니다.

- `spanId`: trace와 journal을 연결하는 축
- `step`: planner 순서를 복원하는 최소 단서
- `toolCall`: 실패를 재현할 수 있는 실행 문맥
- `latencyMs`: 체감 성능과 병목 분석의 기준
- `verification`과 `recoveryHint`: 단순 기록이 아니라 다음 행동을 유도하는 운영 데이터

## TypeScript 예시: journal을 남기며 도구 실행하기

아래 예시는 Next.js 또는 Node.js runtime 어디서든 쓸 수 있는 단순 패턴입니다.

```ts
import { appendFile } from "node:fs/promises";

type JournalEntry = {
  runId: string;
  spanId: string;
  step: number;
  toolCall?: { name: string; args: Record<string, unknown> };
  latencyMs: number;
  verification: { status: "pass" | "fail"; rule: string };
  recoveryHint?: string;
};

async function record(entry: JournalEntry) {
  await appendFile("./var/execution-journal.jsonl", JSON.stringify(entry) + "\n");
}

export async function runToolWithJournal<T>(input: {
  runId: string;
  spanId: string;
  step: number;
  toolName: string;
  args: Record<string, unknown>;
  invoke: () => Promise<T>;
  verify: (result: T) => boolean;
}) {
  const started = Date.now();

  try {
    const result = await input.invoke();
    const passed = input.verify(result);

    await record({
      runId: input.runId,
      spanId: input.spanId,
      step: input.step,
      toolCall: { name: input.toolName, args: input.args },
      latencyMs: Date.now() - started,
      verification: {
        status: passed ? "pass" : "fail",
        rule: "result-schema-and-domain-check"
      },
      recoveryHint: passed ? undefined : "fallback to cached context or ask human review"
    });

    if (!passed) throw new Error("verification_failed");
    return result;
  } catch (error) {
    await record({
      runId: input.runId,
      spanId: input.spanId,
      step: input.step,
      toolCall: { name: input.toolName, args: input.args },
      latencyMs: Date.now() - started,
      verification: { status: "fail", rule: "runtime-exception" },
      recoveryHint: "retry once, then degrade to read-only path"
    });
    throw error;
  }
}
```

이 패턴의 장점은 화려하지 않지만 확실합니다. 나중에 Prometheus나 OpenTelemetry를 붙이더라도, 먼저 JSONL 기반 journal만으로 run 단위 회고와 실패 분석이 가능해집니다.

## 운영 체크리스트: local agent를 실제 서비스로 만들려면

- 쓰기 동작 전에는 항상 verifier를 두기
- 외부 부작용이 있는 step은 approval gate와 분리하기
- tool 실패를 숨기지 말고 `recoveryHint`까지 남기기
- cache hit, fallback 사용 여부를 journal에 같이 기록하기
- 성공률보다 `time_to_useful_action` 악화를 먼저 감지하기

## 결론

2026년의 흥미로운 변화는 모델이 더 강해졌다는 사실만이 아닙니다. **agent runtime이 서버 밖으로 내려오고 있다는 점**입니다. 이때 진짜 경쟁력은 local inference 자체가 아니라, 그 실행을 설명하고 복구하고 검증할 수 있는 운영 구조입니다.

정리하면 이렇습니다. local-first는 속도와 privacy를 주고, zero-server는 비용 효율을 줍니다. 하지만 실무 경쟁력은 거기서 끝나지 않습니다. **Agent SLO와 Execution Journal이 있어야 비로소 운영 가능한 시스템이 됩니다.** 앞으로 강한 팀은 더 많은 agent를 붙인 팀이 아니라, 더 적은 실패를 더 빨리 이해하는 팀일 가능성이 큽니다.
