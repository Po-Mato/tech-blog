---
title: "ASTP Gateway Cost Model & Resource Governance: TCO 방정식, Division별 Chargeback, K8s ResourceQuota 기반 Burst Credit, 그리고 PIPA 보관 비용 최적화 (#071)"
date: 2026-08-03T16:00:00+09:00
draft: false
tags: ["ASTP", "Cost Model", "TCO", "Chargeback", "Resource Governance", "FinOps", "PIPA", "Kubernetes", "FinOps"]
categories: ["Architecture", "FinOps"]
series: ["ASTP Gateway Federation"]
---

## TL;DR

- #070 "Capacity Planning: 몇 대의 Gateway가 필요한가"에 이어, 본 글은 **"그 Gateway에 얼마가 들고 누가 지불하는가"** 라는 FinOps 질문을 다룬다.
- ASTP Gateway Mesh의 **TCO (Total Cost of Ownership)** 를 5대 비용 축 (Compute / Storage / Network / KMS / Observability) 으로 분해하고, 각 비용을 **Little's Law와 request-size 분포**로 정량화하는 방정식을 제시한다.
- **Chargeback Model**: Division별 (LG전자 H&A/HE/VS/BS, KB금융그룹 MCI, 삼성전자 DS/DX/SDS 등) 트래픽 사용량 기반 비용 배분. **Multi-tenant fairness** 를 위한 **Gini 계수** 기반 이상 사용 감지.
- **Resource Governance**: Kubernetes ResourceQuota + **Burst Credit System** 으로 "기본 용량은 Reserved, 일시적 spike는 On-demand" 의 **Two-tier capacity** 를 구현한다. Cloud Burst Credit 계산식이 핵심.
- **Reserved vs On-demand** 의사결정 프레임워크: MCP Stateless 전환으로 **Auto-scaling Zero-to-N** 이 가능해진 경제적 의미 분석. 95th percentile 워크로드 기준으로 Reserved 인스턴스 구매 효율을 산출한다.
- **PIPA 보관 비용 최적화**: 1년 vs 5년 보관의 Storage 비용 차이 (S3 Glacier vs Standard) + Merkle Hash 증적 + Incremental Expunge 알고리즘.
- 한국 시장 3대 시나리오의 **연간 TCO 예측**: KB금융그룹 MCI (연 4.2억 원), 서울대병원 PIPA Federation (연 1.8억 원), 삼성전자 DS/DX/SDS 3-way Federation (연 9.6억 원).

---

## 1. 서론: Capacity가 아닌 Cost로 보는 ASTP Gateway

#070에서 우리는 ASTP Gateway Mesh의 **Capacity Planning** 을 다루었다. "12K RPS 피크에 KB금융그룹 MCI는 3 nodes로 충분하다" "삼성전자 DS/DX/SDS 글로벌 24h Federation은 4~5 nodes로 region 분할이 필요하다" 같은 결론이 나왔다.

하지만 CFO는 다른 질문을 던진다:

> "그 Gateway Mesh를 운영하면 1년에 얼마가 들어? 그리고 그 비용을 **어떤 Division이** 부담해야 하지?"

#066 ~ #070 까지의 시리즈가 **기술적 트레이드오프** 를 다뤘다면, 본 글은 **재무적 트레이드오프** 로 같은 문제를 다시 본다. ASTP Gateway Federation의 **TCO 방정식**, **Chargeback Model**, **Resource Governance**, **예약 vs 온디맨드 의사결정**, **PIPA 보관 비용 최적화** 를 순서로 다룬다.

**왜 이 순서인가?** TCO를 정의해야 Chargeback 기준이 생기고, Chargeback 기준이 있어야 Resource Governance 정책이 합리화되며, Resource Governance가 정해져야 Reserved vs On-demand 의사결정이 가능해진다. 마지막으로 PIPA 같은 컴플라이언스 요구사항이 TCO의 **하한선** 을 결정한다. 이 인과 관계가 본 글의 구조다.

---

## 2. ASTP Gateway TCO 방정식: 5대 비용 축의 분해

### 2.1 TCO 구성 요소

ASTP Gateway Federation의 TCO는 다음 5가지 축으로 분해된다:

```
TCO_year = C_compute + C_storage + C_network + C_kms + C_observability

where:
  C_compute    = 노드 단가 × 노드 수 × 가동 시간
  C_storage    = WAL/Archive 단가 × GB × 보관 기간
  C_network    = Cross-region 데이터 전송량 × 단가
  C_kms        = KMS API 호출 수 × 단가 (per-request)
  C_observability = Prometheus/Grafana/Loki × metric/log/query 단가
```

