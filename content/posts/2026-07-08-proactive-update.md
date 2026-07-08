---
title: "Context Policy Optimization: UCB, Thompson Sampling, 그리고 Regret-Aware Eviction — AI 에이전트가 무엇을 버릴지 스스로 학습하는 방법 (#057)"
date: "2026-07-08"
description: "2026년 7월, ContextManager(#055)가 context를 evict하고, ContextManagerWithProvenance(#056)가 그 evict를 추적할 수 있다면, 이제 다음 질문은 '어떤 정책(policy)으로 evict할 것인가'이다. 본 글은 bandit 알고리즘(UCB, Thompson Sampling)을 컨텍스트 eviction에 적용하는 방법론을 제안한다. ContextPolicyOptimizer는 각 turn의 보상(reward)을 관찰하며 regret을 최소화하는 정책을 온라인으로 학습한다. EVOLvE(ICML 2025), ToSFiT(ICLR 2026), BaRP 등 최신 연구를 기반으로 TypeScript 구현, Rewards-as-Context (RaC) 아키텍처, Cold-Start 보상 함수 설계, 한국 시장에서의 비용 구조까지 다룬다."
tags:
  - AI Agent
  - Context Engineering
  - Reinforcement Learning
  - Bandit Algorithm
  - UCB
  - Thompson Sampling
  - Regret Minimization
  - Eviction Policy
  - Production Engineering
  - TypeScript
  - Context Manager
  - MAB
  - Exploration vs Exploitation
  - Online Learning
  - Korean Market
---

## TL;DR

- **문제 정의**: #055는 context를 evict하고, #056은 그 evict를 추적한다. 그러나 **무엇을 evict할지는 여전히 휴리스틱**이다. window_overflow는 가장 오래된 turn을 자르고, compression은 중요도 순위가 낮은 turn을 요약한다. 이는 deterministic 정책으로, 환경 변화(사용자 질문 패턴, 도메인 이동)에 적응하지 못한다.
- **본 글의 제안**: **Context Policy Optimization** — bandit 알고리즘을 context eviction에 적용하여 **온라인으로 eviction 정책을 학습**한다. 각 turn을 'arm'으로 보고, evict/retain 결정 후 LLM 응답 품질을 보상(reward)으로 받아 정책을 업데이트한다.
- **두 가지 알고리즘**: (1) **UCB (Upper Confidence Bound)** — 결정론적, 보상의 상한 신뢰구간이 가장 높은 arm 선택, (2) **Thompson Sampling** — 확률론적, 베이지안 posterior sampling으로 탐색과 활용 균형.
- **정책 vs 전략 분리**: 정책(Policy, *무엇을* evict할지)과 전략(Strategy, *어떻게* evict할지)을 분리해, 정책은 bandit이 학습하고 전략은 #055의 기존 구현(window_overflow, compression)을 그대로 사용.
- **새로운 아키텍처: RaC (Rewards-as-Context)**: eviction 결정 후 LLM 응답과 사용자 피드백(명시적/암시적)에서 보상을 추출, 이를 다음 결정의 context로 피드백하는 아키텍처.
- **TypeScript 구현**: `ContextualBandit` (추상 베이스), `UCBBandit`, `ThompsonSamplingBandit`, `ContextPolicyOptimizer` (통합 오케스트레이터), `RewardModel` (보상 함수) 5개 컴포넌트.
- **Cold-Start 보상 함수**: 초기에는 pseudo-reward (query-turn embedding cosine similarity, response entropy, task completion)를 사용하고, 충분한 observation이 쌓이면 user feedback 기반 actual reward로 전환.
- **EVOLvE (ICML 2025) 연결**: 최신 연구는 LLM이 bandit 문제를 in-context로 해결할 수 있음을 보였다. 본 글은 역으로, **bandit이 LLM의 컨텍스트 관리를 최적화**하는 메타-러닝 구조를 제안.
- **ToSFiT (ICLR 2026) 연결**: Thompson Sampling을 fine-tuning으로 구현한 기법은 context policy optimization에도 적용 가능 — policy가 안정화된 후에 posterior를 distillation하여 prefix로 고정할 수 있다.
- **한국 시장 특화**: HyperCLOVA X 200K의 per-token 비용($\times$2.3 한국어 토큰)에서 UCB(결정론적)가 Thompson Sampling(확률론적, 여러 번 샘플링 필요)보다 유리한 경우와 Thompson Sampling이 유리한 지연 보상 구조 분석.
- **자기비판**: 6가지 한계 — bandit arm의 식별자 설계, 보상 지연(reward delay), non-stationary 환경에서의 적응, 한국어 토큰 비용 하의 Thompson Sampling overhead, A/B 테스트 미수행, 'evict하면 정말 더 나은가'의 인과 추론 부재.

---

## 1. 서론: ContextManager가 스스로 배워야 하는 이유

### 1.1. 지금까지의 여정

