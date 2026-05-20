---
title: "Event Loop와 비동기 처리 모델: AI 에이전트 런타임의 핵심 설계 원칙"
date: "2026-05-20"
description: "Node.js에서 출발한 Event Loop가 어떻게 AI 에이전트 런타임의 핵심 설계 철학이 되었는지, non-blocking I/O에서 multi-agent 오케스트레이션까지 비동기 처리 모델의 심층 분석"
tags:
  - Event Loop
  - Async Processing
  - AI Agent Runtime
  - Node.js
  - Concurrency
  - Agent Orchestration
  - Non-blocking I/O
---

## 서론: Event Loop가 AI 에이전트 설계의 중심이 된 이유

 Event Loop는 2009년 Node.js의 등장과 함께 서버사이드 JavaScript의 상징이 되었습니다. 그러나 2026년 현재, Event Loop의 영향력은 서버 사이드 JS를 넘어서 AI 에이전트 런타임 설계의 핵심 철학이 되었습니다.

 단일 모델 호출 하나를 생각해 보자. 모델이 추론하는 동안 우리는 다른 작업을 수행해야 한다. 도구를 호출하고, 결과를 기다리고, 다시 모델에 전달하는 과정은 본질적으로 event-driven하다. 여러 에이전트가 동시에 실행되는 환경에서는 이 특성이 더욱 중요하다.

 이 글에서는 Event Loop의 작동 원리를 상세히 분석하고, 이를 AI 에이전트 오케스트레이션에 어떻게 적용하는지探讨한다.

---

## 1. Event Loop의 구조: 단일 스레드의魔法

### 1.1 기본 구조

 Event Loop의 가장 근본적인 설계는 **단일 스레드**로 concurrent한 작업을 처리하는 것이다. 핵심 아이디어는 간단하다: 하나의 스레드에서 빠른 작업을 계속 처리하고, 느린 작업(I/O, 네트워크 요청)은Callbacks나 Promise로 위임하는 것이다.

```
┌──────────────────────────────────────────────────────────┐
│                      Main Thread                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │                   Event Loop                        │  │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐             │  │
│  │  │ Call    │→ │  Poll   │→ │  Close  │             │  │
│  │  │ Stack   │  │  Phase  │  │  Phase  │             │  │
│  │  └─────────┘  └─────────┘  └─────────┘             │  │
│  │       ↑            ↓            ↑                  │  │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐             │  │
│  │  │ Timers  │  │ I/O     │  │ Check   │  → Loop   │  │
│  │  │ Phase   │  │ Callbacks│  │ Phase   │            │  │
│  │  └─────────┘  └─────────┘  └─────────┘             │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

Node.js의 Event Loop는 위와 같은 phases로 구성된다. 각 phase는了自己的queue를 가지고 있고, 해당 phase에 진입하면 queue가 empty가 될 때까지Callbacks를 처리한다.

### 1.2 왜 단일 스레드인가?

"여러 작업을 동시에 처리해야 하는데 왜 하나의 스레드만 쓰는가?"라는 질문에 대한 답은 **I/O 바운드 작업의 특성**에 있다.

대부분의 웹 서비스에서 스레드가 대기하는 시간은 I/O 대기(네트워크 요청, 디스크 읽기 등)이다. 스레드가 blocking 방식으로 I/O를 기다리면, 다른 요청을 처리하려면 추가 스레드가 필요하다. 그러나 Event Loop 방식에서는 I/O 작업이 완료된 후Callbacks를 실행하므로, 단일 스레드에서도 충분히 높은 throughput을 달성할 수 있다.

CPU 바운드 작업(암호화, 압축, 대규모 연산 등)이 많은 서비스에서는 오히려 worker threads나 별도 프로세스를 사용하는 것이 맞다. Event Loop는 **I/O 바운드 환경에서 높은 효율성**을 발휘한다.

### 1.3 non-blocking의 실제 의미

"non-blocking"이라는 표현은 혼동될 수 있다. 실제로는 **event-driven callback pattern**으로 동작한다.

```javascript
// Blocking 방식 (동시성 없음)
const result = db.query("SELECT * FROM users"); // 여기서 대기
console.log(result);
nextOperation(); // 이전 작업 완료后才能 실행

