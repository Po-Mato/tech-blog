---
title: "클라우드 네이티브 환경에 AI 에이전트를 통합하는 설계"
date: 2026-09-02
tags: ["Cloud-Native", "Agentic-AI", "Software-Architecture", "DevOps"]
description: "에이전트 파이프라인의 검증 경계를 살펴보고, Python으로 입력 검증·승인·모의 배포를 직접 실행합니다."
---

# 클라우드 네이티브 환경에 AI 에이전트를 통합하는 설계

AI 에이전트가 만든 변경을 운영 환경에 연결하려면 생성 단계와 검증·승인·배포 단계를 구분해야 합니다. [Gartner의 2021년 발표](https://www.gartner.com/en/newsroom/press-releases/2021-11-10-gartner-says-cloud-will-be-the-centerpiece-of-new-digital-experiences)는 **2025년까지** 신규 디지털 워크로드의 95% 이상이 클라우드 네이티브 플랫폼에 배포될 것으로 예측했습니다. 이는 2026년 실측치가 아닙니다. 이 글은 시장 예측의 달성 여부 대신 검증 경계를 설계하고 실행해 보는 데 집중합니다.

## Cloud-Native의 완성: 플랫폼 엔지니어링

클라우드 네이티브는 이제 표준이 되었습니다. 하지만 규모가 커질수록 복잡성은 폭발적으로 증가합니다. 이를 해결하기 위해 플랫폼 엔지니어링 팀은 다음과 같은 핵심 전략을 시행하고 있습니다.

1.  **API 표준화 및 규격화**: 개발자가 비즈니스 로직에 집중할 수 있도록 추상화 계층을 제공합니다.
2.  **자동화된 보안 및 거버넌스**: 모든 프로젝트는 CI/CD 파이프라인에서 보안 스캔이 자동 수행되어야 하며, `git` 리포지토리에 연결되어 변경 이력이 투명하게 관리되어야 합니다.

## Agentic AI 시대의 아키텍처 변화

코드 생성 자동화의 비용·속도 효과는 작업과 검증 비용에 따라 달라집니다. 생성 결과를 검토 없이 배포하지 않도록 입력 정책, 검증 결과, 승인과 배포 권한을 분리해야 합니다.

### 아키텍처 예시: AI 에이전트 통합 파이프라인

아래 YAML은 역할을 보여 주는 **개념 예시**입니다. 특정 제품의 유효한 설정 파일이 아니며 그대로 실행할 수 없습니다.

```yaml
# 역할과 순서를 설명하는 개념 모델
orchestration:
  agents:
    - name: CodeGenerator
      tasks: [scaffold, feature-implementation]
    - name: SecurityValidator
      tasks: [dependency-check, static-analysis]
  workflow:
    - trigger: git-push
      steps:
        - action: CodeGenerator.execute
        - action: SecurityValidator.verify
        - action: deploy-to-canary
```

### 아키텍트의 역할

이제 아키텍트는 단순히 시스템 구조를 그리는 사람이 아닙니다. **'AI가 생성한 코드와 아키텍처를 검증하고 제어하는 오케스트레이터'**가 되어야 합니다. AI를 신뢰하되, 검증 파이프라인은 플랫폼 엔지니어가 직접 설계하고 관리해야 합니다.

## 로컬 실습: 검증을 통과해도 승인 전에는 멈추기

목표는 입력 검증 → 승인 확인 → 모의 배포 기록의 분기를 직접 확인하는 것입니다. **실제 AI 호출·보안 스캔·클라우드 배포는 수행하지 않습니다.** 네트워크나 API 키가 필요 없고, 파일에는 배포 결과를 쓰지 않습니다. 결과는 터미널의 JSON 한 줄로만 출력합니다.

Python 3.10 이상과 터미널이 필요합니다. 이 글의 로컬 재현 환경은 Python 3.14.3입니다. 추가 패키지는 없습니다. 별도 실습 폴더를 만들고 아래 코드를 `pipeline-lab.py`로 저장하세요. [같은 Python 파일 다운로드](/examples/pipeline-lab.py)도 제공합니다.

```python
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
```

### 1. 입력 준비

같은 폴더에 `request.json`을 만들고 다음 내용을 저장합니다. 문자열 `"true"`가 아니라 JSON 불리언 `true`를 사용합니다.

```json
{"service":"demo-api","environment":"staging","tests_passed":true}
```

실습 정책은 정확히 세 필드, 서비스 `demo-api`, 환경 `staging`, 검사 결과 `true`만 허용합니다. 예시의 `tests_passed`는 사용자가 작성한 값입니다. 실제 테스트 통과나 코드 안전성을 증명하지 않습니다.

### 2. 승인 없이 실행

```sh
python3 pipeline-lab.py request.json
```

예상 출력은 다음과 같고 종료 코드는 `3`입니다. 실패로 보이는 종료 상태가 이 단계의 기대 결과입니다.

```json
{"status": "approval_required", "message": "검토 후 --approve로 다시 실행하세요."}
```

### 3. 내용을 검토한 뒤 모의 승인

```sh
python3 pipeline-lab.py request.json --approve
```

종료 코드 `0`과 다음 기록이 나옵니다. `deployed: false`는 실제 배포가 없었다는 뜻입니다.

```json
{"status": "simulated", "service": "demo-api", "environment": "staging", "deployed": false}
```

### 4. 정책 위반과 잘못된 입력 재현

`request.json`의 `environment`를 `production`으로 바꾸고 같은 승인 명령을 실행합니다. 승인 플래그가 있어도 종료 코드 `2`로 거절합니다.

```json
{"status": "rejected", "message": "demo-api의 staging만 허용합니다."}
```

다시 `staging`으로 돌리고 `tests_passed`를 `false`, `1`, `"true"` 중 하나로 바꿔 보세요. 모두 종료 코드 `2`이며 `tests_passed는 JSON true여야 합니다.`가 표시됩니다. 필드를 빼거나 추가하면 입력 형식 오류가 나고, 잘못된 JSON 또는 없는 파일도 종료 코드 `2`로 끝납니다. 거절 시에는 `simulated` 기록이 나오지 않아야 합니다.

macOS/Linux 터미널에서는 각 명령 **바로 다음에** `echo $?`, PowerShell에서는 `$LASTEXITCODE`로 종료 코드를 확인할 수 있습니다. 다른 명령을 먼저 실행하면 그 명령의 종료 상태가 표시됩니다.

### 운영 설계로 옮길 때의 경계

`--approve`는 사용자의 명시적 선택을 연습하는 플래그이며 승인자의 신원·권한을 인증하지 않습니다. 누구나 플래그를 붙일 수 있으므로 운영 승인 장치로 사용하면 안 됩니다. 실제 시스템에서는 검사 결과를 신뢰할 수 있는 실행에서 얻고, 승인한 변경의 식별자와 배포할 산출물이 같은지 확인하며, 승인자 권한·거절·타임아웃·배포 실패·감사 기록을 별도로 설계해야 합니다.

이 실습은 검증과 승인의 **순서와 실패 분기**만 가르칩니다. 카나리 트래픽 전환, 취약점 탐지, 샌드박스, 롤백은 구현하지 않습니다. [8월 28일의 생성·검사 흐름](/posts/2026-08-28-proactive-update/)과 비교하면, 승인 주석만 있는 흐름과 명시적으로 멈추는 분기의 차이를 볼 수 있습니다.

정리는 이번에 만든 `pipeline-lab.py`와 `request.json` 두 파일만 삭제하면 됩니다. 설치 패키지나 외부 자원은 생성하지 않습니다.

참고: [Python argparse 공식 문서](https://docs.python.org/3/library/argparse.html), [Python JSON 공식 문서](https://docs.python.org/3/library/json.html), [GitHub의 실제 배포 승인·거절 흐름](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/review-deployments).

## 요약

2026년의 성공적인 소프트웨어 구축은 '빠르게 만드는 것'이 아니라, **'어떻게 AI를 안전하고 효율적으로 아키텍처에 통합할 것인가'**에 달려 있습니다. 클라우드 네이티브 인프라 위에서 강력한 보안 거버넌스와 함께 AI 에이전트를 조화롭게 운용하는 것이 오늘날 최고의 아키텍처 솔루션입니다.
