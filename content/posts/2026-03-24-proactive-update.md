---
title: "Agent Harness의 승부처는 모델이 아니라 Replayable Memory다: 왜 2026년 코딩 에이전트는 실행 로그를 먼저 설계해야 하는가"
date: 2026-03-24
tags: ["AI", "Agentic Engineering", "Coding Agents", "Memory", "Observability", "Architecture"]
---

# Agent Harness의 승부처는 모델이 아니라 Replayable Memory다: 왜 2026년 코딩 에이전트는 실행 로그를 먼저 설계해야 하는가

2026년 3월의 흐름을 보면, 이제 시장의 초점은 더 이상 “어느 모델이 더 똑똑한가”에만 머물지 않습니다. GitHub Trending에서 `bytedance/deer-flow`, `browser-use/browser-use`, 각종 Claude Code 스킬 저장소가 동시에 강세를 보이고 있고, Hacker News에서는 **코딩 에이전트 생산성**, **에이전트용 지식 베이스**, **실행 반복성(repeatability)** 에 대한 논의가 빠르게 커지고 있습니다.

이 신호들을 하나로 묶으면 제 결론은 명확합니다.

> **이제 코딩 에이전트의 경쟁력은 모델 IQ보다, 작업을 얼마나 재현 가능하게 기록하고 복기하고 개선할 수 있느냐에 달려 있습니다.**

즉, 다음 라운드의 승부처는 단순한 tool calling이 아니라 **Replayable Memory** 입니다.

오늘은 왜 이 개념이 코딩 에이전트 운영의 핵심으로 떠오르는지, 그리고 실제 제품/내부 플랫폼에서 어떤 구조로 설계해야 하는지 Deep Dive 해보겠습니다.

---

## 1. 최근 트렌드가 말하는 것: “실행하는 에이전트” 다음 병목은 “기억하는 에이전트”다

요즘 뜨는 프로젝트들을 보면 방향이 꽤 일관됩니다.

- `deer-flow` 계열은 샌드박스, 스킬, 메모리, 서브에이전트, 메시지 게이트웨이를 묶어 **장시간 작업을 버티는 harness** 를 강조합니다.
- `browser-use`는 브라우저를 에이전트가 조작 가능한 실행 환경으로 바꿉니다.
- Mozilla의 `Cq` 같은 시도는 사람이 Stack Overflow를 보듯, **에이전트가 문제 해결 히스토리를 재사용** 하는 층을 만들려 합니다.
- 커뮤니티의 Claude Code/Codex 운영 팁도 결국 비슷한 결론으로 수렴합니다. “모델을 더 갈아 끼우는 것”보다 **작업 맥락 정리, 스킬 구조화, 실패 복기, 재시도 루프** 가 생산성을 더 크게 좌우한다는 겁니다.

이건 중요한 구조적 변화입니다.

1세대 에이전트의 핵심 질문은 이거였습니다.

- LLM이 툴을 호출할 수 있는가?
- 파일을 읽고 수정할 수 있는가?
- 브라우저를 조작할 수 있는가?

하지만 2세대, 특히 **실제 코딩 작업을 맡기는 에이전트** 의 질문은 달라집니다.

- 지난번 실패 원인을 기억하는가?
- 중간 가설과 시도 내역이 남는가?
- 다른 에이전트가 그 작업을 이어받을 수 있는가?
- 결과를 재현하고 평가할 수 있는가?

즉, 실행 능력만으로는 부족합니다. **기억의 형식이 곧 생산성의 형식** 이 됩니다.

---

## 2. 왜 일반적인 “채팅 히스토리”로는 부족한가

많은 팀이 아직도 에이전트 메모리를 “이전 대화 몇 턴 더 넣기” 정도로 이해합니다. 하지만 코딩 작업에서는 이 접근이 거의 항상 한계를 드러냅니다.

