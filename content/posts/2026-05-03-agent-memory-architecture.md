---
title: "에이전트 메모리의 진짜 문제: Vector RAG만으로는 에이전트의 기억이 완성되지 않는 이유"
description: "2026년 현재 대부분의 AI 에이전트가 '기억' 문제로 고생하고 있습니다. Vector RAG를 붙였는데도 맥락을 잊어버리고, 같은 실수를 반복하며, 장기 작업을 놓쳐버리는 에이전트를 수없이 봤을 것입니다. 이 글에서는 에이전트 메모리를 'Semantic / Episodic / Procedural'의 세 层으로 재설계하고, 각각의 failure mode와 실전 구현 전략을 정리합니다."
date: "2026-05-03"
tags: ["Agent-Memory", "RAG", "Knowledge-Graph", "Context-Engineering", "AI-Agent", "Production-AI", "Architecture"]
---

## 들어가며

에이전트 개발자라면 한 번쯤 이런 상황을 겪어봤을 것입니다.

-昨夜 잘 동작하던 에이전트가 오늘은 같은 작업을 **처음부터** 시작한다
- 사용자가 "지난번에 봤던 그 문서 다시 찾아줘"라고 하면 찾지 못한다
- 에이전트가 같은 파일을 세 번 다시 읽고, 같은 reasoning을 세 번 반복한다

이 문제의 근본 원인은 하나입니다: **대부분의 에이전트가 '기억'을 Vector RAG와 동일시하고 있기 때문입니다.**

실제로 production에서 동작하는 에이전트의 기억 체계는 Semantic Memory만으로 구성하면 안 됩니다. 이 글에서는 Google, Microsoft, Meta의 내부 연구와 2026년 현재 실전 도입 사례를 기반으로, **세 层 에이전트 메모리 아키텍처**를 설계하는 방법을 정리합니다.

---

## 1. 왜 Vector RAG만으로는 부족한가

### 1.1 RAG의 전제 조건

传统的 RAG(Retrieval-Augmented Generation)는 다음을 전제합니다:

1. **문서가 이미 존재한다** → 새로 생성된 지식은 반영 안 됨
2. **유사도 검색이 의미를 잡아낸다** → 명시적 관계(因果関係, 순서, 반복 패턴)은丢失
3. **Retrieval 시점이 중요하다** → 에이전트의 현재 작업 흐름과 무관하게 동작할 수 있음

에이전트의 작업은 대화형입니다. RAG의 **문서检索** 모델은 에이전트의 **작업 실행 흐름**과 구조적으로 mismatch가 납니다.

### 1.2 Datadog 2026 State of AI Engineering[[1]](https://www.datadoghq.com/state-of-ai-engineering/)이 확인한 현실

> "Teams have meaningful opportunities to improve efficiency and reliability across model fleet management, **agent design**, **context engineering**, and cost optimization."

Context engineering이 별도의 개선 영역으로 분리될 만큼, 단순한 RAG 확장이 해법이 되지 못하고 있다는 뜻입니다.

---

## 2. 세 层 에이전트 메모리 아키텍처

```
┌─────────────────────────────────────────────────────────┐
│              에이전트 메모리 체계 (Three-Layer)            │
├─────────────────────────────────────────────────────────┤
│  Layer 3: Procedural Memory    │ 작업 수행 경로 + 도구 사용 패턴  │
├─────────────────────────────────────────────────────────┤
│  Layer 2: Episodic Memory      │ 작업 이력 + 중간 결과물 + 상태   │
├─────────────────────────────────────────────────────────┤
│  Layer 1: Semantic Memory      │Facts+도메인 지식 (Vector RAG)  │
└─────────────────────────────────────────────────────────┘
```

### 2.1 Layer 1 — Semantic Memory (알아야 하는 것)

**역할**: 에이전트가 판단의 근거로 삼는 Facts과 도메인 지식

**구현**: 전통적인 Vector RAG + Knowledge Graph의 Hybrid

