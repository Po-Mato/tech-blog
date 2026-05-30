---
title: "AI Agent Observability 설계 패턴: Execution Journal, Agent SLO, 그리고 실전 계측"
date: "2026-05-30"
description: "프로덕션 AI 에이전트가 '조용히 실패(Silent Failure)'하는 순간을 잡아내는 방법. 전통적인 APM의 한계를 넘어선 Agent Observability의 4대 기둥(Tool Call, Reasoning, State Transition, Memory Operation)을 OpenTelemetry 기반으로 계측하고, Agent SLO와 Execution Journal을 통해 신뢰할 수 있는 에이전트 시스템을 구축하는 실전 가이드."
tags:
  - Agent Observability
  - Agent SLO
  - Execution Journal
  - OpenTelemetry
  - AI Agents
  - Production AI
  - MCP
  - Multi-Agent Systems
---

## 1. 들어가며: 에이전트가 '정상 응답'을 하면서 실패할 수 있을까?

프로덕션에서 AI 에이전트를 운영해본 팀이라면 한 번쯤 경험하는 상황이 있습니다.

- 에이전트가 "처리 완료"라고 답했는데 고객의 환불이 실제로는 처리되지 않았다.
- 대시보드의 HTTP 200 응답률은 99.9%인데, 사용자 CSAT 점수는 하락 중이다.
- LLM API 비용이 급증했는데, 트래픽 패턴에는 변화가 없다.

이것이 AI 에이전트의 가장 위험한 실패 패턴입니다: **Silent Success (조용한 성공)**. 에이전트는 정상적인 응답을 반환했지만, 내부적으로는 잘못된 도구를 호출했거나, 추론 과정에서 이탈했거나, 메모리에서 잘못된 컨텍스트를 읽어왔습니다. 전통적인 APM(Application Performance Monitoring)은 이러한 실패를 절대 감지할 수 없습니다.

이 글에서는 AI Agent Observability의 전체 설계 패턴을 다룹니다:

1. 왜 전통적인 Observability가 AI 에이전트에 실패하는가
2. Agent Observability의 **4대 기둥** (Tool Call / Reasoning / State Transition / Memory Operation)
3. **Execution Journal** 패턴: 에이전트의 모든 결정을 기록하고 재현하는 방법
4. **Agent SLO**: Task Success Rate, Time-to-Useful-Action 등 에이전트 특화 지표
5. OpenTelemetry 기반 실전 계측 코드
6. Multi-Agent 환경에서의 Trace Correlation

---

## 2. 전통적인 Observability가 에이전트에 실패하는 이유

### 2.1 결정론적 서비스 vs 비결정론적 에이전트

전통적인 APM 스택(Datadog, New Relic, Prometheus)은 결정론적(Deterministic) 서비스를 가정하고 설계되었습니다.

| 측정 항목 | 전통적 APM | 에이전트 시스템 |
|-----------|-----------|----------------|
| 동일 입력 → 동일 출력 | 보장됨 | 보장되지 않음 |
| 실패 신호 | HTTP 5xx, Timeout | Semantic 오류 (잘못된 도구 선택) |
| 실행 경로 | 고정된 코드 경로 | 모델 출력에 따라 분기 |
| 응답 성공 | 200 OK | 정답인지 확인 불가 |

에이전트 시스템의 가장 큰 차이는 **비결정론성(Non-determinism)**입니다. 같은 프롬프트가 매번 다른 도구 호출을 생성할 수 있고, 실행 경로는 모델의 reasoning output에 따라 실시간으로 분기됩니다. 200 응답은 단순히 "요청이 처리됨"을 의미할 뿐, "올바르게 처리됨"을 의미하지 않습니다.

### 2.2 '조용한 실패'가 가장 위험하다

Coralogix의 Agentic AI Observability 가이드에 따르면, 프로덕션 에이전트의 가장 위험한 패턴은 **Silent Success**입니다:

> *"The agent follows flawed reasoning or hallucinates a tool call while your metrics stay green."*

상상해보십시오. 고객 지원 에이전트가 환불 요청을 받고, 데이터베이스를 조회했으며, "환불이 완료되었습니다"라고 응답했습니다. 모든 HTTP 호출은 200, 모든 LLM 호출은 정상, 지연 시간은 허용 범위 내. 그러나 실제로는 에이전트가 서로 다른 고객 ID를 조회했고, 환불은 실행되지 않았습니다. 이 실패는 고객이 직접 전화하기 전까지 누구도 알 수 없습니다.

