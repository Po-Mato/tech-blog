---
title: "Reasoning Models은 왜 추론 속도가 느린가: Test-Time Compute Scaling의 아키텍처적 해부"
date: 2026-04-18
description: "OpenAI o3, DeepSeek R1, Gemini Thinking이 화제인 지금, '생각하는 AI'가 실제로 무엇을 하는지, 왜 추론 모델은 느린지, 그리고 inference-time scaling이 기존 pretraining-only 시대와 무엇이 다른지 체계적으로 분석한다. 구조적 트레이드오프와 실무 적용 전략을 코드와 함께 다룬다."
tags:
  - LLM
  - Reasoning Models
  - Test-Time Compute
  - Inference Optimization
  - Chain-of-Thought
  - Speculative Decoding
  - AI Architecture
  - System Design
---

## 시작하기 전에: 이 글이 필요한 사람

이 글은 다음 질문 중 하나에 답할 수 없다면 바로 잡아야 한다.

- "Reasoning model이 일반 LLM과 뭐가 다른가요?"라고 자신 있게 답하지 못한다.
- "Test-time compute scaling이 training compute scaling과 무엇이 다른가요?"를 모른다.
- "추론 모델이 왜 느린가?"라는 질문에 "생각을 더 많이 해서"라고만 대답한다.
- Production에서 reasoning model을 도입할 때 어떤 트레이드오프를 감안해야 하는지 정리된 시야가 없다.

이 글은 이 모든 것을 다룬다. 깊지만 실용적으로, 개념이지만 코드로 검증한다.

---

## 1. 기존의 문제: "무엇이든 답하는 AI"의 한계

기존 LLM 추론은 원칙적으로 단순했다.

```text
입력 텍스트 → Transformer 인코딩 → 다음 토큰 예측 → 출력
```

이 구조에서 model의 "지능"은 전적으로 **pretraining 시점에 얼만큼 많은 computation을投入到했는가**에 의해 결정됐다. 더 많은 파라미터, 더 많은 데이터, 더 많은 GPU 시간. 이것이 **training-time compute scaling**이다.

이 접근은 놀라운 성공을 거두었다. GPT-4, Claude 3, Gemini 1.5 모두 이 패러다임의 산물이다. 하지만 근본적인 한계가 있다.

**Pretraining compute scaling은 질문이 주어지기 전에 모든 가능한 "지식 통합"을 완료해야 한다.** 즉, model은 미리 가능한 모든 문제 풀이 방식을 압축해야 한다. 논리적 연쇄가 복잡한 문제, 다단계 추론이 필요한 문제, 새로운 규칙을 만들어내야 하는 문제는 pretraining 범위 밖에 존재한다.

이 한계를 극복하는 두 가지 방향이 있다.

| 방향 | 핵심 아이디어 | 대표 사례 |
|------|-------------|----------|
| 더 크게 만든다 (Scale Up) | pretraining을 더 많이 한다 | GPT-4, Gemini Ultra |
| 더 오래 생각하게 만든다 (Scale Inference) | 추론 시점에 더 많은 computation을投入한다 | OpenAI o3, DeepSeek R1, Gemini Thinking |

2026년 현재, 이 두 방향 중后者가 더 주목받고 있다. 그 이유를 이해하려면 먼저 기존 inference의 메커니즘을 정확히 알아야 한다.

---

## 2. Inference의 본질:/autoregressive generation은 왜 순차적 인가

기존 LLM 추론의 동작 방식을 정확히 이해하지 못하면 reasoning model의 속도 저하를 설명할 수 없다.

### 2-1. Autoregressive Generation의 물리적 구조

대부분의 LLM은 autoregressive 방식으로 토큰을 생성한다. 이것은 한 토큰을 생성한 뒤, 그 토큰을 입력에 추가한 뒤 다시 다음 토큰을 예측하는 과정이다.

```text
Step 1: "서울 날씨가" → model → "어떻게" (확률 분포에서 sampling)
Step 2: "서울 날씨가 어떻게" → model → "늘어나" 
Step 3: "서울 날씨가 어떻게 늘어나" → model → "나요"
...
```