```python
# semantic_memory.py
from dataclasses import dataclass
from typing import Optional
import numpy as np

@dataclass
class SemanticMemory:
    """Layer 1: Facts과 도메인 지식을 저장하는 공간"""
    vector_store: 'VectorStore'
    knowledge_graph: 'KnowledgeGraph'

    def retrieve(self, query: str, top_k: int = 5) -> list[dict]:
        # Vector search로 후보 획득
        vector_results = self.vector_store.search(query, top_k=top_k)
        
        # KG로 관련 개념探索 (명시적 관계 활용)
        # KG로 관련 개념 탐색 (명시적 관계 활용)
        kg_results = self.knowledge_graph.expand_query(query)

        # RRF(Reciprocal Rank Fusion)로 결과 합성
        return self._fusion_rerank(vector_results, kg_results, query)
    
    def _fusion_rerank(
        self, 
        vector_results: list, 
        kg_results: list, 
        query: str
    ) -> list[dict]:
        """RRF(Reciprocal Rank Fusion)로 결과 합성"""
        scores = {}
        k = 60  # RRF 파라미터
        
        for rank, result in enumerate(vector_results):
            scores[result['id']] = scores.get(result['id'], 0) + k / (k + rank)
        
        for rank, result in enumerate(kg_results):
            scores[result['id']] = scores.get(result['id'], 0) + k / (k + rank)
        
        sorted_ids = sorted(scores.keys(), key=lambda x: scores[x], reverse=True)
        return [self._fetch_by_id(id) for id in sorted_ids[:top_k]]
```

**Failure Mode**: Facts은 갱신되지만 에이전트가古い参照를 고집 → Knowledge Graph의 temporal versioning 필요

### 2.2 Layer 2 — Episodic Memory (발생했던 일)

**역할**: 에이전트가 작업을 수행하는 동안 생성한 모든 중간 결과물과 상태

**구현**: 작업별 session store + state snapshot

```python
# episodic_memory.py
from datetime import datetime
from typing import Any
import json

@dataclass
class Episode:
    session_id: str
    task_id: str
    timestamp: datetime
    agent_action: str          # "read_file", "call_tool", "reason"
    input_snapshot: dict      # 이 행동의 입력 상태
    output_snapshot: dict    # 이 행동의 출력 결과
    reasoning_trace: str      # Chain-of-Thought log
    
    def to_memory_entry(self) -> dict:
        return {
            "session_id": self.session_id,
            "task_id": self.task_id,
            "action": self.agent_action,
            "input": self.input_snapshot,
            "output": self.output_snapshot,
            "reasoning": self.reasoning_trace,
            "created_at": self.timestamp.isoformat(),
        }

class EpisodicMemory:
    """Layer 2: 작업 이력을 저장하고 유사 작업检索"""
    
    def __init__(self, store: 'SessionStore'):
        self.store = store
    
    def record(self, episode: Episode) -> None:
        entry = episode.to_memory_entry()
        # session + task 기준으로 색인
        self.store.append(
            index=["session_id", "task_id", "agent_action"],
            document=entry
        )
    
    def retrieve_similar_task(
        self, 
        current_task: str, 
        current_context: dict,
        lookback_sessions: int = 10
    ) -> list[Episode]:
        """현재 작업과 유사한 과거 작업을检索"""
        candidates = self.store.search(
            query=current_task,
            index="task_id",
            lookback=lookback_sessions
        )
        
        # 유사도 + 컨텍스트 重複도 综合 점수화
        scored = []
        for ep in candidates:
            similarity = self._task_similarity(
                current_task, ep.task_id
            )
            context_overlap = self._context_overlap(
                current_context, ep.input_snapshot
            )
            # 加權平均 (similarity 0.6, context_overlap 0.4)
            score = similarity * 0.6 + context_overlap * 0.4
            scored.append((score, ep))
        
        scored.sort(reverse=True)
        return [ep for _, ep in scored[:3]]
    
    def _task_similarity(self, a: str, b: str) -> float:
        # 간단한 임베딩 기반 유사도 (실제 구현 시 LLM 또는 embedding model 사용)
        from difflib import SequenceMatcher
        return SequenceMatcher(None, a, b).ratio()
    
    def _context_overlap(self, curr: dict, past: dict) -> float:
        if not curr or not past:
            return 0.0
        intersection = set(curr.keys()) & set(past.keys())
        if not intersection:
            return 0.0
        return sum(1 for k in intersection if curr[k] == past[k]) / len(intersection)
```

**Failure Mode**: Episodic memory가爆炸적으로 증가 → retrieval latency 증가 → tiered storage로 아키텍처 분리 필요

### 2.3 Layer 3 — Procedural Memory (할 수 있는 것)

**역할**: 에이전트가 도구를 사용하는 방법과 작업 수행 경로의 패턴

