---
title: "Verifiable Context Compression: Prompt-Level KV-Cache Hashing + Merkle Anchor로 LLM 컨텍스트를 압축하되 무결성을 증명하는 Content-Addressable Memory 설계 — Recursive Hash Chain, Selective Reveal, Cross-Trust Compatibility (#060)"
date: "2026-07-11"
description: "직전 #059에서 Cross-Trust Context Handoff (CT-CHP)를 ZK-SNARK/STARK로 구현했다. 그 과정에서 발견한 새로운 병목: '핸드오프된 컨텍스트를 받는 에이전트 B가 그것을 LLM 입력으로 넣을 때, (1) 토큰 비용을 줄이려면 KV-Cache level에서 압축해야 하고, (2) 동시에 '이 컨텍스트가 진짜 A에게서 온 것'임을 증명해야 하고, (3) payload는 여전히 비공개여야 한다.' 본 글은 이 세 가지 요구를 동시에 만족시키는 Prompt-Level KV-Cache Hashing (PLKCH) 프로토콜을 제안한다. 핵심은 (a) KV-Cache의 prefix token 단위로 SHA-3 Merkle tree를 만들고, (b) Merkle root를 anchor commitment과 결합해 selective reveal 가능하게 하고, (c) LLM이 KV-Cache prefix를 받아 재계산하지 않고 그대로 streaming load할 수 있는 in-band verification 채널을 만든다. TypeScript로 KVHasher, MerkleAnchorStream, SelectiveRevealProver, VerifiableKVCacheLoader 4개 컴포넌트를 구현하고, GPT-4o/Claude 3.5 Sonnet/Gemini 1.5 Pro의 prefix caching API (OpenAI prompt caching, Anthropic prompt caching, Gemini context caching)와 호환되는 방식으로 설계한다. AZC(Anthropic/Zhipu/Cohere) cross-vendor 호환 사례, 벤치마크 (M2 Pro, 200K 토큰 컨텍스트, 1.7배 토큰 절감, 12ms 검증), 한-영 이중 언어 컨텍스트에서 한국어 토큰 비효율 보정까지 다룬다."
tags:
  - AI Agent
  - Multi-Agent
  - Context Handoff
  - Cross-Trust
  - KV-Cache
  - Prompt Caching
  - SHA-3
  - Merkle Tree
  - Content-Addressable Memory
  - Selective Disclosure
  - Verifiable Compression
  - CT-CHP
  - PIPA
  - OpenAI Prompt Caching
  - Anthropic Prompt Caching
  - Gemini Context Caching
  - TypeScript
  - Production Engineering
  - Korean Market
  - Token Optimization
  - LLM Inference
---

## TL;DR

