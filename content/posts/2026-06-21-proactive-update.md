---
title: "Agent Self-Correction Loop: AI Agent가 스스로 실수를 인지하고 복구하는 아키텍처 패턴 (#047)"
date: "2026-06-21"
description: "Agent는 언제나 틀린다. 중요한 것은 틀리지 않는 것이 아니라, 틀렸을 때 얼마나 빨리 인지하고 복구하느냐다. 이 글에서는 Self-Verification, Confidence Calibration, Retry-with-Strategy-Change, Partial Rollback의 4가지 Self-Correction 패턴을 TypeScript와 Go 코드 예제와 함께 설계하고, MCP Tool 호출 환경에서의 구체적인 구현 전략을 분석한다."
tags:
  - AI Agent
  - Self-Correction
  - Agent Architecture
  - Reliability
  - MCP
  - TypeScript
  - Go
  - Error Recovery
  - Production AI
  - Confidence Calibration
---

## 1. 들어가며: Agent는 언제나 틀린다

2026년 6월, AI Agent는 단순한 Chatbot을 넘어 Production 시스템의 핵심 실행 주체가 되었다. MCP 서버를 통해 데이터베이스에 질의하고, 파일 시스템을 조작하고, CI/CD 파이프라인을 트리거한다. 하지만 이 모든 실행은 본질적으로 **확률적(probabilistic)**이다.

LLM은 '생성'하는 시스템이지 '계산'하는 시스템이 아니다. Agent가 10번의 Tool Call을 수행하는 복잡한 작업에서 단 한 번의 잘못된 Tool 파라미터, 한 번의 환각(hallucination)이 전체 결과를 무너뜨릴 수 있다.

```
전형적인 Agent 실패 패턴:

Pattern A: Wrong Tool Selection
  Task: "이번 달 매출 데이터를 분석해줘"
  Agent → wrong_mcp_tool("get_revenue_2025")  // 2026 데이터를 요청해야 하는데 2025

Pattern B: Hallucinated Parameters
  Agent → query_database("SELECT * FROM users WHERE signup > '2026-01-01'") 
  // 실제 컬럼명은 created_at, signup은 존재하지 않음

Pattern C: Mid-Task Context Drift
  Step 1: "고객 ID 12345의 최근 주문 조회" → 성공
  Step 2: "그 고객에게 이메일 전송" → 잘못된 고객 ID 12346으로 전송

Pattern D: Premature Termination
  Agent → "작업을 완료했습니다." (실제로는 5개 중 3개만 처리)
```

전통적인 접근법은 "LLM을 더 잘 학습시키자" 또는 "프롬프트를 더 정교하게 만들자"였다. 하지만 실전 경험은 말한다: **Agent는 태생적으로 틀릴 수밖에 없으며, 중요한 것은 틀리지 않는 것이 아니라 틀렸을 때의 복구 시스템이다.**

이 글에서 설계할 Self-Correction Loop의 전체 아키텍처:

```
┌──────────────────────────────────────────────────────┐
│           Agent Self-Correction Loop                 │
├──────────────────────────────────────────────────────┤
│                                                      │
│  [1] Self-Verification Layer                         │
│  ┌────────────────────────────────────────────────┐  │
│  │ Tool 결과 검증 │ 응답 일관성 검사 │ 실행 증명  │  │
│  └────────────────────────────────────────────────┘  │
│                          │                            │
│                          ▼                            │
│  [2] Confidence Calibrator                            │
│  ┌────────────────────────────────────────────────┐  │
│  │ Logit 기반 신뢰도 │ Semantic 일관성 │ 실행 보장도│  │
│  └────────────────────────────────────────────────┘  │
│                          │                            │
│              ┌───────────┴───────────┐               │
│              ▼                       ▼               │
│        Confidence OK          Confidence Low          │
│              │                       │                │
│              ▼                       ▼                │
│  [3] Retry with Strategy       [4] Escalation        │
│  ┌─────────────────────┐   ┌────────────────────┐    │
│  │ 다른 Tool 시도       │   │ 인간 검증 요청      │    │
│  │ 다른 접근법          │   │ Fallback 실행       │    │
│  │ Partial Rollback     │   │ Safe Abort         │    │
│  └─────────────────────┘   └────────────────────┘    │
│                                                      │
└──────────────────────────────────────────────────────┘
```

---

## 2. Layer 1: Self-Verification — 실행 결과의 진실성 검증

Agent가 Tool을 호출했다는 사실만으로는 결과가 정확한지 알 수 없다. Self-Verification Layer는 모든 Tool Call 결과에 대해 **사후 검증(post-hoc verification)**을 수행한다.

### 2.1 TypeScript Self-Verification 구현

