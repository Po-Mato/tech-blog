---
title: "Temporal Memory Architecture: AI Agent가 시간의 흐름을 이해하는 방법"
date: "2026-06-05"
description: "2026년 Agent Memory의 가장 어려운 문제는 시간적 추론(Temporal Reasoning)이다. Mem0의 최신 벤치마크(+29.6점), Red Hat의 아키텍처 분석, agentmemory의 다중 세션 설계를 관통하는 핵심 질문: 'AI Agent가 1시간 전, 어제, 지난주의 정보를 어떻게 구분하고 연결할까?' 다중 계층 Temporal Memory의 아키텍처 설계, 지식 업데이트와 모순 해결 패턴, 생산 등급 구현 코드를 단계별로 해부한다."
tags:
  - AI Agent
  - Temporal Memory
  - Agent Architecture
  - Memory Management
  - Knowledge Update
  - Vector Database
  - Multi-Agent Systems
  - Production AI
  - Mem0
  - agentmemory
---

## 1. 들어가며: 에이전트가 시간을 모른다

AI 에이전트에게 시간은 단순한 문자열일 뿐이다.

```
사용자: "저번 주에 추천해준 레스토랑 어디였지?"
에이전트: "죄송합니다. 이전 세션 정보를 찾을 수 없습니다."
```

2026년, Agent Memory는 "데이터를 저장하느냐"에서 "**시간에 따라 변화하는 지식을 어떻게 이해하느냐**"로 진화하고 있다. Mem0의 최신 벤치마크에 따르면, Temporal Reasoning이 +29.6점 향상되었지만 여전히 가장 어려운 과제로 남아 있다. Red Hat의 "From Context to Dreams" 아티클은 이를 "Agent capability = model + harness + **memory** + environment + evolution" 공식에서 memory의 핵심 요소로 지목한다.

**핵심 문제는 이것이다:** 정보는 시간에 따라 생성되고, 업데이트되고, 무효화된다. "사용자가 Python을 선호한다"는 사실은 "사용자가 이제 TypeScript를 선호한다"는 사실과 충돌한다. 두 사실 모두 데이터베이스에 저장되어 있다. 에이전트는 어떤 정보를 신뢰해야 하는가?

```typescript
// ❌ 단순 RAG의 한계 — 시간 정보가 없다
interface MemoryFragment {
  content: string;
  userId: string;
  embedding: number[];
}
// "Python을 선호"와 "TypeScript를 선호"가 모두 검색된다
// 어떤 것이 최신 정보인지 알 수 없다
```

이 글에서는 Temporal Memory Architecture의 4가지 핵심 계층과 생산 등급 구현 패턴을 다룬다.

---

## 2. Temporal Memory의 4계층 아키텍처

Temporal Memory는 단일 기술이 아니라, 서로 다른 시간적 특성을 가진 4가지 메모리 계층의 조합이다.

```
┌─────────────────────────────────────────┐
│          Layer 4: Procedural            │
│  (Tools, Workflows, Rules — 정적/영구)    │
├─────────────────────────────────────────┤
│          Layer 3: Semantic              │
│  (지식, 사실 관계 — 장기, 느린 변화)       │
├─────────────────────────────────────────┤
│          Layer 2: Episodic              │
│  (세션 기록, 대화 맥락 — 중기, 빠른 변화)  │
├─────────────────────────────────────────┤
│          Layer 1: Working               │
│  (현재 태스크, MCP State — 단기, 휘발성)  │
└─────────────────────────────────────────┘
```

### Layer 1: Working Memory (단기, 휘발성)

현재 실행 중인 태스크의 상태를 보유한다. MCP 세션, Tool 호출 체인, 현재 컨텍스트 윈도우.

```typescript
interface WorkingMemory {
  sessionId: string;
  taskId: string;
  contextWindow: TokenWindow;  // 현재 LLM 컨텍스트
  activeTools: Map<string, ToolState>;  // 진행 중인 Tool 호출
  intermediateResults: ResultCache;  // 중간 결과물
  createdAt: Timestamp;
  ttl: number;  // ms 단위, 일반적으로 30-60분
}

class WorkingMemoryManager {
  private stores = new Map<string, WorkingMemory>();
  
  get(sessionId: string): WorkingMemory | null {
    const mem = this.stores.get(sessionId);
    if (!mem) return null;
    if (Date.now() - mem.createdAt > mem.ttl) {
      this.stores.delete(sessionId);
      return null;  // TTL 만료 = 가비지 컬렉션
    }
    return mem;
  }
}
```

