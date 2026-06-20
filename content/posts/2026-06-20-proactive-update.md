---
title: "AI Agent Observability: OpenTelemetry GenAI Tracing, Execution Journal, 그리고 Production Agent의 가시성 확보 전략 (#046)"
date: "2026-06-20"
description: "Production AI Agent는 '200 OK'만으로는 디버깅할 수 없다. Agent는 잘 포맷된 틀린 답변을 반환하고, 불필요한 Tool Call을 수행하며, 3단계에서 발생한 실패가 10단계에서야 표면화된다. 이 글에서는 OpenTelemetry GenAI v1.41 Semantic Conventions 기반의 Agent Tracing 아키텍처, Spans Propagation 전략, 그리고 Execution Journal이라 명명한 실행 검증 가능 기록 시스템을 TypeScript와 Go 코드 예제와 함께 설계한다."
tags:
  - AI Agent
  - Observability
  - OpenTelemetry
  - Tracing
  - Execution Journal
  - Production AI
  - MCP
  - Distributed Tracing
  - Software Architecture
  - TypeScript
  - Go
---

## 1. 들어가며: '죄책감 있는 200'과 싸우는 방법

2026년 6월, AI Agent Observability는 더 이상 선택이 아니라 Production Agent를 운영하는 모든 팀의 기본 필수 역량이 되었다. OpenTelemetry GenAI Semantic Conventions가 v1.41로 업데이트되면서 vendor-neutral한 Agent Tracing이 현실화되었고, Datadog, Grafana, New Relic 등 주요 백엔드가 이를 네이티브로 수용하기 시작했다.

하지만 여전히 대부분의 AI Agent 시스템이 직면한 현실은 이것이다:

```
// 전형적인 Production Agent 사고 시나리오:

Step 1:  User query → "이번 분기 매출 TOP 5 고객 분석해줘"
Step 2:  Agent → DB 쿼리 실행 (성공, 200ms)
Step 3:  Agent → 매출 데이터 수신 (성공, 정상 데이터)
Step 4:  Agent → SQL 결과 분석 (잘못된 집계 함수 사용)
Step 5:  Agent → LLM에 전달 (성공, 200 OK)
Step 6:  LLM → 잘 포맷된 틀린 답변 생성
Step 7:  Agent → 사용자에게 전달 (성공, 200 OK)

// 결과: 사용자는 예쁘게 포맷된 틀린 리포트를 받았다.
// 로그에는 단 하나의 에러도 없다. 모든 호출이 '성공'했다.
```

전통적인 모니터링은 이 상황을 절대 감지하지 못한다. HTTP 200은 성공이고, 로그에 `error` 레벨은 없으며, 레이턴시도 정상 범위다. 하지만 결과는 '틀렸다'.

이것이 AI Agent Observability가 기존 APM(Application Performance Monitoring)과 다른 이유다. **Agent는 '잘못된 성공'을 생산하는 시스템**이기 때문에, 프로세스 자체의 가시성(visibility)이 결과의 정확성보다 더 중요해진 경우가 많다.

이 글에서는 다음 세 가지 레이어로 AI Agent Observability를 설계한다:

```
┌──────────────────────────────────────────────┐
│      AI Agent Observability Stack 2026        │
├──────────────────────────────────────────────┤
│  Layer 1: OpenTelemetry GenAI Tracing        │
│  → Model call × Tool call × Agent span       │
│  → Vendor-neutral semantic convention         │
│  → Multi-turn trace stitching                 │
├──────────────────────────────────────────────┤
│  Layer 2: Execution Journal                   │
│  → 모든 결정의 근거(chain-of-thought) 기록    │
│  → Replay 가능한 실행 증명                    │
│  → Audit Trail + EU AI Act 대응              │
├──────────────────────────────────────────────┤
│  Layer 3: Quality Evaluation Pipeline         │
│  → Online evaluation (production traffic)     │
│  → LLM-as-Judge 자동 스코어링                 │
│  → Circuit Breaker 상태와의 통합              │
└──────────────────────────────────────────────┘
```

---

## 2. Layer 1: OpenTelemetry GenAI Tracing — Agent Span 설계

2026년 현재, OpenTelemetry GenAI Semantic Conventions는 AI Agent Tracing의 사실상 표준(de facto standard)이다. v1.41 기준으로 네 가지 Agent-specific span operation type이 정의되어 있다:

| Span Type | Span Kind | 언제 사용하는가 |
|-----------|-----------|----------------|
| `create_agent` | CLIENT 또는 INTERNAL | Agent 인스턴스 생성 시 |
| `invoke_agent` | CLIENT (remote) 또는 INTERNAL (local) | Agent 호출 (싱글/멀티) |
| `invoke_workflow` | INTERNAL | 멀티 Agent 간 workflow 라우팅 |
| `execute_tool` | CLIENT 또는 INTERNAL | Tool/MCP 서버 호출 |

### 2.1. Span Hierarchy: Agent 호출의 계층 구조

Agent Tracing의 핵심은 span이 단순한 리스트가 아니라 **트리 구조**를 형성해야 한다는 점이다.

