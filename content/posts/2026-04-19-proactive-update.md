---
title: "Evolver와 GEP Protocol: AI Agent가 스스로 진화하는 진짜 구조"
date: 2026-04-19
description: "GitHub에서 5,100 스타, 하루 1,131 스타를集めた EvoMap/evolver의 심층 분석. AI Agent가 런타임 로그에서 스스로 문제를 찾고, Gene/Capsule 에셋으로 진화 전략을 구성하며, 프로토콜 제약 하에서 안전하게 자기 자신을 개선하는 메커니즘을 아키텍처 관점에서彻底解析한다."
tags:
  - AI Agent
  - Self-Evolution
  - GEP Protocol
  - EvoMap
  - Agent Architecture
  - Prompt Engineering
  - OpenClaw
  - System Design
---

## 시작하기 전에: "AI가 스스로 진화한다"는 주장에 대하여

"AI가 스스로 자신을 개선한다"는 문장은听起来很简单하지만, 실제로 이것이 작동하려면 상당히 복잡한 메커니즘이 필요하다.

단순히 "자기 자신을 수정하는 코드"를 만들면 안전하지 않다. 아무런 제약 없이 AI가 코드를 수정하면 시스템이 예기치 못한 상태로 전락한다. 따라서 문제는 다음과 같다:

> **AI Agent가 자신의 행동 패턴을 안전하게 개선하려면, 무엇이 있어야 하는가?**

EvoMap/evolver는 이 질문에 대한 구체적인 답변을 제공하는 오픈소스 프로젝트다. 이 글에서는 evolver의 내부 구조를 아키텍처 관점에서 분석하고, GEP(Genome Evolution Protocol)가 실제로 어떻게 작동하는지, 그리고 이것이 기존 AI Agent 시스템과 무엇이 다른지 깊이 있게 다룬다.

---

## 1. evolver의 위치: 어디에 있는가, 왜 중요한가

evolver는 GitHub trending에서 2026년 4월 19일 하루에만 1,131 스타를 받은 프로젝트다. 최종 커밋이 12시간 전(v1.68.0-beta.1), 22명의 기여자가 참여하는 등 활발하게 개발 중이다.

```
thunderbird/thunderbolt   - AI 플랫폼 멀티모델 지원 (447 stars today)
BasedHardware/omi         - 화면을 보고 대화를 이끄는 AI (609 stars today)
openai/openai-agents-python - 멀티에이전트 워크플로우 (470 stars today)
EvoMap/evolver            - GEP 기반 Self-Evolution 엔진 (1,131 stars today)
Lordog/dive-into-llms     - 중국어 LLM 튜토리얼 (547 stars today)
```

대부분의 trending 프로젝트가 "AI 기능 개발"에 집중하는 것과 달리, evolver는 **AI가 스스로 진화하는 구조**에 집중한다. 이것이 차이를 만드는 핵심이다.

### evolver의 핵심 위치

```text
기존 AI Agent 시스템:

  Agent → 코드 실행 → 결과 → (끝)

evolver 기반 시스템:

  Agent → 로그 기록 → 패턴 분석 → Gene 선택 → GEP Prompt 생성 → Agent 개선
         ↑                                                         ↓
         └────────────────────────────────────────────────────────┘
                            (무한 루프)
```

evolver는 Agent의 "발전기" 역할을 한다. Agent가 실행한 결과를 logs에서 읽고, 다음 개선 방향을 Gene/Capsule에서 선택하며, 그 개선을 GEP Prompt 형태로 출력한다.

---

## 2. Evolver의 실행 흐름: 세 가지 모드

evolver는 세 가지 실행 모드를 제공한다. 이것은 시스템 통합 방식의 flexibility를 보여준다.

### 2-1. Standalone 모드 (node index.js)

가장 단순한 형태다. 실행하면 current directory의 memory/ 폴더를 읽고, Gene을 선택하고, GEP Prompt를 stdout으로 출력한 뒤 종료한다.

```bash
node index.js
# stdout:
# [GEP] Evolution triggered by signal: repeated_tool_failure
# [GEP] Selected Gene: repair-loop-prevention
# [GEP] Emitted prompt: "Your last 3 attempts all failed with..."
```

