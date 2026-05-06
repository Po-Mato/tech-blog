---
title: "Durable Execution for AI Agents — LLM 기반 에이전트의 장시간 태스크를 안전하게 완수하기"
date: 2026-05-06
description: "AI Agent가 복잡한 작업을 수행하다 중간에 실패했을 때, 처음부터 다시 시작해야 할까? Durable Execution 패턴을 활용해 에이전트의 장시간 태스크를 내구성 있게 설계하는 방법을, Temporal, Inngest, LangGraph Checkpointing과 함께 실전 코드와 함께 다룬다."
tags:
  - AI Agents
  - Durable Execution
  - Temporal
  - LangGraph
  - Failure Recovery
  - Production AI
  - Workflow Engine
  - Agent Architecture
---

## 서론: 에이전트가 멈추는 순간

4월 13일의 글에서 Agent SLO와 Failure Recovery 패턴을 discussed했다. 그 글의 결론 중 하나는 "에이전트의 실패는 통상적인 HTTP 타임아웃과 다르다"는 것이었다. 사용자가 "삼성전자 재무제표 분석해줘"라고 요청하면, 에이전트는 수십 개의 내부 단계를 거친다 — 웹 검색, 데이터 파싱, 계산, 문서 생성. 그 어떤 단계에서든 실패할 수 있고, 실패 시 사용자는 그냥 "실패했습니다"만 받는다.

2026년 현재, 이 문제는 기업 AI 도입의 가장 큰 마찰점 중 하나다. Durable execution — 작업의 중간 상태를 저장하고, 실패 시 마지막 성공 지점에서 재개하는 능력 — 이 그 해법이다.

---

## 1. Durable Execution이란 무엇인가

### 전통적 실행 모델의 한계

일반적인 API 호출 모델에서 함수는 실행되거나 실패한다. 실패하면 예외를 던지고 호출자가 처리한다. 재시도가 필요하면 명시적으로 구현해야 한다.

```
[API Request] → [Function Executes] → [Success OR Exception]
                 ↑ 이 사이에 100단계가 있어도
                 실패 시 전체 롤백
```

### Durable Execution의 모델

Durable execution은 함수의 실행 상태를 인프라 레벨에서 추적한다. 각 단계(signal)가 완료될 때마다 상태를 persistence layer에 기록한다. 프로세스가 충돌해도, 마지막 완료된 단계에서 재개한다.

```
[Step 1] → [Step 2] → [Step 3] → [CRASH] → [Resume from Step 3]
              ↓          ↓          ↓
          [Saved]    [Saved]     [Saved]
```

이 모델은 단순 재시도와 다르다. 단순 재시드는 "실패하면 처음부터"이지만, durable execution은 "실패하면 이미 완료된 작업을 반복하지 않음"을 보장한다.

### 주요 구현체

| 시스템 | 모델 | 특징 |
|--------|------|------|
| **Temporal** | Workflow-as-code | Go/Java/TS SDK, 강한 일관성 |
| **Inngest** | Event-driven | Serverless 친화적, TypeScript 우선 |
| **AWS Step Functions** | State machine | 서버리스 통합, 규정 준수 강조 |
| **LangGraph Checkpointing** | Graph-based | LLM 에이전트 특화, 상태 추적 |
| **Convex** | Reactive | 실시간 협업 지원 |

---

## 2. AI Agent에서 Durable Execution이 중요한 이유

### 에이전트의 본질: 장시간, 비결정적 태스크

LLM 기반 에이전트는 다음과 같은 고유한 특성을 가진다:

1. **비결정적 실행**: 같은 입력이라도 모델이 다르게 응답할 수 있음
2. **장시간 실행**: 복잡한 태스크는 수십 초~수 분이 소요됨
3. **멀티스텝 의존성**: 앞 단계의 출력이 뒤 단계의 입력으로 사용됨
4. **외부 의존성**: 웹 검색, API 호출, 파일 시스템 등 네트워크 IO에 의존

### 실패 시나리오 분석

```
[사용자 요청]
    ↓
[Plan 생성] → 실패 시 → 처음부터 Plan 재생성 (API 비용 낭비)
    ↓
[웹 검색 x5] → 3개만 성공, 2개 실패 → 성공한 것만 사용? 처음부터 재시도?
    ↓
[데이터 파싱] → 파싱 실패 → 어떻게 recovery?
    ↓
[보고서 생성] → 중간에 연결 끊김 → 얼마나 많이 날아갔는가?
```

