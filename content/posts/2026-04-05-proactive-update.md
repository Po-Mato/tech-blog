---
title: "MCP는 API 래퍼가 아니다: Enterprise Data Mesh의 실전 설계"
date: 2026-04-05
description: "2026년의 MCP는 단순한 툴 연결 규약을 넘어, 조직의 데이터와 업무 시스템을 에이전트 친화적으로 재구성하는 핵심 인터페이스가 됐습니다. 이 글은 왜 MCP를 Enterprise Data Mesh 관점에서 설계해야 하는지, 그리고 실무에서 어떤 런타임·권한·검증 구조가 필요한지 정리합니다."
---

## 들어가는 글

MCP(Model Context Protocol)를 처음 접하면 흔히 이렇게 생각합니다.

> “아, LLM이 외부 툴을 부를 수 있게 해주는 API 래퍼 같은 거구나.”

절반만 맞습니다. 2026년의 MCP는 단순한 툴 호출 포맷이 아닙니다. 실무에서는 점점 더 **조직의 데이터와 기능을 에이전트가 이해할 수 있는 표준 인터페이스로 재구성하는 레이어**에 가깝게 쓰이고 있습니다.

이게 왜 중요할까요? 모델은 계속 좋아지고 있습니다. 하지만 기업 내부의 진짜 병목은 여전히 사내 위키, 데이터베이스, 이슈 트래커, 메신저 로그, 문서 저장소, 배포 시스템, 결재 시스템이 제각각 흩어져 있다는 점입니다. 에이전트가 똑똑해져도, 연결된 세계가 엉성하면 결국 실무 생산성은 제한됩니다.

그래서 지금 필요한 질문은 “어떤 모델을 붙일까?”보다 아래에 가깝습니다.

- 조직의 데이터와 업무 기능을 어떤 단위로 노출할 것인가?
- 읽기/쓰기/실행 권한을 어떻게 나눌 것인가?
- 에이전트가 잘못된 도구를 골라도 시스템이 덜 깨지게 하려면 어떻게 설계할 것인가?
- 사람의 승인과 감사 로그를 어디에 끼워 넣을 것인가?

이 글에서는 MCP를 **Enterprise Data Mesh** 관점에서 봐야 하는 이유와, 실제로 어떤 구조로 설계하면 덜 위험하고 더 오래 가는지 정리해 보겠습니다.

## 1. 왜 지금 MCP를 “Enterprise Data Mesh”로 봐야 하나

초기의 MCP 활용은 주로 “툴 몇 개 연결해서 모델이 호출하게 만들기”에 머물렀습니다. 하지만 실무에 들어오면 금방 한계가 드러납니다.

예를 들어 “이번 주 장애 회고 초안 작성해줘”라는 단일 요청도 실제로는 여러 시스템을 건드립니다.

- 장애 티켓: Jira/Linear
- 운영 로그: Datadog, CloudWatch, ELK
- 배포 기록: GitHub Actions, ArgoCD
- 대화 맥락: Slack/Discord/이메일
- 산출물 저장: Notion, Google Docs, Confluence

이걸 매번 모델 프롬프트에 억지로 설명하거나, 툴별 맞춤 코드를 계속 추가하는 방식은 금방 유지보수 지옥으로 갑니다.

그래서 MCP를 **툴 호출 표준**이 아니라 아래처럼 생각해야 합니다.

> “조직의 데이터 도메인과 업무 capability를 에이전트가 탐색 가능한 형태로 노출하는 메쉬 인터페이스”

여기서 핵심은 두 가지입니다.

1. **데이터 소스 중심이 아니라 capability 중심으로 설계할 것**
2. **연결보다 거버넌스를 먼저 설계할 것**

즉, “Postgres를 붙였다”보다 “incident.read_timeline”, “deploy.compare_revisions”, “docs.create_postmortem” 같은 업무 단위를 먼저 정의해야 합니다.

## 2. 그냥 API를 MCP로 감싸기만 하면 왜 실패하나

많은 팀이 첫 버전에서 하는 실수는 기존 REST/GraphQL API를 그대로 MCP 툴로 노출하는 것입니다. 겉으로는 빨라 보이지만, 실제 사용성은 금방 떨어집니다.

