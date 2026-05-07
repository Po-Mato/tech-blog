---
title: "AI Agent Authentication in 2026 — NHI, SPIFFE, and the Death of Static API Keys"
date: 2026-05-07
description: "에이전트가 서로를 신뢰하고, 도구를 호출하고, 권한을 위임하는 세계에서 정적 API 키는 충분하지 않다. 2026년 현재 AI Agent 인증의 핵심 개념(NHI, SPIFFE/SPIRE, mTLS, OAuth 2.0 M2M)을 CISA/NSA/Five Eyes 공동 가이드라인과 함께 깊이 분석하고, 실무에 바로 적용 가능한 코드 예시와 함께 정리한다."
tags:
  - AI Agent
  - Security
  - Authentication
  - NHI
  - SPIFFE
  - mTLS
  - Zero Trust
  - Production AI
  - Agent Architecture
---

> **한 줄 요약:** 2026년 현재 에이전트는 수동적 도구가 아니라 능동적 주체다. 그렇다면 그 주체의 정체성을 어떻게 증명하고, 권한을 어떻게 제한하며, 위임 체인을 어떻게 추적할 것인가?

## 서론: 에이전트가 "주체"가 되는 순간

2024년까지 AI 에이전트는 단순한 도구였다. 사용자가 명령을 내리면 LLM이 응답을 생성하고, 끝이었다.

2026년 현재 이 그림은 완전히 달라졌다. 에이전트는 수십 개의 내부 단계를 자동 실행하고, 서브 에이전트를 스폰하며, 외부 API를 호출하고, 데이터베이스에 기록하고, 인간의 승인을 기다리지 않고 직접 변경을 수행한다. CISA/NSA/Five Eyes는 4월 말 공동 가이드라인을 통해 "이미 위험 인프라와 방위 부문에 에이전트 AI가 배치되어 있으며, 대부분 안전하게 모니터링할 수 없는 수준의 접근 권한을 부여받고 있다"고 경고했다.

여기서 핵심 질문이 하나다: **에이전트를 인증하는 기존 방식이 정말 유효한가?**

---

## 1. 정적 API 키의 종말

### 정적 API 키의 세 가지 근본적 문제

예전에는 에이전트에게 API 키 하나를 부여하면 충분했다. 키를secret manager에 저장하고, 요청 시 헤더에 포함시키면 되었다. 하지만 2026년 현재, 이 모델은 세 가지 구조적 문제面前에서 붕괴했다.

**첫 번째 문제: 만료가 없다.** 정적 API 키는 자동으로 ро테이션되지 않는다. 키가 유출되면 공격자는 무제한으로 사용할 수 있다. 대규모 조직에서 개발자들이 API 키를 코드 리포지토리에 커밋하거나 로그에 남기는 사고는 일상적이다.

**두 번째 문제: 범위(binding)가 없다.** 정적 API 키는 "이 키를 가진 사람은 이 서비스에 접근할 수 있다"는 것만 표현한다. 키를 가진 에이전트가 어떤 태스크를 위해 스폰되었는지, 어떤 도구를 호출할 권한이 있는지, 어떤 데이터에 접근해야 하는지는 알 수 없다.

**세 번째 문제: 신원 추적이 불가능하다.** 키가 유출되어滥用되면, 그것을 사용한 것이哪个 에이전트인지, 어떤 워크플로우였는지 알 방법이 없다. 감사와 거버넌스의 기본 전제가 무너진다.

### 2026년 업계의 합의

```
Development 환경    → 정적 API 키 (허용)
Staging/Production  → 정적 API 키 (불허용)
```

2026년 현재, production 환경에서 정적 API 키를 사용하는 것은 보안 감사 시 가장 먼저 지적되는 위반 사항이다. 업계의 baseline은 이미 **OAuth 2.0 Client Credentials (M2M)** 방식으로 이동했다.

---

## 2. Non-Human Identity (NHI) — 에이전트에게 cryptographic identity를 부여하는 것

### NHI란 무엇인가

NHI(Non-Human Identity)는 사람이나 서비스 계정이 아닌, 소프트웨어 에이전트에게 부여하는 암호ographically bound identity다. NHI는 workload identity, service account, agent certificate 등 여러 형태로 구현된다.