传统的 재시도 구조에서는 이 모든 단계가 처음부터 다시 시작된다. Plan 생성부터 다시 하고, 검색을 다시 하고. 비용과 시간이 낭비된다.

### Durable Execution이 해결하는 것

1. **멀티스텝 롱테스트의 원자성**: 전체 태스크를 하나의 durable한 작업으로 감싸서, 실패 지점부터 재개
2. **검증된 스텝 재실행 방지**: 완료된 스텝은 두 번 실행되지 않음 (idempotency 보장)
3. **사용자 대기 시간 관리**: 긴 작업의 진행 상황을 사용자에게 투명하게 제공
4. **비용 최적화**: 실패 시 불필요한 LLM API 호출 제거

---

## 3. 실전 구현: LangGraph Checkpointing

LangGraph는 내장된 checkpointing 메커니즘을 제공한다. 상태(state)를 persistence layer에 저장하고, 실패 시 마지막 상태에서 그래프 실행을 재개한다.

### 기본 예제: 검색 + 분석 에이전트

```typescript
import { StateGraph, MemorySaver, Annotation } from "@langchain/langgraph";
import { z } from "zod";

// 상태 스키마 정의
const AgentState = Annotation.Root({
  query: Annotation<string>,           // 사용자 질문
  searchResults: Annotation<any[]>,     // 검색 결과
  analysis: Annotation<string>,        // 분석 결과
  error: Annotation<string | null>,     // 에러 상태
  step: Annotation<number>,             // 현재 단계 추적
});

// 검색 스텝
async function searchStep(state: typeof AgentState.State) {
  console.log(`[Step ${state.step}] 검색 실행: ${state.query}`);
  
  // 외부 웹 검색 시뮬레이션 (실제로는 Tavily, Serper 등 사용)
  const results = await performWebSearch(state.query);
  
  if (results.length === 0) {
    // 실패 시 상태 저장 후 예외 throw (recovery 포인트)
    throw new Error("검색 결과 없음 — 재시도 필요");
  }
  
  return {
    searchResults: results,
    step: state.step + 1,
    error: null,
  };
}

// 분석 스텝
async function analysisStep(state: typeof AgentState.State) {
  console.log(`[Step ${state.step}] 분석 실행 — ${state.searchResults.length}개 결과`);
  
  const analysis = await performAnalysis(state.searchResults, state.query);
  
  return {
    analysis,
    step: state.step + 1,
  };
}

// 에러 핸들링 스텝
function errorHandler(state: typeof AgentState.State, error: Error) {
  return {
    error: error.message,
    step: state.step,
  };
}

// 그래프 정의
const workflow = new StateGraph(AgentState)
  .addNode("search", searchStep)
  .addNode("analysis", analysisStep)
  .addNode("errorHandler", errorHandler)
  .addEdge("__start__", "search")
  .addConditionalEdges(
    "search",
    (state) => state.error ? "errorHandler" : "analysis"
  )
  .addEdge("analysis", "__end__")
  .addEdge("errorHandler", "__end__")
  .compile();

// Checkpointer 설정 (이것이 핵심)
const checkpointer = new MemorySaver();
const app = workflow.compile({ checkpointer });

// 실패 시나리오: 태스크 실행 중 중단
async function runWithDurability(userQuery: string, threadId: string) {
  try {
    // 첫 실행: 검색까지만 완료 후 '중단'되었다고 가정
    const config = { configurable: { thread_id: threadId } };
    
    // 상태 업데이트만 수행 (중간 저장)
    await app.updateState(config, {
      query: userQuery,
      step: 1,
      searchResults: [{ title: "삼성전자 2025 연간보고서", url: "..." }],
    });
    
    console.log("✅ 상태 저장 완료 — 다음 실행에서从这里 재개");
    
  } catch (error) {
    console.error("에이전트 실행 실패:", error);
  }
}

// 재개 실행: 저장된 상태에서 pick up
async function resumeExecution(threadId: string) {
  const config = { configurable: { thread_id: threadId } };
  
  // checkpointer가 자동으로 마지막 상태를 복원
  const existingState = await app.getState(config);
  console.log(`재개: Step ${existingState.values.step}부터 계속`);
  
  const result = await app.invoke(null, config);
  console.log("최종 분석 결과:", result.analysis);
}
```

