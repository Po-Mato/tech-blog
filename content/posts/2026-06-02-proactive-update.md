---
title: "Signal Propagation과 Cancellation Chain: AbortController에서 분산 시스템까지 비동기 취소의 아키텍처 설계 패턴"
date: "2026-06-02"
description: "JavaScript AbortController는 단순한 fetch 취소 도구가 아니다. Signal Propagation 패턴, CancellationToken 체인, 그리고 분산 Agent 시스템의 Graceful Shutdown까지 — 비동기 취소 메커니즘의 진화를 TypeScript 코드 예제와 함께 아키텍처 수준에서 분석한다."
tags:
  - TypeScript
  - Architecture Pattern
  - Async Programming
  - AbortController
  - Signal Propagation
  - Distributed Systems
  - Graceful Shutdown
  - Error Handling
---

## 1. 들어가며: 취소는 예외가 아니라 아키텍처다

웹 애플리케이션에서 사용자가 검색어를 입력할 때마다 API 요청이 발생한다. 사용자가 다음 글자를 입력하는 순간, 이전 요청은 더 이상 필요하지 않다. 이때 우리는 무엇을 하는가?

대부분의 코드는 이렇게 되어 있다:

```typescript
// ❌ 취소를 무시하는 패턴 — 가장 흔하지만 가장 위험하다
let lastAbortController: AbortController | null = null;

function search(query: string) {
  lastAbortController?.abort(); // 이전 요청 취소
  lastAbortController = new AbortController();
  
  fetch(`/api/search?q=${query}`, {
    signal: lastAbortController.signal,
  });
}
```

이 코드는 동작한다. 하지만 이것은 **취소를 '도구'로만 사용**한 예시다. 취소를 **'아키텍처 패턴'**으로 승격시키면, 단순한 fetch 중단을 넘어서:
- 분산 시스템 전체의 Graceful Shutdown
- Agent Task의 우아한 중단
- 리소스 누수 없는 비동기 작업 관리
- 에러 핸들링과 취소의 명확한 분리

를 실현할 수 있다.

이 글에서는 JavaScript AbortController의 내부 동작 원리부터 시작해서, Signal Propagation 패턴, CancellationToken 체인, 그리고 최종적으로 분산 Agent 시스템에서의 취소 아키텍처까지를 TypeScript 코드와 함께 단계적으로 탐구한다.

---

## 2. AbortController의 내부 동작 원리: EventEmitter의 정교한 변주

### 2.1 구조 분석

AbortController는 겉보기에는 단순해 보이지만, 내부적으로는 **Observer Pattern + 상태 머신**의 조합이다:

```typescript
// AbortController의 내부 구조 (개념적)
class InternalAbortController {
  private _signal: InternalAbortSignal;
  private _aborted = false;

  constructor() {
    this._signal = new InternalAbortSignal(this);
  }

  abort(reason?: unknown) {
    if (this._aborted) return; // idempotent: 한 번 abort되면 재호출 무시
    this._aborted = true;
    this._signal._fireAbort(reason ?? new DOMException('The operation was aborted'));
  }

  get signal() { return this._signal; }
}

class InternalAbortSignal {
  private _onabort: ((ev: Event) => void) | null = null;
  private _listeners = new Set<() => void>();
  private _aborted = false;
  private _reason: unknown;

  constructor(private _controller: InternalAbortController) {}

  get aborted() { return this._aborted; }
  get reason() { return this._reason; }

  // abort 이벤트 리스너 등록 — 사실상 EventEmitter
  addEventListener(type: 'abort', listener: () => void) {
    if (this._aborted) {
      // 이미 중단된 Signal에 리스너를 등록하면 즉시 실행
      queueMicrotask(listener);
      return;
    }
    this._listeners.add(listener);
  }

  removeEventListener(type: 'abort', listener: () => void) {
    this._listeners.delete(listener);
  }

  _fireAbort(reason: unknown) {
    this._aborted = true;
    this._reason = reason;
    // 이미 중단 상태로 리스너들을 실행
    for (const listener of this._listeners) {
      try { listener(); } catch { /* 개별 리스너 실패가 전체를 죽이지 않음 */ }
    }
    this._onabort?.({ type: 'abort' } as Event);
    this._listeners.clear(); // 메모리 누수 방지
  }
}
```

핵심 설계 결정 세 가지:

1. **Idempotent Abort**: `abort()`는 한 번만 유효하다. 두 번째 호출은 무시된다. 이는 Signal을 구독하는 모든 소비자가 `aborted` 상태를 확인할 수 있는 안전한 단일 진실 공급원(Single Source of Truth)을 보장한다.

