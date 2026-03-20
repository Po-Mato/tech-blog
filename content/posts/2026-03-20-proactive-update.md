---
title: "AI가 React 코드를 더 많이 쓸수록, 팀은 컴포넌트보다 아키텍처를 먼저 설계해야 한다"
date: 2026-03-20
tags: ["AI", "React", "Frontend", "Architecture", "TypeScript"]
---

# AI가 React 코드를 더 많이 쓸수록, 팀은 컴포넌트보다 아키텍처를 먼저 설계해야 한다

2026년 프론트엔드 흐름을 보면 흥미로운 역전이 하나 보입니다. 예전에는 React 개발 생산성을 높이기 위해 사람이 직접 `memo`, `useMemo`, `useCallback`을 촘촘히 배치하고, 번들 크기와 렌더링 비용을 집요하게 관리하는 팀이 강하다고 여겨졌습니다. 하지만 지금은 상황이 달라졌습니다.

- AI가 컴포넌트 초안을 매우 빠르게 생성합니다.
- React Compiler RC처럼 **수동 마이크로 최적화의 일부를 컴파일러가 흡수하려는 흐름**이 강해졌습니다.
- Next.js, TanStack Start, Vercel AI SDK, TanStack Query, tRPC, Zod, Better Auth 같은 조합이 **“AI가 쓰기 쉬운 스택”** 으로 묶여 논의됩니다.

이 변화가 의미하는 것은 단순하지 않습니다. 이제 프론트엔드 팀의 경쟁력은 “컴포넌트를 얼마나 빨리 만드는가”보다 **AI가 계속 코드를 생성·수정해도 시스템이 무너지지 않게 만드는가** 쪽으로 이동하고 있습니다.

제 결론은 명확합니다.

> **AI가 React 코드를 더 많이 생성할수록, 성능 병목의 핵심은 개별 컴포넌트가 아니라 상태 경계, 데이터 흐름, 권한 모델, 런타임 계약(contract)으로 이동한다.**

이번 글에서는 왜 그런지, 그리고 실제 팀이 어떤 아키텍처를 채택해야 하는지 Deep Dive 해보겠습니다.

## 1. React Compiler 시대에 바뀌는 것, 바뀌지 않는 것

최근 React Compiler RC 흐름에서 가장 인상적인 부분은, 팀들이 오랫동안 사람 손으로 해온 최적화 패턴 일부를 **빌드 단계의 자동화**로 옮기려 한다는 점입니다. 특히 SWC 기반 통합 가능성, React Hooks 규칙과 결합된 lint 흐름, 더 나은 dependency inference는 한 가지 메시지를 줍니다.

**“이제 컴포넌트 내부 미세 최적화는 점점 덜 차별화된다.”**

이건 React 개발자에게 좋은 소식이기도 하고, 불편한 소식이기도 합니다.

좋은 소식인 이유:
- 사람이 매번 `useCallback`과 `useMemo`의 비용 대비 효과를 계산하지 않아도 됩니다.
- AI가 생성한 초안 코드도 일정 수준까지는 자동 최적화 혜택을 받을 수 있습니다.
- 코드 리뷰가 “왜 여기 memo 안 썼어?”에서 벗어날 가능성이 있습니다.

불편한 소식인 이유:
- **진짜 문제는 이제 컴포넌트 바깥에서 터집니다.**
- 잘못된 상태 배치, 중복 fetch, 서버/클라이언트 책임 혼선, 느슨한 타입 경계는 컴파일러가 해결해주지 못합니다.
- AI가 생산하는 코드량이 늘수록 이런 구조적 결함은 더 빨리 증폭됩니다.

즉, React Compiler는 프론트엔드 엔지니어를 대체하는 기술이 아니라, 엔지니어의 집중 포인트를 바꿉니다.

- 전: 렌더링 최적화 중심
- 후: **아키텍처 제약 설계 중심**

## 2. AI 생성 코드가 팀 코드베이스를 망가뜨리는 방식

AI가 만드는 React 코드는 대체로 “그럴듯한 로컬 최적”에는 강합니다. 문제는 시스템 관점에서는 자주 틀린다는 겁니다.

대표적인 패턴은 이렇습니다.

### 2.1 fetch가 사방에 흩어진다
같은 데이터를 여러 컴포넌트가 각자 가져오고, stale 정책도 제각각입니다.

### 2.2 서버 상태와 UI 상태가 뒤섞인다
로딩 상태, 필터 상태, 인증 상태, 서버 응답 캐시가 한 파일 안에서 섞이며 유지보수성이 급락합니다.

### 2.3 액션 권한이 컴포넌트 안에 하드코딩된다
`if (user.role === 'admin')` 같은 분기가 화면 여기저기에 퍼지고, 나중엔 정책 수정이 거의 불가능해집니다.