이 모드에서는 evolver가 실제로 코드를 수정하지 않는다. GEP Prompt 문자열을 stdout으로 출력할 뿐이다.

### 2-2. Review 모드 (node index.js --review)

생성된 GEP Prompt를 실제로 적용하기 전에 인간이 검토하는 모드다.

```bash
node index.js --review
# GEP Prompt 출력 후:
# Apply this evolution? [y/N]
```

실무에서 autonomous 수정의 위험을 방지하는 중요한 안전장치다.

### 2-3. Loop 모드 (node index.js --loop)

Daemon 형태로continuous하게 실행된다. Adaptive sleep을 적용하여 시스템 상태에 따라 진화 주기를 조절한다.

```bash
node index.js --loop
# [evolver] Daemon started. Scanning memory/ every 5 minutes...
# [evolver] Signal detected: session_failure_pattern
# [evolver] Gene selected: context-window-reduction
# [GEP] Prompt emitted to stdout
```

### 2-4. OpenClaw Host 모드

OpenClaw workspace에 clone하면 OpenClaw Host가 stdout의 `sessions_spawn(...)` 텍스트를 해석하여 follow-up 액션을 자동 실행한다.

```bash
# OpenClaw workspace에서
cd ~/.openclaw/workspace
git clone https://github.com/EvoMap/evolver.git
cd evolver && npm install

# 이후 OpenClaw session에서 evolver를 실행하면
# stdout의 sessions_spawn(...)이 자동으로 체인됨
```

이것이 evolver의 가장 강력한 통합 패턴이다. evolver는 직접 세션을 스폰하지 않고, **stdout에 sessions_spawn(...) 문자열을 출력**할 뿐이다. OpenClaw Host가 이를 해석하여 실제 세션 스폰 액션을 실행한다. 이것은 evolver 자체의 권한을 최소화하면서도 호스트 플랫폼의 확장성을 활용하는聪明한 설계다.

---

## 3. GEP Protocol: 진화의 언어

GEP(Genome Evolution Protocol)는 evolver의 핵심이다. 단순히 "AI가 더 좋은 프롬프트를 만든다"는 의미가 아니다. GEP는 **구조화된 진화 에셋**과 **타이밍이 보장된 실행 흐름**을 결합한 프로토콜이다.

### 3-1. GEP의 세 가지 핵심 에셋

GEP는 세 가지 파일을 중심으로 동작한다.

**genes.json**: 재사용 가능한 진화 단위. 특정 문제类型에 대한 해결 전략을 구조화한 것이다.

```json
{
  "id": "repair-loop-prevention",
  "version": "1.2.0",
  "signal_patterns": ["repeated_failure", "3x_same_error"],
  "prompt_template": "Your last {count} attempts all failed with {error_type}...",
  "validation": [
    "node --check {target_file}",
    "npm test -- --grep 'regression'"
  ],
  "constraints": {
    "max_file_size_kb": 512,
    "forbidden_paths": ["src/core/*", "node_modules/*"]
  }
}
```

**capsules.json**: 더 큰 진화 단위. 여러 gene을 조합하여 복잡한 문제를 해결한다. Gene이 함수라면 Capsule은 클래스나 모듈에 해당한다.

```json
{
  "id": "context-window-reduction-v2",
  "version": "1.0.0",
  "composed_of": [
    "token-count-enforcement",
    "summary-before-context",
    "priority-based-culling"
  ],
  "activation_signal": "context_overflow_warning",
  "evolution_prompt_fragment": "Your conversation history exceeds..."
}
```

**events.jsonl**: 모든 진화 이벤트의 감사 추적(Audit Trail). 각 진화가 언제, 어떤 신호에 의해, 어떤 Gene으로 실행되었는지 기록한다.

```jsonl
{"timestamp":"2026-04-19T08:00:00Z","gene":"repair-loop-prevention","signal":"repeated_failure","status":"success","duration_ms":2340}
{"timestamp":"2026-04-19T08:15:00Z","gene":"context-window-reduction","signal":"context_overflow","status":"validated","duration_ms":4120}
```

