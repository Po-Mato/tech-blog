---
title: "MCP보다 중요한 것: Execution Journal과 Agent SLO로 운영하는 에이전트 시스템"
date: 2026-04-07
description: "2026년의 병목은 MCP 연결 자체가 아니라 운영 가능성이다. 이 글은 HTTP 200만으로는 에이전트 성공을 설명할 수 없는 이유, Agent SLO 설계, Execution Journal 데이터 모델, 그리고 Observability as Code 기반의 실무 도입 패턴을 정리한다."
tags:
  - AI Agents
  - MCP
  - Observability
  - SLO
  - OpenTelemetry
  - Platform Engineering
---

## 들어가는 글

지금 시장에서 MCP(Model Context Protocol)는 분명 중요한 표준입니다. 하지만 실무에서 더 빨리 병목이 되는 지점은 **"연결 여부"** 가 아니라 **"운영 가능성"** 입니다. 툴을 10개 붙인 에이전트가 HTTP 200으로 응답했다고 해서, 그 작업이 실제로 성공했다고 말할 수는 없습니다.

최근 관측 트렌드도 같은 방향을 가리킵니다. IBM은 2026 observability 논의에서 AI 시스템을 AI로 관측해야 하며, 비용 관리와 SLO, 개방형 표준이 같이 설계되어야 한다고 짚었습니다. Grafana의 2026 Observability Survey에서도 anomaly 탐지, root cause 분석, dashboard/query 생성 같은 AI 보조 기능은 높은 가치를 인정받았지만, autonomous action은 여전히 신뢰 격차가 컸습니다. 즉, 팀들은 에이전트를 원합니다. 다만 **통제 가능한 에이전트** 를 원합니다.

오늘의 핵심 주장은 단순합니다.

> 2026년 에이전트 경쟁력은 MCP 통합 개수보다, 실행을 설명하고 검증할 수 있는 Execution Journal과 Agent SLO를 갖췄는지에서 갈린다.

## 왜 HTTP 200과 latency만으로는 agent 성공을 측정할 수 없나

전통적인 APM은 요청 성공률, 응답 시간, 오류율을 잘 보여 줍니다. 하지만 에이전트 시스템은 이 세 가지 지표만으로 설명되지 않습니다. 예를 들어 아래 네 경우는 모두 HTTP 관점에서는 성공처럼 보일 수 있습니다.

- 올바른 툴을 호출했지만 잘못된 문서를 근거로 답변함
- 고객 메일 초안을 생성했지만 개인정보를 과다 노출함
- 5단계 작업을 수행하며 토큰 비용을 과하게 소모함
- 프롬프트 인젝션을 받아 승인 없이 위험한 행동을 제안함

즉, 에이전트의 실패는 네트워크 실패보다 **의미 실패(semantic failure)** 에 가깝습니다. 기존 APM이 보는 것은 "서비스가 응답했는가"이고, 우리가 운영에서 알고 싶은 것은 아래입니다.

- 사용자가 원하는 결과를 실제로 만들었는가
- 중간 단계에서 사람 개입이 필요했는가
- 어떤 툴 체인이 실패를 유발했는가
- 성공 1건을 만들기 위해 얼마의 비용을 태웠는가
- 정책 위반이나 보안 위험이 있었는가

그래서 agent 운영은 request tracing만으로 끝나지 않습니다. **task-level trace + policy decision + human review + outcome verification** 이 함께 남아야 합니다.

## Agent SLO: 에이전트 시스템은 무엇을 목표로 운영해야 하나

웹 서비스 SLO를 그대로 가져오면 반쪽짜리가 됩니다. 에이전트에는 에이전트다운 지표가 필요합니다. 실무에서는 아래 다섯 가지가 특히 유용합니다.

### 1) task_success_rate
사용자가 의도한 작업을 검증 가능한 결과로 끝낸 비율입니다. "응답을 반환한 비율"이 아니라, 사후 검증까지 통과한 비율이어야 합니다.

### 2) time_to_useful_action
최종 완료 시간보다 더 중요한 경우가 많습니다. 첫 유의미한 초안, 첫 정확한 요약, 첫 승인 가능한 제안이 나오기까지 걸린 시간을 봐야 사용자 체감 품질을 알 수 있습니다.

### 3) human_escalation_rate
사람에게 넘긴 비율입니다. 너무 낮으면 위험한 자동화일 수 있고, 너무 높으면 자동화 가치가 낮습니다. 팀의 리스크 허용도에 맞는 목표 범위를 정해야 합니다.

