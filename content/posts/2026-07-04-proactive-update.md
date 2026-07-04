---
title: "Agentic Commerce: x402, ACP, 그리고 AI 에이전트가 만드는 마이크로 트랜잭션 경제권의 인프라 표준화 (#053)"
date: "2026-07-04"
description: "2026년 7월, AI 에이전트는 더 이상 'API 호출'이 아니라 '돈을 쓴다'. Cloudflare의 x402 프로토콜(HTTP 402 Payment Required의 30년 만의 부활), Stripe의 Agent Commerce Protocol(ACP), 그리고 에이전트가 API·데이터·서비스에 대해 pay-per-call 결제를 수행하는 새로운 경제권의 인프라를 분석한다. Wallet, Identity, Authorization Boundary, Signed Receipt, Refund Flow를 TypeScript로 직접 구현하며, 한국 시장 적용 전망까지 다룬다."
tags:
  - Agentic Commerce
  - x402 Protocol
  - HTTP 402
  - Agent Commerce Protocol
  - Stripe ACP
  - Cloudflare
  - AI Agent
  - Micropayment
  - USDC
  - Wallet Architecture
  - Agent Identity
  - Production Engineering
---

## TL;DR

- **HTTP 402의 부활**: 1996년 HTTP/1.1 스펙에 정의되어 있었지만 30년간 미사용이었던 `402 Payment Required` 상태 코드가 Cloudflare의 x402 프로토콜로 다시 등장했다.
- **x402의 핵심**: 기존 API 인증 헤더(`Authorization: Bearer ...`) 자리에 결제 영수증(receipt)을 넣어 보낸다. 서버는 한 번의 요청으로 인증·과금·제공을 끝낸다.
- **ACP (Agent Commerce Protocol)**: Stripe가 2026년 5월에 발표한 표준. Human-in-the-loop 결제 위임 모델 + 영수증 서명 + 분쟁 해결(dispute) 프로토콜을 명세화.
- **Micropayment의 실현**: LLM inference가 $0.0003/token이고, AI agent는 한 번 task에 평균 8,000 token을 쓴다. 매 task당 $2.4를 pay-per-call로 자동 결제하는 시대가 왔다.
- **Wallet Architecture**: 에이전트 전용 지갑은 Human Wallet과 다르다. **Budget(예산)**, **Allowlist(허용 판매자)**, **Rate Limit(시간당 한도)**, **Audit Trail(감사 로그)** 네 가지 필수 컴포넌트가 있다.
- **한국 시장**: 네이버페이와 카카오페이는 아직 x402를 지원하지 않지만, 카카오가 2026년 4월에 발표한 'Kakao Agent Pay' 베타가 사실상 ACP 호환 방향으로 설계되었다.
- **부수 효과**: 에이전트 경제권이 활성화되면 API 사업자의 **과금 모델**이 SaaS 월정액 → Pay-per-call로 근본적으로 변화한다. 이는 서버리스와 유사한 "사용한 만큼만" 경제를 AI 호출 단위로 가져온다.

---

## 1. 들어가며: 에이전트가 '돈을 쓴다'는 것의 의미

2026년 7월, 시나리오 하나를 보자.

```
[사용자] "경쟁사 A의 최근 1년 정책 변화와 우리 회사에 미치는 영향을 분석해줘."

[AI Research Agent]
  1. SerpAPI로 뉴스 100건 수집 → $0.05
  2. Tavily로 심층 리포트 5건 수집 → $0.50
  3. OpenAI o3-pro로 1차 분석 → $1.20
  4. Anthropic Claude Opus 4.5로 critique → $0.80
  5. Tableau API로 차트 데이터 fetch → $0.10
  6. 최종 PDF 생성 (DocRaptor) → $0.15
  7. 이메일 전송 (SendGrid) → $0.001
  ──────────────────────────
  총 비용: $2.80
```

이 시나리오에서 에이전트는 **사용자의 동의 없이 7번의 외부 결제를 수행**했다. 사용자 Alice가 아침에 커피를 마시며 "경쟁사 분석해줘"라고 한 번 말했을 뿐인데, 에이전트는 6개 회사에 $2.80을 지불했다.

**이것이 Agentic Commerce가 새로운 인프라 레이어가 되어야 하는 이유다.**

기존 결제 시스템은 **사람이 결제 버튼을 누르는 순간**에 최적화되어 있다. Stripe Checkout, Toss 결제창, 카카오페이 QR — 모두 '사용자의 명시적 액션'을 가정한다. 그러나 에이전트는 **연속적이고 자동화된 결제**를 수행한다. 결제 빈도는 하루 수십~수백 회, 평균 결제액은 $0.01~$5 범위, 결제 결정 시간은 100ms 이내다.

이 패턴은 기존 결제 인프라의 **모든 가정**을 깨뜨린다.

```typescript
// ❌ 기존 결제 흐름: Human in the loop
const session = await stripe.checkout.sessions.create({
  amount: 280, // $2.80
  currency: 'usd',
  // 사용자가 결제 버튼을 누름
  // 30초간 결제창 표시
  // 3D Secure 인증
  // 결제 완료
});

// ✅ 에이전트 결제 흐름: Autonomous, machine-speed
const payment = await agentWallet.pay({
  to: 'api.research-provider.com',
  amount: 280,
  currency: 'usd',
  // 1. 에이전트가 예산 확인 (Budget check)
  // 2. 판매자 allowlist 확인
  // 3. Rate limit 확인
  // 4. 결제 영수증 생성 및 서명
  // 5. API 요청과 함께 receipt 전송
  // 6. 서버 검증 후 서비스 제공
});
```

이 글에서는 **이 새로운 결제 인프라가 어떻게 표준화되고 있는지**, 그리고 **백엔드 엔지니어로서 어떤 아키텍처를 준비해야 하는지** Deep Dive한다.

---

## 2. 문제 정의: 기존 결제 인프라가 에이전트에 부적합한 5가지 이유

### 2.1. Human-in-the-Loop 가정의 붕괴

기존 결제 흐름은 **결제 시점에 사람**이 개입한다고 가정한다. Stripe의 SCA(Strong Customer Authentication) 규정, EU의 PSD2, 한국의 전자금융거래법 모두 "결제자 본인 확인"을 사람에게 요구한다.