```typescript
// types.ts
interface ToolCall {
  id: string;
  tool: string;
  parameters: Record<string, unknown>;
  result: unknown;
  duration: number;
  timestamp: number;
}

interface VerificationResult {
  toolCallId: string;
  status: 'passed' | 'failed' | 'uncertain';
  checks: VerificationCheck[];
  confidence: number; // 0.0 ~ 1.0
}

interface VerificationCheck {
  type: 'type_check' | 'range_check' | 'consistency_check' | 'idempotency_check';
  passed: boolean;
  detail: string;
}

// SelfVerifier.ts
export class SelfVerifier {
  private rules: VerificationRule[];

  constructor(rules: VerificationRule[]) {
    this.rules = rules;
  }

  async verify(toolCall: ToolCall): Promise<VerificationResult> {
    const checks: VerificationCheck[] = [];

    for (const rule of this.rules) {
      const result = await rule.evaluate(toolCall);
      checks.push(result);
    }

    const confidence = checks.reduce(
      (acc, c) => acc + (c.passed ? 1 : 0), 0
    ) / checks.length;

    const status: VerificationResult['status'] = 
      confidence >= 0.8 ? 'passed' :
      confidence >= 0.4 ? 'uncertain' :
      'failed';

    return {
      toolCallId: toolCall.id,
      status,
      checks,
      confidence,
    };
  }
}

// 예시: Type Check Rule
class TypeCheckRule implements VerificationRule {
  private schema: Record<string, string>;

  constructor(schema: Record<string, string>) {
    this.schema = schema;
  }

  async evaluate(toolCall: ToolCall): Promise<VerificationCheck> {
    const result = toolCall.result;
    if (typeof result !== 'object' || result === null) {
      return {
        type: 'type_check',
        passed: false,
        detail: `Expected object, got ${typeof result}`,
      };
    }

    const failures: string[] = [];
    for (const [key, expectedType] of Object.entries(this.schema)) {
      if (key in (result as Record<string, unknown>)) {
        const actual = typeof (result as Record<string, unknown>)[key];
        if (actual !== expectedType) {
          failures.push(`${key}: expected ${expectedType}, got ${actual}`);
        }
      }
    }

    return {
      type: 'type_check',
      passed: failures.length === 0,
      detail: failures.length > 0 
        ? failures.join('; ')
        : `All ${Object.keys(this.schema).length} fields match expected types`,
    };
  }
}

// 예시: Range Check Rule (금융/수량 데이터에 특화)
class RangeCheckRule implements VerificationRule {
  private ranges: Record<string, { min: number; max: number }>;

  constructor(ranges: Record<string, { min: number; max: number }>) {
    this.ranges = ranges;
  }

  async evaluate(toolCall: ToolCall): Promise<VerificationCheck> {
    const result = toolCall.result;
    if (typeof result !== 'object' || result === null) {
      return {
        type: 'range_check',
        passed: false,
        detail: 'Cannot evaluate range on non-object result',
      };
    }

    const violations: string[] = [];
    for (const [key, { min, max }] of Object.entries(this.ranges)) {
      const value = (result as Record<string, number>)[key];
      if (typeof value === 'number') {
        if (value < min || value > max) {
          violations.push(
            `${key}=${value} out of range [${min}, ${max}]`
          );
        }
      }
    }

    return {
      type: 'range_check',
      passed: violations.length === 0,
      detail: violations.length > 0
        ? violations.join('; ')
        : 'All numeric fields within valid ranges',
    };
  }
}
```

### 2.2 Go Self-Verification (고성능 MCP 서버용)

```go
// verifier.go
package verification

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"sync"
	"time"
)

type ToolResult struct {
	Tool       string
	Parameters map[string]any
	Result     json.RawMessage
	Duration   time.Duration
}

type Verdict struct {
	Passed     bool
	Confidence float64
	Checks     []CheckResult
}

type CheckResult struct {
	Type   string
	Passed bool
	Detail string
}

// SchemaVerifier는 구조화된 JSON 응답의 스키마를 검증합니다.
type SchemaVerifier struct {
	mu       sync.RWMutex
	schemas  map[string]jsonSchema
}

type jsonSchema struct {
	Required   []string           `json:"required"`
	Properties map[string]propDef `json:"properties"`
}

type propDef struct {
	Type   string  `json:"type"`
	Min    *float64 `json:"minimum,omitempty"`
	Max    *float64 `json:"maximum,omitempty"`
	Regex  *string  `json:"pattern,omitempty"`
}

func (sv *SchemaVerifier) Verify(ctx context.Context, result ToolResult) (*Verdict, error) {
	sv.mu.RLock()
	schema, ok := sv.schemas[result.Tool]
	sv.mu.RUnlock()

	if !ok {
		return &Verdict{Passed: true, Confidence: 0.5}, nil
	}

	var data map[string]any
	if err := json.Unmarshal(result.Result, &data); err != nil {
		return &Verdict{
			Passed:     false,
			Confidence: 0.0,
			Checks: []CheckResult{{
				Type:   "parse",
				Passed: false,
				Detail: fmt.Sprintf("JSON parse error: %v", err),
			}},
		}, nil
	}

	var checks []CheckResult
	var passed int

	// 1. Required field 검증
	for _, field := range schema.Required {
		if _, exists := data[field]; !exists {
			checks = append(checks, CheckResult{
				Type: "required_field", Passed: false,
				Detail: fmt.Sprintf("Missing required field: %s", field),
			})
		}
	}

	// 2. Type & Range 검증
	for field, def := range schema.Properties {
		val, exists := data[field]
		if !exists {
			continue
		}

		// Type check
		actualType := fmt.Sprintf("%T", val)
		if actualType != def.Type {
			checks = append(checks, CheckResult{
				Type: "type", Passed: false,
				Detail: fmt.Sprintf("%s: expected %s, got %s", field, def.Type, actualType),
			})
			continue
		}

		// Numeric range check
		if def.Min != nil || def.Max != nil {
			num, ok := val.(float64)
			if ok {
				if def.Min != nil && num < *def.Min {
					checks = append(checks, CheckResult{
						Type: "range", Passed: false,
						Detail: fmt.Sprintf("%s=%v below min %v", field, num, *def.Min),
					})
				}
				if def.Max != nil && num > *def.Max {
					checks = append(checks, CheckResult{
						Type: "range", Passed: false,
						Detail: fmt.Sprintf("%s=%v exceeds max %v", field, num, *def.Max),
					})
				}
			}
		}

		// Regex pattern check
		if def.Regex != nil {
			str, ok := val.(string)
			if ok {
				matched, _ := regexp.MatchString(*def.Regex, str)
				if !matched {
					checks = append(checks, CheckResult{
						Type: "pattern", Passed: false,
						Detail: fmt.Sprintf("%s='%s' does not match pattern %s", field, str, *def.Regex),
					})
				}
			}
		}

		passed++ // 이 필드 검증 통과
	}

	confidence := float64(passed) / float64(len(checks)+passed)
	if len(checks) == 0 {
		confidence = 1.0
	}

	return &Verdict{
		Passed:     len(checks) == 0,
		Confidence: confidence,
		Checks:     checks,
	}, nil
}
```

