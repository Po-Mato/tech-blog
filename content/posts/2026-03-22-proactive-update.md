---
title: "Context Engineering의 시대: MCP/A2A 표준화가 왜 2026년의 진짜 백엔드를 다시 쓰는가"
date: 2026-03-22
tags: ["AI", "Architecture", "MCP", "A2A", "Context Engineering", "Backend"]
---

# Context Engineering의 시대: MCP/A2A 표준화가 왜 2026년의 진짜 백엔드를 다시 쓰는가

2026년의 에이전트 시장을 보면, 더 이상 핵심 경쟁이 "어느 모델이 더 똑똑한가"에만 머물지 않습니다. 최근 트렌드 리포트들이 공통적으로 가리키는 방향은 더 구체적입니다. **멀티 에이전트 오케스트레이션**, **MCP/A2A 같은 프로토콜 표준화**, **거버넌스 내장형 실행 시스템**, 그리고 **엔지니어의 역할이 구현자에서 오케스트레이터로 이동하는 흐름**이 동시에 가속되고 있습니다.

어제 관점이 브라우저와 로컬 런타임을 "두 번째 백엔드"로 보는 것이었다면, 오늘은 그보다 한 단계 더 안쪽으로 들어가 보겠습니다.

제 결론은 명확합니다.

> **2026년의 백엔드는 API를 잘 노출하는 계층이 아니라, 에이전트에게 어떤 맥락(context)을 어떤 계약(contract)으로, 어떤 시점에, 어떤 권한으로 주입할지 설계하는 계층이 된다.**

즉, 이제 중요한 것은 CRUD API의 개수가 아니라 **컨텍스트 엔지니어링(Context Engineering)** 입니다.

이번 글에서는 왜 MCP와 A2A의 표준화가 단순한 연결성 개선이 아니라 백엔드 아키텍처 자체를 바꾸는 사건인지, 그리고 제품 팀이 어떤 경계를 새로 설계해야 하는지 Deep Dive 해보겠습니다.

## 1. REST 이후의 질문: "무슨 데이터를 줄까"가 아니라 "무슨 맥락을 줄까"

기존 백엔드의 질문은 비교적 단순했습니다.

- 어떤 리소스를 저장할 것인가?
- 어떤 엔드포인트로 노출할 것인가?
- 어떤 권한으로 읽고 쓸 것인가?

하지만 에이전트 시스템에서는 이 질문만으로는 부족합니다. 에이전트는 단순히 데이터를 조회하지 않습니다. **계획하고, 도구를 선택하고, 실행 결과를 해석하고, 다음 액션을 결정**합니다. 즉, 에이전트가 필요로 하는 것은 raw data가 아니라 **의사결정 가능한 형태로 정리된 맥락**입니다.

예를 들어 `GET /inventory/42` 가 반환하는 값이 아래와 같다고 해봅시다.

```json
{ "sku": "42", "stock": 18, "leadTimeDays": 5 }
```

인간 개발자에게는 충분할 수 있습니다. 하지만 에이전트가 재발주 여부를 판단해야 한다면 이것만으로는 부족합니다. 필요한 것은 이런 정보입니다.

- 최근 7일 판매 추세
- 품절 임계치
- 공급업체 리드타임의 신뢰도
- 현재 진행 중인 마케팅 캠페인 여부
- 재발주 승인 권한이 있는지 여부

즉, 2026년의 백엔드는 리소스 서버라기보다 **decision substrate** 에 가깝습니다. 데이터를 저장하는 것보다, **모델이 오판하지 않도록 맥락을 조립하는 일**이 더 중요해집니다.

## 2. MCP가 바꾸는 것: 툴 연결 표준이 아니라 "맥락 공급 표준"

MCP(Model Context Protocol)를 단순히 "도구 호출 프로토콜"로 이해하면 절반만 본 겁니다. 실제 제품 관점에서 MCP가 중요한 이유는, 그 프로토콜이 백엔드 팀에게 새로운 책임을 강제하기 때문입니다.

이제 백엔드는 이렇게 질문받습니다.

- 이 도구는 에이전트에게 **무엇을 할 수 있다**고 설명할 것인가?
- 어떤 입력 스키마가 오해를 최소화하는가?
- 결과는 숫자만 반환할 것인가, 아니면 **행동에 필요한 해석 단서**까지 반환할 것인가?
- 실패 시 `not_found` 와 `policy_blocked` 를 어떻게 구분해서 알려줄 것인가?

결국 MCP 서버는 기존 API gateway의 대체재가 아니라, 더 높은 수준의 **semantic gateway** 입니다.

아래는 단순 조회가 아니라, 에이전트에게 "행동 가능한 맥락"을 반환하는 MCP 툴의 예시입니다.