각 비용 축을 정량화하기 위해 **Little's Law** 와 **CRDT Delta Size 분포** 를 다시 등장시킨다. Capacity Planning(#070) 에서 throughput의 함수였던 비용이, 이제는 **시간에 따른 workload 분포** 의 함수가 된다.

### 2.2 Compute 비용 (C_compute)

Gateway 노드는 **Stateless MCP** 환경에서 CPU-bound 와 **WAL fsync I/O-bound** 두 가지 자원을 모두 사용한다. ASTP Gateway v0.4 기준 측정값:

| 리소스 | Steady (1K RPS) | Burst (6x) | Ramp max |
|------|:---:|:---:|:---:|
| CPU (8 core) | 12% | 68% | 95% |
| Memory RSS | 1.2 GB | 1.8 GB | 2.4 GB |
| Disk IOPS (NVMe) | 800 | 4,500 | 8,200 |
| Network Egress | 8 Mbps | 48 Mbps | 80 Mbps |

**Compute 비용 방정식:**

```
C_compute = Σ_nodes (instance_hourly × hours_per_year) × utilization_factor
          = 3 nodes × $0.064/hour × 8,760 hours × 0.65
          = $1,094 / year / node (AWS c6g.2xlarge 기준)
```

`utilization_factor` 는 실제로 노드가 **얼마나 효율적으로** 사용되는지를 반영한다. CPU 12%면 utilization 12%지만, **Burst Credit** 으로 임대료는 동일하게 나가므로 **effective utilization** 은 65% 정도로 잡는다.

### 2.3 Storage 비용 (C_storage)

Storage 비용은 **WAL Hot Tier + WAL Cold Archive + Observability Logs** 로 나뉜다:

```
C_storage = (WAL_hot_per_GB × hot_capacity)
          + (WAL_cold_per_GB × cold_capacity)
          + (Logs_per_GB × log_retention_days)

where:
  WAL_hot: NVMe SSD, $0.10/GB/month
  WAL_cold: S3 Standard-IA, $0.0125/GB/month
  WAL_glacier: S3 Glacier Deep Archive, $0.00099/GB/month
  Logs: Grafana Loki, $0.50/GB/month (compressed)
```

PIPA 1년 보관 시 cold storage 비용이 압도적이므로, **Tiered Storage 전환 시점** 이 Storage 비용 최적화의 핵심이다.

### 2.4 Network 비용 (C_network)

Network 비용은 **두 가지 패턴** 으로 발생한다:

1. **Gateway-to-Gateway (Mesh 내부)**: 같은 리전 AZ 간은 무료이지만, cross-region은 비싸다.
2. **Gateway-to-Client (Egress)**: 인터넷 egress는 $0.05 ~ $0.09/GB (region-dependent).

```
C_network = Σ_regions (egress_GB × region_price)
          + (cross_region_sync_GB × cross_region_price)

where:
  cross_region_price = $0.02/GB (us-east to us-west, 같은 continent)
  cross_region_price = $0.09/GB (ap-northeast-2 to eu-west-1)
```

삼성전자 DS/DX/SDS 3-way Federation처럼 **글로벌 multi-region** 인 경우 Network 비용이 TCO의 25~35% 를 차지할 수 있다.

### 2.5 KMS 비용 (C_kms)

ASTP Gateway는 모든 CRDT Delta에 대해 **AES-256-GCM** 암호화를 수행한다. KMS 호출은 **per-Delta envelope encryption** 으로 설계되어 있어:

```
C_kms = (request_count × $0.03/10K_requests)
      + (customer_master_keys × $1/key/month)

where:
  request_count = 연간 총 request 수
  envelope encryption: KMS로 DEK encrypt, 데이터는 DEK로 encrypt (per-request)
```

서울대병원 PIPA Federation처럼 의료 데이터를 다루는 경우 **모든 Delta가 암호화 대상** 이므로 KMS 비용이 TCO의 5~10% 까지 올라간다.

### 2.6 Observability 비용 (C_observability)

Observability 비용은 **Metrics / Logs / Traces / Profiles** 4가지 축으로 측정된다:

```
C_observability = metrics_cost + logs_cost + traces_cost + profiles_cost

where:
  metrics: Prometheus ($0.005/sample)
  logs: Grafana Loki ($0.50/GB compressed, 30일 retention)
  traces: Tempo ($0.10/spans, 7일 retention)
  profiles: Pyroscope ($0.005/profile, 1일 retention)
```

