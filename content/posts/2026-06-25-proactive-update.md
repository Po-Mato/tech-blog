---
title: "GraphRAG와 Knowledge Graph-Augmented Generation: 벡터 검색의 한계를 넘는 엔터프라이즈 RAG 아키텍처 (#050)"
date: "2026-06-25"
description: "단순 Vector Similarity Search만으로 RAG를 구축하면 '전체론적 질문(holistic question)'과 '멀티홉 추론'에서 실패한다. Microsoft GraphRAG, LightRAG, 그리고 Neo4j + LLM 기반의 Knowledge Graph Augmented Generation 아키텍처를 TypeScript와 Python 코드와 함께 완전 분석한다. 엔터티 추출, 커뮤니티 탐지, Hierarchical Summarization, Hybrid Retrieval 전략까지 Production 구현 가이드를 담았다."
tags:
  - GraphRAG
  - Knowledge Graph
  - RAG
  - LLM
  - AI Agent
  - Neo4j
  - Vector Database
  - Hybrid Search
  - Microsoft GraphRAG
  - LightRAG
  - Enterprise AI
  - Software Architecture
---

## 1. 들어가며: "왜 우리 RAG는 '회사의 5년 전략'을 답하지 못하는가"

2026년 상반기, 한국 대형 금융사의 AI 플랫폼 팀이 직면한 문제. RAG는 정확히 70%는 동작한다. 그러나 CEO가 던진 이 질문에는 침묵한다.

> "지난 5년간 우리 회사의 **리스크 관리 정책이 어떻게 진화**해왔는지, **어떤 부서가 책임을졌고**, **각 단계에서 어떤 외부 규제**가 영향을 미쳤는지 요약해줘."

단순 Vector Search는 chunk 단위로 검색한다. "리스크 관리 정책"이라는 chunk와 "리스크 관리 부서"라는 chunk가 별개로 검색되면, 이 둘이 **시간축 위에서 어떻게 연결되는지** 추론할 수 없다. Vector Similarity는 **거리**를 재지 **관계**를 모른다.

이 글에서 다루는 GraphRAG는 이 문제의 해법이다. 핵심 아이디어는 단순하다:

> **"텍스트를 vector로 임베딩하기 전에, 먼저 Entity-Relationship 그래프로 변환하라. Retrieval 시점에는 vector와 graph를 함께 query해 '의미적 유사성'과 '구조적 관계'를 동시에 활용하라."**

Microsoft Research의 GraphRAG(Feb 2024) 이후, LightRAG(HKU 2025), nano-graphrag(2025), 그리고 여러 production-grade 변형들이 등장하며 이 패턴은 2026년 현재 Enterprise RAG의 사실상 표준이 되었다.

## 2. 문제 정의: Vector-Only RAG의 네 가지 실패 모드

### 2.1. Holistic Question 실패 (전체론적 질문)

전체 데이터셋에 대한 **요약/집계성 질문**은 chunk retrieval로 답할 수 없다.

```python
# 실패 케이스
query = "이 회사의 모든 제품 라인이 공통으로 갖는 기술적 risk factor는?"
# → 개별 chunk는 'risk factor'를 언급하지만, '모든 라인의 공통'은 chunk에 없음
```

Vector search는 top-k chunk만 반환한다. "모든 라인의 공통" 같은 글로벌 특성은 집계되어 있지 않다.

### 2.2. Multi-Hop 추론 실패 (연쇄 질문)

```python
query = "CFO가 승인한 2024년 M&A 건 중, EU AI Act 영향을 받은 건은?"
# Hop 1: CFO의 M&A 승인 → 특정 deal 목록
# Hop 2: 그 deal 중 EU AI Act 영향 → entity chain
```

Vector similarity는 "CFO + M&A"와 "EU AI Act"를 매칭할 수 있지만, 두 결과를 **같은 deal로 연결**하지 못한다.

### 2.3. Entity Disambiguation 실패 (동명이인)

```python
query = "Apple의 2024년 매출 동향은?"
# → Apple(기업), apple(과일), Apple(앨범) 모두 매칭
```

Chunk 단위에서는 context가 부족해 Apple이 어느 Apple인지 알 수 없다.

### 2.4. Temporal Evolution 실패 (시간 추적)

```python
query = "이 회사의 M&A 정책이 2020년 대비 2024년에 어떻게 변했나?"
# → 시간축을 따라가며 비교해야 함
```

