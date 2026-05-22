---
title: "Local-First AI 에이전트의 메모리 설계: Context Window를 넘어서"
date: "2026-05-22"
description: "2026년 급부상하고 있는 Local-First AI 에이전트 패턴에서 가장 중요한 설계 과제인 메모리 관리 아키텍처를 심층 분석합니다. Context Window 활용 전략, Working Memory와 Long-term Memory 분리, Vector Store 기반 RAG 패턴을 실제 구현 코드와 함께 다룹니다."
tags:
  - AI Agent
  - Local AI
  - Memory Architecture
  - RAG
  - Context Management
  - Agent Memory
  - LLM
  - Vector Store
---

## 서론: 왜 Local AI 에이전트의 메모리가 중요한가

 2026년 현재, AI 에이전트가 로컬 환경에서 실행되는 패턴이 급부상하고 있습니다. `tinyhumansai/openhuman`(Rust 기반 로컬 AI), `agentmemory`(코딩 에이전트 메모리), `CloakBrowser`(stealth 브라우저) 등이 지속적인 growth signal을 보이고 있습니다.

 로컬에서 AI 에이전트가 작동한다는 것은 두 가지 핵심 제약을 의미합니다:

 1. **하드웨어 리소스의 한계** — GPU VRAM이 제한적, CPU만 사용하는 환경도 존재
 2. **Context Window의 유한성** — 128K, 200K 토큰의 컨텍스트도 무한하지 않음

 클라우드 기반 에이전트가コンテキストを使い果た면 단순히 더 큰 모델로 전환할 수 있지만, 로컬 에이전트는 메모리 관리 아키텍처 자체를 설계해야 합니다. 이 글에서는 Local-First AI 에이전트의 메모리 계층 구조와 구현 전략을 상세히 분석합니다.

---

## 1. 메모리 계층 구조: 인간의 기억을 모델링하다

### 1.1 계층적 메모리 아키텍처의 필요성

 인간의 기억은 계층적으로 구성됩니다. Sensory Memory → Working Memory → Long-term Memory로 이어지는 구조는 AI 에이전트에서도 동일하게 적용할 수 있습니다.

```
┌────────────────────────────────────────────────────────┐
│              AI Agent Memory Architecture               │
├────────────────────────────────────────────────────────┤
│                                                        │
│  ┌─────────────────────────────────────────────────┐  │
│  │           Working Memory (Tier 1)                │  │
│  │  - 현재 작업上下文 (Conversation)                  │  │
│  │  - 활성 도구 상태                                  │  │
│  │  - 최근 N개의 작업 결과                            │  │
│  │  - 용량: Context Window 크기 내                    │  │
│  └─────────────────────────────────────────────────┘  │
│                        ↓ compress/flush               │
│  ┌─────────────────────────────────────────────────┐  │
│  │           Short-Term Memory (Tier 2)             │  │
│  │  - 오늘의 작업 히스토리                             │  │
│  │  - 세션 간 공유 정보                                │  │
│  │  - 용량: 10K-50K 임베딩 벡터                       │  │
│  └─────────────────────────────────────────────────┘  │
│                        ↓ archive/prioritize           │
│  ┌─────────────────────────────────────────────────┐  │
│  │           Long-Term Memory (Tier 3)               │  │
│  │  - 프로젝트별 지식 베이스                           │  │
│  │  - 학습된 규칙 및 preference                      │  │
│  │  - 용량: Vector Store 크기 기준 (무제한 확장)      │  │
│  └─────────────────────────────────────────────────┘  │
│                                                        │
└────────────────────────────────────────────────────────┘
```

 각 계층은 서로 다른 접근 패턴과 용량을 가집니다. 설계의 핵심은 **어떤 정보를 어느 계층에 언제 이동시킬 것인가**입니다.

### 1.2 각 계층의 특성과 역할

**Working Memory (Tier 1)**
- 용량: 모델의 Context Window 크기
- 접근: O(1) — 모든 정보가 즉시 접근 가능
- 관리: LRU(Least Recently Used) eviction
- 생명주기: 현재 작업 세션