이유는 단순합니다. 코딩 작업의 핵심 상태는 대화문이 아니라 **행동과 결과** 에 있기 때문입니다.

예를 들어 에이전트가 어떤 버그를 고친다고 해봅시다.

필요한 정보는 단순히 “무슨 얘기를 했는가”가 아닙니다.

- 어떤 파일을 열었는가
- 어떤 가설을 세웠는가
- 어떤 테스트를 실행했는가
- 어떤 에러가 났는가
- 어떤 패치를 적용했다가 되돌렸는가
- 어떤 조건에서 실패가 재현됐는가

이런 상태를 대화 히스토리에 섞어 넣으면 세 가지 문제가 생깁니다.

### 2.1 중요 신호와 잡음이 분리되지 않는다

채팅 로그에는 계획, 잡담, 결과 보고, 도구 출력, 에러, 자기 반성까지 다 섞입니다. 나중에 다른 에이전트가 이걸 다시 읽으면 **무엇이 사실이고 무엇이 해석인지** 구분하기 어렵습니다.

### 2.2 재현 가능성이 없다

“아까 pytest에서 실패했다”는 문장과, **정확히 어떤 명령을 어떤 시점에 어떤 exit code로 실행했는지** 는 전혀 다릅니다. 운영 가능한 시스템에는 후자가 필요합니다.

### 2.3 평가 루프를 만들 수 없다

좋은 harness는 “이번 작업이 왜 성공/실패했는가”를 나중에 집계할 수 있어야 합니다. 그런데 정보가 전부 자유 텍스트 대화에 묻혀 있으면, 나중에 통계·품질 평가·자동 개선이 거의 불가능해집니다.

그래서 코딩 에이전트에서 메모리는 채팅이 아니라 **event log** 여야 합니다.

---

## 3. Replayable Memory란 정확히 무엇인가

제가 말하는 Replayable Memory는 단순한 벡터 검색이나 요약 메모가 아닙니다. 정의를 짧게 내리면 이렇습니다.

> **Replayable Memory는 에이전트의 작업 과정을 “누가, 언제, 어떤 맥락에서, 무슨 가설로, 어떤 액션을 실행했고, 그 결과가 어땠는지” 재생 가능한 형태로 기록한 실행 메모리다.**

핵심은 세 가지입니다.

1. **구조화되어 있어야 한다**
2. **시간 순서가 보존되어야 한다**
3. **다른 실행 주체가 이어받을 수 있어야 한다**

아래처럼 최소 이벤트 스키마를 두는 것만으로도 품질이 많이 달라집니다.

```ts
type AgentEvent = {
  id: string;
  taskId: string;
  actor: "planner" | "coder" | "reviewer" | "browser-agent";
  phase:
    | "plan"
    | "inspect"
    | "edit"
    | "test"
    | "review"
    | "rollback"
    | "handoff";
  kind:
    | "hypothesis"
    | "command"
    | "file_change"
    | "test_result"
    | "observation"
    | "decision"
    | "error";
  summary: string;
  details?: Record<string, unknown>;
  createdAt: string;
};
```

예를 들면 이런 식으로 남길 수 있습니다.

```ts
const event: AgentEvent = {
  id: crypto.randomUUID(),
  taskId: "bugfix-4312",
  actor: "coder",
  phase: "test",
  kind: "test_result",
  summary: "checkout e2e 테스트가 payment step에서 실패",
  details: {
    command: "pnpm test:e2e checkout.spec.ts",
    exitCode: 1,
    failedAssertion: "expected status 200, received 500",
    suspectFile: "src/server/payment/createIntent.ts"
  },
  createdAt: new Date().toISOString()
};
```

이 구조를 도입하면 메모리가 단순 회상용이 아니라 **실행 재생용 자산** 이 됩니다.

---

## 4. 실전 아키텍처: 코딩 에이전트 메모리는 4계층으로 나눠야 한다

제가 추천하는 구조는 아래와 같습니다.