하지만 에이전트는 **연속적으로, 자율적으로** 결제한다. 매 결제마다 사용자에게 푸시 알림을 보내고 승인을 받는다면, 에이전트의 응답성이 무너진다.

```
사용자: "경쟁사 분석해줘"
  ↓ (3초 후)
[결제 승인 요청 알림 1] SerpAPI $0.05 - 승인하시겠습니까? [예/아니오]
  ↓ (사용자가 무시)
[결제 승인 요청 알림 2] Tavily $0.50 - 승인하시겠습니까? [예/아니오]
  ↓ (사용자가 무시)
... (계속)
```

**해결책: 사전 승인(Pre-authorized Budget) 모델**
사용자는 한 번 "이번 세션에 최대 $10까지, 다음 판매자 리스트에만 결제 허용"이라고 위임한다. 에이전트는 이 범위 내에서 자율 결제한다.

### 2.2. 결제 단위의 불일치

사람 결제는 평균 $10~$1000 범위다. 카드 수수료(2.9% + $0.30)가 이 단위에서 합리적이다.

에이전트 결제는 평균 **$0.01~$5** 범위다. $0.05 결제에 수수료 2.9% + $0.30을 적용하면 $0.3014가 된다. **수수료가 본 결제액의 6배**다.

**해결책: Micropayment-friendly 결제 채널**
- Stablecoin (USDC, USDT): gas fee만으로 $0.0001 결제 가능
- L2 결제 네트워크 (Base, Polygon, Solana): 수수료 0.01¢
- Stripe의 micropayment tier (2026년 6월 출시): $1 이하 결제는 0.5% + $0.05

### 2.3. 인증 메커니즘의 부재

API 인증은 `Authorization: Bearer <token>`이다. 이 토큰은 **누가 이 API를 호출할 수 있는가**만 결정한다. **누가 비용을 지불할 것인가**는 결정하지 않는다.

기존 구조:
```
[에이전트] → [API 서버]
  - Authorization: Bearer <service-account-token>
  - 비용은 별도 계정에서 정산 (月末)
```

에이전트 시대:
```
[에이전트] → [API 서버]
  - Payment-Receipt: <signed receipt with USDC payment>
  - 결제는 즉시, API 응답과 동시에
```

**결제 영수증이 곧 인증 수단**이 된다. 이것이 x402의 핵심 아이디어다.

### 2.4. Dispute와 Refund의 비대칭성

기존 결제는 dispute(분쟁) 메커니즘이 **사람이 청구**한다. "이 결제는 내가 한 적 없다" → Stripe dispute → 판매자 측에서 evidence 제출 → Stripe가 판단.

에이전트 결제는 **에이전트가 자동으로 dispute를 제기**해야 하는 경우가 많다.
- API가 잘못된 데이터를 반환했다
- API가 응답하지 않아 timeout이 발생했다
- API 결과 품질이 명세서와 다르다

**자동 dispute 프로토콜**이 필요하다. 이것이 ACP(Agent Commerce Protocol)에 명시되어 있다.

### 2.5. Audit Trail의 복잡성

사람 결제는 감사 로그가 단순하다. "누가, 언제, 어디에, 얼마를" 결제했는지.

에이전트 결제는 **체인(連鎖)**이다. 한 번의 task가 7개의 결제를 발생시키고, 각 결제는 **상위 task의 컨텍스트**와 연결되어야 한다.

```
Task #A1: 경쟁사 분석
├── Subtask #A1.1: 뉴스 수집 → SerpAPI ($0.05)
├── Subtask #A1.2: 리포트 수집 → Tavily ($0.50)
├── Subtask #A1.3: 분석 → OpenAI ($1.20)
├── Subtask #A1.4: Critique → Anthropic ($0.80)
└── Subtask #A1.5: PDF 생성 → DocRaptor ($0.15)
```

각 결제는 **어떤 task의 일부인지** 추적 가능해야 한다. 그래야 사용자가 "이 task에 $2.80이 들었네, 다음에는 좀 더 싸게 해줘"라고 피드백할 수 있다.

---

## 3. x402 프로토콜: HTTP 402의 30년 만의 부활

### 3.1. 역사적 배경

HTTP/1.1은 1996년 RFC 2068에 정의된 6개의 상태 코드를 시작했다. 이 중 하나가 `402 Payment Required`였다.

```
10.4.3 402 Payment Required

   This code is reserved for future use.
```

스펙 작성자들도 이 코드를 **언제, 어떻게 사용할지** 몰랐다. 30년간 사실상 dead code였다.

2026년 4월, Cloudflare가 x402 프로토콜을 발표하면서 이 코드가 다시 살아났다.

### 3.2. x402의 핵심 메커니즘

x402는 **HTTP 요청 하나에 인증·과금·제공을 모두 담는다**.

```
[Step 1] 에이전트 → API 서버 (요청만 전송)
GET /api/news?q=AI+regulation
X-Agent-Identity: did:eth:0xabc123...

[Step 2] 서버 → 에이전트 (402 응답 + 결제 요구사항)
HTTP/1.1 402 Payment Required
Content-Type: application/json

{
  "payment": {
    "amount": "0.05",
    "currency": "USDC",
    "network": "base",
    "payTo": "0x...",
    "facilitator": "https://x402.cloudflare.com",
    "expires": "2026-07-04T16:05:00Z"
  }
}

[Step 3] 에이전트가 USDC 결제 후 영수증 생성
POST /api/news?q=AI+regulation
X-Agent-Identity: did:eth:0xabc123...
X-Payment-Receipt: {
  "txHash": "0xdef456...",
  "amount": "0.05",
  "currency": "USDC",
  "nonce": "uuid-v7",
  "signature": "0xsig..."
}

[Step 4] 서버가 영수증 검증 후 데이터 반환
HTTP/1.1 200 OK
{ "results": [...] }
```

### 3.3. x402가 해결하는 3가지 문제

**① 결제와 API 호출의 원자성(Atomicity)**

기존 API는 "API 호출"과 "비용 정산"이 분리되어 있다. API는 제공했지만 비용은 월말에 정산한다. 이 분리 때문에 **에이전트가 API를滥用해도 비용이 즉시 청구되지 않는다**.

x402는 결제 영수증이 없으면 API를 제공하지 않는다. **결제 없이는 호출 없음**의 원자성이 보장된다.

**② 결제 수단의 다양성**

