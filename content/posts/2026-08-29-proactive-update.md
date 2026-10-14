---
title: "데이터 중심 클라우드 설계: 보안과 스트림 처리"
date: 2026-08-29
author: "춘식"
tags: ["Cloud-Native", "Microservices", "System-Design", "2026-Trends"]
description: "서비스 간 데이터 흐름에서 보안, 지연 시간, 무결성을 함께 고려하는 방법을 스트림 처리 예시와 함께 살펴봅니다."
---

## 들어가는 말
서비스를 분리한 뒤에도 데이터가 어디서 멈추고 누가 연결을 정리하는지 결정해야 한다. 이 글은 보안과 처리 성능을 하나의 유행으로 묶기보다, 소비자가 읽기를 중단했을 때 처리 작업을 어떻게 종료할지 작은 Go 실습으로 확인한다.

## Deep Dive: 데이터 집중형 클라우드 네이처의 변화
데이터 흐름을 검토할 때는 처리량뿐 아니라 입력 종료, 느린 소비자, 취소 이후의 자원 정리도 살펴본다. 아래 실습은 한 프로세스 안의 채널을 다룬다. 분산 시스템의 전달 보장이나 메시지 큐를 대체하는 구현은 아니다.

### 1. Zero-Trust 기반의 데이터 보안
서비스 간 통신에서는 호출 주체 확인과 권한 검토, 전송 보호의 경계를 설계해야 한다. mTLS 도입 여부와 인증서 운영은 실제 위협 모델과 인프라에 맞춰 검토할 별도 주제다. 아래 정수 변환 코드는 인증·인가·mTLS를 구현하거나 검증하지 않는다.

### 2. 고성능 실시간 데이터 처리
여기서 성능 우위를 측정하지는 않는다. 기존 예시처럼 출력 채널에 바로 보내면 소비자가 사라진 뒤 송신에서 멈춰 바깥쪽 취소 분기로 돌아오지 못할 수 있다. 입력 채널이 닫힌 경우도 수신의 ok를 확인해야 한다.