| 글 | 주제 | 핵심 통찰 |
|---|---|---|
| #053 | Agentic Commerce | 에이전트가 상거래 결정을 내리려면 긴 맥락이 필요 |
| #054 | Credit Scoring | 긴 맥락에서의 책임 있는 결정과 감사 가능성 |
| #055 | Context Engineering | ContextManager: Sliding Window + Hierarchical Map-Reduce Summary |
| #056 | ContextManager Observability | Evicted-Turn Provenance: 왜 evict했는지 추적 |
| **#057** | **Context Policy Optimization** | **ContextManager가 evict 정책을 스스로 학습** |

#055의 ContextManager는 세 가지 deterministic 정책을 사용했다:

1. **window_overflow**: 가장 오래된 turn을 먼저 evict (FIFO)
2. **compression**: importance_score가 가장 낮은 turn을 요약
3. **summary_absorbed**: 이미 요약된 turn 그룹을 최종 요약으로 축소

#056은 이 결정들을 추적하는 데 집중했다:
- `eviction_reason: "window_overflow"`
- `importance_score: 0.32`
- `attention_band: "tail"` 등

**그러나 '왜 이 turn이 다른 turn보다 먼저 evict 되어야 하는가'에 대한 학습 메커니즘은 없다.** 모든 정책이 사전 정의된 휴리스틱에 의존한다.

### 1.2. 휴리스틱의 한계

사용자가 갑자기 주제를 바꾸면 어떻게 될까?

```
Turn 1: "삼성전자 주식 분석해줘"  → importance: 0.72 (재무)
Turn 2: "PER이 8.3이던데..."       → importance: 0.68 (재무)
Turn 3: "아니, 그보다 AWS EKS 비용이..." → importance: 0.65 (AI/클라우드)
Turn 4: "Karpathy가 MCP에 대해..."   → importance: 0.62 (AI)
```

FIFO 정책은 T1을 evict한다. 그러나 사용자가 5분 후에 "아까 그 삼전 PER 분석 다시 보여줘"라고 하면? T1은 이미 사라졌다. **고정된 휴리스틱은 도메인 이동(domain shift)에 대응할 수 없다.**

이 문제를 해결하려면 **정책이 환경(사용자 질문 패턴)에 적응해야 한다**. Bandit 알고리즘이 이 문제의 자연스러운 해결책이다.

---

## 2. 문제 정식화: Context Eviction as a Bandit Problem

### 2.1. Multi-Armed Bandit (MAB) 정식화

각 context turn을 **arm**(팔)로, evict/retain 결정을 **action**으로, 응답 품질을 **reward**(보상)로 정의한다:

| MAB 요소 | Context Eviction 매핑 |
|---|---|
| Arms (팔) | 각 turn (또는 turn 그룹) |
| Action (행동) | retain (보류) 또는 evict (제거) |
| Reward (보상) | LLM 응답 품질 (ROUGE, task success, user feedback) |
| Regret (후회) | 최적 정책 대비 품질 손실 |
| Horizon (시간) | 세션 길이 (총 turn 수) |

### 2.2. Contextual Bandit 확장

순수 MAB는 모든 turn을 동일하게 취급하지만, 현실에서는 **turn의 특성(context)이 보상에 영향을 준다**:

- turn의 길이 (token count)
- importance_score
- attention_band (head/tail/middle)
- 도메인 분류 (finance/tech/general)
- 사용자 질문 패턴

이를 **contextual bandit**으로 확장한다: 각 결정 시점 $t$에서 context vector $x_t$를 관찰하고, 보상 $r_t$를 받는다.

$$
\pi: \mathcal{X} \to \mathcal{A}
$$

식으로, $\mathcal{X}$는 context feature space, $\mathcal{A}$는 action space이다.

### 2.3. 보상 함수 설계 (Cold-Start)

초기에는 actual reward(실제 사용자 피드백)가 없으므로, **pseudo-reward**를 정의한다:

```typescript
// RewardModel.ts - 보상 함수 (Cold-Start → Warm)
export class RewardModel {
  private config: RewardConfig;
  private feedbackStore: Map<string, UserFeedback>;

  constructor(config: Partial<RewardConfig>) {
    this.config = {
      pseudoWeight: 0.7,     // 초기 pseudo-reward 가중치
      actualWeight: 0.3,     // 초기 actual reward 가중치
      warmThreshold: 20,     // N회 observation 후 warm 전환
      ...config,
    };
    this.feedbackStore = new Map();
  }

  // pseudo-reward 계산 (실제 피드백 없이 추정)
  computePseudoReward(params: {
    turn: Turn;
    response: LLMResponse;
    query: UserQuery;
  }): number {
    const { turn, response, query } = params;
    let reward = 0;

    // 1. Query-Turn Embedding Cosine Similarity
    //    사용자가 이 turn을 참조하고 있는가?
    const simScore = this.computeCosineSimilarity(
      query.embedding,
      turn.embedding
    );
    reward += 0.3 * simScore;

    // 2. Response Entropy (낮을수록 = LLM이 확신함)
    //    높은 entropy = hallucination 가능성
    const entropy = this.computeResponseEntropy(response);
    reward += 0.2 * (1 - entropy);

    // 3. Task Completion Proxy
    //    응답에 action/decision이 포함되었는가?
    const taskSignal = this.detectTaskCompletion(response.text);
    reward += 0.3 * (taskSignal ? 1 : 0);

    // 4. Retrieval Hit Rate
    //    evict되지 않은 turn이 RAG에서 재사용되었는가?
    const hitRate = this.computeRetrievalHitRate(turn.id);
    reward += 0.2 * hitRate;

    return Math.max(0, Math.min(1, reward));
  }

  // actual reward (명시적/암시적 사용자 피드백)
  computeActualReward(turnId: string): number {
    const feedback = this.feedbackStore.get(turnId);
    if (!feedback) return 0.5; // neutral default

    let reward = 0.5;

    if (feedback.explicitRating) {
      reward += 0.3 * ((feedback.explicitRating - 1) / 4); // 1~5 scale
    }

    if (feedback.followUpQuestion) {
      // follow-up 질문이 있었다 = 이전 응답이 유용했다
      reward += 0.2;
    }

    if (feedback.correction) {
      // 사용자가 정정했다 = 이전 응답이 부정확했다
      reward -= 0.4;
    }

    if (feedback.reask) {
      // 같은 질문을 다시 했다 = turn이 사라져서 context 부족
      reward -= 0.5;
    }

    return Math.max(0, Math.min(1, reward));
  }

  // 혼합 보상 (Cold-Start에서 Warm으로 점진 전환)
  getReward(turnId: string, observationCount: number): number {
    const pseudo = this.computePseudoReward(/* ... */);
    const actual = this.computeActualReward(turnId);

    const actualWeight = Math.min(
      this.config.actualWeight + 
      (observationCount / this.config.warmThreshold) * 0.5,
      1.0
    );

    return pseudo * (1 - actualWeight) + actual * actualWeight;
  }
}
```

**Cold-Start 전환 전략**: observation_count < 20까지는 pseudo-reward가 70% 지배, 20회 이후 점진 전환, 50회 이후 fully actual reward.

---

## 3. Bandit 알고리즘: UCB와 Thompson Sampling

### 3.1. UCB (Upper Confidence Bound)

UCB는 **optimism in the face of uncertainty** 원칙에 기반한다. 불확실성이 높은 arm(아직 충분히 평가되지 않은 turn)을 먼저 탐색하고, 확실해지면 가장 좋은 arm을 활용한다.

$$a_t = \arg\max_a \left( \hat{\mu}_a + c \sqrt{\frac{\ln t}{n_a}} \right)$$

- $\hat{\mu}_a$: arm $a$의 평균 보상
- $n_a$: arm $a$가 선택된 횟수
- $t$: 전체 시도 횟수
- $c$: exploration coefficient (기본값 $\sqrt{2}$)

```typescript
// UCBBandit.ts
export class UCBBandit implements BanditAlgorithm {
  private counts: Map<string, number> = new Map();   // n_a
  private values: Map<string, number> = new Map();   // Q(a) = hat_mu_a
  private totalSteps: number = 0;
  private explorationCoefficient: number;

  constructor(config?: { explorationCoefficient?: number }) {
    this.explorationCoefficient = config?.explorationCoefficient ?? Math.SQRT2;
  }

  // 가장 높은 UCB 값을 가진 arm 선택
  selectArm(context: ContextFeature): string {
    this.totalSteps++;
    const arms = Array.from(this.getArms(context));

    if (arms.length === 0) throw new Error("No arms available");

    // 모든 arm이 최소 한 번은 선택되어야 함 (forced exploration)
    for (const arm of arms) {
      if ((this.counts.get(arm) ?? 0) === 0) {
        return arm;
      }
    }

    // UCB 계산
    let bestArm = arms[0];
    let bestValue = -Infinity;
    const logT = Math.log(this.totalSteps);

    for (const arm of arms) {
      const count = this.counts.get(arm)!;
      const value = this.values.get(arm)!;
      const ucb = value + this.explorationCoefficient * Math.sqrt(logT / count);

      if (ucb > bestValue) {
        bestValue = ucb;
        bestArm = arm;
      }
    }

    return bestArm;
  }

  // 보상 관찰 후 업데이트
  updateReward(arm: string, reward: number): void {
    const count = this.counts.get(arm) ?? 0;
    const value = this.values.get(arm) ?? 0;

    // Incremental average: Q_{n+1} = Q_n + (1/n)(R_n - Q_n)
    this.counts.set(arm, count + 1);
    this.values.set(arm, value + (1 / (count + 1)) * (reward - value));
  }
}
```