---

## 3. Agent Observability의 4대 기둥

Braintrust의 2026년 가이드와 OpenTelemetry GenAI semantic conventions를 종합하면, 프로덕션 에이전트의 관측 가능성을 보장하는 4가지 핵심 Span 유형이 있습니다.

### 3.1 Tool Call Span

에이전트는 도구(Tool/MCP Server)를 통해 외부 세계와 상호작용합니다. 각 Tool Call은 다음 정보를 포함해야 합니다:

```typescript
interface ToolCallSpan {
  type: 'tool_call';
  toolName: string;          // 호출된 도구 이름
  arguments: Record<string, unknown>;  // 전달된 인자
  rawOutput: unknown;        // 도구의 원본 응답
  durationMs: number;        // 실행 시간
  retryCount: number;        // 재시도 횟수
  errorState: string | null; // 에러 상태 (없으면 null)
  llmDecision: string;       // 왜 이 도구를 선택했는지 (reasoning excerpt)
}

// 실제 계측 예제
function instrumentToolCall<T>(
  toolName: string,
  args: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  const start = performance.now();
  let retries = 0;

  const attempt = async (): Promise<T> => {
    try {
      const result = await fn();
      emitSpan({
        type: 'tool_call',
        toolName,
        arguments: args,
        rawOutput: result,
        durationMs: performance.now() - start,
        retryCount: retries,
        errorState: null,
        llmDecision: captureLLMDecision(toolName, args)
      });
      return result;
    } catch (err) {
      retries++;
      if (retries < 3) return attempt();
      emitSpan({
        type: 'tool_call',
        toolName,
        arguments: args,
        rawOutput: null,
        durationMs: performance.now() - start,
        retryCount: retries,
        errorState: (err as Error).message,
        llmDecision: captureLLMDecision(toolName, args)
      });
      throw err;
    }
  };

  return attempt();
}
```

**왜 중요한가**: Hallucination된 인자(예: 잘못된 고객 ID)와 침묵하는 재시도 루프는 정상 트래픽과 구분할 수 없습니다. Tool Call Span이 없으면 이 실패는 절대 발견되지 않습니다.

### 3.2 Reasoning Span

Reasoning Span은 에이전트의 내부 추론 과정을 캡처합니다. 이것이 단순한 LLM Span과 에이전트 Span의 결정적 차이입니다.

```typescript
interface ReasoningSpan {
  type: 'reasoning';
  plan: string;              // 초기 계획
  currentStep: string;       // 현재 단계 설명
  observation: string;       // 이전 단계 결과 관찰
  nextAction: string;        // 다음 행동 결정
  confidence: number;        // 모델의 확신도 (0-1)
  planDrift: number;         // 초기 계획 대비 이탈도
}

// ReAct 패턴 계측 예제
class InstrumentedAgent {
  private originalPlan: string | null = null;
  private stepHistory: string[] = [];

  async reason(input: string): Promise<AgentDecision> {
    const response = await llm.generate([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: input }
    ]);

    const decision = parseDecision(response.text);

    // Plan drift 감지
    if (!this.originalPlan) {
      this.originalPlan = decision.plan;
    }

    const drift = calculateDrift(this.originalPlan, decision.plan);
    if (drift > 0.5) {
      console.warn(`High plan drift detected: ${drift}`);
    }

    this.stepHistory.push(decision.currentStep);

    emitSpan({
      type: 'reasoning',
      plan: decision.plan,
      currentStep: decision.currentStep,
      observation: decision.observation,
      nextAction: decision.action,
      confidence: response.confidence ?? 0.5,
      planDrift: drift
    });

    return decision;
  }
}
```

**Plan Drift**는 특히 중요한 메트릭입니다. 에이전트가 초기 계획에서 점점 멀어질수록 Task Success Rate는 급격히 하락합니다. 이 지표가 0.7 이상이면 대부분의 경우 에이전트가 원래 목표를 잃어버린 상태입니다.

### 3.3 State Transition Span

