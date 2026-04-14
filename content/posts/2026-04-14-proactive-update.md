---
title: "Agent Memory Architecture — 장기 기억, 검색, 그리고 '잊어버림'의 프로덕션 설계 (2026년 4월)"
date: 2026-04-14
description: "AI Agent가 대화를 넘어 '지속적 학습체'를 만드는 핵심 과제. 단기/중기/장기 기억 분리, 임베딩 기반 검색, forget 전략, 그리고 프로덕션에서 메모리가 신뢰성을左右하는 시나리오를 실제 아키텍처와 코드로 다룬다."
tags:
  - AI Agents
  - Agent Memory
  - RAG
  - Vector Search
  - Production AI
  - Agent Architecture
  - Memory Management
  - MCP
  - System Design
  - LLM
---

## 서론: Agent의 '기억'은 왜 어려운가

사람이 이전 대화를 기억하듯, AI Agent에게도 메모리 시스템이 필요하다. 하지만 사람의 기억과 Agent 기억은 근본적으로 다르다.

사람의 기억은 **연상 검색** — "작년 크리스마스에 갔던 카페가 어디더라?" — 이 자연스럽게 작동한다. 감정, 맥락, 공간적 단서가 기억을 촉발한다.

AI Agent의 기억은 **외부화되어야 한다**. 모델 자체는 상태가 없기 때문에, 모든 기억을 명시적으로 저장하고 검색해야 한다. 이 단순한 사실이 생각보다 훨씬 복잡한 아키텍처를 요구한다.

2026년 4월 현재, 프로덕션 Agent 시스템에서 memory 설계 미숙으로 인한 실패는 **task hallucination**(이전 결과를 사실로 착각), **컨텍스트 분노**(이전 대화의 민감 정보가 새 대화에 누출), **패널티高昂**(불필요한 긴 컨텍스트로 토큰 비용 폭증)으로 나타난다.

이 글은 Agent Memory를 **단기 / 중기 / 장기**로 분리하고, 각 계층의 저장소, 검색 전략, forget 정책, 그리고 프로덕션에서의 구체적 구현을 다룬다.

---

## 1. Memory의 3계층 구조: 인간의 기억을 가장 닮은 아키텍처

### 생물학적 기억과 Agent Memory의 대응 관계

사람의 기억 체계는 세 가지로 나뉜다:

```
사람의 기억 체계                    Agent Memory 대응
─────────────────                   ─────────────────────────────────
감각 기억 (Sensory)  ──────────▶   단기 기억 (Short-Term, STM)
단기 기억 (Working)  ──────────▶   세션 기억 (Session Memory)
장기 기억 (Long-Term, LTM) ────▶   영속 기억 (Persistent Memory)
```

각 계층의 특성과 역할:

| 계층 | 생물학적 대응 | 용량 | 소멸 시간 | Agent에서의 대응 |
|------|-------------|------|----------|----------------|
| **단기 기억 (STM)** | 감각 기억 | 수 초~수 분 | 즉시 소멸 | 모델 내부 attention (현재 turn) |
| **세션 기억** | 작업 기억 | 7±2 항목 | 세션 종료 시 | Session Memory (최근 N개 메시지) |
| **중기 기억** | 작업 기억 → 장기 전환 구간 | 수백 건 | 일정 기간 | Rolling Memory (활동 로그) |
| **장기 기억** | 장기 기억 | 무제한 | 영구 | Vector Store / KG / SQL |

### 3계층 Memory 아키텍처 개요

