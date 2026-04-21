---
title: "Microsoft Agent Framework 1.0: Semantic Kernel과 AutoGen 통합, 그리고 Agentic AI의 새로운 기준"
date: 2026-04-21
description: "2026년 4월 3일 출시된 Microsoft Agent Framework 1.0은 Semantic Kernel과 AutoGen을 하나의 SDK로 통합하고, Linux Foundation Agentic AI Foundation의 거버넌스 아래에서 MCP/A2A 네이티브 지원을標榜한다. 통합 아키텍처의 실체를 파고들고 기존 프레임워크からの移行 전략을 제시한다."
tags:
  - AI Agent
  - Microsoft Agent Framework
  - Semantic Kernel
  - AutoGen
  - MCP
  - A2A Protocol
  - Agent Architecture
  - Enterprise AI
  - Multi-Agent
---

## TL;DR

- **Microsoft Agent Framework 1.0**은 Semantic Kernel(Planning/Orchestration) + AutoGen(Multi-Agent 협업)을 단일 NuGet/npm 패키지로 통합했다. 기존 두 SDK의 분기점에서 자유로워진다.
- **MCP 네이티브 지원**: `Microsoft.MCP.Agent` 패키지로 에이전트가 외부 MCP 서버에 연결하며, 별도 어댑터 없이 `tools/call`을 그대로 사용한다.
- **A2A 호환**: Google A2A Protocol을 기반으로 agent card와 협업 스택을 구성하되, Microsoft 고유의 확장도 존재한다.
- **Linux Foundation 거버넌스**: 기존 `microsoft/autogen` → `FoundationDB/autogen`으로의 이전이 진행 중이다. 1.0은 이-governance 구조 위에서 첫 번째 정식 릴리스다.
- **도입 판단**: 기존 SK/AutoGen 프로젝트가 있다면 마이그레이션 검토 warranted (Breaking Changes 있음). 신규 프로젝트는 1.0을 표준으로 채택하는 것이 장기적으로 유리하다.

---

## 1. 왜 지금 통합이었는가

### 두 SDK의 탄생 배경 차이

Semantic Kernel(SK)과 AutoGen은 같은 "AI Agent"를 목표로しながらも根本上 다른 문제 의식에서 출발했다:

| | Semantic Kernel | AutoGen |
|---|---|---|
| **출시** | 2023년 초 | 2023년 중반(Microsoft Research) |
| **핵심 추상화** | Planner → Goal Decomposition | Agent → Conversation |
| **주도 사용 사례** | Enterprise Copilot, Plugins | Multi-Agent 협업 시뮬레이션 |
| **디자인 철학** | "도구를 계획대로 조합하라" | "대화에서 행위가涌现하라" |
| **주요 사용자** | Azure Copilot 팀 | 연구팀, Hackathon |

2025년 들어 두 프레임워크가enterprise 시장을 동시에 공략하면서 **런타임 충돌**이 증가했다. SK 기반 앱에 AutoGen 에이전트를 붙이려면 자체 브릿지를 개발해야 했고, 이는 DX를 해쳤다. Agent Framework 1.0은 이 런타임 통합의 필요성에서 출발했다.

### 2026년 4월의 시장 압박

- Google A2A Protocol이 1周年을 맞아 v1.0 정식 채택
- AWS Bedrock, Cloudflare Workers AI가 MCP 서버 호스팅을 공식 지원
- "pure-text models no longer ship" — multimodal 에이전트가 기본 요구사항이 된 시장
- Elgato Stream Deck가 하드웨어에서 MCP를 네이티브 지원하기 시작

Microsoft 입장에서 Agent Framework 1.0은 **단일 SDK로 프로토콜 전쟁에 대응**하는 전략적 결정이었다.

---

## 2. 아키텍처: 하나의 SDK, 두 개의 런타임

### 패키지 구조