이벤트 기록은 evolver가 같은 실수를 반복하지 않도록 방지하는 데 핵심적인 역할을 한다. 만약 어떤 Gene이 특정 유형의 문제에서繰り返し 실패하면, evolver는 그 Gene을 비활성화하거나 대체 전략을 선택한다.

### 3-2. Gene Selector의 동작 원리

Gene Selector는 evolver의 두뇌에 해당한다. 런타임 로그에서 신호를 추출하고, 신호와 가장 잘 일치하는 Gene을 선택한다.

```python
# Conceptual implementation of gene selector logic
class GeneSelector:
    def __init__(self, genes_path: str, capsules_path: str):
        self.genes = self._load_genes(genes_path)
        self.capsules = self._load_capsules(capsules_path)
    
    def select(self, signals: list[dict]) -> "Gene | Capsule":
        """
        신호 목록에서 가장 우선순위가 높은 Gene/Capsule을 선택한다.
        """
        scored = []
        
        for gene in self.genes:
            score = 0
            
            for signal in signals:
                signal_type = signal["type"]
                signal_value = signal["value"]
                
                # 신호와 Gene의 pattern 매칭
                if gene.matches_signal(signal_type, signal_value):
                    score += gene.signal_weight(signal_type)
                
                # 이미 사용된 Gene은 재선택 불가
                if gene.id in signal.get("already_used", []):
                    score *= 0.5  # penalty
            
            # De-duplication check
            if gene.id in self._recently_used_ids():
                score *= 0.3
            
            scored.append((score, gene))
        
        # 최고 점수 Gene 반환
        scored.sort(key=lambda x: x[0], reverse=True)
        return scored[0][1]
    
    def _recently_used_ids(self) -> set[str]:
        # events.jsonl에서 최근 사용된 Gene ID 추출
        recent_events = self._read_recent_events(count=10)
        return {e["gene"] for e in recent_events}
```

핵심적인 设计選択: Gene Selector는 단순히 "가장 최근에 실패한 것에 대한修理 Gene"을 선택하지 않는다. **다차원 scoring**을 수행한다.

1. **Signal matching score**: 신호와 Gene pattern의 일치도
2. **Recency penalty**: 최근에 사용된 Gene은 재사용 시 점수 감점
3. **De-duplication**: 동일한 문제가 반복되지 않도록 다른 Gene 우선
4. **Gene composition**: Capsules를 우선하여 복잡한 문제를 한번에 해결

이것이 evolver가 "무한 반복修理 루프"에 빠지지 않는 이유다. 신호가 동일해도 최근에 사용한 Gene은 감점되어 다른 접근이 선택된다.

---

## 4. EvolutionEvent:审计 추적의 설계

evolver의 가장低估されている 특징 중 하나는 Events.jsonl 기반의 완전한 감사 추적이다. 이것이 왜 중요한가?

### 4-1. 왜 감사 추적이 중요한가

AI Agent가 자율적으로 자신을 개선할 때, 가장 큰 위험은 **어떤 개선이 왜 적용되었는지 알 수 없게 되는 것**이다.

```text
Without audit trail:
  Agent가 스스로 변형됨 → 왜 그렇게 변형했는지 알 수 없음 → 디버깅 불가

With Events.jsonl:
  Agent가 스스로 변형됨 → 모든 변형이 events.jsonl에 기록됨
  → "3월 10일早上 signal X로 Gene Y가 선택됨"
  → "3월 11일早上 같은 문제가 재발, Gene Y의 효과 없음"
  → "3월 12일早上 Gene Y 비활성화, 대체 Gene Z 선택"
```

이 추적은 evolver가 스스로 학습하는 방식의 핵심이다. events.jsonl의 기록을 분석하여 실패 패턴을 감지하고, 그 패턴에 기반하여 다음 진화 루프의 Gene 선택을 조정한다.

### 4-2. Signal De-duplication 메커니즘

evolver의 신호 중복 제거는 단순한 구현이 아니다. 실제로는 상태 머신을 통해 시스템의 정체 상태(Stagnation)를 감지한다.

