---
title: "MCP/A2A가 보급된 뒤 진짜 차별화는 Agent SLO다: 프로토콜 다음은 운영 계약"
date: 2026-03-29
tags: ["AI", "MCP", "A2A", "Observability", "Platform Engineering", "Architecture"]
---

# MCP/A2A가 보급된 뒤 진짜 차별화는 Agent SLO다: 프로토콜 다음은 운영 계약

2026년 3월의 분위기를 한 문장으로 요약하면 이렇습니다. **에이전트 업계의 논의가 “어떻게 연결할 것인가”에서 “연결된 시스템을 어떻게 운영할 것인가”로 이동하고 있습니다.** 최근 외부 리포트와 메모를 함께 보면 신호가 꽤 일관적입니다.

- MCP는 사실상 도구 연결의 표준 인터페이스로 자리 잡고 있습니다.
- A2A는 멀티 에이전트 협업을 위한 공통 수명주기와 메시지 모델을 밀어 올리고 있습니다.
- 반면 실무 병목은 이제 프로토콜 채택 자체가 아니라 **실패율, 지연, 권한 오남용, 재시도 폭주, 관측 부재** 에서 발생합니다.

즉, 시장은 빠르게 다음 단계로 넘어가고 있습니다.

> **프로토콜이 보급된 뒤의 진짜 경쟁력은 연결성(connectivity)이 아니라 운영 계약(operational contract)이다. 그리고 그 운영 계약의 핵심 언어가 바로 Agent SLO다.**

오늘은 왜 MCP/A2A 다음 화두가 Agent SLO, 즉 **에이전트 운영 수준 목표(Service Level Objective)** 가 되어야 하는지, 그리고 플랫폼 팀이 이를 어떤 아키텍처로 구현해야 하는지 Deep Dive 해보겠습니다.

---

## 1. 왜 “프로토콜 채택”만으로는 제품 경쟁력이 되지 않는가

MCP가 처음 주목받을 때 많은 팀은 이걸 “AI용 USB-C”처럼 이해했습니다. 비유 자체는 맞습니다. 서로 다른 도구와 데이터 소스를 일관된 방식으로 연결하게 해주니까요. A2A 역시 비슷합니다. 서로 다른 에이전트가 task, capability, artifact를 교환하는 공통 언어를 제공해 줍니다.

문제는 제품은 연결만으로 끝나지 않는다는 점입니다.

현실의 엔터프라이즈 환경에서 에이전트가 망가지는 이유는 대개 아래와 같습니다.

1. MCP 서버는 연결되지만 응답 시간이 들쭉날쭉하다.
2. A2A로 작업 위임은 되지만, 어느 단계에서 누가 실패했는지 추적이 안 된다.
3. 읽기 전용이어야 할 툴이 쓰기 권한으로 열려 있다.
4. 동일한 실패에 대해 여러 에이전트가 동시 재시도하며 비용을 폭발시킨다.
5. 최종 답변은 그럴듯하지만, 중간 의사결정 경로를 감사할 수 없다.

이건 전형적인 “연결 문제”가 아니라 **운영 문제** 입니다. API Gateway가 등장한 뒤 진짜 경쟁력이 엔드포인트 개수가 아니라 rate limit, auth, tracing, failover, policy enforcement에서 갈렸던 것과 똑같습니다.

에이전트 시스템도 같은 경로를 걷고 있습니다.

- 1단계: 도구를 붙인다.
- 2단계: 여러 에이전트를 엮는다.
- 3단계: 이제 그 전체를 **운영 가능한 시스템** 으로 바꿔야 한다.

바로 이 3단계에서 필요한 것이 Agent SLO입니다.

---

## 2. Agent SLO란 무엇인가: “잘 대답한다”가 아니라 “예측 가능하게 완수한다”

전통적인 웹 서비스의 SLO는 보통 availability, latency, error rate로 정의됩니다. 예를 들어 “99.9%의 요청이 300ms 이내에 완료된다” 같은 식입니다.

하지만 에이전트는 단순 HTTP 서버가 아닙니다. 계획하고, 도구를 호출하고, 외부 상태를 읽고, 때로는 실제 변경까지 수행합니다. 그래서 에이전트 SLO는 조금 다르게 정의해야 합니다.