```ts
import { z } from "zod";

type InventorySnapshot = {
  sku: string;
  stock: number;
  leadTimeDays: number;
  soldLast7d: number;
  campaignBoost: boolean;
};

type ContextEnvelope = {
  summary: string;
  riskLevel: "low" | "medium" | "high";
  recommendedAction?: "reorder_now" | "monitor" | "escalate";
  facts: string[];
};

function buildInventoryContext(snapshot: InventorySnapshot): ContextEnvelope {
  const daysLeft = Math.floor(snapshot.stock / Math.max(snapshot.soldLast7d / 7, 1));
  const campaignFactor = snapshot.campaignBoost ? 1.4 : 1.0;
  const projectedDaysLeft = Math.floor(daysLeft / campaignFactor);

  if (projectedDaysLeft <= snapshot.leadTimeDays) {
    return {
      summary: "현재 판매 속도 기준으로 리드타임 내 품절 위험이 높습니다.",
      riskLevel: "high",
      recommendedAction: "reorder_now",
      facts: [
        `현재 재고: ${snapshot.stock}`,
        `최근 7일 판매량: ${snapshot.soldLast7d}`,
        `리드타임: ${snapshot.leadTimeDays}일`,
        `프로모션 영향 반영 예상 잔여일: ${projectedDaysLeft}일`
      ]
    };
  }

  return {
    summary: "즉시 재발주까지는 아니지만, 재고 추이를 계속 관찰해야 합니다.",
    riskLevel: "medium",
    recommendedAction: "monitor",
    facts: [
      `현재 재고: ${snapshot.stock}`,
      `예상 잔여일: ${projectedDaysLeft}일`
    ]
  };
}
```

이 코드의 핵심은 복잡한 로직이 아닙니다. 핵심은 **백엔드가 더 이상 사실만 전달하지 않고, 에이전트가 안전하게 다음 액션을 고를 수 있도록 의미를 정리해서 넘긴다**는 점입니다.

이 순간부터 백엔드 엔지니어의 산출물은 endpoint가 아니라 **context contract** 가 됩니다.

## 3. A2A가 추가하는 난이도: 서비스 통신이 아니라 "행위자 간 협상"

MCP가 에이전트와 도구를 연결한다면, A2A(Agent-to-Agent)는 에이전트와 에이전트를 연결합니다. 여기서 백엔드 설계는 한 단계 더 어려워집니다.

왜냐하면 전통적인 서비스 간 통신은 비교적 결정적이기 때문입니다. 주문 서비스가 재고 서비스에 요청을 보내면, 스키마와 상태 코드를 맞추는 문제가 중심이었습니다. 하지만 A2A에서는 다음 문제가 동시에 등장합니다.

- 어떤 에이전트가 어떤 전문성을 가진 것으로 간주되는가?
- 작업 위임 시 어느 정도의 맥락을 공유해야 하는가?
- 보조 에이전트가 만든 결과를 누가 검증하는가?
- 충돌하는 제안이 오면 어느 쪽이 최종 권한을 갖는가?

즉, A2A는 단순 RPC가 아니라 **goal-oriented delegation system** 입니다. 서비스 디스커버리보다 더 중요한 것은 **역할, 책임, 검증 루프** 입니다.

여기서 많은 팀이 저지르는 실수는 멀티 에이전트를 "LLM 마이크로서비스"처럼 생각하는 것입니다. 하지만 실제로는 그렇지 않습니다. 멀티 에이전트 시스템은 마이크로서비스보다 훨씬 더 불확실합니다. 각 에이전트는 같은 입력을 받아도 다른 설명을 만들 수 있고, 같은 계획이라도 우선순위를 다르게 둘 수 있습니다.

그래서 A2A 아키텍처는 요청-응답 스키마보다 먼저 아래 세 가지를 고정해야 합니다.

1. **권한 경계** — 누가 실행하고 누가 추천만 하는가
2. **검증 경계** — 누가 결과를 승인하고 반려하는가
3. **맥락 경계** — 어떤 기억을 공유하고 어떤 기억은 숨길 것인가

## 4. 이제 필요한 것은 API 설계가 아니라 Context Budget 설계다

LLM 시스템에서 가장 흔한 실패는 의외로 모델 품질 부족이 아닙니다. 대부분은 **컨텍스트 과잉** 또는 **컨텍스트 누락**입니다.

- 너무 많이 넣으면 토큰 비용이 급증하고, 핵심 신호가 묻힙니다.
- 너무 적게 넣으면 에이전트가 엉뚱한 가정을 세웁니다.
- 권한 정보가 빠지면 위험한 액션을 시도합니다.
- 최신 상태가 빠지면 이미 해결된 문제를 다시 파고듭니다.

