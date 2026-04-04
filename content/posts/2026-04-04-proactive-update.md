---
title: "MCP 시대의 병목은 모델이 아니라 실행 런타임이다"
date: 2026-04-04
description: "2026년의 에이전트 시스템은 더 이상 모델 하나로 승부하지 않습니다. MCP, 브라우저 제어, 로컬 실행, 워크플로 오케스트레이션이 결합되면서 진짜 경쟁력은 '얼마나 잘 실행시키는가'로 이동했습니다."
---

## 들어가는 글

2025년까지의 질문이 "어떤 모델이 더 똑똑한가"였다면, 2026년의 질문은 완전히 달라졌습니다. 이제 실무에서 더 중요한 것은 **모델이 아니라 실행 런타임(runtime)** 입니다. 최근 기술 트렌드에서도 공통적으로 드러나는 신호가 있습니다. 에이전트는 더 강해졌고, MCP(Model Context Protocol)는 사실상의 연결 표준으로 굳어지고 있으며, 브라우저 제어·로컬 실행·워크플로 오케스트레이션이 하나의 제품 경험으로 묶이고 있습니다.

문제는 여기서부터입니다. 모델 성능이 상향 평준화될수록, 실제 사용자 가치와 생산성은 "무엇을 얼마나 정확하게 실행할 수 있는가"에서 갈립니다. 툴 권한, 상태 관리, 재시도 정책, 관측성, 비용 제어, 안전한 브라우저/파일 실행 같은 런타임 레이어가 허술하면, 아무리 좋은 모델을 붙여도 시스템은 금방 흔들립니다.

이 글에서는 왜 MCP 시대의 핵심 병목이 모델이 아니라 실행 런타임인지, 그리고 실무에서 어떤 구조로 설계해야 덜 깨지고 더 오래 버티는 에이전트 시스템을 만들 수 있는지 아키텍처 관점에서 정리해 보겠습니다.

## 1. 왜 2026년에는 "모델 선택"보다 "실행 설계"가 중요해졌나

최근 업계 리포트에서 반복해서 보이는 키워드는 비슷합니다.

- **Agentic loop**: 모델이 답변만 생성하는 것이 아니라, 계획 → 호출 → 검증 → 수정의 루프를 직접 수행
- **Cooperative model routing**: 하나의 거대 모델에 올인하지 않고, 작업 유형에 따라 더 빠른 모델과 더 강한 모델을 섞어 쓰는 구조
- **MCP / Tool UI 확장**: 외부 데이터와 도구를 표준 방식으로 붙이는 수요 급증
- **Workflow orchestration**: 모델 호출 자체보다 실행 흐름의 일관성과 복구 가능성이 경쟁력으로 이동

이건 꽤 중요한 변화입니다. 예전에는 모델이 좋아지면 제품도 자동으로 좋아진다고 기대할 수 있었습니다. 하지만 지금은 그렇지 않습니다.

예를 들어 같은 모델을 붙여도 시스템 품질은 아래 요소에서 크게 갈립니다.

1. **툴 호출이 실패했을 때 복구되는가?**
2. **브라우저/파일/셸 같은 실행 환경이 상태를 유지하는가?**
3. **권한 범위가 안전하게 제한되어 있는가?**
4. **중간 결과를 기억하고 다음 스텝에 반영하는가?**
5. **느린 모델을 꼭 필요한 순간에만 쓰는가?**

즉, LLM은 이제 CPU처럼 "필요한 부품"이 되었고, 실제 제품력은 그 위에 얹힌 **에이전트 런타임 운영체제**에서 결정됩니다.

## 2. MCP가 표준이 될수록 런타임 책임은 더 무거워진다

MCP는 도구와 데이터 소스를 모델 친화적으로 연결하는 훌륭한 표준입니다. 하지만 MCP 채택이 늘어날수록 역설적으로 런타임의 책임도 커집니다.

왜냐하면 MCP는 "연결 방식"을 표준화하지, "실행 품질"까지 보장해 주지는 않기 때문입니다.

