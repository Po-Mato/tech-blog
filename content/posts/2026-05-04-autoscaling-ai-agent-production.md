---
title: "AI 에이전트 Production의 숨은 영웅: 오토스케일링이 에이전트 신뢰성을 결정하는 원리"
description: "트래픽이 불규칙하게 들어오는 AI 에이전트 환경에서 '언제 늘리고 언제 줄일 것인가'는生死를 가르는 질문입니다. 이 글에서는 오토스케일링의 네 가지 알고리즘, Kubernetes HPA vs KEDA, 그리고 AI 에이전트 작업 부하에 특화된 실전 오토스케일링 전략을 Infrastructure 레벨부터深掘り합니다."
date: "2026-05-04"
tags: ["Autoscaling", "Kubernetes", "KEDA", "AI-Agent", "Infrastructure", "SRE", "Production-AI", "Architecture"]
---

## 들어가며

A2A 프로토콜로 여러 에이전트가 협업하고, MCP로 외부 도구를 호출하는 Production AI 시스템에서 가장 큰 고통中的一个는 **"요청이 갑자기 밀려올 때 시스템이 무너지는 것"**입니다.

에이전트가 Concurrent하게 동작하고, 사용자가 에이전트에게 자연스럽게 여러 태스크를 동시에 밀어 넣으면서, AI inference는Compute-intensive 특성上 CPU/메모리 사용률이 예츣할 수 없이 치솟습니다.

이 글에서는:

1. 오토스케일링의 4가지 알고리즘 비교
2. Kubernetes HPA v2 vs KEDA 차이와 선택 기준
3. AI 에이전트 작업 부하에 최적화된 오토스케일링 아키텍처
4. 실제 Production 사례에서 추출한 튜닝 패턴

을 정리합니다.

---

## 1. 오토스케일링의 네 가지 알고리즘

### 1.1 Vertical Scaling (수직 스케일링)

가장 단순한 접근입니다. Pod의 resource request/limit을 높이고, 더 큰 노드로 스케줄링합니다.

```yaml
# Vertical Pod Autoscaler (VPA) — Recommendation Mode
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: agent-inference-vpa
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: agent-inference
  updatePolicy:
    updateMode: "Off"  # recommendation만 보고 실제 적용은 "Auto"
  resourcePolicy:
    containerPolicies:
    - containerName: inference
      minAllowed:
        cpu: "100m"
        memory: "256Mi"
      maxAllowed:
        cpu: "8"
        memory: "16Gi"
```

**장점:** 설정이非常简单, 노트북 한 대에서 크게 하는 것처럼 바로 적용 가능
**단점:** 노드 크기の上限에 도달하면 더 이상 확장 불가, 적용 순간 Pod 재시작 발생

### 1.2 Horizontal Scaling (수평 스케일링) — HPA

Pod 레플리카 수를 늘리는 방식입니다. 가장 널리 쓰이는 패턴.

```yaml
# Kubernetes Horizontal Pod Autoscaler (HPA) v2
apiVersion: autoscaling.k2.x-k8s.io/v1
kind: HorizontalPodAutoscaler
metadata:
  name: agent-worker-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: agent-worker-pool
  minReplicas: 2
  maxReplicas: 50
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300  # 5분 동안缩尺DOWN 안 함
      policies:
      - type: Pods
        value: 2
        periodSeconds: 60
    scaleUp:
      stabilizationWindowSeconds: 0  # 즉시 확장 (급증 대응)
      policies:
      - type: Pods
        value: 4
        periodSeconds: 15
```

**핵심 포인트:** `stabilizationWindowSeconds`는 **스케일링 히스테리시스**를 구현합니다. 너무 짧으면 thrashing(확장→축소→확장 반복), 너무 길면 반응 지연.

### 1.3 Predictive Scaling (예측 스케일링)

ML 모델로 미래 트래픽을 예측하고 미리 용량을 늘리는 방식입니다.