제가 실무에서 추천하는 최소 지표 세트는 다음 다섯 가지입니다.

### 2.1 Task Success Rate
사용자 목표를 실제로 완료한 비율입니다.

중요한 점은 “모델이 응답을 반환했는가”가 아니라 **성공 기준을 충족했는가** 를 봐야 한다는 겁니다.

예:
- 이슈 triage 완료
- PR 초안 생성 완료
- 브라우저에서 폼 제출 완료
- 승인 필요 단계에서 정상 중단 완료

### 2.2 Time-to-Useful-Action
최종 완료 시간만 보지 말고, **첫 유용한 액션까지 걸린 시간** 을 봐야 합니다.

좋은 에이전트는 2분 뒤 완벽한 답을 내기만 하는 시스템이 아닙니다. 5초 안에 관련 파일을 찾고, 10초 안에 실패 지점을 좁히고, 20초 안에 수정 전략을 제시하는 식으로 “진행 중임”을 보여줘야 합니다.

### 2.3 Tool Reliability by Capability
도구별이 아니라 capability별 신뢰도를 봐야 합니다.

예:
- `browser.read`
- `browser.act.click`
- `filesystem.write`
- `github.create_pr`
- `mcp.inventory.query`

같은 MCP 서버라도 조회는 안정적이고, 쓰기 계열만 자주 실패할 수 있습니다. capability 단위로 나눠 보지 않으면 병목이 흐려집니다.

### 2.4 Safe Abort Rate
위험 액션이 있을 때 **제대로 멈춘 비율** 도 핵심 지표입니다.

에이전트 제품에서 “아무것도 안 하는 것”이 항상 실패는 아닙니다. 오히려 승인 토큰이 없는데도 강행했다면 그게 진짜 실패입니다. 즉, 안전한 중단도 성공 경로의 일부로 봐야 합니다.

### 2.5 Context Efficiency
토큰 사용량만이 아니라, **주어진 맥락 대비 얼마나 적절한 결정을 했는가** 를 측정해야 합니다.

쓸모없는 로그와 대화 이력 수천 줄을 밀어 넣는 시스템은 언젠가 무너집니다. 좋은 시스템은 현재 단계에 필요한 상태만 압축해서 공급합니다.

---

## 3. 프로토콜 다음 단계에서 왜 관측성(Observability)이 핵심인가

최근 외부 리포트들이 공통적으로 지적하는 것도 바로 이 지점입니다. 에이전트는 모델 하나로 끝나는 구조가 아니라, **오케스트레이션 레이어가 상태, 세션 메모리, 추론 전략, 도구 호출 결과를 계속 합성하는 구조** 입니다. 여기에 A2A와 MCP가 결합되면 분산 시스템 난이도가 갑자기 올라갑니다.

예를 들어 아래와 같은 흐름을 생각해봅시다.

```text
User Intent
  -> Planner Agent
  -> A2A Delegate: Browser Agent
  -> MCP: CRM Query
  -> MCP: Policy Check
  -> Human Approval
  -> Action Agent
  -> Audit Sink
```

이 플로우에서 사용자 입장에서는 “고객 환불 요청을 처리해줘”라는 한 문장일 뿐입니다. 하지만 운영 측면에서는 다음 질문에 답할 수 있어야 합니다.

- 어느 에이전트가 병목이었는가?
- CRM 조회가 느렸는가, 아니면 Planner가 과도한 재계획을 했는가?
- 승인 전 단계에서 정상 멈춤이 일어났는가?
- retry가 합리적인 횟수로 제한됐는가?
- 최종 액션이 어떤 근거와 artifact 위에서 수행됐는가?

이 질문에 답하지 못하면, 에이전트 시스템은 멋진 데모는 될 수 있어도 **운영 자산** 은 되지 못합니다.

그래서 앞으로의 핵심은 tracing을 “LLM 호출 로그” 수준에서 멈추지 않는 것입니다. 진짜 필요한 것은 아래 세 층이 연결된 관측성입니다.

1. **Intent Trace** — 사용자의 목표와 성공 기준
2. **Reasoning/Planning Trace** — 어떤 계획이 어떤 하위 작업으로 분해됐는가
3. **Execution Trace** — 어떤 툴/에이전트/승인 단계가 어떤 결과를 냈는가

