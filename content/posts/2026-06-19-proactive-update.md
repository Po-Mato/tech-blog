---
title: "AI Agent 데이터 파이프라인의 Circuit Breaker 패턴: 외부 데이터 소스 '사라짐'을 아키텍처로 극복하는 방법"
date: "2026-06-19"
description: "Databricks Lakehouse//RT가 데이터 파이프라인을 단순화하는 시대, 하지만 AI Agent가 의존하는 모든 외부 데이터 소스는 언제든 사라질 수 있다. 네이버 금융 스크리너 종료, 단일 LLM provider 장애, MCP 서버 타임아웃 — 이 모든 문제의 공통 해결책인 Circuit Breaker + Multi-Source Fallback 아키텍처를 TypeScript와 Go 코드 예제와 함께 단계별로 해부한다."
tags:
  - AI Agent
  - Circuit Breaker
  - Data Pipeline
  - Resilience Patterns
  - Fallback Architecture
  - Production AI
  - MCP
  - TypeScript
  - Software Architecture
  - Multi-LLM
---

## 1. 들어가며: '데이터 소스가 사라지는' 시대

2026년 6월, Databricks가 Data + AI Summit에서 Lakehouse//RT와 LTAP를 발표하며 "데이터 파이프라인의 종말"을 선언했다. 객체 스토리지 위에서 밀리초 쿼리 지연 시간을 제공하는 이 기술은, ETL 파이프라인을 제거하고 AI Agent가 데이터에 직접 접근할 수 있는 길을 열었다.

하지만 아이러니가 있다. 파이프라인이 단순화될수록, **그 파이프라인이 의존하는 외부 데이터 소스의 장애는 더 치명적**이 된다.

```
// 2026년 5월, 실제 일어난 일:

// 사례 A: 네이버 금융 lowval.nhn → 영구 종료 (404)
// PER/PBR 기반 저평가 스크리닝 파이프라인이 데이터 소스 소멸로 완전 붕괴.
// 3주 연속 "조건 충족 종목 0건" → 실제로는 조건이 아니라 데이터가 없었던 것.

// 사례 B: 개인 OpenAI API 장애 → 17개 크론잡 동시 마비
// 단일 provider 의존이 전체 자동화 인프라의 단일 장애점(SPOF)이 됨.

// 사례 C: MCP 서버 타임아웃 → 에이전트 전체 체인 붕괴
// MCP 서버 하나가 응답하지 않으면, 그 뒤에 연결된 모든 에이전트 워크플로우가 중단.
```

이 글에서는 **AI Agent 데이터 파이프라인의 Circuit Breaker 패턴**을 실제 아키텍처 설계와 코드로 분석한다. 외부 데이터 소스가 사라져도 시스템이 죽지 않고, 품질이 낮아지더라도 **graceful degradation**을 유지하는 방법이 핵심이다.

---

## 2. 문제 분석: AI Agent 파이프라인의 3가지 취약점

AI Agent가 의존하는 데이터 파이프라인은 전통적인 분산 시스템과 다른 취약점을 가진다.

### 2.1. SPOF #1: 데이터 소스 자체의 생명주기

```
기존 데이터 파이프라인: Source → ETL → Warehouse → BI Tool
AI Agent 파이프라인:  Source → MCP Server → Agent Context → LLM Decision
```

전통적인 파이프라인은 데이터 소스가 변경되면 ETL 로직만 수정하면 된다. 반면 AI Agent 파이프라인에서 데이터 소스 변경은 **Agent의 의사결정 품질 전반**에 영향을 미친다. Agent는 과거 데이터를 기반으로 학습된 컨텍스트 위에서 행동하기 때문이다.

### 2.2. SPOF #2: 단일 Provider 의존

MEMORY.md에 기록된 교훈을 다시 보자:

> "단일 provider 의존은 죽음의 트랩이다. 크론잡이 많아질수록 model pool의 다양성이 생존률을 결정한다."

이는 LLM provider뿐 아니라 데이터 소스, MCP 서버, 벡터 스토어 등 **파이프라인의 모든 노드**에 적용된다.

### 2.3. SPOF #3: Fallback의 부재

가장 심각한 문제는 대부분의 AI Agent 시스템이 **Fallback을 아예 고려하지 않는다**는 점이다. 한 번의 API 호출 실패가 Agent 전체의 실패로 이어진다.

