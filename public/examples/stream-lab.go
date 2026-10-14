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