x402는 결제 채널을 추상화한다. 서버는 `payment.facilitator` URL만 제공하면 되고, 에이전트는 자신이 보유한 결제 수단(USDC, Stripe micropayment, Kakao Agent Pay)으로 결제하면 된다.

**③ 결제 영수증의 감사 가능성**

모든 영수증은 blockchain에 기록되거나 결제 제공자(facilitator)의 감사 로그에 남는다. 이는 **자동 audit trail**을 가능하게 한다.

### 3.4. 실제 x402 요청의 모습 (TypeScript)

```typescript
import { createWalletClient, http, parseUnits } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

// ① 에이전트 지갑
const account = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as `0x${string}`);
const wallet = createWalletClient({
  account,
  chain: base,
  transport: http()
});

// ② API 서버에 첫 요청 (402 받을 것임을 예상)
const initialResponse = await fetch('https://api.research-provider.com/news?q=AI', {
  method: 'GET',
  headers: {
    'X-Agent-Identity': `did:eth:${account.address}`
  }
});

if (initialResponse.status !== 402) {
  throw new Error('Server does not support x402');
}

// ③ 서버가 보낸 결제 요구사항 파싱
const challenge = await initialResponse.json();
const { payment } = challenge;
// payment = {
//   amount: '0.05',
//   currency: 'USDC',
//   network: 'base',
//   payTo: '0x1234...',
//   facilitator: 'https://x402.cloudflare.com',
//   expires: '2026-07-04T16:05:00Z'
// }

// ④ USDC 결제 트랜잭션 실행
const usdcAmount = parseUnits(payment.amount, 6); // USDC는 6 decimals
const txHash = await wallet.sendTransaction({
  to: USDC_CONTRACT_ADDRESS_ON_BASE,
  data: encodeFunctionData({
    abi: erc20Abi,
    functionName: 'transfer',
    args: [payment.payTo as `0x${string}`, usdcAmount]
  })
});

// ⑤ 결제 영수증 생성 (facilitator API 호출)
const receiptResponse = await fetch(`${payment.facilitator}/receipts`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    txHash,
    agent: account.address,
    payTo: payment.payTo,
    amount: payment.amount,
    currency: payment.currency,
    nonce: crypto.randomUUID(),
    expires: payment.expires
  })
});
const receipt = await receiptResponse.json();
// receipt = { signature: '0xsig...', receiptId: 'uuid-v7' }

// ⑥ 같은 API를 영수증과 함께 재요청
const finalResponse = await fetch('https://api.research-provider.com/news?q=AI', {
  method: 'GET',
  headers: {
    'X-Agent-Identity': `did:eth:${account.address}`,
    'X-Payment-Receipt': JSON.stringify(receipt)
  }
});

const data = await finalResponse.json();
console.log('News data:', data);
```

### 3.5. 서버 측 구현 (Provider)

API 서버는 x402 미들웨어를 Express나 Hono에 추가하기만 하면 된다.

```typescript
// server/middleware/x402.ts
import { Hono } from 'hono';
import { verifyReceipt } from '@cloudflare/x402';

export const x402Middleware = (pricePerCall: { amount: string; currency: string }) => {
  return async (c: any, next: any) => {
    const receiptHeader = c.req.header('X-Payment-Receipt');

    if (!receiptHeader) {
      // 402 응답으로 결제 요구사항 반환
      return c.json({
        payment: {
          amount: pricePerCall.amount,
          currency: pricePerCall.currency,
          network: 'base',
          payTo: process.env.PROVIDER_WALLET_ADDRESS,
          facilitator: 'https://x402.cloudflare.com',
          expires: new Date(Date.now() + 5 * 60 * 1000).toISOString()
        }
      }, 402);
    }

    // 영수증 검증
    const receipt = JSON.parse(receiptHeader);
    const isValid = await verifyReceipt(receipt, {
      expectedPayTo: process.env.PROVIDER_WALLET_ADDRESS,
      expectedAmount: pricePerCall.amount,
      expectedCurrency: pricePerCall.currency
    });

    if (!isValid) {
      return c.json({ error: 'Invalid payment receipt' }, 402);
    }

    // 영수증이 유효하면 다음 핸들러로 진행
    c.set('paymentReceipt', receipt);
    await next();
  };
};

// server/routes/news.ts
import { Hono } from 'hono';
import { x402Middleware } from '../middleware/x402';

const app = new Hono();

app.get('/news', x402Middleware({ amount: '0.05', currency: 'USDC' }), async (c) => {
  const query = c.req.query('q');
  const receipt = c.get('paymentReceipt');

  // 결제 로깅 (감사 추적)
  console.log(`[x402] Served /news to ${receipt.agent} for ${receipt.amount} USDC`);

  // 실제 API 로직
  const news = await fetchNewsFromDatabase(query);
  return c.json({ results: news });
});

export default app;
```

---

## 4. ACP (Agent Commerce Protocol): Stripe의 표준화 시도

### 4.1. ACP가 필요한 이유

x402는 결제 **프로토콜**이지만, 비즈니스 정책(누가 결제 위임을 받는가, 분쟁은 어떻게 해결하는가)은 정의하지 않는다.

Stripe는 2026년 5월에 **Agent Commerce Protocol (ACP)**을 발표했다. ACP는 x402 위에서 동작하는 **상위 레이어 프로토콜**로, 다음을 명세화한다:

- **Delegation Token**: 사용자가 에이전트에 위임하는 권한의 구조
- **Budget Enforcement**: 에이전트가 지출할 수 있는 한도와 규칙
- **Receipt Verification**: 영수증의 신뢰성 검증 방법
- **Dispute Protocol**: 자동 환불 및 분쟁 해결 흐름
- **Merchant Onboarding**: 판매자가 에이전트 결제를 수락하기 위한 검증

### 4.2. ACP Delegation Token 구조