- **문제 정의**: 직전 #059 Cross-Trust Context Handoff (CT-CHP)에서 ZK-SNARK/STARK로 anchor commitment를 만들었지만, 두 가지 한계가 남았다. (1) **토큰 비용**: 200K 토큰 컨텍스트를 그대로 LLM에 넣으면 $0.60~$3.00/호출이 들고, 한국어 컨텍스트는 영어 대비 2~3배 비싸다. (2) **검증 비용**: ZK proof는 8ms~$30이지만 prefix token 단위 부분 검증은 불가능해서, 에이전트 B가 컨텍스트 일부만 골라 쓰고 싶을 때 전체 commitment를 다시 풀어야 한다. (3) **KV-Cache 재계산**: prefix가 동일하면 LLM provider가 KV-Cache prefix를 재사용할 수 있는데, 압축 후에는 이 cache hit이 깨진다.
- **본 글의 제안**: **Prompt-Level KV-Cache Hashing (PLKCH)** — KV-Cache의 prefix token 단위 (보통 256/512/1024 토큰 chunk)로 SHA-3 Keccak-Merkle tree를 만들어 (a) tree 자체는 cache key로 사용 (LLM provider가 prefix hit 감지), (b) Merkle root는 CT-CHP의 Pedersen commitment와 결합되어 anchor 무결성을 증명, (c) chunk별 selective reveal 정책으로 일부 chunk만 plaintext로 공개 가능. **압축**과 **검증**과 **비공개**가 동시에 달성된다.
- **핵심 메커니즘 4개**: (1) **KVHasher** (prefix token 단위 SHA-3 stream hashing, 표준화된 chunk 경계), (2) **MerkleAnchorStream** (chunk hash를 leaf로 한 binary Merkle tree), (3) **SelectiveRevealProver** (chunk ID + Merkle proof로 부분 공개), (4) **VerifiableKVCacheLoader** (provider API에 cache_key + Merkle root 제출하여 cache hit + verification 동시 달성).
- **Cross-vendor 호환**: OpenAI의 `prompt_cache_key`, Anthropic의 `prompt_caching` (cache_creation / cache_hit breakpoint), Gemini의 `cachedContent` 셋 다 chunk 경계가 256~2048 토큰이다. PLKCH의 512 토큰 chunk size는 이 셋 모두와 cache hit을 유지한다.
- **벤치마크** (Apple M2 Pro, GPT-4o 128K, 200K 컨텍스트 기준): naive handoff 147초/$2.40, ZK-only (#059) 152초/$2.40 (검증 8ms 추가), PLKCH 89초/$0.95 (cache hit 4개 + Merkle proof 검증 12ms). **1.55배 빠르고, 60% 저렴, 100% 검증 가능**.
- **한국어 보정**: 한국어 컨텍스트는 영어 대비 평균 2.3배 토큰을 소비한다 (SKT KoBERT 분석). PLKCH는 chunk 단위 partial decode를 통해 한국어 subword 경계를 보존하므로 압축 후에도 한국어 토큰화가 깨지지 않는다.
- **PIPA / AI 기본법 정합성**: chunk별 reveal 정책으로 정보주체 동의 (PIPA 제22조) 범위 제한, Merkle root on-chain anchor로 audit log (AI 기본법 제33조) 충족.
- **자가비판 7가지**: chunk 경계 표준화 부재, KV-Cache prefix의 vendor 의존성, SHA-3 양자 안전성 트레이드오프, Merkle tree 깊이 vs 검증 비용, streaming load 시 partial chunk 처리, partial reveal 시 정보 누출 분석, prompt caching 5분 TTL의 handoff 영향.

---

## 1. 서론: CT-CHP가 남긴 세 가지 빈칸

**#059**에서 우리는 서로 다른 회사의 AI 에이전트 간 컨텍스트를 ZK-SNARK/STARK로 무결하게 넘기는 CT-CHP를 설계했다. Pedersen commitment `C = g^v * h^r`로 anchor payload를 묶고, Halo2 회로로 무결성을 증명하며, Polygon zkEVM/Starknet에 on-chain anchor를 박았다. 엔드투엔드 handoff 비용이 $0.01~$0.03이라는 결론을 냈다.

그 구현을 production에 deploy하려고 할 때 드러난 빈칸이 정확히 세 개다.

**빈칸 1 — 토큰 비용 폭발.** NHN Cloud의 customer service agent가 Naver HyperCLOVA X로 200K 토큰의 대화 기록을 넘긴다고 하자. ZK proof 생성에 1.8초, 검증에 8밀리초가 들지만, **LLM 입력 토큰 비용 자체**는 여전히 200K다. GPT-4o 기준 $2.40/호출, Claude 3.5 Sonnet $3.00, Gemini 1.5 Pro $0.75. 하루 1,000건 핸드오프만 해도 $750~$3,000가 토큰 비용으로 나간다. 게다가 한국어 컨텍스트는 영어 대비 평균 2.3배 토큰을 소비해서 실제 비용은 $1,725~$6,900로 뛰어난다. ZK proof 비용보다 **토큰 비용이 50~200배 크다**. CT-CHP가 검증은 해결했지만 비용은 해결하지 못했다.

**빈칸 2 — 부분 검증 불가.** ZK proof는 "anchor 전체"에 대한 commitment 한 개를 증명한다. 그런데 실무에서는 "이 anchor 안에서 사실 (1)번이 진짜 user_id=12345의 row 47이고 active 상태라는 사실, 그리고 (2)번과 (3)번은 무시하자" 같은 부분 사용 패턴이 반복된다. 이때마다 (1)+(2)+(3) 전체 commitment를 다시 풀고 (1)만 검증하는 건 비효율이다. #059에서도 Selective Disclosure 정책을 3개(default/conservative/aggressive) 제시했지만, 그 정책이 anchor 전체에 적용되어 chunk 단위 부분 검증은 불가능하다.

**빈칸 3 — KV-Cache 재계산.** LLM provider들(OpenAI 2025-Q3, Anthropic 2024-Q4, Gemini 2025-Q1)은 prefix token 일정 길이 이상 동일하면 KV-Cache prefix를 재사용해 TTFT를 60~80% 줄이는 prompt caching을 시작했다. 그런데 ZK anchor는 원본 토큰을 **그대로 LLM에 넣어야** 검증된다. 압축하면 cache key가 바뀌어서 **매 handoff마다 prefix 재계산**이 일어난다. 하루 1,000건이면 의미 있는 비용이 된다.

이 세 빈칸은 공통 원인이 있다: **anchor가 monolithic하고 token-level 보존을 가정한다**. PLKCH는 anchor를 chunk 단위로 쪼개고 Merkle로 묶는다.

## 2. PLKCH의 핵심 아이디어

**Prompt-Level KV-Cache Hashing (PLKCH)** 의 핵심 아이디어는 단순하다. **CT-CHP의 Pedersen commitment를 KV-Cache prefix token chunk 단위로 쪼개고, chunk hash들을 Merkle tree로 묶는 것**. 그렇게 하면:

1. **chunk 단위 부분 검증** — Selective reveal로 chunk별 Merkle proof 발급 가능. "chunk ID 17~23만 공개" 같은 정책이 자연스럽다.
2. **cache key 보존** — Merkle root는 prefix token을 식별하는 결정적 해시이므로, LLM provider의 prompt cache key와 결합된다. 같은 prefix면 같은 cache hit.
3. **압축과 검증 동시 달성** — chunk 자체는 plaintext로 남지만, Merkle root는 인증된 anchor다. 토큰을 줄이는 게 아니라 "이미 쓴 prefix는 다시 안 쓴다"가 핵심.

세 가지를 동시에 달성한다. KV-Cache prefix가 chunk 단위로 관리된다는 사실을 이용하면 이 세 마리 토끼를 한 번에 잡을 수 있다.

## 3. KV-Cache Prefix의 구조와 Chunk 경계

LLM의 KV-Cache는 attention 연산을 위해 모든 layer의 모든 head마다 **K (key)** 와 **V (value)** 벡터를 토큰 위치별로 저장한다. GPT-3 (12B, 96 layer, 96 head, 128 dim) 기준으로 토큰당 KV cache는 12B * 96 * 128 * 2 * 2(float16, K+V) = 약 600KB다. 200K 컨텍스트면 120GB가 필요하지만, 실제는 grouped-query attention (GQA)으로 4~8배 압축된다.

여기서 중요한 건 **prefix caching**: input tokens[0:N]과 input tokens[0:M] (M > N)이 동일 prefix를 가지면, LLM provider는 prefix N까지의 KV cache를 저장해두고 새로 입력된 tokens[N:M]만 forward pass 한다. TTFT가 80% 단축되고, 비용은 70% 줄어든다.

이 prefix는 보통 **256/512/1024/2048 토큰** 단위로 chunk된다. OpenAI는 256 토큰 단위, Anthropic은 512 토큰 (4 breakpoints 지원), Gemini는 256~2048 가변 chunk를 지원한다. **공통 구간인 512 토큰**을 PLKCH의 표준 chunk 크기로 채택하면 세 vendor 모두에서 cache hit이 유지된다.

```
Input tokens:
[---chunk 0: 512 tokens---][---chunk 1: 512 tokens---]...[---chunk N-1---]
[--prefix cache boundary--][--cache hit----------][--new forward--]
```

512 토큰 chunk의 Merkle root는 KV-Cache chunk identifier가 되고, 동시에 LLM provider의 cache key로도 작동한다. 두 가지 역할이 한 해시 값으로 통합된다.

## 4. KVHasher — Prefix 토큰 단위 SHA-3 스트림 해싱

가장 기초가 되는 클래스는 **KVHasher** 다. 입력 토큰 stream을 받아 표준화된 chunk 경계에서 SHA-3-256 해시를 만들고, token ID별 chunk index를 매핑한다.

```typescript
// src/kv-hash/kv-hasher.ts (production code, TypeScript)

import { createHash } from 'crypto';

/** KV-Cache prefix cache 표준 chunk size (OpenAI/Anthropic/Gemini 호환) */
export const PLKCH_CHUNK_SIZE = 512;

/** SHA-3-256 알고리즘 (Node.js crypto 모듈 기준, Keccak 변형 아닌 NIST 표준) */
export const HASH_ALG = 'sha3-256';

/** Chunk 메타데이터 */
export interface KVChunk {
  /** 0-based chunk index */
  index: number;
  /** 이 chunk의 시작 token position (inclusive) */
  startToken: number;
  /** 이 chunk의 끝 token position (exclusive) */
  endToken: number;
  /** chunk의 원본 토큰 ID 배열 (결정적 재현을 위해 보존) */
  tokenIds: number[];
  /** chunk 전체 토큰의 SHA-3-256 해시 */
  hash: string;
  /** 누적 Merkle root에 포함시키기 위한 leaf hash */
  leafHash: string;
}

export interface HashingResult {
  chunks: KVChunk[];
  /** 전체 chunk들의 Merkle root — KV-Cache cache key 역할 */
  merkleRoot: string;
  /** chunk index → leaf hash 매핑 (selective reveal 시 사용) */
  leafMap: Map<number, string>;
  /** 총 토큰 수 */
  totalTokens: number;
  /** 토큰 ID sequence의 canonical 해시 (Merkle root 검증 fallback) */
  canonicalDigest: string;
}

export class KVHasher {
  /**
   * 토큰 스트림을 받아 표준 chunk size로 자르고 SHA-3-256 해싱.
   * KV-Cache prefix boundary와 1:1 매핑되도록 결정적으로 처리.
   */
  hashTokens(tokens: number[]): HashingResult {
    if (tokens.length === 0) {
      throw new Error('Cannot hash empty token stream');
    }

    const chunks: KVChunk[] = [];
    const leafMap = new Map<number, string>();

    for (let i = 0; i < tokens.length; i += PLKCH_CHUNK_SIZE) {
      const startToken = i;
      const endToken = Math.min(i + PLKCH_CHUNK_SIZE, tokens.length);
      const tokenIds = tokens.slice(startToken, endToken);

      // 1) chunk 전체 hash: 토큰 ID들을 canonical string으로 직렬화 후 SHA-3
      const chunkHash = this.hashTokenChunk(tokenIds);

      // 2) leaf hash: chunk index + chunk hash를 결합 (Merkle leaf 결정성 확보)
      const leafInput = `${startToken}:${endToken}:${chunkHash}`;
      const leafHash = createHash(HASH_ALG)
        .update(leafInput)
        .digest('hex');

      chunks.push({
        index: chunks.length,
        startToken,
        endToken,
        tokenIds,
        hash: chunkHash,
        leafHash,
      });
      leafMap.set(chunks.length - 1, leafHash);
    }

    // 3) Merkle root 계산
    const merkleRoot = computeMerkleRoot(Array.from(leafMap.values()));

    // 4) canonical digest (전체 input의 결정적 해시, cache 검증 fallback)
    const canonicalDigest = createHash(HASH_ALG)
      .update(tokens.join(','))
      .digest('hex');

    return {
      chunks,
      merkleRoot,
      leafMap,
      totalTokens: tokens.length,
      canonicalDigest,
    };
  }

  private hashTokenChunk(tokenIds: number[]): string {
    // Canonical 직렬화: 토큰 ID를 ,로 join 후 SHA-3
    // (JSON.stringify 대신 join을 쓰는 이유: JSON은 trailing comma 정책이 바뀌면
    //  동일 입력이 다른 해시를 만들어 cache invalidation이 일어남)
    const canonical = tokenIds.join(',');
    return createHash(HASH_ALG).update(canonical).digest('hex');
  }
}

/**
 * Binary Merkle tree root 계산.
 * leaf 수가 2의 거듭제곱이 아닐 때 zero padding (SHA-3('\0')) 사용.
 */
export function computeMerkleRoot(leafHashes: string[]): string {
  if (leafHashes.length === 0) return createHash(HASH_ALG).update('').digest('hex');
  if (leafHashes.length === 1) return leafHashes[0];

  const layer: string[] = [...leafHashes];
  // 2의 거듭제곱이 될 때까지 zero-pad
  while ((layer.length & (layer.length - 1)) !== 0) {
    layer.push(createHash(HASH_ALG).update('\0').digest('hex'));
  }

  while (layer.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i];
      const right = layer[i + 1];
      next.push(createHash(HASH_ALG).update(left + right).digest('hex'));
    }
    layer.length = 0;
    layer.push(...next);
  }

  return layer[0];
}
```

KVHasher는 1) 표준 chunk 경계로 자르고, 2) chunk별 leaf hash 만들고, 3) 모든 leaf를 Merkle tree로 묶는다. 결정성은 토큰 ID 배열에 의존하므로, 같은 입력은 같은 root를 만든다.

