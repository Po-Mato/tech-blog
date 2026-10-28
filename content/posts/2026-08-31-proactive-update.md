---
title: "AI 에이전트의 작업 분해와 컨텍스트 관리"
date: 2026-08-31
tags: ["AI", "AgenticAI", "SoftwareEngineering", "DevOps"]
description: "Python 단일 파일 실습으로 작업 의존성 검증, 실패 전파, 후속 작업 건너뜀과 독립 작업 실행을 확인합니다."
---

# AI 에이전트의 작업 분해와 컨텍스트 관리

작업을 여러 단계로 나누는 것만으로 실행이 안전해지지는 않습니다. 앞 단계가 실패했을 때 어떤 작업을 멈추고 어떤 작업을 계속할지 명시해야 합니다. 이 글은 **이미 정해진 작업 그래프를 순차 실행하는 로컬 실습**입니다. 모델 추론이나 자동 작업 분해, 실제 배포를 구현하지 않습니다.

## 1. AI 어시스턴트에서 Agentic AI로

코드 생성 도구에 여러 작업을 맡길 때도 실행 상태를 검토할 수 있어야 합니다. 여기서는 작업마다 선행 작업과 실행 함수를 선언합니다. 모든 선행 작업이 성공해야 다음 작업을 실행하고, 실패와 건너뜀을 구분합니다. 서로 독립적인 작업은 계속합니다.

## 2. 기술적 깊이: Agentic AI의 작동 원리

이 실습은 추론 대신 실행 계약에 집중합니다. `build → test → package → publish`에서 test가 실패하면 package와 publish는 실행하지 않습니다. 독립적인 docs는 성공할 수 있습니다. 결과의 blocked_by는 바로 앞의 차단 원인을 가리키므로 publish의 원인은 package입니다.

### 코드 예시: 간단한 Task Orchestration (Python)

입력 ID는 비어 있지 않고 고유해야 하며 실행 함수는 호출 가능해야 합니다. 없는 선행 작업과 순환은 어떤 함수도 실행하기 전에 거절합니다. 실행 함수가 예외 없이 반환하면 성공으로 정의합니다. 반환값 False도 자동으로 실패가 되지 않으므로 실패를 알릴 때는 예외를 발생시켜야 합니다.

### 로컬 실습: 실패와 건너뜀 구분하기

Python 3.10 이상과 표준 라이브러리만 사용합니다. [task-lab.py 내려받기](/examples/task-lab.py). 아래 전체 코드와 다운로드 파일은 같습니다.

```python
"""Python 3.10+ 표준 라이브러리 작업 상태 실습: 외부 요청 없음."""
from dataclasses import dataclass
from graphlib import TopologicalSorter
from typing import Callable
import unittest


@dataclass(frozen=True)
class Task:
    id: str
    needs: tuple[str, ...]
    run: Callable[[], object]


def run_tasks(tasks: list[Task]) -> dict:
    by_id = {}
    for task in tasks:
        if not isinstance(task.id, str) or not task.id.strip():
            raise ValueError("빈 작업 ID")
        if task.id in by_id:
            raise ValueError("중복 작업 ID")
        if not callable(task.run):
            raise ValueError("호출 불가능한 작업")
        by_id[task.id] = task
    for task in tasks:
        if any(dep not in by_id for dep in task.needs):
            raise ValueError("없는 선행 작업")
    # 전체 순서를 먼저 확정한다. 순환이 있으면 실행 전에 CycleError.
    order = tuple(TopologicalSorter({t.id: t.needs for t in tasks}).static_order())
    results = {}
    for task_id in order:
        task = by_id[task_id]
        blocked = [dep for dep in task.needs if results[dep]["state"] != "success"]
        if blocked:
            results[task_id] = {"state": "skipped", "blocked_by": blocked}
            continue
        try:
            value = task.run()
        except Exception as error:
            results[task_id] = {"state": "failed", "error": str(error)}
        else:
            results[task_id] = {"state": "success", "value": value}
    return results


class TaskTests(unittest.TestCase):
    def setUp(self):
        self.calls = []

    def task(self, name, needs=(), fail=False):
        def action():
            self.calls.append(name)
            if fail:
                raise RuntimeError("검증 실패")
            return name + " 완료"
        return Task(name, needs, action)

    def test_success_and_once(self):
        tasks = [self.task("build"), self.task("test", ("build",)),
                 self.task("package", ("build", "test"))]
        result = run_tasks(tasks)
        self.assertEqual([r["state"] for r in result.values()], ["success"] * 3)
        self.assertEqual(result["package"]["value"], "package 완료")
        self.assertEqual(self.calls, ["build", "test", "package"])

    def test_failure_propagation_and_independent_work(self):
        tasks = [self.task("build"), self.task("test", ("build",), fail=True),
                 self.task("package", ("build", "test")),
                 self.task("publish", ("package",)), self.task("docs")]
        result = run_tasks(tasks)
        self.assertEqual(result["test"], {"state": "failed", "error": "검증 실패"})
        self.assertEqual(result["package"], {"state": "skipped", "blocked_by": ["test"]})
        self.assertEqual(result["publish"], {"state": "skipped", "blocked_by": ["package"]})
        self.assertEqual(result["docs"]["state"], "success")
        self.assertCountEqual(self.calls, ["build", "test", "docs"])

    def test_invalid_graph_runs_nothing(self):
        cases = [
            [self.task("a"), self.task("a")],
            [self.task("a", ("missing",))],
            [self.task("a", ("a",))],
            [self.task("a", ("b",)), self.task("b", ("a",))],
            [self.task(" ")], [Task("a", (), None)],
        ]
        for tasks in cases:
            with self.subTest(tasks=tasks):
                with self.assertRaises(ValueError):
                    run_tasks([self.task("independent")] + tasks)
                self.assertEqual(self.calls, [])

    def test_empty(self):
        self.assertEqual(run_tasks([]), {})

    def test_process_signals_propagate(self):
        for exception in (KeyboardInterrupt, SystemExit):
            def stop():
                raise exception()
            with self.assertRaises(exception):
                run_tasks([Task("stop", (), stop)])


if __name__ == "__main__":
    unittest.main(verbosity=2)
```