대표적인 실패 패턴은 이렇습니다.

### 2.1 툴 이름은 연결됐는데 의미가 없다

- `getIssues`
- `listDocs`
- `queryDatabase`
- `runSearch`

이런 이름은 기계적으로는 연결되어 있어도, 에이전트 입장에서는 “언제 무엇을 써야 하는지”가 불분명합니다. 결국 planner가 추측에 의존하게 되고, 잘못된 툴 선택이 늘어납니다.

### 2.2 읽기와 쓰기가 섞여 있다

`updateDocument`, `postComment`, `sendNotification` 같은 쓰기 작업이 별다른 승인 경계 없이 열려 있으면, 데모는 화려해도 운영 도입은 거의 막힙니다. 기업은 정확성보다 먼저 **통제 가능성**을 봅니다.

### 2.3 데이터는 연결됐는데 문맥이 없다

티켓 본문, 커밋 메시지, 슬랙 대화, 런북 문서를 각각 따로 읽을 수 있어도, 그것들이 같은 사건을 가리킨다는 연결 정보가 없으면 에이전트는 여전히 조각난 세계를 봅니다.

### 2.4 실패와 검증 설계가 없다

도구 호출이 성공했다고 실제 업무 결과가 맞는 건 아닙니다. 문서를 생성했지만 잘못된 폴더에 들어갔을 수도 있고, 이슈를 수정했지만 잘못된 티켓에 댓글을 달았을 수도 있습니다.

결국 MCP를 제대로 쓰려면, “API 노출”보다 먼저 **도메인 모델 + 권한 모델 + 검증 모델**이 필요합니다.

## 3. 권장 아키텍처: MCP 서버를 데이터 소스별이 아니라 도메인별로 나눠라

실무적으로는 시스템별 MCP 서버보다 **도메인 경계(domain boundary)** 기준의 MCP 서버가 훨씬 낫습니다.

### 안 좋은 구조

- `slack-mcp`
- `jira-mcp`
- `github-mcp`
- `notion-mcp`

이 구조는 연결은 쉽지만, 업무 흐름은 흩어집니다. 에이전트는 “장애 회고 작성” 같은 과업을 수행할 때 어느 서버를 먼저 써야 할지 계속 추론해야 합니다.

### 더 좋은 구조

- `incident-ops-mcp`
- `engineering-knowledge-mcp`
- `release-management-mcp`
- `customer-support-mcp`

이렇게 나누면 서로 다른 원천 시스템을 내부에서 흡수한 뒤, 상위 capability를 일관된 형태로 제공할 수 있습니다.

예를 들면 `incident-ops-mcp`는 내부적으로 Jira, Datadog, Slack, GitHub를 다 읽더라도 외부에는 아래 capability만 노출할 수 있습니다.

- `incident.get_summary`
- `incident.get_timeline`
- `incident.related_deploys`
- `incident.create_postmortem_draft`
- `incident.request_human_review`

이 방식의 장점은 명확합니다.

- planner가 덜 헤맨다
- 데이터 소스 변경이 있어도 상위 계약은 유지된다
- 권한 정책을 capability 단위로 설계할 수 있다
- 감사 로그가 업무 이벤트 기준으로 남는다

## 4. 실전 설계 원칙 1: Resource보다 Capability를 먼저 모델링하라

MCP를 잘 쓰는 팀은 “리소스 목록”보다 “일의 단위”를 먼저 설계합니다.

아래는 TypeScript로 단순화한 capability registry 예시입니다.

```ts
// mcp/capabilities.ts
export type Capability =
  | 'incident.read'
  | 'incident.timeline'
  | 'incident.postmortem.create'
  | 'deploy.compare'
  | 'docs.publish'
  | 'approval.request';

export type AccessLevel = 'read' | 'write' | 'execute';

export interface CapabilitySpec {
  name: Capability;
  description: string;
  access: AccessLevel;
  requiresApproval: boolean;
  ownerTeam: string;
  inputSchema: Record<string, unknown>;
}

export const capabilityRegistry: CapabilitySpec[] = [
  {
    name: 'incident.read',
    description: '장애 티켓과 메타데이터 조회',
    access: 'read',
    requiresApproval: false,
    ownerTeam: 'sre',
    inputSchema: { incidentId: 'string' },
  },
  {
    name: 'incident.postmortem.create',
    description: '회고 초안 문서 생성',
    access: 'write',
    requiresApproval: true,
    ownerTeam: 'sre',
    inputSchema: { incidentId: 'string', template: 'string' },
  },
  {
    name: 'docs.publish',
    description: '검토 완료된 문서를 지식베이스에 게시',
    access: 'execute',
    requiresApproval: true,
    ownerTeam: 'platform',
    inputSchema: { documentId: 'string', destination: 'string' },
  },
];
```