Chunk는 시점 정보를 갖고 있지만, vector similarity는 "시점 변화"를 인식하지 못한다.

## 3. GraphRAG 아키텍처: 5단계 파이프라인

### 3.1. 전체 파이프라인

```
┌──────────────────────────────────────────────────────────────┐
│ Indexing (오프라인, 배치)                                      │
│                                                              │
│  Source Docs (PDF, MD, HTML)                                │
│       ↓                                                      │
│  [1] Chunking (단락/의미 단위 분할)                            │
│       ↓                                                      │
│  [2] Entity & Relation Extraction (LLM)                      │
│       ↓                                                      │
│  [3] Graph Construction (Entity-Edge 구조화)                 │
│       ↓                                                      │
│  [4] Community Detection (Leiden/Louvain)                    │
│       ↓                                                      │
│  [5] Hierarchical Summarization (레벨별 요약)                 │
│       ↓                                                      │
│  [Storage] Neo4j (graph) + Qdrant (vector) + KV (summary)    │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ Query (온라인, 실시간)                                          │
│                                                              │
│  User Query                                                   │
│       ↓                                                      │
│  [A] Query Classification (local vs global)                  │
│       ↓                                                      │
│  [B] Local: Vector Search + Graph Traversal                  │
│      Global: Community Summary Retrieval                     │
│       ↓                                                      │
│  [C] Context Assembly (vector chunks + graph paths + summary)│
│       ↓                                                      │
│  [D] LLM Generation (최종 답변)                                │
└──────────────────────────────────────────────────────────────┘
```

### 3.2. Stage 1: Chunking - 의미 단위 분할

Chunk는 단순 길이 분할이 아니라, **의미 단위**로 분할해야 한다. GraphRAG 표준 권장 chunk size는 600 토큰, overlap 100 토큰이다. GraphRAG는 sliding window 방식보다 **document-level** chunking을 권장한다.

```python
# Python: 의미 단위 chunking
from typing import List
from dataclasses import dataclass
import re

@dataclass
class Chunk:
    text: str
    doc_id: str
    chunk_id: int
    start_offset: int
    end_offset: int
    metadata: dict

def semantic_chunk(text: str, doc_id: str, max_tokens: int = 600) -> List[Chunk]:
    """
    1) 문단 단위로 먼저 분할
    2) 각 문단이 너무 길면 문장 단위로 추가 분할
    3) 마지막에 토큰 수 기반 병합
    """
    chunks = []

    # Step 1: 문단 분할 (\n\n 기준)
    paragraphs = [p.strip() for p in re.split(r'\n\s*\n', text) if p.strip()]

    current_text = ""
    current_offset = 0
    chunk_idx = 0

    for para in paragraphs:
        para_tokens = len(para.split())

        if para_tokens > max_tokens:
            # 문장 단위로 추가 분할
            sentences = re.split(r'(?<=[.!?])\s+', para)
            for sent in sentences:
                if len((current_text + " " + sent).split()) > max_tokens:
                    if current_text:
                        chunks.append(Chunk(
                            text=current_text.strip(),
                            doc_id=doc_id,
                            chunk_id=chunk_idx,
                            start_offset=current_offset,
                            end_offset=current_offset + len(current_text),
                            metadata={},
                        ))
                        chunk_idx += 1
                        current_offset += len(current_text) + 1
                    current_text = sent
                else:
                    current_text = (current_text + " " + sent).strip() if current_text else sent
        else:
            # max_tokens 이하 → 누적
            if len((current_text + " " + para).split()) > max_tokens:
                if current_text:
                    chunks.append(Chunk(
                        text=current_text.strip(),
                        doc_id=doc_id,
                        chunk_id=chunk_idx,
                        start_offset=current_offset,
                        end_offset=current_offset + len(current_text),
                        metadata={},
                    ))
                    chunk_idx += 1
                    current_offset += len(current_text) + 1
                current_text = para
            else:
                current_text = (current_text + "\n\n" + para).strip() if current_text else para

    if current_text:
        chunks.append(Chunk(
            text=current_text.strip(),
            doc_id=doc_id,
            chunk_id=chunk_idx,
            start_offset=current_offset,
            end_offset=current_offset + len(current_text),
            metadata={},
        ))

    return chunks
```

**Self-Critique Note**: 단순 sliding window보다 document-level chunking이 GraphRAG 성능이 더 좋다. 이유는 entity extraction 시 context가 풍부할수록 더 정확한 entity/relation이 추출되기 때문이다.

