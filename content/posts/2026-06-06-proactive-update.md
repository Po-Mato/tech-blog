---
title: "AI Agent Observability: 텔레메트리가 말해주지 않는 다섯 가지 사실"
date: "2026-06-06"
description: "Microsoft Build 2026에서 Agent DevOps 전주기 관측성이 GA를 맞고 Coralogix가 2억 달러를 조달한 지금, AI Agent Observability는 선택이 아닌 필수 인프라가 되고 있습니다. OpenTelemetry가 커버하는 범위와 그 너머에 있는 평가·제어·안전 계층의 아키텍처를 실제 코드와 함께 분석합니다."
tags:
  - AI Observability
  - Agent Architecture
  - OpenTelemetry
  - Microsoft Foundry
  - Production AI
  - MLOps
  - Enterprise AI
---

## 1. 들어가며: 에이전트가 프로덕션에 도달하면 생기는 일

AI 에이전트를 배포하는 것은 비교적 쉽습니다. 단일 툴 호출을 LLM에 위임하는 간단한 에이전트는 하루 만에 만들 수 있습니다. 하지만 그 에이전트가 **프로덕션에서 7x24시간 운영되기 시작하면** 상황이 달라집니다.

**사례 1.** 금융 서비스 팀이 포트폴리오 매니저를 위한 리서치 요약 에이전트를 배포했습니다. 체인은 검색 에이전트 → 요약 LLM → 규정 준수 검증 에이전트로 구성되었습니다. 기존 APM(Application Performance Monitoring) 스택으로는 지연 시간과 에러율만 확인할 수 있었습니다. 일주일 후, 규정 준수 팀이 아침에 세 건의 규정 위반을 발견했습니다. APM 대시보드는 여전히 초록불이었습니다.

**사례 2.** 고객 지원 에이전트가 갑자기 이전과 다른 의사결정을 내리기 시작했습니다. LLM 공급자의 모델이 사이드 채널로 업데이트되면서 reasoning 경로가 바뀌었고, 동일한 프롬프트가 다른 툴 체인을 타기 시작했습니다. 문제를 발견한 시점은 사용자 complaints가 쌓이고 난 3일 후였습니다.

이러한 사례의 공통점은 무엇일까요? **기존의 관측성 스택으로는 AI 에이전트의 의사결정 품질을 추적할 수 없다**는 것입니다. 로그, 메트릭, 에러율만으로는 에이전트가 **올바른 결정을 내렸는지**, 그 결정이 **시간이 지남에 따라 개선되고 있는지 악화되고 있는지**를 알 수 없습니다.

이 문제는 단순한 기술적 결함이 아닙니다. 2026년 6월 현재, Microsoft Build 2026에서는 Azure Foundry에서 에이전트 옵저버빌리티가 GA를 맞았고, Coralogix는 AI 옵저버빌리티를 위해 2억 달러 Series F를 조달했습니다. 시장이 이 주제에 베팅하고 있습니다.

이 글에서는 AI Agent Observability의 아키텍처를 세 가지 레이어로 분해합니다:

1. **데이터 플레인 (Telemetry Layer)** — OpenTelemetry가 커버하는 범위와 한계
2. **컨트롤 플레인 (Evaluation & Control Layer)** — 평가, 안전, 정책 적용이 필요한 이유
3. **비즈니스 플레인 (ROI Layer)** — CFO에게 에이전트의 가치를 증명하는 방법

---

## 2. 전통적 APM이 실패하는 이유

전통적인 소프트웨어는 **결정론적(Deterministic)**입니다. 동일한 입력 → 동일한 출력 → 동일한 코드 경로. 따라서 200 OK / 500 Error라는 이분법적 상태 확인이 유효했습니다.

에이전트는 **비결정론적(Non-Deterministic)**입니다. 동일한 프롬프트가 오늘은 세 가지 툴 경로를 타고, 내일은 모델 업데이트로 네 번째 경로를 탈 수 있습니다. LLM 호출 자체가 확률적(stochastic)이며, 툴 선택도 모델의 reasoning에 의존합니다.