이 때문에 2026년형 백엔드에는 `DB → API → UI` 흐름만으로는 부족합니다. 그 위에 **Context Budget Layer** 가 필요합니다.

제가 추천하는 구조는 대략 이렇습니다.

```text
[Source Systems]
  ├─ DB / Search / Ticket / Git / Browser State
  ↓
[Context Normalizer]
  ├─ schema alignment
  ├─ freshness tagging
  ├─ conflict detection
  ↓
[Policy & Budget Layer]
  ├─ capability filtering
  ├─ token budget allocation
  ├─ PII / secret redaction
  ↓
[Planner / Orchestrator]
  ├─ tool choice
  ├─ sub-agent delegation
  └─ retry / recovery strategy
  ↓
[Action Runtime]
```

여기서 중요한 것은 `Policy & Budget Layer` 입니다. 과거에는 보안과 성능이 별도 concern이었지만, 에이전트 아키텍처에서는 **무엇을 보여줄지**가 곧 보안이자 성능이며 정확도입니다.

즉, Context Engineering은 프롬프트 작성 기교가 아니라 **백엔드의 새 책임 분리**입니다.

## 5. 실전 패턴: 컨텍스트를 "주입"하지 말고 "계약된 상태로 조립"하라

많은 팀이 아직도 에이전트에게 긴 시스템 프롬프트와 다량의 검색 결과를 한 번에 밀어 넣는 방식으로 시스템을 만듭니다. 이건 초기 데모에는 통하지만, 운영 단계에서는 금방 무너집니다.

운영 가능한 구조를 만들려면, 컨텍스트는 문장 뭉치가 아니라 **계약된 상태(contracted state)** 로 조립되어야 합니다.

예를 들면 오케스트레이터는 아래처럼 동작해야 합니다.

```ts
type Capability =
  | "repo.read"
  | "repo.write"
  | "git.push"
  | "ticket.read"
  | "ticket.comment"
  | "browser.submit";

type ContextPacket = {
  objective: string;
  facts: string[];
  constraints: string[];
  capabilities: Capability[];
  freshnessTs: string;
  nextBestActions: string[];
};

function assembleContext(params: {
  objective: string;
  facts: string[];
  constraints: string[];
  capabilities: Capability[];
}): ContextPacket {
  return {
    objective: params.objective,
    facts: params.facts.slice(0, 12),
    constraints: params.constraints.slice(0, 8),
    capabilities: params.capabilities,
    freshnessTs: new Date().toISOString(),
    nextBestActions: deriveNextBestActions(params)
  };
}

function deriveNextBestActions(params: {
  objective: string;
  facts: string[];
  constraints: string[];
  capabilities: Capability[];
}) {
  const actions: string[] = [];

  if (params.capabilities.includes("repo.write")) {
    actions.push("필요한 파일 수정 후 변경 요약 생성");
  }
  if (params.capabilities.includes("git.push")) {
    actions.push("최종 승인 조건 확인 후 main 브랜치 반영");
  }
  if (!params.capabilities.includes("browser.submit")) {
    actions.push("외부 제출 액션은 제안만 하고 실제 실행은 보류");
  }

  return actions;
}
```

이 패턴의 장점은 분명합니다.

- 에이전트가 자신이 **무엇을 아는지**, **무엇을 할 수 있는지**, **무엇을 하면 안 되는지**를 동시에 이해합니다.
- 멀티 에이전트 환경에서도 패킷 단위로 맥락을 넘길 수 있습니다.
- 재시도 시에도 이전 상태를 재조립하기가 쉽습니다.
- 감사 로그에 남기기 좋습니다.

결국 중요한 것은 긴 설명이 아니라 **구조화된 작동 맥락**입니다.

## 6. 거버넌스가 아키텍처 내부로 들어온다

2026년 트렌드 리포트들이 공통으로 강조하는 포인트 하나가 있습니다. 에이전트 확산의 병목은 모델 성능보다 **거버넌스와 신뢰성**입니다.

이 말은 꽤 중요합니다. 왜냐하면 많은 팀이 아직도 거버넌스를 "출시 직전 체크리스트" 정도로 취급하기 때문입니다. 하지만 에이전트 시대에는 그 접근이 통하지 않습니다.

거버넌스는 이제 문서가 아니라 **런타임 기능**이어야 합니다.

필수적으로 내장해야 할 것은 최소 이 정도입니다.

- **Capability gating**: 에이전트별 허용 액션 제한
- **Approval checkpoints**: 외부 상태 변경 전 승인 큐 진입
- **Traceability**: 어떤 맥락으로 어떤 결정을 내렸는지 로그화
- **Recovery typing**: 실패를 재시도 가능/인간 개입 필요/정책 차단으로 구분
- **Context redaction**: 불필요한 민감정보 제거