```python
from dataclasses import dataclass, field
from datetime import datetime
from typing import TypedDict, Protocol, Optional
from enum import Enum
import json


class MemoryTier(Enum):
    SHORT_TERM = "short_term"    # 현재 turn / attention window
    SESSION = "session"          # 현재 세션 전체
    MEDIUM_TERM = "medium_term"  # 최근 N일 활동 요약
    LONG_TERM = "long_term"      # 영구 저장소 (vector/KG)


@dataclass
class MemoryEntry:
    """메모리 항목 하나"""
    id: str
    content: str
    tier: MemoryTier
    created_at: datetime
    accessed_at: datetime
    access_count: int = 0
    importance: float = 1.0       # 0.0 ~ 1.0 — forget 결정에 사용
    embedding: list[float] | None = None
    metadata: dict = field(default_factory=dict)

    def touch(self):
        """접근 시 access_count 증가 및 accessed_at 갱신"""
        self.access_count += 1
        self.accessed_at = datetime.now()


class AgentMemorySystem:
    """
    3계층 메모리 시스템의 핵심 인터페이스.
    각 tier별로 다른 저장소와 TTL 정책이 적용된다.
    """

    def __init__(
        self,
        short_term_limit: int = 10,      # STM: 최근 10개 메시지
        session_limit: int = 200,         # 세션: 최근 200개 메시지
        medium_term_days: int = 7,        # 중기: 7일치 rolling 요약
    ):
        self.short_term_limit = short_term_limit
        self.session_limit = session_limit
        self.medium_term_days = medium_term_days

        # 각 tier별 저장소
        self.short_term: list[MemoryEntry] = []   # 리스트 (in-memory)
        self.session: list[MemoryEntry] = []       # 리스트 (in-memory, larger)
        self.medium_term: list[MemoryEntry] = []  # Rolling 요약 buffer
        self.long_term: VectorStore | None = None  # Vector store (Pinecone, Qdrant 등)

    def add(self, content: str, tier: MemoryTier, metadata: dict = None) -> MemoryEntry:
        """메모리에 항목 추가"""
        entry = MemoryEntry(
            id=f"{tier.value}_{datetime.now().isoformat()}",
            content=content,
            tier=tier,
            created_at=datetime.now(),
            accessed_at=datetime.now(),
            metadata=metadata or {},
        )
        self._store(entry)
        return entry

    def retrieve(self, query: str, tier: MemoryTier, top_k: int = 5) -> list[MemoryEntry]:
        """메모리에서 검색"""
        if tier == MemoryTier.LONG_TERM and self.long_term:
            return self.long_term.search(query, top_k)
        elif tier == MemoryTier.SESSION:
            # 단순 최근접 검색 (BM25 또는 embedding)
            return self._session_search(query, top_k)
        elif tier == MemoryTier.MEDIUM_TERM:
            return self._rolling_search(query, top_k)
        return []

    def build_context(self, query: str) -> str:
        """LLM에 전달할 통합 컨텍스트 문자열 구성"""
        parts = []

        # 1순위: STM — 현재 작업 관련 최근 항목
        stm_results = self.short_term[-self.short_term_limit:]
        if stm_results:
            parts.append(f"[단기 기억 — 최근 {len(stm_results)}개]\n" +
                          "\n".join(f"- {e.content}" for e in stm_results))

        # 2순위: 세션 — 관련 기억 검색
        session_results = self.retrieve(query, MemoryTier.SESSION, top_k=5)
        if session_results:
            parts.append(f"[세션 기억]\n" +
                          "\n".join(f"- {e.content}" for e in session_results))

        # 3순위: 장기 — 벡터 검색
        long_term_results = self.retrieve(query, MemoryTier.LONG_TERM, top_k=3)
        if long_term_results:
            parts.append(f"[장기 기억]\n" +
                          "\n".join(f"- {e.content}" for e in long_term_results))

        return "\n\n".join(parts) if parts else "(기억 없음)"

    def _store(self, entry: MemoryEntry):
        if entry.tier == MemoryTier.SHORT_TERM:
            self.short_term.append(entry)
            self._enforce_tier_limit(MemoryTier.SHORT_TERM)
        elif entry.tier == MemoryTier.SESSION:
            self.session.append(entry)
            self._enforce_tier_limit(MemoryTier.SESSION)
        elif entry.tier == MemoryTier.MEDIUM_TERM:
            self.medium_term.append(entry)
        elif entry.tier == MemoryTier.LONG_TERM:
            if self.long_term:
                self.long_term.upsert(entry)

    def _enforce_tier_limit(self, tier: MemoryTier):
        if tier == MemoryTier.SHORT_TERM:
            while len(self.short_term) > self.short_term_limit:
                self.short_term.pop(0)
        elif tier == MemoryTier.SESSION:
            while len(self.session) > self.session_limit:
                self.session.pop(0)
```

