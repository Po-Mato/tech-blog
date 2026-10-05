"""로컬 교육용 검증 파이프라인. 네트워크 요청과 실제 배포는 하지 않는다."""
import argparse
import json
from pathlib import Path


def report(status, message, exit_code):
    print(json.dumps({"status": status, "message": message}, ensure_ascii=False))
    return exit_code


def main():
    parser = argparse.ArgumentParser(description="입력 검증과 승인 분기 실습")
    parser.add_argument("request", type=Path)
    parser.add_argument("--approve", action="store_true", help="모의 배포에 동의")
    args = parser.parse_args()
    try:
        plan = json.loads(args.request.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return report("invalid", "입력 파일을 읽거나 JSON으로 해석할 수 없습니다.", 2)

    fields = {"service", "environment", "tests_passed"}
    if not isinstance(plan, dict) or set(plan) != fields:
        return report("invalid", "service, environment, tests_passed만 필요합니다.", 2)
    if plan["service"] != "demo-api" or plan["environment"] != "staging":
        return report("rejected", "demo-api의 staging만 허용합니다.", 2)
    if plan["tests_passed"] is not True:
        return report("rejected", "tests_passed는 JSON true여야 합니다.", 2)
    if not args.approve:
        return report("approval_required", "검토 후 --approve로 다시 실행하세요.", 3)

    print(json.dumps({
        "status": "simulated", "service": plan["service"],
        "environment": plan["environment"], "deployed": False,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