2. **지연 리스너 등록 (Late Subscriber Handling)**: 이미 중단된 Signal에 리스너를 등록하면, 리스너가 `queueMicrotask`를 통해 **즉시 비동기적으로 실행**된다. 이는 `await` 이후에 Signal을 확인하는 late subscriber도 누락 없이 취소 이벤트를 수신할 수 있게 한다.

3. **이유 전달 (Reason Propagation)**: 단순히 "취소됨"이 아니라, 왜 취소되었는지에 대한 `reason`을 전달한다. 기본값은 `DOMException('Aborted')`지만, 사용자 정의 이유를 전달할 수 있다.

### 2.2 이것이 중요한 이유

이 세 가지 설계는 단순히 fetch를 취소하는 것 이상의 의미를 가진다. 각각은 분산 시스템의 Cancellation 설계에 직접적으로 매핑된다:

| AbortSignal 설계 | 분산 시스템 매핑 |
|---|---|
| Idempotent abort | 중복 취소 메시지의 안전한 처리 |
| Late subscriber handling | 지연된 컴포넌트의 취소 상태 동기화 |
| Reason propagation | 취소 원인의 체계적인 전파와 로깅 |

---

## 3. Signal Propagation: 체인, 레이스, 그리고 타임아웃

### 3.1 Signal Chaining (부모-자식 취소 전파)

실제 애플리케이션에서는 단일 취소가 아니라 **계층적 취소**가 필요하다. 예를 들어, 페이지를 떠날 때 모든 활성 요청을 취소하고, 각 요청 내에서도 여러 단계의 하위 작업이 있다면:

```typescript
// Signal Chaining — 부모가 취소되면 모든 자식도 취소된다
function createChildSignal(parent: AbortSignal, timeoutMs?: number): AbortController {
  const child = new AbortController();
  
  // 부모가 취소되면 자식도 취소
  const onParentAbort = () => {
    child.abort(parent.reason); // 부모의 이유를 그대로 전파
  };
  
  // 이미 부모가 취소된 경우
  if (parent.aborted) {
    child.abort(parent.reason);
    return child;
  }
  
  parent.addEventListener('abort', onParentAbort, { once: true });
  
  // 타임아웃: 지정된 시간이 지나면 자동 취소
  if (timeoutMs !== undefined) {
    const timeoutId = setTimeout(() => {
      child.abort(new DOMException('Operation timed out', 'TimeoutError'));
    }, timeoutMs);
    
    // 자식이 먼저 취소되면 타임아웃 정리
    child.signal.addEventListener('abort', () => clearTimeout(timeoutId), { once: true });
  }
  
  return child;
}
```

### 3.2 Signal Racing: 여러 취소 소스 중 먼저 도착하는 것 사용

때로는 하나의 작업이 여러 취소 조건을 가질 수 있다. 페이지 이탈 **또는** 사용자 명시적 취소 **또는** 5초 타임아웃 중 먼저 발생하는 것으로 취소해야 한다면:

```typescript
// Signal Racing — 여러 취소 소스 중 가장 빠른 것을 사용
function raceSignals(signals: AbortSignal[]): AbortController {
  const controller = new AbortController();
  
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller;
    }
    
    signal.addEventListener('abort', () => {
      controller.abort(signal.reason);
    }, { once: true });
  }
  
  return controller;
}

// 사용 예
function fetchWithMultipleCancellation(url: string) {
  const pageLeaveSignal = getPageLeaveSignal();   // 페이지 이탈
  const userCancelSignal = getUserCancelSignal();   // 사용자 취소 버튼
  const timeoutSignal = AbortSignal.timeout(5000);  // 5초 타임아웃
  
  const raceController = raceSignals([
    pageLeaveSignal,
    userCancelSignal,
    timeoutSignal,
  ]);
  
  return fetch(url, { signal: raceController.signal });
}
```

### 3.3 AbortSignal.timeout() — 가장 우아한 타임아웃 패턴

2024년에 추가된 `AbortSignal.timeout()`은 기존의 `setTimeout` + `clearTimeout` 패턴을 완전히 대체한다:

```typescript
// 🚫 OLD: 수동 타임아웃 관리
function oldWay(url: string) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  
  return fetch(url, { signal: controller.signal })
    .finally(() => clearTimeout(timeoutId)); // 누락되기 쉬운 정리
}

// ✅ NEW: AbortSignal.timeout()
function newWay(url: string) {
  return fetch(url, { signal: AbortSignal.timeout(5000) });
  // timeout이 만료되면 TimeoutError와 함께 자동 취소
}
```