### 2.4 타입은 있는데 계약은 없다
TypeScript 타입은 존재하지만, 실제로는 API 응답 스키마와 폼 검증, 서버 mutation 계약이 따로 놀아서 런타임 오류가 계속 납니다.

핵심은 이것입니다.

> **AI는 코드 조각을 빠르게 생산하지만, 경계(boundary)를 자동으로 설계하지는 못한다.**

그래서 팀은 “AI가 잘 쓰는 스택”보다 먼저 **AI가 틀리기 어렵게 만드는 구조**를 설계해야 합니다.

## 3. 먼저 설계해야 할 것은 컴포넌트 트리가 아니라 상태 토폴로지다

제가 요즘 프론트엔드 아키텍처를 볼 때 가장 먼저 확인하는 것은 폴더 구조가 아니라 상태 지도입니다.

최소한 아래 네 가지는 분리돼야 합니다.

1. **Server State**: API 응답, 캐시, 재검증
2. **View State**: 모달 열림, 탭 선택, 입력 임시값
3. **Workflow State**: 여러 단계 액션의 진행 상황
4. **Auth/Policy State**: 사용자의 권한, 승인 가능 범위

이 네 가지를 한 레이어에서 관리하면 AI가 코드를 추가할수록 결합도가 폭증합니다.

예를 들어 좋은 출발점은 이런 식입니다.

```ts
// app/core/contracts.ts
import { z } from "zod";

export const PostSchema = z.object({
  id: z.string(),
  title: z.string(),
  excerpt: z.string().optional(),
  publishedAt: z.string(),
  authorRole: z.enum(["admin", "editor", "viewer"]),
});

export type Post = z.infer<typeof PostSchema>;

export const UpdatePostInputSchema = z.object({
  title: z.string().min(1),
  excerpt: z.string().max(220).optional(),
});

export type UpdatePostInput = z.infer<typeof UpdatePostInputSchema>;
```

이 코드는 단순한 Zod 예제가 아닙니다. 중요한 건 **UI가 직접 API를 추측하지 않게 만든다**는 점입니다. AI가 새로운 수정 폼을 만들더라도, 최소한 따라야 할 계약이 존재합니다.

그 위에 서버 상태는 TanStack Query 같은 계층으로 분리합니다.

```ts
// features/posts/queries.ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PostSchema, UpdatePostInputSchema } from "@/app/core/contracts";

export function usePost(postId: string) {
  return useQuery({
    queryKey: ["post", postId],
    queryFn: async () => {
      const res = await fetch(`/api/posts/${postId}`);
      const json = await res.json();
      return PostSchema.parse(json);
    },
    staleTime: 60_000,
  });
}

export function useUpdatePost(postId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: unknown) => {
      const payload = UpdatePostInputSchema.parse(input);
      const res = await fetch(`/api/posts/${postId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return PostSchema.parse(await res.json());
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["post", postId] });
    },
  });
}
```

여기서 얻는 이점은 두 가지입니다.

- AI가 만든 새 컴포넌트도 `usePost`, `useUpdatePost`를 재사용하게 유도할 수 있습니다.
- 검증, 캐시, invalidation 규칙이 한 곳에 모입니다.

즉, **AI에게 자유를 주려면 먼저 레일을 깔아야 합니다.**

## 4. 2026년형 React 팀은 “생성 친화적 구조”를 가져야 한다

AI가 참여하는 코드베이스에서는 아키텍처의 평가 기준도 바뀝니다. 저는 이걸 **generation-friendly architecture**라고 부르고 싶습니다.

좋은 구조는 사람이 이해하기 쉬운 구조이기도 하지만, 동시에 AI가 실수하기 어려운 구조여야 합니다.

그 기준은 대략 이렇습니다.

### 4.1 계약이 파일로 존재한다
- API 응답 스키마
- action input schema
- role / capability enum
- domain event 타입

### 4.2 side effect 진입점이 제한된다
- fetch는 query layer를 통한다
- mutation은 action layer를 통한다
- analytics는 event layer를 통한다

### 4.3 컴포넌트는 도메인보다 표현에 가깝다
- 복잡한 비즈니스 분기를 컴포넌트 안에서 처리하지 않는다
- 프레젠테이션 컴포넌트와 orchestration 컴포넌트의 경계를 둔다

### 4.4 권한은 UI 분기가 아니라 capability 모델로 표현한다
이 부분이 특히 중요합니다. AI가 생성한 UI는 역할(role) 조건문을 중구난방으로 퍼뜨리기 쉽기 때문입니다.

예를 들어 아래처럼 capability layer를 별도로 두는 편이 훨씬 낫습니다.

```ts
// app/auth/capabilities.ts
export type Capability =
  | "post.read"
  | "post.edit"
  | "post.publish"
  | "settings.manage";