### Checkpointing 아키텍처 내부

LangGraph의 checkpointing은 3단계로 동작한다:

```
[Checkpointer Interface]
        ↓
┌──────────────────────────────────────┐
│  1. dump(state) → serialized blob   │
│     - 전체 상태 그래프를 직렬화        │
│     - 스레드 ID별로 구분               │
│                                      │
│  2. load(thread_id) → state         │
│     - 마지막 checkpoint 복원           │
│     - 간으한 경우 diff 기반 증분 저장  │
│                                      │
│  3. get_versions                     │
│     - 히스토리 조회 지원               │
└──────────────────────────────────────┘
        ↓
[Persistence Layer]
  - MemorySaver (개발/테스트)
  - SqliteSaver (로컬 프로덕션)
  - PostgresSaver (분산 프로덕션)
  - Custom (Redis, etc.)
```

---

## 4. Temporal를 활용한 엔터프라이즈 级 Durable Agent

LangGraph checkpointing이 경량 통합에 적합하다면, Temporal은 복잡한 엔터프라이즈 시나리오에 적합하다. Temporal은 워크플로우를 코드로 정의하고, 인프라에서完全的 내구성을 보장한다.

### Temporal 워크플로우로 에이전트 태스크 모델링

```typescript
import { ProxyAwareness } from "@temporalio/client";
import { workflow, proxyActivities } from "@temporalio/workflow";

// 외부 Activity 정의
const activities = {
  searchWeb: async (query: string) => { /* ... */ },
  analyzeData: async (data: any[]) => { /* ... */ },
  generateReport: async (analysis: string) => { /* ... */ },
  sendNotification: async (userId: string, msg: string) => { /* ... */ },
};

// 워크플로우: 실패해도 자동으로 재개
export async function stockAnalysisWorkflow(userQuery: string, userId: string) {
  // Activity Proxy — Temporal 런타임이 failure → retry를 자동 처리
  const { searchWeb, analyzeData, generateReport, sendNotification } =
    proxyActivities({ activities, startToCloseTimeout: "10m" });

  let step = 0;
  
  try {
    // Step 1: 웹 검색 (재시도 정책: 3번, 지수 백오프)
    console.log(`[Workflow Step ${++step}] 웹 검색 시작`);
    const searchResults = await searchWeb(userQuery);
    
    // Step 2: 데이터 분석
    console.log(`[Workflow Step ${++step}] 데이터 분석 시작`);
    const analysis = await analyzeData(searchResults);
    
    // Step 3: 보고서 생성
    console.log(`[Workflow Step ${++step}] 보고서 생성 시작`);
    const report = await generateReport(analysis);
    
    // Step 4: 완료 알림 (비동기 — 실패해도 태스크는 완료로 표시)
    await sendNotification(userId, `분석 완료: ${report.summary}`);
    
    return { success: true, report };
    
  } catch (err) {
    // 실패 시 계속해서 재시도 (Temporal의 내장 재시도 정책)
    console.error(`[Workflow] Step ${step} 실패 — Temporal이 재시도 스케줄링`);
    throw err;
  }
}
```

### Temporal의 재시도 메커니즘

Temporal의 가장 강력한 특성 중 하나는 **실패 메커니즘이 워크플로우 코드와 분리**되어 있다는 점이다:

```
[Activity 실행]
    ↓
[성공?] → Yes → [다음 Activity]
    ↓ No
[재시도 정책 확인]
    - Max attempts exceeded? → Workflow Failure (珠三角)
    - Retryable error? → Wait (backoff) → 재실행
    - Non-retryable error? → Immediate failure
```

```typescript
// 재시도 정책 커스터마이징
const activityConfig = {
  searchWeb: {
    startToCloseTimeout: "5m",
    retry: {
      maximumAttempts: 5,
      initialInterval: "10s",
      backoffCoefficient: 2.0,        // 10s → 20s → 40s → ...
      maximumInterval: "10m",
      nonRetryableErrorTypes: ["ValidationError", "AuthError"],
    },
  },
};
```