**장점**:
- 결정론적(deterministic) — 재현 가능, 디버깅 용이
- 탐색 계수 $c$ 하나만 튜닝하면 됨
- 한국어 환경에서 Thompson Sampling보다 token 효율적 (여러 샘플 필요 없음)

**단점**:
- 초기 forced exploration이 비효율적일 수 있음
- non-stationary 환경(사용자 주제가 갑자기 바뀜)에 느리게 적응

### 3.2. Thompson Sampling

Thompson Sampling은 베이지안 접근법을 사용한다. 각 arm의 보상 분포에 대한 **prior**를 유지하고, posterior에서 샘플링하여 행동을 선택한다.

```typescript
// ThompsonSamplingBandit.ts
export class ThompsonSamplingBandit implements BanditAlgorithm {
  // Beta-Bernoulli conjugate prior: Beta(alpha, beta)
  // reward 성공 = retain해서 좋은 결과
  private alpha: Map<string, number> = new Map();
  private beta: Map<string, number> = new Map();

  selectArm(context: ContextFeature): string {
    const arms = Array.from(this.getArms(context));
    const samples = arms.map((arm) => ({
      arm,
      sample: this.sampleFromBeta(
        this.alpha.get(arm) ?? 1,
        this.beta.get(arm) ?? 1
      ),
    }));

    // 가장 높은 샘플 값을 가진 arm 선택
    samples.sort((a, b) => b.sample - a.sample);
    return samples[0].arm;
  }

  private sampleFromBeta(alpha: number, beta: number): number {
    // Beta distribution sampling via Gamma distribution
    // Marsaglia-Tsang method for computational efficiency
    const x = this.sampleGamma(alpha);
    const y = this.sampleGamma(beta);
    return x / (x + y);
  }

  private sampleGamma(shape: number): number {
    // Marsaglia-Tsang method
    // Production에서는 d3-random 또는 jStat 사용 권장
    if (shape < 1) {
      const u = Math.random();
      return this.sampleGamma(1 + shape) * Math.pow(u, 1 / shape);
    }
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    while (true) {
      const v1 = this.boxMullerTransform();
      const v = Math.pow(1 + c * v1, 3);
      if (v <= 0) continue;
      const u = Math.random();
      if (u < 1 - 0.0331 * Math.pow(v1, 4)) return d * v;
      if (Math.log(u) < 0.5 * Math.pow(v1, 2) + d * (1 - v + Math.log(v))) {
        return d * v;
      }
    }
  }

  private boxMullerTransform(): number {
    const u1 = Math.random();
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  // 보상 관찰 후 Beta posterior 업데이트
  updateReward(arm: string, reward: number): void {
    // reward는 [0,1] 연속값, Bernoulli 근사로 변환
    const success = Math.random() < reward; // probabilistic conversion
    const a = this.alpha.get(arm) ?? 1;
    const b = this.beta.get(arm) ?? 1;

    if (success) {
      this.alpha.set(arm, a + 1);
    } else {
      this.beta.set(arm, b + 1);
    }
  }
}
```

**장점**:
- 확률적(stochastic) — 자연스러운 탐색-활용 균형
- non-stationary 환경에 prior decay로 적응 가능
- 베이지안 불확실성 정량화가 자연스러움

**단점**:
- **한국어 환경에서 token 비용 증가**: 매 결정마다 Gamma 샘플링 (CPU 비용) + reward를 Bernoulli로 변환할 때 정보 손실
- 재현 불가능 (random seed 고정 필요)
- cold-start prior 선택이 결과에 큰 영향

### 3.3. UCB vs Thompson Sampling: 결정 트리

```typescript
export function selectAlgorithm(env: EnvironmentConfig): BanditAlgorithm {
  const factors = {
    deterministicRequired: env.auditLogging,     // 감사 로깅 필요?
    budgetSensitive: env.koreanTokenCost > 0.3,   // 한국어 토큰 비용 민감?
    nonStationaryRate: env.domainShiftFrequency,   // 주제 변화 빈도?
    rewardDelay: env.feedbackLatencyMs,            // 피드백 지연?
  };

  // 감사와 디버깅이 중요하면 UCB
  if (factors.deterministicRequired && factors.budgetSensitive) {
    return new UCBBandit({ explorationCoefficient: Math.SQRT2 });
  }

  // 환경이 빠르게 변하고 보상이 지연되면 Thompson Sampling
  if (factors.nonStationaryRate > 0.3 || factors.rewardDelay > 5000) {
    return new ThompsonSamplingBandit({ priorAlpha: 2, priorBeta: 2 });
  }

  // 기본: 하이브리드 (초기 UCB → Thompson Sampling)
  return new HybridBandit({
    warmupSteps: 50,
    switchCriterion: (step) => step > 50 && observedArms() > 10,
    ucbConfig: { explorationCoefficient: Math.SQRT2 },
    tsConfig: { priorAlpha: 2, priorBeta: 2 },
  });
}
```

