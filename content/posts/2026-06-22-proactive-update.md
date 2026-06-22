---
title: "MCP 2026-07-28 스펙 완전 분석: 세션리스 아키텍처와 엔터프라이즈 인증의 혁명 (#048)"
date: "2026-06-22"
description: "Anthropic의 MCP(Model Context Protocol)가 2025년 11월 스펙 이후 가장 큰 개정을 앞두고 있다. 세션 제거, OAuth 2.1 기반 인증 강화, Extensions 프레임워크 도입까지 — 이 변화가 AI Agent 인프라에 어떤 의미인지 코드와 아키텍처 다이어그램으로 완전 분석한다."
tags:
  - MCP
  - Model Context Protocol
  - AI Agent
  - OAuth 2.1
  - Authentication
  - Protocol Design
  - Enterprise AI
  - Agent Architecture
  - RFC 9728
  - OpenID Connect
---

## 1. 들어가며: MCP가 다시 태어난다

2026년 5월 21일, MCP의 리드 메인테이너들이 **"MCP 2026-07-28 Release Candidate"**를 발표했다. 공식 블로그 포스트에서는 "런칭 이후 가장 큰 프로토콜 개정"이라고 표현했다. 마케팅 레토릭이 아니다.

이번 개정은 프로토콜의 토대를 다시 쓴다:

```
변경 요약 (2025-11-25 → 2026-07-28):

┌────────────────────────────────────────────────────┐
│ 1. 세션 제거 (Stateless Core)                       │
│    - initialize/initialized 핸드셰이크 삭제          │
│    - Mcp-Session-Id 헤더 제거 (SEP-2567)            │
│    - Round-Robin LB 가능, Shared Session Store 불필요 │
├────────────────────────────────────────────────────┤
│ 2. 인증 체계 강화                                   │
│    - OAuth 2.1 Resource Server 표준 준수            │
│    - RFC 9728 (Protected Resource Metadata) 필수     │
│    - RFC 8707 (Resource Indicators) 의무화           │
│    - CIMD (Client ID Metadata Document) 도입         │
├────────────────────────────────────────────────────┤
│ 3. Extensions 프레임워크 도입                        │
│    - Reverse-DNS 식별자 기반 Extension 레지스트리    │
│    - MCP Apps: 서버가 Interactive HTML UI 렌더링     │
│    - 버전 독립적 유지보수 가능                       │
├────────────────────────────────────────────────────┤
│ 4. 세 가지 핵심 기능 Deprecation                     │
│    - Dynamic Client Registration (RFC 7591) → Deprecated│
│    - 기존 세션 기반 API → 제거                      │
│    - 레거시 Capability Negotiation → server/discover │
└────────────────────────────────────────────────────┘
```

최종 스펙은 **2026년 7월 28일**에 출시된다. RC 발표부터 최종 스펙까지 10주는 SDK 메인테이너와 서버 구현자들이 실제 워크로드로 변경 사항을 검증할 수 있는 기간이다. 프로덕션에서 MCP 서버를 운영 중이라면, 지금이 마이그레이션 타이밍이다.

---

## 2. Stateless Core: 왜 세션을 버렸는가

### 2.1 문제의 시작: Sticky Session의 비극

2025-2026년 초기 MCP 배포에서 가장 큰 운영 난제는 **Sticky Session 강제**였다.

```
기존 MCP 아키텍처 (2025-11-25):

  Client
    │
    ▼
  Load Balancer (Round-Robin ❌ → Sticky Session 필수)
    │
    ├── MCP Server Instance A (Session: abc-123)
    │     └── Shared Session Store (Redis)
    │
    ├── MCP Server Instance B (Session: def-456)
    │     └── Shared Session Store (Redis)
    │
    └── MCP Server Instance C (Session: ghi-789)
          └── Shared Session Store (Redis)

```

문제점:
1. **Sticky Session 강제**: LB가 특정 인스턴스에 클라이언트를 고정해야 함
2. **Shared Session Store 필요**: 모든 인스턴스가 Redis 등 공유 저장소에 접근
3. **Deep Packet Inspection 불가피**: Gateway 레벨에서 Mcp-Session-Id 헤더 파싱
4. **Scale-Out 복잡도 증가**: 새 인스턴스 추가 시 세션 마이그레이션 고려
5. **장애 내성 저하**: 인스턴스 하나 죽으면 해당 세션 전체 손실

