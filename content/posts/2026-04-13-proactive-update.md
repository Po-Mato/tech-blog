---
title: "AI Agent Production Reliability — SLO 설계와 Failure Recovery 패턴 (2026년 4월)"
date: 2026-04-13
description: "프레임워크 선택을 넘어, AI Agent를 프로덕션에서 안정적으로 운영하는 데 필요한 핵심 과제. Agent SLO 정의, 실패 복구 메커니즘, 실행 신뢰성을 높이기 위한 아키텍처적 선택지를 실제 코드와 함께 다룬다."
tags:
  - AI Agents
  - Agent SLO
  - Production AI
  - Reliability Engineering
  - MCP
  - Failure Recovery
  - System Design
  - Observability
---

## 서론: 프레임워크 뒤의 진짜 문제

이전 글(Multi-Agent 프레임워크 비교)에서 우리는 LangGraph, Claude SDK, CrewAI, AutoGen의 설계 철학과 트레이드오프를 살펴봤다. 그 글의 결론 중 하나는 "프레임워크 선택은 아키텍처 결정이 아니다"라는 것이었다.

2026년 4월 현재, 기업들은 이미 그 결론을 체감하고 있다. Belitsoft의 2026년 리포트에 따르면, 기업들은 평균 12개의 AI Agent를 운영하지만 절반은 여전히 단독으로运作하며 서로 연결되지 않는다. 즉, 프레임워크를 선택하는 것은 시작일 뿐이고, 그 뒤에 오는 진짜 과제는 ** Reliability(신뢰성)** — Agent가 약속한 작업을 약속된 품질로, 약속된 시간 안에 완수하는가다.

이 글은 Agent Reliability를 위한 3가지 핵심 영역 — **SLO 설계, Failure Recovery, Observability** — 을 다룬다.

---

## 1. Agent SLO: 무엇을 측정해야 하는가

### 전통적인 SLO와 Agent SLO의 차이

전통적 소프트웨어의 SLO는 **가용성(uptime), 레이턴시, 에러율**이라는 측정 가능한 지표로 구성된다. 99.9% uptime이면 1년에 약 8시간 45분의 다운타임을 허용하는 것이다.

Agent SLO는 그보다 복잡하다. "Task Success Rate"라는 단순 지표가 있지만, 실제로는 다음과 같은 레이어가 존재한다:

```
Agent Task Outcome 계층:
├── Task Completion (태스크가 끝났는가)
│   ├── Completed (성공적 완료)
│   ├── Partially Completed (부분 완료 — 어떤 subtask만 성공)
│   └── Failed (실패)
├── Output Quality (산출물의 품질)
│   ├── Correct (정답)
│   ├── Partially Correct (대부분 정답이나 일부 오류)
│   └── Hallucinated (허상 응답 — 근거 없이 생성된 내용)
└── Time-to-Useful-Action (유용한 응답까지 걸린 시간)
    ├── Immediate (< 5초)
    ├── Acceptable (5~30초)
    └── Unacceptable (> 30초, 또는 응답 없음)
```

### 핵심 Agent SLO 지표 설계

