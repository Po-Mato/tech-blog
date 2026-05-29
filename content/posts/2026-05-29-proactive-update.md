---
title: "A2A Protocol 완전 해부: MCP가 Tools라면, A2A는 Agents를 연결한다"
date: "2026-05-29"
description: "Google Cloud Next 2026에서 v1.0이 발표된 A2A(Agent-to-Agent) Protocol은 150개 이상의 조직이 프로덕션에 도입한 차세대 에이전트 통신 표준입니다. MCP와의 근본적인 차이점, AgentCard 기반의 동적 디스커버리, Task 지향 프로토콜 설계, 그리고 3계층 아키텍처(MCP → A2A → ADK)를 코드 예제와 함께 완전 해부합니다."
tags:
  - A2A
  - MCP
  - Agent Architecture
  - Multi-Agent Systems
  - Google Cloud
  - Protocol Design
  - Enterprise AI
---

## 1. 들어가며: MCP 다음은 무엇인가?

2025년 하반기부터 2026년 현재까지, AI 에이전트 생태계는 한 가지 명확한 방향으로 수렴하고 있습니다: **표준화**. Anthropic의 MCP(Model Context Protocol)가 Tool 호출의 사실상 표준(de facto standard)으로 자리잡으면서, "에이전트가 LLM을 통해 도구를 사용하는 방법"에 대한 합의가 이루어졌습니다.

그러나 MCP가 해결하지 못한 영역이 있습니다: **에이전트가 다른 에이전트와 통신하는 방법**.

단일 에이전트가 하나의 LLM + 여러 도구로 처리할 수 있는 작업의 범위에는 한계가 있습니다. 복잡한 엔터프라이즈 워크플로우는 여러 도메인 전문 에이전트의 협업을 필요로 합니다. 바로 이 지점에서 Google이 제시한 **A2A (Agent-to-Agent) Protocol**이 등장합니다.

> **"MCP는 에이전트와 도구를 연결한다. A2A는 에이전트와 에이전트를 연결한다."**

이 글에서는 A2A v1.0의 코어 아키텍처를 MCP와의 비교 관점에서 분석하고, 실제 구현 코드와 함께 엔터프라이즈 도입 전략을 살펴봅니다.

---

## 2. MCP vs A2A: 근본적인 설계 철학의 차이

두 프로토콜을 이해하는 가장 빠른 길은 **누가 누구와 통신하는가**를 이해하는 것입니다.

| 차원 | MCP | A2A |
|------|-----|-----|
| **통신 대상** | Agent ↔ Tool | Agent ↔ Agent |
| **프로토콜 성격** | Tool 호출 (RPC) | Task 위임 (Stateful) |
| **메시지 모델** | 요청-응답 (Stateless) | 상태 관리 (Task ID) |
| **서버 역할** | Tool 제공 | Agent 노출 |
| **디스커버리** | 수동 등록 | AgentCard 기반 자동 발견 |
| **스트리밍** | SSE (이벤트 큐) | SSE + Push Notification |
| **보안 모델** | Transport Auth | AgentCard 내 OAuth/Scheme 명시 |
| **유스케이스** | 검색, DB 쿼리, 파일 I/O | 업무 위임, 티켓 처리, 복합 추론 |

MCP가 **Tool 호출의 표준화**를 목표로 한다면, A2A는 **Agent 협업의 표준화**를 목표로 합니다. 이 두 프로토콜은 경쟁 관계가 아니라 상호 보완 관계입니다.