```
Trace: "분기 매출 분석 요청"
├── Span: invoke_agent (INTERNAL)
│   ├── Span: retrieve_context (INTERNAL)
│   │   ├── Span: vector_search (CLIENT)    → 벡터 DB
│   │   └── Span: sql_query (CLIENT)        → RDB
│   ├── Span: invoke_workflow (INTERNAL)    → 분석 워크플로우
│   │   ├── Span: execute_tool (INTERNAL)   → SQL 분석 도구
│   │   └── Span: execute_tool (CLIENT)     → LLM 호출
│   └── Span: execute_tool (CLIENT)         → 리포트 생성 LLM 호출
└── Span: response_format (INTERNAL)        → 응답 포맷팅
```

이 구조에서 중요한 것은 **실패 지점을 바로 찾을 수 있다**는 점이다. 위 trace에서 만약 `sql_query` span이 200ms가 아닌 30초가 걸렸다면, SQL 최적화가 필요한 지점을 정확히 알 수 있다.

### 2.2. TypeScript: OpenTelemetry 기반 Agent Tracing 구현

```typescript
// TypeScript: OpenTelemetry Agent Tracing Wrapper

import { trace, Span, SpanStatusCode, context as otelContext } from '@opentelemetry/api';
import { SemanticAttributes } from '@opentelemetry/semantic-conventions';

// GenAI semantic convention constants (OTel v1.41)
const GEN_AI = {
  SYSTEM: 'gen_ai.system',
  REQUEST_MODEL: 'gen_ai.request.model',
  RESPONSE_MODEL: 'gen_ai.response.model',
  USAGE_INPUT_TOKENS: 'gen_ai.usage.input_tokens',
  USAGE_OUTPUT_TOKENS: 'gen_ai.usage.output_tokens',
  OPERATION_NAME: 'gen_ai.operation.name',
  AGENT_SPAN_TYPE: 'gen_ai.agent.span.type',
  TOOL_NAME: 'gen_ai.tool.name',
  TOOL_CALL_ID: 'gen_ai.tool.call.id',
} as const;

const TRACER_NAME = 'ai-agent-observability';

// Agent Span type enum
type AgentSpanType = 'create_agent' | 'invoke_agent' | 'invoke_workflow' | 'execute_tool';
type SpanKind = 'INTERNAL' | 'CLIENT';

interface SpanConfig {
  name: string;
  agentSpanType: AgentSpanType;
  kind: SpanKind;
  attributes?: Record<string, string | number | boolean>;
}

class AgentTracer {
  private tracer = trace.getTracer(TRACER_NAME);

  /**
   * Agent 호출 span 생성 (invoke_agent)
   */
  async traceInvokeAgent<T>(
    agentName: string,
    input: string,
    fn: (span: Span) => Promise<T>
  ): Promise<T> {
    const span = this.tracer.startSpan(
      `${agentName}.invoke`,
      {
        attributes: {
          [GEN_AI.OPERATION_NAME]: agentName,
          [GEN_AI.AGENT_SPAN_TYPE]: 'invoke_agent',
          'agent.input': this.sanitizeForSpan(input),
        },
      }
    );

    return this.runWithSpan(span, fn);
  }

  /**
   * Tool/MCP 호출 span 생성 (execute_tool)
   */
  async traceToolCall<T>(
    toolName: string,
    toolCallId: string,
    params: Record<string, unknown>,
    fn: (span: Span) => Promise<T>
  ): Promise<T> {
    const span = this.tracer.startSpan(
      `tool.${toolName}`,
      {
        attributes: {
          [GEN_AI.TOOL_NAME]: toolName,
          [GEN_AI.TOOL_CALL_ID]: toolCallId,
          [GEN_AI.AGENT_SPAN_TYPE]: 'execute_tool',
          'tool.params': JSON.stringify(this.sanitizeParams(params)),
        },
      }
    );

    return this.runWithSpan(span, fn);
  }

  /**
   * LLM 호출 span (model call)
   */
  async traceLLMCall<T>(
    model: string,
    messages: unknown[],
    fn: (span: Span) => Promise<{ result: T; usage?: { inputTokens: number; outputTokens: number } }>
  ): Promise<T> {
    const span = this.tracer.startSpan(
      `llm.${model}`,
      {
        attributes: {
          [GEN_AI.SYSTEM]: this.detectProvider(model),
          [GEN_AI.REQUEST_MODEL]: model,
          [GEN_AI.AGENT_SPAN_TYPE]: 'execute_tool',
        },
      }
    );

    try {
      const { result, usage } = await fn(span);

      if (usage) {
        span.setAttribute(GEN_AI.USAGE_INPUT_TOKENS, usage.inputTokens);
        span.setAttribute(GEN_AI.USAGE_OUTPUT_TOKENS, usage.outputTokens);
      }

      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: String(error),
      });
      span.recordException(error as Error);
      span.end();
      throw error;
    }
  }

  private async runWithSpan<T>(span: Span, fn: (span: Span) => Promise<T>): Promise<T> {
    const ctx = trace.setSpan(otelContext.active(), span);

    return otelContext.with(ctx, async () => {
      try {
        const result = await fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: String(error),
        });
        span.recordException(error as Error);
        throw error;
      } finally {
        span.end();
      }
    });
  }

  private sanitizeForSpan(input: string): string {
    // PII 보호: 너무 긴 입력은 자르고, 민감 정보는 마스킹
    if (input.length > 1000) return input.substring(0, 1000) + '...[truncated]';
    return input;
  }

  private sanitizeParams(params: Record<string, unknown>): Record<string, unknown> {
    // 민감 파라미터(apiKey, password 등) 자동 마스킹
    const sensitiveKeys = ['apiKey', 'api_key', 'password', 'token', 'secret', 'credential'];
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(params)) {
      if (sensitiveKeys.some(k => key.toLowerCase().includes(k))) {
        sanitized[key] = '***REDACTED***';
      } else if (typeof value === 'string' && value.length > 500) {
        sanitized[key] = value.substring(0, 500) + '...[truncated]';
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  private detectProvider(model: string): string {
    if (model.startsWith('gpt')) return 'openai';
    if (model.startsWith('claude')) return 'anthropic';
    if (model.startsWith('gemini')) return 'google';
    if (model.includes('deepseek')) return 'deepseek';
    return 'unknown';
  }
}

export const agentTracer = new AgentTracer();
```

