---
title: "AI Agent의 영속적 메모리: 2026년 새로운 표준 아키텍처 3가지와 SQLite 기반 Minimal 구현"
date: 2026-04-26
description: "Vector Database頼りの RAG에서 벗어나, SQLite + FTS5 + Durable Objects로 AI Agent에게 '기억'을 부여하는 2026년형 영속적 메모리 아키텍처를 Cloudflare Agent Memory, Google ADK, Engram 3가지 실제 구현체로 비교 분석하고, 완전한 SQLite 기반 Minimal Memory Agent를 코드와 함께 제시한다."
tags:
  - AI Agent
  - Persistent Memory
  - SQLite
  - Cloudflare
  - Architecture
  - LLM
  - Agent Infrastructure
  - MCP
  - Vectorize
  - Production
---

## TL;DR

- **"Embeddings万能時代"의 종말**: 2026년, Semantic Search 단독이 agent memory에 부적합하다는 인식이 확산되고 있다
- **목적별 스토어 분리**: episodic(경험) / semantic(지식) / working(작업上下文)로 메모리 계층을 물리적으로 분리해야 한다
- **Cloudflare Agent Memory**: Durable Objects + SQLite + Vectorize 조합으로 agent별隔离 + ACID 보장
- **Google ADK Always On Memory Agent**: Gemini 3.1 Flash-Lite 기반의 external memory layer 패턴
- **Engram**: Go binary + SQLite FTS5 + MCP server로 Agent-agnostic한 메모리 시스템
- **자가 검토 결론**: "Simple is correct" — 복잡한 벡터 스토어보다 SQLite FTS5 BM25가 agent memory의 근본 문제에 더 잘 부합한다

---

## 1. 서론: 왜 AI Agent에게 '기억'이 문제인가

2025년 말을 기점으로 AI Agent가 Production에 본격 도입되면서, 하나의 근본적 한계가 다시 부각되고 있다.

> **"LLM은 stateless다. 그러나 Agent는 stateful해야 한다."**

Agent가 하는 일은 단순히 질의에 답하는 것이 아니다:

- 사용자의 선호도를 기억하고个性化해야 한다
- 이전 작업 결과를 참조하여 연속적 태스크를 수행해야 한다
- 프로젝트 맥락을 축적하여 시간이 지날수록 더 똑똑해져야 한다

기존의 접근은 벡터 데이터베이스에 모든 것을 때려넣는 것이었다. 이 패턴의 문제점은 명확하다:

| 문제 | 설명 |
|------|------|
| **高昂한 비용** | Pinecone, Weaviate 등의 managed vector DB는 GB당 월 $70+ |
| **의미적 검색의 한계** | "작년 3월에 John이 요청한 기능" 같은 시간순서 검색은 의미적 유사도로 풀 수 없다 |
| **지속적 업데이트 비용** | Embedding recalculation은 전체 pipeline cost의 30~40% |
| **복잡한 infrastructure** | Embedding 모델 + Vector DB + 메타데이터 스토어 + 동기화 레이어 |

2026년, 이 문제를 근본적으로 재설계하는 세 가지 아키텍처가 Production에서 검증되고 있다.

---

## 2. Cloudflare Agent Memory: Durable Objects + SQLite + Vectorize

### 2-1 전체 아키텍처

Cloudflare는 2026년 4월, Workers 플랫폼 위에 **Agent Memory**를 정식 공개했다. 구조는 놀라울 정도로 단순하다:

```
┌─────────────────────────────────────────────────────┐
│                    AI Agent                          │
│  (Workers AI / Gemini / Claude / any LLM)          │
└────────────────┬────────────────────────────────────┘
                 │ HTTP / WebSocket
┌────────────────▼────────────────────────────────────┐
│         Durable Object: Agent Memory                  │
│  ┌─────────────────┐  ┌──────────────────────────┐  │
│  │  SQLite (D1)    │  │  Vectorize               │  │
│  │  - episodic mem  │  │  - semantic search      │  │
│  │  - agent config  │  │  - knowledge base      │  │
│  │  - task state    │  │                         │  │
│  └─────────────────┘  └──────────────────────────┘  │
│  Durable Objects =-instance per agent =isolation    │
└─────────────────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────┐
│              R2 Storage (future)                    │
│  - snapshots, long-term archive                    │
└─────────────────────────────────────────────────────┘
```