---

## 4. 제가 추천하는 Agent SLO 아키텍처

핵심은 단순합니다. 에이전트를 “LLM이 달린 앱”으로 보지 말고, **정책·도구·상태·관측성을 가진 워크플로 시스템** 으로 봐야 합니다.

최소한 아래 계층은 분리하는 것이 좋습니다.

```text
[Intent Gateway]
  - user goal normalization
  - success criteria
  - risk classification

[Planner / Router]
  - model routing
  - task decomposition
  - A2A delegation

[Capability Gateway]
  - MCP registry
  - auth/authz
  - rate limit
  - timeout / retry / fallback

[Execution Journal]
  - tool spans
  - artifact lineage
  - approval events
  - replay metadata

[SLO Evaluator]
  - success/failure labeling
  - latency buckets
  - safe-abort scoring
  - cost/context efficiency
```

여기서 특히 중요한 것은 **Execution Journal** 입니다. 많은 팀이 여전히 자유 텍스트 대화 로그를 메모리라고 부르는데, 운영에는 그걸로 부족합니다.

운영 가능한 시스템은 적어도 이런 이벤트를 구조화해 남겨야 합니다.

```ts
type AgentEvent =
  | {
      kind: "intent.received";
      runId: string;
      goal: string;
      successCriteria: string[];
      riskLevel: "low" | "medium" | "high";
      at: string;
    }
  | {
      kind: "tool.called";
      runId: string;
      agentId: string;
      capability: string;
      target: string;
      latencyMs: number;
      ok: boolean;
      retriable: boolean;
      at: string;
    }
  | {
      kind: "approval.required";
      runId: string;
      actionLabel: string;
      reason: string;
      at: string;
    }
  | {
      kind: "task.completed";
      runId: string;
      outcome: "success" | "safe_abort" | "failure";
      usefulActionMs: number;
      totalLatencyMs: number;
      at: string;
    };
```

이런 구조가 있어야 나중에 “왜 느렸는가”뿐 아니라 “왜 안전하게 멈췄는가”, “어느 capability가 비용을 폭발시켰는가”, “어떤 작업 유형에서 성공률이 낮은가”까지 분석할 수 있습니다.

---

## 5. MCP Gateway는 이제 단순 프록시가 아니라 SLO 집계 지점이어야 한다

며칠 전 글에서 MCP Gateway를 에이전트 앱의 실질적 백엔드라고 썼는데, 오늘은 거기에 한 줄을 더 보태고 싶습니다.

> **MCP Gateway는 툴 연결의 입구일 뿐 아니라, Agent SLO를 계산하는 가장 중요한 관측 지점이다.**

이 말의 의미는 분명합니다. Gateway는 단순히 request를 전달하는 것이 아니라 아래 정보를 함께 관리해야 합니다.

- capability별 timeout budget
- 위험 수준별 approval 정책
- idempotency key
- retry ceiling
- cost attribution
- tenant / user / agent 단위 audit trail

예를 들어 쓰기 계열 capability는 아래처럼 더 보수적으로 다룰 수 있습니다.

```ts
type CapabilityPolicy = {
  timeoutMs: number;
  maxRetries: number;
  requiresApproval: boolean;
  idempotent: boolean;
};

const capabilityPolicies: Record<string, CapabilityPolicy> = {
  "crm.readCustomer": {
    timeoutMs: 1500,
    maxRetries: 1,
    requiresApproval: false,
    idempotent: true,
  },
  "crm.issueRefund": {
    timeoutMs: 4000,
    maxRetries: 0,
    requiresApproval: true,
    idempotent: false,
  },
  "github.createPullRequest": {
    timeoutMs: 5000,
    maxRetries: 0,
    requiresApproval: true,
    idempotent: false,
  },
};
```

이런 구조가 있으면 모델이 조금 흔들려도 런타임이 시스템 품질을 방어할 수 있습니다. 이게 중요합니다. **좋은 에이전트 시스템은 모델이 항상 옳기를 기대하지 않고, 모델이 틀려도 운영 계층이 사고를 흡수하도록 설계합니다.**

---

## 6. 멀티 에이전트 시대에는 “누가 했는가”보다 “어떤 계약 아래 했는가”가 중요하다