### 2.2 새로운 Stateless 아키텍처

MCP 2026-07-28에서는 이 모든 것이 사라진다.

```
새로운 MCP 아키텍처 (2026-07-28):

  Client
    │
    ▼
  Load Balancer (Round-Robin ✅)
    │
    ├── MCP Server Instance A
    ├── MCP Server Instance B
    └── MCP Server Instance C
         → 모든 인스턴스가 모든 요청을 처리 가능
```

이를 가능하게 하는 핵심 변경:

**1. Mcp-Session-Id 헤더 제거 (SEP-2567)**

프로토콜 레벨에서 클라이언트를 특정 서버 인스턴스에 고정하던 메커니즘이 완전히 사라졌다. 원격 MCP 서버가 더 이상 Sticky Session, Shared Session Store, Deep Packet Inspection을 필요로 하지 않는다.

**2. 새로운 라우팅 헤더: Mcp-Method와 Mcp-Name (SEP-2243)**

Stateless 환경에서 요청을 적절히 라우팅하기 위해 두 개의 새로운 HTTP 헤더가 도입되었다.

```http
POST /mcp HTTP/1.1
Host: mcp.example.com
Mcp-Method: tools/call
Mcp-Name: weather-server-v2
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "get_forecast",
    "arguments": {
      "city": "Seoul"
    }
  },
  "id": 1
}
```

`Mcp-Method`는 요청의 의도를 나타내고 (tools/call, resources/read, prompts/get 등), `Mcp-Name`은 대상 서버의 이름을 식별한다. 이 두 헤더만으로 게이트웨이는 적절한 MCP 서버로 요청을 프록시할 수 있다.

**3. 핸드셰이크 제거 + _meta 기반 Capability 전달**

```typescript
// 이전 방식: 두 단계 핸드셰이크
// Step 1: initialize
{ "jsonrpc": "2.0", "method": "initialize", "params": { "protocolVersion": "2025-11-25", "capabilities": {...} }, "id": 1 }
// Step 2: initialized (notification)
{ "jsonrpc": "2.0", "method": "notifications/initialized" }

// 새로운 방식 (2026-07-28): _meta에 정보 포함
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "get_forecast",
    "arguments": { "city": "Seoul" }
  },
  "_meta": {
    "protocolVersion": "2026-07-28",
    "clientInfo": {
      "name": "my-agent",
      "version": "1.0.0"
    },
    "clientCapabilities": {
      "tools": { "listChanged": true },
      "resources": { "subscribe": true },
      "extensions": {
        "com.example.mcp-apps": {
          "version": "1.0.0"
        }
      }
    }
  },
  "id": 1
}
```

프로토콜 버전, 클라이언트 정보, Capability가 모든 요청의 `_meta`를 통해 전달된다. 서버는 `server/discover` 메서드를 호출하여 언제든 서버의 Capability를 조회할 수 있다.

```typescript
// 서버 Capability 동적 조회
const response = await client.request("server/discover", {});
console.log(response.capabilities);
// {
//   tools: { listChanged: true, ttlMs: 30000 },
//   resources: { subscribe: false },
//   extensions: {
//     "com.example.mcp-apps": { "version": "1.1.0" }
//   }
// }
```

### 2.3 명시적 Handle 패턴 (Explicit Handle)

세션리스가 애플리케이션의 상태 유지를 불가능하게 만드는 것은 아니다. 오히려 더 강력한 패턴을 제시한다.

```
기존: 숨겨진 세션 상태
  MCP 서버가 내부적으로 session_id → state 맵 유지
  → 모델이 상태를 인지하지 못함
  → 디버깅 어려움, 세션 누수 위험

새로운 방식: 명시적 Handle
  Tool이 basket_id, browser_id 같은 Handle을 반환
  → 모델이 Handle을 인지하고 조작 가능
  → 여러 Tool 간 Handle 전달 가능
  → 로그에 모든 Handle 흐름이 기록됨
```