### 에이전트 워크플로우와 Temporal의 조합

실전에서는 에이전트의 판단 로직과 Temporal의 내구성을 결합한다:

```typescript
export async function agenticWorkflow(input: AgentInput) {
  const { searchWeb, callLLM, saveToDB } = proxyActivities({ activities });
  
  // LLM이 다음 액션을 결정 (LLM = 에이전트의 "두뇌")
  let state: AgentState = { history: [], currentTask: input.task };
  
  while (state.remainingTasks.length > 0 && state.iterations < 20) {
    // LLM이 다음 액션 결정
    const decision = await callLLM({
      prompt: buildPrompt(state),
      model: "claude-sonnet-4",
    });
    
    const action = parseAction(decision);
    
    // 액션 실행 (Temporal이 내구성 보장)
    const result = await executeAction(action, {
      searchWeb,
      // 기타 액션...
    });
    
    // 상태 업데이트
    state.history.push({ action, result });
    state.remainingTasks = updateTaskList(state.remainingTasks, action);
    
    // 중간 저장 (Temporal이 이 지점을 checkpoint로 자동 관리)
    await saveToDB({ threadId: input.threadId, state });
  }
  
  return summarize(state);
}
```

---

## 5. 에러 분류와 Recovery 전략

Durable execution을 구현할 때, 모든 에러를 동일하게 처리하면 안 된다. 에러를 분류하고 각각에 다른 recovery 전략을 적용해야 한다.

### AI Agent 에러 분류 체계

```
[에러 타입]
├── LLM API Error
│   ├── Rate Limit (429) → 지수 백오프 후 재시도 ✓
│   ├── Auth Error (401) → 롤백, 관리자 알림 ✗
│   └── Server Error (500/503) → 재시도 (비동기) ✓
│
├── External Tool Error  
│   ├── Search API 실패 → 대체 검색 엔진 사용 ✓
│   ├── 브라우저 타임아웃 → 스크린샷으로 fallback ✓
│   └── Rate Limit → 큐에 넣고 나중에 재시도 ✓
│
├── Business Logic Error
│   ├── 데이터 불일치 → 부분 결과로 계속 (graceful degradation) ✓
│   └── 검증 실패 → 사용자에게 명확한 피드백 제공 ✗
│
└── Infrastructure Error
    ├── Temporal Worker 다운 → 다른 Worker가 픽업 ✓
    ├── DB 연결 실패 → 재시도 + alerting ✓
    └── 네트워크 파티션 → Circuit Breaker 패턴 ✗
```

### Circuit Breaker 구현

```typescript
class CircuitBreaker {
  private failures = 0;
  private lastFailure = 0;
  private state: "closed" | "open" | "half-open" = "closed";
  
  constructor(
    private threshold: number = 5,
    private timeout: number = 60000,  // 1분
  ) {}
  
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      if (Date.now() - this.lastFailure > this.timeout) {
        this.state = "half-open";  // 복구 시도
      } else {
        throw new Error("Circuit breaker open — fast fail");
      }
    }
    
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  private onSuccess() {
    this.failures = 0;
    this.state = "closed";
  }
  
  private onFailure() {
    this.failures++;
    this.lastFailure = Date.now();
    if (this.failures >= this.threshold) {
      this.state = "open";
    }
  }
}

// 사용 예
const breaker = new CircuitBreaker({ threshold: 3, timeout: 30000 });

// searchWeb Activity를 circuit breaker로 감싸기
const resilientSearch = (query: string) => 
  breaker.execute(() => searchWeb(query));
```

---

## 6. Human-in-the-Loop:Durable Execution의 미issing Piece

Durable execution은 자동화된 태스크에 완벽하지만, AI Agent에는もう一つの 레이어가 필요하다: **Human-in-the-Loop (HITL)**. 에이전트가 불확실한 지점에서 사람의 결정을 요청해야 하는 경우가 있다.

### HITL 패턴: 승인 기반 재개

