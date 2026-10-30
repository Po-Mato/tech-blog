---
title: "개발 에이전트의 구성 요소: 추론, 도구, 메모리"
date: 2026-08-24
tags: ["AI", "Agentic AI", "Software Engineering", "2026 Trends"]
description: "추론·도구·메모리의 역할을 구분하고 Python 실습으로 재시도 예산, 취소, 종료 이유를 검증합니다."
---

## 들어가는 말: 코딩 어시스턴트에서 에이전트로

도구를 반복 실행하는 에이전트를 설계할 때는 실패 후 언제 다시 시도하고 언제 멈출지 정해야 합니다. 이 글에서는 구성 요소를 구분한 뒤, 외부 모델 없이 단일 작업의 종료 경계를 직접 검증합니다.

## Agentic AI의 아키텍처적 핵심

- **추론**: 다음 작업이나 계획을 제안합니다. 제안이 안전하거나 실행 가능하다는 보장은 별도로 검증해야 합니다.
- **도구**: 파일 읽기나 API 호출처럼 실제 효과를 만드는 인터페이스입니다. 권한과 실패 분류는 실행 계층에서 관리합니다.
- **메모리**: 이전 입력과 결과를 보관해 후속 판단에 제공합니다. 기록을 저장하는 것 자체가 모델 학습이나 품질 향상을 뜻하지는 않습니다.

### 간단한 워크플로우 예시 (Conceptual)

흐름은 계획 제안 → 허용된 도구 실행 → 결과 검사 → 종료 또는 다음 시도입니다. 기존 예제처럼 실패할 때 execute_task를 재귀 호출하면 지속 실패 시 재귀 한도에 도달하고, 돌아온 뒤 이전 계획을 계속 실행할 수도 있습니다. 재계획과 재시도를 구분하고 종료 결과를 호출자에게 반환해야 합니다.

### 로컬 실습: 재시도 예산과 취소

[retry-lab.py 전체 파일 받기](/examples/retry-lab.py). Python 3.10 이상과 표준 라이브러리만 필요합니다. 아래 전체 코드와 다운로드 파일은 같습니다. 별도 빈 폴더에 저장한 뒤 실행하세요.

```sh
python3 -I retry-lab.py
```

예상 결과는 `Ran 8 tests`와 `OK`, 종료 코드 0입니다. 실행 시간은 환경마다 다릅니다. 이 실습은 네트워크·sleep·실제 모델 재계획을 수행하지 않습니다.

| 조건 | 종료 이유 | 호출 횟수 |
| --- | --- | --- |
| 즉시 성공 | success | 1 |
| 일시 실패 후 성공 | success | 성공한 시도까지 |
| 영구 오류 | permanent_error | 첫 영구 오류까지 |
| 일시 실패만 반복 | exhausted | max_attempts |
| 시작 전 취소 | cancelled | 0 |
| 시도 사이 취소 | cancelled | 이미 실행한 횟수 |

max_attempts는 최초 호출을 포함합니다. 1 이상의 정수만 허용하며 bool은 거절합니다. 각 호출 직전에 취소를 검사하므로 실행 중인 동기 함수를 강제로 중단하지는 못합니다. 마지막 허용 시도라도 성공은 성공으로 반환하고, 이미 완료한 성공을 사후 취소로 바꾸지 않습니다.