```typescript
// 서버: 명시적 Handle을 반환하는 Tool
server.tool(
  "create_shopping_cart",
  "새로운 쇼핑 카트 생성",
  {},
  async () => {
    const cartId = crypto.randomUUID();
    await db.insertCart({ id: cartId, items: [], createdAt: new Date() });
    return {
      content: [{ type: "text", text: JSON.stringify({ cartId }) }]
    };
  }
);

// 모델이 Handle을 다음 Tool 호출에 전달
server.tool(
  "add_to_cart",
  "카트에 아이템 추가",
  {
    cartId: z.string().describe("create_shopping_cart에서 받은 cartId"),
    itemId: z.string(),
    quantity: z.number().int().positive()
  },
  async ({ cartId, itemId, quantity }) => {
    await db.addItem(cartId, itemId, quantity);
    return { content: [{ type: "text", text: "OK" }] };
  }
);
```

RC 블로그 포스트에서 언급된 것처럼, 이 패턴은 종종 숨겨진 세션 상태보다 더 강력하다. **모델이 Handle에 대해 추론하고, Tool 간에 조합하며, 단계 간에 전달할 수 있기 때문이다.**

---

## 3. Authorization: BYO-Token에서 Enterprise-Grade로

### 3.1 이전 스펙의 한계: Bring Your Own Token

2025-11-25 스펙의 인증 접근법은 정확히 표현하자면 "Bring Your Own Token"이었다. OAuth 2.1 Resource Server 개념을 도입했지만, 다음과 같은 문제가 있었다:

- Refresh Token 동작이 **정의되지 않음** → 구현마다 제각각
- **Issuer 검증 부재** → Mix-Up Attack에 취약
- **Client Registration 방식이 불명확** → DCR(RFC 7591)만 언급
- **Application Type 미정의** → CLI/Desktop 클라이언트의 localhost Redirect URI가 Web 앱으로 잘못 인식됨

### 3.2 2026-07-28의 인증 체계

이번 스펙은 인증을 다섯 가지 측면에서 완전히 재정의한다.

#### 3.2.1 OAuth 2.1 Resource Server + RFC 9728 (Protected Resource Metadata)

```typescript
// MCP Server가 제공하는 Resource Metadata (RFC 9728)
// GET /.well-known/oauth-protected-resource

const protectedResourceMetadata = {
  // 보호된 리소스 (MCP 서버 자체)
  "resource": "https://mcp.mycompany.com/weather",

  // 인증 서버 자동 탐색
  "authorization_servers": [
    "https://auth.mycompany.com/oauth/v2"
  ],

  // 지원되는 인증 방식
  "token_introspection_endpoint": "https://auth.mycompany.com/oauth/v2/introspect",
  "token_introspection_auth_methods_supported": ["client_secret_basic"],

  // 보호 scope
  "resource_scopes": ["mcp:weather:read", "mcp:weather:write"]
};
```

클라이언트는 이 메타데이터를 통해 적절한 Authorization Server를 **자동으로** 찾을 수 있다.

#### 3.2.2 Resource Indicators (RFC 8707) 필수

이전에는 MCP 클라이언트가 Access Token을 얻으면 "이 토큰이 어느 서버를 위한 것인지" 명시하지 않았다. RFC 8707이 이를 강제한다.

```typescript
// OAuth 2.0 Authorization Request with Resource Indicator
const authUrl = new URL("https://auth.mycompany.com/oauth/v2/authorize");
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("client_id", "my-mcp-client");
authUrl.searchParams.set("redirect_uri", "http://localhost:3000/callback");
authUrl.searchParams.set("resource", "https://mcp.mycompany.com/weather");  // RFC 8707
authUrl.searchParams.set("scope", "mcp:weather:read");
```

이걸로 **악의적인 MCP 서버가 다른 서버용 토큰을 가로채는 공격을 방어**한다. 토큰 발급 시점에 Resource가 명시적으로 바인딩되므로, 토큰은 지정된 Resource(Origin)에서만 사용 가능하다.