### 2-2 핵심 설계 결정: Agent별隔离

가장 중요한 설계 결정은 각 Agent에 대한 **Durable Object instance가 1:1로 할당**된다는 것이다.

```typescript
// Cloudflare Agent Memory 접근 패턴
// 각 agent는 자신만의 Durable Object instance와 통신
class AgentMemory extends DurableObject {
  async addMemory(content: string, metadata: MemoryMeta) {
    // SQLite: 정확한 사실 저장 (ACID 보장)
    await this.storage.sql.exec(
      `INSERT INTO episodic_memory (content, timestamp, tags)
       VALUES (?, ?, ?)`,
      [content, Date.now(), JSON.stringify(metadata)]
    );

    // Vectorize: 의미적 검색용
    const embedding = await this.env.ai.run('@cf/baai/bge-base-en-v1.5', {
      text: [content]
    });
    await this.env.vectorize.insert(embedding[0], {
      id: crypto.randomUUID(),
      content
    });
  }
}
```

**왜 이 설계가 중요한가**:

- **ACID 보장**: SQLite의 트랜잭션이 메모리 읽기/쓰기의 일관성을 보장한다. 벡터 DB는 eventual consistency 모델이 기본이다.
- **Isolation =简单化**: Agent A의 메모리가 Agent B에 영향을 주지 않으므로, 메모리 관리 코드가 크게 단순화된다.
- **Cold Start 없음**: Durable Objects는 항상 메모리 상태를 유지한다. Agent가 재시작해도 이전 컨텍스트가 살아 있다.

### 2-3 Durable Objects의 한계와 이해

Durable Objects는 **단일 인스턴스 접근**이 핵심이다:

```typescript
// ❌ 잘못된 패턴: 여러 agent가 하나의 DO를 공유
const memory = new AgentMemory(env, { id: 'shared-memory' });

// ✅ 올바른 패턴: Agent마다 고유 ID
const memory = new AgentMemory(env, { id: `agent-${agentId}` });
```

이는 Cloudflare의 **co-location 모델** 때문이다. 하나의 DO instance는 하나의 Worker에 co-locate되며, 이 인스턴스에 대한 모든 요청은 같은 데이터센터에서 처리된다.

---

## 3. Google ADK: Always On Memory Agent 패턴

### 3-1 아키텍처 개요

Google은 Cloudflare와 거의 같은 시기에 **Always On Memory Agent**를 ADK(Agent Development Kit)를 통해 공개했다.Architecture적으로는 크게 다르지 않지만, 설계 철학에 차이가 있다:

```
┌─────────────────────────────────────────────────────┐
│        Google ADK Application                       │
│  ┌───────────────────────────────────────────────┐  │
│  │           Agent Controller                    │  │
│  │  - task decomposition                         │  │
│  │  - tool orchestration                         │  │
│  │  - memory management                          │  │
│  └───────────────────────────────────────────────┘  │
│         ▲                    ▲                     │
│         │  Gemini 3.1       │  Memory Layer        │
│         │  Flash-Lite       │  (Always On)         │
│         ▼                    ▼                     │
│  ┌──────────────┐    ┌──────────────────────────┐ │
│  │ LLM Inference │    │ External Memory Store    │ │
│  │ (Vertex AI)   │    │ - SQLite (episodic)      │ │
│  │               │    │ - Vector DB (semantic)    │ │
│  │               │    │ - Config Store ( prefs)  │ │
│  └──────────────┘    └──────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### 3-2 Memory Layer의 계층 구조

Google ADK의 메모리 시스템은 **세 개의 분리된 계층**으로 설계된다:

```python
# google/adk/memory/layered_memory.py (개념적 구조)