### 3.3. Stage 2: Entity & Relation Extraction - LLM으로 그래프 만들기

핵심 단계다. LLM이 chunk를 읽고 `(entity, relation, entity)` 트리플을 추출한다.

```python
# OpenAI Structured Outputs 기반 entity extraction
import json
from openai import OpenAI
from pydantic import BaseModel, Field
from typing import List

class Entity(BaseModel):
    name: str = Field(description="Entity name (정규화된 형태)")
    type: str = Field(description="PERSON, ORG, GPE, EVENT, PRODUCT, POLICY, DATE, MONEY, ...")
    description: str = Field(description="이 entity에 대한 짧은 설명")

class Relation(BaseModel):
    source: str = Field(description="Source entity name")
    target: str = Field(description="Target entity name")
    relation: str = Field(description="동사 형태의 관계 (예: 'approved_by', 'acquired', 'reports_to')")
    description: str = Field(description="이 관계에 대한 증거 문장")

class GraphExtraction(BaseModel):
    entities: List[Entity]
    relations: List[Relation]

EXTRACTION_PROMPT = """
당신은 텍스트에서 지식 그래프(Knowledge Graph)를 추출하는 전문가입니다.

주어진 텍스트에서 다음을 수행하세요:
1. 핵심 Entity를 모두 식별 (인물, 조직, 장소, 제품, 정책, 이벤트, 날짜, 금액 등)
2. Entity들 사이의 관계를 식별
3. 각 entity와 relation에 대한 설명을 텍스트에서 직접 근거를 들어 작성

규칙:
- Entity 이름은 정규화된 형태로 (예: "Apple Inc." 또는 "Apple"로 통일, "Apple Inc."와 "Apple Corp"는 별개)
- Description은 텍스트에 명시된 내용만 (추측 금지)
- Relation은 반드시 텍스트에 명시된 연결만
- 하나의 chunk에서 5~20개 entity, 5~30개 relation 추출
"""

def extract_graph_from_chunk(chunk_text: str, client: OpenAI) -> GraphExtraction:
    response = client.beta.chat.completions.parse(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": EXTRACTION_PROMPT},
            {"role": "user", "content": f"다음 텍스트를 분석하세요:\n\n{chunk_text}"},
        ],
        response_format=GraphExtraction,
        temperature=0.0,
    )
    return response.choices[0].message.parsed


# 배치 처리 (동시성 제한)
import asyncio
from asyncio import Semaphore

async def extract_graphs_batch(
    chunks: List[Chunk],
    client: OpenAI,
    concurrency: int = 10,
) -> List[GraphExtraction]:
    sem = Semaphore(concurrency)

    async def extract_one(chunk: Chunk) -> GraphExtraction:
        async with sem:
            # 동기 LLM 호출을 executor에서 실행
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(
                None, extract_graph_from_chunk, chunk.text, client
            )

    return await asyncio.gather(*[extract_one(c) for c in chunks])
```

**Self-Critique Note**: gpt-4o-mini로 entity extraction을 시도하면 비용이 1/15 수준이지만, entity 정규화 일관성이 떨어진다. Entity 이름 정규화는 graph quality의 **single biggest determinant**다. 정규화 일관성이 깨지면 graph traversal이 실패한다. 따라서 gpt-4o 또는 claude-sonnet-4를 권장한다.

### 3.4. Stage 3: Graph Construction - 엔티티 병합과 인덱싱

추출된 트리플은 **같은 entity가 다른 이름으로 등장**할 수 있다. "Apple Inc."와 "Apple"을 병합해야 한다.