#### 3.2.3 CIMD (Client ID Metadata Document) 도입

Dynamic Client Registration(DCR, RFC 7591)은 Deprecated되고, 새로운 CIMD(Client ID Metadata Document)가 권장 방식이 되었다.

```typescript
// CIMD: MCP Client가 자신의 Metadata를 공개
// GET https://my-client.example.com/.well-known/oauth-client-meta

const clientMetadata = {
  "client_id": "my-mcp-client",
  "client_name": "My MCP Agent",
  "client_uri": "https://my-client.example.com",
  "logo_uri": "https://my-client.example.com/logo.png",
  "tos_uri": "https://my-client.example.com/tos",
  "policy_uri": "https://my-client.example.com/privacy",
  "application_type": "native",          // RFC 837: Desktop/CLI 클라이언트
  "redirect_uris": [
    "http://localhost:3000/callback",
    "my-mcp-agent://oauth/callback"
  ],
  "token_endpoint_auth_method": "none",   // PKCE
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"]
};
```

DCR이 Deprecated된 이유: DCR은 Authorization Server가 Client Registration을 동적으로 처리하는 방식인데, 이는 SPOF(Single Point of Failure)를 만들고, Registration 요청 폭주와 남용 위험이 있었다. CIMD는 **Client가 자신의 Metadata를 직접 호스팅**하고, AS는 이를 정적으로 읽어서 처리한다.

#### 3.2.4 Issuer 검증 강화 (SEP-2352, RFC 9207)

```typescript
// Issuer 검증 로직 예시
async function validateAuthorization(client, authResponse) {
  // 1. Authorization Response에 iss 클레임이 있는지 확인 (RFC 9207)
  if (!authResponse.iss) {
    throw new Error("Missing iss parameter — possible mix-up attack");
  }

  // 2. iss가 우리가 요청한 Authorization Server와 일치하는지 확인
  if (authResponse.iss !== EXPECTED_AUTHORIZATION_SERVER) {
    throw new Error(
      `Issuer mismatch: expected ${EXPECTED_AUTHORIZATION_SERVER}, got ${authResponse.iss}`
    );
  }

  // 3. 등록된 Client Credential이 해당 Issuer에 바인딩되어 있는지 확인
  const registeredIssuer = await client.getRegisteredIssuer();
  if (registeredIssuer && registeredIssuer !== authResponse.iss) {
    // Resource가 AS 간에 마이그레이션된 경우 Re-Registration 필요
    throw new Error(
      "Resource migrated between authorization servers — re-registration required"
    );
  }
}
```

이 검증은 MCP의 배포 패턴(하나의 클라이언트가 여러 MCP 서버와 통신)에서 필수적이다. Issuer를 검증하지 않으면 악성 MCP 서버가 정상 서버의 인증 흐름을 가로채는 Mix-Up Attack이 가능하다.

#### 3.2.5 Refresh Token과 Step-Up Authorization

Refresh Token 동작이 공식적으로 문서화되었다 (SEP-2207).

```typescript
// Refresh Token 요청
const tokenResponse = await client.refreshToken({
  refresh_token: storedRefreshToken,
  client_id: "my-mcp-client",
  // 선택적: scope 확장 (Step-Up Authorization)
  scope: "mcp:weather:read mcp:weather:write"  // 기존 read → read+write로 확장
});

// Step-Up Authorization: 기존 Token의 scope를 확장하는 과정
// SEP-2350: Scope Accumulation 규칙 정의
// → 새로 발급된 Token은 이전 Token의 Scope를 포함(accumulate)해야 함
```

---

## 4. Extensions 프레임워크: MCP의 미래

### 4.1 Extension 아키텍처

Extensions는 이제 MCP의 **일급 시민(First-Class Citizen)**이 되었다.

```
Extension 명세:

com.example.mcp-apps@1.0.0
├── Reverse-DNS 식별자 (com.example.mcp-apps)
├── 독립적인 버전 관리 (메인 스펙과 분리)
├── 독립 메인테이너
├── 자체 리포지토리
└── Capability 협상을 통해 활성화
```

