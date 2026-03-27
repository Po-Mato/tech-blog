---
title: "코딩 에이전트의 다음 병목은 모델이 아니라 브라우저다: MCP 시대의 실행·검증 아키텍처"
date: 2026-03-27
tags: ["AI", "Browser Automation", "MCP", "Architecture", "TypeScript", "Coding Agents"]
---

# 코딩 에이전트의 다음 병목은 모델이 아니라 브라우저다: MCP 시대의 실행·검증 아키텍처

지난 한 달 동안 반복적으로 보이는 신호가 있습니다. **브라우저 제어 도구의 고도화**, **MCP(Model Context Protocol) 기반 도구 표준화**, 그리고 **에이전트 결과를 브라우저에서 직접 검증하려는 흐름** 입니다. `agent-browser`, `chrome-devtools-mcp`, 그리고 멀티 에이전트 오케스트레이션 계열 도구들은 서로 다른 층위의 프로젝트처럼 보이지만, 실은 같은 방향을 가리킵니다.

> **이제 브라우저는 “출력물을 확인하는 최종 화면”이 아니라, 코딩 에이전트의 실행과 검증이 만나는 런타임 계층이 되고 있습니다.**

많은 팀이 아직도 에이전트 시스템을 이렇게 생각합니다.

```text
LLM -> code patch 생성 -> CI 실행 -> 성공/실패 반환
```

이 모델은 너무 낙관적입니다. 실제 제품 개발에서는 CI 이전에 훨씬 많은 문제가 터집니다.

- 버튼은 렌더됐지만 클릭할 수 없는 상태일 수 있다.
- API는 200인데 hydration mismatch 때문에 화면이 깨질 수 있다.
- 기능은 동작하지만 성능 회귀가 발생할 수 있다.
- 수정은 맞지만 기존 사용자 플로우를 조용히 망가뜨릴 수 있다.

즉, 코드 생성 능력만 높아져서는 부족합니다. **에이전트는 결국 사용자 환경에 가장 가까운 실행 표면(surface)에서 결과를 확인해야** 합니다. 그 표면이 바로 브라우저입니다.

오늘은 이 변화를 “툴이 하나 더 생겼다” 수준이 아니라, **에이전트 시스템 아키텍처가 어떻게 바뀌어야 하는가** 관점에서 뜯어보겠습니다.

---

## 1. 왜 브라우저가 다시 아키텍처 중심으로 올라오는가

과거 웹 개발에서 브라우저는 대체로 얇은 클라이언트로 취급됐습니다.

```text
Browser = UI renderer
Server = state + logic + search + verification
```

하지만 에이전트 시대에는 이 분리가 어색해집니다. 이유는 간단합니다. 사용자가 최종적으로 경험하는 장애는 서버 로그가 아니라 **렌더링 결과, 상호작용 가능성, 네트워크 타이밍, 콘솔 에러, 레이아웃 안정성** 으로 나타나기 때문입니다.

특히 코딩 에이전트가 실무에 들어오면 브라우저는 다음 역할을 동시에 맡게 됩니다.

1. **Execution Surface** — 실제 사용자 플로우 실행
2. **Verification Surface** — DOM, 네트워크, 콘솔, 성능 흔적 확인
3. **Constraint Surface** — 권한, 세션, CSP, 샌드박스 등 현실 제약 반영
4. **Feedback Surface** — 모델이 다음 수정을 할 근거 수집

여기서 중요한 포인트는 하나입니다.

> **에이전트가 고쳐야 하는 것은 코드 자체가 아니라, 코드가 브라우저에서 만들어내는 행위와 결과다.**

그래서 앞으로의 병목은 “모델이 코드를 얼마나 잘 짜는가”보다, **생성된 코드가 실제 브라우저 상태와 얼마나 빠르게 닫힌 루프를 이루는가** 쪽으로 이동합니다.

---

## 2. MCP가 중요한 이유: 도구 호출의 표준화보다 ‘검증 루프의 정규화’가 더 크다