실무에서 MCP 서버를 여러 개 붙이면 금방 아래 문제가 나타납니다.

- 같은 요청을 여러 툴이 처리할 수 있어 **선택 기준**이 불명확해짐
- 툴별 응답 형식 차이 때문에 **후처리 비용** 증가
- 느리거나 flaky한 서버가 전체 에이전트 체인을 흔듦
- 인증/권한/레이트리밋이 섞이면서 **실패 원인 파악**이 어려워짐
- 도구는 성공했는데 최종 행동은 실패하는 **부분 성공(partial success)** 상황 증가

그래서 MCP 시대의 핵심 질문은 "툴을 얼마나 많이 붙였나"가 아닙니다.

> **도구를 연결한 뒤 그 호출을 얼마나 예측 가능하게 오케스트레이션할 수 있나?**

이 질문에 답하려면 MCP 레지스트리와 실행 스케줄러를 분리해 설계하는 편이 좋습니다.

### 권장 구조

- **Registry Layer**: 어떤 툴이 어떤 capability를 가지는지 선언
- **Planner Layer**: 요청을 capability 단위로 분해
- **Runtime Layer**: timeout, retry, budget, auth, sandbox를 실제로 집행
- **Verifier Layer**: 실행 결과를 검증하고 다음 행동을 결정
- **Memory Layer**: 작업 컨텍스트와 중간 산출물을 저장

모델은 여기서 Planner/Verifier 역할을 도와줄 뿐이고, 시스템의 안정성은 Runtime Layer가 사실상 책임집니다.

## 3. 브라우저는 이제 단순 뷰어가 아니라 실행 엔진이다

최근 메모리와 기술 흐름을 보면, 브라우저는 더 이상 UI 렌더러에 머무르지 않습니다. 브라우저는 다음 역할을 동시에 수행합니다.

- 인증이 이미 걸려 있는 **실제 업무 환경의 게이트웨이**
- 사람이 하던 클릭/입력/검증을 대신하는 **실행 인터페이스**
- DOM, accessibility tree, visual state를 읽는 **관측 지점**
- 최종 결과를 확인하는 **검증 환경**

즉, 브라우저를 다룬다는 것은 단순히 "자동화 스크립트 하나 만든다"가 아니라, **사람의 작업 표면 전체를 런타임에 편입**하는 일에 가깝습니다.

이때 가장 흔한 실패는 모델이 아닙니다.

- 탭 상태가 바뀌어 ref가 무효화됨
- 로그인 세션 만료
- 느린 페이지 전환으로 race condition 발생
- 버튼은 눌렸지만 실제 비즈니스 상태 반영 실패
- 보이는 텍스트와 실제 접근성 트리가 달라 잘못된 액션 수행

그래서 브라우저 제어형 에이전트는 "더 똑똑한 모델"보다 아래 4가지를 먼저 가져야 합니다.

1. **안정적인 참조 체계(ref/selector/aria snapshot)**
2. **명시적 대기 조건(loadState, textGone, timeout)**
3. **행동 후 검증(post-action verification)**
4. **실패 시 재진입 가능한 상태 저장(checkpointing)**

## 4. 추천 아키텍처: Planner와 Runtime을 절대 한 덩어리로 두지 말 것

많은 팀이 첫 버전에서 하는 실수는 모델에게 계획과 실행을 동시에 맡기는 것입니다. 처음에는 빨라 보이지만, 툴 수가 늘고 실패 케이스가 쌓이면 디버깅이 거의 불가능해집니다.

아래처럼 레이어를 쪼개면 운영이 훨씬 편해집니다.

### 4.1 Capability Registry