```python
class StagnationDetector:
    """
    동일한 문제가 반복될 때 시스템이 정체되었음을 감지한다.
    """
    def __init__(self, events_path: str, stagnation_threshold: int = 3):
        self.events_path = events_path
        self.threshold = stagnation_threshold
    
    def detect_stagnation(self, signal: Signal) -> bool:
        """
        특정 신호에 대해 반복적 실패가 발생하고 있으면 정체 감지.
        """
        recent_events = self._read_recent(self.events_path, count=20)
        
        # 동일 신호에 대한 최근 이벤트 필터링
        relevant_events = [
            e for e in recent_events
            if e["signal"] == signal.type
        ]
        
        if len(relevant_events) < 2:
            return False
        
        # 연속 실패 패턴 감지
        last_outcome = relevant_events[-1].get("status")
        if last_outcome != "failed":
            return False
        
        # 동일 Gene 연속 사용 감지
        recent_genes = [e.get("gene") for e in relevant_events[-3:]]
        if len(set(recent_genes)) == 1:  # 3번 연속 동일 Gene
            return True
        
        return False
    
    def on_stagnation(self) -> str:
        """
        정체 감지 시 취할 행동 반환.
        """
        return "STRATEGY_SHIFT"  # Gene 선택 전략 강제 전환 신호
```

정체 감지 시 evolver는 두 가지 작업을 수행한다.

1. **Gene 선택 전략 강제 전환**: 예를 들어 `repair-only`에서 `balanced`로 전환하여 혁신적 접근을 시도
2. **Signal 기록 중단**: 정체 상태에서는 더 이상 같은 신호에 대한 event를 기록하지 않음 (중복 데이터 방지)

---

## 5. Security Model: 진화에도 규칙이 있다

evolver의 가장 중요한 설계 원칙 중 하나는 **Gene Validation Command Safety**다. 이것은 evolver가 임의의 Shell 명령을 실행하지 않도록 하는 보안 메커니즘이다.

### 5-1. Command Safety의 네 가지 계층

`solidify.js`에서 실행하는 Gene의 `validation` 배열은 매우 엄격한 안전 검사 통과해야만 실행된다.