```
// 전통적 APM이 보는 에이전트
// Latency: 2.3s, Status: 200 OK, Error: none

// 실제로 일어난 일
// - 검색 에이전트가 잘못된 데이터 소스 선택 (정확도 42%)
// - 요약 LLM이 문서에 없는 통계를 생성 (환각)
// - 규정 준수 에이전트가 forward-looking statement 위반을 놓침 (missed)
```

이것이 **"인스트루먼테이션 블라인드 스팟(Instrumentation Blind Spot)"**입니다. 에러율, 지연 시간, 스루풋은 정상이지만, 에이전트의 **의사결정 품질**은 확인할 수 없습니다.

---

## 3. 데이터 플레인: OpenTelemetry가 커버하는 범위

OpenTelemetry는 이 문제의 **데이터 계층**을 해결합니다. 2026년 현재 OpenTelemetry GenAI SIG는 AI 워크로드 전용 시맨틱 컨벤션을 정의했으며, 이는 세 가지 핵심 속성을 제공합니다:

### 3.1 벤더 중립성(Vendor Neutrality)

한 번 인스트루먼트하면 어떤 백엔드로도 내보낼 수 있습니다. LLM 공급자를 교체해도 속성 이름, 트레이스 구조, 대시보드가 일관됩니다.

```python
from opentelemetry import trace
from opentelemetry.semconv.ai import SpanAttributes, GenAISystemAttributes

tracer = trace.get_tracer("ai-research-agent")

with tracer.start_as_current_span("llm.chat") as span:
    # GenAI 시맨틱 컨벤션 적용
    span.set_attribute("gen_ai.system", "openai")
    span.set_attribute("gen_ai.request.model", "gpt-4o")
    span.set_attribute("gen_ai.request.max_tokens", 2048)
    span.set_attribute("gen_ai.request.temperature", 0.2)

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=messages,
        max_tokens=2048,
        temperature=0.2,
    )

    span.set_attribute(
        "gen_ai.usage.input_tokens",
        response.usage.prompt_tokens
    )
    span.set_attribute(
        "gen_ai.usage.output_tokens",
        response.usage.completion_tokens
    )
    span.set_attribute(
        "gen_ai.response.finish_reasons",
        [response.choices[0].finish_reason]
    )
```

이 코드는 OpenAI, Anthropic, AWS Bedrock 중 어느 것을 사용해도 동일한 속성 구조를 유지합니다.

### 3.2 에이전트 계층 전체의 분산 트레이싱

OpenTelemetry 트레이스는 사용자 요청 → 오케스트레이터 → 서브 에이전트 → 툴 호출 → LLM 호출의 전체 호출 그래프를 캡처합니다. 각 단계는 구조화된 속성을 가진 스팬(span)이 됩니다.

### 3.3 통합 파이프라인

OTel Collector는 메트릭, 트레이스, 로그를 단일 파이프라인에서 처리합니다. LLM 호출의 레이턴시 스파이크가 네트워크 파티션 때문인지, 모델 프로바이더의 레이트 리밋 때문인지 동일한 트레이스 컨텍스트 내에서 추적할 수 있습니다.

### 3.4 OpenTelemetry가 커버하지 못하는 것

그러나 OpenTelemetry는 근본적인 한계가 있습니다. **"무슨 일이 일어났는가(what happened)"**는 캡처하지만, **"그것이 괜찮은가(was it good)"**는 평가하지 않습니다.

| OpenTelemetry가 하는 일 | OpenTelemetry가 하지 못하는 일 |
|---|---|
| LLM 호출 성공/실패 기록 | 출력이 컨텍스트에 충실한지 평가 (hallucination) |
| 토큰 사용량 추적 | 출력이 유해한지, PII를 노출하는지 검사 |
| 호출당 지연 시간 측정 | 응답이 사용자 질문에 적합한지 평가 |
| 툴 호출 완료 여부 기록 | 가드레일이 올바르게 작동했는지 확인 |
| 스팬 속성으로 벤더 간 비교 | 비용을 토큰 이상으로 속성화 (Evaluation Trust Tax) |

이 간극이 바로 **컨트롤 플레인**이 필요한 이유입니다.

---

## 4. 컨트롤 플레인: 평가와 제어의 아키텍처

Microsoft Foundry의 Build 2026 발표는 이 간극을 정확히 메웁니다. Foundry는 에이전트 옵저버빌리티를 **네 가지 기능**으로 정의합니다:

1. **Trace** — 모든 단계의 엔드투엔드 텔레메트리
2. **Evaluate** — 단일/다중 턴에서의 품질 및 안전 스코어링
3. **Monitor** — Azure Monitor를 통한 실시간 이슈 탐지
4. **Optimize** — 프로덕션 신호를 증거 기반 에이전트 개선으로 전환

### 4.1 Trace → Evaluate 연결

텔레메트리만으로는 충분하지 않습니다. Foundry의 핵심 혁신은 **Trace를 Evaluate에 직접 연결**하는 점입니다. 즉, 캡처한 트레이스를 런타임에 평가하여 스코어를 할당합니다.

```typescript
// 의사 코드: Foundry Agent Observability Trace → Evaluate 파이프라인
const evaluator = new AgentEvaluator({
  metrics: {
    taskSuccess: { weight: 0.5 },
    toneConsistency: { weight: 0.2 },
    safety: { weight: 0.2 },
    latencyCostEfficiency: { weight: 0.1 },
  },
});

// Production 트레이스를 실시간 평가
const trace = await telemetry.getTrace(agentCallId);
const score = await evaluator.evaluateMultiTurn(trace);
// 결과: { taskSuccess: 0.92, tone: 0.88, safety: 1.0, overall: 0.91 }
```

### 4.2 Multi-Turn Evaluation

단일 턴 평가는 장기 컨텍스트에서만 발생하는 실패 모드를 놓칩니다:
- 컨텍스트 누적으로 인한 톤 변화 (tone drift)
- 대화 초기의 목표를 잃어버리는 현상 (goal drift)
- 긴 대화에서의 모순 발생 (contradiction)
- 안전 회귀 (safety regression)

Multi-turn 평가는 전체 대화를 하나의 평가 단위로 취급하여 이러한 복합 실패를 감지합니다.

### 4.3 Rubric Evaluator

"좋은(good)"의 기준은 에이전트마다 다릅니다. 벤더 이력 에이전트에게 좋은 것과 고객 지원 에이전트에게 좋은 것은 다릅니다.

Rubric Evaluator는 에이전트의 의도된 행동에서 컨텍스트 인식 평가 기준을 **자동 생성**합니다:

```typescript
const rubric = await evaluator.generateRubric({
  agentName: "vendor-history-agent",
  intendedBehavior: "계약 이력 검색 및 정확한 요약 제공",
  domains: ["task_completion", "tone", "safety", "cost", "latency"],
  weights: [0.4, 0.1, 0.3, 0.1, 0.1],
});

// "계약 이력 검색" 에이전트를 위한 커스텀 루브릭
// - task_completion: 계약 조건 3가지 이상 포함 여부
// - safety: 내부 정책상 공개 불가 정보 누락 확인
// - cost: 검색당 평균 토큰 비용 대비 효율
```

### 4.4 지능형 트레이스 샘플링

모든 프로덕션 트레이스를 평가하는 것은 낭비이고, 아무것도 평가하지 않는 것은 위험합니다. Foundry의 Intelligent Trace Sampling은 **신호가 가장 풍부한 상호작용**을 선별하여 평가합니다. 중요한 트레이스(고위험 쿼리, 예외 경로, 장기 대화)는 100% 샘플링하고, 일반적인 트레이스는 통계적 샘플링합니다.

---

## 5. 실전 패턴: 에이전트 옵저버빌리티 구축하기

이론적인 아키텍처를 실제 코드로 구현해 보겠습니다.

### 5.1 기본 구조: Telemetry Bridge

