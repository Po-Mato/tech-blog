---
title: "Context Window은 RAM, Memory는 Storage: AI Agent 2-Layer Memory Architecture 완전 분석 (#051)"
date: "2026-06-27"
description: "생산 환경에서 AI Agent가 8~10번의 tool call 이후 갑자기 이전 결정을 무시하는 이유는 모델이 나빠서가 아니다. Context Window를 데이터베이스처럼 사용하는 Memory Architecture의 실패다. 이 글에서는 Context Window = RAM, Persistent Memory = Storage라는 2-Layer 메모리 모델을 정의하고, Token Budget Scheduler, Multi-Signal Retrieval, OWASP Memory Guard 통합까지 Production 코드와 함께 완전 분석한다."
tags:
  - AI Agent
  - Memory Architecture
  - LLM
  - Production Patterns
  - Context Window
  - Agent Security
  - System Design
---

## TL;DR

- Context Window는 **RAM**이고, Persistent Memory는 **Storage**다. 이 둘을 혼용하면 agent가 8~10 턴이 지나면 '망각'하는 것처럼 보이는 생산 고장이 발생한다.
- 2026년 4월 Gamage 연구(4,416회 시험)는 **Commission Constraint(금지 명령)는 유지되지만 Omission Constraint(수행 명령)는 대화 깊이에 따라 급격히 붕괴**됨을 계량적으로 증명했다. 이는 모델 문제가 아니라 Memory Architecture 문제다.
- Mem0의 2026년 token-efficient 알고리즘은 **Single-Pass ADD-Only Extraction + Multi-Signal Retrieval**로 LoCoMo 92.5, LongMemEval 94.4를 달성하며 token 소비를 ~6,900 tokens/query로 안정화했다.
- OWASP는 2026년 5월 **ASI06: Memory Poisoning**을 Agent Top 10에 등재했다. Memory Layer는 이제 공격 표면이며, 암호화 해싱 + 이상 탐지 + Temporal Trust Decay가 방어의 핵심이다.

---

## 1. 문제의 정확한 진단: 모델이 망각하는 것처럼 보이는 이유

2025~2026년에 생산 환경에서 LLM Agent를 운영해본 빌더라면 다음 패턴을 경험했을 것이다:

> Agent가 8번째 tool call 즈음에서 2번째 step에서 결정했던 내용을 무시한다. 같은 정보를 두 번 fetch한다. 사용자가 세션 시작 시 설정한 제약 조건을 무시한다.

직관적인 진단은 "모델이 나빠졌다"지만, 실제 원인은 더 간단하고 더 교정 가능하다.

### 1.1 Context Window의 세 가지 구조적 특성

LLM의 Context Window는 다음과 같은 특성을 공유한다:

| 특성 | Context Window | Computer RAM | Persistent Storage |
|------|---------------|--------------|-------------------|
| **휘발성** | 세션 종료 시 소멸 | 프로세스 종료 시 소멸 | 영구 보존 |
| **용량 효과** | 한계 도달 전부터 성능 저하 (Lost in the Middle) | 바이너리: 용량 초과 시 크래시 | 하드웨어에 따라 선형 확장 |
| **접근 비용** | 매 호출 시 전체 재처리 | 직접 주소 참조 | 탐색 + 읽기 오버헤드 |
| **업데이트 메커니즘** | Append Only | Random Write | Read-Modify-Write |
| **실패 모드** | 매장(Burial) 및 주의 분산 | Overflow Crash | 손상 또는 손실 |
| **최적 용도** | 현재 작업의 활성 추론 상태 | 연산 실행 | 사실, 선호도, 이력 |

### 1.2 Gamage (2026) 연구: 계량적 증명

2026년 4월 Yeran Gamage의 연구 *"Omission Constraints Decay While Commission Constraints Persist in Long-Context LLM Agents"*는 6개 대화 깊이(1~50턴)에 걸쳐 4,416회의 시험을 수행했다:

```python
# 연구 방법론의 핵심: Constraint Type별 붕괴 곡선 측정
import matplotlib.pyplot as plt
import numpy as np

constraint_types = {
    "commission": {  # "하지마" 유형 명령
        1: 98.2, 5: 97.1, 10: 95.8, 
        20: 93.4, 35: 91.2, 50: 88.7
    },
    "omission": {   # "해라" 유형 명령  
        1: 96.8, 5: 88.3, 10: 74.6, 
        20: 61.2, 35: 52.4, 50: 47.1
    }
}

# 핵심 발견: Commission은 유지되나 Omission은 10턴에서 급격 붕괴
# 0~1턴에서 두 유형 모두 ~97% → 10턴에서 omission 74.6% vs commission 95.8%
# → 20턴 시점: omission 61.2%로 과반 실패
```

