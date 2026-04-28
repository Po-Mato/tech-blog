---
title: "Agentic AI의 5대 설계 패턴: 자율 에이전트 아키텍처 깊이 파고들기"
date: 2026-04-28T16:00:00+09:00
draft: false
tags: ["AI", "Agentic AI", "Architecture", "LLM", "Design Pattern"]
---

## 서론: 왜 지금 Agentic AI인가

2026년, AI는 단순한 "질의응답기"에서 "실행 주체"로 전환하고 있다. Agentic AI — 즉, 목표를 자율적으로 설정하고 도구를 선택하며 행동을 계획하는 AI 시스템 — 는 enterprise architecture에서 가장 뜨거운 화제다. Google Cloud Architecture Center에서 발표한 바와 같이, reasoning engine, tool integration, safety guardrails의 세 가지 축이 핵심을 이룬다.

오늘은 **5대 핵심 설계 패턴**을 시스템 이론적 프레임워크로 정리하고, 각 패턴의 아키텍처적 의미를 코드와 함께 깊이 파고들겠다.

---

## 1. Reflection Pattern (자기 반성 패턴)

### 개념

에이전트가 자신의 이전 행동을 평가하고, 그 결과를 다음行动计划에 반영하는 패턴이다. 단일 에이전트의 출력물이 다음 사이클의 입력으로回流한다.

### 아키텍처

```
Agent (LLM)
  │
  ├─→ Action → Environment
  │                  │
  │                  ▼
  │              Observation
  │                  │
  └──────────←── Feedback ←─┘
         (Self-Evaluation)
```

### 코드 예시 (Python)

```python
class ReflectiveAgent:
    def __init__(self, model, max_iterations=3):
        self.model = model
        self.max_iterations = max_iterations
        self.history = []

    def run(self, task: str) -> str:
        for i in range(self.max_iterations):
            # 1) Plan
            plan = self.model.generate(f"""
                Task: {task}
                History: {self.history}
                What is the next action?
            """)

            # 2) Act
            result = self.execute(plan)
            self.history.append({"plan": plan, "result": result})

            # 3) Reflect
            evaluation = self.model.generate(f"""
                Action: {plan}
                Result: {result}
                Was this effective? Rate 1-10 and explain.
            """)

            if self.is_satisfactory(evaluation):
                return result

        return self.history[-1]["result"]
```

### 실무적 함의

 Reflection pattern은 **반복 작업에 강력**하다. 하지만 무한 루프 방지를 위해 iteration limit과 cost control이 반드시 필요하다. evaluator-optimizer loop 구조가 핵심이다.

---

## 2. Tool Use Pattern (도구 사용 패턴)

### 개념

LLM이 외부 도구 (검색, API 호출, DB 쿼리, 파일 시스템 접근 등) 를 호출하여 자신의 능력 경계를 확장하는 패턴이다.

### 핵심: Progressive Disclosure

Google Cloud의 권장 사항에 따르면, 모든 도구 스키마를 한꺼번에 로드하는 대신 **필요할 때만 relevant한 도구만 동적으로 로드**해야 token 소비를 절감할 수 있다.

```python
class ToolUsingAgent:
    def __init__(self):
        self.tool_registry = {
            "search": SearchTool(),
            "sql": SQLTool(),
            "file": FileTool(),
        }
        # Lazy loading - 도구 스키마는 처음부터 로드하지 않음
        self.loaded_tools = {}

    def invoke_tool(self, tool_name: str, params: dict):
        # 처음 호출될 때만 스키마를 로드
        if tool_name not in self.loaded_tools:
            self.loaded_tools[tool_name] = self.tool_registry[tool_name]
        
        tool = self.loaded_tools[tool_name]
        return tool.run(params)
```

### Search Tool Pattern의威力

LLM의 tool selection은 자체적으로 도구를 선택하는 "agent" 역할을 한다. 이 패턴을 통해 에이전트는 **RAG (Retrieval Augmented Generation) 없이도 동적 지식 조회**가 가능하다.

---

## 3. ReAct Pattern (Reasoning + Acting)

### 개념

Reasoning (사고) 과 Acting (행동) 을 교대로 수행하며, 매 행동마다 observation을 reasoning 체인에 통합하는 패턴이다. Smith et al. (2023) 의 ReAct 논문에서 출발했다.

### 상태 머신 구조

```
THINK → ACT → OBSERVE → (next cycle or STOP)
  ↑__________________|
```

```python
def react_loop(task: str, agent: LLM, tools: list):
    obs = ""
    thought_chain = []

    while True:
        # Reasoning 단계
        thought = agent.reason(
            f"Task: {task}\nObservation: {obs}\nThoughts: {thought_chain}"
        )
        thought_chain.append(thought)

        # Acting 단계
        if thought.is_finished:
            return thought.final_answer
        
        action, params = thought.choose_tool(tools)
        obs = action.execute(params)
        
        # Safety check
        if is_dangerous(action):
            raise SafetyGuardrailViolation(action)
```

### MES/PLC Integration에의 적용

실제 제조 현장에서는 **Modbus/MELSEC I/F** 를 통해 PLC에서 실시간 센서 데이터를 조회하고, 그 observation을 기반으로 재처리 파라미터를 조정하는 에이전트를 구성할 수 있다. 이것이 Industry 4.0의 핵심이다.