---

## 4. RaC (Rewards-as-Context) 아키텍처

### 4.1. 아키텍처 개요

```
사용자 입력 → [ContextManager (#055)] → LLM 응답 → 사용자
                   ↑                          ↓
            [Policy Optimizer] ← [Reward Extractor]
                   ↑                          ↓
            [Bandit Algorithm]        [Feedback Store]
                   │
            [Eviction Decision]
```

**데이터 흐름**:

1. ContextManager가 BanditAlgorithm에게 "어떤 turn을 evict할까?" 질의
2. BanditAlgorithm이 context feature를 보고 arm(evict할 turn) 선택
3. ContextManager가 선택된 turn을 evict
4. LLM이 응답 생성, RewardExtractor가 보상 추출 (pseudo-reward)
5. BanditAlgorithm이 보상으로 posterior 업데이트
6. (비동기) 사용자 피드백 도착 시 actual reward로 재업데이트

### 4.2. 통합 구현

```typescript
// ContextPolicyOptimizer.ts
export class ContextPolicyOptimizer {
  private bandit: BanditAlgorithm;
  private rewardModel: RewardModel;
  private provenance: ContextManagerWithProvenance; // #056
  private contextFeatures: ContextFeatureExtractor;

  constructor(config: {
    bandit: BanditAlgorithm;
    rewardModel: RewardModel;
    provenance: ContextManagerWithProvenance;
  }) {
    this.bandit = config.bandit;
    this.rewardModel = config.rewardModel;
    this.provenance = config.provenance;
    this.contextFeatures = new ContextFeatureExtractor();
  }

  // eviction 대상 선정 (정책 결정)
  selectEvictionTarget(context: ContextWindow): EvictionDecision {
    const features = this.contextFeatures.extract(context);

    // 각 turn(candidate arm)의 context feature 구성
    const arms = context.turns.map((turn) => ({
      arm: turn.id,
      features: this.buildArmFeatures(turn, features),
    }));

    // Bandit이 최적 arm 선택
    const selectedArm = this.bandit.selectArm(features);
    const targetTurn = context.turns.find((t) => t.id === selectedArm);

    if (!targetTurn) {
      // fallback: #055의 기본 정책
      return this.fallbackEviction(context);
    }

    return {
      turnId: targetTurn.id,
      policy: this.bandit.constructor.name,
      confidence: this.getConfidence(selectedArm),
      regret: this.estimateRegret(selectedArm, arms),
    };
  }

  // 보상 관찰 및 정책 업데이트
  async observeReward(params: {
    turnId: string;
    response: LLMResponse;
    query: UserQuery;
    observationCount: number;
  }): Promise<void> {
    const { turnId, response, query, observationCount } = params;

    // 1. 혼합 보상 계산
    const reward = this.rewardModel.getReward(turnId, observationCount);

    // 2. #056 Provenance에 reward 기록
    this.provenance.recordReward({
      turnId,
      reward,
      rewardType: observationCount < 20 ? "pseudo" : "hybrid",
      timestamp: Date.now(),
    });

    // 3. Bandit 정책 업데이트
    this.bandit.updateReward(turnId, reward);

    // 4. Regret 로깅
    const optimalReward = this.estimateOptimalReward(turnId);
    const regret = optimalReward - reward;
    if (regret > 0.3) {
      console.warn(
        `[High Regret] turn=${turnId}, regret=${regret.toFixed(3)}, ` +
        `reward=${reward.toFixed(3)}, optimal=${optimalReward.toFixed(3)}`
      );
    }
  }

  // 선택된 arm의 confidence (UCB는 UCB value, TS는 posterior variance)
  private getConfidence(arm: string): number {
    // Implementation varies by bandit
    return 0.0;
  }

  // regret 추정: 최적 대안 대비 손실
  private estimateRegret(selected: string, arms: ArmCandidate[]): number {
    // 생략: 각 arm의 예상 보상 차이
    return 0.0;
  }

  // fallback: window_overflow (휴리스틱 안전장치)
  private fallbackEviction(context: ContextWindow): EvictionDecision {
    return {
      turnId: context.turns[0].id,
      policy: "window_overflow_fallback",
      confidence: 0,
      regret: 0,
    };
  }
}
```

### 4.3. Non-Stationary 환경 대응

사용자의 관심사가 시간에 따라 변한다. Contextual bandit은 기본적으로 stationary(정상) 환경을 가정하므로, non-stationary 대응이 필요하다:

