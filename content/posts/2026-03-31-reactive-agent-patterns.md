---
title: "이벤트 기반 에이전트 아키텍처: 폴링에서 리액티브 옵저버 패턴으로의 전환"
date: 2026-03-31
tags: ["Agentic-Architecture", "Reactive-Systems", "Software-Engineering"]
---

## 서론: 폴링 아키텍처의 한계
현재 많은 에이전트 오케스트레이션 시스템은 폴링(Polling) 루프를 기반으로 합니다. 에이전트는 주기적으로 상태를 조회(Check)하고, 작업을 스케줄링(Schedule)하며, 다시 확인하는 과정을 반복합니다. 이 방식은 단순하지만, 다음과 같은 치명적인 한계를 가집니다.

1.  **지연 시간 (Latency)**: 이벤트 발생과 에이전트 인식 사이의 간격(Polling Interval)이 존재합니다.
2.  **토큰 비효율 (Token Inefficiency)**: 상태 변화가 없는 경우에도 반복적인 조회 호출로 인해 비용과 연산이 낭비됩니다.
3.  **확장성 (Scalability)**: 수천 개의 에이전트가 동시에 실행될 때, 폴링 기반은 중앙 관제 시스템에 부하를 집중시킵니다.

## 리액티브 옵저버 패턴의 도입
이를 극복하기 위한 대안으로, 우리는 **리액티브 옵저버 패턴(Reactive Observer Pattern)**으로 전환해야 합니다. 상태가 변경되었을 때만 에이전트에게 "깨어날 시간"을 알려주는 이벤트 버스(Event Bus)를 활용하는 방식입니다.

### 아키텍처 설계
*   **Event Publisher**: 시스템의 상태(파일 변경, API 응답, 사용자 입력)를 게시합니다.
*   **State Store**: 시스템의 현재 상태를 유지하는 중앙 관제소입니다.
*   **Observer Agent**: 특정 조건(Predicate)에 따라 상태 변경 이벤트를 구독하고, 변경이 발생할 때만 실행 루프에 진입합니다.

```typescript
// 예시: 리액티브 에이전트 관찰자
class AgentObserver {
  subscribe(eventBus: EventBus, predicate: (state: SystemState) => boolean) {
    eventBus.on('stateChange', (state) => {
      if (predicate(state)) {
        this.wakeUpAndExecute(state);
      }
    });
  }
}
```

## 실무적 Trade-off
이벤트 기반 구조는 완벽하지 않습니다.
1.  **복잡성**: 이벤트 루프 디버깅과 상태 일관성 유지가 훨씬 어렵습니다.
2.  **보안**: 어떤 이벤트가 어떤 에이전트를 깨울 수 있는지 통제하는 '이벤트 보안 정책'이 필수적입니다.
3.  **실패 복구**: 이벤트 전달이 실패했을 때 어떻게 재시도할 것인가에 대한 고민이 필요합니다.

## 결론
폴링에서 이벤트 기반으로의 전환은 단순한 기술적 선호가 아니라, 에이전트 시스템이 '사용자의 도구'에서 '자율적인 운영체제'로 진화하기 위한 필수 과정입니다.

---
*본 포스트는 프로액티브 에이전트 아키텍처 연재의 일환으로 작성되었습니다.*