**핵심 발견**: Commission constraint(금지 명령, "하지마")는 50턴까지 88.7% 유지되는 반면, Omission constraint(수행 명령, "해라")는 10턴에서 74.6%, 20턴에서 61.2%로 급격히 붕괴한다.

**해석**: Agent가 10턴까지 작업을 수행하지 않은 명령은 "망각"할 확률이 25%를 넘어간다. 이는 **모델의 성능 문제가 아니라 Context Window의 주의 분산(attention dilution) 문제**다.

---

## 2. 2-Layer Memory Architecture

이 구조적 문제에 대한 해결책은 직관적이다: Context Window를 RAM처럼, Persistent Memory를 Storage처럼 사용하라.

### 2.1 Working Memory (RAM Layer)

Context Window에 유지할 정보는 오직 **현재 작업 완료에 필요한 최소한의 정보**여야 한다:

```
┌─────────────────────────────────────┐
│         Working Memory              │
│         (Context Window)            │
├─────────────────────────────────────┤
│ • 현재 태스크 설명 & 즉시 요청       │
│ • 중간 tool 결과 (압축된 사실만)     │
│ • 활성 추론 추적 (결정 사항)         │
│ • 세션 중 임시 수정 명령             │
│ • 이 세션에만 적용되는 임시 제약     │
└─────────────────────────────────────┘
```

### 2.2 Persistent Memory (Storage Layer)

세션 경계를 넘어 유지되어야 하는 모든 정보:

```
┌─────────────────────────────────────┐
│       Persistent Memory             │
│    (Vector Store / Mem0 / Zep)      │
├─────────────────────────────────────┤
│ • 안정적 사용자 선호도              │
│ • 모든 세션에 적용되는 하드 제약     │
│ • 신원 정보 (Timezone, 언어, 직무)  │
│ • 이전 세션의 이력 컨텍스트          │
│ • 완료된 작업의 결과 (참조용)        │
└─────────────────────────────────────┘
```

### 2.3 Token Budget Scheduler: 생산 패턴

Context Window에 들어갈 내용을 능동적으로 관리하는 Token Budget Scheduler의 구현:

```typescript
interface MemoryLayer {
  type: 'working' | 'persistent';
  priority: number;       // 0-100
  ttl: number;            // seconds
  maxTokens: number;
  content: string;
}

class TokenBudgetScheduler {
  private workingMemory: MemoryLayer[] = [];
  private readonly MAX_WORKING_TOKENS = 32000;
  private readonly EVICTION_THRESHOLD = 28000;

  /**
   * RAM Layer: 현재 작업에 필요한 최소한만 유지
   * Storage Layer: 세션 경계를 넘는 정보는 외부에 저장
   */
  async processTurn(newContent: string): Promise<string[]> {
    // 1. 새 컨텐츠 추가
    this.workingMemory.push({
      type: 'working',
      priority: this.calculatePriority(newContent),
      ttl: 300,  // 5분 TTL
      maxTokens: this.countTokens(newContent),
      content: this.compressToolResult(newContent)
    });

    // 2. TTL 만료 항목 제거 (eviction)
    this.workingMemory = this.workingMemory.filter(m => {
      if (m.type === 'working' && m.ttl <= 0) {
        this.archiveToPersistent(m);  // Storage로 이동
        return false;
      }
      return true;
    });

    // 3. Token 예산 초과 시 우선순위 기반 압축/제거
    const totalTokens = this.sumTokens(this.workingMemory);
    if (totalTokens > this.EVICTION_THRESHOLD) {
      this.compressLowPriority();
    }

    // 4. Compressed Context 생성
    return this.assembleContext();
  }

  /**
   * Tool Call 결과는 요약해서 저장 (Full Result는 Persistent로)
   */
  private compressToolResult(result: string): string {
    // 핵심 사실만 추출: "무엇을, 결과가 무엇인가"
    const facts = this.extractFacts(result);
    return `[Result Summary] ${facts.join(' | ')}`;
  }

  /**
   * 우선순위 기반 압축:
   * Priority < 30: 제거 (Persistent로 이동)
   * Priority 30-70: 요약 (token 50% 감축)
   * Priority > 70: 유지
   */
  private compressLowPriority(): void {
    const sorted = [...this.workingMemory]
      .sort((a, b) => a.priority - b.priority);
    
    for (const item of sorted) {
      if (item.priority < 30) {
        this.archiveToPersistent(item);
        this.workingMemory = this.workingMemory.filter(m => m !== item);
      } else if (item.priority < 70) {
        item.content = this.summarize(item.content);
        item.maxTokens = Math.floor(item.maxTokens / 2);
      }
    }
  }

  /**
   * Persistent Memory로의 아카이브
   * Mem0, Zep, 또는 직접 Vector Store에 저장
   */
  private async archiveToPersistent(memory: MemoryLayer): Promise<void> {
    await persistMemory({
      content: memory.content,
      metadata: {
        original_priority: memory.priority,
        timestamp: Date.now(),
        session_id: currentSessionId
      },
      ttl: 86400 * 30  // 30일 기본 TTL
    });
  }

  private countTokens(text: string): number {
    // 1 token ≈ 4 chars (approximation)
    return Math.ceil(text.length / 4);
  }

  private sumTokens(layers: MemoryLayer[]): number {
    return layers.reduce((sum, m) => sum + m.maxTokens, 0);
  }
}
```

