---
title: "MCP 다음 단계는 연결이 아니라 운영이다: Observable Agent Runtime 설계"
date: 2026-04-16
description: "2026년의 Agent 시스템은 더 많은 tool을 붙이는 경쟁에서 벗어나, async execution contract, runtime observability, verification gate를 얼마나 단단하게 설계하느냐로 승부가 갈린다. MCP 이후 실무 팀이 바로 적용할 수 있는 운영 중심 아키텍처를 정리한다."
tags:
  - AI Agents
  - MCP
  - Observability
  - Runtime Verification
  - Async Execution
  - TypeScript
  - System Design
  - Production Engineering
---

## 왜 지금 이 주제를 다시 봐야 하나

2026년의 Agent 시스템은 더 이상 `tool 호출이 가능하다`는 사실만으로 차별화되지 않는다. MCP가 tool interface를 정리해 준 뒤부터, 병목은 훨씬 더 운영적인 곳으로 이동했다.

- long-running task를 어떻게 추적할 것인가
- 실패한 실행을 어디까지 재시도할 것인가
- 실행 결과를 어떤 단위로 검증할 것인가
- 사람이 개입해야 하는 지점을 어떻게 남길 것인가
- 사고가 났을 때 어느 로그를 보면 원인을 찾을 수 있는가

즉, 문제는 `연결`이 아니라 `운영`이다.

최근 2026년 4월의 Agent 트렌드를 보면 이 흐름이 더 선명하다. 업계의 관심은 단순한 model upgrade가 아니라 다음으로 이동하고 있다.

- runtime security
- async task orchestration
- execution trace
- verification protocol
- local or browser based execution isolation

이 글에서는 이 흐름을 한 문장으로 압축한다.

> MCP가 tool access를 표준화했다면, 이제 경쟁력은 observable runtime과 verification contract를 얼마나 잘 설계했느냐에서 나온다.

이번 글은 그 설계를 실무 관점에서 풀어본다.

---

## 1. MCP는 시작점일 뿐이다

MCP는 아주 중요한 문제를 해결했다. model이 어떤 tool을 어떤 schema로 호출해야 하는지 통일된 방식으로 설명할 수 있게 만들었다. 이건 분명히 큰 진전이다.

하지만 실제 운영에서는 MCP만으로 해결되지 않는 질문이 훨씬 많다.

```text
사용자 요청
   │
   ▼
Planner model
   │  tool call 생성
   ▼
MCP client
   │
   ▼
MCP server
   │
   ├─ tool A 실행
   ├─ tool B 실행
   └─ tool C 실행
```

이 다이어그램은 연결 관점에서는 충분하다. 하지만 운영 관점에서는 빠진 게 많다.

```text
사용자 요청
   │
   ▼
Planner
   │
   ▼
Execution Contract Layer
   │  - idempotency key
   │  - timeout budget
   │  - retry policy
   │  - approval policy
   ▼
Runtime Orchestrator
   │  - queue
   │  - state store
   │  - cancellation
   │  - backpressure
   ▼
MCP Tool Runtime
   │
   ├─ Trace Collector
   ├─ Verification Gate
   ├─ Audit Log
   └─ Human Review Hook
```

실무에서 차이가 나는 부분은 이 두 번째 그림이다.

MCP는 tool을 부르는 규칙을 제공한다. 하지만 다음은 여전히 여러분이 설계해야 한다.

- 실행을 큐에 넣을지 즉시 돌릴지
- retry 가능한 오류와 아닌 오류를 어떻게 나눌지
- partial success를 어떤 형태로 저장할지
- side effect가 있는 tool call을 재실행해도 되는지
- agent가 내린 결론을 바로 반영할지 verification 뒤에 반영할지

정리하면 MCP는 `interface standard`이고, production 경쟁력은 `execution standard`에서 나온다.

---

## 2. 2026년 Agent 시스템의 핵심은 async execution contract다

