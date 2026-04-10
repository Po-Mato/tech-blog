---
title: "Agent SLO: AI Agent를 '신뢰할 수 있는 서비스'로 만드는 런타임 관측성 프레임워크"
date: 2026-04-10
description: "AI Agent를 단순히 '연결'하는 시대는 끝났다. 이제 질문은 '얼마나 신뢰할 수 있는 결과를 내는가'다. 이 글은 Task Success Rate, Time-to-First-Useful-Action, Execution Journal 같은 Agent SLO를 정의하고, 프로덕션 환경에서 이를 지속적으로 측정·개선하는 런타임 관측성 프레임워크를 TypeScript 예시와 함께 정리한다."
tags:
  - AI Agents
  - Agent SLO
  - Execution Journal
  - Observability
  - Production AI
  - System Design
  - TypeScript
---

## 서론: 연결을 넘어 신뢰로

MCP와 A2A 같은 프로토콜이 Agent 간 연결 표준을 만들어가고 있습니다. 하지만 연결이 가능해졌다고 해서 Agent가 **신뢰할 수 있는 서비스**가 된 것은 아닙니다. 마치 마이크로서비스가 HTTP로 연결되지만 SLO 없이는 운영 불가능한 것과 같은 문제입니다.

실무에서 Agent를 운영할 때 가장 먼저 나오는 질문은 이것입니다.

> "이 Agent가 어떤 조건에서, 어떤 비율로, 올바른 결과를 내는가?"

이 질문에 답하려면 전통적인 API 서비스와 같은 관측성 체계가 필요합니다. 바로 **Agent SLO**와 **Execution Journal**입니다.

## 전통적 SLO와 Agent SLO의 근본적 차이

전통적 SLO는 명확합니다. API 서비스라면:

- **Availability**: 99.9% uptime
- **Latency**: p99 < 200ms
- **Error Rate**: < 0.1%

모두 측정 가능하고, 자동화也比较 쉽습니다.

하지만 Agent는 다릅니다. 같은 입력에 대해서도 모델이 매번 다른 출력을 내릴 수 있고, "성공"의 정의 자체가 모호합니다. 그래서 Agent SLO는 **행위적 지표(behavioral metrics)** 와 **산출물 지표(outcome metrics)** 두 축으로 나뉩니다.

### Agent SLO의 다층 구조

```
Agent SLO
├── Availability Layer
│   ├── Agent Uptime: Agent가 응답 가능한 시간 비율
│   ├── Tool Availability: 설정된 도구 중 사용 가능한 비율
│   └── Context Freshness: 세션 컨텍스트가 유효한 비율
│
├── Latency Layer
│   ├── Time to First Token: 첫 응답까지 시간
│   ├── Time to First Tool Call: 첫 도구 호출까지 시간
│   ├── Time to First Useful Action: 실질적 행동 첫 개시 시간
│   └── Total Execution Time: 작업 완수 총 시간
│
├── Quality Layer
│   ├── Task Completion Rate: 완료로 인정된 작업 비율
│   ├── Output Validity Rate: 출력 스키마/형식 유효 비율
│   ├── Self-Correction Rate: 자가 수정 빈도
│   └── Escalation Rate: 사람에게エスカレーション 비율
│
└── Reliability Layer
    ├── Idempotency: 같은 요청 반복 시 일관된 결과 비율
    ├── Rollback Feasibility: 실패 시 이전 상태 복원 가능 비율
    └── Context Preservation Rate: 긴 작업 중 컨텍스트 유지 비율
```

핵심은 **Quality Layer**입니다. 단순히 "응답이 왔다"가 아니라 "의미 있는 결과를 냈다"를 측정해야 합니다.

## Task Completion Rate: 성공의 정의를 내리는 기술

Task Completion Rate(TCR)는 Agent SLO의 핵심입니다. 정의하기 어렵지만, 측정 가능해야 합니다.

### TCR 측정 프레임워크

TCR을 측정하려면 먼저 **task taxonomy**를 만들어야 합니다.