에이전트는 Multi-Turn 실행 동안 **작업 메모리(Working Memory)**를 유지합니다. 이 메모리의 상태 변화를 추적하는 것이 State Transition Span입니다.

```typescript
interface StateTransitionSpan {
  type: 'state_transition';
  before: Record<string, unknown>;  // 이전 상태
  after: Record<string, unknown>;   // 이후 상태
  delta: string[];                  // 변경된 키 목록
  contextWindowUtilization: number; // 컨텍스트 사용률 (%)
  summarizationTriggered: boolean;  // 요약 발생 여부
}

function trackStateTransition(
  before: AgentState,
  after: AgentState
): void {
  const delta = Object.keys(after).filter(
    k => JSON.stringify(before[k]) !== JSON.stringify(after[k])
  );

  emitSpan({
    type: 'state_transition',
    before: before as Record<string, unknown>,
    after: after as Record<string, unknown>,
    delta,
    contextWindowUtilization: calculateContextUsage(after),
    summarizationTriggered: delta.length > 10
  });

  // 컨텍스트 손실 경고
  if (calculateContextUsage(after) > 0.8) {
    alertContextPressure(after);
  }
}
```

**실전 교훈**: 긴 실행(10+ 턴)에서 상태 요약(Summarization)이 발생하면, 정보 손실률이 평균 30-40%에 달합니다. State Transition Span은 "왜 5턴 후에 에이전트가 이전 결정을 기억하지 못하는지"를 설명해줍니다.

### 3.4 Memory Operation Span

에이전트가 장기 메모리(Vector Store, Key-Value Store 등)에 읽기/쓰기를 수행할 때마다 기록합니다.

```typescript
interface MemoryOperationSpan {
  type: 'memory_operation';
  operation: 'read' | 'write' | 'delete';
  query: string;                     // 검색 쿼리
  returnedEntries: number;           // 반환된 항목 수
  relevanceScores: number[];          // 유사도 점수 배열
  freshnessHours: number;            // 가장 오래된 항목의 경과 시간
  stalenessWarning: boolean;         // 오래된 데이터 경고
}

// RAG(Retrieval-Augmented Generation) 계측
async function instrumentedRetrieve(query: string, topK: number): Promise<Document[]> {
  const results = await vectorStore.similaritySearch(query, topK);
  const oldestAge = Math.max(
    ...results.map(r => (Date.now() - r.timestamp) / 3600000)
  );

  emitSpan({
    type: 'memory_operation',
    operation: 'read',
    query,
    returnedEntries: results.length,
    relevanceScores: results.map(r => r.score),
    freshnessHours: oldestAge,
    stalenessWarning: oldestAge > 72  // 3일 이상 된 데이터는 경고
  });

  if (results.length === 0) {
    alertEmptyRetrieval(query);
  }

  return results;
}
```

**주요 인사이트**: 검색 결과가 0건인 Memory Read는 에이전트가 '모르는 상태'에서 추측하게 만듭니다. 이 패턴이 감지되면 즉시 Fallback 로직이나 Human-in-the-Loop로 전환해야 합니다.

---

## 4. Execution Journal: 에이전트의 결정을 재현 가능하게

Execution Journal은 위 4가지 Span을 하나의 구조화된 레코드로 통합한 개념입니다. 마치 데이터베이스의 WAL(Write-Ahead Log)처럼, 에이전트의 모든 결정과 상태 변화를 순서대로 기록합니다.

### 4.1 Execution Journal Schema

```typescript
interface ExecutionJournal {
  traceId: string;                 // 요청 단위 Trace ID
  sessionId: string;               // 세션 단위 Session ID
  agentId: string;                 // 에이전트 식별자
  userId: string;                  // 사용자 식별자 (익명화)
  
  startTime: number;               // 실행 시작 시간
  endTime: number | null;          // 실행 종료 시간
  totalDurationMs: number;         // 총 소요 시간
  
  parentTraceId: string | null;    // 상위 Trace (Multi-Agent)
  
  spans: Array<
    ToolCallSpan 
    | ReasoningSpan 
    | StateTransitionSpan 
    | MemoryOperationSpan
  >;
  
  outcome: {
    status: 'success' | 'failure' | 'partial' | 'unknown';
    taskCompleted: boolean;
    userSatisfaction?: number;     // 사용자 피드백 (0-1)
    costUSD: number;               // 이 실행의 LLM 비용
    tokenCount: {
      input: number;
      output: number;
      total: number;
    }
  };
  
  alerts: Array<{
    severity: 'info' | 'warning' | 'critical';
    type: string;                  // 'plan_drift' | 'empty_retrieval' | 'context_loss' | ...
    message: string;
    timestamp: number;
  }>;
}
```