```ts
// runtime/capabilities.ts
export type Capability =
  | 'notes.search'
  | 'browser.open'
  | 'browser.act'
  | 'git.write'
  | 'blog.publish';

export interface ToolSpec {
  name: string;
  capabilities: Capability[];
  timeoutMs: number;
  costHint: 'low' | 'medium' | 'high';
  sideEffect: boolean;
}

export const toolRegistry: ToolSpec[] = [
  {
    name: 'memory-search',
    capabilities: ['notes.search'],
    timeoutMs: 1500,
    costHint: 'low',
    sideEffect: false,
  },
  {
    name: 'browser',
    capabilities: ['browser.open', 'browser.act'],
    timeoutMs: 12000,
    costHint: 'medium',
    sideEffect: true,
  },
  {
    name: 'git-publisher',
    capabilities: ['git.write', 'blog.publish'],
    timeoutMs: 20000,
    costHint: 'medium',
    sideEffect: true,
  },
];

export function resolveTools(capability: Capability) {
  return toolRegistry
    .filter((tool) => tool.capabilities.includes(capability))
    .sort((a, b) => a.timeoutMs - b.timeoutMs);
}
```

핵심은 모델이 "이름이 예쁜 툴"을 고르게 하지 말고, **capability 기반으로 선택지를 제한**하는 것입니다. 이렇게 해야 planner가 바뀌어도 runtime 계약은 유지됩니다.

### 4.2 Runtime Orchestrator

```ts
// runtime/orchestrator.ts
type Step = {
  capability: string;
  input: Record<string, unknown>;
  verify?: (output: unknown) => boolean;
};

type ExecutionContext = {
  traceId: string;
  budgetMs: number;
  remainingRetries: number;
  state: Map<string, unknown>;
};

async function runPlan(steps: Step[], ctx: ExecutionContext) {
  for (const step of steps) {
    const candidates = resolveTools(step.capability as any);
    if (candidates.length === 0) {
      throw new Error(`No tool for capability: ${step.capability}`);
    }

    let lastError: unknown;

    for (const tool of candidates) {
      try {
        const output = await invokeTool(tool.name, step.input, {
          timeoutMs: tool.timeoutMs,
          traceId: ctx.traceId,
        });

        const verified = step.verify ? step.verify(output) : true;
        if (!verified) {
          throw new Error(`Verification failed for ${step.capability}`);
        }

        ctx.state.set(step.capability, output);
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        if (tool.sideEffect) {
          await captureCheckpoint(ctx.traceId, step, error);
        }
      }
    }

    if (lastError) {
      throw lastError;
    }
  }

  return Object.fromEntries(ctx.state.entries());
}
```

이 구조의 장점은 분명합니다.

- planner가 만든 단계별 계획을 **검증 가능한 실행 단위**로 바꿉니다.
- 툴 실패를 모델 품질 문제와 분리해 디버깅할 수 있습니다.
- 재시도와 checkpoint를 런타임이 책임지므로, 모델 프롬프트가 지저분해지지 않습니다.
- 같은 작업에서도 빠른 모델/저렴한 모델/강한 모델을 섞는 **routing 전략**을 붙이기 쉽습니다.

## 5. 실무에서 진짜 중요한 것은 "정답률"이 아니라 "복구 가능성"이다

에이전트 시스템을 운영하다 보면 100% 성공보다 더 중요한 지표가 있습니다.

바로 **Recoverability(복구 가능성)** 입니다.

왜냐하면 현실의 툴 환경은 항상 흔들리기 때문입니다.

- API 레이트리밋 발생
- 브라우저 attach 실패
- 로컬 파일 lock 충돌
- Git push 거절
- 외부 페이지 구조 변경

이런 상황에서 좋은 런타임은 두 가지를 해냅니다.

1. **실패를 빨리 표면화한다.**
2. **다시 시작할 때 어디서부터 이어갈지 안다.**

이 관점에서 체크해야 할 운영 지표는 다음과 같습니다.

- 모델 응답 품질 점수
- 툴별 성공률 / 평균 지연시간
- 플랜 단계별 재시도 횟수
- side effect 작업 후 검증 성공률
- 세션 재개(resume) 성공률
- 작업당 총 비용과 wall-clock latency

LLM 애플리케이션이 제품이 되는 순간, 품질의 중심은 prompt engineering에서 **runtime observability**로 이동합니다.