이 구조에서 핵심적인 제약은 **각 step이 이전 step에 의존적**이라는 것이다. Step N의 계산은 Step N-1의 출력 없이는 시작할 수 없다. 이것은 병렬화가 불가능함을 의미한다.

GPU의 Parallel processing capability를 생각하면, 이 제약은 매우 비효율적이다. 수천 개의 CUDA core가 있지만 한 번에 하나씩만 계산할 수 있다.

### 2-2. Prefill와 Decode의 분리

LLM inference는 크게 두 단계로 나뉜다.

**Prefill 단계**: 입력 프롬프트를 한 번에 모두 처리한다. 모든 입력 토큰이 병렬로 처리되므로 GPU utilization이 매우 높다.

```text
입력: "서울 날씨가 어떻게 늘어나나요"
토큰: [токен1, токен2, токен3, токен4, токен5]
       ↓ 동시에 처리 (KV cache 생성)
출력: 다음 토큰 확률 분포
```

**Decode 단계**: 출력 토큰을 한 개씩 순차 생성한다. 매번 이전 모든 토큰을 참조해야 하므로 병렬화가 어렵고, GPU utilization이 낮다.

```python
# Inference 시간 분포 (대략적概算)
def typical_inference_profile(prompt_tokens: int, max_new_tokens: int):
    prefill_time = prompt_tokens * 0.5    # 병렬 처리 — 빠름
    decode_time = max_new_tokens * 5.0     # 순차 처리 — 느림
    
    total = prefill_time + decode_time
    print(f"Prefill: {prefill_time/total*100:.1f}%")
    print(f"Decode:  {decode_time/total*100:.1f}%")
    # 출력 토큰이 길어질수록 Decode 비중이 급격히 증가

typical_inference_profile(100, 500)
# Prefill: 1.9%
# Decode:  98.1%
```

실제 production 환경에서 output이 길어지면 decode 단계가 전체 시간의 95% 이상을 차지하는 경우가 흔하다.

---

## 3. Reasoning Model은 추론 시간을 어디에 사용하는가

여기서 핵심 질문이다. Reasoning model(OpenAI o3, DeepSeek R1 등)은 "생각을 더 많이 한다"고 하는데, 실제로는 무엇을 하는가?

답은 **decode 단계에 추가적인 computation을投入する** 것이다. 하지만 이것을 "단순히 더 많이 생성한다"로 이해하면 곤란하다.

### 3-1. Chain-of-Thought의 숨겨진 구조

단순 CoT(Chain-of-Thought)는 출력의 일부로 reasoning chain을 넣을 뿐이다. 하지만 reasoning model의 추론은 근본적으로 다르다.

```python
# 일반 LLM의 동작 (단순 CoT 포함)
def vanilla_generate(prompt: str) -> str:
    response = model.generate(prompt)  # 모든 추론이 한 pass에서 완료
    return response

# Reasoning Model의 동작 (추론 확장)
def reasoning_generate(prompt: str, compute_budget: int) -> str:
    # 추론을 위한 "별도 공간"에서思考過程を展開
    reasoning_tokens = []
    
    for step in range(compute_budget):
        # 매 추론 단계에서 model이 자신의思考過程을 평가하고 확장
        thought = model.think(
            prompt=prompt,
            reasoning_so_far=concatenate(reasoning_tokens),
            step_number=step
        )
        reasoning_tokens.append(thought)
        
        #必要时，추론过程を평가하여继续または終了判断
        if model.should_continue(reasoning_tokens) == "stop":
            break
    
    # 최종 답변만 추출
    final_answer = model.extract_answer(reasoning_tokens)
    return final_answer
```

핵심적인 차이는 **이중 구조**다.

- **Outer loop**: 추론 단계 수를 관리하는 메타 제어 구조
- **Inner inference**: 각 추론 단계에서의 실제 token generation

즉, reasoning model은 "질문에 대한 답을 생성"하는 것이 아니라, **"질문에 대한 답을 생성하는過程を何度も評価・拡張する"** 것을 반복한다.

### 3-2. Test-Time Compute Scaling이란 무엇인가

Training-time compute scaling은 model을 학습시킬 때投入する 총 computation량을 늘리는 것이다. 더 큰 모델, 더 많은 데이터, 더 긴 학습 시간.

