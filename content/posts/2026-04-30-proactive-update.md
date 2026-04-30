---
title: "AI 에이전트의 진정한 병목: 런타임이说了算"
description: "模型迭代 속도를 따라가는 건 어렵지 않지만, 실행 런타임의 신뢰성을 확보하는 건 아직까지 엔지니어링의 핵심 과제입니다. Harness Engineering이라는 새로운 패러다임을深人分析합니다."
date: "2026-04-30"
tags: ["AI-Agent", "Harness-Engineering", "MCP", "Agent-SLO", "Production-AI"]
---

## 들어가며

최근 AI 에이전트 관련 논의는 대부분 **모델 성능**에 집중됩니다. o1이냐, DeepSeek-R1이냐, GPT-4.5냐. 하지만 실제로 production에서 에이전트를 운영해본 팀이라면 알 수 있는 사실이 하나 있습니다.

**모델은 결국commodity가 된다. 런타임이 경쟁력이 된다.**

이 글에서는 2026년 현재, AI 에이전트의 실행 런타임을 설계할 때 반드시 고려해야 하는 아키텍처적 요소들과 함께, 최근 주목받고 있는 **Harness Engineering** 패러다임의 핵심을 정리합니다.

---

## 1. 모델이 아니라 런타임이 병목인 이유

### 1.1 과거 2년간의 패턴

2024년 초에는 "어떤 LLM을 쓰느냐"가 에이전트의 성패를 결정했습니다. 2025년에는 **프롬프트 엔지니어링과 도구 설계**로 관심이 이동했습니다. 2026년 현재, 논의의 중심은 **실행 런타임의 신뢰성**으로 이동했습니다.