**Short-Term Memory (Tier 2)**
- 용량: 10K-50K 벡터 (메모리 제한에 따라)
- 접근: O(log N) — Vector Search
- 관리: 중요도 기반 압축 및 요약
- 생명주기: 몇 시간 ~ 며칠

**Long-Term Memory (Tier 3)**
- 용량: 디스크 기반 Vector Store (실제 무제한)
- 접근: O(log N) + 네트워크 지연
- 관리: retrieval 전략 최적화
- 생명주기: 수 주 ~ 수 년

---

## 2. Working Memory: Context Window 활용 전략

### 2.1 Context Compression의 핵심 문제

 Context Window는 유한합니다. 128K 토큰의 컨텍스트도 로컬 AI 에이전트가 긴 작업을 수행하면 금방 가득찰 수 있습니다.

 핵심 문제는 단순히 컨텍스트를 자르는 것이 아니라, **어떤 정보를 유지하고 어떤 정보를 제거할 것인가**입니다. 무분별한 자르기는 에이전트의 판단력을 저하합니다.

### 2.2 중요도 기반 선택적 유지

 정보를 유지할 때는 다음 기준을 적용합니다:

```python
from dataclasses import dataclass, field
from typing import List, Optional
import tiktoken

@dataclass
class MemoryEntry:
    content: str
    importance: float  # 0.0 ~ 1.0
    created_at: float
    access_count: int = 0
    last_accessed: float = 0
    
    def relevance_score(self, current_task: str) -> float:
        # 현재 작업과의 관련성 + 중요도 + 접근 빈도
        task_relevance = self._calculate_relevance(current_task)
        recency = self._calculate_recency()
        return (task_relevance * 0.5) + (self.importance * 0.3) + (recency * 0.2)
    
    def _calculate_relevance(self, task: str) -> float:
        # 간단한 키워드 매칭 기반 (실제로는 embedding 사용)
        common_words = set(self.content.split()) & set(task.split())
        return len(common_words) / max(len(task.split()), 1)
    
    def _calculate_recency(self) -> float:
        import time
        hours_old = (time.time() - self.last_accessed) / 3600
        return max(0, 1.0 - (hours_old / 24))

class ContextWindowManager:
    def __init__(self, max_tokens: int = 128000):
        self.max_tokens = max_tokens
        self.encoding = tiktoken.get_encoding("cl100k_base")
        self.entries: List[MemoryEntry] = []
    
    def add(self, content: str, importance: float = 0.5):
        tokens = len(self.encoding.encode(content))
        entry = MemoryEntry(
            content=content,
            importance=importance,
            created_at=time.time()
        )
        self.entries.append(entry)
        self._evict_if_needed()
    
    def _evict_if_needed(self):
        current_tokens = self._total_tokens()
        
        while current_tokens > self.max_tokens and self.entries:
            # 가장 낮은 relevance score의 항목을 제거
            self.entries.sort(key=lambda e: e.relevance_score(self._current_task))
            removed = self.entries.pop(0)
            current_tokens -= len(self.encoding.encode(removed.content))
    
    def get_context(self, task: str, max_tokens: Optional[int] = None) -> str:
        # 중요도 + 관련성으로 정렬된 컨텍스트 반환
        scored = [(e, e.relevance_score(task)) for e in self.entries]
        scored.sort(key=lambda x: x[1], reverse=True)
        
        context_parts = []
        total_tokens = 0
        limit = max_tokens or self.max_tokens
        
        for entry, score in scored:
            entry_tokens = len(self.encoding.encode(entry.content))
            if total_tokens + entry_tokens > limit:
                break
            context_parts.append(entry.content)
            total_tokens += entry_tokens
        
        return "\n".join(reversed(context_parts))  # 오래된 것부터
```

 이 구조의 핵심은 **정적 중요도(imporance)**와 **동적 관련성(relevance)**의 조합입니다. 항목 자체가 중요한 정보는 높은 importance를 부여하고, 현재 작업과 관련된 정보는 relevance score가 높아집니다.