많은 팀이 아직도 Agent 실행을 request-response로만 생각한다. 사용자가 요청하면 model이 몇 번 생각하고 tool을 부르고 바로 답을 주는 흐름이다. 작은 데모에는 잘 맞는다. 하지만 실제 업무 자동화는 그렇지 않다.

예를 들어 이런 작업을 생각해 보자.

- GitHub issue를 읽고 재현 환경을 만든다
- staging에 배포해서 smoke test를 돈다
- browser로 로그인과 결제 흐름을 확인한다
- 결과를 정리해서 PR comment를 남긴다

이건 몇 초 안에 끝나는 작업이 아니다. 중간에 network jitter도 있고, external API limit도 있고, 사람이 승인해야 하는 단계도 있다. 이 시점부터 필요한 것은 model intelligence보다 `async execution contract`다.

### 실행 계약이 필요한 이유

실행 계약이 없으면 이런 문제가 터진다.

- 같은 작업이 중복 실행된다
- timeout 뒤에 실제 실행은 계속된다
- 성공과 실패가 섞인 상태가 저장되지 않는다
- 사용자는 실패했다고 보는데 외부 시스템은 이미 변경되었다
- review 없이 side effect가 발생한다

이를 막으려면 모든 agent task가 최소한 아래 필드를 가져야 한다.

```ts
export type TaskStatus =
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'waiting_external'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface AgentTask {
  taskId: string;
  requestId: string;
  idempotencyKey: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  budget: {
    deadlineMs: number;
    maxRetries: number;
    maxToolCalls: number;
  };
  input: {
    userGoal: string;
    riskLevel: 'low' | 'medium' | 'high';
  };
  output?: {
    summary: string;
    artifacts: string[];
  };
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}
```

핵심은 `agent가 생각한 내용`보다 `실행 단위가 어떤 상태로 흘러가는가`를 먼저 데이터 모델로 고정하는 것이다.

### 실행 계약의 최소 규칙

내가 추천하는 최소 규칙은 다음 다섯 가지다.

1. 모든 side effect 작업은 `idempotencyKey`를 가진다.
2. 모든 task는 `deadline`과 `retry budget`를 가진다.
3. approval이 필요한 단계는 별도 상태로 빠진다.
4. tool result는 원문과 요약을 함께 저장한다.
5. completed 전에 반드시 `verifying` 단계를 통과한다.

이 규칙만 지켜도 운영 난이도가 크게 내려간다.

---

## 3. Observable Runtime은 로그가 아니라 실행 그래프다

많은 팀이 observability를 `tool call 로그 남기기` 정도로 이해한다. 하지만 Agent에서는 그걸로 부족하다. 왜냐하면 문제의 핵심이 단일 호출 실패가 아니라, 호출들의 연쇄에서 발생하기 때문이다.

예를 들어 이런 상황을 보자.

- planner가 browser tool을 호출했다
- login step은 성공했다
- checkout page에서 AB test variation이 달라졌다
- fallback selector가 실패했다
- agent는 empty result를 요약하면서 `상품이 없다`고 결론 냈다

이 사건을 사후 분석하려면 단순 로그가 아니라 실행 그래프가 필요하다.

```text
task-1842
 ├─ step-1 plan.generate                420ms   success
 ├─ step-2 browser.open                 980ms   success
 ├─ step-3 browser.login               2120ms   success
 ├─ step-4 browser.find-cart-button    1300ms   failed(selector_not_found)
 ├─ step-5 fallback.search-button       880ms   failed(selector_not_found)
 ├─ step-6 model.summarize              610ms   success
 └─ verdict                            incorrect
```

여기서 중요한 건 세 가지다.

- **causality**: 어떤 실패가 다음 판단에 영향을 줬는가
- **timing**: 느린 구간이 어디인가
- **decision trace**: model이 왜 그런 결론을 냈는가

### 어떤 이벤트를 남겨야 하나

실무에서 최소한 아래 이벤트는 구조화해서 남겨야 한다.