```python
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from typing import Optional

class TaskStatus(Enum):
    COMPLETED = "completed"
    PARTIALLY_COMPLETED = "partially_completed"
    FAILED = "failed"
    TIMEOUT = "timeout"
    HALLUCINATED = "hallucinated"

@dataclass
class TaskMetrics:
    task_id: str
    agent_id: str
    started_at: datetime
    completed_at: Optional[datetime] = None
    status: TaskStatus = TaskStatus.FAILED
    token_used: int = 0
    cost_usd: float = 0.0
    retry_count: int = 0
    quality_score: float = 0.0  # 0.0 ~ 1.0

    @property
    def duration_seconds(self) -> float:
        if self.completed_at:
            return (self.completed_at - self.started_at).total_seconds()
        return 0.0

    @property
    def success(self) -> bool:
        return self.status in (TaskStatus.COMPLETED, TaskStatus.PARTIALLY_COMPLETED)

@dataclass
class AgentSLO:
    """Agent SLO 목표치 정의"""
    task_success_rate: float = 0.95       # 95% 이상 완료
    quality_threshold: float = 0.8         # quality_score 0.8 이상
    max_duration_seconds: float = 60.0    # 60초 초과 시 timeout
    hallucination_rate: float = 0.02      # 허상 응답 2% 이하
    p99_latency_seconds: float = 30.0     # P99 레이턴시 30초 이하

@dataclass
class AgentSLOReport:
    """SLO 측정 결과를 집계하는 보고서"""
    window: timedelta
    tasks: list[TaskMetrics] = field(default_factory=list)

    def compute(self) -> dict:
        total = len(self.tasks)
        if total == 0:
            return {"error": "No tasks in window"}

        completed = [t for t in self.tasks if t.success]
        good_quality = [t for t in self.tasks if t.quality_score >= 0.8]
        hallucinated = [t for t in self.tasks if t.status == TaskStatus.HALLUCINATED]

        durations = sorted([t.duration_seconds for t in self.tasks if t.completed_at])
        p99_latency = durations[int(len(durations) * 0.99)] if durations else 0.0

        return {
            "total_tasks": total,
            "task_success_rate": len(completed) / total,
            "quality_score_avg": sum(t.quality_score for t in self.tasks) / total,
            "hallucination_rate": len(hallucinated) / total,
            "p99_latency_seconds": p99_latency,
            "total_cost_usd": sum(t.cost_usd for t in self.tasks),
            "total_tokens": sum(t.token_used for t in self.tasks),
            "slo_met": {
                "task_success_rate": len(completed) / total >= 0.95,
                "p99_latency": p99_latency <= 30.0,
                "hallucination_rate": len(hallucinated) / total <= 0.02,
            }
        }
```

### SLO 측정 결과를 기반으로 한 Alert 설계

SLO를 정의만 하고 감시하지 않으면 의미가 없다. 핵심 Alert 조건:

```python
SLO_ALERT_RULES = {
    "task_success_rate_drop": {
        "condition": "task_success_rate < 0.90 for 15 min",
        "severity": "warning",
        "action": "Check if model degraded or upstream API changed"
    },
    "hallucination_spike": {
        "condition": "hallucination_rate > 0.05 for 5 min",
        "severity": "critical",
        "action": "Immediately fallback to human review for affected tasks"
    },
    "cost_anomaly": {
        "condition": "cost_usd > 3 * rolling_avg for 10 min",
        "severity": "warning",
        "action": "Check for infinite loops or token inflation attacks"
    },
    "p99_latency_breach": {
        "condition": "p99_latency > 60.0 for 5 min",
        "severity": "warning",
        "action": "Scale up model capacity or add caching layer"
    }
}
```

---

## 2. Failure Recovery: 실패를 디자인에 넣는 기술

### 실패 유형 분류와 대응 전략

Agent 실패는 크게 4가지 유형으로 나뉜다. 각 유형마다 설계해야 할 복구 전략이 다르다:

```
Failure Type 분류:
├── Transient Failure (일시적 실패)
│   ├── 원인: 네트워크 끊김, Rate Limit, 일시적 API 장애
│   ├── 전략: Exponential Backoff + Retry
│   └── 주의: Max retry 횟수 설정으로 무한 재시도 방지
│
├── Model Failure (모델 실패)
│   ├── 원인: 모델 응답 오류, 품질 저하,幻觉 内容 생성
│   ├── 전략: 1) 검증 로직으로 hallucination 감지 → 2) fallback model로 전환
│   └── 주의: Hallucination은 재시도로 해결되지 않음 → human-in-the-loop 필요
│
├── Tool Failure (도구/플러그인 실패)
│   ├── 원인: MCP 서버 응답 없음, API 스펙 변경, 타임아웃
│   ├── 전략: 1) Tool timeout 설정 → 2) 대체 도구로 fallback → 3) graceful degradation
│   └── 주의: 도구 실패는 Task 전체를 실패시키지 않아야 함
│
└── Orchestration Failure (오케스트레이션 실패)
    ├── 원인: Agent 간 상태 불일치, 체크포인팅 오류, 데드락
    ├── 전략: 1) idempotent task design → 2) saga pattern for multi-agent → 3) compensation logic
    └── 주의: 단일 Agent 실패가 전체 시스템을 못 보내면 안 됨
```