ASTP는 #069 Observability 글에서 **7가지 invariant 검사 + 6종 Prometheus metric + W3C Trace Context** 를 정의했다. 이 모든 것이 비용으로 환산된다.

### 2.7 TCO 종합 예측

3개 Gateway 노드 + 5,000 RPS 평균 + 50,000 RPS 피크 workload 기준 TCO 예측:

| 비용 축 | 연간 비용 (USD) | 비중 |
|---------|:---:|:---:|
| Compute (3 × c6g.2xlarge) | $3,280 | 18% |
| Storage (1.05 TB hot + 3.15 TB cold) | $610 | 3% |
| Network (10 TB egress/month) | $6,000 | 33% |
| KMS (50M envelope calls/year) | $150 | 1% |
| Observability (3 Prometheus + Loki + Tempo) | $8,000 | 44% |
| **Total** | **$18,040** | **100%** |

**놀라운 발견:** Compute가 아니라 **Observability + Network** 가 TCO의 77% 를 차지한다. 이는 Gateway Federation이 stateless 처리 자체보다 **모니터링과 데이터 전송** 에서 비용이 발생한다는 것을 의미한다. FinOps 관점에서 **로그 retention 단축 + cross-region 동기화 최적화** 가 가장 큰 비용 절감 포인트다.

---

## 3. Chargeback Model: Division별 비용 배분

### 3.1 왜 Chargeback인가?

ASTP Gateway Federation은 **여러 Division이 공유하는 플랫폼** 이다. KB금융그룹 MCI는 KB국민은행/KB증권/KB손해보험/KB국민카드 4개 Division이 Gateway Mesh를 공유한다. 삼성전자 DS/DX/SDS는 Device Solution / Device eXperience / 삼성SDS 가 공유한다.

이런 공유 플랫폼에서 **"모든 Division이 동일한 비용을 부담"** 하는 것은 **불공정** 하다. 트래픽을 많이 쓰는 Division이 더 많이, 거의 안 쓰는 Division은 적게 부담해야 **multi-tenant fairness** 가 유지된다.

### 3.2 Chargeback 구성 요소

Chargeback은 다음 4가지 dimension으로 구성된다:

```
Charge_i = (RPS_share_i × C_compute_share)
         + (WAL_size_i × C_storage_share)
         + (egress_i × C_network_share)
         + (kms_calls_i × C_kms_share)
         + (observability_volume_i × C_observability_share)

where:
  _share_i = Division i의 사용량 / 전체 사용량
```

**Multi-tenant fairness** 를 정량화하기 위해 **Gini 계수** 를 도입한다:

```typescript
interface ChargebackFairness {
  // 각 Division의 usage 비율과 charge 비율의 편차 측정
  calculateGiniCoefficient(divisionUsages: number[], divisionCharges: number[]): number {
    // Gini = 0: 완전 균등 (모든 Division이 동일하게 사용/비용 부담)
    // Gini = 1: 완전 불균등 (한 Division이 100% 사용/비용)
    const n = divisionUsages.length;
    const sortedPairs = divisionUsages
      .map((u, i) => ({ usage: u, charge: divisionCharges[i] }))
      .sort((a, b) => a.usage - b.usage);

    let cumulativeUsage = 0;
    let cumulativeCharge = 0;
    let areaUnderCurve = 0;

    for (let i = 0; i < n; i++) {
      cumulativeUsage += sortedPairs[i].usage;
      cumulativeCharge += sortedPairs[i].charge;
      areaUnderCurve += cumulativeCharge;
    }

    const totalCharge = cumulativeCharge;
    const gini = 1 - (2 * areaUnderCurve) / (n * totalCharge);
    return Math.max(0, Math.min(1, gini));
  }

  // Gini > 0.3이면 이상 사용 감지 → audit
  detectAnomaly(divisionUsages: number[], divisionCharges: number[]): AnomalyReport | null {
    const gini = this.calculateGiniCoefficient(divisionUsages, divisionCharges);
    if (gini > 0.3) {
      return {
        severity: 'warning',
        message: `Charge distribution Gini coefficient ${gini.toFixed(3)} exceeds 0.3 threshold`,
        affectedDivisions: this.identifyOutliers(divisionUsages, divisionCharges),
        recommendation: 'Audit usage logs for anomaly, consider rate limiting'
      };
    }
    return null;
  }
}
```