```ts
interface RuntimeEvent {
  eventId: string;
  taskId: string;
  stepId: string;
  type:
    | 'plan_created'
    | 'tool_started'
    | 'tool_succeeded'
    | 'tool_failed'
    | 'approval_requested'
    | 'approval_granted'
    | 'verification_started'
    | 'verification_failed'
    | 'task_completed';
  ts: string;
  actor: 'planner' | 'tool' | 'verifier' | 'human';
  toolName?: string;
  latencyMs?: number;
  payload: Record<string, unknown>;
}
```

주의할 점도 있다. Agent observability는 무조건 많이 쌓는다고 좋은 게 아니다. raw prompt와 raw artifact를 전부 적재하면 비용도 커지고 privacy 문제도 생긴다. 그래서 관측 단위를 나눠야 한다.

- control plane event: 상태 전이, 승인, 취소, 재시도
- execution event: tool input hash, output digest, latency, error code
- audit artifact: 필요 시만 전문 저장

즉, `항상 저장할 것`과 `문제가 생겼을 때만 열람할 것`을 분리해야 한다.

---

## 4. Verification은 마지막에 붙이는 QA가 아니다

많은 팀이 verification을 `결과 나온 뒤에 한번 더 검사하는 단계`로 붙인다. 그런데 Agent 시스템에서는 그렇게 하면 늦는 경우가 많다. 이미 side effect가 발생했기 때문이다.

Verification은 사후 검사보다 `실행 경계`로 들어가야 한다.

### 어떤 경계에 verifier를 둘 것인가

가장 효과적인 방식은 아래 세 지점에 verifier를 두는 것이다.

1. **plan gate**: 위험한 tool 조합인지 본다.
2. **pre-commit gate**: side effect 반영 직전에 본다.
3. **post-condition gate**: 반영 뒤 시스템 상태가 기대와 맞는지 본다.

예를 들어 GitHub issue triage agent라면 이렇게 된다.

```text
issue 분석
  ▼
plan gate
  - destructive action 포함 여부
  - 외부 발송 여부
  - budget 초과 여부
  ▼
sandbox 실행
  ▼
pre-commit gate
  - 재현 성공 증거 존재 여부
  - 로그와 요약의 일치 여부
  ▼
comment 작성 또는 label 변경
  ▼
post-condition gate
  - comment 생성 확인
  - label 반영 확인
```

### Verifier는 다른 model이어야 하나

꼭 그렇지는 않다. 더 중요한 건 역할 분리다.

- planner: 일을 진행하려는 성향
- verifier: 틀린 결론을 막으려는 성향

같은 model을 쓰더라도 prompt contract와 입력 자료를 다르게 구성하면 역할 분리는 가능하다. 다만 high-risk workflow라면 planner와 verifier를 다른 model 혹은 다른 policy budget으로 분리하는 편이 낫다.

아래는 간단한 verification gate 예시다.

```ts
interface VerificationInput {
  taskId: string;
  intendedAction: string;
  evidence: Array<{
    kind: 'log' | 'screenshot' | 'json' | 'diff';
    uri: string;
    digest: string;
  }>;
  assertions: string[];
}

interface VerificationResult {
  passed: boolean;
  score: number;
  reasons: string[];
  requiresHumanReview: boolean;
}

export async function verifyBeforeCommit(
  input: VerificationInput,
): Promise<VerificationResult> {
  const missingEvidence = input.assertions.filter((assertion) => {
    return !input.evidence.some((item) => item.kind === 'json' || item.kind === 'diff');
  });

  if (missingEvidence.length > 0) {
    return {
      passed: false,
      score: 0.42,
      reasons: [`핵심 근거 부족: ${missingEvidence.join(', ')}`],
      requiresHumanReview: true,
    };
  }

  return {
    passed: true,
    score: 0.91,
    reasons: ['필수 근거 확인 완료'],
    requiresHumanReview: false,
  };
}
```

이 코드는 단순해 보이지만 중요한 원칙을 담고 있다.