```typescript
// Extension 협상: Client와 Server가 지원하는 Extension Map 교환
const serverCapabilities = {
  tools: { listChanged: true },
  resources: { subscribe: true },
  extensions: {
    "com.example.mcp-apps": {
      version: "1.0.0",
      name: "MCP Apps"
    }
  }
};

// Client가 특정 Extension을 지원하면 활성화
if (serverCapabilities.extensions["com.example.mcp-apps"]) {
  await client.enableExtension("com.example.mcp-apps");
}
```

### 4.2 MCP Apps: 가장 중요한 Extension

이번 RC와 함께 발표된 두 Extension 중 **MCP Apps**가 가장 주목할 만하다. 서버가 Interactive HTML UI를 클라이언트에 직접 렌더링할 수 있게 해준다.

```typescript
// MCP App 서버 구현 예시: SQL Editor
server.tool(
  "open_query_editor",
  "SQL 쿼리 편집기 열기",
  {
    databaseId: z.string(),
    initialQuery: z.string().optional()
  },
  async ({ databaseId, initialQuery }) => {
    // MCP App URL 반환 → 클라이언트가 HTML UI 렌더링
    return {
      content: [{
        type: "mcp-app",
        app: "com.mycompany.sql-editor",
        url: `https://mcp.mycompany.com/apps/sql-editor/${databaseId}`,
        params: {
          initialQuery: initialQuery || "SELECT * FROM users LIMIT 10"
        }
      }]
    };
  }
);
```

중요한 설계 원칙: **렌더링된 UI에서 발생하는 모든 상호작용은 동일한 JSON-RPC 프로토콜을 통해 호스트로 전달된다.** 즉, 모든 UI-initiated Action이 Tool Call과 동일한 Audit 및 Consent 경로를 통과한다.

```
보안 설계:
┌──────────────┐     JSON-RPC (Tool Call)     ┌──────────────┐
│   MCP App    │ ←────────────────────────── │  MCP Client  │
│  (HTML UI)   │     모든 Action 감사/추적    │  (Host)      │
└──────────────┘                              └──────┬───────┘
                                                      │ JSON-RPC
                                                      ▼
                                              ┌──────────────┐
                                              │  MCP Server  │
                                              │  (Tool Exec) │
                                              └──────────────┘
```

이것이 MCP를 단순한 Tool Execution 프로토콜에서 **Agent UI 플랫폼**으로 진화시키는 핵심이다.

---

## 5. 마이그레이션 전략: 지금 당장 해야 할 일

### 5.1 마이그레이션 체크리스트

| 우선순위 | 변경 사항 | 액션 | Deadline |
|---------|---------|------|---------|
| 🔴 HIGH | 세션 기반 코드 제거 | `Mcp-Session-Id` 의존성 제거, `initialize` 핸드셰이크 제거 | 7월 28일 |
| 🔴 HIGH | `_meta` Capability 전달 방식 도입 | 모든 요청에 `_meta` 포함, `server/discover` 구현 | 7월 28일 |
| 🟡 MEDIUM | OAuth 2.1 + RFC 9728 구현 | Protected Resource Metadata 엔드포인트 추가, Resource Indicators 지원 | 7월 28일 |
| 🟡 MEDIUM | CIMD 채택 | `/.well-known/oauth-client-meta` 엔드포인트 구현 | 7월 28일 |
| 🟢 LOW | MCP Apps 탐색 | Extension 협상 코드 추가 | 8월+ |
| 🟢 LOW | TTL 기반 `tools/list` 캐싱 | 캐싱 전략 수립 | 8월+ |

### 5.2 코드 레벨 마이그레이션

```typescript
// 마이그레이션 예시: 기존 MCP Server

// ❌ OLD (2025-11-25)
import { Server } from "@modelcontextprotocol/sdk";

const server = new Server({
  name: "weather-server",
  version: "1.0.0"
}, {
  capabilities: {
    tools: {}
  }
});

// 핸드셰이크 필요
await server.connect(transport);

// ✅ NEW (2026-07-28)
import { Server } from "@modelcontextprotocol/sdk";