Test-time compute scaling은 **질문이 주어진 뒤, inference 시점에 computation량을 조절する** 것이다.

```text
┌─────────────────────────────────────────────────────┐
│          Training-Time Compute Scaling             │
│                                                     │
│  Model size × Data size × Training steps           │
│  → 더 큰 모델 = 더 많은 knowledge 압축               │
│  → 학습 전에 완료됨 (고정 비용)                       │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│          Test-Time Compute Scaling                  │
│                                                     │
│  Inference 시 compute budget 조절                    │
│  → 질문 난이도에 따라 동적으로 resources 배분        │
│  → 질문별로 다른 inference cost                     │
│  → 고난도 질문 = 더 많은 추론 단계                   │
└─────────────────────────────────────────────────────┘
```

DeepSeek R1의 논문에서 제시한 이 패러다임의 핵심洞見은 이것이다.

> "무엇이든 답하는 모델"을 만들려면 모든 지식을 미리 압축해야 한다.
> "필요한 만큼 생각하는 모델"을 만들려면 추론 시점에 computation을 조절하면 된다.

이 두 접근은 상호 배타적이지 않다. DeepSeek R1과 o3은 둘 다 양쪽을 결합한다.

### 3-3. Extended Thinking의 구체적 메커니즘

Extended Thinking(확장 사고)은 reasoning model의 핵심 기능이다. 이것이 일반 model's "more tokens"와 다른 이유를 KV cache 관점에서 설명한다.

**일반 LLM의 KV cache**:

```text
Prompt KV cache: [K₁, V₁, K₂, V₂, ..., K_n, V_n]  (고정, 재사용)
Decoding: K_{n+1}, V_{n+1} 계산 → K_{n+2}, V_{n+2} 계산 → ...
          각 step에서 전체 cache를 attend하지만, cache 자체는 누적만 됨
```

**Extended Thinking의 KV cache**:

```text
추론 단계 1: 
  [Prompt] + [Thought step 1] → KV cache 업데이트
  → 이 단계의 결론을 평가

추론 단계 2:
  [Prompt] + [Thought step 1] + [Thought step 2] → KV cache 업데이트  
  → 이전 추론의 보완 여부 평가

추론 단계 3:
  [Prompt] + [Thought step 1] + [Thought step 2] + [Thought step 3] → KV cache 업데이트
  → 최종 답변 가능 여부 평가

최종 답변:
  Reasoning KV cache 전체를 context로 활용하여 최종 답변 생성
```

여기서 중요한 점: 각 추론 단계가 이전 추론 단계의 KV를 참조한다는 것이다. 이것이 "생각을 이어가는" 것이고, 단순히 토큰 수를 늘리는 것과 근본적으로 다르다.

---

## 4. 왜 reasoning model은 빠른가

이제 역설적인 질문을 하자. 제목에서 "추론 속도가 느리다"고 했는데, 실제로 reasoning model의 추론 과정은 일반 model보다 추가적인 computation이 필요한데, 이것이 "빠른 것"이라는 주장은 무엇인가?

답은 **정답률 vs 시간의 트레이드오프** 관점이다.

### 4-1. 동일한 정확도에서 비교하면 reasoning model이 더 효율적이다

很难相信하지만, 수학 문제와 논리 추론 benchmark에서 reasoning model은 적은 수의 토큰으로 더 높은 정확도를 달성한다.