**Gini > 0.3** 이면 **이상 사용 (anomaly)** 으로 판단하여 **audit** 를 트리거한다. 한 Division이 평소의 3배 이상 트래픽을 발생시키면 Gini가 급격히 증가하고, audit 로그가 자동 생성된다.

### 3.3 KB금융그룹 MCI 시나리오 Chargeback

4개 Division의 일일 트래픽 분포:

```
KB국민은행: 50% (2.5M requests/day, 평시 RPS 30, 피크 6,000)
KB증권:    25% (1.25M requests/day, 평시 RPS 15, 피크 3,000)
KB손해보험: 15% (0.75M requests/day, 평시 RPS 9, 피크 1,800)
KB국민카드: 10% (0.5M requests/day, 평시 RPS 6, 피크 1,200)
```

**Annual Chargeback:**

| Division | RPS share | Charge (USD/year) | Charge (KRW) |
|----------|:---:|:---:|:---:|
| KB국민은행 | 50% | $9,020 | 1,200만원 |
| KB증권 | 25% | $4,510 | 600만원 |
| KB손해보험 | 15% | $2,706 | 360만원 |
| KB국민카드 | 10% | $1,804 | 240만원 |
| **Total** | **100%** | **$18,040** | **2,400만원** |

Gini 계수 = 0.245 (공정 범위). 만약 KB국민은행이 단기간에 트래픽 3배 spike를 일으키면 Gini가 0.45로 올라가 audit trigger.

---

## 4. Resource Governance: K8s ResourceQuota + Burst Credit System

### 4.1 왜 Resource Governance인가?

Gateway Federation은 **공유 자원을 효율적으로** 사용해야 하지만, **한 Division의 폭주가 다른 Division을 starve 시키면 안 된다.** Kubernetes의 기본적인 `ResourceQuota` 와 `LimitRange` 는 정적(static) 이지만, 실제 workload는 동적(dynamic) 이다.

ASTP는 **Burst Credit System** 으로 이 문제를 해결한다:

```
기본 용량 (Base Capacity): 모든 Division에게 보장되는 최소 자원
Burst Credit: 평시 미사용 자원에서 적립되는 credit, spike 시 사용
```

### 4.2 Burst Credit 방정식

```yaml
# gateway-burst-credit.yaml
apiVersion: astp/v1
kind: BurstCreditPolicy
metadata:
  name: gateway-mesh-default
spec:
  baseCapacity:
    cpu: "1000m"        # 1 core 보장
    memory: "2Gi"       # 2GB 보장
    walIops: 5000       # 5K IOPS 보장

  burstLimits:
    cpu: "4000m"        # 4 core 까지 burst 가능
    memory: "8Gi"       # 8GB 까지 burst 가능
    walIops: 20000      # 20K IOPS 까지 burst 가능

  creditAccumulation:
    rate: 0.5           # 0.5 credit/sec (평시 미사용분 적립)
    maxCredits: 100     # 최대 100 credit까지 적립

  creditConsumption:
    cpuPerCredit: 1     # 1 credit = 1 milliCPU·sec burst
    memoryPerCredit: 10485760  # 1 credit = 10 MiB·sec
    iopsPerCredit: 5    # 1 credit = 5 IOPS burst·sec

  enforcement:
    action: throttle    # credit 0 이면 throttle (reject)
    cooldownPeriod: 30s
```

**계산 예시:** KB국민은행이 평시 1000m CPU만 사용하다 spike 시 4000m CPU 필요하면:
- 평시 미사용분: 1000m (1초당) × 0.5 credit/sec × 60초 = 30 credit/min 적립
- spike 시 4000m burst 시: 4000m × 1초 = 4000 credit·sec 소비
- 즉, 1분 적립분 (30 credit) 으로 약 7.5초 burst 가능

이 credit balance가 음수가 되면 throttle되어 429 Too Many Requests 응답.

### 4.3 Multi-tenant fairness in Resource Governance

ResourceQuota는 **namespace 단위** 로 적용되므로, 각 Division을 별도 namespace로 격리:

```typescript
interface NamespaceQuota {
  division: string;
  namespace: string;
  hard: {
    'requests.cpu': string;        // "1000m" (base)
    'requests.memory': string;     // "2Gi"
    'persistentvolumeclaims': string;  // "10"
    'requests.storage': string;    // "100Gi"
  };
  scopeSelector: {
    matchExpressions: [{
      key: 'priority-class',
      operator: 'In',
      values: ['gateway-mesh-tier-1']  // tier 1 = KB국민은행 (high priority)
    }];
  };
}
```