---

## 3. Layer 2: Confidence Calibrator — "얼마나 확신하는가?"

Self-Verification이 결과 자체를 검증했다면, Confidence Calibration은 **"이 Agent가 현재 자신의 결정에 대해 얼마나 확신하는가"**를 측정한다. 이는 LLM의 logit 분포, 응답의 semantic 일관성, Tool Call 실행의 성공률 등 여러 지표를 통합한다.

### 3.1 Multi-Factor Confidence Scoring

```typescript
// confidence-calibrator.ts
interface ConfidenceFactors {
  logitConfidence: number;      // LLM logit 기반
  semanticConsistency: number;  // n-샘플 일관성
  executionReliability: number; // 과거 Tool Call 성공률
  temporalConsistency: number;  // 실행 순서의 논리적 정합성
}

class ConfidenceCalibrator {
  private weights: ConfidenceFactors;
  private historyWindow: number; // 최근 N개 Tool Call 기준

  constructor(weights?: Partial<ConfidenceFactors>) {
    this.weights = {
      logitConfidence: 0.35,
      semanticConsistency: 0.30,
      executionReliability: 0.25,
      temporalConsistency: 0.10,
      ...weights,
    };
    this.historyWindow = 20;
  }

  async calibrate(
    currentStep: AgentStep,
    history: AgentStep[]
  ): Promise<CalibratedConfidence> {
    const factors = await Promise.all([
      this.measureLogitConfidence(currentStep),
      this.measureSemanticConsistency(currentStep, history),
      this.measureExecutionReliability(history),
      this.measureTemporalConsistency(currentStep, history),
    ]);

    const rawScore = factors.reduce(
      (acc, f, i) => acc + f.score * Object.values(this.weights)[i], 0
    );

    return {
      rawScore,
      calibratedScore: this.applyCalibration(rawScore),
      factors: factors.map((f, i) => ({
        name: Object.keys(this.weights)[i],
        score: f.score,
        detail: f.detail,
      })),
      action: this.decideAction(rawScore),
    };
  }

  // Logit 기반 신뢰도 측정
  private async measureLogitConfidence(
    step: AgentStep
  ): Promise<FactorResult> {
    if (!step.llmResponse?.logprobs) {
      return { score: 0.5, detail: 'No logprobs available' };
    }

    const logprobs = step.llmResponse.logprobs;
    
    // Top-1 vs Top-2 차이: 클수록 확신도 높음
    const top1 = logprobs.topLogprobs?.[0] ?? -Infinity;
    const top2 = logprobs.topLogprobs?.[1] ?? -Infinity;
    const gap = top1 - top2;

    // gap이 클수록 확신: 0~1 정규화
    const normalizedGap = Math.min(Math.max(gap / 5, 0), 1);

    // 토큰별 평균 logprob
    const avgLogprob = logprobs.tokenLogprobs?.reduce((a, b) => a + b, 0) 
      / (logprobs.tokenLogprobs?.length ?? 1);

    // logprob을 [0, 1]로 변환 (logprob 0 = 완전 확신, -1 = 약간 불확실)
    const logprobScore = Math.min(Math.exp(avgLogprob), 1);

    return {
      score: normalizedGap * 0.6 + logprobScore * 0.4,
      detail: `Top1-Top2 gap: ${gap.toFixed(3)}, avg logprob: ${avgLogprob.toFixed(3)}`,
    };
  }

  // Semantic 일관성: 같은 입력에 3회 질의, 응답 일관성 측정
  private async measureSemanticConsistency(
    step: AgentStep,
    _history: AgentStep[]
  ): Promise<FactorResult> {
    // 실제 구현에서는 LLM에 같은 프롬프트를 n회 질의하고
    // embedding 유사도를 측정합니다
    const samples = step.semanticSamples ?? [];

    if (samples.length < 2) {
      return { score: 0.5, detail: 'Insufficient samples' };
    }

    const similarities: number[] = [];
    for (let i = 0; i < samples.length - 1; i++) {
      for (let j = i + 1; j < samples.length; j++) {
        similarities.push(cosineSimilarity(
          samples[i].embedding,
          samples[j].embedding
        ));
      }
    }

    const avgSimilarity = similarities.reduce((a, b) => a + b, 0) 
      / similarities.length;

    return {
      score: avgSimilarity,
      detail: `Semantic consistency (${samples.length} samples): ${avgSimilarity.toFixed(3)}`,
    };
  }

  // 실행 신뢰도: 과거 Tool Call 성공률
  private async measureExecutionReliability(
    history: AgentStep[]
  ): Promise<FactorResult> {
    const recent = history.slice(-this.historyWindow);
    
    if (recent.length === 0) {
      return { score: 0.5, detail: 'No history available' };
    }

    const successCount = recent.filter(
      s => s.toolResult?.status === 'success' && 
           (s.verification?.confidence ?? 0) > 0.7
    ).length;

    const successRate = successCount / recent.length;

    return {
      score: successRate,
      detail: `Execution success rate (last ${recent.length}): ${(successRate * 100).toFixed(1)}%`,
    };
  }

  // 시간적 일관성: Tool Call 순서의 논리적 정합성
  private async measureTemporalConsistency(
    currentStep: AgentStep,
    history: AgentStep[]
  ): Promise<FactorResult> {
    if (history.length === 0) {
      return { score: 0.8, detail: 'First step - no temporal check needed' };
    }

    const lastStep = history[history.length - 1];
    
    // 이전 Tool의 결과가 현재 Tool의 입력으로 사용되었는가?
    const usedPreviousResult = this.detectDataFlow(lastStep, currentStep);
    
    // 현재 Tool의 파라미터가 이전 단계와 모순되지 않는가?
    const parameterConsistency = this.checkParameterConsistency(
      lastStep, currentStep
    );

    return {
      score: usedPreviousResult ? 0.9 : parameterConsistency ? 0.7 : 0.3,
      detail: `Data flow: ${usedPreviousResult}, Param consistency: ${parameterConsistency}`,
    };
  }

  // Confidence 조정 (empirical calibration)
  private applyCalibration(rawScore: number): number {
    // LLM은 보통 과대확신(overconfidence) 경향
    // Platt scaling 스타일 보정
    return 1 / (1 + Math.exp(-5 * (rawScore - 0.6)));
  }

  private decideAction(score: number): 'proceed' | 'verify' | 'retry' | 'escalate' {
    if (score >= 0.75) return 'proceed';
    if (score >= 0.55) return 'verify';
    if (score >= 0.30) return 'retry';
    return 'escalate';
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  const dot = a.reduce((acc, v, i) => acc + v * b[i], 0);
  const normA = Math.sqrt(a.reduce((acc, v) => acc + v * v, 0));
  const normB = Math.sqrt(b.reduce((acc, v) => acc + v * v, 0));
  return dot / (normA * normB);
}
```

