---
title: "에이전트 메모리의 네 계층과 컨텍스트 관리"
date: 2026-04-11
tags:
  - AI Agents
  - Agent Architecture
  - Memory System
  - Context Management
  - RAG
  - Production AI
  - System Design
  - TypeScript
description: "작업·일화·의미·절차 기억의 역할을 나누고, 대화 사이에 문맥을 유지하기 위한 검색·보존·삭제의 균형을 설명합니다."
---

## 서론: 왜 Agent Memory인가

이전 글(2026-04-10)에서 Agent SLO와 Execution Journal를 통해 Agent의**실행 품질을 측정**하는 방법을 살펴봤다. 하지만 측정만으로는 불완전하다. Agent가**이전 대화를 기억하지 못한다**면, TCR은 아무리 높아도 사용자를 만족시키지 못한다.

인간 뇌의 기억은 단일 메커니즘이 아니다. Working memory는 현재 사고를 뒷받침하는 단기 기억이고, episodic memory는 경험의 시간순 기록이며, semantic memory는 개념과 사실의 지식 기반, procedural memory는기술과 절차의 묶음이다. AI Agent의 Memory도 마찬가지로 다층 구조가 필요하다.

## Agent Memory의 4계층 구조

```
Agent Memory Architecture
├── Working Memory          (현재 세션, LLM Context Window)
│   └── 가장 최근 N턴의 대화 + 현재 작업 상태
│
├── Episodic Memory         (과거 세션의 경험)
│   └── 세션별 주요 이벤트, 결정, 결과의 시계열 기록
│
├── Semantic Memory         (영속적 지식 베이스)
│   └── 사용자 프로파일, 선호도, 프로젝트 맥락
│
└── Procedural Memory       (행동 정책)
    └── 프롬프트 템플릿, 도구 사용 정책, SLO 규칙
```

이 구조에서 핵심 질문은 세 가지다.

1. **Working Memory가 넘칠 때** → 무엇을 episodic으로 보존할 것인가
2. **Episodic이 증가할 때** → Semantic Memory로 어떻게 압축할 것인가
3. **Semantic이 노후화할 때** → 어떻게 정렬(refresh)할 것인가

## Working Memory: Context Window의 전략적 관리

LLM의 Context Window는 유한한 자원이다. 128K 토큰이 있더라도, 모든 대화를 넣으면 최근 중요 정보가 묻힐 수 있다. Working Memory 관리의 핵심은**중요도 기반 선별(salience-based triage)** 이다.

```ts
type ConversationTurn = {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  tokens: number;
  salient: boolean;   // 사용자가 명시적으로 표시
  autoSalient: boolean; // 키워드/감정 분석으로 자동 판단
};

type WorkingMemoryConfig = {
  maxTokens: number;
 reservedRatio: number;       // 항상 유지하는 시스템 프롬프트 비율 (0.3 = 30%)
  salientBoost: number;  // salient=true 메시지의 가중치 배수
};

class WorkingMemoryManager {
  private config: WorkingMemoryConfig;
  private conversationHistory: ConversationTurn[] = [];

  constructor(config: WorkingMemoryConfig) {
    this.config = config;
  }

  addTurn(role: ConversationTurn["role"], content: string, salient = false) {
    const tokens = this.estimateTokens(content);
    this.conversationHistory.push({ role, content, timestamp: Date.now(), tokens, salient, autoSalient: false });
    this.evictIfNeeded();
  }

  getContext(): { role: ConversationTurn["role"]; content: string }[] {
    const reserved = this.getSystemPrompt();
    const reservedTokens = this.estimateTokens(reserved);
    const availableTokens = this.config.maxTokens * (1 - this.config.reservedRatio);

    const turns = this.conversationHistory
      .map((t) => ({
        ...t,
        weight: t.salient || t.autoSalient ? this.config.salientBoost : 1,
        effectiveTokens: t.tokens * (t.salient || t.autoSalient ? this.config.salientBoost : 1),
      }))
      .sort((a, b) => {
        // 중요도 가중치 × 시간 신선도(time decay)
        const freshnessA = this.timeDecay(a.timestamp);
        const freshnessB = this.timeDecay(b.timestamp);
        return b.weight * freshnessB - a.weight * freshnessA;
      });

    let used = reservedTokens;
    const selected: ConversationTurn[] = [];

    for (const turn of turns) {
      if (used + turn.tokens <= availableTokens) {
        selected.push(turn);
        used += turn.tokens;
      } else {
        break;
      }
    }

    // 시간순 정렬 후 반환
    return [
      { role: "system", content: reserved },
      ...selected.sort((a, b) => a.timestamp - b.timestamp),
    ];
  }

  private timeDecay(timestamp: number): number {
    const hoursAgo = (Date.now() - timestamp) / (1000 * 60 * 60);
    return Math.exp(-hoursAgo / 24); // 24시간 반감기
  }

  private evictIfNeeded() {
    // Eviction은 getContext() 호출 시lazy하게 처리
  }

  private estimateTokens(text: string): number {
    // Approximate: 한글 기준 2자 ≈ 1토큰
    return Math.ceil(text.length / 2);
  }

  private getSystemPrompt(): string {
    return "You are a helpful AI assistant. Keep responses concise and context-aware.";
  }
}
```