```python
# Entity resolution: 이름 정규화 + 임베딩 기반 중복 탐지
import numpy as np
from neo4j import GraphDatabase

class GraphConstructor:
    def __init__(self, neo4j_uri: str, neo4j_user: str, neo4j_password: str):
        self.driver = GraphDatabase.driver(neo4j_uri, auth=(neo4j_user, neo4j_password))

    def merge_graph(self, extractions: List[GraphExtraction]):
        """추출 결과를 Neo4j에 MERGE (중복 자동 병합)"""
        with self.driver.session() as session:
            for ext in extractions:
                for entity in ext.entities:
                    session.execute_write(
                        self._merge_entity,
                        entity.name, entity.type, entity.description,
                    )
                for rel in ext.relations:
                    session.execute_write(
                        self._merge_relation,
                        rel.source, rel.target, rel.relation, rel.description,
                    )

    @staticmethod
    def _merge_entity(tx, name, entity_type, description):
        tx.run("""
            MERGE (e:Entity {name: $name})
            ON CREATE SET e.type = $type, e.description = $description, e.mention_count = 1
            ON MATCH SET e.description = coalesce(e.description, $description),
                          e.mention_count = e.mention_count + 1
        """, name=name, type=entity_type, description=description)

    @staticmethod
    def _merge_relation(tx, source, target, relation, description):
        tx.run("""
            MATCH (s:Entity {name: $source})
            MATCH (t:Entity {name: $target})
            MERGE (s)-[r:REL {type: $relation}]->(t)
            ON CREATE SET r.description = $description, r.weight = 1
            ON MATCH SET r.weight = r.weight + 1
        """, source=source, target=target, relation=relation, description=description)
```

### 3.5. Stage 4: Community Detection - Leiden 알고리즘

GraphRAG의 핵심 차별점이다. 그래프를 **의미적 커뮤니티**(Leiden 알고리즘)로 분할하고, 각 커뮤니티를 요약한다. 이 요약이 "전체론적 질문"에 답한다.

```python
import igraph as ig
import leidenalg as la
from collections import defaultdict

def detect_communities(graph: GraphConstructor, resolution: float = 1.0) -> List[List[str]]:
    """
    Leiden 알고리즘으로 graph를 community로 분할.
    resolution: 1.0 = 기본, 높을수록 더 작은 community
    """
    with graph.driver.session() as session:
        result = session.run("""
            MATCH (e:Entity)-[r:REL]->(t:Entity)
            RETURN e.name AS source, t.name AS target, r.weight AS weight
        """)
        edges = [(r["source"], r["target"], r["weight"]) for r in result]

    # igraph 구성
    g = ig.Graph.TupleList(edges, weights=True)

    # Leiden 알고리즘 적용
    partition = la.find_partition(
        g, la.CPMVertexPartition,
        weights="weight",
        resolution_parameter=resolution,
    )

    # Community별 entity 묶음
    communities = defaultdict(list)
    for node_idx, community_id in enumerate(partition.membership):
        communities[community_id].append(g.vs[node_idx]["name"])

    return list(communities.values())
```

**왜 Leiden인가?** Louvain은 disconnected community를 생성할 수 있다 (한 community가 두 개로 분리되지만 연결되지 않는 문제). Leiden은 이를 보장한다. Microsoft GraphRAG가 Leiden을 채택한 이유다.

### 3.6. Stage 5: Hierarchical Summarization - 레벨별 요약

각 community를 LLM으로 요약하고, community cluster를 다시 요약하는 **계층적 요약**을 만든다. 이 요약이 global question에 활용된다.

```python
SUMMARIZATION_PROMPT = """
당신은 knowledge graph community를 요약하는 전문가입니다.

주어진 entity들과 relation들을 보고, 이 community가 무엇을 나타내는지 200~300 단어로 요약하세요.

요약 형식:
- Community Theme: (한 줄 주제)
- Key Entities: (주요 entity 3~7개)
- Key Relationships: (주요 관계 3~5개)
- Narrative Summary: (자세한 설명)

요약은 보고서 형태로 작성하되, 검색 엔진이 나중에 참고할 수 있도록 정보 밀도를 높이세요.
"""

async def summarize_communities(
    communities: List[List[str]],
    graph: GraphConstructor,
    client: OpenAI,
    concurrency: int = 5,
) -> List[dict]:
    sem = Semaphore(concurrency)
    summaries = []

    async def summarize_one(community: List[str]) -> dict:
        async with sem:
            # community의 entity/relation 조회
            with graph.driver.session() as session:
                result = session.run("""
                    MATCH (e:Entity)-[r:REL]->(t:Entity)
                    WHERE e.name IN $names AND t.name IN $names
                    RETURN e.name AS source, e.type AS source_type,
                           t.name AS target, t.type AS target_type,
                           r.type AS relation, r.description AS description
                """, names=community)
                facts = [dict(r) for r in result]

            facts_text = "\n".join(
                f"- {f['source']} ({f['source_type']}) --[{f['relation']}]--> "
                f"{f['target']} ({f['target_type']}): {f['description']}"
                for f in facts
            )

            loop = asyncio.get_event_loop()
            response = await loop.run_in_executor(
                None,
                lambda: client.chat.completions.create(
                    model="gpt-4o-mini",  # 요약은 mini로 충분
                    messages=[
                        {"role": "system", "content": SUMMARIZATION_PROMPT},
                        {"role": "user", "content": f"Community Facts:\n{facts_text}"},
                    ],
                    temperature=0.0,
                ),
            )

            return {
                "community_id": community[0],  # 첫 entity를 ID로
                "members": community,
                "summary": response.choices[0].message.content,
                "fact_count": len(facts),
            }

    return await asyncio.gather(*[summarize_one(c) for c in communities])
```