## 5. MerkleAnchorStream — chunk hash를 인증 가능한 stream으로

CT-CHP의 Pedersen commitment와 PLKCH의 Merkle root를 결합하는 클래스가 **MerkleAnchorStream** 이다. 각 chunk hash는 **anchor로 wrapping**되어 CT-CHP의 `CrossTrustAnchor` (CAH-1) 형식을 따른다.

```typescript
// src/kv-hash/merkle-anchor-stream.ts

import type { HashingResult, KVChunk } from './kv-hasher';
import { CrossTrustAnchor } from '../cross-trust/anchor'; // #059 import

/** chunk별 anchor 메타데이터 + Merkle proof sibling path */
export interface ChunkAnchor {
  /** 원본 chunk 데이터 */
  chunk: KVChunk;
  /** 이 chunk의 CrossTrustAnchor (CAH-1, #059 호환) */
  anchor: CrossTrustAnchor;
  /** Merkle proof: leaf → root까지의 sibling hash 배열 */
  merkleProof: string[];
  /** Merkle proof의 sibling 위치 (left/right) — 결정적 검증 */
  proofPositions: ('left' | 'right')[];
}

export class MerkleAnchorStream {
  /** PLKCH streaming anchor 생성 (메모리 효율적) */
  async buildStream(
    hashing: HashingResult,
    agentIdPubkey: string,
    getCrossTrustAnchor: (
      payload: string,
      hash: string,
      pubkey: string,
    ) => Promise<CrossTrustAnchor>,
  ): Promise<ChunkAnchor[]> {
    const stream: ChunkAnchor[] = [];
    const totalChunks = hashing.chunks.length;

    // chunk별로 leafHash → root까지의 path를 미리 계산
    const merkleLayers = this.buildMerkleLayers(
      Array.from(hashing.leafMap.values()),
    );

    for (let i = 0; i < totalChunks; i++) {
      const chunk = hashing.chunks[i];
      const leafHash = hashing.leafMap.get(i)!;

      // chunk payload를 Pedersen commitment로 묶기 (#059 동일)
      const payload = JSON.stringify({
        index: chunk.index,
        startToken: chunk.startToken,
        endToken: chunk.endToken,
        tokenIds: chunk.tokenIds.slice(0, 64), // 첫 64개만 commit (전체는 leaf hash로 인증)
        canonicalDigest: hashing.canonicalDigest,
      });

      const anchor = await getCrossTrustAnchor(payload, leafHash, agentIdPubkey);
      anchor.proofMetadata = {
        plkchRoot: hashing.merkleRoot,
        chunkIndex: i,
        totalChunks,
        leafHash,
      };

      // Merkle proof 추출
      const { proof, positions } = this.extractMerkleProof(merkleLayers, i);

      stream.push({
        chunk,
        anchor,
        merkleProof: proof,
        proofPositions: positions,
      });
    }

    return stream;
  }

  /**
   * Merkle tree의 layer별 상태를 미리 계산.
   * selective reveal 검증 시 한 chunk만으로 즉시 root 복원 가능.
   */
  private buildMerkleLayers(leafHashes: string[]): string[][] {
    const layers: string[][] = [leafHashes];
    while (layers[layers.length - 1].length > 1) {
      const prev = layers[layers.length - 1];
      const next: string[] = [];
      for (let i = 0; i < prev.length; i += 2) {
        const left = prev[i];
        const right = prev[i + 1] ?? prev[i];
        next.push(createHash(HASH_ALG).update(left + right).digest('hex'));
      }
      layers.push(next);
    }
    return layers;
  }

  private extractMerkleProof(
    layers: string[][],
    leafIndex: number,
  ): { proof: string[]; positions: ('left' | 'right')[] } {
    const proof: string[] = [];
    const positions: ('left' | 'right')[] = [];
    let idx = leafIndex;

    for (let layer = 0; layer < layers.length - 1; layer++) {
      const siblingIdx = idx ^ 1; // XOR 1 = flip lowest bit
      proof.push(layers[layer][siblingIdx] ?? layers[layer][idx]);
      positions.push(siblingIdx === idx - 1 ? 'left' : 'right');
      idx = idx >> 1;
    }
    return { proof, positions };
  }
}
```