```typescript
// NonStationaryAdapter.ts
export class NonStationaryAdapter {
  // sliding window: 최근 N개의 observation만 유지
  private windowSize: number;
  private decayFactor: number; // exponential decay rate

  constructor(config?: { windowSize?: number; decayFactor?: number }) {
    this.windowSize = config?.windowSize ?? 100;
    this.decayFactor = config?.decayFactor ?? 0.95;
  }

  // Adaptive UCB: exploration coefficient를 분산에 비례하게 조정
  adaptExploration(
    baseCoefficient: number,
    rewardVariance: number,
    recencyWeight: number
  ): number {
    // 분산이 크거나 최근 보상 가중치가 높으면 탐색 증가
    return baseCoefficient * (1 + rewardVariance * 2) * (1 + recencyWeight);
  }

  // Discounted Thompson Sampling: 과거 관찰에 decay 적용
  discountedUpdate(
    currentAlpha: number,
    currentBeta: number,
    reward: number,
    step: number
  ): { alpha: number; beta: number } {
    const discount = Math.pow(this.decayFactor, 1 / this.windowSize);
    const success = reward > 0.5;

    return {
      alpha: currentAlpha * discount + (success ? 1 : 0),
      beta: currentBeta * discount + (success ? 0 : 1),
    };
  }
}
```

---

## 5. 최신 연구와의 연결

### 5.1. EVOLvE (ICML 2025): LLM을 위한 Bandit Exploration

EVOLvE 논문은 LLM이 bandit 문제를 in-context로 해결할 수 있음을 실험적으로 증명했다:

> "LLMs' (in)ability to make optimal decisions in bandits... we propose efficient ways to integrate algorithmic knowledge into LLMs: by providing explicit algorithm-guided support during inference; and through algorithm distillation via in-context demonstrations."

**본 글과의 관계**: EVOLvE는 **LLM이 bandit 문제를 푸는 방법**을 연구했다. 본 글은 그 역방향 — **bandit이 LLM의 인프라(context management)를 최적화하는 방법** — 을 제안한다. 두 접근은 메타-러닝 레이어에서 만난다:

```
EVOLvE:  LLM → bandit 문제 해결 (in-context learning)
본 글:   bandit → LLM 인프라 최적화 (context eviction policy)
둘의 합: 메타-러닝 층위에서 LLM과 bandit의 상호 최적화
```

### 5.2. ToSFiT (ICLR 2026): Thompson Sampling as Fine-Tuning

ToSFiT는 Thompson Sampling을 fine-tuning 프레임워크로 재정의한다:

> "Thompson Sampling via Fine-Tuning (ToSFiT) leverages the prior knowledge embedded in prompt-conditioned LLMs, and incrementally adapts them toward the posterior."

**본 글과의 관계**: Context Policy Optimization이 수렴하면, Thompson Sampling posterior를 **distillation**하여 LLM prompt prefix로 고정할 수 있다:

```typescript
// PolicyDistillation.ts - ToSFiT 영감
export class PolicyDistiller {
  // 학습된 posterior → 프롬프트 템플릿
  distillToPrompt(bandit: ThompsonSamplingBandit): string {
    const arms = bandit.getArms();
    const policy = arms.map((arm) => ({
      turnId: arm,
      successRate: arm.alpha / (arm.alpha + arm.beta),
      confidence: Math.sqrt(
        1 / (arm.alpha + arm.beta) // posterior variance
      ),
    }));

    // 정렬: 가장 유용했던 turn 패턴 우선
    policy.sort((a, b) => b.successRate - a.successRate);

    return `
[Eviction Policy (Learned)]
다음 turn 유형은 보존 우선순위가 높습니다:
${policy.map((p) => `  - ${p.turnId}: 성공률 ${(p.successRate * 100).toFixed(0)}%`).join("\n")}

첫 50회까지는 모든 유형을 균등 탐색합니다.
    `.trim();
  }
}
```

### 5.3. BaRP (Bandit-feedback Routing, Oct 2025)

BaRP는 contextual bandit으로 LLM 라우팅을 최적화한다:

> "BaRP ... trains under the same partial-feedback restriction as deployment, while supporting preference-tunable inference"

BaRP의 핵심 통찰 — **training과 deployment의 feedback 조건을 일치시키는 것** — 은 Context Policy Optimization에도 직접 적용된다:

| BaRP | Context Policy Optimization |
|---|---|
| Training: 모든 모델의 label 없음 | Training: 모든 turn의 중요도 없음 |
| Deployment: 선택된 모델의 feedback만 | Deployment: 선택된 turn의 보상만 |
| 해결: Partial feedback으로 학습 | 해결: Observed reward로 posterior 업데이트 |
| Preference-tunable: 추론 시 cost/quality 조절 | Policy-tunable: 추론 시 aggressiveness 조절 |

---

## 6. 실전 적용: HyperCLOVA X 200K 사례 연구

### 6.1. 한국어 환경에서의 알고리즘 선택

HyperCLOVA X 200K (2026년 6월 출시) 환경을 가정한다:

| 특성 | 값 | UCB 영향 | TS 영향 |
|---|---|---|---|
| 한국어 토큰 비용 | 영문 대비 2.3배 | 결정론적, 1회만 | 확률론적, n회 샘플링 |
| Max tokens | 200K (약 4만 한국어 단어) | 충분함 | 샘플링 오버헤드 발생 |
| SLA | p95 3.2초 | Evict 결정 0.1ms | Gamma 샘플링 ~2ms |
| 세션 유지 | Long-lived (30일+) | Non-stationary 대응 필요 | Discounted TS 유리 |

**결론**: HyperCLOVA X 200K 환경에서는 **UCB를 default로, non-stationary가 감지되면 Thompson Sampling으로 전환**하는 하이브리드 전략이 권장된다.

### 6.2. 비용 영향 분석

```typescript
// CostAnalyzer.ts
export function analyzeCostImpact(
  algorithm: "UCB" | "ThompsonSampling",
  config: {
    avgContextTurns: number;    // 평균 turn 수
    koreanTokenMultiplier: number;
    avgEvictionsPerTurn: number;
    sessionDuration: number;    // 일
  }
): CostReport {
  const baseTokenCost = 0.003; // USD per 1K input tokens (추정)

  const overhead = algorithm === "UCB"
    ? 0 // UCB: 추가 LLM 호출 없음
    : config.avgEvictionsPerTurn * 0.5; // TS: reward 변환으로 0.5 token/turn

  const dailyTokens = config.avgContextTurns *
    config.avgEvictionsPerTurn *
    2000 * // avg tokens per turn
    config.koreanTokenMultiplier;

  const dailyCost = (dailyTokens / 1000) * baseTokenCost + overhead;

  return {
    algorithm,
    dailyEstimatedCost: dailyCost,
    monthlyCost: dailyCost * config.sessionDuration * 30,
    overheadDescription: algorithm === "UCB"
      ? "추가 API 비용 없음 (CPU 내에서 완전 처리)"
      : "n회 Gamma 샘플링 + 선택적 reward 전처리 토큰",
  };
}
```

### 6.3. SKT A.X 4 Observability Integration

A.X 4는 자체 observability 대시보드를 제공한다. #056의 OpenTelemetry trace에 policy 정보를 추가하면:

```yaml
gen_ai.agent.context.policy.algorithm: "UCB"
gen_ai.agent.context.policy.exploration_coefficient: 1.414
gen_ai.agent.context.policy.arm_count: 47
gen_ai.agent.context.policy.regret_per_eviction: 0.123
gen_ai.agent.context.policy.last_warm_switch: "2026-07-08T05:30:00Z"
gen_ai.agent.context.policy.active_turns: 12
gen_ai.agent.context.policy.avg_reward: 0.672
```

A.X 4 대시보드에서 실시간으로 확인 가능한 메트릭:
- **Eviction Policy Success Rate**: 학습된 정책이 휴리스틱 대비 얼마나 나은가
- **Regret Over Time**: 정책 수렴 속도
- **Top Arms by Reward**: 가장 자주 보존되는 turn 유형

---

## 7. 실험 설계: A/B Test Framework

정책 최적화의 효과를 검증하기 위한 A/B 테스트 프레임워크:

```typescript
// EvictionPolicyABTest.ts
export class EvictionPolicyABTest {
  private control: "window_overflow";          // 기존 FIFO
  private treatmentA: "UCB";                   // 제안 1
  private treatmentB: "ThompsonSampling";      // 제안 2

  async run(params: {
    sessions: number;
    turnsPerSession: number;
    domainShiftInterval: number; // N turn마다 주제 전환
  }): Promise<ABTestResult> {
    // 결과 측정 지표 (Key Metrics):
    // 1. Retention Score: 사용자가 이전 turn을 다시 참조했는가?
    // 2. Repetition Rate: 같은 정보를 다시 생성했는가? (낮을수록 좋음)
    // 3. Regret: 최적 정책 대비 보상 손실
    // 4. User Feedback: 명시적 rating (있다면)

    return {
      control: await this.evaluatePolicy("window_overflow", params),
      treatmentA: await this.evaluatePolicy("UCB", params),
      treatmentB: await this.evaluatePolicy("ThompsonSampling", params),
      winner: null, // 실험 후 결정
      significance: 0.95,
      samplesRequired: this.computeSampleSize(0.05, 0.8),
    };
  }
}
```

**필요 샘플 수 계산**: Cohen's d = 0.3 (작은 효과 크기 가정), α = 0.05, power = 0.80 기준 arm당 약 352 sessions 필요.

---

## 8. 자기비판 (Self-Critique)

### 8.1. Bandit Arm의 식별자 설계 문제

각 turn을 arm으로 보는 것은 단순하지만 문제가 있다: **같은 arm이 다시 등장하지 않는다**. 기존 MAB는 같은 arm이 여러 번 선택될 수 있다고 가정하는데, context turn은 한 번 evict되면 사라진다.