**Self-Critique Note**: 요약은 mini 모델로 충분하다. 다만 한 community가 50개 entity를 넘으면 LLM context가 폭발한다. Leiden resolution를 조정해 community 크기를 10~30 entity로 유지하는 것이 운영 노하우다.

## 4. Query Stage: Local vs Global 검색 분기

### 4.1. Query Classification

질문을 두 가지로 분류한다:
- **Local search**: 특정 entity나 사실에 대한 질문 → vector + graph traversal
- **Global search**: 전체/요약/추세에 대한 질문 → community summary retrieval

```python
# TypeScript: Query router
type SearchMode = "local" | "global" | "hybrid";

interface QueryClassification {
  mode: SearchMode;
  entities: string[];
  reasoning: string;
}

const CLASSIFY_PROMPT = `당신은 query를 'local', 'global', 'hybrid'로 분류하는 라우터입니다.

- 'local': 특정 인물/사건/제품/문서에 대한 구체적 사실 질문
  예: "Apple의 2024년 매출은?", "CFO가 누구인가?"
- 'global': 전체 데이터셋에 대한 추세/요약/패턴 질문
  예: "회사의 5년간 정책 변화는?", "주요 risk factor는?"
- 'hybrid': local + global이 모두 필요한 질문
  예: "Apple의 5년간 매출 추세와 그 원인은?"

분류 결과와 추출된 entity name을 JSON으로 반환하세요.`;

async function classifyQuery(
  query: string,
  openai: OpenAI,
): Promise<QueryClassification> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: CLASSIFY_PROMPT },
      { role: "user", content: query },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
  });

  return JSON.parse(response.choices[0].message.content!);
}
```

### 4.2. Local Search: Vector + Graph Traversal

```python
class LocalSearcher:
    def __init__(
        self,
        qdrant_client,  # vector DB
        graph: GraphConstructor,  # Neo4j
        embedder,  # 임베딩 모델
    ):
        self.qdrant = qdrant_client
        self.graph = graph
        self.embedder = embedder

    def search(self, query: str, top_k: int = 10, depth: int = 2) -> dict:
        """
        1) Query를 임베딩 → vector search
        2) Top-k chunk에 등장하는 entity 추출
        3) 그 entity들을 시작점으로 graph를 depth-hop traversal
        4) Vector 결과 + graph context를 결합
        """
        # Step 1: Vector search
        query_vec = self.embedder.encode(query)
        vector_results = self.qdrant.search(
            collection_name="chunks",
            query_vector=query_vec,
            limit=top_k,
        )

        # Step 2: Top chunk에서 entity 추출
        chunk_ids = [r.id for r in vector_results]
        entities = self._extract_entities_from_chunks(chunk_ids)

        # Step 3: Graph traversal
        graph_context = self._traverse_graph(entities, depth=depth)

        # Step 4: 결합
        return {
            "chunks": [
                {"text": r.payload["text"], "score": r.score, "doc_id": r.payload["doc_id"]}
                for r in vector_results
            ],
            "graph": graph_context,
            "entities": entities,
        }

    def _traverse_graph(self, entity_names: List[str], depth: int = 2) -> List[dict]:
        """Neo4j에서 depth-hop traversal"""
        with self.graph.driver.session() as session:
            result = session.run("""
                MATCH path = (start:Entity)-[*1..%d]-(related:Entity)
                WHERE start.name IN $names
                RETURN
                    [n IN nodes(path) | n.name] AS path_nodes,
                    [r IN relationships(path) | r.type] AS path_relations,
                    length(path) AS hops
                LIMIT 100
            """ % depth, names=entity_names)

            paths = []
            for r in result:
                paths.append({
                    "nodes": r["path_nodes"],
                    "relations": r["path_relations"],
                    "hops": r["hops"],
                })
            return paths
```