이 구조의 핵심 설계 의도는 두 가지다.

- **중요도 가중치**: 중요하다고 표시된 메시지는 시간과 관계없이 우선 보존
- **시간에 따른 감쇠**: 오래된 메시지일수록 중요도가 점진적으로 낮아져 결국 제거된다

## Episodic Memory: 세션 경험을시간순 기록으로 변환

Working Memory는 세션이 끝나면 사라진다.Episodic Memory는 이를**세션 단위 경험 record**로 저장한다. 개념적으로 인간의일화 기억에 해당한다.

```ts
type EpisodeSummary = {
  sessionId: string;
  userId: string;
  startedAt: number;
  endedAt: number;
  turnCount: number;

  // 핵심 정보만 추출한 요약
  coreTopics: string[];         // ["API 설계", "성능 최적화"]
  keyDecisions: string[];       // ["Redis 캐싱 도입", "DB sharding 결정"]
  unresolvedTopics: string[];   // ["OAuth 연동 미완료"]
  
  // 메트릭
  satisfactionScore?: number;   // 사용자가 별점 or thumb으로 평가
  escalationCount: number;
  totalTokensUsed: number;

  // 원본 참조 (Full transcript는 별도 스토어)
  rawTranscriptRef: string;     // S3, GCS 등 durable storage 경로
};

class EpisodicMemoryStore {
  private store: /* Vector DB + KV store */ unknown;

  async saveEpisode(episode: EpisodeSummary): Promise<void> {
    // 1. 요약 자체를 저장 (KV)
    await this.store.put(`episode:${episode.sessionId}`, episode);

    // 2. 핵심 주제를 벡터화하여 검색 가능하게 (Vector DB)
    for (const topic of episode.coreTopics) {
      await this.store.upsertVector({
        id: `episode:${episode.sessionId}:topic:${topic}`,
        vector: await this.embed(topic),
        payload: {
          sessionId: episode.sessionId,
          topic,
          timestamp: episode.endedAt,
        },
      });
    }

    // 3. unresolved topics → 다음 세션의agenda로 자동 등록
    for (const topic of episode.unresolvedTopics) {
      await this.scheduleFollowUp(topic, episode.userId);
    }
  }

  async retrieveRelevantEpisodes(
    userId: string,
    query: string,
    opts: { maxAgeDays?: number; limit?: number } = {}
  ): Promise<EpisodeSummary[]> {
    const queryVector = await this.embed(query);
    const minTimestamp = opts.maxAgeDays
      ? Date.now() - opts.maxAgeDays * 24 * 60 * 60 * 1000
      : 0;

    const results = await this.store.similaritySearch({
      vector: queryVector,
      filter: { userId, minTimestamp },
      limit: opts.limit ?? 5,
    });

    return this.store.getMultiple(results.map((r) => r.payload.sessionId));
  }
}
```