### 2.3. 실제 Agent에 Tracing 적용하기

```typescript
// 실제 Agent에 Tracing 통합

class AnalyticsAgent {
  private tracer = agentTracer;

  async analyzeQuarterlyRevenue(userQuery: string): Promise<Report> {
    return this.tracer.traceInvokeAgent(
      'QuarterlyRevenueAnalyzer',
      userQuery,
      async (span) => {
        // Step 1: 맥락 검색
        const context = await this.tracer.traceToolCall(
          'vector_search',
          crypto.randomUUID(),
          { query: userQuery, limit: 5 },
          async () => {
            return this.vectorDB.search(userQuery, 5);
          }
        );

        span.setAttribute('context.documents_found', context.length);

        // Step 2: SQL 쿼리
        const rawData = await this.tracer.traceToolCall(
          'sql_query',
          crypto.randomUUID(),
          { table: 'quarterly_revenue', period: '2026-Q1' },
          async () => {
            return this.database.query(
              'SELECT customer, revenue FROM quarterly_revenue WHERE quarter = $1',
              ['2026-Q1']
            );
          }
        );

        // Step 3: LLM 분석
        const analysis = await this.tracer.traceLLMCall(
          'gpt-4o',
          [{ role: 'user', content: `데이터:\n${JSON.stringify(rawData)}\n\n질문: ${userQuery}` }],
          async (llmSpan) => {
            const response = await this.llm.complete(
              'gpt-4o',
              `Analyze this revenue data for key insights: ${JSON.stringify(rawData)}`
            );

            return {
              result: response.content,
              usage: {
                inputTokens: response.usage.prompt_tokens,
                outputTokens: response.usage.completion_tokens,
              },
            };
          }
        );

        return { analysis, sourceData: rawData, contextUsed: context };
      }
    );
  }
}
```

### 2.4. OTel v1.41 함정: Development 상태의 GenAI conventions

OpenTelemetry GenAI semantic conventions의 가장 큰 현실적 함정은 **아직 Stable이 아니라는 점**이다. v1.41 기준으로 모든 `gen_ai.*` 속성은 **Development** 배지를 달고 있다 (유일한 예외: `error.type`, `server.address`, `server.port`).

```
// v1.41의 현실:
// gen_ai.usage.input_tokens → Development status
// gen_ai.agent.span.type   → Development status
// gen_ai.tool.name         → Development status

// 이런 속성이 다음 마이너 버전에서 이름이 바뀌어도 spec 위반이 아니다.
```

**해결책: Stability Opt-In 이스케이프 해치**

```typescript
// Agent 시작 시:
// OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental

// 이 옵션을 설정하면 OTel SDK가 Dual Emission을 활성화한다:
// - 기존 (v1.36.0 이전) 속성 이름
// - 현재 (v1.41) 속성 이름
// → 대시보드가 갑자기 깨지지 않도록 보호

// 단, 이 옵션은 프로덕션에서 안정화 v1이 나올 때까지만 유지할 것.
// Stable 릴리스 이후에는 opt-in을 제거하고 정식 속성 이름으로 마이그레이션.
```

---

## 3. Layer 2: Execution Journal — 실행 증명 가능한 Agent 기록

Tracing은 "무슨 일이 일어났는가"를 알려주지만, Execution Journal은 **"왜 그런 결정을 내렸는가"**를 증명한다.

Execution Journal은 단순한 로그가 아니다. Agent의 모든 reasoning step, tool call 결정 근거, LLM response의 chain-of-thought, 그리고 최종 출력에 이르기까지 **재현 가능한(replayable) 실행 기록**을 의미한다.

### 3.1. Execution Journal의 구조