```
// ❌ 나쁜 패턴: Fallback 없는 에이전트
async function fetchStockData(ticker: string) {
  const response = await fetch(`https://api.finance.example.com/price/${ticker}`);
  return response.json(); // 이 줄에서 실패하면 Agent 전체가 멈춤
}
```

---

## 3. Circuit Breaker 패턴: AI Agent 버전

Circuit Breaker는 전통적으로 마이크로서비스 간 호출을 보호하는 패턴이다. AI Agent 파이프라인에서는 세 가지 레벨로 적용해야 한다.

```
┌─────────────────────────────────────────────────┐
│           Agent Runtime Resilience Layer        │
├─────────────┬──────────────┬────────────────────┤
│ Level 1     │ Level 2      │ Level 3            │
│ LLM 호출    │ 데이터 소스   │ 에이전트 체인     │
│ Circuit     │ Circuit      │ Circuit            │
│ Breaker     │ Breaker      │ Breaker            │
├─────────────┼──────────────┼────────────────────┤
│ LLM provider│ REST API     │ Agent → Tool A     │
│ 타임아웃    │ 데이터 피드    │ → Tool B → Tool C  │
│ /429/500    │ 종료/변경     │ 체인의 부분 실패   │
└─────────────┴──────────────┴────────────────────┘
```

### 3.1. Level 1: LLM 호출 Circuit Breaker

가장 흔한 패턴이다. LLM provider가 429(rate limit)나 500(서버 에러)을 반환하면, fallback provider로 자동 전환한다.

```typescript
// TypeScript: LLM Multi-Provider Circuit Breaker

interface LLMProviderConfig {
  name: string;
  endpoint: string;
  apiKey: string;
  model: string;
  fallbackPriority: number; // 낮을수록 우선
  maxRetries: number;
  timeoutMs: number;
}

class LLMCircuitBreaker {
  private state: Map<string, {
    failures: number;
    lastFailureTime: number;
    state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  }> = new Map();

  private readonly failureThreshold = 3;  // 3회 연속 실패시 OPEN
  private readonly resetTimeoutMs = 30000; // 30초 후 HALF_OPEN
  private readonly halfOpenMaxRequests = 1;

  constructor(private providers: LLMProviderConfig[]) {}

  async complete(prompt: string): Promise<string> {
    // fallbackPriority 순으로 provider 정렬
    const sortedProviders = [...this.providers]
      .sort((a, b) => a.fallbackPriority - b.fallbackPriority);

    for (const provider of sortedProviders) {
      const breaker = this.getBreaker(provider.name);

      if (breaker.state === 'OPEN') {
        // resetTimeout이 지났는지 확인
        if (Date.now() - breaker.lastFailureTime > this.resetTimeoutMs) {
          breaker.state = 'HALF_OPEN';
          console.warn(`[CB] ${provider.name}: OPEN → HALF_OPEN`);
        } else {
          console.warn(`[CB] ${provider.name}: OPEN, skipping`);
          continue; // 다음 provider로 fallback
        }
      }

      try {
        const result = await this.callProvider(provider, prompt);

        // 성공: CLOSED 상태로 복구
        if (breaker.state === 'HALF_OPEN') {
          breaker.state = 'CLOSED';
          breaker.failures = 0;
          console.info(`[CB] ${provider.name}: recovered`);
        }

        return result;
      } catch (err) {
        breaker.failures++;
        breaker.lastFailureTime = Date.now();

        if (breaker.failures >= this.failureThreshold) {
          breaker.state = 'OPEN';
          console.error(`[CB] ${provider.name}: OPEN (${breaker.failures} failures)`);
        }

        // 다음 provider로 fallback
        continue;
      }
    }

    throw new Error('All LLM providers exhausted');
  }

  private getBreaker(name: string) {
    if (!this.state.has(name)) {
      this.state.set(name, {
        failures: 0,
        lastFailureTime: 0,
        state: 'CLOSED',
      });
    }
    return this.state.get(name)!;
  }

  private async callProvider(
    config: LLMProviderConfig,
    prompt: string
  ): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const response = await fetch(config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`${config.name} returned ${response.status}`);
      }

      const data = await response.json();
      return data.choices[0].message.content;
    } finally {
      clearTimeout(timeout);
    }
  }
}
```

### 3.2. Level 2: 데이터 소스 Circuit Breaker with Multi-Source Fallback

더 복잡한 패턴이다. 같은 의미의 데이터를 제공하는 여러 소스를 정의하고, 우선순위대로 시도한다.

```typescript
// TypeScript: 데이터 소스 Multi-Source Fallback