### 4) tool_failure_budget
툴 호출 실패를 얼마나 허용할지 정하는 예산 개념입니다. 단일 task에서 tool error가 몇 번 발생하면 자동 중단하고 사람 검토로 넘길지 정책화해야 합니다.

### 5) cost_per_success
성공 1건당 평균 비용입니다. 에이전트는 요청 1회 비용보다, 성공 1건을 만드는 총비용이 더 중요합니다. 실패 재시도와 과도한 체이닝을 포함해 계산해야 합니다.

아래는 예시 SLO 정의입니다.

```json
{
  "service": "tech-blog-agent",
  "window": "7d",
  "slos": {
    "task_success_rate": { "target": 0.92 },
    "p95_time_to_useful_action_ms": { "target": 45000 },
    "human_escalation_rate": { "target": 0.15, "operator": "<=" },
    "tool_failure_budget": { "target": 0.03, "operator": "<=" },
    "cost_per_success_usd": { "target": 0.35, "operator": "<=" }
  }
}
```

포인트는 지표를 많이 만드는 것이 아닙니다. **팀이 실제로 의사결정을 바꾸게 만드는 지표를 고르는 것** 입니다.

## Execution Journal: 실행을 설명 가능하게 만드는 최소 단위

Execution Journal은 에이전트의 실행 과정을 사람이 읽을 수 있고, 시스템이 집계할 수 있는 형태로 남기는 구조화 로그입니다. 일반 로그보다 더 중요하게 봐야 할 것은 "무슨 API를 쳤나"가 아니라 **왜 그 행동이 일어났고, 어떤 정책 판단 아래 어떤 결과를 냈는가** 입니다.

권장하는 최소 필드는 아래와 같습니다.

```json
{
  "run_id": "run_2026_04_07_001",
  "task": "publish_proactive_blog_post",
  "user_goal": "오늘 기술 트렌드를 반영한 딥다이브 글 게시",
  "started_at": "2026-04-07T11:05:00Z",
  "model": "google/gemini-3-flash-preview",
  "steps": [
    {
      "step_id": "s1",
      "type": "research",
      "action": "fetch_trend_sources",
      "inputs": ["IBM", "Grafana", "Iris"],
      "output_summary": "AI observability, trust gap, SLO focus 확인",
      "latency_ms": 2480,
      "cost_usd": 0.02,
      "status": "ok"
    },
    {
      "step_id": "s2",
      "type": "policy",
      "action": "topic_dedup_check",
      "policy_result": "pass",
      "reason": "2026-04-05 MCP/data-mesh 글과 주제 분리"
    },
    {
      "step_id": "s3",
      "type": "tool_call",
      "action": "write_post_file",
      "target": "content/posts/2026-04-07-proactive-update.md",
      "status": "ok"
    }
  ],
  "outcome": {
    "useful_action_at": "2026-04-07T11:08:30Z",
    "verification": ["frontmatter_valid", "build_passed", "git_push_passed"],
    "success": true,
    "human_escalated": false,
    "total_cost_usd": 0.19
  }
}
```

이 Journal이 있어야 장애 분석도 쉬워집니다. 예를 들어 성공률이 떨어졌을 때 모델 자체 문제인지, 특정 MCP 서버의 latency 문제인지, 승인 정책이 너무 엄격한지 분리해서 볼 수 있습니다.

## Observability as Code: 계측도 코드처럼 관리해야 한다

에이전트 관측에서 자주 생기는 실수는 "나중에 대시보드 붙이자"입니다. 그렇게 하면 실행 데이터가 제각각이라 결국 비교가 불가능해집니다. 2026년에는 observability 자체를 코드처럼 선언하고 버전 관리하는 방식이 더 적합합니다.

- 어떤 step을 trace로 남길지
- 어떤 policy decision을 audit 대상으로 볼지
- 어떤 SLO를 서비스별로 강제할지
- 어떤 태그를 OpenTelemetry span에 넣을지
- 어떤 알림이 human escalation을 트리거할지

이런 규칙을 런타임 코드와 같이 관리해야 합니다. OpenTelemetry는 step trace와 tool call span을 표준화하는 데 유리하고, Prometheus는 집계 지표를 쌓는 데 적합하며, Grafana는 팀별 SLO 대시보드와 경보를 운영하기 좋습니다.

아키텍처를 단순화하면 아래와 같습니다.