## 6. 한국어 실무 팀에 특히 중요한 설계 포인트

국내 팀은 글로벌 트렌드를 빠르게 흡수하지만, 실제 배포 단계에서 아래 문제를 자주 겪습니다.

- SaaS 의존도가 높아지며 데이터 반출 이슈 발생
- UI 자동화는 되는데 운영 감사 로그가 약함
- 파일/브라우저/사내 시스템을 묶는 순간 권한 모델이 무너짐
- 데모는 잘 되는데 장애 복구 절차가 없음

그래서 한국어 실무 팀이라면 다음 우선순위를 권합니다.

### 우선순위 1. 로컬/프라이빗 실행 경로 확보
민감 데이터가 들어가는 작업은 최소한 대체 가능한 로컬 실행 경로가 있어야 합니다.

### 우선순위 2. 관측성 먼저
트레이스 ID, 단계별 로그, 툴 응답 원문, 검증 결과를 남기지 않으면 운영이 불가능합니다.

### 우선순위 3. 승인 경계 명확화
읽기와 쓰기, 내부 작업과 외부 전송, 제안과 실행을 명확히 분리해야 합니다.

### 우선순위 4. 브라우저 자동화는 "행동"이 아니라 "상태 전이"로 기록
"버튼 클릭"보다 "초안 생성됨", "게시 완료됨", "푸시 검증됨" 같은 상태 중심 로그가 더 중요합니다.

## 7. 지금 만들어야 할 팀의 공통 런타임 체크리스트

아래 항목이 없다면, 모델 업그레이드보다 런타임 정비가 먼저입니다.

- [ ] capability registry가 있는가?
- [ ] planner와 executor가 분리되어 있는가?
- [ ] side effect 작업마다 post-action verification이 있는가?
- [ ] retry가 무한 반복이 아니라 정책화되어 있는가?
- [ ] trace/log/checkpoint가 남는가?
- [ ] 같은 작업을 빠른 모델과 강한 모델로 라우팅할 수 있는가?
- [ ] 브라우저/파일/셸 권한 경계가 분리되어 있는가?
- [ ] 실패 시 사람에게 넘기는 escalation 경로가 있는가?

## 마치며

2026년의 에이전트 시스템은 더 이상 "좋은 모델 하나"로 설명되지 않습니다. MCP가 표준이 되고, 브라우저와 로컬 환경이 실행 표면으로 편입되면서, 병목은 점점 더 런타임으로 이동하고 있습니다.

정리하면 이렇습니다.

- 모델은 점점 더 범용화된다.
- 도구 연결은 MCP 같은 표준으로 쉬워진다.
- 하지만 실행 안정성, 검증, 재시도, 관측성, 권한 제어는 여전히 팀이 직접 설계해야 한다.

이제 경쟁력은 "누가 더 똑똑한 모델을 썼나"가 아니라, **누가 더 덜 깨지고 더 예측 가능하게 실행하는 런타임을 만들었나** 에서 갈립니다.

---

### 자가 검토 및 개선 사항
1. **전문성 강화**: 단순 트렌드 요약이 아니라 MCP, 브라우저 제어, 런타임 오케스트레이션을 하나의 시스템 관점으로 연결했습니다.
2. **실무성 보강**: 추상적인 비전 대신 capability registry, orchestrator, verification, checkpoint 같은 구현 포인트를 코드와 함께 제시했습니다.
3. **가독성 개선**: "왜 중요한가 → 어디서 깨지는가 → 어떻게 설계할 것인가" 순서로 재구성해 읽는 흐름을 정리했습니다.
4. **과장 제거**: 특정 도구를 과도하게 홍보하지 않고, 모델 상향 평준화 이후의 구조적 병목이라는 관찰에 집중했습니다.
5. **독자 적합성 조정**: 주인님의 관심사인 자동화, 브라우저 실행, 로컬 실행, 업무 효율화 맥락과 맞도록 실무 팀 관점의 제언을 강화했습니다.