MCP를 단순히 “도구를 붙이는 프로토콜” 정도로 보면 절반만 본 겁니다. 진짜 변화는 모델이 브라우저, 파일시스템, DevTools, 테스트 러너 같은 주변 능력을 **일관된 계약(contract)** 으로 다루게 된다는 점입니다.

이게 왜 중요할까요?

이전 세대 에이전트는 보통 다음과 같은 안티패턴을 가졌습니다.

- 셸 스크립트에 강하게 묶인 ad-hoc 자동화
- 결과가 문자열 로그로만 남아 구조화가 약함
- 같은 실패를 반복해도 상태를 일반화하지 못함
- 도구별 예외 처리 방식이 제각각임

반면 MCP 기반 접근은 적어도 다음을 가능하게 합니다.

- **도구 능력(capability)을 명시적으로 선언**
- **입출력을 구조화**
- **실패 원인을 브라우저/네트워크/성능/권한 문제로 분류**
- **다음 추론 단계가 소비하기 쉬운 관찰 결과를 반환**

즉, MCP의 본질은 “툴 연결이 편해진다”가 아니라, **에이전트가 세상을 더 규격화된 방식으로 관측하고 수정할 수 있게 된다**는 데 있습니다.

특히 브라우저 계층과 결합되면 파급력이 큽니다. `chrome-devtools-mcp` 류 접근은 단순 클릭 자동화를 넘어서,

- 네트워크 요청
- 콘솔 에러
- 퍼포먼스 트레이스
- 화면 스냅샷
- DOM 상태

를 같은 작업 맥락 안에 넣어줍니다.

이 순간 에이전트는 “버튼을 클릭했다” 수준이 아니라, **“버튼 클릭 이후 어떤 요청이 나갔고, 어떤 콘솔 오류가 났고, 그 결과 LCP와 레이아웃이 어떻게 변했는지”** 까지 동일한 검증 루프 안에서 다룰 수 있습니다.

---

## 3. 새 기준: Generate → Execute → Observe → Critique → Patch

이제 코딩 에이전트 파이프라인의 기본형은 아래처럼 바뀌는 게 맞습니다.

```text
Plan
  -> Generate patch
  -> Execute in browser-like environment
  -> Observe DOM/network/console/perf
  -> Critique against task + invariants
  -> Patch again
  -> Escalate to CI only when local/browser checks pass
```

이 구조에서 CI는 여전히 중요합니다. 다만 **최초 검증자** 가 아니라 **최종 승인자** 에 가까워집니다.

실무적으로는 다음 3계층으로 나누는 게 가장 깔끔합니다.

### 계층 A. 생성 계층
- 코드 수정안 생성
- 테스트 보강
- 위험 지점 후보 식별

### 계층 B. 브라우저 실행·관측 계층
- 실제 플로우 재현
- DOM/네트워크/콘솔 상태 수집
- 시각적/상호작용적 회귀 탐지

### 계층 C. 정책·품질 계층
- 접근성 기준
- 성능 예산
- 보안 제약
- 변경 범위 통제

이렇게 설계하면 모델은 “한 번에 정답 코드 쓰기” 부담에서 벗어나고, 시스템은 **빠른 국소 수정(local repair)** 에 강해집니다.

---

## 4. 추천 아키텍처: Browser Verification Bus를 별도 계층으로 두자

제가 보기엔 앞으로 많은 팀이 놓칠 포인트가 하나 있습니다. 브라우저 자동화 도구를 그냥 테스트 러너 옆에 붙이는 정도로는 부족합니다.

브라우저는 **검증 버스(verification bus)** 로 분리하는 편이 낫습니다.

```text
+------------------------+
| Planner / Orchestrator |
+-----------+------------+
            |
            v
+------------------------+
| Patch Generator        |
| - code changes         |
| - test changes         |
+-----------+------------+
            |
            v
+------------------------+
| Browser Verification   |
| Bus                    |
| - DOM snapshot         |
| - console logs         |
| - network traces       |
| - perf metrics         |
| - screenshots          |
+-----------+------------+
            |
            v
+------------------------+
| Critique / Policy      |
| - pass/fail            |
| - rollback suggestion  |
| - next patch hints     |
+------------------------+
```