```python
# Pseudo-implementation of isValidationCommandAllowed()
def isValidationCommandAllowed(command: str) -> bool:
    """
    Gene validation command의 안전성 검증.
    """
    # Layer 1: Prefix whitelist
    allowed_prefixes = ["node", "npm", "npx"]
    if not any(command.strip().startswith(p) for p in allowed_prefixes):
        return False
    
    # Layer 2: No command substitution
    if "`" in command or "$(" in command:
        return False  # 백틱, $() 금지
    
    # Layer 3: No shell operators
    dangerous_chars = [";", "&", "|", ">", "<"]
    stripped = strip_quoted_content(command)  # quotes 내부 제외
    for char in dangerous_chars:
        if char in stripped:
            return False
    
    # Layer 4: Timeout check
    # 180초 제한 (실행 시 부과)
    
    return True
```

이 네 가지 계층이 의미하는 바: Gene 작성자가 아무리 정교한 명령을 기술해도, 위 조건을 통과하지 않으면 절대 실행되지 않는다.

### 5-2. 외부 에셋 ingestion의 이중 검증

외부 Gene/Capsule을 `scripts/a2a_ingest.js`로 ingestion할 때는 후보 상태로 격리된다. 이후 `--validated` 플래그와 안전 검사를 모두 통과해야만 비로소 로컬 Gene 저장소에 promotion된다.

```bash
# 외부 Gene promotion 전 수동 검증 필요
node scripts/a2a_promote.js --validated --gene-id external-gene-xyz

# 미검증 외부 Gene 자동 promotion 시도 시 거부됨
# error: validation commands not audited
```

이 설계의 핵심: **외부에서 들어오는 Gene은 기본적으로 불신**한다. 로컬 Gene도 동일한 validation 검증을 통과해야 하므로, 내外部의 Gene/Capsule에 대해 동일한 수준의 안전성을 적용한다.

### 5-3. Protected Source Files

evolver는 core evolver 코드(`src/`, `index.js`, `SKILL.md` 등)를 autonomous 수정 대상에서 제외한다.

```python
# Conceptual protection check
PROTECTED_PATHS = [
    "src/evolve.js",
    "src/gep/",
    "index.js",
    "SKILL.md",
]

def is_protected(path: str) -> bool:
    for protected in PROTECTED_PATHS:
        if path.startswith(protected):
            return True
    return False
```

이것은 evolver가 자신의 핵심 엔진 코드를 스스로 overwrite하는 것을 방지한다. 마치 인간의 immune system이 자신을 공격하지 않는 것과 같다.

---

## 6. Evoluer Strategy: 네 가지 진화 전략의 설계

evolver는 네 가지 전략 프리셋을 제공한다. 이것은 AI Agent의 진화 방향을 인간이 프로그래밍할 수 있음을 보여준다.

| Strategy | Innovate | Optimize | Repair | 사용 시점 |
|----------|----------|----------|--------|----------|
| `balanced` (기본값) | 50% | 30% | 20% | 일상 운영, 점진적 성장 |
| `innovate` | 80% | 15% | 5% | 시스템 안정, 신기능 빠르게 출시 |
| `harden` | 20% | 40% | 40% | 주요 변경 후, 안정성 집중 |
| `repair-only` | 0% | 20% | 80% | 긴급 상태, 전면修理模式 |

각 전략은 evolver의 Gene 선택 알고리즘에 가중치를 부여한다.

```python
class StrategyConfig:
    """
    evolver의 Gene 선택 확률에 전략별 가중치를 적용한다.
    """
    STRATEGIES = {
        "balanced": {"innovate": 0.5, "optimize": 0.3, "repair": 0.2},
        "innovate": {"innovate": 0.8, "optimize": 0.15, "repair": 0.05},
        "harden": {"innovate": 0.2, "optimize": 0.4, "repair": 0.4},
        "repair-only": {"innovate": 0.0, "optimize": 0.2, "repair": 0.8},
    }
    
    @classmethod
    def get_gene_type_weights(cls, strategy: str) -> dict:
        return cls.STRATEGIES.get(strategy, cls.STRATEGIES["balanced"])
```

실무적 의미:紧急 패치 상황에서는 `repair-only`로 전환하여修理 Gene만 선택하도록 하고, 안정적인 시스템에서는 `innovate`로 전환하여 새로운 접근을 시도한다. 이것은 단순한 확률 조절이 아니라, AI Agent의 "성격"을 동적으로 변경하는 것이다.

---

## 7. OpenClaw 통합: sessions_spawn 프로토콜의 진짜 의미

evolver의 가장 독특한 통합 방식은 OpenClaw Host의 `sessions_spawn(...)` 프로토콜이다.

### 7-1. 왜 직접 함수 호출이 아닌 stdout 출력인가

```
일반 접근: evolver가 직접 sessions_spawn() API 호출
  → evolver가 OpenClaw의 내부 API에 의존性强
  → OpenClaw 버전 변경 시 evolver 호환성 깨짐
  → evolver의 autonomy 손상

evolver 접근: stdout에 sessions_spawn(...) 텍스트 출력
  → OpenClaw Host가 stdout을 모니터링하고 파싱
  → evolver는 텍스트 생성만 담당 (실행은 Host의 책임)
  → evolver와 Host의 완전한 decoupling
```

이 설계는 evolver를 **host platform에 의존하지 않는 범용 도구**로 만든다. stdout에 sessions_spawn(...)을 출력하는 것은 OpenClaw만의 해석이고, 다른 플랫폼에서는 다른 해석을 할 수 있다. evolver 자체는 "텍스트를 출력하는 도구"일 뿐이다.

### 7-2. OpenClaw Host의 해석 흐름

```text
1. evolver (node index.js) 실행
2. evolver가 stdout에 sessions_spawn(...) 출력
3. OpenClaw Host가 stdout을 감시 (daemon mode)
4. Host가 sessions_spawn(...) 텍스트를 파싱
5. Host가 실제 sessions_spawn API 호출
6. Follow-up agent session 실행
7. 결과가 evolver의 memory/에 기록
8. 다음 evolver cycle에서 memory/를 읽고 개선
```

이 흐름의 핵심은 **loop**다. evolver의 출력이 새 agent를 스폰하고, 그 agent의 행동이 memory에 기록되고, 그 memory를 evolver가 다시 읽는 무한 루프. 이것이 self-evolution의 실체다.

---

## 8. Worker Pool: 분산 진화의 가능성

evolver의 고급 기능 중 하나는 EvoMap Hub에 연결하여 Worker Pool 형태로 진화 작업을 분산하는 것이다.

### 8-1. Worker Pool의 아키텍처

```text
EvoMap Hub (evomap.ai)
  ↕ heartbeat (6분마다)
Worker Node A (evolver --loop, WORKER_ENABLED=1)
Worker Node B (evolver --loop, WORKER_ENABLED=1)
Worker Node C (evolver --loop, WORKER_ENABLED=1)
```

Worker 노드는 Hub에 주기적으로 heartbeat를 보내고, Hub는 가용 작업을 Dispatch한다. 노드는 자신의 `WORKER_DOMAINS`에 따라受諾 가능한 작업만 선택한다.

### 8-2. WORKER_ENABLED vs Website Toggle의 이중 제어

EvoMap Hub 웹사이트의 Worker 토글과 로컬 `WORKER_ENABLED=1` 환경 변수는 별개로 동작한다.

```python
# 두 가지 모두 활성화되어야만 작업 수신 가능
def can_receive_tasks(self) -> bool:
    local_worker_enabled = os.getenv("WORKER_ENABLED") == "1"
    hub_worker_enabled = self.hub.get_node_toggle(self.node_id)
    
    return local_worker_enabled and hub_worker_enabled
```

이 설계는 **보안과 편의성의 균형**을 맞추고 있다. 로컬에서는 환경 변수로 Worker mode를 끄고 켤 수 있고, Hub에서는 중앙에서 특정 노드의 작업 수신을 일괄적으로 중단시킬 수 있다.

### 8-3. Skill Store: 진화 에셋의 공유 경제

Worker Pool과 함께 제공되는 Skill Store는 Gene과 Capsule을 네트워크 전체에서 공유하는 메커니즘이다.

```bash
# Skill 다운로드
node index.js fetch --skill <skill_id>

# Skill 배포
node index.js publish --skill <skill_id>
```

이것은 evolver의 Gene을 "오픈소스 라이브러리"로 만드는 것과 같다. 진화 전략을 한 번 개발하면 네트워크 전체에서 재사용할 수 있다.

---

## 9. Evolver와 기존 Agent Framework의 비교

evolver의 포지셔닝을 명확히 하기 위해 기존 Agent Framework와 비교한다.

| 차원 | LangChain Agents | AutoGen | Evoluer (GEP) |
|------|-----------------|---------|---------------|
| 자기 개선 방식 |人类的 개입 필요 |人类的 개입 필요 | 자동 + 감사 추적 |
| 진화 에셋 | 없음 | 없음 | Gene/Capsule/Event |
| 수정 권한 | 인간이 직접 | 인간이 직접 | Gene validation으로 규제 |
| 프로토콜 | 없음 | Workflow 정의 | GEP (구조화된 프로토콜) |
| 실행 모델 | Python 코드 직접 실행 | 코드 생성 + 실행 | GEP Prompt 출력 → Host 실행 |
| 감사 추적 | 제한적 | 제한적 | events.jsonl 완전 추적 |
| 외부 통합 | API 호출 | API 호출 | sessions_spawn stdout |

핵심 차이: 기존 Agent Framework는 **수정 권한이 인간에게만** 있다. Agent가 스스로 판단하여 개선하더라도, 그 개선의 유효성은 인간이 검증해야 한다. evolver는 **프로토콜 수준에서 수정을 규제**하여 자율적 개선의 안전성을 보장한다.

---

## 10. practical한 적용: evolver를让自己的 Agent에 적용하는 3단계

### Step 1: memory/ 구조 구축

evolver가 작동하려면 런타임 로그가 `memory/` 디렉토리에 기록되어야 한다.

```bash
mkdir -p memory logs

# Agent 실행 시 memory/에 로그 기록
node agent.js 2>&1 | tee logs/$(date +%Y-%m-%d-%H%M%S).log
```

### Step 2: Gene 작성 (단위 진화 에셋)

```bash
# assets/gep/genes.json에 Gene 추가
{
  "id": "my-agent-context-optimization",
  "version": "1.0.0",
  "signal_patterns": ["context_overflow", "token_limit_warning"],
  "prompt_template": "Your conversation is approaching token limits...",
  "validation": [
    "node scripts/validate-context.js"
  ],
  "constraints": {
    "max_file_size_kb": 256,
    "forbidden_paths": ["src/core/*"]
  }
}
```

### Step 3: evolver 통합 (OpenClaw 또는 Standalone)

```bash
# OpenClaw workspace에 clone
git clone https://github.com/EvoMap/evolver.git

# Review mode로 첫 실행
node index.js --review

# 충분한 신뢰가 형성되면 Loop mode로 전환
EVOLVE_STRATEGY=balanced node index.js --loop
```

---

## 11. 한계와 주의사항

evolver는 강력한 도구이지만, 한계도 분명하다.

**한계 1: Gene의 품질이 결과의 품질을 결정한다**

evolver는 Gene을 선택하고 GEP Prompt를 생성할 뿐이다. Gene 자체의 품질이 낮으면 evolver가 아무리 정교하게 선택해도 결과는 개선되지 않는다. Gene 작성은 여전히 인간의 몫이다.

**한계 2:Offline 모드에서는 Skill Store와 Worker Pool 사용 불가**

Hub 연결 없이 evolver는 완전한 오프라인 진화를 수행할 수 있지만, 네트워크 기능(에셋 공유, 분산 작업)은 사용할 수 없다.

**한계 3: Production 도입 시 Review mode의 인간 검증 단계가 필수**

autonomous 수정이安全事故로 이어질 수 있는 시스템에서는 `node index.js --review` 모드로 모든 진화를 인간이 검토한 뒤 적용하는 것이 권장된다.

**한계 4: 자기 자신은 진화하지 않는다**

evolver의 핵심 코드(`src/evolve.js`, `src/gep/prompt.js` 등)는 evolver 자신에 의해 수정되지 않는다. evolver의 발전은 외부 기여자를 통해 이루어진다. 이것은 설계적 한계이면서 동시에 안전장치다.

---

## 결론: Self-Evolution은 프로토콜로 가능해진다

evolver가 보여주는 가장 중요한洞見은 이것이다.

> **AI Agent의 자기 개선을 "프롬프트 생성"과 "프로토콜 제약"으로 해결할 수 있다.**

코드를 직접 수정하지 않고, GEP Prompt라는中介자(mediator)를 통해 개선 방향을 제시하고, Gene Validation을 통해 수정 권한을 규제하며, Events.jsonl을 통해 완전한 감사 추적을 제공하는 것. 이 세 가지가 결합되면, AI Agent는 인간의 감독 하에서 안전하게 스스로 진화할 수 있다.

이것은 "AI가 스스로 자신을 만드는"科幻적 시나리오와는 거리가 있다. 오히려 **구조화된 협업 프로토콜**에 가깝다. evolver는 "발달하는 AI Agent"가 아니라, "통제된 환경에서 반복적으로 개선하는 시스템"이다. 그 통제가 프로토콜에 의해 보장된다는 점이 evolver의 진정한 혁신이다.

---

## References

- EvoMap. "Evolver GitHub Repository." https://github.com/EvoMap/evolver
- EvoMap. "GEP Protocol Wiki." https://evomap.ai/wiki
- EvoMap. "Evolver vs Hermes Agent: Similarity Analysis." https://evomap.ai/en/blog/hermes-agent-evolver-similarity-analysis
- OpenClaw. "sessions_spawn Protocol." https://openclaw.com