### 2.3 Streaming 요약: 긴 컨텍스트의 점진적 압축

 컨텍스트가 가득 차기 전에 선제적으로 압축하는 전략도 효과적입니다:

```python
class StreamingSummarizer:
    def __init__(self, llm_client, compression_ratio: float = 0.3):
        self.llm = llm_client
        self.compression_ratio = compression_ratio
    
    async def compress(self, entries: List[MemoryEntry], reason: str) -> MemoryEntry:
        """
        entries를 compression_ratio 비율로 요약
        reason: 왜 압축하는지 (에이전트의 현재 작업)
        """
        # 오래된 것부터 정렬
        sorted_entries = sorted(entries, key=lambda e: e.created_at)
        
        original_text = "\n".join([e.content for e in sorted_entries])
        
        prompt = f"""다음 대화 로그를 {int(self.compression_ratio * 100)}% 길이로 요약하세요.
핵심 정보와 결정 사항을 유지하고, 상세한 과정은 제거하세요.

현재 작업 맥락: {reason}

원본:
{original_text}

요약:"""
        
        summary = await self.llm.complete(prompt)
        
        # 평균 중요도를 유지하되 약간 감소
        avg_importance = sum(e.importance for e in entries) / len(entries)
        
        return MemoryEntry(
            content=f"[요약: {sorted_entries[0].created_at} ~ {sorted_entries[-1].created_at}]\n{summary}",
            importance=avg_importance * 0.85,  # 요약이 약간 낮은 중요도
            created_at=time.time()
        )
```

 Streaming 요약의 장점은 **미리 선제적으로 압축하여 컨텍스트 바깥으로 나가는 정보를 줄이는 것**입니다. 가득 차서 evict되는 것보다, 덜 차 있을 때 핵심만 남기는 게 정보 손실을 줄입니다.

---

## 3. Short-Term Memory: 세션 간 지식 공유

### 3.1 세션 간 메모리 전달 문제

 AI 에이전트가 동일한 사용자와 여러 세션에 걸쳐 작업할 때, 이전 세션의 정보를 어떻게 접근할지가 핵심 과제입니다.

 단순히 모든 과거 대화를コンテキ스트에 넣으면 금방 꽉 차게 됩니다. 해결책은 **요약된 형태의 정보만 전달**하는 것입니다.

### 3.2 오늘의 작업 프로필

 하루가 끝나면 에이전트는 그날의 작업 프로필을 생성합니다:

```python
class DailyProfile:
    def __init__(self):
        self.date: str = ""
        self.projects: List[ProjectSummary] = []
        self.decisions: List[Decision] = []
        self.preferences: List[Preference] = []
        self.unresolved: List[str] = []
    
    def add_decision(self, context: str, decision: str, rationale: str):
        self.decisions.append(Decision(
            context=context,
            decision=decision,
            rationale=rationale,
            timestamp=time.time()
        ))
    
    def to_memory_entry(self) -> MemoryEntry:
        text = f"""일자: {self.date}

작업한 프로젝트:
{chr(10).join([p.to_text() for p in self.projects])}

결정 사항:
{chr(10).join([d.to_text() for d in self.decisions])}

미해결 작업:
{chr(10).join([f"- {u}" for u in self.unresolved])}"""
        
        return MemoryEntry(
            content=text,
            importance=0.6,  # 중간 중요도
            created_at=time.time()
        )

@dataclass
class Decision:
    context: str
    decision: str
    rationale: str
    timestamp: float
    
    def to_text(self) -> str:
        return f"- [{self.context}] {self.decision}\n  이유: {self.rationale}"
```

 이 Daily Profile은 Long-Term Memory로 이전되어 이후 세션에서检索될 수 있습니다.

### 3.3 중요 사건의 즉각적 기록

 세션 중간에 중요한 결정이나 발견이 있으면 즉시 기록합니다:

```python
class ImportantEventRecorder:
    def __init__(self, short_term_store):
        self.store = short_term_store
        self.threshold = 0.8  # 이重要性 이상만 기록
    
    def maybe_record(self, event: str, importance: float):
        if importance >= self.threshold:
            self.store.add(
                content=f"[중요] {event}",
                importance=importance,
                tags=["important", "decision", "discovery"]
            )
    
    # 에이전트가 명시적으로 호출
    def record_decision(self, context: str, decision: str, why: str):
        entry = MemoryEntry(
            content=f"""결정: {decision}
맥락: {context}
이유: {why}""",
            importance=0.9,
            tags=["important", "decision"]
        )
        self.store.add(entry)
```

 "중요한事件的即时记录" 패턴은 나중에 검색할 때 활용할 수 있는 구조화된 정보를 생성합니다.

---

## 4. Long-Term Memory: Vector Store 기반 RAG

### 4.1 Retrieval-Augmented Generation 패턴

 Local AI 에이전트의 Long-Term Memory는 일반적으로 Vector Store로 구현됩니다. 문서를 embedding하고, 유사도 검색으로 relevant한 정보를检索합니다.

### 4.2 계층적 검색 전략

 단순한 유사도 검색은 때때로 불필요한 정보를 찾거나 핵심 정보를 놓칠 수 있습니다. 계층적 검색은 이 문제를 완화합니다:

```python
from typing import List, Tuple
import numpy as np

class HierarchicalRetriever:
    def __init__(self, vector_store, llm):
        self.store = vector_store
        self.llm = llm
    
    async def retrieve(self, query: str, current_context: str) -> str:
        # Level 1: Temporal filtering
        # 최근 관련 정보 먼저 검색
        recent_hits = await self._search_with_time_filter(
            query, days_back=7
        )
        
        # Level 2: Semantic search
        # Embedding 기반 유사도 검색
        semantic_hits = await self._semantic_search(
            query, top_k=10
        )
        
        # Level 3: Cross-reference
        # 현재 컨텍스트와 결합하여 재순위화
        reranked = self._rerank_with_context(
            recent_hits + semantic_hits, 
            current_context
        )
        
        # 최종 결과를 관련성 순으로 정렬
        final = sorted(reranked, key=lambda x: x[1], reverse=True)[:5]
        
        return self._format_results(final)
    
    async def _search_with_time_filter(self, query: str, days_back: int) -> List:
        cutoff = time.time() - (days_back * 86400)
        
        results = await self.store.search(
            query,
            filter={"timestamp": {"$gte": cutoff}},
            top_k=5
        )
        return results
    
    async def _semantic_search(self, query: str, top_k: int) -> List:
        return await self.store.search(query, top_k=top_k)
    
    def _rerank_with_context(self, hits: List, current_context: str) -> List:
        """
        현재 컨텍스트와 각 검색 결과의 관련성을 평가
        단순 키워드 기반(real 구현에서는 embedding 사용)
        """
        context_words = set(current_context.lower().split())
        
        reranked = []
        for hit in hits:
            hit_words = set(hit.content.lower().split())
            overlap = len(context_words & hit_words)
            
            # 원래 점수 + 컨텍스트 관련성 보너스
            new_score = hit.score + (overlap * 0.1)
            reranked.append((hit, new_score))
        
        return reranked
    
    def _format_results(self, results: List[Tuple]) -> str:
        if not results:
            return ""
        
        formatted = []
        for hit, score in results:
            formatted.append(f"[관련도: {score:.2f}]\n{hit.content}\n")
        
        return "\n---\n".join(formatted)
```

 계층적 검색의 핵심은 **시간적 근접성**과 **현재 작업 관련성**을 조합하여 단순 유사도 검색의 한계를 보완하는 것입니다.

### 4.3 메모리 무드성과隐私

 Long-Term Memory에는敏感한 정보가 포함될 수 있습니다. 검색 결과에 민감한 정보가 포함되지 않도록 필터링하는 것이 중요합니다:

```python
class PrivacyFilteredRetriever(HierarchicalRetriever):
    def __init__(self, vector_store, llm, privacy_policy):
        super().__init__(vector_store, llm)
        self.privacy = privacy_policy
    
    async def retrieve(self, query: str, current_context: str) -> str:
        raw_results = await super().retrieve(query, current_context)
        
        # Privacy policy에 따라 필터링
        filtered = []
        for result in raw_results.split("---"):
            if not self.privacy.contains_sensitive(result):
                filtered.append(result)
        
        return "---".join(filtered)
    
    def add_rule(self, pattern: str, action: str = "redact"):
        self.privacy.add_rule(pattern, action)
```

 Privacy 필터링은 에이전트가 사용자의私人 정보에 불필요하게 접근하는 것을 방지합니다.

---

## 5. 실제 구현: `agentmemory` 스타일의 메모리 매니저

### 5.1 에이전트 메모리 매니저의 핵심 구조

 `agentmemory` 라이브러리에서 영감을 받은 실제 구현을 살펴보겠습니다:

```python
import asyncio
from typing import Dict, List, Optional
from dataclasses import dataclass

@dataclass
class AgentMemory:
    working: "WorkingMemory"
    short_term: "ShortTermMemory"
    long_term: "LongTermMemory"
    privacy_filter: "PrivacyFilter"
    
    @classmethod
    async def create(cls, config: Dict) -> "AgentMemory":
        working = WorkingMemory(
            max_tokens=config.get("working_tokens", 64000)
        )
        
        short_term = ShortTermMemory(
            vector_store=VectorStore.create_in_memory(
                dim=config.get("embedding_dim", 1536)
            )
        )
        
        long_term = LongTermMemory(
            vector_store=VectorStore.create_persistent(
                path=config.get("memory_path", "./memory_store")
            )
        )
        
        return cls(
            working=working,
            short_term=short_term,
            long_term=long_term,
            privacy_filter=PrivacyFilter()
        )
    
    async def store_interaction(self, role: str, content: str, importance: float = 0.5):
        """작업 중 발생하는 모든 상호작용을 적절한 계층에 저장"""
        entry = MemoryEntry(
            content=f"[{role}]: {content}",
            importance=importance,
            created_at=time.time()
        )
        
        # Working memory에 우선 저장
        self.working.add(entry)
        
        # 중요도가 높으면 short-term에도 저장
        if importance >= 0.8:
            await self.short_term.add(entry)
    
    async def recall(self, query: str) -> str:
        """과거 정보 검색 — 계층적 접근"""
        # 1. Working memory 먼저 (가장 최근 + 관련성 높음)
        working_hits = self.working.search(query)
        
        # 2. Short-term에서 검색
        short_hits = await self.short_term.search(query, top_k=5)
        
        # 3. Long-term에서 검색
        long_hits = await self.long_term.search(query, top_k=5)
        
        # 계층적 결합
        all_hits = working_hits + short_hits + long_hits
        
        # 중복 제거 후 relevance 순으로 정렬
        return self._merge_and_rank(all_hits, query)
    
    async def flush_to_long_term(self):
        """세션 종료 시 working memory를 장기 메모리로 이전"""
        if self.working.entries:
            summary_entry = await self._create_session_summary(
                self.working.entries
            )
            await self.long_term.add(summary_entry)
            
            # Working memory 정리
            self.working.clear()
    
    async def _create_session_summary(self, entries: List[MemoryEntry]) -> MemoryEntry:
        """Working memory 항목들의 요약 생성"""
        all_content = "\n".join([e.content for e in entries])
        
        summary_prompt = f"""다음 작업 세션을 요약해줘:
{all_content}

형식:
- 주요 작업: ...
- 결정 사항: ...
- 다음 작업 참고사항: ..."""
        
        # 실제로는 LLM 호출
        summary_text = f"[세션 요약 from {entries[0].created_at}]: ..."
        
        return MemoryEntry(
            content=summary_text,
            importance=0.6,
            created_at=time.time()
        )
```

