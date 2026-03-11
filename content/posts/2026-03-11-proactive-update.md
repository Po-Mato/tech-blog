---
title: Agentic Workflow를 활용한 기술 문서 자동화의 아키텍처적 접근
date: 2026-03-11
tags: [agentic-workflow, architecture, automation]
---

## 서론: 문서화의 역설
개발자에게 문서화는 필수적이지만 가장 미뤄지는 작업입니다. 우리는 코드는 자동화하지만, 문서는 수동으로 관리하는 모순에 빠져 있습니다. 오늘은 Agentic Workflow를 활용하여 기술 문서를 '코드 기반의 아티팩트'로 유지하는 전략을 탐구합니다.

## 아키텍처 제안
문서화를 단순한 텍스트 파일이 아닌, CI/CD 파이프라인의 일부로 편입시켜야 합니다.

1.  **Trigger**: Git Commit/PR이 발생하면 Agent가 트리거됩니다.
2.  **Context Aggregation**: LLM이 변경된 코드와 기존 `architecture.md`를 비교 분석합니다.
3.  **Synthesis**: 변경사항을 반영하여 문서를 업데이트합니다.
4.  **Verification**: 문서 내 코드 스니펫이 현재 빌드와 일치하는지 검증합니다.

## 코드 예시 (TypeScript Pseudocode)
```typescript
interface DocAgent {
  sync(diff: CodeDiff, currentDocs: Markdown[]): Promise<Markdown>;
  verify(doc: Markdown): Promise<boolean>;
}

// 자동 동기화 프로세스
async function autoDocPipeline(pr: PullRequest) {
  const diff = await getCodeDiff(pr);
  const agent = new AgenticDocGenerator();
  const updatedDoc = await agent.sync(diff, CURRENT_DOCS);
  
  if (await agent.verify(updatedDoc)) {
    await commit(updatedDoc);
  }
}
```

## Self-Critique (자가 검토)
- **적절성**: 문서화 자동화라는 고전적 주제에 Agentic Workflow라는 현대적 해법을 제시하여 적절합니다.
- **전문성**: 추상적인 자동화를 넘어 CI/CD 파이프라인과의 통합을 강조하여 실무적인 아키텍처 제언을 담았습니다.
- **가독성**: 코드 예시를 포함하여 추상적인 개념을 구체화했습니다. 다만, 더 상세한 프롬프트 엔지니어링 예시가 있었으면 좋았을 것이라는 아쉬움이 남습니다. 다음 포스팅에서는 구체적인 System Prompt 설계를 다루겠습니다.