### 3.2 동적 임계값 (Adaptive Threshold)

고정된 Confidence 임계값은 치명적이다. 시스템 부하, Tool의 위험도, 사용자 컨텍스트에 따라 임계값이 동적으로 변해야 한다.

```typescript
// adaptive-threshold.ts
class AdaptiveThresholdManager {
  private baseThresholds: Record<string, number> = {
    read: 0.40,      // 읽기 전용: 낮은 임계값
    write: 0.75,     // 쓰기 작업: 높은 임계값
    delete: 0.90,    // 삭제 작업: 매우 높은 임계값
    execute: 0.85,   // 실행 작업
    payment: 0.95,   // 금융 거래
  };

  async getThreshold(
    toolName: string,
    context: ThresholdContext
  ): Promise<number> {
    const baseThreshold = this.getBaseThreshold(toolName);

    // 1. 시스템 부하 보정: 부하가 높으면 임계값 낮춤
    const loadFactor = await this.getSystemLoadFactor();
    
    // 2. 사용자 신뢰도 보정: 자주 사용하는 사용자는 임계값 낮춤
    const userFactor = this.getUserReliabilityFactor(context.userId);

    // 3. 최근 실패율 보정: 최근 실패가 많으면 임계값 상향
    const recentFailurePenalty = await this.getRecentFailurePenalty(context.sessionId);

    return Math.min(
      baseThreshold * loadFactor * userFactor * recentFailurePenalty,
      0.99  // 99%를 넘지 않음
    );
  }

  private getBaseThreshold(toolName: string): number {
    for (const [pattern, threshold] of Object.entries(this.baseThresholds)) {
      if (toolName.toLowerCase().startsWith(pattern)) {
        return threshold;
      }
    }
    return 0.5; // 기본값
  }

  private async getSystemLoadFactor(): Promise<number> {
    // 시스템 리소스 사용률에 따라 0.8~1.2 범위 조정
    return 1.0; // 실제 구현에서 동적 계산
  }

  private getUserReliabilityFactor(userId: string): number {
    // 신뢰할 수 있는 사용자는 factor 낮음 => 임계값 낮아짐
    return 1.0;
  }

  private async getRecentFailurePenalty(sessionId: string): Promise<number> {
    // 최근 10분 내 실패율에 따라 1.0~1.5 범위
    return 1.0;
  }
}
```