`AbortSignal.timeout()`의 숨은 장점은 **취소 이유의 타입 안전성**에 있다:

```typescript
try {
  await fetch(url, { signal: AbortSignal.timeout(5000) });
} catch (err) {
  if (err instanceof DOMException && err.name === 'TimeoutError') {
    // 타임아웃으로 인한 취소
    console.log('요청이 5초를 초과했습니다');
  } else if (err instanceof DOMException && err.name === 'AbortError') {
    // 명시적 취소
    console.log('요청이 취소되었습니다');
  } else {
    // 네트워크 오류 등
    throw err;
  }
}
```

---

## 4. AbortSignal → CancellationToken: 추상화 레이어 설계

브라우저가 아닌 환경(Node.js, Worker, Edge Runtime)에서도 일관된 취소 메커니즘이 필요하다. 이를 위해 AbortSignal을 더 일반적인 **CancellationToken**으로 추상화할 수 있다:

```typescript
// CancellationToken — 환경 독립적인 취소 인터페이스
interface CancellationToken {
  readonly isCancellationRequested: boolean;
  readonly reason?: unknown;
  onCancelled(callback: () => void): () => void; // unsubscribe 함수 반환
  throwIfCancelled(): void;
}

// 브라우저 AbortSignal → CancellationToken 어댑터
class AbortSignalToken implements CancellationToken {
  constructor(private signal: AbortSignal) {}
  
  get isCancellationRequested() { return this.signal.aborted; }
  get reason() { return this.signal.reason; }
  
  onCancelled(callback: () => void): () => void {
    if (this.signal.aborted) {
      queueMicrotask(callback);
      return () => {}; // 이미 취소됨, unsubscribe 불필요
    }
    
    const handler = () => callback();
    this.signal.addEventListener('abort', handler, { once: true });
    return () => this.signal.removeEventListener('abort', handler);
  }
  
  throwIfCancelled() {
    if (this.signal.aborted) {
      throw this.signal.reason instanceof Error
        ? this.signal.reason
        : new DOMException(String(this.signal.reason), 'AbortError');
    }
  }
}

// 사용 예: CancellationToken을 받는 제네릭 함수
async function withCancellation<T>(
  fn: (token: CancellationToken) => Promise<T>,
  signal?: AbortSignal,
  timeoutMs?: number
): Promise<T> {
  const effectiveSignal = timeoutMs !== undefined
    ? AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(timeoutMs)])
    : signal ?? new AbortController().signal;
  
  const token = new AbortSignalToken(effectiveSignal);
  return fn(token);
}
```

이 추상화의 가치는:
1. **테스트 용이성**: 모의 CancellationToken을 주입하여 취소 시나리오를 쉽게 테스트
2. **환경 독립성**: 브라우저/Node.js/Worker에서 동일한 인터페이스 사용
3. **타임아웃 + 취소의 조합**: 복합 취소 조건을 단일 토큰으로 통합

---

## 5. 분산 시스템에서의 Cancellation 설계 패턴

### 5.1 문제: 취소는 전파되어야 한다

마이크로서비스나 AI Agent 시스템에서 하나의 요청은 여러 서비스에 걸쳐 있다. 사용자가 A 서비스에 요청을 보내고, A는 B와 C를 호출하고, B는 다시 D를 호출한다. 이때 사용자가 요청을 취소하면 A, B, C, D 모두에게 취소가 전파되어야 한다.

이것이 **Cancellation Propagation** 문제다:

```
사용자 ──▶ A 서비스 ──▶ B 서비스 ──▶ D 서비스
               ├──▶ C 서비스
```

B나 C가 여전히 실행 중이라면 자원이 낭비된다. 더 나쁜 경우, D가 데이터베이스 락을 획득한 상태라면 데드락까지 발생할 수 있다.

### 5.2 TypeScript 구현: 계층적 CancellationToken 전파