CISA/NSA 가이드라인은 이를 다음과 같이 명시했다:

> *"Developers should construct each agent as a distinct principal, a cryptographically anchored identity with its own unique keys or certificates."*

이것이 의미하는 바는 명확하다. 에이전트 하나あたり 하나의 identity다. 여러 에이전트가 하나의 공유 credential을 사용하는 것은不允许다.

### 왜 "사람의 정체성" 모델이 통하지 않는가

기존 IAM(Identity and Access Management)은 사람을 대상웠다. 사람은 사내 SSO로 로그인하고, 그 세션은 수 시간 동안 유지되며, MFA로 보안을 강화한다.

에이전트는 이 모델과 완전히 다른 특성을 가진다:

| 특성 | 사람 | 에이전트 (2026) |
|------|------|-----------------|
| 세션 수명 | 수 시간 ~ 수 일 | 수 분 ~ 수 시간 (태스크 기반) |
| 인스턴스 수 | 수천 명 | 조직당 수백만 개 |
| Credential 관리 | 분기별 로테이션 | 수 분 단위 만료, 자동 ро테이션 |
| MFA 방식 | TOTP, Push, Hardware Key | Hardware Attestation, Orchestrator 승인을 통한 dual-party 확인 |
| 이상 탐지 | 비정상적 로그인 위치/시간 | 예기치 않은 도구 호출, scope creep, 프로프트 인젝션 신호 |

2026년 현재, 대규모 기업에서 NHI가 사람 인 identity를 능가하는 비율은 **40:1**에 달한다.

---

## 3. Authentication Methods — 2026년 현재 가능한 옵션들

### 3.1 OAuth 2.0 Client Credentials (M2M) — Baseline Standard

Machine-to-Machine 토큰 발행을 위한 표준. 인간의 개입 없이 에이전트에게 직접 토큰을 발급한다. 토큰은 선언된 권한 범위로 scope되고, 자동 만료된다.

```typescript
// OAuth 2.0 Client Credentials를 사용한 Agent 인증 예시
// (실무에서는 서버 사이드에서만 처리하고, 토큰을 에이전트 설정 파일에 저장하지 마세요)

interface AgentCredential {
  client_id: string;
  client_secret: string;  // 실제로는vault에서 동적으로 가져옴
  scope: string[];        // 이 에이전트에 허용된 권한 목록
  audience: string;       // 이 토큰이 유효한 대상 서비스
}

// 실무 적용: Vault에서 동적으로 секрет를 가져오는 예시
async function getAgentToken(agentId: string, taskScope: string[]): Promise<string> {
  const vault = getVaultClient();
  
  // 에이전트의 동적 secret을 vault에서 가져옴
  const { client_id, client_secret } = await vault.getAgentCredentials(agentId);
  
  const tokenResponse = await fetch(`${AUTH_SERVER}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id,
      client_secret,
      scope: taskScope.join(' '),
    }),
  });
  
  const { access_token, expires_in } = await tokenResponse.json();
  return access_token;
}

