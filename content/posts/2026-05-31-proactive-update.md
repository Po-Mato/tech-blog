---
title: "AI Agent Harness Engineering: 모델이 아니라 인프라가 에이전트를 만든다"
date: "2026-05-31"
description: "프로덕션 AI 에이전트가 실패하는 이유는 LLM의 능력 부족이 아니라 Harness(컨텍스트 전달, 도구 인터페이스, 메모리, 샌드박스, 검증 루프)의 설계 결함 때문이다. 2026년 OpenAI, Anthropic, Martin Fowler가 정립한 Harness Engineering의 5가지 Design Primitive를 코드 예제와 함께 분석하고, Microsoft Agent Framework 1.0과 OpenAI Agents SDK의 최신 아키텍처를 비교한다."
tags:
  - Harness Engineering
  - AI Agents
  - Agent Architecture
  - MCP
  - Agent SLO
  - Context Engineering
  - Production AI
  - Agent Framework
---

## 1. 들어가며: 모델이 아니라 인프라다

2026년, AI 에이전트는 '실험' 단계를 넘어 '프로덕션'으로 진입했습니다. OpenAI Agents SDK는 4월 대규모 업데이트로 네이티브 샌드박스와 MCP 통합을 선보였고, Microsoft는 Semantic Kernel과 AutoGen을 통합한 **Microsoft Agent Framework 1.0**을 출시했으며, Meta는 Ranking Engineer Agent(REA)라는 프로덕션 Multi-Agent 시스템을 공개했습니다.

하지만 여전히 프로덕션 에이전트가 실패하는 가장 큰 원인은 **LLM의 능력 부족이 아닙니다.** Anthropic의 최신 연구에 따르면, 프로덕션 실패의 약 70%는 Harness(에이전트를 감싸는 인프라)의 설계 결함에서 비롯됩니다.

> **Harness Engineering**이란: 컨텍스트 전달, 도구 인터페이스, 계획 아티팩트, 검증 루프, 메모리 시스템, 샌드박스 등 에이전트를 감싸는 **인프라 스캐폴딩(Scaffolding)**을 설계하는 학문입니다.

이 글에서는 2026년 3~5월 OpenAI, Anthropic, Martin Fowler, LangChain이 정립한 Harness Engineering의 이론과 실전 패턴을 다룹니다:

1. Harness Engineering이 왜 필요한가
2. **5가지 Design Primitive** (Filesystem / Code Execution / Sandbox / Memory / Context Management)
3. Microsoft Agent Framework 1.0의 아키텍처 분석
4. Harness를 직접 구축하는 TypeScript 코드 패턴

---

## 2. Harness Engineering이란 무엇인가

### 2.1 정의와 범위

OpenAI의 Harness Engineering 발표에서는 Harness를 다음과 같이 정의합니다:

> *"Harness는 모델을 감싸는 인프라 레이어로, 컨텍스트 전달, 도구 인터페이스, 계획 수립, 검증 루프, 메모리 시스템, 그리고 샌드박스를 포함합니다. Harness가 에이전트의 성공과 실패를 결정합니다."*

Martin Fowler의 블로그에서는 이를 더 포괄적으로 설명합니다:

> *"Harness Engineering은 세 가지 상호 연결된 시스템이다: Context Engineering(에이전트가 아는 것을 큐레이션), Architectural Constraints(결정론적 린터와 구조적 테스트), Entropy Management(문서 이탈을 수리하는 주기적 에이전트)."*

중요한 인사이트: Harness의 모든 컴포넌트는 **"모델이 이것을 스스로 할 수 없다"**는 가정 위에 설계됩니다. 그리고 모델이 발전하면 이러한 가정은 만료됩니다.

### 2.2 왜 지금 Harness Engineering인가

| 시기 | 패러다임 | 문제 | 해결책 |
|------|---------|------|--------|
| 2023-2024 | Prompt Engineering | 프롬프트만 잘 쓰면 된다 | In-Context Learning |
| 2024-2025 | RAG + Tool Use | 지식 검색과 도구 호출 필요 | Vector Store + MCP |
| **2025-2026** | **Harness Engineering** | **에이전트 인프라 전체 설계 필요** | **Scaffolding + Orchestration** |