- verifier는 `생각이 그럴듯한가`가 아니라 `근거가 충분한가`를 본다.
- verification 실패는 곧바로 human review로 연결된다.
- score는 편의 기능일 뿐, 최종 판정은 rules와 evidence completeness가 담당한다.

---

## 5. Planner와 Runtime을 분리하지 않으면 생기는 문제

Agent를 처음 만들 때 흔히 하는 실수는 planner가 runtime 정책까지 동시에 쥐게 만드는 것이다. 예를 들어 model이 직접 이런 걸 결정하게 두는 식이다.

- 몇 번 재시도할지
- timeout을 얼마나 줄지
- approval 없이 진행할지
- background task로 넘길지

이 구조는 데모에서는 빨라 보인다. 하지만 운영에서는 재앙에 가깝다. 왜냐하면 실행 정책은 business policy와 security policy의 영역이지, 매번 model이 새로 추론할 영역이 아니기 때문이다.

권장 구조는 다음과 같다.

```text
Planner
  - 어떤 목표를 달성할지 계획
  - 어떤 tool이 필요한지 제안

Policy Engine
  - 이 계획이 허용 범위 안인지 판단
  - retry, timeout, approval 규칙 부여

Runtime Orchestrator
  - 실제 큐잉, 취소, 상태 저장, 재실행 수행

Verifier
  - 실행 근거와 결과의 적합성 검사
```

아래 예시는 planner의 자유도를 줄이고 runtime이 정책을 강제하는 형태다.

```ts
type ToolCategory = 'read' | 'write' | 'external_send' | 'deploy';

interface PlannedToolCall {
  toolName: string;
  category: ToolCategory;
  params: Record<string, unknown>;
}

interface ExecutionPolicy {
  timeoutMs: number;
  retryLimit: number;
  requiresApproval: boolean;
  queue: 'inline' | 'background';
}

export function resolvePolicy(call: PlannedToolCall): ExecutionPolicy {
  switch (call.category) {
    case 'read':
      return {
        timeoutMs: 10_000,
        retryLimit: 1,
        requiresApproval: false,
        queue: 'inline',
      };
    case 'write':
      return {
        timeoutMs: 20_000,
        retryLimit: 0,
        requiresApproval: true,
        queue: 'inline',
      };
    case 'external_send':
      return {
        timeoutMs: 15_000,
        retryLimit: 0,
        requiresApproval: true,
        queue: 'background',
      };
    case 'deploy':
      return {
        timeoutMs: 120_000,
        retryLimit: 0,
        requiresApproval: true,
        queue: 'background',
      };
  }
}
```

이 구조의 장점은 분명하다.

- planner가 똑똑해도 policy를 우회할 수 없다.
- runtime metrics를 category 기준으로 바로 집계할 수 있다.
- review 기준이 코드로 남는다.
- 운영자가 model behavior보다 policy file을 먼저 볼 수 있다.

실제로 production 운영은 `model tuning`보다 `policy clarity`에서 더 자주 개선된다.

---

## 6. Browser runtime과 local runtime을 같은 방식으로 다루면 안 된다

2026년 Agent 흐름에서 browser runtime의 비중은 계속 커지고 있다. 하지만 browser tool을 local file tool과 같은 재시도 규칙으로 다루면 장애가 늘어난다. 실패 특성이 다르기 때문이다.

- local runtime 실패: permission error, file not found, process exit code
- browser runtime 실패: selector drift, auth expiry, timing race, modal interrupt

즉, tool abstraction은 같아도 failure model은 다르다.

그래서 runtime layer는 최소한 아래처럼 분리돼야 한다.

```text
Local Tool Adapter
  - deterministic failure 비중이 높음
  - 재현 가능성 높음
  - retry보다 즉시 실패가 더 유익할 때 많음

Browser Tool Adapter
  - nondeterministic failure 비중이 높음
  - DOM variation과 timing 영향 큼
  - bounded retry와 fallback selector가 유효함
```

실무 팁 하나를 덧붙이면, browser tool에서는 `정답 추론`보다 `증거 수집`을 우선시하는 편이 낫다. 예를 들면 다음 순서다.