const roleToCapabilities: Record<string, Capability[]> = {
  admin: ["post.read", "post.edit", "post.publish", "settings.manage"],
  editor: ["post.read", "post.edit", "post.publish"],
  viewer: ["post.read"],
};

export function can(role: string, capability: Capability) {
  return roleToCapabilities[role]?.includes(capability) ?? false;
}
```

그리고 UI에서는 이 capability를 소비만 합니다.

```tsx
// features/posts/PostActions.tsx
import { can } from "@/app/auth/capabilities";

export function PostActions({ role, onPublish }: {
  role: string;
  onPublish: () => void;
}) {
  return (
    <div className="flex gap-2">
      {can(role, "post.edit") && <button>수정</button>}
      {can(role, "post.publish") && (
        <button onClick={onPublish}>게시</button>
      )}
    </div>
  );
}
```

이 구조의 장점은 코드 예쁨이 아닙니다. **AI가 새 화면을 생성해도 정책 소스를 재사용하게 만들 수 있다는 것**입니다.

## 5. Next.js냐 TanStack Start냐보다 더 중요한 질문

요즘 스택 추천 글을 보면 보통 이런 질문으로 흘러갑니다.

- Next.js가 더 낫나?
- TanStack Start가 더 명시적인가?
- shadcn/ui가 AI 친화적인가?
- Vercel AI SDK vs TanStack AI 중 뭘 고를까?

이 질문들 자체는 유효합니다. 다만 저는 이보다 먼저 물어야 할 게 있다고 봅니다.

### 질문 1. 이 팀은 서버 상태 계약을 중앙화했는가?
프레임워크보다 중요합니다.

### 질문 2. 사용자 액션을 도메인 이벤트로 추적하는가?
AI 기능이 들어가면 특히 중요합니다. 왜냐하면 “모델이 무슨 결정을 했는가”뿐 아니라 “사용자가 어떤 결과를 승인했는가”도 추적해야 하기 때문입니다.

### 질문 3. RSC/SSR/CSR 경계를 문서화했는가?
Next.js에서 특히 중요합니다. AI가 코드를 생성할 때 이 경계가 अस्पष्ट하면 서버 전용 로직이 클라이언트로 새거나, 반대로 인터랙션이 깨집니다.

### 질문 4. 인증과 권한이 UI에서 분리돼 있는가?
Better Auth든 다른 솔루션이든 상관없습니다. 핵심은 UI가 auth provider 세부 구현과 강결합되지 않는가입니다.

즉, 도구 선택보다 **도구를 꽂아 넣을 슬롯 설계**가 더 중요합니다.

## 6. AI 기능이 들어간 제품에서 프론트엔드가 더 어려워지는 이유

여기서 한 단계 더 나가 보겠습니다. 단순 CRUD 앱이 아니라 AI 기능이 들어간 제품에서는 프론트엔드의 책임이 더 무거워집니다.

이제 UI는 결과를 렌더링하는 것만으로 끝나지 않습니다. 아래를 설명할 수 있어야 합니다.

- 어떤 입력이 모델에 전달됐는가
- 어떤 도구 호출이 발생했는가
- 진행 중인가, 대기 중인가, 실패했는가
- 사용자의 승인 없이는 넘어가면 안 되는 단계가 있는가

즉, AI UI의 핵심은 예쁜 채팅 버블이 아니라 **실행 상태를 드러내는 control plane** 입니다.

```tsx
type AgentStep = {
  id: string;
  label: string;
  status: "queued" | "running" | "waiting_approval" | "done" | "failed";
  risk?: "low" | "medium" | "high";
};