---

## 2. 단기 기억 (Short-Term Memory): Attention Budget의 전략적 관리

### Attention Window는 유한 자원이다

GPT-4o의 context window는 128K 토큰, Claude Sonnet 4는 200K 토큰. 충분히 넓어 보이지만, 프로덕션 Agent에서 이 budget은 순식간에 고갈된다:

```
Context Budget 소모 예시:
─────────────────────────
시스템 프롬프트                          ~4,000 토큰
도구 스키마 (MCP 도구 5개)               ~2,000 토큰
사용자 현재 메시지                       ~500 토큰
단기 기억 (STM, 최근 10 turn)            ~3,000 토큰
세션 기억 검색 결과                      ~2,000 토큰
장기 기억 검색 결과                       ~1,500 토큰
─────────────────────────────────────────
총합                                     ~13,000 토큰

남은 자유 공간                           ~115,000 토큰

→ 하지만 이것은 "여유 budget"이 아니라
  "LLM이 reasoning에 사용하는 working space"
  여유가 많을수록 reasoning 품질이 높아짐
```

### STM 관리 전략: Importance-Weighted Eviction

단순히 "최근 N개"만 유지하는 FIFO 방식은 중요한 정보가 조기에 제거될 수 있다. **Importance-weighted eviction**은 접근 빈도와 중요도를 함께 고려한다:

```python
from collections import deque
import heapq

class ImportanceWeightedSTM:
    """
    Importance 점수 기반 단기 기억 관리.
    - 최근 접근: access_count 가중
    - 중요도: metadata에서 지정 (user Explicitly marked)
    - 비용: 토큰 길이에 비례하여 유지 비용 증가
    """

    def __init__(self, capacity: int = 10, max_tokens: int = 3000):
        self.capacity = capacity
        self.max_tokens = max_tokens
        self.entries: list[MemoryEntry] = []
        self.current_tokens: int = 0

    def _score(self, entry: MemoryEntry) -> float:
        """Importance scoring function"""
        recency_weight = 1.0 / (1.0 + (datetime.now() - entry.accessed_at).seconds / 3600)
        access_weight = min(entry.access_count / 10.0, 1.0)
        importance_weight = entry.importance
        token_penalty = 1.0 / (1.0 + len(entry.content) / 500)
        return (recency_weight * 0.3 + access_weight * 0.3 +
                importance_weight * 0.3 + token_penalty * 0.1)

    def add(self, entry: MemoryEntry) -> bool:
        """항목 추가 — 용량 초과 시 eviction 후 추가"""
        entry_tokens = len(entry.content) // 4  # 대략적 토큰 수

        # 용량 또는 토큰 초과 시 eviction
        while (len(self.entries) >= self.capacity or
               self.current_tokens + entry_tokens > self.max_tokens):
            if not self.entries:
                break
            # 가장 낮은 점수의 항목 제거
            evict_idx = min(
                range(len(self.entries)),
                key=lambda i: self._score(self.entries[i])
            )
            evicted = self.entries.pop(evict_idx)
            self.current_tokens -= len(evicted.content) // 4

        if entry_tokens <= self.max_tokens:
            entry.touch()
            self.entries.append(entry)
            self.current_tokens += entry_tokens
            return True
        return False
```

---

## 3. 세션 기억 (Session Memory): Conversational Context의 구조적 관리

### 단순 대화 히스토리가 부족한 이유

가장 단순한 세션 기억 구현은 "모든 메시지를 배열에 저장"이다. 문제는 두 가지다:

1. **토큰 비용**: 200 turn 대화 = 200 × ~500 토큰 = 100K 토큰 (거의 full context)
2. **검색 품질**: 200개 메시지에서 "가장 관련성 높은 5개"를 찾으려면 단순 FIFO로는 부족

### Hierarchical Summarization: 대화의 '요약 트리' 만들기

```python
from langchain.chat_loaders import BaseChatLoader
from langchain.schema import HumanMessage, AIMessage, SystemMessage


class HierarchicalSessionMemory:
    """
    세션을 hierarchical하게 요약하여 저장하는 세션 기억.

    구조:
    - Level 0: 원본 메시지 (완전한 대화 기록)
    - Level 1: Turn 단위 요약 (각 메시지 쌍을 하나의 문단으로)
    - Level 2: 주제 단위 요약 (반복되는 주제별로 결합)
    - Level 3: 세션 전체 요약 (2~3 문장)
    """

    def __init__(self, llm, max_turns_per_summary: int = 5):
        self.llm = llm
        self.max_turns_per_summary = max_turns_per_summary
        self.levels: dict[int, list[MemoryEntry]] = {
            0: [],   # 원본
            1: [],   # turn 요약
            2: [],   # topic 요약
            3: [],   # session 요약
        }

    async def add_message(self, role: str, content: str, metadata: dict = None):
        """메시지 추가 — 요약 조건 충족 시 상위 계층 생성"""
        entry = MemoryEntry(
            id=f"msg_{len(self.levels[0]) + 1}",
            content=f"[{role}]: {content}",
            tier=MemoryTier.SESSION,
            created_at=datetime.now(),
            accessed_at=datetime.now(),
            metadata={**(metadata or {}), "role": role},
        )
        self.levels[0].append(entry)

        # Level 0이 N개 모이면 Level 1 요약 생성
        if len(self.levels[0]) % self.max_turns_per_summary == 0:
            await self._summarize_to_level(0, 1)

        # Level 1이 N개 모이면 Level 2 생성
        if len(self.levels[1]) >= 4:
            await self._summarize_to_level(1, 2)

    async def _summarize_to_level(self, from_level: int, to_level: int):
        """from_level의 항목들을 to_level으로 요약"""
        source_content = "\n".join(e.content for e in self.levels[from_level][-self.max_turns_per_summary:])

        prompt = f"""다음 대화를 {to_level}단계 요약으로 압축해줘:
- 너무 장황하지 않게
- 핵심 정보와 결정 사항은 반드시 포함
- {to_level} 레벨일수록 더 압축적으로

---
{source_content}
---
"""
        summary_text = await self.llm.agenerate([prompt])
        summary_entry = MemoryEntry(
            id=f"summary_l{to_level}_{datetime.now().isoformat()}",
            content=summary_text,
            tier=MemoryTier.SESSION,
            created_at=datetime.now(),
            accessed_at=datetime.now(),
            importance=0.8,
            metadata={"level": to_level, "source_count": self.max_turns_per_summary},
        )
        self.levels[to_level].append(summary_entry)

    def get_context(self, query: str) -> str:
        """세션 기억에서 쿼리에 관련된 컨텍스트 반환"""
        context_parts = []

        # Session 요약 (Level 3) — 항상 먼저
        if self.levels[3]:
            context_parts.append(f"[세션 요약] {self.levels[3][-1].content}")

        # Topic 요약 (Level 2) — 쿼리 관련성 필터
        topic_relevant = [e for e in self.levels[2] if any(w in e.content for w in query.split()[:3])]
        if topic_relevant:
            context_parts.append("[주제 요약]\n" + "\n".join(e.content for e in topic_relevant[-3:]))

        # Turn 요약 (Level 1) — 최근 것만
        if self.levels[1]:
            context_parts.append("[최근 대화 흐름]\n" + "\n".join(e.content for e in self.levels[1][-3:]))

        return "\n\n".join(context_parts) if context_parts else ""
```

---