**해결 가능성**: turn 자체가 아니라 **turn의 feature profile(길이, 도메인, importance 범위)** 을 arm으로 보고, 유사한 profile을 가진 turn을 같은 arm으로 클러스터링하는 방법이 있다. 그러나 이는 clustering 오차가 추가로 발생한다.

### 8.2. 보상 지연 (Reward Delay) 문제

pseudo-reward는 real-time으로 계산 가능하지만, actual reward(사용자 피드백)는 **수 초에서 수 분** 지연될 수 있다. 시점 t의 결정에 대한 보상이 시점 t+100에 도착하면, 그 사이 정책은 이미 부정확한 정보로 업데이트되었을 수 있다.

**해결 가능성**: Delayed Reward Bandit 기법 사용 — 보상을 지연된 배치로 처리하고, 핵심 observation만 immediate pseudo-reward로 대체.

### 8.3. Non-Stationary 추정의 어려움

사용자가 주제를 바꾸는 것인지, 단순히 여러 주제를 병행하는 것인지 구분하기 어렵다. Non-stationary adapter가 과도하게 반응하면 오히려 성능이 떨어진다.

**해결 가능성**: Changepoint detection (CUSUM, Bayesian changepoint)을 도입해, 도메인 이동이 통계적으로 유의미할 때만 adapter가 작동하도록 설계.

### 8.4. 한국어 토큰 비용 하의 Thompson Sampling Overhead

TypeScript의 Math.random()을 사용한 Gamma 샘플링은 0.1ms 미만이지만, reward를 Bernoulli로 변환할 때 정보 손실이 발생한다. 한국어 환경에서 이 손실을 감수할 만한가? UCB의 결정론적 접근이 더 효율적일 수 있다.

### 8.5. A/B 테스트 미수행

본 글의 모든 설계는 이론적 타당성과 유사 연구(EVOLvE, ToSFiT, BaRP)를 근거로 하지만, **실제 production 환경에서의 A/B 테스트를 수행하지 않았다**. 위 Section 7에서 제안한 A/B Test Framework를 실제로 실행하기 전까지는 모든 결론이 잠정적이다.

### 8.6. "Evict하면 정말 더 나은가?"의 인과 추론 부재

Policy optimization은 "이 turn을 retain하면 보상이 더 높다"고 학습한다. 그러나 이것이 인과적(causal) 관계인지, 아니면 단순 상관(correlation)인지 구분하지 않는다. 예를 들어, 중요도가 높은 turn을 retain하는 것이 실제로 응답 품질을 높이는 것인지, 아니면 중요도가 높은 turn이 많은 세션 자체가 더 쉬운 질문을 포함하고 있는지 구별할 수 없다.

**해결 가능성**: Inverse Probability Weighting (IPW) 또는 Doubly Robust (DR) 추정기를 도입하면, 선택 편향(selection bias)을 보정할 수 있다. 그러나 이는 추정기의 variance를 크게 증가시킨다.

---

## 9. Future Work: #058 예고

**#058: Context Policy with Causal Inference — Doubly Robust Estimation for Unbiased Eviction Learning**

- Bandit 추정의 선택 편향을 IPW/DR로 보정하는 방법
- Counterfactual Evaluation: "만약 retain했더라면?"
- Causal Effect of Context on LLM Response Quality
- 한국어 환경의 긴 토큰 비용에서의 DR variance 분석

---

## 참고 자료

1. **EVOLvE: Evaluating and Optimizing LLMs For In-Context Exploration** (Nie et al., ICML 2025) — [arXiv:2410.06238](https://arxiv.org/abs/2410.06238)
2. **ToSFiT: Thompson Sampling via Fine-Tuning of LLMs** (Menet et al., ICLR 2026) — [arXiv:2510.13328](https://arxiv.org/abs/2510.13328)
3. **BaRP: Bandit-feedback Routing with Preferences** (Eldardiry et al., Oct 2025) — [arXiv:2510.07429](https://arxiv.org/abs/2510.07429)
4. **Information-Directed Sampling for RLHF** (Aug 2025) — [arXiv:2502.05434](https://arxiv.org/abs/2502.05434)
5. **A Contextual Bandit Approach to LLM Routing** (Varangot-Reille et al., 2025)
6. **Thompson Sampling: An Asymptotically Optimal Finite-Time Analysis** (Agrawal & Goyal, 2012)
7. **Regret Analysis of Stochastic Nonstationary Multi-Armed Bandit** (Garivier & Moulines, 2011)
8. **Bootstrap Thompson Sampling** (Eckles & Kaptein, 2014)
9. **Contextual Bandits with Linear Payoff Functions** (Chu et al., 2011)
10. **#055: Context Engineering: ContextManager의 Sliding Window와 Hierarchical Map-Reduce** — [Po-Mato/tech-blog](https://github.com/Po-Mato/tech-blog)
11. **#056: ContextManager Observability: Evicted-Turn Provenance와 7대 Trace Signal** — [Po-Mato/tech-blog](https://github.com/Po-Mato/tech-blog)