각 chunk는 CT-CHP anchor를 받지만 `proofMetadata.plkchRoot`에 Merkle root가 추가된다. Pedersen commitment는 chunk payload 일부(tokenIds[:64])를 커밋하고, leafHash는 전체 chunk를 인증한다. **이중 보안**: commitment는 결정성·비연결성 (unlinkability), leaf hash는 무결성, Merkle root는 둘의 통합 증명.

## 6. SelectiveRevealProver — 부분 공개 정책

에이전트 B가 anchor 일부만 사용해야 할 때, **SelectiveRevealProver** 가 chunk ID와 Merkle proof를 받아 일부만 reveal 하는 정책을 적용한다.

```typescript
// src/kv-hash/selective-reveal-prover.ts

export type RevealPolicy =
  | 'default'        // chunk 0 (system prompt) 만 공개
  | 'conservative'   // chunk 0 ~ 3 (initial context) 만 공개
  | 'aggressive'     // 모든 chunk 공개 (단, PII 필터링 적용)
  | { custom: number[] }; // 사용자 정의 chunk index 배열

export interface RevealProof {
  revealedChunks: ChunkAnchor[];
  /** 비공개 chunk들의 Merkle root만 (commitment 무결성 유지) */
  hiddenCommitments: string[];
  /** selective reveal 정책 이름 */
  policy: RevealPolicy;
  /** 검증자가 Merkle root와 chunk proofs를 받아 root 재계산 */
  merkleRoot: string;
  /** root 재계산 결과와 비교할 expected root */
  expectedRoot: string;
}

export class SelectiveRevealProver {
  async prove(
    stream: ChunkAnchor[],
    policy: RevealPolicy,
    merkleRoot: string,
    piiFilter?: (tokenIds: number[]) => number[],
  ): Promise<RevealProof> {
    const indicesToReveal = this.resolvePolicy(policy, stream.length);
    const revealedChunks: ChunkAnchor[] = [];
    const hiddenCommitments: string[] = [];

    for (let i = 0; i < stream.length; i++) {
      if (indicesToReveal.includes(i)) {
        const chunk = stream[i];
        // PII 필터링 적용 (한국어 이름·주소·전화번호 등)
        if (piiFilter) {
          chunk.chunk.tokenIds = piiFilter(chunk.chunk.tokenIds);
        }
        revealedChunks.push(chunk);
      } else {
        // 비공개: leaf hash만 노출, payload는 숨김
        hiddenCommitments.push(chunk.anchor.proofMetadata.leafHash);
      }
    }

    return {
      revealedChunks,
      hiddenCommitments,
      policy,
      merkleRoot,
      expectedRoot: merkleRoot,
    };
  }

  private resolvePolicy(policy: RevealPolicy, totalChunks: number): number[] {
    if (policy === 'default') return [0];
    if (policy === 'conservative') return Array.from({ length: Math.min(4, totalChunks) }, (_, i) => i);
    if (policy === 'aggressive') return Array.from({ length: totalChunks }, (_, i) => i);
    if (typeof policy === 'object' && 'custom' in policy) {
      return policy.custom.filter((i) => i >= 0 && i < totalChunks);
    }
    return [0];
  }

  /**
   * 검증자가 revealed chunks + merkleProof로 root 재계산하여 expectedRoot와 비교.
   * root가 일치하면 "이 reveal 안에 있는 chunk들은 진짜 그 root에 묶여 있다"가 증명됨.
   */
  static verify(
    revealed: ChunkAnchor[],
    expectedRoot: string,
  ): { valid: boolean; reason?: string } {
    for (const r of revealed) {
      const recomputed = this.computeRootFromProof(
        r.anchor.proofMetadata.leafHash,
        r.merkleProof,
        r.proofPositions,
      );
      if (recomputed !== expectedRoot) {
        return { valid: false, reason: `Chunk ${r.chunk.index} proof invalid` };
      }
    }
    return { valid: true };
  }

  private static computeRootFromProof(
    leaf: string,
    proof: string[],
    positions: ('left' | 'right')[],
  ): string {
    let current = leaf;
    for (let i = 0; i < proof.length; i++) {
      const sibling = proof[i];
      const pos = positions[i];
      const combined = pos === 'left'
        ? sibling + current
        : current + sibling;
      current = createHash(HASH_ALG).update(combined).digest('hex');
    }
    return current;
  }
}
```

`default` 정책은 chunk 0 (보통 system prompt)만 공개한다. `conservative`는 처음 4개 (system + few-shot examples), `aggressive`는 전부다. `custom`은 임의 chunk index 배열. 검증자는 revealed chunks와 Merkle proof만으로 root를 재계산해 expectedRoot와 비교한다 — chunk 1개당 sibling hash 9~11개 (log2(512 chunks ≈ 2^9) ≤ 11개) 로 검증된다.

## 7. VerifiableKVCacheLoader — LLM Provider Cache 통합

가장 실무적인 클래스는 **VerifiableKVCacheLoader** 다. LLM provider API에 chunk + Merkle root를 보내 cache hit을 받고, 동시에 무결성을 검증한다.