**구현**: Tool-use log → pattern mining → reusable workflow

```python
# procedural_memory.py
from collections import defaultdict

class ProceduralMemory:
    """Layer 3: 도구 사용 패턴과 작업 수행 경로를 저장"""
    
    def __init__(self):
        # tool_sequence: 어떤 작업에 어떤 도구 시퀀스가 효과적이었는지
        self.tool_sequences: dict[str, list['ToolPattern']] = defaultdict(list)
        self.success_rates: dict[str, float] = {}
    
    def record_execution(self, task_type: str, tool_sequence: list[str], success: bool) -> None:
        pattern = ToolPattern(
            task_type=task_type,
            sequence=tool_sequence,
            success=success,
            frequency=1
        )
        
        # 기존 패턴과 매칭 → 빈도 更新
        existing = self._find_matching_pattern(task_type, tool_sequence)
        if existing:
            existing.frequency += 1
            if success and not existing.last_success:
                existing.success_rate = (
                    (existing.success_rate * (existing.frequency - 1) + 1) 
                    / existing.frequency
                )
            existing.last_success = success
        else:
            self.tool_sequences[task_type].append(pattern)
        
        # 성공률 更新
        self._recompute_success_rate(task_type)
    
    def suggest_tools(self, task_type: str) -> list[str]:
        """작업 유형에 따라 검증된 도구 시퀀스 추천"""
        patterns = self.tool_sequences.get(task_type, [])
        if not patterns:
            return []  # 알 수 없는 작업 → 에이전트에게 질문
        
        # 성공률 기준 정렬
        viable = [p for p in patterns if p.success_rate >= 0.7]
        viable.sort(key=lambda p: (p.success_rate, p.frequency), reverse=True)
        return viable[0].sequence if viable else []
    
    def _find_matching_pattern(self, task_type: str, seq: list[str]) -> 'ToolPattern':
        for p in self.tool_sequences[task_type]:
            if p.sequence == seq:
                return p
        return None
    
    def _recompute_success_rate(self, task_type: str) -> None:
        patterns = self.tool_sequences.get(task_type, [])
        if patterns:
            total = sum(p.success_rate * p.frequency for p in patterns)
            freq_sum = sum(p.frequency for p in patterns)
            self.success_rates[task_type] = total / freq_sum if freq_sum else 0.0

@dataclass
class ToolPattern:
    task_type: str
    sequence: list[str]
    success: bool
    frequency: int
    success_rate: float = 0.0
    last_success: bool = False
```

---

## 3. 세 层 메모리의 통합: Memory Orchestrator

```python
# memory_orchestrator.py
from dataclasses import dataclass

@dataclass
class AgentMemory:
    semantic: SemanticMemory
    episodic: EpisodicMemory
    procedural: ProceduralMemory
    
    def full_retrieval(self, query: str, task_type: str, context: dict) -> dict:
        """세 层 메모리를 통합 검색"""
        semantic_results = self.semantic.retrieve(query)
        episodic_results = self.episodic.retrieve_similar_task(query, context)
        procedural_suggestion = self.procedural.suggest_tools(task_type)
        
        return {
            "facts": semantic_results,           # Layer 1: 판단 근거
            "past_episodes": episodic_results,   # Layer 2: 작업 이력
            "recommended_tools": procedural_suggestion,  # Layer 3: 도구 추천
        }
    
    def remember(self, session_id: str, task_id: str, action: str, 
                 inputs: dict, outputs: dict, reasoning: str, 
                 task_type: str = "general") -> None:
        """모든 layer에 동시 기록"""
        # Layer 2:Episodic
        episode = Episode(
            session_id=session_id,
            task_id=task_id,
            timestamp=datetime.now(),
            agent_action=action,
            input_snapshot=inputs,
            output_snapshot=outputs,
            reasoning_trace=reasoning
        )
        self.episodic.record(episode)
        
        # Layer 3:Procedural
        tool_seq = self._extract_tool_sequence(outputs)
        self.procedural.record_execution(task_type, tool_seq, success=True)
```

---

## 4. Production 도입 시 반드시 고려해야 할 4가지 Failure Mode

### 4.1 Memory Explosion

Layer 2(Episodic)가 무制御으로 성장하면 retrieval latency가 에이전트 반응 속도를 죽입니다.

**해결책**: tiered TTL 정책