```ts
enum TaskType {
  INFORMATIONAL = "informational",    // 질문 응답, 검색
  TRANSACTIONAL = "transactional",     // 예약, 주문, 알림
  CREATIVE = "creative",              // 글쓰기, 코드 생성
  ANALYTICAL = "analytical",           // 분석, 비교, 추론
  ORCHESTRATION = "orchestration",     // 다단계 워크플로우
}

enum CompletionGrade {
  FULL = "full",           // 완벽히 완료, 추가 조치 불필요
  PARTIAL = "partial",     // 완료는 됐으나 사소한 보완 필요
  FAILED = "failed",       // 명백한 실패
  HUNG = "hung",           // 시간 초과, 응답 없음
  ESCALATED = "escalated", // 사람에게 전달
}

type TaskRecord = {
  taskId: string;
  taskType: TaskType;
  input: Record<string, unknown>;
  startedAt: number;
  completedAt?: number;
  grade: CompletionGrade;
  retryCount: number;
  escalationReason?: string;
  executionJournal: ExecutionEntry[];
};

function calculateTCR(records: TaskRecord[]): {
  overall: number;
  byType: Record<TaskType, number>;
  byGrade: Record<CompletionGrade, number>;
} {
  const total = records.length;

  const gradeCounts = records.reduce((acc, r) => {
    acc[r.grade] = (acc[r.grade] || 0) + 1;
    return acc;
  }, {} as Record<CompletionGrade, number>);

  const byType = Object.values(TaskType).reduce((acc, type) => {
    const typeRecords = records.filter((r) => r.taskType === type);
    const completed = typeRecords.filter(
      (r) => r.grade === CompletionGrade.FULL || r.grade === CompletionGrade.PARTIAL
    );
    acc[type] = typeRecords.length > 0 ? completed.length / typeRecords.length : 0;
    return acc;
  }, {} as Record<TaskType, number>);

  const completed = records.filter(
    (r) => r.grade === CompletionGrade.FULL || r.grade === CompletionGrade.PARTIAL
  );

  return {
    overall: total > 0 ? completed.length / total : 0,
    byType,
    byGrade: gradeCounts,
  };
}
```

이 구조의 핵심은 **task type별로 SLO 기준이 다르다**는 점입니다. INFORMATIONAL은 FULL completion이 높아야 하고, ANALYTICAL은 PARTIAL도容認할 수 있습니다. 모든 태스크에 하나의 성공률을 적용하면 의미 없는 숫자가 됩니다.

## Execution Journal: Agent의飞行データレコーダー

비행기의 black box가 사고 원인을 추적하듯, Agent에게는 **Execution Journal**이 필요합니다. LLM의 reasoning은 블랙박스이지만, **tool calls, decisions, state transitions은 기록 가능**합니다.

### Execution Journal의 구조

```ts
type ExecutionEntry = {
  timestamp: number;
  sequence: number;
  phase: "planning" | "execution" | "verification" | "escalation";
  action: string;
  input: Record<string, unknown>;
  output?: unknown;
  durationMs?: number;
  error?: string;
  contextSnapshot?: {
    memorySize: number;
    toolCount: number;
    conversationTurns: number;
  };
};

type ExecutionJournal = {
  runId: string;
  agentId: string;
  taskType: TaskType;
  startedAt: number;
  entries: ExecutionEntry[];
  finalGrade: CompletionGrade;
  ttl: number; // 레tainment 기간
};

class ExecutionJournalStore {
  private db: /* durable storage */ unknown;

  async append(runId: string, entry: Omit<ExecutionEntry, "sequence">): Promise<void> {
    const fullEntry: ExecutionEntry = {
      ...entry,
      sequence: await this.getNextSequence(runId),
    };
    await this.db.append(runId, fullEntry);
  }

  async getJournal(runId: string): Promise<ExecutionJournal> {
    return await this.db.read(runId);
  }

  async search(opts: {
    agentId?: string;
    taskType?: TaskType;
    grade?: CompletionGrade;
    from?: number;
    to?: number;
    limit?: number;
  }): Promise<ExecutionJournal[]> {
    return await this.db.query(opts);
  }
}
```