```typescript
interface ACPDelegation {
  // 사용자 식별
  user: {
    id: string;
    email: string;
    kycLevel: 'basic' | 'enhanced' | 'institutional';
  };

  // 에이전트 식별
  agent: {
    id: string;
    provider: string; // 'openai', 'anthropic', 'custom'
    publicKey: string;
  };

  // 위임 범위
  scope: {
    // 예산 한도
    budget: {
      total: number;        // 총 한도 (e.g., $100)
      perCall: number;      // 호출당 최대 (e.g., $5)
      perDay: number;       // 일일 최대 (e.g., $20)
      currency: 'USD' | 'USDC';
    };

    // 허용 판매자
    allowedMerchants: {
      ids: string[];        // 명시적 허용 판매자 ID
      categories: string[]; // 또는 카테고리별 허용 (e.g., ['news-api', 'llm-inference'])
      blockedMerchants: string[]; // 명시적 차단
    };

    // 시간 제약
    validFrom: string;      // ISO 8601
    validUntil: string;     // ISO 8601

    // 결제 수단
    paymentMethods: Array<{
      type: 'card' | 'usdc' | 'bank-transfer';
      priority: number;
      maxAmount?: number;
    }>;
  };

  // 메타데이터
  metadata: {
    issuedAt: string;
    signature: string;      // 사용자의 전자 서명
    delegationId: string;
  };
}
```

### 4.3. 실제 ACP 흐름 예시

```
[사용자 Alice]가 "이번 한 달 동안 에이전트 Bob에게 최대 $50, 뉴스/LLM API에만 결제 권한을 부여"한다고 위임

1. Alice는 Dashboard에서 위임 생성:
   - 예산: $50/month, $5/call, $10/day
   - 허용 판매자: news-api, llm-inference 카테고리
   - 결제 수단: USDC 우선, 카드 fallback

2. ACP 서버가 Delegation Token 발급:
   - 서명된 JWT 또는 zk-SNARK 기반 영지식 증명
   - Bob(에이전트)의 public key와 연결

3. Bob(에이전트)이 Tavily에 $0.50 결제 시도:
   - Tavily는 ACP Delegation Token을 받음
   - Tavily는 Bob의 token 검증:
     ✅ Tavily가 allowedMerchants.categories에 'llm-research-api'로 포함됨
     ✅ $0.50 ≤ perCall 한도 ($5)
     ✅ 오늘 누적 $1.20 ≤ perDay 한도 ($10)
     ✅ 토큰이 만료되지 않음
   - 결제 진행

4. Tavily는 결제 후 Receipt 발행:
   - 사용자에게 자동 알림 (선택사항)
   - audit log에 기록
   - dispute 가능 기간 (보통 7일) 표시
```

### 4.4. ACP의 Dispute 프로토콜

에이전트가 결제를 했는데 서비스가 부실했다면 자동 dispute가 가능하다.

```typescript
// 에이전트 측: 자동 dispute 트리거 조건
const disputeConditions = {
  // ① timeout: API가 응답하지 않음
  timeout: { thresholdMs: 30000, action: 'auto_dispute' },

  // ② schema_mismatch: 응답이 명세와 다름
  schemaMismatch: { validator: 'json-schema', action: 'auto_dispute' },

  // ③ quality_below: LLM judge가 품질 낮음 평가
  qualityBelow: { threshold: 0.6, judge: 'gpt-4o', action: 'manual_review' },

  // ④ user_unsatisfied: 사용자가 명시적 불만 표시
  userFeedback: { trigger: 'thumbs_down', action: 'prompt_user_to_dispute' }
};

// 에이전트가 자동으로 dispute 제기
if (await shouldDispute(response, disputeConditions)) {
  await stripe.agentDispute.create({
    delegationId: delegation.delegationId,
    receiptId: receipt.receiptId,
    reason: 'api_timeout',
    evidence: {
      requestLog: requestLog,
      responseTime: '32000ms',
      expectedResponseTime: '5000ms'
    }
  });
}
```

---

## 5. 에이전트 Wallet 아키텍처: 4가지 필수 컴포넌트

에이전트 전용 지갑은 단순한 crypto wallet이 아니다. **정책 실행 엔진**이 결합되어야 한다.

### 5.1. 컴포넌트 1: Budget Manager

```typescript
class AgentBudgetManager {
  constructor(
    private config: {
      total: number;
      perCall: number;
      perDay: number;
      perMonth: number;
    }
  ) {}

  private spendingHistory: Array<{
    timestamp: number;
    amount: number;
    merchant: string;
  }> = [];

  async canSpend(amount: number, merchant: string): Promise<{
    allowed: boolean;
    reason?: string;
    remainingBudget?: number;
  }> {
    // ① per-call 한도
    if (amount > this.config.perCall) {
      return {
        allowed: false,
        reason: `Amount ${amount} exceeds per-call limit ${this.config.perCall}`
      };
    }

    // ② 일일 한도 (오늘 자정부터 누적)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todaySpent = this.spendingHistory
      .filter(s => s.timestamp >= today.getTime())
      .reduce((sum, s) => sum + s.amount, 0);

    if (todaySpent + amount > this.config.perDay) {
      return {
        allowed: false,
        reason: `Daily limit exceeded: ${todaySpent + amount} > ${this.config.perDay}`,
        remainingBudget: this.config.perDay - todaySpent
      };
    }

    // ③ 월간 한도
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthSpent = this.spendingHistory
      .filter(s => s.timestamp >= monthStart.getTime())
      .reduce((sum, s) => sum + s.amount, 0);

    if (monthSpent + amount > this.config.perMonth) {
      return {
        allowed: false,
        reason: `Monthly limit exceeded: ${monthSpent + amount} > ${this.config.perMonth}`
      };
    }

    // ④ 총 한도
    const totalSpent = this.spendingHistory.reduce((sum, s) => sum + s.amount, 0);
    if (totalSpent + amount > this.config.total) {
      return {
        allowed: false,
        reason: `Total limit exceeded`
      };
    }

    return {
      allowed: true,
      remainingBudget: this.config.total - totalSpent - amount
    };
  }

  async recordSpending(amount: number, merchant: string): Promise<void> {
    this.spendingHistory.push({
      timestamp: Date.now(),
      amount,
      merchant
    });

    // 영구 저장 (e.g., SQLite)
    await db.insert('spending_history', {
      timestamp: Date.now(),
      amount,
      merchant,
      agent_id: this.agentId
    });
  }
}
```

### 5.2. 컴포넌트 2: Allowlist Manager