```text
[Raw Execution Log]
  - commands
  - tool outputs
  - file diffs
  - test exits
        ↓
[Working Memory]
  - active hypothesis
  - current blockers
  - touched files
  - next actions
        ↓
[Replay Index]
  - similar failures
  - reusable fix patterns
  - prior successful workflows
        ↓
[Evaluation Layer]
  - pass/fail rate
  - rollback frequency
  - tool effectiveness
  - prompt/skill quality signals
```

많은 팀이 Raw Log와 Vector Search만 붙이고 “메모리 구현 완료”라고 생각하는데, 그건 절반짜리입니다.

실무에서 중요한 건 가운데 두 층입니다.

### 4.1 Working Memory

현재 작업을 이어가기 위한 압축 상태입니다.

- 지금 가장 유력한 원인은 무엇인가
- 이미 시도해본 해결책은 무엇인가
- 건드린 파일은 어디인가
- 다음 3개 액션은 무엇인가

이건 사람의 단기 작업 기억과 비슷합니다.

### 4.2 Replay Index

비슷한 과거 사례를 다시 불러오는 층입니다.

- “Next.js hydration mismatch를 이전에 어떻게 고쳤는가?”
- “GitHub Actions flaky test는 어떤 패턴으로 실패했는가?”
- “브라우저 자동화가 로그인 redirect loop에 걸렸을 때 무슨 우회가 먹혔는가?”

이건 단순 semantic search보다 한 단계 더 나아가야 합니다. **에러 형태, 사용한 도구, 성공률, 적용 환경** 같은 메타데이터가 같이 붙어야 진짜 재사용이 됩니다.

---

## 5. 왜 이 구조가 생산성을 크게 바꾸는가

### 5.1 장시간 작업에서 문맥 손실을 줄인다

코딩 에이전트는 생각보다 자주 문맥을 잃습니다.

- 토큰 창이 바뀌거나
- 서브에이전트가 교체되거나
- 작업 시간이 길어지거나
- 다른 모델로 이어받아야 하거나
- 중간에 실패해서 재시도해야 할 때

이때 Replayable Memory가 없으면, 에이전트는 같은 파일을 다시 읽고 같은 테스트를 다시 돌리고 같은 실수를 다시 합니다.

반대로 메모리가 잘 설계되어 있으면 새 실행 주체는 아래만 보고도 바로 진입할 수 있습니다.

```ts
type WorkingMemory = {
  objective: string;
  activeHypotheses: string[];
  blockers: string[];
  touchedFiles: string[];
  lastVerifiedCommand?: string;
  nextBestActions: string[];
};

function summarizeWorkingMemory(events: AgentEvent[]): WorkingMemory {
  const touchedFiles = new Set<string>();
  const activeHypotheses: string[] = [];
  const blockers: string[] = [];
  let lastVerifiedCommand: string | undefined;

  for (const event of events) {
    if (event.kind === "file_change" && typeof event.details?.file === "string") {
      touchedFiles.add(event.details.file);
    }
    if (event.kind === "hypothesis") {
      activeHypotheses.push(event.summary);
    }
    if (event.kind === "error") {
      blockers.push(event.summary);
    }
    if (event.kind === "test_result" && event.details?.exitCode === 0) {
      lastVerifiedCommand = String(event.details.command ?? "");
    }
  }

  return {
    objective: "checkout 500 오류 수정 및 회귀 방지",
    activeHypotheses: activeHypotheses.slice(-3),
    blockers: blockers.slice(-3),
    touchedFiles: [...touchedFiles],
    lastVerifiedCommand,
    nextBestActions: [
      "payment intent 생성 로직에서 null branch 검증",
      "실패 케이스에 대한 단위 테스트 추가",
      "e2e 회귀 재실행"
    ]
  };
}
```

이건 단순 요약이 아닙니다. **작업을 이어받기 위한 실행 상태 복원** 입니다.

### 5.2 실패를 학습 자산으로 바꾼다

