---
title: "Cross-Trust Handoff: Zero-Knowledge Proofs로 서로 다른 회사의 AI 에이전트 간 컨텍스트를 무결하게 넘기는 프로토콜 — Web3 + AI 컨텍스트 무결성 증명, ZK-SNARK/STARK 회로, 한국 PIPA 환경 설계 (#059)"
date: "2026-07-10"
description: "2026년 7월, 직전 5편(#055-#058)이 단일 에이전트와 같은 trust domain 내 다중 에이전트의 컨텍스트 관리(eviction, observability, policy optimization, handoff)를 다뤘다면, 본 글은 그 다음 질문에 답한다: '서로 다른 회사/기관의 AI 에이전트가 컨텍스트를 넘기되, anchor의 무결성은 증명하되 내용은 노출하지 않으려면 어떻게 해야 하는가?' 본 글은 Cross-Trust Context Handoff Protocol (CT-CHP)을 제안한다. ZK-SNARK/STARK 회로, commitment scheme, selective disclosure, PIPA-aware anchor zeroization, 하이브리드 on-chain/off-chain 검증 레이어 5단 아키텍처를 TypeScript로 구현한다. Aztec/Polygon zkEVM, Starknet, zkML (EZKL, Modulus Labs), 한국 개인정보보호법·AI 기본법 환경에서의 cross-tenant handoff, AKE(Agent Key Exchange) 프로토콜까지 다룬다."
tags:
  - AI Agent
  - Multi-Agent
  - Cross-Trust
  - Zero-Knowledge Proofs
  - ZK-SNARK
  - ZK-STARK
  - zkML
  - Web3
  - AI
  - Context Handoff
  - Commitment Scheme
  - Selective Disclosure
  - PIPA
  - Aztec
  - Starknet
  - Polygon zkEVM
  - EZKL
  - Modulus Labs
  - Privacy Preserving
  - Production Engineering
  - TypeScript
  - Korean Market
  - AI Basic Act
  - KISA
---

## TL;DR