> **핵심 원칙:** Working Memory는 절대 DB에 쓰지 않는다. 메모리 내에서만 존재하며, 세션이 종료되면 사라진다. 영속성이 필요한 정보는 상위 계층으로 승격(Promotion)해야 한다.

### Layer 2: Episodic Memory (중기, 세션 기반)

각 세션의 전체 내역을 시간 순서로 저장한다. `agentmemory`의 핵심 설계 영역이다.

```typescript
interface EpisodicMemory {
  userId: string;
  sessionId: string;
  episodes: Episode[];
  // temporal index — 시간 순서 + 계층 구조
  temporalIndex: TemporalIndex;
}

interface Episode {
  id: string;
  timestamp: Timestamp;
  type: 'user_input' | 'agent_action' | 'tool_result' | 'system_event';
  content: string;
  metadata: {
    turnNumber: number;
    parentEpisodeId?: string;  // 계층 구조 — 어떤 액션의 결과인지
    toolCalls?: ToolCallRecord[];
    importance?: number;  // 중요도 점수 (0-1)
  };
  embedding?: number[];
}
```

Episodic Memory의 핵심은 **Temporal Index**다. 단순한 벡터 검색만으로는 "어제 저녁에 논의한 내용"을 찾을 수 없다.

### Layer 3: Semantic Memory (장기, 느린 변화)

사용자의 선호도, 프로젝트 컨텍스트, 학습된 지식 등 변화 속도가 느린 정보를 저장한다. 이 계층이 Temporal Reasoning의 핵심 전장이다.

```typescript
interface SemanticFact {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;  // 0.0 - 1.0
  timeline: FactTimeline;  // 시간에 따른 변화 이력
  source: string;  // 어떤 세션/에피소드에서 추출되었는가
  embedding: number[];
  metadata: {
    firstObserved: Timestamp;
    lastObserved: Timestamp;
    observationCount: number;
    contradictoryFacts: string[];  // 모순 관계 추적
  };
}

interface FactTimeline {
  entries: TimelineEntry[];
  current: TimelineEntry;  // 가장 최근 유효한 값
}

interface TimelineEntry {
  value: string;
  validFrom: Timestamp;
  validTo?: Timestamp;  // undefined = 현재 유효
  reason?: string;  // 변경 이유
}
```

### Layer 4: Procedural Memory (영구, 정적)

Tool 정의, MCP 서버 설정, Workflow 템플릿, 가드레일 규칙 등 변화가 거의 없는 정적 정보. 일반적으로 파일 시스템이나 환경 변수로 관리된다.

---

## 3. Temporal Indexing: 벡터 검색의 시간적 축

Temporal Memory의 가장 큰 기술적 도전은 **벡터 유사도와 시간적 근접성을 어떻게 결합할 것인가**다.

### 문제 정의

"지난주에 추천한 맛집"을 검색할 때:
1. "맛집" + "추천"의 의미적 유사도를 검색한다
2. 검색 결과 중 "지난주"에 해당하는 Temporal Window로 필터링한다
3. Temporal Window 내에서 가장 의미적으로 유사한 결과를 반환한다