Execution Journal이 있으면 무엇이 가능해지냐면, **실패 건만 별도 추출**하여 패턴을 분석할 수 있습니다.

```ts
async function diagnoseFailurePatterns(agentId: string, lookbackDays: number) {
  const from = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  const journals = await journalStore.search({
    agentId,
    from,
    limit: 1000,
  });

  const failed = journals.filter(
    (j) => j.finalGrade === CompletionGrade.FAILED || j.finalGrade === CompletionGrade.HUNG
  );

  // Phase별 실패 빈도 분석
  const phaseFailureCounts = failed.flatMap((j) =>
    j.entries.filter((e) => e.error).map((e) => e.phase)
  ).reduce((acc, phase) => {
    acc[phase] = (acc[phase] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Escalation 사유 분석
  const escalationReasons = failed
    .filter((j) => j.finalGrade === CompletionGrade.ESCALATED)
    .flatMap((j) =>
      j.entries
        .filter((e) => e.action === "escalate")
        .map((e) => e.input.reason as string)
    );

  return { phaseFailureCounts, escalationReasons, totalFailed: failed.length };
}
```

이 결과를 보면 Agent가 어느 단계에서 주로 실패하는지, 어떤 사유로 사람에게 エスカレーション하는지가 데이터로 드러납니다.

## Time-to-First-Useful-Action: 지연의 진짜 원인 찾기

기존 Latency SLO의盲点是 "첫 토큰"은 빠르지만 **실질적 행동**은 느린 경우입니다. 모델이思索만 하고 도구를 호출하지 않으면 사용자는 답을 받지 못합니다.

그래서 필요한 지표가 **Time-to-First-Useful-Action (TTFUA)** 입니다.

```ts
type ActionUtilityScore = {
  action: string;
  utilityScore: number; // 0.0 ~ 1.0
  reasoning: string;
};

async function measureTTFUA(runId: string): Promise<{
  ttft: number;           // Time to First Token (ms)
  ttfua: number;           // Time to First Useful Action (ms)
  uselessActions: number;  // utilityScore < 0.3인 행동 수
  effectiveActions: number;
} | null> {
  const journal = await journalStore.getJournal(runId);
  if (!journal) return null;

  const planningEntry = journal.entries.find((e) => e.phase === "planning");
  const firstExecutionEntry = journal.entries.find(
    (e) => e.phase === "execution" && e.action !== "think"
  );

  if (!planningEntry || !firstExecutionEntry) return null;

  const utilityScores: ActionUtilityScore[] = await scoreActionUtility(
    journal.entries.filter((e) => e.phase === "execution")
  );

  const usefulActions = utilityScores.filter((a) => a.utilityScore >= 0.3);

  return {
    ttft: firstExecutionEntry.timestamp - journal.startedAt,
    ttfua: usefulActions[0]
      ? utilityScores[0].timestamp - journal.startedAt
      : -1,
    uselessActions: utilityScores.filter((a) => a.utilityScore < 0.3).length,
    effectiveActions: usefulActions.length,
  };
}
```

TTFUA가 TTFT보다 훨씬 크면, Agent가思索을 오래하거나 잘못된 도구를 먼저 호출하는 것입니다. 이 데이터로 **planning 프롬프트를 튜닝**하거나 **도구 우선순위를 조정**할 근거가 됩니다.

## Agent SLO Dashboard: 무엇을监控해야 하는가

단순한 dashboard가 아니라 **의사결정에 즉시 연결되는 dashboard**를 만들어야 합니다.

