---
title: "Agentic AI의 Production SLO 설계: Time-to-Useful-Action로 본 시스템 신뢰성"
date: 2026-04-29T16:00:00+09:00
draft: false
tags: ["AI", "Agentic AI", "SLO", "Production Engineering", "Reliability", "LLM"]
---

## 서론: Agentic AI에 SLO가 필요한 이유

2026년, AI 에이전트가 Production 환경에서 업무를 수행하는 시대가 왔다. 단순히 "답변 생성"이 아니라, "카테고리 분류 후 DB에 저장", "코드 리뷰 후 PR合并", "고객 이메일 분석 후 태스크 생성" 같은 **실행 목표(Goal-Oriented Task)**를自立적으로 수행한다.

그런데 문제가 있다.传统的 SLI/SLO(SLA와는 다르게, **사용자 관점의 신뢰 지표**)가 AI 에이전트에는 존재하지 않는다는 것이다.

- API 응답 지연 →传统的Latency SLO
- 서비스 장애 → Availability SLO
- 그런데 **"에이전트가 올바른 도구를 선택했는가?"**, **"3단계 reasoning 후 올바른 행동을 했는가?"** → 측정 frameworks이 없다

이 글에서는 Agentic AI system을 위한 **Production SLO 설계 프레임워크**를 정리하고, 핵심 metric인 **Time-to-Useful-Action (TTUA)**를 중심轴로 어떻게 신뢰성을 측정하고 개선하는지 살펴본다.

---

## 1. Agentic AI SLO의 구조

Agentic AI의 SLO는 크게 세 가지 차원으로 나뉜다:

### 1.1 Execution SLO (실행 신뢰성)

에이전트가 행동을 성공적으로 완료하는 지표.传统的 API 서비스와 유사하지만, **자율적 의사결정**이 추가된다.

```python
# Execution SLO 정의 예시
class AgentExecutionSLO:
    def __init__(self):
        # 단계 1: Tool Selection Accuracy
        # 에이전트가 주어진 상황에서 적절한 tool을 선택한 비율
        self.tool_selection_accuracy: float = 0.95  # 95%为目标
        
        # 단계 2: Action Completion Rate
        # Tool 선택 후 실제로 원하는 결과에 도달한 비율
        self.action_completion_rate: float = 0.90
        
        # 단계 3: Result Accuracy (幻觉 방지)
        # 생성된 결과가 ground truth와 일치하는 비율
        self.result_accuracy: float = 0.93
```

### 1.2 Latency SLO (응답 지연)

AI 에이전트는 일반 API보다 복잡한 reasoning 체인이 있어 latency 관리更难하다.

| 계층 | Metric | Target | 설명 |
|------|--------|--------|------|
| Thinking Latency | First Token Time | < 2s | 첫 번째 토큰 생성까지 시간 |
| Reasoning Depth | Reasoning Steps | < 15 steps | 목표 달성까지 reasoning 단계 수 |
| Action Latency | Tool Execution Time | < 5s per tool | 도구별 실행 시간 |
| Total Latency | **TTUA (Time-to-Useful-Action)** | < 30s p95 | 목표 달성까지 총 시간 |

### 1.3 Safety SLO (안전rails)

실행 단계에서 발생할 수 있는 위험 행동을 제어하는 지표.

```python
class AgentSafetySLO:
    def __init__(self):
        # 1. Hallucination Detection Rate
        # 사실과 다른 내용을 생성했다가 detect된 비율
        self.hallucination_rate: float = 0.02  # 2% 이하
        
        # 2. Tool Misuse Rate
        # 권한 없는 operation이나 잘못된 tool 사용 비율
        self.tool_misuse_rate: float = 0.005   # 0.5% 이하
        
        # 3. Cascade Failure Prevention
        # 하나의 잘못된 decision이 전체 시스템을 무너뜨리는 비율
        self.cascade_failure_rate: float = 0.001  # 0.1% 이하
```

---

## 2. Time-to-Useful-Action (TTUA): 핵심 Metric

### 2.1 TTUA란?