// 에이전트가 API 호출 시 토큰을 포함시키는 예시
async function callTool(agentToken: string, toolEndpoint: string, payload: object) {
  const response = await fetch(toolEndpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${agentToken}`,
      'Content-Type': 'application/json',
      'X-Agent-Identity': getCurrentAgentId(),  // 추적을 위한 헤더
      'X-Task-Id': getCurrentTaskId(),           // 감사 로그를 위한 헤더
    },
    body: JSON.stringify(payload),
  });
  
  if (response.status === 401) {
    // 토큰 만료 → 갱신 후 재시도
    const newToken = await refreshAgentToken();
    return callTool(newToken, toolEndpoint, payload);
  }
  
  return response.json();
}
```

**장점:** 구현이 비교적 간단하고, 범위 제어가 직관적이며, 많은 identity provider가 지원한다.
**단점:** 토큰 자체가 탈취되면 스코프 내에서滥用 가능하다. mTLS만큼 강한 상호 인증은 제공하지 않는다.

### 3.2 Mutual TLS (mTLS) — 높은 민감도 워크로드용

전송 계층 프로토콜로, 클라이언트와 서버 모두 유효한 인증서를 제시해야 연결이 수립된다. 양방향 신원 확인이 이루어지므로, 네트워크 레벨에서 트러스트가 보장되어야 하는 높은 민감도 워크로드에 적합하다.

```typescript
// mTLS 인증을 사용하는 에이전트 간 통신 예시 (Node.js / tls 모듈 사용)
// 실무에서는 SPIFFE/SPIRE가 인증서 라이프사이클을 자동으로 관리한다.

import * as tls from 'tls';
import * as fs from 'fs';

interface AgentTLSAuth {
  cert: Buffer;
  key: Buffer;
  ca: Buffer;  // 서버 인증서 검증용 CA
}

// 에이전트의 workload identity 인증서 (SPIRE를 통해 자동 갱신)
const agentCert = await getWorkloadCertificate('agent-coder-001');

const socket = tls.connect({
  host: 'internal-tool-service',
  port: 8443,
  cert: agentCert.cert,
  key: agentCert.privateKey,
  ca: getInternalCA(),           // 서비스 Mesh의 내부 CA
  rejectUnauthorized: true,       // 유효하지 않은 인증서는 즉시 거부
  // mTLS 필수 옵션
  requestCert: true,              // 서버에게도 인증서를 요청
  verify: (serverCert) => {
    // 서버 인증서의 identity 검증
    // 이 검증으로 "이 서비스가 내가 호출하려는 서비스가 맞는지" 확인
    return verifySPIFFEID(serverCert, 'internal-tool-service.prod.cluster.local');
  },
});

socket.write(JSON.stringify({
  agent_id: 'agent-coder-001',
  task_id: 'task-2026-05-07-001',
  tool_call: 'code_search',
  params: { query: 'authentication patterns' }
}));

// 응답 처리
socket.on('data', (data) => {
  const response = JSON.parse(data.toString());
  // 응답의 출처 인증서를 검증 → MITM 공격 방지
  logAgentToolCall(response, socket.getPeerCertificate());
});
```

**장점:** 네트워크 레벨에서 양방향 인증이 이루어지므로, 토큰 탈취와 관계없이 인증서를 위조하는 것이 사실상 불가능하다.
**단점:** 인증서 관리와 로테이션의 운영 복잡성이 높다. SPIFFE/SPIRE 없이는 사실상 유지보수가 어렵다.

### 3.3 SPIFFE / SPIRE — 동적 환경에서의 암호 inúmer 신원

SPIFFE(Secure Production Identity Framework for Everyone)는 동적 환경에서 워크로드에 암호화 신원을 부여하고 로테이션하는 개방형 표준이다. SPIRE는 그 production 구현체다.

핵심 개념은 이렇다. 에이전트가 시작될 때 SPIRE agent가 그 에이전트의 workload를 attestation한다 — 즉, "이 에이전트가 어떤 환경에서, 어떤 메타데이터로 실행되고 있는가"를 검증한다. 검증이 완료되면 SPIFFE ID(SVID: SPIFFE Verifiable Identity Document)가 발급되고, 이 SVID는 짧은 수명을 가지며 자동 로테이션된다.

```
[에이전트 시작]
  → SPIRE Agent가 workload attestation 수행 (어떤 노드에서, 어떤 레이블로 실행 중인가)
  → SVID 발급 (짧은 수명의 인증서)
  → 다른 서비스와 통신할 때 mTLS로 서로의 SVID를 검증
  → 수명이 만료되면 자동 갱신
  → 에이전트 종료 시 인증서 자동 폐기
```

```yaml
# SPIRE Server 설정 파일 예시 (spire-server.conf)
# 실무에서는 Terraform/Ansible 등으로 관리

entries:
  - spiffe_id: "spiffe://prod.cluster.local/agent/coder"
    parent_id: "spiffe://prod.cluster.local/k8s-sa/default"
    selectors:
      - type: "k8s"
        pod_label: "app: agent-coder"
        namespace: "ai-agents"
    
  - spiffe_id: "spiffe://prod.cluster.local/agent/reviewer"
    parent_id: "spiffe://prod.cluster.local/k8s-sa/default"
    selectors:
      - type: "k8s"
        pod_label: "app: agent-reviewer"
        namespace: "ai-agents"

# 이 설정으로 coder 에이전트는 reviewer 에이전트의 신원을 검증할 수 있지만,
# 데이터베이스 에이전트의 신원은 검증할 수 없음 —最小 권한의 물리적 구현
```

```typescript
// 에이전트가 SPIFFE SVID를 사용하는 실무 코드
import { AgentAPI } from '@spiffe/spire-agent-sdk';

class SpireAgent {
  private client: AgentAPI;
  
  async initialize(agentType: 'coder' | 'reviewer' | 'executor') {
    // SPIRE Agent Unix socket을 통해 통신
    this.client = await AgentAPI.connect('/spire-agent.sock', {
      agentType,
      // SPIRE가 자동으로 SVID를 갱신하므로, 에이전트는 만료 시간을 신경 쓰지 않음
      // 에이전트가 통신할 때마다 SPIRE가 현재 유효한 SVID를 사용
    });
    
    console.log(`SPIFFE ID: ${this.client.getSPIFFEID()}`);
    // 출력 예: spiffe://prod.cluster.local/agent/coder
  }
  
  async callService(serviceName: string, payload: object) {
    // SPIRE가 자동으로 현재 유효한 SVID를 사용하여 mTLS 소켓을 설정
    const socket = await this.client.createMTLSConnection(serviceName);
    
    // 이 소켓으로의 모든 통신은 자동으로 상호 인증됨
    // 호출하는 쪽도 호출받는 쪽도 cryptographic identity가 있다
    
    const response = await socket.transmit(payload);
    
    // 감사 로그에 SPIFFE ID 기록
    auditLogger.log({
      caller_spiffe_id: this.client.getSPIFFEID(),
      target_service: serviceName,
      payload_hash: sha256(JSON.stringify(payload)),
      timestamp: new Date().toISOString(),
    });
    
    return response;
  }
}
```

### 3.4 Attestation-Backed Tokens — 하드웨어 수준의 검증

토큰 발급이 하드웨어 또는 플랫폼 attestation(검증)에 조건부로缚られる 방식이다. 에이전트가 기밀 컴퓨팅 enclave(예: AWS Nitro Enclave, Intel TDX) 내에서 실행되고 있음을 증명해야만 토큰을 받을 수 있다. 금융 및 의료 등 엄격한 규제 업계의 2026년 컴플라이언스 프레임워크에서 요구되고 있다.

```typescript
// Attestation-Backed Token 획득 예시
// (AWS Nitro Enclave 환경에서의 구현)

import { EnclaveAttester } from '@nitro/enclave-attestation';

async function getAttestedToken(agentId: string): Promise<string> {
  // 1단계: 현재 실행 환경의 attestation 수집
  const attestation = await EnclaveAttester.attest({
    measurement: process.env.ENCLAVE_MEASUREMENT,
    user_data: agentId,  // 이 enclave에서 실행되는 에이전트의 identity
    //nonce: 서버가 제공하는 랜덤 값 (replay 공격 방지)
  });
  
  // 2단계: attestation 결과를 identity provider에 제출
  const response = await fetch(`${TRUSTED_IDP}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'attestation',
      attestation_document: attestation.document,
      agent_id: agentId,
    }),
  });
  
  if (!response.ok) {
    // attestation 검증 실패 — 이 환경은 신뢰할 수 없음
    throw new Error('Attestation rejected: this environment is not trusted');
  }
  
  const { token } = await response.json();
  return token;
  // 이 토큰은 enclave 외부에서는 사용할 수 없음 (토큰 자체가 enclave identity에 묶여 있음)
}
```

---

## 4. Agent Identity Lifecycle — 프로비저닝부터 해지까지

에이전트의 신원 관리는 한 번의 인증으로 끝나지 않는다. 전체 수명 주기를 프로그래밍 방식으로 관리해야 한다.

### 네 단계로 보는 에이전트 신원 라이프사이클

**1단계: 프로비저닝 (Provisioning at Spawn Time)**

에이전트가 스폰될 때 신원이 즉시 부여된다. Orchestration 플랫폼(예: Temporal, LangGraph Runtime)이 이 역할을 수행한다.

```typescript
interface AgentProvisioning {
  agent_id: string;         // UUID 등 고유 식별자
  spiffe_id: string;        // SPIFFE 표준 identity
  created_at: Date;
  parent_principal: string; // 이 에이전트를 위임한 상위 주체 (사람 또는 상위 에이전트)
  workload_type: 'coder' | 'reviewer' | 'executor' | 'datafetcher' | ...;
  initial_scope: Permission[];  // 태스크 시작 시 부여된 기본 권한
}

