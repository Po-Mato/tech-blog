---
title: "에이전트 런타임의 진짜 전쟁터: 왜 .claude/를 넘어 상태 제어면을 설계해야 하는가"
date: 2026-03-28
tags: ["AI", "Coding Agents", "Runtime Architecture", "State Management", "TypeScript", "Context Engineering"]
---

# 에이전트 런타임의 진짜 전쟁터: 왜 `.claude/`를 넘어 상태 제어면을 설계해야 하는가

최근 며칠 사이의 신호를 한 줄로 요약하면 이렇습니다. **에이전트는 점점 더 강해지고 있지만, 여전히 많은 팀이 그 에이전트를 너무 약한 저장 매체 위에서 운영하고 있습니다.** Hacker News 상위권에 오른 `Go hard on agents, not on your filesystem`, `Anatomy of the .claude/ folder` 같은 글이 주목받고, GitHub Trending에는 `last30days-skill`, `oh-my-claudecode`, `AI-Scientist-v2`, `onyx` 같은 에이전트·스킬·오케스트레이션 프로젝트가 동시에 올라오는 이유도 여기에 있습니다. 시장은 이미 "모델이 더 똑똑해지면 해결된다"는 단계를 지나, **에이전트를 어떤 런타임 위에서 안정적으로 굴릴 것인가**라는 질문으로 이동하고 있습니다.

저는 이 흐름을 꽤 중요하게 봅니다. 어제 글에서 브라우저를 코딩 에이전트의 실행·검증 계층으로 봤고, 그 전 글에서는 MCP/A2A가 백엔드를 컨텍스트 제어면으로 바꾼다고 주장했습니다. 오늘은 그 둘을 이어 보겠습니다. **브라우저 검증 루프와 컨텍스트 엔지니어링이 실제 운영 체계가 되려면, 파일시스템 중심의 작업 방식에서 stateful runtime 중심의 설계로 넘어가야 합니다.**

핵심 주장은 명확합니다.

> `.claude/` 같은 작업 디렉토리나 각종 markdown 덤프는 유용한 흔적이지만, 그것만으로는 운영 가능한 에이전트 시스템이 되지 않습니다. 파일은 영속화 계층의 일부일 뿐이고, planning / execution / observation / recovery / approval / retry / context budgeting 은 별도의 상태 모델로 관리되어야 합니다.

---

## 1. 왜 파일시스템 중심 에이전트가 빠르게 한계에 부딪히는가

초기 코딩 에이전트는 대부분 파일을 중심으로 동작합니다.

```text
prompt.md 작성
-> todo.md 갱신
-> notes.md 누적
-> diff 생성
-> 결과를 다시 파일에 기록
```

이 방식은 시작이 빠릅니다. 사람이 디버깅하기 쉽고, Git과도 잘 맞으며, 로컬 도구와 연결하기도 편합니다. 그래서 많은 에이전트 프레임워크가 작업 폴더를 사실상의 상태 저장소처럼 사용합니다.

문제는 이 구조가 **운영 복잡도**를 버티지 못한다는 점입니다.

첫째, 파일은 **현재 상태(current state)** 보다 **과거 흔적(history)** 에 강합니다. 에이전트 운영에 필요한 것은 “무슨 일이 있었는가”만이 아니라 “지금 무엇이 진행 중인가”입니다. 예를 들어 아래 질문은 파일 몇 개로는 정확히 답하기 어렵습니다.

- 지금 이 작업은 실행 중인가, 실패했는가, 승인 대기인가?
- 어떤 요약은 최신이고, 어떤 요약은 stale 상태인가?
- 브라우저 관찰 결과는 어느 계획 단계와 연결되는가?
- 재시도는 몇 번 했고, 다음 재시도는 어떤 정책으로 제한되는가?
- 이 에이전트가 현재 갖는 권한 범위는 어디까지인가?

둘째, 파일은 **행동 제약(action constraints)** 을 잘 표현하지 못합니다. 문서에 “외부 전송 전 승인 필요”라고 써두는 것과, 런타임이 실제로 승인 토큰 없이는 전송 단계를 실행하지 못하게 막는 것은 완전히 다른 수준의 안전성입니다.