### Retry + Fallback 패턴 실제 구현

```python
import asyncio
from typing import TypeVar, Callable, Any
from dataclasses import dataclass
import random

T = TypeVar("T")

@dataclass
class RetryConfig:
    max_attempts: int = 3
    base_delay_seconds: float = 1.0
    max_delay_seconds: float = 30.0
    exponential_base: float = 2.0
    jitter: bool = True  # Thundering herd 방지

@dataclass
class AttemptResult:
    success: bool
    value: Any = None
    error: Exception | None = None
    attempt_number: int = 0
    total_latency_ms: float = 0.0

async def with_retry_and_fallback(
    task_name: str,
    primary_fn: Callable[..., Any],
    fallback_fn: Callable[..., Any] | None = None,
    validation_fn: Callable[[Any], bool] | None = None,
    config: RetryConfig = RetryConfig(),
) -> AttemptResult:
    """
    Retry + Fallback + Validation을 통합한 실패 복구 패턴.

    - 일시적 실패: Exponential backoff로 재시도
    - 지속 실패: Fallback으로 대체
    - Hallucination/품질 저하: Validation으로 감지 후 fallback
    """
    last_error = None

    for attempt in range(1, config.max_attempts + 1):
        start_time = asyncio.get_event_loop().time()
        delay = min(
            config.base_delay_seconds * (config.exponential_base ** (attempt - 1)),
            config.max_delay_seconds,
        )
        if config.jitter:
            delay *= (0.5 + random.random())  # 50%~100% jitter

        try:
            if attempt > 1:
                await asyncio.sleep(delay)

            result = await primary_fn()
            latency_ms = (asyncio.get_event_loop().time() - start_time) * 1000

            # Hallucination 감지 (validation function 사용)
            if validation_fn and not validation_fn(result):
                raise ValueError(f"Validation failed for task: {task_name}")

            return AttemptResult(
                success=True,
                value=result,
                attempt_number=attempt,
                total_latency_ms=latency_ms,
            )

        except Exception as e:
            last_error = e
            latency_ms = (asyncio.get_event_loop().time() - start_time) * 1000

            # 마지막 시도에서Fallback 시도
            if attempt == config.max_attempts and fallback_fn:
                try:
                    fallback_result = await fallback_fn()
                    return AttemptResult(
                        success=True,
                        value=fallback_result,
                        error=last_error,
                        attempt_number=attempt,
                        total_latency_ms=latency_ms,
                    )
                except Exception as fallback_error:
                    return AttemptResult(
                        success=False,
                        error=Exception(
                            f"Primary failed after {attempt} attempts: {last_error}. "
                            f"Fallback also failed: {fallback_error}"
                        ),
                        attempt_number=attempt,
                        total_latency_ms=latency_ms,
                    )

    return AttemptResult(
        success=False,
        error=last_error or Exception("Unknown error"),
        attempt_number=config.max_attempts,
    )


# 사용 예시
async def validate_agent_output(output: dict) -> bool:
    """Agent 출력의 품질/정확성을 검증하는 함수"""
    # Hallucination 체크: 응답이 사실 기반인지 검증
    if output.get("confidence", 1.0) < 0.7:
        return False
    if output.get("has_fabricated_citation", False):
        return False
    return True


async def main():
    result = await with_retry_and_fallback(
        task_name="research-agent",
        primary_fn=lambda: research_agent_query(),
        fallback_fn=lambda: simplified_search(),
        validation_fn=validate_agent_output,
        config=RetryConfig(max_attempts=3, base_delay_seconds=2.0),
    )

    if result.success:
        print(f"Task completed in {result.attempt_number} attempt(s)")
    else:
        print(f"All attempts failed: {result.error}")
        # Human-in-the-loop Escalation
        escalate_to_human_review()
```

### Idempotent Task Design: 재시도해도 문제 없는 설계

Multi-Agent 시스템에서 가장 위험한 실패는 "작업이 중복 실행되어 데이터가 오염되는 것"이다. 이를 방지하는 핵심 원칙은 **Idempotency(멱등성)** — 동일한 작업을 여러 번 실행해도 결과가 같은 것다.