```python
# AWS Auto Scaling — Predictive Scaling (Python boto3 예시)
import boto3

autoscaling = boto3.client('autoscaling')

# Predictive Scaling Policy 설정
autoscaling.put_scaling_policy(
    AutoScalingGroupName='agent-inference-asg',
    PolicyName='predictive-scaling',
    PolicyType='PredictiveScaling',
    PredictiveScalingConfiguration={
        'MetricSpecifications': [
            {
                'TargetResourceType': 'ComputeEnvironment',
                'CustomizedCapacityMetric': {
                    'MetricDataQueries': [
                        {
                            'Id': 'agent_active_tasks',
                            'Expression': 'agent_running_tasks / agent_max_capacity',
                            'Label': 'Agent Active Task Ratio'
                        }
                    ]
                },
                'TargetValue': 70,  # 70% 이상이면 확장
                'ScaleInCooldown': 300,
                'ScaleOutCooldown': 60
            }
        ],
        'Mode': 'ForecastAndScale',  # 예측 + 실시간 하이브리드
        'SchedulingBufferTime': 300   # 예측 시간より5분先に 확장
    }
)
```

**AI 에이전트 활용:** 사용자가 작업을 등록하면 작업 큐에积まれる데, Predictive Scaling은 **작업 제출 패턴**을 학습해서 에이전트 풀 크기를 미리 늘립니다.

### 1.4 Event-Driven Scaling — KEDA

AI 에이전트 Workload에 가장 적합한 패턴입니다. 메트릭 기반이 아니라 **이벤트 소스** 기반으로 스케일링합니다.

```yaml
# KEDA (Kubernetes Event-Driven Autoscaling)
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: agent-task-queue-scaler
spec:
  scaleTargetRef:
    name: agent-worker-pool
  pollingInterval: 5      # 5초마다 체크
  cooldownPeriod: 30      # 확장 후 30초间 축소 안 함
  minReplicaCount: 2
  maxReplicaCount: 100

  triggers:
  # 트리거 1: RabbitMQ 큐 깊이
  - type: rabbitmq
    metadata:
      host: amqp://guest:guest@rabbitmq:5672/
      queueName: agent_tasks
      activationThreshold: "10"       # 10개 이상일 때만 스케일 아웃
      threshold: "50"                  # 50개면 max까지 확장

  # 트리거 2: Prometheus — LLM API 에러율
  - type: prometheus
    metadata:
      serverAddress: http://prometheus:9090
      metricName: llm_api_error_rate
      threshold: "0.05"               # 5% 이상 에러율이면 추가 에이전트 배치
      query: |
        sum(rate(llm_api_errors_total{agent_id=~".*"}[2m]))
        /
        sum(rate(llm_api_requests_total{agent_id=~".*"}[2m]))

  # 트리<minimax:tool_call> 3: Cron — 근무 시간 패턴
  - type: cron
    metadata:
      timezone: Asia/Seoul
      start: "0 9 * * 1-5"   # 월~금 09:00에 최소 10개副本
      end: "0 18 * * 1-5"    # 오후 6시에 원복
      desiredReplicas: "10"
```

**KEDA가 AI 에이전트에最强的인 이유:**

| 트리거 유형 | AI 에이전트 활용 시나리오 |
|---|---|
| RabbitMQ / Kafka queue depth | 대기 중인 태스크 수로_worker 수 조정 |
| Prometheus custom metric | LLM API latency / error rate |
| Cron | 업무 시간대 preemptive 확장 |
| AWS SQS | S3에 문서 업로드 이벤트 → 문서 처리 에이전트 확장 |
| Datadog / CloudWatch | 에이전트 에러율 기반 |

---

## 2. HPA vs KEDA: 언제 무엇을 선택하는가

### 2.1 결정 매트릭스

```
                    HPA                              KEDA
─────────────────────────────────────────────────────────────────
기본 원리            메트릭 기반 스케일링             이벤트 소스 기반 스케일링
확장 속도            moderate (1~3분 딜레이)          빠름 (5초 폴링)
축소 속도            느림 (hist窗口 길다)             중간 (cooldownPeriod 튜닝)
커스텀 메트릭        가능하나 설정 복잡             非常简单 (메트릭 쿼리만)
외부 이벤트 소스     불가                             매우 다양함 (30+ 트리거)
구성 복잡도          낮음 ~ 중간                      중간
비용 효율성          배치 작업에 불리                배치 + 이벤트 드리븐에 최적
```

### 2.2 Hybrid 아키텍처 (실무 권장)

HPA와 KEDA를 동시에 쓰는 구성입니다.

