---
title: "브라우저가 에이전트 런타임이 되는 순간: MCP + In-Page Agent 아키텍처 Deep Dive"
date: 2026-03-08
categories: ["Trend", "AI", "Frontend", "Architecture"]
tags: ["MCP", "Agentic", "Browser Automation", "Local-first", "TypeScript"]
draft: false
---

# 브라우저가 에이전트 런타임이 되는 순간: MCP + In-Page Agent 아키텍처 Deep Dive

최근 트렌드는 한 문장으로 요약됩니다.

> **"AI는 더 이상 서버에서만 추론하지 않는다. 브라우저 안에서 실행 흐름을 오케스트레이션한다."**

오늘 글은 단순 뉴스 요약이 아니라, 실제 제품에 바로 적용 가능한 아키텍처 관점으로 정리합니다.

- 왜 `MCP + 브라우저 자동화 + 인페이지 에이전트` 조합이 강력한가?
- 어떤 계층으로 설계해야 확장성과 안전성을 동시에 잡을 수 있는가?
- 코드 레벨에서 어떤 인터페이스를 고정해야 팀 생산성이 올라가는가?

---

## 1) 트렌드 시그널: "생성형"에서 "실행형"으로

오늘 확인된 흐름은 세 가지입니다.

1. **MCP 생태계 확대**: AI 앱/IDE/CLI가 표준 인터페이스(MCP)로 도구 연결을 통합.
2. **브라우저 자동화의 구조화**: 스크린샷 중심이 아니라 접근성 트리/구조화 액션 기반 제어가 확대.
3. **In-Page Agent의 부상**: 웹 앱 내부에서 자연어→UI 액션 변환을 수행하는 패턴 증가.

핵심은 "에이전트가 UI를 이해하고 행동하는 능력"이 프론트엔드 경쟁력으로 직접 연결된다는 점입니다.

---

## 2) 권장 아키텍처: 4-Layer Agentic Frontend

### Layer A — Intent Layer (의도 해석)
- 입력: 사용자 자연어, 컨텍스트(현재 페이지/권한/히스토리)
- 출력: 구조화된 의도(Intent DTO)

### Layer B — Planning Layer (실행 계획)
- 입력: Intent DTO, 도구 카탈로그
- 출력: Action Plan (검증 가능한 스텝 목록)

### Layer C — Tool Execution Layer (도구 실행)
- MCP 서버, 브라우저 제어 도구, 내부 API 어댑터를 통해 실제 액션 수행
- 모든 실행은 **idempotent key**와 **audit log**를 남김

### Layer D — Safety & Governance Layer (안전/거버넌스)
- 정책 엔진(RBAC/ABAC), PII 마스킹, 위험 액션 승인 워크플로우
- "읽기/쓰기/외부전송"을 분리 승인

이렇게 분리하면 모델이 바뀌어도(교체 주기 단축) 핵심 도메인 로직이 흔들리지 않습니다.

---

## 3) 구현 포인트: 인터페이스를 먼저 고정하라

아래처럼 의도/계획/실행 이벤트를 타입으로 명확히 분리하면, 모델 교체와 도구 추가가 쉬워집니다.

```ts
// agent-contract.ts
export type UserIntent = {
  goal: string;
  constraints: string[];
  riskLevel: "low" | "medium" | "high";
};

export type PlanStep = {
  id: string;
  tool: "mcp.browser" | "mcp.calendar" | "internal.api";
  action: string;
  payload: Record<string, unknown>;
  requiresApproval: boolean;
};

export type ExecutionResult = {
  stepId: string;
  ok: boolean;
  output?: unknown;
  error?: string;
  latencyMs: number;
};

export interface AgentOrchestrator {
  parseIntent(input: string): Promise<UserIntent>;
  buildPlan(intent: UserIntent): Promise<PlanStep[]>;
  execute(plan: PlanStep[]): Promise<ExecutionResult[]>;
}
```

실전에서는 `execute()` 전에 정책 검증을 강제합니다.

```ts
// policy-gate.ts
export function assertPolicy(step: PlanStep, userRole: string) {
  if (step.requiresApproval && userRole !== "owner") {
    throw new Error(`Approval required for step: ${step.id}`);
  }

  const blocked = ["external.send", "db.drop", "secrets.read"];
  if (blocked.includes(step.action)) {
    throw new Error(`Blocked action: ${step.action}`);
  }
}
```

이 두 파일만 잘 설계해도, "모델 중심"이 아닌 "프로토콜 중심" 아키텍처로 전환됩니다.

---

## 4) 프론트엔드 팀이 바로 적용할 체크리스트

- [ ] 툴 호출을 UI 이벤트와 분리한 `Action Bus`를 도입했는가?
- [ ] 에이전트 실행 로그를 replay 가능한 형태로 저장하는가?
- [ ] 고위험 액션(외부 전송/삭제/권한 변경)에 human-in-the-loop가 있는가?
- [ ] 모델 교체 시 테스트 가능한 계약 테스트(contract test)가 있는가?
- [ ] 실패 시 복구 가능한 보상 트랜잭션(compensating action)이 정의되어 있는가?

---

## 5) 결론: 프론트엔드의 역할이 다시 커지고 있다

지난 2년이 "모델 성능 경쟁"이었다면, 이제는 **"실행 신뢰성 경쟁"**입니다.

앞으로의 프론트엔드 핵심 역량은 다음과 같습니다.

1. 에이전트가 행동할 수 있는 안전한 UI/도구 인터페이스 설계
2. 모델 교체를 흡수하는 프로토콜/계약 기반 구조화
3. 관측 가능성(로그/추적)과 승인 흐름까지 포함한 제품 운영 능력

즉, **브라우저는 다시 얇은 뷰 레이어가 아니라, 지능형 실행 엔진의 제어판**이 되고 있습니다.

이번 주 실무 액션으로는 다음을 권장합니다.
- 기존 AI 기능을 "프롬프트 단위"가 아니라 "Intent → Plan → Execute" 파이프라인으로 재구성
- 도구 호출 전 정책 게이트 강제
- 액션 로그를 기반으로 실패 패턴을 측정하고 자동 복구 규칙 추가

이 구조를 먼저 잡는 팀이, 모델 경쟁이 아니라 **실행 품질**로 격차를 만듭니다.