**Priority class** 로 Division별 우선순위 차등 적용. KB금융그룹 MCI처럼 SLA가 다른 Division은 우선순위가 다르게 책정된다.

---

## 5. Reserved vs On-demand Capacity 의사결정 프레임워크

### 5.1 MCP Stateless 전환의 경제적 의미

#070에서 강조했듯이, **MCP 2026-07-28 RC** 의 Stateless 전환은 Gateway Mesh의 **Auto-scaling Zero-to-N** 을 가능하게 한다. Session affinity가 없으므로 K8s HPA (Horizontal Pod Autoscaler) 가 0개에서 N개까지 **즉시 확장** 가능.

이것은 **재무적으로** 어떤 의미를 가지는가?

```
기존 (Session-based):
  Reserved Instances (1-year commit): 평균 workload의 80%
  On-demand Instances: 평균 workload의 120% (peak 대비)

  = 항상 노드의 100%가 running
  = idle resource가 0% (과잉 provisioning 위험)

Stateless 전환 후:
  Reserved Instances: 평균 workload의 60%
  On-demand (HPA triggered): peak workload의 140% (stateless 즉시 확장)
  Scale-to-zero: 야간/주말 미사용 시 0 node

  = 평균 utilization 향상
  = 비용 30~40% 절감 가능
```

### 5.2 Reserved 의사결정 공식

95th percentile 워크로드 기준으로 Reserved 인스턴스 구매 효율을 산출:

```
RPS_distribution (예):
  5%ile: 200 RPS
  50%ile (median): 1,500 RPS
  95%ile: 8,500 RPS
  99%ile: 12,000 RPS (peak)
  99.9%ile: 15,000 RPS (extreme peak)

Reserved 권장 = ceil(95%ile / per_node_capacity) nodes
              = ceil(8,500 / 5,000) = 2 nodes reserved

On-demand buffer = ceil((99.9%ile - 95%ile) / per_node_capacity)
                = ceil(6,500 / 5,000) = 2 nodes on-demand

결과: 2 reserved + 2 on-demand = 4 nodes max
평소 utilization: 95%ile / 4 nodes / per_node = 42.5% (acceptable)
```

**Reserved 인스턴스 할인율** (AWS 기준):
- 1-year no upfront: 27% 할인
- 1-year partial upfront: 34% 할인
- 3-year all upfront: 60% 할인

**ASTP 권장:** Stateful workload (WAL durability) 가 핵심이므로 **3-year all upfront는 위험**. 대신 **1-year partial upfront (34% 할인)** + **유연한 On-demand HPA** 조합을 권장한다. 3-year는 기술 변화 (MCP 신규 RC, ASTP 자체 evolution) 가 빠르므로 결함.

### 5.3 Break-even 분석

```
1-year reserved (partial upfront): $0.034/hour (c6g.2xlarge)
On-demand: $0.0648/hour

할인율 = (0.0648 - 0.034) / 0.0648 = 47.5% ← AWS c6g 실제 할인율

Break-even:
  Reserved를 1년 내내 사용하면 → 47.5% 절감
  Reserved를 9개월만 사용하면 → break-even
  Reserved를 6개월만 사용하면 → 오히려 손해 (선지급분 회수 불가)
```

ASTP는 **6개월 단위로 Reserved 재평가** 를 권장한다. MCP RC 발표 주기(현재 ~3개월), ASTP 자체 마이너 업데이트(1개월) 등을 고려해 **Reserved 인스턴스 utilization을 매월 측정** 한다.

---

## 6. PIPA 보관 비용 최적화: 1년 vs 5년의 Storage Cost 차이

### 6.1 PIPA 보관 요구사항별 Storage 비용

PIPA (개인정보 보호법) 는 보관 기간에 따라 다른 Storage tier가 적합하다:

| 보관 기간 | 적합한 Tier | 단가 (per GB/month) | 1TB 기준 연간 비용 |
|----------|-------------|:---:|:---:|
| 1년 | S3 Standard-IA | $0.0125 | $150 |
| 1년 | S3 Glacier Instant Retrieval | $0.004 | $48 |
| 5년 | S3 Glacier Flexible Retrieval | $0.0036 | $43 |
| 5년 | S3 Glacier Deep Archive | $0.00099 | $12 |

**5년 보관 시 Deep Archive로 12배 절감** 가능하지만, **Retrieval latency** 가 크게 증가한다:
- S3 Standard-IA: 즉시 (milliseconds)
- S3 Glacier Instant: milliseconds
- S3 Glacier Flexible: 1~12 hours
- S3 Glacier Deep Archive: 12~48 hours