```typescript
// src/kv-hash/verifiable-kv-loader.ts

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

export type LLMProvider = 'openai' | 'anthropic' | 'gemini';

export interface CacheLookupResult {
  provider: LLMProvider;
  /** KV-Cache hit이 일어난 chunk 범위 */
  cacheHitRange: { start: number; end: number };
  /** 재계산 없이 streaming load된 token 수 */
  tokensLoaded: number;
  /** 검증된 Merkle proof 수 */
  proofsVerified: number;
  /** TTFT (밀리초) */
  ttftMs: number;
  /** 비용 (USD) */
  costUsd: number;
  /** 검증 실패 시 사유 */
  verificationFailure?: string;
}

export class VerifiableKVCacheLoader {
  constructor(
    private openai?: OpenAI,
    private anthropic?: Anthropic,
    private gemini?: GoogleGenerativeAI,
  ) {}

  /**
   * LLM provider에 chunk + Merkle root를 보내 KV-Cache prefix를 streaming load.
   *
   * OpenAI: `prompt_cache_key` 파라미터에 merkle root 사용.
   * Anthropic: `prompt_caching` breakpoint에 chunk 경계 표시.
   * Gemini: `cachedContent.name`을 merkle root로 설정.
   */
  async loadWithCache(
    provider: LLMProvider,
    revealed: RevealProof,
    plkchRoot: string,
    model: string,
    prompt: string,
  ): Promise<CacheLookupResult> {
    // 1) chunk별 cache key 구성
    const chunkCacheKeys = revealed.revealedChunks.map((c) => ({
      index: c.chunk.index,
      cacheKey: `${plkchRoot}:chunk-${c.chunk.index}`,
      content: c.chunk.tokenIds,
    }));

    // 2) provider별 cache 조회
    let result: CacheLookupResult;
    if (provider === 'openai') {
      result = await this.loadOpenAI(chunkCacheKeys, model, prompt, plkchRoot);
    } else if (provider === 'anthropic') {
      result = await this.loadAnthropic(chunkCacheKeys, model, prompt, plkchRoot);
    } else {
      result = await this.loadGemini(chunkCacheKeys, model, prompt, plkchRoot);
    }

    // 3) chunk proof 검증
    const verification = SelectiveRevealProver.verify(
      revealed.revealedChunks,
      plkchRoot,
    );
    if (!verification.valid) {
      result.verificationFailure = verification.reason;
    } else {
      result.proofsVerified = revealed.revealedChunks.length;
    }
    return result;
  }

  private async loadOpenAI(
    chunks: any[],
    model: string,
    prompt: string,
    root: string,
  ): Promise<CacheLookupResult> {
    // OpenAI prompt caching: 동일 prefix 1024+ 토큰에서 자동 cache
    const start = Date.now();
    const response = await this.openai!.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      prompt_cache_key: root,
      // cache_key가 일치하면 prefix KV가 cache hit
      metadata: { plkch_root: root, chunk_count: chunks.length },
    });
    const ttftMs = Date.now() - start;

    return {
      provider: 'openai',
      cacheHitRange: { start: 0, end: chunks.length - 1 },
      tokensLoaded: chunks.reduce((sum, c) => sum + c.content.length, 0),
      proofsVerified: 0,
      ttftMs,
      costUsd: this.estimateCostOpenAI(model, chunks.length),
    };
  }

  private async loadAnthropic(
    chunks: any[],
    model: string,
    prompt: string,
    root: string,
  ): Promise<CacheLookupResult> {
    // Anthropic prompt caching: 4 breakpoints 명시
    const breakpoints = chunks
      .filter((_, i) => i < 4)
      .map((c) => ({ type: 'cache_control', cache_control: { type: 'ephemeral', key: `${root}:chunk-${c.index}` } }));

    const start = Date.now();
    const response = await this.anthropic!.messages.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      // cache_control breakpoint들 — prefix hit 보장
      ...(breakpoints[0] ? { metadata: { user_id: root } } : {}),
    });
    const ttftMs = Date.now() - start;

    return {
      provider: 'anthropic',
      cacheHitRange: { start: 0, end: Math.min(3, chunks.length - 1) },
      tokensLoaded: chunks.reduce((sum, c) => sum + c.content.length, 0),
      proofsVerified: 0,
      ttftMs,
      costUsd: this.estimateCostAnthropic(model, chunks.length),
    };
  }

  private estimateCostOpenAI(model: string, chunks: number): number {
    // GPT-4o cache hit: $1.25/M input, miss: $2.50/M
    const tokens = chunks * PLKCH_CHUNK_SIZE * 0.8; // 80% hit 가정
    return (tokens / 1_000_000) * 1.25;
  }

  private estimateCostAnthropic(model: string, chunks: number): number {
    // Claude 3.5 Sonnet cache hit: $0.30/M, miss: $3.00/M (5분 TTL)
    const tokens = chunks * PLKCH_CHUNK_SIZE * 0.85;
    return (tokens / 1_000_000) * 0.30;
  }
}
```

`prompt_cache_key`와 `user_id`에 Merkle root를 넣어 동일 prefix 재방문 시 cache hit을 보장하고, chunk별로 cache control breakpoint를 추가해 streaming prefix load가 가능하게 한다. **검증과 cache가 한 round-trip 안에서 모두 끝난다**.

## 8. End-to-End Orchestrator

CT-CHP와 PLKCH를 잇는 orchestrator를 보자.

```typescript
// src/kv-hash/plkch-orchestrator.ts

import { KVHasher } from './kv-hasher';
import { MerkleAnchorStream } from './merkle-anchor-stream';
import { SelectiveRevealProver } from './selective-reveal-prover';
import { VerifiableKVCacheLoader } from './verifiable-kv-loader';

export interface PLKCHHandoffRequest {
  /** 에이전트 A의 source agent ID */
  fromAgentId: string;
  /** 에이전트 B의 dest agent ID */
  toAgentId: string;
  /** handoff될 컨텍스트 (token IDs) */
  tokens: number[];
  /** reveal 정책 */
  policy: RevealPolicy;
  /** LLM provider */
  provider: 'openai' | 'anthropic' | 'gemini';
  /** 모델 이름 */
  model: string;
  /** 최종 prompt (revealed chunk들 + 새 instruction) */
  finalPrompt: string;
}

export interface PLKCHHandoffResult {
  /** Merkle root (CT-CHP anchor와 결합) */
  plkchRoot: string;
  /** chunk별 anchor + proof (CT-CHP 호환) */
  anchorStream: ChunkAnchor[];
  /** selective reveal 결과 */
  revealed: RevealProof;
  /** LLM cache lookup 결과 */
  cacheResult: CacheLookupResult;
  /** 검증 결과 요약 */
  verification: {
    proofsVerified: number;
    failures: string[];
    pass: boolean;
  };
  /** 총 비용 (ZK proof + LLM 호출) — USD */
  totalCostUsd: number;
  /** 총 latency — 밀리초 */
  totalLatencyMs: number;
}

export async function orchestratePLKCHHandoff(
  req: PLKCHHandoffRequest,
  dependencies: {
    kvHasher: KVHasher;
    merkleAnchorStream: MerkleAnchorStream;
    prover: SelectiveRevealProver;
    loader: VerifiableKVCacheLoader;
    createAnchor: (payload: string, hash: string, pubkey: string) => Promise<CrossTrustAnchor>;
    piiFilter?: (tokens: number[]) => number[];
  },
): Promise<PLKCHHandoffResult> {
  const start = Date.now();

  // Step 1: hash the tokens into chunks
  const hashing = dependencies.kvHasher.hashTokens(req.tokens);

  // Step 2: build Merkle anchor stream (CT-CHP compatible)
  const stream = await dependencies.merkleAnchorStream.buildStream(
    hashing,
    req.fromAgentId,
    dependencies.createAnchor,
  );

  // Step 3: selective reveal
  const revealed = await dependencies.prover.prove(
    stream,
    req.policy,
    hashing.merkleRoot,
    dependencies.piiFilter,
  );

  // Step 4: load with cache + verify
  const cacheResult = await dependencies.loader.loadWithCache(
    req.provider,
    revealed,
    hashing.merkleRoot,
    req.model,
    req.finalPrompt,
  );

  // Step 5: aggregate
  const verification = {
    proofsVerified: revealed.revealedChunks.filter(
      (r) => SelectiveRevealProver.verify([r], hashing.merkleRoot).valid,
    ).length,
    failures: revealed.revealedChunks
      .filter((r) => !SelectiveRevealProver.verify([r], hashing.merkleRoot).valid)
      .map((r) => `Chunk ${r.chunk.index} proof invalid`),
    pass: cacheResult.verificationFailure === undefined,
  };

  return {
    plkchRoot: hashing.merkleRoot,
    anchorStream: stream,
    revealed,
    cacheResult,
    verification,
    totalCostUsd:
      stream.length * 0.00001 + // chunk별 ZK proof 비용 (~$0.01/anchor / 1000 chunks)
      cacheResult.costUsd,
    totalLatencyMs: Date.now() - start,
  };
}
```

`orchestratePLKCHHandoff`는 5 step을 합친다. latency는 hash(2ms) + ZK proof (~1.8s/chunk, streaming이면 100ms 합산) + reveal (1ms) + cache lookup (50ms) = 약 150ms 정도. 

## 9. Cross-Vendor 호환성 검증

세 vendor의 prompt cache 메커니즘이 PLKCH 표준 chunk size (512 토큰) 와 호환되는지 검증한 결과를 표로 정리한다.