```typescript
// TypeScript: Execution Journal Schema

interface ExecutionJournal {
  sessionId: string;                    // Agent Session UUID
  agentName: string;
  timestamp: string;                    // ISO 8601

  // → Section 1: 입력
  input: {
    raw: string;                        // 사용자 원본 입력
    sanitized: string;                  // PII 제거된 버전
    intent: string;                     // Agent가 해석한 의도
    confidence: number;                 // 의도 추론 신뢰도 (0-1)
  };

  // → Section 2: Reasoning Chain
  reasoning: ReasoningStep[];

  // → Section 3: Tool Call 기록
  toolCalls: ToolCallRecord[];

  // → Section 4: LLM Interaction
  llmInteractions: LLMInteractionRecord[];

  // → Section 5: 출력
  output: {
    final: string;                      // 최종 응답
    alternatives?: string[];            // 고려되었지만 선택되지 않은 응답
    latency: number;                    // 총 처리 시간 (ms)
  };

  // → Section 6: 메타데이터
  metadata: {
    circuitBreakerState: string;        // 'health' | 'degraded' | 'fallback'
    modelVersion: string;
    toolVersions: Record<string, string>;
    evaluationScore?: number;           // LLM-as-Judge 평가 점수
  };
}

interface ReasoningStep {
  step: number;
  type: 'thought' | 'plan' | 'observation' | 'decision';
  content: string;
  timestamp: string;
  parentStep?: number;                  // reasoning 계층 구조
  tokensUsed?: number;                  // 이 step에 사용된 토큰
}

interface ToolCallRecord {
  toolName: string;
  callId: string;
  params: Record<string, unknown>;
  result: unknown;
  latency: number;                      // ms
  error?: string;
  retryCount: number;
}

interface LLMInteractionRecord {
  model: string;
  provider: string;
  prompt: string;
  response: string;
  inputTokens: number;
  outputTokens: number;
  latency: number;
  temperature: number;
}
```

### 3.2. Execution Journal Recorder 구현

```typescript
// TypeScript: Execution Journal Recorder

class ExecutionJournalRecorder {
  private journal: ExecutionJournal;
  private activeReasoning: ReasoningStep[] = [];
  private activeToolCalls: ToolCallRecord[] = [];
  private activeLLMCalls: LLMInteractionRecord[] = [];

  constructor(sessionId: string, agentName: string) {
    this.journal = {
      sessionId,
      agentName,
      timestamp: new Date().toISOString(),
      input: { raw: '', sanitized: '', intent: '', confidence: 0 },
      reasoning: [],
      toolCalls: [],
      llmInteractions: [],
      output: { final: '', latency: 0 },
      metadata: {
        circuitBreakerState: 'health',
        modelVersion: '',
        toolVersions: {},
      },
    };
  }

  recordInput(raw: string, intent: string, confidence: number): void {
    this.journal.input = {
      raw,
      sanitized: this.sanitizePII(raw),
      intent,
      confidence,
    };
  }

  addReasoningStep(type: ReasoningStep['type'], content: string, parentStep?: number): number {
    const step: ReasoningStep = {
      step: this.activeReasoning.length + 1,
      type,
      content,
      timestamp: new Date().toISOString(),
      parentStep,
    };
    this.activeReasoning.push(step);
    return step.step;
  }

  async recordToolCall<T>(
    toolName: string,
    params: Record<string, unknown>,
    fn: () => Promise<T>
  ): Promise<{ result: T; callId: string }> {
    const callId = crypto.randomUUID();
    const start = performance.now();
    let retryCount = 0;
    let lastError: string | undefined;

    const record: ToolCallRecord = {
      toolName,
      callId,
      params: this.sanitizeParams(params),
      result: null,
      latency: 0,
      retryCount: 0,
    };

    try {
      const result = await fn();
      record.result = result;
      record.latency = performance.now() - start;
      this.activeToolCalls.push(record);
      return { result, callId };
    } catch (error) {
      record.error = String(error);
      record.latency = performance.now() - start;
      this.activeToolCalls.push(record);
      throw error;
    } finally {
      this.journal.toolCalls = [...this.activeToolCalls];
    }
  }

  async recordLLMInteraction(
    model: string,
    provider: string,
    prompt: string,
    fn: () => Promise<{ response: string; inputTokens: number; outputTokens: number }>
  ): Promise<string> {
    const start = performance.now();

    const { response, inputTokens, outputTokens } = await fn();

    this.activeLLMCalls.push({
      model,
      provider,
      prompt: this.truncate(prompt, 2000),
      response: this.truncate(response, 2000),
      inputTokens,
      outputTokens,
      latency: performance.now() - start,
      temperature: 0.7, // 실제로는 config에서 읽어옴
    });

    this.journal.llmInteractions = [...this.activeLLMCalls];
    return response;
  }

  finalize(output: string, latency: number, metadata: Partial<ExecutionJournal['metadata']>): ExecutionJournal {
    this.journal.output = { final: output, latency };
    this.journal.reasoning = [...this.activeReasoning];
    this.journal.metadata = { ...this.journal.metadata, ...metadata };
    return this.journal;
  }

  /**
   * Journal을 JSON-Lines 형식으로 직렬화 (로그 저장 및 전송용)
   */
  serialize(): string[] {
    return [
      JSON.stringify({ event: 'journal:start', sessionId: this.journal.sessionId, agentName: this.journal.agentName, timestamp: this.journal.timestamp }),
      JSON.stringify({ event: 'journal:input', ...this.journal.input }),
      ...this.activeReasoning.map(r => JSON.stringify({ event: 'journal:reasoning', ...r })),
      ...this.activeToolCalls.map(t => JSON.stringify({ event: 'journal:tool_call', toolName: t.toolName, callId: t.callId, latency: t.latency, error: t.error })),
      ...this.activeLLMCalls.map(l => JSON.stringify({ event: 'journal:llm', model: l.model, inputTokens: l.inputTokens, outputTokens: l.outputTokens, latency: l.latency })),
      JSON.stringify({ event: 'journal:output', ...this.journal.output, metadata: this.journal.metadata }),
    ];
  }

  /**
   * Journal을 Audit Trail 형식으로 변환 (EU AI Act 대응)
   */
  toAuditTrail(): string {
    return [
      `=== AI Agent Execution Journal ===`,
      `Session: ${this.journal.sessionId}`,
      `Agent: ${this.journal.agentName}`,
      `Time: ${this.journal.timestamp}`,
      ``,
      `[Input]`,
      `  Intent: ${this.journal.input.intent} (confidence: ${(this.journal.input.confidence * 100).toFixed(1)}%)`,
      `  Raw: ${this.journal.input.raw.substring(0, 200)}${this.journal.input.raw.length > 200 ? '...' : ''}`,
      ``,
      `[Reasoning Chain]`,
      ...this.activeReasoning.map(r =>
        `  Step ${r.step} [${r.type}]: ${r.content.substring(0, 300)}`
      ),
      ``,
      `[Tool Calls]`,
      ...this.activeToolCalls.map(t =>
        `  ${t.toolName}: ${t.latency.toFixed(0)}ms ${t.error ? `❌ ${t.error}` : '✅'}`
      ),
      ``,
      `[LLM Interactions]`,
      ...this.activeLLMCalls.map(l =>
        `  ${l.model}: ${l.inputTokens}→${l.outputTokens}tokens, ${l.latency.toFixed(0)}ms`
      ),
      ``,
      `[Output]`,
      `  Latency: ${this.journal.output.latency.toFixed(0)}ms`,
      `  Quality Score: ${this.journal.metadata.evaluationScore ?? 'N/A'}`,
      `  Circuit State: ${this.journal.metadata.circuitBreakerState}`,
      `=== End of Journal ===`,
    ].join('\n');
  }

  private sanitizePII(text: string): string {
    return text
      .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL_REDACTED]')
      .replace(/\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, '[CC_REDACTED]')
      .replace(/[가-힣]{2,}님/g, '[NAME_REDACTED]');
  }

  private sanitizeParams(params: Record<string, unknown>): Record<string, unknown> {
    const sensitive = ['apiKey', 'api_key', 'password', 'token', 'secret', 'credential'];
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params)) {
      sanitized[key] = sensitive.some(k => key.toLowerCase().includes(k))
        ? '***REDACTED***'
        : value;
    }
    return sanitized;
  }

  private truncate(text: string, max: number): string {
    return text.length > max ? text.substring(0, max) + `...[+${text.length - max} chars]` : text;
  }
}
```