```typescript
// HTTP 요청에 CancellationToken을 전달하는 미들웨어
interface CancellableRequest {
  signal: AbortSignal;
  // ... 다른 요청 속성
}

// API Gateway에서 취소 전파
async function apiGatewayHandler(req: CancellableRequest) {
  const taskId = crypto.randomUUID();
  
  // 부모 컨트롤러: 클라이언트 연결이 끊기면 취소
  const parentController = new AbortController();
  req.signal.addEventListener('abort', () => {
    parentController.abort(new DOMException('Client disconnected', 'AbortError'));
  }, { once: true });
  
  // A → B, A → C: 각각 자식 Signal 생성
  const [resultB, resultC] = await Promise.all([
    serviceB.call({ ...req, signal: createChildSignal(parentController.signal, 10000).signal }),
    serviceC.call({ ...req, signal: createChildSignal(parentController.signal, 10000).signal }),
  ]);
  
  return { resultB, resultC };
}

// Service B가 다시 Service D를 호출
class ServiceB {
  async call(req: CancellableRequest): Promise<Result> {
    const childController = createChildSignal(req.signal, 5000);
    
    // 여러 하위 작업을 취소 가능하게 실행
    try {
      const [dbResult, dResult] = await Promise.all([
        this.queryDatabase(childController.signal),
        serviceD.call({ signal: createChildSignal(childController.signal).signal }),
      ]);
      
      return { dbResult, dResult };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // 취소 시 정리 작업 수행
        await this.rollbackPartialWork();
      }
      throw err;
    }
  }
}
```

### 5.3 AI Agent 시스템에서의 Task Cancellation

AI Agent 환경에서는 취소가 더 복잡하다 — LLM 호출, 툴 실행, 상태 업데이트가 동시에 일어나기 때문:

```typescript
// Agent Task 실행기 — 취소 가능한 Agent 실행
class AgentTaskRunner {
  async executeTask(
    task: AgentTask,
    token: CancellationToken
  ): Promise<AgentResult> {
    // 1단계: 계획 수립 (취소 가능)
    token.throwIfCancelled();
    const plan = await this.plan(task, token);
    
    // 2단계: 단계별 실행 (각 단계에서 취소 확인)
    const results: StepResult[] = [];
    for (const step of plan.steps) {
      token.throwIfCancelled(); // 매 단계마다 취소 확인
      
      // 타임아웃이 있는 상태에서 LLM 호출
      const llmToken = new AbortSignalToken(
        AbortSignal.timeout(30000) // 각 LLM 호출은 30초 제한
      );
      
      const stepResult = await this.executeStep(step, {
        ...llmToken,
        parentToken: token,
      });
      
      results.push(stepResult);
    }
    
    return this.synthesize(task, results);
  }
  
  private async executeStep(
    step: Step,
    context: { parentToken: CancellationToken }
  ): Promise<StepResult> {
    // LLM 추론 + 툴 호출을 동시 실행
    const [llmResponse, toolResults] = await Promise.all([
      this.callLLM(step.prompt, context.parentToken),
      this.callTools(step.tools, context.parentToken),
    ]);
    
    return { llmResponse, toolResults };
  }
}
```

### 5.4 Cache Stampede 방어와 조기 취소

오늘의 System Design Knowledge Pill 주제인 **Cache Stampede**도 취소 메커니즘과 밀접한 관련이 있다:

```typescript
// Cache Stampede 방어 + Signal 기반 조기 완료
class CacheStampedeDefender<T> {
  private inflight = new Map<string, {
    promise: Promise<T>;
    controller: AbortController;
  }>();
  
  async get(key: string, fetch: (signal: AbortSignal) => Promise<T>): Promise<T> {
    // 이미 진행 중인 요청이 있다면 — Signal을 공유
    const existing = this.inflight.get(key);
    if (existing) return existing.promise;
    
    const controller = new AbortController();
    
    const promise = fetch(controller.signal).finally(() => {
      this.inflight.delete(key);
    });
    
    this.inflight.set(key, { promise, controller });
    
    // 경합: 첫 번째 완료자가 나머지 취소
    const result = await promise;
    
    // 같은 키로 대기 중인 다른 요청들은 자동 취소
    // (Signal을 공유하지 않고 각자 fetch했다면 중복 요청이 발생했을 것)
    
    return result;
  }
}
```

---

## 6. 고급 패턴: AbortSignal.any()와 복합 취소

2025년 표준에 포함된 `AbortSignal.any()`는 여러 Signal 중 **하나라도** 취소되면 함께 취소되는 복합 Signal을 생성한다:

```typescript
// AbortSignal.any() — N 중 1 취소 = 전체 취소
function fetchWithMultipleGuards(url: string) {
  const pageVisibility = new AbortController();
  
  // 페이지가 숨겨지면 취소
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      pageVisibility.abort(new DOMException('Page hidden', 'AbortError'));
    }
  }, { signal: pageVisibility.signal }); // ★ 리스너 자기 자신도 취소 가능
  
  const combined = AbortSignal.any([
    AbortSignal.timeout(8000),      // 8초 타임아웃
    pageVisibility.signal,           // 페이지 숨김
    userAbortController.signal,      // 사용자 명시적 취소
  ]);
  
  return fetch(url, { signal: combined });
}
```

### AbortSignal.any() vs RaceSignals()