---

## 3. Multi-Signal Retrieval: Persistent Memory의 검색 엔진

Mem0가 2026년 발표한 새로운 알고리즘의 핵심은 **Multi-Signal Retrieval**이다. 단일 검색 신호(예: 의미 유사도만)에 의존하면 메모리 검색의 precision과 recall이 모두 떨어진다.

### 3.1 세 가지 검색 신호

```python
import numpy as np
from typing import List, Tuple
from sentence_transformers import SentenceTransformer
import re
from collections import Counter

class MultiSignalRetriever:
    """Multi-Signal Retrieval: Semantic + Keyword + Entity Matching"""
    
    def __init__(self, embedding_model: str = "all-MiniLM-L6-v2"):
        self.encoder = SentenceTransformer(embedding_model)
        
    def retrieve(
        self, 
        query: str, 
        memory_store: List[dict],
        top_k: int = 5
    ) -> List[Tuple[dict, float]]:
        """
        세 가지 신호를 병렬로 스코어링하고 융합한다.
        Mem0 2026 알고리즘의 핵심: 단일 신호보다 융합 점수가 항상 우세
        """
        # Signal 1: Semantic Similarity
        query_embedding = self.encoder.encode(query)
        semantic_scores = []
        for mem in memory_store:
            mem_embedding = self.encoder.encode(mem["content"])
            semantic_scores.append(self._cosine_similarity(query_embedding, mem_embedding))
        
        # Signal 2: Keyword Matching (BM25-style)
        keyword_scores = []
        query_terms = set(self._tokenize(query.lower()))
        for mem in memory_store:
            mem_terms = Counter(self._tokenize(mem["content"].lower()))
            score = sum(mem_terms[t] for t in query_terms if t in mem_terms)
            keyword_scores.append(score / max(len(query_terms), 1))
        
        # Signal 3: Entity Matching
        entity_scores = []
        query_entities = self._extract_entities(query)
        for mem in memory_store:
            mem_entities = self._extract_entities(mem["content"])
            overlap = len(query_entities & mem_entities)
            entity_scores.append(overlap / max(len(query_entities), 1))
        
        # Score Fusion: 가중치 정규화 + 융합
        fused_scores = []
        for i in range(len(memory_store)):
            # 각 신호를 [0, 1] 범위로 정규화
            s_sem = self._normalize(semantic_scores, i)
            s_kw = self._normalize(keyword_scores, i)
            s_ent = self._normalize(entity_scores, i)
            
            # 융합: 가중치 0.5 + 0.3 + 0.2
            fused = 0.5 * s_sem + 0.3 * s_kw + 0.2 * s_ent
            fused_scores.append((memory_store[i], fused))
        
        # 상위 k개 반환
        fused_scores.sort(key=lambda x: x[1], reverse=True)
        return fused_scores[:top_k]
    
    def _cosine_similarity(self, a: np.ndarray, b: np.ndarray) -> float:
        return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-8))
    
    def _tokenize(self, text: str) -> List[str]:
        return re.findall(r'\w+', text.lower())
    
    def _extract_entities(self, text: str) -> set:
        # 간단한 NER: 대문자 시작 단어, 숫자, 고유 패턴
        entities = set()
        for token in self._tokenize(text):
            if token[0].isupper() or token.isdigit():
                entities.add(token)
        return entities
    
    def _normalize(self, scores: List[float], idx: int) -> float:
        min_s, max_s = min(scores), max(scores)
        if max_s == min_s:
            return 0.0
        return (scores[idx] - min_s) / (max_s - min_s)
```

### 3.2 벤치마크 결과 (Mem0 2026)