```
┌─────────────────────────────────────────────────────────┐
│  Agent SLO Dashboard                          [Refresh]  │
├──────────────────┬──────────────────┬───────────────────┤
│ Task Completion   │ TTFUA (p50/p99) │ Escalation Rate   │
│ TCR: 87.3% [⚠️]   │ 1.2s / 8.4s [✅] │ 4.1% [✅]          │
├──────────────────┴──────────────────┴───────────────────┤
│  TCR by Task Type                                       │
│  [CREATIVE ████████████░░░░ 72%] [TRANSACTIONAL ███████]│
│  [INFORMATIONAL ██████████████ 96%] [ORCHESTRATION ███] │
├─────────────────────────────────────────────────────────┤
│  Failure Phase Distribution (last 7 days)               │
│  planning  ████████████████  52%                         │
│  execution ████████  28%                                 │
│  verification ████  14%                                  │
│  escalation ██  6%                                       │
└─────────────────────────────────────────────────────────┘
```

이 dashboard에서 **가장 즉각적 행동으로 연결되는 지표**는 TCR by Task Type입니다. CREATIVE가 72%라면 creative 태스크의 프롬프트를 검토해야 합니다. planning phase 실패가 52%라면 planning capability를 높여야 합니다.

## Alerting: SLO Breach에 대한 반응 설계

SLO는 측정이 목적이 아니라 **행동 트리거**가 목적입니다.

```ts
type SLOConfig = {
  taskCompletionRate: { target: number; alertBelow: number; windowDays: number };
  ttlua: { target: number; alertAbove: number; percentile: "p50" | "p99" };
  escalationRate: { target: number; alertAbove: number; windowDays: number };
};

async function checkSLOBreaches(config: SLOConfig, agentId: string): Promise<void> {
  const now = Date.now();
  const windowMs = config.taskCompletionRate.windowDays * 24 * 60 * 60 * 1000;

  const journals = await journalStore.search({
    agentId,
    from: now - windowMs,
  });

  const tcr = calculateTCR(journals);

  // TCR breach
  if (tcr.overall < config.taskCompletionRate.alertBelow) {
    await sendAlert({
      severity: "warning",
      agentId,
      metric: "Task Completion Rate",
      value: tcr.overall,
      threshold: config.taskCompletionRate.alertBelow,
      recommendation: "Check planning phase failures and creative task prompts",
    });
  }

  // TCR by type deep dive
  for (const [taskType, rate] of Object.entries(tcr.byType)) {
    if (rate < config.taskCompletionRate.alertBelow) {
      await sendAlert({
        severity: "critical",
        agentId,
        metric: `Task Completion Rate (${taskType})`,
        value: rate,
        threshold: config.taskCompletionRate.alertBelow,
        recommendation: `Investigate ${taskType} task execution journal entries`,
      });
    }
  }
}
```

중요한 것은 **alert에 recommendation이 포함**되어야 한다는 점입니다. "TCR 72%"라는 숫자보다 "CREATIVE 태스크 TCR이 72%입니다. planning phase 실패 패턴을 확인하세요"가 훨씬 실행 가능합니다.

## Execution Journal 기반 Self-Improvement

SLO가 측정이라면, **Execution Journal 기반 self-improvement**는 학습입니다.

```ts
async function selfImprove(agentId: string): Promise<{
  improvementsApplied: string[];
  insights: string[];
}> {
  const patterns = await diagnoseFailurePatterns(agentId, 7);
  const insights: string[] = [];
  const improvementsApplied: string[] = [];

  // 패턴 1: planning phase 실패가 전체의 50% 이상
  if ((patterns.phaseFailureCounts["planning"] ?? 0) / patterns.totalFailed > 0.5) {
    insights.push("Planning phase 실패가 과반입니다. planner 모델 전환 또는 프롬프트 강화가 필요합니다.");
    improvementsApplied.push("planner_prompt_v2");
  }

  // 패턴 2: 특정 escalation 사유가 반복
  const topEscalation = mostFrequent(patterns.escalationReasons);
  if (topEscalation && topEscalation.count > 5) {
    insights.push(`'${topEscalation.value}' 사유로 ${topEscalation.count}회 escalation 발생. 이 케이스를 처리 가능하도록 tool 또는 policy를 확장합니다.`);
    improvementsApplied.push(`escalation_handler_${sanitize(topEscalation.value)}`);
  }

  return { improvementsApplied, insights };
}
```