```
┌─────────────────────────────────────────────────────┐
│                    Orchestrator (ADK)                │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │  User Intent / Planning / Global Memory       │   │
│  └──────────────┬───────────────────────────────┘   │
│                 │ A2A                               │
│                 ▼                                   │
│  ┌─────────────────────┐  ┌─────────────────────┐   │
│  │ Billing Agent       │  │ Support Agent        │   │
│  │ ┌─────────────────┐ │  │ ┌─────────────────┐  │   │
│  │ │ MCP Tools       │ │  │ │ MCP Tools       │  │   │
│  │ │ - Payment API   │ │  │ │ - Search        │  │   │
│  │ │ - Invoice DB    │ │  │ │ - KB Query      │  │   │
│  │ └─────────────────┘ │  │ └─────────────────┘  │   │
│  └─────────────────────┘  └─────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

이 3계층 구조가 2026년 엔터프라이즈 AI의 표준 아키텍처입니다.

---

## 3. AgentCard: "OpenAPI for Agents"

A2A의 핵심 혁신 중 하나는 **AgentCard**입니다. MCP가 `.well-known/mcp.json`을 통해 서버 메타데이터를 노출하는 것처럼, A2A 에이전트는 `/.well-known/agent.json`에 AgentCard를 게시합니다.

### AgentCard 구조

```json
{
  "name": "billing-specialist-v2",
  "description": "Handles refund requests, subscription changes, and invoice disputes",
  "version": "2.1.0",
  "capabilities": {
    "streaming": true,
    "push_notifications": true,
    "stateful_tasks": true
  },
  "authentication": {
    "schemes": ["oauth2"],
    "oauth2": {
      "token_url": "https://auth.example.com/v2/token",
      "scopes": ["billing:read", "billing:write"]
    }
  },
  "skills": [
    {
      "id": "refund.process",
      "name": "Process Refund",
      "description": "Process a payment refund given a transaction ID and reason",
      "input_modes": ["application/json"],
      "output_modes": ["application/json"],
      "examples": [
        {
          "name": "Simple refund",
          "input": {
            "transaction_id": "txn_abc123",
            "amount": 29900,
            "reason": "customer_request"
          }
        }
      ]
    },
    {
      "id": "subscription.upgrade",
      "name": "Upgrade Subscription",
      "description": "Upgrade a user's subscription plan",
      "input_modes": ["application/json"],
      "output_modes": ["application/json"]
    }
  ],
  "rate_limits": {
    "requests_per_minute": 100,
    "tokens_per_minute": 10000
  }
}
```

AgentCard의 강력함은 **런타임에 에이전트의 기능을 동적으로 발견**할 수 있다는 점입니다. 마이크로서비스 아키텍처의 Service Discovery와 유사하지만, AgentCard는 단순한 위치 정보뿐 아니라 **에이전트가 무엇을 할 수 있는지**(skills), **어떻게 인증할지**(authentication), **어떤 형식을 주고받는지**(input/output modes)까지 명시합니다.

### AgentCard Discovery 구현

실제 Node.js A2A 클라이언트에서 AgentCard를 발견하는 코드는 다음과 같습니다:

```typescript
// a2a-discovery.ts
interface AgentCard {
  name: string;
  description: string;
  version: string;
  capabilities: {
    streaming: boolean;
    push_notifications: boolean;
    stateful_tasks: boolean;
  };
  authentication: {
    schemes: string[];
    oauth2?: {
      token_url: string;
      scopes: string[];
    };
  };
  skills: Array<{
    id: string;
    name: string;
    description: string;
    input_modes: string[];
    output_modes: string[];
  }>;
}

async function discoverAgent(agentBaseUrl: string): Promise<AgentCard> {
  const cardUrl = new URL('/.well-known/agent.json', agentBaseUrl);
  const response = await fetch(cardUrl.toString(), {
    headers: { 'Accept': 'application/json' }
  });

  if (!response.ok) {
    throw new Error(
      `AgentCard discovery failed: ${response.status} — ` +
      `expected A2A-compliant agent at ${agentBaseUrl}`
    );
  }

  const card: AgentCard = await response.json();

  // AgentCard schema 검증
  if (!card.name || !card.skills?.length) {
    throw new Error('Invalid AgentCard: missing required fields');
  }

  return card;
}
```

이처럼 A2A 클라이언트는 AgentCard를 읽어서 원격 에이전트와 통신하는 데 필요한 모든 정보를 획득합니다. 이는 MCP의 `initialize -> tools/list -> tools/call` 핸드셰이크 시퀀스와 유사하지만, **AgentCard는 정적 메타데이터로 캐싱 가능**하고 **검색 가능한 레지스트리**에 등록할 수 있다는 차이가 있습니다.

---

## 4. Task 지향 프로토콜: 단순 RPC를 넘어서

MCP가 Tool 호출이라는 단일 연산(operation)에 집중한다면, A2A는 **Task**라는 일급 추상화(first-class abstraction)를 도입합니다.

### Task 수명 주기

```
클라이언트                              A2A 서버
    │                                      │
    │   POST /tasks/send                    │
    │  ─────────────────────────────────>   │
    │   { id: "task_001",                   │
    │     sessionId: "sess_abc",            │
    │     message: { role: "user",          │
    │       parts: [{ type: "text",         │
    │         text: "환불 처리해줘" }] } }    │
    │                                      │
    │   202 Accepted                        │
    │   { id: "task_001",                   │
    │     status: "submitted" }             │
    │  <─────────────────────────────────   │
    │                                      │
    │   ---- SSE Streaming 시작 ----       │
    │                                      │
    │   event: task_status                 │
    │   data: { status: "working",         │
    │          message: { role: "agent",   │
    │            parts: [{ type: "text",   │
    │              text: "환불을 처리..." }] } } │
    │  <────────────────────────────────── │
    │                                      │
    │   event: task_artifact               │
    │   data: { artifact: {                │
    │          parts: [{ type: "file",     │
    │            mimeType: "application/   │
    │              json",                  │
    │            data: "{ \"refund_id\":   │
    │              \"rf_789\" }" }] } }     │
    │  <────────────────────────────────── │
    │                                      │
    │   event: task_status                 │
    │   data: { status: "completed" }      │
    │  <────────────────────────────────── │