```python
import hashlib
import json
from datetime import datetime

@dataclass
class TaskIdempotencyKey:
    """
    태스크의 멱등 키 생성.
    동일한 (agent_id, task_type, parameters_hash, date_bucket)이면
    같은 작업으로 간주하여 재실행 방지.
    """
    agent_id: str
    task_type: str
    parameters: dict
    date_bucket: str  # "2026-04-13" — 일 단위 버킷

    @staticmethod
    def from_task(agent_id: str, task_type: str, params: dict) -> "TaskIdempotencyKey":
        date_bucket = datetime.now().strftime("%Y-%m-%d")
        # 파라미터의 순서를 무시하기 위해 정렬 후 해시
        params_json = json.dumps(params, sort_keys=True)
        params_hash = hashlib.sha256(params_json.encode()).hexdigest()[:12]

        return TaskIdempotencyKey(
            agent_id=agent_id,
            task_type=task_type,
            parameters={"_hash": params_hash, **params},
            date_bucket=date_bucket,
        )

    def as_key(self) -> str:
        return f"{self.agent_id}:{self.task_type}:{self.parameters['_hash']}:{self.date_bucket}"


class IdempotentTaskStore:
    """
    이미 실행된 태스크를 추적하는 저장소.
    Redis나 DB를 backing store로 사용.
    """

    def __init__(self, redis_client):
        self.redis = redis_client
        self.key_prefix = "idempotency"
        self.ttl_seconds = 86400 * 7  # 7일 후 만료

    def is_already_running(self, key: TaskIdempotencyKey) -> bool:
        """다른 동일 태스크가 현재 실행 중인지 확인"""
        redis_key = f"{self.key_prefix}:running:{key.as_key()}"
        return self.redis.exists(redis_key) == 1

    def mark_running(self, key: TaskIdempotencyKey) -> bool:
        """실행 시작 표시 — 이미 있으면 False 반환"""
        redis_key = f"{self.key_prefix}:running:{key.as_key()}"
        return self.redis.set(redis_key, "1", nx=True, ex=300)  # 5분 타임아웃

    def mark_completed(self, key: TaskIdempotencyKey, result: dict):
        """완료 표시"""
        running_key = f"{self.key_prefix}:running:{key.as_key()}"
        result_key = f"{self.key_prefix}:result:{key.as_key()}"
        self.redis.delete(running_key)
        self.redis.set(result_key, json.dumps(result), ex=self.ttl_seconds)

    def get_result(self, key: TaskIdempotencyKey) -> dict | None:
        """이전 실행 결과를 반환 (재시도 대신 이전 결과 사용)"""
        result_key = f"{self.key_prefix}:result:{key.as_key()}"
        data = self.redis.get(result_key)
        return json.loads(data) if data else None


# 사용
async def run_idempotent_task(agent_id, task_type, params):
    key = TaskIdempotencyKey.from_task(agent_id, task_type, params)

    store = IdempotentTaskStore(redis_client)

    # 이미 완료된 태스크 → 결과 반환
    if existing_result := store.get_result(key):
        return {"source": "cache", "result": existing_result}

    # 현재 실행 중 → 중복 실행 방지
    if not store.mark_running(key):
        raise RuntimeError(f"Task already running: {key.as_key()}")

    try:
        result = await execute_task(agent_id, task_type, params)
        store.mark_completed(key, result)
        return {"source": "fresh", "result": result}
    except Exception as e:
        # 실패 시 running 표시 제거 (재시도 가능하도록)
        store.mark_failed(key)
        raise
```

---

## 3. Observability: Agent 실행을 '본다'는 것

### 왜 기존 APM은 부족한가

전통적 APM(Debugging/Tracing 도구)은 요청-응답 쌍을 추적한다. HTTP 200이면 성공, 500이면 실패. 명확하다.

Agent 시스템은 다르게 생겼다:

```
User Request
    ↓
Agent Planning (LLM call #1 — planning reasoning)
    ↓
Tool Calls (LLM call #2 — web_search, 3회 retry)
    ↓
Sub-Agent Coordination (LLM call #3 — task delegation)
    ↓
Result Aggregation (LLM call #4 — synthesis)
    ↓
User Response
```