[Go 공식 pipeline 문서](https://go.dev/blog/pipelines)는 소비자가 일찍 멈출 때 송신 측도 종료할 수 있어야 한다고 설명한다. 이를 context 취소와 함께 작은 단계로 구현한다.

## 로컬 실습: 채널 종료와 취소 확인
Go 1.25 이상을 준비한다. 이 예제는 Go 1.25.7, macOS arm64에서 실행과 race 검사를 확인했다. 표준 라이브러리만 사용하며 네트워크 호출·외부 패키지·자격증명이 없다. 새 실습 폴더에 두 파일을 저장한다.

[프로그램 다운로드](/examples/stream-lab.go) · [테스트 다운로드](/examples/stream-lab_test.go)

### 프로그램: stream-lab.go
생산자는 입력을 닫고 Stage만 출력을 닫는다. done은 출력 종료 이후 닫히므로 테스트가 종료 완료를 기다릴 수 있다. 변환 함수는 짧고 종료하는 계산이어야 한다.

```go
package main

import (
	"context"
	"fmt"
)

// Stage owns out and done. The producer owns and closes in.
// transform must finish on its own; context cannot interrupt arbitrary code.
func Stage(ctx context.Context, in <-chan int, transform func(int) int) (<-chan int, <-chan struct{}) {
	out := make(chan int)
	done := make(chan struct{})
	go func() {
		defer close(done)
		defer close(out)
		for {
			select {
			case <-ctx.Done():
				return
			case value, ok := <-in:
				if !ok {
					return
				}
				result := transform(value)
				select {
				case <-ctx.Done():
					return
				case out <- result:
				}
			}
		}
	}()
	return out, done
}

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	in := make(chan int, 3)
	for _, value := range []int{1, 2, 3} {
		in <- value
	}
	close(in)
	out, done := Stage(ctx, in, func(n int) int { return n * 2 })
	for value := range out {
		fmt.Println(value)
	}
	<-done
	fmt.Println("완료: 입력 종료와 출력 종료 확인")
}
```

### 테스트: stream-lab_test.go
정상 값과 순서, 빈 입력, 입력 대기 취소, 소비자가 없는 출력의 취소를 확인한다. 마지막 검사는 변환 도달 신호를 기다린 다음 취소하고, 종료 전에는 출력을 받지 않는다. 임의 Sleep으로 실행 상태를 추측하지 않는다. 각 대기는 1초 제한이며 실패한 구현도 정리 단계에서 출력 대기를 해소한다.

```go
package main

import (
	"context"
	"reflect"
	"testing"
	"time"
)

func waitDone(t *testing.T, done <-chan struct{}) {
	t.Helper()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("처리 goroutine 종료 시간 초과")
	}
}

func TestNormalAndClosedInput(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	in := make(chan int, 3)
	for _, n := range []int{1, 2, 3} {
		in <- n
	}
	close(in)
	out, done := Stage(ctx, in, func(n int) int { return n * 2 })
	t.Cleanup(func() { cancel(); waitDone(t, done) })
	var got []int
	timer := time.NewTimer(time.Second)
	defer timer.Stop()
	for {
		select {
		case n, ok := <-out:
			if !ok {
				if !reflect.DeepEqual(got, []int{2, 4, 6}) {
					t.Fatalf("결과: %v", got)
				}
				waitDone(t, done)
				return
			}
			got = append(got, n)
		case <-timer.C:
			t.Fatal("출력 종료 시간 초과")
		}
	}
}

func TestEmptyInput(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	in := make(chan int)
	close(in)
	out, done := Stage(ctx, in, func(n int) int { return n })
	t.Cleanup(func() { cancel(); waitDone(t, done) })
	select {
	case _, ok := <-out:
		if ok {
			t.Fatal("닫힌 입력에서 값 생성")
		}
	case <-time.After(time.Second):
		t.Fatal("빈 입력 종료 시간 초과")
	}
	waitDone(t, done)
}

func TestCancelWaitingForInput(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	in := make(chan int)
	out, done := Stage(ctx, in, func(n int) int { return n })
	t.Cleanup(func() { cancel(); close(in); waitDone(t, done) })
	cancel()
	cancel() // Repeated cancellation is safe.
	waitDone(t, done)
	if _, ok := <-out; ok {
		t.Fatal("취소된 입력 대기에서 값 생성")
	}
}

func TestCancelWithoutOutputConsumer(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	in := make(chan int, 1)
	in <- 7
	close(in)
	reached := make(chan struct{})
	out, done := Stage(ctx, in, func(n int) int { close(reached); return n })
	t.Cleanup(func() {
		cancel()
		// Drain only during cleanup so a broken direct-send variant can exit.
		deadline := time.NewTimer(time.Second)
		defer deadline.Stop()
		for {
			select {
			case <-done:
				return
			case _, ok := <-out:
				if !ok {
					waitDone(t, done)
					return
				}
			case <-deadline.C:
				t.Error("정리 시간 초과")
				return
			}
		}
	})
	select {
	case <-reached: // Input was received and transformation reached the output boundary.
	case <-time.After(time.Second):
		t.Fatal("변환 도달 시간 초과")
	}
	cancel()
	// Do not receive out before done: the consumer has stopped.
	waitDone(t, done)
	if _, ok := <-out; ok {
		t.Fatal("소비자 없는 출력에 값이 남음")
	}
}
```

### 실행과 예상 결과
두 파일이 있는 폴더에서 실행한다. 아래 환경 변수 표기는 macOS/Linux 셸 기준이다. GOTOOLCHAIN=local은 설치된 Go만 사용하고 GOPROXY=off는 패키지 프록시 사용을 막는다.

```sh
GOTOOLCHAIN=local GOPROXY=off go run stream-lab.go
GOTOOLCHAIN=local GOPROXY=off go test -v -count=1 -timeout=10s stream-lab.go stream-lab_test.go
GOTOOLCHAIN=local GOPROXY=off go test -race -count=10 -timeout=30s stream-lab.go stream-lab_test.go
```

첫 명령의 출력은 다음과 같다. 테스트는 네 Test 함수가 PASS이고 종료 코드가 0이어야 한다. race 검사는 지원되는 플랫폼과 C 컴파일러가 필요하다. race 실행 실패를 일반 테스트 통과로 대체해서 해석하지 않는다.

```text
2
4
6
완료: 입력 종료와 출력 종료 확인
```

검사 실패 시 ‘처리 goroutine 종료 시간 초과’는 종료 신호를 받지 못했다는 뜻이며 처리량 측정값이 아니다. 출력의 select를 직접 송신으로 되돌린 변형에서는 소비자 없는 취소 검사가 실패한다. 입력 ok 검사를 제거한 변형에서는 빈 입력 검사가 실패한다. 블로그 회귀 검사에서 이 두 변형을 임시 폴더에서 실행해 테스트가 문제를 잡는지도 확인한다.

### 취소의 범위와 정리
[context 문서](https://pkg.go.dev/context)에 따라 cancel을 호출해 관련 자원을 해제한다. 다만 취소는 임의 코드의 강제 중단이 아니다. transform이 무한 계산이나 취소를 무시하는 외부 I/O에 들어가면 이 Stage도 끝나지 않는다. 실제 I/O는 취소를 지원하는 API와 별도 제한 시간이 필요하다.

취소와 송수신이 동시에 준비될 때 취소만 우선한다고 가정하지 않는다. 이 예제는 ‘취소 직후 추가 처리 0개’나 트랜잭션 롤백을 보장하지 않는다. 처리 단계가 소유한 채널의 종료와 대기 해소를 확인하는 실습이다. 실행 후 만든 두 파일과 실습 폴더를 지우면 된다. Go 도구의 빌드 캐시는 별도로 남을 수 있다.

## 결론
정상 데이터 처리만으로 스트림의 생명주기를 검증할 수는 없다. 생산자의 입력 종료, 소비자의 조기 종료, 처리 단계의 출력 종료를 각각 정하고 테스트해야 한다. 다음 단계로 외부 I/O를 붙일 때도 이 종료 계약을 먼저 유지한다.