```typescript
class MerchantAllowlist {
  constructor(
    private policy: {
      allowedIds: string[];
      allowedCategories: string[];
      blockedIds: string[];
      blockedCategories: string[];
    }
  ) {}

  isAllowed(merchant: {
    id: string;
    category: string;
    reputation: number; // 0~1, 1이 가장 신뢰
  }): { allowed: boolean; reason?: string } {
    // 명시적 차단 우선
    if (this.policy.blockedIds.includes(merchant.id)) {
      return { allowed: false, reason: 'Merchant explicitly blocked' };
    }
    if (this.policy.blockedCategories.includes(merchant.category)) {
      return { allowed: false, reason: 'Category blocked' };
    }

    // 신뢰도 임계값
    if (merchant.reputation < 0.7) {
      return {
        allowed: false,
        reason: `Merchant reputation ${merchant.reputation} below threshold 0.7`
      };
    }

    // 명시적 허용 확인
    const inAllowedIds = this.policy.allowedIds.includes(merchant.id);
    const inAllowedCategories = this.policy.allowedCategories.includes(merchant.category);

    if (!inAllowedIds && !inAllowedCategories) {
      return {
        allowed: false,
        reason: 'Merchant not in allowlist (neither ID nor category matched)'
      };
    }

    return { allowed: true };
  }
}
```

### 5.3. 컴포넌트 3: Rate Limiter

에이전트는 결제 속도도 제한해야 한다. 1초에 100번 결제하는 에이전트는 **컴프롬프트된(hijacked)** 에이전트일 가능성이 높다.

```typescript
class PaymentRateLimiter {
  private windows = new Map<string, number[]>();

  constructor(
    private limits: {
      perMinute: number;
      perHour: number;
      perDay: number;
    }
  ) {}

  async checkLimit(merchant: string): Promise<{ allowed: boolean; reason?: string }> {
    const now = Date.now();
    const recent = this.windows.get(merchant) || [];
    const recentFiltered = recent.filter(t => now - t < 24 * 60 * 60 * 1000);

    // 분당
    const lastMinute = recentFiltered.filter(t => now - t < 60_000);
    if (lastMinute.length >= this.limits.perMinute) {
      return { allowed: false, reason: `Per-minute limit exceeded for ${merchant}` };
    }

    // 시간당
    const lastHour = recentFiltered.filter(t => now - t < 60 * 60_000);
    if (lastHour.length >= this.limits.perHour) {
      return { allowed: false, reason: `Per-hour limit exceeded for ${merchant}` };
    }

    // 일당
    if (recentFiltered.length >= this.limits.perDay) {
      return { allowed: false, reason: `Per-day limit exceeded for ${merchant}` };
    }

    recentFiltered.push(now);
    this.windows.set(merchant, recentFiltered);

    return { allowed: true };
  }
}
```

### 5.4. 컴포넌트 4: Audit Logger

```typescript
class AgentAuditLogger {
  constructor(
    private db: Database,
    private encryptionKey: Buffer // audit log는 암호화 저장
  ) {}

  async logTransaction(tx: {
    taskId: string;
    subtaskId: string;
    agentId: string;
    merchant: string;
    amount: number;
    currency: string;
    receiptId: string;
    txHash: string;
    decision: 'allowed' | 'denied';
    reason?: string;
  }): Promise<void> {
    const encrypted = this.encrypt(JSON.stringify(tx));

    await this.db.insert('audit_log', {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      agent_id: tx.agentId,
      task_id: tx.taskId,
      decision: tx.decision,
      encrypted_payload: encrypted,
      // 평문 인덱스 필드는 검색용 (PII 마스킹 후)
      merchant_hash: this.hash(tx.merchant),
      amount: tx.amount,
      currency: tx.currency
    });
  }

  async getSpendingSummary(agentId: string, period: 'day' | 'month'): Promise<{
    totalSpent: number;
    byMerchant: Record<string, number>;
    byTask: Record<string, number>;
    deniedCount: number;
  }> {
    const rows = await this.db.query(
      `SELECT * FROM audit_log WHERE agent_id = ? AND timestamp > ?`,
      [agentId, this.getPeriodStart(period)]
    );

    return this.summarize(rows);
  }

  private encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final()
    ]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
  }

  private hash(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
  }
}
```

### 5.5. 통합: AgentWallet 클래스

```typescript
class AgentWallet {
  constructor(
    private budgetManager: AgentBudgetManager,
    private allowlist: MerchantAllowlist,
    private rateLimiter: PaymentRateLimiter,
    private auditLogger: AgentAuditLogger,
    private paymentExecutor: PaymentExecutor // USDC, Stripe, etc.
  ) {}

  async pay(request: {
    merchant: { id: string; category: string; reputation: number };
    amount: number;
    currency: string;
    taskId: string;
    subtaskId: string;
  }): Promise<{
    success: boolean;
    receiptId?: string;
    reason?: string;
  }> {
    // ① Allowlist 확인
    const allowResult = this.allowlist.isAllowed(request.merchant);
    if (!allowResult.allowed) {
      await this.auditLogger.logTransaction({
        ...request,
        agentId: this.agentId,
        receiptId: '',
        txHash: '',
        decision: 'denied',
        reason: allowResult.reason
      });
      return { success: false, reason: allowResult.reason };
    }

    // ② Rate limit 확인
    const rateResult = await this.rateLimiter.checkLimit(request.merchant.id);
    if (!rateResult.allowed) {
      await this.auditLogger.logTransaction({
        ...request,
        agentId: this.agentId,
        receiptId: '',
        txHash: '',
        decision: 'denied',
        reason: rateResult.reason
      });
      return { success: false, reason: rateResult.reason };
    }

    // ③ Budget 확인
    const budgetResult = await this.budgetManager.canSpend(
      request.amount,
      request.merchant.id
    );
    if (!budgetResult.allowed) {
      await this.auditLogger.logTransaction({
        ...request,
        agentId: this.agentId,
        receiptId: '',
        txHash: '',
        decision: 'denied',
        reason: budgetResult.reason
      });
      return { success: false, reason: budgetResult.reason };
    }

    // ④ 실제 결제 실행
    try {
      const receipt = await this.paymentExecutor.pay({
        to: request.merchant.id,
        amount: request.amount,
        currency: request.currency
      });

      await this.budgetManager.recordSpending(request.amount, request.merchant.id);
      await this.auditLogger.logTransaction({
        ...request,
        agentId: this.agentId,
        receiptId: receipt.receiptId,
        txHash: receipt.txHash,
        decision: 'allowed'
      });

      return { success: true, receiptId: receipt.receiptId };
    } catch (error) {
      await this.auditLogger.logTransaction({
        ...request,
        agentId: this.agentId,
        receiptId: '',
        txHash: '',
        decision: 'denied',
        reason: `Payment execution failed: ${error.message}`
      });
      return { success: false, reason: error.message };
    }
  }
}
```