// Non-blocking 방식 (event-driven)
db.query("SELECT * FROM users", (error, result) => {
  console.log(result); // 완료 시 실행
});
nextOperation(); // 바로 실행, I/O는 background에서 진행
```

blocking 방식에서는 I/O 대기 시간이 낭비되지만, non-blocking에서는 I/O 요청 후 바로 다음 작업으로 이동한다. I/O 완료는event로 들어오고, 해당event handler가 실행된다.

---

## 2. AI 에이전트 런타임에서의 Event Loop 적용

### 2.1 에이전트 작업의 비동기적 특성

AI 에이전트의 작업 흐름은 본질적으로 event-driven하다:

1. **사용자 입력 event**: 새로운 작업 요청이 들어온다
2. **모델 추론 event**: LLM이 추론을 시작한다
3. **도구 호출 event**: 에이전트가 도구를 호출한다
4. **도구 완료 event**: 도구 실행이 완료되고 결과가 반환된다
5. **반복**: 에이전트가 다시 모델을 호출하거나 최종 응답을 생성한다

각 단계의Duration은 매우 다양하다. 사용자 입력은 밀리초 단위이지만, LLM 추론은 수 초에서 수십 초가 걸릴 수 있다.Blocking 방식으로 처리하면 에이전트는 추론 중 아무것도 할 수 없는 상태가 된다.

### 2.2 LangChain의 Callback mechanism

LangChain은 이 문제를 해결하기 위해 callback-based architecture를 사용한다:

```python
from langchain.callbacks.base import BaseCallbackHandler
from langchain.chat_models import ChatOpenAI

class AgentCallbackHandler(BaseCallbackHandler):
    def on_llm_start(self, serialized, prompts, **kwargs):
        print(f"추론 시작: {len(prompts[0])} 토큰")
    
    def on_llm_end(self, response, **kwargs):
        print(f"추론 완료: {response.generation[0].text[:50]}...")
    
    def on_tool_start(self, tool, input_str, **kwargs):
        print(f"도구 실행: {tool.name}")
    
    def on_tool_end(self, output, **kwargs):
        print(f"도구 완료: {output[:30]}...")

llm = ChatOpenAI(callbacks=[AgentCallbackHandler()])
```

이 callback architecture는 Event Loop의 phases와 유사하다. 각 작업 단계에서 event를 발생시키고, callback handler가 이를 처리한다.

### 2.3 Temporal Loop: 에이전트 전용 Event Loop

 전통적 Event Loop(노드 계열)는 다양한 종류의event를 unified queue로 처리한다. 그러나 AI 에이전트 환경에서는 작업의 특성에 따라 다른 우선순위와 처리 방식이 필요하다.

**Temporal Loop**라는 개념이 제안되었고, 이는 에이전트의 작업 특성에 맞게 설계된专用 Event Loop이다:

```python
class TemporalLoop:
    def __init__(self):
        # 에이전트 작업별 dedicated queues
        self.queues = {
            'urgent': [],      # 사용자 직접 입력
            'model': [],       # LLM 추론 작업
            'tool': [],        # 도구 호출
            'background': []   # 장기 백그라운드 작업
        }
        self.running = True
    
    async def tick(self):
        # 우선순위에 따라 작업 처리
        if self.queues['urgent']:
            task = self.queues['urgent'].pop(0)
            await self.process(task)
        
        elif self.queues['model']:
            task = self.queues['model'].pop(0)
            # 모델 추론은 병렬로 실행 가능
            asyncio.create_task(self.process_model(task))
        
        elif self.queues['tool']:
            task = self.queues['tool'].pop(0)
            asyncio.create_task(self.process_tool(task))
        
        else:
            # idle 상태, 백그라운드 정리 작업
            await self.run_gc()
        
        # Event Loop처럼 계속 순환
        if self.running:
            asyncio.get_event_loop().call_later(0.01, self.tick)
```

 이 구조의 핵심 이점은 **작업 우선순위에 따른 differentiated handling**이다. 긴급한 사용자 입력을 즉시 처리하고, 모델 추론은 병렬로 실행하며, 백그라운드 작업은 유휴 시간에 처리한다.

---

## 3. 비동기 처리 패턴과 에이전트 오케스트레이션

### 3.1 Promise chain vs async/await

 Event Loop에서 발전한 비동기 처리 패턴은 두 가지 주요 스타일이 있다:

**Promise Chain** (명령적 스타일):
```javascript
fetchUser(userId)
  .then(user => fetchPosts(user.id))
  .then(posts => fetchComments(posts[0].id))
  .then(comments => renderComments(comments))
  .catch(error => handleError(error));