class LayeredMemory:
    """
    세 개의 메모리 계층:
    1. Working Memory - 현재 세션의 직접적 컨텍스트 (context window)
    2. Episodic Memory - 과거 경험/대화 (SQLite 기반)
    3. Semantic Memory - 구조화된 지식/사실 (Vector DB 기반)
    """

    def __init__(self, agent_id: str):
        self.working  = WorkingMemory(window_tokens=128_000)
        self.episodic = EpisodicMemory(agent_id, backend="sqlite")
        self.semantic = SemanticMemory(agent_id, backend="vectorize")

    def recall(self, query: str, max_results: int = 10) -> List[MemoryItem]:
        """了三 계층에서 동시에 검색 → fused results"""
        episodic = self.episodic.search(query, max=5)
        semantic = self.semantic.search(query, max=5)

        # Working memory는 항상 전체 포함
        working = self.working.get_all()

        return self._fuse_and_rank(working, episodic, semantic)
```

### 3-3 세 계층의职责 분리

| 계층 | 저장소 | 내용 | 검색 방식 |
|------|--------|------|----------|
| **Working** | In-memory (LLM context) | 현재 세션의 최근 대화/작업 | 순서 그대로 삽입 |
| **Episodic** | SQLite | 과거 대화 요약, 태스크 완료 기록 | FTS5 / BM25 |
| **Semantic** | Vector DB | 문서, 지식 베이스,的事实 | Cosine similarity |

**핵심 규칙**: 각 계층은 **职责가 다르므로 서로 다른 검색 엔진**을 사용해야 한다. Semantic-search로 episodic memory를 검색하는 것은 성능과 정확도 양면에서 손해다.

---

## 4. Engram: Agent-Agnostic SQLite + FTS5 + MCP

### 4-1 Engram의 설계 철학

Engram은 위 두巨인의方案과 가장 크게 다른 점이 있다:

> **"메모리 시스템은 Agent에 묶이지 말아야 한다."**

Engram은 Go로 작성된 단일 바이너리로, MCP(Model Context Protocol) 서버를 통해 **모든 AI 도구에서 동일한 메모리에 접근**할 수 있게 한다.

```
┌──────────────┐     ┌─────────────┐     ┌──────────────┐
│   Claude     │     │   Cursor    │     │  Windsurf    │
│   Desktop    │     │   AI        │     │  AI          │
└──────┬───────┘     └──────┬──────┘     └──────┬───────┘
       │ MCP                │ MCP                │ MCP
       └─────────────────────┼───────────────────┘
                             │
                    ┌────────▼────────┐
                    │  Engram Server   │
                    │  (MCP Server)    │
                    │  ┌───────────┐  │
                    │  │ SQLite    │  │
                    │  │ + FTS5    │  │
                    │  │ + BM25    │  │
                    │  └───────────┘  │
                    └─────────────────┘
```

### 4-2 FTS5 BM25: 벡터 검색을 대체하는 선택

Engram의 가장 흥미로운 결정은 **벡터 검색을 사용하지 않는다는 것**이다. 대신 SQLite의 **FTS5(Full-Text Search) 익스텐션**과 **BM25 알고리즘**을 활용한다.

```sql
-- Engram의 메모리 테이블 스키마
CREATE VIRTUAL TABLE memories USING fts5(
    content,
    project,
    tags,
    created_at,
    content='memory_content',
    content_rowid='id'
);

-- BM25 기반 검색 (벡터 유사도 대신)
SELECT id, content, project, tags,
       bm25(memories, ?, 10.0, 2.0) AS score
FROM memories
WHERE memories MATCH ?
  AND project = ?