TTUA는 에이전트가 사용자의 목표를 달성할 때까지 걸리는 **총 시간**을 측정하는 지표다.传统的 TTFL (Time to First Letter)와 유사하지만, AI 에이전트 특성상 **다단계 reasoning + tool execution**이 포함된다.

```
User Request → [Think] → [Plan] → [Tool 1] → [Observe] → [Tool 2] → [Final Output]
                    ↓          ↓          ↓           ↓           ↓
                 t=0.5s     t=1.2s     t=3.5s       t=5.0s      t=8.2s     TTUA = 8.2s
```

### 2.2 TTUA 분해와 개선 전략

```python
def decompose_ttua(timestamp_log: list[dict]) -> dict:
    """TTUA를 각 단계별로 분해하여 병목 지점 식별"""
    
    phases = {
        "thinking": [],   # Reasoning/Planning 시간
        "tool_call": [],  # Tool 실행 시간
        "observation": [], # 결과 관찰·판단 시간
        "latency": []     # 네트워크·외부 API 대기 시간
    }
    
    for i, event in enumerate(timestamp_log):
        if event["type"] == "reasoning":
            phases["thinking"].append(event["duration"])
        elif event["type"] == "tool_execution":
            phases["tool_call"].append(event["duration"])
        elif event["type"] == "observation":
            phases["observation"].append(event["duration"])
        elif event["type"] == "wait":
            phases["latency"].append(event["duration"])
    
    # P95 TTUA 계산
    total_merged = sorted(
        [sum(phases[k], []) for k in phases], 
        key=lambda x: x.get("end", 0)
    )
    
    p95_idx = int(len(total_merged) * 0.95)
    
    return {
        "thinking_p50": median(phases["thinking"]),
        "tool_call_p95": percentile(phases["tool_call"], 95),
        "observation_p95": percentile(phases["observation"], 95),
        "ttua_p95": total_merged[p95_idx]["end"],
        "bottleneck": max(phases, key=lambda k: median(phases[k]))
    }
```

### 2.3 TTUA 기반 SLO 모니터링 대시보드 구성

```yaml
# Prometheus + Grafana 기반 Agentic AI SLO 대시보드
slo_config:
  agent_slo:
    name: "customer-ticket-agent"
    ttua_target: 30  # 초
    ttua_window: 5m  # 5분 윈도우
    
    # SLI (Service Level Indicator) 정의
    sli:
      good_requests:
        # TTUA <= 30s이고, 최종 결과가 정확하면 "good"
        query: |
          sum(rate(agent_requests_total{
            agent="customer-ticket-agent",
            ttua_bucket="<=30s",
            result="accurate"
          }[5m]))
      
      total_requests:
        query: |
          sum(rate(agent_requests_total{
            agent="customer-ticket-agent"
          }[5m]))
    
    # SLO 계산: (good / total) >= 0.95
    target: 0.95
    error_budget_policy:
      burn_rate_threshold: 1.5  # 1시간内有 target의 1.5배 오류 발생 시 alert
      recovery_threshold: 0.5   # 1시간内有 target의 0.5배 이하로回落 시 recovery
```

---

## 3. Execution Journal: 에이전트의 черный盒子

전통적 시스템의 черный盒子는 로그다. AI 에이전트의 черный盒子는 **Execution Journal**이다.

```python
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
import json

@dataclass
class ExecutionStep:
    step_id: str
    timestamp: datetime
    reasoning: str              # 에이전트의 사고 과정
    action: str                # 취한 행동
    tool_used: Optional[str]   # 사용한 도구
    observation: str            # 환경으로부터의 관찰
    confidence: float           # 0-1, 에이전트의 자기 신뢰도
    correction: Optional[str] = None  # 자기 반성(Reflection Pattern) 결과

@dataclass
class ExecutionJournal:
    session_id: str
    user_goal: str
    started_at: datetime
    completed_at: Optional[datetime]
    steps: list[ExecutionStep] = field(default_factory=list)
    
    # 메타데이터
    total_reasoning_tokens: int = 0
    total_tool_calls: int = 0
    final_outcome: str = "unknown"
    
    def to_trace(self) -> dict:
        """분산 트레이싱 포맷으로 변환 (Jaeger/Zipkin 연동)"""
        return {
            "session_id": self.session_id,
            "user_goal": self.user_goal,
            "trace_id": self.session_id,
            "span_count": len(self.steps),
            "spans": [
                {
                    "name": step.action,
                    "start_time": step.timestamp.isoformat(),
                    "duration_ms": 0,  # 계산 필요
                    "tags": {
                        "reasoning": step.reasoning[:200],  # 토큰 절약
                        "tool": step.tool_used or "llm_only",
                        "confidence": step.confidence,
                        "corrected": step.correction is not None
                    }
                }
                for step in self.steps
            ],
            "final_outcome": self.final_outcome
        }
```