### 4.3. Global Search: Community Summary Retrieval

```python
class GlobalSearcher:
    def __init__(self, qdrant_client, embedder):
        self.qdrant = qdrant_client
        self.embedder = embedder

    def search(self, query: str, top_k: int = 10) -> List[dict]:
        """
        Community summary collection에 대해 vector search.
        각 community의 narrative summary가 chunk로 저장되어 있다.
        """
        query_vec = self.embedder.encode(query)
        results = self.qdrant.search(
            collection_name="community_summaries",
            query_vector=query_vec,
            limit=top_k,
        )
        return [
            {
                "community_id": r.payload["community_id"],
                "summary": r.payload["summary"],
                "members": r.payload["members"],
                "score": r.score,
            }
            for r in results
        ]
```

### 4.4. Final Answer Generation

```python
def assemble_context(local_result: dict, global_result: List[dict], query: str) -> str:
    parts = []

    # Global summaries
    if global_result:
        parts.append("=== Global Context (Community Summaries) ===")
        for i, g in enumerate(global_result, 1):
            parts.append(f"[Community {i}] {g['summary']}")

    # Local chunks
    if local_result.get("chunks"):
        parts.append("\n=== Local Context (Relevant Documents) ===")
        for i, c in enumerate(local_result["chunks"], 1):
            parts.append(f"[Doc {i}] {c['text'][:500]}...")

    # Graph paths
    if local_result.get("graph"):
        parts.append("\n=== Graph Relations ===")
        for p in local_result["graph"][:20]:  # 상위 20개
            nodes_str = " -> ".join(p["nodes"])
            rels_str = " -> ".join(p["relations"])
            parts.append(f"Path ({p['hops']} hops): {nodes_str}  [relations: {rels_str}]")

    return "\n\n".join(parts)


def generate_answer(query: str, context: str, client: OpenAI) -> str:
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {
                "role": "system",
                "content": (
                    "당신은 knowledge graph와 document context를 종합해 답변하는 "
                    "정확한 분석가입니다. Context에 명시된 정보만 사용하고, "
                    "추측은 명시적으로 표시하세요. 시간적 관계는 '먼저', '이후' 등으로 "
                    "명확히 서술하세요."
                ),
            },
            {
                "role": "user",
                "content": f"Context:\n{context}\n\n질문: {query}",
            },
        ],
        temperature=0.1,
    )
    return response.choices[0].message.content
```

## 5. Hybrid Retrieval 전략: Reciprocal Rank Fusion

Local과 Global 결과가 모두 있을 때, 어떻게 통합할까? 단순 concat이 아니라 **Reciprocal Rank Fusion(RRF)**이 효과적이다.

```python
def reciprocal_rank_fusion(
    result_lists: List[List[dict]],
    k: int = 60,
) -> List[dict]:
    """
    여러 retrieval 결과 리스트를 RRF로 통합.
    각 result는 'id' 필드를 가져야 함.
    """
    scores: dict = defaultdict(float)
    items: dict = {}

    for results in result_lists:
        for rank, item in enumerate(results, 1):
            item_id = item.get("id") or item.get("chunk_id") or item.get("community_id")
            scores[item_id] += 1.0 / (k + rank)
            items[item_id] = item

    # 점수 기준 정렬
    ranked = sorted(scores.items(), key=lambda x: -x[1])
    return [{**items[item_id], "rrf_score": score} for item_id, score in ranked]
```

**k=60이 기본값인 이유**: TREC 실험에서 60이 가장 robust한 결과를 보였다. 너무 작으면 high-rank에 과도한 가중치, 너무 크면 rank 차이가 무시된다.

## 6. Production 운영 노하우

### 6.1. Incremental Indexing

대용량 corpus를 처음부터 rebuild하지 말고, **incremental update**를 구현한다.

```python
def incremental_update(
    graph: GraphConstructor,
    new_chunks: List[Chunk],
    client: OpenAI,
):
    """
    새 chunk가 들어올 때마다:
    1) Entity/relation 추출
    2) 기존 graph에 MERGE
    3) 영향받은 community만 re-summarize
    """
    extractions = extract_graphs_batch(new_chunks, client)
    graph.merge_graph(extractions)

    # 영향받은 community 식별 (변경된 entity가 속한 community)
    affected_communities = set()
    for ext in extractions:
        for entity in ext.entities:
            community_id = get_community_for_entity(graph, entity.name)
            if community_id is not None:
                affected_communities.add(community_id)

    # 영향받은 community만 재요약
    for comm_id in affected_communities:
        members = get_community_members(graph, comm_id)
        new_summary = summarize_community(members, graph, client)
        update_community_summary(graph, comm_id, new_summary)
```