이렇게 정의하면 MCP 서버는 단순 데이터 제공자가 아니라 **조직 규칙을 포함한 실행 계약(contract)** 이 됩니다.

## 5. 실전 설계 원칙 2: Planner와 MCP Runtime을 분리하라

여기서 가장 흔한 안티패턴은 모델이 계획과 실행을 동시에 독점하게 두는 것입니다.

처음엔 간단해 보입니다.

1. 모델이 해야 할 일을 생각한다
2. 모델이 툴을 고른다
3. 모델이 결과를 읽고 다음 행동을 정한다

하지만 툴 수가 늘어나고, 권한 차이가 생기고, 승인 단계가 끼기 시작하면 이 방식은 금방 불안정해집니다.

그래서 권장 구조는 아래처럼 분리하는 것입니다.

- **Planner**: 요청을 capability 단위의 단계로 분해
- **Policy Engine**: 각 capability의 허용 여부, 예산, 승인 필요 여부 평가
- **Runtime**: 실제 MCP 툴 호출, timeout/retry/checkpoint 처리
- **Verifier**: 호출 결과가 업무적으로 유효한지 확인
- **Human Gate**: 쓰기/게시/전송 전에 사람 승인 삽입

예시 코드는 아래와 같습니다.

```ts
// runtime/execute-plan.ts
type PlanStep = {
  capability: string;
  input: Record<string, unknown>;
  onFailure?: 'retry' | 'fallback' | 'ask-human' | 'abort';
};

type ExecutionResult = {
  ok: boolean;
  output?: unknown;
  reason?: string;
};

async function executeStep(step: PlanStep): Promise<ExecutionResult> {
  const policy = await evaluatePolicy(step.capability, step.input);
  if (!policy.allowed) {
    return { ok: false, reason: `blocked_by_policy:${policy.reason}` };
  }

  if (policy.requiresApproval) {
    const approved = await requestHumanApproval(step);
    if (!approved) {
      return { ok: false, reason: 'approval_denied' };
    }
  }

  const tool = await resolveMcpTool(step.capability);
  const output = await invokeMcp(tool, step.input, {
    timeoutMs: policy.timeoutMs,
    traceId: crypto.randomUUID(),
  });

  const verified = await verifyBusinessOutcome(step.capability, output);
  if (!verified) {
    return { ok: false, reason: 'verification_failed' };
  }

  return { ok: true, output };
}
```

핵심은 모델에게 “모든 걸 맡기는 것”이 아니라, 모델은 계획과 해석에 집중시키고 **실행의 안전장치와 검증은 런타임이 책임지게 하는 것**입니다.

## 6. 실전 설계 원칙 3: 데이터 메쉬의 핵심은 검색보다 “연결성”이다

많은 팀이 MCP를 도입하면서 “이제 우리도 검색 잘 되겠네” 정도로 생각합니다. 그런데 엔터프라이즈 환경에서 진짜 중요한 건 검색 정확도만이 아닙니다.

진짜 가치는 **연결된 문맥(linked context)** 에 있습니다.

예를 들어 하나의 장애 사건을 아래처럼 연결할 수 있어야 합니다.

- Incident ticket `INC-2049`
- 관련 PR `#871`
- 배포 버전 `release-2026.04.05.2`
- Slack thread permalink
- 모니터링 대시보드 스냅샷
- 회고 문서 draft ID

이 연결성이 없으면 에이전트는 여전히 “조각난 문서 여러 개”를 읽을 뿐입니다. 하지만 연결성이 있으면 아래가 가능해집니다.