셋째, 파일은 **동시성·부분 실패·재개(resume)** 에 약합니다. 한 에이전트가 계획을 수정하는 동안 다른 에이전트가 브라우저 검증을 돌리고, 또 다른 프로세스가 승인 대기 큐를 관리하는 순간, 파일 기반 합의는 금방 애매해집니다. "마지막으로 쓴 사람이 이긴다" 수준이면 아직 런타임이라고 부르기 어렵습니다.

넷째, 파일은 **컨텍스트 예산 관리**의 좋은 단위가 아닙니다. 에이전트에게 필요한 것은 폴더 전체가 아니라, 현재 단계에 맞는 압축된 상태입니다. 그런데 파일 기반 접근은 대개 둘 중 하나로 흐릅니다.

- 너무 많이 넣어서 토큰 비용과 오염이 커지거나
- 너무 적게 넣어서 핵심 상태를 놓치거나

즉, 파일시스템은 여전히 중요하지만, 그것을 런타임 그 자체로 착각하는 순간 병목이 시작됩니다.

---

## 2. 앞으로의 핵심은 "파일 저장소"가 아니라 "상태 제어면"이다

2026년형 에이전트 런타임은 단순한 작업 폴더보다 **state control plane** 에 가깝게 설계되어야 합니다. 여기서 제어면(control plane)이란 단순 대시보드가 아니라, 에이전트가 무엇을 알고 무엇을 할 수 있으며 어떤 결과를 어디에 반영할지를 조정하는 계층입니다.

제가 추천하는 최소 구조는 다음과 같습니다.

```text
Intent Layer
  - 사용자 목표
  - 성공 기준
  - 정책 제약

Planning State
  - 현재 계획
  - 하위 작업 DAG
  - 우선순위 / 의존성

Execution State
  - 실행 중 작업
  - 시도 횟수
  - lease / timeout
  - tool session linkage

Observation State
  - 브라우저/CLI/테스트 결과
  - 로그 요약
  - 오류 분류
  - 증거 링크

Memory & Summary State
  - 단계별 압축 요약
  - 장기 보관 가치 판정
  - stale 여부 / freshness budget

Governance State
  - 권한 범위
  - 승인 체크포인트
  - 외부 전송 정책
  - redaction 규칙

Recovery State
  - 실패 유형
  - 자동 재시도 가능 여부
  - 인간 개입 필요 여부
  - resume cursor
```

이 구조에서 파일은 어디에 위치할까요? 답은 간단합니다. **파일은 이 상태를 영속화하거나 감사 가능하게 만드는 여러 저장소 중 하나**입니다. 상태의 canonical source를 파일로 두어도 되지만, 런타임은 파일 위에 더 명시적인 의미론을 부여해야 합니다.

물론 모든 팀이 처음부터 거대한 제어면을 만들 필요는 없습니다. 단일 개발자가 짧은 세션에서 쓰는 로컬 에이전트라면 파일 중심 구조만으로도 충분할 수 있습니다. 하지만 **장기 실행, 멀티 에이전트, 승인 워크플로, 브라우저 검증, 외부 액션, 실패 복구** 중 두세 가지만 동시에 들어오는 순간, 파일만으로 버티는 비용이 오히려 더 커집니다.

예를 들어 `todo.md`는 사람이 읽는 계획 문서일 수 있습니다. 하지만 실제 런타임은 별도로 “현재 실행 가능한 노드”, “승인 필요 노드”, “관찰 결과가 부족한 노드”, “재시도 금지 노드”를 구분해 가져야 합니다. 이 차이가 곧 장난감 에이전트와 운영 가능한 에이전트를 가릅니다.

---

## 3. Planning / Execution / Observation 을 분리하지 않으면 검증 루프가 무너진다

최근 코딩 에이전트 시스템을 보면 모델 성능보다 **상태 분리의 부재** 때문에 무너지는 경우가 많습니다. 하나의 프롬프트 안에 계획, 실행 결과, 브라우저 관찰, 다음 수정안, 회고를 전부 쓸어 담으면 처음에는 그럴듯해 보입니다. 하지만 세 번째 재시도쯤 가면 시스템이 급격히 불안정해집니다.

왜냐하면 계획과 관찰은 성격이 다르기 때문입니다.

