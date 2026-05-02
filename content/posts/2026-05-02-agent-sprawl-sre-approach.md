---
title: "Agent Sprawl: AI 에이전트 인프라의 미кро서비스 독Canonical 문제와 SRE적 접근"
description: "AI 에이전트 생태계가 빠르게 확장하는 가운데, 에이전트 인프라 복잡성이 신뢰성을 능가하는 'Agent Sprawl'이 새로운 운영 과제로 떠오르고 있습니다. 2026년 현재 micorservices sprawl을 겪었던 SRE 팀이 어떻게 이 문제에 접근하는지, 그리고 Agent-specific SLO/SLI를 어떻게 설계하는지深人 분석합니다."
date: "2026-05-02"
tags: ["Agent-Sprawl", "SRE", "AI-Agent", "SLO", "Production-Reliability", "Infrastructure", "AIOps"]
---

## 들어가며

2026년, AI 에이전트 기반 시스템의 운영 복잡성이 놀라운 속도로 증가하고 있습니다.

一个新概念이 빠르게 확산되고 있습니다: **Agent Sprawl** — 에이전트 인프라 복잡성(프레임워크, 모델, 도구 레이어, 오케스트레이션 패턴)이 신뢰성을 측정하고 관리하는能力을 능가하는 상태[[1]](https://dev.to/ajaydevineni/agent-sprawl-is-your-next-production-incident-an-sre-response-to-datadogs-state-of-ai-engineering-3k83).

이 상태는 구조적으로 2015~2020년 사이 SRE 팀이 겪었던 **microservices sprawl**과 동일합니다. 팀들은 서비스를 SLO보다 빠르게 추가했고, 결국 운영 비용이 폭발했습니다.

이 글에서는:
1. Agent Sprawl이 발생하는 구조적 원인을 분석
2. 에이전트-specific SLI/SLO 프레임워크를 설계
3. 실제 적용 가능한 비용 절감 전략을 제시합니다

---

## 1. Agent Sprawl의 anatomy

### 1.1 microservices sprawl과의 비교

```
microservices sprawl (2015-2020)          Agent Sprawl (2025-2026)
─────────────────────────────────────────────────────────────────────
서비스 추가 속도 > SLO 정의 속도            에이전트 추가 속도 > 신뢰성 측정 속도
추적되지 않는 서비스 의존성                   추적되지 않는 에이전트 간 통신
 falloCHAOS 문서화되지 않은 장애              에이전트 결정 경로 추적 불가
 팀당 서비스 수 증가 → 운영 비용 증가         에이전트 수 증가 → 비용/지연 증가
```

핵심 similarity: **복잡성의 성장 속도가 운영 역량의 성장 속도를 앞서간다.**

### 1.2 2026년 현재 상태

Datadog의 "State of AI Engineering 2026"[[2]](https://www.datadoghq.com/state-of-ai/)에 따르면:
- 기업당 평균 에이전트 배포 수가 2024년 12개에서 2026년 현재 **47개**로 증가
- 하지만 SLO가 정의된 에이전트는 **8%** 미만
- 에이전트 관련 인시던트가 전체 AI 인시던트의 **62%**를 차지

이는 microservices 초기 단계와 매우 유사합니다.

---

## 2. 에이전트-specific SLI 설계

### 2.1 기존 SRE 개념의 확장

전통적인 SLI는 다음과 같습니다:
- **Availability**: 시스템이 요청을 처리할 수 있는 시간 비율
- **Latency**: 요청에 대한 응답 시간
- **Throughput**: 단위 시간당 처리량

에이전트 시스템에서는这些 개념이 달라집니다. Komodor의 AI SRE Summit 2026[[3]](https://komodor.com/ai-sre-summit-2026/)에서 제시된 5가지 에이전트-specific SLI를深人 분석합니다.

### 2.2 5가지 핵심 SLI

#### SLI-1: Calibration Error (교정 오차)

**정의**: 에이전트가 제시한 신뢰도와 실제 정확도 간의 차이

```
Calibration Error = |Stated Confidence - Actual Accuracy|

예시:
- 에이전트가 "이 답변의 정확도는 95%"라고 주장
- 실제 검증 결과 87% 정확 → Calibration Error = 8%
```

**측정 방법**:
```python
def calculate_calibration_error(agent_id: str, samples: list[dict]) -> float:
    """
    각 샘플에서 stated_confidence와 actual_outcome을 비교
    """
    errors = []
    for sample in samples:
        stated = sample["stated_confidence"]  # 0.0 ~ 1.0
        actual = sample["actual_accuracy"]    # 0.0 ~ 1.0
        
        # calibration error는 절대값
        error = abs(stated - actual)
        errors.append(error)
    
    # 평균 calibration error 반환
    return sum(errors) / len(errors)

# 기준선 예시
# CE < 0.05: Excellent (90% 이상 정답률)
# CE < 0.10: Good
# CE < 0.15: Acceptable
# CE >= 0.15: Needs calibration training
```

#### SLI-2: Evidence Completeness (증거 완전성)

**정의**: 에이전트의 판단 근거가 충분한 정보를 포함하고 있는지

```
Evidence Completeness = 도구 호출로 확보한 맥락 / 최적 맥락

예시:
- 최적 맥락: 사용자 히스토리 10개 + 실시간 DB + 외부 API
- 실제 확보: 사용자 히스토리 3개만 → Evidence Completeness = 30%
```

**측정 방법**:
```python
def measure_evidence_completeness(task: dict, context: dict) -> float:
    """
    필수 정보 목록과 실제 확보 정보를 비교
    """
    required_contexts = task["required_contexts"]  # ["user_history", "db", "api"]
    available_contexts = context.keys()            # ["user_history"]
    
    # 집합 비교
    coverage = len(available_contexts & set(required_contexts))
    total = len(required_contexts)
    
    return coverage / total if total > 0 else 0.0
```

#### SLI-3: Data Currency (데이터 신선도)

**정의**: 에이전트가 사용하는 데이터가 현재 시점에서 얼마나 최신인지

```
Data Currency = min(마지막 업데이트 경과 시간 / 최대 허용 경과 시간)

예시:
- 실시간 가격 정보: 최대 5분 전까지 허용
- 사용자 프로필: 최대 24시간 전까지 허용
- 규제 정보: 최대 1시간 전까지 허용
```

**측정 방법**:
```python
from datetime import datetime, timedelta

class DataCurrencyMonitor:
    def __init__(self, thresholds: dict[str, timedelta]):
        # thresholds: {"price_data": timedelta(minutes=5), ...}
        self.thresholds = thresholds
    
    def check_currency(self, data_source: str, last_updated: datetime) -> float:
        """
        0.0 ~ 1.0 반환
        1.0 = 최상 (최대 허용 시간 이내)
        0.0 = 최악 (시간 초과)
        """
        max_age = self.thresholds.get(data_source, timedelta(hours=24))
        age = datetime.now() - last_updated
        
        if age <= max_age:
            # 비율 계산 (여유 시간 대비 사용 가능 비율)
            return 1.0 - (age / max_age) * 0.5
        else:
            # 시간 초과 시 점진적 페널티
            overage = age - max_age
            penalty = min(overage / max_age, 1.0)
            return max(0.0, 1.0 - penalty - 0.5)
```

#### SLI-4: Contradiction Rate (모순율)

**정의**: 동일 질문에 대한 연속 응답 간 모순 발생 비율

```
Contradiction Rate = 모순이 발생한 연속 응답 쌍 / 전체 연속 응답 쌍
```

**왜 중요한가**:
- 동일한 질문에 다른 답변 → 사용자 신뢰도 하락
- 내부 로직 불일치 → 디버깅 복잡성 증가
- 규정 준수 문제 (audit trail에서 모순 발견)

**측정 방법**:
```python
def detect_contradiction(response_a: dict, response_b: dict, task_type: str) -> bool:
    """
    두 연속 응답 간 모순 检测
    """
    if task_type == "factual_qa":
        # 사실 기반 질문: 핵심 답변이 상반되는지 확인
        answer_a = extract_key_fact(response_a["answer"])
        answer_b = extract_key_fact(response_b["answer"])
        return is_contradictory(answer_a, answer_b)
    
    elif task_type == "process_execution":
        # 프로세스 실행: 단계 순서/파라미터 불일치
        steps_a = response_a["execution_plan"]["steps"]
        steps_b = response_b["execution_plan"]["steps"]
        return steps_a != steps_b
    
    else:
        # 기본: 같을 것으로 예상
        return response_a["answer"] != response_b["answer"]
```

#### SLI-5: Decision Tier Distribution (결정 계층 분포)

**정의**: 에이전트의 결정이 자동 실행 / 검토 요청 / 에스컬레이션 중 어디에 해당하는지

```
Tier 0: 자동 실행 (즉시 처리)
Tier 1: 자동 실행 + 로깅 (후처리 검토)
Tier 2: 인간 검토 필요 (승인 대기)
Tier 3: 에스컬레이션 (전문가 참여)
```

**측정 방법**:
```python
def analyze_decision_tier_distribution(agent_id: str, period: str) -> dict:
    """
    각 tier에 속하는 결정 수를 카운트
    """
    decisions = query_decision_log(agent_id, period)
    
    tier_counts = {0: 0, 1: 0, 2: 0, 3: 0}
    
    for decision in decisions:
        tier = classify_decision_tier(decision)
        tier_counts[tier] += 1
    
    total = sum(tier_counts.values())
    
    return {
        tier: {
            "count": count,
            "percentage": count / total if total > 0 else 0
        }
        for tier, count in tier_counts.items()
    }

# 기준선 예시
# Tier 0-1이 80% 이상: 자동화 잘 되고 있음
# Tier 2-3이 30% 이상: 검토/에스컬레이션 병목 확인 필요
```

---

## 3. SLO 설계 프레임워크

### 3.1 목표 지향적 SLO 설정

```yaml
# 예시: 고객 서비스 에이전트의 SLO

service_level_objectives:
  calibration_error:
    target: "< 0.08"
    window: "30d"
    alert_threshold: ">= 0.12"
    
  evidence_completeness:
    target: ">= 0.85"
    window: "7d"
    alert_threshold: "< 0.75"
    
  data_currency:
    target: ">= 0.90"
    window: "1d"
    alert_threshold: "< 0.80"
    
  contradiction_rate:
    target: "< 0.02"
    window: "14d"
    alert_threshold: ">= 0.05"
    
  decision_tier_distribution:
    target: "Tier 0-1 >= 0.75"
    window: "7d"
    alert_threshold: "Tier 2-3 >= 0.35"
```

### 3.2 Error Budget 정책

```python
class AgentErrorBudget:
    """
    SLO 위반을 위한 error budget 관리
    """
    
    def __init__(self, slo: dict, burn_rate_threshold: float = 1.5):
        self.slo = slo
        self.burn_rate_threshold = burn_rate_threshold
        self.consumed_budget = {k: 0.0 for k in slo.keys()}
    
    def consume(self, sli_name: str, error_percentage: float):
        """
        error budget 소모 기록
        """
        if sli_name not in self.consumed_budget:
            return
        
        # 1%를 소비하면 1% budget 사용
        self.consumed_budget[sli_name] += error_percentage
    
    def check_burn_rate(self, sli_name: str, window_hours: int) -> float:
        """
        현재 소진 속도 계산
        """
        budget = self.slo[sli_name]
        consumed = self.consumed_budget[sli_name]
        
        # 시간 대비 소진율
        burn_rate = consumed / (window_hours / 24)
        
        return burn_rate
    
    def should_alert(self, sli_name: str, window_hours: int) -> bool:
        """
        alerting 필요 여부 판단
        """
        burn_rate = self.check_burn_rate(sli_name, window_hours)
        return burn_rate >= self.burn_rate_threshold
```

---

## 4. Agent Sprawl 관리 전략

### 4.1 감축 원칙: 불필요한 에이전트 제거

microservices에서 했던 것처럼[[4]](https://www.infoq.com/news/2025/10/ai-agent-orchestration-patterns/), 에이전트 भी 정기적으로 검토해야 합니다.

```python
class AgentPortfolioReview:
    """
    에이전트 포트폴리오 정기 검토
    """
    
    def evaluate_agent(self, agent_id: str) -> dict:
        """
        에이전트의 기여도/비용 분석
        """
        metrics = self.collect_metrics(agent_id)
        
        return {
            "utilization": metrics.task_count / metrics.capacity,
            "cost_per_task": metrics.total_cost / metrics.task_count,
            "reliability_score": metrics.overall_slo_compliance,
            "strategic_value": self.assess_strategic_value(agent_id)
        }
    
    def should_retain(self, evaluation: dict) -> bool:
        """
        에이전트 유지 여부 판단
        """
        # 기준: 활용도 20% 이상, 신뢰도 0.8 이상, 전략적 가치 있음
        return (
            evaluation["utilization"] >= 0.20 and
            evaluation["reliability_score"] >= 0.80 and
            evaluation["strategic_value"] >= 2
        )
```

### 4.2 통신 복잡성 관리: A2A 계약 최소화

A2A 통신[[5]](https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/)이 증가하면 추적 복잡성이指数적으로 증가합니다.

**原则**:
1. **계약 계약은 명시적으로 문서화** — capability 스키마 버저닝
2. **비동기 우선** — 동기 호출은 비용이 높음
3. **장애 격리** — 에이전트 단위의 circuit breaker

```python
class AgentCircuitBreaker:
    """
    에이전트 간 통신의 circuit breaker
    """
    
    def __init__(self, failure_threshold: int = 5, timeout_seconds: int = 60):
        self.failure_threshold = failure_threshold
        self.timeout = timeout_seconds
        self.failures = {}
        self.states = {}
    
    def call(self, agent_id: str, func: callable) -> Any:
        """
        에이전트 호출前的 circuit check
        """
        if self.is_open(agent_id):
            raise CircuitOpenException(f"Agent {agent_id} circuit is open")
        
        try:
            result = func()
            self.record_success(agent_id)
            return result
        except Exception as e:
            self.record_failure(agent_id)
            
            if self.failures[agent_id] >= self.failure_threshold:
                self.open_circuit(agent_id)
            
            raise
```

---

## 5. 비용 최적화: Tiered Agent Model

### 5.1 비용/신뢰도 trade-off

acecloud.ai의 2026 트렌드 분석[[6]](https://acecloud.ai/blog/agentic-ai-trends/)에 따르면:
- **Task Success Rate**와 **Cost per Successful Outcome**이 핵심 지표
- 소형 모델(SLM)로 처리 가능한 작업에 대형 모델(LLM)을 사용하면 비용만 낭비

### 5.2 Tiered 실행 패턴

```python
from enum import Enum
from dataclasses import dataclass

class TaskComplexity(Enum):
    TRIVIAL = 1   # 단순 조희, 정형 응답
    STANDARD = 2  # 일반적인 워크플로우
    COMPLEX = 3   # 멀티 스텝推理, 불확실성 높음
    CRITICAL = 4 # 법적/재무적 영향

@dataclass
class AgentConfig:
    model: str
    max_retries: int
    timeout_seconds: int
    escalation_threshold: float

AGENT_TIERS = {
    TaskComplexity.TRIVIAL: AgentConfig(
        model="gpt-4o-mini", max_retries=1, timeout_seconds=5, escalation_threshold=0.5
    ),
    TaskComplexity.STANDARD: AgentConfig(
        model="gpt-4o", max_retries=2, timeout_seconds=30, escalation_threshold=0.7
    ),
    TaskComplexity.COMPLEX: AgentConfig(
        model="claude-sonnet-4", max_retries=3, timeout_seconds=120, escalation_threshold=0.85
    ),
    TaskComplexity.CRITICAL: AgentConfig(
        model="claude-opus-4", max_retries=5, timeout_seconds=300, escalation_threshold=0.95
    ),
}

def route_task(task: dict) -> AgentConfig:
    """
    작업 복잡도에 따라 에이전트 티어 선택
    """
    complexity = assess_complexity(task)
    return AGENT_TIERS[complexity]
```

---

## 6. 결론: Sprawl을 방지하려면

Agent Sprawl은 아직 초기 단계입니다. 지금 적절한 관심을 기울이면 microservices에서 했던 실수를 반복하지 않을 수 있습니다.

**핵심 행동 요약**:

1. **측정 없는 배포 금지**: 에이전트 추가 시 반드시 SLI/SLO를 함께 정의
2. **정기적 포트폴리오 검토**: 분기별 에이전트 감사 실시
3. **Tiered 모델 도입**: 작업 복잡도에 따라 적절한 리소스 배분
4. **Circuit Breaker 필수**: 에이전트 간 통신의 장애 격리
5. **A2A 계약 문서화**: 명시적 버전 관리로 통신 복잡성 관리

SRE 원칙은 특정 기술에 종속되지 않습니다. 신뢰성 확보를 위한 기본 원칙은 에이전트 시대에도 변하지 않습니다.

---

## references

[[1] Agent Sprawl is Your Next Production Incident - DEV Community](https://dev.to/ajaydevineni/agent-sprawl-is-your-next-production-incident-an-sre-response-to-datadogs-state-of-ai-engineering-3k83)
[[2] Datadog State of AI Engineering 2026](https://www.datadoghq.com/state-of-ai/)
[[3] AI SRE Summit 2026 - Komodor](https://komodor.com/ai-sre-summit-2026/)
[[4] AI Agent Orchestration Patterns - InfoQ](https://www.infoq.com/news/2025/10/ai-agent-orchestration-patterns/)
[[5] A2A: A New Era of Agent Interoperability - Google Developers Blog](https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/)
[[6] Agentic AI Trends 2026: From Pilots To Production - AceCloud](https://acecloud.ai/blog/agentic-ai-trends/)