핵심은 브라우저 관측치를 각 도구의 임시 출력으로 버리지 말고, **에이전트가 다시 추론할 수 있는 구조화된 데이터 자산** 으로 다루는 것입니다.

예를 들면 이런 타입을 둘 수 있습니다.

```ts
export type BrowserObservation = {
  url: string;
  timestamp: string;
  domSummary: {
    missingSelectors: string[];
    interactiveIssues: string[];
    accessibilityWarnings: string[];
  };
  console: Array<{
    level: "log" | "warn" | "error";
    message: string;
    source?: string;
  }>;
  network: Array<{
    method: string;
    url: string;
    status: number;
    durationMs: number;
  }>;
  performance: {
    lcpMs?: number;
    cls?: number;
    tbtMs?: number;
  };
  screenshots: string[];
};
```

이 관찰값을 한 번 모아두면, 다음 모델 호출은 훨씬 날카로워집니다.

- “왜 실패했는지”를 추론할 수 있고
- “다음 수정이 어디를 건드려야 하는지”를 좁힐 수 있고
- “겉보기 성공인데 실제로는 망가진 상태”를 걸러낼 수 있습니다.

즉, 브라우저 자동화의 핵심 가치는 클릭 자체가 아니라 **관찰을 구조화하는 능력** 입니다.

---

## 5. TypeScript 예시 1: 에이전트 패치 결과를 브라우저 관찰값으로 채점하기

아래는 간단한 형태의 브라우저 검증 채점기입니다. 실제로는 `agent-browser`나 DevTools 계열 MCP 서버에서 수집한 결과를 넣어 판단할 수 있습니다.

```ts
export type PatchScore = {
  pass: boolean;
  score: number;
  reasons: string[];
};

export function scoreObservation(obs: BrowserObservation): PatchScore {
  const reasons: string[] = [];
  let score = 100;

  const errorCount = obs.console.filter((item) => item.level === "error").length;
  if (errorCount > 0) {
    score -= errorCount * 15;
    reasons.push(`콘솔 에러 ${errorCount}건 발생`);
  }

  const failedRequests = obs.network.filter((req) => req.status >= 400);
  if (failedRequests.length > 0) {
    score -= failedRequests.length * 10;
    reasons.push(`실패한 네트워크 요청 ${failedRequests.length}건`);
  }

  if ((obs.performance.lcpMs ?? 0) > 2500) {
    score -= 10;
    reasons.push("LCP 예산 초과");
  }

  if ((obs.performance.cls ?? 0) > 0.1) {
    score -= 10;
    reasons.push("CLS 예산 초과");
  }

  if (obs.domSummary.missingSelectors.length > 0) {
    score -= 20;
    reasons.push("필수 셀렉터 누락");
  }

  if (obs.domSummary.interactiveIssues.length > 0) {
    score -= 20;
    reasons.push("상호작용 불능 상태 감지");
  }

  return {
    pass: score >= 80 && reasons.every((reason) => !reason.includes("누락")),
    score: Math.max(0, score),
    reasons,
  };
}
```

이런 식으로 해두면 에이전트는 단순히 “테스트 통과/실패”가 아니라, **어떤 종류의 실패가 발생했는지 의미적으로 분류된 피드백** 을 받습니다. 그리고 이 정보는 다음 패치 프롬프트의 품질을 크게 올립니다.

---

## 6. TypeScript 예시 2: 브라우저 검증 결과를 다음 패치 프롬프트로 압축하기

모델은 raw trace를 그대로 받는 것보다, 실패를 요약한 구조화 맥락을 받는 편이 훨씬 잘 움직입니다.