```python
"""
Agent Observability Bridge Pattern
OTel 텔레메트리를 캡처하여 평가 파이프라인에 전달
"""

from opentelemetry import trace
from opentelemetry.semconv.ai import SpanAttributes
from dataclasses import dataclass, field
from typing import Optional
import json


@dataclass
class AgentDecision:
    """에이전트의 단일 의사결정을 기록하는 구조체"""
    step_id: str
    agent_name: str
    tool_chosen: str
    tool_input: dict
    tool_output: Optional[dict] = None
    latency_ms: float = 0.0
    token_cost: float = 0.0
    confidence_score: Optional[float] = None
    was_recovered: bool = False  # fallback 경로 진입 여부


class ObservableAgent:
    """
    ObservableAgent 데코레이터 패턴:
    모든 의사결정을 OTel 스팬 + 평가 큐에 기록
    """

    def __init__(self, agent_name: str, evaluator=None):
        self.agent_name = agent_name
        self.tracer = trace.get_tracer(agent_name)
        self.evaluator = evaluator
        self.decisions: list[AgentDecision] = []

    def record_decision(self, decision: AgentDecision):
        """의사결정을 OTel 스팬과 평가 큐에 동시 기록"""
        with self.tracer.start_as_current_span(f"agent.{decision.agent_name}") as span:
            span.set_attribute("agent.name", decision.agent_name)
            span.set_attribute("agent.step_id", decision.step_id)
            span.set_attribute("agent.tool_chosen", decision.tool_chosen)
            span.set_attribute("agent.latency_ms", decision.latency_ms)
            span.set_attribute("agent.token_cost", decision.token_cost)
            span.set_attribute("agent.was_recovered", decision.was_recovered)

            # 평가 큐에 추가 (비동기 처리)
            self.decisions.append(decision)

            if decision.confidence_score is not None:
                span.set_attribute(
                    "agent.confidence_score",
                    decision.confidence_score
                )

    async def evaluate_session(self, session_id: str) -> dict:
        """세션 종료 후 전체 의사결정 체인 평가"""
        if not self.evaluator:
            return {"error": "no evaluator configured"}

        return await self.evaluator.evaluate_chain(
            session_id=session_id,
            decisions=self.decisions,
        )
```

### 5.2 평가자 구현: Multi-Turn Chain Evaluator

```python
"""
Multi-turn 평가자: 전체 대화 체인에서 복합 실패 모드 감지
"""


class MultiTurnChainEvaluator:
    """
    단일 턴 평가가 놓치는 복합 실패를 감지:
    - Goal drift: 초기 목표와 최종 결과의 정렬도
    - Tone drift: 톤 일관성 변화율
    - Contradiction: 이전 발언과의 모순 빈도
    """

    def __init__(self, llm_client):
        self.llm = llm_client

    async def evaluate_chain(
        self,
        session_id: str,
        decisions: list[AgentDecision],
    ) -> dict:
        goal_alignment = await self._measure_goal_alignment(decisions)
        tone_consistency = await self._measure_tone_consistency(decisions)
        contradictions = await self._detect_contradictions(decisions)
        safety_score = await self._check_safety_compliance(decisions)

        return {
            "session_id": session_id,
            "overall_score": (
                goal_alignment * 0.35
                + tone_consistency * 0.15
                + (1 - contradictions) * 0.25
                + safety_score * 0.25
            ),
            "goal_alignment": goal_alignment,
            "tone_consistency": tone_consistency,
            "contradiction_rate": contradictions,
            "safety_score": safety_score,
            "decision_count": len(decisions),
            "total_latency_ms": sum(
                d.latency_ms for d in decisions
            ),
            "total_token_cost": sum(
                d.token_cost for d in decisions
            ),
            "recovery_rate": sum(
                1 for d in decisions if d.was_recovered
            ) / len(decisions) if decisions else 0,
        }

    async def _measure_goal_alignment(
        self, decisions: list[AgentDecision]
    ) -> float:
        """첫 번째 결정의 목적과 최종 결정의 정렬도 측정"""
        if len(decisions) < 2:
            return 1.0
        first_goal = decisions[0].tool_input.get("goal", "")
        final_output = decisions[-1].tool_output
        # LLM 기반 정렬도 평가 (생략: 실제 구현은 LLM 호출)
        return 0.92  # 예시 반환값
```

### 5.3 가드레일 통합: Telemetry → Action Loop

텔레메트리만으로는 부족합니다. 평가 결과를 바탕으로 **실시간 제어**가 가능해야 합니다:

```python
"""
Observability → Guardrail → Action 파이프라인
"""


class GuardrailEnforcementLoop:
    """
    프로덕션 트레이스 평가 결과를 즉시 액션으로 전환:
    - Safety threshold 초과 → 즉시 차단
    - Quality threshold 미달 → 재시도 또는 fallback
    - Cost anomaly 감지 → 모델 다운그레이드
    """

    def __init__(self, threshold: float = 0.6):
        self.threshold = threshold
        self.action_log: list[dict] = []

    async def process_evaluation(
        self, session_id: str, eval_result: dict
    ) -> str:
        score = eval_result.get("overall_score", 1.0)

        if eval_result.get("safety_score", 1.0) < self.threshold:
            action = self._block_session(session_id, eval_result)
        elif score < self.threshold:
            action = self._trigger_fallback(
                session_id, eval_result
            )
        else:
            action = self._pass_through(session_id, eval_result)

        self.action_log.append({
            "session_id": session_id,
            "score": score,
            "action": action["type"],
            "timestamp": "2026-06-06T07:00:00Z",
        })
        return action["type"]

    def _block_session(self, session_id: str,
                       eval_result: dict) -> dict:
        return {
            "type": "BLOCK",
            "reason": f"Safety threshold: {eval_result['safety_score']}",
        }

    def _trigger_fallback(self, session_id: str,
                          eval_result: dict) -> dict:
        return {
            "type": "FALLBACK",
            "action": "reroute_to_simpler_model",
            "reason": f"Quality score: {eval_result['overall_score']}",
        }

    def _pass_through(self, session_id: str,
                      eval_result: dict) -> dict:
        return {"type": "PASS", "action": "none"}
```

### 5.4 생태계 현황: 누가 무엇을 제공하는가

| 플랫폼 | 텔레메트리 | 평가 | 가드레일 | 최적화 |
|--------|-----------|------|---------|-------|
| Microsoft Foundry (Build 2026) | OTel 기반 (GA) | Multi-turn + Rubric (Public Preview) | Azure Monitor 연동 | Traces-to-dataset |
| Arize AI (OpenInference) | OTel 확장 | Phoenix 평가 프레임워크 | 스코어 기반 얼러트 | 실험 트래킹 |
| Datadog LLM Observability | 자체 SDK | 품질 메트릭 | APM 통합 가드레일 | 비용 분석 |
| LangSmith (LangChain) | LangChain 네이티브 | 맞춤형 평가자 | 허브 정책 | 프롬프트 최적화 |
| Fiddler AI | OTel 수집 | 정확성 + 안전성 | 트래픽 차단 | 모델 비교 |

---

## 6. OpenTelemetry: Telemetry Data Plane vs Evaluation Control Plane

Fiddler AI의 최근 분석은 이 아키텍처의 핵심 구분을 명확히 합니다:

> **OpenTelemetry is the data plane. It captures what happened. Evaluation is the control plane. It assesses whether what happened was acceptable.**

이 구분은 다음과 같은 구조적 의미를 가집니다:

```
┌──────────────────────────────────────────────┐
│            Control Plane                     │
│  (Evaluation, Scoring, Enforcement, Policy)  │
├──────────────────────────────────────────────┤
│            Data Plane                        │
│  (OpenTelemetry: Trace, Metric, Log)        │
├──────────────────────────────────────────────┤
│            Agent Runtime                     │
│  (MCP Tools, A2A Protocol, LLM Calls)       │
└──────────────────────────────────────────────┘
```

OpenTelemetry가 데이터 플레인으로 정착하면서, 평가와 제어 플레인은 그 위에 구축되는 별도의 계층이 되었습니다. 이 계층 분리는 엔터프라이즈 배포에서 중요한 의미를 가집니다:

- **데이터 플레인은 변경에 강함**: 인스트루먼테이션은 한 번 구축하면 LLM 변경에도 영향을 받지 않음
- **컨트롤 플레인은 빠르게 진화**: 평가 기준은 비즈니스 요구사항에 따라 지속적으로 업데이트 가능
- **정책 적용은 분리 가능**: 규정 준수 정책을 데이터 수집과 독립적으로 변경할 수 있음

---

## 7. 비즈니스 플레인: Observability에서 ROI로

마지막이자 가장 중요한 계층입니다. 에이전트 옵저버빌리티의 궁극적인 목표는 **"에이전트를 더 잘 운영하는 것"**이 아니라 **"에이전트의 비즈니스 가치를 증명하고 극대화하는 것"**입니다.