export function AgentRunPanel({ steps }: { steps: AgentStep[] }) {
  return (
    <section className="rounded-2xl border p-4">
      <h2 className="text-lg font-semibold">Execution Timeline</h2>
      <ul className="mt-4 space-y-3">
        {steps.map((step) => (
          <li key={step.id} className="rounded-xl border p-3">
            <div className="flex items-center justify-between">
              <strong>{step.label}</strong>
              <span>{step.status}</span>
            </div>
            {step.risk && <p className="mt-1 text-xs text-zinc-500">risk: {step.risk}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

이 컴포넌트 자체는 단순합니다. 하지만 설계 철학은 중요합니다.

- 상태 머신이 먼저다.
- 뷰는 상태를 반영한다.
- 모델/도구/정책의 경계는 UI에도 드러나야 한다.

이런 제품에서는 React Compiler가 일부 렌더링 비용을 줄여주는 것보다, **사용자 신뢰를 지탱하는 실행 구조를 얼마나 잘 드러내느냐**가 더 중요합니다.

## 7. 추천 구조: “컴파일러 + 계약 + 정책 + 실행 레이어”

제가 지금 시점에서 가장 현실적이라고 보는 구성은 아래와 같습니다.

```text
[React UI Layer]
  ├─ Presentational Components
  ├─ Execution Timeline / Approval UI
  └─ Feature Modules
        ↓
[Application Layer]
  ├─ Query Hooks
  ├─ Mutation Actions
  ├─ Form Models
  └─ View State Stores
        ↓
[Contract Layer]
  ├─ Zod Schemas
  ├─ Capability Model
  ├─ Domain Events
  └─ API Client Types
        ↓
[Runtime Layer]
  ├─ Auth Provider
  ├─ AI Provider SDK
  ├─ Data Services
  └─ Observability / Logs
        ↓
[Compiler / Build Layer]
  ├─ React Compiler
  ├─ SWC / Bundler
  └─ Lint / Static Analysis
```

이 구조가 좋은 이유는 명확합니다.

1. **컴파일러는 최적화를 맡고**
2. **계약 계층은 타입·검증을 맡고**
3. **애플리케이션 계층은 워크플로우를 맡고**
4. **런타임 계층은 인증·AI·데이터 서비스를 맡습니다.**

이렇게 나누면 AI가 어디에 새 코드를 추가해야 하는지도 비교적 명확해집니다. 그 결과 코드 생성량이 늘어나도 시스템 복잡도가 폭주하지 않습니다.

## 8. 실무 체크리스트: 지금 바로 팀에 적용할 것

### A. `useEffect` 최적화보다 계약 파일부터 정리하라
프론트엔드 저장소에서 가장 먼저 강화해야 할 것은 schema, event, capability입니다.

### B. fetch 금지 구역을 만들어라
직접 `fetch()`를 아무 데서나 호출하지 못하게 하고 query/action layer를 통과시키세요.

### C. role 기반 분기를 capability 기반으로 치환하라
이 작업은 시간이 조금 들지만, AI 생성 코드 품질을 눈에 띄게 올립니다.

### D. AI 기능 화면에는 실행 상태 패널을 기본 탑재하라
결과만 보여주지 말고, 진행·대기·승인·실패 상태를 노출하세요.

### E. 컴파일러 도입은 “리뷰 비용 절감” 관점으로 보라
React Compiler의 가치 중 하나는 성능 향상 자체보다도, 리뷰와 유지보수에서 반복적 최적화 논쟁을 줄일 수 있다는 점입니다.

## 마무리

프론트엔드의 다음 경쟁력은 더 이상 “누가 컴포넌트를 빨리 짜는가”에만 있지 않습니다. 그 영역은 이미 AI와 컴파일러가 빠르게 잠식하고 있습니다.

남는 것은 더 어려운 문제들입니다.

- 데이터 경계를 어떻게 나눌 것인가
- 정책을 어디서 강제할 것인가
- 실행 상태를 어떻게 설명할 것인가
- 생성된 코드가 어디로 흘러가야 하는가

그래서 2026년의 강한 React 팀은 단순히 AI 도구를 잘 쓰는 팀이 아니라, **AI가 계속 참여해도 무너지지 않는 구조를 먼저 설계한 팀**일 가능성이 높습니다.

컴파일러는 코드를 더 빠르게 만들 수 있습니다. 하지만 제품을 더 믿을 만하게 만드는 것은 결국 **아키텍처**입니다.

## Self-Critique

초안 작성 후 아래 부분을 중점적으로 보완했습니다.

1. **주제 중복 축소**: 전날 글이 브라우저 런타임 자체를 다뤘기 때문에, 이번 글은 React/AI 코드 생성 시대의 프론트엔드 구조 설계로 초점을 옮겨 반복을 줄였습니다.
2. **트렌드와 실무의 연결 강화**: React Compiler RC, AI 친화적 스택 논의를 단순 나열하지 않고, 왜 그것이 아키텍처 우선 전략으로 이어지는지 논리 사슬을 보강했습니다.
3. **코드 예시 실전성 개선**: schema, query/mutation, capability, execution panel 예시를 넣어 바로 팀 규약으로 전환할 수 있게 다듬었습니다.
4. **과장 표현 정리**: 외부 트렌드 신호는 “이런 흐름이 보인다” 수준으로 표현하고, 확정적·선동적 문장을 줄여 신뢰도를 높였습니다.
5. **가독성 보완**: 문단 길이를 줄이고, 설계 원칙 중심 소제목으로 재구성해 블로그 독자가 빠르게 핵심을 훑을 수 있게 정리했습니다.