interface DataSource<T> {
  name: string;
  priority: number;
  fetch: () => Promise<T>;
  validate: (data: T) => boolean; // 데이터 품질 검증
}

class DataPipelineCircuitBreaker<T> {
  private circuitStates: Map<string, {
    state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
    failureCount: number;
    lastFailure: number;
    lastSuccessData: T | null;  // 마지막 성공 데이터 캐시
  }> = new Map();

  constructor(
    private sources: DataSource<T>[],
    private options: {
      failureThreshold?: number;
      resetTimeoutMs?: number;
      staleDataMaxAgeMs?: number;  // 만료된 캐시도 사용할 최대 시간
    } = {}
  ) {
    this.options = {
      failureThreshold: 3,
      resetTimeoutMs: 60000,
      staleDataMaxAgeMs: 86400000, // 기본 24시간
      ...options,
    };
  }

  async fetch(): Promise<{
    data: T;
    source: string;
    quality: 'fresh' | 'stale' | 'fallback';
  }> {
    const sorted = [...this.sources].sort((a, b) => a.priority - b.priority);

    for (const source of sorted) {
      const state = this.getState(source.name);

      // OPEN 상태면 스킵 (HALF_OPEN 체크는 내부에서)
      if (state.state === 'OPEN') {
        if (Date.now() - state.lastFailure > this.options.resetTimeoutMs!) {
          state.state = 'HALF_OPEN';
        } else {
          continue;
        }
      }

      try {
        const data = await source.fetch();

        // 데이터 품질 검증 — 퀀트 스크리닝 사례:
        // 모든 종목이 PER 0 또는 음수면 데이터 자체가 잘못된 것
        if (!source.validate(data)) {
          throw new Error(`Data validation failed for ${source.name}`);
        }

        // 성공: 상태 초기화 + 캐시 갱신
        state.state = 'CLOSED';
        state.failureCount = 0;
        state.lastSuccessData = data;

        return { data, source: source.name, quality: 'fresh' };
      } catch (err) {
        state.failureCount++;
        state.lastFailure = Date.now();

        if (state.failureCount >= this.options.failureThreshold!) {
          state.state = 'OPEN';
          console.warn(`[DataCB] ${source.name}: OPEN`);
        }
      }
    }

    // 모든 소스 실패: Stale Data Fallback
    const staleResult = this.tryStaleData();
    if (staleResult) return staleResult;

    throw new Error('All data sources exhausted, no stale data available');
  }

  private tryStaleData(): {
    data: T; source: string; quality: 'stale';
  } | null {
    // 모든 소스의 마지막 성공 데이터 중 가장 최신 것을 찾는다
    let best: { data: T; source: string; age: number } | null = null;

    for (const [name, state] of this.circuitStates) {
      if (!state.lastSuccessData) continue;

      const age = Date.now() - state.lastFailure; // 대략적인 age
      if (age < this.options.staleDataMaxAgeMs!) {
        if (!best || age < best.age) {
          best = { data: state.lastSuccessData, source: name, age };
        }
      }
    }

    return best
      ? { data: best.data, source: `${best.source} (stale)`, quality: 'stale' }
      : null;
  }

  private getState(name: string) {
    if (!this.circuitStates.has(name)) {
      this.circuitStates.set(name, {
        state: 'CLOSED',
        failureCount: 0,
        lastFailure: 0,
        lastSuccessData: null,
      });
    }
    return this.circuitStates.get(name)!;
  }
}
```

#### 실제 적용: 한국 주식 데이터 Fallback

```typescript
// 실제 적용 예: 한국 주식 시장 데이터 수집
const stockDataSources: DataSource<StockScreeningResult[]> = [
  {
    name: 'KRX-API',
    priority: 1,
    fetch: () => krxApi.fetchMarketData(),      // 한국거래소 공식 API
    validate: (data) => data.length > 0 && data.some(s => s.per > 0),
  },
  {
    name: 'Naver-Finance',
    priority: 2,
    fetch: () => naverFinance.scrapeTopStocks(), // 네이버 금융 (JavaScript-rendered)
    validate: (data) => data.length > 0,
  },
  {
    name: 'KIS-API',
    priority: 3,
    fetch: () => kisApi.fetchScreening(),        // 한국투자증권 API
    validate: (data) => data.length > 0,
  },
];