---

## 4. SLO 에 따른 에이전트 개선 사이클

```python
class AgentImprovementCycle:
    """
    SLO 위반 시 자동 트리거되는 개선 사이클.
   传统的 OODA (Observe-Orient-Decide-Act) 루프를 Agentic AI에 적용.
    """
    
    def __init__(self, slo_config: AgentExecutionSLO):
        self.slo = slo_config
        self.journal_store: list[ExecutionJournal] = []
    
    def evaluate_slo(self, recent_journals: list[ExecutionJournal]) -> dict:
        """SLI 계산 + SLO 준수 여부 판단"""
        
        total = len(recent_journals)
        good = sum(1 for j in recent_journals 
                   if j.final_outcome == "success" 
                   and self._calculate_ttua(j) <= self.slo.ttua_target)
        
        slo_compliance = good / total if total > 0 else 0
        
        return {
            "compliance_rate": slo_compliance,
            "target": self.slo.target,
            "error_budget_remaining": self.slo.target - slo_compliance,
            "status": "healthy" if slo_compliance >= self.slo.target else "violated",
            "failed_journals": [j for j in recent_journals if j.final_outcome != "success"]
        }
    
    def _calculate_ttua(self, journal: ExecutionJournal) -> float:
        """TTUA 계산: 시작~완료 시간"""
        if journal.completed_at is None:
            return float('inf')
        return (journal.completed_at - journal.started_at).total_seconds()
    
    def diagnose_failure(self, failed_journal: ExecutionJournal) -> dict:
        """SLO 위반 journal 분석 → root cause 추출"""
        
        correction_steps = [s for s in failed_journal.steps if s.correction]
        
        root_causes = {
            "tool_selection_error": 0,
            "reasoning_depth_insufficient": 0,
            "observation_misinterpreted": 0,
            "tool_execution_failed": 0,
            "unknown": 0
        }
        
        for step in correction_steps:
            if "wrong tool" in step.correction.lower():
                root_causes["tool_selection_error"] += 1
            elif "more reasoning" in step.correction.lower():
                root_causes["reasoning_depth_insufficient"] += 1
            elif "observation unclear" in step.correction.lower():
                root_causes["observation_misinterpreted"] += 1
            elif "tool failed" in step.correction.lower():
                root_causes["tool_execution_failed"] += 1
            else:
                root_causes["unknown"] += 1
        
        primary_cause = max(root_causes, key=root_causes.get)
        
        return {
            "primary_cause": primary_cause,
            "cause_distribution": root_causes,
            "affected_steps": len(correction_steps),
            "recommendation": self._get_recommendation(primary_cause)
        }
    
    def _get_recommendation(self, cause: str) -> str:
        recommendations = {
            "tool_selection_error": "Tool selection prompt 개선 또는 tool description 정제 필요. few-shot examples 추가 권장.",
            "reasoning_depth_insufficient": "Max reasoning steps 증가 또는 chain-of-thought prompting 강화.",
            "observation_misinterpreted": "Observation parsing 로직 개선 + structured output 강제.",
            "tool_execution_failed": "Tool retry logic + fallback strategy 구현 필요."
        }
        return recommendations.get(cause, "추가 분석 필요")
```

---

## 5. 실제 적용: Multi-Agent 환경에서의 SLO 설계

Production 환경에서는 단일 에이전트가 아니라 **여러 에이전트가 협업**하는 경우가 많다. 이때 SLO 설계는 계층적으로 달라진다.

### 5.1 Hierarchical Agent SLO