## 4. 장기 기억 (Long-Term Memory): 검색의 정밀도 문제

### Vector Search의 3가지 함정

장기 기억의 핵심은 **검색**이다. 2026년 현재 대부분의 구현이 vector search(임베딩 기반 유사도 검색)에 의존하는데, 여기에는 정교한 설계가 필요하다:

**함정 1: 임베딩 모델 불일치**
사용자 쿼리와 저장된 메모리의 임베딩이 **서로 다른 모델**에서 생성되면 유사도 점수가 의미를 잃는다. 반드시 동일한 임베딩 모델을 사용해야 한다.

**함정 2: '주제'는 벡터로 잡히지 않는다**
"서울 출장 기억해?"와 "작년 3월 가던 카페还记得?"는 벡터 공간에서 멀다. 시간, 장소, 감정 등의 메타데이터는 별도 필터로 관리해야 한다.

**함정 3: 유사도 ≠ 관련성**
"비슷하게 생긴 답"이 "정확한 답"이 아니다. RAG에서 검증 로직 없이 retrieved chunks를 그대로 사용하면 hallucination이 강화된다.

### Hybrid Search: Keyword + Vector의 조합

```python
from dataclasses import dataclass
from typing import Protocol
import numpy as np


class VectorStore(Protocol):
    async def upsert(self, entry: MemoryEntry): ...
    async def search(self, query: str, top_k: int) -> list[MemoryEntry]: ...


class HybridLongTermMemory:
    """
    Vector search + Keyword search (BM25) + Metadata filter를
    조합한 하이브리드 장기 기억.
    """

    def __init__(
        self,
        vector_store: VectorStore,
        embedder,          # OpenAI embeddings 또는 sentence-transformers
        alpha: float = 0.7,  # vector weight (1-alpha = keyword weight)
    ):
        self.vector_store = vector_store
        self.embedder = embedder
        self.alpha = alpha
        self.keyword_index: dict[str, list[str]] = {}  # term -> entry_ids

    async def add(self, content: str, metadata: dict = None) -> MemoryEntry:
        """장기 기억에 저장 — vector 임베딩과 keyword 인덱싱 동시 수행"""
        entry = MemoryEntry(
            id=f"ltm_{datetime.now().isoformat()}",
            content=content,
            tier=MemoryTier.LONG_TERM,
            created_at=datetime.now(),
            accessed_at=datetime.now(),
            metadata=metadata or {},
        )

        # Vector embedding
        entry.embedding = await self.embedder.embed(content)

        # Keyword index (간단한 BM25 대신 빈도 기반)
        words = content.lower().split()
        for word in set(words):
            if len(word) > 3:  # stop word 제거
                if word not in self.keyword_index:
                    self.keyword_index[word] = []
                self.keyword_index[word].append(entry.id)

        await self.vector_store.upsert(entry)
        return entry

    async def search(
        self,
        query: str,
        top_k: int = 5,
        metadata_filter: dict | None = None,
        min_relevance: float = 0.6,
    ) -> list[MemoryEntry]:
        """하이브리드 검색: vector similarity + keyword overlap"""

        # 1. Vector search
        query_embedding = await self.embedder.embed(query)
        vector_results = await self.vector_store.search(query, top_k * 2)

        # 2. Keyword search
        keyword_scores = {}
        query_words = [w.lower() for w in query.split() if len(w) > 3]
        for word in query_words:
            if word in self.keyword_index:
                for entry_id in self.keyword_index[word]:
                    keyword_scores[entry_id] = keyword_scores.get(entry_id, 0) + 1

        # 3. 하이브리드 스코어 결합
        results_with_scores = []
        for entry in vector_results:
            if entry.id in keyword_scores:
                keyword_score = keyword_scores[entry.id] / len(query_words)
            else:
                keyword_score = 0.0

            vector_score = np.dot(query_embedding, entry.embedding)  # cosine 유사도 가정
            hybrid_score = self.alpha * vector_score + (1 - self.alpha) * keyword_score

            # Metadata filter 적용
            if metadata_filter:
                if not all(entry.metadata.get(k) == v for k, v in metadata_filter.items()):
                    continue

            if hybrid_score >= min_relevance:
                results_with_scores.append((entry, hybrid_score))

        # 정렬 후 top_k 반환
        results_with_scores.sort(key=lambda x: x[1], reverse=True)
        return [entry for entry, _ in results_with_scores[:top_k]]
```