const pipeline = new DataPipelineCircuitBreaker(stockDataSources, {
  failureThreshold: 2,
  resetTimeoutMs: 120000,
  staleDataMaxAgeMs: 172800000, // 48시간
});

// 사용:
const result = await pipeline.fetch();
if (result.quality === 'stale') {
  // 사용자에게 데이터가 오래되었음을 명시적으로 표시
  console.warn(`⚠️ Stale data from ${result.source}: using cached snapshot`);
}
```

### 3.3. Level 3: Agent 체인 Circuit Breaker (MCP용)

가장 고급 패턴이다. Agent가 여러 MCP 서버(Memory, File System, Search 등)를 호출할 때, 개별 서버 실패가 전체 체인을 붕괴시키지 않도록 보호한다.

```typescript
// TypeScript: MCP 체인 Circuit Breaker

interface MCPToolCall {
  server: string;
  tool: string;
  params: Record<string, unknown>;
  critical: boolean; // true면 이 단계 실패 = 전체 실패
}

interface MCPToolResult {
  server: string;
  tool: string;
  success: boolean;
  data?: unknown;
  error?: string;
  latencyMs: number;
}

class MCPChainCircuitBreaker {
  private readonly serverStates = new Map<string, {
    state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
    failures: number;
    lastFailure: number;
  }>();

  private readonly maxFailures = 5;
  private readonly resetMs = 30000;

  async executeChain(chain: MCPToolCall[]): Promise<{
    results: MCPToolResult[];
    degraded: boolean; // 부분 성공
  }> {
    const results: MCPToolResult[] = [];
    let degraded = false;

    for (const call of chain) {
      const state = this.getServerState(call.server);

      // Circuit OPEN: 이 서버 스킵
      if (state.state === 'OPEN') {
        if (Date.now() - state.lastFailure > this.resetMs) {
          state.state = 'HALF_OPEN';
        } else {
          if (call.critical) {
            throw new Error(
              `Critical tool ${call.server}/${call.tool} unavailable (circuit OPEN)`
            );
          }
          results.push({
            server: call.server,
            tool: call.tool,
            success: false,
            error: 'Circuit OPEN — skipped',
            latencyMs: 0,
          });
          degraded = true;
          continue;
        }
      }

      const start = Date.now();
      try {
        const data = await this.callMCPServer(call);
        const latencyMs = Date.now() - start;

        // 성공: CLOSED 복구
        if (state.state === 'HALF_OPEN') {
          state.state = 'CLOSED';
          state.failures = 0;
        }

        results.push({
          server: call.server,
          tool: call.tool,
          success: true,
          data,
          latencyMs,
        });
      } catch (err) {
        const latencyMs = Date.now() - start;
        state.failures++;
        state.lastFailure = Date.now();

        if (state.failures >= this.maxFailures) {
          state.state = 'OPEN';
        }

        if (call.critical) {
          throw err; // critical 단계 실패는 전파
        }

        results.push({
          server: call.server,
          tool: call.tool,
          success: false,
          error: String(err),
          latencyMs,
        });
        degraded = true;
      }
    }

    return { results, degraded };
  }

  private getServerState(server: string) {
    if (!this.serverStates.has(server)) {
      this.serverStates.set(server, {
        state: 'CLOSED',
        failures: 0,
        lastFailure: 0,
      });
    }
    return this.serverStates.get(server)!;
  }