```typescript
interface TemporalVectorIndex {
  // Time-aware hybrid search
  async search(params: {
    query: string;
    queryEmbedding: number[];
    userId: string;
    timeRange?: {
      from?: Timestamp;
      to?: Timestamp;
      relative?: 'today' | 'this_week' | 'last_week' | 'this_month';
    };
    topK: number;
    temporalWeight?: number;  // 0.0-1.0, 시간 가중치
    minRelevance?: number;    // 최소 의미적 유사도 임계값
  }): Promise<ScoredMemory[]>;
}

// 구현: Multi-Signal Retrieval with Temporal Decay
class TemporalHybridRetriever {
  private vectorStore: VectorStore;
  private timeStore: TimeSeriesStore;
  
  async search(params: SearchParams): Promise<ScoredMemory[]> {
    // 1. 벡터 검색 — 의미적 유사도 점수
    const vectorResults = await this.vectorStore.similaritySearch(
      params.queryEmbedding, 
      params.topK * 3  // 여유 있게 가져온다
    );
    
    // 2. Temporal scoring — 시간 기반 점수
    const scored = vectorResults.map(result => {
      const timeScore = this.computeTemporalScore(
        result.lastObserved, 
        params.timeRange
      );
      const vectorScore = result.similarity;
      
      // Fusion: 가중 결합
      const w = params.temporalWeight ?? 0.3;
      return {
        ...result,
        combinedScore: (1 - w) * vectorScore + w * timeScore,
      };
    });
    
    // 3. Temporal decay 적용
    const decayed = scored.map(r => ({
      ...r,
      decayedScore: r.combinedScore * this.temporalDecayFactor(r.lastObserved),
    }));
    
    // 4. Top-K 정렬 및 반환
    return decayed
      .sort((a, b) => b.decayedScore - a.decayedScore)
      .slice(0, params.topK);
  }
  
  private temporalDecayFactor(lastObserved: number): number {
    const hoursAgo = (Date.now() - lastObserved) / (1000 * 60 * 60);
    
    if (hoursAgo < 1) return 1.0;       // 최근 1시간: 최대 가중치
    if (hoursAgo < 24) return 0.9;      // 오늘: 0.9
    if (hoursAgo < 168) return 0.7;     // 이번 주: 0.7
    if (hoursAgo < 720) return 0.4;     // 이번 달: 0.4
    
    // 오래된 정보는 시간적 가중치가 낮지만,
    // 의미적 유사도가 매우 높으면 여전히 검색될 수 있다
    return 0.2;
  }
}
```

**왜 temporal decay가 중요한가?**

Mem0의 2026년 벤치마크에서 Temporal Reasoning이 +29.6점 향상된 주요 원인 중 하나가 이 decay 패턴이다. 단순히 최신 정보만 반환하는 것이 아니라, **의미적 유사도 × 시간적 근접성**의 결합 점수를 통해 "오래되었지만 중요한 정보"와 "최근의 사소한 정보"를 공정하게 비교한다.

---

## 4. 지식 업데이트와 모순 해결 (Knowledge Update & Contradiction Resolution)

에이전트가 시간을 이해하는 가장 어려운 부분은 정보가 **변경**될 때다.

### 문제 시나리오

```
세션 1 (3월): 사용자 "저는 Python을 주로 사용합니다."
세션 2 (5월): 사용자 "최근에 TypeScript로 갈아탔어요."
질문 (6월): "사용자의 주력 언어는?"
```

올바른 답: "TypeScript". 하지만 단순 RAG 시스템은 Python과 TypeScript 모두를 검색하고, 어느 것이 최신인지 판단하지 못한다.

### 솔루션: Fact Timeline + Verifier Loop

```typescript
class KnowledgeGraph {
  private facts: Map<string, SemanticFact>;
  
  // 새로운 사실을 추가하거나 기존 사실을 업데이트한다
  async ingest(fact: RawFact): Promise<ResolvedFact> {
    // 1. 기존에 동일한 subject+predicate가 있는지 확인
    const existing = this.findExisting(fact.subject, fact.predicate);
    
    if (!existing) {
      // 신규 사실 — 그대로 추가
      return this.addNewFact(fact);
    }
    
    // 2. 값이 변경되었는지 확인
    if (existing.currentValue === fact.object) {
      // 동일한 값 — observationCount만 증가
      existing.observationCount++;
      existing.lastObserved = fact.timestamp;
      return { status: 'confirmed', fact: existing };
    }
    
    // 3. 값이 변경됨 — 모순 감지!
    return this.resolveContradiction(existing, fact);
  }
  
  private async resolveContradiction(
    existing: SemanticFact, 
    newFact: RawFact
  ): Promise<ResolvedFact> {
    // Temporal Verifier: 최신 정보를 채택하되,
    // 이전 정보를 완전히 삭제하지 않고 타임라인에 보존한다
    
    // 3a. 이전 fact의 validTo 설정
    existing.timeline.current.validTo = newFact.timestamp;
    existing.timeline.current.reason = 'superseded_by_new_observation';
    
    // 3b. 새 TimelineEntry 생성
    const newEntry: TimelineEntry = {
      value: newFact.object,
      validFrom: newFact.timestamp,
      validTo: undefined,
      reason: 'user_stated_update',
    };
    
    // 3c. 타임라인에 추가
    existing.timeline.entries.push(newEntry);
    existing.timeline.current = newEntry;
    
    // 3d. 모순 관계 등록 (자기 교정용)
    existing.metadata.contradictoryFacts.push(
      `${newFact.timestamp}: ${newFact.object}`
    );
    
    return { 
      status: 'updated', 
      fact: existing,
      previousValue: existing.currentValue,
    };
  }
  
  // 시간을 고려한 사실 조회
  async queryFact(
    subject: string, 
    predicate: string, 
    asOf?: Timestamp
  ): Promise<string | null> {
    const fact = this.facts.get(`${subject}:${predicate}`);
    if (!fact) return null;
    
    const queryTime = asOf ?? Date.now();
    
    // Query time에 해당하는 TimelineEntry 찾기
    const entry = fact.timeline.entries.find(e => 
      e.validFrom <= queryTime && 
      (!e.validTo || e.validTo >= queryTime)
    );
    
    return entry?.value ?? null;
  }
}
```