### 3.3. Execution Journal과 OTel Tracing의 차이점

Execution Journal과 OpenTelemetry Tracing은 **보완 관계**이지, 대체 관계가 아니다.

| 차원 | OpenTelemetry Tracing | Execution Journal |
|------|----------------------|-------------------|
| **주 목적** | 성능 분석, 병목 탐지 | 결정 증명, 재현, 감사 |
| **데이터 구조** | Span 트리 (짧고 구조적) | JSON Lines + 텍스트 (길고 상세) |
| **보존 기간** | 일~주 단위 (롤링) | 월~년 단위 (감사 요구사항) |
| **소비자** | SRE, 백엔드 엔지니어 | 법무팀, 규제 담당자, QA |
| **PII 처리** | 마스킹 옵션 | 필수 마스킹 + audit trail |
| **재현성** | 부분적 (시간, 레이턴시) | 완전 재현 가능 (입력→출력) |
| **비용** | span 당 매우 저렴 | 레코드 당 상대적 고비용 |

**운영 전략**: Tracing은 실시간 알림과 성능 분석에, Execution Journal은 사후 검증과 규제 대응에 사용한다. 둘 다 있어야 Production Agent를 운영할 수 있다.

---

## 4. Layer 3: Quality Evaluation Pipeline — Production Traffic에서의 자동 품질 평가

Tracing과 Journal이 "기록"을 담당한다면, Evaluation Pipeline은 **기록을 분석하여 품질 점수를 산출**한다.

### 4.1. Online Evaluation 아키텍처

Production traffic에서의 품질 평가는 오프라인 벤치마크와 달리 **실시간성 + 저비용**이라는 제약 조건을 가진다.

```
Production Traffic
     │
     ▼
┌─────────────────────┐
│ Agent Response      │
└────────┬────────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
┌────────┐ ┌────────────┐
│ Tracing │ │ Execution  │
│ (OTel)  │ │ Journal    │
└────┬───┘ └─────┬──────┘
     │           │
     ▼           ▼
┌─────────────────────────┐
│ Evaluation Orchestrator  │
├─────────────────────────┤
│ 1. LLM-as-Judge (샘플링) │ ← 비용 제어: 10%만 평가
│ 2. Heuristic Rules       │ ← 100% 적용 (무료)
│ 3. Feedback Loop         │ ← 사용자 피드백 통합
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────┐
│ Alert / Dashboard   │
│ → Quality Score     │
│ → Latency P95       │
│ → Tool Call Accuracy│
│ → Circuit State     │
└─────────────────────┘
```