### 4.2 Journal 기반 디버깅 워크플로우

Execution Journal이 있으면 디버깅 프로세스가 근본적으로 바뀝니다:

1. **문제 감지**: Agent SLO 위반 (예: Task Success Rate < 95%)
2. **Trace 검색**: 실패한 세션의 Execution Journal 조회
3. **Plan Drift 분석**: Reasoning Span에서 초기 계획 대비 이탈 시점 식별
4. **잘못된 Tool Call 확인**: Tool Call Span에서 Hallucination된 인자 발견
5. **메모리 상태 검토**: State Transition Span에서 Context Loss 지점 확인
6. **근본 원인 수정**: 프롬프트 조정, Tool 정의 개선, Fallback 로직 추가
7. **회귀 테스트**: 수정 사항을 Evaluation Suite에 추가

---

## 5. Agent SLO: Task Success Rate에서 Time-to-Useful-Action까지

에이전트 시스템의 SLO(Service Level Objective)는 전통적인 서비스와 완전히 다릅니다. LLM의 비결정론적 특성과 Multi-Step 실행을 고려한 새로운 지표 체계가 필요합니다.

### 5.1 핵심 Agent SLO 지표

```typescript
interface AgentSLO {
  // 1. Task Success Rate (TSR): 가장 중요한 단일 지표
  //    에이전트가 의도된 작업을 올바르게 완료한 비율
  taskSuccessRate: {
    value: number;           // 0.0 - 1.0
    target: number;          // 목표 (예: 0.97)
    windowSize: number;      // 측정 윈도우 (시간 또는 요청 수)
  };

  // 2. Time-to-Useful-Action (TTUA): 
  //    요청 → 첫 번째 유용한 Tool Call까지의 시간
  //    에이전트가 '생각만 하고' 있는지 측정
  timeToUsefulActionMs: {
    p50: number;
    p95: number;
    p99: number;
    target: number;          // P95 목표 (예: 5000ms)
  };

  // 3. Tool Call Accuracy (TCA):
  //    LLM이 선택한 도구가 실제로 올바른 도구였는지 비율
  toolCallAccuracy: {
    value: number;
    byTool: Record<string, number>;  // 도구별 정확도
    target: number;
  };

  // 4. Plan Adherence Rate (PAR):
  //    에이전트가 초기 계획에서 벗어나지 않고 실행된 비율
  planAdherenceRate: {
    value: number;
    lowDriftThreshold: number;   // 경미한 이탈 기준 (예: 0.2)
    highDriftThreshold: number;  // 심각한 이탈 기준 (예: 0.6)
  };

  // 5. Retrieval Precision:
  //    Memory Read가 관련성 있는 결과를 반환한 비율
  retrievalPrecision: {
    value: number;
    topKRelevance: number[];     // 상위 K개의 평균 관련성 점수
  };

  // 6. Cost Efficiency:
  //    성공적인 작업당 평균 LLM 비용
  costPerSuccessfulTask: {
    usd: number;
    tokensPerTask: number;
    trend: 'improving' | 'stable' | 'degrading';
  };
}
```

### 5.2 SLO 계측 구현

