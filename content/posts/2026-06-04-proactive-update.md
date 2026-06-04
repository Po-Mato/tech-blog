---
title: "Event-Driven Agent Orchestration: 상태 기계와 이벤트 소싱으로 AI 에이전트의 신뢰성 확보하기"
date: "2026-06-04"
description: "LangGraph, Burr, AutoGen이 상태 기계(state machine) 패턴을 채택하는 이유와, Event-Driven Architecture가 AI Agent Orchestration에서 Request-Response 패턴보다 신뢰성이 높은 근거를 TypeScript 코드 예제와 실전 아키텍처 패턴으로 해부한다. 프로덕션 크론과 에이전트 워크플로우에서 겪는 '조용한 실패(silent failure)'를 5가지 이벤트 주도 패턴으로 해결하는 방법."
tags:
  - Event-Driven Architecture
  - State Machine
  - AI Agents
  - Agent Orchestration
  - TypeScript
  - Reliability Patterns
  - Event Sourcing
  - LangGraph
  - Burr
  - Workflow Engine
---

## 1. 들어가며: 크론이 실패하고 에이전트는 조용히 무시한다

프로덕션 AI 에이전트 시스템을 운영해본 엔지니어라면 이런 경험이 있다:

17개의 크론잡이 동시에 실행 중이고, 그중 3개는 단일 모델 provider에 의존한다. 갑자기 API rate limit이 터지면서 3개 크론이 조용히 실패한다. 그런데 로그를 뒤져보니 에러 메시지조차 제대로 기록되지 않았다. 에이전트는 "처리 완료"라고 응답했지만, 실제로는 아무 일도 일어나지 않았다.

이것은 **AI Agent Orchestration의 근본적인 패러다임 문제**다:

```
// ❌ Request-Response 방식 — 실패가 전파되지 않는다
async function runDailyCron() {
  const result = await agent.process("오늘의 태스크 실행");
  console.log("완료:", result); // 에러가 발생해도 여기 도달할 수 있다
}
```

Request-Response 모델은 "요청을 보내고 응답을 기다린다"는 단순한 가정 위에 설계되어 있다. 하지만 AI 에이전트는:

1. LLM 호출이 실패할 수 있다 (네트워크, rate limit, 타임아웃)
2. Tool 호출이 부분적으로 성공할 수 있다 (일부 도구만 실행됨)
3. 상태 전이 중간에 중단될 수 있다 (OOM, 크래시)
4. 부작용(side effect)이 이미 발생했는데 실패했다 (멱등성 위반)

이 모든 문제의 공통점은 **에이전트 실행을 상태 기계(State Machine)로 모델링하지 않았기 때문**이다.

## 2. 에이전트는 본질적으로 상태 기계다

LangChain의 LangGraph, Burr, Microsoft AutoGen이 모두 상태 기계(state machine) 패턴을 채택하는 데는 이유가 있다. AI 에이전트의 실행 주기는 다음과 같은 **유한 상태 집합(FSM)**으로 표현될 수 있다:

```
           +---------+
           |  IDLE   |
           +---------+
               |
               v
        +------------+
        | REASONING  | <----+
        +------------+      |
               |            |
        +------+------+     |
        |             |     |
        v             v     |
   +--------+   +---------+ |
   |TOOL_CALL|  | COMPLETE| |
   +--------+   +---------+ |
        |                    |
        +--------------------+ (loop: reasoning → tool_call)
```

이 FSM을 코드로 표현하면 다음과 같다:

```typescript
// ✅ Agent State Machine — 타입 안전한 상태 전이
type AgentState =
  | { status: "idle" }
  | { status: "reasoning"; input: string; tokenCount: number }
  | { status: "tool_call"; tool: string; args: unknown; attempt: number }
  | { status: "complete"; output: string }
  | { status: "failed"; error: Error; phase: string; recovered: boolean };

// 상태 전이 함수 — 순수 함수로 각 전이를 정의
function transition(state: AgentState, event: AgentEvent): AgentState {
  switch (state.status) {
    case "idle":
      if (event.type === "START") {
        return { status: "reasoning", input: event.input, tokenCount: 0 };
      }
      return state;
      
    case "reasoning":
      if (event.type === "TOOL_REQUIRED") {
        return {
          status: "tool_call",
          tool: event.tool,
          args: event.args,
          attempt: 0
        };
      }
      if (event.type === "COMPLETE") {
        return { status: "complete", output: event.output };
      }
      if (event.type === "ERROR") {
        return { status: "failed", error: event.error, phase: "reasoning", recovered: false };
      }
      return state;
      
    case "tool_call":
      if (event.type === "TOOL_RESULT" && state.attempt < 3) {
        return { status: "reasoning", input: event.result, tokenCount: 0 };
      }
      if (event.type === "TOOL_RETRY" && state.attempt < 3) {
        return { ...state, attempt: state.attempt + 1 };
      }
      if (event.type === "ERROR") {
        return { status: "failed", error: event.error, phase: `tool:${state.tool}`, recovered: false };
      }
      return state;
      
    default:
      return state;
  }
}
```

이 단순한 FSM만으로도 다음과 같은 장점이 생긴다:

- **멱등성**: 동일한 상태 + 동일한 이벤트는 항상 동일한 다음 상태를 반환
- **추적 가능성**: 모든 상태 전이가 명시적이므로 Execution Journal 작성이 자연스러움
- **실패 격리**: 각 상태에서 실패 처리를 독립적으로 정의 가능

## 3. Event-Driven Orchestration: 왜 Request-Response보다 나은가

전통적인 크론 기반 에이전트는 "주기적으로 요청을 보내고 완료를 기다린다"는 패턴을 사용한다. 이 패턴의 치명적인 단점은 **중간 상태의 손실**이다:

### 3.1 Request-Response 패턴의 문제

```typescript
// ❌ Request-Response: 중간 상태가 손실됨
class CronAgent {
  async executeWorkflow(): Promise<void> {
    const step1 = await this.processStep("데이터 수집");
    // 여기서 crash 발생 → step1의 결과 영구 손실
    
    const step2 = await this.processStep(step1.result);
    const step3 = await this.processStep(step2.result);
  }
}
```

크래시가 발생하면 `step1`의 결과는 메모리에서 사라진다. 재시작하면 처음부터 다시 시작해야 한다. 이미 수행된 API 호출은 중복 실행될 수 있고, 이는 비멱등(non-idempotent) 연산에서 심각한 데이터 무결성 문제를 일으킨다.

### 3.2 Event-Driven 패턴의 솔루션

```typescript
// ✅ Event-Driven: 모든 상태를 이벤트 저장소에 기록
interface Event {
  type: string;
  payload: unknown;
  timestamp: number;
  correlationId: string;
}

class EventSourcedAgent {
  private events: Event[] = [];
  private state: AgentState = { status: "idle" };
  
  // 이벤트를 저장하고 상태를 재구성
  async apply(event: Event): Promise<void> {
    // 이벤트 저장 (내구성 확보)
    await this.eventStore.append(event);
    this.events.push(event);
    
    // 순수 함수로 상태 재구성
    this.state = transition(this.state, event);
    
    // 부작용 실행 (재시도 가능)
    await this.executeSideEffects(event);
  }
  
  // 장애 복구: 모든 이벤트를 다시 재생
  async recover(correlationId: string): Promise<void> {
    const history = await this.eventStore.getEvents(correlationId);
    this.state = { status: "idle" };
    
    for (const event of history) {
      this.state = transition(this.state, event);
    }
    
    // 중단된 지점부터 재개
    if (this.state.status === "tool_call") {
      await this.retryToolCall(this.state);
    }
  }
}
```

이 패턴의 핵심 강점:

| 측면 | Request-Response | Event-Driven |
|------|-----------------|--------------|
| **크래시 복구** | 불가능 (처음부터 재시작) | 가능 (이벤트 리플레이) |
| **부분 실패 처리** | try/catch 블록으로 처리 | 상태별 독립적 처리 |
| **멱등성 보장** | 수동 구현 필요 | 이벤트 ID 기반 자연 보장 |
| **실행 추적** | 로그 레벨에 의존 | 이벤트 스트림 자체가 로그 |
| **테스트 용이성** | Mock 의존 | 이벤트 기반 단위 테스트 |
| **확장성** | 동기적 블로킹 | 비동기 분산 처리 |

## 4. 실전 구현: 5가지 Event-Driven 패턴

이론만으로는 부족하다. 실제 OpenClaw 또는 유사한 에이전트 시스템에 적용할 수 있는 5가지 패턴을 코드와 함께 제시한다.

### 4.1 Outbox 패턴 — 메시지 손실 방지

AI 에이전트가 작업을 완료했는데 상태 업데이트가 저장되지 않는 문제를 방지한다:

```typescript
// 📦 Outbox: 작업 결과와 이벤트 발행을 원자적으로 처리
interface OutboxRecord {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
  status: "pending" | "published" | "failed";
  createdAt: Date;
}

class OutboxAgent {
  async executeWithOutbox(task: Task): Promise<void> {
    // 데이터베이스 트랜잭션 안에서:
    await this.db.transaction(async (tx) => {
      // 1. 실제 작업 수행
      const result = await task.execute();
      
      // 2. 상태 업데이트
      await tx.taskState.update(task.id, { status: "completed", result });
      
      // 3. Outbox에 이벤트 기록 (동일 트랜잭션)
      await tx.outbox.insert({
        aggregateId: task.id,
        eventType: "task.completed",
        payload: result,
        status: "pending",
        createdAt: new Date()
      });
    });
    
    // 별도의 publisher가 Outbox 폴링하여 이벤트 발행
    // → 발행 실패해도 데이터 손실 없음
  }
}

// 🏃 Outbox Publisher (별도 프로세스)
async function publishOutbox(db: Database, broker: EventBroker): Promise<void> {
  const pending = await db.outbox.findMany({ status: "pending" });
  
  for (const record of pending) {
    try {
      await broker.publish(record.eventType, record.payload);
      await db.outbox.update(record.id, { status: "published" });
    } catch (error) {
      await db.outbox.update(record.id, { 
        status: "failed", 
        error: String(error),
        retryAt: new Date(Date.now() + 5000)
      });
    }
  }
}
```

### 4.2 Saga 패턴 — 분산 트랜잭션의 보상

여러 에이전트가 협력하는 Multi-Agent 시스템에서 하나의 실패가 전체 워크플로우를 망가뜨리는 것을 방지한다:

```typescript
// 🔄 Saga: 분산 보상 트랜잭션
interface SagaStep {
  name: string;
  execute: () => Promise<void>;
  compensate: () => Promise<void>; // 롤백 로직
}

class SagaOrchestrator {
  private steps: SagaStep[] = [];
  private executedSteps: string[] = [];
  
  addStep(step: SagaStep): void {
    this.steps.push(step);
  }
  
  async execute(): Promise<void> {
    for (const step of this.steps) {
      try {
        await step.execute();
        this.executedSteps.push(step.name);
      } catch (error) {
        // ⚠️ 실패 시 역순으로 보상 실행
        await this.rollback();
        throw new SagaError(`Step "${step.name}" failed`, error);
      }
    }
  }
  
  private async rollback(): Promise<void> {
    // 역순으로 보상
    for (const name of this.executedSteps.reverse()) {
      const step = this.steps.find(s => s.name === name)!;
      try {
        await step.compensate();
      } catch (compensationError) {
        // 보상 실패는 별도로 기록 (수동 개입 필요)
        await this.alertOperator(name, compensationError);
      }
    }
  }
}

// 사용 예: 환불 워크플로우
const refundSaga = new SagaOrchestrator();
refundSaga.addStep({
  name: "결제 취소",
  execute: () => paymentService.cancel(txId),
  compensate: () => paymentService.restore(txId),
});
refundSaga.addStep({
  name: "재고 복원",
  execute: () => inventory.restore(productId, quantity),
  compensate: () => inventory.deduct(productId, quantity),
});
refundSaga.addStep({
  name: "알림 발송",
  execute: () => notification.send(userId, "환불 완료"),
  compensate: async () => {}, // 알림은 되돌릴 수 없음
});
```