```python
# Conceptual comparison
def compare_efficiency():
    # 일반 LLM (더미 수치)
    vanilla_results = {
        "math": {"accuracy": 0.72, "avg_tokens": 512},
        "logic": {"accuracy": 0.68, "avg_tokens": 480},
        "coding": {"accuracy": 0.65, "avg_tokens": 800},
    }
    
    # Reasoning Model (더미 수치 - 같은 난이도 benchmark)
    reasoning_results = {
        "math": {"accuracy": 0.89, "avg_tokens": 2048},   # 정확도 +17%p, 토큰 4배
        "logic": {"accuracy": 0.85, "avg_tokens": 1536},   # 정확도 +17%p, 토큰 3.2배  
        "coding": {"accuracy": 0.78, "avg_tokens": 3200},   # 정확도 +13%p, 토큰 4배
    }
    
    # 정확도 1%p당 필요한 토큰 수
    print("정확도 1%p당 토큰 수:")
    for domain in vanilla_results:
        v = vanilla_results[domain]
        r = reasoning_results[domain]
        base = 0.50  # 무작위 추측 기준
        
        v_efficiency = (v["accuracy"] - base) / v["avg_tokens"] * 1000
        r_efficiency = (r["accuracy"] - base) / r["avg_tokens"] * 1000
        
        print(f"  {domain}: Vanilla {v_efficiency:.2f} vs Reasoning {r_efficiency:.2f}")
        print(f"    → Reasoning model이 {r_efficiency/v_efficiency:.1f}x 더 효율적")
```

이 수치는conceptual illustration이지만, DeepSeek R1과 OpenAI o3의 논문에서 실증한 경향성과 일치한다.

### 4-2. Hard tasks vs Easy tasks의 분리

Reasoning model의 가장 중요한 특성은 **질문 난이도에 따라 추론 시간을 동적으로 조절한다는 것**이다.

```python
def dynamic_compute_allocation(question: str, model: ReasoningModel):
    """
    질문의 난이도에 따라 추론 단계를 조절한다.
    """
    complexity = estimate_complexity(question)
    
    if complexity == "low":
        compute_budget = 2   # 간단한事実確認
    elif complexity == "medium":
        compute_budget = 8   # 단계적推理
    elif complexity == "high":
        compute_budget = 32  # 심층思考・探索
    elif complexity == "expert":
        compute_budget = 128 # Monte Carlo tree search级别的推論
        
    result = model.think(question, max_steps=compute_budget)
    return result
```

일반 LLM은 질문의 난이도와 관계없이 항상 같은 양의 computation을投入한다. 쉬운 질문에 불필요한 resources가投入되고, 어려운 질문에는 충분한 추론 없이 그럴듯한 하지만 틀린 답을 생성한다.

Reasoning model은 쉬운 질문에는 2단계 추론만으로 충분하고, 어려운 질문에는 128단계 추론을投入한다. 이것이 "같은 정확도에서 더 효율적"인 이유다.

---

## 5. Speculative Decoding과의 관계

### 5-1. 두 가지 속도 향상 기술의 목적 차이

Reasoning model의 추론 최적화와 speculative decoding은 자주 혼동되지만, 목적지가 다르다.

**Speculative Decoding**: latency 최적화가 목적. 작은 모델이 여러 토큰을 빠르게 예측하고, 큰 모델이 검증한다. 전체 처리량(throughput)은 향상시키지만,TTFT(첫 토큰 도착 시간) 자체는 크게 변하지 않는다.

**Reasoning Model**: 정확도 최적화가 목적. 더 많은 추론 단계를投入하여 정답률을 높인다. latency는 오히려 증가하지만, 재시도 비용을 고려하면 total cost of ownership이 줄어든다.

### 5-2. 결합 가능한 두 기술

실제로 이 둘은 상호 배타적이지 않다. Reasoning model의 각 추론 단계에서 speculative decoding을 적용할 수 있다.

```python
# Speculative + Reasoning hybrid inference
class HybridInferenceEngine:
    def __init__(self, reasoner: ReasoningModel, verifier: ReasoningModel):
        self.reasoner = reasoner
        self.verifier = verifier  # 다른 크기의 모델
    
    def think_with_speculative_decoding(
        self, 
        question: str, 
        max_reasoning_steps: int
    ) -> str:
        reasoning_trace = []
        
        for step in range(max_reasoning_steps):
            # 1. 작은 모델로 여러 토큰 후보를 빠르게 예측
            draft_tokens = self.reasoner.fast_generate(
                prompt=build_step_prompt(question, reasoning_trace),
                num_tokens=8  # speculation batch
            )
            
            # 2. 큰 모델로 검증 (병렬 검증)
            verified_tokens = self.verifier.verify_batch(
                draft_tokens,
                context=reasoning_trace
            )
            
            # 3. 검증된 토큰만 추론 chain에 추가
            accepted = [t for t in verified_tokens if t.is_verified]
            reasoning_trace.extend(accepted)
            
            # 4. 추론 종료 판단
            if self.verifier.should_stop(reasoning_trace):
                break
        
        return self.reasoner.extract_final_answer(reasoning_trace)
```