2026년의 핵심 전환점: 모델이 충분히 똑똑해졌습니다. 문제는 모델을 어떻게 **안정적으로 운영**할 것인가로 이동했습니다.

---

## 3. 5가지 Design Primitive

LangChain의 "The Anatomy of an Agent Harness"는 Harness를 구성하는 5가지 Primitive를 제시합니다.

### 3.1 Filesystem: 지속성과 에이전트 간 협업 표면

Filesystem은 에이전트에게 가장 기본적인 **지속성(Persistence)**을 제공합니다. 단순한 파일 읽기/쓰기처럼 보이지만, 사실상 에이전트의 '작업 메모리' 역할을 합니다.

```typescript
// Harness Filesystem 인터페이스
interface HarnessFilesystem {
  // 작업 디렉토리 구조
  readonly workspaceDir: string;
  readonly artifactDir: string;   // 완성된 아티팩트 저장
  readonly checkpointDir: string; // 중간 상태 저장 (재개용)
  
  // 핵심 연산
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  list(dir: string): Promise<string[]>;
  
  // Plan.md 패턴 (OpenAI Codex 스타일)
  async savePlan(plan: string): Promise<void> {
    // 계획을 파일로 저장하여 에이전트가 재시작 시
    // 이전 계획을 참조할 수 있게 함
    await this.write(`${this.artifactDir}/PLAN.md`, plan);
  }
  
  // Execution Journal (Agent Observability 연동)
  async appendJournal(entry: JournalEntry): Promise<void> {
    await this.write(
      `${this.checkpointDir}/journal.jsonl`,
      JSON.stringify(entry) + '\n'
    );
  }
}

// 실전 사용 예: Long-Horizon Task
class LongHorizonTask {
  constructor(private fs: HarnessFilesystem) {}
  
  async execute(instruction: string): Promise<void> {
    // 1단계: 초기 계획 수립
    const plan = await llm.generatePlan(instruction);
    await this.fs.savePlan(plan);
    
    // 2단계: 단계별 실행 (중단 가능)
    for (const step of plan.steps) {
      const checkpoint = await this.fs.read(
        `${this.fs.checkpointDir}/step-${step.id}.json`
      ).catch(() => null);
      
      if (checkpoint) {
        // 이미 완료된 단계는 건너뜀
        continue;
      }
      
      // 실행
      await this.executeStep(step);
      
      // 체크포인트 저장
      await this.fs.write(
        `${this.fs.checkpointDir}/step-${step.id}.json`,
        JSON.stringify({ completed: true, timestamp: Date.now() })
      );
    }
  }
}
```

**핵심 인사이트**: Filesystem Primitive가 중요한 이유는 **재개 가능성(Resumability)** 때문입니다. 에이전트가 중간에 중단되어도, Filesystem 덕분에 중단된 지점부터 재개할 수 있습니다. 이는 Long-Horizon Task(수시간~수일이 소요되는 작업)의 기본 가정입니다.

### 3.2 Code Execution: 사전 설계된 솔루션 없이 자율적 문제 해결

Code Execution Primitive는 에이전트가 **런타임에 코드를 생성하고 실행**할 수 있게 합니다. 이것이 Harness Engineering의 가장 강력하면서도 위험한 Primitive입니다.