### 6.2. Cost Engineering

GraphRAG는 vector-only RAG보다 3~10배 비싸다. 비용 최적화 포인트:

| 단계 | 비용 절감 전략 | 절감률 |
|------|---------------|--------|
| Entity extraction | gpt-4o-mini + cache-friendly chunking | -60% |
| Embedding | chunk embedding만 (entity는 graph에서) | -40% |
| Community summary | mini 모델 + 200-word cap | -80% |
| Incremental update | 전체 rebuild 대신 영향 community만 | -95% |
| Query-time | local/global 분기로 불필요한 retrieval 회피 | -50% |

전체적으로 **5~15배 비용 절감**이 가능하다. 그러나 처음부터 mini 모델로 시작하면 entity 정규화 품질이 떨어지므로, gpt-4o로 시작 → 품질 검증 → mini로 점진 전환을 권장한다.

### 6.3. Evaluation: GraphRAG Score

GraphRAG의 품질을 평가하려면 다음 메트릭을 함께 추적한다:

```python
@dataclass
class GraphRAGEvalMetrics:
    # Retrieval 품질
    context_precision: float      # 검색된 chunk가 실제 relevant인가
    context_recall: float         # 모든 relevant chunk가 검색되었는가
    graph_path_relevance: float   # graph path가 질문과 관련 있는가

    # Generation 품질
    answer_relevance: float       # 답변이 질문과 관련 있는가
    answer_factualness: float     # 답변이 사실에 기반하는가 (할루시네이션 비율)

    # Holistic / Multi-hop 능력
    holistic_accuracy: float      # 'global' 질문 정확도
    multihop_accuracy: float      # 'multi-hop' 질문 정확도

    # 운영 메트릭
    indexing_throughput: float   # chunks per second
    query_latency_p99: float     # ms
    cost_per_query_usd: float
```

## 7. Self-Critique: GraphRAG의 한계와 반론

이 글의 자가 검토 결과를 정리한다.

### 7.1. 강점

- **Holistic question**: community summary가 global view를 제공해 vector-only RAG가 실패하는 영역을 해결
- **Multi-hop**: graph traversal이 entity chain을 따라가며 multi-hop 추론 가능
- **Disambiguation**: entity normalization이 동명이인 문제 해결
- **Explainability**: graph path가 답변의 reasoning path를 시각화

### 7.2. 약점과 Trade-off

1. **Indexing 비용**: vector-only RAG 대비 5~10배 비싸다. 100만 chunk corpus는 초기 indexing에 수백만 원의 LLM 비용이 든다.
2. **신선도 문제**: entity extraction이 batch로 동작하므로 실시간 새로 들어오는 문서의 반영에 latency가 있다. Incremental update로 완화하지만 복잡도가 증가한다.
3. **Graph quality = LLM quality**: entity 정규화 일관성이 graph quality의 single biggest determinant. 모델 업그레이드 시 graph rebuild가 필요할 수 있다.
4. **Schema rigidity**: typed entity (PERSON, ORG, GPE...)는 강력하지만, 도메인 특화 entity type이 필요할 때 매번 prompt를 수정해야 한다.
5. **Community drift**: incremental update 시 community 구조가 drift할 수 있다. 주기적 full rebuild가 필요하다.

### 7.3. 언제 GraphRAG가 필요한가?

판단 기준:

| 신호 | GraphRAG 필요 |
|------|---------------|
| 단순 factoid 질문 위주 | ❌ Vector-only로 충분 |
| "왜?", "어떻게 변화했나?" 질문 多 | ✅ GraphRAG |
| 문서 간 cross-reference 多 | ✅ GraphRAG |
| 도메인 entity가 명확하고 고정 | ✅ GraphRAG |
| 실시간 streaming 데이터 | ❌ Vector-only + buffer |
| 예산 제한적 (<$1k/월) | ❌ Vector-only 우선 |

## 8. Production 적용 로드맵

### Phase 1 (1~2주): Foundation