Episodic Memory의 핵심 가치: **다음 세션에서 이전 결정과 맥락을 즉시 참조**할 수 있다. "이전 대화에서 Redis 캐싱 도입으로 결정했죠?"라는 문장이 가능해진다.

## Semantic Memory: 사용자 프로파일의 영속적 저장소

Episodic가 경험의시간순 기록이라면, Semantic Memory는**지식의 구조화된 조직**이다. 사용자 프로파일, 선호도, 프로젝트별 맥락이 여기 해당한다.

```ts
type UserProfile = {
  userId: string;
  name: string;
  timezone: string;
  preferredLanguage: "ko" | "en" | "mixed";
  
  // 기술 스택 (SK Interview 준비 수준 등)
  technicalLevel: {
    systemDesign: "beginner" | "intermediate" | "advanced";
    backend: string[];
    frontend: string[];
    infrastructure: string[];
  };

  // 작업 스타일
  workStyle: {
    responseVerbosity: "concise" | "balanced" | "detailed";
    codeStyle: "functional" | "oop" | "flexible";
    prefersExamples: boolean;
  };

  // 현재 프로젝트 맥락
  activeProjects: {
    name: string;
    role: string;
    techStack: string[];
    currentGoals: string[];
    blockers: string[];
  }[];

  // 기억할 사실들
  facts: { key: string; value: string; updatedAt: number }[];

  // 제외할 사항 (선호하지 않는 항목)
  dislikes: string[];
};

class SemanticMemoryManager {
  private store: /* durable KV store */ unknown;
  private profileCache = new Map<string, { profile: UserProfile; loadedAt: number }>();

  async getProfile(userId: string): Promise<UserProfile | null> {
    // 60초 TTL cache
    const cached = this.profileCache.get(userId);
    if (cached && Date.now() - cached.loadedAt < 60_000) {
      return cached.profile;
    }

    const profile = await this.store.get(`profile:${userId}`);
    if (profile) {
      this.profileCache.set(userId, { profile, loadedAt: Date.now() });
    }
    return profile;
  }

  async updateProfile(userId: string, patch: Partial<UserProfile>): Promise<void> {
    const current = await this.getProfile(userId);
    const updated = { ...current, ...patch };
    await this.store.put(`profile:${userId}`, updated);
    this.profileCache.delete(userId); // cache inval
  }

  async mergeFromEpisode(userId: string, episode: EpisodeSummary): Promise<void> {
    //Episodic에서Semantic으로 정보 압축
    const profile = (await this.getProfile(userId)) ?? this.emptyProfile(userId);

    // Topic → 기술 스택 자동 업데이트
    for (const topic of episode.coreTopics) {
      this.inferAndMergeTechStack(profile, topic);
    }

    // 만족도 점수 → 선호도 추론
    if (episode.satisfactionScore !== undefined) {
      this.updatePreferenceFromScore(profile, episode);
    }

    await this.updateProfile(userId, profile);
  }

  private inferAndMergeTechStack(profile: UserProfile, topic: string) {
    const techKeywords: Record<string, keyof UserProfile["technicalLevel"]> = {
      "API": "backend",
      "Redis": "backend",
      "Database": "backend",
      "React": "frontend",
      "Next.js": "frontend",
      "AWS": "infrastructure",
      "Kubernetes": "infrastructure",
    };

    for (const [keyword, category] of Object.entries(techKeywords)) {
      if (topic.includes(keyword) && !profile.technicalLevel[category].includes(keyword)) {
        profile.technicalLevel[category].push(keyword);
      }
    }
  }

  private emptyProfile(userId: string): UserProfile {
    return {
      userId,
      name: "",
      timezone: "Asia/Seoul",
      preferredLanguage: "mixed",
      technicalLevel: { systemDesign: "intermediate", backend: [], frontend: [], infrastructure: [] },
      workStyle: { responseVerbosity: "balanced", codeStyle: "flexible", prefersExamples: true },
      activeProjects: [],
      facts: [],
      dislikes: [],
    };
  }
}
```

Semantic Memory는**서비스 초기에cold start**가 걸리지만, 시간이 갈수록 Agent가 해당 사용자에게**맞춤형으로 작동**하게 된다.

## Procedural Memory: 행동 정책의 버전 관리

