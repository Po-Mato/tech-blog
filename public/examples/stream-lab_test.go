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