둘의 차이는 **취소 이유 전파**에 있다:

```typescript
// AbortSignal.any() — 첫 번째 취소 이유를 사용
const combined = AbortSignal.any([sig1, sig2]);
// combined.reason === 먼저 취소된 Signal의 reason

// 수동 RaceSignals — 취소 이유를 명시적으로 전파
function raceSignals(signals: AbortSignal[]) {
  const controller = new AbortController();
  for (const sig of signals) {
    sig.addEventListener('abort', () => {
      controller.abort(sig.reason); // 명시적 이유 전파
    }, { once: true });
  }
  return controller;
}
```

실무에서는 `AbortSignal.any()`가 더 간결하고 표준에 가깝지만, 취소 이유에 따른 분기 처리가 필요하다면 수동 구현이 유리하다.

---

## 7. 실전 응용: React Query + 취소 통합

React Query의 `queryFn`은 이미 `AbortSignal`을 인자로 받는다. 하지만 대부분의 코드는 이를 무시한다:

```typescript
// ❌ React Query에서 Signal 무시
const { data } = useQuery({
  queryKey: ['search', query],
  queryFn: () => fetchSearch(query), // 취소 불가능
});

// ✅ React Query에서 Signal 활용
const { data } = useQuery({
  queryKey: ['search', query],
  queryFn: ({ signal }) => fetchSearch(query, signal), // 취소 가능
});

async function fetchSearch(query: string, signal: AbortSignal): Promise<Result[]> {
  // debounce + 취소: 이전 요청이 자연스럽게 취소됨
  await delay(300, signal); // AbortSignal을 지원하는 delay 함수
  const res = await fetch(`/api/search?q=${query}`, { signal });
  return res.json();
}

// AbortSignal을 지원하는 delay 유틸리티
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}
```

이 패턴을 적용하면:
- 검색어를 빠르게 입력할 때 이전 요청이 자동 취소
- 네트워크 요청과 디바운스 타이머가 모두 취소됨
- 불필요한 setState와 리렌더링 방지

---

## 8. 자가 검토: 패턴 선택 가이드

| 패턴 | 사용 시기 | 주의사항 |
|---|---|---|
| `new AbortController()` | 단일 작업 취소 | 메모리 누수 방지를 위한 리스너 정리 |
| `createChildSignal()` | 계층적 취소가 필요할 때 | 부모-자식 생명주기 일치 필요 |
| `raceSignals()` | 여러 취소 조건 중 가장 빠른 것 | 취소 이유가 혼동될 수 있음 |
| `AbortSignal.timeout()` | 단순 타임아웃 | TimeoutError vs AbortError 구분 필요 |
| `AbortSignal.any()` | 복합 취소 조건 (표준) | 브라우저 지원 확인 (2025+) |
| `CancellationToken` | 환경 독립적 추상화 | 오버 엔지니어링 주의 |

---

## 9. 결론: Cancel Culture in Engineering

AbortController는 단순한 API가 아니다. 이것은 **비동기 작업의 생명주기 관리**에 대한 언어 수준의 선언이다. 자바의 `InterruptedException`이나 C#의 `CancellationToken`과 달리, JavaScript의 AbortSignal은:

1. **Push 기반**이다 — 소비자가 주기적으로 폴링하지 않아도 취소를 통지받는다.
2. **조합 가능(Composable)** 하다 — `AbortSignal.any()`, `createChildSignal()`, `raceSignals()` 등으로 복합 취소 조건을 자연스럽게 표현할 수 있다.
3. **에러와 취소를 분리**한다 — `AbortError`는 에러 핸들러가 아닌 취소 핸들러가 처리하며, 이는 시스템의 복원력을 높인다.

분산 Agent 시스템이 보편화될수록, 취소 메커니즘은 단순한 UX 개선을 넘어 **리소스 효율성과 시스템 안정성의 핵심 요소**로 자리잡을 것이다. 오늘 다룬 AbortController의 설계 원칙 — Idempotency, Reason Propagation, Late Subscriber Safety — 은 단일 스레드 JavaScript를 넘어, 분산 시스템 전체에 적용될 수 있는 보편적인 취소 아키텍처의 기초를 제공한다.

---

> **참고 자료**
> - [AbortController MDN](https://developer.mozilla.org/en-US/docs/Web/API/AbortController)
> - [AbortSignal MDN](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal)
> - [WHATWG Specification: AbortController](https://dom.spec.whatwg.org/#interface-abortcontroller)
> - [TC39 Proposal: AbortSignal.any()](https://github.com/tc39/proposal-abort-signal-any)
