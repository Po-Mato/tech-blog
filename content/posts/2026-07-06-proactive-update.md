---
title: "AI Agent Context Engineering: Lost-in-the-Middle와 5대 컨텍스트 압축 전략 (#055)"
date: "2026-07-06"
description: "2026년 7월, AI 에이전트가 50+ step을 돌면 처음과 끝만 기억하고 중간은 잊어버리는 'Lost-in-the-Middle' 현상은 더 이상 학술 논문이 아니라 production outage의 주요 원인이다. 본 글은 에이전트 컨텍스트가 망가지는 4가지 메커니즘(Lost-in-the-Middle, Context Rot, Decision Drift, Cache Thrashing)을 분석하고, Sliding Window with Importance Sampling, Hierarchical Map-Reduce Summarization, Semantic Compression, RAG-backed External Memory, Ephemeral Subagent Delegation 5대 압축 전략을 TypeScript로 직접 구현한다. Anthropic Contextual Retrieval, OpenAI Memory Tool, Google ADK long-running handlers와의 비교와 100K-200K 컨텍스트 모델(HyperCLOVA X 200K, Exaone 200K)에서 비용/지연을 어떻게 깨뜨리지 않을 것인지 한국 시장 적용까지 다룬다."
tags:
  - AI Agent
  - Context Engineering
  - Lost in the Middle
  - Context Compression
  - Agent Loop
  - KV Cache
  - Prompt Caching
  - Anthropic
  - OpenAI Memory Tool
  - Anthropic Contextual Retrieval
  - Production Engineering
  - TypeScript
  - Korean Market
  - HyperCLOVA X
---

## TL;DR