```
┌─────────────────────────────────────────────┐
│          Orchestrator Agent SLO             │
│  TTUA_target: 120s | Compliance: 95%        │
│                                             │
│  ├──── Planning Agent SLO                   │
│  │    TTUA_target: 5s | Compliance: 98%     │
│  │                                          │
│  ├──── Execution Agent SLO                   │
│  │    TTUA_target: 30s | Compliance: 95%    │
│  │                                          │
│  └──── Review Agent SLO                      │
│       TTUA_target: 15s | Compliance: 97%    │
└─────────────────────────────────────────────┘
```

하위 에이전트의 SLO 위반은 상위 에이전트의 TTUA에直接影响된다. 따라서 **Error Budget을 계층별로 배분**하고, 상위 수준에서는 하위 수준의 오류를 **감내(graceful degradation)**하는 설계가 필요하다.

```python
class HierarchicalAgentSLO:
    def __init__(self):
        self.orchestrator = AgentSLOConfig(
            name="orchestrator",
            ttua_target=120,
            target=0.95
        )
        self.planner = AgentSLOConfig(
            name="planner",
            ttua_target=5,
            target=0.98
        )
        self.executor = AgentSLOConfig(
            name="executor",
            ttua_target=30,
            target=0.95
        )
        self.reviewer = AgentSLOConfig(
            name="reviewer",
            ttua_target=15,
            target=0.97
        )
    
    def calculate_end_to_end_slo(self) -> float:
        """최종 사용자 관점의 E2E SLO 계산.
        
        전체 성공 조건:
        1. Orchestrator의 planning 성공
        2. Planner → Executor → Reviewer의 체이닝 성공
        3. 최종 결과가 accuracy threshold 충족
        
        E2E success = P(orch_success) * P(plan_success) * 
                      P(exec_success) * P(review_success)
        """
        
        # 각 에이전트의 현재 compliance rate를 가정
        orch_rate = 0.97
        plan_rate = 0.99
        exec_rate = 0.96
        review_rate = 0.98
        
        e2e_success_rate = orch_rate * plan_rate * exec_rate * review_rate
        
        return e2e_success_rate  # ≈ 0.904 (90.4%)
    
    def get_error_budget(self, window_hours: int = 24) -> dict:
        """Error Budget 계산 (SRE 방식)"""
        e2e_rate = self.calculate_end_to_end_slo()
        target = self.orchestrator.target  # 0.95
        
        total_requests = 10000 * window_hours  # 시간당 10000 요청 가정
        allowed_errors = total_requests * (1 - target)
        actual_errors = total_requests * (1 - e2e_rate)
        
        return {
            "error_budget_total": allowed_errors,
            "error_budget_consumed": actual_errors,
            "consumed_percentage": (actual_errors / allowed_errors) * 100,
            "status": "healthy" if e2e_rate >= target else "burning"
        }
```

---

## 6. 결론: SLO는 Agentic AI의 성장 발판이다

AI 에이전트를 production에 배포할 때, **"정확한가?"**만 묻는 것은 insufficient하다. **"얼마나 빠르게 정확한 결과에 도달하는가?"**, **"어떤 종류의 실패가 발생하는가?"**, **"실패 시 recovery는 어떻게 되는가?"**가问了야 한다.

SLO를 설계하면 세 가지好处가 있다:

1. **실패의 언어화**: "AI가 잘못했다"가 아니라 "TTUA가 SLO를 위반했다"로 표현 가능
2. **반복적 개선 가능**: SLO 위반 패턴에서 root cause를 추출하여 구체적으로 개선
3. **조직적 합의 형성**: 비즈니스 팀과 엔지니어링 팀이 "95% 정확도, TTUA 30초"라는共同 목표를 가질 수 있음

Agentic AI의 시대, **신뢰성은 설계 가능하고 측정 가능해야 한다.** SLO 프레임워크는 그第一步이다.

---

## References

- [Google Cloud - Agents Architecture](https://cloud.google.com/architecture/agents)
- [Site Reliability Engineering - SLO Documentation](https://sre.google/sre-book/part-II/)
- [OpenTelemetry - Agent Trace Specification](https://opentelemetry.io/docs/concepts/signals/traces/)