### 4.3 Event Carried State Transfer — 내구성과 성능의 균형

에이전트가 상태를 조회하기 위해 매번 DB를 호출하지 않고, 이벤트에 포함된 상태 데이터를 활용한다:

```typescript
// 🚚 Event Carried State Transfer
interface AgentTaskEvent {
  type: "task.created" | "task.running" | "task.completed" | "task.failed";
  taskId: string;
  // 상태를 이벤트에 함께 전달
  state: {
    status: string;
    progress: number;
    result?: unknown;
    error?: string;
    version: number; // 낙관적 락
  };
  metadata: {
    timestamp: number;
    correlationId: string;
    causationId: string; // 원인이 된 이전 이벤트 ID
  };
}

// Consumer 측: 이벤트로 최신 상태 유지
class TaskProjection {
  private tasks = new Map<string, AgentTaskEvent["state"]>();
  
  async handleEvent(event: AgentTaskEvent): Promise<void> {
    // 낙관적 락: 오래된 버전의 이벤트는 무시
    const current = this.tasks.get(event.taskId);
    if (current && current.version >= event.state.version) {
      return; // 이미 최신 상태
    }
    this.tasks.set(event.taskId, event.state);
  }
  
  getTask(taskId: string): AgentTaskEvent["state"] | undefined {
    return this.tasks.get(taskId);
    // DB 조회 없이 메모리에서 바로 반환!
  }
}
```

### 4.4 Dead Letter Agent — 복구 불가능한 실패의 처리

모든 재시도가 실패한 메시지를 처리하는 전용 에이전트:

```typescript
// 💀 Dead Letter Agent
class DeadLetterHandler {
  private readonly maxRetries = 5;
  private readonly backoff = [1000, 5000, 15000, 60000, 300000]; // 1s, 5s, 15s, 1m, 5m
  
  async handleFailedMessage(message: FailedMessage): Promise<void> {
    if (message.retryCount < this.maxRetries) {
      // 지수 백오프 재시도
      const delay = this.backoff[message.retryCount] || 300000;
      await this.scheduleRetry(message, delay);
      return;
    }
    
    // 최대 재시도 초과 → Dead Letter Queue로 이동
    await this.deadLetterQueue.enqueue({
      originalMessage: message.payload,
      errorHistory: message.errors,
      lastError: message.lastError,
      failedAt: new Date(),
      suggestedAction: this.suggestRecovery(message),
    });
    
    // 담당자 알림 (PagerDuty, Slack 등)
    await this.notifyOperator({
      level: "critical",
      title: `에이전트 태스크 복구 불가: ${message.correlationId}`,
      description: `최대 ${this.maxRetries}회 재시도 후에도 실패`,
      suggestedAction: this.suggestRecovery(message),
    });
  }
  
  private suggestRecovery(message: FailedMessage): string {
    // 실패 패턴 분석 → 자동 복구 제안
    if (message.lastError.includes("rate_limit")) {
      return "Rate limit 초과: 1시간 후 자동 재시작 예약";
    }
    if (message.lastError.includes("timeout")) {
      return "타임아웃: 타임아웃 값을 2배로 증가하고 재시도";
    }
    if (message.lastError.includes("auth")) {
      return "인증 실패: 토큰 갱신 필요 (수동 개입)";
    }
    return "수동 분석 필요: 운영자 개입 요청";
  }
}
```

### 4.5 State Machine Watcher — 상태 전이 모니터링

에이전트가 특정 상태에 너무 오래 머물러 있거나(무한 루프), 잘못된 상태 전이가 발생하는 것을 감지:

```typescript
// 👁️ State Machine Watcher
class StateMachineWatcher {
  private readonly timeouts: Map<string, number> = new Map();
  private readonly maxReasoningTime = 30_000; // 30초
    
  onTransition(agentId: string, from: AgentState, to: AgentState): void {
    const prevTimeout = this.timeouts.get(agentId);
    if (prevTimeout) clearTimeout(prevTimeout);
    
    if (to.status === "reasoning") {
      // Reasoning 상태 타임아웃 설정
      const timeout = setTimeout(async () => {
        console.warn(`[WATCHER] Agent ${agentId} stuck in reasoning >30s`);
        
        // 강제 상태 전이: reasoning → tool_call (fallback)
        const forcedEvent: AgentEvent = {
          type: "FORCE_TOOL_CALL",
          tool: "fallback",
          args: { reason: "reasoning_timeout" },
        };
        
        await this.forceTransition(agentId, forcedEvent);
      }, this.maxReasoningTime);
      
      this.timeouts.set(agentId, timeout as unknown as number);
    }
    
    // 무한 루프 감지: 동일 상태 전이 반복
    if (this.detectLoop(agentId, from, to)) {
      console.warn(`[WATCHER] Agent ${agentId} detected loop: ${from.status} -> ${to.status}`);
      this.breakLoop(agentId);
    }
  }
  
  private detectLoop(agentId: string, from: AgentState, to: AgentState): boolean {
    const key = `${from.status}->${to.status}`;
    const history = this.loopHistory.get(agentId) || [];
    history.push(key);
    
    // 최근 5번의 전이 중 3번 이상 같은 패턴 → 루프 의심
    const recent = history.slice(-5);
    const count = recent.filter(k => k === key).length;
    
    return count >= 3;
  }
}
```

## 5. 아키텍처: 전체 시스템 구성

이 5가지 패턴을 통합한 최종 아키텍처는 다음과 같다:

```
                    ┌─────────────────────────────┐
                    │     Event Store (Kafka/RDB)  │
                    │    - Append-only log         │
                    │    - Event sourcing storage   │
                    └──────────┬──────────────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         │                     │                     │
         v                     v                     v
   ┌───────────┐       ┌──────────────┐     ┌─────────────┐
   │  Outbox   │       │ Agent FSM    │     │  Watcher    │
   │  Publisher│──────▶│ Orchestrator │────▶│  Guard      │
   └───────────┘       └──────┬───────┘     └─────────────┘
                              │
                    ┌─────────┴─────────┐
                    │                   │
                    v                   v
             ┌──────────┐       ┌──────────────┐
             │  Saga    │       │ Dead Letter  │
             │ Executor │       │   Handler    │
             └──────────┘       └──────────────┘
```

각 구성 요소의 역할:

| 컴포넌트 | 역할 | 실패 시나리오 | 대응 전략 |
|---------|------|-------------|----------|
| **Event Store** | 모든 이벤트를 Append-only로 저장 | 스토리지 장애 | Write-ahead log, replica |
| **Outbox Publisher** | DB 트랜잭션과 이벤트 발행을 원자적으로 처리 | Publisher crash | Transactional outbox, 재시도 |
| **Agent FSM Orchestrator** | 타입 안전한 상태 전이 관리 | 비정상 상태 | Watcher가 감지하고 강제 전이 |
| **Saga Executor** | 분산 트랜잭션의 보상 처리 | 보상 실패 | Dead Letter로 에스컬레이션 |
| **Watcher Guard** | 상태 전이 모니터링 및 무한 루프 감지 | Watcher 자체 크래시 | Health check + restart |
| **Dead Letter Handler** | 복구 불가능한 실패의 수집 및 알림 | Queue overflow | 알림 우선순위별 처리 |

## 6. 주의사항: Event-Driven 도입 시 반드시 고려할 점

Event-Driven 패턴은 강력하지만, 무분별한 도입은 오히려 복잡도를 증가시킨다.

### 6.1 이벤트 스키마 진화

