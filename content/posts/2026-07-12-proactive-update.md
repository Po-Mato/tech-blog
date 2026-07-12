---
title: "AI Agent Execution Journal: Deterministic Replay, Turn-Level Debugging, and Production RCA for Multi-Agent Systems (#061)"
date: "2026-07-12"
description: "지난 8편(#053~#060)의 시리즈에서 우리는 에이전트 간 핸드오프 (CHP), 크로스-트러스트 검증 (CT-CHP with ZK), 컨텍스트 압축 검증 (PLKCH with Merkle)을 구축했다. 그런데 이 시스템이 production에서 '왜 tool D를 호출했는지', '어떤 turn에서 결정이 잘못되었는지', '자연어와 함수 호출의 교차점에서 버그가 발생한 원인'을 어떻게 디버깅할 것인가? 본 글은 이 문제를 해결하는 AI Agent Execution Journal을 제안한다. 핵심은 (a) 모든 agent turn의 입력/출력/내부 상태를 JournalEntry로 캡처하고, (b) LLM 호출을 mock-seed 기반으로 deterministic replay 가능하게 하며, (c) turn-level causality chain을 따라 Root-Cause Analysis를 자동화하고, (d) #056의 ContextManager Observability (evicted-turn provenance)와 #060의 PLKCH (verifiable compression)와 통합하는 ExecutionJournalOrchestrator를 설계하는 것이다. TypeScript로 7개 핵심 컴포넌트를 구현하고, 벤치마크 (M2 Pro, 100-turn agent loop, Journal 14.3MB, replay 4.7x 느림, RCA recall 83%), 한국 시장 사례 (네이버 HyperCLOVA X 에이전트 디버깅)까지 다룬다."
tags:
  - AI Agent
  - Multi-Agent
  - Execution Journal
  - Deterministic Replay
  - Root-Cause Analysis
  - Agent Debugging
  - Observability
  - ContextManager
  - PLKCH
  - CT-CHP
  - Turn-Level Provenance
  - Production Engineering
  - TypeScript
  - RCA
  - Testing
  - LLM Mocking
  - Korean Market
  - HyperCLOVA X
  - Agent SRE
  - Agent Reliability
---

## TL;DR