A2A가 확산되면 흔히 생기는 오해가 있습니다. 에이전트가 많아질수록 더 똑똑해진다고 생각하는 겁니다. 실제로는 그렇지 않습니다. 에이전트 수가 늘면 coordination tax도 함께 증가합니다.

대표적인 문제는 이렇습니다.

- Planner와 Executor가 서로 stale context를 본다.
- Browser Agent와 Policy Agent가 다른 권한 가정을 가진다.
- Reviewer Agent가 실패 artifact가 아니라 요약문만 읽고 판단한다.
- 동시에 여러 에이전트가 같은 외부 API를 두드려 rate limit를 유발한다.

그래서 멀티 에이전트 아키텍처의 핵심은 “역할 수를 늘리는 것”이 아니라, 각 역할이 어떤 계약을 따르는지 명확히 하는 것입니다.

예를 들어 저는 A2A task envelope에 최소한 아래 필드를 강제하는 편이 맞다고 봅니다.

```ts
type AgentTaskEnvelope = {
  taskId: string;
  parentRunId: string;
  objective: string;
  successCriteria: string[];
  allowedCapabilities: string[];
  forbiddenCapabilities: string[];
  budget: {
    maxLatencyMs: number;
    maxToolCalls: number;
    maxInputTokens: number;
  };
  evidenceRequired: {
    artifacts: boolean;
    citations: boolean;
    screenshots: boolean;
  };
};
```

이 구조가 필요한 이유는 단순합니다. 멀티 에이전트 환경에서 실패의 본질은 “누가 똑똑하지 않았는가”보다 **누구도 공통된 운영 계약을 갖고 있지 않았는가** 에 더 자주 있기 때문입니다.

---

## 7. Self-Critique: 이 글을 쓰며 제가 가장 경계한 두 가지

이번 주제는 쉽게 추상론으로 흐를 수 있어서, 초안 작성 뒤 두 가지를 집중적으로 손봤습니다.

첫째, **“프로토콜은 이제 끝났다”는 식의 과장** 을 덜어냈습니다. MCP와 A2A는 여전히 중요합니다. 다만 오늘 시점의 경쟁력이 프로토콜 채택 자체에만 있지 않다는 점을 분명히 하려고 했습니다.

둘째, **운영론을 공허한 슬로건으로 두지 않기 위해** SLO 항목, execution journal 구조, capability policy, task envelope 예시를 추가했습니다. 에이전트 아키텍처 글은 멋있게 들리기 쉽지만, 결국 팀이 가져가야 할 것은 구현 가능한 계약이기 때문입니다.

저는 앞으로 이 영역에서 가장 강한 팀은 “에이전트를 많이 붙인 팀”이 아니라, **에이전트의 성공·실패·중단을 숫자와 정책으로 다루는 팀** 이 될 거라고 봅니다.

---

## 결론: 프로토콜 시대 다음의 승부처는 운영 가능한 신뢰성이다

2026년 상반기의 신호는 꽤 분명합니다. MCP는 도구 연결을 표준화하고, A2A는 에이전트 협업을 표준화하고 있습니다. 하지만 표준화가 끝나면 차별화 포인트는 자연스럽게 위로 올라갑니다.

이제 진짜 질문은 이것입니다.

- 이 에이전트는 얼마나 자주 실제 목표를 완수하는가?
- 실패할 때 얼마나 빨리, 얼마나 안전하게 멈추는가?
- 어떤 capability가 병목인지 보이는가?
- 사람이 나중에 이 결정을 감사할 수 있는가?

즉, 다음 라운드의 경쟁은 “누가 더 많은 툴을 연결했는가”가 아니라, **누가 더 신뢰 가능한 운영 계약을 설계했는가** 에서 갈릴 것입니다.

제 결론은 단순합니다.

> **프로토콜이 에이전트를 연결했다면, Agent SLO는 그 에이전트를 제품으로 만든다.**

이제 에이전트 플랫폼 팀이 설계해야 할 것은 또 하나의 데모가 아니라, 성공률·지연·안전한 중단·감사 가능성을 동시에 관리하는 운영 계층입니다. 그걸 먼저 만든 팀이, 결국 2026년의 “쓸 수 있는 에이전트”를 만들게 될 겁니다.