**ASTP 권장 전략:**
- **Hot WAL (NVMe, 7일)**: 실시간 요청 처리. fsync latency 0.01ms.
- **Warm WAL (S3 Standard-IA, 30일)**: 일반 조회용. retrieval 즉시.
- **Cold Audit (S3 Glacier Flexible Retrieval, 1년)**: PIPA 감사 증적용. retrieval 1~12h 허용.
- **Frozen Audit (S3 Glacier Deep Archive, 5년)**: 장기 법적 보관. retrieval 12~48h 허용.

### 6.2 Incremental Expunge: GDPR 잊힐 권리와 PIPA의 충돌

GDPR "잇힐 권리 (Right to be Forgotten)" 와 PIPA 5년 보관은 본질적으로 충돌한다. PIPA 보관 의무는 있지만, 개인정보 주체가 **삭제 청구** 를 하면 어떻게 할 것인가?

ASTP는 **Merkle Hash 기반의 Incremental Expunge** 알고리즘으로 해결한다:

```typescript
interface IncrementalExpungeProof {
  // 원본 record 위치 (WAL offset)
  walOffset: number;

  // 해당 record의 hash를 tree에서 제외
  merkleProof: string[];  // sibling hashes (root → leaf path)

  // root hash after exclusion
  newRootHash: string;

  // audit log: "이 record는 expunged 되었다"
  auditEntry: {
    expungedAt: number;
    originalRecordHash: string;  // expunged 이전 hash는 보존 (audit용)
    legalBasis: string;  // "GDPR Art. 17 Right to Erasure"
  };
}

class IncrementalExpunger {
  async expungeRecord(walOffset: number, auditEntry: any): Promise<ExpungeResult> {
    // 1. 해당 record를 Merkle tree에서 제외 (O(log n) sibling hashes)
    const merkleProof = await this.merkleTree.excludeAndProve(walOffset);

    // 2. PIPA audit log에 expunge 사실 기록 (삭제 X, fact 기록)
    await this.auditLog.append({
      event: 'expunge',
      walOffset,
      merkleProof,
      ...auditEntry
    });

    // 3. 새로운 root hash를 cold storage에 commit
    const newRootHash = await this.merkleTree.getRoot();
    await this.coldStorage.commitNewRoot(newRootHash);

    // 4. ZKP 생성: "record X is no longer in WAL" (without revealing X)
    const zkp = await this.zkpEngine.proveExclusion(walOffset);

    return { merkleProof, newRootHash, zkp };
  }
}
```

**핵심 아이디어:**
- WAL record 자체는 **삭제하지 않고** 유지 (PIPA 보관 의무)
- 하지만 Merkle tree의 inclusion proof를 **invalid** 로 만들어 "검색에 안 걸리게" 한다
- Audit log에 "이 record는 expunged 되었다" 는 사실 자체를 기록
- ZKP로 **검색 불가성을 수학적으로 증명** (regulator 만족)

이 접근은 **WAL append-only 속성을 유지하면서 GDPR/PIPA 컴플라이언스를 동시에 만족** 한다. 하지만 **저장 비용은 그대로** 이므로 (record는 보존) 비용 최적화는 **Merkle tree depth + ZKP generation overhead** 로 결정된다.

### 6.3 PIPA 보관 비용 예측

서울대병원 PIPA Federation 시나리오 (5년 보관, 26.3 TB/year):

```
Hot WAL (NVMe 7일):       $0.10/GB × 0.5 TB  = $50/month
Warm WAL (S3 IA 30일):    $0.0125/GB × 2 TB   = $25/month
Cold Audit (Glacier 1년): $0.0036/GB × 26 TB  = $94/month
Frozen Audit (Deep 5년):  $0.00099/GB × 131 TB = $130/month

Total monthly storage: $299/month
Total annual storage: $3,588/year (서울대병원 PIPA Federation)
```

5년 보관 시 **Deep Archive 선택이 압도적으로 저렴** 하지만 retrieval latency를 수용할 수 있어야 한다. ASTP는 의료 Federation의 경우 retrieval SLA를 **P99 < 24h** 로 설정하여 Glacier Flexible Retrieval + Deep Archive 조합을 권장.

---

## 7. 한국 시장 3대 시나리오 연간 TCO 예측

### 7.1 KB금융그룹 MCI Federation