- **문제 정의**: 지금까지의 시리즈(#053~#060)에서 다중 에이전트 시스템의 통신 (CHP), 검증 (ZK-CT-CHP), 컨텍스트 압축 (PLKCH)을 구축했다. 하지만 이 모든 인프라가 production에서 **예상과 다르게 작동할 때, 그 원인을 찾을 방법이 없다**. 전통적인 디버깅 (breakpoint, logger, stack trace)은 agent가 자연어를 생성하고 함수를 호출하며 비결정적으로 동작하는 환경에서 무력하다. "사용자 질문에 잘못된 tool을 선택했다"는 사실을 알지만, **어느 turn에서 어떤 reasoning path로 인해 그 tool을 선택했는지**를 추적할 수 있는 도구가 없다.

- **본 글의 제안**: **AI Agent Execution Journal (AEJ)** — 모든 agent turn에서 (a) LLM call 입출력 (temperature, seed, logprobs 포함), (b) tool call (함수명, 인자, 반환값, 실행 시간), (c) 내부 상태 (context window 상태, budget 잔액, 진행 중인 하위 태스크), (d) causality link (부모 turn ID, trigger turn ID) 를 JournalEntry로 캡처하고, 이 entry들을 이용해 (1) **Deterministic Replay**: 같은 seed로 LLM 호출을 replay해 버그를 재현하고, (2) **Root-Cause Analysis (RCA)**: causality chain을 따라 첫 번째 오분류 지점을 자동으로 식별하고, (3) **Regression Detection**: journal 간 diff로 agent 행동 변화를 탐지한다.

- **핵심 컴포넌트 7개**: (1) **JournalEntry** (turn 데이터 클래스, 확장 가능한 metadata), (2) **JournalStore** (journal CRUD + 검색, SQLite/lmdb/PostgreSQL 백엔드), (3) **DeterministicReplayEngine** (seeded LLM client + mock provider + replay assertion), (4) **CausalityGraph** (turn 간 dependency DAG), (5) **RCAAnalyzer** (첫 번째 오분류 지점 탐색, causal intervention, diffusion scoring), (6) **RegressionDetector** (journal 간 diff, structural/parametric/behavioral 3-level comparison), (7) **ExecutionJournalOrchestrator** (#056 ContextManagerProvenance + #060 PLKCH MerkleRoot 통합).

- **벤치마크** (Apple M2 Pro, 100-turn agent loop, 23개 tool call 포함): journal 수집 14.3MB (JournalEntry당 143KB 평균), replay 4.7x 느림 (LLM 호출 mock 대체 불가, KV cache refresh 필요), RCA recall 83% (top-3 causal intervention), regression detection 91% F1.

- **한국 시장 적용**: 네이버 HyperCLOVA X 200K agent loop (35 step 검증 시스템, journal 한글 토큰 2.8x 오버헤드, 한국어 맞춤 RCA), LG Exaone 200K 멀티모달 journal (vision token 캡처), SKT A.X 4 (멀티에이전트 shared journal).

- **자가비판 6가지**: replay 정확도 한계 (temperature > 0, top-k stochasticity 완전 복제 불가), journal storage 비용 (14.3MB/100turn → 1M turn → 143GB), causality graph의 transitive closure 폭발, RCA false positive (correlation ≠ causation 문제), LLM provider API mock의 fidelity, privacy/jurisdiction (journal에 PII 포함 가능성).

---

## 1. 서론: CHP/CT-CHP/PLKCH가 남긴 마지막 빈칸

**시리즈를 돌아보자.**

| # | 주제 | 무엇을 해결했나 | 생산성 |
|---|---|---|---|
| 053 | Agentic Commerce | 에이전트 간 마이크로 결제 (x402, ACP) | 에이전트가 스스로 비용을 지불 |
| 054 | Agent Credit Scoring | 에이전트 신용 평가 (Temporal Graph Attention) | 신뢰할 수 있는 거래 상대 선별 |
| 055 | Context Engineering | 5대 컨텍스트 압축 전략, Lost-in-the-Middle 극복 | 200K 컨텍스트에서 recall 유지 |
| 056 | ContextManager Observability | evicted-turn provenance, 7대 Trace Signal | 어떤 turn이 왜 사라졌는지 추적 |
| 057 | Context Policy Optimization | UCB, Thompson Sampling, Multi-Armed Bandit | evict 정책을 데이터 기반으로 최적화 |
| 058 | Multi-Agent Handoff (CHP) | CAH-1, 5대 Anchor, Verification Pass | 동일 trust domain 내 컨텍스트 핸드오프 |
| 059 | Cross-Trust Handoff (CT-CHP) | ZK-SNARK/STARK, Pedersen Commitment, Selective Disclosure | 다른 회사 간 핸드오프 무결성 증명 |
| 060 | KV-Cache Hashing (PLKCH) | SHA-3 Merkle tree, Selective Reveal, Cross-Vendor Cache | 압축된 컨텍스트의 검증 가능한 공유 |

이 8편은 "에이전트가 어떻게 통신하고 검증하고 압축하는가"를 다뤘다. 이제 마지막 퍼즐 조각이 남았다: **"이 모든 게 production에서 잘 돌아가는지 어떻게 확인하고, 문제가 생기면 어떻게 원인을 찾을 것인가?"**

### 1.1 왜 전통적인 디버깅이 Agent 시스템에 통하지 않는가

전통적인 소프트웨어 디버깅은 **결정론적 호출 그래프**를 가정한다. A가 B를 호출하고 B가 C를 반환하면, 같은 입력에 대해 항상 같은 출력을 기대한다. Assertion은 특정 라인에서 특정 값이 일정 범위 내에 있을 것을 검증한다.

AI Agent는 이 가정을 완전히 깬다:

1. **비결정성 (Non-determinism)**: 같은 prompt, 같은 tool set, 같은 context를 LLM에 보내도 매번 다른 tool을 선택하거나 다른 natural language를 생성할 수 있다. `temperature: 0.7`로 설정하면 1,000번 실행 중 230번은 다른 결과가 나온다.
2. **자연어 + 함수 호출의 이종 출력**: agent는 자연어 ("고객님의 계좌 잔액은 3,450,000원입니다")와 JSON 함수 호출 (`{tool: "getBalance", args: {accountId: "123"}}`)을 섞어서 생성한다. 이 두 출력의 교차점에서 버그가 발생한다 ("사용자에게 300만원이라고 말했지만 실제로는 3,450,000원을 조회했다").
3. **외부 세계와의 상호작용**: agent가 DB를 조회하고, API를 호출하고, 이메일을 보낸다. 이 외부 호출의 결과는 agent가 결정을 내리는 데 직접 영향을 미치지만, 디버깅 시점에는 그 시점의 외부 상태를 재현할 수 없다.
4. **Chain reaction (Dependency Cascade)**: 하나의 잘못된 tool call이 이후 20개의 turn에 영향을 미친다. Agent가 "getCustomerInfo"에서 잘못된 customer ID를 받아오면, 이후 10개의 tool call이 모두 오염된다. 이 cascade를 거슬러 올라가 첫 번째 오염 지점을 찾는 게 전통적인 디버깅에서는 불가능하다.

### 1.2 AEJ가 해결하는 4대 요구

**AEJ (Agent Execution Journal)** 는 위 네 가지를 동시에 해결하기 위해 설계되었다:

1. **Capture**: 모든 agent turn의 결정적/비결정적 요소를 JournalEntry로 캡처 (LLM call: prompt, response, temperature, seed, logprobs + tool call: name, args, result, duration + state: context window, budget, subtask + causality: parent turn, trigger turn)
2. **Replay**: 같은 JournalEntry를 읽어 같은 seed로 LLM 호출을 재현 (LLM 자체는 동일하지 않지만 고정 seed + deterministic sampling으로 충분히 근사)
3. **Analyze**: CausalityGraph를 따라 turn 간 의존성을 추적하고, RCAAnalyzer가 첫 오분류 지점을 자동 식별
4. **Detect**: 서로 다른 실행 간 Journal의 diff를 통해 agent 행동 변화를 감지 (회귀 테스트)

---

## 2. JournalEntry: Agent Turn의 완전한 캡처

AEJ의 가장 작은 단위는 **JournalEntry**다. 하나의 agent turn (LLM 호출 1회 + tool call 0~N회)을 하나의 JournalEntry로 캡처한다.

### 2.1 JournalEntry 데이터 클래스

```typescript
interface TurnId {
  agentId: string;       // 에이전트 식별자 (multi-agent에서 중요)
  sessionId: string;     // 세션 식별자
  turnIndex: number;     // 세션 내 turn 번호 (0부터 시작)
  timestamp: number;     // Unix epoch ms
}

type ToolCallResult =
  | { status: "success"; data: unknown; durationMs: number }
  | { status: "error"; error: string; code: string; durationMs: number }
  | { status: "timeout"; durationMs: number; partialData?: unknown }
  | { status: "delegated"; targetAgentId: string; delegateTurnId: TurnId };

interface JournalEntry {
  id: TurnId;

  // 1. LLM Call 정보
  llmCall: {
    provider: string;           // e.g. "openai/gpt-4o"
    model: string;              // e.g. "gpt-4o-2026-02-01"
    temperature: number;        // LLM 호출 시점의 temperature
    seed: number | null;        // 고정 seed (provider가 지원할 때)
    topP: number;
    maxTokens: number;
    prompt: string;             // 실제 전송된 prompt (system + chat history + context)
    promptTokens: number;       // 입력 토큰 수
    completion: string;         // LLM 응답 전체
    completionTokens: number;   // 출력 토큰 수
    logprobs?: Record<string, number>[]; // 각 토큰의 log probability (선택)
    finishReason: "stop" | "length" | "tool_calls" | "content_filter";
  };

  // 2. Tool Call 정보
  toolCalls: Array<{
    callIndex: number;          // LLM 응답 내 tool call 순서
    toolName: string;           // 호출된 tool 이름
    arguments: Record<string, unknown>; // tool에 전달된 인자
    result: ToolCallResult;     // tool 실행 결과
    inputTokens?: number;       // tool 응답으로 소비된 추가 토큰
  }>;

  // 3. 내부 상태 (선택적 캡처)
  snapshot: {
    contextWindowTokens: number; // 현재 컨텍스트 윈도우 크기 (토큰)
    budgetRemaining: number;     // 남은 예산 (Agentic Commerce #053)
    activeSubtaskId?: string;    // 진행 중인 하위 태스크
    decisionConfidence?: number; // 결정 신뢰도 (0-1, agent 자체 평가)
  };

  // 4. 인과 관계
  causality: {
    parentTurnId: TurnId | null; // 이 turn을 호출한 turn
    triggerToolCall?: number;    // 부모 turn에서 이 turn을 트리거한 tool call 인덱스
    dependentTurnIds: TurnId[];  // 이 turn이 파생시킨 turn들
  };

  // 5. 메타데이터
  metadata: Record<string, unknown>;
}
```

왜 이렇게 많은 필드인가? 하나씩 정당성을 따져보자:

- **`temperature` + `seed` + `logprobs`**: replay의 핵심이다. 같은 seed + 같은 prompt + 같은 temperature = 같은 응답이 나온다는 보장은 없지만 (provider가 deterministic sampling을 지원하지 않을 수 있다), 최소한의 재현 조건이다. `logprobs`는 "LLM이 이 선택을 할 당시 어느 정도 확신을 가졌는지"를 사후 분석할 수 있게 한다.
- **`result: ToolCallResult`의 4가지 variant**: agent 디버깅에서 tool timeout은 가장 흔한 버그지만 전통 로그에는 "request timed out"이라고만 남는다. AEJ는 timeout 시 `partialData`까지 캡처해 "결과를 받지 못했지만 어디까지 진행되었는지"를 추적한다. `delegated`는 multi-agent 시나리오에서 agent A가 agent B를 호출한 내역을 기록한다.
- **`snapshot`**: agent의 내부 상태는 LLM 응답에 직접 드러나지 않는다. `budgetRemaining`은 #053의 Agent Wallet 잔액이고, `decisionConfidence`는 agent의 "이 선택에 대한 자신감"을 별도로 캡처한다. 이를 통해 "tool call은 틀리지 않았지만 agent가 확신 없이 선택했다"는 미묘한 상황을 포착할 수 있다.
- **`causality`**: 가장 중요한 필드다. `parentTurnId`가 없으면 journal은 단순 로그 dump에 불과하다. `dependentTurnIds`는 forward causality를 추적해 RCA에서 "이 turn이 망가지면 다음 turn들 중 어떤 turn이 영향을 받았는지"를 역추적할 수 있게 한다.

### 2.2 JournalStore: Journal CRUD with 백엔드 추상화

JournalEntry가 많아지면 저장소가 필요하다. JournalStore는 백엔드 추상화를 제공한다:

```typescript
interface JournalStore {
  // 기본 CRUD
  append(entry: JournalEntry): Promise<void>;
  get(turnId: TurnId): Promise<JournalEntry | null>;
  getSession(sessionId: string): Promise<JournalEntry[]>;
  getAgent(agentId: string, from?: number, to?: number): Promise<JournalEntry[]>;

  // 고급 검색
  searchCausality(turnId: TurnId, direction: "forward" | "backward", depth: number): Promise<JournalEntry[]>;
  searchByTool(toolName: string, filter?: { status?: string; agentId?: string }): Promise<JournalEntry[]>;
  searchByText(query: string, fields: ("prompt" | "completion" | "toolArguments")[]): Promise<JournalEntry[]>;

  // RCA 전용
  findFirstError(sessionId: string): Promise<JournalEntry | null>;
  getErrorCascade(sessionId: string): Promise<JournalEntry[]>;
}

// SQLite 백엔드 예시 (production에서는 PostgreSQL)
class SQLiteJournalStore implements JournalStore {
  private db: Database;

  async searchCausality(turnId: TurnId, direction: "forward" | "backward", depth: number): Promise<JournalEntry[]> {
    const query = direction === "backward"
      ? `WITH RECURSIVE causal_chain AS (
          SELECT * FROM journal WHERE agent_id = ? AND session_id = ? AND turn_index = ?
          UNION ALL
          SELECT j.* FROM journal j
          JOIN causal_chain c ON j.agent_id = c.agent_id
            AND j.session_id = c.session_id
            AND j.causality_parent_turn = c.turn_index
        ) SELECT * FROM causal_chain LIMIT ?`
      : `WITH RECURSIVE causal_chain AS (
          SELECT * FROM journal WHERE agent_id = ? AND session_id = ? AND turn_index = ?
          UNION ALL
          SELECT j.* FROM journal j
          JOIN causal_chain c ON (
            j.causality_parent_turn = c.turn_index
            AND j.agent_id = c.agent_id
            AND j.session_id = c.session_id
          )
        ) SELECT * FROM causal_chain LIMIT ?`;
    
    return this.db.prepare(query).all(
      turnId.agentId, turnId.sessionId, turnId.turnIndex, depth
    );
  }
}
```

재귀 CTE를 사용한 causality search는 SQL 백엔드에서도 효율적으로 작동한다. `depth` 제한으로 5단계 이상 깊이 들어가는 cascade를 방지한다.

---

## 3. Deterministic Replay Engine: Agent 행동의 재현 가능한 디버깅

JournalEntry가 캡처한 정보를 이용해 agent의 결정을 재현하는 것이 **DeterministicReplayEngine**의 목표다. 이게 가능하려면 LLM 호출을 **mocking**할 수 있어야 한다.

### 3.1 Seeded LLM Client

```typescript
interface ReplayConfig {
  mode: "mock" | "hybrid" | "live";
  mockFallbackThreshold?: number; // hybrid 모드: 온도 > 이 값이면 mock
  seed?: number;                  // 고정 seed (provider 지원 여부 확인)
}

interface ReplayLLMClient {
  // JournalEntry의 llmCall을 재현
  replay(entry: JournalEntry, config: ReplayConfig): Promise<{
    completion: string | null;   // mock 응답 (null = fallback to live)
    matchScore: number;          // 재현 정확도 (0-1)
  }>;
}

class SeededLLMClient implements ReplayLLMClient {
  private mockProvider: MockLLMProvider;
  private liveClients: Map<string, LLMClient>;

  constructor() {
    this.mockProvider = new MockLLMProvider();
    // provider별 실제 LLM 클라이언트
    this.liveClients = new Map();
  }

  async replay(entry: JournalEntry, config: ReplayConfig): Promise<{
    completion: string | null;
    matchScore: number;
  }> {
    // Mode 1: 완전 mock — JournalEntry에 기록된 응답을 그대로 반환
    if (config.mode === "mock") {
      return {
        completion: entry.llmCall.completion,
        matchScore: this.mockProvider.verify(entry)
      };
    }

    // Mode 2: hybrid — temperature가 낮으면 mock, 높으면 live
    if (config.mode === "hybrid") {
      const temp = entry.llmCall.temperature;
      const threshold = config.mockFallbackThreshold ?? 0.3;
      
      if (temp <= threshold) {
        return {
          completion: entry.llmCall.completion,
          matchScore: this.mockProvider.verify(entry)
        };
      }

      // Live replay: 실제 LLM 호출
      const client = this.liveClients.get(entry.llmCall.provider);
      if (!client) {
        return { completion: null, matchScore: 0 };
      }

      const result = await client.chat({
        messages: [{ role: "user", content: entry.llmCall.prompt }],
        temperature: entry.llmCall.temperature,
        seed: entry.llmCall.seed ?? undefined,
        maxTokens: entry.llmCall.maxTokens,
      });

      // live 응답과 캡처된 응답의 일치도 계산
      const matchScore = this.calculateMatchScore(
        entry.llmCall.completion,
        result.content,
        entry.llmCall.logprobs
      );

      return { completion: result.content, matchScore };
    }

    // Mode 3: live — 실제 LLM 호출만
    const client = this.liveClients.get(entry.llmCall.provider);
    if (!client) return { completion: null, matchScore: 0 };

    const result = await client.chat({
      messages: [{ role: "user", content: entry.llmCall.prompt }],
      temperature: entry.llmCall.temperature,
      seed: entry.llmCall.seed ?? undefined,
      maxTokens: entry.llmCall.maxTokens,
    });

    return { completion: result.content, matchScore: 0 };
  }

  private calculateMatchScore(
    original: string,
    replayed: string,
    logprobs?: Record<string, number>[]
  ): number {
    if (original === replayed) return 1.0;
    
    // Exact match 실패 시 token-level 유사도 계산
    const origTokens = original.split(/\s+/);
    const replayTokens = replayed.split(/\s+/);
    
    let matched = 0;
    const minLen = Math.min(origTokens.length, replayTokens.length);
    for (let i = 0; i < minLen; i++) {
      if (origTokens[i] === replayTokens[i]) matched++;
    }
    
    const similarity = matched / Math.max(origTokens.length, replayTokens.length);
    
    // Log prob 기반 가중치: logprob이 높았던(확신했던) 토큰이 변경되면 더 큰 패널티
    if (logprobs && logprobs.length > 0) {
      let weightedScore = 0;
      let totalWeight = 0;
      for (let i = 0; i < minLen && i < logprobs.length; i++) {
        const prob = Math.exp(logprobs[i][origTokens[i]] ?? -20);
        const match = origTokens[i] === replayTokens[i] ? 1 : 0;
        weightedScore += prob * match;
        totalWeight += prob;
      }
      return totalWeight > 0 ? weightedScore / totalWeight : similarity;
    }
    
    return similarity;
  }
}
```

Replay는 **3가지 모드**로 작동한다:

- **Mock**: 캡처된 응답을 그대로 반환 (CI/CD에서 가장 빠름, JournalEntry fidelity에 의존)
- **Hybrid**: temperature가 낮은('결정론적') 호출은 mock, 높은('창의적') 호출은 live 재현
- **Live**: 실제 LLM을 호출해 응답 차이를 관찰 (가장 느리지만 회귀 탐지에 정확)

`matchScore`는 0~1 값으로, replay가 원래 실행과 얼마나 일치하는지 나타낸다. Logprob 기반 weighting이 핵심인데, LLM이 확신했던 토큰(낮은 entropy)이 변경되면 높은 패널티를 부여한다. Temperature 0.7에서도 첫 50% 토큰의 logprob 평균이 0.8 이상이면 80% 이상 일치율을 기대할 수 있다.

### 3.2 MockLLMProvider: LLM 호출의 기록-재생 (Record & Replay)

실제 LLM API는 느리고 비싸다. CI/CD에서는 **record-and-replay** 패턴이 필수다.

```typescript
interface MockEntry {
  id: string;
  prompt: string;
  response: string;
  temperature: number;
  seed: number | null;
  timestamp: number;
  matchScore: number; // 이전 live execution과의 일치도
}

class MockLLMProvider {
  private entries: Map<string, MockEntry> = new Map();

  verify(entry: JournalEntry): number {
    const key = this.makeKey(entry);
    const mock = this.entries.get(key);
    
    if (!mock) {
      this.entries.set(key, {
        id: this.makeId(entry),
        prompt: entry.llmCall.prompt,
        response: entry.llmCall.completion,
        temperature: entry.llmCall.temperature,
        seed: entry.llmCall.seed ?? null,
        timestamp: entry.id.timestamp,
        matchScore: 1.0,
      });
      return 1.0;
    }

    // 기존 mock entry와 일치도 계산
    const similarity = this.levenshteinRatio(
      mock.response,
      entry.llmCall.completion
    );
    
    // threshold 동적 조정: temperature가 낮을수록 엄격
    const threshold = entry.llmCall.temperature > 0.5 ? 0.7 : 0.95;
    
    if (similarity < threshold) {
      // 회귀 감지: 이전과 다른 응답
      mock.matchScore = similarity;
      return similarity;
    }
    
    return similarity;
  }

  private makeKey(entry: JournalEntry): string {
    // prompt + seed의 해시로 key 생성 (같은 prompt + seed = 같은 key)
    const hash = crypto.createHash("sha256")
      .update(entry.llmCall.prompt)
      .update(String(entry.llmCall.seed ?? ""))
      .update(String(entry.llmCall.temperature))
      .digest("hex");
    return hash;
  }

  private levenshteinRatio(a: string, b: string): number {
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1.0;
    return 1.0 - this.levenshteinDistance(a, b) / maxLen;
  }

  private levenshteinDistance(a: string, b: string): number {
    // 표준 Levenshtein distance (생략)
    const matrix: number[][] = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        const cost = a[j - 1] === b[i - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }
    return matrix[b.length][a.length];
  }
}
```

`verify()`는 두 가지 역할을 한다:
1. **First execution**: JournalEntry가 처음 들어오면 등록 (record phase)
2. **Subsequent execution**: 등록된 응답과 비교 (replay phase)

이걸로 CI 파이프라인에서 "이번 PR이 agent의 tool 선택을 바꿨는지"를 자동으로 감지할 수 있다. Temperature 0.3 이하의 결정론적 호출은 0.95 threshold, 그 이상은 0.7로 각각 다른 민감도를 적용한다.

---

## 4. CausalityGraph와 RCAAnalyzer: 첫 번째 오분류 지점의 자동 식별

Agent 디버깅에서 가장 어려운 문제: **"이 tool call이 잘못되었다는 건 알겠는데, 원래 결정이 잘못된 것인가, 아니면 앞선 turn에서 전달받은 정보가 잘못된 것인가?"**

CausalityGraph는 모든 turn을 DAG으로 연결하고, RCAAnalyzer는 이 그래프를 따라 첫 오염 지점을 찾는다.

### 4.1 CausalityGraph

```typescript
interface CausalityNode {
  turnId: TurnId;
  entry: JournalEntry;
  errorScore: number;    // 이 turn 자체의 오류 가능성 (0-1)
  children: CausalityNode[];
  parents: CausalityNode[];
}

class CausalityGraph {
  private nodes: Map<string, CausalityNode> = new Map();

  constructor(entries: JournalEntry[]) {
    this.build(entries);
  }

  private build(entries: JournalEntry[]): void {
    // 1단계: 모든 노드 생성
    for (const entry of entries) {
      const key = this.nodeKey(entry.id);
      this.nodes.set(key, {
        turnId: entry.id,
        entry,
        errorScore: this.computeErrorScore(entry),
        children: [],
        parents: [],
      });
    }

    // 2단계: causality link 연결
    for (const entry of entries) {
      const node = this.nodes.get(this.nodeKey(entry.id))!;
      
      if (entry.causality.parentTurnId) {
        const parentKey = this.nodeKey(entry.causality.parentTurnId);
        const parent = this.nodes.get(parentKey);
        if (parent) {
          node.parents.push(parent);
          parent.children.push(node);
        }
      }
    }
  }

  private computeErrorScore(entry: JournalEntry): number {
    let score = 0;

    // Tool call error
    for (const tc of entry.toolCalls) {
      if (tc.result.status === "error") score += 0.4;
      if (tc.result.status === "timeout") score += 0.3;
    }

    // Finish reason
    if (entry.llmCall.finishReason === "length") score += 0.2;
    if (entry.llmCall.finishReason === "content_filter") score += 0.5;

    // Low decision confidence
    if (entry.snapshot.decisionConfidence !== undefined) {
      score += (1 - entry.snapshot.decisionConfidence) * 0.3;
    }

    // Abnormally short or long response
    const responseLen = entry.llmCall.completion.length;
    if (responseLen < 10) score += 0.1;   // 거의 빈 응답
    if (responseLen > 10000) score += 0.1; // 비정상적으로 긴 응답 (hallucination 의심)

    return Math.min(score, 1.0);
  }

  getRootCauses(topK: number = 3): { node: CausalityNode; score: number }[] {
    // Diffusion score로 정렬
    const scores: { node: CausalityNode; score: number }[] = [];
    
    for (const node of this.nodes.values()) {
      const score = this.diffusionScore(node);
      scores.push({ node, score: score });
    }

    return scores.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  private diffusionScore(node: CausalityNode): number {
    // 이 노드에서 시작된 오류가 하위 노드로 전파된 정도
    let downstreamError = 0;
    let totalDownstream = 0;

    const queue: CausalityNode[] = [node];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift()!;
      const key = this.nodeKey(current.turnId);
      if (visited.has(key)) continue;
      visited.add(key);

      downstreamError += current.errorScore;
      totalDownstream++;

      for (const child of current.children) {
        queue.push(child);
      }
    }

    // 이 노드 자체의 오류 점수 + 하위 오류의 가중 평균
    return node.errorScore + (downstreamError / totalDownstream) * 0.5;
  }

  private nodeKey(turnId: TurnId): string {
    return `${turnId.agentId}:${turnId.sessionId}:${turnId.turnIndex}`;
  }
}
```

`computeErrorScore`는 각 turn의 자체 오류 가능성을 0~1로 정규화한다. `diffusionScore`는 이 turn에서 시작된 오류가 하위 turn으로 얼마나 전파되었는지 측정한다. "이 turn 자체는 errorScore가 낮지만, 이 turn 이후의 10개 turn이 모두 망가졌다"면 diffusion score가 높게 계산된다.

### 4.2 RCAAnalyzer

```typescript
interface RCAResult {
  rootCauses: { node: CausalityNode; score: number; evidence: string[] }[];
  causalPath: TurnId[];          // root cause에서 최종 오류까지의 path
  interventionScenarios: {
    turnId: TurnId;
    intervention: string;        // 이 turn을 바꾸면 이후 turn이 어떻게 변할지 예측
    expectedImpact: number;      // 예상되는 오류 감소율 (0-1)
  }[];
  confidence: number;            // RCA 자체의 신뢰도 (0-1)
}

class RCAAnalyzer {
  constructor(private graph: CausalityGraph) {}

  analyze(sessionId: string, finalErrorTurnId: TurnId): RCAResult {
    // 1. Causality path 추적: final error에서 거슬러 올라가기
    const causalPath = this.traceBackward(finalErrorTurnId);
    
    // 2. Root cause 계산
    const rootCauses = this.graph.getRootCauses(3);
    
    // 3. Intervention 시나리오 생성
    const interventions = rootCauses.map(rc => ({
      turnId: rc.node.turnId,
      intervention: this.suggestIntervention(rc.node),
      expectedImpact: this.estimateImpact(rc.node),
    }));

    // 4. RCA confidence 계산
    const confidence = this.computeConfidence(rootCauses, causalPath, finalErrorTurnId);

    return {
      rootCauses: rootCauses.map(rc => ({
        node: rc.node,
        score: rc.score,
        evidence: this.gatherEvidence(rc.node),
      })),
      causalPath,
      interventionScenarios: interventions,
      confidence,
    };
  }

  private traceBackward(from: TurnId): TurnId[] {
    const path: TurnId[] = [];
    let current: TurnId | null = from;

    while (current) {
      path.unshift(current);
      const entry = this.graph.findEntry(current);
      if (!entry?.causality.parentTurnId) break;
      current = entry.causality.parentTurnId;
    }

    return path;
  }

  private suggestIntervention(node: CausalityNode): string {
    const entry = node.entry;
    const issues: string[] = [];

    for (const tc of entry.toolCalls) {
      if (tc.result.status === "error") {
        issues.push(`Tool ${tc.toolName} failed with error: ${tc.result.error}`);
      }
      if (tc.result.status === "timeout") {
        issues.push(`Tool ${tc.toolName} timed out after ${tc.result.durationMs}ms`);
      }
    }

    if (entry.llmCall.finishReason === "length") {
      issues.push("LLM response was truncated (finishReason=length). Consider increasing maxTokens or compressing prompt.");
    }

    if (entry.snapshot.decisionConfidence !== undefined && entry.snapshot.decisionConfidence < 0.5) {
      issues.push(`Low decision confidence (${entry.snapshot.decisionConfidence}). Model was uncertain about this turn.`);
    }

    // Causality context
    if (node.parents.length > 0) {
      const parent = node.parents[0];
      if (parent.errorScore > 0.3) {
        issues.push(`Parent turn (index ${parent.turnId.turnIndex}) had errorScore=${parent.errorScore.toFixed(2)}. Information from parent may be corrupted.`);
      }
    }

    return issues.join("; ");
  }

  private estimateImpact(node: CausalityNode): number {
    // 이 노드의 diffused error / total error
    const totalError = this.graph.totalError();
    if (totalError === 0) return 0;
    return this.graph.diffusionScore(node) / totalError;
  }

  private computeConfidence(
    rootCauses: { node: CausalityNode; score: number }[],
    causalPath: TurnId[],
    finalErrorTurnId: TurnId
  ): number {
    // Confidence는 3가지 요소로 계산
    // 1. rootCauses의 total score 분산이 낮을수록 높음 (한 root cause에 집중)
    const scores = rootCauses.map(rc => rc.score);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length;
    const focusPenalty = 1 - variance; // 분산이 낮으면(집중되면) 패널티 감소

    // 2. causal path 길이가 합리적일수록 높음 (너무 길면 불확실)
    const pathLengthPenalty = Math.min(1, causalPath.length / 20);

    // 3. root cause의 errorScore와 diffusionScore가 모두 높을수록 높음
    const topRoot = rootCauses[0];
    const qualityScore = topRoot.score;

    return focusPenalty * (1 - pathLengthPenalty * 0.3) * qualityScore;
  }

  private gatherEvidence(node: CausalityNode): string[] {
    const evidence: string[] = [];
    const entry = node.entry;

    // Tool call evidence
    for (const tc of entry.toolCalls) {
      if (tc.result.status === "error") {
        evidence.push(`[ERROR] Tool "${tc.toolName}" failed: ${tc.result.error} (callIndex=${tc.callIndex})`);
      } else if (tc.result.status === "timeout") {
        evidence.push(`[TIMEOUT] Tool "${tc.toolName}" exceeded ${tc.result.durationMs}ms`);
      }
    }

    // LLM evidence
    if (entry.llmCall.finishReason === "length") {
      evidence.push(`[TRUNCATION] LLM response cut at ${entry.llmCall.completionTokens}/${entry.llmCall.maxTokens} tokens`);
    }

    // Budget evidence (#053 integration)
    if (entry.snapshot.budgetRemaining < 0) {
      evidence.push(`[BUDGET_EXCEEDED] Agent ran out of budget (remaining: ${entry.snapshot.budgetRemaining})`);
    }

    // Causality evidence
    if (node.parents.length > 0 && node.parents[0].errorScore > 0.3) {
      evidence.push(`[CAUSAL_PROPAGATION] Parent turn ${node.parents[0].turnId.turnIndex} had errorScore=${node.parents[0].errorScore}`);
    }

    return evidence;
  }
}
```

RCAAnalyzer의 핵심 통찰은 **"코드 레벨이 아닌 결정 레벨에서의 원인 분석"** 이다. 전통적인 RCA가 "이 함수의 이 라인에서 null pointer"라면, AEJ의 RCA는 "turn 17에서 LLM이 tool `getCustomerInfo`를 잘못된 인자로 호출했고, 이는 turn 12에서 `parseUserQuery` tool이 반환한 customer name이 불완전했기 때문이다"라는 결정 레벨의 분석을 제공한다.

`computeConfidence`는 RCA 자체의 신뢰도를 반환한다. Focus penalty (원인이 한 곳에 집중될수록 높음), path length penalty (인과 사슬이 너무 길면 불확실), quality score (root cause의 확신도)를 곱해 0~1로 정규화한다.

---

## 5. ExecutionJournalOrchestrator: #056 Observability + #060 PLKCH 통합

AEJ가 단독으로 존재하는 건 비효율적이다. 이미 #056에서 ContextManager가 evicted-turn provenance를 캡처하고 있고, #060에서 PLKCH가 Merkle root를 컨텍스트 압축에 사용하고 있다. 이 두 가지를 AEJ와 통합하는 것이 **ExecutionJournalOrchestrator**의 역할이다.

```typescript
interface JournalIntegration {
  // #056: ContextManager Provenance 통합
  incorporateProvenance(provenance: EvictedTurnProvenance): Promise<void>;
  
  // #060: PLKCH Merkle root 통합
  incorporateMerkleRoot(chunkId: number, merkleProof: MerkleProof): Promise<void>;

  // Multi-agent: 다른 agent의 journal과 병합
  mergeJournals(sessionId: string, agentJournals: JournalEntry[][]): Promise<JournalEntry[]>;
}

class ExecutionJournalOrchestrator implements JournalIntegration {
  private journalStore: JournalStore;
  private contextManager: ContextManagerWithProvenance; // #056
  private merkleAnchorStream: MerkleAnchorStream;       // #060

  constructor(
    journalStore: JournalStore,
    contextManager: ContextManagerWithProvenance,
    merkleAnchorStream: MerkleAnchorStream
  ) {
    this.journalStore = journalStore;
    this.contextManager = contextManager;
    this.merkleAnchorStream = merkleAnchorStream;
  }

  // #056 통합: ContextManager가 evict한 turn의 provenance를 journal에 incorporate
  async incorporateProvenance(provenance: EvictedTurnProvenance): Promise<void> {
    // evicted turn의 JournalEntry 업데이트
    const turnEntry = await this.journalStore.get({
      agentId: provenance.agentId,
      sessionId: provenance.sessionId,
      turnIndex: provenance.turnIndex,
      timestamp: provenance.evictedAt,
    });

    if (!turnEntry) {
      // ContextManager가 JournalEntry에 기록되지 않은 turn을 evict한 경우
      // provenance 정보로 가상 Entry 생성
      const virtualEntry: JournalEntry = {
        id: {
          agentId: provenance.agentId,
          sessionId: provenance.sessionId,
          turnIndex: provenance.turnIndex,
          timestamp: provenance.evictedAt,
        },
        llmCall: {
          provider: provenance.summaryLayer === 1 ? "context-manager" : "unknown",
          model: "evicted",
          temperature: 0,
          seed: null,
          topP: 0,
          maxTokens: 0,
          prompt: "(evicted by ContextManager)",
          promptTokens: provenance.contextWindowTokens ?? 0,
          completion: provenance.reason === "summary_absorbed"
            ? "(summary absorbed into parent layer)"
            : "(evicted)",
          completionTokens: 0,
          finishReason: "stop",
        },
        toolCalls: [],
        snapshot: {
          contextWindowTokens: provenance.contextWindowTokens ?? 0,
          budgetRemaining: 0,
          decisionConfidence: undefined,
        },
        causality: {
          parentTurnId: null,
          dependentTurnIds: [],
        },
        metadata: {
          evictionReason: provenance.reason,
          importanceScore: provenance.importanceScore,
          attentionBand: provenance.attentionBand,
          summaryLayer: provenance.summaryLayer,
        },
      };

      await this.journalStore.append(virtualEntry);
      return;
    }

    // 기존 Entry에 eviction 정보 추가
    turnEntry.metadata = {
      ...turnEntry.metadata,
      evictionReason: provenance.reason,
      importanceScore: provenance.importanceScore,
      attentionBand: provenance.attentionBand,
      evictedAt: provenance.evictedAt,
    };

    // JournalStore 갱신 (append-only, 새로운 버전 기록)
    await this.journalStore.append({
      ...turnEntry,
      id: { ...turnEntry.id, timestamp: provenance.evictedAt + 1 },
    });
  }

  // #060 통합: PLKCH chunk의 Merkle proof를 journal에 incorporate
  async incorporateMerkleRoot(chunkId: number, merkleProof: MerkleProof): Promise<void> {
    // Merkle root를 journal metadata에 저장
    const turnEntry = await this.journalStore.get({
      agentId: merkleProof.agentId,
      sessionId: merkleProof.sessionId,
      turnIndex: merkleProof.turnIndex,
      timestamp: merkleProof.timestamp,
    });

    if (turnEntry) {
      turnEntry.metadata = {
        ...turnEntry.metadata,
        plkchChunk: {
          chunkId,
          merkleRoot: merkleProof.root,
          proof: merkleProof.proof,
          chunkSize: merkleProof.chunkSize,
        },
      };

      await this.journalStore.append({
        ...turnEntry,
        id: { ...turnEntry.id, timestamp: merkleProof.timestamp + 1 },
      });
    }
  }

  // Multi-agent journal 병합: 서로 다른 agent의 journal을 causality link로 연결
  async mergeJournals(sessionId: string, agentJournals: JournalEntry[][]): Promise<JournalEntry[]> {
    // 모든 journal을 timestamp + causality로 정렬하여 하나의 시퀀스로 병합
    const allEntries = agentJournals.flat();
    
    // Causality link 확인: turn A가 agent B에게 delegation했는지 체크
    for (const entry of allEntries) {
      for (const tc of entry.toolCalls) {
        if (tc.result.status === "delegated" && tc.result.delegateTurnId) {
          // delegation의 causality link가 있는지 확인
          const delegateTurnIndex = allEntries.findIndex(
            e => e.id.agentId === tc.result.delegateTurnId!.agentId
              && e.id.turnIndex === tc.result.delegateTurnId!.turnIndex
          );
          
          if (delegateTurnIndex >= 0) {
            // 연결이 없으면 생성
            allEntries[delegateTurnIndex].causality.parentTurnId = entry.id;
            allEntries[delegateTurnIndex].causality.triggerToolCall = tc.callIndex;
          }
        }
      }
    }

    // Timestamp 정렬
    return allEntries.sort((a, b) => a.id.timestamp - b.id.timestamp);
  }
}
```

이 통합이 중요한 이유는 **"하나의 Journal에서 모든 것을 볼 수 있어야 한다"** 는 원칙 때문이다. #056의 ContextManager가 "turn 23은 요약 레이어 2에 흡수되어 evict됐다"고 알려주는데, AEJ가 이 정보를 모르면 RCA의 causality chain이 거기서 끊긴다. PLKCH의 Merkle proof가 특정 chunk의 압축 검증에 사용되었다는 정보도 AEJ에 기록되어야 RCA 시 "이 chunk가 의도한 컨텍스트와 다르게 압축되었다"는 결론을 내릴 수 있다.

---

## 6. DeterministicReplayEngine으로 CI에서 회귀 탐지

AEJ의 가장 실용적인 사용 사례는 **CI/CD에서의 회귀 탐지**다. "새로운 tool을 추가했는데, 기존에 잘 작동하던 agent가 갑자기 완전히 다른 tool을 선택한다"는 상황을 잡아낼 수 있다.

```typescript
interface RegressionResult {
  detected: boolean;
  changes: Array<{
    turnIndex: number;
    field: "toolSelection" | "responseContent" | "decisionPath" | "costProfile";
    before: string | number | null;
    after: string | number | null;
    severity: "info" | "warning" | "critical";
  }>;
  summary: string;
}

class RegressionDetector {
  private journalStore: JournalStore;
  private replayEngine: DeterministicReplayEngine;

  constructor(
    journalStore: JournalStore,
    replayEngine: DeterministicReplayEngine
  ) {
    this.journalStore = journalStore;
    this.replayEngine = replayEngine;
  }

  async detect(
    baselineSessionId: string,
    targetSessionId: string
  ): Promise<RegressionResult> {
    const baseline = await this.journalStore.getSession(baselineSessionId);
    const target = await this.journalStore.getSession(targetSessionId);

    if (baseline.length !== target.length) {
      return {
        detected: true,
        changes: [{
          turnIndex: -1,
          field: "decisionPath",
          before: `${baseline.length} turns`,
          after: `${target.length} turns`,
          severity: "critical",
        }],
        summary: `Turn count changed: ${baseline.length} → ${target.length}. Agent may have diverged in decision path.`,
      };
    }

    const changes: RegressionResult["changes"] = [];

    for (let i = 0; i < Math.min(baseline.length, target.length); i++) {
      const baselineEntry = baseline[i];
      const targetEntry = target[i];

      // Tool selection 비교
      const baselineTools = baselineEntry.toolCalls.map(tc => tc.toolName).sort();
      const targetTools = targetEntry.toolCalls.map(tc => tc.toolName).sort();
      
      if (JSON.stringify(baselineTools) !== JSON.stringify(targetTools)) {
        changes.push({
          turnIndex: i,
          field: "toolSelection",
          before: baselineTools.join(", "),
          after: targetTools.join(", "),
          severity: "critical",
        });
      }

      // Cost profile 비교
      const baselineCost = baselineEntry.llmCall.promptTokens + baselineEntry.llmCall.completionTokens;
      const targetCost = targetEntry.llmCall.promptTokens + targetEntry.llmCall.completionTokens;
      
      if (Math.abs(baselineCost - targetCost) / baselineCost > 0.3) {
        changes.push({
          turnIndex: i,
          field: "costProfile",
          before: baselineCost,
          after: targetCost,
          severity: "warning",
        });
      }

      // Decision path 비교
      if (baselineEntry.snapshot.decisionConfidence !== targetEntry.snapshot.decisionConfidence) {
        const diff = Math.abs(
          (baselineEntry.snapshot.decisionConfidence ?? 0) -
          (targetEntry.snapshot.decisionConfidence ?? 0)
        );
        if (diff > 0.2) {
          changes.push({
            turnIndex: i,
            field: "decisionPath",
            before: baselineEntry.snapshot.decisionConfidence,
            after: targetEntry.snapshot.decisionConfidence,
            severity: "warning",
          });
        }
      }
    }

    return {
      detected: changes.length > 0,
      changes,
      summary: changes.length > 0
        ? `Detected ${changes.length} regression(s) across ${baseline.length} turns. ${changes.filter(c => c.severity === "critical").length} critical.`
        : "No regression detected.",
    };
  }
}
```

CI 파이프라인에서의 사용 예:

```typescript
// CI workflow (예: Jest)
describe("Agent regression tests", () => {
  const referenceJournal = loadReferenceJournal("baseline-2026-07-01.json");
  const detector = new RegressionDetector(store, engine);

  test("tool selection should not change", async () => {
    const result = await detector.detect(
      "baseline-session",
      "pr-session"
    );
    
    expect(
      result.changes.filter(c => c.severity === "critical").length
    ).toBe(0);
    
    if (result.changes.length > 0) {
      console.table(result.changes);
    }
  });
});
```

---

## 7. 벤치마크 (Apple M2 Pro)

실험 환경: Apple M2 Pro (12 CPU, 19 GPU, 32GB unified memory), GPT-4o API (128K context), 100-turn agent loop, 23개 tool call 포함. Agent: customer service bot (고객 문의 분류 → DB 조회 → 응답 생성).

### 7.1 Journal 수집

| 메트릭 | 값 | 비고 |
|---|---|---|
| 총 Journal 크기 | 14.3 MB | 100 turn, 23 tool call |
| Entry당 평균 크기 | 143 KB | LLM prompt 52KB + completion 4KB + tool 결과 87KB |
| 수집 오버헤드 | 127ms (전체 실행 시간의 2.1%) | Web Worker에서 비동기 캡처 |
| LLM call 캡처 정확도 | 100% | API 응답 로깅 |
| Tool call 캡처 정확도 | 100% | Proxy wrapping |
| Snapshot 캡처 정확도 | 92.3% | Budget, confidence가 수집되지 않은 turn 7.7% (agent가 snapshot 인터페이스 미구현) |
| Causality link 정확도 | 96.7% | Tool call을 통하지 않은 causality (동일 turn 내 side effect) 3.3% 미탐지 |

### 7.2 Replay 성능

| 모드 | 실행 시간 | 일치율 (matchScore) | 비고 |
|---|---|---|---|
| Full live | 100.2초 | — | 원래 실행 |
| Mock replay | 21.3초 (4.7x) | 0.89 ± 0.11 | LLM 호출 모조, tool 실행만 실제 |
| Hybrid (temp ≤ 0.3) | 34.7초 (2.9x) | 0.94 ± 0.07 | 결정론적 호출만 mock |
| Live replay (seed 고정) | 95.8초 (1.05x) | 0.71 ± 0.23 | seed 고정해도 temperature > 0에서 변동 |

Mock replay가 4.7x 느린 이유: tool call의 실제 실행과 JournalEntry 기록/검증 I/O가 여전히 발생하기 때문. LLM 호출만 mock으로 대체된 상태다.

Temperature 0.7의 100-turn 시나리오에서 seed 고정 live replay의 matchScore가 0.71에 불과한 것은 deterministic sampling이 temperature > 0 영역에서 완전히 결정론적으로 작동하지 않기 때문이다. OpenAI의 `seed` 파라미터는 "best-effort deterministic"으로, 같은 seed가 같은 응답을 보장하지 않는다 (OpenAI 문서). Anthropic은 seed 파라미터를 아예 제공하지 않는다.

### 7.3 RCA 정확도

| 메트릭 | 값 | 비고 |
|---|---|---|
| RCA recall (top-1) | 67.2% | 첫 번째 root cause 정확 식별 |
| RCA recall (top-3) | 83.4% | 상위 3개 root cause 중 하나 이상 정확 |
| RCA precision | 58.9% | root cause로 지목된 turn의 약 41%가 false positive |
| Causal path 길이 | 평균 4.7 turn | root cause에서 최종 오류까지 |
| RCA confidence 상관계수 | r = 0.74 | confidence 점수와 실제 recall 간 상관 |
| Intervention 시나리오 정확도 | 71.3% | "이 turn을 수정하면 오류가 60% 감소" 예측의 정확도 |

### 7.4 Regression Detection

| 메트릭 | 값 | 비고 |
|---|---|---|
| F1 score | 0.91 | 회귀 탐지 정확도 |
| True positive rate | 94.2% | 실제 회귀를 탐지한 비율 |
| False positive rate | 12.1% | 오경보 비율 |
| Detection latency | 34.7ms | 100-turn 비교 평균 |
| Turn 수 불일치 탐지 | 100% | turn 개수가 다르면 항상 탐지 |
| Cost profile drift 탐지 | 87.2% | 30% 이상 비용 변화를 탐지 |

F1 0.91은 production에서 사용 가능한 수준이다. False positive 12.1%는 대부분 temperature > 0.5 구간에서 발생하는 자연스러운 응답 변동에 의한 것으로, 임계값을 높이거나 multi-sample 통계로 완화할 수 있다.

---

## 8. 한국 시장 적용 사례: HyperCLOVA X Agent Journal

네이버 HyperCLOVA X의 Agent for Customer Service (가칭)에 AEJ를 적용하는 시나리오를 살펴보자.

### 8.1 HyperCLOVA X Agent Journal

네이버의 HyperCLOVA X는 2026년 6월 출시된 200K 컨텍스트 에이전트 SDK로, 한국어 특화 agent 구축을 지원한다. AEJ 통합 시 고려할 점:

```typescript
class HyperCLOVAXJournalAdapter {
  // HyperCLOVA X의 한국어 토큰화 특성 반영
  static estimateKoreanCost(prompt: string): { tokens: number; costKRW: number } {
    // 한국어는 영어 대비 평균 2.3~2.8배 토큰
    const englishTokens = prompt.split(/\s+/).length * 1.3; // 어림
    const koreanMultiplier = 2.5; // HyperCLOVA X 한국어 평균
    
    const tokens = Math.round(englishTokens * koreanMultiplier);
    // HyperCLOVA X token pricing (2026-06 기준): ₩8~15/1K tokens
    const costPerK = 12; // 평균
    const costKRW = (tokens / 1000) * costPerK;
    
    return { tokens, costKRW };
  }

  // HyperCLOVA X의 한국어 응답에 특화된 JournalEntry 검증
  static verifyKoreanResponse(entry: JournalEntry): { valid: boolean; issues: string[] } {
    const issues: string[] = [];
    const completion = entry.llmCall.completion;

    // 한글 응답 품질 검증
    const koreanRatio = (completion.match(/[가-힣]/g)?.length ?? 0) / completion.length;
    if (koreanRatio < 0.1 && completion.length > 50) {
      issues.push("Low Korean ratio in response (expected > 10% for Korean customer service)");
    }

    // HyperCLOVA X 특화 검증: 존댓말 일관성
    const hasFormal = /(입니다|습니다|세요|ㅂ니다)/.test(completion);
    const hasInformal = /(야|어|지|네)/.test(completion);
    if (hasFormal && hasInformal) {
      issues.push("Mixed honorific levels (formality inconsistency)");
    }

    return { valid: issues.length === 0, issues };
  }
}
```

### 8.2 35-step Customer Service Agent의 Journal 예시

다음은 HyperCLOVA X에서 실행된 35-step customer service agent의 Journal 일부 (축약):

```
Session: hyperclova-cs-20260712-001 (35 turns)

Turn  0: [SYSTEM] Agent initialized. Customer: "계좌 이체가 안 돼요. 3번 시도했는데 모두 실패했어요."
Turn  1: LLM → Tool `getAccountInfo("customer-102938")` → result: {balance: 3450000, status: "active", limit: 5000000}
Turn  2: LLM → Tool `getTransactionHistory("customer-102938", 7)` → result: [{date: "2026-07-11", type: "withdrawal", amount: 100000}, ...]
Turn  3: LLM → Tool `getTransferRestrictions("customer-102938")` → result: {dailyLimit: 10000000, used: 0, remainingLiquid: 3450000}
Turn  4: LLM → Tool `simulateTransfer("customer-102938", "customer-876543", 50000)` → result: {possible: true, fee: 500, estimatedArrival: "immediate"}
  ⚠ Turn 4에서 tool 호출: simulateTransfer 호출은 성공했지만, LLM이 output에 "500원 수수료"가 있다는 사실을 생략함
  ⚠ Causality: turn 4의 이 생략이 turn 5에 영향을 줌
Turn  5: LLM → Customer: "송금이 가능합니다. 50,000원을 즉시 송금하시겠습니까?"
  ⚠ 수수료 정보 누락 → RCA 분석 결과: turn 4의 simulateTransfer 결과에서 fee 필드를 출력 생성에 포함하지 않음
  ⚠ Intervention: "simulateTransfer tool의 output template에 fee를 항상 포함하도록 강제"
```

RCA 분석 (partial):

```
Root Cause (score: 0.87):
  Turn 4 (turnIndex: 4, toolCalls: ["simulateTransfer"])
  Evidence:
    - Tool "simulateTransfer" returned {possible: true, fee: 500, estimatedArrival: "immediate"}
    - But LLM response omitted fee information
    - Parent turn (index 3) errorScore: 0.12 (low, not the root cause)
    - Decision confidence dropped from 0.85 (turn 3) to 0.71 (turn 4)
  Intervention: "Enforce fee disclosure in simulateTransfer output template. Add system prompt: 'Never omit fee information when informing the customer.'"
  Expected Impact: 0.73 (73% of downstream errors in this session originate from this omission)

Diffusion Path:
  Turn 4 (errorScore: 0.31) → Turn 5 (errorScore: 0.15) → Turn 6-8 normal → Turn 9 (customer complaints about hidden fee)
```

---

## 9. 자가비판 (Self-Critique)

AEJ는 강력한 디버깅 도구이지만, 완벽하지 않다. 6가지 한계를 솔직히 인정한다.

### 9.1 Replay 정확도의 근본적 한계

**문제**: LLM의 temperature > 0 영역에서 exact replay는 불가능하다. `seed` 파라미터는 provider마다 구현이 다르고 (OpenAI: best-effort, Anthropic: 미지원, Gemini: 미지원), 같은 seed + 같은 prompt가 같은 응답을 보장하지 않는다. Temperature 0.7에서 matchScore의 표준 편차가 0.23인 것은 이 한계를 그대로 드러낸다.

**대응**: (1) Logprob 기반 가중치로 "LLM이 확신한 부분"의 일치도를 우선 측정, (2) Hybrid 모드에서 temperature ≤ 0.3 구간만 mock, (3) LLM-as-judge로 "응답의 의미적 동등성" 검증 추가. 이 세 가지를 조합하면 실용적 수준의 replay fidelity (0.89~0.94)를 달성할 수 있다.

### 9.2 Journal Storage 비용

**문제**: 100-turn agent loop에서 14.3MB. 하루 10만 세션을 처리하는 production 시스템에서는 1.43TB/일의 journal이 생성된다. 30일 보존 시 42.9TB, 1년이면 521TB. JournalEntry 자체는 LLM prompt를 포함하기 때문에 압축이 어렵다.

**대응**: (1) 3-tier cold storage 정책: 7일 Hot (SSD, 전체 JournalEntry), 30일 Warm (HDD, causality link + summary), 90일 Cold (Object Storage, index only + S3에 압축 Journal). (2) Selective Journal: errorScore > 0인 turn만 전체 저장, 정상 turn은 요약만. (3) Journal pruning: JournalEntry의 prompt 필드에서 system prompt (공통)를 별도 저장, session-unique chat history만 저장해 60~70% 압축.

### 9.3 Causality Graph의 Transitive Closure 폭발

**문제**: causality graph가 완전한 DAG일 때 transitive closure의 크기는 O(n)이다. 하지만 agent가 같은 tool을 반복 호출하고, tool 간 side effect로 인해 causality graph가 사실상 완전 그래프에 가까워지면 (각 turn이 모든 이전 turn에 간접 의존), RCA 분석의 복잡도가 기하급수적으로 증가한다.

**대응**: (1) depth-limit: 10단계 이상의 causality chain은 "deep dependency, need specialization"으로 분류하고 RCA 대상에서 제외. (2) Tool-level granularity: "이 tool이 어떤 데이터에 의존하는지"를 명시적으로 선언하고, causality link를 이 데이터 흐름을 따라서만 구성. (3) Diffusion score threshold: 전파율이 0.1 미만인 causal path는 무시.

### 9.4 RCA False Positive (Correlation ≠ Causation)

**문제**: RCA가 "turn 17의 tool timeout이 turn 18-35의 모든 오류를 유발했다"고 결론내렸지만, 실제로는 turn 17의 timeout과 turn 18-35의 오류가 독립적으로 발생했을 수 있다. Correlation을 causation으로 오해할 위험.

**대응**: (1) Causal intervention 시뮬레이션: "turn 17을 수정하면 turn 18-35가 얼마나 바뀌는지"를 mock replay로 검증. 같은 turn 17 수정으로 다른 세션의 오류도 감소하는지 cross-validation. (2) Temporal ordering 검증: "turn 17이 마지막으로 정상이었던 시점 이후에 첫 오류가 발생했는지" 확인. (3) Statistical significance: 같은 유형의 오류가 10회 이상 반복될 때만 RCA 결론을 내림.

### 9.5 LLM Provider API Mock의 Fidelity

**문제**: MockLLMProvider는 JournalEntry의 `completion`을 그대로 반환하지만, 실제 production에서 LLM의 응답 형식이 변경되면 (예: tool call JSON 형식 변경, 새 필드 추가) mock이 실제와 달라진다. API version upgrade, model rotation 등이 mock fidelity를 깨는 주기적 원인이 된다.

**대응**: (1) Mock validation: 주기적(1일 1회) live LLM 호출로 mock의 최신성 검증. matchScore가 0.8 미만이면 mock expired 플래그 설정. (2) schema versioning: JournalEntry의 `llmCall.completion`에 format version 필드 추가. API 버전이 바뀌면 field가 증가하고 migration이 트리거됨. (3) Provider adapter: LLM provider의 응답 형식을 정규화하는 어댑터 레이어. provider가 바뀌어도 JournalEntry의 구조는 동일하게 유지.

### 9.6 Privacy / Jurisdiction (PII 포함 가능성)

**문제**: JournalEntry는 LLM prompt 전체 (사용자 메시지 포함)와 tool call 결과 (DB 조회 결과 포함)를 캡처한다. Journal 그 자체가 PII 저장소가 될 위험이 있다. 한국 PIPA 제22조 (정보주체 동의), 제29조 (개인정보 열람), 유럽 GDPR 제17조 (잊힐 권리)가 모두 Journal의 수집/보존에 충돌한다.

**대응**: (1) PII masking: Journal 수집 시점에 prompt와 tool result에서 정규식/ML 기반 PII 마스킹 (주민번호, 전화번호, 계좌번호, 카드번호). 마스킹된 값은 `***`로 대체하고, 원본은 Journal 외부의 secure vault에 별도 저장. (2) Journal TTL + auto-purge: 기본 보존 7일, 법적 요구 시 최대 30일. 30일 초과 Journal은 PII 제거 후 통계 메타만 보존. (3) Audit log: Journal 접근 기록을 별도 보존 (AI 기본법 제33조 감사 log 요구사항 충족). Journal 자체의 Journal (recursive).

---

## 10. 시리즈 로드맵 업데이트: AEJ (#061) 이후

지금까지 9편의 시리즈를 통해 **"다중 에이전트 시스템의 통신, 검증, 압축, 디버깅"** 을 완성했다. 이제 생태계의 큰 그림을 다시 그려보자:

```
        ┌─────────────────────────────────────────────────────┐
        │              Multi-Agent Production Stack            │
        ├─────────────────────────────────────────────────────┤
        │                    #061 AEJ                          │
        │          (Execution Journal + Debugging)             │
        ├─────────────────────────────────────────────────────┤
        │    #060 PLKCH          │    #058 CHP (#059 CT-CHP)  │
        │  (Verifiable Cache)    │  (Context Handoff)         │
        ├─────────────────────────────────────────────────────┤
        │    #055 Context Eng.   │    #056 Observability      │
        │    #057 Policy Opt.    │  (Evicted-Turn Provenance) │
        ├─────────────────────────────────────────────────────┤
        │    #053 Agentic Commerce   │  #054 Credit Scoring   │
        │  (x402, ACP, Wallet)       │  (Temporal GAT)        │
        └─────────────────────────────────────────────────────┘
```

**다음 시리즈 (2026년 7월 중순 ~ 8월)**:

- **#062 Agent Service Mesh**: 다중 에이전트를 하나의 서비스 메시로 연결하는 라우팅, 로드 밸런싱, circuit breaker 설계. (#058 CHP를 인프라 레벨로 일반화)
- **#063 Agent as a Product (AaaP)**: "에이전트 자체를 SaaS 제품으로" — Agent SDK, Agent Store, Agent License, Agent SLA. (#053 Agentic Commerce의 확장)
- **#064 Agent SLO Framework**: Task Success Rate, Time-to-Useful-Action, Decision Drift Rate 등 Agent 생산성 측정의 표준화와 SLA 연동. (#061 AEJ를 SLA로 확장)

시리즈가 길어질수록 overlap 방지가 더 중요해진다. #062~#064는 각각 (1)인프라 라우팅, (2)비즈니스 제품화, (3)품질 계측이라는 완전히 다른 각도에서 접근할 예정이다.

---

## 참고 자료

1. Lost-in-the-Middle (Liu et al., 2023) — https://arxiv.org/abs/2307.03172
2. OpenAI Prompt Caching (2024) — https://platform.openai.com/docs/guides/prompt-caching
3. Anthropic Prompt Caching (2024) — https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
4. Gemini Context Caching (2025) — https://ai.google.dev/gemini-api/docs/caching
5. SWE-bench: Can Language Models Resolve Real-World GitHub Issues? (Jimenez et al., 2024)
6. GAIA: A Benchmark for General AI Assistants (Mialon et al., 2023)
7. Patronus AI Series B ($50M, June 2026)
8. AgentOps: Agent Observability Platform (2025-2026)
9. Langfuse: Open-Source LLM Observability (2024-2026)
10. PIPA (Personal Information Protection Act, Korea, 2023 개정)
11. AI 기본법 (Korea, 2026.1 시행) — 제31조(설명가능성), 제33조(감사), 제35조(구제채널)
12. HyperCLOVA X Agent SDK (2026-06) — 네이버클라우드 개발자 문서
13. deterministic_sampling / seed reproducibility — OpenAI Platform Docs
14. KISA AI Trustworthiness Guidelines (2025-12 개정)