```typescript
// Schema evolution 고려 사항
interface TaskEvent {
  type: "task.completed";
  version: 2;  // 🔴 스키마 버전 명시
  payload: {
    taskId: string;
    result: string;
    
    // v2에서 추가된 필드 (optional로 하위 호환성 확보)
    latency?: number;
    tokenUsage?: { prompt: number; completion: number };
  };
}

// 마이그레이션 함수
function migrateV1ToV2(event: unknown): TaskEvent {
  const v1 = event as any;
  return {
    type: "task.completed",
    version: 2,
    payload: {
      taskId: v1.payload.taskId,
      result: v1.payload.result,
    }
  };
}
```

### 6.2 멱등성 보장

이벤트가 중복 전달될 수 있다는 가정 하에 설계하라:

```typescript
// 멱등한 이벤트 핸들러
class IdempotentHandler {
  private processedEvents = new Set<string>();
  
  async handle(event: AgentEvent): Promise<void> {
    // 이벤트 ID 기반 중복 제거
    if (this.processedEvents.has(event.id)) {
      return; // 이미 처리됨
    }
    this.processedEvents.add(event.id);
    
    // 실제 처리 로직
    await this.process(event);
  }
  
  // 재시작 시 processedEvents를 복원
  async restore(): Promise<void> {
    const recentIds = await this.eventStore.getProcessedIds(/* last 1 hour */);
    for (const id of recentIds) {
      this.processedEvents.add(id);
    }
  }
}
```

### 6.3 과도한 이벤트 분할 금지

모든 것을 이벤트로 만들면 디버깅이 어려워진다:

```
❌ Bad: 너무 세분화된 이벤트
token.prompt.encoding.started
token.prompt.kv_cache.allocated
token.prompt.attention.computed
token.prompt.encoding.completed
token.generation.started  // ← 그래서? 어떤 태스크의 일부인지?

✅ Good: 의미 있는 경계의 이벤트
task.started    { taskId, type: "daily-cron", timestamp }
reasoning.begin { taskId, input, tokenBudget }
tool.call      { taskId, tool: "search", query, attempt: 1 }
tool.result    { taskId, tool: "search", status: "success", latency }
reasoning.end  { taskId, output, tokenUsed }
task.completed { taskId, result, totalLatency }
```

규칙: **인간이 이벤트 스트림만 보고 태스크의 진행 상황을 이해할 수 있어야 한다.**

## 7. 마치며: Request-Response에서 Event-Driven으로

크론 기반 자동화를 운영하면서 "왜 이건 조용히 실패할까"라는 질문을 던진 적이 있다면, 답은 아키텍처에 있다. Request-Response는 단순한 요청에는 적합하지만, 상태를 유지하고 복구해야 하는 에이전트 워크플로우에는 태생적으로 부적합하다.

Event-Driven 패턴으로 전환하면:

1. **조용한 실패(Silent Failure)가 사라진다** — 모든 상태 전이가 이벤트 스토어에 기록된다
2. **크래시 복구가 선형적이다** — 이벤트 리플레이만으로 중단된 지점부터 재개 가능
3. **멱등성이 자연스럽게 확보된다** — 이벤트 ID 기반 중복 제거
4. **운영 가시성이 확보된다** — 이벤트 스트림 자체가 완벽한 감사 로그

가장 중요한 것은 단순하게 시작하는 것이다. 모든 것을 Event-Driven으로 바꾸려 하지 말고, 오늘 당장 가장 고통받는 크론 하나부터 Outbox 패턴을 적용해보라. 그 차이를 직접 경험할 수 있을 것이다.

---

### 참고 자료

- LangGraph State Management Guide, 2026 — https://langchain-ai.github.io/langgraph/
- Burr: State Machine for Agent Workflows, 2026 — https://github.com/dagworks-inc/burr
- Microsoft AutoGen: Event-Driven Multi-Agent Framework, 2026 — https://microsoft.github.io/autogen/
- Martin Fowler: Event Sourcing Pattern — https://martinfowler.com/eaaDev/EventSourcing.html
- Pat Helland: "Immutability Changes Everything" — https://queue.acm.org/detail.cfm?id=2884038