```typescript
class AgentSLOCollector {
  private traces: ExecutionJournal[] = [];
  private windowSize: number = 1000; // 최근 1000건 기준

  record(journal: ExecutionJournal): void {
    this.traces.push(journal);
    if (this.traces.length > this.windowSize) {
      this.traces.shift();
    }

    const slo = this.computeSLO();
    this.emitMetrics(slo);
    this.checkAlerts(slo);
  }

  private computeSLO(): AgentSLO {
    const recent = this.traces;
    const successful = recent.filter(t => 
      t.outcome.status === 'success' && t.outcome.taskCompleted
    );

    return {
      taskSuccessRate: {
        value: successful.length / recent.length,
        target: 0.97,
        windowSize: recent.length
      },
      timeToUsefulActionMs: {
        p50: percentile(recent.map(t => t.spans
          .filter(s => s.type === 'tool_call')
          .sort((a, b) => a.timestamp - b.timestamp)[0]?.durationMs ?? 0
        ), 0.5),
        p95: percentile(recent.map(t => t.spans
          .filter(s => s.type === 'tool_call')
          .sort((a, b) => a.timestamp - b.timestamp)[0]?.durationMs ?? 0
        ), 0.95),
        p99: percentile(recent.map(t => t.spans
          .filter(s => s.type === 'tool_call')
          .sort((a, b) => a.timestamp - b.timestamp)[0]?.durationMs ?? 0
        ), 0.99),
        target: 5000
      },
      // ... 나머지 지표 계산
    };
  }

  private checkAlerts(slo: AgentSLO): void {
    if (slo.taskSuccessRate.value < slo.taskSuccessRate.target * 0.95) {
      alertCritical(`Task Success Rate drop: ${(slo.taskSuccessRate.value * 100).toFixed(1)}%`);
    }
  }
}
```

### 5.3 SLO 위반의 실제 패턴

프로덕션에서 관찰된 전형적인 SLO 위반 패턴입니다:

| 패턴 | 원인 | 감지 방법 | 대응 |
|------|------|-----------|------|
| TSR 급감 | 프롬프트 변경 / 모델 업데이트 | TSR 5%↓ 감지 시 알람 | 이전 버전 프롬프트로 롤백 |
| TTUA 증가 | Tool Definition 복잡도 상승 | P95 > 10s 감지 | Tool Definition 단순화 |
| TCA 저하 | MCP Server 교체 | 특정 Tool 정확도 80%↓ | Tool 가이드라인 개선 |
| Retrieval Miss | Vector Store 데이터 오래됨 | 최근성 < 72h 경고 | 인덱스 재구축 |

---

## 6. OpenTelemetry 기반 실전 계측

이론을 실제 코드로 옮깁니다. OpenTelemetry의 GenAI semantic conventions를 사용한 에이전트 계측 예제입니다.

### 6.1 OpenTelemetry Span 설정

```typescript
import { trace, Span, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { SemanticAttributes } from '@opentelemetry/semantic-conventions';

// Tracer 초기화
const provider = new NodeTracerProvider();
provider.register();

const tracer = trace.getTracer('agent-observability');

// Agent 실행 계측 데코레이터
async function runAgent(input: string): Promise<AgentResponse> {
  // Agent Root Span 생성
  return tracer.startActiveSpan('agent.run', {
    kind: SpanKind.SERVER,
    attributes: {
      'agent.id': 'customer-support-v2',
      'agent.framework': 'openai-agents-sdk',
      'gen_ai.request.model': 'gpt-4o',
      'gen_ai.request.max_tokens': 4096,
    }
  }, async (span: Span) => {
    try {
      span.addEvent('agent.input', { 
        'app.agent.input.truncated': input.substring(0, 500)
      });

      const result = await executeAgentLoop(input);

      span.setAttribute('app.agent.tool_calls', result.toolCalls);
      span.setAttribute('app.agent.latency_ms', result.durationMs);
      span.setAttribute('app.agent.task_completed', result.completed);

      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
      return result;
    } catch (err) {
      span.setStatus({ 
        code: SpanStatusCode.ERROR, 
        message: (err as Error).message 
      });
      span.end();
      throw err;
    }
  });
}
```

### 6.2 MCP Tool Call 계측

```typescript
async function callMCPTool(
  toolName: string,
  args: Record<string, unknown>,
  serverName: string
): Promise<unknown> {
  return tracer.startActiveSpan('mcp.tool.call', {
    kind: SpanKind.CLIENT,
    attributes: {
      'mcp.server': serverName,
      'mcp.tool': toolName,
      'mcp.protocol': '2025-03-26',
    }
  }, async (span: Span) => {
    try {
      // 인자 기록 (민감 정보 마스킹)
      span.addEvent('mcp.tool.arguments', {
        'app.mcp.args': maskSensitiveData(args)
      });

      const start = Date.now();
      const result = await mcpClient.callTool(toolName, args);
      const duration = Date.now() - start;

      span.setAttribute('app.mcp.duration_ms', duration);
      span.setAttribute('app.mcp.retry_count', 0);
      
      span.addEvent('mcp.tool.result', {
        'app.mcp.result_truncated': 
          JSON.stringify(result).substring(0, 1000)
      });

      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({ 
        code: SpanStatusCode.ERROR, 
        message: (err as Error).message 
      });
      throw err;
    } finally {
      span.end();
    }
  });
}
```