```python
# 각 episode에 TTL 적용
EPISODE_TTL = {
    "immediate":   60 * 60,       # 1시간 (현재 작업 세션)
    "short_term":  24 * 60 * 60,  # 24시간 (오늘의 작업)
    "long_term":   30 * 24 * 60 * 60,  # 30일 (重要 프로젝트)
}

def should_retain(episode: Episode) -> bool:
    age = datetime.now() - episode.timestamp
    if age < EPISODE_TTL["immediate"]:
        return True
    elif episode.task_id in PRIORITY_TASKS and age < EPISODE_TTL["long_term"]:
        return True
    else:
        return age < EPISODE_TTL["short_term"]
```

### 4.2 Context Contamination

과거 Episodic memory가 현재 작업에 不필요한 선入을 제공하여 에이전트가 잘못된 文脈에서 판단하는 문제

**해결책**: retrieval時 contextual gating

```python
def retrieve_with_gating(
    self, 
    query: str, 
    current_task: str,
    contamination_threshold: float = 0.3
) -> list:
    results = self._raw_retrieval(query)
    
    filtered = []
    for r in results:
        # 현재 작업과의 관련도 점수
        relevance = self._task_relevance(current_task, r.task_id)
        if relevance >= contamination_threshold:
            filtered.append(r)
        # 관련도가 낮으면 logging만 하고 결과에서 제외
        else:
            log_contamination(r, query)
    
    return filtered
```

### 4.3 Semantic Memory Drift

도메인 지식이 업데이트되었는데 에이전트가古い版本을 고집하는 문제

**해결책**: temporal versioning + freshness score

```python
def retrieve(self, query: str, max_age_days: int = 30) -> list:
    results = self.vector_store.search(query)
    
    return [
        r for r in results 
        if r.metadata.get("fact_age_days", 0) <= max_age_days
    ]
```

### 4.4 Procedural Memory Staleness

특정 도구 시퀀스가 과거에는 성공했지만 현재 환경에서는 실패하는 상태

**해결책**: periodic re-validation

```python
# 1주일에 한 번 실패율 재검증
def revalidate_patterns(self, task_types: list[str]) -> None:
    for task_type in task_types:
        patterns = self.procedural.tool_sequences[task_type]
        for pattern in patterns:
            recent = self.episodic.get_recent(
                task_type=task_type,
                since=datetime.now() - timedelta(days=7)
            )
            if recent:
                recent_success_rate = sum(1 for e in recent if e.success) / len(recent)
                if abs(recent_success_rate - pattern.success_rate) > 0.2:
                    # 20% 이상 차이가 나면 stale로 표시
                    pattern.stale = True
                    pattern.last_validated = datetime.now()
```

---

## 5. 언제 어떤 Layer를 강화해야 하는가

| 작업 특성 | Layer 1 강화 | Layer 2 강화 | Layer 3 강화 |
|---------|-------------|-------------|-------------|
| 사실 검색 위주 | ✅ | ❌ | ❌ |
| 반복 작업 (문서 처리 등) | ⚪ | ✅ | ✅ |
| 신규 도메인 진입 | ✅ | ❌ | ❌ |
| 복잡한 tool orchestration | ❌ | ⚪ | ✅ |
| 장기 프로젝트 (수주~결과) | ✅ | ✅ | ⚪ |

---

## 나가며

에이전트의 기억 문제는 "RAG를 붙이면 된다"로 끝나지 않습니다. Semantic / Episodic / Procedural의 三層으로 나누어 각각의 retrieval pattern과 failure mode를 설계해야 production에서 실제로 동작하는 기억 체계가 됩니다.

특히 Layer 2(Episodic)와 Layer 3(Procedural)은 단순 KV store로는 구현 불가능하며, 에이전트의 작업 흐름을 추적하고 도구 사용 패턴을 학습하는 메커니즘이 반드시 필요합니다.

2026년 현재, 에이전트의 기억 체계 설계는 결국 **"에이전트를 어떻게 가르칠 것인가"** 의 문제로 귀결됩니다. 기억의 三層을 올바르게 설계하면, 에이전트는 어제의 문서를 스스로 찾아보고, 지난번의 실수를 반복하지 않으며, 적절한 도구를 스스로 선택하게 될 것입니다.

---

**References**

[[1] Datadog State of AI Engineering 2026](https://www.datadoghq.com/state-of-ai-engineering/)