좋은 팀과 나쁜 팀의 차이는 실패 횟수가 아니라, 실패가 다음 성공 확률을 얼마나 올려주느냐에 있습니다. 에이전트도 똑같습니다.

예를 들어 이런 집계가 가능해집니다.

- 어떤 테스트가 자주 flaky한가
- 어떤 프롬프트 패턴이 rollback으로 이어지는가
- 어떤 스킬이 수정 성공률을 높이는가
- 어떤 저장소 구조에서 에이전트 오판이 잦은가

즉, Replayable Memory는 개인 메모리가 아니라 **조직의 agent ops 데이터 레이어** 입니다.

---

## 6. MCP/A2A 시대에 왜 더 중요해지는가

최근 며칠간 강하게 보이는 또 하나의 흐름은 멀티 에이전트와 프로토콜 표준화입니다. 그런데 A2A/MCP 환경이 확산될수록 메모리 설계는 오히려 더 중요해집니다.

왜냐하면 에이전트 수가 늘수록 “누가 뭘 했는지”가 더 빨리 불분명해지기 때문입니다.

- planner가 세운 가설과
- coder가 적용한 패치와
- reviewer가 반려한 이유와
- browser agent가 확인한 UI 상태가

한 흐름 안에서 연결되어 있어야 합니다.

그래서 멀티 에이전트 환경에서는 메모리에 최소한 아래 필드가 필요합니다.

```ts
type HandoffPacket = {
  taskId: string;
  from: string;
  to: string;
  objective: string;
  acceptedFacts: string[];
  pendingRisks: string[];
  touchedFiles: string[];
  requiredChecks: string[];
  replayPointer: string;
};
```

여기서 중요한 건 `replayPointer` 입니다. 단순히 “이전 대화를 참고하세요”가 아니라, **정확히 어느 이벤트 구간부터 읽으면 되는지** 를 알려줘야 합니다.

이 구조가 없으면 서브에이전트가 늘어날수록 시스템은 똑똑해지는 게 아니라 혼란스러워집니다.

---

## 7. 운영 관점에서 반드시 넣어야 할 패턴 5가지

### 7.1 Append-only event log

수정 가능한 요약본만 두면 안 됩니다. 요약은 언제든 왜곡될 수 있으므로, 원본 실행 로그는 append-only로 보존해야 합니다.

### 7.2 Diff-aware memory

코딩 작업에서는 “무슨 파일을 읽었는가”보다 **실제로 어떤 diff가 생겼는가** 가 중요합니다. 따라서 파일 변경 이벤트에는 최소 diff 요약이 있어야 합니다.

```ts
type FileChangeDetails = {
  file: string;
  additions: number;
  deletions: number;
  summary: string;
};
```

### 7.3 Test-linked memory

성공/실패 판단은 결국 테스트와 검증 명령에 연결돼야 합니다. “수정 완료” 같은 인간 친화적 문장은 운영 신뢰도를 떨어뜨립니다.

### 7.4 Rollback trace

에이전트 운영에서는 rollback 자체가 실패가 아니라, **위험 통제 능력의 신호** 일 수 있습니다. 그래서 되돌린 이유가 메모리에 남아야 합니다.

### 7.5 Human override logging

사람이 개입해 방향을 바꿨다면 그 사실을 별도 이벤트로 저장해야 합니다. 그래야 나중에 성능 평가 시 “에이전트 단독 성공”과 “인간 보정 성공”을 구분할 수 있습니다.

---

## 8. 흔한 안티패턴: 대부분의 팀이 여기서 무너진다

### 안티패턴 1. 벡터 DB만 붙여놓고 메모리라고 부른다

검색 가능성은 중요하지만, 그 자체가 replayability를 보장하지는 않습니다. 코딩 에이전트에는 **순서, 상태 전이, 검증 결과** 가 필요합니다.

### 안티패턴 2. 모든 툴 출력을 그대로 저장한다