### 6.3 Multi-Agent Nested Tracing

가장 까다로운 부분은 Multi-Agent 환경에서의 Trace Correlation입니다. A2A Protocol로 통신하는 에이전트 간의 추적을 연결해야 합니다.

```typescript
// Agent A → Agent B 요청 시 Trace Context 전파
async function requestAgentB(payload: AgentTask): Promise<AgentResult> {
  const currentSpan = trace.getActiveSpan();
  const traceId = currentSpan?.spanContext().traceId;
  const spanId = currentSpan?.spanContext().spanId;

  // W3C Trace Context를 A2A 요청 헤더에 포함
  const response = await fetch(`http://agent-b.internal/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'traceparent': `00-${traceId}-${spanId}-01`,
      'tracestate': `agent=customer-support-v2`
    },
    body: JSON.stringify({
      ...payload,
      _trace: { parentTraceId: traceId, parentSpanId: spanId }
    })
  });

  return response.json();
}

// Agent B에서 Trace Context 복원
async function handleAgentBRequest(req: Request): Promise<Response> {
  const traceparent = req.headers.get('traceparent');
  const context = traceparent 
    ? propagation.extract(ROOT_CONTEXT, { traceparent })
    : ROOT_CONTEXT;

  return trace.withSpan(context, async () => {
    // 이 Span은 자연스럽게 Agent A의 Trace에 연결됨
    return tracer.startActiveSpan('agent-b.execute', {
      kind: SpanKind.SERVER,
      attributes: { 'agent.id': 'billing-specialist-v1' }
    }, async (span) => {
      const result = await executeBillingAgent(req.body);
      span.end();
      return new Response(JSON.stringify(result));
    });
  });
}
```

---

## 7. Multi-Agent Trace Tree 시각화

실제 프로덕션 Multi-Agent Trace는 다음과 같은 트리 구조를 갖습니다:

```
agent.run (customer-support-v2)                    ← Root Span
├── reasoning (initial plan)                       ← Reasoning Span
├── tool_call (get_customer_info → 200 OK)        ← Tool Call Span
├── memory.read (vector: customer_policy)          ← Memory Operation Span
│   └── [3 results, relevance: 0.92, 0.87, 0.45]
├── reasoning (policy check)                       ← Reasoning Span
├── agent-b.execute (billing-specialist-v1)       ← Nested Agent Span
│   ├── tool_call (check_invoice → 200 OK)
│   ├── tool_call (process_refund → 200 OK)
│   └── reasoning (refund summary)
├── state_transition [delta: status=completed]     ← State Transition Span
└── agent.output (final response to user)
```

이 Trace Tree가 있으면:
- **어디서 시간이 소모되었는지**: Tool Call의 P95 지연 시간
- **어디서 비용이 발생했는지**: 각 LLM 호출의 Token 소모
- **어디서 실패했는지**: Error Span의 위치와 원인
- **어디서 컨텍스트가 손실되었는지**: State Transition의 Delta 크기

를 단일 Trace에서 한눈에 파악할 수 있습니다.

---

## 8. Evaluation Layer: Trace에 평가 점수 연결하기

Agent Observability의 완성은 Evaluation Layer입니다. 모든 Trace에 자동 평가 점수를 첨부하여 '잘못된 성공'을 걸러냅니다.

```typescript
interface TraceEvaluation {
  traceId: string;
  
  // 정확성 평가
  faithfulness: number;      // LLM 응답이 검색 결과에 충실한가 (0-1)
  relevance: number;          // 응답이 질문과 관련 있는가 (0-1)
  
  // 안전성 평가
  toxicity: number;           // 유해 콘텐츠 포함 여부 (0-1, 낮을수록 좋음)
  piiLeakage: boolean;        // 개인정보 노출 여부
  
  // 태스크 평가
  taskCompletion: boolean;    // 작업이 실제로 완료되었는가
  toolSelectionOptimal: boolean; // 최적의 도구를 선택했는가
  