```

**async/await** (동기 스타일):
```javascript
async function loadContent() {
  try {
    const user = await fetchUser(userId);
    const posts = await fetchPosts(user.id);
    const comments = await fetchComments(posts[0].id);
    return renderComments(comments);
  } catch (error) {
    handleError(error);
  }
}
```

AI 에이전트에서는 두 패턴을 모두 사용한다. 도구 호출이 독립적일 때는 Promise.all로 병렬 실행하고, 순차적 의존성이 있을 때는 async/await로 체인을 구성한다.

### 3.2 Multi-Agent 오케스트레이션에서의 Event Loop

여러 에이전트가 동시에 실행되는 환경에서는 Event Loop의 설계가 더욱 복잡해진다:

```
┌──────────────────────────────────────────────────────┐
│            Multi-Agent Event Orchestrator            │
├──────────────────────────────────────────────────────┤
│  ┌─────────┐  ┌─────────┐  ┌─────────┐              │
│  │ Agent A │  │ Agent B │  │ Agent C │   ...        │
│  │ Event Q │  │ Event Q │  │ Event Q │              │
│  └────┬────┘  └────┬────┘  └────┬────┘              │
│       │            │            │                   │
│       └────────────┼────────────┘                   │
│                    ↓                                │
│         ┌─────────────────────┐                    │
│         │  Shared Event Bus   │                    │
│         │  - inter-agent msg  │                    │
│         │  - resource locks   │                    │
│         │  - state changes    │                    │
│         └─────────────────────┘                    │
└──────────────────────────────────────────────────────┘
```

각 에이전트는 자체 Event Loop를 가지고 있고, 에이전트 간 통신은 shared event bus를 통해 이루어진다. 이를 통해 단일 에이전트의 응답성을 유지하면서도 전체 시스템의 coordinated execution을 달성한다.

### 3.3 에이전트 스케줄링: Priority Queue 기반

Event Loop의 timer phase에서 영감을 받은 **priority-based scheduling**이 에이전트 오케스트레이션에 적용된다:

```python
import heapq

class AgentScheduler:
    def __init__(self):
        self.pending_tasks = []
        self.running_tasks = {}
        self.max_concurrent = 5
    
    def schedule(self, task, priority=0, delay=0):
        execute_at = time.time() + delay
        heapq.heappush(self.pending_tasks, (execute_at, priority, task))
    
    async def run(self):
        while True:
            now = time.time()
            
            # 완료된 작업 정리
            done = [aid for aid, t in self.running_tasks.items() if t.done()]
            for aid in done:
                del self.running_tasks[aid]
            
            # 새 작업 시작
            while (self.pending_tasks and 
                   len(self.running_tasks) < self.max_concurrent):
                execute_at, priority, task = heapq.heappop(self.pending_tasks)
                if execute_at <= now:
                    self.running_tasks[id(task)] = asyncio.create_task(task)
            
            await asyncio.sleep(0.01)
```

이 scheduler는 **Event Loop의 timer phase와 동일한 원리**를 적용한다. 지연된 작업은 execute_at 시간까지 priority queue에 유지되고, 시간이 되면 실행된다. 동시에 실행되는 작업 수는 max_concurrent로 제한되어 resource exhaustion을 방지한다.

---

## 4. Event Loop의 한계와 에이전트 런타임에서의 해결책

### 4.1 CPU 바운드 작업의問題

 Event Loop의 근본적 한계는 **CPU 바운드 작업에 취약하다**는 것이다. 단일 스레드에서 긴 CPU 작업이 실행되면, event loop가block되어 다른 작업이 처리되지 않는다.

AI 에이전트에서 LLM 추론은 대표적인 CPU 바운드 작업이다. 많은 런타임이 이 문제를 해결하기 위해 다음 전략을 사용한다:

1. **별도 프로세스에서 추론 실행**: 메인 Event Loop를block하지 않기 위해 worker process에서 모델 추론을 실행한다
2. **Streaming 응답**: 토큰 단위로 결과를 반환하여 첫 번째 응답까지의 대기 시간을 최소화한다
3. **프로그레시브 처리**: 긴 추론을 작은 단계로 나누어 각 단계 후 event를 발생시킨다

### 4.2 starving 문제

 Event Loop에서 특정 phase의 queue가 계속 채워지면 다른 phase가starving할 수 있다. 예를 들어, I/O callbacks가 빠르게 생성되면 timers phase의 작업이 실행되지 않을 수 있다.

AI 에이전트 런타임에서는 이 문제를 해결하기 위해 **fair scheduling**을 구현한다:

```python
class FairEventLoop:
    def __init__(self):
        self.phases = ['urgent', 'model', 'tool', 'timers', 'idle']
        self.phase_index = 0
        self.max_per_phase = 10  # 각 phase에서 최대 처리 수
    
    async def tick(self):
        for _ in range(len(self.phases)):
            current_phase = self.phases[self.phase_index]
            processed = 0
            
            while self.has_tasks(current_phase) and processed < self.max_per_phase:
                task = self.get_task(current_phase)
                await self.process(task)
                processed += 1
            
            self.phase_index = (self.phase_index + 1) % len(self.phases)
