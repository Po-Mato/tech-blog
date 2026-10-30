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