  private async callMCPServer(call: MCPToolCall): Promise<unknown> {
    // MCP 프로토콜 기반 호출
    const response = await fetch(`http://mcp-router/${call.server}/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool: call.tool,
        params: call.params,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`MCP ${call.server}/${call.tool}: ${response.status}`);
    }

    return response.json();
  }
}
```

---

## 4. 아키텍처: Multi-Layer Resilience

이 세 가지 회로 차단기를 단일 시스템으로 통합한 아키텍처를 살펴보자.

```
┌──────────────────────────────────────────────────────────┐
│                    AI Agent Runtime                        │
│  ┌─────────────────────────────────────────────────────┐  │
│  │           Resilience Middleware                      │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │  │
│  │  │ LLM CB   │  │ Data CB  │  │ MCP Chain CB     │  │  │
│  │  │ Level 1  │  │ Level 2  │  │ Level 3          │  │  │
│  │  └────┬─────┘  └────┬─────┘  └───────┬──────────┘  │  │
│  │       │              │                │              │  │
│  │       ▼              ▼                ▼              │  │
│  │  ┌──────────────────────────────────────────┐       │  │
│  │  │       Degradation Reporter                │       │  │
│  │  │  → Circuit state changes                  │       │  │
│  │  │  → Stale data usage                       │       │  │
│  │  │  → Provider switch events                  │       │  │
│  │  └──────────────────────────────────────────┘       │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                           │
│  ┌──────────────────────────────────────┐                 │
│  │         Fallback Strategy Table       │                 │
│  ├────────────────┬─────────────────────┤                 │
│  │ Priority 1     │ Primary Source       │                 │
│  │ Priority 2     │ Secondary Source     │                 │
│  │ Priority 3     │ Tertiary Source      │                 │
│  │ Stale Fallback │ Last Known Good      │                 │
│  └────────────────┴─────────────────────┘                 │
└──────────────────────────────────────────────────────────┘
```

### 4.1. Degradation Reporter: 장애가 품질 메트릭이 되다

가장 중요한 설계 결정은 **Circuit Breaker가 단순히 실패를 숨기지 않는다**는 점이다. 어떤 Circuit이 OPEN 상태인지, Stale 데이터를 사용 중인지를 명시적으로 기록하고, 이 정보를 Agent의 의사결정에 반영해야 한다.

```typescript
// TypeScript: Circuit Health → Agent Context

interface CircuitHealthContext {
  degradedSources: {
    source: string;
    since: number;       // timestamp
    using: string;       // current fallback
    dataQuality: 'fresh' | 'stale' | 'degraded';
  }[];
  llmStatus: {
    primary: string;
    active: string;
    fallbacksTried: string[];
  };
}

function buildCircuitHealthContext(): string {
  const health: CircuitHealthContext = {
    degradedSources: [],
    llmStatus: {
      primary: 'gpt-4o',
      active: 'claude-4',
      fallbacksTried: ['gpt-4o (429)', 'gemini-3 (timeout)'],
    },
  };

  // 이 컨텍스트를 Agent system prompt에 주입하여
  // Agent가 자신의 데이터 품질 한계를 인지하게 한다
  return `
[SYSTEM CONTEXT — CIRCUIT HEALTH]
현재 데이터 품질 상태:
${health.degradedSources.map(s =>
  `- ${s.source}: ${s.dataQuality} (using ${s.using})`
).join('\n')}
LLM Provider: ${health.llmStatus.active} (primary: ${health.llmStatus.primary})
Fallbacks tried: ${health.llmStatus.fallbacksTried.join(', ')}

⚠️ Stale data를 사용 중인 경우, 응답에 "이 정보는 [날짜] 기준입니다"를
명시적으로 포함하십시오.
`;
}
```

---

## 5. Go 구현: 경량 에지용 Circuit Breaker

리소스가 제한된 환경(크론잡, 에지 디바이스)에서는 Go로 구현하는 것이 더 효율적이다.

```go
// Go: 경량 Circuit Breaker (goroutine-safe + metrics)

package circuitbreaker

import (
	"log"
	"sync"
	"time"
)

type State int

const (
	Closed State = iota
	Open
	HalfOpen
)

type Breaker struct {
	mu              sync.RWMutex
	state           State
	failureCount    int
	lastFailureTime time.Time

	threshold    int
	resetTimeout time.Duration
}

func New(threshold int, resetTimeout time.Duration) *Breaker {
	return &Breaker{
		state:        Closed,
		threshold:    threshold,
		resetTimeout: resetTimeout,
	}
}

func (b *Breaker) Execute(fn func() error) error {
	if !b.allowRequest() {
		return ErrCircuitOpen
	}

	err := fn()
	b.recordResult(err)
	return err
}

func (b *Breaker) allowRequest() bool {
	b.mu.RLock()
	state := b.state
	lastFailure := b.lastFailureTime
	b.mu.RUnlock()

	switch state {
	case Closed:
		return true
	case Open:
		if time.Since(lastFailure) > b.resetTimeout {
			// OPEN → HALF_OPEN
			b.mu.Lock()
			b.state = HalfOpen
			b.mu.Unlock()
			log.Println("[CB] OPEN → HALF_OPEN")
			return true
		}
		return false
	case HalfOpen:
		return true
	}
	return false
}

func (b *Breaker) recordResult(err error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	if err == nil {
		// 성공
		b.failureCount = 0
		if b.state == HalfOpen {
			b.state = Closed
			log.Println("[CB] HALF_OPEN → CLOSED (recovered)")
		}
		return
	}

	// 실패
	b.failureCount++
	b.lastFailureTime = time.Now()
	log.Printf("[CB] failure %d/%d", b.failureCount, b.threshold)

	if b.failureCount >= b.threshold && b.state != Open {
		b.state = Open
		log.Println("[CB] → OPEN")
	}
}

// Health: Prometheus metrics용
func (b *Breaker) Health() map[string]interface{} {
	b.mu.RLock()
	defer b.mu.RUnlock()

	return map[string]interface{}{
		"state":        b.state.String(),
		"failureCount": b.failureCount,
		"sinceOpen":    time.Since(b.lastFailureTime).String(),
	}
}

var ErrCircuitOpen = fmt.Errorf("circuit breaker: open")
```

---

## 6. 운영 교훈: 실제 환경에서 배운 3가지

실제로 이 패턴을 운영하면서 얻은 교훈을 정리한다.

### 6.1. Fallback 품질 저하를 숨기지 마라

가장 큰 함정은 Circuit Breaker가 장애를 "투명하게" 처리한다고 생각하는 것이다. Fallback이 발동되면 **데이터 품질이 떨어졌음을 명시적으로 표시**해야 한다.

```
✅ DO:  "이 정보는 어제 데이터 기준입니다 (KRX API 장애로 인해)"
❌ DON'T: (아무 말 없이 오래된 데이터 제공)
```

TypeScript의 DataPipelineCircuitBreaker에서 `quality: 'stale'` 필드를 반환하는 이유가 바로 이것이다.

### 6.2. Stale Data에도 수명이 있다

지난 주의 주식 데이터는 오늘의 매매 결정에 사용할 수 없다. 데이터 소스마다 **stale data 최대 허용 시간**을 다르게 설정해야 한다.

```
주식 시세:       5분
PER/PBR 데이터:  1일
뉴스 헤드라인:   1시간
기업 재무제표:   7일
```

### 6.3. Half-Open 상태의 테스트 주기를 조정하라

LLM provider는 보통 rate limit 해제에 1~60분이 걸린다. 반면 REST API는 몇 초면 복구된다. Circuit Breaker마다 resetTimeout을 데이터 소스 특성에 맞게 조정해야 한다.

```
provider마다 다른 resetTimeout:
- OpenAI API (429):       60초 (rate limit window)
- 네이버 금융 스크래핑:   300초 (봇 감지 우회 시간 고려)
- KRX 공개 API:          30초 (정규 장 시간에만 사용)
- MCP 서버:               10초 (내부 서비스)
```

---

## 7. 결론: AI Agent는 'Fallback을 아는' 시스템이어야 한다

2026년, AI Agent의 경쟁력은 더 이상 "가장 똑똑한 모델"이 아니라 "가장 탄력적인 파이프라인"에서 나온다.

Databricks Lakehouse//RT가 데이터 파이프라인의 단순화를 선언했지만, 외부 데이터 소스의 예측 불가능성은 여전히 존재한다. 네이버 금융 스크리너가 종료되고, OpenAI API가 다운되고, MCP 서버가 타임아웃이 나는 것은 기술의 문제가 아니라 **분산 시스템의 본질**이다.

핵심은 이것이다:

> 외부 데이터 소스는 언제든 사라질 수 있다.
> 중요한 것은 그것을 감지하고, 대체하고, 그 사실을 사용자에게 알리는 구조를 아키텍처 수준에서 갖추는 것이다.

이 글에서 제시한 3-Layer Circuit Breaker와 Multi-Source Fallback 패턴은 단순한 "에러 핸들링"이 아니라 **AI Agent가 자신의 데이터 품질 한계를 인지하고 행동하는 방법**에 대한 설계 철학이다.

---

## 참고 자료

- Michael Nygard, "Release It!: Design and Degrade to Production-Ready Software" (2007, 재발행)
- Databricks Lakehouse//RT 발표 (Data + AI Summit 2026)
- Barista Labs, "AI Agent spend control needs a circuit breaker" (2026)
- arXiv 2606.18422: "Gatekeepers and Hallucinations: Layered Evaluation Framework for LLM-Driven Systems" (2026)
- Microsoft Build 2026: Agent Control Specification (ACS)