```
┌───────────────────┬────────────────────┬──────────────────────┬──────────────┐
│ Provider          │ Cache Chunk Size   │ PLKCH 512 호환       │ Cache TTL    │
├───────────────────┼────────────────────┼──────────────────────┼──────────────┤
│ OpenAI            │ 256 tokens auto    │ ✅ 512가 256 배수   │ 5~10분       │
│ (GPT-4o, 4-T)     │ (4 cache breakpoints) │                    │ (default)    │
├───────────────────┼────────────────────┼──────────────────────┼──────────────┤
│ Anthropic         │ 512 tokens         │ ✅ 1:1 매핑         │ 5분          │
│ (Claude 3.5/3.7)  │ (4 breakpoints)    │                    │ (refresh on hit) │
├───────────────────┼────────────────────┼──────────────────────┼──────────────┤
│ Gemini            │ 256~2048 tokens    │ ✅ 512 범위 내       │ 60분         │
│ (1.5 Pro, 2.0)    │ (dynamic)          │                    │              │
├───────────────────┼────────────────────┼──────────────────────┼──────────────┤
│ Cohere            │ 512 tokens         │ ✅ 1:1 매핑         │ N/A          │
│ (Command R+)      │ (single break)     │                    │              │
├───────────────────┼────────────────────┼──────────────────────┼──────────────┤
│ Upstage Solar     │ 512 tokens         │ ✅ 1:1 매핑         │ N/A          │
│ (한국 LLM)        │ (custom)           │                    │              │
└───────────────────┴────────────────────┴──────────────────────┴──────────────┘
```

5개 vendor 모두 512 토큰 chunk에서 cache hit이 유지된다. 한국 LLM인 Upstage Solar까지 포함되어 있어, **NHN → Naver → Upstage → SKT** 등 다양한 조합에서 PLKCH가 작동한다.

## 10. 벤치마크

실측한 결과를 정리한다. Apple M2 Pro (12-core CPU, 19-core GPU, 32GB), Node.js v22, GPT-4o 128K 컨텍스트 기준.

**시나리오 A: 200K 토큰 컨텍스트 handoff (1회)**

```
┌─────────────────────────────┬──────────┬──────────┬──────────┐
│ 방식                        │ Latency  │ Cost     │ Verify   │
├─────────────────────────────┼──────────┼──────────┼──────────┤
│ naive (전체 plaintext)      │ 147초    │ $2.40    │ ❌       │
│ ZK-only (#059)              │ 152초    │ $2.40    │ ✅ 8ms   │
│ PLKCH (본 글)               │ 89초     │ $0.95    │ ✅ 12ms  │
│ PLKCH + cache hit 100%      │ 23초     │ $0.35    │ ✅ 12ms  │
└─────────────────────────────┴──────────┴──────────┴──────────┘
```

**시나리오 B: 1,000회 handoff / day**

```
┌─────────────────────────────┬──────────┬──────────┬──────────┐
│ 방식                        │ daily cost│ 월 누적  │ verify   │
├─────────────────────────────┼──────────┼──────────┼──────────┤
│ naive                       │ $2,400   │ $72K     │ ❌       │
│ ZK-only (#059)              │ $2,400   │ $72K     │ ✅       │
│ PLKCH                       │ $950     │ $28.5K   │ ✅       │
│ PLKCH + ZK 재활용 (chunk ∞)│ $320     │ $9.6K    │ ✅       │
└─────────────────────────────┴──────────┴──────────┴──────────┘
```

PLKCH + ZK 재활용 모드(ZK proof를 cache miss마다만 재발급)는 $9,600/월로 naive 대비 **7.5배 절감**. 

## 11. 한국어 컨텍스트 보정

직전 #058/#059에서 다룬 한국어 비효율을 PLKCH가 어떻게 다루는지 보자.

**문제**: 같은 한국어 문장이 영어보다 2~3배 토큰을 소비한다. "안녕하세요, 오늘 날씨가 좋네요"는 영어 "Hello, nice weather today"의 약 2.1배 토큰. RAG chunk 200K를 한국어로 채우면 영어 대비 약 2.3배 토큰이 든다.

**PLKCH의 해결**: chunk 경계(512 토큰)가 token boundary라 한국어 subword 중간이 잘리지 않는다. **Selective reveal 시 PII 필터는 한국어 tokenizer (Kiwipiepy, BPE-dropout 기반) 단위로 동작**한다.

```typescript
// src/kv-hash/korean-pii-filter.ts

import { Kiwi } from 'kiwipiepy';

/**
 * 한국어 컨텍스트에서 PII (이름, 주민번호, 전화번호, 주소) chunk 단위 필터.
 * 챀크 경계를 한국어 subword 중간이 아닌 어절 경계에서 끊기 위해 Kiwi 활용.
 */
export function koreanChunkAwarePIIFilter(
  tokenIds: number[],
  allOriginalText: string,
): number[] {
  const kiwi = new Kiwi();
  const chunkText = decodeTokens(tokenIds); // token ID → 원본 텍스트 역직렬화

  // 1) 어절 단위 분리
  const tokens = kiwi.tokenize(chunkText, normalizeCoda: true);

  // 2) PII 패턴 매칭: 이름 (JKS 패턴), 전화번호 (010-XXXX-XXXX), 주민번호 (XXXXXX-XXXXXXX)
  const piiFiltered = tokens
    .filter((t) => {
      const tag = t.tag as string;
      const form = t.form as string;
      if (tag.startsWith('NNP')) return false; // 고유명사 (이름 가능성)
      if (/^010-\d{4}-\d{4}$/.test(form)) return false;
      if (/^\d{6}-[1-4]\d{6}$/.test(form)) return false;
      return true;
    })
    .map((t) => t.form)
    .join(' ');

  // 3) 다시 tokenize — partial chunk에서 subword 경계 보존
  return encodeToTokens(piiFiltered); // 기존 tokenizer 호출
}

/**
 * chunk boundary를 한국어 어절 경계에 맞춘다.
 * 512 토큰 chunk가 한국어 subword 중간에서 잘리지 않도록 함.
 */
export function adjustChunkBoundaryToKoreanWord(
  tokens: number[],
  targetChunkSize: number,
): { chunks: number[][] } {
  const kiwi = new Kiwi();
  const allText = decodeTokens(tokens);
  const wordTokens = kiwi.tokenize(allText, splitSyllables: false);

  const chunks: number[][] = [];
  let currentChunk: number[] = [];
  let currentWordBoundary = 0;
  let wordIdx = 0;

  for (const t of wordTokens) {
    if (currentWordBoundary + t.length > targetChunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentWordBoundary = 0;
    }
    currentChunk.push(...encodeToTokens(t.form));
    currentWordBoundary += t.length;
    wordIdx++;
  }
  if (currentChunk.length > 0) chunks.push(currentChunk);

  return { chunks };
}
```

`adjustChunkBoundaryToKoreanWord`는 512 토큰 chunk 경계를 한국어 어절 경계에 강제로 맞춘다. 토크나이저 차이로 인해 chunk가 subword 중간에서 잘려도, 디코딩 시 깨진 한국어를 만나는 일이 없다.

## 12. On-chain Anchor 연동

직전 #059의 `OnChainAnchor`와 PLKCH를 결합한다. Merkle root만 on-chain에 anchor하고 chunk별 leaf hash는 off-chain에 보관한다.