```
노드: 3 × c6g.2xlarge (or equivalent: 8 vCPU, 16GB, NVMe)
연간 TCO 분해:
  Compute:    3 × $0.064 × 8,760 × 0.65 = $1,094
  Storage:    NVMe 7일 + S3 IA 30일 = $720
  Network:    KB사내망은 internal, 외부 egress만: $240
  KMS:        50M envelope calls = $150
  Observability: Prom + Loki + Tempo = $8,000
  Cross-region: N/A (단일 리전)
  Total:      $10,204/year ≈ 1,360만원

Chargeback (4 Division):
  KB국민은행 (50%): 5,102 USD = 680만원
  KB증권 (25%):     2,551 USD = 340만원
  KB손해보험 (15%):  1,531 USD = 204만원
  KB국민카드 (10%):  1,020 USD = 136만원
```

### 7.2 서울대병원 PIPA Federation

```
노드: 2 × c6g.2xlarge (응급 피크 시 HPA로 3rd node 추가)
연간 TCO 분해:
  Compute:    2 × $0.064 × 8,760 × 0.55 = $617
  Storage:    NVMe + IA + Glacier + Deep Archive = $3,588
  Network:    병원 내부 망 = $120
  KMS:        의료 데이터 envelope (전체 Delta): $3,000 (10× 일반)
  Observability: 의료 강화 monitoring = $12,000
  Total:      $19,325/year ≈ 2,580만원

Chargeback: 두 병원 균등 분담 (50:50)
  서울대병원:     966만원
  분당서울대병원: 966만원
```

### 7.3 삼성전자 DS/DX/SDS 3-way Federation

```
노드: 5 × c6g.2xlarge × 4 region = 20 노드 (글로벌 분할)
연간 TCO 분해:
  Compute:    20 × $0.064 × 8,760 × 0.70 = $7,853
  Storage:    4 region × NVMe + IA + Glacier = $8,640
  Network:    Cross-region sync (4 region) + egress = $18,000
  KMS:        산업 데이터 envelope = $1,500
  Observability: Multi-region Prom + Loki + Tempo = $24,000
  Total:      $59,993/year ≈ 8,000만원

Chargeback (3 Division):
  DS (제조 50%):  30,000 USD = 4,000만원
  DX (Device 30%): 18,000 USD = 2,400만원
  SDS (IT 20%):    12,000 USD = 1,600만원
```

**삼성전자 Federation은 Network 비용이 전체 TCO의 30%** 를 차지한다. 글로벌 multi-region의 본질적 비용. Cross-region data transfer를 줄이기 위해 **region-local processing 우선** + **aggregation 후 sync** 패턴이 권장된다.

---

## 8. 자가 검토 (Self-Critique)

이 글에서 의도적으로 다루지 않거나 한계를 인정하는 부분:

1. **AWS 단가 기준:** Section 2~7의 모든 dollar 계산은 AWS c6g.2xlarge / S3 / KMS 단가 기준이다. **GCP / Azure / Naver Cloud** 에서는 단가가 10~40% 차이가 날 수 있다. 한국 시장을 위해 Naver Cloud 단가 (예: c2.medium + Server SSD) 로 재계산하면 **원화 기준이 더 낮아진다**. 본 글의 dollar 수치는 **비교 가능성** 을 위해 표준화한 것이지, 실제 한국 비용이 아니다.

2. **5대 비용 축의 불완전성:** TCO에 **사람의 비용 (운영 엔지니어 / SRE 인건비)** 이 빠져 있다. ASTP Gateway Federation 3-node 운영에 **SRE 1~2명** 이 필요하다고 가정하면, 인건비가 **연 1억 ~ 2억 원** 으로 TCO의 50~70% 를 차지한다. 자동화 수준에 따라 이 비용은 0.5배 ~ 3배까지 변동한다.

3. **Chargeback의 정치적 함의:** Section 3의 Gini-based anomaly detection은 기술적으로 합리적이지만, **조직 정치** 적으로 민감할 수 있다. KB국민은행 IT 본부가 KB증권 IT 본부보다 더 많이 부담하는 상황에서, "왜 우리가 더 비싼가" 라는 질문이 나올 수 있다. **투명한 usage 대시보드** 와 **정기적인 capacity review meeting** 이 기술 모델과 함께 제공되어야 한다.

4. **Burst Credit의 예측 불가능성:** Section 4의 Burst Credit 방정식은 **평시 workload가 안정적** 이라는 가정에 기반한다. 만약 평시 workload 자체가 spike를 자주 일으키면 (예: 매일 점심시간 6x burst), credit이 항상 0에 가까워져 throttle이 빈번해진다. 이런 workload는 **base capacity를 늘려서** reserved 영역으로 흡수해야 한다.