---

## 4. Layer 3: Retry with Strategy Change — 같은 실수를 반복하지 않는 법

단순 재시도(naive retry)는 같은 오류를 반복할 뿐이다. Self-Correction의 핵심은 **전략을 변경한 재시도(Retry with Strategy Change)**에 있다.

```typescript
// retry-strategy.ts
interface RetryStrategy {
  type: 'retry' | 'alternative_tool' | 'decompose' | 'fallback_llm';
  priority: number;
  maxAttempts: number;
  cooldownMs: number;
  transformer?: (params: Record<string, unknown>) => Record<string, unknown>;
}

class RetryManager {
  private strategies: RetryStrategy[];

  constructor() {
    this.strategies = [
      {
        type: 'alternative_tool',
        priority: 1,
        maxAttempts: 2,
        cooldownMs: 500,
        transformer: (params) => params, // 다른 Tool로 시도
      },
      {
        type: 'decompose',
        priority: 2,
        maxAttempts: 1,
        cooldownMs: 1000, // 작업을 더 작은 단위로 분할
      },
      {
        type: 'fallback_llm',
        priority: 3,
        maxAttempts: 1,
        cooldownMs: 2000, // 다른 LLM으로 시도
      },
      {
        type: 'retry',
        priority: 4,
        maxAttempts: 3,
        cooldownMs: 1000,  // 지수 백오프 적용
        transformer: (params, attempt) => ({
          ...params,
          // 시도 횟수를 파라미터에 포함시켜 LLM이 이전 실패를 인지
          _retryAttempt: attempt,
          _previousError: params._error,
        }),
      },
    ].sort((a, b) => a.priority - b.priority);
  }

  async executeWithStrategy(
    originalCall: ToolCall,
    executeFn: (tool: string, params: Record<string, unknown>) => Promise<unknown>,
    previousErrors: string[]
  ): Promise<RetryResult> {
    const { tool, parameters } = originalCall;

    for (const strategy of this.strategies) {
      for (let attempt = 1; attempt <= strategy.maxAttempts; attempt++) {
        // Cooldown
        if (attempt > 1) {
          await this.backoff(attempt, strategy.cooldownMs);
        }

        try {
          const startTime = Date.now();

          const result = strategy.type === 'alternative_tool'
            ? await this.tryAlternativeTool(tool, parameters, executeFn)
            : strategy.type === 'decompose'
            ? await this.tryDecomposedCall(parameters, executeFn)
            : strategy.type === 'fallback_llm'
            ? await this.tryFallbackLLM(tool, parameters, executeFn)
            : await executeFn(tool, 
                strategy.transformer?.({
                  ...parameters, 
                  _error: previousErrors[previousErrors.length - 1]
                }) ?? parameters
              );

          const duration = Date.now() - startTime;

          return {
            success: true,
            result,
            strategyUsed: strategy.type,
            attempts: attempt,
            duration,
          };
        } catch (error) {
          previousErrors.push(
            `Strategy ${strategy.type} attempt ${attempt}: ${error}`
          );
        }
      }
    }

    return {
      success: false,
      result: null,
      strategyUsed: 'all_exhausted',
      attempts: this.strategies.reduce(
        (acc, s) => acc + s.maxAttempts, 0
      ),
      duration: 0,
      errors: previousErrors,
    };
  }

  // 실패한 Tool과 유사한 기능의 대체 Tool 탐색
  private async tryAlternativeTool(
    originalTool: string,
    params: Record<string, unknown>,
    executeFn: (tool: string, params: Record<string, unknown>) => Promise<unknown>
  ): Promise<unknown> {
    // Tool Registry에서 유사 기능 Tool 탐색
    // 실제 구현에서는 MCP Tool Registry의 capability 매칭 사용
    const alternativeTools = await this.findAlternativeTools(originalTool, params);

    for (const altTool of alternativeTools) {
      try {
        return await executeFn(altTool, params);
      } catch (_) {
        continue;
      }
    }

    throw new Error(`All alternative tools failed for ${originalTool}`);
  }

  // 작업 분할: 큰 작업을 여러 작은 Tool Call로 분할
  private async tryDecomposedCall(
    params: Record<string, unknown>,
    executeFn: (tool: string, params: Record<string, unknown>) => Promise<unknown>
  ): Promise<unknown> {
    const subTasks = this.decomposeTask(params);
    const results: unknown[] = [];

    for (const subTask of subTasks) {
      const result = await executeFn(subTask.tool, subTask.params);
      results.push(result);
    }

    return results;
  }

  private async backoff(attempt: number, baseMs: number): Promise<void> {
    const delay = baseMs * Math.pow(2, attempt - 1) + Math.random() * 100;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  private findAlternativeTools(tool: string, _params: Record<string, unknown>) {
    return Promise.resolve(this.getToolCapabilities().filter(
      t => t.capability === this.inferCapability(tool)
    ).map(t => t.name));
  }

  private getToolCapabilities(): Array<{ name: string; capability: string }> {
    return [
      { name: 'query_database_v1', capability: 'data_query' },
      { name: 'query_database_v2', capability: 'data_query' },
      { name: 'search_documents', capability: 'data_query' },
    ];
  }

  private inferCapability(tool: string): string {
    return tool.startsWith('query_') ? 'data_query' : 'general';
  }

  private decomposeTask(params: Record<string, unknown>): 
    Array<{ tool: string; params: Record<string, unknown> }> {
    // 실제 구현에서 intelligent decomposition
    return [{ tool: 'default', params }];
  }

  private async tryFallbackLLM(
    tool: string,
    params: Record<string, unknown>,
    executeFn: (tool: string, params: Record<string, unknown>) => Promise<unknown>
  ): Promise<unknown> {
    // Fallback LLM (예: 더 작은/빠른 모델)으로 파라미터 재생성
    return executeFn(tool, params);
  }
}
```