```yaml
# HPA — CPU/메모리 기반 안전망 (fallback)
apiVersion: autoscaling.k2s.io/v2
kind: HorizontalPodAutoscaler
metadata:
  name: agent-hpa-fallback
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: agent-worker-pool
  minReplicas: 2
  maxReplicas: 100
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70

---
# KEDA — 큐 기반 최적 확장 (Primary)
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: agent-keda-primary
spec:
  scaleTargetRef:
    name: agent-worker-pool
  minReplicaCount: 2
  maxReplicaCount: 100
  cooldownPeriod: 30
  triggers:
  - type: rabbitmq
    metadata:
      host: amqp://guest:guest@rabbitmq:5672/
      queueName: agent_tasks
      threshold: "20"
```

**이 구성의 효과:**
- KEDA가 큐 메시지 수로 빠르게 확장
- CPU/메모리가 비정상적으로 치솟으면 HPA가 백업으로 동작
-平常時は KEDA만 동작, 이상 발생 시 HPA가 안전망 역할

---

## 3. AI 에이전트 Workload 특성별 오토스케일링 전략

### 3.1 LLM Inference Worker Pool

LLM inference는 **GPU 바운드**이면서 동시에 **메모리 바운드**입니다.

```yaml
# GPU 노드 스케일링 — Karpenter 사용
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: agent-gpu-pool
spec:
  template:
    spec:
      requirements:
      - key: node.kubernetes.io/gpu-count
        operator: Gt
        values: ["1"]
      - key: scheduling.k8s.io/ec2-capacity-type
        operator: Exists
      limits:
        gpu: "8"
        cpu: "32"
        memory: "256Gi"
  disruption:
    consolidationPolicy: WhenUnderutilized
    consolidateAfter: "3m"
  weight: 100

---
# Inference Worker — GPU 활용률 기반 스케일링
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: llm-inference-scaler
spec:
  scaleTargetRef:
    name: llm-inference-worker
  minReplicaCount: 1
  maxReplicaCount: 8
  triggers:
  - type: prometheus
    metadata:
      serverAddress: http://prometheus:9090
      metricName: gpu_utilization_avg
      threshold: "60"         # GPU 60% 이상이면 확장
      query: |
        avg(gpu_utilization{gpu_model=~"A100|H100"}) by (job)
```

### 3.2 에이전트 태스크 큐 (Work Queue Driven)

```python
# 에이전트 태스크 상태 머신
"""
에이전트 태스크 생명주기:
  PENDING → QUEUED → DISPATCHED → RUNNING → COMPLETED/FAILED
                  ↑
                  └─ KEDA가 이 상태만 보고 확장
"""

# RabbitMQ Exchange 구성
# 에이전트가 태스크를 등록하면 agent_tasks 큐에 쌓임
# KEDA가 이 큐의 message count를 읽어서 replica 수 결정
```

### 3.3 Multi-Agent 협업 (A2A 프로토콜)

A2A로 여러 에이전트가 협업할 때, **Orchestrator Agent**와 **Worker Agent**의 스케일링 전략이 다릅니다.

```yaml
# Orchestrator — Concurrent 연결 수 기준
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: orchestrator-scaler
spec:
  scaleTargetRef:
    name: orchestrator-agent
  minReplicaCount: 1
  maxReplicaCount: 10
  triggers:
  - type: prometheus
    metadata:
      metricName: active_agent_sessions
      threshold: "50"           # 50개 이상 세션이면 확장
      query: |
        sum(agent_active_sessions{type="orchestrator"})

---
# Worker Agents — 태스크 큐 처리량 기준
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: worker-agent-scaler
spec:
  scaleTargetRef:
    name: worker-agents
  minReplicaCount: 5
  maxReplicaCount: 200         # 태스크가 많이 쌓이면 대량 확장
  cooldownPeriod: 15
  triggers:
  - type: rabbitmq
    metadata:
      host: amqp://guest:guest@rabbitmq:5672/
      queueName: agent_task_queue
      threshold: "5"            # 5개 이상 대기하면 점진적 확장
      activationThreshold: "20" # 20개부터 스케일 아웃 시작
```

---

## 4. 실전 튜닝: Production에서 얻은教训