  // 인간 피드백 (사후)
  userRating?: number;        // 사용자 평가 (1-5)
  humanReviewed: boolean;     // 인간 검토 완료 여부
}

// 실시간 Evaluation Pipeline
async function evaluateTrace(journal: ExecutionJournal): Promise<TraceEvaluation> {
  const evaluation: TraceEvaluation = {
    traceId: journal.traceId,
    faithfulness: await evaluateFaithfulness(journal),
    relevance: await evaluateRelevance(journal),
    toxicity: await evaluateToxicity(journal),
    piiLeakage: await scanForPII(journal),
    taskCompletion: journal.outcome.taskCompleted,
    toolSelectionOptimal: await evaluateToolSelection(journal),
  };

  // Critical 평가 실패 → 즉시 알림
  if (evaluation.faithfulness < 0.6 || evaluation.toxicity > 0.3) {
    alertCriticalEvaluation(evaluation);
  }

  // Evaluation Span을 Trace에 추가
  emitSpan({
    type: 'evaluation',
    traceId: journal.traceId,
    scores: evaluation
  });

  return evaluation;
}
```

---

## 9. 종합: 프로덕션 체크리스트

AI Agent Observability를 프로덕션에 도입할 때 확인해야 할 사항입니다.

### 계측 체크리스트

- [ ] 모든 Tool Call이 추적 가능한가? (Tool Call Span)
- [ ] 에이전트의 추론 과정이 기록되는가? (Reasoning Span)
- [ ] 상태 변화가 추적되는가? (State Transition Span)
- [ ] 메모리 읽기/쓰기가 로깅되는가? (Memory Operation Span)
- [ ] Trace Context가 Multi-Agent 경계를 넘어 전파되는가?
- [ ] PII가 마스킹 처리되는가?
- [ ] Token 사용량이 지표로 수집되는가?

### SLO 체크리스트

- [ ] Task Success Rate > 97%?
- [ ] Time-to-Useful-Action P95 < 5s?
- [ ] Tool Call Accuracy > 90%?
- [ ] Plan Adherence Rate > 80%?
- [ ] 평균 Cost Per Successful Task가 개선 추세인가?

### 운영 체크리스트

- [ ] Silent Success 감지 알람이 설정되었는가?
- [ ] Retrieval Miss 알람이 설정되었는가?
- [ ] Plan Drift 경고가 설정되었는가?
- [ ] Agent Loop 감지기가 동작하는가?
- [ ] Evaluation Suite가 자동 실행되는가?
- [ ] Trace Storage가 적절히 샘플링되는가?

---

## 10. 결론: Observability 없이는 Scale할 수 없다

AI 에이전트가 단일 LLM 호출에서 벗어나 Multi-Step, Multi-Tool, Multi-Agent 시스템으로 진화할수록, Observability는 선택이 아닌 필수 인프라가 됩니다. 전통적인 APM은 에이전트의 비결정론적 행동을 설명할 수 없으며, Silent Success는 대시보드가 초록불일 때 발생합니다.

**Execution Journal**은 이러한 격차를 해소하는 실용적인 패턴입니다. 모든 Tool Call, Reasoning Step, State Transition, Memory Operation을 구조화된 레코드로 남기고, 이를 Agent SLO와 Evaluation Layer로 연결함으로써, 에이전트 시스템을 **관찰 가능하고(Observable)**, **측정 가능하며(Measurable)**, **지속적으로 개선 가능한(Continuously Improvable)** 상태로 유지할 수 있습니다.

다음 단계로는:
1. 이 Observability 데이터를 기반으로 한 **자동 회귀 테스트 (Auto-Regression Test)** 프레임워크
2. Trace 데이터를 활용한 **프롬프트 최적화 (Prompt Optimization)** 파이프라인
3. Multi-Agent 간 **자원 경합 (Resource Contention)** 감지 및 조정

을 다룰 예정입니다.

---

*참고 자료*
- Braintrust, "Agent Observability: The Complete Guide for 2026" (May 2026)
- Coralogix, "Agentic AI Observability: A Practical Guide for 2026" (May 2026)
- Groundcover, "AI Agent Observability Guide" (May 2026)
- OpenTelemetry, "GenAI Semantic Conventions" (2026)
- Arize AI, "LLM Observability & Evaluation Platform" (2026)