파일을 빈 폴더에 저장하고 다음 명령을 실행합니다. 네트워크 요청이나 파일 쓰기는 없습니다.

```sh
python3 -I task-lab.py
```

정상 결과는 `Ran 5 tests`와 `OK`입니다. 테스트는 전부 성공, 다중 선행 작업 중 실패, 여러 단계 건너뜀, 독립 작업 계속, 정확한 호출 횟수, 잘못된 그래프의 호출 0회, 빈 그래프, 프로세스 중단 신호를 확인합니다.

실패 사례의 기대 상태는 다음과 같습니다. 실행 순서가 아닌 작업별 결과 표입니다.

| 작업 | 상태 | 이유 |
| --- | --- | --- |
| build | success | 실행 함수 정상 반환 |
| test | failed | 검증 실패 예외 |
| package | skipped | test 실패 |
| publish | skipped | package 건너뜀 |
| docs | success | 실패 작업과 독립적 |

검사가 결함을 잡는지 확인하려면 복사본에서 `if blocked:`를 `if False:`로 바꾸고 다시 실행하세요. 후속 작업이 실행되어 실패 전파 검사가 `FAILED`와 비정상 종료 코드로 끝나야 합니다. 실험 후 원문 파일로 되돌리거나 실습 폴더를 삭제합니다.

## 3. 엔지니어가 준비해야 할 것

위상 정렬은 실행 순서만 정합니다. 작업 성공을 보장하지 않습니다. Python의 TopologicalSorter는 정의하지 않은 선행 노드를 자동 추가하기 때문에 이 실습은 누락 검사를 별도로 수행합니다. 순환 검사는 전체 실행 전에 끝냅니다.

각 함수는 한 실행에서 최대 한 번 호출하지만 프로그램을 다시 실행하면 다시 호출됩니다. 영속 저장·중복 요청 방지·트랜잭션·롤백은 제공하지 않습니다. 실패 전 발생한 부작용을 되돌리지도 않습니다. 함수가 멈추지 않으면 전체 실행도 기다리므로 실제 서비스에는 별도의 시간 제한과 격리가 필요합니다. 재시도·병렬 처리·외부 모델 호출은 범위 밖입니다. KeyboardInterrupt와 SystemExit는 작업 실패로 삼키지 않고 호출자에게 전달합니다.

### 결론

상태 기록은 막연한 완료 메시지보다 구체적이어야 합니다. 먼저 입력 그래프를 검증하고 성공·실패·건너뜀을 나눈 뒤, 실패한 작업의 후속 함수가 실제로 호출되지 않았는지 검사하세요.

근거: [Python graphlib — 위상 정렬과 순환](https://docs.python.org/3/library/graphlib.html), [Python unittest — 테스트 실행과 예외 검사](https://docs.python.org/3/library/unittest.html). 이 예제의 성공·건너뜀 정책은 교육용 설계이며 모든 오케스트레이터의 표준 동작은 아닙니다.