```ts
export function buildRepairPrompt(
  task: string,
  changedFiles: string[],
  obs: BrowserObservation,
  score: PatchScore,
): string {
  const topConsoleErrors = obs.console
    .filter((item) => item.level === "error")
    .slice(0, 5)
    .map((item) => `- ${item.message}`)
    .join("\n");

  const failedRequests = obs.network
    .filter((req) => req.status >= 400)
    .slice(0, 5)
    .map((req) => `- ${req.method} ${req.url} -> ${req.status}`)
    .join("\n");

  return [
    `Task: ${task}`,
    `Changed files: ${changedFiles.join(", ")}`,
    `Browser verification score: ${score.score}`,
    `Failure reasons: ${score.reasons.join("; ") || "none"}`,
    `Top console errors:\n${topConsoleErrors || "- none"}`,
    `Failed requests:\n${failedRequests || "- none"}`,
    `Missing selectors: ${obs.domSummary.missingSelectors.join(", ") || "none"}`,
    `Interactive issues: ${obs.domSummary.interactiveIssues.join(", ") || "none"}`,
    "Revise the patch with the smallest safe change that restores the user flow without expanding scope.",
  ].join("\n\n");
}
```

여기서 중요한 건 마지막 문장입니다.

> **브라우저 기반 수정 루프는 ‘더 많이 고치는 모델’보다 ‘더 적게, 더 정확히 고치는 모델’을 선호합니다.**

브라우저 관찰값이 강해질수록, 큰 리팩터링보다 **작고 검증 가능한 패치** 가 승률이 높아집니다.

---

## 7. 멀티 에이전트가 붙으면 뭐가 달라지나

MassGen 같은 멀티 에이전트 계열이 시사하는 바도 분명합니다. 앞으로는 하나의 모델이 혼자 답을 내는 구조보다,

- 한 에이전트는 패치를 만들고
- 다른 에이전트는 브라우저에서 검증하고
- 또 다른 에이전트는 성능/보안 기준을 감시하고
- 마지막 에이전트가 합의된 수정안을 채택

하는 식의 분업이 늘어날 겁니다.

이때 브라우저 계층이 더 중요해집니다. 이유는 **합의의 기준점** 이 되기 때문입니다.

모델끼리 서로를 비평하게 하면 말은 그럴듯해질 수 있습니다. 하지만 브라우저 관찰값은 상대적으로 덜 정치적입니다.

- 콘솔 에러가 있나?
- 필수 요소가 나타났나?
- 네트워크 요청이 실패했나?
- 성능 예산을 넘었나?

이런 사실 기반 피드백이 있어야 멀티 에이전트가 “말싸움”이 아니라 **검증 가능한 수렴** 으로 갑니다.

제 의견은 명확합니다.

> **멀티 에이전트의 핵심은 에이전트 수가 아니라, 에이전트들이 공유하는 검증 현실(shared verification reality)을 갖고 있느냐 입니다.**

브라우저는 그 현실을 가장 잘 제공하는 계층입니다.

---

## 8. 보안과 운영: 브라우저를 열어준다고 끝이 아니다

여기서 많은 팀이 과하게 낙관적입니다. 브라우저 제어 능력은 매우 강력하고, 그만큼 위험합니다.

최소한 아래 원칙은 기본값으로 깔아야 합니다.

### 8.1 Capability를 분리하라
- 읽기 전용 탐색
- 클릭/입력 가능
- 파일 업로드 가능
- 인증 세션 접근 가능
- DevTools/네트워크 관찰 가능

이 권한은 한 덩어리로 주면 안 됩니다. “브라우저 접근 가능”은 실제로 다섯 개 이상의 서로 다른 위험 수준을 뜻합니다.

### 8.2 세션 경계를 분리하라
- 실제 사용자 로그인 세션과
- 테스트 계정 세션과
- 완전 격리된 헤드리스 세션

을 반드시 분리해야 합니다. 특히 코딩 에이전트의 자동 수정 루프는 테스트 계정에서 먼저 돌고, 사람 승인 후에만 더 높은 권한 환경으로 올라가는 편이 맞습니다.

### 8.3 관찰 데이터도 민감 정보다
DevTools 계층은 네트워크 payload, 쿠키 맥락, 콘솔 로그, 내부 API 응답 일부를 볼 수 있습니다. 즉 **검증 로그 자체가 민감 정보 저장소** 가 됩니다. 브라우저 관찰값을 장기 보관할 때는 마스킹과 TTL 정책이 필요합니다.

