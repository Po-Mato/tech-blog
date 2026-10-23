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