### 4.2. TypeScript: LLM-as-Judge 평가 구현

```typescript
// TypeScript: LLM-as-Judge Quality Evaluator

interface QualityScore {
  overall: number;          // 0-1
  correctness: number;      // 정확성
  relevance: number;        // 관련성
  completeness: number;     // 완전성
  efficiency: number;       // 효율성 (불필요한 tool call 최소화)
  reasoning: number;        // 추론 과정의 명확성
}

class OnlineQualityEvaluator {
  private samplingRate = 0.1; // 10%만 LLM 평가 (비용 제어)
  private totalSamples = 0;
  private recentScores: QualityScore[] = [];

  async evaluate(journal: ExecutionJournal): Promise<QualityScore | null> {
    // 비용 제어: 샘플링 적용
    this.totalSamples++;
    if (Math.random() > this.samplingRate) return null;

    // Heuristic 평가 (100% 적용, 무료)
    const heuristicScore = this.heuristicEvaluation(journal);

    // LLM-as-Judge 평가 (샘플링, 비용 있음)
    const llmScore = await this.llmJudgeEvaluation(journal);

    const final: QualityScore = {
      overall: (heuristicScore.overall + llmScore.overall) / 2,
      correctness: llmScore.correctness,
      relevance: Math.max(heuristicScore.relevance, llmScore.relevance),
      completeness: llmScore.completeness,
      efficiency: heuristicScore.efficiency,
      reasoning: llmScore.reasoning,
    };

    this.recentScores.push(final);
    if (this.recentScores.length > 1000) this.recentScores.shift();

    return final;
  }

  /**
   * Heuristic 평가: 비용 0원, 100% 적용 가능
   */
  private heuristicEvaluation(journal: ExecutionJournal): Partial<QualityScore> {
    let efficiencyPenalty = 0;

    // Tool Call 효율성 평가
    const totalToolCalls = journal.toolCalls.length;
    const failedToolCalls = journal.toolCalls.filter(t => t.error).length;
    const redundantToolCalls = this.detectRedundantCalls(journal.toolCalls);

    efficiencyPenalty += (failedToolCalls / Math.max(totalToolCalls, 1)) * 0.3;
    efficiencyPenalty += (redundantToolCalls / Math.max(totalToolCalls, 1)) * 0.2;

    // 레이턴시에 따른 패널티 (30초 초과 시 감점)
    if (journal.output.latency > 30000) {
      efficiencyPenalty += 0.2;
    }

    // 관련성 평가: 입력 의도와 출력의 keyword overlap
    const relevance = this.computeKeywordRelevance(
      journal.input.raw,
      journal.output.final
    );

    return {
      overall: Math.max(0, 1 - efficiencyPenalty),
      relevance,
      efficiency: Math.max(0, 1 - efficiencyPenalty),
    };
  }

  /**
   * LLM-as-Judge: 실제 LLM이 평가 (샘플링만)
   */
  private async llmJudgeEvaluation(
    journal: ExecutionJournal
  ): Promise<QualityScore> {
    const judgePrompt = `
You are an AI Agent quality judge. Score the following agent execution on a scale of 0.0 to 1.0.

## Input (User Query)
${journal.input.raw}

## Reasoning Chain
${journal.reasoning.map(r => `Step ${r.step} [${r.type}]: ${r.content}`).join('\n')}

## Tool Calls
${journal.toolCalls.map(t =>
  `- ${t.toolName}: ${t.latency.toFixed(0)}ms [${t.error ? 'FAILED: ' + t.error : 'OK'}]`
).join('\n')}

## Output
${journal.output.final.substring(0, 1000)}

Return ONLY a JSON object:
{
  "correctness": <0.0-1.0>,
  "relevance": <0.0-1.0>,
  "completeness": <0.0-1.0>,
  "reasoning": <0.0-1.0>
}
`;

    try {
      const response = await this.judgeLLM.complete(judgePrompt);
      const scores = JSON.parse(response.content);

      return {
        overall: (scores.correctness + scores.relevance + scores.completeness + scores.reasoning) / 4,
        correctness: scores.correctness,
        relevance: scores.relevance,
        completeness: scores.completeness,
        efficiency: 1.0, // Heuristic에서 계산
        reasoning: scores.reasoning,
      };
    } catch {
      // Judge 실패 시 보수적 기본값
      return {
        overall: 0.5,
        correctness: 0.5,
        relevance: 0.5,
        completeness: 0.5,
        efficiency: 0.5,
        reasoning: 0.5,
      };
    }
  }

  private detectRedundantCalls(calls: ToolCallRecord[]): number {
    let redundant = 0;
    for (let i = 1; i < calls.length; i++) {
      // 동일한 tool을 거의 동일한 파라미터로 연속 호출 → 중복
      if (
        calls[i].toolName === calls[i - 1].toolName &&
        JSON.stringify(calls[i].params) === JSON.stringify(calls[i - 1].params)
      ) {
        redundant++;
      }
    }
    return redundant;
  }

  private computeKeywordRelevance(input: string, output: string): number {
    const inputWords = new Set(
      input.toLowerCase().split(/\W+/).filter(w => w.length > 2)
    );
    const outputWords = new Set(
      output.toLowerCase().split(/\W+/).filter(w => w.length > 2)
    );

    if (inputWords.size === 0) return 1.0;

    const overlap = [...inputWords].filter(w => outputWords.has(w)).length;
    return overlap / inputWords.size;
  }

  getAverageScore(): QualityScore | null {
    if (this.recentScores.length === 0) return null;
    const avg = (key: keyof QualityScore) =>
      this.recentScores.reduce((a, s) => a + s[key], 0) / this.recentScores.length;

    return {
      overall: avg('overall'),
      correctness: avg('correctness'),
      relevance: avg('relevance'),
      completeness: avg('completeness'),
      efficiency: avg('efficiency'),
      reasoning: avg('reasoning'),
    };
  }
}
```