```typescript
export async function humanInTheLoopWorkflow(task: Task) {
  const { executeStep, requestApproval, saveResult } = proxyActivities({ activities });
  
  const state = await loadState(task.threadId);
  
  for (const step of state.pendingSteps) {
    if (step.requiresApproval) {
      // 사람에게 승인 요청 — 여기서 워크플로우가 PAUSE 상태로 유지됨
      const approval = await requestApproval({
        stepId: step.id,
        description: step.description,
        preview: step.preview,
        timeout: "1h",  // 1시간 동안 대기
      });
      
      if (!approval.approved) {
        return { status: "rejected", step: step.id };
      }
    }
    
    const result = await executeStep(step);
    await saveResult({ stepId: step.id, result, timestamp: Date.now() });
  }
  
  return { status: "completed" };
}
```

Temporal에서는 `signal`을 통해 런타임에 워크플로우와 통신할 수 있다:

```typescript
// 워크플로우에서 사용자 승인 대기
export async function approvalWorkflow(task: string) {
  let approved = false;
  
  //.signal()은 워크플로우 실행을 블로킹하지 않고 등록만 함
  workflow.setSignalHandler("approvalSignal", (approved: boolean) => {
    approved = approved;
  });
  
  // 사용자가 승인할 때까지 대기
  await new Promise<void>((resolve) => {
    const check = setInterval(async () => {
      if (approved) {
        clearInterval(check);
        resolve();
      }
    }, 1000);
  });
  
  return "Approved — proceeding";
}
```

---

## 7. 모니터링과 Observability

Durable execution의 이점은 자동이지만, 모니터링 없이는自信を持って 운영할 수 없다.

### 핵심 메트릭

```typescript
// Temporal 워크플로우 메트릭 통합
const metrics = {
  // 워크플로우 레벨
  workflowStartTotal: counter("agent_workflow_start_total"),
  workflowCompleteTotal: counter("agent_workflow_complete_total"),
  workflowFailTotal: counter("agent_workflow_fail_total"),
  workflowDuration: histogram("agent_workflow_duration_seconds"),
  
  // Activity 레벨
  activityRetryTotal: counter("agent_activity_retry_total"),
  activityTimeoutTotal: counter("agent_activity_timeout_total"),
  
  // Human-in-the-loop
  approvalPendingGauge: gauge("agent_approval_pending"),
  approvalResponseTime: histogram("agent_approval_response_seconds"),
};
```

### 분산 트레이싱

LangGraph + OpenTelemetry 통합:

```typescript
import { OpenTelemetryConfig } from "@langchain/langgraph-opentelemetry";

const otel = new OpenTelemetryConfig({
  serviceName: "ai-agent-service",
  tracer: tracer,
});

const app = workflow.compile({
  checkpointer,
  beforeMiddleware: otel.middleware,
});

// 각 스텝이 분산 트레이스 스팬으로 기록됨
const result = await app.invoke(initialState, {
  spanName: "stock-analysis-agent",
  attributes: {
    "agent.type": "durable",
    "agent.task": "financial-analysis",
  },
});
```

---

## 결론: Durable Execution은 선택이 아니라 필수

2026년 현재, AI Agent를 프로덕션에서 운영하는 것은 단순히 LLM API를 호출하는 것이 아니다. 복잡한 멀티스텝 태스크를 내구성 있게 실행하는 것이 핵심 역량이다.

**Durable execution이 해결하는 3가지 핵심 문제:**

1. **비용 낭비 방지**: 완료된 스텝의 재실행 제거
2. **사용자 경험**: 실패해도-progress가 사라지지 않음
3. **운영 신뢰도**: 모니터링과 재시도로 자동 복구

LangGraph의 checkpointing으로 시작하고, 복잡한 엔터프라이즈 시나리오에는 Temporal을 도입하는 것이 현실적인 전략이다. 둘 다 persistence layer를 공유하기 때문에 간단한 prototype에서 production으로 scale-up이 자연스럽다.

핵심은 **실패를 예상하고 설계**하는 것이다. 에이전트가 반드시 실패한다는 것이 아니라, "실패할 경우 어떻게 되는가"를 처음부터 설계하는 것이 Durable Execution의 철학이다.

---

### References

- Temporal Documentation: https://docs.temporal.io
- LangGraph Checkpointing: https://langchain-ai.github.io/langgraph/how-tos/checkpointing/
- AWS Step Functions: https://docs.aws.amazon.com/step-functions/
- "Building Reliable Systems" — Charity Majors, 2025
- "The Human-in-the-Loop Machine Learning" — Hunker et al., O'Reilly 2026