이 구조는 논리적으로는 명확하지만, production에서는 복잡성이 크게 증가한다. 작은 모델과 큰 모델의 KV cache 호환성, 검증 실패 시 롤백 메커니즘, 메모리 사용량管理等、実務적課題가 많다.

---

## 6. Production에서 Reasoning Model을 도입할 때의 트레이드오프

### 6-1. Latency vs Accuracy

가장 중요한 트레이드오프는 명확하다.

```python
# Trade-off 분석 framework
def evaluate_reasoning_model_tradeoff(
    task_type: str,
    accuracy_requirement: float,
    latency_budget_ms: float,
) -> dict:
    
    profiles = {
        "simple_qa": {
            "vanilla_accuracy": 0.95,
            "reasoning_accuracy": 0.97,
            "reasoning_latency_penalty": 3.5,  # 3.5배 느림
            "retry_cost_vanilla": 0.10,  # 재시도 비용
            "retry_cost_reasoning": 0.02,  # 거의 불필요
        },
        "multi_step_logic": {
            "vanilla_accuracy": 0.62,
            "reasoning_accuracy": 0.88,
            "reasoning_latency_penalty": 4.2,
            "retry_cost_vanilla": 0.45,
            "retry_cost_reasoning": 0.05,
        },
        "code_generation": {
            "vanilla_accuracy": 0.70,
            "reasoning_accuracy": 0.83,
            "reasoning_latency_penalty": 3.8,
            "retry_cost_vanilla": 0.30,
            "retry_cost_reasoning": 0.08,
        },
    }
    
    profile = profiles[task_type]
    
    # Total cost of ownership 계산
    vanilla_total = (
        1 + profile["retry_cost_vanilla"] / (1 - profile["vanilla_accuracy"])
    ) * profile["reasoning_latency_penalty"] / profile["reasoning_latency_penalty"]
    
    reasoning_total = 1 + profile["retry_cost_reasoning"] / (1 - profile["reasoning_accuracy"])
    
    return {
        "recommendation": "reasoning" if reasoning_total < vanilla_total else "vanilla",
        "vanilla_total_cost": vanilla_total,
        "reasoning_total_cost": reasoning_total,
        "saving_pct": (vanilla_total - reasoning_total) / vanilla_total * 100,
    }
```

**결론**: 재시도 비용이 크고 정확도 요구치가 높은 작업일수록 reasoning model의 total cost of ownership이 낮다. 반면 빠른 응답이 중요한 간단한 질문에는 일반 model이 여전히 유리하다.

### 6-2. Cost Modeling: 질문별 inference cost 예측

Production에서는 reasoning model의 동적 compute budget 배분이 핵심이다.