```

이 구조는 **round-robin 방식**으로 각 phase를 번갈아가며 처리하여 starvation을 방지한다.

### 4.3 에러 전파와恢复

 Event Loop에서 예외가 발생하면 보통 해당 callback에서만 처리되고 다른 callbacks는 계속 실행된다. 그러나 AI 에이전트에서는 작업 간 의존성이 있으므로, 에러의 전파 방식이 중요하다.

```python
class ResilientAgentLoop:
    def __init__(self):
        self.error_handlers = []
        self.task_history = []
    
    async def run_task(self, task):
        try:
            result = await task.execute()
            self.task_history.append({'task': task.id, 'status': 'success', 'result': result})
            return result
        except Exception as e:
            # 에러 로깅
            for handler in self.error_handlers:
                handler.on_task_error(task, e)
            
            # 필요시 재시도
            if task.should_retry():
                return await self.run_task(task.retry())
            
            # 실패 기록
            self.task_history.append({'task': task.id, 'status': 'failed', 'error': str(e)})
            raise
```

에러发生后立即的处理而不是让整个系统崩溃这一点在Event Loop和Agent Runtime中都适用。

---

## 5. 실제 적용: Cursor AI의 Event-Driven Architecture

 Cursor AI의 에디터는典型的인 event-driven architecture를 사용한다. 사용자의 입력이 발생하면 event로 처리되고, AI 추론은background에서 비동기적으로 실행된다:

1. **입력 이벤트**: 사용자가 코드 작성 요청을 입력한다
2. **변경 이벤트**: 버퍼가 변경되면 completion request가 큐에 추가된다
3. **추론 이벤트**: LLM이background에서 추론을 실행한다
4. **표시 이벤트**: 추론이 완료되면 제안이 UI에 표시된다

이 구조 덕분에 에디터는 AI 추론이 진행되는 동안에도 responsively 유지된다. 사용자는 추론 완료를 기다리지 않고 계속 코딩할 수 있다.

---

## 결론: Event Loop의 철학이 AI 에이전트 설계에 남긴 자산

 Event Loop는 단순한 기술적 구현이 아니라 **동시성 확보를 위한 철학적 접근법**이다:

1. **단일 스레드 + non-blocking**: 느린 작업에 blocking되지 않고 효율적으로 자원을 활용한다
2. **event-driven callbacks**: 완료 대기가 아니라 완료 시 실행 패턴으로 responsiveness를 확보한다
3. **phase-based processing**: 작업의 종류에 따라異なる handling으로 predictability를 제공한다
4. **fair scheduling**: starvation 방지로 시스템 전체의 stability를 유지한다

AI 에이전트 런타임은 이 원칙들을 그대로 차용한다. 에이전트가 도구를 호출하고 결과를 기다리는 동안 다른 작업을 수행하고, 도구 완료 시 event handler가 이를 처리하며, 우선순위에 따라 작업이 스케줄링된다.

 Event Loop가 servidor사이드 JavaScript의 패러다임을 바꾼 것처럼, event-driven architecture는 AI 에이전트의 설계 원칙을 재정의하고 있다. 앞으로의 AI 에이전트 런타임은 더 복잡한 multi-agent 시나리오를 처리해야 하고, Event Loop의 교훈은 그 핵심 설계 가이드가 될 것이다.

---

*본 포스트는 시스템 디자인 지식 필 연재의 일환으로 작성되었습니다.*