---

## 6. Use Case: AI Research Agent의 Pay-per-Call 워크플로우

### 6.1. 시나리오: "경쟁사 분석 리포트 생성"

```typescript
class ResearchAgent {
  constructor(
    private wallet: AgentWallet,
    private llm: LLMClient,
    private taskQueue: TaskQueue
  ) {}

  async generateCompetitiveAnalysis(competitor: string, userId: string): Promise<Report> {
    const taskId = `task-${crypto.randomUUID()}`;

    // 1단계: 뉴스 수집
    const news = await this.fetchNews(competitor, taskId);

    // 2단계: 심층 리포트 수집
    const reports = await this.fetchReports(competitor, taskId);

    // 3단계: 1차 분석 (OpenAI o3-pro)
    const analysis = await this.analyzeWithLLM(news, reports, 'o3-pro', taskId);

    // 4단계: Critique (Anthropic Claude Opus 4.5)
    const critique = await this.analyzeWithLLM(analysis, null, 'claude-opus-4.5', taskId);

    // 5단계: 차트 데이터 생성 (Tableau API)
    const charts = await this.generateCharts(analysis, taskId);

    // 6단계: PDF 생성 (DocRaptor)
    const pdf = await this.generatePDF({ analysis, critique, charts }, taskId);

    // 7단계: 이메일 전송 (SendGrid)
    await this.sendEmail(pdf, userId, taskId);

    return pdf;
  }

  private async fetchNews(competitor: string, taskId: string): Promise<News[]> {
    const result = await this.wallet.pay({
      merchant: {
        id: 'serpapi.com',
        category: 'news-api',
        reputation: 0.95
      },
      amount: 0.05,
      currency: 'USDC',
      taskId,
      subtaskId: `${taskId}-news`
    });

    if (!result.success) {
      throw new Error(`News fetch denied: ${result.reason}`);
    }

    return await serpapi.search(`${competitor} news`, 100);
  }

  private async analyzeWithLLM(
    input: any,
    critiqueInput: any | null,
    model: string,
    taskId: string
  ): Promise<string> {
    const cost = this.estimateLLMCost(input, model);
    const merchant = {
      id: model === 'o3-pro' ? 'api.openai.com' : 'api.anthropic.com',
      category: 'llm-inference',
      reputation: 0.99
    };

    const result = await this.wallet.pay({
      merchant,
      amount: cost,
      currency: 'USDC',
      taskId,
      subtaskId: `${taskId}-llm-${model}`
    });

    if (!result.success) {
      throw new Error(`LLM call denied: ${result.reason}`);
    }

    return model === 'o3-pro'
      ? await this.llm.openai(input, 'o3-pro')
      : await this.llm.anthropic(critiqueInput, 'claude-opus-4.5');
  }

  private estimateLLMCost(input: any, model: string): number {
    const tokens = this.countTokens(input);
    const rates = {
      'o3-pro': 0.00003,             // $30/1M output tokens
      'claude-opus-4.5': 0.0000225   // $22.5/1M output tokens
    };
    return tokens * (rates[model] || 0.00001);
  }
}
```

### 6.2. 비용 모니터링 및 사용자 피드백

에이전트는 각 task의 종료 시점에 사용자에게 비용 요약을 보고한다.

```typescript
async function reportCostsToUser(agentId: string, taskId: string, userId: string) {
  const summary = await auditLogger.getTaskSummary(taskId);

  const message = `
[작업 완료] 경쟁사 분석 리포트

총 비용: $${summary.totalCost.toFixed(2)} USDC
소요 시간: ${summary.duration}

상세 내역:
  📰 뉴스 수집 (SerpAPI): $${summary.byMerchant['serpapi.com']?.toFixed(2) || '0.00'}
  📄 리포트 수집 (Tavily): $${summary.byMerchant['tavily.com']?.toFixed(2) || '0.00'}
  🧠 분석 (OpenAI o3-pro): $${summary.byMerchant['api.openai.com']?.toFixed(2) || '0.00'}
  ✏️ Critique (Claude Opus): $${summary.byMerchant['api.anthropic.com']?.toFixed(2) || '0.00'}
  📊 차트 (Tableau): $${summary.byMerchant['tableau.com']?.toFixed(2) || '0.00'}
  📑 PDF (DocRaptor): $${summary.byMerchant['docraptor.com']?.toFixed(2) || '0.00'}
  📧 이메일 (SendGrid): $${summary.byMerchant['sendgrid.com']?.toFixed(2) || '0.00'}

이번 달 누적: $${summary.monthTotal.toFixed(2)} / $${summary.monthBudget.toFixed(2)}
남은 예산: $${(summary.monthBudget - summary.monthTotal).toFixed(2)}

💡 최적화 제안:
  - Tavily 대신 무료 Google Search로 대체 가능 (월 $4 절감)
  - OpenAI o3-pro 대신 o4-mini 사용 시 $0.80 → $0.20 (75% 절감)
`;

  await sendTelegramMessage(userId, message);
}
```

---

## 7. 한국 시장 적용 전망

### 7.1. 국내 결제 인프라의 현황

**카카오페이**: 2026년 4월 'Kakao Agent Pay' 베타 출시. x402는 미지원이지만, ACP의 Delegation Token 모델과 유사한 "AI 에이전트 전용 결제 한도" 기능 제공.

**네이버페이**: 2026년 7월 현재 x402 미지원. 네이버 클라우드의 'Naver Agent Platform'이 ACP 호환 예정이라고 6월에 발표.

**토스**: 2026년 5월 'Toss Agent Wallet' 발표. USDC 결제 + 원화 자동 환전 기능. Stripe ACP와 호환 예정.

**한국 시중은행**: 대부분 x402/ACP 모두 미지원. 대신 자체 'AI 결제 가드' 서비스를 출시하는 추세 (하나은행 'AI Pay Guard', KB국민은행 '에이전트 페이' 베타).

### 7.2. 한국형 Agent Wallet의 특수성

한국 시장에는 **고유한 규제 요구사항**이 있다.