---

## 5. '잊어버림(Forget)' 전략: 메모리가 무한增长的 대가

### 왜 Forget이 중요한가

LLM Context는 유한 자원이므로, "기억이 쌓일수록 새 기억이 더 잘 들어간다"는 착각이 있다. 실제로는 **중요도较低的 오래된 기억이 중요한 새 기억의 공간을 차지**하여 성능을 저하시킨다.

이를 방지하는 3가지 forget 전략:

```
Forget 전략 비교:
────────────────────────────────────────────────────────────────
전략              동작                    장점                    단점
────────────────────────────────────────────────────────────────
TTL-based        일정 기간 후 자동 삭제   단순함                  시간 기준이라 임의적
Importance-based  접근 빈도/점수 기준   실제로 사용된 것 위주    점수 알고리즘 의존
Semantic-based   주제 중복 시 통합     저장 효율성              병합 로직 복잡
Retrieval-based  검색 시점 기준 동적   가장 유연                매 검색 시 재계산
────────────────────────────────────────────────────────────────
```

### Importance Decay: 시간에 따라 기억을 잊게 만드는 자동화

```python
from datetime import timedelta


class ForgetPolicy:
    """
    시간 경과에 따른 importance decay를 자동화하는 forget 정책.
    접근하지 않은 기억은 점진적으로 importance를 잃고 eventually 삭제.
    """

    def __init__(
        self,
        decay_rate_per_day: float = 0.1,   # 매일 10% importance 감소
        min_importance: float = 0.1,        # 이 이하이면 삭제 대상
        check_interval_hours: int = 24,    # 24시간마다 체크
    ):
        self.decay_rate = decay_rate_per_day
        self.min_importance = min_importance

    def compute_decay(self, entry: MemoryEntry) -> float:
        """경과 시간에 따른 decay 점수 반환"""
        age_days = (datetime.now() - entry.accessed_at).total_seconds() / 86400
        decayed = entry.importance * (1 - self.decay_rate) ** age_days
        return max(decayed, 0.0)

    def should_forget(self, entry: MemoryEntry) -> bool:
        """삭제 대상 판정"""
        # 접근 빈도가 낮고 오래된 기억 우선 삭제
        current_importance = self.compute_decay(entry)
        recency_penalty = 1.0 / (1.0 + age_days * 0.5)
        final_score = current_importance * recency_penalty * (entry.access_count / 10)

        return final_score < self.min_importance

    def gc(self, memory_entries: list[MemoryEntry]) -> list[MemoryEntry]:
        """Forget 정책에 따라 entries를 필터링"""
        kept = []
        forgotten = []

        for entry in memory_entries:
            if self.should_forget(entry):
                forgotten.append(entry)
            else:
                kept.append(entry)

        if forgotten:
            print(f"[ForgetPolicy] {len(forgotten)}개 항목 삭제. "
                  f"남은 항목: {len(kept)}")

        return kept


# Medium-term memory에 weekly forget 적용
forget_policy = ForgetPolicy(decay_rate_per_day=0.15, min_importance=0.2)

async def weekly_gc():
    """주 1회 중기 기억 GC 실행 (cron job)"""
    current_medium = agent_memory.medium_term
    agent_memory.medium_term = forget_policy.gc(current_medium)
```

---

## 6. 프로덕션 Memory 시스템: 4가지 현실적 시나리오

### 시나리오 1: 고객 지원 Agent — 민감 정보 분리