```text
[User Request]
   |
   v
[Planner]
   |
   +--> [Policy Gate] ----> [Approval Queue]
   |
   v
[Agent Runtime] --> [MCP Tools / APIs / Browser]
   |
   +--> [Execution Journal Store]
   +--> [OpenTelemetry Collector]
   +--> [Prometheus Metrics]
   |
   v
[Verifier]
   |
   v
[SLO Evaluator] --> [Grafana Dashboard / Alerting]
```

이 구조에서 핵심은 모든 행동이 runtime 바깥으로 흩어지지 않고, **Journal·Trace·Metric이 하나의 run_id로 묶인다**는 점입니다.

## TypeScript 예시 1: Journal emitter

```ts
import { appendFile } from "node:fs/promises";

export type JournalStep = {
  stepId: string;
  type: "research" | "plan" | "tool_call" | "policy" | "verify";
  action: string;
  status: "ok" | "error" | "blocked";
  latencyMs?: number;
  costUsd?: number;
  detail?: Record<string, unknown>;
};

export async function emitJournalStep(runId: string, step: JournalStep) {
  const event = {
    runId,
    ts: new Date().toISOString(),
    ...step,
  };

  await appendFile(
    "./var/execution-journal.jsonl",
    JSON.stringify(event) + "\n",
    "utf8"
  );
}
```

이렇게 JSONL로 먼저 남기고, 배치 집계 또는 스트리밍 파이프라인에서 후처리하면 운영 부담을 낮출 수 있습니다.

## TypeScript 예시 2: SLO evaluator + policy gate

```ts
type RunSummary = {
  success: boolean;
  usefulActionMs: number;
  escalated: boolean;
  toolFailures: number;
  toolCalls: number;
  totalCostUsd: number;
};

export function evaluateRun(summary: RunSummary) {
  const toolFailureRate =
    summary.toolCalls === 0 ? 0 : summary.toolFailures / summary.toolCalls;

  return {
    taskSuccess: summary.success,
    usefulActionOk: summary.usefulActionMs <= 45_000,
    escalationOk: !summary.escalated,
    toolBudgetOk: toolFailureRate <= 0.03,
    costOk: summary.totalCostUsd <= 0.35,
  };
}

export function shouldBlockAutonomousPublish(input: {
  containsExternalSideEffect: boolean;
  verificationPassed: boolean;
  riskScore: number;
}) {
  if (input.containsExternalSideEffect && !input.verificationPassed) return true;
  if (input.riskScore >= 0.7) return true;
  return false;
}
```

이런 코드는 화려하지 않지만, 실제 운영에서는 이런 단순한 게이트가 큰 사고를 막습니다.

## 실무 도입 로드맵: 한 번에 다 하려 하지 말 것

### 1단계: Journal 우선
가장 먼저 해야 할 일은 모든 고가치 task에 run_id를 부여하고 step 단위 Journal을 남기는 것입니다. 이 단계에서는 완벽한 평가보다 **실행 가시성 확보** 가 목적입니다.

### 2단계: SLO와 verifier 도입
다음으로 task_success_rate와 time_to_useful_action부터 측정하십시오. 동시에 성공 여부를 판정하는 verifier를 붙여 "응답 완료"와 "업무 성공"을 분리해야 합니다.

### 3단계: 정책 자동화와 예산 관리
마지막으로 human escalation, tool failure budget, cost_per_success를 운영 정책에 연결합니다. 이때부터는 팀이 어떤 작업은 자동 승인하고, 어떤 작업은 사람 검토를 강제할지 근거 기반으로 정할 수 있습니다.

## 결론

MCP는 중요합니다. 하지만 그 자체는 연결 표준일 뿐입니다. 실무에서 진짜 차이를 만드는 것은 에이전트가 **무엇을 했는지, 왜 그렇게 했는지, 그 결과가 정말 유효했는지** 를 설명할 수 있는 운영 체계입니다.

정리하면 다음과 같습니다.

- MCP 도입은 출발점이지 경쟁력이 아니다.
- 경쟁력은 Execution Journal, Agent SLO, 정책 게이트, 검증 루프에서 나온다.
- 2026년의 우수한 에이전트 팀은 더 많은 툴을 연결한 팀이 아니라, 더 적은 실패를 설명 가능하게 만든 팀이다.

결국 에이전트 시대의 플랫폼 엔지니어링은 "모델을 붙이는 기술"에서 끝나지 않습니다. **운영할 수 있는 자동화** 를 만드는 팀이 오래 이깁니다.