- Vector DB (Qdrant, Milvus, pgvector) 셋업
- Embedding 모델 선정 (OpenAI text-embedding-3-small 또는 한국어 모델 like ko-sroberta)
- 단순 chunk embedding + vector search 기반 RAG
- Baseline 정확도 측정

### Phase 2 (2~4주): Graph Layer

- Neo4j 또는 FalkorDB 셋업
- Entity extraction 파이프라인 구축
- 100개 chunk로 graph quality 사전 검증
- chunk ↔ entity 매핑 인덱스 구축

### Phase 3 (4~6주): Community Layer

- Leiden 알고리즘 통합
- Community summary 생성
- Global search 구현
- Hybrid search (RRF) 통합

### Phase 4 (6~8주): Production Hardening

- Incremental update 파이프라인
- Cost monitoring & alerts
- Eval pipeline (holistic + multi-hop test set)
- A/B 테스트: vector-only vs GraphRAG

### Phase 5 (8주+): Scale

- Full corpus indexing
- Query latency 최적화
- Graph schema evolution 관리
- Multi-tenant 분리

## 9. 결론: Graph는 RAG의 '두 번째 차원'이다

2024년 RAG가 등장했을 때, 모든 시스템은 "의미적 유사성"만으로 작동했다. 그러나 production 운영 경험이 쌓이면서 명확해진 사실이 있다.

> **"단순 vector similarity는 '관련된 문서'를 찾을 뿐, '문서들 사이의 관계'를 이해하지는 못한다."**

GraphRAG는 이 한계를 메운다. Entity-Relationship 그래프가 **구조적 기억**을, vector embedding이 **의미적 기억**을 담당한다. 두 기억을 함께 query하는 것이 2026년 enterprise RAG의 표준이 되었다.

핵심 교훈 세 가지:

1. **Chunk retrieval이 아닌 graph traversal로 multi-hop을 풀어라.** "A의 B" 같은 질문은 chain으로 풀어야 한다.
2. **Global 질문은 community summary로 답하라.** 집계/추세/패턴은 chunk에 없고 graph의 상위 구조에 있다.
3. **Entity 정규화 품질이 모든 것을 결정한다.** LLM 모델 선정보다 정규화 후처리에 더 많은 시간을 써라.

GraphRAG는 "더 복잡한 RAG"가 아니다. **벡터 공간이 놓치는 관계 정보를 복원하는 RAG**다. RAG가 단순 검색에서 추론 시스템으로 진화하려면 graph는 필수다. 다음 시리즈에서는 **GraphRAG의 실시간 incremental indexing**과 **Streaming RAG with Temporal Graphs**를 다룰 예정이다.

---

*참고: 이 글의 예제 코드는 개념 증명 수준이다. 실전 도입 시에는 (1) entity 정규화 후처리 alias map 관리, (2) graph schema versioning, (3) community summary의 staleness 감지, (4) cost guardrail (월 $X 초과 시 alert) 등이 추가로 필요하다.*

---

## Appendix A: Storage Layout

```
Qdrant Collections:
  - chunks: {id, vector, text, doc_id, chunk_id, entities[]}
  - community_summaries: {id, vector, community_id, summary, members[]}

Neo4j Nodes:
  - (:Entity {name, type, description, mention_count, embedding})

Neo4j Relations:
  - (:Entity)-[:REL {type, description, weight, evidence[]}]->(:Entity)

PostgreSQL (metadata):
  - documents: {id, source, indexed_at, version}
  - chunking_jobs: {id, status, started_at, completed_at}
  - community_summaries: {community_id, level, summary, version, generated_at}
```

## Appendix B: GraphRAG 운영 체크리스트

| 항목 | 권장 | 비고 |
|------|-----|------|
| Chunk size | 600 tokens | overlap 100 |
| Entity extraction model | gpt-4o 또는 claude-sonnet-4 | 정규화 일관성 우선 |
| Embedding model | text-embedding-3-small (1024d) | 한국어는 ko-sroberta 검토 |
| Community detection | Leiden, resolution 1.0 | community 크기 10~30 |
| Summary model | gpt-4o-mini | 200~300 words cap |
| Vector search top_k | local 10, global 10 | RRF로 통합 |
| Graph traversal depth | 2 hops | 너무 깊으면 noise |
| Incremental update | 영향 community만 재요약 | 주 1회 full rebuild 검토 |
| Cost guardrail | $X/월 초과 시 fallback to vector-only | production 필수 |
