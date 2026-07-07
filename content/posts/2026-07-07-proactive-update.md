---
title: "ContextManager Observability: Evicted-Turn Provenance와 7대 Trace Signal — AI 에이전트 컨텍스트 망가짐을 추적하는 시스템 (#056)"
date: "2026-07-07"
description: "2026년 7월, 직전 글(#055)의 ContextManager가 '왜 이 turn을 evict 했는가'에 답하지 못하면 디버깅은 끝없는 추측 게임이 된다. 본 글은 Evicted-Turn Provenance(추방된 turn의 출처 추적), 7대 Trace Signal(eviction_reason, importance_score, attention_band, llm_cited, retrieval_hydrated, summary_layer, drift_delta), 그리고 OpenTelemetry GenAI Semantic Conventions 기반의 Trace 스키마를 TypeScript로 직접 구현한다. RAG의 Grounding & Citations 표준 패턴(Quoted Span, Citation Footnote, Verification Pass)을 컨텍스트 관리에 역수입하는 새로운 아키텍처, HyperCLOVA X와 Exaone 200K 환경에서의 비용 vs 디버깅 가능성 trade-off, 한국 AI Agent Observability 시장 전망까지 다룬다."
tags:
  - AI Agent
  - Context Engineering
  - Observability
  - Evicted-Turn Provenance
  - OpenTelemetry
  - GenAI Semantic Conventions
  - Grounding
  - Citations
  - Trace
  - KV Cache
  - Production Engineering
  - TypeScript
  - Korean Market
  - HyperCLOVA X
  - Exaone
---

## TL;DR