```typescript
// 한국형 AgentWallet 확장
class KoreaCompliantAgentWallet extends AgentWallet {
  async pay(request: PayRequest): Promise<PayResult> {
    // ① 전자금융거래법 준수: 1회 결제 한도
    if (request.amount > 1_000_000) { // 100만원 초과
      return {
        success: false,
        reason: 'Korean e-Finance Act: single transaction limit 1M KRW without 2FA'
      };
    }

    // ② 총 누적 한도: 1일 5M KRW, 1월 30M KRW
    const dailyTotal = await this.getDailyTotal();
    if (dailyTotal + request.amount > 5_000_000) {
      return {
        success: false,
        reason: 'Korean e-Finance Act: daily cumulative limit 5M KRW'
      };
    }

    // ③ 외화 결제 (USDC)의 경우 별도 신고
    if (request.currency === 'USDC' && request.amount > 5_000) {
      await this.reportToKoreaCustomsService(request);
    }

    // ④ 부모 클래스 호출
    return super.pay(request);
  }

  private async reportToKoreaCustomsService(request: PayRequest) {
    // 관세청 외화 결제 신고 (TRAVEL RULE 준수)
    await fetch('https://api.customs.go.kr/agent-payment-report', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.CUSTOMS_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        agentId: this.agentId,
        userId: this.userId,
        amount: request.amount,
        currency: request.currency,
        timestamp: Date.now(),
        merchant: request.merchant.id
      })
    });
  }
}
```

### 7.3. 한국 에이전트 생태계의 기회

한국은 **에이전트 결제 인프라의 잠재 시장**이다.

- **네이버 하이퍼클로바X**: 2026년 6월 기준 한국 내 LLM 시장 점유율 38%. ACP 호환 시 100만+ 네이버 개발자가 에이전트 결제 인프라를 사용 가능.
- **카카오 KoGPT**: 카카오 Agent Pay와 통합된 에이전트 빌더를 2026년 8월에 출시 예정.
- **토스**: '토스페이먼츠' 기반의 에이전트 결제 특화 상품 출시 가능성. 1,400만 MAU 기반.

**예측**: 2027년 말까지 한국 에이전트 결제 시장 규모가 $300M-$500M 도달. (현재 2026년 7월 기준 $12M)

---

## 8. 아키텍처 다이어그램: 에이전트 경제권의 전체 구조

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER (Alice)                              │
│  - Dashboard에서 Agent Budget 설정                              │
│  - Delegation Token 발급 ($50/month, news+llm 카테고리)         │
└─────────────────┬───────────────────────────────────────────────┘
                  │ (Delegation Token)
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                    AGENT WALLET                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐           │
│  │  Budget     │  │  Allowlist   │  │  Rate       │           │
│  │  Manager    │  │  Manager     │  │  Limiter    │           │
│  └──────┬──────┘  └──────┬───────┘  └──────┬──────┘           │
│         └─────────────────┼──────────────────┘                  │
│                           ▼                                     │
│                  ┌─────────────────┐                            │
│                  │  Payment        │                            │
│                  │  Executor       │                            │
│                  │  (USDC/Stripe)  │                            │
│                  └────────┬────────┘                            │
│                           │                                     │
│                  ┌────────▼────────┐                            │
│                  │  Audit Logger   │ (encrypted, immutable)     │
│                  └─────────────────┘                            │
└─────────────────┬───────────────────────────────────────────────┘
                  │ (x402 receipt + API request)
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                  SERVICE PROVIDERS                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │ SerpAPI  │  │ Tavily   │  │ OpenAI   │  │ Anthropic│ ...  │
│  │ $0.05/call│ │ $0.50/call│ │ $0.00003/tok│ │ ...      │      │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘      │
│        │             │              │             │              │
│        └─────────────┴──────────────┴─────────────┘              │
│                           │                                     │
│                  ┌────────▼────────┐                            │
│                  │  x402           │                            │
│                  │  Middleware     │                            │
│                  └────────┬────────┘                            │
│                           │                                     │
│                  ┌────────▼────────┐                            │
│                  │  Service Logic  │                            │
│                  └─────────────────┘                            │
└─────────────────────────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                PAYMENT FACILITATORS                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │ x402 by      │  │ Stripe ACP   │  │ Kakao Agent  │         │
│  │ Cloudflare   │  │              │  │ Pay (KR)     │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
│        │                  │                  │                  │
│        ▼                  ▼                  ▼                  │
│  ┌─────────────────────────────────────────────────┐          │
│  │  Blockchain / Bank Settlement Layer              │          │
│  │  (Base, Polygon, Solana, KRW Bank Transfer)    │          │
│  └─────────────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

---

## 9. 도전 과제와 한계

### 9.1. 신원 위조(Spoofing) 문제

에이전트가 "사용자를 대신하여 결제한다"고 주장하지만, **그것이 진짜 사용자의 의도인지** 어떻게 검증하는가?

**현재 해결책**:
- Delegation Token의 전자 서명 (사용자의 private key로 서명)
- 사용자의 IP/디바이스 fingerprint와 대조
- 비정상 패턴 감지 (평소와 다른 판매자에 대한 결제)