### 4.1 스케일링 Thrashing 방지

가장 흔한 실수는 **cooldownPeriod를 너무 짧게 설정**하는 것입니다.

```yaml
# ❌ 잘못된 설정 — Thrashing 발생
cooldownPeriod: 5   # 5초면 확장과 축소가 반복됨

# ✅ 수정된 설정
cooldownPeriod: 300  # 5분간 축소 안 함
```

**경험적 규칙:** 에이전트 태스크 하나의 평균 실행 시간이 30초라면, cooldownPeriod는 최소 **10배 이상(300초)**으로 설정.

### 4.2 Panic Mode (급격 확장 방지)

```yaml
behavior:
  scaleUp:
    stabilizationWindowSeconds: 0  # 즉각 확장
  scaleDown:
    stabilizationWindowSeconds: 600 # 10분간 축소 안 함 (Panic 방지)
    policies:
    - type: Percent
      value: 10                       # 한 번에 10% 이상 축소 불가
      periodSeconds: 600
```

급격한 축소로 인한 **OOM restart cascading failure**를 방지합니다.

### 4.3 Cost Cap으로 예산 관리

```yaml
# Kubernetes Resource Claim으로 비용 상한 제어
apiVersion: v1
kind: LimitRange
metadata:
  name: agent-cost-cap
spec:
  limits:
  - max:
      cpu: "64"
      memory: "128Gi"
    min:
      cpu: "100m"
      memory: "128Mi"
    type: Container
  - max:
      pods: "200"    # 전체 Pod 수로 비용 상한 관리
    type: Pod
```

---

## 5. 모니터링: SLO 달성을 위한 핵심 메트릭

오토스케일링이 제대로 되고 있는지 확인하려면:

| 메트릭 | 목적 | Alert 임계값 |
|---|---|---|
| `scaler_replicas_count` | 현재 replica 수 | sudden drop to min |
| `scaler_trigger_value` | 트리거 메트릭 값 | queue depth > threshold sustained |
| `task_queue_latency_p99` | 태스크 대기 시간 | > 60초 |
| `agent_session_active_count` | 활성 에이전트 세션 | > capacity 80% sustained |
| `gpu_utilization_avg` | GPU 활용률 | < 30% sustained (리소스 낭비) |
| `pod_restart_count` | Pod 재시작 | > 5/hour |
| `llm_api_latency_p99` | LLM 응답 시간 | > 30초 |

```python
# Grafana Dashboard — 오토스케일링 상태 패널
dashboard_config = {
    "panels": [
        {"title": "Active Replicas vs Queue Depth", "metrics": [
            "keda_scaler_replicas",
            "rabbitmq_queue_messages{queue='agent_tasks'}"
        ]},
        {"title": "Task Latency P99", "metrics": [
            "histogram_quantile(0.99, task_processing_duration_seconds)"
        ]},
        {"title": "GPU Utilization Heatmap", "metrics": [
            "gpu_utilization"
        ]}
    ]
}
```

---

## 마무리

AI 에이전트 시스템에서 오토스케일링은 단순한 infrastructure 설정이 아니라, **서비스 신뢰성(SRE)의 핵심 구성 요소**입니다.

핵심 정리:

1. **HPA + KEDA hybrid 구성**이 AI 에이전트 Workload에 가장 효과적
2. **KEDA의 이벤트 드리븐 확장**은 큐 기반 에이전트 태스크에 최적
3. **Panic mode 설정**으로 스케일링 Thrashing과 cascading failure 방지
4. **Cost cap**으로 예산 초과 리스크 관리
5. **실시간 모니터링**으로 SLO 유지 여부 확인

오토스케일링을 제대로 구성하면, 에이전트 시스템은 트래픽 급증에도 안정적으로 동작하면서 불필요한 비용은最小화할 수 있습니다.

---

**References:**

- [KEDA Documentation](https://keda.sh/)
- [Kubernetes HPA v2 Behavior Configuration](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/)
- [Karpenter — Node Provisioning for Kubernetes](https://karpenter.sh/)
- [AWS Auto Scaling — Predictive Scaling](https://docs.aws.amazon.com/autoscaling/ec2/userguide/predictive-scaling-how-it-works.html)
- Datadog "State of AI Engineering 2026"