이것이 전통적 APM(APM: Application Performance Monitoring)과 Agent Observability의根本적 차이입니다. APM은"무엇이 잘못됐는지"만 말하지만, Agent Observability는"왜 잘못됐는지"를 Execution Journal에서 추적하고"다음엔 어떻게 개선할지"까지 제안합니다.

## practical한 Agent SLO 도입 순서

### 1단계: Execution Journal 먼저 구축 (Day 1)
SLO 계산보다 먼저 Agent의 행동 log를 남기는 것이 가장 중요합니다. journal 없이는 SLO 측정도 불가능합니다.

### 2단계: Task Taxonomy 정의 (Week 1)
작업 유형을 정의하고 각각의 성공 기준을 문서화합니다. 이 기준이 없으면 TCR 계산이 의미 없습니다.

### 3단계: 기본 SLO 계산 + Dashboard (Week 2)
TCR, TTFT, escalation rate를 계산하고 dashboard를 구축합니다. Dashboard가 없는 SLO는 잊혀집니다.

### 4단계: Alerting 규칙 설정 (Week 3)
SLO breach 시 즉시 담당자에게通知되는 체계를 만듭니다. Alert fatigue를 방지하려면閾値を 신중하게 설정해야 합니다.

### 5단계: Self-Improvement Automation (Month 2)
Execution Journal 기반 자동 분석을 돌리고, 주기적으로 개선 아이디어를生成하는 봇을 운영합니다.

## 팀 체크리스트

- [ ] Execution Journal이 모든 Agent 실행 시 기록되는가?
- [ ] Task taxonomy가 정의되어 있는가?
- [ ] Task Completion Rate가 task type별로 측정되는가?
- [ ] Time-to-First-Useful-Action이 TTFT와 함께 추적되는가?
- [ ] Escalation 사유가 분류되고 빈도 분석되는가?
- [ ] SLO breach 시 담당자에게 즉각通知되는 alerting이 있는가?
- [ ] 주기적으로 self-improvement 분석이 실행되는가?
- [ ] SLO trend가 개선 방향으로 가고 있는지 확인하는 회기가 있는가?

## 결론

MCP와 A2A가 Agent의**연결**을 표준화했다면, Agent SLO와 Execution Journal은 Agent의**신뢰성**을 표준화하는 작업입니다. 이 둘은 별개가 아니라一套입니다.

- 연결 표준: Agent가 서로通信할 수 있는가
- SLO + Journal: Agent가 믿을 수 있는 결과를 내는가

이 두 축이 갖춰져야 "AI Agent를 프로덕션 환경에서 운영한다"는 문장이 실용적인 의미를 갖습니다. 연결이 잘 되는 세상에서 남는 경쟁력은 결국 **얼마나 일관되고 예측 가능한 결과물을 내는가**입니다.

SLO 도입은 기술적 선택이 아니라 조직적决心입니다. 숫자로 서비스를 운영하는 문화가 있는 팀이라면 Agent SLO도 반드시 구현할 수 있습니다.

---

### 자가 검토 및 개선 사항

1. **주제 차별화**: 최근 Planning/Workflow Engine 글과 겹치지 않도록, 이번 글은"측정과 관측"에 집중했습니다.Planning이 설계라면, SLO는 운영이며, 이 둘은 자연스러운 연결고리입니다.
2. **구체성 강화**: 추상적 개념이 아니라 `TaskRecord`, `TCR`, `TTFUA`, `ExecutionJournal`까지 TypeScript 타입으로 정의하여 실무 적용이 가능하도록 했습니다.
3. **실용성 강조**: Dashboard, Alerting, Self-Improvement 순서로 도입 전략을 배치하여"여기서 무엇을 해야 하는가"가 명확하도록 했습니다.
4. **한글 자연스러움**: 기술 용어를 자연스럽게 섞되, 설명은 한국어 위주로 작성하여 주인님의 선호도에 맞췄습니다.
5. **네이밍 일관성**: TCR, TTFUA 등 축약어를 도입부에 미리 정의하고 본문에서 일관되게 사용했습니다.