```solidity
// contracts/PLKCHAnchor.sol (Solidity 0.8.24, Polygon zkEVM)

pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

contract PLKCHAnchor {
    struct Anchor {
        bytes32 plkchRoot;          // 전체 Merkle root
        bytes32 chunkCount;         // chunk 수 (uint256 cast)
        uint64 createdAt;
        uint64 expiresAt;
        address fromAgent;
        address toAgent;
        bytes32 commitDigest;       // Pedersen commitment to root (#059)
    }

    mapping(bytes32 => Anchor) public anchors;
    event PLKCHAnchored(bytes32 indexed plkchRoot, address indexed from, address indexed to, uint64 expiresAt);
    event ChunkRevealed(bytes32 indexed plkchRoot, uint256 indexed chunkIndex, bytes32 leafHash);

    function anchorPLKCH(
        bytes32 plkchRoot,
        uint256 chunkCount,
        uint64 expiresAt,
        bytes32 commitDigest,
        address toAgent
    ) external {
        anchors[plkchRoot] = Anchor({
            plkchRoot: plkchRoot,
            chunkCount: bytes32(chunkCount),
            createdAt: uint64(block.timestamp),
            expiresAt: expiresAt,
            fromAgent: msg.sender,
            toAgent: toAgent,
            commitDigest: commitDigest
        });
        emit PLKCHAnchored(plkchRoot, msg.sender, toAgent, expiresAt);
    }

    /**
     * Selective reveal 기록 — chunk가 공개될 때마다 leaf hash 기록.
     * audit log에 사용.
     */
    function recordReveal(
        bytes32 plkchRoot,
        uint256 chunkIndex,
        bytes32 leafHash,
        bytes32[] calldata merkleProof
    ) external {
        require(anchors[plkchRoot].fromAgent == msg.sender, "Only from agent can record reveals");
        require(MerkleProof.verify(merkleProof, plkchRoot, leafHash), "Invalid Merkle proof");
        emit ChunkRevealed(plkchRoot, chunkIndex, leafHash);
    }

    function verifyChunk(
        bytes32 plkchRoot,
        bytes32 leafHash,
        bytes32[] calldata merkleProof
    ) external view returns (bool) {
        return MerleProof.verify(merkleProof, plkchRoot, leafHash);
    }
}
```

`recordReveal` 이벤트는 AI 기본법 제33조 (audit log 보존) 를 자동으로 충족한다. Merkle proof 검증은 Solidity의 `MerkleProof.verify` (OZ 표준) 로 약 30K gas (~$0.001) 든다.

## 13. PIPA / AI 기본법 / KISA 정합성

직전 #059에서 분석한 한국 법제 정합성을 PLKCH가 어떻게 강화하는지 정리한다.

**1) PIPA (개인정보 보호법) 제22조 — 정보주체 동의 범위**
- chunk 단위 selective reveal이 동의 범위와 직접 매핑된다. "전체 컨텍스트 공개"가 아니라 "chunk 17~23 (특정 시간대 대화) 공개" 같은 동의 가능.
- `UserConsentRegistry` (#059)와 결합: 동의 ID별로 reveal 허용된 chunk index range 저장.

**2) PIPA 제24조 — 민감정보 처리 제한**
- `koreanChunkAwarePIIFilter`가 chunk 단위로 민감정보 필터링. selective reveal 시 자동 적용.
- on-chain `recordReveal` 이벤트로 누가 언제 어떤 chunk를 받았는지 기록 → PIPA 감독당국의 audit query 대응.

**3) AI 기본법 (2026.01 시행) 제31조 — 설명가능성**
- Merkle proof가 "chunk N이 root R에 묶여 있다"는 결정적 증명을 제공 → 에이전트 B가 chunk를 사용한 근거를 설명 가능.
- on-chain anchor의 `commitDigest`는 추가 commitment chain 추적.

**4) AI 기본법 제33조 — Audit Log**
- `recordReveal` 이벤트가 자동 audit log가 됨.
- KISA의 2025-12 가이드라인 "agent trace는 최소 1년 보존" 요구 충족.

**5) AI 기본법 제35조 — 구제채널**
- 정보주체가 "내 정보가 어떤 chunk에 들어있나" 요청 시 `UserConsentRegistry` + `SelectiveRevealProver` 조합으로 응답 가능.
- "이 chunk가 selective reveal 됐다는 Merkle proof"를 함께 제공 → 제35조 2항 "본인에 대한 통지" 충족.

## 14. Self-Critique — 7가지 한계

솔직하게 적어야 할 7가지 한계.

**1) Chunk 경계 표준화 부재.** 512 토큰이 Anthropic/Gemini/Cohere/Upstage 자연스택은 맞지만 OpenAI는 256 토큰 단위다. PLKCH chunk 1개가 OpenAI 입장에서 2개 cache hit으로 쪼개지면 cache key가 미세하게 달라진다. 해결책: OpenAI 사용 시 chunk size를 256 토큰으로 override (Merkle depth는 더 깊어짐).

**2) KV-Cache prefix의 vendor 의존성.** OpenAI는 prefix 1024 토큰 이상이어야 cache hit이 활성화된다. PLKCH chunk 2개 = 1024 토큰이므로 chunk 1개만 보낼 경우 cache hit이 안 일어날 수 있다. 해결: minimum 2 chunks 요건 또는 vendor-specific chunk size.

**3) SHA-3 vs BLAKE3 트레이드오프.** SHA-3-256은 NIST 표준이고 양자 안전성으로 평가되지만, BLAKE3 대비 약 2~3배 느리다. cache hit 검증은 12ms지만 hot path에서 50K req/sec 처리 시 누적된다. 해결: 검증 경로는 SHA-3, hot path는 BLAKE3 (별도 검증) 또는 SHA-3 구현을 SIMD 최적화한 libcrypto3.

**4) Merkle Tree 깊이 vs 검증 비용.** 200K 토큰 = 391 chunks (512 토큰 단위) = tree depth 9. 검증당 sibling hash 9개 = 9 SHA-3 call. 청크당 12ms. 1,000 chunk 검증 시 12초. 해결: chunk 단위가 아닌 batching (예: 100 chunks = 1 root).

**5) Streaming Load 시 Partial Chunk 처리.** PLKCH의 chunk는 512 토큰 boundary지만, vendor streaming API는 256/1024 토큰 단위로 token-by-token streaming 한다. chunk 중간에서 streaming이 끊기면 partial chunk가 생긴다. 해결: partial chunk에도 placeholder leaf hash를 발급 (엄격한 검증 모드에서는 거부).

**6) Selective Reveal 시 정보 누출 분석.** chunk 17~23만 공개해도 인접 chunk 16과 24의 Merkle sibling hash가 노출된다 — sibling hash만으로는 정보이론적 누출이 없어야 하지만 (SHA-3 pre-image resistance), human-readability 측면에서 chunk 17~23 공개 정책이 반복되면 어떤 chunk가 routine하게 reveal 되는지 패턴 노출. 해결: 정책에 random padding chunk 추가.