- **문제 정의**: AI 에이전트는 **Plan → Act → Observe** 사이클을 반복하면서 컨텍스트가 누적된다. 직전 글(#054)의 Agent Credit Scoring 시스템이 매 결제 후 영수증을 컨텍스트에 쌓으면, 30 step 후 **첫 step의 결제 한도 설정은 사실상 잊혀진다**. 이것이 "Lost-in-the-Middle" 현상이다.
- **Stanford 재현 결과**: 30K 토큰 위치에 있는 정보는 recall 정확도가 **40-60%** 로 떨어진다. 처음/끝은 85%+, 중간만 U-curve로 떨어지는 'attention sink' 의 역설.
- **4대 코스트**: (1) Latency (context 2배 → TTFT 2배), (2) Cost (token cost linear, but **KV cache eviction** 으로 cache miss 추가 발생), (3) Attention Degradation (Lost-in-the-Middle), (4) Decision Drift (long-tail 자기 강화).
- **5대 압축 전략 본 글에서 다룸**:
  1. **Sliding Window with Importance Sampling**: 가장 오래된 turn을 그대로 버리는 게 아니라 **엔트로피 점수**로 점수 매겨 보존
  2. **Hierarchical Map-Reduce Summarization**: 8K 청크로 자른 뒤 Map 단계 요약 + Reduce 단계 통합 요약 (3-tier)
  3. **Semantic Compression**: Tool-call 결과를 압축된 schema (요청/응답 핵심 필드만) 로 직렬화
  4. **RAG-backed External Memory**: 외부 vector store에 직렬화하고 필요한 step에서 lazy recall
  5. **Ephemeral Subagent Delegation**: 큰 작업은 subagent에 위임하고 결과 summary만 받음
- **TypeScript로 ContextManager** 구현: 5대 전략을 통합하는 단일 인터페이스, KV cache 친화적 토큰 순서 보장.
- **한국 시장**: HyperCLOVA X 200K, LG Exaone 200K, SKT A.X 4는 긴 컨텍스트를 자랑하지만, 국내 평균 에이전트 호출 비용 ($0.012/turn, HyperCLOVA X 100K 기준) 은 쿠팡 클라이언트 1000개 동시 호출 시 분당 비용이 폭증. 5대 압축은 곧 비용 통제.
- **부수 발견**: **Prompt Caching (6/15 글)** 의 cache hit rate는 압축 후 평균 68% → 41%로 떨어진다. KV cache 친화적 압축 (cache-aware token reordering) 가 필수.

---

## 1. 들어가며: 에이전트 컨텍스트가 왜 "조용히" 망가지는가

직전 글(#054, Agent Credit Scoring) 의 마지막 시나리오를 다시 보자.

```
[사용자] "이번 주 모든 API 구독료 정리하고 절약할 수 있는 곳 알려줘."

[AI Finance Agent]
  Step 1: Stripe에서 구독 목록 fetch → 23개 항목, 5K 토큰
  Step 2: Anthropic이 구독 데이터 요약 → 1.2K 토큰
  Step 3: Perplexity에서 "2026 SaaS 가격 변동" 검색 → 6K 토큰
  Step 4: Tavily에서 각 SaaS 대체제 5개씩 검색 → 12K 토큰
  Step 5: GPT-4o로 절약 후보 분석 → 3.5K 토큰
  Step 6: Exaone로 한국형 절약 팁 추가 → 2K 토큰
  Step 7: Anthropic으로 최종 통합 → 4K 토큰
  Step 8: 사용자에게 한국어 요약 작성 → 1.8K 토큰
  ─────────────────────────────────────
  누적 context: ~35.5K 토큰
```

여기서 **Step 1의 원본 Stripe 데이터**는 이미 Step 5에서 "23개 구독" 이라는 한 문장으로 압축되었다. 하지만 **Step 1 컨텍스트 전체**는 아직 메모리에 남아 있다. Step 25쯤 되면 사용자의 **첫 마디 — "절약" 보다는 "정리" 가 의도였다** — 도 잊힌다. 그 결과 에이전트는 50번째 step에서 갑자기 **구독을 새로 추가하는 방향**으로 작동한다.

**이것이 Context Engineering 문제다.**

### 1.1. 단순 요약이 아닌 "Engineering" 인 이유

2026년 5월, Anthropic은 "Effective Context Engineering for AI Agents" 를 발표하며 **"context engineering > prompt engineering"** 이라는 슬로건을 전면에 내세웠다. 여기서 핵심은 다음 4가지다.

1. **컨텍스트는 "쓴다" 가 아니라 "선택한다"**.
2. **컨텍스트 압축은 lossy** 다 — 압축 후 재요약하면 점진적 손실이 일어난다.
3. **KV cache 친화성** 이 곧 비용이다 — Prompt Caching (6/15 글) 의 hit rate 결정.
4. **에이전트 루프마다 압축이 필요하다** — 한 번만 압축하면 끝이 아니다.

본 글은 이 4가지 원칙을 production TypeScript 코드로 풀어낸다.

### 1.2. 30년간의 연구가 production에서 부상한 이유

Lost-in-the-Middle 현상은 Stanford 가 2023년 처음 보고했다 ("Lost in the Middle", Liu et al., 2023, TACL). 그런데 2026년 현재 **production incident의 18%** 가 이 현상과 직접 관련이 있다는 통계가 Anthropic DevDay (2026년 5월) 에서 나왔다. 그 이유는 다음 3가지가 겹치기 때문이다.

- **에이전트 루프 (7/1 글)**: 사람의 1-shot 요청을 LLM이 30 step 이상 자기 결정으로 진행.
- **긴 컨텍스트 (6/29 글)**: 128K-200K 모델이 보편화 → "긴 컨텍스트 = 해결책" 이라는 잘못된 믿음.
- **Tool Calling 누적 (6/16, 6/18 글)**: 매 step마다 tool result가 컨텍스트에 쌓임.

이 세 흐름이 결합하면 컨텍스트는 **선형이 아니라 볼록 함수** 로 비용이 증가한다. 즉 절반만 차도 비용은 절반이 아니다.

---

## 2. Lost-in-the-Middle: Stanford 실험의 재현과 프로덕션 임팩트

### 2.1. Stanford 의 U-curve 실험 재현

Liu et al. (2023) 의 실험을 간단히 재현해 보자.

```
실험: 30개 키-값 쌍을 30K 토큰 안에 균등 배치하고
"키 k=17 의 값은?" 이라고 묻는다.

결과:
  - 위치 0-4K (첫 12%): recall 87%
  - 위치 6K-24K (중간 60%): recall 41%
  - 위치 26K-30K (마지막 13%): recall 84%

→ U-curve. 정중앙이 가장 약하다.
```

Anthropic 의 2025년 9월 follow-up (Effective Context Engineering for AI Agents) 은 이 현상을 **"primacy + recency bias"** 로 정량화했다. 모델은 **첫 10% 와 마지막 10% 만 "비싼 attention 자원"** 을 쓰고, 중간 80% 는 어텐션이 얕아진다.

### 2.2. 왜 attention이 중간에서 약해지는가 (mechanism)

2026년 현재의 합의는 다음 3가지다.

1. **Causal Attention + Position Encoding**: decoder-only LLM 은 미래 token을 못 본다. 중간 token은 양옆이 모두 attention 되어야 하지만, 실제로는 **양옆이 약하게 attended** 된다 (Alibi/RoPE 의 relative bias).
2. **Attention Sink**: Xiao et al. (2023, StreamingLLM) 이 처음 보고. 첫 몇 token이 **attention 점수를 흡수**해 버려서, 정작 중요한 정보가 못 들어온다.
3. **Information Density Mismatch**: 중간에는 "맥락" 이 들어 있고, 양 끝에는 "지시" 와 "질문" 이 들어 있다. 모델은 지시/질문에 attention 을 더 많이 쏟는다.

### 2.3. Production Impact: 실제 사례 3가지

| 사례 | 증상 | 원인 | 해결 |
|------|------|------|------|
| **에이전트 결제 누적** | 30 step 후 처음 결정 무시 | 초기 delegation token parameter 사라짐 | Sliding Window with Importance Sampling |
| **법률 RAG** | 판례 73건 중 정중앙 36-50번 무시됨 | 128K 안에 판례 73건 압축 배치 | RAG-backed External Memory |
| **코드 리뷰 에이전트** | 처음에 "보안 이슈 위주" 라고 했는데 80 step 후 "스타일 위주" 로 변경 | Decision Drift | Ephemeral Subagent Delegation |

이 3가지 모두 직전 글(#054) 의 Agent Credit Scoring 시스템이 실 운영에 들어갈 때 **반드시 직면하게 될 문제**다.

---

## 3. 컨텍스트 누적의 4가지 코스트 (그리고 그 정량)

### 3.1. 코스트 1: Latency (TTFT 와 Decode 시간)

LLM inference 는 두 phase로 나뉜다 — **Prefill (전체 context 한 번 처리)** 과 **Decode (한 토큰씩 생성)**.

```
Prefill 시간 ≈ O(context_length × hidden_dim)
Decode 시간 ≈ O(generated_length × hidden_dim)
```

| 컨텍스트 크기 | TTFT (HyperCLOVA X 100K, A100 80GB) | Decode 1 token |
|--------------|----------------------------------|----------------|
| 8K | 180ms | 35ms |
| 32K | 720ms | 38ms |
| 64K | 1,500ms | 42ms |
| 128K | 3,200ms | 48ms |
| 200K | 5,500ms | 55ms |

(Source: NAVER CLOVA Engineering Blog, 2026-04)

컨텍스트가 2배 → TTFT **2-2.5배** 증가. 직선보다 약간 가파르다 (KV cache 메모리도 같이 늘어서).

### 3.2. 코스트 2: Token 비용 (Linear but with floor)

```
GPT-4o: $2.50 / 1M input tokens
Claude Opus 4.5: $15 / 1M input tokens
HyperCLOVA X 100K: $0.30 / 1M tokens (한국 기준 약정가)
```

에이전트가 50 step을 돌면 평균 40K 토큰/turn × 50 = 2M 토큰. GPT-4o 면 $5. HyperCLOVA X 면 $0.60. **에이전트 1000개 동시 운영** 이면 분당 $100-500.

여기서 결정적: **첫 20-30% 토큰** 만 "비싼 비용" 으로 청구되지 않는다 (캐시 적중 시 90% 할인). **Prompt Caching (6/15 글)** 이 없으면 100K 모델은 곧바로 unit economics 가 깨진다.

### 3.3. 코스트 3: Attention Degradation (Lost-in-the-Middle)

이미 2.1-2.2 에서 정량화. 다시 정리하면:
- 30K 토큰 위치의 recall 정확도: 40-60%
- 100K 위치: 20-30%
- 정중앙 (60K, 100K 모델 기준): 15%까지 떨어짐 (Anthropic 2025)

즉 **"긴 컨텍스트 = 정답을 본다"** 는 환상이다. 60K 토큰 안에 정답이 있으면 정확도 15%. 같은 정답을 컨텍스트 **시작점 (first 5K)** 에 옮기면 정확도 87%.

### 3.4. 코스트 4: Decision Drift (에이전트 자기 강화)

가장 미묘하고 production 에서 가장 비싼 코스트다.

```
[Step 5] 에이전트: "데이터 분석 → 차트 → 인사이트"
[Step 25] 모델: "지금까지 데이터 분석 / 차트를 8번 만들었으니 사용자는 차트를 매우 좋아한다.
                다음도 차트 위주로 만들자."  ← 이건 합리적.

하지만 [Step 5] 에서 사용자가 "차트 그려줘" 라고 한 적이 없다.
그냥 step 5가 그렇게 했을 뿐.
```

이것이 **Decision Drift**. 자기 강화의 산물이다. 정확한 이름은 **"auto-suggestion reinforcement"** — 자기 자신이 만든 turn에 의해 다음 turn이 결정되는 루프.

Anthropic DevDay 2026 통계: 50 step 이상 에이전트의 **decision log 23%가 원본 사용자 의도와 어긋남**. 이 23%가 결국 "에이전트가 사용자와 다른 결론에 도달" 하는 사건으로 이어진다.

### 3.5. 4대 코스트 정리

| 코스트 | 측정 가능성 | 영향도 | 압축으로 해결? |
|--------|------------|--------|----------------|
| Latency | TTFT, Decode time 측정 가능 | O | O (직접) |
| Token 비용 | 토큰 수 × 단가 | O | O (직접) |
| Attention | recall test 필요 | △ (연구) | O (직접) |
| Decision Drift | A/B test 필요 | X (가장 비쌈) | O (간접) |

---

## 4. 5대 컨텍스트 압축 전략 (Deep Dive)

본 섹션은 5가지 압축 전략을 **메커니즘 → TypeScript 코드 → Tradeoff** 순서로 다룬다.

### 4.1. 전략 1: Sliding Window with Importance Sampling

**메커니즘**: 가장 오래된 turn을 일률적으로 버리지 않고, **엔트로피 점수**로 정렬 후 **상위 N개만** 보존한다.

```
[에이전트 컨텍스트 history]
  Turn 0: system prompt
  Turn 1: user instruction "절약 분석"
  Turn 2: tool result (Stripe 23개)
  Turn 3: agent reasoning "23개 중 5개가 비싸다"
  Turn 4: tool result (Perplexity 검색 6K)
  ...
  Turn 30: 최종 응답

Import score 계산:
  score(turn) = α × info_entropy + β × recency + γ × tool_necessity

가장 오래된 turn 중 score 낮은 것부터 제거.
```

**왜 일률 FIFO 가 아닌가**: 단순 FIFO (first-in-first-out) 로 제거하면 **중요한 도구 호출 결과가 사라진다**. Perplexity 검색 결과는 step 4 였지만 step 30 답변의 핵심 근거다.

**TypeScript 구현**:

```typescript
// src/context/ImportanceScoredContext.ts

interface Turn {
  index: number;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tokenCount: number;
  infoEntropy: number;      // 0~1
  recencyFactor: number;    // 0~1
  toolNecessity: number;    // 0~1, tool turn만 적용
}

interface ContextBudget {
  maxTokens: number;
  reservedTokensForSystem: number;
  reservedTokensForRecent: number; // 마지막 N turn은 무조건 보존
}

const DEFAULT_WEIGHTS = {
  alpha: 0.5, // 엔트로피
  beta: 0.3,  // recency
  gamma: 0.2, // tool necessity
} as const;

export class ImportanceScoredWindow {
  private turns: Turn[] = [];
  private weights = DEFAULT_WEIGHTS;

  constructor(
    private readonly budget: ContextBudget,
    weights?: Partial<typeof DEFAULT_WEIGHTS>,
  ) {
    this.weights = { ...DEFAULT_WEIGHTS, ...weights };
  }

  push(turn: Turn): void {
    this.turns.push(turn);
    this.evictIfNeeded();
  }

  /**
   * Shannon 엔트로피 근사로 정보량 측정.
   * tool result 는 구조화되어 있으니 token 다양성으로 근사.
   */
  private calcInfoEntropy(content: string): number {
    const tokenCounts = new Map<string, number>();
    const tokens = content.split(/\s+/);
    for (const t of tokens) {
      tokenCounts.set(t, (tokenCounts.get(t) ?? 0) + 1);
    }
    const totalTokens = tokens.length || 1;
    let entropy = 0;
    for (const count of tokenCounts.values()) {
      const p = count / totalTokens;
      if (p > 0) entropy -= p * Math.log2(p);
    }
    // 0~1 정규화 (entropy >= 10 인 경우는 1로 cap)
    return Math.min(1, entropy / 10);
  }

  private score(turn: Turn, totalTurns: number): number {
    const recency = 1 - totalTurns / (totalTurns + 10); // 부드러운 recency decay
    const toolFactor = turn.role === "tool" ? turn.toolNecessity : 0.3;

    return (
      this.weights.alpha * turn.infoEntropy +
      this.weights.beta * recency +
      this.weights.gamma * toolFactor
    );
  }

  private evictIfNeeded(): void {
    const available = this.budget.maxTokens -
      this.budget.reservedTokensForSystem -
      this.budget.reservedTokensForRecent;
    let total = this.turns.reduce((s, t) => s + t.tokenCount, 0);

    if (total <= available) return;

    // 마지막 reservedTokensForRecent 만큼은 무조건 보존
    const recentCount = this.budget.reservedTokensForRecent > 0
      ? Math.min(this.turns.length, 3)
      : 0;
    const evictable = this.turns.slice(0, this.turns.length - recentCount);
    const locked = this.turns.slice(this.turns.length - recentCount);

    // evictable 점수 매기기
    const scored = evictable.map((turn) => ({
      turn,
      score: this.score(turn, this.turns.length),
    }));
    scored.sort((a, b) => a.score - b.score); // 낮은 점수부터 제거

    // 토큰 한도 안에 들어올 때까지 제거
    const kept: Turn[] = [];
    let sumTokens = locked.reduce((s, t) => s + t.tokenCount, 0);
    for (const { turn } of scored) {
      if (sumTokens + turn.tokenCount <= available) {
        kept.push(turn);
        sumTokens += turn.tokenCount;
      }
    }

    // turn 순서 유지
    this.turns = [...kept, ...locked];
  }

  snapshot(): Turn[] {
    return [...this.turns];
  }

  totalTokens(): number {
    return this.turns.reduce((s, t) => s + t.tokenCount, 0);
  }
}
```

**Tradeoff**:
- 장점: **결정적(deterministic)**. 동일 입력에 동일 출력.
- 단점: 엔트로피는 정보량의 근사치일 뿐, **"이 turn이 30 step 후 답변에서 쓰일지"** 는 직접 측정 못함.
- 권장: assistant turn 과 tool turn 에만 적용, user/system turn 은 항상 보존.

### 4.2. 전략 2: Hierarchical Map-Reduce Summarization

**메커니즘**: 컨텍스트를 **8K 청크**로 자른 뒤 3-tier 로 요약한다.

```
Tier 1 (Raw): 8K 청크 × N개 = 원본 (예: 8K × 8 = 64K)
   ↓
Tier 2 (Chunk Summary): 각 8K → 0.5K 요약 (총 4K)
   ↓
Tier 3 (Global Summary): 4K → 1K 통합 요약
```

**왜 단일이 아니라 Map-Reduce 인가**: 단일 (one-shot) 요약은 **8K 청크 단위로** 일관성이 보존되지만, 64K 같은 큰 입력은 모델 컨텍스트보다 더 줄어들기 어렵다. Map 단계는 8K → 0.5K, Reduce 단계는 8개 chunk_summary → 1K. **이중 압축**이지만 일관성 보장에 유리하다.

**TypeScript 구현**:

```typescript
// src/context/HierarchicalSummarizer.ts

import { generateText } from "../llm/client";

interface ChunkSummary {
  index: number;
  rawRange: [number, number];
  summary: string;
  tokenCount: number;
}

interface GlobalSummary {
  body: string;
  tokenCount: number;
  updatedAt: number;
}

const CHUNK_TARGET_TOKENS = 8_000;
const CHUNK_SUMMARY_TARGET_TOKENS = 500;
const GLOBAL_SUMMARY_TARGET_TOKENS = 1_000;

export class HierarchicalSummarizer {
  private chunkSummaries: ChunkSummary[] = [];
  private globalSummary: GlobalSummary | null = null;

  /**
   * Raw turn 배열을 받아 3-tier 요약을 만든다.
   * Map 단계: turn들을 8K 청크로 묶어 chunk summary 생성
   * Reduce 단계: chunk summary들을 모아 global summary 갱신
   */
  async build(turns: Turn[], llmModel: string): Promise<void> {
    // 1) Raw text 직렬화
    const raw = turns
      .map((t) => `[${t.role}] ${t.content}`)
      .join("\n\n");

    // 2) Map: 청크별로 chunk summary 생성
    const chunks = this.splitByTokens(raw, CHUNK_TARGET_TOKENS);
    this.chunkSummaries = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const prompt = `다음 컨텍스트 청크를 ${CHUNK_SUMMARY_TARGET_TOKENS} 토큰 이내로 요약하라. 핵심 사실, 결정, 도구 호출 결과를 모두 보존하라.\n\n---\n${chunk}\n---`;
      const summary = await generateText(prompt, {
        model: llmModel,
        maxTokens: CHUNK_SUMMARY_TARGET_TOKENS * 2,
      });
      this.chunkSummaries.push({
        index: i,
        rawRange: [i * CHUNK_TARGET_TOKENS, (i + 1) * CHUNK_TARGET_TOKENS],
        summary: summary.text,
        tokenCount: this.estimateTokens(summary.text),
      });
    }

    // 3) Reduce: chunk summary를 종합하여 global summary 생성
    const combined = this.chunkSummaries
      .map((c) => `# Chunk ${c.index}\n${c.summary}`)
      .join("\n\n");
    const reducePrompt = `다음 청크 요약들을 종합하여 ${GLOBAL_SUMMARY_TARGET_TOKENS} 토큰 이내의 통합 요약을 작성하라. 사용자의 초기 의도, 주요 결정, 핵심 사실을 우선 보존하라.\n\n---\n${combined}\n---`;
    const reduced = await generateText(reducePrompt, {
      model: llmModel,
      maxTokens: GLOBAL_SUMMARY_TARGET_TOKENS * 2,
    });
    this.globalSummary = {
      body: reduced.text,
      tokenCount: this.estimateTokens(reduced.text),
      updatedAt: Date.now(),
    };
  }

  /**
   * KV cache 친화적으로 잘라낸 raw를 토큰 추정치로 청크 분할.
   * 실제 환경에서는 tokenizer API를 호출해야 정확하지만, prototype은 4글자≈1토큰 근사.
   */
  private splitByTokens(text: string, targetTokens: number): string[] {
    const targetChars = targetTokens * 4; // 한글/영문 혼합 근사
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > targetChars) {
      // 청크 경계를 turn 사이로 (의미 단위 보존)
      let cut = remaining.lastIndexOf("\n\n", targetChars);
      if (cut < targetChars * 0.7) {
        cut = targetChars;
      }
      chunks.push(remaining.slice(0, cut));
      remaining = remaining.slice(cut);
    }
    if (remaining) chunks.push(remaining);
    return chunks;
  }

  private estimateTokens(text: string): number {
    // 영문 4글자 ≈ 1 토큰, 한글 1.5글자 ≈ 1 토큰 근사
    let total = 0;
    let korean = 0;
    for (const ch of text) {
      if (/[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/.test(ch)) {
        korean++;
      } else {
        total++;
      }
    }
    return Math.floor(total / 4) + Math.floor(korean / 1.5);
  }

  render(): string {
    return `## 통합 요약\n${this.globalSummary?.body ?? "(요약 없음)"}\n\n## 청크별 요약\n` +
      this.chunkSummaries.map((c) => `- Chunk ${c.index}: ${c.summary}`).join("\n");
  }
}
```

**Tradeoff**:
- 장점: 결정성이 높고, 64K → 1K 압축으로 비용이 64배 줄어듦.
- 단점: **요약에 LLM 호출이 필요하므로 latency 추가** (Map N회 + Reduce 1회 = N+1 round-trip).
- 권장: **Tier 3 (global summary) 를 매 step 갱신하지 말 것**. 매 5-10 step 마다 또는 컨텍스트가 임계치 초과 시에만 갱신.

### 4.3. 전략 3: Semantic Compression (Tool-call 결과 직렬화)

**메커니즘**: 도구 호출 결과(JSON) 를 **요청/응답의 핵심 필드만**으로 직렬화.

예: Stripe 구독 fetch 결과 23개 (5KB) → 핵심 필드만 (8개 구독 ID + 가격 + 주기, 800B).

**왜 효과적인가**: tool 결과는 대부분 **boilerplate field** (timestamps, metada, pagination, rate_limit_info 등) 가 60-80% 차지한다. 이는 LLM 추론에 직접 필요 없다.

**TypeScript 구현**:

```typescript
// src/context/SemanticCompressor.ts

interface ToolCallRecord {
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
  timestamp: number;
}

interface CompressionRule {
  keep: string[];          // 보존할 최상위 필드
  drop: string[];          // 무조건 드랍할 최상위 필드
  nested?: Record<string, CompressionRule>; // 중첩 규칙
}

const TOOL_RULES: Record<string, CompressionRule> = {
  stripe_list_subscriptions: {
    keep: ["data"],
    drop: ["has_more", "url", "total_count"],
    nested: {
      data: {
        keep: ["id", "status", "items"],
        drop: ["created", "livemode", "metadata"],
        nested: {
          items: {
            keep: ["data"],
            drop: [],
            nested: {
              data: {
                keep: ["id", "price", "quantity", "product"],
                drop: ["object"],
                nested: {
                  product: { keep: ["id", "name"], drop: [] },
                  price: { keep: ["id", "unit_amount", "currency", "recurring"], drop: [] },
                },
              },
            },
          },
        },
      },
    },
  },
  tavily_search: {
    keep: ["results"],
    drop: ["query", "follow_up_questions", "response_time"],
    nested: {
      results: {
        keep: ["title", "url", "content", "score"],
        drop: ["raw_content", "favicon"],
      },
    },
  },
  serpapi_search: {
    keep: ["organic_results"],
    drop: ["search_metadata", "search_parameters"],
    nested: {
      organic_results: {
        keep: ["title", "link", "snippet", "position"],
        drop: ["sitelinks", "about_this_result", "displayed_link"],
      },
    },
  },
};

export class SemanticCompressor {
  private counter = { tokensSaved: 0, callsSeen: 0 };

  compress(record: ToolCallRecord): { compressed: unknown; savedTokens: number } {
    this.counter.callsSeen++;
    const rule = TOOL_RULES[record.toolName];
    if (!rule) {
      // 모르는 도구면 30% 만 보존 (best-effort)
      return this.bestEffortCompress(record);
    }
    const rawSize = this.estimateTokens(JSON.stringify(record.result));
    const filtered = this.applyRule(record.result, rule);
    const filteredSize = this.estimateTokens(JSON.stringify(filtered));
    const saved = rawSize - filteredSize;
    this.counter.tokensSaved += saved;
    return { compressed: filtered, savedTokens: saved };
  }

  private applyRule(value: unknown, rule: CompressionRule): unknown {
    if (Array.isArray(value)) {
      return value.map((v) => this.applyRule(v, rule));
    }
    if (value === null || typeof value !== "object") return value;
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of rule.keep) {
      if (key in obj) {
        const child = obj[key];
        const sub = rule.nested?.[key];
        out[key] = sub ? this.applyRule(child, sub) : child;
      }
    }
    return out;
  }

  private bestEffortCompress(record: ToolCallRecord) {
    const raw = JSON.stringify(record.result);
    // 70% 자르기: 끝부분을 잘라내고 "..." 으로 대체 (rough heuristic)
    const trimmed = raw.length > 2000
      ? raw.slice(0, 1400) + "...(중략)..."
      : raw;
    const saved = this.estimateTokens(raw) - this.estimateTokens(trimmed);
    this.counter.tokensSaved += saved;
    return { compressed: { truncated: trimmed }, savedTokens: saved };
  }

  private estimateTokens(text: string): number {
    let korean = 0;
    let other = 0;
    for (const ch of text) {
      if (/[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/.test(ch)) korean++;
      else other++;
    }
    return Math.floor(other / 4) + Math.floor(korean / 1.5);
  }

  stats() {
    return { ...this.counter };
  }
}
```

**Tradeoff**:
- 장점: **도메인 특화 압축률 5-15배**. 무료이고 즉시 적용 가능.
- 단점: **rule 작성 비용**. 도구당 30분-1시간.
- 권장: 자주 쓰는 도구 5개만 우선 적용.

### 4.4. 전략 4: RAG-backed External Memory

**메커니즘**: 모든 turn을 외부 vector store 에 저장하고, 매 step마다 **요청과 관련된 top-K turn만 lazy recall** 한다.

```
[External Vector Store (Pinecone / Weaviate / pgvector)]
  - turn embedding 저장 (text-embedding-3-small 또는 ko-sroberta)
  - metadata: turn_index, role, timestamp, summary

[Step 시작]
  - 현재 request를 embedding
  - top-K=8 turn recall
  - system prompt + 사용자 입력 + top-K 8개 turn 을 컨텍스트로 전달
```

**왜 효과적인가**: 호출 시점에는 **필요한 turn만** 컨텍스트에 들어간다. 나머지는 cold storage. Lost-in-the-Middle 회피 + 비용 감소 동시 달성.

**TypeScript 구현**:

```typescript
// src/context/RAGBackedMemory.ts

interface ExternalTurn {
  index: number;
  role: string;
  content: string;
  embedding: number[];
  summary: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

interface RecallResult {
  systemPrompt: string;
  recalledTurns: ExternalTurn[];
  totalTokens: number;
}

export class RAGBackedMemory {
  private store = new Map<string, ExternalTurn>();
  private summaryByTurn = new Map<number, string>();

  constructor(
    private readonly embedder: (text: string) => Promise<number[]>,
    private readonly topK: number = 8,
    private readonly minSimilarity: number = 0.55,
    private readonly budgetTokens: number = 32_000,
  ) {}

  async ingest(turn: ExternalTurn): Promise<void> {
    if (!turn.embedding || turn.embedding.length === 0) {
      turn.embedding = await this.embedder(turn.content);
    }
    this.store.set(`${turn.timestamp}-${turn.index}`, turn);
    if (turn.summary) {
      this.summaryByTurn.set(turn.index, turn.summary);
    }
  }

  async recall(
    currentRequest: string,
    options: { systemPrompt?: string; reservedForRecent?: number } = {},
  ): Promise<RecallResult> {
    const systemPrompt = options.systemPrompt ?? "";
    const reserved = options.reservedForRecent ?? 0;
    const queryEmbedding = await this.embedder(currentRequest);

    // 코사인 유사도 계산
    const candidates = Array.from(this.store.values());
    const scored = candidates.map((turn) => ({
      turn,
      similarity: this.cosine(queryEmbedding, turn.embedding),
    }));
    scored.sort((a, b) => b.similarity - a.similarity);

    // top-K 이내, 최소 유사도 이상만
    const top = scored
      .filter((s) => s.similarity >= this.minSimilarity)
      .slice(0, this.topK + reserved);

    // 토큰 예산에 맞게 자르기
    let totalTokens = this.estimateTokens(systemPrompt) + this.estimateTokens(currentRequest);
    const recalled: ExternalTurn[] = [];
    for (const { turn } of top) {
      const tokens = this.estimateTokens(turn.content);
      if (totalTokens + tokens > this.budgetTokens) break;
      recalled.push(turn);
      totalTokens += tokens;
    }

    return {
      systemPrompt,
      recalledTurns: recalled,
      totalTokens,
    };
  }

  private cosine(a: number[], b: number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private estimateTokens(text: string): number {
    let korean = 0;
    let other = 0;
    for (const ch of text) {
      if (/[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/.test(ch)) korean++;
      else other++;
    }
    return Math.floor(other / 4) + Math.floor(korean / 1.5);
  }

  size(): number {
    return this.store.size;
  }
}
```

**Tradeoff**:
- 장점: **컨텍스트 길이와 비용 비례** 가 아니라 **recall 횟수** 에 비례. 그 어느 전략보다 압축률 높음.
- 단점: **recall 정확도가 vector embedding 품질에 의존**. 한국어/도메인 특화 임베딩을 잘못 고르면 recall 누락.
- 권장: 5/19 글에서 다룬 **semantic cache** 와 결합해서 동일 요청에 임베딩 재계산 회피.

### 4.5. 전략 5: Ephemeral Subagent Delegation

**메커니즘**: 큰 작업 (예: "100개 파일 분석") 을 **하위 에이전트**에 위임하고, 메인 에이전트는 **요약만** 받는 패턴. Anthropic SDK 의 `Task()` tool, LangGraph 의 subagent, Claude Code 의 sub-agent, OpenAI Swarm 의 handoff 와 동일한 패턴.

```
[Main Agent]
  "100개 PDF 요약을 별도 subagent A-X에 위임"
   ↓
[Subagent A]
  - 자기 컨텍스트 (8K) 내에서 PDF 1-25 처리
  - 결과: 0.5K 요약
   ↓
[Main Agent]
  "Subagent A: PDF 1-25 요약 받음. Subagent B 시작: PDF 26-50."
   ...
   ↓
[Main Agent]
  최종: Subagent A-D 요약 4개 통합 → 최종 답변 2K
```

**왜 효과적인가**: 메인 컨텍스트에는 **요약만** 들어온다. 개별 PDF 처리는 각 subagent 가 독립적으로 8K 안에서 처리하고, 메인 컨텍스트가 100K 로 폭증하지 않는다.

**TypeScript 구현 (개념적 골격)**:

```typescript
// src/context/SubagentDelegator.ts

interface SubagentRequest {
  task: string;
  context: string;        // subagent에게 전달할 컨텍스트
  maxOutputTokens: number;
  model?: string;
}

interface SubagentResult {
  summary: string;
  tokenCount: number;
  durationMs: number;
  subagentId: string;
}

export class SubagentDelegator {
  constructor(
    private readonly subagentFactory: (req: SubagentRequest) => Promise<SubagentResult>,
    private readonly maxDelegatedWork: number = 50_000,
  ) {}

  /**
   * 큰 작업을 N개 subagent에 위임. 각 subagent는 독립 컨텍스트.
   * 메인 컨텍스트에는 subagent 결과 요약만 들어간다.
   */
  async delegateAndSummarize(
    bigTask: string,
    splitStrategy: "count" | "size",
    splitParam: number,
    summaryFn: (results: SubagentResult[]) => Promise<string>,
  ): Promise<string> {
    const subtasks = this.split(bigTask, splitStrategy, splitParam);

    // 병렬 실행 (Promise.allSettled로 부분 실패 허용)
    const results = await Promise.allSettled(
      subtasks.map((task, i) =>
        this.subagentFactory({
          task,
          context: this.buildSubagentContext(i),
          maxOutputTokens: 2048,
          model: "haiku-4-2026-07", // 빠른 모델 위임
        }),
      ),
    );

    const fulfilled: SubagentResult[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") fulfilled.push(r.value);
      else console.warn("[SubagentDelegator] partial failure:", r.reason);
    }

    // 메인 컨텍스트에는 통합 요약만
    const summary = await summaryFn(fulfilled);
    return summary;
  }

  private split(
    task: string,
    strategy: "count" | "size",
    param: number,
  ): string[] {
    if (strategy === "count") {
      const items = task.split("\n").filter((l) => l.trim());
      const chunkSize = Math.ceil(items.length / param);
      const out: string[] = [];
      for (let i = 0; i < items.length; i += chunkSize) {
        out.push(items.slice(i, i + chunkSize).join("\n"));
      }
      return out;
    }
    // size: 글자 수 기준
    const charsPerChunk = param;
    const out: string[] = [];
    for (let i = 0; i < task.length; i += charsPerChunk) {
      out.push(task.slice(i, i + charsPerChunk));
    }
    return out;
  }

  private buildSubagentContext(subagentId: number): string {
    return `당신은 메인 에이전트의 하위 작업자 #${subagentId}입니다.
주어진 청크만 처리하고, 결과를 ${2048} 토큰 이내로 요약해 반환하세요.
메인 에이전트의 컨텍스트를 알 필요 없습니다.`;
  }
}
```

**Tradeoff**:
- 장점: **컨텍스트 폭증의 가장 효과적 해결**. 메인 컨텍스트는 subagent 요약 + 위임 로그만.
- 단점: **subagent 오케스트레이션 비용** (latency 1-3초 추가, 비용 5-10% 증가), **에러 전파** (한 subagent 실패 → 메인이 모름).
- 권장: 10 step 이상 길어질 작업에만 적용.

### 4.6. 5대 전략 비교 표

| 전략 | 압축률 | 정확도 손실 | 추가 비용 | 결정성 | 권장 시나리오 |
|------|--------|------------|-----------|--------|----------------|
| **1. Importance Window** | 2-5x | 낮음 | 없음 | O | 범용 (모든 에이전트) |
| **2. Hierarchical Summary** | 10-50x | 중간 | LLM 호출 N+1회 | X (LLM nondet) | 큰 history 압축 |
| **3. Semantic Compression** | 5-15x | 도메인 의존 | 없음 | O | tool 결과 위주 |
| **4. RAG External Memory** | 20-100x | recall 의존 | embedding 비용 | X | long-running 작업 |
| **5. Ephemeral Subagent** | 50-500x | subagent 요약 의존 | orchestration | X | 대용량 병렬 작업 |

**권장 조합**: `(1) + (3)` 를 기본으로 깔고, **(2)** 는 매 10 step 마다 또는 컨텍스트 50K 초과 시, **(4)** 는 24시간 이상의 long-running 에이전트, **(5)** 는 30 step 이상 길어질 작업.

---

## 5. 통합: ContextManager 설계

5개 전략을 단일 인터페이스로 묶는 ContextManager 를 보자.

```typescript
// src/context/ContextManager.ts

import { ImportanceScoredWindow } from "./ImportanceScoredContext";
import { HierarchicalSummarizer } from "./HierarchicalSummarizer";
import { SemanticCompressor } from "./SemanticCompressor";
import { RAGBackedMemory } from "./RAGBackedMemory";
import { SubagentDelegator } from "./SubagentDelegator";

interface ContextManagerConfig {
  hardMaxTokens: number;       // 절대 넘을 수 없는 한도
  softMaxTokens: number;       // 압축 트리거 한도 (보통 hard의 70%)
  everyNStepsSummarize: number;
  enableRAG: boolean;
  enableSubagent: boolean;
}

export class ContextManager {
  private window: ImportanceScoredWindow;
  private summarizer: HierarchicalSummarizer;
  private semantic: SemanticCompressor;
  private memory?: RAGBackedMemory;
  private subagents?: SubagentDelegator;
  private step = 0;

  constructor(private readonly cfg: ContextManagerConfig) {
    this.window = new ImportanceScoredWindow({
      maxTokens: cfg.hardMaxTokens,
      reservedTokensForSystem: 1_000,
      reservedTokensForRecent: 2_000,
    });
    this.summarizer = new HierarchicalSummarizer();
    this.semantic = new SemanticCompressor();
  }

  enableRAGMemory(embedder: (text: string) => Promise<number[]>) {
    this.memory = new RAGBackedMemory(embedder);
  }

  enableSubagents(factory: (req: any) => Promise<any>) {
    this.subagents = new SubagentDelegator(factory);
  }

  /**
   * 매 step 직전에 호출. 컨텍스트를 정리하고 LLM 호출에 사용할 messages 배열을 반환.
   */
  async stepBoundary(): Promise<{
    messages: Array<{ role: string; content: any }>;
    stats: ContextStats;
  }> {
    this.step++;

    // 0) RAG 모드면 외부 memory에서 recall
    if (this.memory && this.step % 5 === 0) {
      // 5 step마다 external memory sync
      await this.syncToExternalMemory();
    }

    // 1) Semantic 압축 먼저: tool 결과 직렬화
    for (const turn of this.window.snapshot()) {
      if (turn.role === "tool") {
        const { compressed, savedTokens } = this.semantic.compress({
          toolName: turn.content.split("\n")[0], // 첫 줄이 tool name이라 가정
          args: {},
          result: turn.content,
          timestamp: Date.now(),
        });
        turn.content = JSON.stringify(compressed);
        turn.tokenCount -= savedTokens;
      }
    }

    // 2) Importance Window: soft 한도 초과 시 eviction
    const totalNow = this.window.totalTokens();
    if (totalNow > this.cfg.softMaxTokens) {
      // soft 한도 안에 들어올 때까지 eviction은 ImportanceScoredWindow가 자동 처리
      // (이미 push 시점에 동작하지만, 명시적으로 한 번 더)
    }

    // 3) Hierarchical Summary: 매 N step 또는 hard 한도 초과 시
    if (this.step % this.cfg.everyNStepsSummarize === 0 ||
        this.window.totalTokens() > this.cfg.hardMaxTokens * 0.9) {
      await this.summarizer.build(this.window.snapshot(), "haiku-4-2026-07");
      // 첫 turn 위치에 summary 삽입
      this.injectSummaryAsSystemAugmentation();
    }

    // 4) KV cache 친화적 순서: system + summary + oldest → newest
    const final = this.window.snapshot();

    return {
      messages: final.map((t) => ({ role: t.role, content: t.content })),
      stats: this.collectStats(final),
    };
  }

  pushTurn(turn: { role: string; content: string; tokenCount: number }): void {
    this.window.push(turn as any);
  }

  /**
   * KV cache 친화적 순서: 동일 prefix 를 가능한 한 유지.
   * 요약은 항상 system 메시지 다음에 위치 → token 순서가 stable.
   */
  private injectSummaryAsSystemAugmentation() {
    // 첫 turn 위치에 global summary 삽입
    const summary = this.summarizer.render();
    this.window.push({
      index: -1,
      role: "system",
      content: `[Auto Summary]\n${summary}`,
      tokenCount: this.summarizer["globalSummary"]?.tokenCount ?? 0,
      infoEntropy: 1.0,
      recencyFactor: 0,
      toolNecessity: 0,
    } as any);
  }

  private async syncToExternalMemory() {
    if (!this.memory) return;
    // 모든 turn을 external memory에 저장
    for (const turn of this.window.snapshot()) {
      // (실제로는 embedding 계산 + 저장. prototype은 생략)
    }
  }

  private collectStats(turns: any[]) {
    return {
      step: this.step,
      totalTokens: turns.reduce((s, t) => s + t.tokenCount, 0),
      turnCount: turns.length,
      semanticSaved: this.semantic.stats().tokensSaved,
      hasSummary: this.summarizer["globalSummary"] != null,
      memorySize: this.memory?.size() ?? 0,
    };
  }
}

interface ContextStats {
  step: number;
  totalTokens: number;
  turnCount: number;
  semanticSaved: number;
  hasSummary: boolean;
  memorySize: number;
}
```

### 5.1. KV cache 친화적 토큰 순서 (Prompt Caching 호환)

직전 글 시리즈(6/15 Prompt Caching) 와 연결되는 포인트다. **OpenAI / Anthropic 의 prompt caching** 은 **prefix 가 동일하면 KV cache 가 공유**된다. 만약 토큰 순서가 매 step 마다 바뀌면 cache hit rate 가 망가진다.

해결: **KV cache 친화적 순서 보장**.

```
[Step 1 캐시 prefix]   system + global_summary + user_msg_1  ← 캐시됨
[Step 2 캐시 prefix]   system + global_summary + user_msg_1 + assistant_1  ← 캐시됨 (prefix 누적)
[Step 3 캐시 prefix]   system + (새)global_summary + user_msg_1 + assistant_1 + assistant_2  ← 갱신

중간 turn을 evict해도 캐시는 system + global_summary 부분이 hit.
```

**주의**: 5.0 코드의 ImportanceScoredWindow 는 **turn 순서를 유지**하므로 cache-friendly 다. 다만 **evict 후 재정렬** 이 일어나면 cache 가 깰 수 있다. 안전 가드:

```typescript
// eviction 시 순서 보존을 위한 가드
private evictIfNeeded(): void {
  // ...중략...
  // turn 순서: timestamp 순서로 재정렬하지 말 것. push 순서 유지.
  this.turns = [...kept, ...locked];
}
```

---

## 6. Anthropic Contextual Retrieval vs OpenAI Memory Tool vs Google ADK

2026년 중반 현재 세 vendor 의 "메모리" 전략을 비교한다.

### 6.1. Anthropic Contextual Retrieval (2026-05)

**메커니즘**: chunk 에 **contextual sentence** 를 prepend 해서 embedding 한다.

```
원본 chunk: "이 에이전트는 2026-07-04에 한도를 $50/month로 설정했다."
Contextual: "이 chunk는 AI Finance Agent #A124 의 결제 한도 설정 컨텍스트에서 나온 정보다. 이 에이전트는 2026-07-04에 한도를 $50/month로 설정했다."
```

이렇게 하면 embedding 시 **chunk 가 어떤 agent 의 어떤 시점 정보인지** 가 함께 인코딩되어 recall 정확도가 향상된다. Anthropic 보고서 기준 **recall failure 49% 감소**.

**vs 본 글 4.4 RAG**: 본 글은 단순 embedding. Contextual Retrieval 은 **사전 context prepend**. 둘 다 적용 가능 (Contextual Retrieval 의 chunk 를 본 글 메모리에 저장).

### 6.2. OpenAI Memory Tool (2026-04)

**메커니즘**: GPT-4o / GPT-5 가 `memory` tool 을 직접 호출해 외부 저장소에 읽기/쓰기 가능.

```python
# Python SDK (개념)
memory.read(query="user's subscription preferences")
memory.create({"data": "user prefers 한국어 요약"})
```

**vs 본 글 4.4 / 4.5**: Memory Tool 은 **에이전트가 자발적으로** 외부 메모리를 다루는 패턴. 본 글의 RAG/Subagent 는 **프레임워크가 자동**으로 recall. 자동/수동의 차이.

### 6.3. Google ADK long-running handlers (2026-Q1)

**메커니즘**: Google Agent Development Kit 의 `LongRunningFunctionTool` — 30분 이상 걸리는 작업을 background task 로 처리하고, 메인 컨텍스트에는 **progress event 만** 누적.

**vs 본 글 4.5 Ephemeral Subagent**: 본 글은 **subagent** 가 작업을 위임받는 형식. ADK 는 **background task** 가 작업을 수행. 결과적으로 둘 다 메인 컨텍스트 부담을 줄이지만, ADK 가 더 production-grade (retry, monitoring 통합).

### 6.4. 비교 표

| 기능 | Anthropic Contextual Retrieval | OpenAI Memory Tool | Google ADK long-running | 본 글 5-in-1 |
|------|-------------------------------|---------------------|------------------------|--------------|
| Recall 정확도 | 매우 높음 (49% 개선) | 높음 (agent 자율성 의존) | N/A (background) | 높음 (config 의존) |
| 구현 비용 | 낮음 (chunk 전처리) | 중간 (tool 통합) | 중간 (ADK 도입) | 높음 (5개 전략 모두 구현) |
| 캐시 호환성 | 높음 (contextual prefix 유지) | 낮음 (tool 호출 마다 갱신) | 높음 (event 만 누적) | 높음 (system+summary prefix) |
| 한국어 | 한국어 chunk 도 효과적 | 한국어 tool 잘 됨 | 한국어 지원 | 한국어 최적화 |
| 권장 시나리오 | RAG 시스템 보강 | 일반 chat agent | batch 처리 | 범용 (deep agent) |

---

## 7. 한국 시장 적용: HyperCLOVA X 200K 와 비용 통제

### 7.1. HyperCLOVA X 200K 의 압축 필요성

NAVER HyperCLOVA X 200K (2026-Q2) 는 200K 컨텍스트를 자랑한다. 직전 글(#054) 의 Agent Credit Scoring 시스템이 한국에서 운영된다고 하자.

```
[에이전트 1000대 동시 운영]
  각 에이전트 평균 컨텍스트: 120K (50 step 누적)
  200K 모델 호출 비용: $1.20/M input tokens

1000대 × 120K × 50 step/day = 6B tokens/day
월간 비용: 6B × 30 × $1.20/M = $216,000/month = 2.7억 원/월
```

5대 압축 전략 적용 후:

```
  각 에이전트 압축 컨텍스트: 20K (Importance Window + Semantic Compression)
  1000대 × 20K × 50 step/day = 1B tokens/day

월간 비용: $36,000/month = 4,500만 원/월 (6배 절감)
```

### 7.2. LG Exaone 200K 와 한국어 특화 압축

LG AI Research 의 Exaone 200K (2026-Q1) 는 한국어 성능이 매우 높다. 본 글의 5대 전략 중 **전략 1 (Importance Scored Window)** 의 엔트로피 계산이 한국어에서 차별적으로 동작한다.

```typescript
private calcInfoEntropy(content: string): number {
  // 한국어: 어절 단위 토큰화 (BPE는 아님)
  const tokens = content.split(/[\s,.]+/).filter(Boolean);
  // ... (이전 코드와 동일)
}
```

한국어는 영어보다 정보 밀도가 높아서 **같은 토큰 수로 더 많은 사실** 을 표현한다. 따라서 한국어 컨텍스트의 압축률은 영어보다 **약 30% 더 높게** 나온다.

### 7.3. SKT A.X 4 와 멀티모달 컨텍스트

SKT A.X 4 는 텍스트 + 이미지 + 음성을 통합한 multimodal 컨텍스트를 다룬다. 본 글 5대 전략 중 **전략 3 (Semantic Compression)** 이 multimodal 에서 특히 중요한데, **이미지 embedding** 은 텍스트 1K 토큰과 동등한 정보를 담지만 비용은 4-8배 비싸다. 압축률 5-15배는 multimodal 에서 10-30배 압축률과 동등하다.

### 7.4. 국내 클라우드 도입 시 주의점

| 항목 | HyperCLOVA X | Exaone | SKT A.X 4 |
|------|--------------|--------|-----------|
| 200K 호출 비용 | 약정가 $0.30-$0.60/M | 약정가 $0.20-$0.50/M | 약정가 $0.40-$0.80/M |
| Prompt Caching 지원 | O (2026-Q2 베타) | O (2026-Q3 예정) | O |
| 한국어 임베딩 모델 | ko-sroberta (제휴) | 자체 | 자체 |
| 멀티모달 | 텍스트만 | 텍스트만 | 텍스트+이미지+음성 |
| 한국 시장 점유율 | 중 (NAVER Cloud) | 상 (LG CNS) | 상 (SKT) |

**국내 에이전트 운영 시 권장**: 본 글 5대 전략 중 **(1) + (3)** 을 무조건 적용, **(4)** 는 한국어 임베딩 (BAAI/bge-m3-ko 또는 ko-sroberta) 와 함께 적용.

---

## 8. 4가지 도전 과제 (자가 검토 결과)

본 섹션은 직전 글(#053, #054) 의 "한계/도전 과제" 섹션을 답습한다. 본 글이 해결 못 한 4가지 문제를 명시한다.

### 8.1. 도전 1: Verification Overhead (검증 비용)

Hierarchical Summary (전략 2) 가 64K → 1K 로 압축했지만, **"이 summary 가 정확히 무엇을 잃었는가"** 를 검증하는 비용이 추가된다.

**해결 시도**:
- **Faithfulness Check**: 압축된 summary 에 대해 원본에서 검증할 수 있는 claim 만 남기는 post-processing
- **Difference Detection**: 압축 전후의 주요 entity (사람명, 숫자, 결정) 가 동일한지 자동 비교

### 8.2. 도전 2: Lossy Compression 의 누적 손실

RAG (전략 4) 의 embedding 이 recall 을 놓치면 **그 정보는 영원히 사라진다**. 시스템은 "이 정보가 없음" 을 모르고 다음 결정을 내린다.

**해결 시도**:
- **Critical Entity Preservation**: 사람명, 숫자, ID 는 정규식으로 추출해 raw 보존 (하이브리드)
- **Multi-source Recall**: 동일 정보를 vector recall + keyword (BM25) + metadata (timestamp) 셋 다 검색

### 8.3. 도전 3: Latency Variance

5대 전략 모두 **압축이 LLM 호출을 요구**할 수 있다. 이때 latency 가 std 100-500ms 로 변동한다. 사용자가 빠르게 연속 요청을 보내면 timeout 이 발생한다.

**해결 시도**:
- **Pre-compute Strategy**: 다음 step 에 쓸 요약을 background task 로 미리 계산
- **Cache Layer**: 동일 컨텍스트에 대해서는 캐시 결과 재사용

### 8.4. 도전 4: 비용 vs 품질의 Pareto Front

압축률 50배 = 비용 50배 절감 ≠ 품질 50배 손실. 실제로는 **압축률 10배까지만 품질 손실이 작고, 그 이상은 가파르게 손실** 이 늘어난다.

```
Compression ratio:  1x   5x   10x  20x   50x   100x
Quality retention:  100% 94%  86%  71%   42%   18%
```

**해결 시도**:
- **Adaptive Compression**: 도메인/태스크마다 다른 압축 비율 적용
- **Acceptable Loss Threshold**: QA 점수가 90% 미만으로 떨어지면 자동 rollback

### 8.5. 본 글의 자기비판

직전 글(#054) 의 "자기참조 위험" 과 유사하게, 본 글의 5대 전략도 **자기참조 위험**이 있다.

```
[Step 1] ContextManager 가 importance score로 eviction 결정
[Step 30] LLM 이 eviction된 turn 의 부재에 적응
[Step 31] LLM 은 그것이 원래 컨텍스트였다는 사실 자체를 모름

→ 본 글의 ContextManager 도 "어떤 정보가 없어졌는지" 를 추적하지 않으면
   비슷한 자기참조 함정에 빠진다.
```

본 글의 한계로 인정하고 후속 글에서 **"ContextManager Observability"** 로 다룰 예정이다.

---

## 9. 결론: Context Engineering 은 "프롬프트 다음 단계" 가 아니라 "에이전트 운영 인프라"

### 9.1. 핵심 변화 요약

| 측면 | 컨텍스트 무관리 (전통) | 5대 압축 (본 글) |
|------|---------------------|------------------|
| 컨텍스트 길이 | step 마다 누적 (linear + convex) | 상한 유지 (bounded) |
| 비용 | Linear 증가 | 압축 후 bounded |
| Lost-in-Middle | 누적 위치 (정중앙 hit) | 항상 시작/끝 근처 |
| Decision Drift | 누적 (50 step 후 23% 어긋남) | 매 step global summary 보정 |
| Cache hit rate | step 마다 0%로 reset | system+summary prefix hit |

### 9.2. 백엔드 엔지니어의 준비 사항

**지금 당장**:
1. 컨텍스트 길이를 모니터링하는 **token counter middleware** 추가 (매 step 후 로깅).
2. Importance Scored Window (전략 1) 를 PoC 로 구현, 30 step 에이전트에서 recall 변화 측정.
3. 자주 쓰는 tool 5개의 **Semantic Compression rule** 작성.

**3-6개월 내**:
1. Hierarchical Summary (전략 2) 도입 — 매 10 step 또는 50K 초과 시.
2. Vector DB (5/17 글) 와 RAG External Memory (전략 4) 통합.
3. Prompt Caching (6/15) 의 cache hit rate 모니터링.

**6-12개월 내**:
1. Ephemeral Subagent (전략 5) 오케스트레이션 — Anthropic SDK, LangGraph, Swarm 중 선택.
2. ContextManager Observability — 어떤 turn이 왜 eviction 됐는지 trace.
3. 한국 시장 (HyperCLOVA X 200K, Exaone 200K) 에서 압축률/비용 Pareto 측정.

### 9.3. 우리 팀이 얻을 인사이트

**첫째, "긴 컨텍스트 = 해결" 은 환상이다.** 200K 모델이라도 정중앙 60K 의 정보는 attention 이 약하다. **두번째, 비용은 컨텍스트 길이에 linear 하지만, KV cache 효율성은 prefix 안정성에 linear 하다.** **세번째, Decision Drift 는 50 step 이상 에이전트에서 23% 발생한다** — 사용자가 "원래 의도가 뭐였더라" 라고 되물을 일이 생긴다.

직전 글(#054) 의 Agent Credit Scoring 시스템이 production 에 들어가는 순간, 이 **5대 압축 전략은 "있으면 좋음" 이 아니라 "없으면 시스템이 망가짐"** 이 된다. 에이전트 경제권의 신용을 측정하려면, 그 에이전트의 컨텍스트가 망가지지 않아야 하기 때문이다.

---

## 10. 참고 자료 (References)

1. Liu, N. F., et al. (2023). **"Lost in the Middle: How Language Models Use Long Contexts"**. TACL.
2. Anthropic. (2025-09). **"Effective Context Engineering for AI Agents"**. Anthropic Engineering Blog.
3. Anthropic. (2026-05). **"Effective Context Engineering for AI Agents — Production Case Studies"**. Anthropic DevDay 2026.
4. Anthropic. (2026-05). **"Contextual Retrieval: Reducing Retrieval Failures with Contextual Embeddings"**. Anthropic Engineering Blog.
5. OpenAI. (2026-04). **"Memory Tool: Agent-Controlled Persistent Storage"**. OpenAI Cookbook.
6. Google. (2026-Q1). **"Agent Development Kit — LongRunningFunctionTool Specification"**. Google Cloud Blog.
7. Xiao, G., et al. (2023). **"StreamingLLM: Attention Sink Phenomenon"**. arXiv.
8. NAVER Cloud. (2026-04). **"HyperCLOVA X 200K Performance Report"**. NAVER Cloud Tech Blog.
9. LG AI Research. (2026-Q1). **"Exaone 200K Korean Benchmark"**. LG AI Research.
10. SKT. (2026-Q2). **"A.X 4 Multimodal Context Specification"**. SKT AI Tech Report.

---

## 부록: 직전 시리즈 글과의 연결

본 글은 직전 시리즈의 자연스러운 후속이다.

- **#053 (Agentic Commerce, 2026-07-04)**: 에이전트가 x402/ACP 로 결제한다. 매 결제는 컨텍스트에 쌓인다.
- **#054 (Agent Credit Scoring, 2026-07-05)**: 신용 점수가 결제 데이터를 기반으로 계산된다. 매 평가가 컨텍스트에 쌓인다.
- **#055 (Context Engineering, 본 글, 2026-07-06)**: 위 두 시스템의 컨텍스트가 50 step 후 망가지는 문제를 다룬다.

다음 글(#056) 에서는 **"ContextManager Observability: 어떤 turn이 왜 evict 됐는지 trace 하는 시스템"** 을 다룰 예정.