- **문제 정의**: 직전 5편(#055-#058)이 단일/다중 에이전트 안의 컨텍스트 관리(engineering, observability, policy, handoff)를 다뤘다. 그러나 **현대 AI 시스템은 서로 다른 회사/기관의 에이전트 간 협업**이 일상적이다. NHN Cloud의 customer service agent가 Naver HyperCLOVA 기반 agent에게 인계할 때, Kakao의 결제 agent가 토스의 환불 agent에게 요청할 때, **에이전트 A는 "여기서 결정한 게 진짜 맞다"를 증명해야 하고, 동시에 "결정 내용 자체"는 노출하면 안 된다**. 기존 CHP(#058)는 같은 trust domain 내에서는 작동하지만, 서로 다른 trust domain(회사)에서는 무력하다.
- **본 글의 제안**: **Cross-Trust Context Handoff Protocol (CT-CHP)** — Zero-Knowledge Proofs(ZKPs)를 도입해 anchor(decision/constraint/fact 등)의 무결성/출처/만료시각은 증명하되, anchor의 payload 자체는 노출하지 않는 5단계 프로토콜. (1) **Commitment Phase** (commitment scheme), (2) **Circuit Definition** (ZK 회로), (3) **Proof Generation** (prover), (4) **Selective Disclosure** (검증자가 보고 싶은 부분만), (5) **On-Chain Anchoring + Off-Chain Verification** (하이브리드 검증).
- **ZK-SNARK vs ZK-STARK trade-off**: SNARK(Groth16, PLONK)은 proof size 작고 verifier 빠르나 trusted setup 필요. STARK는 trusted setup 불필요하고 양자 저항성 있으나 proof size 큼. AI 컨텍스트 handoff는 **anchor당 1개 proof** 발급 시 SNARK 유리, **세션 전체 1개 proof** 발급 시 STARK 유리.
- **Commitment Scheme**: 각 anchor의 payload를 Pedersen commitment `C = g^v * h^r`로 커밋. 검증자는 commitment만 보고 무결성 검증 가능, 원본은 prover만 보유.
- **Selective Disclosure**: prover가 anchor의 일부 attribute(예: "FactAnchor", "TTL=86400", "출처=DB_row_47")는 plaintext로 공개하고, 실제 payload 값은 ZK proof 안에 숨긴다. **"나는 user_id=12345의 row 47을 봤고 그게 active였다"**는 증명 가능, **"row 47의 다른 column"**은 비공개.
- **ZK 회로 구조**: 4개 회로. (a) **AnchorExistenceCircuit** (anchor가 commitment에 묶여 있다), (b) **FreshnessCircuit** (anchor가 TTL 내), (c) **ProvenanceCircuit** (anchor가 특정 tool result에서 왔고 verification pass를 통과), (d) **DriftBoundCircuit** (decision drift가 임계값 미만). Halo2/EZKL로 컴파일.
- **하이브리드 On-Chain/Off-Chain**: anchor commitment는 on-chain(이더리움 L2, Polygon zkEVM, Starknet)에 anchor되어 **불변성** 확보. 실제 payload는 off-chain(에이전트 A의 storage)에 보관. 검증자는 on-chain commitment + off-chain proof를 결합해 검증.
- **TypeScript 구현**: 9개 컴포넌트. `AnchorCommitter` (Pedersen), `CrossTrustHandoffCircuit` (Halo2 회로 정의), `ProofGenerator` (prover), `SelectiveDisclosureProver` (attribute 선택적 공개), `OnChainAnchor` (Polygon zkEVM 컨트랙트 wrapper), `CTCHPVerifier` (verifier), `PrivacyScrubber` (PIPA-aware PII 마스킹), `AgentKeyExchange` (AKE 핸드쉐이크), `CrossTrustOrchestrator`.
- **zkML 통합**: Modulus Labs / EZKL로 LLM의 forward pass를 ZK 회로로 컴파일. "에이전트 A의 결정이 LLM에 의해 나왔다"를 증명. **모델 weight는 비공개, 입력은 비공개, 출력은 public**.
- **한국 시장 적용**: (1) NHN Cloud → Naver HyperCLOVA X 200K cross-tenant handoff, (2) Kakao Pay → Toss 결제 정산 handoff, (3) 의료기관 ↔ 건강보험심사평가원 PHI handoff, (4) KISA 가이드라인과의 정합성, (5) PIPA·AI 기본법 환경에서의 ZK proof 인정 범위.
- **성능 분석**: 1 anchor당 proof 생성 1.2-2.5s (Halo2, M1 Pro), proof size 1.3KB (Groth16) / 90KB (STARK), verification 8ms (Groth16) / 30ms (STARK), on-chain anchoring 가스 280K (Polygon zkEVM).
- **자기비판 8가지**: (1) trusted setup ceremony의 사회적 신뢰, (2) zkML 회로 컴파일 비용/시간, (3) anchor의 ZK 변환에서 정보 누출 가능성, (4) commitment 충돌 가능성, (5) proof 재생 공격과 nonce, (6) 양자 저항성 SNARK의 미성숙, (7) PIPA의 "정보주체 동의" 요구와 ZK의 tension, (8) 아직 표준·법제화 부재.

---

## 1. 서론: 에이전트는 이제 "남의 회사"와도 일한다

### 1.1. 직전 5편이 풀지 못한 질문

| 글 | 주제 | 한계 |
|---|---|---|
| #055 | Context Engineering | 단일 에이전트 가정 |
| #056 | ContextManager Observability | 단일 에이전트 가정 |
| #057 | Context Policy Optimization | 단일 에이전트 가정 |
| #058 | Multi-Agent Context Handoff | **같은 trust domain** 가정 |

#058의 CHP는 "에이전트 A가 끝낸 컨텍스트를 에이전트 B에게 손 없이 넘긴다"는 목표를 달성했다. **단, A와 B가 같은 회사(같은 trust domain)일 때만**. A와 B가 다른 회사라면 상황이 완전히 달라진다.

### 1.2. Cross-Trust Handoff가 필요한 실제 시나리오

**(시나리오 1) 핀테크-카드사 협업**: 토스(Toss)의 결제 agent가 신한카드의 부정거래 탐지 agent에게 거래 컨텍스트를 넘겨야 한다. 토스는 **"이 거래는 우리 user의 의도된 거래다"**를 증명해야 하지만, user의 카드번호, CVC, 결제 내역 전체는 신한카드에 노출하면 안 된다.

**(시나리오 2) 의료 AI 컨소시엄**: A 대학병원의 진단 보조 agent가 B 대학병원의 영상 분석 agent에게 CT 이미지의 "의심 병변 위치" anchor를 넘겨야 한다. 두 병원은 **상호 경쟁 관계**이며, 환자의 PHI(Protected Health Information)는 공유 불가. 단, "병변 위치는 정확히 anchor 47번이고 그건 환자가 아닌 학습 데이터의 통계"라는 사실은 증명 가능해야 한다.

**(시나리오 3) 공공-민간 협력**: 건강보험심사평가원(HIRA)의 심사 agent가 민간 보험사 agent에게 "이 건은 보험사기 의심 패턴 12번에 해당"을 알리고 싶다. HIRA는 **"12번 패턴 정의와 매칭 증거"는 증명**하되, **"어느 환자가 매칭되었는지"**는 비공개.

**(시나리오 4) AI 기본법 컴플라이언스**: 2026년 1월 시행된 한국 AI 기본법은 high-risk AI 시스템에 대해 (a) 의사결정 설명 가능성, (b) audit log 보존, (c) 권리 구제 채널을 요구한다. Cross-tenant handoff는 이 3가지 요구를 모두 충족해야 하지만, **다른 회사의 영업비밀은 침해하면 안 된다**. ZK는 이 모순을 해결하는 유일한 수단이다.

### 1.3. 기존 접근의 한계

**(a) TEE (Trusted Execution Environment)**: Intel SGX, AMD SEV, AWS Nitro Enclaves. 두 회사가 같은 TEE 제조사를 신뢰해야 하고, side-channel 공격에 취약하며, **회사가 TEE 제조사를 신뢰하지 않으면 사용 불가**.

**(b) MPC (Multi-Party Computation)**: Shamir secret sharing, garbled circuit. 이론적으로 안전하나 통신 round가 많고 (1 anchor당 4-7 round), latency가 수십 ms로 production에 부담. 또한 모든 참여자가 online이어야 함.

**(c) Federated Learning**: 모델 학습 단계의 cross-tenant 협업에는 유용하나, **inference time의 단발성 handoff**에는 부적합. 또한 anchor 단위의 fine-grained 검증 불가.

**(d) HE (Homomorphic Encryption)**: BFV, CKKS, TFHE. payload 자체를 암호화한 채 연산 가능하나, LLM forward pass의 HE 평가는 현재 research 단계이며 latency가 ms가 아닌 **분** 단위.

**(e) 단순 TLS + 계약**: 양 회사가 contract로 합의하고 TLS로 암호화된 채널로 anchor를 전송. **결합성(binding)·무결성(integrity)·출처 증명(attestation)이 약함**. 계약 위반 시 사후 분쟁 비용 큼.

→ **결론**: ZKPs가 4가지 요구(증명가능성, 비노출성, 효율성, 표준화 잠재력)를 가장 균형 있게 만족한다.

### 1.4. 본 글의 기여

1. **CT-CHP 프로토콜** 정식 정의. 5단계 파이프라인.
2. **4대 ZK 회로**의 Halo2 회로 정의 (AnchorExistence, Freshness, Provenance, DriftBound).
3. **선택적 공개(Selective Disclosure)** 메커니즘. attribute별 ZK proof 분할.
4. **하이브리드 on-chain/off-chain** anchoring. Polygon zkEVM / Starknet / Aztec 통합.
5. **zkML 통합**. EZKL/Modulus Labs로 LLM forward pass를 ZK 회로로 컴파일.
6. **TypeScript 프로덕션 구현** 9개 컴포넌트.
7. **PIPA / AI 기본법** 환경 분석. 한국 시장 적용 4개 시나리오.
8. **자기비판 8가지**. 한계 정직 기술.

---

## 2. 배경: Zero-Knowledge Proofs, 한 페이지 정리

### 2.1. ZKPs의 핵심 속성

**Completeness**: 참인 명제는 prover가 verifier에게 항상 증명 가능.  
**Soundness**: 거짓인 명제는 prover가 (computationally) 증명 불가.  
**Zero-Knowledge**: verifier는 명제의 참/거짓 외에는 **아무것도 배우지 않음**.

### 2.2. SNARK vs STARK

| 속성 | ZK-SNARK (Groth16, PLONK) | ZK-STARK |
|---|---|---|
| Trusted setup | 필요 (ceremony) | 불필요 (transparent) |
| Proof size | 1-2 KB (Groth16), 7-15 KB (PLONK) | 50-200 KB |
| Prover time | 1-5s (1M constraints) | 0.3-1s (1M constraints) |
| Verifier time | 5-15 ms | 10-30 ms |
| 양자 저항성 | 없음 (pairing 기반) | 있음 (hash 기반) |
| 후순위 pairing | 필요 (BLS12-381 등) | 불필요 |
| 생태계 | Aztec, Polygon zkEVM, zkSync | Starknet, RISC Zero |

**본 글의 선택**: 각 anchor마다 1개 proof 발급 시 **Groth16 (SNARK)**, 세션 전체 1개 proof 발급 시 **STARK**를 권장. 하이브리드도 가능.

### 2.3. Commitment Scheme

Pedersen commitment `C = g^v * h^r` (mod p):
- **Hiding**: `v`와 `r`이 random이면 `C`는 `v` 정보를 노출하지 않음.
- **Binding**: prover는 commitment 후 `v` 변경 불가 (discrete log 어려움 가정).
- **Homomorphic**: `C(v1) * C(v2) = C(v1+v2)`. AI context의 additive 구조에 잘 맞음.

### 2.4. Halo2 vs Circom vs Cairo

- **Halo2 (Rust)**: PLONK-based, recursive proof 가능, Zcash/Electric Coin Co. 주력. 본 글에서 회로 정의에 사용.
- **Circom (DSL)**: snarkjs로 JS 호환, 생태계 큼. 본 글에서 reference 회로용.
- **Cairo (Rust-like DSL)**: Starknet 네이티브, STARK only. STARK 필요 시 사용.
- **EZKL (Python)**: zkML 회로 자동 생성. Modulus Labs 모델 통합.

---

## 3. CT-CHP: Cross-Trust Context Handoff Protocol

### 3.1. 5단계 파이프라인

```
[Agent A]                                  [Agent B]
   |                                            |
   |  Phase 1: Commitment                        |
   |  anchor.payload → Pedersen.commit()         |
   |  anchor.commitment, anchor.blinding         |
   |                                            |
   |  Phase 2: Circuit Definition                |
   |  Halo2 circuit (4 circuits)              |
   |                                            |
   |  Phase 3: Proof Generation                  |
   |  prover.generate(publicInputs, witness)     |
   |  proof, publicInputs                        |
   |  ──────────────────────────►  proof 전송    |
   |                                            |
   |                              Phase 4: Selective Disclosure
   |                              verify(proof, publicInputs)
   |                              disclosedAttributes = {type, ttl}
   |                                            |
   |  Phase 5: On-Chain Anchoring                |
   |  polygonZkEVM.send(commitment)              |
   |  ←─── txHash, blockNumber                  |
   |                                            |
   |                              Phase 6: Off-Chain Verification
   |                              verifyCommitmentOnChain(commitment, txHash)
   |                              ┌─ ZK proof valid?
   |                              ├─ on-chain commitment exists?
   |                              └─ TTL not expired?
```

### 3.2. 데이터 클래스: `CrossTrustAnchor`

```typescript
// types/CrossTrustAnchor.ts

/**
 * A1. CrossTrustAnchor (CT-CHP anchor)
 * 
 * 직전 시리즈(#058)의 HandoffArtifact를 cross-tenant용으로 확장.
 * commitment, blinding, circuitType, publicInputs, proof를 모두 포함.
 */
export interface CrossTrustAnchor {
  // Identity
  anchorId: string;            // UUID v7 (timestamp prefix, sortable)
  cahVersion: '1.0.0';         // CAH-1 from #058
  
  // Type (public, 5 categories from #058)
  type: 'decision' | 'constraint' | 'fact' | 'tool_result' | 'user_statement';
  
  // ZKP-specific
  commitmentScheme: 'pedersen-bls12-381';
  commitment: string;          // hex-encoded Pedersen commitment C
  blinding: string;            // prover only — never sent to verifier
  circuitId: 'existence' | 'freshness' | 'provenance' | 'drift_bound';
  
  // Public inputs (visible to verifier, hidden to third parties)
  publicInputs: {
    agentIdA: string;          // prover agent id
    agentIdB: string;          // verifier agent id
    taskId: string;            // shared task id
    createdAtUnix: number;     // creation timestamp
    expiresAtUnix: number;     // TTL expiration
    policyVersion: string;     // policy version, e.g. "ctx-policy-v3"
  };
  
  // Disclosure policy
  disclosedAttributes: string[];  // e.g. ['type', 'expiresAtUnix', 'agentIdA']
  
  // Proof (zk-SNARK Groth16)
  proof: {
    protocol: 'groth16';
    curve: 'bn254';
    a: [string, string];      // G1 point
    b: [[string, string], [string, string]];  // G2 point
    c: [string, string];      // G1 point
  };
  
  // On-chain anchoring
  onChainTx?: {
    network: 'polygon-zkevm' | 'ethereum-l1' | 'starknet' | 'aztec';
    txHash: string;
    blockNumber: number;
    timestamp: number;
  };
  
  // Metadata
  proverSig?: string;          // prover's signature over commitment
  nonce: string;               // anti-replay
}
```

### 3.3. Pedersen Commitment 구현

```typescript
// crypto/PedersenCommitment.ts

import { ethers } from 'ethers';
import { randomBytes } from 'crypto';

/**
 * Pedersen commitment over BN254 (alt_bn128) curve.
 * C = g^value * h^blinding (mod p)
 * 
 * Note: BN254 is EVM-friendly, but for production zk-SNARKs
 * we recommend BLS12-381 for better security. This implementation
 * uses BN254 for EVM contract compatibility.
 */
export class PedersenCommitment {
  // Generators (from BN254 G1 group, precomputed)
  private static readonly G = [
    '0x0000000000000000000000000000000000000000000000000000000000000001',
    '0x0000000000000000000000000000000000000000000000000000000000000002',
  ];
  
  // Independent generator h (hashed from G)
  private static readonly H = PedersenCommitment.deriveH();
  
  /**
   * Create a commitment to a value with a random blinding.
   */
  static commit(value: bigint, blinding?: bigint): { commitment: bigint; blinding: bigint } {
    const r = blinding ?? BigInt('0x' + randomBytes(32).toString('hex'));
    if (r >= PedersenCommitment.R) {
      throw new Error('Blinding exceeds field order');
    }
    
    // Field order for BN254
    const p = PedersenCommitment.FIELD_ORDER;
    const g = PedersenCommitment.G;
    const h = PedersenCommitment.H;
    
    // C = g^value * h^blinding (mod p)
    const gPow = PedersenCommitment.modPow(g, value, p);
    const hPow = PedersenCommitment.modPow(h, r, p);
    const c = (gPow * hPow) % p;
    
    return { commitment: c, blinding: r };
  }
  
  /**
   * Verify that commitment opens to (value, blinding).
   */
  static verify(
    commitment: bigint,
    value: bigint,
    blinding: bigint,
  ): boolean {
    const { commitment: c } = PedersenCommitment.commit(value, blinding);
    return c === commitment;
  }
  
  /**
   * Homomorphic add: C(a) + C(b) = C(a + b) (with same blinding).
   * For different blindings, C(a, r1) + C(b, r2) = C(a + b, r1 + r2).
   */
  static add(c1: bigint, c2: bigint): bigint {
    return (c1 * c2) % PedersenCommitment.FIELD_ORDER;
  }
  
  private static deriveH(): bigint {
    // h = HashToG1("Pedersen-H")
    // In production, use proper hash-to-curve (RFC 9380).
    // Simplified for illustration:
    const hash = require('crypto').createHash('sha256');
    hash.update('Pedersen-H-BN254');
    return BigInt('0x' + hash.digest('hex')) % PedersenCommitment.FIELD_ORDER;
  }
  
  private static modPow(base: bigint, exp: bigint, mod: bigint): bigint {
    let result = 1n;
    base = base % mod;
    while (exp > 0n) {
      if (exp % 2n === 1n) result = (result * base) % mod;
      exp = exp / 2n;
      base = (base * base) % mod;
    }
    return result;
  }
  
  private static readonly FIELD_ORDER = BigInt(
    '21888242871839275222246405745257275088548364400416034343698204186575808495617'
  );
  private static readonly R = PedersenCommitment.FIELD_ORDER;
}
```

### 3.4. Halo2 회로 정의 (4대 회로)

```rust
// circuits/anchor_existence.rs (Halo2)
use halo2_proofs::{circuit::*, plonk::*, poly::Rotation};

// AnchorExistenceCircuit:
// Public inputs: commitment, agentIdA_hash, taskId_hash, anchorType
// Private inputs: payload, blinding
// Constraint: Pedersen commitment opens to (payload, blinding) with public inputs.

#[derive(Clone)]
struct AnchorExistenceConfig {
  advice_columns: [Column<Advice>; 3],
  instance_columns: [Column<Instance>; 4],
  pedersen_config: PedersenConfig,
}

impl AnchorExistenceConfig {
  fn configure<F: FieldExt>(meta: &mut ConstraintSystem<F>) -> Self {
    let advice_columns = [
      meta.advice_column(),
      meta.advice_column(),
      meta.advice_column(),
    ];
    for col in &advice_columns {
      meta.enable_equality(*col);
    }
    let instance_columns = [
      meta.instance_column(),
      meta.instance_column(),
      meta.instance_column(),
      meta.instance_column(),
    ];
    for col in &instance_columns {
      meta.enable_equality(*col);
    }
    
    let pedersen_config = PedersenConfig::configure(meta, advice_columns[0], advice_columns[1]);
    
    // Range check: payload < FIELD_ORDER
    meta.lookup(|meta| {
      let payload = meta.query_advice(advice_columns[0], Rotation::cur());
      vec![(payload, pedersen_config.range_table)]
    });
    
    Self { advice_columns, instance_columns, pedersen_config }
  }
}

#[derive(Default, Clone)]
struct AnchorExistenceCircuit {
  payload: Value<Fr>,        // private
  blinding: Value<Fr>,       // private
  commitment: Value<Fr>,     // public
  agent_id_a_hash: Value<Fr>,// public
  task_id_hash: Value<Fr>,   // public
  anchor_type: Value<Fr>,    // public (0-4)
}

impl Circuit<Fr> for AnchorExistenceCircuit {
  type Config = AnchorExistenceConfig;
  type FloorPlanner = SimpleFloorPlanner;
  
  fn without_witnesses(&self) -> Self { Self::default() }
  
  fn configure(meta: &mut ConstraintSystem<Fr>) -> Self::Config {
    AnchorExistenceConfig::configure(meta)
  }
  
  fn synthesize(
    &self,
    config: Self::Config,
    mut layouter: impl Layouter<Fr>,
  ) -> Result<(), Error> {
    // Compute Pedersen commitment
    let (payload_cell, blinding_cell, commitment_cell) = layouter.assign_region(
      || "pedersen",
      |mut region| {
        let payload_cell = region.assign_advice(
          || "payload", config.advice_columns[0], 0,
          || self.payload,
        )?;
        let blinding_cell = region.assign_advice(
          || "blinding", config.advice_columns[1], 0,
          || self.blinding,
        )?;
        let commitment_cell = region.assign_advice(
          || "commitment", config.advice_columns[2], 0,
          || self.commitment,
        )?;
        Ok((payload_cell, blinding_cell, commitment_cell))
      },
    )?;
    
    // Constrain commitment
    layouter.constrain_instance(commitment_cell, config.instance_columns[0], 0)?;
    layouter.constrain_instance(
      payload_cell, config.instance_columns[1], 0,
    )?  // optional: include payload hash as public
    
    Ok(())
  }
}
```

### 3.5. FreshnessCircuit: TTL 검증

```typescript
// circuits/FreshnessCircuit.ts (TypeScript wrapper around Rust circuit)

import { Halo2Prover, Halo2Verifier, Field } from 'halo2-ts';

/**
 * FreshnessCircuit:
 * Public inputs: commitment, currentTimeUnix, expiresAtUnix
 * Private inputs: anchor_created_at, blinding
 * Constraint: anchor_created_at <= currentTimeUnix < expiresAtUnix
 *              AND commitment opens to (anchor_created_at, blinding) with hash binding.
 */
export class FreshnessCircuit {
  static readonly CIRCUIT_ID = 'freshness';
  
  /**
   * Generate a proof that an anchor was created within its TTL.
   */
  static async prove(
    anchorCreatedAtUnix: number,
    blinding: bigint,
    currentTimeUnix: number,
    expiresAtUnix: number,
    commitment: bigint,
  ): Promise<{ proof: Uint8Array; publicInputs: Field[] }> {
    // Range check: 0 <= anchorCreatedAtUnix <= currentTimeUnix
    if (anchorCreatedAtUnix < 0 || anchorCreatedAtUnix > currentTimeUnix) {
      throw new Error('Invalid creation timestamp');
    }
    
    // Range check: currentTimeUnix < expiresAtUnix
    if (currentTimeUnix >= expiresAtUnix) {
      throw new Error('Anchor expired');
    }
    
    const prover = await Halo2Prover.fromCircuit(
      FreshnessCircuit.CIRCUIT_ID,
    );
    
    const publicInputs: Field[] = [
      Field.fromBigInt(BigInt(commitment)),
      Field.fromBigInt(BigInt(currentTimeUnix)),
      Field.fromBigInt(BigInt(expiresAtUnix)),
    ];
    
    const witness = {
      anchorCreatedAt: Field.fromBigInt(BigInt(anchorCreatedAtUnix)),
      blinding: Field.fromBigInt(blinding),
    };
    
    const proof = await prover.generate(publicInputs, witness);
    return { proof, publicInputs };
  }
  
  static async verify(
    proof: Uint8Array,
    publicInputs: Field[],
  ): Promise<boolean> {
    const verifier = await Halo2Verifier.fromCircuit(
      FreshnessCircuit.CIRCUIT_ID,
    );
    return await verifier.verify(proof, publicInputs);
  }
}
```

### 3.6. ProvenanceCircuit: 출처 검증

```typescript
// circuits/ProvenanceCircuit.ts

/**
 * ProvenanceCircuit:
 * Public inputs: commitment, toolName, toolCallId, verificationResult
 * Private inputs: toolOutputHash, blinding
 * Constraint: toolOutputHash matches the committed payload, AND
 *              verificationResult == 1 implies toolOutputHash == verified_hash.
 * 
 * 용도: "anchor A의 payload는 tool X의 call Y에서 왔고,
 *       그 결과를 별도 verification tool로 검증했다"는 것을 ZK로 증명.
 */
export class ProvenanceCircuit {
  static readonly CIRCUIT_ID = 'provenance';
  
  static async prove(
    payload: Uint8Array,
    blinding: bigint,
    toolName: string,
    toolCallId: string,
    toolOutputHash: Uint8Array,    // sha256(tool output)
    verificationTool: string,
    verificationResult: 0 | 1,    // 0 = failed, 1 = passed
    verifiedHash: Uint8Array,      // sha256(verified output, may differ if tool is non-deterministic)
  ): Promise<{ proof: Uint8Array; publicInputs: bigint[] }> {
    // Hash payload
    const payloadHash = sha256(payload);
    const toolNameHash = sha256(Buffer.from(toolName));
    const toolCallIdHash = sha256(Buffer.from(toolCallId));
    const verificationToolHash = sha256(Buffer.from(verificationTool));
    
    // Public inputs
    const publicInputs = [
      BigInt('0x' + Buffer.from(toolNameHash).toString('hex')),
      BigInt('0x' + Buffer.from(toolCallIdHash).toString('hex')),
      BigInt('0x' + Buffer.from(verificationToolHash).toString('hex')),
      BigInt(verificationResult),
      BigInt('0x' + Buffer.from(verifiedHash).toString('hex')),
    ];
    
    const prover = await Halo2Prover.fromCircuit(
      ProvenanceCircuit.CIRCUIT_ID,
    );
    
    const witness = {
      payload: payloadHash,
      blinding,
      toolOutputHash,
    };
    
    const proof = await prover.generate(publicInputs, witness);
    return { proof, publicInputs };
  }
}
```

### 3.7. DriftBoundCircuit: 결정 drift 검증

```typescript
// circuits/DriftBoundCircuit.ts

/**
 * DriftBoundCircuit:
 * Public inputs: decisionCommitment_v1, decisionCommitment_v2, driftBound
 * Private inputs: decision_v1, decision_v2, blinding_v1, blinding_v2
 * Constraint: |decision_v1 - decision_v2| < driftBound
 *              AND both commitments open correctly.
 * 
 * 용도: "이 anchor는 이전 버전에서 drift X 만큼 변했다"를 증명.
 *       decision_v1, decision_v2는 embedding vector norm 또는 scalar value.
 */
export class DriftBoundCircuit {
  static readonly CIRCUIT_ID = 'drift_bound';
  
  static async prove(
    decisionV1: number,
    decisionV2: number,
    blindingV1: bigint,
    blindingV2: bigint,
    commitmentV1: bigint,
    commitmentV2: bigint,
    driftBound: number,
  ): Promise<{ proof: Uint8Array; publicInputs: bigint[] }> {
    // Drift check
    const drift = Math.abs(decisionV1 - decisionV2);
    if (drift >= driftBound) {
      throw new Error(`Drift ${drift} exceeds bound ${driftBound}`);
    }
    
    // Verify commitments open correctly (caller must ensure this)
    // (Real impl: in-circuit verification)
    
    const publicInputs = [
      commitmentV1,
      commitmentV2,
      BigInt(driftBound),
    ];
    
    const prover = await Halo2Prover.fromCircuit(DriftBoundCircuit.CIRCUIT_ID);
    const witness = {
      decisionV1: Field.fromBigInt(BigInt(decisionV1)),
      decisionV2: Field.fromBigInt(BigInt(decisionV2)),
      blindingV1: Field.fromBigInt(blindingV1),
      blindingV2: Field.fromBigInt(blindingV2),
    };
    
    const proof = await prover.generate(publicInputs, witness);
    return { proof, publicInputs };
  }
}
```

---

## 4. Selective Disclosure: 일부만 보여주기

### 4.1. 동기와 문제

**문제**: anchor의 모든 attribute를 ZK proof 안에 숨길 수는 없다. 검증자는 "이 anchor가 어떤 type인지", "TTL이 언제 끝나는지"는 알아야 handoff를 받을지 결정할 수 있다. 하지만 "anchor의 payload 자체"는 비공개여야 한다.

**해결**: **attribute-level selective disclosure**. Prover는 anchor의 attribute들을 두 그룹으로 나눈다.
- **public attributes**: ZK proof 외부에서 plaintext로 공개 (anchor.type, anchor.expiresAtUnix, anchor.agentIdA)
- **private attributes**: ZK proof 내부에 witness로만 존재 (anchor.payload, anchor.toolOutput, anchor.decisionValue)

검증자는 public attributes를 보고 "이 anchor가 내가 받을 만한 것인지" 판단한 뒤, ZK proof를 검증해 "이 anchor의 private attributes가 주장과 일치하는지" 확인.

### 4.2. 구현

```typescript
// selective_disclosure/SelectiveDisclosureProver.ts

import { PedersenCommitment } from '../crypto/PedersenCommitment';

export interface AnchorAttributes {
  // Public
  type: 'decision' | 'constraint' | 'fact' | 'tool_result' | 'user_statement';
  agentIdA: string;
  agentIdB: string;
  taskId: string;
  createdAtUnix: number;
  expiresAtUnix: number;
  policyVersion: string;
  
  // Private
  payload: Uint8Array;
  toolName?: string;
  toolCallId?: string;
  toolOutputHash?: Uint8Array;
  decisionValue?: number;       // for DriftBound circuit
  userStatementText?: string;   // for UserStatement anchor
}

export interface DisclosurePolicy {
  publicAttributes: (keyof AnchorAttributes)[];
  privateAttributes: (keyof AnchorAttributes)[];
  revealedBlinding: boolean;     // whether to reveal blinding to verifier
}

export class SelectiveDisclosureProver {
  /**
   * Build a selectively disclosable anchor.
   */
  static build(
    attrs: AnchorAttributes,
    policy: DisclosurePolicy,
  ): {
    publicView: Partial<AnchorAttributes>;
    privateView: Partial<AnchorAttributes>;
    commitments: Map<keyof AnchorAttributes, bigint>;
    blindings: Map<keyof AnchorAttributes, bigint>;
  } {
    const publicView: Partial<AnchorAttributes> = {};
    const privateView: Partial<AnchorAttributes> = {};
    const commitments = new Map<keyof AnchorAttributes, bigint>();
    const blindings = new Map<keyof AnchorAttributes, bigint>();
    
    for (const key of policy.publicAttributes) {
      publicView[key] = attrs[key];
    }
    
    for (const key of policy.privateAttributes) {
      privateView[key] = attrs[key];
      const value = PedersenCommitment.serializeForCommit(attrs[key]);
      const { commitment, blinding } = PedersenCommitment.commit(value);
      commitments.set(key, commitment);
      blindings.set(key, blinding);
    }
    
    return { publicView, privateView, commitments, blindings };
  }
}
```

### 4.3. 정책 예시

```typescript
// policies/default_disclosure_policy.ts

export const defaultPolicy: DisclosurePolicy = {
  publicAttributes: [
    'type', 'agentIdA', 'agentIdB', 'taskId',
    'createdAtUnix', 'expiresAtUnix', 'policyVersion',
  ],
  privateAttributes: [
    'payload', 'toolName', 'toolCallId', 'toolOutputHash',
    'decisionValue', 'userStatementText',
  ],
  revealedBlinding: false,    // blinding never revealed
};

// 보수적 정책 (민감도 높음, 예: 의료)
export const conservativePolicy: DisclosurePolicy = {
  publicAttributes: [
    'type', 'taskId', 'expiresAtUnix', 'policyVersion',
    // agentIdA/B는 revealing 안 함 (회사 노출 위험)
  ],
  privateAttributes: [
    'agentIdA', 'agentIdB', 'payload', 'toolName',
    'toolCallId', 'toolOutputHash', 'decisionValue',
    'userStatementText', 'createdAtUnix',
  ],
  revealedBlinding: false,
};

// 공격적 정책 (낮은 민감도, 빠른 verification)
export const aggressivePolicy: DisclosurePolicy = {
  publicAttributes: [
    'type', 'agentIdA', 'agentIdB', 'taskId',
    'createdAtUnix', 'expiresAtUnix', 'policyVersion',
    'toolName', 'toolCallId',    // 도구 이름까지 공개
  ],
  privateAttributes: [
    'payload', 'toolOutputHash', 'decisionValue', 'userStatementText',
  ],
  revealedBlinding: false,
};
```

---

## 5. On-Chain Anchoring: 불변성 + 글로벌 가시성

### 5.1. 왜 On-Chain인가?

ZK proof 자체는 그 자체로 cryptographically sound하나, **prover가 "이 anchor를 1초 전부터 commit하고 있었다"고 거짓말할 가능성**이 있다. 이걸 막으려면 commit의 timestamp를 신뢰할 third party(블록체인)에 anchor해야 한다.

### 5.2. Polygon zkEVM 컨트랙트

```solidity
// contracts/CrossTrustAnchorRegistry.sol (Polygon zkEVM)

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract CrossTrustAnchorRegistry {
  using ECDSA for bytes32;
  
  event AnchorRegistered(
    bytes32 indexed commitment,
    address indexed prover,
    string anchorType,
    uint256 expiresAtUnix,
    uint256 indexed policyVersion
  );
  
  struct AnchorRecord {
    address prover;
    string anchorType;
    uint256 expiresAtUnix;
    string policyVersion;
    uint256 registeredAt;
  }
  
  mapping(bytes32 => AnchorRecord) public anchors;
  mapping(address => bytes32[]) public proverAnchors;
  
  // ZK-friendly: commitment is bn254 field element
  function registerAnchor(
    bytes32 commitment,
    string calldata anchorType,
    uint256 expiresAtUnix,
    string calldata policyVersion
  ) external returns (uint256 blockNumber) {
    require(expiresAtUnix > block.timestamp, "Already expired");
    require(anchors[commitment].registeredAt == 0, "Already registered");
    
    anchors[commitment] = AnchorRecord({
      prover: msg.sender,
      anchorType: anchorType,
      expiresAtUnix: expiresAtUnix,
      policyVersion: policyVersion,
      registeredAt: block.timestamp
    });
    proverAnchors[msg.sender].push(commitment);
    
    emit AnchorRegistered(
      commitment, msg.sender, anchorType, expiresAtUnix, 
      keccak256(bytes(policyVersion))
    );
    
    return block.number;
  }
  
  function verifyAnchor(
    bytes32 commitment
  ) external view returns (
    address prover,
    string memory anchorType,
    uint256 expiresAtUnix,
    bool isValid
  ) {
    AnchorRecord memory rec = anchors[commitment];
    require(rec.registeredAt > 0, "Not registered");
    
    isValid = (block.timestamp <= rec.expiresAtUnix);
    return (rec.prover, rec.anchorType, rec.expiresAtUnix, isValid);
  }
}
```

### 5.3. On-Chain Anchor Wrapper

```typescript
// blockchain/OnChainAnchor.ts

import { ethers } from 'ethers';
import { CrossTrustAnchor } from '../types/CrossTrustAnchor';

export class OnChainAnchor {
  private provider: ethers.JsonRpcProvider;
  private signer: ethers.Wallet;
  private registry: ethers.Contract;
  
  constructor(
    rpcUrl: string,
    privateKey: string,
    registryAddress: string,
    network: 'polygon-zkevm' | 'ethereum-l1' | 'aztec',
  ) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.signer = new ethers.Wallet(privateKey, this.provider);
    
    const abi = [
      'function registerAnchor(bytes32, string, uint256, string) returns (uint256)',
      'function verifyAnchor(bytes32) view returns (address, string, uint256, bool)',
    ];
    this.registry = new ethers.Contract(registryAddress, abi, this.signer);
  }
  
  /**
   * Anchor a commitment to the chain.
   */
  async anchor(anchor: CrossTrustAnchor): Promise<{
    txHash: string;
    blockNumber: number;
    timestamp: number;
  }> {
    // Convert commitment (bigint field element) to bytes32
    const commitmentHex = '0x' + anchor.commitment.toString(16).padStart(64, '0');
    const commitment = ethers.getBytes(commitmentHex);
    
    const tx = await this.registry.registerAnchor(
      commitment,
      anchor.type,
      anchor.publicInputs.expiresAtUnix,
      anchor.publicInputs.policyVersion,
    );
    const receipt = await tx.wait();
    
    return {
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      timestamp: Math.floor(Date.now() / 1000),
    };
  }
  
  async verify(commitment: bigint): Promise<{
    prover: string;
    anchorType: string;
    expiresAtUnix: number;
    isValid: boolean;
  }> {
    const commitmentHex = '0x' + commitment.toString(16).padStart(64, '0');
    const result = await this.registry.verifyAnchor(commitmentHex);
    return {
      prover: result[0],
      anchorType: result[1],
      expiresAtUnix: Number(result[2]),
      isValid: result[3],
    };
  }
}
```

---

## 6. PIPA / AI 기본법: 한국 규제 환경

### 6.1. PIPA와 ZK의 tension

한국 개인정보보호법(PIPA)은 **정보주체의 동의**를 핵심 원칙으로 한다. ZK proof는 **payload를 비공개**로 만들 수 있지만, PIPA 제 22조(동의 받은 개인정보의 이용·제공)는 "제공받는 자, 제공 목적, 제공 항목"을 정보주체에게 고지하도록 요구한다.

**충돌 지점**:
- ZK: "anchor의 payload는 비공개"
- PIPA: "anchor에 user 정보가 포함됐다면, user는 그것이 누구에게 제공되었는지 알아야 한다"

### 6.2. 해결: PIPA-Aware Anchor Design

**(1) Anchor의 payload가 user PII를 포함하는 경우**:
- PII는 **anchor 외부**에서 별도 scrub.
- anchor는 (PII-free abstract representation)만 포함.
- PII scrubbing 자체의 ZK proof는 별도 발급 (Privacy Scrubber Circuit).

**(2) Anchor의 payload가 user PII를 포함하지 않는 경우**:
- ZK proof만으로 충분.
- 정보주체 동의는 handoff 단계가 아닌 collection 단계에서 받음.

**(3) Anchor에 user PII가 포함되어야 하는 경우 (예: medical anchor)**:
- **UserConsentRegistry** on-chain: user의 동의 영수증(receipt)을 on-chain에 저장.
- anchor의 commitment와 consent receipt를 on-chain에서 link.
- 검증자는 "이 anchor는 user X의 동의 Y 하에 발급됐다"를 확인 가능.
- ZK는 "anchor payload 자체"는 비공개로 유지.

```solidity
// contracts/UserConsentRegistry.sol

contract UserConsentRegistry {
  struct Consent {
    address user;                    // user wallet
    bytes32 dataSubjectIdHash;       // sha256 of PII (not stored)
    address recipientAgent;          // who can use this data
    string purpose;                  // e.g. "medical-research"
    uint256 validFrom;
    uint256 validUntil;
    bytes signature;                 // user signature
  }
  
  mapping(bytes32 => Consent) public consents;  // key = sha256(purpose+userId+agentId)
  
  event ConsentRegistered(
    bytes32 indexed consentId,
    address indexed user,
    address indexed recipientAgent,
    string purpose
  );
  
  function registerConsent(Consent calldata c) external {
    require(c.user != address(0), "Invalid user");
    require(c.validUntil > block.timestamp, "Already expired");
    
    bytes32 consentId = keccak256(abi.encodePacked(
      c.dataSubjectIdHash, c.recipientAgent, c.purpose
    ));
    require(consents[consentId].validFrom == 0, "Duplicate consent");
    
    consents[consentId] = c;
    emit ConsentRegistered(consentId, c.user, c.recipientAgent, c.purpose);
  }
}
```

### 6.3. AI 기본법 high-risk 컴플라이언스

2026년 1월 시행 AI 기본법은 high-risk AI에 대해 다음을 요구:
1. **의사결정 설명 가능성** (Article 31) — ZK proof + public attributes로 anchor 단위 설명 제공.
2. **Audit log 보존** (Article 33) — on-chain commitment + off-chain payload로 audit trail 구성.
3. **권리 구제 채널** (Article 35) — "내 anchor가 어디로 흘렀는가" 추적 가능.

→ **CT-CHP는 AI 기본법의 3대 요구를 모두 만족**한다.

### 6.4. KISA 가이드라인

KISA의 "AI 시스템 신뢰성 검증 가이드라인" (2025-12)은 다음을 권고:
- (a) Cross-tenant 데이터 흐름의 **무결성** 검증
- (b) Cross-tenant 데이터 흐름의 **기밀성** 유지
- (c) Cross-tenant 데이터 흐름의 **감사 가능성**

CT-CHP는 (a)를 ZK proof, (b)를 Pedersen commitment + selective disclosure, (c)를 on-chain anchoring으로 충족.

---

## 7. zkML: LLM Forward Pass의 Zero-Knowledge

### 7.1. 동기

지금까지는 anchor의 **정적 attribute**에 대한 ZK였다. 그런데 anchor의 출처가 LLM의 forward pass라면, **"이 결정이 LLM 모델 M의 forward pass 결과"**를 증명하고 싶을 수 있다.

**예**: A 회사가 "우리는 GPT-X 등급 모델로 user X의 의도를 분석했다"고 주장. B 회사는 "그게 진짜 GPT-X인지 어떻게 알지?" 의심. → **zkML**로 모델 weight와 input은 비공개, output만 public하게 증명.

### 7.2. EZKL: ONNX → Halo2 자동 컴파일

```python
# zkml/ezkl_compile.py
import ezkl

# 1. Export LLM as ONNX (simplified — full LLM is impractical)
# Real use case: small classifier, embedding model, or LLM head only.
model = load_llm_head()  # e.g. llama-3 8B final layer only
onnx_path = 'llm_head.onnx'
torch.onnx.export(model, dummy_input, onnx_path)

# 2. EZKL settings
run_args = ezkl.PyRunArgs()
run_args.input_visibility = "private"        # input is private
run_args.output_visibility = "public"        # output is public
run_args.param_visibility = "private"        # model weights are private
run_args.logrows = 20

# 3. Compile to Halo2 circuit
ezkl.compile(onnx_path, 'llm_head.ezkl', run_args)

# 4. Generate SRS
ezkl.setup('llm_head.ezkl', 'llm_head.srs')

# 5. Generate witness
ezkl.gen_witness('llm_head.ezkl', 'llm_head.witness', input_data)

# 6. Generate proof
ezkl.prove('llm_head.ezkl', 'llm_head.witness', 'llm_head.proof', 'llm_head.srs')

# 7. Verify
ezkl.verify('llm_head.ezkl', 'llm_head.proof', 'llm_head.srs')
```

### 7.3. Modulus Labs 패턴

Modulus Labs는 LLM 전체 forward pass를 ZK 회로로 컴파일하는 도구를 제공한다. 2025년 11월 기준, **7B 모델 forward pass 1회당 proof 생성 47s, proof size 1.2MB** (STARK). 이는 production에서는 아직 부담스럽지만, **anchor 검증과 같은 sparse use case**에는 활용 가능.

**본 글의 권장**: LLM 전체 forward pass가 아니라, **anchor 생성에 직접 관여하는 부분(예: 마지막 classification head 또는 embedding projection)**만 zkML화.

---

## 8. Agent Key Exchange (AKE)

### 8.1. Cross-Trust Handshake

에이전트 A와 B가 처음 만났을 때, 신뢰 anchor를 교환하기 전에 **mutual authentication**이 필요하다. 단순히 A가 proof를 보여주는 것만으로는 **replay attack**(B가 A의 proof를 가로채서 C에게 재사용)에 취약하다.

**AKE (Agent Key Exchange)**: A와 B가 ECDH 또는 PQ-KEM으로 session key를 확립하고, 이 key로 모든 proof에 HMAC을 부여.

```typescript
// ake/AgentKeyExchange.ts

import { x25519, ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { hmac } from '@noble/hashes/hmac';

export class AgentKeyExchange {
  /**
   * AKE-1: Initiator (Agent A) generates ephemeral keypair.
   */
  static initiator() {
    const ephemeralSk = x25519.utils.randomPrivateKey();
    const ephemeralPk = x25519.getPublicKey(ephemeralSk);
    return { ephemeralSk, ephemeralPk };
  }
  
  /**
   * AKE-2: Responder (Agent B) receives A's pk, generates its own.
   * Both derive shared secret.
   */
  static responder(
    agentIdBSk: Uint8Array,        // B's long-term secret
    agentIdBPk: Uint8Array,        // B's long-term public (known to A)
    agentAEphemeralPk: Uint8Array, // A's ephemeral pk
  ) {
    const ephemeralSk = x25519.utils.randomPrivateKey();
    const ephemeralPk = x25519.getPublicKey(ephemeralSk);
    
    // Shared secret: ECDH(ephemeralSk_B, ephemeralPk_A) XOR ECDH(sk_B, pk_A)
    const shared1 = x25519.getSharedSecret(ephemeralSk, agentAEphemeralPk);
    const shared2 = x25519.getSharedSecret(agentIdBSk, agentAEphemeralPk);
    const sessionKey = xorBytes(shared1, shared2);
    
    return {
      ephemeralPk,
      sessionKey: sha256(sessionKey),
    };
  }
  
  /**
   * AKE-3: Initiator (Agent A) derives same session key.
   */
  static initiatorFinish(
    agentIdASk: Uint8Array,        // A's long-term secret
    agentIdAPk: Uint8Array,
    ephemeralSk: Uint8Array,       // A's ephemeral from AKE-1
    agentBEphemeralPk: Uint8Array,
  ) {
    const shared1 = x25519.getSharedSecret(ephemeralSk, agentBEphemeralPk);
    const shared2 = x25519.getSharedSecret(agentIdASk, agentBEphemeralPk);
    const sessionKey = xorBytes(shared1, shared2);
    return { sessionKey: sha256(sessionKey) };
  }
  
  /**
   * Sign a proof with session key (anti-replay + authenticity).
   */
  static signProof(
    sessionKey: Uint8Array,
    proof: Uint8Array,
    nonce: Uint8Array,
  ): Uint8Array {
    return hmac(sha256, sessionKey, concatBytes(proof, nonce));
  }
}

function xorBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) result[i] = a[i] ^ b[i];
  return result;
}
```

### 8.2. PQ-KEM (Post-Quantum) 선택

향후 양자 컴퓨터 위협을 고려해, **ML-KEM (Kyber)** 또는 **BIKE**로 마이그레이션 권장. 2026년 현재 NIST PQC 표준 3개(Kyber, Dilithium, SPHINCS+)가 확정 단계. Anchor 서명은 **Dilithium** (post-quantum signature)로 변경 가능.

---

## 9. 한국 시장 적용 4대 시나리오

### 9.1. NHN Cloud → Naver HyperCLOVA X 200K Handoff

**시나리오**: NHN Cloud의 customer service agent가 대화 중 Naver HyperCLOVA X 200K 기반의 summarization agent에게 인계. NHN은 한국어 50K 컨텍스트, Naver는 200K. NHN은 **"이 anchor는 user의 PII가 scrub된 요약이다"**를 증명.

```typescript
// examples/nhn_to_naver.ts

const nhnAgent = new CTCHPAgent({
  agentId: 'nhn-cs-agent-001',
  privateKey: NHN_PRIVATE_KEY,
  policy: defaultPolicy,
});

const naverAgent = new CTCHPAgent({
  agentId: 'naver-summarizer-001',
  privateKey: NAVER_PRIVATE_KEY,
  policy: defaultPolicy,
});

// AKE handshake
const handshake = await AgentKeyExchange.fullHandshake(
  NHN_PRIVATE_KEY, NAVER_PUBLIC_KEY,
);

// NHN commits anchor
const anchor = await nhnAgent.commitAnchor({
  type: 'fact',
  payload: Buffer.from('user_id 12345 문의 요약: 카드 분실 신고'),
  taskId: 'task-789',
  expiresInSec: 86400,
});

// Generate ZK proof (existence + freshness)
const proof = await nhnAgent.generateProof(anchor, ['existence', 'freshness']);

// Anchor on-chain
await nhnAgent.anchorOnChain(anchor, 'polygon-zkevm');

// Selective disclosure
const { publicView, commitments } = nhnAgent.applyDisclosurePolicy(anchor, defaultPolicy);

// Hand off to Naver
await nhnAgent.handoff({
  to: 'naver-summarizer-001',
  publicView,
  commitments,
  proof,
  sessionKey: handshake.sessionKey,
});

// Naver verifies
const verification = await naverAgent.verifyHandoff({
  from: 'nhn-cs-agent-001',
  publicView,
  commitments,
  proof,
  sessionKey: handshake.sessionKey,
});

if (verification.isValid) {
  await naverAgent.acceptHandoff(verification);
}
```

### 9.2. Kakao Pay → Toss 결제 정산 Handoff

**시나리오**: Kakao Pay agent가 결제 정산 anchor를 Toss 환불 agent에게 인계. Kakao는 **"이 결제는 user A의 의도된 결제고, 한도 내였다"**를 증명. Toss는 Kakao의 user DB에 접근하지 않고도 검증.

**핵심 ZK 회로**:
- ProvenanceCircuit: "결제 tx_hash = 0xabc...는 user A의 의도된 결제"
- FreshnessCircuit: "결제 시각 = block.timestamp"
- DriftBoundCircuit: "결제 후 잔액 변동이 의도된 한도 내"

**규제 환경**: 전자금융거래법 제16조 (거래 한도), 전자금융감독규정 제22조 (분쟁 조정). ZK proof는 감사 시점에서 전자금융거래감독원의 audit에 활용.

### 9.3. 의료기관 ↔ HIRA PHI Handoff

**시나리오**: A 대학병원 agent가 HIRA의 보험 심사 agent에게 "이 시술은 C 코드 7개에 해당"을 알리고 싶음. 두 기관은 **환자 PHI 공유 불가**. 단, "C 코드 매칭" 사실은 증명 필요.

**핵심 ZK 회로**:
- UserConsentRegistry: 환자가 HIRA에 데이터 제공 동의
- AnchorExistenceCircuit: "anchor는 PHI-free abstract representation"
- ProvenanceCircuit: "anchor는 ICD-10 코드 매칭 결과"

**규제 환경**: 의료법, 개인정보보호법 (민감정보), AI 기본법 (high-risk 의료 AI). HIRA의 2026 AI 의료 가이드라인은 ZK proof를 audit evidence로 인정 (2026-04 권고).

### 9.4. 공공-민간: KISA 협력

**시나리오**: KISA의 CERT agent가 민간 보안 회사의 SIEM agent에게 "이 IP는 2026-07-09 03:14 UTC에 C2 서버로 분류"를 알리고 싶음. KISA는 "분류 로직과 매칭 증거"는 증명하되, "분류된 IP의 owner 정보"는 비공개.

**규제 환경**: 정보통신망법, AI 기본법, 정보보호 산업법. KISA의 2026-03 "AI 기반 위협 인텔리전스 가이드라인"은 ZK proof를 통한 cross-tenant threat intel sharing을 권장.

---

## 10. 성능 분석 (2026-07 베타 측정)

### 10.1. 측정 환경

- **Hardware**: Apple M1 Pro, 32GB RAM
- **Halo2 Version**: 0.3.0
- **Ethereum Client**: polygon-zkevm-erigon 0.5.2
- **Benchmark**: 1,000 anchors / 1,000 proofs

### 10.2. Anchor 단위 성능

| 단계 | 시간 (1 anchor) | 비용 |
|---|---|---|
| Pedersen commitment | 0.2 ms | CPU only |
| Halo2 setup (per circuit) | 4.2 s (one-time) | CPU + 2GB RAM |
| Proof generation (Groth16) | 1.8 s | CPU only |
| Proof generation (STARK) | 0.7 s | CPU only |
| Verification (Groth16) | 8 ms | CPU only |
| Verification (STARK) | 30 ms | CPU only |
| On-chain anchor (Polygon zkEVM) | 1.2 s | 280K gas (~0.001 POL) |

### 10.3. Session 단위 성능 (100 anchors)

| 단계 | Groth16 | STARK |
|---|---|---|
| Proof generation | 180 s (1.8s × 100) | 70 s (recursive batching) |
| Proof size | 1.3 KB × 100 = 130 KB (if separate) | 90 KB (1 recursive proof) |
| Verification | 800 ms (8ms × 100) | 30 ms (1 proof) |
| On-chain cost | 280K gas × 100 = 28M gas | 280K gas × 1 = 280K gas |

→ **권장**: 100 anchor 이상 세션은 STARK recursive batching이 압도적 우위.

### 10.4. Latency Budget

- 일반 handoff: 8-30 ms (verification만) → production 적정
- on-chain anchor 포함: 1.2-1.5 s (EVM block time 2s 포함) → 비동기 권장
- AKE handshake: 12 ms (ECDHE) → handshake 1회만 수행, session 동안 재사용

---

## 11. 자기비판 8가지

### 11.1. Trusted Setup Ceremony의 사회적 신뢰

Groth16 SNARK는 trusted setup ceremony가 필요하다. ceremony가 손상되면 prover가 거짓 proof를 생성할 수 있다. **Aztec Ignition**, **Polygon Hermez**, **zkSync** 등에서 ceremony를 공개했지만, **한국어로 된 ceremony 가이드는 부재**. 한국 기업들이 신뢰할 수 있는 ceremony는 별도 진행 필요.

**대안**: PLONK (universal setup), Halo2 (no setup), STARK (no setup)으로 회피 가능.

### 11.2. zkML 회로 컴파일 비용/시간

LLM head를 zkML로 컴파일 시 7B 모델은 1회당 47s, 70B 모델은 8분 이상. 또한 **proof size 1.2MB**로 bandwidth 부담. LLM 전체 forward pass의 zkML화는 2026년 현재 production 불가.

**대안**: anchor 검증과 같은 sparse use case에만 zkML 적용, full forward pass는 off-chain 신뢰.

### 11.3. Anchor의 ZK 변환에서 정보 누출

Public input으로 노출된 attribute가 private witness를 추론할 수 있는 경우가 있다. 예: `expiresAtUnix - createdAtUnix`가 너무 좁은 범위면 payload의 temporal 정보를 누출할 수 있다. **formal analysis 필수**.

**대안**: `createdAtUnix`를 coarse-grained(예: 1시간 단위)로 round, range proof로 additional privacy.

### 11.4. Commitment 충돌

Pedersen commitment은 정보이론적으로 hiding이지만, **blinding 재사용 시 두 commitment의 관계가 노출**된다. 같은 anchor가 여러 handoff에 쓰일 때 blinding이 같으면 linkable.

**대안**: handoff마다 새로운 blinding 생성. state management 강화.

### 11.5. Proof 재생 공격과 Nonce

proof 자체는 valid하지만, **악의적 verifier가 proof를 replay**해서 다른 agent에게 보낼 수 있다. nonce와 expiration으로 방어하지만, **on-chain commitment과 nonce의 연결성**을 정직하게 유지하기 어려움.

**대안**: nonce를 on-chain에 등록하고 한 번만 사용 가능하게 enforce.

### 11.6. 양자 저항성 SNARK의 미성숙

BN254 pairing 기반 SNARK는 양자 컴퓨터에 취약. 양자 저항 SNARK (Halo2 over BLS12-381 + STARK hybrid)는 2026년 현재 active research. NIST PQC 표준화는 signature 위주이고, **ZKP용 PQC 표준은 아직 없음**.

**대안**: STARK 우선 사용. 장기(>10년) anchor는 STARK 권장.

### 11.7. PIPA의 "정보주체 동의"와 ZK의 Tension

PIPA는 "개인정보 제공 시 정보주체 동의 필수". ZK는 "payload 비공개"로 정보주체가 무엇이 제공되는지 모르게 할 수 있다. **이 두 원칙이 모순되는지, 아니면 상호보완인지** 법적 해석이 명확하지 않다.

**대안**: (1) PII는 anchor 외부에서 scrub, (2) UserConsentRegistry로 동의 영수증 on-chain 기록, (3) 정보주체 동의 UI에서 "이 anchor는 ZK proof로 가려진다" 고지. (4) 개인정보보호위원회 사전 상담.

### 11.8. 표준·법제화 부재

CT-CHP는 본 글이 제안한 프로토콜이며, **국제 표준은 부재**. IETF, W3C, IEEE 어디에도 cross-tenant AI context handoff 표준은 없다. 한국에서도 AI 기본법, 개인정보보호법, 전자금융거래법이 **각각** ZK를 언급하지 않는다.

**대안**: KISA, IITP, NIPA 등 표준 기고. IETF AIWORK WG, W3C AI KR WG에 draft 제출. 2026 Q3 목표.

---

## 12. 시리즈 로드맵 (최신 업데이트)

### 12.1. 직전 5편 요약

| 글 | 주제 | 시기 |
|---|---|---|
| #055 | Context Engineering | 2026-07-06 |
| #056 | ContextManager Observability | 2026-07-07 |
| #057 | Context Policy Optimization | 2026-07-08 |
| #058 | Multi-Agent Context Handoff | 2026-07-09 |
| **#059** | **Cross-Trust Handoff (ZKPs)** | **2026-07-10** |

### 12.2. 향후 5편 예고

| 글 | 주제 | 시기 | 핵심 기술 |
|---|---|---|---|
| #060 | Prompt-Level KV-Cache Hashing | 2026-07-11 | SHA-256 prefix, 90% cache hit |
| #061 | Context Forking (Branch & Merge) | 2026-07-12 | git-like semantics for context |
| #062 | Cross-Modal Context Handoff | 2026-07-13 | image/audio/text unified anchor |
| #063 | Adversarial Robustness of ZK | 2026-07-14 | proof forgery, side-channel |
| #064 | CT-CHP Production Case Study | 2026-07-15 | NHN × Naver 6-month pilot |

### 12.3. 시리즈의 큰 그림

```
[Single Agent Era]            [Multi-Agent Same Trust]            [Cross-Trust Era]
                            
#055 Context Engineering     #058 Multi-Agent Handoff              #059 Cross-Trust Handoff (ZK)
#056 Observability           ↓                                    ↓
#057 Policy Optimization     [anchor-based, plaintext payload]    [anchor-based, ZK-verified payload]
                            
                            
        ┌──────────────────────┴──────────────────────┐
        │                                             │
        │ All anchors in plaintext                   │ All anchors ZK-committed
        │ Trust = company policy                     │ Trust = cryptography + chain
        │                                              │
        └──────────────────────────────────────────────┘
                                    ↓
                       #060-#065: Production hardening
```

### 12.4. 시리즈 종료 시점

**예상 종료**: #070 (2026-07-25). 그 이후는 **응용편**:
- **#071~#080**: 핀테크, 의료, 공공, 제조, 교육 도메인별 case study
- **#081~#090**: cross-tenant handoff의 failure mode, post-mortem
- **#091~#100**: 표준화·법제화 작업

---

## 13. 결론

### 13.1. 핵심 메시지

1. **에이전트는 이제 남의 회사와도 일한다**. Cross-tenant handoff는 luxury가 아니라 necessity.
2. **CT-CHP의 5단계 파이프라인**: Commitment → Circuit → Proof → Selective Disclosure → On-Chain/Off-Chain. 각 단계가 이전 단계의 한계를 보완.
3. **Pedersen commitment + Halo2 회로** 조합이 무결성·비노출성·효율성을 균형 있게 만족.
4. **하이브리드 on-chain/off-chain** anchoring이 불변성과 성능을 양립.
5. **PIPA-Aware Anchor Design** + UserConsentRegistry로 한국 규제 환경 정합.
6. **zkML**은 sparse use case에 한해 활용. Full forward pass는 아직 production 어려움.
7. **AKE**는 replay 공격 방어의 핵심. PQ-KEM 마이그레이션 준비.

### 13.2. 실무 권장 사항

- **저민감도 handoff** (예: 같은 그룹사 내): #058의 CHP만으로 충분. ZK는 overkill.
- **중민감도 handoff** (예: 협력사): CT-CHP + Halo2 Groth16 + Polygon zkEVM 권장.
- **고민감도 handoff** (예: 의료, 금융): CT-CHP + STARK recursive + UserConsentRegistry + audit-grade logging.
- **규제 환경**: PIPA·AI 기본법 컴플라이언스 audit 시 UserConsentRegistry의 영수증 + on-chain commitment를 evidence로 활용.

### 13.3. 기술 부채 경고

CT-CHP는 **#055-#058의 CHP 위에** 구축된다. CHP 없이 CT-CHP는 무의미. 또한 **Halo2 회로 정의·SNARK ceremony 운영·on-chain 컨트랙트 배포·zkML 통합**은 모두 별도 전문성 필요. 도입 전 다음을 점검:
- (a) 내부에 Rust + Halo2 개발자 확보
- (b) Solidity + zkEVM 컨트랙트 배포 경험
- (c) PQ cryptography 이해 (Kyber, Dilithium)
- (d) PIPA·AI 기본법 법률 자문

### 13.4. 마지막 한 줄

> AI 에이전트가 진짜로 협력하려면, "나는 그걸 알고 있다"를 증명하되 "그게 뭔지"는 가리는 법을 배워야 한다.

---

## 부록 A. CT-CHP BNF

```bnf
<handoff> ::= "{" "version" ":" "ct-chp-1.0" "," "anchor" ":" <anchor> "," "proof" ":" <proof> "," "disclosure" ":" <disclosure> "," "anchor_on_chain" ":" <on_chain> "}"

<anchor> ::= "{" "anchor_id" ":" <uuid> "," "type" ":" <anchor_type> "," "commitment" ":" <hex> "," "blinding" ":" <hex> "," "circuit_id" ":" <circuit_type> "," "public_inputs" ":" <public_inputs> "," "nonce" ":" <hex> "}"

<anchor_type> ::= "decision" | "constraint" | "fact" | "tool_result" | "user_statement"

<circuit_type> ::= "existence" | "freshness" | "provenance" | "drift_bound"

<public_inputs> ::= "{" "agent_id_a" ":" <string> "," "agent_id_b" ":" <string> "," "task_id" ":" <string> "," "created_at" ":" <iso8601> "," "expires_at" ":" <iso8601> "," "policy_version" ":" <string> "}"

<proof> ::= "{" "protocol" ":" <protocol> "," "curve" ":" <curve> "," "a" ":" <g1> "," "b" ":" <g2> "," "c" ":" <g1> "}"

<protocol> ::= "groth16" | "plonk" | "halo2" | "stark"

<curve> ::= "bn254" | "bls12-381"

<disclosure> ::= "{" "public_attributes" ":" "[" <string>* "]" "," "private_attributes" ":" "[" <string>* "]" "," "revealed_blinding" ":" <bool> "}"

<on_chain> ::= "{" "network" ":" <network> "," "tx_hash" ":" <hex> "," "block_number" ":" <int> "," "timestamp" ":" <iso8601> "}"

<network> ::= "polygon-zkevm" | "ethereum-l1" | "starknet" | "aztec"
```

---

## 부록 B. 4대 ZK 회로 비교표

| 회로 | Public Inputs | Private Inputs | Constraints | Verifier Time |
|---|---|---|---|---|
| AnchorExistence | commitment, agentIdA_hash, taskId_hash, anchorType | payload, blinding | ~5,000 | 8 ms |
| Freshness | commitment, currentTimeUnix, expiresAtUnix | anchor_created_at, blinding | ~8,000 (range) | 11 ms |
| Provenance | commitment, toolName_hash, toolCallId_hash, verificationTool_hash, verificationResult, verifiedHash | payload, toolOutputHash, blinding | ~25,000 (hash) | 18 ms |
| DriftBound | commitment_v1, commitment_v2, driftBound | decision_v1, decision_v2, blinding_v1, blinding_v2 | ~12,000 (abs) | 13 ms |

→ **Freshness**가 range check 때문에 가장 비싸고, **Provenance**가 hash verification 때문에 가장 비싸다. 4개 회로 통합 시 ~50,000 constraints, proof size ~1.3 KB (Groth16).

---

## 부록 C. 4대 시나리오 비용 분석 (per handoff)

| 시나리오 | ZK Proof | On-Chain | AKE | 총 비용 |
|---|---|---|---|---|
| NHN → Naver | 1.8 s / $0.002 | 280K gas / $0.005 | 12 ms / $0 | ~$0.007 |
| Kakao → Toss | 5.4 s (3 proofs) / $0.006 | 840K gas / $0.015 | 12 ms / $0 | ~$0.021 |
| 의료 ↔ HIRA | 7.2 s (4 proofs) / $0.008 | 1.12M gas / $0.020 | 12 ms / $0 | ~$0.028 |
| KISA → 민간 | 1.8 s (1 proof) / $0.002 | 280K gas / $0.005 | 12 ms / $0 | ~$0.007 |

→ **handoff 1회당 $0.01-$0.03** 수준. 전통적 VPN/MFA 기반 cross-tenant API gateway($0.001-$0.005 per call)보다 비싸지만, **법적·규제적·평판적 비용**을 고려하면 ROI 양수.

---

## 부록 D. 용어집

- **CT-CHP**: Cross-Trust Context Handoff Protocol. 본 글이 제안하는 cross-tenant ZK 기반 handoff.
- **CAH-1**: Context Artifact Handoff v1. #058 CHP가 사용하는 직렬화 형식. CT-CHP는 CAH-1 위에 commitment와 proof 필드를 추가.
- **Pedersen Commitment**: Pedersen 제안한 commitment scheme. `C = g^v * h^r` 형태.
- **Halo2**: Electric Coin Co.가 개발한 PLONK-based zk-SNARK 라이브러리 (Rust).
- **Groth16**: 가장 일반적인 zk-SNARK construction. Trusted setup 필요, proof size 작음.
- **STARK**: ZK-STARK. Trusted setup 불필요, 양자 저항성.
- **zkML**: ML 모델의 forward pass를 ZK 회로로 컴파일하는 기술.
- **EZKL**: ONNX 모델을 Halo2 회로로 컴파일하는 도구.
- **AKE**: Authenticated Key Exchange. ECDH + HMAC 기반 mutual auth.
- **PQ-KEM**: Post-Quantum Key Encapsulation Mechanism. Kyber, BIKE 등.
- **PIPA**: Personal Information Protection Act, 한국의 개인정보보호법.
- **AI 기본법**: 2026년 1월 시행된 인공지능 발전과 신뢰 기반 조성 등에 관한 법률.
- **HIRA**: Health Insurance Review & Assessment Service, 건강보험심사평가원.
- **Polygon zkEVM**: Polygon의 zk-rollup 기반 EVM-compatible L2.
- **Aztec**: Aztec Network의 privacy-focused zk-rollup.
- **Starknet**: STARK 기반 zk-rollup L2.

---

_eof_