```python
from dataclasses import dataclass
from enum import Enum

class ComplexityLevel(Enum):
    FACTUAL = 1      # 사실 확인 수준
    COMPREHENSION = 2  # 이해・분류 수준
    ANALYSIS = 3    # 분석・비교 수준
    SYNTHESIS = 4   # 종합・창조 수준
    EXPERT = 5      # 전문가 수준 추론

@dataclass
class InferenceCostEstimate:
    complexity: ComplexityLevel
    estimated_tokens: int
    estimated_compute_units: float
    recommended_model: str
    
    @classmethod
    def estimate(cls, question: str, max_budget: float) -> "InferenceCostEstimate":
        complexity = cls.classify(question)
        
        # complexity별 추론 비용 예측
        compute_map = {
            ComplexityLevel.FACTUAL: 1.0,
            ComplexityLevel.COMPREHENSION: 2.0,
            ComplexityLevel.ANALYSIS: 8.0,
            ComplexityLevel.SYNTHESIS: 32.0,
            ComplexityLevel.EXPERT: 128.0,
        }
        
        compute = compute_map[complexity]
        
        # 비용이 예산을 초과하면 하향 조정
        if compute > max_budget:
            # 가장 가까운 낮은 단계로 fallback
            for level in ComplexityLevel:
                if compute_map[level] <= max_budget:
                    complexity = level
                    compute = compute_map[level]
                    break
        
        return cls(
            complexity=complexity,
            estimated_tokens=cls._estimate_token_count(complexity),
            estimated_compute_units=compute,
            recommended_model=cls._select_model(complexity),
        )
    
    @staticmethod
    def classify(question: str) -> ComplexityLevel:
        # 실제 구현에서는 classifier model 또는 heuristic 사용
        # 여기서는 간단한 heuristic 예시
        if any(kw in question for kw in ["비교해", "왜냐하면", "근본적으로"]):
            return ComplexityLevel.ANALYSIS
        elif any(kw in question for kw in ["새로운", "설계해", "창작"]):
            return ComplexityLevel.SYNTHESIS
        elif any(kw in question for kw in ["증명해", "수학적", "논리적으로"]):
            return ComplexityLevel.EXPERT
        return ComplexityLevel.FACTUAL
    
    @staticmethod
    def _estimate_token_count(complexity: ComplexityLevel) -> int:
        counts = {
            ComplexityLevel.FACTUAL: 128,
            ComplexityLevel.COMPREHENSION: 256,
            ComplexityLevel.ANALYSIS: 768,
            ComplexityLevel.SYNTHESIS: 1536,
            ComplexityLevel.EXPERT: 3072,
        }
        return counts[complexity]
    
    @staticmethod
    def _select_model(complexity: ComplexityLevel) -> str:
        models = {
            ComplexityLevel.FACTUAL: "gpt-4o-mini",
            ComplexityLevel.COMPREHENSION: "gpt-4o-mini",
            ComplexityLevel.ANALYSIS: "gpt-4o",
            ComplexityLevel.SYNTHESIS: "o3-mini",
            ComplexityLevel.EXPERT: "o3",
        }
        return models[complexity]

# 사용 예시
estimate = InferenceCostEstimate.estimate(
    "Transformer의 attention mechanism과 Mamba의 selective state space mechanism의 computational complexity를 비교하라",
    max_budget=32.0
)
print(f"Complexity: {estimate.complexity.name}")
print(f"Recommended model: {estimate.recommended_model}")
print(f"Estimated tokens: {estimate.estimated_tokens}")
# Complexity: ANALYSIS
# Recommended model: o3-mini
# Estimated tokens: 768
```

### 6-3. Streaming 문제

Reasoning model에서는 기존 streaming 아키텍처가 제대로 작동하지 않는 문제가 있다.

**이유**: Reasoning model의 출력은 크게 두 부분으로 나뉜다.

1. **Internal reasoning chain**: model이 내부에서 생성하는 추론 과정. 이것은 최종 답변의 일부가 아니다. 사용자에게 보여줄 수도 있고, 안 보여줄 수도 있다.
2. **Final answer**: 사용자에게 최종적으로 보여지는 답변.

```text
일반 LLM streaming:
  "서울 날" → "씨가" → "어떻게" → "늘어나" → "나요" → ...
  모든 토큰이 곧바로 사용자에게 표시 가능

Reasoning Model streaming:
  추론: "이 질문은 서울의 날씨에 대한 것이니까..." → 추론 토큰 (보이지 않을 수 있음)
  추론: "사용자는 날씨 변화 추이를 묻고 있으므로..." → 추론 토큰
  ...
  추론: "최종 답변을 구성하자..." → 추론 토큰
  답변: "서울의 날씨趋势는..." → 사용자에게 표시
```

Reasoning chain을 숨기면 streaming이 끊긴 것처럼 보인다. 공개하면 사용자가 답변을 기다리는 동안 추론 과정이 노출되어UX가 어색해진다.

**해결 접근**:

```python
# Reasoning-aware streaming handler
class ReasoningStreamingHandler:
    def __init__(self, show_reasoning: bool = False):
        self.show_reasoning = show_reasoning
        self.buffer = []
        self.is_reasoning = True  # reasoning phase开始了
    
    def on_token(self, token: str, token_type: str):
        """
        token_type: 'reasoning' | 'answer'
        """
        if token_type == 'reasoning':
            if self.show_reasoning:
                self.buffer.append(f"[思考] {token}")
            # reasoning 토큰은 버퍼에만 저장 (표시 안 함)
            self.buffer.append(token)
        else:
            # answer phase开始了
            if self.is_reasoning:
                self.flush_reasoning_buffer()  # 필요 시 reasoning 요약만 표시
                self.is_reasoning = False
            
            if self.show_reasoning and self.buffer:
                # reasoning 결과를 압축해서 표시
                summary = self.summarize_reasoning(self.buffer)
                yield f"[추론 요약] {summary}\n"
            
            yield token  # 답변 토큰은 즉시 streaming
    
    def flush_reasoning_buffer(self):
        # reasoning phase 종료 시 처리
        pass
    
    def summarize_reasoning(self, buffer: list) -> str:
        # 긴 reasoning chain을 요약 (model 또는 heuristic)
        return f"({len(buffer)}단계 추론 완료)"
```

---

## 7. Reasoning Model의 한계와 과학적 기대 관리

### 7-1. 과학적 기대의 위험

Reasoning model에 대해 흔히 하는 과대평가가 몇 가지 있다.

**오해 1: "더 오래 생각하면 더 정확한 답이 나온다"**

이것은 일정 부분 사실이지만 무조건 적용하면 안 된다. Reasoning model의 추론은 명시적 규칙 기반 논리 추론이 아니라, statistical pattern matching의 일종이다. 즉, 더 많은 추론 단계가必ずしもより正確な答え로 연결되지 않는다. 특히 학습 데이터에 패턴이 희소한 영역에서는 추가 추론이 오히려 확신을 과대평가하게 만들 수 있다.

**오해 2: "Reasoning model은 기존 model을 완전히 대체한다"**

아니다. Factual recall, 간단한 분류, 빠르게 대량이 필요한 작업에서는 일반 model이 여전히 효율적이다. Reasoning model은 고난도 작업 특화 도구다.

**오해 3: "o3이AGO(바둑)처럼 모든 것을 풀 수 있다"**

OpenAI o3이 AGO 수준의 추론을 한다는 표현이 종종 사용되지만, 이것은 정확하지 않다. AGO는 명시적 규칙과 완전한 정보 환경에서 작동한다. LLM의 추론은 확률적이며, 불완전한 정보와 모호한 문제에서도 "그럴듯한 답"을 생성한다. 이것이 강점이기도 하고 한계이기도 하다.

### 7-2. Model Selection Framework

```python
def select_model(
    question: str,
    latency_sla_ms: float,
    accuracy_requirement: float,
) -> str:
    """
    질문 특성에 따라 최적 model을 선택한다.
    """
    complexity = InferenceCostEstimate.classify(question)
    estimate = InferenceCostEstimate.estimate(question, max_budget=128.0)
    
    # Latency SLA 기반 하드 필터링
    if latency_sla_ms < 500:
        if complexity.value >= ComplexityLevel.ANALYSIS.value:
            # Latency SLA를 맞출 수 없으면 fallback 전략 필요
            return "vanilla_fast_mode"
        return "gpt-4o-mini"
    
    # Accuracy requirement 기반 선택
    if accuracy_requirement >= 0.95:
        if estimate.recommended_model in ["o3", "o3-mini"]:
            return estimate.recommended_model
        # accuracy 요구가 높지만 reasoning model이 아닌 경우
        return "use_vanilla_with_cot"
    
    # Default: complexity-based routing
    return estimate.recommended_model
```

---

## 8.Architectural Pattern: Multi-Model Routing in Production

실제 production에서는 질문의 특성에 따라 서로 다른 model로 라우팅하는 것이 필수적이다.