```bash
# .NET
dotnet add package Microsoft.AgentFramework --version 1.0.0

# Node.js / TypeScript
npm install @microsoft/agent-framework@1.0.0
```

1.0 SDK는 내부적으로 두 개의 런타임을 제공한다:

```csharp
// Microsoft.AgentFramework.Abstractions (공통 레이어)
public interface IAgentRuntime
{
    Task<AgentResponse> ExecuteAsync(AgentRequest request, CancellationToken ct);
    IAsyncEnumerable<StreamingResponse> StreamAsync(AgentRequest request);
}

// 두 런타임 구현
public class SemanticKernelRuntime : IAgentRuntime { /* SK 2.x 기반 */ }
public class AutoGenRuntime     : IAgentRuntime { /* AutoGen 1.x 기반 */ }

// 1.0 신규: 통합 런타임
public class UnifiedAgentRuntime : IAgentRuntime
{
    private readonly IOrchestrator _orchestrator;   // SK Planner
    private readonly IConversationRouter _router;  // AutoGen Router
    private readonly IMcpClient _mcpClient;        // MCP 네이티브 클라이언트
}
```

핵심 변화: **`UnifiedAgentRuntime`**이 SK의 목표 분해 능력과 AutoGen의 대화형 협업 능력을 단일 파이프라인에서 mixing할 수 있게 되었다.

### 코드 예시: MCP 도구呼叫 + Multi-Agent 협업

```csharp
using Microsoft.AgentFramework;
using Microsoft.AgentFramework.MCP;

// 1. MCP 서버 등록 (MCP 네이티브)
var builder = AgentRuntime.CreateBuilder()
    .WithMCPServer("github", new MCPServerConfig
    {
        Transport = MCPTransport.StdIO,
        Command = "npx",
        Args = new[] { "-y", "@modelcontextprotocol/server-github" },
        Env = new Dictionary<string, string>
        {
            ["GITHUB_TOKEN"] = Env.GITHUB_TOKEN
        }
    })
    .WithMCPServer("filesystem", new MCPServerConfig
    {
        Transport = MCPTransport.HTTP,
        Url = "http://localhost:3000"
    });

// 2. Planner + Researcher 에이전트 정의
builder.AddAgent("planner", new SemanticKernelAgent
{
    Instructions = "사용자의 목표를 분해하고 Researcher에게子任務을 할당한다.",
    Model = "gpt-4o",
    MaxIterations = 5
});

builder.AddAgent("researcher", new AutoGenAgent
{
    SystemMessage = "GitHub 코드와 문서를調査し、結果を报告する。",
    Model = "claude-sonnet-4",
    MaxTurns = 3
});

// 3. 협업 규칙 (A2A 기반)
builder.AddCollaborationRule("planner", "researcher", new CollaborationRule
{
    Protocol = AgentProtocol.A2A,
    TaskBroadcast = true,
    ResultAggregation = AggregationMode.LastWriterWins
});

// 4. 실행
var runtime = builder.Build();
var response = await runtime.ExecuteAsync(new AgentRequest
{
    Goal = "이 저장소의 最近 commit 5개를 분석하고, 어떤 기능이 开发中인지 보고해줘",
    Context = new Dictionary<string, object> { ["repo"] = "Po-Mato/tech-blog" }
});

await foreach (var chunk in response.Stream())
{
    Console.WriteLine(chunk.Content);
}
```

이 예시에서 주목할 점:
- **MCP 도구**가 에이전트 런타임에 직접 등록됨 (`WithMCPServer`)
- **Planner → Researcher**로의 작업 분배가 A2A Collaboration Rule로 선언적 관리
- **Streaming Response**가 통합 파이프라인에서 end-to-end로 흐른다

### 3. MCP 네이티브 지원의 실체

기존 SK/AutoGen에서 MCP를 쓰려면 커뮤니티 어댑터를��다:

```csharp
// ❌ Old: Community 어댑터 (비공식, 불안정)
var adapter = new McpToolAdapter("github-server");
await planner.Add_plugin(adapter.GetTools());
```