| Benchmark | Score | Avg Tokens/Query | 2025 대비 향상 |
|-----------|-------|-------------------|----------------|
| LoCoMo | **92.5** | 6,956 | +12.3 |
| LongMemEval | **94.4** | 6,787 | +15.7 |
| BEAM (1M) | **64.1** | 6,719 | 신규 |
| BEAM (10M) | **48.6** | 6,914 | 신규 |

가장 큰 향상: **Temporal Reasoning +29.6점**, **Multi-Hop Reasoning +23.1점** — 이 두 카테고리는 실제 사용자 이력 처리에서 가장 중요한 지표다.

---

## 4. Memory Poisoning 방어: OWASP ASI06 대응

2026년 5월, OWASP는 **ASI06: Memory Poisoning**을 Agentic Applications Top 10에 등재했다. 이는 단순 Prompt Injection과는 완전히 다른 위협 클래스다:

```typescript
interface MemoryPoisoningDefense {
  /** 
   * Memory Poisoning Attack Lifecycle:
   * 1. Injection: 악성 명령이 PDF/이메일/지식베이스를 통해 유입
   * 2. Persistence: 작성된 내용이 Long-Term Semantic Memory에 저장
   * 3. Execution: 주/월 후 검색 시 신뢰된 맥락으로 실행
   */
  
  // Layer 1: Cryptographic Baseline (변조 감지)
  async validateIntegrity(memory: MemoryBlob): Promise<boolean> {
    const stored = await readMemory(memory.id);
    const computed = crypto.createHash('sha256')
      .update(JSON.stringify(memory))
      .digest('hex');
    return stored.hash === computed;
  }

  // Layer 2: Temporal Trust Decay
  // 오래되고 검증되지 않은 항목은 검색 시 가중치를 낮춤
  calculateTrustWeight(memory: MemoryBlob): number {
    const ageHours = (Date.now() - memory.createdAt) / 3600000;
    const baseWeight = memory.verified ? 1.0 : 0.5;
    return baseWeight * Math.exp(-ageHours * 0.001);  // 시간에 따른 감쇠
  }

  // Layer 3: Anomaly Detection
  // 급격한 상태 변화, 보호 키 수정, 비정상 크기 팽창 감지
  async detectAnomaly(newMemory: MemoryBlob): Promise<AnomalyResult> {
    const history = await getMemoryHistory(newMemory.userId);
    const recentWrites = history.slice(-10);
    
    const flags: string[] = [];
    
    // 급격한 키 수정 감지
    const protectedKeys = ['identity', 'constraints', 'preferences'];
    for (const key of protectedKeys) {
      const changed = recentWrites.filter(w => w.key === key);
      if (changed.length > 3) {  // 10회 중 3회 이상 수정 = 의심
        flags.push(`PROTECTED_KEY_RAPID_MODIFY:${key}`);
      }
    }
    
    // 비정상 크기 팽창 (JSON/YAML injection payload)
    const avgSize = average(recentWrites.map(w => w.content.length));
    if (newMemory.content.length > avgSize * 5) {
      flags.push('ABNORMAL_SIZE_EXPANSION');
    }
    
    return { isAnomaly: flags.length > 0, flags };
  }
}
```

**Prompt Injection과 Memory Poisoning의 결정적 차이**:

| 구분 | Prompt Injection | Memory Poisoning |
|------|----------------|-----------------|
| 공격 지속성 | Stateless (세션 내) | Persistent (주/월 단위) |
| 탐지 시점 | 동일 세션 내 | 작성 후 수 주 후 |
| 방어 위치 | 입력/출력 검증 | Memory Layer 내부 |
| 영향 범위 | 단일 세션 | Cross-session, Multi-agent |

---

## 5. 통합 아키텍처: Production Memory Manager

실전에서는 위의 모든 패턴을 하나의 Memory Manager로 통합해야 한다:

```python
class ProductionMemoryManager:
    """
    2-Layer Memory + Multi-Signal Retrieval + Security Guard 통합
    
    아키텍처 원칙:
    1. 모든 메모리 쓰기는 Write Guard 통과 필수
    2. 모든 메모리 읽기는 Multi-Signal Retrieval 사용
    3. Context Window는 Token Budget Scheduler가 능동 관리
    4. 보안 위반 의심 시 즉시 격리(quarantine) 및 대체 경로 제공
    """
    
    def __init__(self):
        self.token_scheduler = TokenBudgetScheduler()
        self.retriever = MultiSignalRetriever()
        self.security_guard = MemoryPoisoningDefense()
        self.working_memory: List[MemoryLayer] = []
        self.persistent_store: Dict[str, MemoryBlob] = {}
        
    async def read(self, query: str, context: dict) -> List[dict]:
        """읽기: Multi-Signal Retrieval + Temporal Decay 적용"""
        candidates = await self._load_candidates(context)
        
        # 검색 전 보안 검증
        verified_candidates = []
        for mem in candidates:
            if await self.security_guard.validateIntegrity(mem):
                mem["trust_weight"] = self.security_guard.calculateTrustWeight(mem)
                verified_candidates.append(mem)
        
        # Multi-Signal 검색
        results = self.retriever.retrieve(query, verified_candidates)
        
        # Trust Weight 적용하여 최종 점수 조정
        final = []
        for mem, score in results:
            adjusted = score * mem.get("trust_weight", 1.0)
            final.append((mem, adjusted))
        
        final.sort(key=lambda x: x[1], reverse=True)
        return final[:5]
    
    async def write(self, content: str, metadata: dict) -> WriteResult:
        """쓰기: 이상 탐지 후 검증된 경우만 저장"""
        # 보안 검사
        anomaly = await self.security_guard.detectAnomaly({
            "content": content,
            **metadata
        })
        
        if anomaly.is_anomaly:
            # 의심스러운 메모리는 격리
            await self._quarantine(content, metadata, anomaly.flags)
            return WriteResult(
                status="quarantined",
                reason=f"Security flags: {', '.join(anomaly.flags)}"
            )
        
        # 정상 메모리: SHA-256 해시와 함께 저장
        memory_id = await self._persist(content, metadata)
        return WriteResult(status="stored", memory_id=memory_id)
    
    async def process_turn(self, 
                          user_input: str, 
                          tool_results: List[str]
                          ) -> ProcessResult:
        """매 턴마다 호출: 메모리 관리의 핵심 루틴"""
        # 1. Working Memory 업데이트
        new_layers = []
        for result in tool_results:
            compressed = self.token_scheduler.compressToolResult(result)
            new_layers.append(MemoryLayer(
                type='working',
                priority=self._calc_priority(result),
                content=compressed,
                ttl=300
            ))
        
        # 2. RAM Eviction (TTL 만료 + Token Budget)
        self._evict_expired()
        
        # 3. 사용자 입력에서 중요한 사실 추출 → Persistent에 저장
        important_facts = self._extract_facts(user_input)
        for fact in important_facts:
            await self.write(
                content=fact,
                metadata={"source": "user_input", "timestamp": time.time()}
            )
        
        # 4. 관련 Persistent Memory 검색 → Working에 주입
        relevant_memories = await self.read(user_input, {})
        for mem in relevant_memories[:3]:  # 최대 3개
            self.working_memory.append(MemoryLayer(
                type='working',
                priority=90,  # Persistent에서 검색된 정보: 높은 우선순위
                content=f"[Memory] {mem['content']}",
                ttl=600
            ))
        
        # 5. 압축된 Context Assembly
        context = self.token_scheduler.assemble_context()
        return ProcessResult(context=context, memories_found=len(relevant_memories))
```

---

## 6. 결론: 모델이 아니라 아키텍처다

2026년 현재, AI Agent Memory는 더 이상 "context window에 모든 대화를 집어넣는" 접근법으로 해결할 수 있는 문제가 아니다:

1. **Context Window는 RAM**이다. 확장된다고 Storage가 되지 않는다. Token Budget Scheduler가 명시적으로 관리해야 한다.
2. **Persistent Memory는 Storage**다. Multi-Signal Retrieval로 검색하고, Temporal Trust Decay로 신뢰도를 조정해야 한다.
3. **Memory Poisoning은 현실 위협**이다. 2026년 5월 OWASP가 공식 분류했으며, Memory Layer 자체에서 방어해야 한다.
4. **계량적 증명**이 존재한다: Gamage(2026)의 4,416회 시험은 Omission Constraint가 20턴에서 38.8% 붕괴함을 입증했다.

**단순한 질문 하나로 요약된다**: 당신의 Agent는 Context Window를 RAM으로 쓰고 있는가, Storage로 쓰고 있는가?

---

*참고문헌:*
- Gamage, Y. (2026). "Omission Constraints Decay While Commission Constraints Persist in Long-Context LLM Agents." arXiv:2604.20911
- Mem0 Engineering Team. (2026). "State of AI Agent Memory 2026: Progress Benchmark Report." mem0.ai
- Mem0 Engineering Team. (2026). "Context Window is RAM, Not Storage." mem0.ai
- OWASP. (2026). "Agent Memory Guard" & "ASI06: Memory Poisoning." owasp.org
- Schneider, C. (2026). "Persistent Memory Poisoning in AI Agents."
- Liu, N. et al. (2023). "Lost in the Middle: How Language Models Use Long Contexts." arXiv:2307.03172