1. page state snapshot 저장
2. 실패 selector 기록
3. screenshot 또는 accessibility tree 저장
4. 그 다음에만 fallback reasoning 수행

이 순서를 거꾸로 하면, evidence 없는 요약이 늘어난다.

---

## 7. Production 체크리스트

실제 팀이 Agent runtime을 운영하기 전에 반드시 점검해야 할 항목을 짧게 정리한다.

### 실행 계약

- 모든 task에 `taskId`, `requestId`, `idempotencyKey`가 있는가
- timeout과 retry budget이 정책으로 분리되어 있는가
- cancellation이 실제 tool execution까지 전파되는가
- partial failure 상태가 저장되는가

### observability

- task 단위 상태 전이가 구조화 이벤트로 남는가
- tool latency와 error code가 집계되는가
- planner decision과 verifier decision이 구분되어 기록되는가
- raw artifact 저장 정책과 digest 저장 정책이 나뉘어 있는가

### verification

- side effect 직전 gate가 존재하는가
- evidence 부족 시 human review로 빠지는가
- verifier score만으로 commit하지 않는가
- post-condition check가 실제 external state를 확인하는가

### security

- tool category별 최소 권한 정책이 있는가
- external send, deploy, delete는 무조건 approval 대상인가
- audit log가 수정 불가능한 저장소로 복제되는가
- prompt와 artifact에 민감 정보 마스킹이 적용되는가

### 운영

- stuck task를 감지하는 watchdog가 있는가
- queue backlog가 일정 임계치를 넘으면 backpressure가 작동하는가
- model outage 시 degraded mode가 존재하는가
- workflow별 SLO를 정의했는가

---

## 8. 어떤 지표를 봐야 운영이 좋아지는가

Agent 시스템에서 자주 빠지는 함정이 `정확도` 하나만 보는 것이다. 하지만 운영 지표는 더 입체적이어야 한다.

내가 추천하는 기본 지표는 아래와 같다.

- **Task Success Rate**: 최종 목표 달성 비율
- **Verification Pass Rate**: verifier를 통과한 비율
- **Time to Useful Action**: 첫 유효 작업까지 걸린 시간
- **Human Intervention Rate**: 사람 개입 비율
- **Replay Safety Rate**: 같은 task 재실행 시 side effect 없이 복구되는 비율
- **Evidence Completeness Score**: 판단에 필요한 근거 충족 비율

이 중 특히 중요한 건 `Verification Pass Rate`와 `Evidence Completeness Score`다. 왜냐하면 Agent 시스템의 실패는 종종 `틀린 답`보다 `근거 없는 자신감`으로 나타나기 때문이다.

---

## 결론: 다음 경쟁력은 더 영리한 model이 아니라 더 설명 가능한 실행이다

2026년의 Agent 시스템은 분명 더 강력해졌다. 하지만 그만큼 더 위험해졌다. 이유는 단순하다. 이제 Agent는 읽고 요약하는 수준을 넘어, 실제로 실행하고 바꾸고 보낸다.

그래서 다음 단계의 핵심 질문은 이것이다.

- 이 agent는 무엇을 실행했는가
- 왜 그렇게 실행했는가
- 어떤 근거로 통과되었는가
- 실패했다면 어느 단계에서 어긋났는가
- 다시 실행해도 안전한가

이 질문에 답할 수 없으면, tool이 백 개 있어도 production 신뢰도는 올라가지 않는다.

MCP는 매우 중요한 기반이다. 하지만 실무 팀이 진짜로 만들어야 하는 것은 그 위의 운영 계층이다.

- async execution contract
- structured runtime events
- verification gate
- policy enforced orchestration
- evidence first debugging

결국 경쟁력은 `더 많은 연결`이 아니라 `더 설명 가능한 실행`에서 나온다.

Agent 시대의 운영은 model demo가 아니라 distributed systems engineering에 더 가깝다. 그리고 바로 그 지점에서, 좋은 runtime 설계가 팀의 실질적 차이를 만든다.