```typescript
interface CodeExecutionSandbox {
  // Python/TypeScript 스크립트 실행
  execute(code: string, language: 'python' | 'typescript'): Promise<ExecutionResult>;
  
  // 라이브러리 설치
  install(packageName: string): Promise<void>;
  
  // 결과 검증
  verify(result: ExecutionResult): boolean;
}

interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  outputFiles: string[];  // 생성된 파일 목록
}

// 안전한 코드 실행 패턴
class SafeCodeExecutor {
  constructor(private sandbox: CodeExecutionSandbox) {}
  
  async executeWithGuard(code: string): Promise<ExecutionResult> {
    // 1. 정적 분석으로 위험 패턴 차단
    this.staticAnalyze(code);
    
    // 2. 타임아웃 설정 (무한 루프 방지)
    const timeoutMs = 30_000;
    
    // 3. 실행
    const result = await Promise.race([
      this.sandbox.execute(code, 'python'),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Execution timeout')), timeoutMs)
      )
    ]);
    
    // 4. 출력 검증
    this.sanitizeOutput(result);
    
    return result;
  }
  
  private staticAnalyze(code: string): void {
    const blockedPatterns = [
      /subprocess/i, /exec\(/, /eval\(/,
      /import os/i, /import socket/i,
      /open\(.*['"]\/['"]/,  // 루트 접근
    ];
    
    for (const pattern of blockedPatterns) {
      if (pattern.test(code)) {
        throw new Error(`Blocked pattern: ${pattern}`);
      }
    }
  }
}
```

**2026년 주요 변화**: OpenAI Agents SDK의 4월 업데이트는 **네이티브 샌드박스 실행**을 첫 번째 기능으로 내세웠습니다. Codex의 성공 이후, Sandboxed Code Execution이 에이전트 인프라의 표준 요구사항이 되었습니다.

### 3.3 Sandbox: 격리 + 검증 + 네트워크 제어

Sandbox는 단순한 격리(isolation) 이상의 역할을 합니다. 에이전트의 행동을 **제한**하고 **검증**하는 계층입니다.

```typescript
interface SandboxConfig {
  // 파일 시스템 제한
  allowedPaths: string[];
  readOnlyPaths: string[];
  maxFileSize: number; // MB
  
  // 네트워크 제한
  allowedHosts: string[];     // 허용된 외부 호스트
  blockExternal: boolean;     // 외부 네트워크 완전 차단
  
  // 리소스 제한
  maxMemoryMB: number;
  maxCPUCores: number;
  maxExecutionTimeMs: number;
  
  // 권한
  permissions: Permission[];
  requireHumanApproval: boolean;
}

type Permission =
  | { type: 'file_write'; path: string }
  | { type: 'network_call'; host: string; port: number }
  | { type: 'install_package'; name: string }
  | { type: 'delete_file'; path: string };

// Anthropic의 Beyond Permission Prompts 패턴
class StructuredPermissionSystem {
  private pendingPermissions: Map<string, Permission[]> = new Map();
  
  async requestPermission(
    agentId: string,
    permission: Permission
  ): Promise<boolean> {
    // 1. 정책 기반 자동 승인 확인
    if (this.isAutoApproved(permission)) {
      return true;
    }
    
    // 2. 자연어가 아닌 구조화된 권한 요청
    this.pendingPermissions.set(agentId, [
      ...(this.pendingPermissions.get(agentId) ?? []),
      permission
    ]);
    
    // 3. 권한 요청 UI (자연어 프롬프트 X)
    return this.promptHuman({
      type: 'permission_request',
      agentId,
      permission: this.formatPermission(permission),
      context: this.getCurrentContext(agentId),
      // 옵션: 일회성 / 세션 / 영구
      scope: 'session'
    });
  }
  
  private isAutoApproved(permission: Permission): boolean {
    // 읽기 전용 경로의 파일 읽기는 자동 승인
    if (permission.type === 'file_write') {
      return this.allowedPaths.some(p => permission.path.startsWith(p));
    }
    return false;
  }
  
  private formatPermission(permission: Permission): string {
    switch (permission.type) {
      case 'file_write':
        return `📝 파일 쓰기: ${permission.path}`;
      case 'delete_file':
        return `🗑️ 파일 삭제: ${permission.path}`;
      case 'network_call':
        return `🌐 네트워크 요청: ${permission.host}:${permission.port}`;
      case 'install_package':
        return `📦 패키지 설치: ${permission.name}`;
    }
  }
}
```

**인사이트**: Anthropic의 "Beyond Permission Prompts"는 자연어 권한 요청이 사용자에게 충분한 정보를 제공하지 못한다는 점을 지적합니다. 구조화된 퍼미션 시스템은 *"에이전트가 ~하려고 합니다. 허용하시겠습니까?"*라는 막연한 질문 대신, 구체적인 작업과 영향을 표시해야 합니다.