```python
"""네트워크나 대기 없이 단일 작업의 재시도 경계를 검증합니다."""
from dataclasses import dataclass
import unittest


class RetryableError(Exception):
    pass


class PermanentError(Exception):
    pass


@dataclass(frozen=True)
class Result:
    reason: str
    attempts: int
    value: object = None
    error: str | None = None


def run_retry(task, max_attempts, cancelled=lambda: False):
    if type(max_attempts) is not int or max_attempts < 1:
        raise ValueError("max_attempts는 1 이상의 정수여야 합니다")
    attempts = 0
    last_error = None
    for _ in range(max_attempts):
        if cancelled():
            return Result("cancelled", attempts, error=last_error)
        attempts += 1
        try:
            value = task()
        except RetryableError as error:
            last_error = str(error)
        except PermanentError as error:
            return Result("permanent_error", attempts, error=str(error))
        else:
            return Result("success", attempts, value=value)
    return Result("exhausted", attempts, error=last_error)


class RetryTests(unittest.TestCase):
    def fixture(self, outcomes):
        calls = []

        def task():
            index = len(calls)
            calls.append(index)
            outcome = outcomes[min(index, len(outcomes) - 1)]
            if isinstance(outcome, BaseException):
                raise outcome
            return outcome

        return task, calls

    def test_success(self):
        for outcomes, budget in [(["완료"], 3),
                                 ([RetryableError("대기"), "완료"], 3),
                                 ([RetryableError("대기"), "완료"], 2)]:
            with self.subTest(outcomes=outcomes, budget=budget):
                task, calls = self.fixture(outcomes)
                self.assertEqual(run_retry(task, budget),
                                 Result("success", len(outcomes), "완료"))
                self.assertEqual(len(calls), len(outcomes))

    def test_permanent_error(self):
        task, calls = self.fixture([PermanentError("권한 없음"), "실행 금지"])
        self.assertEqual(run_retry(task, 3),
                         Result("permanent_error", 1, error="권한 없음"))
        self.assertEqual(len(calls), 1)

    def test_exhausted(self):
        task, calls = self.fixture([RetryableError("첫 오류"), RetryableError("마지막 오류")])
        self.assertEqual(run_retry(task, 2),
                         Result("exhausted", 2, error="마지막 오류"))
        self.assertEqual(len(calls), 2)

    def test_invalid_budget(self):
        for budget in [0, -1, True, False, 1.5, "2", None]:
            with self.subTest(budget=budget):
                task, calls = self.fixture(["실행 금지"])
                with self.assertRaises(ValueError):
                    run_retry(task, budget)
                self.assertEqual(calls, [])

    def test_cancel_before_start(self):
        task, calls = self.fixture(["실행 금지"])
        self.assertEqual(run_retry(task, 2, lambda: True), Result("cancelled", 0))
        self.assertEqual(calls, [])

    def test_cancel_between_attempts(self):
        task, calls = self.fixture([RetryableError("중단 요청"), "실행 금지"])
        self.assertEqual(run_retry(task, 3, lambda: bool(calls)),
                         Result("cancelled", 1, error="중단 요청"))
        self.assertEqual(len(calls), 1)

    def test_completed_success_wins(self):
        task, calls = self.fixture(["완료"])
        self.assertEqual(run_retry(task, 2, lambda: bool(calls)),
                         Result("success", 1, "완료"))
        self.assertEqual(len(calls), 1)

    def test_unexpected_errors_propagate(self):
        for error in [RuntimeError("버그"), KeyboardInterrupt(), SystemExit(2)]:
            with self.subTest(error=type(error).__name__):
                task, calls = self.fixture([error])
                with self.assertRaises(type(error)):
                    run_retry(task, 3)
                self.assertEqual(len(calls), 1)


if __name__ == "__main__":
    unittest.main()
```

### 결함을 넣어 종료 경계 확인하기

복사한 파일의 `range(max_attempts)`를 `range(max_attempts + 1)`로 바꾸고 같은 명령을 실행하세요. 예산 소진 검사가 호출 횟수 3과 기대값 2의 차이를 검출해 `FAILED`와 종료 코드 1을 반환해야 합니다. 확인 후 원래 코드를 복원합니다. 실패 여부뿐 아니라 실제 호출 횟수를 검사해야 초과 실행을 잡을 수 있습니다.

## 엔지니어가 준비해야 할 것

이 예제는 RetryableError만 재시도하고 PermanentError는 종료 결과로 반환합니다. 예상하지 않은 오류와 KeyboardInterrupt/SystemExit는 호출자에게 전파합니다. 실서비스의 어떤 오류가 일시적인지는 API 계약과 작업 성격을 근거로 분류해야 합니다.

재시도는 중복 부작용을 만들 수 있습니다. 결제·배포처럼 효과가 있는 작업에는 멱등성 키나 중복 방지, 재시도 간 백오프, 호출별 시간 제한과 전체 마감 시간을 별도로 설계해야 합니다. 이 실행기는 그런 기능이나 실행 중 강제 취소를 제공하지 않습니다. 여러 작업의 의존성과 실패 전파는 [작업 그래프 실습](/posts/2026-08-31-proactive-update/)에서 따로 다룹니다.

구현 근거는 Python 공식 [예외 처리](https://docs.python.org/3/tutorial/errors.html)와 [unittest](https://docs.python.org/3/library/unittest.html)입니다. 지정한 예외만 처리하고 다른 예외를 전파하는 동작, assertEqual/assertRaises 기반 검사를 사용했습니다.

## 맺음말

도구 실행 루프에서는 반복 여부만큼 종료 이유와 호출 횟수가 중요합니다. 이 실습의 fixture를 자신의 오류 분류로 바꾸어 예산 소진·영구 실패·취소 경계를 먼저 검증하세요. 모델의 판단 품질이나 실제 시스템의 성공률은 이 로컬 검사로 입증하지 않습니다.