1.0의 네이티브 지원은 이 어댑터 계층을 **`IMcpClient` 추상화**로 대체한다:

```csharp
// ✅ New: 네이티브 MCP 클라이언트
public interface IMcpClient
{
    Task<McpListToolsResult> ListToolsAsync(string serverName);
    Task<McpCallToolResult> CallToolAsync(string serverName, string tool, object args);
    IAsyncEnumerable<McpResource> StreamResources(string serverName);
    Task GuardAsync(McpSecurityPolicy policy);  // 1.0 신규: 보안 거버넌스
}
```

`GuardAsync`는 1.0의 신규 기능으로, MCP 서버에 적용할 수 있는 **security policy를 선언적**으로 적용한다:

```csharp
// MCP 서버별 보안 정책
runtime.ApplyMcpGuard("github", new McpSecurityPolicy
{
    AllowedTools = new[] { "search_code", "list_repos" },  // read-only 도구만 허용
    BlockedTools = new[] { "delete_repo", "create_issue" },
    RateLimitPerMinute = 30
});
```

### 4. A2A Protocol 통합: 어디까지 Google's 것인가

A2A Protocol의 핵심 스펙:

```json
// Agent Card (A2A의 발견 메커니즘)
{
  "agent_id": "researcher-agent",
  "name": "Researcher Agent",
  "capabilities": {
    "streaming": true,
    "pushNotifications": false,
    "handoff": true
  },
  "skills": [
    { "id": "github-code-search", "name": "GitHub Code Search" }
  ],
  "protocol": "A2A/1.0"
}
```

1.0 SDK는 A2A Agent Card를 다음과 같이 생성하고 advertising한다:

```csharp
// Agent Card 자동 생성 및 등록
builder.AddAgent("researcher", agent)
    .WithA2ACard(new A2ACapability
    {
        Streaming = true,
        Handoff = true,
        Skills = new[] { "github-code-search", "web-fetch" }
    });

// 에이전트 검색
var matched = await runtime.DiscoverAgentsAsync(
    skill: "github-code-search",
    protocol: AgentProtocol.A2A
);
```

**그러나 주의할 점**: 1.0은 A2A의 **core spec만 지원**하며, Microsoft 고유의 확장 (예: Teams 채널 연계, Azure AD 통합)은 별도 proprietary plugin으로 제공한다. A2A 순수 호환을 원하는 팀은 `WithA2AExtensions(false)` 옵션을 사용해야 한다.

---

## 5. Breaking Changes 및 마이그레이션

### Semantic Kernel 1.x → Agent Framework 1.0

| 변경점 | SK 1.x | AF 1.0 |
|---|---|---|
| NuGet 패키지 | `Microsoft.SemanticKernel` | `Microsoft.AgentFramework` |
| Plugin 등록 | `.AddSemanticSkill()` | `.AddMCPPlugin()` (MCP 기반) |
| Planner | `KernelPlanner` 추상화 | `IOrchestrator` 인터페이스 |
| Memory | `ISemanticTextMemory` | `IAgentMemory` (추가: vector + graph) |

마이그레이션 예시:

```csharp
// ❌ SK 1.x
kernel.Plugins.AddFromType<MyPlugin>();
var plan = await kernel.Planner.CreatePlanAsync(userGoal);

// ✅ AF 1.0
runtime.RegisterCapability<MyCapability>();
var result = await runtime.OrchestrateAsync(userGoal);
```

### AutoGen 0.x → Agent Framework 1.0

AutoGen의 GroupChat, RepresentativeAgent 패턴은 `AutoGenRuntime` 위에서 그대로 동작한다:

```python
# ❌ AutoGen 0.x
groupchat = GroupChat(agents=[planner, researcher], max_round=10)
manager = GroupChatManager(groupchat=groupchat)
await agent.a_initiate_chat(manager, message=task)

# ✅ AF 1.0 (AutoGenRuntime 사용 시 완전 호환)
runtime = AgentRuntime.CreateBuilder()
    .UseRuntime(AutoGenRuntime())  # 완전 호환 모드
    .Build()
# 코드 변경 없음 — 기존 AutoGen 스크립트가 그대로 동작
```

---

## 6. OpenClaw에서의 활용 가능성

주인님의 OpenClaw 환경은 이미 MCP 런타임으로 동작한다:

```
OpenClaw Plugin ← MCP → Camera, Sonos, Things3, Notion ...
```

Agent Framework 1.0의 `IMCPClient` 추상화는 OpenClaw의 **capability- 중심 설계와 구조적으로 일치**한다. 가능성 있는 통합 방향:

1. **OpenClaw Plugin을 MCP Server로 formalize**:现有的 imsg, sonoscli, camsnap技能을 MCP 스펙에 맞춰 server로 추출
2. **Multi-Agent Planner로서 OpenClaw 활용**: 복잡한 목표 분해가 필요한 작업에서 OpenClaw를 "도구 실행 에이전트"로 활용
3. **A2A Agent Card 기반 발견**: 여러 OpenClaw 인스턴스가 A2A로 서로를 발견하고 자원을 공유하는 시나리오

OpenClaw의 런타임이 Linux/macOS에서 동작하므로, `.NET` SDK보다는 **`@microsoft/agent-framework`** (Node.js) 또는 **Python 포팅**이 더 실용적이다.

---

## 7. 도입 판단: Adopt / Trial / Assess

**도입 권장(Adopt)** — 아래 조건에 해당하면 즉시 도입:

- 기존 Semantic Kernel 또는 AutoGen 기반 프로젝트를 유지 중이며, 두 프레임워크를 동시에 사용하고 있는 팀
- Enterprise 환경에서 MCP 서버 거버넌스(보안 정책, rate limit)가 필요한 경우
- Multi-Agent 협업에 A2A를 표준으로 채택하려는 경우

**검증 필요(Trial)** — PoC 후 판단:

- OpenClaw Plugin을 MCP 서버로 formalize하려는 실험적 작업
- Microsoft 생태계(Azure Copilot, Teams)와의 tight한 연계를 계획 중인 경우

**관찰 필요(Assess)** — 추가 정보 대기:

- Linux Foundation 거버넌스 전환(`microsoft/autogen` → `FoundationDB/autogen`) 완료 시점 확인
- Python SDK (`microsoft-autogen` 또는 `agentframework-python`) 정식 출시 여부

---

## 8. 요약 및 다음 단계

Microsoft Agent Framework 1.0은 2023~2025년에 걸쳐 분화했던 enterprise AI agent SDK를 다시 수렴시키는 릴리스다. Semantic Kernel의 구조적Planner와 AutoGen의 협업 에이전트 모델이 `UnifiedAgentRuntime`에서 만나고, MCP/A2A가 네이티브 레벨에서 지원된다.

이는 "**도구 연결 + 에이전트 협업 + 프로토콜 표준**"이 단일 SDK에서 모두 해결되는 시대를 의미한다. 기존 분산 아키텍처를 운영 중인 팀에게는 마이그레이션 비용이 있고, 신규 프로젝트에게는 강력한 기본값이다.

**실행 가능한 다음 액션:**
1. 기존 SK/AutoGen 프로젝트의 의존성 그래프를审计하고, 공통 기능 영역 파악
2. `Microsoft.AgentFramework` 또는 `@microsoft/agent-framework`를andbox에서 간단한 MCP 연결 테스트
3. A2A Agent Card 생성 및discovery 테스트

---

*References: [Microsoft Agent Framework 1.0 Release Notes](https://learn.microsoft.com/en-us/semantic-kernel/), [A2A Protocol 1.0 Spec](https://github.com/google/a2a), [Linux Foundation AAIF](https://foundationdb.org/)*
