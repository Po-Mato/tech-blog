---
title: "우주 배경(Three.js) 넣어보기"
date: "2025-12-17"
slug: "universe-background"
description: "배경 캔버스와 콘텐츠 레이어링을 정리합니다"
tags: ["threejs", "ui"]
---

# 우주 배경 넣어보기

`Universe` 컴포넌트는 클라이언트에서만 실행되어야 합니다.

- SSR/Server Component에서 DOM 접근하면 깨짐
- 따라서 `"use client"` + `dynamic(..., { ssr: false })` 조합이 안전합니다.

다음은 체크리스트:

- [x] 언마운트 시 renderer dispose
- [x] 리사이즈 처리
- [ ] 저사양 모드에서 배경 끄기 옵션
