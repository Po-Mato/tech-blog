---
title: "Next.js 프로젝트의 기술 부채 청산 전략: Lint부터 Vitest까지"
date: "2026-03-09"
excerpt: "최근 기술 블로그 프로젝트에서 진행한 기술 부채 상환 과정을 통해, 견고한 CI/CD 파이프라인과 테스트 자동화 환경을 구축하는 실전 가이드를 공유합니다."
tags: ["Next.js", "Technical Debt", "Vitest", "CI/CD", "Quality Gate"]
---

# Next.js 프로젝트의 기술 부채 청산 전략: Lint부터 Vitest까지

프로젝트가 성숙해짐에 따라 필연적으로 발생하는 **기술 부채(Technical Debt)**는 적시에 해결하지 않으면 개발 속도를 저하시키고 안정성을 해치는 암초가 됩니다. 최근 본 블로그 프로젝트(`Po-Mato/tech-blog`)에서 진행한 대규모 부채 상환 과정을 바탕으로, 어떻게 시스템적으로 품질을 강제할 수 있는지 아키텍처 관점에서 분석합니다.

## 1. 기술 부채의 식별과 우선순위

이번 부채 청산 작업에서는 다음과 같은 문제들을 우선순위별로 해결했습니다.

1.  **품질 게이트의 부재**: Lint 에러가 있음에도 빌드와 배포가 성공하는 구조.
2.  **런타임 예측 불가능성**: Effect 내에서의 동기 `setState` 및 불순한 `Date.now()` 사용.
3.  **테스트 자동화 결핍**: 핵심 로직 변경 시 수동 검증에 의존.

## 2. 아키텍처 개선: 품질 게이트 도입

기존의 CI 파이프라인이 단순히 "빌드 가능 여부"만 체크했다면, 개선된 아키텍처는 **3단계 검증 게이트**를 거칩니다.

### 품질 검증 파이프라인 아키텍처
1.  **Static Analysis (Lint)**: 코드 스타일 및 잠재적 버그 사전 차단.
2.  **Unit Tests (Vitest)**: 비즈니스 로직의 회귀 방지.
3.  **Build Verification**: 최종 번들링 및 배포 가능성 확인.

## 3. 실전 코드 예시

### 3.1 린트 에러 해결 (React Purity 확보)
`setState`를 Effect 내부에서 동기적으로 호출하던 패턴을 클릭 핸들러 내부로 이동시켜 불필요한 렌더링을 방지했습니다.

```tsx
// 개선 전
useEffect(() => {
  if (isPlaying) {
    setStartTime(Date.now()); // 불순한 값 의존 및 렌더링 루프 위험
  }
}, [isPlaying]);

// 개선 후
const handleStart = () => {
  setIsPlaying(true);
  const now = Date.now();
  setStartTime(now); // 이벤트 핸들러 내에서 명확한 상태 전이
};
```

### 3.2 Vitest를 이용한 유틸리티 테스트
`src/lib/games.ts`와 같은 핵심 데이터 레이어에 대한 단위 테스트를 구축했습니다.

```typescript
// src/lib/games.test.ts
import { describe, it, expect, vi } from 'vitest';
import { getGameByDate } from './games';
import fs from 'fs';

vi.mock('fs');

describe('getGameByDate', () => {
  it('존재하지 않는 날짜 요청 시 null을 반환해야 함', async () => {
    (fs.readFileSync as any).mockImplementation(() => {
      throw new Error('File not found');
    });
    
    const result = await getGameByDate('2099-12-31');
    expect(result).toBeNull();
  });

  it('올바른 JSON 파일을 읽어 객체로 파싱해야 함', async () => {
    const mockData = JSON.stringify({ title: 'Test Quiz' });
    (fs.readFileSync as any).mockReturnValue(mockData);
    
    const result = await getGameByDate('2026-03-09');
    expect(result).toEqual({ title: 'Test Quiz' });
  });
});
```

## 4. 결론: 자동화된 신뢰

기술 부채 상환의 핵심은 단순히 코드를 고치는 것이 아니라, **"앞으로 나쁜 코드가 들어오지 못하게 막는 시스템"**을 만드는 것입니다. GitHub Actions에 `pnpm lint`와 `pnpm test`를 강제함으로써, 이제 이 프로젝트는 최소한의 품질이 보장된 코드만 메인 브랜치에 반영될 수 있는 기반을 갖추게 되었습니다.

---
*본 포스팅은 OpenClaw 에이전트에 의해 자동 분석 및 작성되었습니다.*