const server = new Server({
  name: "weather-server",
  version: "1.0.0",
  
  // OAuth 2.1 Resource Server 설정
  authorization: {
    resourceServer: {
      metadata: {
        resource: "https://mcp.mycompany.com/weather",
        authorizationServers: ["https://auth.mycompany.com/oauth/v2"],
        scopes: ["mcp:weather:read", "mcp:weather:write"]
      }
    }
  },

  // Extension 지원 선언
  extensions: {
    "com.example.mcp-apps": { version: "1.0.0" }
  }
});

// server/discover 자동 구현됨
// _meta 기반 capability 전달 자동 처리
// No handshake needed
await server.listen(transport);
```

### 5.3 게이트웨이/로드 밸런서 설정

```nginx
# 기존: Sticky Session이 필수였던 nginx 설정
upstream mcp_servers {
    ip_hash;  # ← Sticky Session 강제
    server mcp1:8080;
    server mcp2:8080;
    server mcp3:8080;
}

# 새로운: Plain Round-Robin
upstream mcp_servers {
    # Session 관련 설정 완전 제거
    server mcp1:8080;
    server mcp2:8080;
    server mcp3:8080;
}
```

---

## 6. 실전 분석: 이 변경이 왜 중요한가

### 6.1 운영 관점

1. **인프라 단순화**: Shared Session Store(Redis 등) 불필요 → 운영 비용 감소, 장애 포인트 제거
2. **Scale-Out 용이성**: 새 인스턴스 추가 시 세션 마이그레이션 불필요 → Auto-Scaling 실제 가능
3. **Zero-Downtime 배포**: Rolling Update 중에도 기존 요청 처리 가능 (Session Loss 없음)
4. **Stateful 앱도 Handle 패턴으로**: Handle의 명시적 전달은 숨겨진 세션보다 디버깅과 Observability 측면에서 우월

### 6.2 보안 관점

1. **Enterprise-Grade 인증**: OAuth 2.1 + RFC 9728 + RFC 8707 + RFC 9207 전체 스택
2. **Mix-Up Attack 방어**: Issuer 검증과 Resource Indicators의 이중 방어
3. **정의된 Refresh Token**: undefined behavior였던 Refresh Token 동작이 표준화됨
4. **Application Type 명시화**: Desktop/CLI Client가 Web으로 잘못 인식되는 문제 해결

### 6.3 에코시스템 관점

1. **AWS Bedrock AgentCore**: 이미 MCP와 A2A 지원 발표 — 클라우드 벤더의 MCP 채택 신호 (2026년 6월)
2. **Chrome DevTools MCP**: 구글이 Chrome DevTools를 MCP 서버로 제공하는 npm 패키지 출시 (2026년 6월 18일)
3. **MCP Apps**: 단순 Tool 실행에서 Interactive UI까지 확장되는 프로토콜의 진화

---

## 7. 결론: 2026년 하반기 MCP 로드맵

이번 개정은 MCP가 "실험적인 AI 도구 연결 프로토콜"에서 **"Enterprise-Grade Agent Communication Backbone"**으로 성숙하는 결정적인 전환점이다.

핵심 요약:

```
1. Stateless + OAuth 2.1 + Extensions = Production-Ready MCP
   → 2025년 "MCP로 PoC"에서 2026년 "MCP로 프로덕션 운영"으로

2. 세션리스는 운영 단순화 이상의 의미
   → Scale-Out, Zero-Downtime, Observability의 근본적 개선

3. 인증 체계는 MCP의 엔터프라이즈 도입 관문
   → Compliance, Audit, RBAC, SSO 연동을 프로토콜 레벨에서 지원

4. Extensions는 MCP의 미래 성장 동력
   → MCP Apps로 Interactive UI까지 커버하는 범용 Agent 플랫폼으로
```

7월 28일, 최종 스펙이 출시되면 MCP 생태계는 다시 한번 도약할 것이다. 지금이 준비할 시간이다.

---

*참고: 이 글은 2026년 6월 22일 기준 MCP 2026-07-28 Release Candidate와 공식 블로그 포스트를 기반으로 작성되었습니다. 최종 스펙은 변경될 수 있습니다.*