LLM 호출이 4번이고, 각 호출마다 내부 reasoning이 있으며, 도구 호출에서 재시도가 발생한다. **하나의 "요청"이 내부적으로 10개 이상의 트레이스 이벤트**를 생성한다. 전통적 APM으로 이걸 보면是一片混沌다.

### 구조화된 Agent Trace 설계

```python
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter

# OpenTelemetry 기반 Agent Trace 수집
provider = TracerProvider()
processor = BatchSpanProcessor(OTLPSpanExporter(endpoint="http://otel-collector:4317"))
provider.add_span_processor(processor)
trace.set_tracer_provider(provider)

tracer = trace.get_tracer(__name__)

async def trace_agent_task(task_id: str, agent_id: str, task_fn):
    """Agent 작업을 OpenTelemetry trace로 캡처하는 래퍼"""
    with tracer.start_as_current_span(
        f"agent.{agent_id}.task",
        attributes={
            "task.id": task_id,
            "agent.id": agent_id,
        }
    ) as span:
        try:
            result = await task_fn()
            span.set_attribute("task.success", True)
            return result
        except Exception as e:
            span.record_exception(e)
            span.set_attribute("task.success", False)
            span.set_attribute("error.type", type(e).__name__)
            raise


# LangGraph와 통합하는 예시
from langgraph.prebuilt import ToolNode

class ObservableToolNode(ToolNode):
    """ToolNode에 OpenTelemetry 추적을 추가한 래퍼"""

    def __init__(self, tools: list, tracer_name: str = "langgraph"):
        super().__init__(tools)
        self.tracer = trace.get_tracer(tracer_name)

    async def invoke(self, input_data, config=None):
        tool_name = input_data.get("name", "unknown")
        with self.tracer.start_as_current_span(
            f"tool.{tool_name}",
            attributes={
                "tool.name": tool_name,
                "tool.input_tokens": input_data.get("_input_tokens", 0),
            }
        ) as tool_span:
            try:
                result = await super().invoke(input_data, config)
                tool_span.set_attribute("tool.success", True)
                return result
            except Exception as e:
                tool_span.record_exception(e)
                tool_span.set_attribute("tool.success", False)
                raise
```

### 핵심 모니터링 대시보드 지표

Production Agent 시스템에서는 다음 5가지 지표가 대시보드에 반드시 표시되어야 한다:

| 지표 | 측정 대상 | Alert Threshold |
|------|---------|----------------|
| **Task Success Rate** | 완료된 태스크 중 성공 비율 | < 90% → Warning, < 80% → Critical |
| **Time-to-First-Token** | 첫 응답까지 레이턴시 | P99 > 30s → Warning |
| **Token per Task** | 태스크당 평균 토큰 소비 | 이상 치(up 3σ) → Cost anomaly |
| **Tool Call Latency** | 각 도구 호출별 레이턴시 분포 | P99 > 10s → Tool bottleneck |
| **Hallucination Rate** | 검증 실패 비율 | > 2% → Quality degradation |

---

## 4. MCP와 실패 격리: 외부 의존성 관리

MCP(Model Context Protocol)는 Agent에게 외부 도구를 표준화된 방식으로 접근하게 하지만, 동시에 **외부 의존성으로 인한 실패 위험**도 가져온다. 2026년 4월 현재, MCP 서버 실패가 Agent 전체를 못 보내는 사례가 빈번하다.