### 3.4 Memory: 세션을 넘어선 지속성

Memory Primitive는 Filesystem이 제공하는 파일 수준 지속성과 달리 **의미론적 지속성(Semantic Persistence)**을 제공합니다.

```typescript
interface AgentMemory {
  // Semantic Memory (Vector RAG)
  semantic: {
    store(embedding: number[], metadata: Record<string, unknown>): Promise<string>;
    query(query: string, topK: number): Promise<MemoryItem[]>;
  };
  
  // Episodic Memory (과거 에이전트 경험)
  episodic: {
    record(episode: Episode): Promise<void>;
    recall(context: string): Promise<Episode[]>;
  };
  
  // Procedural Memory (성공한 패턴)
  procedural: {
    learn(pattern: SuccessPattern): Promise<void>;
    suggest(task: string): Promise<SuccessPattern | null>;
  };
}

interface MemoryItem {
  id: string;
  content: string;
  score: number;
  metadata: {
    timestamp: number;
    source: 'user' | 'agent' | 'system';
    taskId: string;
    stalenessScore: number;  // 오래된 정보 경고
  };
}

// Context Rot 방지를 위한 Compaction
class ContextCompactor {
  async compact(memory: AgentMemory, threshold: number = 0.8): Promise<void> {
    // 1. 컨텍스트 사용률 확인
    const utilization = await this.measureUtilization(memory);
    
    if (utilization > threshold) {
      // 2. 요약 실행: 정보 손실률 최소화
      const summary = await this.summarizeMemory(memory);
      
      // 3. 오래된 항목 아카이브
      await this.archiveOldEntries(memory, 24); // 24시간 기준
      
      // 4. 요약으로 대체
      await memory.semantic.store(summary.embedding, {
        type: 'compacted_summary',
        originalCount: summary.originalCount,
        compressionRatio: summary.compressionRatio,
        timestamp: Date.now()
      });
    }
  }
  
  private async measureUtilization(memory: AgentMemory): Promise<number> {
    // 컨텍스트 윈도우의 몇 퍼센트가 사용 중인지 측정
    const entries = await memory.semantic.query('', 100);
    const totalTokens = entries.reduce((sum, e) => sum + e.content.length, 0);
    return totalTokens / 128_000; // 128K 컨텍스트 기준
  }
}
```

**Martin Fowler의 Entropy Management 연결**: Context Compaction은 Harness Engineering의 세 번째 축인 **Entropy Management**의 핵심 구현체입니다. 시간이 지남에 따라 에이전트의 메모리와 문서는 '엔트로피'(정보 이탈, 중복, 노이즈)가 증가합니다. 주기적인 압축(Compaction)이 없으면 에이전트는 점점 더 부정확해집니다.

### 3.5 Context Management: 정보 전달의 인터페이스 설계

Context Management는 에이전트가 '무엇을 알고 있는가'를 제어합니다. 단순히 많은 정보를 전달하는 것이 아니라, **적시에 필요한 정보만** 전달하는 것이 핵심입니다.