5. **Reserved vs On-demand의 실제 할인율 변동:** Section 5의 AWS 단가는 2026년 8월 기준이다. AWS는 분기마다 reserved instance pricing을 조정하며, AWS Marketplace의 third-party reserved resellers를 통해 더 큰 할인을 받을 수도 있다. **3-year all upfront 60% 할인** 이라는 수치는 **AWS standard RI** 기준이며, **Savings Plans** 와 비교 검토가 필요하다.

6. **PIPA와 GDPR 충돌의 법적 복잡성:** Section 6의 Incremental Expunge는 기술적으로 elegant하지만, **법적으로** 는 "개인정보가 삭제되었다" 와 "Merkle tree에서 exclusion proof가 생성되었다" 가 동일한지 한국 개인정보보호위원회가 명확히 해석하지 않았다. ZKP + audit log의 법적 지위는 **법무 자문** 이 필수다. 본 글의 접근은 **기술적 가정** 일 뿐 법적 보장이 아니다.

7. **Cross-region Data Transfer 비용의 변동성:** Section 7.3의 삼성전자 Federation은 cross-region sync 비용을 $18,000/년으로 잡았지만, **AWS Inter-Region Data Transfer** pricing은 region pair마다 다르며 **Outbound to Internet** 은 다른 단가다. 중국 region (Seoul-Singapore) 의 경우 **Great Firewall 정책** 으로 인해 추가 latency가 발생할 수 있어 application layer의 retry logic이 필요하고, 이 또한 비용에 반영되어야 한다.

8. **Observability 비용의 hidden growth:** Section 2.6에서 Observability 비용이 TCO의 44% 라고 분석했지만, **trace cardinality가 증가하면** 비용이 **선형이 아니라 지수적으로 증가** 한다. ASTP의 7가지 invariant + 6종 metric + distributed tracing은 trace cardinality를 5,000/s 이상으로 만들 수 있으며, 이 경우 Tempo 비용이 $30,000/년으로 뛰는 것도 가능하다. **Adaptive sampling** (Section 7의 Auto-Benchmark Lambda Architecture) 이 실전에서 필수인 이유다.

9. **TCO 모델의 장기 불확실성:** MCP Spec은 6개월마다 major update가 예상된다. 2027년 중반쯤 새로운 transport (예: WebTransport 기반) 이 등장하면 Gateway 코드 자체가 다시 작성될 수 있다. 본 글의 TCO 예측은 **현재 시점 (2026-08-03) 기준** 이며, **12개월 후** 면 모델 자체가 달라질 수 있다. **Quarterly TCO 재평가** 가 FinOps 모범 사례다.

---

## 9. 다음 글 예고: #072 — ASTP Gateway Carbon-Aware Scheduling & Green FinOps

이번 글이 **Cost를 정량화** 했다면, 다음 글 #072는 **Carbon** 으로 같은 문제를 다시 본다. 주요 내용:

- ASTP Gateway Mesh의 **Carbon Footprint** 측정: 전력 사용 (PUE + Watt/operation) + Scope 3 (vendor cloud)
- **Carbon-Aware Scheduling**: 전력 grid의 **carbon intensity** (gCO2/kWh) 가 낮은 region/time 으로 workload migration
- **Green FinOps**: $ 비용이 아닌 **CO2eq 비용** 으로 의사결정. "1M request 당 CO2eq" 가 새로운 KPI.
- 한국 시장 **RE100 (Renewable Energy 100%)** 의무 대응: 네이버/카카오/삼성전자 모두 2030~2040 RE100 목표
- **Geo-distributed CRDT** 와 **Carbon-aware routing** 의 trade-off: consistency vs sustainability

---

## 참고 자료

1. FinOps Foundation: Framework and Principles (https://www.finops.org/)
2. AWS Pricing Calculator: https://calculator.aws/
3. Kubernetes ResourceQuota: https://kubernetes.io/docs/concepts/policy/resource-quotas/
4. Burst Credit (AWS T-series): https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/burstable-credits-baseline-concepts.html
5. S3 Glacier Storage Classes: https://aws.amazon.com/s3/storage-classes/
6. CRDTs and Merkle Trees (Shapiro et al., 2011)
7. Zero-Knowledge Proofs for Audit (Ben-Sasson et al., 2014)
8. PIPA (개인정보 보호법) - 2023년 개정
9. GDPR Article 17: Right to Erasure
10. #066 ~ #070 ASTP Gateway Federation 시리즈