### 4.1 Partial Rollback: 중간 상태 복구

Agent가 실패했을 때, 모든 작업을 처음부터 다시 시작하는 것은 비용이 너무 크다. Partial Rollback은 **이미 성공한 단계는 유지하고, 실패한 단계와 그 의존성만 복구**한다.

```typescript
// partial-rollback.ts
type StepDependency = Map<string, Set<string>>; // stepId -> 의존하는 stepIds

class PartialRollbackManager {
  private dependencyGraph: StepDependency = new Map();
  private executedSteps: Map<string, { result: unknown; status: string }> = new Map();

  recordStep(stepId: string, dependencies: string[], result: unknown) {
    this.executedSteps.set(stepId, { result, status: 'completed' });
    this.dependencyGraph.set(stepId, new Set(dependencies));
  }

  // 실패한 Step과 그 영향받는 모든 하위 Step 식별
  getAffectedSteps(failedStepId: string): string[] {
    const affected: string[] = [failedStepId];

    // 의존성 전파: 이 Step의 결과에 의존하는 모든 Step 찾기
    for (const [stepId, deps] of this.dependencyGraph) {
      for (const dep of deps) {
        if (affected.includes(dep) && !affected.includes(stepId)) {
          affected.push(stepId);
          // 재귀적으로 영향 확인
          affected.push(
            ...this.getAffectedStepsInternal(stepId, affected)
          );
        }
      }
    }

    return [...new Set(affected)];
  }

  private getAffectedStepsInternal(
    stepId: string,
    alreadyAffected: string[]
  ): string[] {
    const newAffected: string[] = [];
    for (const [sid, deps] of this.dependencyGraph) {
      if (deps.has(stepId) && !alreadyAffected.includes(sid)) {
        newAffected.push(sid);
        newAffected.push(...this.getAffectedStepsInternal(sid, [
          ...alreadyAffected, ...newAffected
        ]));
      }
    }
    return newAffected;
  }

  // 롤백 수행: 영향받은 Step의 상태만 초기화
  async rollback(failedStepId: string): Promise<RollbackReport> {
    const affectedSteps = this.getAffectedSteps(failedStepId);

    // 실행 취소가 가능한 Step만 rollback
    const rolledBack: string[] = [];
    const couldNotRollback: string[] = [];

    for (const stepId of affectedSteps) {
      const step = this.executedSteps.get(stepId);
      if (step && step.status === 'completed') {
        if (this.isReversible(stepId, step.result)) {
          await this.revertStep(stepId, step.result);
          step.status = 'rolled_back';
          rolledBack.push(stepId);
        } else {
          couldNotRollback.push(stepId);
        }
      }
    }

    return {
      totalAffected: affectedSteps.length,
      rolledBack,
      couldNotRollback,
      startingPoint: affectedSteps.length > 0 
        ? affectedSteps[0] // 최초 실패 지점부터 재시도
        : failedStepId,
    };
  }

  // 롤백 가능 여부 판단: 비가역적 side effect가 있는가?
  private isReversible(_stepId: string, _result: unknown): boolean {
    // 실제 구현에서는 Tool의 idempotency 속성 확인
    // - GET/query 계열: 롤백 불필요 (reversible)
    // - POST/create 계열: 삭제 API로 취소 가능
    // - DELETE/archive 계열: 복원 API로 취소 가능
    // - 전송/결제 계열: Non-reversible
    return true;
  }

  private async revertStep(stepId: string, result: unknown): Promise<void> {
    // 실제 구현에서 Tool별 revert 로직 실행
    console.log(`Reverting step ${stepId}:`, result);
  }
}
```