- **Planning** 은 앞으로 할 일을 압축한 예측 구조입니다.
- **Execution** 은 실제로 어떤 액션이 발생했는지에 대한 사실 구조입니다.
- **Observation** 은 실행의 결과를 해석 가능한 증거로 정리한 구조입니다.

이 셋을 분리하면 좋은 점이 많습니다.

1. 계획이 틀려도 관찰 증거는 보존됩니다.
2. 재시도 시 이전 실행의 부작용을 추적할 수 있습니다.
3. 모델이 잘못된 자기서사를 덧씌우기 어렵습니다.
4. 승인·감사 로그와 연결하기 쉬워집니다.

아래는 제가 선호하는 최소 상태 스키마 예시입니다.

```ts
export type TaskStatus =
  | "planned"
  | "running"
  | "blocked"
  | "awaiting_approval"
  | "succeeded"
  | "failed";

export interface TaskNode {
  id: string;
  goal: string;
  dependsOn: string[];
  status: TaskStatus;
  owner: "planner" | "coder" | "reviewer" | "browser";
  attemptCount: number;
  maxAttempts: number;
  updatedAt: string;
}

export interface Observation {
  taskId: string;
  source: "browser" | "test" | "shell" | "human";
  severity: "info" | "warn" | "error";
  summary: string;
  evidenceRef?: string;
  retryable: boolean;
  capturedAt: string;
}

export interface RuntimeState {
  runId: string;
  goal: string;
  tasks: TaskNode[];
  observations: Observation[];
  approvalRequired: boolean;
  contextBudgetTokens: number;
}
```

이런 스키마가 중요한 이유는 화려함 때문이 아닙니다. **모델이 아니라 런타임이 작업의 진실을 갖도록 만들기 위해서**입니다. 모델은 이 상태를 읽고 해석할 수는 있어도, 임의로 사실을 덮어써서는 안 됩니다.

다음은 관찰 결과를 기반으로 재시도 가능 여부와 다음 액션을 결정하는 간단한 예시입니다.

```ts
function decideNextAction(state: RuntimeState, taskId: string) {
  const task = state.tasks.find((t) => t.id === taskId);
  const related = state.observations.filter((o) => o.taskId === taskId);

  if (!task) {
    return { type: "halt", reason: "task_not_found" } as const;
  }

  const hardFailure = related.find(
    (o) => o.severity === "error" && o.retryable === false,
  );

  if (hardFailure) {
    return {
      type: "escalate",
      reason: "non_retryable_failure",
      summary: hardFailure.summary,
    } as const;
  }

  if (task.attemptCount >= task.maxAttempts) {
    return {
      type: "await_human",
      reason: "retry_budget_exhausted",
    } as const;
  }

  const latestError = [...related].reverse().find((o) => o.severity === "error");
  if (latestError) {
    return {
      type: "repair",
      reason: latestError.summary,
    } as const;
  }

  return { type: "continue" } as const;
}
```

이 코드는 단순하지만, 아주 중요한 원칙을 담고 있습니다. **재시도, 인간 개입, 강제 중단 같은 운영 판단을 프롬프트 문구가 아니라 런타임 규칙으로 다룬다**는 점입니다.

---

## 4. `.claude/`는 유용하다. 하지만 런타임 전체가 되어서는 안 된다

여기서 오해하면 안 됩니다. 저는 `.claude/`, `notes/`, `plans/`, `scratchpad/` 같은 구조를 무시하자는 것이 아닙니다. 오히려 이런 디렉토리는 사람과 에이전트의 협업 흔적을 남기기에 매우 유용합니다.

문제는 **그 폴더를 곧 시스템 상태라고 생각하는 순간**입니다.

예를 들어 `.claude/` 내부에 아래 파일이 있다고 해보겠습니다.

- `plan.md`
- `memory.md`
- `research.md`
- `next-actions.md`

사람은 이 문서를 읽고 맥락을 재구성할 수 있습니다. 하지만 운영 중인 런타임은 다음을 더 명확하게 알아야 합니다.

- 지금 `plan.md`가 최신 계획인가, 아니면 이전 시도의 잔재인가?
- `memory.md` 안 요약 중 어느 항목이 현재 목표에 relevant 한가?
- `research.md`의 출처는 검증됐는가, 아니면 단순 추정인가?
- `next-actions.md`는 승인 전 단계인가, 바로 실행 가능한 단계인가?