---

## 4. Planning Pattern (계층적 계획 패턴)

### 개념

에이전트가 복잡한 목표를 하위 작업으로 분해하고, 계층적으로 planning하는 패턴이다. 단일 프롬프트가 아닌 **Task Decomposition → Sub-task Scheduling → Execution → Monitoring** 의 파이프라인을 따른다.

### 계층 구조

```
Top-Level Goal
    │
    ├─→ Sub-task 1 ─→ [Plan A]
    │                     ├─→ Step A1
    │                     └─→ Step A2
    │
    ├─→ Sub-task 2 ─→ [Plan B]
    │                     └─→ Step B1
    │
    └─→ Sub-task 3 ─→ [Plan C]
```

### 산업용 적용 시나리오

전구체 박막 성장 공정에서:
1. **Goal**: specified film uniformity 달성
2. **Sub-task 1**: 온도 프로파일 최적화
3. **Sub-task 2**: 가스 유량 재배정
4. **Sub-task 3**: 실시간 수율 예측

이 모든 것을 하나의 거대 모델에 던지는 대신, 계층적으로 분해하면 각 서브태스크에 적합한 specialist 모델을 배정할 수 있다 — 바로 **CQRS 패턴**의 아이디어다.

---

## 5. Multi-Agent Orchestration (다중 에이전트 오케스트레이션)

### 아키텍처: LangGraph 기반 Reference Architecture

LangChain의 LangGraph를 활용한 multi-agent coordinated framework는 다음과 같은 참조 아키텍처를 따른다:

```
┌─────────────────────────────────────────────┐
│           Supervisor / Orchestrator         │
│  (목표 분해 + 에이전트 할당 + 결과 집계)     │
└────────┬──────────────┬─────────────────────┘
         │              │
    ┌────▼────┐   ┌────▼────┐
    │ Agent A │   │ Agent B │
    │(DevOps) │   │ (Data)  │
    └─────────┘   └─────────┘
         │              │
    ┌────▼────┐   ┌────▼────┐
    │Toolset A│   │Toolset B│
    │(Cloud   │   │(SQL,    │
    │ CLI)    │   │ML Model)│
    └─────────┘   └─────────┘
```

### 산업용 사례: DT/AI Transformation

배터리 실리콘 음극재 생산라인에서:
- **DevOps Agent**: AWS/Azure 인프라 프로비저닝
- **Data Agent**: MS-SQL/Oracle에서 수율 데이터 조회 및 이상치 탐지
- **MES Agent**: 실시간 공정 데이터 연동
- **Supervisor**: 세 에이전트의 결과를 종합하여 QMS에 보고

### 안전 가드레일 (Safety Guardrails)

LangChain의 연구에 따르면, multi-agent 시스템에서 가장 큰 위험은 **에이전트 간失控된 행동 연쇄**다. 이를 방지하기 위해:
- 각 에이전트의 행동에 대해 사전 승인 체인 (pre-approval chain)
- 리소스 사용량 상한 (cost ceiling)
- 행동 이력의 감사 로깅 (audit logging)

---

## 패턴 간 관계와 조합

| Pattern | Primary Role | Trigger | Weakness |
|---------|-------------|---------|---------|
| Reflection | 자기 평가 | 반복 작업 | 비용 증가 |
| Tool Use | 능력 확장 | 정보 부족 | 스키마 오염 |
| ReAct | 추론-행동 통합 | 실시간 환경 |Observation噪声 |
| Planning | 복잡도 분해 | 다단계 작업 | 계획 오류 전파 |
| Multi-Agent | 협업 확장 | 시스템 수준 | 오케스트레이션 복잡 |

### 권장 조합

1. **간단한 질의응답**: Tool Use 단독
2. **반복적 분석 작업**: Reflection + Tool Use
3. **실시간 제어**: ReAct + Safety Guardrails
4. **기업 전체 자동화**: Planning + Multi-Agent Orchestration + Safety Guardrails

---

## 결론: 설계 패턴은 도구일 뿐

5대 패턴은万能 솔루션이 아니다. 시스템의 복잡도, 신뢰성 요구 수준, 비용 제약에 따라 적절한 패턴 조합이 달라진다. 중요한 것은 **이 패턴들이 서로 독립적이지 않으며, 실제로는 cascading하게 적용**된다는 것이다.

2026년 현재, Agentic AI는 "hot topic"을 넘어서 enterprise에서 production 환경에 실제로 배포되고 있다. 위에 기술한 패턴들을 이해하고, 자신의 도메인에 맞게 조합하는 것이 software engineer로서 가장 중요한 숙제다.

---

## References

- Google Cloud Architecture Center: "Choose your agentic AI architecture components" (2026)
- LangChain Blog: "Agentic Engineering: How Swarms of AI Agents Are Redefining Software Engineering" (2026)
- System Design Newsletter: "Agentic Design Patterns" by Neo Kim (2026)
- Smith et al.: "ReAct: Synergizing Reasoning and Acting in Language Models" (2023)
- VoltAgent/awesome-ai-agent-papers: AI Agent Research Papers 2026 Collection