// Temporal Workflow에서의 프로비저닝 예시
async function spawnCodingAgent(taskId: string, parentId: string): Promise<AgentProvisioning> {
  const agentId = `agent-${taskId}-${Date.now()}`;
  
  const provisioning = await identityManager.provision({
    agent_id: agentId,
    spiffe_id: `spiffe://prod.cluster.local/agent/coder/${agentId}`,
    parent_principal: parentId,
    workload_type: 'coder',
    initial_scope: [
      { resource: 'code_search', actions: ['read'] },
      { resource: 'git_repo', actions: ['read'] },
      { resource: 'llm_api', actions: ['invoke'] },
    ],
    // 이 시점에서 vault에 credential이 저장되고,审计 로그에 기록됨
  });
  
  console.log(`Agent provisioned: ${provisioning.spiffe_id}`);
  return provisioning;
}
```

**2단계: 스코프 바인딩 (Scope Binding During Task Assignment)**

에이전트가 특정 태스크를 할당받으면, 그 태스크에 필요한 최소 권한만 동적으로 부여된다. 이것이 **Least-Privilege Scoping**의 실전 구현이다.

```typescript
// 동적 스코프 바인딩 예시
function bindTaskScope(
  agent: AgentProvisioning,
  task: TaskManifest
): ScopedPermission[] {
  const allowedTools = task.required_tools; // 태스크 매니페스트에서 필요 도구 목록
  
  // 에이전트가 요청한 도구가 태스크에 필요한 도구 목록에 포함되어 있는지만 검증
  // → 이 도구 목록에 없으면 에이전트가 중간에 권한 확대(scope creep)를 시도해도 거부됨
  const scope: ScopedPermission[] = allowedTools.map(tool => ({
    tool,
    max_calls: task.tool_call_limits?.[tool] ?? 100, // 태스크별 호출 한도
    data_access: task.data_scope ?? [],               // 접근 허용 데이터 범위
    expiry: task.deadline,                            // 태스크 마감 시 자동 만료
  }));
  
  // 이 스코프는 에이전트의 도구 호출마다 policy engine이 검증
  // 검증 항목: (1) 현재 도구가 이 스코프에 포함되어 있는가?
  //            (2) 호출 횟수가 한도를 초과하지 않았는가?
  //            (3) 데이터 접근이 허용 범위 내인가?
  
  return scope;
}
```

**3단계: 태스크 중 실시간 재검증 (Continuous Revalidation Mid-Task)**

단순히 시작 시 권한을 부여하고放っておけば 되는 것이 아니다. CISA/NSA 가이드라인은 "모든 접근 요청마다 신원을 확인하고 권한을 검증하라"고 명시한다.

```typescript
// 도구 호출 직전의 실시간 재검증 로직
interface ToolCallContext {
  agent_id: string;
  tool_name: string;
  params: Record<string, unknown>;
  current_task_id: string;
  elapsed_time_ms: number; // 태스크 경과 시간 — 이상 징후 탐지에 사용
}