ORDER BY score ASC
LIMIT 5;
```

**BM25 vs. Vector Similarity**:

| 기준 | BM25 (FTS5) | Vector Similarity |
|------|-------------|-------------------|
| **정확도** | 키워드 매칭에 최적 | 의미적 유사도에 최적 |
| **속도** | O(log n) - 매우 빠름 | O(n·d) - 벡터 차원에 의존 |
| **비용** | SQLite만 필요 (무료) | Embedding 모델 + 벡터 DB |
| **파라미터 조정** | b, k1 파라미터로 조절 | 임베딩 차원, 거리 함수 |
| **검색 가능한 내용** | 텍스트 자체를 인덱싱 | 텍스트의 의미를 벡터로 변환 |

**Engram의 결론**: Agent의 메모리 문제는 "의미가 비슷한 텍스트를 찾아라"가 아니라 **"내가 원하는 정확한 경험을 가진 기록을 찾아라"**이다. BM25가 이 문제에 더 적합하다.

### 4-3 Engram의 CLI/TUI 구조

```bash
# Engram CLI 사용 예시
engram add "사용자가 선호하는 디자인 시스템은 Tailwind입니다"
engram search "디자인 시스템" --project my-project
engram list --tag design --limit 10

# MCP 서버로 실행 (Claude, Cursor 등이 메모리에 접근)
engram mcp-server --port 8080
```

---

## 5. 세方案的 비교 분석

| 기준 | Cloudflare Agent Memory | Google ADK | Engram |
|------|----------------------|------------|--------|
| **스토어** | SQLite(D1) + Vectorize | SQLite + Vector DB | SQLite FTS5 only |
| **Runtime** | Cloudflare Workers | Vertex AI |任何地方 |
| **Isolation** | Durable Objects | Agent별隔离 | Project별隔离 |
| **검색 엔진** | Vector similarity | Vector + 계층별 hybrid | BM25 (FTS5) |
| **Protocol** | HTTP/WebSocket | ADK SDK | MCP |
| **비용** | Workers 요금만 | Vertex AI 요금 | бесплатный |
| **확장성** | Durable Objects 한계 | Cloud dependent | Local-first |
| **적합한 용도** | 글로벌 프로덕션 | Google 생태계 | Local/Custom |

---

## 6. Minimal 구현: SQLite Only Agent Memory Agent

세方案的 공통점을抽出하면, 어떤 클라우드나ベクトル DB에도依存하지 않는 **순수 SQLite 기반 Agent Memory**를 구현할 수 있다.

### 6-1 데이터 모델

```sql
-- 메모리 테이블 설계
CREATE TABLE IF NOT EXISTS memories (
    id          TEXT PRIMARY KEY,
    content     TEXT NOT NULL,
    memory_type TEXT NOT NULL CHECK(memory_type IN ('episodic', 'semantic', 'config')),
    project     TEXT,
    tags        TEXT,          -- JSON array
    metadata    TEXT,          -- JSON object
    created_at  INTEGER NOT NULL,
    accessed_at INTEGER NOT NULL,
    access_count INTEGER DEFAULT 0
);

-- FTS5 인덱스 (BM25 검색용)
CREATE VIRTUAL TABLE memories_fts USING fts5(
    content,
    content='memories',
    content_rowid='id'
);

-- TTL 관리: 90일 이상 접근되지 않은 메모리 자동 정리
CREATE INDEX IF NOT EXISTS idx_memories_accessed
ON memories(accessed_at, memory_type);
```

### 6-2 Go 구현체 (Engram 스타일)

```go
// memory/memory.go
package memory

import (
    "database/sql"
    "encoding/json"
    "time"

    _ "github.com/mattn/go-sqlite3"
)

type Memory struct {
    ID         string            `json:"id"`
    Content    string            `json:"content"`
    MemoryType string            `json:"memory_type"`
    Project    string            `json:"project,omitempty"`
    Tags       []string          `json:"tags,omitempty"`
    Metadata   map[string]interface{} `json:"metadata,omitempty"`
    CreatedAt  int64             `json:"created_at"`
    AccessedAt int64             `json:"accessed_at"`
    AccessCount int              `json:"access_count"`
}

type Store struct {
    db *sql.DB
}

func New(dbPath string) (*Store, error) {
    db, err := sql.Open("sqlite3", dbPath)
    if err != nil {
        return nil, err
    }

    if err := initSchema(db); err != nil {
        return nil, err
    }

    return &Store{db: db}, nil
}