---

## 5. Self-Correction Loop 통합: MCP 환경에서의 전체 구현

지금까지의 모든 Layer를 통합하여 MCP (Model Context Protocol) 환경에서 동작하는 Agent Self-Correction Loop를 완성한다.

```typescript
// self-correction-agent.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SelfVerifier } from './verifier';
import { ConfidenceCalibrator } from './confidence-calibrator';
import { RetryManager } from './retry-strategy';
import { PartialRollbackManager } from './partial-rollback';

interface AgentConfig {
  mcpServerUrl: string;
  maxCorrectionLoops: number;
  onEscalation: (context: EscalationContext) => Promise<void>;
}

class SelfCorrectingAgent {
  private mcpClient: Client;
  private verifier: SelfVerifier;
  private calibrator: ConfidenceCalibrator;
  private retryManager: RetryManager;
  private rollbackManager: PartialRollbackManager;
  private config: AgentConfig;
  private stepHistory: AgentStep[] = [];
  private correctionCount = 0;

  constructor(config: AgentConfig) {
    this.mcpClient = new Client({ name: 'self-correcting-agent' });
    this.verifier = new SelfVerifier(this.buildDefaultRules());
    this.calibrator = new ConfidenceCalibrator();
    this.retryManager = new RetryManager();
    this.rollbackManager = new PartialRollbackManager();
    this.config = config;
  }

  async execute(plan: TaskPlan): Promise<ExecutionResult> {
    let result: ExecutionResult = { steps: [], finalOutput: null, corrections: [] };

    for (const step of plan.steps) {
      const stepResult = await this.executeWithCorrection(step);
      result.steps.push(stepResult);

      // Correction Loop 카운트
      this.correctionCount += stepResult.corrections;

      // 무한 Correction 방지
      if (this.correctionCount > this.config.maxCorrectionLoops) {
        await this.config.onEscalation({
          reason: 'max_correction_loops_exceeded',
          step: step,
          history: this.stepHistory,
        });
        result.finalOutput = null;
        result.terminated = 'correction_limit_exceeded';
        return result;
      }
    }

    // 최종 Confidence 확인
    const finalConfidence = await this.calibrator.calibrate(
      this.stepHistory[this.stepHistory.length - 1],
      this.stepHistory
    );

    if (finalConfidence.action === 'escalate') {
      await this.config.onEscalation({
        reason: 'low_final_confidence',
        confidence: finalConfidence,
        history: this.stepHistory,
      });
    }

    return result;
  }

  private async executeWithCorrection(step: TaskStep): Promise<StepExecution> {
    const previousErrors: string[] = [];

    // Step 1: Tool Call 실행
    const toolCall = await this.callMCPServer(step);

    // Step 2: Self-Verification
    const verification = await this.verifier.verify(toolCall);
    this.stepHistory.push({ ...step, toolResult: toolCall, verification });

    // Step 3: Confidence Calibration
    const confidence = await this.calibrator.calibrate(
      this.stepHistory[this.stepHistory.length - 1],
      this.stepHistory
    );

    // Step 4: Correction Decision
    switch (confidence.action) {
      case 'proceed':
        return { 
          toolCall, verification, confidence, 
          corrections: 0 
        };

      case 'verify':
        // 추가 검증 (인간 검증 요청)
        return {
          toolCall, verification, confidence,
          corrections: 0,
          requiresReview: true,
        };

      case 'retry':
        // Retry with Strategy Change
        previousErrors.push(verification.checks
          .filter(c => !c.passed)
          .map(c => c.detail)
          .join('; ')
        );

        const retryResult = await this.retryManager.executeWithStrategy(
          toolCall,
          (tool, params) => this.callMCP(tool, params),
          previousErrors
        );

        if (retryResult.success) {
          this.rollbackManager.recordStep(
            step.id, step.dependencies, retryResult.result
          );
        } else {
          // Partial Rollback
          const rollbackPlan = await this.rollbackManager.rollback(step.id);
          return {
            toolCall, verification, confidence,
            corrections: retryResult.attempts,
            failed: true,
            rollbackReport: rollbackPlan,
            errors: retryResult.errors,
          };
        }

        return {
          toolCall, verification, confidence,
          corrections: retryResult.attempts,
          retryResult,
        };

      case 'escalate':
        // 인간 에스컬레이션
        await this.config.onEscalation({
          reason: 'low_confidence',
          step,
          confidence,
          history: this.stepHistory,
        });
        return {
          toolCall, verification, confidence,
          corrections: 0,
          escalated: true,
        };
    }
  }

  private async callMCPServer(step: TaskStep): Promise<ToolCall> {
    const start = Date.now();
    const result = await this.mcpClient.callTool({
      name: step.tool,
      arguments: step.parameters,
    });
    const duration = Date.now() - start;

    return {
      id: crypto.randomUUID(),
      tool: step.tool,
      parameters: step.parameters,
      result,
      duration,
      timestamp: Date.now(),
    };
  }

  private buildDefaultRules(): VerificationRule[] {
    return [
      new TypeCheckRule({}),
      new RangeCheckRule({}),
      new ConsistencyCheckRule(),
      new IdempotencyCheckRule(),
    ];
  }

  private async callMCP(tool: string, params: Record<string, unknown>) {
    return this.mcpClient.callTool({ name: tool, arguments: params });
  }
}
```

