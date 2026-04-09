---
title: "AI Agent Planning은 왜 Workflow Engine으로 컴파일되어야 하는가"
date: 2026-04-09
description: "최근 공개 논의에서 Durable Execution과 agent orchestration이 다시 주목받고 있습니다. 이 글은 Planning 중심 Agent를 프로덕션 시스템으로 올릴 때 왜 상태 머신, checkpoint, idempotency, approval gate가 필요한지 TypeScript 예시와 함께 정리합니다."
tags:
  - AI Agents
  - Planning
  - Durable Execution
  - Workflow Engine
  - TypeScript
  - System Design
---

## 배경: Planning이 뜨는 이유와, 바로 부딪히는 현실

오늘의 주제로 Planning을 고른 이유는 분명합니다. Agent engineering에서 이제 중요한 질문은 "모델이 답을 잘 쓰는가"가 아니라 **"복잡한 일을 단계로 쪼개고 끝까지 완수할 수 있는가"** 로 옮겨가고 있기 때문입니다. 최근 공개 논의에서도 Durable Execution, workflow orchestration, human-in-the-loop를 Agent 런타임의 핵심 축으로 다루는 흐름이 강해졌습니다. Temporal, Inngest, Mastra 같은 이름이 함께 거론되는 것도 같은 맥락입니다.

문제는 많은 팀이 Planning을 곧바로 "LLM이 step list를 잘 만들게 하는 일"로 축소한다는 점입니다. 데모에서는 그럴듯합니다. 하지만 프로덕션으로 올라가는 순간 아래 문제가 한꺼번에 터집니다.

- step 3에서 API timeout이 나면 어디서부터 다시 시작할지 모름
- 이미 실행한 외부 side effect를 중복 호출할 수 있음
- 사람 승인을 기다리는 동안 메모리 기반 상태가 사라짐
- 긴 실행 중 plan이 바뀌면 어떤 결과가 최신인지 불명확해짐

즉, **Planning은 시작점일 뿐이고, 신뢰성은 Execution 모델에서 결정됩니다.** Agent가 만든 plan은 문장이 아니라 실행 단위여야 하고, 그 실행 단위는 재개 가능하고 검증 가능해야 합니다.

이 글의 핵심 주장은 단순합니다.

> 프로덕션 Agent에서 plan은 생각의 흔적이 아니라 workflow로 컴파일되어야 한다.

## 왜 step list만으로는 프로덕션 Agent가 무너지는가

많은 구현이 아래 흐름으로 시작합니다.

```text
User Request
  -> LLM Planner
  -> Step 1
  -> Step 2
  -> Step 3
  -> Final Answer
```

이 구조는 간단하지만, 실제 운영에서는 세 가지가 빠져 있습니다.

### 1. 상태가 durable하지 않다

plan과 intermediate state가 메모리 안에만 있으면 프로세스 재시작, 컨테이너 교체, 함수 timeout 같은 흔한 이벤트만으로도 맥락이 증발합니다. 결국 재시작 이후에는 모델에게 "다시 생각해봐"를 시키게 되는데, 이때 새 plan이 이전 plan과 달라질 수 있습니다.

### 2. side effect가 안전하지 않다

결제, 메일 발송, 문서 게시, Git push 같은 작업은 한 번만 실행되어야 합니다. 하지만 retry를 naive하게 걸면 중복 실행이 발생합니다. Planning 시스템이 아니라 **effect system** 관점에서 설계해야 하는 이유입니다.

### 3. 승인과 대기가 1급 상태가 아니다

실무 Agent는 사람 승인을 자주 기다립니다. 법무 검토, 운영 승인, 고객 발송 전 확인 같은 단계가 대표적입니다. 이 시간을 그냥 sleep으로 처리하면 런타임이 낭비되고, 프로세스가 내려가면 기다리던 상태가 사라집니다.

그래서 Agent Planning을 프로덕션급으로 만들려면 아래 구조가 필요합니다.

```text
User Request
  -> Planner
  -> Plan IR
  -> Workflow Compiler
  -> Durable Workflow Runtime
      -> Activities / Tools
      -> Checkpoints
      -> Approval Gate
      -> Retry / Timeout / Compensation
  -> Verifier
  -> Final Outcome
```