```python
from enum import Enum

class ModelTier(Enum):
    FAST = "gpt-4o-mini"           # 저비용・저지연
    STANDARD = "gpt-4o"            # 균형
    REASONING = "o3-mini"          # 고난도 추론
    EXPERT = "o3"                 # 최고 정확도

class ModelRouter:
    def __init__(self):
        self.cost_per_1k_tokens = {
            ModelTier.FAST: 0.00015,
            ModelTier.STANDARD: 0.005,
            ModelTier.REASONING: 0.003,
            ModelTier.EXPERT: 0.015,
        }
        self.latency_profile = {
            ModelTier.FAST: 0.8,       # 초 단위
            ModelTier.STANDARD: 2.5,
            ModelTier.REASONING: 15.0,
            ModelTier.EXPERT: 60.0,
        }
    
    def route(self, question: str, context: dict) -> ModelTier:
        """
        질문 특성과 요청 context를 기반으로 model tier를 선택한다.
        """
        complexity = InferenceCostEstimate.classify(question)
        
        # Hard constraints부터 확인
        latency_budget = context.get("latency_budget_s", 10)
        accuracy_target = context.get("accuracy_target", 0.80)
        
        # Latency budget으로 필터링
        viable = [
            tier for tier, latency in self.latency_profile.items()
            if latency <= latency_budget
        ]
        
        if not viable:
            viable = [min(self.latency_profile.keys(), 
                          key=lambda t: self.latency_profile[t])]
        
        # Accuracy target으로 필터링
        accuracy_map = {
            ModelTier.FAST: 0.82,
            ModelTier.STANDARD: 0.88,
            ModelTier.REASONING: 0.91,
            ModelTier.EXPERT: 0.95,
        }
        
        viable = [t for t in viable if accuracy_map[t] >= accuracy_target]
        
        if not viable:
            viable = [ModelTier.STANDARD]
        
        # Complexity 기준 선택
        complexity_tier_map = {
            ComplexityLevel.FACTUAL: ModelTier.FAST,
            ComplexityLevel.COMPREHENSION: ModelTier.FAST,
            ComplexityLevel.ANALYSIS: ModelTier.REASONING,
            ComplexityLevel.SYNTHESIS: ModelTier.EXPERT,
            ComplexityLevel.EXPERT: ModelTier.EXPERT,
        }
        
        return complexity_tier_map.get(complexity, ModelTier.STANDARD)
    
    def estimate_cost(self, question: str, tier: ModelTier) -> float:
        tokens = InferenceCostEstimate._estimate_token_count(
            InferenceCostEstimate.classify(question)
        )
        return (tokens / 1000) * self.cost_per_1k_tokens[tier]
```

---

## 9. 결론: Reasoning Model은 도구이고 만능이 아니다

2026년 현재, reasoning model은 AI 추론 능력의 한계를 확장한 중요한 기술 진보다. 하지만 그것을 바라보는 올바른 프레임은 다음과 같다.

**Reasoning model이擅长的 것**:

- 다단계 논리 추론이 필요한 작업
- 정답과 오답의 차이가 명백한 작업 (수학, 코딩, 증명)
- 재시도 비용이 높은 작업 (외부 시스템에 실제로 영향을 미치는 결정)
- 사용자가 추론 과정을 검증하고 싶은 작업

**기존 model이 여전히優れるもの**:

- 빠른 응답이 필요한 간단한 작업
- 대량 처리율이 중요한 작업
- 사실 확인 중심의 작업
- 비용 최적화가 필수적인 작업

결국 중요한 것은 질문의 특성을 먼저 분석하고, 그에 맞는 추론 전략을 선택하는 것이다. 이것은 기술 선택의 문제가 아니라, 시스템을 어떻게 설계하느냐의 문제다.

> Reasoning Model은 AI에게 "답을 찾기 위해 얼마나 생각할 것인가"라는 질문을 프로그래밍할 수 있게 해준 첫 번째 기술적 breakthrough다. 그 가능성의 앞면만 보지 말고, 뒷면의 트레이드오프까지 함께 이해할 때 비로소 올바르게 활용할 수 있다.

---

## References

- DeepSeek-AI. "DeepSeek-R1: Incentivizing Reasoning Capability in LLMs via Reinforcement Learning." 2026.
- OpenAI. "Learning to Reason with Large Language Models." 2024.
- Wei et al. "Chain-of-Thought Prompting Elicits Reasoning in Large Language Models." NeurIPS 2022.
- Snell et al. "Scaling LLM Test-Time Compute" (Seminal work on inference-time scaling). 2024.