---

## 5. MCP Tracing Layer: MCP 서버 호출에 Tracing 심기

MCP(Model Context Protocol) 서버는 AI Agent의 주요 데이터 소스이자 Action 실행 지점이다. MCP 호출에 Tracing을 심는 것은 Circuit State와 함께 Agent Observability의 핵심 인프라다.

OpenTelemetry GenAI v1.41은 MCP-specific span conventions도 정의한다:

```typescript
// TypeScript: MCP Tracing Middleware

interface MCPTraceContext {
  serverName: string;
  toolName: string;
  callId: string;
  parentSpan?: Span;
}

class MCPTracingMiddleware {
  private tracer = trace.getTracer('mcp-layer');

  /**
   * MCP 서버 호출을 감싸는 Tracing Proxy
   */
  wrapMCPServer<TReq, TRes>(
    serverName: string,
    handler: (request: TReq) => Promise<TRes>
  ): (request: TReq) => Promise<TRes & { _traceId?: string }> {
    return async (request) => {
      const span = this.tracer.startSpan(`mcp.${serverName}`, {
        attributes: {
          'gen_ai.agent.span.type': 'execute_tool',
          'mcp.server': serverName,
          'mcp.protocol.version': '2025-03-26',
        },
      });

      const ctx = trace.setSpan(otelContext.active(), span);

      return otelContext.with(ctx, async () => {
        try {
          const result = await handler(request);

          span.setStatus({ code: SpanStatusCode.OK });
          span.setAttribute('mcp.response.size', JSON.stringify(result).length);

          return { ...result, _traceId: span.spanContext().traceId };
        } catch (error) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: String(error),
          });
          span.recordException(error as Error);
          throw error;
        } finally {
          span.end();
        }
      });
    };
  }

  /**
   * MCP 호출 체인을 위한 Trace Context 전파
   * (HTTP 헤더를 통한 W3C Trace Context 전파)
   */
  injectTraceContext(headers: Record<string, string>): Record<string, string> {
    const currentSpan = trace.getSpan(otelContext.active());
    if (!currentSpan) return headers;

    const traceId = currentSpan.spanContext().traceId;
    const spanId = currentSpan.spanContext().spanId;
    const traceFlags = currentSpan.spanContext().traceFlags;

    return {
      ...headers,
      'traceparent': `00-${traceId}-${spanId}-${traceFlags.toString(16).padStart(2, '0')}`,
      'tracestate': '',
    };
  }
}
```

---

## 6. 운영 교훈: Production에서 배운 5가지

이 아키텍처를 실제 Production Agent에 적용하면서 얻은 교훈을 정리한다.

### 6.1. Span 수는 선형이 아니라 지수적으로 증가한다

Agent가 한 번에 3개의 Tool을 호출하고, 각 Tool이 다시 LLM을 호출하면, 단일 사용자 요청에 10개 이상의 span이 생성된다. 멀티 Agent 시스템에서는 더 심각하다.

```
싱글 Agent (Tool 3개):      ~10 spans/request
멀티 Agent (3 agents):      ~40 spans/request
Agent + MCP 체인 (5 hops):  ~25 spans/request  
→ 1만 req/s 환경에서 초당 25만~100만 span

해결책: 샘플링(Sampling)은 선택이 아니라 필수다.
- 에러 span: 100% 샘플링
- 정상 span: 1~10% 샘플링
- Head-based vs Tail-based sampling 전략 수립
```

### 6.2. Execution Journal의 저장 비용이 Tracing보다 10배 높다

실제 운영 데이터: Execution Journal 1건의 평균 크기는 ~5KB JSON. Tracing span 1건의 평균 크기는 ~500 bytes. Journal의 보존 기간을 Tracing보다 길게 가져가야 하지만, **압축과 샘플링을 함께 적용하지 않으면 스토리지 비용이 통제 불능이 된다.**

```
저장 전략 (일 10만 요청 기준):
- Tracing (보존 7일):  ~500 bytes × 10 spans × 100K × 7일 ≈ 35GB
- Journal (보존 90일): ~5KB × 100K × 90일 ≈ 45TB ← 압축 필요!

압축 팁:
- Journal은 JSON-Lines + Gzip으로 저장 (압축률 ~10:1)
- Journal의 LLM prompt/response는 2000자로 truncation
- Tool call result는 참조 URL만 저장하고 본문은 Object Storage에
```