async function validateAndExecuteTool(ctx: ToolCallContext): Promise<unknown> {
  // 1단계: 신원 재검증 (현재 세션이 여전히 유효한가?)
  const session = await identityStore.getSession(ctx.agent_id);
  if (session.revoked) {
    throw new AgentIdentityRevokedError(ctx.agent_id);
  }
  
  // 2단계: 스코프 검증 (이 도구 호출이 허용된 범위 내인가?)
  const policy = await policyEngine.evaluate({
    agent_id: ctx.agent_id,
    tool: ctx.tool_name,
    task_id: ctx.current_task_id,
  });
  
  if (!policy.allowed) {
    // 권한 없음 — 이것이 바로 scope creep 방지의 핵심
    await auditLogger.logSecurityEvent({
      type: 'SCOPE_VIOLATION',
      agent_id: ctx.agent_id,
      attempted_tool: ctx.tool_name,
      reason: policy.denial_reason,
    });
    throw new ToolCallDeniedError(ctx.tool_name);
  }
  
  // 3단계: 이상 징후 탐지 (Anomaly Detection)
  if (ctx.tool_name === 'delete_database' && ctx.elapsed_time_ms < 5000) {
    // 에이전트가 태스크 시작 후 5초 만에 database 삭제를 시도한다면?
    // 이것은 의도한 플로우가 아닐 가능성이 높음 — 즉석 차단
    await raiseHumanApprovalAlert(ctx.agent_id, 'SUSPICIOUS_RAPID_DESTRUCTIVE_ACTION');
  }
  
  // 4단계: 도구 실행
  return await tools[ctx.tool_name].execute(ctx.params, {
    agent_id: ctx.agent_id,
    task_id: ctx.current_task_id,
    call_count: policy.current_call_count + 1,
  });
}
```

**4단계: 자동 해지 (Automatic Revocation at Completion or Anomaly Detection)**

태스크 완료 또는 이상 감지 시 즉시 credential을 무효화한다.

```typescript
// 완료 시 자동 해지
async function revokeAgentCredentials(agentId: string, reason: 'completed' | 'failed' | 'revoked') {
  // 1) SPIRE에 신원 해지 신호 전송
  await spireAgent.revokeSVID(agentId);
  
  // 2) Vault에서 에이전트 credential 폐기
  await vault.destroyAgentCredentials(agentId);
  
  // 3) 모든 active 세션 즉시 종료
  await sessionManager.terminateAllSessions(agentId);
  
  // 4) 감사 로그에 완전한 해지 기록
  await auditLogger.log({
    event: 'AGENT_IDENTITY_REVOKED',
    agent_id: agentId,
    reason,
    revoked_at: new Date().toISOString(),
  });
}
```

---

## 5. Delegation Chain — 에이전트가 에이전트에게 권한을 위임할 때

### 왜 위임 체인이 중요한가

기업 환경에서 인간이 직접 모든 에이전트를 관리하지 않는다. 인간이 에이전트 A에게 권한을 부여하고, A가 서브 에이전트 B와 C를 스폰하며, B가 다시 D를 호출하는식이 된다. 이때 D의 행위에 대한 책임은 누구에게 있는가?

**위임 체인의 각 링크가 감사 가능해야 한다.** 공격자가 에이전트 하나를 침투하면, 그 에이전트가 위임받은 권한의 범위 내에서만 행위할 수 있어야 한다. 해지 시 위임 체인의 모든 하위 에이전트도 함께 해지되어야 한다.

```typescript
// 위임 체인의 감사 가능 기록 구현
interface DelegationChain {
  chain_id: string;
  principal: string;        // 최초授權자 (사람 또는 상위 에이전트)
  delegates: DelegateLink[];
}