- 특정 장애의 전후 맥락을 자동 요약
- 배포와 장애 상관관계 분석
- 회고 문서 초안 자동 생성
- 후속 액션 아이템 추천
- 비슷한 과거 사건 검색

즉, MCP 기반 Data Mesh에서 중요한 것은 “문서를 얼마나 많이 읽을 수 있나”가 아니라,

> “하나의 업무 사건을 구성하는 엔티티들을 얼마나 일관되게 연결해 둘 수 있나”

입니다.

## 7. 권한 설계: 읽기는 넓게, 쓰기는 좁게, 외부 전송은 가장 좁게

국내 기업 환경에서 MCP 도입이 막히는 가장 큰 이유 중 하나는 보안팀이 “에이전트가 뭘 쓰고 어디로 보내는지 통제할 수 있나?”를 확신하지 못하기 때문입니다.

그래서 권한 모델은 처음부터 세 층으로 나누는 편이 좋습니다.

### 7.1 Read

- 문서 읽기
- 메타데이터 조회
- 히스토리 검색
- 로그 집계

이 레벨은 비교적 넓게 열 수 있습니다. 다만 조회 범위와 마스킹 규칙은 명확해야 합니다.

### 7.2 Write

- 초안 문서 생성
- 댓글 초안 작성
- 라벨/상태 변경
- 체크리스트 업데이트

이 레벨부터는 승인 또는 대상 제한이 필요합니다. 예를 들어 “임시 폴더에만 작성 가능”, “draft 상태만 허용” 같은 제약이 유효합니다.

### 7.3 External Execute

- 메일 발송
- 운영 채널 공지
- 고객 알림 전송
- main 브랜치 배포

이 레벨은 가장 좁아야 합니다. 가급적 사람 승인, 감사 로그, 재확인 단계를 기본값으로 두는 게 맞습니다.

아래처럼 정책을 선언형으로 두면 운영이 쉬워집니다.

```ts
// policy/publish-policy.ts
export const publishPolicy = {
  'docs.publish': {
    allowedRoles: ['staff-engineer', 'sre-lead'],
    requireApproval: true,
    audit: 'strict',
    allowedDestinations: ['postmortems/drafts', 'engineering/blog/drafts'],
  },
  'notification.send': {
    allowedRoles: ['incident-bot'],
    requireApproval: true,
    audit: 'strict',
    allowedDestinations: ['internal-only'],
  },
};
```

## 8. 블로그 자동화 예시: “글 생성”보다 “게시 검증”이 더 중요하다

이번 글의 맥락처럼 블로그 자동화에도 MCP 사고방식은 그대로 적용됩니다.

블로그 자동 게시를 구성한다고 해봅시다.

### 나쁜 접근

- 모델이 트렌드 읽음
- 모델이 글 씀
- 바로 git commit + push

이건 데모는 빠르지만 운영 관점에서 위험합니다. 제목 중복, 프론트매터 누락, 빌드 실패, 잘못된 카테고리, 너무 빈약한 본문 같은 문제가 생길 수 있습니다.

### 더 나은 접근

1. 트렌드 수집 capability 호출
2. 주제 선정 rationale 생성
3. 초안 생성
4. 품질 기준 검증
   - 최소 분량
   - 코드 블록 존재 여부
   - 제목/description/frontmatter 유효성
   - 금칙어/환각 가능성 검사
5. 리포지토리 쓰기
6. 빌드 실행
7. git diff 확인
8. 커밋/푸시
9. 푸시 후 결과 검증 및 보고

이 흐름은 사실상 작은 출판 파이프라인입니다. 중요한 건 “글을 썼다”가 아니라 **게시 가능한 상태로 검증했다**는 점입니다.

## 9. 한국 개발자가 지금 이 주제에 특히 주목해야 하는 이유

한국 개발 환경은 MCP/Data Mesh 관점이 특히 잘 맞습니다.

### 9.1 시스템이 많고 단절이 심하다

사내 위키, 메신저, 티켓 시스템, 배포 시스템, 파일 저장소가 서로 단절된 경우가 많습니다. 에이전트를 진짜 유용하게 만들려면, 이 단절을 메꾸는 표준 인터페이스가 필요합니다.