### 장기적인 도전: Temporal Abstraction at Scale

BEAM 벤치마크의 1M/10M 토큰 규모에서 드러난 문제는 **시간적 추상화(Temporal Abstraction)** 다. 10M 토큰의 기록에서 "사용자가 3월에 Python을 선호했다가 5월에 TypeScript로 전환했다"는 패턴을 추출하는 것은 단순한 타임라인 관리 이상의 작업이 필요하다.

```typescript
interface TemporalAbstraction {
  // 일정 기간의 에피소드를 분석하여 추세/패턴 추출
  async abstractPatterns(
    episodes: Episode[],
    windowSize: 'hour' | 'day' | 'week'
  ): Promise<PatternSummary[]> {
    const windows = this.windowEpisodes(episodes, windowSize);
    
    return windows.map(window => ({
      period: window.period,
      keyTopics: this.extractTopics(window.episodes),
      sentiment: this.analyzeSentiment(window.episodes),
      actionFrequency: this.countActions(window.episodes),
      // 패턴 변화 감지
      changePoint: this.detectChangePoint(
        window, 
        this.previousWindow
      ),
    }));
  }
}
```

---

## 5. Memory Staleness: 언제 기억을 잊을 것인가

사람과 마찬가지로, 에이전트도 **잊는 방법**을 알아야 한다. 모든 정보를 영원히 보유하는 것은 검색 품질을 떨어뜨리고 비용을 증가시킨다.

### Staleness Detection Strategies

```typescript
class StalenessDetector {
  // 전략 1: 시간 기반 (Time-to-Live)
  private ttlStrategy(fact: SemanticFact): StalenessScore {
    const hoursSinceUpdate = 
      (Date.now() - fact.lastObserved) / (1000 * 60 * 60);
    
    // 정보 유형별 TTL
    const ttl: Record<string, number> = {
      'preference': 30 * 24,       // 선호도: 30일
      'project_context': 7 * 24,   // 프로젝트 맥락: 7일
      'session_detail': 48,        // 세션 상세: 48시간
      'tool_result': 24,           // 도구 결과: 24시간
      'temporal_query': 1,         // 시간 질의: 1시간
    };
    
    const maxTtl = ttl[fact.predicate] ?? 7 * 24;
    const staleness = Math.min(hoursSinceUpdate / maxTtl, 1.0);
    
    return { score: staleness, strategy: 'ttl' };
  }
  
  // 전략 2: 사용성 기반 (Usage-based)
  private usageStrategy(fact: SemanticFact): StalenessScore {
    // 얼마나 자주 조회되는가?
    const usageRate = fact.metadata.observationCount / 
      ((Date.now() - fact.firstObserved) / (1000 * 60 * 60 * 24));
    
    // 하루 0.1회 미만 조회 = 거의 사용되지 않음
    const staleness = Math.max(1.0 - (usageRate / 0.1), 0);
    
    return { score: staleness, strategy: 'usage' };
  }
  
  // 전략 3: 모순 기반 (Contradiction-based)
  private contradictionStrategy(fact: SemanticFact): StalenessScore {
    // 여러 번 모순이 발생한 사실은 신뢰도가 낮다
    const contradictionRatio = 
      fact.metadata.contradictoryFacts.length / 
      Math.max(fact.metadata.observationCount, 1);
    
    return { 
      score: Math.min(contradictionRatio * 2, 1.0),
      strategy: 'contradiction' 
    };
  }
  
  // 통합 staleness score
  async computeStaleness(fact: SemanticFact): Promise<number> {
    const scores = await Promise.all([
      this.ttlStrategy(fact),
      this.usageStrategy(fact),
      this.contradictionStrategy(fact),
    ]);
    
    // 가중 평균
    const weights = [0.5, 0.3, 0.2];
    return scores.reduce((sum, s, i) => sum + s.score * weights[i], 0);
  }
}
```