- **문제 정의**: 직전 글(#055)의 ContextManager는 turn을 evict 한다. 그러나 **왜 evict 했는지**, **언제 evict 했는지**, **LLM이 그 turn을 인용했는지**, **회수하면 어떻게 되는지** 를 기록하지 않는다. 장애 발생 시 "왜 갑자기 답이 이상해졌지?" 라는 질문에 답할 수 없다.
- **본 글의 제안**: **Evicted-Turn Provenance (추방된 turn의 출처)** 라는 새로운 observability primitive. evict가 발생할 때마다 7대 Trace Signal을 함께 저장한다. (1) `eviction_reason`, (2) `importance_score`, (3) `attention_band`, (4) `llm_cited`, (5) `retrieval_hydrated`, (6) `summary_layer`, (7) `drift_delta`.
- **RAG Grounding의 역수입**: 2026-07-07 오늘의 AI Knowledge Pill 주제인 "Grounding & Citations"는 RAG 응답에 출처를 붙이는 패턴이다. 본 글은 이 패턴을 **컨텍스트 관리**로 역수입한다. evict된 turn에도 "citation footnote" 을 남겨, 나중에 recall 하면 근거가 따라온다.
- **OpenTelemetry GenAI Semantic Conventions**: OTel은 2026년 4월에 `gen_ai.*` span attribute 표준을 발표했다. 본 글의 Trace 스키마는 이 표준과 호환된다 (`gen_ai.operation.name`, `gen_ai.usage.input_tokens`, `gen_ai.agent.context.evicted_turns` 등).
- **TypeScript 구현**: `ContextTraceStore` (evict 이벤트 저장), `EvictionReasonClassifier` (4대 이유 분류), `DriftDetector` (decision drift 측정), `CitationLinker` (LLM 응답 ↔ 컨텍스트 turn 링크) 4개 컴포넌트.
- **한국 시장 적용**: HyperCLOVA X 200K는 2026년 6월부터 per-token trace 옵션을 제공하기 시작했다. SKT A.X 4는 자체 observability 대시보드를 내장. 토종 모델에서도 evict 추적이 곧 production 필수.
- **핵심 인사이트**: **"Eviction은 손실이 아니라 압축이다"**. 그러나 압축이 일어났다는 사실을 **기억하지 못하면**, 그 압축을 풀 수 없다. Provenance는 압축의 reversible log 이다.

---

## 1. 들어가며: ContextManager는 침묵한다

직전 글(#055) 에서 우리는 5대 컨텍스트 압축 전략을 다뤘다. Sliding Window, Hierarchical Map-Reduce, Semantic Compression, RAG-backed External Memory, Ephemeral Subagent Delegation. 모두 효과적이지만, 공통된 결함이 하나 있다.

> **"왜 이 turn이 사라졌는가?"**

라는 질문에 답할 수 없다는 점.

Production 환경에서 AI 에이전트를 운영하다 보면 이런 상황을 반드시 만나게 된다.

```
[15:23:45] user: 이번 분기 매출 보고서를 작성해줘
[15:24:12] agent: 1분기 매출을 조회합니다.
[15:24:13] tool_call: get_quarterly_revenue(quarter="Q1")
[15:24:15] observation: Q1 매출은 1,200억원 (전년 대비 +12%)
[15:25:30] agent: 2분기 매출을 조회합니다.
[15:25:31] tool_call: get_quarterly_revenue(quarter="Q2")
[15:25:33] observation: Q2 매출은 1,350억원 (전년 대비 +25%)
... (중략, 30 step)
[15:42:08] agent: 이번 분기 매출은 1,200억원입니다.
[15:42:09] [ERROR] user: 아니, 2분기는 1,350억원이라고 했잖아?
[15:42:10] agent: 죄송합니다. 다시 조회하겠습니다.
```

이런 "에이전트가 자기 발을 쏘는" 현상의 원인은 여러 가지다.

1. **Lost-in-the-Middle**: 30 step 후 Q2 매출이 컨텍스트 중간으로 밀려났다.
2. **Eviction without trace**: Sliding Window이 Q2 turn을 evict 했는데, 그 사실이 기록되지 않았다.
3. **No citation**: LLM이 답할 때 "Q2 매출 1,350억원"이라는 사실의 **출처 turn**을 인용하지 않았다.

직전 글의 ContextManager는 (1)을 완화했지만, (2)와 (3)는 다루지 않았다. 본 글은 그 두 가지를 다룬다.

> **핵심 주장**: Eviction은 손실이 아니다. **기록 없는 압축이** 손실이다.

---

## 2. Evicted-Turn Provenance: 새로운 observability primitive

### 2.1 정의

**Evicted-Turn Provenance (추방된 turn의 출처)** 란, 컨텍스트에서 evict 된 turn에 대해 다음 7가지 메타데이터를 함께 저장하는 관찰 가능성 패턴이다.

| Signal | 의미 | 사용 예시 |
|---|---|---|
| `eviction_reason` | 왜 evict 됐는가 | 디버깅 시 "compression" 때문인지 "window overflow" 때문인지 구분 |
| `importance_score` | evict 직전의 중요도 점수 (0-1) | 회수 우선순위 결정 |
| `attention_band` | evict 직전에 어느 attention 위치에 있었는가 | Lost-in-the-Middle 검증 |
| `llm_cited` | evict 전 LLM이 이 turn을 인용했는가 | 인용된 turn이 evict되면 재주입 후보 |
| `retrieval_hydrated` | 이 turn이 retrieval로 다시 주입 가능한가 | RAG 재hydration 가능 여부 |
| `summary_layer` | 어떤 계층의 summary에 흡수됐는가 (없으면 -1) | 원본 회수 시 어느 summary부터 봐야 하는지 |
| `drift_delta` | evict 결정 직전 decision drift 양 | drift가 큰 turn부터 evict 했는지 검증 |

이 7개 signal은 evict 이벤트 발생 시점에 한 번에 저장되며, 이후 traceback 과 회수(re-hydration) 두 가지 용도로 사용된다.

### 2.2 왜 7개인가

더 적으면 디버깅에 부족하고, 더 많으면 storage 비용이 폭증한다. 7개는 다음 세 가지 트레이드오프의 균형점이다.

1. **Storage cost vs debuggability**: turn당 평균 7개 signal × 200 bytes = 1.4KB. 10만 turn/day 서비스라면 **140MB/day**. 수용 가능.
2. **Read pattern diversity**: 디버거, 회수기, 분석기, 평가기 4가지 read pattern을 모두 지원하려면 7개가 최소.
3. **Schema evolution**: 7개 중 5개(eviction_reason, importance_score, llm_cited, summary_layer, drift_delta)는 고정, 2개(attention_band, retrieval_hydrated)는 optional. 향후 v2에서 추가 가능.

### 2.3 직전 글과의 연결

#055 의 5대 압축 전략을 다시 떠올려 보자.

| 전략 (#055) | 본 글의 Provenance 확장 |
|---|---|
| Sliding Window | evict 시점에 `eviction_reason="window_overflow"` + `importance_score` 저장 |
| Hierarchical Map-Reduce | Map 단계에서 evict → `summary_layer=1`, Reduce 단계에서 evict → `summary_layer=2` |
| Semantic Compression | 압축된 schema로 변환된 turn은 `retrieval_hydrated=true` (필드 일부라도 복원 가능) |
| RAG-backed External Memory | 외부 저장소로 이동한 turn은 `retrieval_hydrated=true`, `summary_layer=-1` (summary 없음) |
| Ephemeral Subagent | subagent에게 위임된 turn은 `eviction_reason="delegated"`, `retrieval_hydrated=false` |

각 전략에 대해 Provenance schema가 다르며, 이를 통해 **"5대 전략 중 어떤 전략이 evict 했는가"** 도 한 번에 알 수 있다.

---

## 3. 7대 Trace Signal 상세 설계

### 3.1 `eviction_reason`: 4대 카테고리

evict가 일어나는 이유는 본질적으로 4가지로 분류된다.

```typescript
type EvictionReason =
  | "window_overflow"      // Sliding Window의 size 한계 초과
  | "compression"          // Semantic Compression으로 축약됨
  | "summary_absorbed"     // Hierarchical Map-Reduce의 summary에 흡수됨
  | "delegated";           // Subagent에게 위임됨

function classifyEvictionReason(
  before: ContextTurn[],
  after: ContextTurn[],
  evictedTurn: ContextTurn
): EvictionReason {
  if (evictedTurn.delegated_to_subagent) return "delegated";
  if (evictedTurn.summary_layer >= 0) return "summary_absorbed";
  if (evictedTurn.compressed_fields) return "compression";
  return "window_overflow";
}
```

이 분류의 핵심 가치는 **"strategy attribution"** 이다. 장애 분석 시 "compression 때문에 정보가 사라졌는지, summary 때문에 사라졌는지, 단순 window overflow 때문인지" 가 명확해진다.

### 3.2 `importance_score`: 0에서 1 사이의 보존 가치

evict 직전 turn의 정보 가치를 정량화한다. 본 글에서는 **Shannon Entropy 기반 점수**를 제안한다 (직전 글 #055 의 전략 1과 호환).

```typescript
interface ImportanceScorer {
  /**
   * turn의 정보량을 [0, 1] 사이로 정규화.
   * 1에 가까울수록 보존 가치가 높음.
   */
  score(turn: ContextTurn, context: ContextTurn[]): number;
}

class EntropyImportanceScorer implements ImportanceScorer {
  // (1) 내용 엔트로피: 얼마나 새로운 정보 단어가 있는가
  private contentEntropy(turn: ContextTurn): number {
    const tokens = tokenize(turn.content);
    const counts = new Map<string, number>();
    for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);

    let entropy = 0;
    const total = tokens.length;
    for (const c of counts.values()) {
      const p = c / total;
      if (p > 0) entropy -= p * Math.log2(p);
    }
    // log2(|vocab|) 로 정규화 (0~1)
    return entropy / Math.log2(counts.size + 1);
  }

  // (2) 인용 빈도: 직전 5 turn에서 이 turn을 참조하는 빈도
  private citationFrequency(turn: ContextTurn, ctx: ContextTurn[]): number {
    const recent = ctx.slice(-5);
    let cites = 0;
    for (const other of recent) {
      if (other.tool_call?.references_turn_id === turn.id) cites++;
    }
    return cites / 5; // 0~1
  }

  // (3) 툴 출력 보존 가치: tool 결과는 일반적으로 더 중요
  private toolOutputValue(turn: ContextTurn): number {
    if (turn.role === "tool") return 0.8;
    if (turn.role === "assistant" && turn.tool_call) return 0.6;
    return 0.4;
  }

  score(turn: ContextTurn, ctx: ContextTurn[]): number {
    const e = this.contentEntropy(turn);
    const c = this.citationFrequency(turn, ctx);
    const t = this.toolOutputValue(turn);

    // 가중 합산 (튜닝 가능한 가중치)
    return 0.4 * e + 0.4 * c + 0.2 * t;
  }
}
```

**임계값 정책**: 기본적으로 `importance_score >= 0.6` 인 turn은 evict 대상에서 제외한다. 단, `summary_layer` 가 이미 있다면 (이미 요약된 적 있다면) 임계값을 0.4 로 낮춰 요약본을 우선 evict 한다.

### 3.3 `attention_band`: Lost-in-the-Middle 검증

evict 직전 turn이 LLM 컨텍스트의 어느 위치에 있었는지를 기록한다.

```typescript
type AttentionBand = "head" | "tail" | "middle" | "unknown";

function classifyAttentionBand(
  contextPosition: number,  // 0-based, 컨텍스트 내 위치
  totalLength: number
): AttentionBand {
  const ratio = contextPosition / totalLength;
  if (ratio < 0.15) return "head";      // 처음 15%
  if (ratio > 0.85) return "tail";      // 끝 15%
  if (ratio >= 0.4 && ratio <= 0.6) return "middle";  // 정중앙 20%
  return "unknown";
}
```

이 signal의 핵심 용도는 **"Lost-in-the-Middle 가설 검증"** 이다. Stanford 2023 / Anthropic 2025 의 U-curve 가설이 production에서도 성립하는지 확인하려면, `attention_band="middle"` 인 turn 들의 `llm_cited` 비율을 집계해야 한다.

```
Hypothesis: attention_band="middle" 인 turn의 llm_cited 비율은
            "head" / "tail" 보다 40-60% 낮아야 한다.
```

만약 가설이 production에서 성립하면, ContextManager는 **middle band 의 llm_cited=false 인 turn** 을 가장 먼저 evict 대상으로 선정한다.

### 3.4 `llm_cited`: 인용 여부 추적

LLM 응답이 특정 컨텍스트 turn을 "인용했는가" 를 자동으로 판별한다. 단순 substring 매칭이 아니라, **semantic citation detection** 으로 구현한다.

```typescript
interface CitationLinker {
  /**
   * LLM 응답이 어떤 turn들을 인용했는지 식별.
   * 임베딩 유사도 + 토큰 overlap 결합.
   */
  linkCitations(
    response: string,
    candidateTurns: ContextTurn[]
  ): CitedTurnRef[];
}

interface CitedTurnRef {
  turn_id: string;
  cited_at_response_offset: number;  // 응답 내 위치
  similarity_score: number;          // 0~1
  cited_quote: string;              // 응답이 turn 내용을 인용한 부분
}

class EmbeddingCitationLinker implements CitationLinker {
  constructor(private embedder: Embedder) {}

  async linkCitations(
    response: string,
    candidates: ContextTurn[]
  ): Promise<CitedTurnRef[]> {
    const responseChunks = chunkText(response, 200); // 200 토큰 청크
    const responseEmbeds = await Promise.all(
      responseChunks.map(c => this.embedder.embed(c))
    );

    const refs: CitedTurnRef[] = [];
    for (const turn of candidates) {
      const turnEmbed = await this.embedder.embed(turn.content);
      for (let i = 0; i < responseChunks.length; i++) {
        const sim = cosineSimilarity(turnEmbed, responseEmbeds[i]);
        if (sim > 0.82) {
          refs.push({
            turn_id: turn.id,
            cited_at_response_offset: i,
            similarity_score: sim,
            cited_quote: extractOverlap(turn.content, responseChunks[i])
          });
        }
      }
    }
    return refs;
  }
}
```

이 `llm_cited` signal이 `true` 인 turn이 evict될 때, ContextManager는 두 가지 action 중 하나를 자동 수행한다.

1. **Re-hydrate**: evict 대신 외부 메모리로 옮기고 retrieval 활성화
2. **Soft-evict**: evict 하지만 `retrieval_hydrated=true` 로 표시, 차후 LLM이 인용하려 하면 자동 복원

### 3.5 `retrieval_hydrated`: RAG 재주입 가능성

evict 된 turn을 retrieval로 다시 주입할 수 있는지를 boolean 으로 표시한다.

```typescript
interface RehydrationPolicy {
  /**
   * evict 시점에 외부 메모리에 보존할지 결정.
   * true면 retrieval 대상, false면 완전 손실.
   */
  shouldHydrate(turn: ContextTurn, signal: EvictionSignals): boolean;
}

class DefaultRehydrationPolicy implements RehydrationPolicy {
  shouldHydrate(turn: ContextTurn, signal: EvictionSignals): boolean {
    // (1) 툴 출력은 거의 항상 보존 (데이터 손실 비용 큼)
    if (turn.role === "tool") return true;

    // (2) LLM이 인용한 turn은 보존
    if (signal.llm_cited) return true;

    // (3) importance_score 가 높은 turn은 보존
    if (signal.importance_score >= 0.7) return true;

    // (4) 그 외는 압축만 시도
    return false;
  }
}
```

이 policy에 의해 보존된 turn들은 **Vector DB** (혹은 hyperdimensional KV cache) 에 저장되며, 추후 `retrieval(query_embedding) -> turn` 으로 recall 된다.

### 3.6 `summary_layer`: 계층적 요약 추적

Hierarchical Map-Redue 요약에서, evict 된 turn이 **어느 계층의 summary에 흡수되었는지** 를 기록한다.

```typescript
interface SummaryLayerMap {
  // 0: 원본 turn
  // 1: Map 단계 요약 (8K 청크 → 0.5K)
  // 2: Reduce 단계 요약 (0.5K × N → 1K)
  // 3: 통합 요약 (1K × M → 2K)
  layer: number;
  summary_turn_id: string;  // 해당 계층의 summary turn ID
  compression_ratio: number; // 원본 대비 압축률
}
```

`summary_layer=2` 인 turn이 evict되면, 차후 recall 시 `summary_turn_id` 부터 따라가야 원본에 도달한다.

```
원본 turn A → (Map) → summary S1 (compression_ratio=16)
S1 → (Reduce) → summary S2 (compression_ratio=4)
S2 → (통합) → summary S3 (compression_ratio=2)

turn A의 summary_layer=3, summary_turn_id=S3
A를 recall하려면 S3 → S2 → S1 → A 순서로 expand
```

### 3.7 `drift_delta`: 결정 표류 측정

evict 결정 직전의 **decision drift** (LLM 응답의 안정성 저하) 를 측정한다.

```typescript
interface DriftDetector {
  /**
   * 직전 N turn 간의 응답 분포 차이를 측정.
   * 분포 차이가 크면 drift 큼.
   */
  measureDrift(recentTurns: ContextTurn[]): number;
}

class EntropyDriftDetector implements DriftDetector {
  measureDrift(turns: ContextTurn[]): number {
    if (turns.length < 2) return 0;

    // 직전 5개 turn의 응답 토큰 분포 비교
    const recent = turns.slice(-5);
    const distributions = recent.map(t => tokenDistribution(t.content));

    // KL divergence 평균 (자기 자신 제외)
    let totalDrift = 0;
    let pairs = 0;
    for (let i = 0; i < distributions.length; i++) {
      for (let j = i + 1; j < distributions.length; j++) {
        totalDrift += klDivergence(distributions[i], distributions[j]);
        pairs++;
      }
    }

    return pairs > 0 ? totalDrift / pairs : 0;
  }
}
```

`drift_delta` 가 높다는 것은 에이전트가 **불안정** 하다는 신호이며, 이때 evict 된 turn은 **회수 우선순위가 높아야** 한다 (불안정한 turn들이 모여있던 컨텍스트를 잃으면 다음 응답도 더 불안정해질 가능성).

---

## 4. TypeScript 통합 구현: ContextTraceStore

4개 컴포넌트(`ContextTraceStore`, `EvictionReasonClassifier`, `DriftDetector`, `CitationLinker`)를 한 시스템으로 묶는다.

### 4.1 데이터 모델

```typescript
interface ContextTurn {
  id: string;
  session_id: string;
  turn_index: number;           // 세션 내 turn 순서 (0-based)
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  tool_call?: ToolCall;
  tool_call_id?: string;        // tool 결과와 매핑
  delegated_to_subagent?: string;
  compressed_fields?: string[]; // Semantic Compression으로 보존된 필드
  created_at: number;           // epoch ms
}

interface EvictionSignals {
  turn_id: string;
  evicted_at: number;           // epoch ms
  eviction_reason: EvictionReason;
  importance_score: number;     // 0~1
  attention_band: AttentionBand;
  llm_cited: boolean;
  retrieval_hydrated: boolean;
  summary_layer: number;
  drift_delta: number;
  evicted_from_position: number; // 컨텍스트 내 위치
  context_length_at_eviction: number;
}

interface ContextTrace {
  trace_id: string;
  session_id: string;
  span_id: string;              // OpenTelemetry 호환
  parent_span_id?: string;
  operation_name: string;       // "context.compress", "context.window_slide" 등
  started_at: number;
  ended_at: number;
  evicted_turns: EvictionSignals[];
  preserved_turns: string[];     // turn_id 목록 (evict 안 된 것들)
  llm_response_id?: string;     // 이 trace 이후의 LLM 응답
}
```

### 4.2 ContextTraceStore 구현

```typescript
class ContextTraceStore {
  constructor(
    private readonly db: TraceDatabase,
    private readonly driftDetector: DriftDetector,
    private readonly citationLinker: CitationLinker,
    private readonly importanceScorer: ImportanceScorer
  ) {}

  /**
   * evict 이벤트 발생 시 호출.
   * 7대 signal을 계산하여 저장.
   */
  async recordEviction(
    turn: ContextTurn,
    context: ContextTurn[],
    evictionReason: EvictionReason,
    sessionId: string,
    spanId: string
  ): Promise<EvictionSignals> {
    const now = Date.now();

    // (1) importance_score 계산
    const importance = this.importanceScorer.score(turn, context);

    // (2) attention_band 분류
    const position = turn.turn_index;
    const totalLength = context.length;
    const band = classifyAttentionBand(position, totalLength);

    // (3) drift_delta 측정 (직전 5 turn)
    const drift = this.driftDetector.measureDrift(context.slice(-5));

    // (4) llm_cited 판정
    const citedRefs = await this.citationLinker.linkCitations(
      context[context.length - 1]?.content ?? "",
      [turn]
    );
    const llm_cited = citedRefs.length > 0;

    // (5) retrieval_hydrated 결정
    const policy = new DefaultRehydrationPolicy();
    const retrieval_hydrated = policy.shouldHydrate(turn, {
      llm_cited,
      importance_score: importance
    } as EvictionSignals);

    const signals: EvictionSignals = {
      turn_id: turn.id,
      evicted_at: now,
      eviction_reason: evictionReason,
      importance_score: importance,
      attention_band: band,
      llm_cited,
      retrieval_hydrated,
      summary_layer: turn.summary_layer ?? -1,
      drift_delta: drift,
      evicted_from_position: position,
      context_length_at_eviction: totalLength
    };

    // (6) 저장
    await this.db.insertEviction(signals);
    await this.db.linkSpanEviction(spanId, signals.turn_id);

    return signals;
  }

  /**
   * 디버깅용 traceback.
   * 특정 시점 이후 어떤 turn이 evict됐는지 조회.
   */
  async traceback(
    sessionId: string,
    sinceMs: number
  ): Promise<EvictionSignals[]> {
    return this.db.queryEvictions({
      session_id: sessionId,
      evicted_after: sinceMs
    });
  }

  /**
   * 회수 가능성 분석.
   * 주어진 query에 대해 retrieval_hydrated=true 인 evicted turn을 recall.
   */
  async analyzeRehydration(
    sessionId: string,
    queryEmbedding: number[]
  ): Promise<RehydrationCandidate[]> {
    const hydratedTurns = await this.db.queryEvictions({
      session_id: sessionId,
      retrieval_hydrated: true
    });

    const candidates: RehydrationCandidate[] = [];
    for (const ev of hydratedTurns) {
      const turn = await this.db.getTurn(ev.turn_id);
      if (!turn) continue;
      const turnEmbed = await this.embedder.embed(turn.content);
      const sim = cosineSimilarity(queryEmbedding, turnEmbed);
      if (sim > 0.7) {
        candidates.push({
          turn,
          signals: ev,
          rehydration_priority:
            0.5 * ev.importance_score +
            0.3 * sim +
            0.2 * (ev.drift_delta > 0.3 ? 1 : 0)
        });
      }
    }

    return candidates.sort((a, b) =>
      b.rehydration_priority - a.rehydration_priority
    );
  }
}

interface RehydrationCandidate {
  turn: ContextTurn;
  signals: EvictionSignals;
  rehydration_priority: number;
}
```

### 4.3 CitationLinker 통합

```typescript
class ContextManagerWithProvenance {
  constructor(
    private readonly baseContextManager: ContextManager,  // #055의 5대 전략
    private readonly traceStore: ContextTraceStore
  ) {}

  async compressAndTrace(
    sessionId: string,
    context: ContextTurn[],
    strategy: CompressionStrategy
  ): Promise<{ context: ContextTurn[]; trace: ContextTrace }> {
    const spanId = generateSpanId();
    const startedAt = Date.now();

    // (1) 압축 수행 (#055의 5대 전략)
    const beforeIds = new Set(context.map(t => t.id));
    const compressed = await this.baseContextManager.compress(
      context,
      strategy
    );
    const afterIds = new Set(compressed.map(t => t.id));

    // (2) evict된 turn 식별
    const evictedTurns = context.filter(t => !afterIds.has(t.id));

    // (3) 각 evict에 대해 7대 signal 기록
    const signals: EvictionSignals[] = [];
    for (const turn of evictedTurns) {
      const sig = await this.traceStore.recordEviction(
        turn,
        context,
        strategy.evictionReason,
        sessionId,
        spanId
      );
      signals.push(sig);
    }

    // (4) trace 종료
    const trace: ContextTrace = {
      trace_id: generateTraceId(),
      session_id: sessionId,
      span_id: spanId,
      operation_name: `context.${strategy.name}`,
      started_at: startedAt,
      ended_at: Date.now(),
      evicted_turns: signals,
      preserved_turns: Array.from(afterIds),
      llm_response_id: undefined  // 다음 LLM 응답 시 채워짐
    };

    await this.traceStore.db.insertTrace(trace);

    return { context: compressed, trace };
  }

  /**
   * LLM 응답 시점에 citation을 자동 연결.
   * 응답 후 이 메서드를 호출하면 evicted turn과의 link가 기록됨.
   */
  async linkResponseCitations(
    sessionId: string,
    spanId: string,
    response: string,
    activeContext: ContextTurn[]
  ): Promise<CitedTurnRef[]> {
    const refs = await this.traceStore.citationLinker.linkCitations(
      response,
      activeContext
    );

    for (const ref of refs) {
      await this.traceStore.db.insertCitation({
        response_span_id: spanId,
        cited_turn_id: ref.turn_id,
        cited_at_offset: ref.cited_at_response_offset,
        similarity: ref.similarity_score,
        quote: ref.cited_quote
      });
    }

    return refs;
  }
}
```

### 4.4 자기검증 hook

```typescript
/**
 * 4가지 self-check 패턴.
 * 운영 환경에서 주기적으로 실행.
 */
async selfCheck(sessionId: string): Promise<SelfCheckReport> {
  const evictions = await this.traceStore.traceback(sessionId, Date.now() - 3600_000);

  // (1) Lost-in-the-Middle 가설 검증
  const middleCited = evictions.filter(
    e => e.attention_band === "middle" && e.llm_cited
  ).length;
  const headCited = evictions.filter(
    e => e.attention_band === "head" && e.llm_cited
  ).length;
  const tailCited = evictions.filter(
    e => e.attention_band === "tail" && e.llm_cited
  ).length;

  // (2) 압축 비율 sanity check
  const avgImportance = evictions.reduce(
    (sum, e) => sum + e.importance_score, 0
  ) / Math.max(evictions.length, 1);

  // (3) drift 추세
  const avgDrift = evictions.reduce((sum, e) => sum + e.drift_delta, 0)
    / Math.max(evictions.length, 1);

  // (4) retrieval coverage
  const hydratedRate = evictions.filter(e => e.retrieval_hydrated).length
    / Math.max(evictions.length, 1);

  return {
    session_id: sessionId,
    middle_citation_ratio: middleCited / Math.max(evictions.filter(e => e.attention_band === "middle").length, 1),
    head_citation_ratio: headCited / Math.max(evictions.filter(e => e.attention_band === "head").length, 1),
    tail_citation_ratio: tailCited / Math.max(evictions.filter(e => e.attention_band === "tail").length, 1),
    avg_importance: avgImportance,
    avg_drift: avgDrift,
    hydration_rate: hydratedRate,
    timestamp: Date.now()
  };
}

interface SelfCheckReport {
  session_id: string;
  middle_citation_ratio: number;
  head_citation_ratio: number;
  tail_citation_ratio: number;
  avg_importance: number;
  avg_drift: number;
  hydration_rate: number;
  timestamp: number;
}
```

---

## 5. RAG Grounding & Citations 패턴의 역수입

### 5.1 오늘의 AI Knowledge Pill: Grounding & Citations

2026-07-07 오늘의 AI Knowledge 주제는 **"Grounding & Citations"** 이다. LLM 응답에 "이 정보는 어디서 왔는가" 를 붙이는 패턴이다. RAG에서는 표준이 되었지만, **컨텍스트 관리**에는 아직 적용되지 않았다.

본 글은 이 패턴을 컨텍스트 evict 으로 역수입한다. 핵심은 세 가지다.

#### 5.1.1 Quoted Span

RAG에서는 LLM 응답의 각 문장이 어떤 chunk에서 왔는지 `[doc_3, para_2]` 형태로 표시한다. 본 글의 ContextManager는 **evict된 turn을 인용할 때** `[evicted:turn_a1b2, layer=2]` 형태로 표시한다.

```typescript
class GroundedResponseFormatter {
  format(response: string, citedRefs: CitedTurnRef[]): string {
    let formatted = response;
    // 응답 내 인용 위치를 찾아 footnote 추가
    for (const ref of citedRefs) {
      const footnote = ` [evicted:${ref.turn_id}]`;
      formatted = formatted.replace(
        ref.cited_quote,
        `${ref.cited_quote}${footnote}`
      );
    }
    return formatted;
  }
}
```

#### 5.1.2 Citation Footnote

evict된 turn이 **나중에 다시 회수될 때**, 그 turn의 Provenance 전체가 footnote로 따라온다.

```
응답: "이번 분기 매출은 1,350억원입니다. [evicted:turn_q2_xyz]

(footnote: evicted at 15:25:33, reason=window_overflow,
importance=0.82, llm_cited=true, summary_layer=1)"
```

이 footnote는 사용자가 모델의 답변을 검증할 때 직접 사용된다.

#### 5.1.3 Verification Pass

LLM이 응답을 생성한 직후, **두 번째 LLM call** 이 grounding 을 검증한다.

```typescript
class GroundingVerifier {
  async verify(
    response: string,
    citations: CitedTurnRef[]
  ): Promise<VerificationResult> {
    const prompt = `
You are a grounding verifier. Check if the following response is fully supported by the cited context turns.

Response:
${response}

Cited turns:
${citations.map(c => `[${c.turn_id}] ${c.cited_quote}`).join("\n")}

For each claim in the response, mark whether it is:
- SUPPORTED: directly stated in cited turns
- INFERRED: logically derived but not directly stated
- HALLUCINATED: not supported by any cited turn

Output as JSON: { "claims": [...], "unsupported_count": N }
`;

    const result = await this.llm.generate(prompt, { json: true });
    return JSON.parse(result);
  }
}
```

이 verification pass 의 결과는 **다음 evict 결정** 에 반영된다. `unsupported_count` 가 높다면, 그 직전 turn은 evict 대상에서 우선 제외된다.

### 5.2 Grounding 점수의 evict 결정 반영

```typescript
class GroundingAwareContextManager {
  /**
   * grounding 점수가 낮은 turn은 evict 우선순위 낮춤.
   * 즉, 검증되지 않은 정보가 있는 turn은 더 오래 보존.
   */
  computeEvictionPriority(turn: ContextTurn, signal: EvictionSignals): number {
    let priority = 0;

    // 기본 우선순위 (낮을수록 빨리 evict)
    priority += signal.importance_score * 0.3;
    priority += (signal.llm_cited ? 1 : 0) * 0.3;
    priority += (signal.drift_delta > 0.3 ? 1 : 0) * 0.2;

    // grounding 점수가 낮으면 보존 우선순위 ↑
    const groundingScore = this.getGroundingScore(turn.id);
    priority += groundingScore * 0.2;

    // retrieval_hydrated 가능하면 evict해도 안전 → 우선순위 ↓
    priority -= (signal.retrieval_hydrated ? 0.5 : 0);

    return priority;
  }

  private getGroundingScore(turnId: string): number {
    // turn이 인용된 응답들의 grounding verification 결과 평균
    return this.db.queryGroundingScores(turnId);
  }
}
```

이렇게 함으로써, **hallucination 으로부터 가장 취약한 turn들** 이 가장 오래 보존된다.

---

## 6. OpenTelemetry GenAI Semantic Conventions 통합

### 6.1 표준 span attribute

2026년 4월, OpenTelemetry 는 GenAI 워킹그룹을 통해 `gen_ai.*` semantic conventions 을 발표했다. 본 글의 ContextTraceStore 는 이 표준과 호환된다.

```typescript
class OTelCompatibleSpanExporter {
  toOTelAttributes(trace: ContextTrace): Record<string, string | number> {
    return {
      // 표준 OTel GenAI 속성
      "gen_ai.system": "context_manager_v2",
      "gen_ai.operation.name": trace.operation_name,

      // 본 글의 확장 속성
      "gen_ai.agent.context.original_turns": trace.preserved_turns.length +
        trace.evicted_turns.length,
      "gen_ai.agent.context.evicted_turns": trace.evicted_turns.length,
      "gen_ai.agent.context.evicted_window_overflow":
        trace.evicted_turns.filter(e => e.eviction_reason === "window_overflow").length,
      "gen_ai.agent.context.evicted_compression":
        trace.evicted_turns.filter(e => e.eviction_reason === "compression").length,
      "gen_ai.agent.context.evicted_summary_absorbed":
        trace.evicted_turns.filter(e => e.eviction_reason === "summary_absorbed").length,
      "gen_ai.agent.context.evicted_delegated":
        trace.evicted_turns.filter(e => e.eviction_reason === "delegated").length,

      "gen_ai.agent.context.avg_importance": avg(trace.evicted_turns.map(e => e.importance_score)),
      "gen_ai.agent.context.avg_drift": avg(trace.evicted_turns.map(e => e.drift_delta)),
      "gen_ai.agent.context.hydration_rate":
        trace.evicted_turns.filter(e => e.retrieval_hydrated).length /
        Math.max(trace.evicted_turns.length, 1),
      "gen_ai.agent.context.cited_eviction_rate":
        trace.evicted_turns.filter(e => e.llm_cited).length /
        Math.max(trace.evicted_turns.length, 1)
    };
  }
}
```

### 6.2 Trace 시각화

이 trace 들을 Jaeger / Tempo / SigNoz 같은 OTel-compatible 백엔드에 보내면, 다음과 같은 waterfall view 가 생성된다.

```
[15:23:45] user_query            [───────────────────────] 2.1s
  [15:23:47] agent_plan           [────────] 0.4s
    [15:23:47] tool:get_revenue_Q1 [───] 0.3s  → 12 turns preserved
  [15:24:12] agent_act            [───] 0.2s
  [15:25:30] context.compress     [────] 0.5s  → 3 turns evicted (window_overflow, avg_imp=0.71)
  [15:25:31] tool:get_revenue_Q2  [───] 0.3s
  ... (중략)
  [15:42:08] llm_response         [────────] 0.9s  → 2 citations linked
```

이 view에서 "왜 30 step 후 답이 이상해졌지?" 라는 질문에 즉시 답할 수 있다. **evict된 turn들의 평균 importance** 가 너무 낮았다면 정책 실패, **drift_delta** 가 누적되고 있었다면 그 이전에 멈춰야 했다.

### 6.3 Prometheus / OpenMetrics 메트릭

```typescript
class ContextObservabilityMetrics {
  // 카운터: evict 사유별 횟수
  evictionReasonCount = new Counter({
    name: "context_eviction_total",
    labelNames: ["reason", "session_type"],
    help: "Total number of context evictions by reason"
  });

  // 히스토그램: importance_score 분포
  importanceScoreHistogram = new Histogram({
    name: "context_eviction_importance_score",
    buckets: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
    help: "Distribution of importance scores of evicted turns"
  });

  // 게이지: 현재 활성 컨텍스트의 middle band 비율
  middleBandRatio = new Gauge({
    name: "context_middle_band_ratio",
    help: "Ratio of turns currently in middle attention band"
  });

  // 카운터: 인용된 turn의 evict 횟수 (이게 늘면 안 됨)
  citedEvictionCount = new Counter({
    name: "context_cited_eviction_total",
    labelNames: ["attention_band"],
    help: "Total number of evicted turns that were cited by LLM (should be near 0)"
  });
}
```

`context_cited_eviction_total` 메트릭이 0 이 아닌 값을 보이면 **즉시 알람** 이 발생해야 한다. LLM이 인용한 turn을 evict했다는 것은 명백한 정책 위반이다.

---

## 7. 한국 시장 적용: 토종 모델의 Provenance 지원

### 7.1 HyperCLOVA X 200K

NAVER Cloud 의 HyperCLOVA X 200K 는 2026년 6월부터 **per-token trace 옵션** 을 제공하기 시작했다. 본 글의 ContextTraceStore 와 호환된다.

```typescript
interface HyperClovaXTraceConfig {
  enabled: boolean;
  trace_level: "summary" | "detailed" | "full";
  store_target: "naver_cloud_object_storage" | "self_hosted";
  retention_days: number;
}

const hyperclovaxConfig: HyperClovaXTraceConfig = {
  enabled: true,
  trace_level: "detailed",  // token-level 메타데이터 포함
  store_target: "naver_cloud_object_storage",
  retention_days: 30
};

// HyperCLOVA X 호출 시 헤더로 trace 활성화
const response = await hyperclovax.invoke({
  prompt: context,
  model: "HCX-200K",
  options: {
    max_tokens: 2048,
    temperature: 0.7,
    headers: {
      "X-NCP-CLOVA-Training-Dataset-Use": "false",
      "X-NCP-CLOVA-Trace": JSON.stringify(hyperclovaxConfig)
    }
  }
});
```

HyperCLOVA X 의 `X-NCP-CLOVA-Trace` 옵션은 **per-turn attention weight** 와 **per-token entropy** 를 반환한다. 본 글의 `attention_band` 와 `drift_delta` 계산에 직접 활용할 수 있다.

### 7.2 LG Exaone 200K

LG AI Research 의 Exaone 200K 는 자체 observability API 를 제공한다.

```typescript
interface ExaoneTraceResponse {
  turn_id: string;
  attention_weights: number[];     // 토큰별 attention 가중치
  entropy_per_token: number[];
  semantic_embedding: number[];    // 1024-dim
  korean_tokenization: TokenInfo[];
}

const exaoneTrace = await exaone.invokeWithTrace({
  prompt: context,
  options: { trace: true }
});

// Exaone의 attention weight로 attention_band 정밀 계산
const attentionBand = classifyAttentionBandFromWeights(
  exaoneTrace.attention_weights
);
```

Exaone 의 강점은 **한국어 토큰화 정보** 가 함께 제공된다는 점이다. 직전 글(#055) 의 한국어 2-3배 토큰 소비 문제와 결합하면, 한국어 turn 의 `importance_score` 를 더 정확히 계산할 수 있다.

### 7.3 SKT A.X 4

SKT 의 A.X 4 는 멀티모달 컨텍스트(텍스트+이미지+오디오)를 지원하며, 자체 dashboard 를 통해 evict 이벤트를 시각화한다.

```typescript
interface AX4MultimodalContextTurn {
  id: string;
  modality: "text" | "image" | "audio" | "video";
  modality_specific_metadata: {
    image?: { width: number; height: number; dominant_colors: string[] };
    audio?: { duration_ms: number; language: string };
  };
  standard_metadata: ContextTurn;
}

const ax4Trace = await ax4.invoke({
  context: multimodalContext,
  options: {
    observability: {
      dashboard_url: "https://observability.a-x.skt.ai/sessions/...",
      evict_webhook: "https://my-service.com/ax4/evict"
    }
  }
});
```

A.X 4 의 dashboard 는 한국어 UI 를 기본 제공하여, 국내 운영팀이 **코드를 작성하지 않고도** evict 패턴을 분석할 수 있다.

### 7.4 비용 트레이드오프

| 항목 | HyperCLOVA X | Exaone 200K | A.X 4 |
|---|---|---|---|
| Trace 비용 (per 1K tokens) | +₩12 | +₩8 | +₩15 |
| Storage 비용 (per GB/month) | ₩250 | ₩180 | ₩320 |
| Dashboard | 기본 제공 | CLI/API only | 표준 제공 |
| 한국어 최적화 | 토큰 메타 포함 | 토큰 메타 포함 | 모달리티 메타 |

**권장**: 예산이 충분하면 **HyperCLOVA X detailed trace + self-hosted storage** 조합. 예산이 제한적이면 **Exaone 200K summary level** + 외부 Vector DB.

---

## 8. 도전 과제와 자기비판

본 섹션은 본 글의 한계를 정직하게 다룬다.

### 8.1 7개 signal의 적정성 검증 부족

본 글에서 7개 signal을 제안했지만, 이는 **합리적 추정** 일 뿐 실제 production A/B 테스트로 검증되지 않았다. 신호 수를 5개로 줄이면 storage 비용 28% 절감, 10개로 늘리면 디버깅 coverage 15% 향상 같은 트레이드오프가 있을 수 있다.

**개선 아이디어**: 실 production 환경에서 7개 vs 12개 vs 5개 의 signal set 을 비교하는 A/B 테스트 설계.

### 8.2 Embedding 기반 Citation Detection의 한계

본 글의 `CitationLinker` 는 cosine similarity 0.82 임계값으로 citation 을 판별한다. 그러나 이 값은 **모델과 도메인에 따라** 달라져야 한다.

- 한국어 도메인: 임계값을 0.78 정도로 낮춰야 recall 향상
- 코드 생성 도메인: 임계값을 0.85 이상으로 올려 false positive 방지
- 다국어 도메인: 다국어 임베딩 모델 사용 시 임계값 보정 필요

**자기비판**: 본 글의 0.82 는 어디까지나 합리적 기본값일 뿐, **production calibration 없이는 그대로 사용하면 안 된다**.

### 8.3 DriftDetector의 가정

본 글의 `DriftDetector` 는 **KL divergence** 로 drift 를 측정한다. 이는 다음 가정을 둔다.

1. LLM 응답의 토큰 분포가 gaussian 에 가깝다 (실제로는 아님)
2. drift 가 단조 증가한다 (실제로는 진동할 수 있음)
3. drift 가 클수록 나쁘다 (가끔 drift 는 창의성의 신호일 수도 있음)

특히 (3)번 가정은 위험하다. **drift 가 큰 turn이 항상 evict 대상에서 제외되어야 하는가?** 는 열린 질문이다. 창의를 요구하는 task (예: brainstorming) 에서는 drift 가 오히려 긍정적 신호일 수 있다.

### 8.4 Storage 비용의 숨은 폭탄

7개 signal × 200 bytes × 10만 turn/day = 140MB/day. 1년이면 51GB. 10년이면 510GB. 검색 인덱스까지 고려하면 **수 TB**.

**개선 아이디어**: 
- cold storage (S3 Glacier) 로 evict 후 30일 지난 trace 이동
- 중요도 점수가 낮은 evict trace는 aggregation 후 삭제
- 일별 batch ETL로 핵심 메트릭만 보존

본 글은 이 비용 최적화를 다루지 않았다. **운영팀이 자체적으로 설계해야 할 영역** 이다.

### 8.5 자기참조 함정

본 글의 ContextManagerWithProvenance 는 **자기 자신의 동작도 trace 한다**. 즉, evict 결정을 trace 하고, 그 trace 결정도 다시 trace 된다. 무한 재귀는 아니지만 (depth 1), **"이 trace 가 왜 기록되었는가"** 라는 질문은 답할 수 없다.

직전 글(#055) 의 8.5절과 같은 자기참조 함정이다. 본 시스템은 **운영자의 외부 검증** 으로만 보정 가능하다.

### 8.6 한국어 토큰화의 추가 비용

한국어 turn 은 영어 대비 2-3배 토큰을 소비한다 (직전 글 #055 의 한국어 임베딩 참고). 7개 signal 이 한국어 메타데이터(예: 형태소 분석 결과)를 포함한다면, signal storage 비용도 2-3배가 된다.

**개선 아이디어**: 한국어 메타데이터는 optional signal 로 분리, 기본 trace 에서는 제외, 필요 시 별도 저장.

---

## 9. 다음 글 예고 (#057)

본 글은 #055 의 ContextManager 가 **"왜 evict 했는가"** 에 답하게 만들었다. 다음 단계는 **"이 evict 정책이 최적이었는가"** 에 답하는 것이다.

**#057: Context Policy Optimization — Eviction Policy 의 A/B 테스트와 자동 튜닝**

예정 내용:
- eviction policy 의 효과를 정량적으로 측정하는 방법
- bandit algorithm (UCB, Thompson Sampling) 기반의 online policy tuning
- 카나리 배포와 같은 점진적 rollout 전략
- 한국 모델 환경 (HyperCLOVA X / Exaone) 에서의 정책 비교

---

## 10. 마무리

본 글은 AI 에이전트 컨텍스트 관리에 **observability** 를 도입하는 첫 시도였다.

핵심 메시지는 단 하나다.

> **Eviction 은 손실이 아니다. 기록 없는 압축이 손실이다.**

Evicted-Turn Provenance 라는 새로운 primitive 를 통해, 우리는 evict 의 7가지 측면을 모두 추적할 수 있게 되었다. 그리고 RAG 의 Grounding & Citations 패턴을 역수입하여, **evict 결정 자체가 grounding verification 의 대상** 이 되도록 만들었다.

이는 단순한 로깅이 아니라, **AI 에이전트의 자기 인식(self-awareness)** 을 높이는 첫 단계다. 다음 글에서는 그 자기 인식을 **자동 정책 개선** 으로 확장한다.

---

## 참고 자료

1. OpenTelemetry. (2026-04). **"GenAI Semantic Conventions — Span Attributes for LLM Applications"**. CNCF OpenTelemetry.
2. Anthropic. (2026-05). **"Effective Context Engineering for AI Agents — Production Case Studies"**. Anthropic DevDay 2026.
3. Anthropic. (2026-04). **"Grounding & Citations: Reducing Hallucination in RAG"**. Anthropic Engineering Blog.
4. Stanford NLP. (2023). **"Lost in the Middle: How Language Models Use Long Contexts"**. arXiv:2307.03172.
5. Anthropic. (2025). **"Long Context Retrieval Evaluation Follow-up"**. Anthropic Research.
6. NAVER Cloud. (2026-06). **"HyperCLOVA X 200K Per-Token Trace 옵션 출시"**. NAVER Cloud 공지.
7. LG AI Research. (2026-Q2). **"Exaone 200K Observability API 명세"**. LG AI Research Technical Report.
8. SKT. (2026-Q2). **"A.X 4 Multimodal Observability Dashboard Guide"**. SKT AI Tech Report.
9. Langfuse. (2026-05). **"OpenLLMetry — OpenTelemetry for LLM"**. Langfuse Documentation.
10. Arize AI. (2026-Q1). **"LLM Evals and Tracing in Production"**. Arize Phoenix Documentation.

---

## 부록: 시리즈 글 백링크

본 시리즈는 2026년 6월부터 매주 한 편씩 AI 에이전트 인프라를 깊이 있게 다루고 있다.

- **#050 (2026-06-25)**: GraphRAG and Knowledge Graph-Augmented Generation Architecture
- **#051 (2026-06-27)**: AI Agent 2-Layer Memory Architecture
- **#052 (2026-06-28)**: Speculative Decoding & Continuous Batching
- **#053 (2026-07-04)**: Agentic Commerce (x402, ACP)
- **#054 (2026-07-05)**: AI Agent Credit Scoring
- **#055 (2026-07-06)**: AI Agent Context Engineering
- **#056 (본 글, 2026-07-07)**: ContextManager Observability

다음 글(#057) 에서는 Context Policy Optimization 을 다룬다.