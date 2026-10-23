---
title: "에이전트가 작성한 코드를 검증하는 개발자의 역할"
date: 2026-09-01
tags: ["AI", "Software Development", "Agentic AI", "Platform Engineering"]
description: "요구사항과 인터페이스를 명확히 정의하고, 통합 테스트와 변경 이력으로 에이전트의 결과를 검토하는 방법을 다룹니다."
---

# 에이전트가 작성한 코드를 검증하는 개발자의 역할

생성된 코드도 명시한 요구사항을 만족하는지 확인해야 합니다. 이 글은 상태 코드가 정상이어도 본문이 계약을 어길 수 있다는 점을 작은 로컬 실습으로 보여줍니다.

## 1. 코드 작성에서 시스템 설계로의 전환

검토자는 입력과 출력, 실패 조건을 먼저 정해야 합니다. 테스트 통과는 정한 범위의 증거이며 보안·가용성·전체 시스템의 정확성을 보장하지 않습니다.

## 2. 코드 예시: 에이전트가 작성한 코드의 검증

기존 예제의 `module_agent`는 fixture 정의가 없었고 `/health`의 200 여부만 검사했습니다. 아래는 실제 서버 호출 대신 상태 코드와 응답 문자열을 전달하는 결정적 fixture 실습입니다. 네트워크 통합 테스트와 구분해서 사용하세요.

### 로컬 실습: 응답 본문 계약 검사

교육용 계약은 상태 코드 200, JSON 객체, 문자열 `status`와 `service`를 요구합니다. `status`는 `ok`, `service`는 공백을 제외하고 비어 있지 않아야 합니다. 추가 필드는 허용합니다. 모든 API에 적용되는 표준이 아니라 이 실습의 선택입니다.

[전체 코드와 테스트 다운로드](/examples/contract-lab.py)

Python 3.10 이상과 표준 라이브러리만 사용합니다. 파일을 빈 폴더에 저장하고 다음 명령을 실행하세요. 외부 API·패키지 설치·인증정보는 필요하지 않습니다.

```sh
python3 -I contract-lab.py
```

```python
"""외부 요청 없이 교육용 health 응답 계약을 검사한다. Python 3.10+."""
import json
import unittest


def validate_health(status_code, body):
    if status_code != 200:
        raise ValueError("http_status")
    try:
        data = json.loads(body)
    except json.JSONDecodeError as error:
        raise ValueError("invalid_json") from error
    if not isinstance(data, dict):
        raise ValueError("object_required")
    if "status" not in data or "service" not in data:
        raise ValueError("missing_field")
    if not isinstance(data["status"], str) or not isinstance(data["service"], str):
        raise ValueError("field_type")
    if data["status"] != "ok":
        raise ValueError("status_value")
    if not data["service"].strip():
        raise ValueError("empty_service")
    return data


class ContractTests(unittest.TestCase):
    def test_valid(self):
        self.assertEqual(validate_health(200, '{"status":"ok","service":"demo"}')["service"], "demo")

    def test_extra_fields_allowed(self):
        self.assertEqual(validate_health(200, '{"status":"ok","service":"demo","version":1}')["version"], 1)

    def test_invalid_responses(self):
        cases = [
            (503, '{}', "http_status"),
            (200, '{', "invalid_json"),
            (200, '[]', "object_required"),
            (200, 'null', "object_required"),
            (200, '{"status":"ok"}', "missing_field"),
            (200, '{"status":true,"service":"demo"}', "field_type"),
            (200, '{"status":"ok","service":1}', "field_type"),
            (200, '{"status":"failed","service":"demo"}', "status_value"),
            (200, '{"status":"ok","service":"  "}', "empty_service"),
        ]
        for status, body, reason in cases:
            with self.subTest(status=status, body=body):
                with self.assertRaisesRegex(ValueError, "^" + reason + "$"):
                    validate_health(status, body)


if __name__ == "__main__":
    unittest.main(verbosity=2)
```

정상·추가 필드 허용과 9개 잘못된 응답을 검사합니다. 예상 결과는 `Ran 3 tests`와 `OK`, 종료 코드 0입니다. 잘못된 응답에서 예상한 예외가 발생해야 테스트가 통과합니다.

### 결함을 넣어 테스트의 의미 확인하기

파일을 복사한 뒤 `validate_health`에서 상태 코드 검사 다음에 `return {}`를 넣어 보세요. 본문 검사를 생략하므로 테스트가 실패하고 종료 코드가 0이 아니어야 합니다. 원본 파일로 복구한 뒤 다시 통과하는지 확인하세요. 이 검사는 실제 서비스에 요청하지 않습니다.

계약을 바꾸려면 허용 값과 추가 필드 정책을 먼저 합의하고 정상·거절 사례를 함께 수정하세요. JSON 파싱 성공만으로 필수 필드가 검증되지는 않습니다. 이 예제는 주어진 문자열의 지정 필드만 검사하며 중복 키·본문 크기 제한·실제 HTTP 헤더·인증·시간 초과는 범위 밖입니다. 실습이 끝나면 저장한 파일과 폴더를 삭제하면 됩니다.

## 3. 결론

상태 코드만 보는 검사에서 본문의 타입·값·누락 조건을 확인하는 검사로 확장했습니다. 다음 단계는 실제 서비스의 계약을 정의하고 네트워크 실패·권한·통합 경계를 별도로 검증하는 것입니다.

### 공식 자료

- [Python unittest: TestCase와 assertRaises](https://docs.python.org/3/library/unittest.html)
- [Python json: 디코딩과 JSONDecodeError](https://docs.python.org/3/library/json.html)