핵심은 LLM이 만든 plan을 바로 실행하지 않고, **중간 표현인 Plan IR로 표준화한 뒤 workflow runtime으로 내리는 것**입니다.

## 아키텍처: Plan IR + Durable Workflow Runtime

제가 추천하는 최소 구조는 다섯 층입니다.

### 1) Planner
사용자 목표를 step으로 나눕니다. 중요한 점은 planner가 곧 executor가 아니어야 한다는 것입니다. planner의 책임은 "무엇을 해야 하는가"까지입니다.

### 2) Plan IR
LLM의 자유로운 자연어 출력을 구조화된 intermediate representation으로 바꿉니다. 여기서 입력 스키마, 예상 side effect, retry 정책, approval 필요 여부를 명시합니다.

### 3) Workflow Compiler
Plan IR을 workflow step으로 변환합니다. 이때 각 step은 durable state, timeout, retry, compensation hook을 가질 수 있어야 합니다.

### 4) Durable Runtime
실행 상태를 저장하고, 재시작 이후에도 같은 run을 이어서 진행합니다. human approval이나 외부 callback 같은 장기 대기를 안전하게 처리합니다.

### 5) Verifier
tool call 성공과 업무 성공은 다릅니다. verifier는 산출물이 정말 목표를 만족하는지 확인합니다. 예를 들어 블로그 글 생성이라면 frontmatter 유효성, 최소 분량, 코드 블록 존재, build 성공 여부를 봐야 합니다.

## 설계 원칙 1: plan은 자연어가 아니라 typed graph여야 한다

실무에서는 step list보다 directed graph가 더 적합한 경우가 많습니다. 이유는 간단합니다. 실제 업무에는 조건 분기, 재시도, 병렬 단계가 있기 때문입니다.

예를 들어 "트렌드를 수집하고, 후보 주제를 평가하고, 초안을 쓰고, 검토 후 게시"하는 작업은 선형처럼 보여도 아래처럼 분기됩니다.

- 데이터 수집 실패 시 fallback source 사용
- 주제 후보가 중복이면 다음 후보 선택
- 품질 검증 실패 시 draft 단계로 되돌아감
- 게시 승인 거부 시 draft만 저장하고 종료

이런 흐름을 자연어 문장으로만 두면 운영이 어렵습니다. 최소한 아래 정도의 IR은 있어야 합니다.

```ts
type StepKind = "tool" | "approval" | "wait" | "verify" | "branch";

type PlanStep = {
  id: string;
  kind: StepKind;
  action: string;
  input: Record<string, unknown>;
  dependsOn?: string[];
  retry?: { maxAttempts: number; backoffMs: number };
  timeoutMs?: number;
  sideEffect?: "none" | "internal-write" | "external-write";
  requiresApproval?: boolean;
  onFail?: "abort" | "retry" | "fallback" | "human-review";
};

type PlanIR = {
  goal: string;
  steps: PlanStep[];
};
```

이 모델의 장점은 planner가 조금 흔들려도 runtime 규칙은 유지된다는 점입니다. 모델은 유연해도 되고, 실행은 보수적으로 관리할 수 있습니다.

## 설계 원칙 2: tool call은 function call이 아니라 activity여야 한다

Agent 구현에서 흔한 실수는 tool을 그냥 함수처럼 호출하는 것입니다.

```ts
await sendEmail(payload);
```

이 자체는 틀리지 않지만, 프로덕션 관점에서는 정보가 부족합니다.

- 몇 번 재시도할 수 있는가
- timeout은 얼마인가
- 이미 실행됐는지 어떻게 판단하는가
- 실패 시 compensation이 있는가
- human approval 없이 실행 가능한가

그래서 tool은 activity로 승격되어야 합니다.

```ts
type ActivityContext = {
  runId: string;
  stepId: string;
  idempotencyKey: string;
};

async function runActivity<TInput, TOutput>(input: {
  ctx: ActivityContext;
  timeoutMs: number;
  execute: (ctx: ActivityContext, arg: TInput) => Promise<TOutput>;
  arg: TInput;
}) {
  const startedAt = Date.now();

  try {
    const result = await input.execute(input.ctx, input.arg);
    return {
      ok: true as const,
      result,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "unknown_error",
      latencyMs: Date.now() - startedAt,
    };
  }
}
```

이렇게 감싸면 activity는 retry, timeout, audit, idempotency key와 자연스럽게 연결됩니다.