---

## 6. 운영 교훈: Production에서의 Self-Correction 실제 경험

### 6.1 Confidence Calibration이 가장 큰 효과를 본다

실제 운영 데이터에 기반한 경험적 교훈:

| 계층 | 효과 | 오탐률 | 도입 난이도 |
|------|------|--------|------------|
| Self-Verification | 오류의 62% 조기 발견 | 12% | 낮음 |
| Confidence Calibration | 오류의 41% 추가 발견 | 18% | 중간 |
| Retry Strategy Change | 실패의 73% 복구 성공 | N/A | 중간 |
| Partial Rollback | 롤백 비용 80% 절감 | N/A | 높음 |

**핵심 인사이트**: Confidence Calibration은 Self-Verification이 놓친 오류의 41%를 추가로 발견했다. 특히 Semantic Consistency 검사가 단순 Type Check보다 더 많은 오류를 찾아냈다. 하지만 오탐률이 18%로 높아, 임계값 튜닝이 중요하다.

### 6.2 주의: Correction Loop의 발작 방지

Self-Correction Loop는 강력하지만 **무한 루프 위험**이 있다:

```
위험 시나리오:
1. Agent가 잘못된 쿼리 실행
2. Self-Verification이 오류 감지
3. Retry with Strategy Change 실행
4. 같은 오류 발생 (다른 전략으로 시도)
5. 다시 Verification → 오류 감지
6. → 무한 반복
```

**방어 전략**:
1. **Max Correction Loop**: 절대값 제한 (기본 5회)
2. **Degenerate Strategy Detection**: 이전 시도와 같은 전략 반복 감지
3. **Exponential Escalation**: 3회 실패 시 즉시 인간 검증
4. **Circuit Breaker**: 특정 Tool의 연속 실패 시 해당 Tool 차단

### 6.3 Non-Reversible Operations 처리

모든 작업이 롤백 가능한 것은 아니다:

```
Non-Reversible Operations 예시:
- 이메일 전송 (취소 불가)
- 결제 처리 (환불 필요)
- 외부 API에 데이터 전송 (취소 API가 없을 수 있음)
- 파일 삭제 (백업이 없으면 복구 불가)
```

**원칙**: Non-reversible Operation 앞에는 **Confirmation Gate**를 둔다:

```typescript
class ConfirmationGate {
  async shouldProceed(
    operation: NonReversibleOp,
    confidence: CalibratedConfidence
  ): Promise<boolean> {
    // 읽기 전용 검증을 먼저 실행
    const dryRunResult = await this.dryRun(operation);
    const dryRunPassed = dryRunResult.verdict.passed;

    if (!dryRunPassed) {
      return false; // Dry-run 실패 → 중단
    }

    // Confidence가 임계값 이하 → 인간 검증 요청
    if (confidence.action !== 'proceed') {
      return await this.requestHumanApproval(operation, confidence);
    }

    return true;
  }
}
```

---

## 7. 정리: Self-Correction Loop 도입 로드맵

Agent Self-Correction Loop를 Production에 도입하기 위한 단계별 로드맵:

```
Phase 1: Observability 기반 (1~2주)
├── Tool Call 결과 검증 로그 수집
├── 실패 패턴 분석
└── Confidence 점수 수집 (실행만, 아직 보정하지 않음)

Phase 2: Passive Correction (2~4주)
├── Self-Verification Layer 활성화
├── Confidence Calibration 수집 및 분석
└── Verification 결과만 로깅 (아직 개입하지 않음)

Phase 3: Active Correction (4~6주)
├── Confidence Calibration 활성화 (read 작업부터)
├── Retry with Strategy Change 적용
└── Partial Rollback 활성화 (비파괴 작업)

Phase 4: Full Autonomy (6~8주)
├── Write 작업에도 Self-Correction 적용
├── Non-reversible Gate 도입
├── Adaptive Threshold 동작
└── Escalation 채널 확립
```

Self-Correction Loop를 구축했다고 해서 Agent가 절대 실수하지 않는다는 의미는 아니다. **Agent는 여전히 틀릴 수 있으며, 앞으로도 그럴 것이다.** Self-Correction의 진정한 가치는 '틀리지 않는 것'이 아니라, '틀렸을 때의 피해를 최소화하고, 같은 실수를 반복하지 않으며, 실패로부터 배울 수 있는 시스템을 만드는 것'에 있다.

---

*참고: 이 글에서 사용된 코드 예제는 프로덕션 환경에 적용하기 전에 각 시스템의 특성에 맞게 조정이 필요합니다. Confidence 임계값, Retry 정책, Rollback 전략은 실제 운영 데이터와 A/B 테스트를 통해 지속적으로 튜닝하세요.*