### Memory Consolidation (압축)

주기적으로 오래되고 중요도가 낮은 정보를 압축하거나 삭제한다:

```typescript
class MemoryConsolidator {
  async consolidate(userId: string): Promise<ConsolidationReport> {
    const candidates = await this.stalenessDetector
      .findStaleMemories(userId, { threshold: 0.8 });
    
    const actions: ConsolidationAction[] = [];
    
    for (const candidate of candidates) {
      if (candidate.importance < 0.3 && candidate.staleness > 0.9) {
        // 중요도 낮고 매우 오래됨 → 삭제
        actions.push({ 
          factId: candidate.id, 
          action: 'delete',
          reason: 'low_importance_high_staleness',
        });
      } else if (candidate.staleness > 0.7) {
        // 중요도는 있지만 오래됨 → 요약 압축
        const summary = await this.summarizeFact(candidate);
        actions.push({
          factId: candidate.id,
          action: 'compress',
          summary,
        });
      }
    }
    
    await this.applyActions(actions);
    return { consolidated: actions.length, details: actions };
  }
}
```

---

## 6. Cross-Session Identity: 세션 너머의 사용자 인식

Agent Memory의 가장 까다로운 문제 중 하나는 **세션 간 동일성 식별**이다. 같은 사용자가 다른 디바이스, 다른 시간대, 다른 컨텍스트에서 접속할 때, 에이전트는 이들을 동일 인물로 인식해야 한다.

```typescript
interface IdentityResolver {
  // 다중 시그널 기반 사용자 식별
  async resolve(params: {
    userId?: string;
    deviceId?: string;
    sessionContext: SessionContext;
    behavioralSignals: BehavioralSignature;
  }): Promise<IdentityResult> {
    
    // 1. 명시적 userId가 있으면 즉시 해결
    if (params.userId) {
      return { resolved: true, identityId: params.userId, confidence: 1.0 };
    }
    
    // 2. 행동 시그널 기반 휴리스틱 매칭
    const candidates = await this.findCandidates(params.behavioralSignals);
    
    if (candidates.length === 0) {
      // 새로운 사용자 — 임시 ID 생성
      return this.createAnonymousIdentity(params);
    }
    
    if (candidates.length === 1 && candidates[0].confidence > 0.85) {
      return { 
        resolved: true, 
        identityId: candidates[0].identityId, 
        confidence: candidates[0].confidence,
      };
    }
    
    // 3. 불확실한 경우 — 에이전트가 직접 확인
    return {
      resolved: false,
      requiresConfirmation: true,
      candidates: candidates.map(c => c.identityId),
      prompt: "이전에 대화한 적이 있으신가요? " +
        "맞다면 이전 주제를 이어서 도와드릴게요.",
    };
  }
}
```

---

## 7. 생산 등급 구현: Mem0 + agentmemory 통합 아키텍처

Mem0의 벤치마크(92.5 LoCoMo, 94.4 LongMemEval)와 agentmemory의 다중 세션 설계를 결합한 생산 등급 구현:

```typescript
import { MemoryClient } from 'mem0';
import { AgentMemory } from 'agentmemory';

class TemporalMemorySystem {
  private semanticMemory: MemoryClient;  // Mem0 — 장기 의미 메모리
  private episodicMemory: AgentMemory;    // agentmemory — 세션 기억
  private workingMemory: WorkingMemoryManager;  // 단기 작업 메모리
  private knowledgeGraph: KnowledgeGraph;  // 사실 관계 + 타임라인
  private consolidator: MemoryConsolidator;
  
  async remember(
    query: string,
    userId: string,
    options?: {
      temporalWeight?: number;
      asOf?: Timestamp;
      includeEpisodic?: boolean;
    }
  ): Promise<MemoryResult> {
    const embedding = await this.embed(query);
    const temporalWeight = options?.temporalWeight ?? 0.3;
    
    // 1. Working Memory 검색 (최우선)
    const working = this.workingMemory.search(query, userId);
    
    // 2. Episodic Memory 검색 (중기)
    const episodic = options?.includeEpisodic !== false
      ? await this.episodicMemory.search(query, { 
          userId,
          recency: temporalWeight,
        })
      : [];
    
    // 3. Semantic Memory 검색 (장기, Temporal Decay 적용)
    const semantic = await this.semanticMemory.search(query, {
      userId,
      topK: 10,
    });
    
    // 4. Knowledge Graph 조회 (사실 + 타임라인)
    const facts = await this.knowledgeGraph.queryForContext(
      query, 
      options?.asOf
    );
    
    // 5. Multi-Signal Fusion
    return this.fuseMemoryResults({
      working,
      episodic,
      semantic: semantic.map(s => ({
        ...s,
        temporalScore: this.temporalDecay(s.lastObserved),
      })),
      facts,
    });
  }
  
  async observe(
    observation: {
      userId: string;
      sessionId: string;
      content: string;
      type: 'user_input' | 'agent_action' | 'tool_result';
      importance?: number;
    }
  ): Promise<void> {
    // 1. Working Memory 업데이트
    this.workingMemory.update(observation);
    
    // 2. Episodic Memory에 저장
    await this.episodicMemory.store({
      ...observation,
      timestamp: Date.now(),
    });
    
    // 3. 중요 정보는 Semantic Memory로 승격
    if ((observation.importance ?? 0.5) > 0.7) {
      const facts = await this.extractFacts(observation.content);
      for (const fact of facts) {
        await this.knowledgeGraph.ingest({
          ...fact,
          timestamp: Date.now(),
          source: observation.sessionId,
        });
        
        // Mem0에도 저장
        await this.semanticMemory.add(
          fact.content, 
          { user_id: observation.userId }
        );
      }
    }
  }
}
```

---

## 8. 결론: 에이전트에게 시간을 가르친다는 것

2026년, Agent Memory는 "무엇을 기억할 것인가"에서 "**언제, 어떻게 변화하는가를 이해할 것인가**"로 패러다임이 전환되고 있다.

**핵심 Takeaways:**

1. **단일 메모리 시스템으로는 부족하다.** Working → Episodic → Semantic → Procedural의 4계층 구조가 생산 등급의 기본이다.

2. **Temporal Indexing이 RAG의 다음 진화다.** 단순 벡터 유사도 검색에 Temporal Decay를 결합하면 검색 품질이 크게 향상된다. Mem0의 +29.6점 향상이 이를 증명한다.

3. **모순 해결은 선택이 아니라 필수다.** 정보는 시간에 따라 변한다. 타임라인 기반 Fact 관리와 버전 이력 보존이 모순 없는 지식 그래프의 기초다.

4. **잊는 것도 아키텍처다.** Memory Consolidation과 Staleness Detection이 없으면 검색 비용은 증가하고 품질은 하락한다.

5. **Cross-Session Identity는 아직 열린 문제다.** 행동 시그널과 에이전트의 직접 확인이 현재 최선의 접근법이다.

---

### 참고 자료

- [Mem0: State of AI Agent Memory 2026 Benchmarks](https://mem0.ai/blog/state-of-ai-agent-memory-2026) — LoCoMo 92.5, LongMemEval 94.4, BEAM 48.6(10M)
- [Red Hat: Architecting Memory for AI Agents](https://next.redhat.com/2026/06/01/from-context-to-dreams-architecting-memory-for-ai-agents/) — Agent capability = model + harness + memory + environment + evolution
- [agentmemory: Persistent Memory for Coding Agents](https://github.com/rohitg00/agentmemory) — #1 persistent memory for AI coding agents
- [Mem0 Research Paper (ECAI 2025)](https://arxiv.org/abs/2504.19413) — Ten memory approaches head-to-head on LoCoMo
- [LoCoMo Benchmark](https://github.com/snap-research/locomo) — Multi-session conversational memory evaluation
- [LongMemEval](https://github.com/xiaowu0162/longmemeval) — 500 questions across six memory categories
- [BEAM Benchmark](https://github.com/mohammadtavakoli78/BEAM) — 1M and 10M token scale memory evaluation