문서를 읽어 의미를 복원하는 방식은 인간에게는 괜찮지만, 런타임에는 너무 느리고 애매합니다. 더 나쁜 경우, 에이전트가 스스로 남긴 서술을 다시 읽고 자기 확신을 강화하는 **self-referential drift** 가 발생합니다. 계획 문서는 원래 가설인데, 몇 번의 반복 뒤에는 사실처럼 굳어지는 식입니다.

그래서 문서형 기억은 반드시 **구조화된 상태와 쌍으로 존재**해야 합니다.

- 문서는 설명 가능한 서사를 담당하고
- 구조화 상태는 실행 가능한 진실을 담당해야 합니다.

이 구분이 없으면 에이전트는 잘 쓰인 문서에 속고, 운영자는 멋진 로그를 보면서도 실제 상태를 놓칩니다.

---

## 5. 권한·승인·요약·컨텍스트 예산은 런타임 기능이어야 한다

에이전트 시스템이 실제 제품 환경에 들어가면, 가장 먼저 부딪히는 문제는 모델 정확도보다 **거버넌스** 입니다. 구체적으로는 아래 네 가지가 핵심입니다.

### 5.1 권한은 프롬프트가 아니라 capability 로 관리해야 한다

"외부 전송 금지", "삭제 명령은 사용자 승인 후", "운영 DB 읽기만 허용" 같은 규칙은 문장으로 써두는 것만으로는 부족합니다. 런타임은 실제 capability token 혹은 policy gate 수준에서 이를 강제해야 합니다.

### 5.2 승인은 이벤트가 아니라 상태 전이여야 한다

승인 요청은 메시지 하나 보내고 끝나는 기능이 아닙니다. `planned -> awaiting_approval -> approved -> running` 같은 상태 전이가 명시돼야 합니다. 그래야 승인 지연, 만료, 취소, 정책 변경을 일관되게 처리할 수 있습니다.

### 5.3 요약은 저장보다 freshness 관리가 중요하다

많은 시스템이 요약을 쌓기만 합니다. 하지만 좋은 런타임은 “어떤 요약이 최신인지”, “어떤 요약은 이미 실행 결과로 무효화됐는지”를 관리합니다. stale summary는 없는 요약보다 더 위험합니다.

### 5.4 컨텍스트 예산은 비용 관리가 아니라 정확도 관리다

토큰 예산을 단순 비용 문제로 보면 절반만 보는 겁니다. 컨텍스트가 과하면 모델이 핵심 신호를 놓치고, 부족하면 잘못된 가정을 세웁니다. 그래서 런타임은 단계별로 필요한 상태만 골라 주입해야 합니다.

아래는 작업 단계별 컨텍스트 패킷을 조립하는 예시입니다.

```ts
interface ContextPacket {
  goal: string;
  currentTask: string;
  constraints: string[];
  recentObservations: string[];
  approvedCapabilities: string[];
  summaries: string[];
}

function buildContextPacket(state: RuntimeState, taskId: string): ContextPacket {
  const task = state.tasks.find((t) => t.id === taskId);
  const recentObservations = state.observations
    .filter((o) => o.taskId === taskId)
    .slice(-5)
    .map((o) => `[${o.source}/${o.severity}] ${o.summary}`);

  return {
    goal: state.goal,
    currentTask: task?.goal ?? "unknown",
    constraints: [
      state.approvalRequired ? "external_action_requires_approval" : "",
      `context_budget=${state.contextBudgetTokens}`,
    ].filter(Boolean),
    recentObservations,
    approvedCapabilities: state.approvalRequired ? ["read", "analyze"] : ["read", "analyze", "write"],
    summaries: [
      "Use browser observations as primary evidence for UI-affecting changes.",
      "Prefer repair over restart if retry budget remains.",
    ],
  };
}
```

중요한 건 이 패킷이 단순 요약이 아니라는 점입니다. 이 안에는 **현재 목표, 제약, 최신 관찰, 승인된 능력, 실행 방침** 이 함께 들어 있습니다. 이런 형태가 되어야 모델은 "무엇을 아는가"뿐 아니라 "무엇을 해도 되는가"까지 동시에 이해합니다.