```

핵심은 **Task가 Network 연결보다 오래 살 수 있다(stateful)**는 점입니다. LLM 추론 시간이 수 초에서 수 분까지 걸릴 수 있다는 점을 고려하면, HTTP 요청-응답 모델로는 신뢰성 있는 통신이 어렵습니다. A2A는 Task ID를 통해 **연결이 끊겨도 작업이 계속되고, 재연결 시 상태를 복구**할 수 있습니다.

### A2A Client 구현 예제

```typescript
// a2a-client.ts
class A2AClient {
  private readonly agentUrl: URL;
  private readonly card: AgentCard;
  private readonly authToken: string;

  constructor(agentUrl: string) {
    this.agentUrl = new URL(agentUrl);
    this.card = null!;
    this.authToken = '';
  }

  async initialize(): Promise<void> {
    // 1. AgentCard 발견
    this.card = await discoverAgent(this.agentUrl.toString());

    // 2. 인증 토큰 획득
    if (this.card.authentication.schemes.includes('oauth2')) {
      this.authToken = await this.authenticateOAuth(
        this.card.authentication.oauth2!
      );
    }
  }

  // A2A Task 전송
  async sendTask(
    sessionId: string,
    text: string,
    onProgress?: (message: string) => void
  ): Promise<TaskResult> {
    const response = await fetch(
      new URL('/tasks/send', this.agentUrl).toString(),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.authToken}`,
          'Accept': 'text/event-stream'  // SSE 요청
        },
        body: JSON.stringify({
          id: crypto.randomUUID(),
          sessionId,
          message: {
            role: 'user',
            parts: [{ type: 'text', text }]
          }
        })
      }
    );

    if (this.card.capabilities.streaming && response.ok) {
      // SSE 스트리밍 처리
      return this.handleStreamingResponse(response, onProgress);
    }

    // Non-streaming fallback
    return response.json();
  }

  private async handleStreamingResponse(
    response: Response,
    onProgress?: (message: string) => void
  ): Promise<TaskResult> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const event = JSON.parse(line.slice(6));
          if (event.status === 'completed') {
            return event.result;
          }
          if (event.status === 'working' && onProgress) {
            onProgress(event.message?.parts?.[0]?.text || '');
          }
        }
      }
    }

    throw new Error('Task stream ended unexpectedly');
  }

  private async authenticateOAuth(
    config: { token_url: string; scopes: string[] }
  ): Promise<string> {
    // OAuth2 클라이언트 자격 증명 흐름
    const tokenResponse = await fetch(config.token_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: config.scopes.join(' ')
      })
    });

    const { access_token } = await tokenResponse.json();
    return access_token;
  }
}
```

---

## 5. MCP + A2A: 실제 듀얼 프로토콜 구현

실제 엔터프라이즈 환경에서는 단일 에이전트가 MCP 서버와 A2A 에이전트에 **동시에** 연결해야 합니다. 다음은 TypeScript로 구현한 듀얼 프로토콜 에이전트 예제입니다:

```typescript
// hybrid-agent.ts
import { Client as MCPClient } from '@modelcontextprotocol/sdk';
import { A2AClient } from './a2a-client';

interface AgentConfig {
  name: string;
  mcpServers: Array<{ name: string; url: string }>;
  a2aPeers: Array<{ name: string; url: string; description: string }>;
  delegationRules: Array<{
    intentPattern: RegExp;
    delegateTo: string;
    fallbackAction: 'self' | 'error';
  }>;
}

class HybridAgent {
  private mcpClients: Map<string, MCPClient> = new Map();
  private a2aClients: Map<string, A2AClient> = new Map();
  private config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    // MCP Client 초기화 (Tool 연결)
    for (const server of this.config.mcpServers) {
      const client = new MCPClient();
      await client.connect(server.url);
      this.mcpClients.set(server.name, client);
      console.log(`[MCP] Connected to tool server: ${server.name}`);
    }

    // A2A Client 초기화 (Agent 연결)
    for (const peer of this.config.a2aPeers) {
      const client = new A2AClient(peer.url);
      await client.initialize();
      this.a2aClients.set(peer.name, client);
      console.log(`[A2A] Discovered agent: ${peer.name} — ${peer.description}`);
    }
  }

  async process(input: string): Promise<string> {
    // 1. 위임 규칙 확인
    const matchingRule = this.config.delegationRules.find(
      r => r.intentPattern.test(input)
    );

    if (matchingRule) {
      const peerClient = this.a2aClients.get(matchingRule.delegateTo);
      if (peerClient) {
        console.log(`[A2A] Delegating to ${matchingRule.delegateTo}: "${input}"`);
        const result = await peerClient.sendTask(
          crypto.randomUUID(),
          input
        );
        return `[${matchingRule.delegateTo}]: ${result}`;
      }
    }

    // 2. MCP Tool 호출로 직접 처리
    const results: string[] = [];
    for (const [name, client] of this.mcpClients) {
      try {
        const tools = await client.listTools();
        const tool = tools.find(t => input.includes(t.name));
        if (tool) {
          const result = await client.callTool(tool.name, { input });
          results.push(`[Tool:${name}] ${result}`);
        }
      } catch (e) {
        console.error(`[MCP] Tool error on ${name}:`, e);
      }
    }

    return results.join('\n') || 'No matching tool or agent found.';
  }
}

// 사용 예시
const agent = new HybridAgent({
  name: 'support-orchestrator',
  mcpServers: [
    { name: 'payment-gateway', url: 'http://mcp-payment:3100' },
    { name: 'knowledge-base', url: 'http://mcp-kb:3100' }
  ],
  a2aPeers: [
    {
      name: 'billing-agent',
      url: 'http://billing-service:8080',
      description: 'Handles refunds, subscriptions, invoices'
    },
    {
      name: 'escalation-agent',
      url: 'http://escalation-service:8080',
      description: 'Handles complex complaints requiring human review'
    }
  ],
  delegationRules: [
    { intentPattern: /환불|refund|billing/i, delegateTo: 'billing-agent', fallbackAction: 'self' },
    { intentPattern: /항의|complaint|escalat/i, delegateTo: 'escalation-agent', fallbackAction: 'error' }
  ]
});

await agent.initialize();
const result = await agent.process("지난주 결제 환불 요청합니다");
console.log(result); // [billing-agent]: Refund processed...
```

이 패턴의 핵심은 **의도 기반 위임(Intent-based Delegation)**입니다. Orchestrator는 사용자의 요청을 분석하여 MCP Tool로 직접 처리할지, A2A Agent로 위임할지 결정합니다.

---

## 6. Event Compaction: 에이전트 메모리의 실용적 해법

A2A가 stateful Task를 지원하면서 **Context 폭발(Context Explosion)** 문제가 대두됩니다. 여러 에이전트 간의 대화가 길어질수록 토큰 비용이 급증하고, LLM의 컨텍스트 윈도우 한계에 도달하게 됩니다.

ADK 1.0이 도입한 **Event Compaction**은 이 문제에 대한 실용적인 해결책입니다:

```typescript
// event-compaction.ts
interface CompactionConfig {
  windowSize: number;      // 최근 이벤트 유지 개수
  summarizerModel: string; // 요약 전용 경량 모델
  pinKeys: string[];       // 유지해야 할 핵심 데이터 키
}

class EventCompactor {
  private events: Array<{ timestamp: number; role: string; content: string }> = [];
  private summary: string = '';
  private pinned: Map<string, any> = new Map();

  constructor(private config: CompactionConfig) {}

  addEvent(role: string, content: string): void {
    this.events.push({ timestamp: Date.now(), role, content });

    // 윈도우 초과 시 Compaction 실행
    if (this.events.length > this.config.windowSize) {
      this.compact();
    }
  }

  private compact(): void {
    const recent = this.events.slice(-this.config.windowSize);
    const old = this.events.slice(0, -this.config.windowSize);

    // 오래된 이벤트 요약
    this.summary = this.summarize(old);

    // 이벤트 버퍼 정리
    this.events = recent;
  }

  private summarize(events: Array<{ role: string; content: string }>): string {
    // 경량 LLM을 사용한 요약 (추상화)
    return events
      .map(e => `[${e.role}]: ${e.content.slice(0, 200)}`)
      .join('\n');
  }

  getContext(): string {
    // 반환: [Pin 데이터] + [요약] + [최근 이벤트]
    const pinnedStr = [...this.pinned.entries()]
      .map(([k, v]) => `[${k}]: ${JSON.stringify(v)}`)
      .join('\n');

    const recentStr = this.events
      .map(e => `[${e.role}]: ${e.content}`)
      .join('\n');

    return [
      pinnedStr && `=== Pinned Data ===\n${pinnedStr}`,
      this.summary && `=== Summary ===\n${this.summary}`,
      `=== Recent ===\n${recentStr}`
    ].filter(Boolean).join('\n\n');
  }

  pin(key: string, value: any): void {
    this.pinned.set(key, value);
  }
}
```

프로덕션 벤치마크에서 Event Compaction은 **토큰 사용량 38% 감소, 지연 시간 18% 개선**을 보여줍니다. 핵심은 `pinKeys`로 트랜잭션 ID나 사용자 정보 같은 필수 데이터를 요약 과정에서 보호하는 것입니다.

---

## 7. 엔터프라이즈 도입: 90일 로드맵

A2A의 엔터프라이즈 도입은 기존 MCP 인프라 위에 단계적으로 구축하는 것이 가장 효과적입니다.

### Phase 1 (1-30일): MCP 표준화 + AgentCard 등록
- 모든 내부 도구를 MCP 서버로 전환
- 각 팀의 에이전트에 AgentCard 작성 및 내부 레지스트리 등록
- 인증 체계 (OAuth2 / API Key) 통일

### Phase 2 (31-60일): Orchestrator 구축 + A2A 파일럿
- ADK 1.0 기반 Root Orchestrator 구현
- 하나의 도메인 에이전트 (예: Billing)를 A2A 프로토콜로 전환
- 듀얼 프로토콜 (MCP + A2A) 통신 검증

### Phase 3 (61-90일): HITL + Observability
- 고위험 작업 (환불, 계정 삭제)에 Human-in-the-Loop 적용
- OpenTelemetry 기반 분산 추적 구성
- Event Compaction 설정으로 비용 최적화

---

## 8. 결론: 경쟁이 아닌 공존

MCP는 Tool 호출의 표준으로, A2A는 Agent 협업의 표준으로 자리잡고 있습니다. 이 두 프로토콜은 **경쟁 관계가 아닌 상호 보완 관계**입니다.

2026년 엔터프라이즈 AI 아키텍처의 핵심 원칙은 **"프로토콜 준수, 프레임워크 독립"** 입니다. MCP로 도구를 표준화하고, A2A로 에이전트 간 협업을 정의하며, ADK로 오케스트레이션을 처리하는 3계층 구조가 앞으로 수년간 지속될 표준 패턴입니다.

가장 중요한 통찰: **에이전트가 Tools를 사용하는 방법(MCP)과 에이전트가 에이전트와 협업하는 방법(A2A)은 별개의 문제입니다.** 하나를 해결했다고 다른 하나가 해결되지 않습니다. 2026년의 경쟁력 있는 AI 시스템은 이 두 프로토콜을 모두 유창하게 다루는 능력에서 결정될 것입니다.

---

### 참고 자료
- A2A Protocol Specification: [https://a2a-protocol.org](https://a2a-protocol.org)
- GitHub: [github.com/a2aproject/A2A](https://github.com/a2aproject/A2A)
- Google ADK 1.0 GA Announcement (Cloud Next 2026)
- MCP Specification: [https://modelcontextprotocol.io](https://modelcontextprotocol.io)