Microsoft Foundry의 Build 2026 발표에는 중요한 ROI 대시보드가 포함되었습니다. CFO가 물어볼 세 가지 질문에 답해야 합니다:

1. **이 에이전트가 우리에게 얼마를 절약해 주고 있나요?**
   - 비용 측정: LLM 호출당 토큰 비용 + 평가 인프라 비용 (Evaluation Trust Tax)
   - 절감 측정: 수동 처리 대비 시간 절감 × 인건비

2. **에이전트가 작업을 얼마나 잘 수행하고 있나요?**
   - Task Success Rate (TSR): 에이전트가 의도된 작업을 완료한 비율
   - Human Intervention Rate (HIR): 사람이 개입해야 했던 비율 (낮을수록 좋음)

3. **이 에이전트가 시간이 지남에 따라 개선되고 있나요?**
   - TSR 트렌드 (주간/월간)
   - 에이전트 개선 루프 (traces → dataset → retrain → redeploy)의 완료율

### ROI 계산 예시

```
가상의 사례: 엔터프라이즈 IT 헬프데스크 에이전트

월간 비용:
  - LLM API 호출 비용: $3,200
  - OTel 인프라: $400
  - 평가 파이프라인: $600
  - 총 운영 비용: $4,200

월간 절감:
  - 대체된 Tier-1 인시던트: 1,200건 × $25/건 = $30,000
  - 해결 시간 단축: 평균 45분 → 12분 = 73% 단축
  - 총 절감: $30,000

월간 ROI: ($30,000 - $4,200) / $4,200 = 614%
```

이러한 ROI 계산은 옵저버빌리티 인프라 없이는 불가능합니다. 측정할 수 없으면 증명할 수 없고, 증명할 수 없으면 투자를 받을 수 없습니다.

---

## 8. 결론: 2026년 Agent Observability의 5가지 진실

AI Agent Observability는 선택이 아닌 필수 인프라가 되었습니다. Microsoft Build 2026의 발표와 Coralogix의 2억 달러 투자는 이 시장의 성숙도를 증명합니다.

**이 글이 말해주는 5가지 핵심 진실:**

1. **APM만으로는 충분하지 않다**: 결정론적 소프트웨어를 위해 설계된 기존 관측성 스택은 비결정론적 에이전트의 의사결정 품질을 측정할 수 없습니다.

2. **OpenTelemetry는 시작일 뿐이다**: OTel은 데이터 플레인(무슨 일이 일어났는가)을 해결하지만, 컨트롤 플레인(그것이 괜찮은가)은 평가와 정책 계층이 필요합니다.

3. **Multi-turn 평가가 복합 실패를 잡는다**: 단일 턴 평가는 컨텍스트 드리프트, 골 드리프트, 모순, 안전 회귀를 놓칩니다.

4. **샘플링 전략이 비용과 신뢰도의 균형을 결정한다**: Intelligent Trace Sampling 없이는 모든 트레이스를 평가하는 비용이 감당할 수 없습니다.

5. **옵저버빌리티는 ROI의 전제 조건이다**: 측정할 수 없으면 개선할 수 없고, 개선할 수 없으면 투자를 받을 수 없습니다.

이 글이 다루는 내용은 에이전트의 수명주기(Lifecycle) 전체를 포괄합니다. MCP가 툴 연결을, A2A가 에이전트 간 통신을 표준화했다면, 이제 Observability는 그 위에서 실행되는 모든 에이전트의 신뢰성과 비즈니스 가치를 보장하는 마지막 퍼즐 조각입니다.

---

*참고 자료:*
- [Microsoft Build 2026: From observability to ROI for AI agents on any framework](https://devblogs.microsoft.com/foundry/build-2026-from-observability-to-roi-for-ai-agents-on-any-framework/)
- [OpenTelemetry for AI Observability: What It Covers and Where It Stops - Fiddler AI](https://www.fiddler.ai/blog/opentelemetry-ai-observability-guide)
- [Coralogix $200M Series F - Observability Backbone for AI](https://newmarketpitch.com/blogs/news/coralogix-series-f-why)
- [OpenTelemetry GenAI Semantic Conventions (SIG)](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