```typescript
interface ContextManager {
  // 역할별 컨텍스트 구성
  buildContext(request: AgentRequest): ContextPackage;
  
  // 컨텍스트 윈도우 최적화
  optimize(context: ContextPackage): OptimizedContext;
  
  // 중요도 기반 필터링
  prioritize(items: ContextItem[]): ContextItem[];
}

interface ContextPackage {
  systemPrompt: string;
  relevantDocuments: Document[];
  conversationHistory: Message[];
  activePlan: Plan;
  toolDefinitions: ToolDefinition[];
  // 최근 결정의 근거
  recentReasoning: string[];
}

class ContextWindowManager implements ContextManager {
  private readonly MAX_TOKENS = 128_000;
  
  buildContext(request: AgentRequest): ContextPackage {
    return {
      systemPrompt: this.selectPrompt(request.taskType),
      relevantDocuments: this.retrieveRelevant(request.query),
      conversationHistory: this.summarizeHistory(
        request.sessionId, 
        20  // 최근 20개의 메시지만
      ),
      activePlan: this.getCurrentPlan(request.sessionId),
      toolDefinitions: this.filterTools(request.taskType),
      recentReasoning: this.getLastSteps(request.sessionId, 5)
    };
  }
  
  optimize(context: ContextPackage): OptimizedContext {
    // 중요도 점수 계산 후 정렬
    const scored = [
      ...context.relevantDocuments.map(d => ({
        content: d,
        priority: this.scoreImportance(d)
      })),
      ...context.conversationHistory.map(m => ({
        content: m,
        priority: this.scoreRecency(m)
      }))
    ].sort((a, b) => b.priority - a.priority);
    
    // 토큰 예산에 맞게 자르기
    let tokens = 0;
    const optimized = [];
    for (const item of scored) {
      const itemTokens = estimateTokens(item.content);
      if (tokens + itemTokens > this.MAX_TOKENS * 0.8) break;
      optimized.push(item.content);
      tokens += itemTokens;
    }
    
    return { items: optimized, tokenUsage: tokens };
  }
  
  private scoreImportance(doc: Document): number {
    // 최신성 + 관련성 + 출처 신뢰도
    const recency = Date.now() - doc.timestamp;
    return (
      doc.relevanceScore * 0.5 +
      Math.max(0, 1 - recency / (7 * 24 * 3600000)) * 0.3 +  // 7일 이내
      doc.sourceTrustScore * 0.2
    );
  }
}
```

**LangChain의 통찰**: Context Management의 가장 큰 도전은 **Context Rot**입니다. 에이전트가 수 시간, 수일에 걸쳐 작업할 때, 초기에 전달된 컨텍스트는 점점 관련성을 잃습니다. 이를 해결하는 유일한 방법은 주기적인 컨텍스트 압축(요약 + 중요도 재계산)입니다.

---

## 4. Microsoft Agent Framework 1.0 아키텍처 분석

2026년 4월, Microsoft는 Semantic Kernel과 AutoGen을 통합한 **Microsoft Agent Framework 1.0**을 출시했습니다. 이는 Harness Engineering의 개념을 가장 체계적으로 구현한 프레임워크입니다.

### 4.1 아키텍처 개요

```
┌─────────────────────────────────────────────┐
│            Agent Application                  │
├─────────────────────────────────────────────┤
│         YAML Agent Definition                  │
│  (declarative: skills, model, tools, memory) │
├─────────────────────────────────────────────┤
│         Middleware Pipeline                    │
│  [Logging → Auth → RateLimit → Cache → ...] │
├──────────────────┬──────────────────────────┤
│  Orchestrator    │     DevUI (Debugger)      │
│  (Graph-based)   │  (실시간 agent 실행 시각화) │
├──────────────────┴──────────────────────────┤
│         Execution Layer                       │
│  [Code Interpreter] [Sandbox] [File System]  │
├─────────────────────────────────────────────┤
│   Model Providers (Multi-Provider Support)    │
│  Azure OpenAI · Anthropic · Bedrock · Gemini │
│                    · Ollama                   │
├─────────────────────────────────────────────┤
│   Protocol Integration                        │
│          MCP · A2A · OAuth                    │
└─────────────────────────────────────────────┘
```

### 4.2 주요 특징

**① YAML 선언적 에이전트 정의**

```yaml
# agent-definition.yaml
name: customer-support-v2
description: 멀티채널 고객 지원 에이전트

model:
  provider: azure-openai
  deployment: gpt-4o
  max_tokens: 4096
  temperature: 0.2

skills:
  - name: billing
    mcp_server: billing-system
    tools:
      - check_invoice
      - process_refund
      - payment_history
  
  - name: knowledge-base
    vector_store: azure-ai-search
    index: kb-v3
    top_k: 5

memory:
  episodic:
    provider: sqlite
    retention: 30d
  semantic:
    provider: azure-ai-search
    index: agent-memory-v2

pipeline:
  - logging
  - authentication
  - rate_limiter:
      max_rpm: 100
  - content_filter

sandbox:
  allowed_paths: ["/workspace"]
  block_network: true
  allowed_hosts: ["api.internal.company.com"]

human_in_the_loop:
  require_approval:
    - delete_file
    - process_refund > $1000
```