interface DelegateLink {
  delegate_agent_id: string;
  delegated_at: Date;
  delegated_by: string;    // 위임한 주체
  scope: Permission[];      // 위임된 권한 범위
  expires_at: Date;
  purpose: string;          // 위임 목적 (감사용)
}

// 위임 시-chain audit trail 기록
async function delegateToSubAgent(
  parentAgentId: string,
  childAgentId: string,
  scope: Permission[],
  purpose: string
): Promise<DelegateLink> {
  const parentChain = await getDelegationChain(parentAgentId);
  
  // 부모의 위임 체인을 검증 — 루트授权자까지 추적 가능해야 함
  if (!parentChain) {
    throw new Error('Parent delegation chain not found');
  }
  
  // 이 위임으로 인한 총 스코프 확인 (부모의 권한을 초과할 수 없음)
  const combinedScope = [...parentChain.scope, ...scope];
  
  const link: DelegateLink = {
    delegate_agent_id: childAgentId,
    delegated_at: new Date(),
    delegated_by: parentAgentId,
    scope: combinedScope,
    expires_at: calculateExpiry(scope), // 부모의 만료 시점을 초과할 수 없음
    purpose,
  };
  
  await delegationStore.appendLink(link);
  await auditLogger.logDelegation(link);
  
  return link;
}
```

---

## 6. CISA/NSA/Five Eyes Joint Guidance — 핵심 요약

2026년 4월, CISA/NSA/Australian Signals Directorate/Canadian Centre for Cyber Security/NZ NCSC/UK NCSC가 공동으로 발표한 에이전트 AI 보안 가이드라인의 핵심 사항은 다음과 같다.

**1. 모든 에이전트를 고유한 cryptographic identity로 구축하라.** 하나의 공유 credential을 여러 에이전트가 공유해서는 안 된다.

**2. 짧은 수명의 credential을 사용하고 모든 통신을 암호화하라.** 에이전트 간 및 에이전트-서비스 간 모든 통신이 대상이다.

**3. 높은 영향의 작업(high-impact actions)에는 인간이 반드시 직접 승인해야 한다.** 어떤 작업에 인간 승인이 필요한지는 시스템 설계자가 결정하며, 에이전트 스스로가 결정해서는 안 된다.

**4. 위험을 관리하기 위해 기존의 사이버 보안 프레임워크를 활용하라.** 에이전트 AI에全新的 보안 분야가 필요한 것이 아니라, 제로 트러스트, 방어인심(Defense-in-Depth), 최소 권한 원칙을 기존 프레임워크에 통합하라는 것이다.

**5. 프로프트 인젝션(prompt injection) 위험을 인식하라.** 데이터에 삽입된 명령어로 에이전트의 행위를 탈취할 수 있으며, 이 문제는 완전히 해결되기 어려울 수 있다.

**6. "보안 관행, 평가 방법, 표준이 성숙하기 전에는 에이전트 AI 시스템이 예기치 않게 동작할 수 있다고 가정하고 배치하하라."** 회고성(복구력), 가역성, 위험 억제를 효율성 증가보다 우선시하라는 것이다.

---

## 7. 실무 적용 체크리스트

에이전트 AI 시스템을 production에 배포하기 전에 점검해야 할 보안 항목들:

```
[ ] 모든 에이전트에 고유한 NHI/SPIFFE ID 부여
[ ] 정적 API 키를 모두 제거 (development 환경 제외)
[ ] credential을 코드/환경 변수에 하드코딩하지 않고 vault 사용
[ ] OAuth 2.0 M2M 또는 mTLS 인증 적용
[ ] SPIRE를 통한 자동 credential 로테이션 구축
[ ] 도구 호출마다 실시간 권한 검증 (시작 시 1회 검증이 아님)
[ ] 위임 체인 감사 로그 활성화
[ ] 높은 영향 작업에 인간 승인 게이트 적용
[ ] 에이전트 세션 만료 시 자동 credential 해지
[ ] 이상 징후 탐지: 짧은 시간 내 destructive tool 호출 감시
[ ] 프로프트 인젝션 탐지 로직 구현
[ ] 모든 에이전트 통신 암호화 (동일 사이트 내에서도 적용)
```

---

## 8. 정리 — 에이전트 시대의 보안 원리

2026년, AI 에이전트 보안은 더 이상 "LLM을 안전하게 쓰기"가 아니다. 에이전트가 능동적으로 행위하는 주체로 등장하면서, 그 주체의 정체를 증명하고, 권한을 제한하며, 행위 결과를 추적하는 것 자체가 핵심 보안 과제가 되었다.

**핵심 원리 세 가지:**

1. **모든 에이전트에 신원을 부여하라.** 공유 credential은 없으며, 각 에이전트는 자신의 cryptographic identity로 식별된다.
2. **신원은 짧고, 범위는 좁게, 검증은 지속하라.** 시작 시 한 번 검증하고 끝이 아니다. 모든 도구 호출마다, 모든 단계마다 신원과 권한을 재확인한다.
3. **위임 체인은 감사 가능해야 한다.** 에이전트가 다른 에이전트에 권한을 위임했다면, 그 위임의 경로와 범위가 모두 기록되고 검증 가능해야 한다.

CISA/NSA 가이드라인의 한 문장이 이 모든 것을 압축한다:

> *"Until security practices, evaluation methods and standards mature, organisations should assume that agentic AI systems may behave unexpectedly and plan deployments accordingly."*

보안이 성숙하기 전에 에이전트를 배치하는 현실에서, 우리는 속도를 위해 보안을 희생해서는 안 된다. authentication과 authorization은 에이전트 아키텍처의 foundational layer다. 이 층이 부실하면, 위에 쌓이는 모든 intelligence는 모래 위의 성이 된다.

---

*본 글은 CISA/NSA/Five Eyes 공동 가이드라인(2026.04), SPIFFE Community Documentation, Strata.io Agent Authentication Guide를 참고했습니다.*