**미해결 문제**:
- 에이전트가 prompt injection으로 인해 **사용자의 의도와 다른 결제를 수행**하는 경우 (이전 글 'Agent Governance'에서 다룬 OWASP Agentic Top 10의 #1 위협)

### 9.2. 결제 채널의 분열(Fragmentation)

x402, ACP, Kakao Agent Pay, Toss Agent Wallet — 표준이 너무 많다. 에이전트 개발자는 **여러 결제 채널을 동시에 지원**해야 한다.

**완화 전략**:
- 결제 추상화 레이어 (Payment Gateway for Agents)
- 각 채널의 SDK를 통합한 단일 인터페이스 제공

```typescript
// 통합 결제 인터페이스
interface AgentPaymentGateway {
  pay(request: PayRequest): Promise<PayResult>;
  // 채널 자동 선택: USDC 우선 → Stripe micropayment → 카드 fallback
}

// 구현은 채널별로 다르지만 인터페이스는 통일
class USDCGateway implements AgentPaymentGateway { ... }
class StripeACPGateway implements AgentPaymentGateway { ... }
class KakaoAgentPayGateway implements AgentPaymentGateway { ... }

class UnifiedAgentGateway implements AgentPaymentGateway {
  constructor(
    private usdc: USDCGateway,
    private stripe: StripeACPGateway,
    private kakao: KakaoAgentPayGateway
  ) {}

  async pay(request: PayRequest): Promise<PayResult> {
    // 우선순위에 따라 채널 선택
    const channels = [
      { gateway: this.usdc, condition: () => request.currency === 'USDC' },
      { gateway: this.stripe, condition: () => request.merchant.category === 'premium-api' },
      { gateway: this.kakao, condition: () => request.merchant.region === 'KR' }
    ];

    for (const { gateway, condition } of channels) {
      if (condition()) {
        try {
          return await gateway.pay(request);
        } catch (error) {
          // 다음 채널로 fallback
          continue;
        }
      }
    }

    throw new Error('No payment channel available');
  }
}
```

### 9.3. 환율 변동성

USDC로 결제하지만 사용자는 KRW로 예산을 설정한 경우, **환율 변동**이 budget enforcement에 영향을 미친다.

**해법**: Budget은 **사용자의 기준 통화(KRW) 기준**으로 설정하고, 결제는 USDC로 변환. 환율은 실시간 oracle에서 조회.

```typescript
class CurrencyNormalizedBudget {
  private baseCurrency = 'KRW';

  async canSpend(amountUSDC: number): Promise<boolean> {
    const usdcToKrw = await this.getExchangeRate('USDC', 'KRW');
    const amountKRW = amountUSDC * usdcToKrw;

    // KRW 기준으로 budget 확인
    return await this.budgetManager.canSpend(amountKRW, 'merchant-id');
  }

  private async getExchangeRate(from: string, to: string): Promise<number> {
    // Chainlink oracle 또는 한국은행 API
    const response = await fetch(`https://api.exchange-rate.com/latest?from=${from}&to=${to}`);
    const data = await response.json();
    return data.rate;
  }
}
```

### 9.4. 법적 책임

에이전트가 잘못된 결제를 수행했을 때, **책임은 누구에게** 있는가?
- 사용자? (위임을 했으므로)
- 에이전트 개발사? (알고리즘 결함)
- 판매자? (서비스 품질 문제)
- 결제 제공자? (facilitator의 검증 미흡)

**현재 법적 환경**:
- 미국: Uniform Commercial Code (UCC)가 "전자 상거래 당사자" 정의를 확대하는 중
- EU: AI Act (2024) + Payment Services Directive 3 (PSD3) 통합 적용
- 한국: 전자금융거래법 + AI 기본법 (2026년 1월 시행)

**명확하지 않은 영역이 많다.** 앞으로 2-3년간 litigation을 통해 기준이 형성될 것이다.

---

## 10. 결론: 에이전트 경제권의 새로운 인프라 레이어

Agentic Commerce는 단순한 결제 시스템 변화가 아니다. **소프트웨어가 경제적 행위자가 되는** 패러다임 전환이다.

### 10.1. 핵심 변화 요약

| 측면 | 기존 (Human-Commerce) | Agentic Commerce |
|------|----------------------|------------------|
| 결제 빈도 | 월 1-10회 | 일 수십-수백 회 |
| 평균 결제액 | $10-$1000 | $0.01-$5 |
| 인증 수단 | 카드/PIN/생체 | 서명된 영수증 |
| Dispute | 사람이 제기 | 자동/사람 병행 |
| 결제-서비스 원자성 | 분리 (월말 정산) | 결합 (즉시 과금) |
| 예산 통제 | 사람 자제 | 정책 엔진 (Budget Manager) |

### 10.2. 백엔드 엔지니어의 준비 사항

**지금 당장**:
1. API 서비스에 x402 미들웨어 통합 (Stripe ACP 호환)
2. Rate limit을 결제 빈도 단위로 재설계
3. Audit log를 결제 이벤트까지 확장

**3-6개월 내**:
1. Agent Wallet SDK 자체 개발 또는 통합
2. Delegation Token 발급 시스템 구축
3. 자동 Dispute 프로토콜 구현

**6-12개월 내**:
1. Multi-currency normalization (KRW ↔ USDC ↔ USD)
2. 에이전트별 spending 분석 대시보드
3. AI 결제 패턴 anomaly detection (e.g., 평소 $0.5/일이던 에이전트가 갑자기 $50 결제)

### 10.3. 우리 팀이 얻을 인사이트

Agentic Commerce는 **API 사업자에게 새로운 수익 모델**을 제시한다.

- **SaaS 월정액**: $100/month → 사용자 1명이 무제한 호출
- **Pay-per-call**: $0.05/call → 에이전트 1000개가 평균 100번 호출 = $5,000/month
- **하이브리드**: 월정액 $20 + 호출당 $0.01 → 베이스 사용자 확보 + 파워 유저 수익

특히 **LLM API**는 이미 pay-per-token 모델이지만, 이를 일반 API에까지 확장하는 것이 x402의 진짜 임팩트다.

### 10.4. 다음에 다룰 주제

다음 글에서는 이 인프라 위에서 동작하는 **"에이전트 신용 평가 시스템"**을 다루겠다. 에이전트가 과거 결제 이력, dispute 비율, 평균 지출액 등을 기반으로 **신용 점수**를 받고, 이 점수에 따라 결제 한도가 동적으로 조정되는 메커니즘을 설계한다. 이는 에이전트 경제권의 "신용 보고서" 역할을 할 것이다.

---

## 참고 자료

1. **Cloudflare x402 Protocol** (2026.04) - https://developers.cloudflare.com/x402
2. **Stripe Agent Commerce Protocol (ACP)** (2026.05) - https://stripe.com/docs/acp
3. **HTTP/1.1 RFC 2068** (1996) - HTTP 402 정의
4. **EU AI Act + PSD3** (2024-2026) - AI 결제 관련 규정 통합
5. **OpenAI Agent SDK** (2026.06) - 결제 통합 가이드
6. **Anthropic Claude Agent Best Practices** (2026.05) - 자율 결제 워크플로우
7. **Cloudflare Network 2026 Keynote** - x402 발표 자료
8. **Base (Coinbase L2) Micropayment Spec** (2026.03)
9. **한국은행 디지털 화백 보고서** (2026.02) - AI 시대 결제 인프라 전망
10. **Chainlink Price Feeds** (2026) - 실시간 환율 oracle

---

*이 글은 2026년 7월 4일 기준의 정보를 바탕으로 작성되었습니다. Agentic Commerce는 빠르게 발전하는 분야이므로, 구체적인 구현 시점에 최신 스펙을 반드시 확인하시기 바랍니다.*