## 설계 원칙 3: human-in-the-loop는 예외가 아니라 기본 기능이어야 한다

실무 Agent가 실패하는 지점 중 하나는 사람 승인 단계를 런타임 바깥에서 처리한다는 점입니다. 예를 들어 Slack 메시지를 보내고 "답 오면 이어서 하자"는 식으로 구현하면, 그 사이의 상태 연결이 끊기기 쉽습니다.

승인은 workflow 안에 1급 step으로 들어와야 합니다.

```ts
type ApprovalResult = "approved" | "rejected";

async function waitForApproval(input: {
  runId: string;
  stepId: string;
  reviewer: string;
  message: string;
}): Promise<ApprovalResult> {
  // 실제 환경에서는 DB 또는 workflow engine signal을 사용
  while (true) {
    const result = await readApprovalState(input.runId, input.stepId);
    if (result === "approved" || result === "rejected") return result;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
```

위 코드는 개념 예시지만, 핵심은 분명합니다. approval step은 단순 UI 이벤트가 아니라 **workflow state transition** 이어야 합니다. 그래야 재시작 이후에도 이어지고, 누가 언제 승인했는지도 감사할 수 있습니다.

## TypeScript 예시: planner 결과를 workflow로 컴파일하기

아래 예시는 framework 중립적으로 단순화한 예시입니다. Temporal, Inngest, 자체 orchestrator 어디에도 응용할 수 있는 구조입니다.

```ts
type WorkflowState = {
  runId: string;
  currentStepId?: string;
  completed: string[];
  outputs: Record<string, unknown>;
};

async function executePlan(plan: PlanIR, state: WorkflowState) {
  for (const step of plan.steps) {
    if (state.completed.includes(step.id)) continue;
    if (step.dependsOn?.some((id) => !state.completed.includes(id))) continue;

    state.currentStepId = step.id;

    if (step.kind === "approval") {
      const result = await waitForApproval({
        runId: state.runId,
        stepId: step.id,
        reviewer: "editor",
        message: "게시 전 최종 승인 필요"
      });

      if (result === "rejected") throw new Error(`approval_rejected:${step.id}`);
      state.completed.push(step.id);
      await persistState(state);
      continue;
    }

    const activity = await runActivity({
      ctx: {
        runId: state.runId,
        stepId: step.id,
        idempotencyKey: `${state.runId}:${step.id}`,
      },
      timeoutMs: step.timeoutMs ?? 30_000,
      arg: step.input,
      execute: resolveExecutor(step.action),
    });

    if (!activity.ok) {
      if (step.onFail === "retry") throw new Error(`retryable:${step.id}`);
      if (step.onFail === "human-review") throw new Error(`human_review:${step.id}`);
      if (step.onFail === "fallback") {
        await enqueueFallback(step.id, state.runId);
        continue;
      }
      throw new Error(`step_failed:${step.id}:${activity.error}`);
    }

    state.outputs[step.id] = activity.result;
    state.completed.push(step.id);
    await persistState(state);
  }

  return state;
}
```

여기서 중요한 포인트는 세 가지입니다.

- step 완료 후 바로 상태를 저장한다
- idempotency key를 step 단위로 고정한다
- 실패 정책을 plan 단계에서 명시한다

이 셋만 있어도 "다시 처음부터" 문제를 크게 줄일 수 있습니다.

## 블로그 자동화 예시: plan을 workflow로 바꾸면 무엇이 달라지나

이 주제는 블로그 자동 게시 작업에도 그대로 적용됩니다. 단순한 스크립트는 보통 이렇게 생깁니다.

1. 트렌드 수집
2. 제목 생성
3. 본문 생성
4. 파일 저장
5. git commit
6. git push

보기에는 충분하지만, 실제로는 위험합니다.

- 제목은 괜찮은데 frontmatter가 깨질 수 있음
- 본문은 길지만 코드 예시가 없을 수 있음
- 파일 저장은 됐지만 build가 실패할 수 있음
- commit은 됐지만 push가 거절될 수 있음
- 같은 날짜 글이 이미 있으면 덮어쓸 수 있음

workflow 관점으로 보면 단계가 더 명확해집니다.

```text
collect_trends
  -> score_topics
  -> dedupe_with_recent_posts
  -> draft_post
  -> self_critique
  -> revise_post
  -> verify_frontmatter
  -> verify_code_blocks
  -> build_site
  -> git_commit
  -> git_push
  -> report_result
```