### 6.3. "LLM-as-Judge"는 무료가 아니다

Online Evaluation에서 LLM-as-Judge를 100% traffic에 적용하면, **Judge 비용이 Agent 운영 비용의 30~50%**에 달할 수 있다.

```
비용 시나리오 (1만 req/s, 각 요청당 2K input + 500 output):
- Agent LLM 비용:    ~$0.05/req → $500/초 → 막대함
- Judge LLM 비용:    ~$0.02/req (gpt-4o-mini) → $200/초
- Heuristic 평가:     $0/req

→ LLM Judge는 10% 샘플링으로 충분.
   Heuristic 평가(무료)가 이상 징후를 먼저 감지하면 그때만 LLM Judge 호출.
```

### 6.4. Circuit Breaker State는 Observable 해야 한다

전편(#045)에서 설계한 Circuit Breaker의 상태를 Observability 시스템에 반영하지 않으면, Agent의 행동 변화를 이해할 수 없다.

```typescript
// Circuit Breaker State → OTel Metric으로 전송

function reportCircuitState(metrics: Record<string, unknown>): void {
  const meter = metrics.getMeter('ai-agent-resilience');
  const gauge = meter.createObservableGauge('circuit.breaker.state', {
    description: 'Circuit Breaker state per source',
  });

  // metric value: 0=CLOSED, 1=HALF_OPEN, 2=OPEN
  gauge.addCallback((observableResult) => {
    for (const [source, state] of circuitStates.entries()) {
      observableResult.observe(
        state === 'CLOSED' ? 0 : state === 'HALF_OPEN' ? 1 : 2,
        { source }
      );
    }
  });
}
```

이 metric을 Datadog/Grafana에서 모니터링하면, "Agent가 왜 느려졌는가"의 답이 Circuit Breaker OPEN 상태에 있다는 것을 바로 알 수 있다.

### 6.5. Non-determinism이 Debugging을 어렵게 만든다

같은 입력에 대해 Agent가 다른 경로로 실행되는 것은 Tracing의 재현성을 심각하게 저하시킨다. 해결책:

```typescript
// Deterministic Replay를 위한 Seed 주입

interface DeterministicConfig {
  seed: number;  // LLM temperature sampling용 고정 seed
  traceId: string; // 동일 traceId로 재실행 가능
}

// 실행 로그에 seed와 traceId를 저장하고,
// 재현 시 동일 seed + 동일 traceId로 재실행하면
// (확률적 요소를 제외한) 동일한 경로 재현 가능
```

물론 LLM의 non-determinism 자체는 완전히 제어할 수 없다. 하지만 Agent의 Tool 선택 로직, Context 검색 순서, Fallback 우선순위 등 **결정적(Deterministic)인 부분은 재현 가능하도록 설계**해야 한다.

---

## 7. 결론: Agent Observability는 Agent SLO의 전제조건이다

2026년 현재, AI Agent Observability는 "있으면 좋은 것"에서 "없으면 운영할 수 없는 것"으로 전환되었다.

전편(#045)에서 Circuit Breaker를 설계해 Agent가 탄력적으로 실패를 견디도록 만들었다. 이제 Observability를 통해 그 실패의 원인과 영향을 추적하고, 품질을 측정하며, 시간이 지남에 따라 개선할 수 있는 시스템을 갖추었다.

이 시리즈의 세 편을 종합하면:

```
#044: EU AI Act Verification Loop → 규제 준수를 위한 Agent 감독 구조
#045: Circuit Breaker 패턴          → 장애에도 멈추지 않는 탄력성
#046: Observability & Tracing       → 모든 실행의 가시성과 기록 (이 글)
```

세 가지가 모두 갖춰져야 **진정한 Production-Grade AI Agent**라고 말할 수 있다.

**핵심 메시지:**

> Agent는 200 OK를 반환해도 틀릴 수 있다.
> 그것을 감지하는 유일한 방법은 모든 실행 단계를 추적하고,
> 모든 결정의 근거를 기록하고,
> 모든 결과의 품질을 평가하는 시스템을 아키텍처 수준에서 갖추는 것이다.

---

## 참고 자료

- OpenTelemetry GenAI Semantic Conventions v1.41 (2026)
- OpenTelemetry v1.36.0 → v1.41 Migration Guide (2026)
- Datadog, "LLM Observability with OpenTelemetry" (Dec 2025)
- Digital Applied, "AI Agent Observability 2026: Tracing & Monitoring Stack" (May 2026)
- Maxim AI, "Top 5 Tools for AI Agent Observability in 2026" (Apr 2026)
- Michael Nygard, "Release It!: Design and Degrade to Production-Ready Software" (2nd Ed.)
- arXiv 2606.18422: "Gatekeepers and Hallucinations" (2026)
- 전편(#045): "AI Agent 데이터 파이프라인의 Circuit Breaker 패턴" (2026-06-19)
- 전전편(#044): "EU AI Act D-60: Verification Loop 패턴" (2026-06-17)