### 9.2 API가 없거나 일관되지 않은 서비스가 많다

국내 환경에서는 정형 API보다 브라우저 워크플로, 파일 업로드, 승인 페이지 같은 반정형 인터페이스가 자주 등장합니다. 이런 환경일수록 상위 capability를 안정적으로 감싸 주는 MCP 레이어가 중요합니다.

### 9.3 보안과 감사 요구가 높다

금융, 커머스, 헬스케어, 공공 영역은 “에이전트가 똑똑하다”보다 “통제 가능하다”가 더 중요합니다. MCP를 capability + policy + audit 구조로 설계하면 이 장벽을 낮출 수 있습니다.

### 9.4 커리어 관점에서도 유리하다

앞으로는 단순히 모델 API를 붙일 줄 아는 개발자보다, **조직의 데이터와 워크플로를 에이전트가 다룰 수 있는 형태로 재설계하는 개발자**가 훨씬 희소해질 가능성이 큽니다.

## 10. 팀 체크리스트: 우리 MCP는 “연결”인가, “운영 가능한 메쉬”인가

아래 질문에 “예”가 많을수록 운영 가능한 구조에 가깝습니다.

- [ ] 툴 이름이 아니라 capability 언어로 설계되어 있는가?
- [ ] 읽기/쓰기/외부 전송 권한이 분리되어 있는가?
- [ ] 사람 승인 단계가 런타임에 삽입 가능한가?
- [ ] 도메인별 MCP 서버 경계가 명확한가?
- [ ] 하나의 사건을 여러 시스템 엔티티와 연결할 수 있는가?
- [ ] 툴 호출 성공과 업무 성공을 별도로 검증하는가?
- [ ] 감사 로그가 “API 호출”이 아니라 “업무 이벤트” 기준으로 남는가?
- [ ] 원천 시스템이 바뀌어도 상위 capability 계약이 유지되는가?

## 마치며

2026년의 MCP를 단순한 툴 호출 규약으로만 보면, 결국 “API 래퍼를 하나 더 만든 것” 이상의 가치가 잘 나오지 않습니다.

반대로 MCP를 Enterprise Data Mesh 관점에서 보면 시야가 달라집니다.

- 데이터 소스를 capability로 재구성하고
- 권한과 승인을 실행 계약에 포함시키고
- 연결된 문맥을 유지하며
- 검증 가능한 업무 결과를 만들어 내는 구조

이렇게 설계해야 에이전트는 비로소 “똑똑한 데모”를 넘어 **운영 가능한 동료 시스템**이 됩니다.

정리하면 이렇습니다.

- MCP의 본질은 연결 그 자체가 아니다.
- 진짜 가치는 조직 지식과 업무 기능을 에이전트 친화적으로 재배열하는 데 있다.
- 그리고 그 성공 여부는 모델 성능보다 **도메인 모델, 권한 설계, 검증 가능한 런타임** 에서 갈린다.

올해 MCP를 붙일 계획이라면, 툴 목록부터 만들지 마세요. 먼저 조직 안에서 반복되는 “일의 단위”가 무엇인지부터 정의하는 편이 훨씬 낫습니다.

---

### 자가 검토 및 개선 사항
1. **어제 글과 차별화**: 전날 런타임 중심 글과 겹치지 않도록, 오늘은 MCP를 데이터 메쉬와 조직 설계 문제로 확장해 논지를 분리했습니다.
2. **추상론 축소**: “MCP가 중요하다” 수준에서 멈추지 않고 capability registry, policy, runtime 분리, 연결성 모델까지 구현 관점을 넣었습니다.
3. **실무성 강화**: 단순 검색/연결보다 승인, 감사, 빌드 검증, 게시 파이프라인 같은 운영 포인트를 강조했습니다.
4. **한국 독자 적합화**: 국내 기업의 단절된 시스템, 반정형 UI, 높은 보안 요구를 반영해 왜 지금 이 관점이 필요한지 맥락을 보강했습니다.
5. **가독성 개선**: 문제 제기 → 실패 패턴 → 설계 원칙 → 코드 예시 → 팀 체크리스트 순서로 재구성해 읽는 흐름을 선명하게 정리했습니다.