---

## 6. 브라우저와 도구 관찰을 붙이지 않으면 stateful runtime도 반쪽짜리다

상태를 잘 나눴다고 끝이 아닙니다. 그 상태가 현실과 연결되지 않으면 다시 문서놀이가 됩니다. 그래서 저는 앞으로의 런타임이 반드시 **observation-first** 여야 한다고 봅니다.

특히 UI, 코딩, 자동화 계열 에이전트에서는 브라우저와 도구 관찰이 핵심 증거 계층이 됩니다.

- 브라우저: DOM 변화, 콘솔 에러, 네트워크, 시각 회귀, 클릭 가능성
- 테스트 러너: assertion 결과, flaky 여부, 소요 시간
- 셸/빌드: exit code, stderr 패턴, artifact 생성 여부
- 인간 피드백: 승인, 반려, 우선순위 조정

이 관찰 결과는 단순 로그 첨부로 끝나면 안 됩니다. **태스크와 연결된 증거 객체** 로 저장돼야 합니다. 그래야 런타임이 다음 질문에 답할 수 있습니다.

- 이 실패는 코드 생성 문제인가, 실행 환경 문제인가?
- 재시도하면 해결될 유형인가, 사람 승인 없이는 못 가는가?
- 이전 수정이 실제 사용자 플로우를 개선했는가, 아니면 다른 부분을 망가뜨렸는가?

결국 stateful runtime의 본질은 "상태를 많이 저장한다"가 아닙니다. **행동과 관찰을 연결해 복구 가능한 시스템을 만든다**는 데 있습니다.

---

## 결론: 2026년의 강한 에이전트 팀은 더 많은 파일이 아니라 더 나은 상태 모델을 가진 팀이다

에이전트 생태계는 빠르게 성숙하고 있습니다. 스킬 프레임워크, 멀티 에이전트 오케스트레이션, 로컬 런타임, 브라우저 검증 루프, MCP/A2A 표준화가 한 번에 움직이는 지금, 병목은 더 이상 "모델이 코드를 얼마나 잘 쓰는가" 하나로 설명되지 않습니다.

이제 중요한 것은 **에이전트를 어떤 상태 모델 위에서 운영하느냐** 입니다.

제 결론은 분명합니다.

- `.claude/` 와 같은 파일 구조는 필요하다.
- 그러나 그것만으로는 운영 가능한 런타임이 되지 않는다.
- 파일은 영속화·감사·협업을 위한 한 계층일 뿐이다.
- 진짜 경쟁력은 planning / execution / observation / recovery / governance / context budgeting 을 별도 상태 모델로 설계하는 데서 나온다.

다르게 말하면, 앞으로의 에이전트 런타임은 작업 폴더가 아니라 **상태 제어면(control plane)** 이 되어야 합니다. 그 위에서 파일은 보이는 표면이고, 실제 신뢰성은 보이지 않는 상태 전이와 정책 엔진이 책임져야 합니다.

---

## 실무 체크리스트

아래 질문에 선명하게 답하지 못한다면, 당신의 에이전트 시스템은 아직 데모에 더 가깝습니다.

- 현재 태스크의 canonical status 를 문서가 아니라 구조화 상태로 알 수 있는가?
- 계획, 실행, 관찰, 회복 상태가 분리돼 있는가?
- 승인 필요 작업이 런타임 수준에서 실제로 차단되는가?
- 재시도 예산과 실패 유형이 상태 전이 규칙으로 정의돼 있는가?
- 브라우저/테스트/셸 관찰 결과가 태스크별 증거 객체로 연결되는가?
- 요약의 freshness 와 stale 여부를 판정하는 규칙이 있는가?
- 컨텍스트 패킷이 단계별로 조립되는가, 아니면 폴더를 통째로 넣는가?
- 파일이 시스템의 전부가 아니라, 상태를 표현하는 하나의 projection 으로 취급되는가?

이 질문들에 제대로 답하기 시작하는 순간, 에이전트는 "파일을 읽고 쓰는 LLM"에서 벗어나 **운영 가능한 소프트웨어 시스템**으로 진화하기 시작합니다.