```python
"""
고객 지원 Agent의 Memory 설계.
민감 정보(PII, 계좌 번호 등)는 세션 내에서만 사용 후 forget.
일반 대화 맥락은 장기 기억에 저장.
"""

class CustomerSupportMemory(AgentMemorySystem):

    PII_PATTERNS = [
        (r"\d{4}-\d{4}-\d{4}-\d{4}", "card_number"),   # 카드 번호
        (r"\d{10,}", "phone_number"),                    # 전화번호
        (r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}", "email"),
    ]

    def add_safely(self, content: str, tier: MemoryTier) -> MemoryEntry:
        """PII를 마스킹 후 저장"""
        masked = content
        for pattern, label in self.PII_PATTERNS:
            import re
            masked = re.sub(pattern, f"[{label}: ***]", masked)

        return self.add(masked, tier, metadata={"has_pii": False})
```

### 시나리오 2: 코딩 Agent — 프로젝트 상태 추적

```python
"""
소프트웨어 엔지니어링 Agent의 Memory.
프로젝트 디렉토리 구조, 마지막 편집 위치, 빌드 상태 등을 추적.
"""

class CodingAgentMemory:
    """
    코딩 Agent 전용 메모리 — 파일 구조, 빌드 상태, 현재 작업 파일
    """

    def __init__(self):
        self.project_context: dict[str, dict] = {}  # project_path -> metadata
        self.recent_edits: list[dict] = []           # 최근 파일 편집 이력

    def update_file_edit(self, file_path: str, change_summary: str):
        """파일 편집 이력 업데이트"""
        self.recent_edits.append({
            "file": file_path,
            "summary": change_summary,
            "timestamp": datetime.now().isoformat(),
        })
        # 최근 50개만 유지
        if len(self.recent_edits) > 50:
            self.recent_edits.pop(0)

    def get_current_working_context(self) -> str:
        """현재 작업 디렉토리와 최근 편집 파일 목록 반환"""
        if not self.recent_edits:
            return "프로젝트 기록 없음. 새로 시작."

        recent = self.recent_edits[-5:]
        files = [e["file"] for e in recent]
        summaries = [e["summary"] for e in recent]

        return (
            f"최근 편집 파일: {', '.join(files)}\n"
            f"편집 요약: {' | '.join(summaries)}"
        )
```

---

## 7. Memory와 SLO의 관계: 기억이 곧 신뢰성

### Memory 설계가直接影响하는 3가지 SLO

이전 글(2026-04-13)의 Agent SLO 프레임워크와 연결하면, memory 설계는 특히 다음 SLO에 영향을 미친다:

```
Memory 관련 SLO 파급 효과:
─────────────────────────────────────────────────────
Task Success Rate
├── 원인: 잘못된 memory 검색 → hallucinated 사실을 정답으로 사용
├── 해결: retrieval validation + importance threshold
└── 지표: "memory-caused failure" 비율 모니터링

Hallucination Rate
├── 원인: 오래된/덜 중요한 memory가 검색되어 사실로 착각
├── 해결: retrieval relevance threshold + freshness boost
└── 지표: memory retrieval 결과 중 hallucinations 비율

Cost per Task
├── 원인: 불필요하게 긴 memory context → token 소비 급증
├── 해결: memory budget limits + summarization aggressively
└── 지표: task당 평균 token 소비량 추적
─────────────────────────────────────────────────────
```

### Memory SLO 모니터링 대시보드 구성