func initSchema(db *sql.DB) error {
    schema := `
    CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        memory_type TEXT NOT NULL,
        project TEXT,
        tags TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        accessed_at INTEGER NOT NULL,
        access_count INTEGER DEFAULT 0
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(content);
    CREATE INDEX IF NOT EXISTS idx_memories_accessed ON memories(accessed_at, memory_type);
    `
    _, err := db.Exec(schema)
    return err
}

func (s *Store) Add(m Memory) error {
    tagsJSON, _ := json.Marshal(m.Tags)
    metaJSON, _ := json.Marshal(m.Metadata)
    now := time.Now().UnixMilli()

    tx, err := s.db.Begin()
    if err != nil {
        return err
    }
    defer tx.Rollback()

    _, err = tx.Exec(`
        INSERT INTO memories (id, content, memory_type, project, tags, metadata, created_at, accessed_at, access_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        m.ID, m.Content, m.MemoryType, m.Project, string(tagsJSON), string(metaJSON), now, now)
    if err != nil {
        return err
    }

    _, err = tx.Exec(`INSERT INTO memories_fts(rowid, content) VALUES ((SELECT rowid FROM memories WHERE id = ?), ?)`, m.ID, m.Content)
    if err != nil {
        return err
    }

    return tx.Commit()
}

// SearchFTS: BM25 기반 FTS5 검색
func (s *Store) SearchFTS(query string, project string, limit int) ([]Memory, error) {
    sqlQuery := `SELECT id, content, memory_type, project, tags, metadata, created_at, accessed_at, access_count
                 FROM memories m
                 WHERE memories_fts MATCH ?
                   AND (? = '' OR m.project = ?)
                 ORDER BY bm25(memories_fts, ?) ASC
                 LIMIT ?`

    rows, err := s.db.Query(sqlQuery, query, project, project, query, limit)
    if err != nil {
        return nil, err
    }
    defer rows.Close()

    var results []Memory
    for rows.Next() {
        var m Memory
        var tagsJSON, metaJSON string
        rows.Scan(&m.ID, &m.Content, &m.MemoryType, &m.Project, &tagsJSON, &metaJSON, &m.CreatedAt, &m.AccessedAt, &m.AccessCount)
        json.Unmarshal([]byte(tagsJSON), &m.Tags)
        json.Unmarshal([]byte(metaJSON), &m.Metadata)
        results = append(results, m)
    }

    // access tracking
    s.db.Exec(`UPDATE memories SET accessed_at = ?, access_count = access_count + 1 WHERE id IN (?, ?, ...)`)

    return results, nil
}

// CleanupTTL: 90일 이상 미접근 메모리 삭제
func (s *Store) CleanupTTL(days int) (int, error) {
    cutoff := time.Now().AddDate(0, 0, -days).UnixMilli()
    result, err := s.db.Exec(`DELETE FROM memories WHERE accessed_at < ?`, cutoff)
    if err != nil {
        return 0, err
    }
    count, _ := result.RowsAffected()
    return int(count), nil
}
```

### 6-3 MCP Server 통합

```go
// mcp/server.go - Engram 스타일 MCP 서버
package main

import (
    "encoding/json"
    "net/http"

    "github.com/gentleman-programming/engram/memory"
)

type MCPRequest struct {
    Method string          `json:"method"`
    Params json.RawMessage `json:"params"`
}

func main() {
    store, _ := memory.New("./engram.db")

    http.HandleFunc("/mcp", func(w http.ResponseWriter, r *http.Request) {
        var req MCPRequest
        json.NewDecoder(r.Body).Decode(&req)

        switch req.Method {
        case "memory_add":
            var p struct{ Content, Project string; Tags []string }
            json.Unmarshal(req.Params, &p)
            store.Add(memory.Memory{
                ID:         generateID(),
                Content:    p.Content,
                MemoryType: "episodic",
                Project:    p.Project,
                Tags:       p.Tags,
            })
            json.NewEncoder(w).Encode(map[string]bool{"success": true})

        case "memory_search":
            var p struct{ Query, Project string; Limit int }
            json.Unmarshal(req.Params, &p)
            results, _ := store.SearchFTS(p.Query, p.Project, p.Limit)
            json.NewEncoder(w).Encode(results)
        }
    })

    http.ListenAndServe(":8080", nil)
}
```

---

## 7. 실무 적용 시 고려사항

### 7-1 어떤方案을 언제 선택할 것인가

```
선택 트리:

├─ 비용 예산이 제한적인가?
│   └─ Yes → Engram (SQLite only, 무료)
│
├─ 글로벌하게 분산된 Agent 인프라인가?
│   └─ Yes → Cloudflare Agent Memory
│
├─ Google Cloud / Vertex AI 생태계인가?
│   └─ Yes → Google ADK Always On Memory
│
└─ 자체 호스팅 + 커스터마이징 필요?
    └─ Yes → Minimal SQLite 구현 (본문의 구현 참조)
```

### 7-2 Memory eviction 정책

모든 무제한 메모리 시스템은 결국 비용과 성능 문제를 일으킨다. 세方案 모두 사용하는 **실용적 eviction 전략**:

```sql
-- 1. LRU (Least Recently Used): 접근 빈도 기준
DELETE FROM memories
WHERE id IN (
    SELECT id FROM memories
    ORDER BY access_count ASC, accessed_at ASC
    LIMIT 100
);

-- 2. TTL (Time To Live): 시간 기준
DELETE FROM memories
WHERE memory_type = 'episodic'
  AND accessed_at < (strftime('%s', 'now') - 90*24*60*60) * 1000;

-- 3. 중요도 기반: metadata.priority 기준
DELETE FROM memories
WHERE metadata LIKE '%"priority":"low"%'
  AND access_count < 2;
```

### 7-3 Embedding vs. FTS5: 언제 벡터 검색을 유지할 것인가

FTS5 BM25가 모든 시나리오에서 우월한 것은 아니다:

| 시나리오 | 추천 검색 엔진 |
|---------|--------------|
| 정확한 키워드 매칭 | FTS5 BM25 |
| 코드의 정확한 함수명/변수명 검색 | FTS5 BM25 |
| "작업 환경 설정 기억해줘" (의도 파악) | Vector similarity |
| 관련 문서 추천 (의미 기반) | Vector similarity |
| 하이브리드 (의미 + 키워드 동시 필요) | Both + RRF fusion |

**RRF (Reciprocal Rank Fusion)**으로 두 결과 집합을 통합:

```python
def rrf_fusion(results_vector, results_fts, k=60):
    """두 검색 결과 집합을 RRF로 통합"""
    scores = {}
    for rank, item in enumerate(results_fts):
        scores[item.id] = scores.get(item.id, 0) + 1 / (k + rank + 1)
    for rank, item in enumerate(results_vector):
        scores[item.id] = scores.get(item.id, 0) + 1 / (k + rank + 1)

    return sorted(scores.items(), key=lambda x: x[1], reverse=True)
```

---

## 8. 결론: 2026년 Agent Memory의 lessons learned

1. **Purpose-built storage가 정답**: 하나의 데이터베이스로 모든 것을 해결하려 하지 말라. Episodic/Semantic/Working은 성격이 다르다.
2. **SQLite의復興**: 벡터 DB 과대평가에서 SQLite FTS5로 회귀하는 추세가 있다. BM25는 대부분의 Agent 메모리 검색 시나리오에 적합하다.
3. **Isolation이シンプル화**: Agent별 스토어 분리가 전체 시스템을 크게 단순화한다.
4. **MCP가 표준이 될 것**: Engram의 방향(Agent-agnostic memory)이 산업 표준이 될 가능성이 높다.
5. **Simple is correct**: 복잡한 벡터 파이프라인보다 단순한 BM25 FTS5가 더 자주, 더 정확하게 동작한다.

---

*참고: 이 글은 2026년 4월 기준 Cloudflare Agent Memory, Google ADK, Engram 공개 정보를 바탕으로 분석 및 재구성되었습니다.*