### 5.2 메모리 정책 설정

 에이전트의 동작에 따라 메모리 정책을 조절할 수 있습니다:

```python
class MemoryPolicy:
    def __init__(self):
        self.compression_threshold = 0.7  # working memory 70% 이상 채워지면 압축
        self.flush_interval = 3600  # 1시간마다 short-term으로 flush
        self.long_term_importance_threshold = 0.8  # 이 이상만 장기 저장
    
    def should_compress(self, working_memory) -> bool:
        return working_memory.usage_ratio() > self.compression_threshold
    
    def should_flush(self, last_flush: float) -> bool:
        return time.time() - last_flush > self.flush_interval
```

 에이전트의 작업 특성에 따라 이 정책을 조정합니다. 긴 코드 작성 작업에는 working memory를 넉넉하게 유지하고, 빠른 탐색 작업에는 자주 flush하는 식입니다.

---

## 6. Local-First의 한계와 하이브리드 접근

### 6.1 Local-First의 장단점

 Local AI 에이전트의 메모리 설계는 Cloud-First와 비교하여 명확한 트레이드오프를 가집니다:

**장점:**
- 데이터가 외부로 나가지 않음 (privacy)
- 네트워크 대기 시간 없음 (latency)
- 비용 없음 (clould API 비용)
- 오프라인 작동 가능

**단점:**
- 하드웨어 리소스 제한 (VRAM, RAM)
- 모델 크기 제한 (더 작은 모델 사용)
- 검색 속도 제한 (disk-based vector store)

### 6.2 하이브리드 패턴: Local + Cloud

 2026년 현재 가장 실용적인 접근은 **하이브리드 패턴**입니다:

```python
class HybridMemory:
    def __init__(self, local_memory: AgentMemory, cloud_memory: Optional[CloudMemory]):
        self.local = local_memory
        self.cloud = cloud_memory
    
    async def store(self, entry: MemoryEntry):
        # 중요 정보는 local + cloud 양쪽에
        await self.local.store(entry)
        
        if self.cloud and entry.importance >= 0.9:
            await self.cloud.store(entry)
    
    async def recall(self, query: str) -> str:
        # local 먼저, 없으면 cloud
        local_results = await self.local.recall(query)
        
        if not local_results and self.cloud:
            return await self.cloud.recall(query)
        
        return local_results
```

 자주 접근하는 정보는 local에 두고,rare한 정보는 cloud에서 검색하는 구조입니다. 이 패턴은 로컬 리소스의 효율적 활용과 cloud의 확장성을 모두 취합니다.

---

## 결론: 메모리 설계는 에이전트의 지능을 결정한다

 Local-First AI 에이전트의 메모리 설계는 단순한 구현 문제가 아닙니다. **에이전트가 정보를 어떻게 인식하고, 저장하고,检索하는가의 설계**입니다.

 핵심 설계 원칙:

 1. **계층적 관리**: Working → Short-Term → Long-Term으로 정보를 흐르게 한다
 2. **선제적 압축**: 가득 차서 losing 것보다 덜 차 있을 때 핵심만 유지한다
 3. **관련성 기반 검색**: 단순 유사도를 넘어 현재 작업과의 관련성을 평가한다
 4. **Privacy 우선**: 검색 결과에 민감한 정보가 포함되지 않도록 필터링한다
 5. **하이브리드 전략**: local의 privacy와 cloud의 확장성을 모두 활용한다

 2026년 현재 로컬 AI 에이전트가 급부상하는 이유는 하드웨어 발전과 모델 효율화 때문입니다. 그러나 진정한 성장은 **메모리 아키텍처의 성숙**에 달려 있습니다. Context Window를 넘어선 메모리 설계, 이것이 Local-First AI 에이전트의 다음 과제입니다.

---

*본 포스트는 AI 에이전트 아키텍처 시리즈의 일환으로 작성되었습니다.*