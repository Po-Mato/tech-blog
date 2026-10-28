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