지금까지의 Memory는**데이터**였다.Procedural Memory는**정책(policy)** 이다. 프롬프트 템플릿, 도구 사용 규칙, SLO 임계값 등이 해당한다.

```ts
type AgentPolicy = {
  version: string;
  activePrompt: {
    systemPrompt: string;
    toolDescriptions: string[];
    responseFormat: "markdown" | "json" | "plain";
  };
  sloConfig: {
    taskCompletionRate: { target: number; alertBelow: number };
    escalationRate: { alertAbove: number };
  };
  memoryConfig: WorkingMemoryConfig;
};

class ProceduralMemoryManager {
  private store: /* git-like versioned store */ unknown;

  async getActivePolicy(agentId: string): Promise<AgentPolicy> {
    return await this.store.getCurrent(`policy:${agentId}`);
  }

  async updatePolicy(agentId: string, patch: Partial<AgentPolicy>): Promise<void> {
    const current = await this.getActivePolicy(agentId);
    const newVersion = incrementPatch(current.version); // e.g. "1.2.3" → "1.2.4"

    await this.store.put(`policy:${agentId}:v:${newVersion}`, {
      ...current,
      ...patch,
      version: newVersion,
    });

    await this.store.setCurrent(`policy:${agentId}`, newVersion);
  }

  async rollback(agentId: string, targetVersion: string): Promise<void> {
    const policy = await this.store.get(`policy:${agentId}:v:${targetVersion}`);
    if (!policy) throw new Error(`Version ${targetVersion} not found`);

    await this.store.put(`policy:${agentId}:v:${targetVersion}:rollback-${Date.now()}`, policy); // 롤백 이력
    await this.store.setCurrent(`policy:${agentId}`, targetVersion);
  }

  async diffVersions(agentId: string, v1: string, v2: string): Promise<string> {
    const p1 = await this.store.get(`policy:${agentId}:v:${v1}`);
    const p2 = await this.store.get(`policy:${agentId}:v:${v2}`);
    return this.computeDiff(p1, p2);
  }
}
```

Procedural Memory의 핵심: 모든 정책 변경이**버전 관리**되고, 롤백이 가능한 것이다. "왜 이 프롬프트를 이렇게 바꿨을까?"라는 질문에 답을 찾을 수 있다.

## Memory 간 상호작용: Forget의 과학

Memory 시스템의 가장 어려운 문제는**무엇을 잊을 것인가**이다. 모든 것을 기억하면 비용이 너무 높아지고, 너무 적게 기억하면 문맥이 단절된다.

```ts
type MemoryHealthScore = {
  workingMemoryUtilization: number;  // 0.8 이상이면 경고
  episodicStaleness: number;         // 너무 오래된 Episode 비율
  semanticOutdatedness: number;      // 마지막 업데이트로부터 경과 시간
  totalMemorySizeMb: number;
};

async function runMemoryGC(
  userId: string,
  config: { maxEpisodicAgeDays: number; maxSemanticAgeDays: number; maxTotalGb: number }
): Promise<{ evictedEpisodes: number; updatedSemantic: number; reclaimedMb: number }> {
  const result = { evictedEpisodes: 0, updatedSemantic: 0, reclaimedMb: 0 };

  // 1. 오래된 Episodic Memory evict
  const oldEpisodes = await episodicStore.query({
    userId,
    olderThan: config.maxEpisodicAgeDays,
    hasUnresolved: false,  // 미해결 이슈가 있으면 보존
  });

  for (const episode of oldEpisodes) {
    // 중요 결정이 있으면 Semantic Memory로 먼저 압축
    if (episode.keyDecisions.length > 0) {
      await semanticMemory.mergeFromEpisode(userId, episode);
      result.updatedSemantic++;
    }
    await episodicStore.delete(episode.sessionId);
    result.evictedEpisodes++;
    result.reclaimedMb += estimateEpisodeSize(episode);
  }

  // 2. 노후화된 Semantic Memory check
  const profile = await semanticMemory.getProfile(userId);
  const outdatedFacts = profile.facts.filter(
    (f) => Date.now() - f.updatedAt > config.maxSemanticAgeDays * 24 * 60 * 60 * 1000
  );

  // Outdated facts에 대해 사용자에게 확인 질의
  if (outdatedFacts.length > 0) {
    await scheduleMemoryRefreshPrompt(userId, outdatedFacts);
  }

  return result;
}
```