**② 그레프 기반 오케스트레이션**

```python
# Microsoft Agent Framework의 그레프 오케스트레이터
from agent_framework import AgentGraph, Node

class CustomerSupportGraph(AgentGraph):
    def build(self):
        triage = Node("triage", skill="classification")
        billing = Node("billing", skill="billing_specialist")
        tech = Node("tech", skill="technical_support")
        escalate = Node("escalate", skill="human_handoff")
        
        # 조건부 라우팅
        triage >> billing  # 기본: billing으로
        triage.on_condition("technical") >> tech  # 기술 문의
        tech.on_condition("unresolved") >> escalate  # 에스컬레이션
        
        # 병렬 처리
        billing & tech >> self.combine  # 병렬 처리 후 결합
        
        return triage  # 시작 노드

# DevUI에서 실시간 Trace 시각화
# 각 Node는 독립적인 Span으로 계측됨
```

**③ Middleware Pipeline (Harness Engineering의 핵심)**

```python
from agent_framework import Middleware, Context

class LoggingMiddleware(Middleware):
    """모든 Agent 실행 단계를 기록"""
    async def on_enter(self, ctx: Context):
        ctx.span = self.tracer.start_span(f"agent.{ctx.stage}")
        ctx.span.set_attribute("agent.id", ctx.agent_id)
        ctx.span.set_attribute("stage", ctx.stage)
    
    async def on_exit(self, ctx: Context):
        ctx.span.set_attribute("duration_ms", ctx.duration)
        ctx.span.end()

class RateLimitMiddleware(Middleware):
    """토큰 소비 기반 속도 제한"""
    async def on_enter(self, ctx: Context):
        cost = estimate_token_cost(ctx.input)
        if not self.bucket.consume(cost):
            raise RateLimitError("Token budget exceeded")
```

### 4.3 Agent SLO와의 연계

Microsoft Framework의 가장 강력한 점은 Harness Engineering의 Output을 **Agent SLO**와 직접 연결한다는 점입니다:

```python
# 내장 Agent SLO 수집기
from agent_framework import SLOMonitor

monitor = SLOMonitor()

@monitor.track("customer-support")
async def handle_ticket(ticket: Ticket):
    result = await agent.run(ticket)
    return result

# 주간 리포트
report = monitor.generate_report("customer-support", window="7d")
print(f"""
Task Success Rate: {report.tsr:.1%}
Tool Call Accuracy: {report.tca:.1%}
Avg Latency: {report.p95_latency_ms:.0f}ms
Avg Cost/Task: ${report.cost_per_task:.2f}
""")
```

---

## 5. Harness 설계 시 고려할 Trade-off

Harness Engineering은 모든 것을 '최대로' 설정하는 것이 아닙니다. 각 Primitive 간의 Trade-off를 이해하는 것이 중요합니다.

| 프리미티브 | 너무 적게 설정하면 | 너무 많이 설정하면 | 최적 균형 |
|-----------|-------------------|-------------------|----------|
| **Sandbox** | 에이전트가 시스템에 손상 | 에이전트가 너무 제약받음 | 최소 권한 원칙 + 예외 정책 |
| **Memory** | 컨텍스트 부족으로 오류 | 컨텍스트 오염으로 혼란 | 중요도 기반 적응형 필터링 |
| **Context** | 정보 부족으로 잘못된 결정 | 컨텍스트 윈도우 초과 | 동적 중요도 점수 + 압축 |
| **Permission** | 보안 위험 | 생산성 저하 | 작업 위험도 기반 자동화 |
| **Filesystem** | 재개 불가능 | 파일 시스템 오염 | 체크포인트 + TTL 기반 정리 |

---

## 6. Harness Engineering의 미래: 2026년 이후

2026년 5월 현재, Harness Engineering은 급속도로 발전 중입니다:

### 6.1 Natural-Language Agent Harnesses

