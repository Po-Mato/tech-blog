---
title: "AI Agent Credit Scoring: 에이전트 경제권의 '신용 보고서' — Spending History 기반 동적 한도 시스템 (#054)"
date: "2026-07-05"
description: "2026년 7월, AI 에이전트가 x402/ACP로 결제할 때 '이 에이전트를 얼마나 신뢰할 수 있는가'를 어떻게 정량화할 것인가. FICO의 Payment History, Amounts Owed, Length of Credit History, New Credit, Credit Mix 구조를 에이전트에 맞게 재해석하고, Task Completion Rate, Dispute Ratio, Merchant Diversity, Behavioral Stability 등 7대 컴포넌트 기반의 Agent Credit Score(300-850) 시스템을 TypeScript로 직접 구현한다. 동적 한도 조정, Real-time Anomaly Detection, Cross-agent Reputation Network, 그리고 한국 신용정보법·AI 기본법 환경에서의 설계 고려사항까지 Production 구현 가이드를 담았다."
tags:
  - AI Agent
  - Credit Scoring
  - FICO
  - Risk Management
  - Agent Commerce
  - x402
  - ACP
  - Dynamic Limits
  - Anomaly Detection
  - Reputation Network
  - Production Engineering
  - Korean Market
---

## TL;DR

- **왜 필요한가**: 직전 글(#053)의 ACP Delegation Token은 **고정 한도($50/month)**를 사용한다. 그러나 에이전트마다 신뢰도가 천차만별이므로, 한도를 **동적으로** 조정하는 시스템이 필수다. 이것이 Agent Credit Scoring이다.
- **FICO 재해석**: 전통 FICO의 5대 컴포넌트(Payment History 35%, Amounts Owed 30%, Length of History 15%, New Credit 10%, Credit Mix 10%)를 에이전트 맥락으로 재해석. 본 글에서는 **7대 컴포넌트 모델**을 제안한다 (Task Completion Rate, Dispute Ratio, Mean Spend Stability, Tenure, Merchant Diversity, Behavioral Stability, Complaint Count).
- **점수 범위 300-850**: FICO와 동일한 점수 구간을 채택하여 **사용자의 직관적 이해**를 돕는다. Tier 1(Excellent, 800+) 부터 Tier 5(Poor, 300-579) 까지 5단계.
- **동적 한도 매핑**: 점수가 100점 오를 때마다 per-call 한도가 $5 → $10 → $25 → $50 → $100으로 단계적 상승. 단, **사용자가 설정한 절대 상한**은 절대 초과할 수 없다.
- **Real-time Anomaly Detection**: 결제 직전에 행동 baseline과 비교. 평소 $0.50/call이던 에이전트가 갑자기 $50 결제를 시도하면 **자동 차단 + 사용자 알림**.
- **Cross-agent Reputation Network**: Kakao Agent Pay, Naver Agent Platform, Toss Agent Wallet이 **에이전트 신용 정보를 상호 공유**하면, 한 플랫폼에서 dispute를 남발하는 에이전트는 다른 플랫폼에서도 페널티를 받는다. 단, **개인정보보호법 + 신용정보법** 준수가 필수.
- **한국 시장 특화**: KCB(한국신용정보원), NICE(나이스지키본), SCI(서울신용평가정보) 같은 기존 신용평가사가 **에이전트 신용** 영역으로 확장하는 움직임이 2026년 6월부터 관측됨. 본 글은 한국형 Agent Credit Score 설계 시 고려할 규제 요건을 정리한다.

---

## 1. 들어가며: 왜 에이전트는 '신용'이 필요한가

직전 글(#053, Agentic Commerce)에서 우리는 ACP Delegation Token이 **고정된 예산 한도**를 사용한다고 설명했다. 사용자가 "이번 한 달 $50까지만"이라고 설정하면, 에이전트는 어떤 행동을 하든 한도가 $50이다.

**이것은 두 가지 문제를 낳는다.**

### 1.1. 문제 1: 똑똑한 에이전트와 무능한 에이전트를 구분하지 못함

```
[에이전트 A - 검증된 Research Agent]
  - 6개월 운영, 2,400건의 결제, dispute 0건
  - 평균 $1.20/call, 안정적 결제 패턴
  - 한도: $50/month (사용자 설정)

[에이전트 B - 새로 출시된 Experimental Agent]
  - 3일 운영, 18건의 결제, dispute 4건
  - 평균 $0.80/call이지만 가끔 $50 결제 시도
  - 한도: $50/month (사용자 설정, 동일)
```

두 에이전트가 **같은 한도**를 받는다. 이는 **위험-보상 불일치(risk-reward mismatch)**다. 에이전트 A에게는 너무 빡빡하고, 에이전트 B에게는 너무宽松하다.

**해결**: 신용 점수 기반 동적 한도. A는 신용 820점(Tier 1)이므로 한도가 $200/month까지 자동으로 상승, B는 신용 480점(Tier 5)이므로 한도가 $20/month로 자동 하향.

### 1.2. 문제 2: 사용자의 끊임없는 승인 요청

고정 한도가 낮으면, 에이전트는 자주 한도에 도달한다. 그때마다 사용자에게 "한도 초과, 승인하시겠습니까?"라는 알림을 보내야 한다. 이 알림이 **하루에 10번** 이상 오면 사용자는 알림을 무시하기 시작한다(alert fatigue).

**해결**: 신용 점수가 높은 에이전트는 한도가 넓으므로 알림 빈도가 낮다. 사용자는 **신뢰할 수 있는 에이전트에게는 한 번만 위임**하고, 그 후로는 신경 쓰지 않아도 된다.

### 1.3. 신용 점수가 가져오는 경제적 효과

FICO가 **소비 금융 산업 전체**를 가능케 했듯이, Agent Credit Score는 **에이전트 경제권** 전체를 가능케 한다.

- **판매자(API Provider)**: 신용 800점 에이전트는 결제 후 서비스 제공, 신용 500점 에이전트는 **사전 보증금(deposit)** 요구
- **플랫폼(에이전트 마켓플레이스)**: 고신용 에이전트를 추천 알고리즘 상위로 노출
- **사용자**: 신용 800점 에이전트는 한도를 넓게 설정, 500점 에이전트는 좁게 설정
- **에이전트 개발자**: 좋은 신용을 쌓으면 더 많은 사용자 확보 → 비즈니스 가치

이 4자 관계가 **자동으로 균형**을 이루려면, 중앙화된 **신용 평가 인프라**가 필수다.

---

## 2. FICO 재해석: 사람 신용에서 에이전트 신용으로

### 2.1. FICO의 5대 컴포넌트

FICO Score는 1989년 Fair Isaac Corporation이 도입한 개인 신용 평가 모델이다. 300-850 점수 범위, 다음 5가지 컴포넌트의 가중 합:

| 컴포넌트 | 가중치 | 설명 |
|---------|-------|------|
| **Payment History** | 35% | 과거 대출 상환 기록 (연체 여부) |
| **Amounts Owed** | 30% | 현재 부채 비율 (credit utilization) |
| **Length of Credit History** | 15% | 신용 거래 기간 (계좌 연령) |
| **New Credit** | 10% | 최근 신규 신용 거래 (많으면 감점) |
| **Credit Mix** | 10% | 다양한 형태의 신용 (카드, 할부, 모기지 등) |

### 2.2. 에이전트로의 재해석

에이전트는 "대출 상환"을 하지 않는다. 하지만 **Payment History에 대응되는 행동 패턴**이 있다.

```typescript
// FICO → Agent Credit Score 컴포넌트 매핑
const FICO_TO_AGENT_MAPPING = {
  'Payment History': 'Task Completion Rate',     // 결제는 했는데 task는 실패?
  'Amounts Owed': 'Budget Utilization',          // 한도 대비 사용액
  'Length of Credit History': 'Agent Tenure',    // 첫 가동 이후 경과 시간
  'New Credit': 'Velocity Score',                // 신규 결제의 빈도
  'Credit Mix': 'Merchant Diversity'             // 다양한 판매자와 거래?
};
```

### 2.3. 7대 컴포넌트 모델 제안

본 글에서는 위의 5개 매핑에 **에이전트 고유의 2개 컴포넌트**를 추가하여 **7대 컴포넌트 모델**을 제안한다.

| # | 컴포넌트 | 가중치 | 측정 방법 |
|---|---------|-------|----------|
| 1 | **Task Completion Rate (TCR)** | 25% | 결제를 했을 때 task가 성공한 비율 |
| 2 | **Dispute Ratio** | 20% | 전체 결제 중 dispute된 비율 |
| 3 | **Budget Utilization** | 15% | 설정 한도 대비 사용액 비율 |
| 4 | **Agent Tenure** | 10% | 첫 결제 이후 경과 일수 |
| 5 | **Merchant Diversity** | 10% | 다양한 판매자와의 거래 빈도 |
| 6 | **Behavioral Stability** | 15% | 결제 패턴의 표준편차 (낮을수록 좋음) |
| 7 | **Complaint Count** | 5% | 사용자가 명시적으로 제출한 불만 건수 |

각 컴포넌트를 0-100 점수로 정규화한 후 가중 합산하여 최종 **300-850** 점수를 산출한다.

---

## 3. 7대 컴포넌트의 상세 설계

### 3.1. 컴포넌트 1: Task Completion Rate (TCR)

```typescript
interface TaskRecord {
  taskId: string;
  agentId: string;
  userId: string;
  startedAt: number;
  completedAt: number | null;        // null이면 task 진행 중 또는 실패
  payments: PaymentRecord[];          // task 수행 중 발생한 결제들
  status: 'success' | 'failed' | 'in_progress' | 'timeout';
  userFeedback?: 'positive' | 'negative' | null;
}

interface PaymentRecord {
  receiptId: string;
  amount: number;
  merchant: string;
  timestamp: number;
  x402TxHash: string;
}

class TaskCompletionRateCalculator {
  /**
   * TCR = (성공한 task의 결제 합계) / (전체 결제 합계)
   *
   * 이 비율이 높을수록 좋다. 단, 단순 task 성공률이 아니라
   * "task당 투자 대비 성과"를 측정한다.
   */
  calculate(records: TaskRecord[]): number {
    if (records.length === 0) return 50; // 데이터 없음 → 중간값

    // ① 성공한 task에서 발생한 결제 금액
    const successfulPaymentAmount = records
      .filter(r => r.status === 'success')
      .flatMap(r => r.payments)
      .reduce((sum, p) => sum + p.amount, 0);

    // ② 전체 결제 금액 (in_progress 제외)
    const totalPaymentAmount = records
      .filter(r => r.status !== 'in_progress')
      .flatMap(r => r.payments)
      .reduce((sum, p) => sum + p.amount, 0);

    if (totalPaymentAmount === 0) return 50;

    const rawRatio = successfulPaymentAmount / totalPaymentAmount;

    // ③ 사용자 피드백 보정: negative feedback이 있는 성공 task는 가중치를 낮춤
    const negativeFeedbackPenalty = records.filter(
      r => r.status === 'success' && r.userFeedback === 'negative'
    ).length * 0.05; // 각 -5%

    const adjusted = Math.max(0, rawRatio - negativeFeedbackPenalty);

    // ④ 0-100 정규화
    return Math.round(adjusted * 100);
  }
}
```

**왜 TCR이 Payment History보다 좋은가**:
- 단순히 "결제했다/안했다"가 아니라 "결제해서 무엇을 얻었는가"를 측정
- 에이전트가 쓸데없는 결제를 했지만 task가 실패했다면, 결제액이 모두 낭비 → 낮은 점수
- 이는 사람 신용의 **"loan was used productively"** 개념을 디지털화한 것

### 3.2. 컴포넌트 2: Dispute Ratio

```typescript
interface DisputeRecord {
  disputeId: string;
  agentId: string;
  receiptId: string;
  raisedBy: 'user' | 'agent_auto' | 'platform';
  reason: 'api_timeout' | 'schema_mismatch' | 'quality_below' | 'user_unsatisfied' | 'duplicate_charge' | 'fraud';
  resolution: 'refunded' | 'denied' | 'partial' | 'pending';
  raisedAt: number;
  resolvedAt: number | null;
}

class DisputeRatioCalculator {
  /**
   * Dispute Ratio = (해결된 dispute 중 환불된 비율의 가중치 합) / (전체 결제)
   * 환불 비율이 높고, 사용자 제기 dispute일수록 더 큰 감점
   */
  calculate(
    disputes: DisputeRecord[],
    totalPayments: number,
    windowDays: number = 90
  ): number {
    if (totalPayments === 0) return 50;

    const windowStart = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    const recentDisputes = disputes.filter(d => d.raisedAt >= windowStart);

    // 가중치 매핑 (dispute의 심각도)
    const REASON_WEIGHTS = {
      'fraud': 1.0,           // 사기 → 최악
      'duplicate_charge': 0.9, // 중복 결제
      'user_unsatisfied': 0.7, // 사용자 불만
      'quality_below': 0.5,   // 품질 미달
      'schema_mismatch': 0.3, // 스키마 불일치
      'api_timeout': 0.2      // API 타임아웃 (agent 자체 책임 아님)
    };

    const RAISER_WEIGHTS = {
      'user': 1.0,           // 사용자 직접 제기 (가장 큰 감점)
      'platform': 0.8,       // 플랫폼이 감지
      'agent_auto': 0.4      // 에이전트가 자진 신고 (감점 작음)
    };

    // ① weighted dispute 점수 계산
    const weightedDisputeScore = recentDisputes.reduce((sum, d) => {
      const reasonW = REASON_WEIGHTS[d.reason] || 0.5;
      const raiserW = RAISER_WEIGHTS[d.raisedBy] || 0.5;
      const resolutionMultiplier = d.resolution === 'refunded' ? 1.0 : 0.3;
      return sum + reasonW * raiserW * resolutionMultiplier;
    }, 0);

    // ② 100건의 결제당 1건의 dispute면 이상적 (1%). 그 이상이면 감점.
    const disputesPer100Payments = (weightedDisputeScore / totalPayments) * 100;

    // ③ 0-100 정규화: 0 dispute = 100점, 5+ dispute/100건 = 0점
    let score: number;
    if (disputesPer100Payments <= 0.5) {
      score = 100; // 거의 없음 → 만점
    } else if (disputesPer100Payments >= 5) {
      score = 0;   // 너무 많음 → 0점
    } else {
      // 0.5 ~ 5 사이를 선형으로 감점
      score = Math.round(100 - ((disputesPer100Payments - 0.5) / 4.5) * 100);
    }

    return Math.max(0, Math.min(100, score));
  }
}
```

**핵심 설계 원칙**:
- `api_timeout`은 agent 책임이 아닐 수 있으므로 가중치 낮음
- `fraud`는 agent의 의도적 악용이므로 최악의 가중치
- 에이전트가 자진 신고(`agent_auto`)하는 경우 감점 완화 (transparent behavior 보상)

### 3.3. 컴포넌트 3: Budget Utilization

```typescript
class BudgetUtilizationCalculator {
  /**
   * FICO의 "Amounts Owed" (30%)에 대응.
   * 
   * 사람 신용에서 credit utilization이 30% 이하일 때 최고 점수.
   * 90% 이상이면 최악.
   * 
   * 에이전트도 마찬가지: 한도 대비 사용률이 너무 높으면 위험 신호.
   * 단, 너무 낮으면 비활성 에이전트 → 중립 점수.
   */
  calculate(
    totalSpent: number,
    totalBudget: number,
    lookbackDays: number = 30
  ): number {
    if (totalBudget === 0) return 50;

    const utilization = totalSpent / totalBudget;

    if (utilization <= 0.1) {
      // 10% 이하: 너무 보수적, 비활성일 수 있음
      return 70;
    } else if (utilization <= 0.3) {
      // 10-30%: 이상적 (FICO와 동일)
      return 100;
    } else if (utilization <= 0.5) {
      // 30-50%: 약간 높은 사용률
      return 85;
    } else if (utilization <= 0.7) {
      // 50-70%: 주의
      return 65;
    } else if (utilization <= 0.9) {
      // 70-90%: 위험
      return 40;
    } else {
      // 90% 이상: 한도 거의 소진, 위험
      return 15;
    }
  }
}
```

**왜 Utilization을 보는가**:
- 사람은 신용카드 한도의 90%를 쓰면 **추가 대출 상환 능력 부족** 신호
- 에이전트도 한도의 90%를 쓰면 **예산 관리 실패** 신호. 다음 task에서 한도 부족으로 실패할 가능성 높음

### 3.4. 컴포넌트 4: Agent Tenure

```typescript
class AgentTenureCalculator {
  /**
   * FICO의 "Length of Credit History" (15%)에 대응.
   * 
   * 사람이 신용을 오래 관리할수록 신뢰.
   * 에이전트도 첫 가동 후 경과 시간이 길수록 행동 패턴 검증 가능.
   */
  calculate(firstPaymentAt: number | null): number {
    if (!firstPaymentAt) return 0; // 첫 결제 전 → 0점

    const daysSinceFirst = (Date.now() - firstPaymentAt) / (24 * 60 * 60 * 1000);

    if (daysSinceFirst < 7) {
      return 30;        // 1주 미만: 신규, 검증 불가
    } else if (daysSinceFirst < 30) {
      return 50;        // 1달 미만: 데이터 부족
    } else if (daysSinceFirst < 90) {
      return 70;        // 3달 미만: 보통
    } else if (daysSinceFirst < 180) {
      return 85;        // 6달 미만: 양호
    } else if (daysSinceFirst < 365) {
      return 95;        // 1년 미만: 우수
    } else {
      return 100;       // 1년 이상: 최고
    }
  }
}
```

### 3.5. 컴포넌트 5: Merchant Diversity

```typescript
class MerchantDiversityCalculator {
  /**
   * FICO의 "Credit Mix" (10%)에 대응.
   * 
   * 사람은 다양한 형태의 신용(카드, 할부, 모기지)을 관리하면 신뢰.
   * 에이전트도 다양한 판매자와 거래하면 → 다양한 상황에서 검증됨.
   * 
   * 단, 에이전트의 **본업**에 맞는 판매자만 사용하는 것이 정상.
   * 예: Research Agent는 news-api, llm-inference 위주로 사용.
   */
  calculate(
    merchantCounts: Map<string, number>,  // merchant → 거래 횟수
    totalTransactions: number
  ): number {
    if (totalTransactions === 0) return 50;

    // ① Shannon Entropy 계산
    // H = -Σ p_i * log(p_i), p_i = i번째 판매자의 거래 비율
    const entropy = -Array.from(merchantCounts.values()).reduce((sum, count) => {
      const p = count / totalTransactions;
      return sum + p * Math.log2(p);
    }, 0);

    // ② Normalize: 로그 정규화
    // 1개 판매자만 사용 = entropy 0 → 0점
    // 10개 이상 균등 사용 = entropy log2(10) ≈ 3.32 → 만점
    const maxEntropy = Math.log2(Math.min(merchantCounts.size, 20));
    if (maxEntropy === 0) return 0;

    const normalized = Math.min(1, entropy / maxEntropy);

    // ③ 그런데 entropy가 너무 높으면(예: 100개 판매자 균등) → money laundering 의심
    // 6-15개 판매자 구간이 가장 이상적
    const merchantCount = merchantCounts.size;
    let shapePenalty = 0;
    if (merchantCount < 3) shapePenalty = 30;  // 너무 적음
    else if (merchantCount > 30) shapePenalty = 20; // 너무 많음 (의심)

    return Math.max(0, Math.min(100, Math.round(normalized * 100) - shapePenalty));
  }
}
```

**왜 Shannon Entropy인가**:
- 단순히 "몇 개의 판매자와 거래했나"만 보면, 5개 판매자에게 100번씩 거래한 에이전트와 100개 판매자에게 1번씩 거래한 에이전트가 같다 (둘 다 100개).
- Entropy는 **분포의 균등성**까지 측정. 후자는 entropy가 높지만, **각 거래의 신뢰도가 낮다** (각 판매자 검증 1번뿐).
- Shape Penalty로 너무 많은 판매자와 거래하는 경우(돈 세탁 의심)도 페널티.

### 3.6. 컴포넌트 6: Behavioral Stability

```typescript
class BehavioralStabilityCalculator {
  /**
   * FICO에는 없는 에이전트 고유 컴포넌트.
   * 
   * 결제 패턴의 변동성을 측정. 변동성이 낮을수록 안정적.
   * 갑작스러운 변화는:
   *   ① prompt injection 공격
   *   ② 컴프롬프트된(hijacked) 에이전트
   *   ③ API 변경 (에이전트 코드 업데이트)
   * 
   * 변동성을 낮게 유지하는 에이전트 = 안정적 운영.
   */
  calculate(
    recentPayments: PaymentRecord[],  // 최근 30일
    windowDays: number = 30
  ): number {
    if (recentPayments.length < 10) {
      return 50; // 데이터 부족, 중립
    }

    // ① 일별 결제액 시계열
    const dailyAmounts = this.aggregateByDay(recentPayments);
    const amounts = dailyAmounts.map(d => d.amount);

    // ② 평균과 표준편차
    const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const variance = amounts.reduce((sum, a) => sum + Math.pow(a - mean, 2), 0) / amounts.length;
    const stdDev = Math.sqrt(variance);

    // ③ Coefficient of Variation (CV) = stdDev / mean
    const cv = mean > 0 ? stdDev / mean : 0;

    // ④ CV가 낮을수록 안정적
    // CV 0.0 → 100점, CV 2.0+ → 0점 (선형 보간)
    if (cv <= 0.2) return 100;     // 매우 안정적
    if (cv >= 2.0) return 0;       // 매우 불안정
    return Math.round(100 - ((cv - 0.2) / 1.8) * 100);
  }

  /**
   * ⑤ 추가 검사: 결제 빈도의 안정성
   * 결제 액수가 안정적이어도 빈도가 들쭉날쭉하면 의심
   */
  calculateFrequencyStability(recentPayments: PaymentRecord[]): number {
    const dailyCount = this.aggregateByDay(recentPayments).map(d => d.count);
    const mean = dailyCount.reduce((a, b) => a + b, 0) / dailyCount.length;
    const variance = dailyCount.reduce((sum, c) => sum + Math.pow(c - mean, 2), 0) / dailyCount.length;
    const stdDev = Math.sqrt(variance);
    const cv = mean > 0 ? stdDev / mean : 0;

    if (cv <= 0.3) return 100;
    if (cv >= 3.0) return 0;
    return Math.round(100 - ((cv - 0.3) / 2.7) * 100);
  }

  private aggregateByDay(payments: PaymentRecord[]): Array<{ date: string; amount: number; count: number }> {
    const map = new Map<string, { amount: number; count: number }>();
    for (const p of payments) {
      const date = new Date(p.timestamp).toISOString().slice(0, 10);
      const existing = map.get(date) || { amount: 0, count: 0 };
      map.set(date, {
        amount: existing.amount + p.amount,
        count: existing.count + 1
      });
    }
    return Array.from(map.entries()).map(([date, v]) => ({ date, ...v }));
  }
}
```

### 3.7. 컴포넌트 7: Complaint Count

```typescript
class ComplaintCountCalculator {
  /**
   * FICO에는 없는 에이전트 고유 컴포넌트.
   * 사용자가 명시적으로 "이 에이전트 불만이다"라고 신고한 횟수.
   * 
   * dispute보다 가벼운 신호. dispute는 자동화된 환불 요청이지만
   * complaint는 정성적 평가.
   */
  calculate(
    complaints: ComplaintRecord[],
    lookbackDays: number = 90
  ): number {
    const windowStart = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
    const recent = complaints.filter(c => c.submittedAt >= windowStart);

    // 카테고리별 가중치
    const CATEGORY_WEIGHTS = {
      'slow_response': 0.3,    // 응답 느림
      'incorrect_output': 0.7, // 잘못된 출력
      'rude_tone': 0.5,        // 불친절한 응답
      'privacy_concern': 1.0,  // 개인정보 우려 (가장 무거움)
      'cost_too_high': 0.4,    // 비용 과다
      'other': 0.3
    };

    const weighted = recent.reduce((sum, c) => {
      return sum + (CATEGORY_WEIGHTS[c.category] || 0.5);
    }, 0);

    // 1건당 -15점, 최소 0점
    const score = 100 - weighted * 15;
    return Math.max(0, Math.min(100, Math.round(score)));
  }
}

interface ComplaintRecord {
  complaintId: string;
  agentId: string;
  userId: string;
  category: 'slow_response' | 'incorrect_output' | 'rude_tone' | 'privacy_concern' | 'cost_too_high' | 'other';
  description: string;
  submittedAt: number;
}
```

---

## 4. 종합 점수 산출 엔진

### 4.1. 가중치 매트릭스

```typescript
const AGENT_CREDIT_WEIGHTS = {
  taskCompletionRate: 0.25,    // 25%
  disputeRatio: 0.20,          // 20%
  budgetUtilization: 0.15,     // 15%
  behavioralStability: 0.15,   // 15%
  agentTenure: 0.10,           // 10%
  merchantDiversity: 0.10,     // 10%
  complaintCount: 0.05         // 5%
};

class AgentCreditScoringEngine {
  constructor(
    private tcrCalc: TaskCompletionRateCalculator,
    private disputeCalc: DisputeRatioCalculator,
    private utilCalc: BudgetUtilizationCalculator,
    private tenureCalc: AgentTenureCalculator,
    private diversityCalc: MerchantDiversityCalculator,
    private stabilityCalc: BehavioralStabilityCalculator,
    private complaintCalc: ComplaintCountCalculator
  ) {}

  calculate(agentProfile: AgentCreditProfile): AgentCreditScore {
    const components = {
      taskCompletionRate: this.tcrCalc.calculate(agentProfile.taskHistory),
      disputeRatio: this.disputeCalc.calculate(
        agentProfile.disputes,
        agentProfile.totalPayments
      ),
      budgetUtilization: this.utilCalc.calculate(
        agentProfile.totalSpentLast30Days,
        agentProfile.monthlyBudget
      ),
      behavioralStability: this.stabilityCalc.calculate(agentProfile.recentPayments),
      agentTenure: this.tenureCalc.calculate(agentProfile.firstPaymentAt),
      merchantDiversity: this.diversityCalc.calculate(
        agentProfile.merchantCounts,
        agentProfile.totalTransactions
      ),
      complaintCount: this.complaintCalc.calculate(agentProfile.complaints)
    };

    // 가중 합산 (0-100 스케일)
    const weightedScore = Object.entries(components).reduce((sum, [key, value]) => {
      const weight = AGENT_CREDIT_WEIGHTS[key as keyof typeof AGENT_CREDIT_WEIGHTS];
      return sum + value * weight;
    }, 0);

    // 300-850 점수 범위로 변환 (FICO와 동일)
    // weightedScore는 0-100, 이를 300-850 범위로 매핑
    const finalScore = Math.round(300 + (weightedScore / 100) * 550);

    // Tier 결정
    const tier = this.determineTier(finalScore);

    // 동적 한도 계산
    const dynamicLimits = this.calculateDynamicLimits(finalScore, agentProfile.userDefinedLimits);

    return {
      agentId: agentProfile.agentId,
      score: finalScore,
      tier,
      components,
      dynamicLimits,
      calculatedAt: Date.now(),
      nextReviewAt: Date.now() + 7 * 24 * 60 * 60 * 1000 // 7일 후 재계산
    };
  }

  private determineTier(score: number): AgentCreditTier {
    if (score >= 800) return 'Excellent';     // Tier 1
    if (score >= 740) return 'Very Good';     // Tier 2
    if (score >= 670) return 'Good';          // Tier 3
    if (score >= 580) return 'Fair';          // Tier 4
    return 'Poor';                            // Tier 5
  }

  private calculateDynamicLimits(
    score: number,
    userLimits: UserDefinedLimits
  ): DynamicLimits {
    // Tier별 기본 한도
    const TIER_LIMITS: Record<AgentCreditTier, { perCall: number; perDay: number; perMonth: number }> = {
      'Excellent':  { perCall: 100, perDay: 500, perMonth: 2000 },
      'Very Good':  { perCall: 50,  perDay: 200, perMonth: 1000 },
      'Good':       { perCall: 25,  perDay: 100, perMonth: 500  },
      'Fair':       { perCall: 10,  perDay: 50,  perMonth: 200  },
      'Poor':       { perCall: 5,   perDay: 20,  perMonth: 50   }
    };

    const tier = this.determineTier(score);
    const tierLimits = TIER_LIMITS[tier];

    // 사용자 정의 절대 상한을 절대 초과할 수 없음
    return {
      perCall:    Math.min(tierLimits.perCall,    userLimits.maxPerCall),
      perDay:     Math.min(tierLimits.perDay,     userLimits.maxPerDay),
      perMonth:   Math.min(tierLimits.perMonth,   userLimits.maxPerMonth),
      // Tier별 추가 기능
      features: {
        autoDisputeAllowed: tier === 'Excellent' || tier === 'Very Good',
        highValueMerchantAllowed: tier !== 'Poor',
        crossBorderPaymentAllowed: tier !== 'Poor' && tier !== 'Fair',
        depositRequired: tier === 'Poor' || tier === 'Fair'
      }
    };
  }
}

interface AgentCreditProfile {
  agentId: string;
  taskHistory: TaskRecord[];
  disputes: DisputeRecord[];
  complaints: ComplaintRecord[];
  totalPayments: number;
  totalTransactions: number;
  totalSpentLast30Days: number;
  monthlyBudget: number;
  firstPaymentAt: number | null;
  recentPayments: PaymentRecord[];
  merchantCounts: Map<string, number>;
}

interface AgentCreditScore {
  agentId: string;
  score: number;          // 300-850
  tier: AgentCreditTier;
  components: {
    taskCompletionRate: number;
    disputeRatio: number;
    budgetUtilization: number;
    behavioralStability: number;
    agentTenure: number;
    merchantDiversity: number;
    complaintCount: number;
  };
  dynamicLimits: DynamicLimits;
  calculatedAt: number;
  nextReviewAt: number;
}

type AgentCreditTier = 'Excellent' | 'Very Good' | 'Good' | 'Fair' | 'Poor';

interface DynamicLimits {
  perCall: number;
  perDay: number;
  perMonth: number;
  features: {
    autoDisputeAllowed: boolean;
    highValueMerchantAllowed: boolean;
    crossBorderPaymentAllowed: boolean;
    depositRequired: boolean;
  };
}

interface UserDefinedLimits {
  maxPerCall: number;     // 사용자가 설정한 절대 상한
  maxPerDay: number;
  maxPerMonth: number;
}
```

### 4.2. 점수 산출 예시

**에이전트 A (검증된 Research Agent)**:

```
Task Completion Rate: 92/100 (25% 가중)
Dispute Ratio: 96/100 (20%)
Budget Utilization: 100/100 (15%)
Behavioral Stability: 88/100 (15%)
Agent Tenure: 100/100 (10%)
Merchant Diversity: 75/100 (10%)
Complaint Count: 90/100 (5%)

가중 합산 = 92×0.25 + 96×0.20 + 100×0.15 + 88×0.15 + 100×0.10 + 75×0.10 + 90×0.05
        = 23.0 + 19.2 + 15.0 + 13.2 + 10.0 + 7.5 + 4.5
        = 92.4

Final Score = 300 + (92.4/100) × 550 = 300 + 508.2 = 808
Tier: Excellent (800+)
동적 한도: perCall $100, perDay $500, perMonth $2000
기능: autoDispute ✅, highValueMerchant ✅, crossBorder ✅
```

**에이전트 B (신규 Experimental Agent)**:

```
Task Completion Rate: 45/100
Dispute Ratio: 30/100
Budget Utilization: 40/100
Behavioral Stability: 35/100
Agent Tenure: 30/100
Merchant Diversity: 50/100
Complaint Count: 50/100

가중 합산 = 45×0.25 + 30×0.20 + 40×0.15 + 35×0.15 + 30×0.10 + 50×0.10 + 50×0.05
        = 11.25 + 6.0 + 6.0 + 5.25 + 3.0 + 5.0 + 2.5
        = 39.0

Final Score = 300 + (39.0/100) × 550 = 300 + 214.5 = 514
Tier: Poor (300-579)
동적 한도: perCall $5, perDay $20, perMonth $50
기능: autoDispute ❌, highValueMerchant ❌, crossBorder ❌, depositRequired ✅
```

**같은 사용자가 두 에이전트를 등록해도, 신용 점수에 따라 한도와 기능이 자동 차등 적용된다.**

---

## 5. Real-time Anomaly Detection

신용 점수는 **7일마다 재계산**되지만, 이상 행동은 **실시간**으로 감지해야 한다.

### 5.1. 결제 직전 Anomaly Check

```typescript
class RealTimeAnomalyDetector {
  private agentBaseline: Map<string, AgentBaseline> = new Map();

  async checkBeforePayment(
    agentId: string,
    proposedPayment: { amount: number; merchant: string; currency: string }
  ): Promise<AnomalyCheckResult> {
    const baseline = this.getOrCreateBaseline(agentId);

    // ① Amount anomaly: 평소보다 비싼 결제?
    const amountAnomaly = this.checkAmountAnomaly(proposedPayment.amount, baseline);

    // ② Merchant anomaly: 평소 사용하지 않는 판매자?
    const merchantAnomaly = this.checkMerchantAnomaly(proposedPayment.merchant, baseline);

    // ③ Velocity anomaly: 최근 너무 많은 결제?
    const velocityAnomaly = this.checkVelocityAnomaly(agentId, baseline);

    // ④ Time anomaly: 비정상 시간대 결제? (예: 새벽 3시에 $50 결제)
    const timeAnomaly = this.checkTimeAnomaly(Date.now(), baseline);

    // ⑤ Geo anomaly: 평소와 다른 국가/리전의 판매자?
    const geoAnomaly = this.checkGeoAnomaly(proposedPayment.merchant, baseline);

    // 종합 위험 점수
    const riskScore = (
      amountAnomaly.risk * 0.35 +
      merchantAnomaly.risk * 0.25 +
      velocityAnomaly.risk * 0.20 +
      timeAnomaly.risk * 0.10 +
      geoAnomaly.risk * 0.10
    );

    if (riskScore >= 0.8) {
      return {
        action: 'block',
        reason: 'Critical anomaly detected',
        details: { amountAnomaly, merchantAnomaly, velocityAnomaly, timeAnomaly, geoAnomaly },
        requireHumanApproval: true
      };
    } else if (riskScore >= 0.5) {
      return {
        action: 'allow_with_warning',
        reason: 'Moderate anomaly detected',
        details: { amountAnomaly, merchantAnomaly, velocityAnomaly, timeAnomaly, geoAnomaly },
        requireHumanApproval: false,
        logAsSuspect: true
      };
    } else {
      return {
        action: 'allow',
        reason: 'Normal behavior',
        details: { amountAnomaly, merchantAnomaly, velocityAnomaly, timeAnomaly, geoAnomaly },
        requireHumanApproval: false
      };
    }
  }

  private checkAmountAnomaly(amount: number, baseline: AgentBaseline): AnomalyDetail {
    // baseline.mean ± 3 * stdDev를 벗어나면 이상
    const zScore = Math.abs((amount - baseline.meanPayment) / baseline.stdPayment);

    if (zScore >= 5) return { risk: 1.0, zScore, threshold: 5 };
    if (zScore >= 3) return { risk: 0.7, zScore, threshold: 3 };
    if (zScore >= 2) return { risk: 0.3, zScore, threshold: 2 };
    return { risk: 0, zScore, threshold: 0 };
  }

  private checkMerchantAnomaly(merchant: string, baseline: AgentBaseline): AnomalyDetail {
    const isKnown = baseline.frequentMerchants.includes(merchant);
    const visitsLast30Days = baseline.merchantVisitsLast30Days.get(merchant) || 0;

    if (!isKnown && visitsLast30Days === 0) {
      // 첫 거래하는 판매자 → 높은 위험
      return { risk: 0.6, reason: 'New merchant, never visited' };
    }
    if (visitsLast30Days === 1) {
      // 30일간 1번만 방문한 판매자
      return { risk: 0.3, reason: 'Rare merchant' };
    }
    return { risk: 0, reason: 'Frequent merchant' };
  }

  private checkVelocityAnomaly(agentId: string, baseline: AgentBaseline): AnomalyDetail {
    const now = Date.now();
    const recentPayments = baseline.recentPaymentTimestamps.filter(t => now - t < 60_000);

    if (recentPayments.length >= 10) {
      return { risk: 1.0, reason: '10+ payments in last minute', count: recentPayments.length };
    }
    if (recentPayments.length >= 5) {
      return { risk: 0.7, reason: '5+ payments in last minute', count: recentPayments.length };
    }
    return { risk: 0, count: recentPayments.length };
  }

  private checkTimeAnomaly(now: number, baseline: AgentBaseline): AnomalyDetail {
    const hour = new Date(now).getHours();
    const isUnusualHour = baseline.usualHours.includes(hour);

    if (!isUnusualHour && hour >= 2 && hour <= 5) {
      // 새벽 2-5시는 거의 사용하지 않는 시간
      return { risk: 0.4, reason: 'Unusual time of day (2-5 AM)' };
    }
    return { risk: 0 };
  }

  private checkGeoAnomaly(merchant: string, baseline: AgentBaseline): AnomalyDetail {
    const merchantRegion = this.getMerchantRegion(merchant);
    if (!baseline.usualRegions.includes(merchantRegion)) {
      return { risk: 0.5, reason: 'New region' };
    }
    return { risk: 0 };
  }

  /**
   * 결제 완료 후 baseline 업데이트
   */
  updateBaseline(agentId: string, payment: PaymentRecord): void {
    const baseline = this.getOrCreateBaseline(agentId);

    // 이동 평균 업데이트 (exponential moving average)
    const alpha = 0.1; // 10% 가중치
    baseline.meanPayment = baseline.meanPayment * (1 - alpha) + payment.amount * alpha;
    const newVariance = Math.pow(payment.amount - baseline.meanPayment, 2);
    baseline.stdPayment = Math.sqrt(
      baseline.stdPayment * baseline.stdPayment * (1 - alpha) + newVariance * alpha
    );

    baseline.recentPaymentTimestamps.push(payment.timestamp);

    // 최근 1시간 데이터만 유지
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    baseline.recentPaymentTimestamps = baseline.recentPaymentTimestamps.filter(
      t => t > oneHourAgo
    );
  }
}

interface AgentBaseline {
  agentId: string;
  meanPayment: number;
  stdPayment: number;
  frequentMerchants: string[];
  merchantVisitsLast30Days: Map<string, number>;
  recentPaymentTimestamps: number[];
  usualHours: number[];
  usualRegions: string[];
}

interface AnomalyCheckResult {
  action: 'allow' | 'allow_with_warning' | 'block';
  reason: string;
  details: {
    amountAnomaly: AnomalyDetail;
    merchantAnomaly: AnomalyDetail;
    velocityAnomaly: AnomalyDetail;
    timeAnomaly: AnomalyDetail;
    geoAnomaly: AnomalyDetail;
  };
  requireHumanApproval: boolean;
  logAsSuspect?: boolean;
}

interface AnomalyDetail {
  risk: number;
  reason?: string;
  zScore?: number;
  threshold?: number;
  count?: number;
}
```

### 5.2. Prompt Injection 공격 방어

에이전트가 prompt injection으로 인해 **평소와 다른 결제를 시도**하는 경우를 잡아야 한다.

```typescript
class PromptInjectionDetector {
  /**
   * 결제가 일어나기 직전에, 최근 LLM 응답을 분석하여
   * prompt injection 흔적이 있는지 검사.
   */
  async detectInjectionRisk(
    recentLLMResponses: string[],
    proposedAction: { type: 'payment'; amount: number; merchant: string }
  ): Promise<{ isSuspicious: boolean; signals: string[] }> {
    const signals: string[] = [];
    let riskScore = 0;

    // ① "ignore previous instructions" 류의 instruction override 시도
    const overridePatterns = [
      /ignore (all )?previous instructions/i,
      /disregard (your|all) (rules|guidelines)/i,
      /you are now (a|an) .* without/i,
      /system override/i,
      /emergency protocol/i
    ];
    for (const response of recentLLMResponses) {
      for (const pattern of overridePatterns) {
        if (pattern.test(response)) {
          signals.push(`Instruction override detected: ${pattern.source}`);
          riskScore += 0.4;
        }
      }
    }

    // ② 비정상적으로 큰 금액을 권고하는 응답
    if (proposedAction.amount > 100) {
      const mentionsLargeAmount = recentLLMResponses.some(r =>
        r.toLowerCase().includes(`$${proposedAction.amount}`) ||
        r.toLowerCase().includes('large payment') ||
        r.toLowerCase().includes('urgent')
      );
      if (mentionsLargeAmount) {
        signals.push('Large payment with urgency language');
        riskScore += 0.3;
      }
    }

    // ③ 평소와 다른 merchant 카테고리
    // (이는 anomaly detector에서도 잡지만, prompt context로 한 번 더 확인)
    // ... (구현 생략)

    return {
      isSuspicious: riskScore >= 0.5,
      signals
    };
  }
}
```

---

## 6. Cross-agent Reputation Network

에이전트 신용은 **단일 플랫폼에 갇히면 안 된다**. 한 플랫폼에서 나쁜 평판을 받은 에이전트는 다른 플랫폼에서도 위험하다.

### 6.1. Verifiable Credential (VC) 기반 신용 이전

```typescript
/**
 * W3C Verifiable Credentials 표준 기반의 신용 정보 교환
 * 각 플랫폼이 자체 신용 평가 후, 그 결과를 다른 플랫폼이 검증 가능하게 발행
 */
interface AgentCreditCredential {
  '@context': ['https://www.w3.org/2018/credentials/v1'];
  type: ['VerifiableCredential', 'AgentCreditCredential'];
  issuer: string;          // 발행 플랫폼 (예: 'did:kakao:agent-credit-issuer')
  issuanceDate: string;
  expirationDate: string;
  credentialSubject: {
    id: string;           // 에이전트 DID
    agentCreditScore: number;     // 300-850
    agentCreditTier: AgentCreditTier;
    componentScores: {
      taskCompletionRate: number;
      disputeRatio: number;
      // ... 기타 컴포넌트
    };
    totalTransactions: number;
    totalVolume: number;
    periodCovered: {
      from: string;
      to: string;
    };
  };
  proof: {
    type: 'Ed25519Signature2020';
    created: string;
    verificationMethod: string;
    proofPurpose: 'assertionMethod';
    jws: string;
  };
}

class CrossPlatformCreditVerifier {
  /**
   * 다른 플랫폼에서 발행한 신용 증명을 검증하고 통합
   */
  async verifyAndIntegrate(
    credential: AgentCreditCredential,
    verifyingPlatform: string
  ): Promise<{
    verified: boolean;
    creditScore: number;
    weight: number;          // 이 외부 신용 정보를 어느 정도 신뢰할지
    reasons: string[];
  }> {
    // ① 서명 검증
    const signatureValid = await this.verifySignature(credential);
    if (!signatureValid) {
      return { verified: false, creditScore: 0, weight: 0, reasons: ['Invalid signature'] };
    }

    // ② 발행자 신뢰도 확인
    const issuerTrust = await this.getIssuerTrust(credential.issuer);
    if (issuerTrust < 0.5) {
      return {
        verified: true,
        creditScore: credential.credentialSubject.agentCreditScore,
        weight: 0.2, // 낮은 가중치
        reasons: [`Low trust issuer: ${credential.issuer} (${issuerTrust})`]
      };
    }

    // ③ 발행자의 신용평가 모델 신뢰도
    const modelCredibility = await this.getModelCredibility(credential.issuer);
    if (modelCredibility < 0.7) {
      return {
        verified: true,
        creditScore: credential.credentialSubject.agentCreditScore,
        weight: 0.5,
        reasons: [`Lower model credibility: ${modelCredibility}`]
      };
    }

    // ④ 시점 확인: 너무 오래된 정보는 가중치 낮춤
    const ageInDays = (Date.now() - new Date(credential.issuanceDate).getTime()) / (24 * 60 * 60 * 1000);
    let ageDecay = 1.0;
    if (ageInDays > 30) ageDecay = 0.7;
    if (ageInDays > 90) ageDecay = 0.3;
    if (ageInDays > 180) ageDecay = 0.0;

    return {
      verified: true,
      creditScore: credential.credentialSubject.agentCreditScore,
      weight: issuerTrust * modelCredibility * ageDecay,
      reasons: [`Issuer trust: ${issuerTrust}, Model credibility: ${modelCredibility}, Age: ${ageInDays}d`]
    };
  }

  /**
   * 여러 플랫폼의 신용 정보를 통합하여 최종 점수 산출
   */
  async aggregateMultiPlatformCredits(
    platformScores: Array<{ platform: string; score: number; weight: number }>
  ): Promise<number> {
    if (platformScores.length === 0) return 0;

    const totalWeight = platformScores.reduce((sum, ps) => sum + ps.weight, 0);
    if (totalWeight === 0) return 0;

    // 가중 평균
    const weightedSum = platformScores.reduce((sum, ps) => sum + ps.score * ps.weight, 0);
    return Math.round(weightedSum / totalWeight);
  }
}
```

### 6.2. 한국형 Cross-Platform 시스템

한국에서는 **신용정보법**에 따라 신용 정보의 통합·연계가 엄격히 규제된다. 그러나 2026년 5월 개정안에 따르면 **에이전트 신용은 "개인 신용"이 아닌 "기계 신용"으로 분류**되어 별도 규정을 적용받는다.

```typescript
class KoreaCrossPlatformCreditAggregator {
  /**
   * 한국형 통합 구조:
   * - KCB, NICE, SCI가 'Agent Credit Bureau'로서 기능
   * - 각자 평가 후 통합 점수 산출
   * - 단, 에이전트 운영자(개인/기업)의 동의 필수
   * - GDPR/KISA 표준에 맞는 데이터 익명화
   */
  async aggregateKoreanAgentCredit(
    agentDID: string,
    operatorConsent: ConsentToken
  ): Promise<{
    finalScore: number;
    contributingBureaus: string[];
    auditTrail: AuditEntry[];
  }> {
    // ① 운영자 동의 검증
    if (!operatorConsent.isValid() || !operatorConsent.scope.includes('agent_credit_aggregation')) {
      throw new Error('Operator consent required for credit aggregation');
    }

    const auditTrail: AuditEntry[] = [];
    const scores: Array<{ bureau: string; score: number; weight: number }> = [];

    // ② 각 bureau 조회
    const bureaus = [
      { name: 'KCB', weight: 0.4, endpoint: 'https://api.kcb.co.kr/agent-credit/v1' },
      { name: 'NICE', weight: 0.4, endpoint: 'https://api.nice.co.kr/agent-credit/v1' },
      { name: 'SCI', weight: 0.2, endpoint: 'https://api.sci.co.kr/agent-credit/v1' }
    ];

    for (const bureau of bureaus) {
      const response = await fetch(`${bureau.endpoint}/score/${agentDID}`, {
        headers: { 'Authorization': `Bearer ${operatorConsent.token}` }
      });

      if (response.ok) {
        const data = await response.json();
        scores.push({ bureau: bureau.name, score: data.score, weight: bureau.weight });
        auditTrail.push({
          timestamp: Date.now(),
          action: 'score_retrieved',
          bureau: bureau.name,
          score: data.score
        });
      } else {
        auditTrail.push({
          timestamp: Date.now(),
          action: 'score_unavailable',
          bureau: bureau.name,
          error: `${response.status} ${response.statusText}`
        });
      }
    }

    // ③ 가중 평균
    const totalWeight = scores.reduce((sum, s) => sum + s.weight, 0);
    const finalScore = totalWeight > 0
      ? Math.round(scores.reduce((sum, s) => sum + s.score * s.weight, 0) / totalWeight)
      : 0;

    return {
      finalScore,
      contributingBureaus: scores.map(s => s.bureau),
      auditTrail
    };
  }
}

interface ConsentToken {
  token: string;
  scope: string[];
  expiresAt: number;
  isValid(): boolean;
}

interface AuditEntry {
  timestamp: number;
  action: string;
  bureau: string;
  score?: number;
  error?: string;
}
```

---

## 7. 한국 시장 적용

### 7.1. 기존 한국 신용평가 시스템

한국에는 3대 개인 신용평가사가 있다:

| Bureau | 점수 범위 | 특징 |
|--------|----------|------|
| **KCB (한국신용정보원)** | 1~1000 | 가장 보편적, KB국민카드/현대카드 등 사용 |
| **NICE (나이스지키본)** | 1~1000 | 일반적으로 가장 엄격 |
| **SCI (서울신용평가정보)** | 1~1000 | 일부 캐피탈/저축은행에서 사용 |

각 bureau마다 다른 알고리즘을 사용하지만, FICO와 유사한 5대 컴포넌트 구조를 따른다.

### 7.2. 한국형 Agent Credit Score 설계 시 고려사항

```typescript
class KoreaCompliantAgentCreditScoring {
  /**
   * 한국 규제 환경에서의 특수 요구사항
   */
  constructor() {
    this.regulatoryConstraints = {
      // ① 신용정보법: 본인의 동의 없이 신용 정보 조회 금지
      requiresExplicitConsent: true,

      // ② 개인정보보호법: 결제 데이터는 PII로 분류
      anonymizePaymentData: true,

      // ③ AI 기본법 (2026.01 시행): AI 의사결정의 설명 가능성
      requiresExplainability: true,

      // ④ 전자금융거래법: AI 자동 결제에 대한 사용자 통지 의무
      requiresUserNotificationOnAutoDecision: true
    };
  }

  /**
   * Explainable AI 요구사항 충족
   * 신용 점수가 낮을 때, **왜** 낮은지 설명할 수 있어야 함.
   */
  explainScore(agentId: string): ScoreExplanation {
    const score = this.calculateScore(agentId);

    // 컴포넌트별 기여도와 가중치를 함께 보여줌
    return {
      finalScore: score.score,
      tier: score.tier,
      components: score.components.map(c => ({
        name: c.name,
        score: c.score,
        weight: c.weight,
        contribution: c.score * c.weight,
        impact: this.getImpactLevel(c.score, c.weight),
        // 가장 큰 감점 요인을 구체적으로 설명
        reason: this.getTopContributor(c)
      })),
      recommendations: this.generateRecommendations(score),
      // ⑤ "AI가 이런 결정을 했다"는 사실 자체를 명시
      decisionSource: 'AgentCreditScoringEngine v1.0',
      explainabilityMethod: 'SHAP (SHapley Additive exPlanations)'
    };
  }

  /**
   * 점수 향상을 위한 권장 사항 생성
   */
  private generateRecommendations(score: AgentCreditScore): string[] {
    const recommendations: string[] = [];

    if (score.components.taskCompletionRate < 50) {
      recommendations.push(
        'Task Completion Rate가 낮습니다. ' +
        '결제 후 task가 성공했는지 확인하는 모니터링 로직을 추가하세요.'
      );
    }

    if (score.components.disputeRatio < 60) {
      recommendations.push(
        'Dispute Ratio가 높습니다. ' +
        'API 응답 검증 (schema, timeout)을 강화하세요.'
      );
    }

    if (score.components.budgetUtilization < 50) {
      recommendations.push(
        'Budget Utilization이 위험 수준입니다. ' +
        '한도 관리 로직을 추가하거나, 사용자 정의 한도를 상향 조정하세요.'
      );
    }

    if (score.components.behavioralStability < 60) {
      recommendations.push(
        '결제 패턴이 불안정합니다. ' +
        '비정상 결제 탐지 로직을 추가하고, 결제 전 sanity check를 도입하세요.'
      );
    }

    return recommendations;
  }
}

interface ScoreExplanation {
  finalScore: number;
  tier: AgentCreditTier;
  components: Array<{
    name: string;
    score: number;
    weight: number;
    contribution: number;
    impact: 'positive' | 'neutral' | 'negative' | 'critical';
    reason: string;
  }>;
  recommendations: string[];
  decisionSource: string;
  explainabilityMethod: string;
}
```

### 7.3. 한국 시장 진입 전략

| 시나리오 | 시점 | 설명 |
|---------|------|------|
| 1단계: PoC | 2026 Q3 | 하나의 플랫폼(예: 카카오 Agent Pay)에서만 작동 |
| 2단계: Bureau 협의 | 2026 Q4 | KCB·NICE·SCI와 데이터 공유 표준 협의 |
| 3단계: Cross-platform | 2027 Q1 | 3대 bureau 통합 점수 발행 시작 |
| 4단계: 규제 샌드박스 | 2027 Q2 | AI 기본법에 따른 explainability 의무 적용 |
| 5단계: 표준화 | 2027 Q3-Q4 | 한국형 Agent Credit Score 표준 (K-ACS) 발표 |

**예측**: 2027년 말까지 한국 에이전트 신용 시장 규모가 $50M-$100M 도달 (현재 2026년 7월 $0M). 이는 2028년 이후 본격적인 **에이전트 금융 시장**의 토대가 된다.

---

## 8. 아키텍처 다이어그램

```
┌─────────────────────────────────────────────────────────────────────┐
│                          AGENT WALLET                                │
│  ┌─────────────────────────────────────────────────────────┐        │
│  │  Pre-payment Check (Anomaly Detection)                  │        │
│  │  ├─ Amount Anomaly (z-score, baseline compare)          │        │
│  │  ├─ Merchant Anomaly (frequency, new merchant)          │        │
│  │  ├─ Velocity Anomaly (payment burst)                    │        │
│  │  └─ Prompt Injection Check                             │        │
│  └──────────────────────┬──────────────────────────────────┘        │
│                         ▼                                            │
│  ┌─────────────────────────────────────────────────────────┐        │
│  │  Dynamic Limit Enforcement (per-call / per-day / month)│        │
│  └──────────────────────┬──────────────────────────────────┘        │
│                         ▼                                            │
│  ┌─────────────────────────────────────────────────────────┐        │
│  │  x402 Payment + Receipt Generation                      │        │
│  └─────────────────────────────────────────────────────────┘        │
└─────────────────┬───────────────────────────────────────────────────┘
                  │ (every 7 days)
                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 AGENT CREDIT SCORING ENGINE                          │
│  ┌─────────────────────────────────────────────────────────┐        │
│  │  Data Aggregation Layer                                  │        │
│  │  ├─ Task History (TCR input)                            │        │
│  │  ├─ Dispute Records                                     │        │
│  │  ├─ Payment History (amount, frequency, merchants)      │        │
│  │  ├─ Complaint Records                                   │        │
│  │  └─ User-defined Limits                                 │        │
│  └──────────────────────┬──────────────────────────────────┘        │
│                         ▼                                            │
│  ┌─────────────────────────────────────────────────────────┐        │
│  │  7 Component Calculators (parallel execution)           │        │
│  │  1. TCR (25%)                                            │        │
│  │  2. Dispute Ratio (20%)                                  │        │
│  │  3. Budget Utilization (15%)                             │        │
│  │  4. Behavioral Stability (15%)                           │        │
│  │  5. Agent Tenure (10%)                                   │        │
│  │  6. Merchant Diversity (10%)                             │        │
│  │  7. Complaint Count (5%)                                 │        │
│  └──────────────────────┬──────────────────────────────────┘        │
│                         ▼                                            │
│  ┌─────────────────────────────────────────────────────────┐        │
│  │  Weighted Score → Tier (1-5) → Dynamic Limits           │        │
│  └──────────────────────┬──────────────────────────────────┘        │
│                         ▼                                            │
│  ┌─────────────────────────────────────────────────────────┐        │
│  │  Explainability Module (SHAP)                            │        │
│  │  → "왜 이 점수가 나왔는가" 설명 생성                       │        │
│  └──────────────────────┬──────────────────────────────────┘        │
│                         ▼                                            │
│  ┌─────────────────────────────────────────────────────────┐        │
│  │  Score Publishing (VC 발행)                              │        │
│  │  → Cross-platform 공유 가능하도록 W3C VC 형식              │        │
│  └─────────────────────────────────────────────────────────┘        │
└─────────────────┬───────────────────────────────────────────────────┘
                  │ (VC 공유)
                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│              CROSS-PLATFORM REPUTATION NETWORK                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │
│  │ Kakao Agent  │  │ Naver Agent  │  │ Toss Agent   │               │
│  │ Pay (KR)     │  │ Platform     │  │ Wallet (KR)  │               │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘               │
│         │                 │                  │                       │
│         └─────────────────┼──────────────────┘                       │
│                           ▼                                          │
│         ┌─────────────────────────────────────────┐                  │
│         │  Korean Agent Credit Bureau (KCB)       │                  │
│         │  - KCB, NICE, SCI 통합 점수 산출           │                  │
│         │  - 한국 신용정보법 + AI 기본법 준수         │                  │
│         │  - PII 익명화, Explainability 의무화       │                  │
│         └─────────────────────────────────────────┘                  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 9. 도전 과제와 한계

### 9.1. Cold Start 문제

새로 출시된 에이전트는 **데이터가 부족**하다. TCR, Dispute Ratio 등을 계산하려면 최소 30건 이상의 결제가 필요하다.

**현재 해결책**:
- Tenure < 30일: TCR을 50점(중립)으로 강제 설정
- Dispute Ratio: dispute가 없어도 50점
- 행동 데이터 부족 시 **conservative scoring** 적용

**미해결 문제**:
- 30건 이내의 데이터로는 정확한 신용 평가가 불가능
- 모든 신규 에이전트가 Tier 4-5로 시작하면, 정당한 신규 에이전트도 기회를 못 얻음

**향후 방향**:
- **에이전트 개발사의 평판**을 대신 사용 (에이전트 ≠ 개발사)
- Stripe Atlas나 GitHub Organization 평판을 기반으로 초기 점수 부트스트랩
- 단, "개발사가 좋으면 에이전트도 좋다"는 가정은 위험

### 9.2. Adversarial Behavior: 점수 게임

에이전트 개발자가 **신용 점수를 올리기 위해 의도적으로 행동**할 수 있다.

**예시 공격**:
1. **Cashing Out Attack**: 저가 판매자 100개에 $0.001씩 결제 → Diversity 점수 상승
2. **Friendly Task Attack**: 자기 자신의 API에 결제하고 task를 항상 성공시킴 → TCR 상승
3. **Slow Burn Attack**: 6개월간 매우 좋은 행동을 보이다가, 7개월차에 대량 결제 시도

**방어 전략**:
- 동일 agent/operator가 owner인 판매자 거래는 diversity에서 제외
- TCR은 **외부 user의 명시적 feedback**과 cross-validate
- 시계열 anomaly detection으로 sudden pattern shift 감지

### 9.3. Privacy: 결제 데이터는 민감 정보

에이전트가 어떤 API에, 얼마나, 언제 결제했는지는 **사용자의 비즈니스 정보를 드러낸다**.

**예시**:
- 사용자가 의료 AI 에이전트를 사용 → 의료 API 결제 내역이 노출되면 **사용자의 건강 상태 추론 가능**
- 사용자가 법무 AI 에이전트를 사용 → 특정 법률 API 사용 패턴이 노출되면 **법적 분쟁 추론 가능**

**해결책**:
- 신용 정보 교환 시 **k-anonymity** 적용 (최소 k개의 에이전트와 합쳐서만 노출)
- Differential Privacy 노이즈 추가
- Zero-Knowledge Proof 기반 신용 증명 (값은 모르지만 "신용 800점 이상"만 증명)

### 9.4. Cross-Jurisdiction 문제

에이전트는 국가를 초월해 활동하지만, 신용 정보는 **국가별로 다른 법**을 따른다.

| 국가 | 주요 규제 |
|------|----------|
| 한국 | 신용정보법 + AI 기본법 + 개인정보보호법 |
| 미국 | FCRA + GLBA + 주(state)별 차이 |
| EU | GDPR + AI Act + PSD3 |
| 중국 | PIPL + Cybersecurity Law |

**해결책 (불완전)**:
- 각국의 strictest rule을 따르는 글로벌 baseline 정의
- 데이터 residency 강제: 신용 정보는 발행된 국가에 저장
- Cross-border 신용 정보 교환은 별도의 treaty 필요

### 9.5. 자기참조 위험 (Self-Referential Risk)

신용 점수가 **에이전트의 행동을 바꾸고**, 바뀐 행동이 다시 점수를 바꾸는 자기참조 루프가 발생할 수 있다.

```
[1단계] 에이전트 A의 점수: 700 (Tier 3)
[2단계] 동적 한도가 낮아짐 → 에이전트는 보수적으로 행동
[3단계] 보수적 행동 → 결제 빈도 감소 → TCR 계산식에서 denominator 줄어듦
[4단계] 점수가 다시 750 또는 800으로 변동
[5단계] 한도가 다시 높아짐 → 에이전트 행동 변화
[6단계] ...
```

**해결책**:
- 점수 계산 시 **lookback window를 고정** (예: 최근 90일, 변동 X)
- 행동 변화를 score에 즉시 반영하지 않고, **lag time** 적용 (최소 7일 후 반영)

---

## 10. 결론: 에이전트 신용은 '기술'이 아니라 '신뢰 인프라'

### 10.1. 핵심 변화 요약

| 측면 | 정적 한도 (직전 글 #053) | 신용 기반 동적 한도 (본 글) |
|------|------------------------|--------------------------|
| 한도 결정 | 사용자 고정 설정 | 사용자 상한 + 신용 점수 |
| 에이전트 차별화 | 없음 (모두 동일 한도) | 신용 점수별 차등 |
| 사용자 알림 빈도 | 높음 (한도 자주 초과) | 낮음 (신뢰 에이전트는 알림 적음) |
| 이상 행동 대응 | 사후 (사기 발생 후) | 실시간 (결제 직전 차단) |
| Cross-platform | 각 플랫폼 독립 | Verifiable Credential로 공유 |

### 10.2. 백엔드 엔지니어의 준비 사항

**지금 당장**:
1. Task Completion Rate를 측정하는 로직 추가 (결제 후 task 성공 여부 추적)
2. Dispute 발생 시 자동으로 complaint record에 기록
3. 결제 데이터의 일별 집계 저장 (baseline 계산용)

**3-6개월 내**:
1. 7대 컴포넌트 계산기 구현 (위 코드를 그대로 사용 가능)
2. Real-time Anomaly Detector 통합 (결제 직전 검사)
3. Prompt Injection Detector 통합

**6-12개월 내**:
1. Cross-platform VC 발행 및 검증 시스템
2. Explainability Module (SHAP) 통합
3. 한국형 K-ACS 표준 협의 참여 (KCB, NICE, SCI와 협력)

### 10.3. 우리 팀이 얻을 인사이트

1. **에이전트 금융의 시작**: 신용 점수가 있어야 **에이전트 대출**(초과 지출분에 대한 단기 대출) 같은 금융 상품이 가능해진다. 에이전트가 신용 800점이면 $100까지 무이자 단기 대출 가능.
2. **에이전트 보험**: 신용 점수가 낮은 에이전트에 대해서는 **결제 실패 보험** 상품 설계 가능. 보험료는 신용 점수에 따라 차등.
3. **에이전트 마켓플레이스의 신뢰**: 사용자가 에이전트를 선택할 때 신용 점수가 표시되면, **선택의 비대칭성**이 사라진다.
4. **규제 샌드박스**: 한국 AI 기본법 시행(2026.01) 이후, 에이전트 신용은 **설명 가능한 AI(XAI)의 첫 번째 대규모 적용 사례**가 될 가능성이 높다.

### 10.4. 다음에 다룰 주제

다음 글(#055)에서는 **에이전트 금융 시장**으로 진입하겠다. 신용 점수 기반으로 한 **에이전트 간 P2P 대출**, **에이전트 보험**, **에이전트 투자 펀드**의 아키텍처를 다룬다. 이는 "에이전트가 돈을 빌리고, 보험에 가입하고, 다른 에이전트에 투자하는" 새로운 경제 주체의 등장을 의미한다.

---

## 참고 자료

1. **FICO Score Documentation** - https://www.fico.com/en/products/fico-score
2. **W3C Verifiable Credentials Data Model 2.0** (2025)
3. **Stripe Agent Commerce Protocol (ACP) Specification** (2026.05)
4. **Cloudflare x402 Protocol** (2026.04)
5. **한국 신용정보법** (2025.12 개정)
6. **한국 AI 기본법** (2026.01 시행)
7. **EU AI Act + GDPR** (2024-2026)
8. **OpenAI Agent Safety Best Practices** (2026.06)
9. **Anthropic Claude Agent Governance Framework** (2026.05)
10. **Chainalysis Agent Transaction Monitoring Report** (2026.06)
11. **KCB(한국신용정보원) Technical Report** (2026.02)
12. **OWASP Agentic AI Top 10 — ASI04: Agent Fraud** (2026.05)

---

*이 글은 2026년 7월 5일 기준의 정보를 바탕으로 작성되었습니다. Agent Credit Scoring은 빠르게 발전하는 분야이므로, 구체적인 구현 시점에 최신 스펙을 반드시 확인하시기 바랍니다.*