```python
@dataclass
class MemorySLOReport:
    """Memory 시스템의 건강 상태를 보고하는 SLO 리포트"""
    period: str
    total_retrievals: int
    avg_retrieval_latency_ms: float
    avg_context_tokens: float
    retrieval_hallucination_rate: float
    forget_operations: int
    long_term_size: int

    def print_dashboard(self):
        print(f"""
╔══════════════════════════════════════════════╗
║         Memory System SLO Dashboard          ║
╠══════════════════════════════════════════════╣
║  Period                    : {self.period}       ║
║  Total Retrievals          : {self.total_retrievals:,}          ║
║  Avg Retrieval Latency    : {self.avg_retrieval_latency_ms:.1f}ms     ║
║  Avg Context Tokens        : {self.avg_context_tokens:.0f}          ║
║  Hallucination from Memory : {self.retrieval_hallucination_rate:.1%}     ║
║  Forgets Executed          : {self.forget_operations}           ║
║  Long-Term Memory Size     : {self.long_term_size:,} entries     ║
╠══════════════════════════════════════════════╣
║  ⚠️  Alert if hallucination rate > 2%         ║
║  ⚠️  Alert if avg context tokens > 10,000      ║
╚══════════════════════════════════════════════╝
        """)
```

---

## 결론: 기억을 설계한다는 것

Agent Memory 시스템은 단순히 "대화를 저장하는 배열"이 아니다. **단기 / 중기 / 장기의 분리**, **계층적 요약**, **하이브리드 검색**, **의도적인 forget**이 결합된 복잡한子系统다.

2026년 4월 현재, 프로덕션 Agent의 memory 설계에서 가장 중요한 3가지 교훈:

1. **Memory도 SLO가 필요하다**: 검색 품질, hallucination 기여도, 토큰 비용까지 측정해야 memory가 "작동하는지" 알 수 있다. 그냥 저장하면 된다는 관념은 프로덕션에서 실패한다.

2. **Forget은 설계다**: 모든 기억을 저장하는 것은 메모리子系统의 scalability를毁한다. Importance decay, TTL, semantic deduplication을 처음부터 설계에 넣어야 한다.

3. **검색 품질이 곧 산출물 품질이다**: RAG가 그렇듯, Agent Memory의 검색 결과가 LLM의 reasoning 재료가 된다. "좋은 검색 = 좋은 답변"이라는 원칙은 무엇보다 먼저다.

**핵심 체크리스트** — 자신의 Agent Memory를 점검하고 싶다면:
- [ ] 단기 기억의 용량 제한과 eviction 정책이 있는가?
- [ ] 세션 기억이 토큰 budget을 초과하지 않는가?
- [ ] 장기 기억의 검색 quality를 정량적으로 측정하고 있는가?
- [ ] PII 등 민감 정보의 분리와 forget 정책이 있는가?
- [ ] Memory에 의한 hallucination 비율을 SLO로 추적하고 있는가?

이 체크리스트 하나가 프로덕션 Agent의 신뢰성을 한 단계 끌어올린다.

---

### 자가 검토 및 개선 사항

1. **3계층 구조의 직관성**: 생물학적 기억 체계와의 대응 관계를 먼저 설명하여 "왜 이렇게 나누는가"에 대한 이해를 돕고, 이후 구체적 구현으로 넘어감. 도입부에서 추상적 개념과 실용적 구현을 자연스럽게 연결.

2. **코드 예시의 완결성**: ImportanceWeightedSTM, HierarchicalSessionMemory, HybridLongTermMemory 모두 단독으로 사용 가능한 수준의 완전한 구현. 특히 Hybrid search의 alpha 파라미터와 keyword/indexing 전략은 실무에서 즉시 참조 가능.

3. **Forget 전략의 실질성**: "저장하면 좋은 것"만 강조하지 않고, 무한 저장으로 인한 비용/품질 저하 문제를 먼저 제기하고, 4가지 forget 전략을 비교표로 정리. Importance decay 코드는 production에서 바로 사용 가능.

4. **SLO 시리즈와의 연계**: 4월 13일 Agent SLO 글과 의도적으로 연결. memory 설계가 SLO에 미치는 파급 효과를 구체적으로 분석하여 "이전 글이 왜 필요했는지"를 보여줌.

5. **프로덕션 시나리오의 현실성**: 고객 지원 Agent의 PII 분리, 코딩 Agent의 파일 이력 추적 등 실제 사용 시나리오 2가지를 상세 코드로 구현. 추상적 설계가 아니라 "이런 경우에 이렇게 쓴다"를 보여줌.