### 8.4 “보이는 성공”과 “실제 성공”을 구분하라
스크린샷 하나가 정상처럼 보여도, 실제로는 클릭이 막혀 있거나 포커스 트랩이 걸려 있거나 스크린 리더에서 망가져 있을 수 있습니다. 브라우저 검증은 스크린샷 중심이 아니라,

- DOM 접근성 트리
- 상호작용 가능 여부
- 네트워크/콘솔 상태
- 성능 지표

를 함께 봐야 합니다.

---

## 9. 도입 전략: 어디까지 자동화하고 어디서 멈춰야 하나

실무에서는 한 번에 “완전 자율 수정 에이전트”로 가려 하면 실패 확률이 높습니다. 단계적으로 가는 편이 좋습니다.

### 1단계 — Browser-aware QA Agent
- 코드 수정 권한 없이
- 브라우저 실행과 관찰만 수행
- 버그 재현 및 보고 자동화

이 단계만으로도 가치가 큽니다. 팀은 어떤 종류의 프런트 장애가 자주 발생하는지 빠르게 패턴을 잡을 수 있습니다.

### 2단계 — Suggest-only Repair Agent
- 수정안은 제안만 하고
- 브라우저 검증 결과와 함께 diff를 제출
- 사람 승인 후 병합

대부분의 팀은 여기서 이미 ROI가 나옵니다.

### 3단계 — Scoped Auto-fix Agent
- 스타일/문구/소규모 UI 플로우 등
- 영향 범위가 작은 패치만 자동 반영
- 브라우저 검증 + 테스트 + 정책 통과 시 자동 머지

핵심은 **변경 범위가 작은 영역부터 자동화** 하는 것입니다.

### 4단계 — Policy-driven Multi-agent Repair
- 패치, 검증, 성능, 보안 에이전트 분리
- 공통 Browser Verification Bus 기반 합의
- 사람이 예외 정책과 권한 경계만 관리

이 단계는 가능하지만, 생각보다 운영 난도가 높습니다. 브라우저 관찰값 스키마와 권한 분리를 먼저 잘 설계하지 않으면 금방 복잡도에 짓눌립니다.

---

## 10. 제 결론: 2026년 코딩 에이전트 경쟁력은 ‘코드 생성력’보다 ‘브라우저 폐루프(closed loop)’에서 갈린다

앞으로 좋은 코딩 에이전트는 단순히 코드를 잘 쓰는 모델이 아닙니다. **코드 변경이 실제 사용자 경험에 어떤 결과를 만들었는지 빠르게 확인하고, 그 피드백으로 다시 패치를 좁혀가는 시스템** 이 좋은 에이전트입니다.

이 관점에서 보면 최근 흐름은 꽤 선명합니다.

- `agent-browser` 류 도구는 브라우저 조작을 더 쉽게 만든다.
- `chrome-devtools-mcp` 류 도구는 브라우저 내부 상태를 에이전트가 더 풍부하게 관찰하게 만든다.
- 멀티 에이전트 오케스트레이션은 이 관찰 결과를 여러 관점에서 비평하고 수렴하게 만든다.

이 셋이 합쳐지면, 브라우저는 더 이상 끝단 UI가 아닙니다. **브라우저는 에이전트 시스템의 실행·검증·비평을 연결하는 핵심 런타임** 입니다.

제 판단은 단호합니다.

> **이제 코딩 에이전트의 성패는 “어떤 모델을 붙였는가”보다, “브라우저에서 얼마나 짧고 안전한 검증 루프를 만들었는가”에서 갈립니다.**

모델은 계속 좋아질 겁니다. 하지만 모델이 아무리 좋아져도, 브라우저에서 실패한 코드는 결국 실패한 코드입니다.

그래서 다음으로 투자해야 할 곳은 모델 교체 스크립트가 아니라, **Browser Verification Bus, capability 설계, 그리고 작은 패치 중심의 수정 루프** 입니다.

그걸 먼저 만든 팀이, 에이전트를 ‘데모’에서 ‘생산성 시스템’으로 넘길 겁니다.