arXiv에 발표된 최신 논문(2603.25723)은 에이전트 제어 로직을 **휴대용 자연어 아티팩트(NLAH: Natural-Language Agent Harnesses)**로 외부화하는 개념을 제안합니다. 핵심 아이디어는 Harness 설계를 코드에 고정하지 않고, 버전 관리 가능한 자연어 파일로 관리하는 것입니다:

```
# NLAH 예시: agent-harness.md
## Rules for all tool calls
- Before calling any tool, check if required parameters exist
- If parameter is missing, ask user before continuing
- Never retry a failed tool call more than 3 times

## Context window management
- When context reaches 70% utilization, trigger compaction
- Compact by summarizing the oldest 30% of conversation
- Keep the last 5 messages in full fidelity

## Error handling
- For PermissionDenied errors: request explicit user approval
- For Timeout errors: retry once with doubled timeout
- For RateLimit errors: wait 5s and retry once
```

이 접근법은 Harness 설계가 **재현 가능하고(Reproducible)**, **전이 가능하며(Transferable)**, **감사 가능한(Auditable)** 상태를 유지할 수 있게 합니다.

### 6.2 Co-evolution 경고

LangChain의 "Anatomy of an Agent Harness"는 중요한 경고를 합니다: **모델이 특정 Harness에 맞춰 훈련되면, 그 Harness 디자인에 과적합(overfitting)될 위험이 있습니다.** 즉, 현재의 Harness 설계가 미래의 모델 발전을 제약할 수 있습니다. Harness는 '영원한 정답'이 아니라 '현재 모델의 한계를 보완하는 임시 구조물'이라는 인식이 필요합니다.

---

## 7. 결론: Harness Engineering이 미래의 SRE다

2023년이 **Prompt Engineering의 해**였다면, 2025-2026년은 **Harness Engineering의 해**입니다. 모델 능력이 포화점에 도달하면서, 에이전트의 성공은 '어떤 모델을 쓰는가'보다 '어떤 Harness로 감싸는가'에 의해 결정됩니다.

Martin Fowler의 표현을 빌리자면:

> *"Harness 엔지니어는 에이전트의 개별 출력을 검사하는 대신, 에이전트 환경을 설계하고 유지보수하는 **'루프 위의 인간(Humans on the Loop)'**이다."*

에이전트가 많아질수록, 각 에이전트의 개별 동작을 직접 검토하는 것은 불가능해집니다. 대신, 우리는 에이전트가 안전하고 효과적으로 동작할 수 있는 **Harness(인프라)**를 설계해야 합니다. 이것이 바로 **Agent SRE**의 시작이며, AI 운영의 새로운 패러다임입니다.

**핵심 요약:**
- Harness Engineering은 모델을 감싸는 5가지 Primitive(Filesystem, Code Execution, Sandbox, Memory, Context Management)를 설계하는 학문
- Microsoft Agent Framework 1.0은 Harness Engineering을 가장 체계적으로 구현한 프로덕션 프레임워크
- Harness는 영구적인 해결책이 아닌, 현재 모델의 한계를 보완하는 '임시 구조물'
- Natural-Language Agent Harnesses는 Harness 설계를 코드에서 분리하는 새로운 패러다임
- **궁극적 목표**: 에이전트가 '잘못된 성공(Silent Success)'을 하지 않도록 하는 인프라 구축

---

*참고 자료*
- OpenAI, "Harness Engineering" (Mar 2026)
- Anthropic, "Building Effective Agents" (Mar 2026)
- Anthropic, "Harness Design for Long-Running Application Development" (Mar 2026)
- Anthropic, "Beyond Permission Prompts" (Apr 2026)
- Martin Fowler, "Harness Engineering" (Apr 2026)
- LangChain, "The Anatomy of an Agent Harness" (May 2026)
- Microsoft, "Agent Framework 1.0 Release" (Apr 2026)
- arXiv 2603.25723, "Natural-Language Agent Harnesses" (2026)
- OpenAI, "OpenAI Agents SDK v2 Update" (Apr 15, 2026)