특히 A2A 환경에서는 보조 에이전트에게 너무 많은 맥락을 넘기는 순간, 보안 문제와 비용 문제가 동시에 커집니다. 그래서 앞으로의 백엔드 보안은 요청 인증만으로 끝나지 않습니다. **"이 에이전트가 지금 이 작업을 위해 이 정보까지 볼 필요가 있는가"** 가 핵심 질문이 됩니다.

이건 Zero Trust가 사람과 서비스 사이를 넘어, **에이전트와 컨텍스트 사이로 확장되는 것**에 가깝습니다.

## 7. 시니어 엔지니어의 역할은 더 어려워진다. 대신 더 중요해진다

CIO와 각종 업계 분석이 공통적으로 말하는 것도 결국 같은 방향입니다. 엔지니어는 점점 더 직접 구현만 하는 사람이 아니라, **AI 에이전트·도구·서비스·정책을 조율하는 시스템 설계자**가 됩니다.

여기서 중요한 오해를 하나 걷어내야 합니다. 이 변화는 엔지니어의 가치가 줄어든다는 뜻이 아닙니다. 오히려 반대입니다.

코드를 직접 500줄 쓰는 일의 상대적 가치가 줄어드는 대신, 아래 능력의 가치가 커집니다.

- 시스템 경계를 잘 자르는 능력
- 정책과 권한을 설계하는 능력
- 실패를 분류하고 복구 루프를 설계하는 능력
- 에이전트에게 줄 맥락을 압축하고 구조화하는 능력
- 다중 실행 주체의 책임 소재를 명확하게 만드는 능력

다르게 말하면, **문법보다 계약이 중요해지고, 함수보다 경계가 중요해지며, 구현보다 오케스트레이션이 중요해집니다.**

이건 유행어가 아니라 구조적 변화입니다.

## 결론: 2026년의 백엔드는 "컨텍스트 제어면(Control Plane)" 이다

제가 보기에 2026년의 강한 팀은 더 많은 API를 가진 팀이 아닙니다. 더 좋은 프롬프트를 가진 팀도 아닙니다.

강한 팀은 아래를 설계할 수 있는 팀입니다.

- 에이전트에게 어떤 맥락을 언제 줄지
- 어떤 계약으로 툴과 에이전트를 연결할지
- 어떤 역할을 어떤 전문 에이전트에게 위임할지
- 어떤 권한은 자동 실행하고 어떤 권한은 인간 승인으로 넘길지
- 실패했을 때 어디서부터 복구할지

그래서 제 표현으로 정리하면 이렇습니다.

- **MCP는 툴 호출 규격이 아니라 맥락 공급 계약이다.**
- **A2A는 에이전트 채팅이 아니라 책임 분배 프로토콜이다.**
- **백엔드는 데이터 저장소가 아니라 컨텍스트 제어면이 된다.**

앞으로의 제품 차별화는 모델을 붙였느냐가 아니라, **맥락을 얼마나 정확하고 안전하고 경제적으로 흘려보내느냐**에서 결정됩니다.

그게 바로 지금, Context Engineering을 프롬프트 장인이 아니라 **백엔드 아키텍트의 핵심 역량**으로 봐야 하는 이유입니다.

## 실무 체크리스트

마지막으로, 지금 팀에 바로 적용해볼 체크리스트를 남깁니다.

1. MCP 툴 설명이 "사실 설명"이 아니라 "행동 가능한 의미"를 담고 있는가?
2. 에이전트에 전달하는 컨텍스트가 역할별로 최소화되어 있는가?
3. A2A 위임 시 권한, 검증 책임, 맥락 범위가 분리되어 있는가?
4. 재시도와 인간 개입이 필요한 실패 유형을 구분하고 있는가?
5. 에이전트 로그에 의사결정 근거와 사용된 컨텍스트가 남는가?
6. 토큰 예산과 보안 예산을 별개가 아니라 하나의 아키텍처 문제로 다루고 있는가?

이 여섯 가지에 선명하게 답하지 못한다면, 당신의 에이전트 시스템은 아직 모델 데모에 가깝고, 제품 아키텍처라고 부르기 어렵습니다.

<!--
Self-Critique:
- 어제 글의 브라우저/로컬 런타임 관점과 겹치지 않도록, 오늘은 MCP/A2A와 context contract 중심으로 주제를 재구성했다.
- 단순 트렌드 요약 대신 백엔드 책임 재정의, context budget, governance 내장화처럼 구조적 논점을 강화했다.
- 코드 예시는 "툴 호출" 자체보다 "행동 가능한 맥락 반환"과 "계약된 상태 조립"을 보여주도록 수정해 실무성을 높였다.
- 결론부에 실무 체크리스트를 추가해 읽고 끝나는 글이 아니라 설계 점검용 글이 되도록 다듬었다.
-->