```python
# MCP 서버 실패를 격리하는 Circuit Breaker 패턴

import asyncio
from enum import Enum

class CircuitState(Enum):
    CLOSED = "closed"      # 정상 — 요청 통과
    OPEN = "open"          # 실패过多 — 요청 차단
    HALF_OPEN = "half_open"  # 복구 시도 중

class MCPCircuitBreaker:
    def __init__(
        self,
        server_name: str,
        failure_threshold: int = 3,
        recovery_timeout_seconds: float = 30.0,
    ):
        self.server_name = server_name
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout_seconds
        self.failure_count = 0
        self.state = CircuitState.CLOSED
        self.last_failure_time: float | None = None

    def record_failure(self):
        self.failure_count += 1
        self.last_failure_time = asyncio.get_event_loop().time()

        if self.failure_count >= self.failure_threshold:
            self.state = CircuitState.OPEN
            print(f"[CircuitBreaker] {self.server_name} opened due to {self.failure_count} failures")

    def record_success(self):
        self.failure_count = 0
        self.state = CircuitState.CLOSED

    async def call(self, fn, *args, **kwargs):
        if self.state == CircuitState.OPEN:
            # 복구 타이머 확인
            if self.last_failure_time:
                elapsed = asyncio.get_event_loop().time() - self.last_failure_time
                if elapsed < self.recovery_timeout:
                    raise Exception(f"Circuit open for {self.server_name} — rejecting call")
                self.state = CircuitState.HALF_OPEN

        try:
            result = await fn(*args, **kwargs)
            self.record_success()
            return result
        except Exception as e:
            self.record_failure()
            raise

# MCP 서버 등록
circuit_breakers = {
    "postgres-mcp": MCPCircuitBreaker("postgres-mcp"),
    "filesystem-mcp": MCPCircuitBreaker("filesystem-mcp"),
    "web-search-mcp": MCPCircuitBreaker("web-search-mcp"),
}

async def call_mcp_server(server_name: str, fn, *args, **kwargs):
    cb = circuit_breakers.get(server_name)
    if not cb:
        return await fn(*args, **kwargs)
    return await cb.call(fn, *args, **kwargs)
```

---

## 결론: Reliability는 선택이 아니라 필수

2026년 4월, AI Agent를 프로덕션에 운영하는 것은 "기술적 실험"이 아니라 "신뢰성 공학"이 되어야 한다.

**이 글에서 다룬 3가지 핵심 원칙:**

1. **SLO 정의**: Task Success Rate, Quality Score, Hallucination Rate를 측정하고Alert을 설계하라. "동작하는 것 같다"는 감이 아닌 측정 가능한 지표로 신뢰성을 판단하라.

2. **Failure Recovery 설계**: Retry/Fallback/Idempotency를 처음부터 설계에 넣어야 한다. 실패는 피할 수 없지만, 실패에서 복구하는 것은 설계할 수 있다. 특히 Hallucination은 재시도로 해결되지 않으니 Validation + Human Escalation 경로를 반드시 구성하라.

3. **Observability**: Agent 실행을 "볼 수 없다면" 고치지도 못한다. OpenTelemetry 기반의 구조화된 Trace로 LLM 호출의 실행 경로를 추적 가능하게 해야 한다. MCP Circuit Breaker로 외부 의존성 실패가 전체 시스템을 못 보내는 것을 방지하라.

**핵심 교훈**: 프레임워크를 선택하는 것은 어렵지 않다. 그 프레임워크 위에서 Agent를 신뢰성 있게 운영하는 것이 진짜 과제다. Belitsoft 리포트가 말하는 "절반이 단독으로运作"라는 현실을 바꾸는 것은 프레임워크 비교가 아니라 Reliability Engineering이다.

---

### 자가 검토 및 개선 사항

1. **SLO 계층의 구체성**: 단순 "성공/실패"가 아닌 품질 점수와 Hallucination Rate를 분리하여 측정하는 것이 실질적 운영에 필수적이라는 관점을 강조함.

2. **코드 예시의 완결성**: Retry + Fallback + Validation을 하나의 함수로 통합한 `with_retry_and_fallback`이 실무에서 바로 사용 가능한 수준으로 구성됨. IdempotencyKey 설계도 실제Redis 기반 구현에 참조 가능.

3. **MCP 의존성 위험 강조**: 이전 글의 MCP生态계 강점과 대비하여, MCP 서버 실패 시 Agent 전체에 미치는 영향을 Circuit Breaker 패턴으로 대응하는 현실적 조언을 포함.

4. **관찰 가능성 섹션의 실질성**: 전통적 APM의 한계와 Agent Trace의 복잡성을 구체적으로 설명하고, OpenTelemetry 기반 통합 예시로 실용적 해결책을 제시.

5. **전편과의 연계성**: 4월 10일(Agent SLO), 4월 11일(Agentic Memory), 4월 12일(Multi-Agent Framework) 글과 자연스럽게 이어지도록 구성. 이 글이 그 시리즈의 "运营적 완결성"을 담당.