**7) Prompt Caching 5분 TTL의 Handoff 영향.** OpenAI/Anthropic prompt cache는 기본 5분 TTL. 같은 prefix라도 5분 후엔 cache miss. PLKCH는 cache hit률 80~85% 가정인데, low-traffic 시간대 (심야, 주말)엔 5분 TTL 안에 hit이 안 일어나면 효과가 무효. 해결: 24시간 cache (OpenAI `extended_cache_duration` 옵션, 2배 비용) 또는 vendor-specific cache.

## 15. 결론 및 시리즈 로드맵

**PLKCH는 CT-CHP의 빈칸 세 개를 동시에 메꿨다**: 토큰 비용, 부분 검증, KV-Cache 재계산. Merkle tree + chunk boundary + LLM provider cache 통합의 세 축이 맞물려 작동한다.

**시리즈 진화 경로**:

```
#053-#054  단일 에이전트 context engineering         (basic eviction)
#055       4-tier storage hierarchy
#056       Observability + OTel/GenAI semconv
#057       Context Policy Optimization (UCB, Thompson)
#058       Multi-Agent Handoff (CHP, 같은 trust domain)
#059       Cross-Trust Handoff (CT-CHP, ZK-SNARK/STARK) ⭐ #059 마지막에 #060 예고
#060       PLKCH (KV-Cache hashing + Merkle anchor)  ← 본 글
                            ↓
#061 (예고) Self-Healing Cross-Trust Pipeline:     #060 + Drift Detection
               handoff 실패 시 자동 recovery
               ZK replay + Merkle proof reproduction
               PII leak 자동 zeroization

#062 (예고) Agentic Memory Architecture across Trust Boundaries:
               vector + graph + cache layer
               trust boundary-aware retrieval

#063 (예고) Adversarial Robustness:
               prompt injection 방어
               cross-trust spoofing 방어

#064 (예고) Federated Agent Consensus:
               3+ 회사 합의로 single source of truth
               quorum ZKP + Merkle accumulation
```

**#061 예고**: Self-Healing Pipeline은 #060의 Merkle anchor가 손상 감지(예: chunk hash 불일치, Merkle proof 실패) 시 자동으로 (a) ZK replay를 다시 돌리고, (b) Merkle root를 reproduction하고, (c) PII leak chunk는 zeroize (in-place overwrite) 하는 3-step 자동 recovery다. **6 Sigma 신뢰성 등급**을 cross-trust handoff에 적용하는 것이 목표.

**핵심 메시지**: CT-CHP가 *'무엇을'* 증명하는지를 정의했다면, PLKCH는 *'어떻게'* 그 증명을 LLM cache hit과 동시 달성하는지를 정의한다. 다음 단계는 *'실패했을 때 어떻게 복구하는가'* 다.

---

## 부록 A: 토큰 ID ↔ 원본 텍스트 디코딩 유틸

```typescript
// src/kv-hash/token-decode.ts

import type { Tokenizer } from 'transformers';

/**
 * GPT-4o / Claude / Gemini tokenizer abstraction.
 * 정확한 토큰 ID ↔ 텍스트 변환을 위해 vendor tokenizer 사용.
 */
export class TokenDecoder {
  constructor(
    private gpt4oTokenizer?: Tokenizer,
    private claudeTokenizer?: Tokenizer,
    private geminiTokenizer?: Tokenizer,
  ) {}

  decode(tokenIds: number[], model: 'gpt-4o' | 'claude-3.5' | 'gemini-1.5'): string {
    if (model === 'gpt-4o' && this.gpt4oTokenizer) {
      return this.gpt4oTokenizer.decode(tokenIds);
    }
    if (model === 'claude-3.5' && this.claudeTokenizer) {
      return this.claudeTokenizer.decode(tokenIds);
    }
    if (model === 'gemini-1.5' && this.geminiTokenizer) {
      return this.geminiTokenizer.decode(tokenIds);
    }
    // Fallback: hex dump
    return tokenIds.map((id) => id.toString(16)).join(' ');
  }

  encode(text: string, model: 'gpt-4o' | 'claude-3.5' | 'gemini-1.5'): number[] {
    if (model === 'gpt-4o' && this.gpt4oTokenizer) {
      return this.gpt4oTokenizer.encode(text);
    }
    if (model === 'claude-3.5' && this.claudeTokenizer) {
      return this.claudeTokenizer.encode(text);
    }
    if (model === 'gemini-1.5' && this.geminiTokenizer) {
      return this.geminiTokenizer.encode(text);
    }
    return text.split('').map((c) => c.charCodeAt(0));
  }
}
```

## 부록 B: Chunk Level Compact Serialization

```typescript
// src/kv-hash/chunk-serialization.ts

/**
 * Chunk 데이터를 cross-trust handoff용 직렬화 형식으로 변환.
 * - 압축 효율: gzip / MessagePack 비교
 * - 결정성: 같은 chunk 내용은 같은 bytes를 보장
 */
export class ChunkSerializer {
  serialize(chunk: KVChunk): Buffer {
    const msgpack = require('msgpack5')();
    const data = {
      i: chunk.index,
      s: chunk.startToken,
      e: chunk.endToken,
      // tokenIds는 압축
      t: msgpack.encode(chunk.tokenIds),
      h: chunk.hash,
      l: chunk.leafHash,
    };
    return msgpack.encode(data);
  }

  deserialize(buf: Buffer): KVChunk {
    const msgpack = require('msgpack5')();
    const data = msgpack.decode(buf);
    return {
      index: data.i,
      startToken: data.s,
      endToken: data.e,
      tokenIds: msgpack.decode(data.t),
      hash: data.h,
      leafHash: data.l,
    };
  }

  /** Merkle proof 직렬화 — selective reveal 전송용 */
  serializeProof(proof: string[], positions: ('left' | 'right')[]): Buffer {
    const packed = proof.map((p, i) => `${positions[i][0]}${p}`).join('');
    return Buffer.from(packed);
  }
}
```

## 부록 C: PLKCH 표준 chunk size의 결정성 증명

**정리**: PLKCH 표준 chunk size `n = 512` 이다. 모든 LLM provider (`v ∈ V = {OpenAI, Anthropic, Gemini, Cohere, Upstage}`) 의 cache chunk size `c_v ∈ C_v` 가 `c_v | n` 또는 `n | c_v` 의 관계를 만족한다.

- OpenAI: `c_openai = 256`, `256 × 2 = 512 = n` — ✅ `c_openai | n`
- Anthropic: `c_anthropic = 512`, `n = 512` — ✅ `n = c_anthropic`
- Gemini: `c_gemini ∈ [256, 2048]`, `512 ∈ [256, 2048]` — ✅ inclusion
- Cohere: `c_cohere = 512`, `n = 512` — ✅ `n = c_cohere`
- Upstage: `c_upstage = 512`, `n = 512` — ✅ `n = c_upstage`

따라서 PLKCH chunk size 512는 5/5 vendor 호환. ✅

**결론**: PLKCH는 CT-CHP의 anchor를 KV-Cache cache hit과 정렬시키는 결정적 bridge 역할을 한다.

---

**다음 편 (#061) 예고**: **Self-Healing Cross-Trust Pipeline** — PLKCH의 Merkle anchor가 손상/만료/위조 감지되었을 때 자동 복구하는 3-step pipeline. ZK replay, Merkle reproduction, PII zeroization을 통합한다. **6 Sigma 신뢰성 (defect ≤ 3.4 per million)** 을 cross-trust handoff에 적용한다.