원본 보존은 필요하지만, 그대로 다 넣으면 Working Memory가 오염됩니다. Raw Log와 Working Memory를 분리해야 합니다.

### 안티패턴 3. 성공 사례만 저장한다

실제로는 실패 사례가 더 중요합니다. 특히 “무슨 접근이 안 먹혔는가”는 다음 시도의 탐색 비용을 크게 줄입니다.

### 안티패턴 4. 메모리를 프롬프트 엔지니어링의 일부로만 본다

이건 아키텍처 문제입니다. 저장 구조, 이벤트 스키마, 평가 집계, 권한 분리가 다 들어갑니다.

---

## 9. 제 결론: 앞으로의 코딩 에이전트는 “코드를 쓰는 모델”이 아니라 “실행을 축적하는 시스템”이 된다

지금 시장에서 사람들은 자꾸 어느 모델이 더 잘 짜는지에 시선을 빼앗깁니다. 물론 중요합니다. 하지만 실제 운영 단계로 가면 병목은 금방 다른 곳으로 이동합니다.

- 같은 실패를 반복하지 않게 하는가
- 긴 작업을 끊기지 않고 이어가는가
- 다른 에이전트가 안전하게 넘겨받는가
- 왜 성공했고 왜 실패했는지 조직 차원에서 분석 가능한가

이 질문에 답하는 핵심이 바로 Replayable Memory입니다.

그래서 제 정리는 이렇습니다.

> **2026년의 Agent Harness는 모델 래퍼가 아니라, 실행 로그·작업 기억·재생 인덱스·평가 루프를 갖춘 운영체제에 더 가깝다.**

강한 코딩 에이전트 팀은 더 긴 프롬프트를 가진 팀이 아니라,
**실행을 남기고, 복기하고, 재사용하고, 개선하는 메모리 구조를 가진 팀** 이 될 겁니다.

---

## 실무 체크리스트

이번 주 안에 바로 점검해볼 항목만 추리면 아래 7가지입니다.

1. 에이전트의 명령 실행, 파일 수정, 테스트 결과가 event log로 구조화되어 있는가?
2. Raw Log와 Working Memory가 분리되어 있는가?
3. 실패 원인과 rollback 사유가 검색 가능하게 남아 있는가?
4. 서브에이전트 handoff 시 replay pointer를 전달하는가?
5. 성공/실패를 자유 문장이 아니라 검증 명령 기준으로 판정하는가?
6. 비슷한 버그/실패 패턴을 replay index에서 다시 꺼내올 수 있는가?
7. 메모리 데이터를 품질 평가와 스킬 개선 루프에 실제로 연결하고 있는가?

이 일곱 가지에 답하지 못한다면, 당신의 코딩 에이전트는 아직 “툴을 호출하는 데모”일 가능성이 높습니다.

진짜 제품 경쟁력은 이제 모델 파라미터가 아니라,
**실행을 얼마나 잘 기억하고 다시 재생할 수 있느냐** 에서 갈릴 겁니다.

<!--
Self-Critique:
- 최근 이틀 글이 MCP/브라우저/컨텍스트 엔지니어링에 집중되어 있어, 오늘은 같은 에이전트 흐름 안에서도 운영 병목인 replayable memory로 초점을 이동했다.
- 단순 트렌드 요약이 아니라 event log, working memory, replay index, evaluation layer로 계층을 분리해 아키텍처적 깊이를 강화했다.
- 코드 예시는 추상 개념 설명용이 아니라 실제 harness 설계 시 바로 참고할 수 있도록 이벤트 스키마, working memory materialization, handoff packet 중심으로 재구성했다.
- 결론부는 “모델 성능 경쟁”보다 “운영 가능한 기억 구조”가 왜 생산성을 좌우하는지 선명하게 드러나도록 문장을 압축하고, 실무 체크리스트를 추가해 실행 가능성을 높였다.
-->