**GC의 핵심 원칙**: evict할 때 단순 삭제하지 않고, 중요한 정보는 Semantic Memory로**승격(promotion)** 한다. 이것이 filing cabinet 방식이다 — working desk에서 오래된 서류를 archives로 이동하지만, 완전히 버리지는 않는다.

## Memory 검색: Context Window에 넣을 때 품질 결정하기

Context Window에 어떤 memory를 넣을지 결정하는**검색 품질**이 Agent 응답 품질을 좌우한다.

```ts
async function buildSessionContext(
  userId: string,
  currentQuery: string,
  config: { maxContextTokens: number }
): Promise<{ working: ConversationTurn[]; semantic: object; episodic: EpisodeSummary[] }> {
  // 1. Semantic Memory: 현재 query와 관련된 사용자 프로파일 검색
  const relevantProfile = await semanticMemory.getProfile(userId);

  // 2. Episodic Memory: query와 관련된 과거 세션 검색
  const relevantEpisodes = await episodicMemory.retrieveRelevantEpisodes(
    userId,
    currentQuery,
    { maxAgeDays: 90, limit: 3 }
  );

  // 3. Working Memory: 최근 대화 (기존 로직)
  const workingMemory = workingMemoryManager.getContext();

  // 4. 크기 예측 및 트리밍
  const semanticText = JSON.stringify(relevantProfile);
  const episodicText = relevantEpisodes.map((e) => e.coreTopics.join(", ")).join(" | ");
  const totalEstimate =
    estimateTokens(workingMemory) +
    estimateTokens(semanticText) +
    estimateTokens(episodicText);

  if (totalEstimate > config.maxContextTokens) {
    // Semantic → episodic 순으로 우선순위
    const trimmed = trimContextToTokenBudget(workingMemory, semanticText, episodicText, config.maxContextTokens);
    return trimmed;
  }

  return { working: workingMemory, semantic: relevantProfile, episodic: relevantEpisodes };
}
```

이 과정이 매 세션 시작 시 자동으로 실행되어야 한다. 수동으로 memory를 관리하는 것은 scalability가 전혀 없다.

## Memory System을 만드는 팀 체크리스트

- [ ] Working Memory에 중요도 기반 선별 알고리즘이 구현되어 있는가?
- [ ] Session 종료 시 Episodic Memory로 자동 저장되는가?
- [ ] Episodic Memory에서 unresolved topics가 다음 세션 agenda로 등록되는가?
- [ ] Semantic Memory가 Episodic에서 자동으로 업데이트되는가?
- [ ] Procedural Memory가 버전 관리되고 롤백 가능한가?
- [ ] Memory GC가 주기적으로 실행되어 오래된 데이터가 evict되는가?
- [ ] Memory 검색 결과가 session 시작 시 자동으로 context에 포함되는가?
- [ ] Memory staleness가 SLO dashboard에 표시되는가?

## 결론

Memory 설계는 Agent를**범용 도구**에서**개인화된 파트너**로 만드는 핵심 요소다. 4계층 구조는 단순한 추상화가 아니라 실제 구현 시마다 마주하는 문제들이다.

- Working Memory: 현재 세션의 attention 관리
- Episodic Memory: 경험의시간순 기록과 검색
- Semantic Memory: 사용자 지식의 구조화된 조직
- Procedural Memory: 정책의 버전 관리

이 네 가지를 갖추면 Agent는 대화 초기에 사용자의 이름, 기술 수준, 작업 스타일을 파악하고, 대화 중에는 맥락을 유지하며, 대화 종료 후에는 결정과 문제를 기록하여**다음 만남에서 기억**한다.

메모리는 에이전트의 연속성을 뒷받침한다. 이전 맥락을 기억하지 못하면 모델의 성능이 높아도 사용자와 신뢰를 쌓기 어렵다.

---