이 구조의 장점은 "글 생성"이 아니라 **"게시 가능한 결과 생성"** 을 목표로 삼는다는 점입니다. Planning이 콘텐츠 품질을 정하고, workflow가 출판 품질을 보장합니다.

## 도입 전략: 처음부터 거대한 orchestration을 만들 필요는 없다

실무 팀이라면 아래 순서가 현실적입니다.

### 1단계: plan을 JSON으로 강제하기
자연어 step list 대신 typed IR을 강제하십시오. 이 단계만으로도 verifier와 runtime을 붙이기 쉬워집니다.

### 2단계: step checkpoint 저장하기
모든 step 완료 시 durable store에 상태를 남기십시오. SQLite, Postgres, Redis Streams, workflow engine history 어느 쪽이든 괜찮습니다.

### 3단계: side effect에 idempotency key 붙이기
메일, 결제, 게시, push 같은 작업은 모두 key 기반으로 중복 실행을 막아야 합니다.

### 4단계: approval과 wait를 workflow step으로 승격하기
사람 승인, webhook callback, 일정 대기는 런타임 바깥의 임시 처리로 두지 마십시오.

### 5단계: verifier를 최종 gate로 두기
tool success를 outcome success로 착각하지 않도록 최종 품질 검증 단계를 분리해야 합니다.

## 팀 체크리스트

아래 질문에 많이 답할수록 Planning 시스템이 프로덕션에 가까워집니다.

- [ ] plan이 자연어가 아니라 typed IR로 남는가?
- [ ] 각 step이 timeout, retry, onFail 정책을 갖는가?
- [ ] 외부 side effect에 idempotency key가 있는가?
- [ ] 사람 승인과 장기 대기가 workflow 안에 들어와 있는가?
- [ ] 재시작 후 같은 run을 같은 step부터 이어갈 수 있는가?
- [ ] tool success와 business success를 구분하는 verifier가 있는가?
- [ ] 최근 생성 결과와 중복 주제를 감지하는 정책이 있는가?
- [ ] planner 모델을 바꿔도 runtime 계약은 유지되는가?

## 결론

Planning은 분명 Agent의 핵심 능력입니다. 하지만 프로덕션 시스템에서 plan 자체보다 더 중요한 것은 그 plan이 **어떤 실행 모델 위에 올라가느냐** 입니다. 메모리 안의 step list는 데모를 통과시킬 수 있어도, 장애와 승인과 재시도가 섞이는 현실 세계를 버티지는 못합니다.

그래서 앞으로 강한 Agent 시스템은 planner를 더 복잡하게 만드는 팀보다, **plan을 durable workflow로 안전하게 내리는 팀** 에서 나올 가능성이 큽니다. 요약하면 이렇습니다.

- plan은 자연어 메모가 아니라 typed graph여야 한다
- tool call은 함수가 아니라 activity여야 한다
- approval과 wait는 예외가 아니라 기본 step이어야 한다
- 최종 신뢰성은 모델 성능보다 workflow runtime 설계에서 갈린다

Planning의 다음 단계는 더 긴 chain-of-thought가 아닙니다. **재개 가능하고, 검증 가능하고, 운영 가능한 execution model** 입니다.

---

### 자가 검토 및 개선 사항

1. **주제 중복 축소**: 최근 글의 MCP, SLO, journal 중심 논지와 겹치지 않도록 이번 글은 Planning을 workflow compilation 문제로 재정의했습니다.
2. **추상론 보강**: "Planning이 중요하다" 수준에 머물지 않고 Plan IR, activity, approval step, verifier까지 설계 단위를 구체화했습니다.
3. **코드 실용성 강화**: TypeScript 예시는 프레임워크 종속성을 줄이고, 어느 workflow engine에도 이식 가능한 구조로 정리했습니다.
4. **운영 관점 선명화**: retry, idempotency, side effect, 재시작 복구처럼 실제 서비스에서 먼저 깨지는 지점을 전면에 배치했습니다.
5. **가독성 개선**: 문제 제기 -> 아키텍처 -> 설계 원칙 -> 코드 -> 도입 전략 -> 체크리스트 순서로 재배열해 읽는 흐름을 단순하게 만들었습니다.