이전 글[[1]](https://chaguz.com/2026/04/03/mcp-execution-runtime-bottleneck/)에서 이미 다루었듯, MCP 시대를 넘어서면 에이전트의 병목은 다음 세 가지입니다:

- **Execution Runtime**: 에이전트가 실제로 행동을 취하는 환경
- **State Management**: 다단계 작업에서 컨텍스트를 유지하는 메커니즘
- **Permission Boundary**: 외부 시스템 접근을 제어하는 보안 레이어

### 1.2 Datadog의 2026 State of AI Engineering[[2]](https://www.datadoghq.com/state-of-ai-engineering/) 리포트도 이를 뒷받침합니다

동일 리포트에 따르면:
- LLM fleet management에서 **cost optimization**이 가장 큰 과제
- Multi-step workflow의 **common failure modes**가 전체 오류의 60% 이상
- **Agent design** 관련 telemetry가 전체 AI 트래픽의 40% 이상을 차지

즉, 모델을 선택하는 것은 "starting point"일 뿐, 실제로 경쟁력을 만드는 것은 **그 모델 위에서 안정적으로 동작하는 런타임**입니다.

---

## 2. Harness Engineering이란 무엇인가

### 2.1 정의

Harness Engineering[[3]](https://github.com/ai-boost/awesome-harness-engineering)은 AI 에이전트를 **안정적으로 실행하고, 평가하고, 관찰할 수 있는 infrastructure**를 설계하는 분야입니다.

단순히 "프롬프트를 잘 쓰자"는 차원이 아닙니다. 에이전트가 실제로 production 환경에서:

- **성공적으로 완료하는가** (Task Success Rate)
- **얼마나 빠르게 행동하는가** (Time-to-Useful-Action)
- **실패 시 어떻게 복구하는가** (Recovery Pattern)

这些问题를 모두 infrastructure 차원에서 해결하는 것입니다.

### 2.2 핵심 컴포넌트 5가지

```
┌─────────────────────────────────────────────────────────┐
│                  Harness Engineering                     │
├─────────────┬─────────────┬─────────────┬────────────────┤
│   Tools     │   Memory    │ Permissions │  Observability │
│   (MCP)     │  (Context)  │ (Security)  │   (Telemetry)  │
├─────────────┴─────────────┴─────────────┴────────────────┤
│              Execution Runtime                           │
│         (Sandbox / Pool / Timeout / Retry)               │
└─────────────────────────────────────────────────────────┘
```

#### 1) Tools (MCP Integration)

MCP[[4]](https://modelcontextprotocol.io/)는 에이전트에게 도구를 제공하는 표준화된 방식입니다. 핵심은 "도구를 많이 만드는 것"이 아니라 **도구의 계약(contract)을 명확히 하는 것**입니다.

```typescript
// MCP 도구 정의의 핵심: capability contract
interface MCPSToolDefinition {
  name: string;
  description: string;        // 에이전트가 이해할 수 있는 명확한 설명
  inputSchema: z.ZodSchema;   // 런타임 검증 가능
  outputSchema?: z.ZodSchema; // 실패 모드 사전 정의
  timeoutMs: number;          // 명시적 타임아웃
  retryPolicy?: {
    maxAttempts: number;
    backoffMs: number;
  };
}
```

#### 2) Memory Architecture

에이전트의 Memory는 단순히 "히스토리 저장"이 아닙니다. **어떤 정보를 언제 유지하고 언제 폐기할 것인가**를 결정하는 것이 핵심입니다.

```
短期記憶 (Working Context)
├── 현재 작업 관련 상태 (max 32K tokens)
├── 直近 3개/tool calls 결과
└── 에이전트의 현재 목표

中期記憶 (Session Memory)
├── 이번 세션의 주요 결정들
├── 성공/실패 패턴 기록
└── max 7일 or 100 tool calls

長期記憶 (Persistent Memory)
├── 성공적인 strategy 패턴
├── Domain knowledge
└── 에이전트의 personal character
```

#### 3) Permission Boundary

가장 위험한 부분입니다. "에이전트가 할 수 있는 것"과 "해서는 안 되는 것"을 명확히 분리해야 합니다.

```python
# Permission boundary 설정 예시
class AgentPermissionPolicy:
    ALLOWED_ACTIONS = [
        "read:database",
        "write:database:only_if_sandboxed",
        "send:notification",
        "create:file:in_specific_directory_only"
    ]

    DENIED_ACTIONS = [
        "exec:system_command",
        "delete:production_data",
        "send:external_webhook"
    ]

    # 실행 전 반드시 검증
    def validate_action(self, action: Action) -> bool:
        return action.type in self.ALLOWED_ACTIONS
```

#### 4) Observability (SLO/Telemetry)

에이전트의 품질을 측정하려면 전통적인 SLO 개념을 에이전트에 맞게 재정의해야 합니다:

```yaml
# Agent SLO 정의 예시
agent_slo:
  task_success_rate:
    target: "> 85%"
    measurement: "완료된 태스크 / 전체 시도"
    alert_threshold: "< 80%"

  time_to_useful_action:
    target: "< 30초 (P95)"
    measurement: "첫 tool call까지의 시간"
    alert_threshold: "> 60초"

  recovery_rate:
    target: "> 90%"
    measurement: "실패 후 자동 복구 비율"
    alert_threshold: "< 85%"

  context_window_efficiency:
    target: "> 70%"
    measurement: "유용한 토큰 / 총 사용 토큰"
    alert_threshold: "< 50%"
```

#### 5) Execution Runtime

Sandbox 실행이 핵심입니다. 2026년 4월, OpenAI Agents SDK[[5]](https://github.com/openai/openai-agents-python)에 **native sandbox execution**이 추가되었습니다.

```python
# OpenAI Agents SDK - sandbox execution 예시
from openai.agents import Agent, SandboxConfig

agent = Agent(
    name="code_reviewer",
    instructions="...",
    tools=[...],
    sandbox=SandboxConfig(
        timeout=60,           # 최대 60초
        memory_limit="512MB",  # 메모리 제한
        network_access=False,  # 외부 네트워크 차단
        filesystem_scope="/tmp/agent_workspace"  # 파일시스템 제한
    )
)
```

---

## 3. Multi-Agent Orchestration Patterns

### 3.1 Microsoft Agent Framework 1.0[[6]](https://techcommunity.microsoft.com/blog/azuredevcommunityblog/the-future-of-agentic-ai-inside-microsoft-agent-framework-1-0/4510698)에서 정리한 패턴

production에서 안정적으로 동작하는 multi-agent 패턴은 다음 세 가지입니다:

#### Pattern 1: Router Agent

```typescript
// 작업 유형에 따라適切な 에이전트에게 라우팅
const routerAgent = new Agent({
  instructions: `
    분석 결과를 바탕으로 적절한 작업 에이전트에게 전달:
    - code_review → CodeReviewAgent
    - data_analysis → DataAnalysisAgent
    - simple_query → DirectResponseAgent

    라우팅 결정은 3초 내에 내려야 합니다.
  `
});

// 실패 시 fallback: 복잡한 작업은 너무 쉽게 에이전트에게 넘기지 않음
```

#### Pattern 2: Supervisor Chain

```typescript
// Supervisor가 전체 워크플로우를 관리
const supervisor = new Agent({
  instructions: `
    복잡한 태스크를 하위 단계로 분해하고,
    각 단계完成后 Supervisor가 다시 제어권을 가집니다.
    모든 단계의 결과를 취합해서 최종 결과를 산출합니다.
  `
});
```

#### Pattern 3: Parallel Execution with Fan-out/Gather

```typescript
// 독립적 태스크를 병렬로 실행 후 취합
const results = await Promise.allSettled([
  agentA.execute(task1),
  agentB.execute(task2),
  agentC.execute(task3)
]);

// 실패한 태스크만 재시도
const failures = results.filter(r => r.status === 'rejected');
if (failures.length > 0) {
  await retryFailed(failures, { maxAttempts: 2 });
}
```

---

## 4. 내身在 produção에서 무엇을 해야 하는가

### 4.1 Immediate Actions (1-2주 이내)

1. **현재 에이전트의 SLO 모니터링 시작**
   - Task success rate 추적
   - Time-to-first-tool-call 측정
   - Failure mode 분류

2. **Permission boundary审计**
   - 현재 에이전트가 접근할 수 있는 모든 리소스列出
   - 불필요한 권한 제거

3. **MCP 도구 contract审计**
   - 모든 도구에 timeout 명시
   - input/output schema 검증 로직 추가

### 4.2 Medium-term (1-2개월)

1. **Memory strategy 도입**
   - 단기/중기/장기 메모리 분리
   - Session 종료 시 정리 로직

2. **Sandbox 실행 도입**
   - Production 도구 실행은 반드시 sandbox에서
   - Network 접근制御

3. **에이전트별 Cost tracking**
   - Token 사용량 모니터링
   - 최적화 기회 식별

---

## 5. 결론

AI 에이전트의 품질은 **모델 성능이 아니라 런타임 신뢰성**에 의해 결정됩니다.

Harness Engineering은 다음과 같은 질문에 답하는 것입니다:
- "내 에이전트가 실패했을 때 무엇이 일어나는가?"
- "실패하지 않으려면 어떤 안전장치가 필요한가?"
- "실패해도 자동 복구되는가?"

2026년 현재, 이러한 질문에 답할 수 있는 infrastructure를 가진 팀과 그렇지 않은 팀의 격차는 빠르게 벌어지고 있습니다. 모델의 차이는 수 주 내에 좁혀지지만, 런타임 신뢰성은 수개월의 엔지니어링이 필요한 영역이기 때문입니다.

**모델을 바꾸는 것은 쉽습니다. 런타임을 신뢰할 수 있게 만드는 것은 어렵습니다.**

---

## References

[[1]](https://chaguz.com/2026/04/03/mcp-execution-runtime-bottleneck/) MCP 시대의 병목은 모델이 아니라 실행 런타임이다
[[2]](https://www.datadoghq.com/state-of-ai-engineering/) Datadog State of AI Engineering 2026
[[3]](https://github.com/ai-boost/awesome-harness-engineering) Awesome Harness Engineering
[[4]](https://modelcontextprotocol.io/) Model Context Protocol Official
[[5]](https://github.com/openai/openai-agents-python) OpenAI Agents SDK
[[6]](https://techcommunity.microsoft.com/blog/azuredevcommunityblog/the-future-of-agentic-ai-inside-microsoft-agent-framework-1-0/4510698) Microsoft Agent Framework 1.0