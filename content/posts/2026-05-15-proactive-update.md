---
title: "이벤트驱动 아키텍처의 현실: Transactional Outbox로 메시지 신뢰성을 보장하는 기술"
date: "2026-05-15"
description: "분산 시스템에서 '이벤트를 정확히 한 번만 발행해야 한다'는 명백해 보이는 요구가 왜 그렇게 어려운지, 그리고 Transactional Outbox 패턴이 이 문제를 어떻게 해결하는지 아키텍처 관점에서 깊이 있게 분석합니다. 메시지 순서 보장, 중복 제거, 그리고 CDC와의 조합까지 실전 구현 사례와 함께 다룹니다."
tags:
  - Event-Driven Architecture
  - Transactional Outbox
  - Reliable Messaging
  - Distributed Systems
  - CDC
  - Architecture Pattern
---

## 서론: 명백해 보이는 요구의 함정

"주문 완료 시 사용자에게 이메일을 보내라." 

이 요구사항은，看起来는 단순합니다. 데이터베이스에 주문 레코드를INSERT하고, 이메일Service를 호출하면 그만입니다. 하지만 이것을 분산 환경에서 **신뢰할 수 있게** 구현하려면 수십 줄의 코드가 필요합니다. 그리고 여전히 완벽한 해법이 아닐 수 있습니다.

이 글에서는 분산 시스템에서 메시지 발행의 신뢰성을 확보하는 기법 중 가장 실용적인 **Transactional Outbox 패턴**을 중심으로, 그 배경 원리부터 실무 구현, 그리고 CDC(Change Data Capture)와의 조합까지 깊이 있게探讨합니다.

---

## 1. 문제의 본질: 왜 단순한 호출은 신뢰할 수 없는가

### 1.1 이중 실패 문제 (Dual Write Problem)

가장 직관적인 구현은 이렇습니다:

```python
# ⚠️ 이 코드는 신뢰할 수 없습니다
def create_order(order_data: OrderData) -> Order:
    order = db.orders.create(order_data)
    email_service.send(order.customer_email, "주문이 완료되었습니다")
    return order
```

이 코드에는 치명적인 문제가 있습니다. `db.orders.create()`는 성공했지만 `email_service.send()`가 실패하면 데이터베이스에는 주문이 있지만 이메일은 보내지 않습니다. 역으로, 이메일 전송 후 DB 트랜잭션이 롤백되면 이메지는 이미 발송된 상태입니다.

이것이 **이중 실패(Dual Write)** 문제입니다. 두 개의 서로 다른 시스템(데이터베이스와 메시지Broker)을 하나의 원자적 트랜잭션으로 묶을 수 없기 때문에, 어떤 작업은 성공하고 어떤 작업은 실패할 수 있습니다.

### 1.2 메시지Broker의 보장 수준

주요 메시지Broker들은 각각 다른 수준의 신뢰성을 제공합니다:

| Broker | 보장 수준 | 기본 동작 |
|--------|----------|-----------|
| RabbitMQ | At-least-once | acknowledgements 기반 |
| Apache Kafka | At-least-once (기본), Exactly-once (설정 가능) | idempotent producer |
| AWS SQS | At-least-once | visibility timeout 기반 |

**Exactly-once semantics**는 marketed되어 있지만, 실제로는 producer → broker 구간과 broker → consumer 구간을 모두Cover해야 하므로 상당한 구현 복잡성이 필요합니다.

---

## 2. 해결 기법들: 각각의 트레이드오프

### 2.1 Polling Publisher (Polling Outbox)

가장 단순한 접근법은 별도의 프로세스가 테이블을 주기적으로 polling하는 것입니다:

```sql
-- 발송 대기 중인 이벤트 테이블
CREATE TABLE outbox (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type VARCHAR(255) NOT NULL,
    aggregate_id   VARCHAR(255) NOT NULL,
    event_type     VARCHAR(255) NOT NULL,
    payload        JSONB NOT NULL,
    created_at     TIMESTAMP DEFAULT NOW(),
    processed_at   TIMESTAMP NULL
);
```

```python
# 별도 프로세스(Worker)가 주기적으로 처리
def poll_outbox():
    events = db.query("""
        SELECT * FROM outbox 
        WHERE processed_at IS NULL 
        ORDER BY created_at 
        LIMIT 100
    """)
    
    for event in events:
        try:
            message_broker.publish(event.event_type, event.payload)
            db.execute(
                "UPDATE outbox SET processed_at = NOW() WHERE id = %s",
                event.id
            )
        except Exception as e:
            logger.error(f"Failed to publish event {event.id}: {e}")
```

**장점:** 구현이 단순함
**단점:** Polling 지연, 빈번한 DB 조회 부담, 스케일링 시 coordination 문제

### 2.2 Transaction Log Tailing (CDC Approach)

데이터베이스의 WAL(Write-Ahead Log)이나 replication log를 직접 읽는 방법입니다. AWS DMS, Debezium, MaxScale 등이 이 접근법을 사용합니다.

```python
# Debezium의 CDC 파이프라인 개념
# MySQL binlog → Kafka Connect → Kafka Topic → Consumer
```

**장점:** 트랜잭션 내부에 개입 없이 이벤트Capture, Near real-time
**단점:** 데이터베이스 종류에 따라 지원 여부가 다름, 설정 복잡, Binlog 포맷 의존

---

## 3. Transactional Outbox 패턴: 정확한 구현

### 3.1 핵심 아이디어

핵심 통찰은 단순합니다: **"메시지 발행도 하나의 트랜잭션으로 묶어라."**

Outbox 테이블은 애플리케이션의 DB 트랜잭션 내부에서 일반 테이블처럼 접근됩니다. 별도의 프로세스가 Outbox를 읽어 메시지Broker에 전달하고, 처리 완료된 레코드를 표시합니다.

```python
def create_order(order_data: OrderData) -> Order:
    with db.transaction():
        order = db.orders.create(order_data)
        
        # ✨ Outbox에 INSERT — DB 트랜잭션의 일부
        db.outbox.create({
            "aggregate_type": "Order",
            "aggregate_id": order.id,
            "event_type": "OrderCreated",
            "payload": {
                "order_id": order.id,
                "customer_email": order.customer_email,
                "total_amount": str(order.total_amount),
                "created_at": order.created_at.isoformat()
            }
        })
        
        # 위 두 작업은同一个 트랜잭션으로 처리됩니다
        # → 둘 다 성공하거나 둘 다 롤백됩니다
    
    return order  # 이메일 전송은 여기서 완료되지 않음
```

주문 생성 함수에서 이메일 전송이 사라졌습니다. 이메일 전송은 Outbox 테이블에 레코드Insertion하는 것으로 대체되었습니다. 이것이 의미하는 바: **주문이 성공하면 그에 대한 알림 Event도 반드시 Outbox에 존재합니다.**

### 3.2 Outbox Processor (Relay Service)

별도의 프로세스가 Outbox 테이블을 읽고 메시지를 전달합니다:

```python
class OutboxProcessor:
    def __init__(self, db: Database, broker: MessageBroker):
        self.db = db
        self.broker = broker
    
    def process_batch(self, batch_size: int = 100):
        with self.db.transaction():
            # 처리 대상 events를 선택 (FOR UPDATE로 행 잠금)
            events = self.db.query("""
                SELECT * FROM outbox 
                WHERE processed_at IS NULL 
                ORDER BY created_at 
                LIMIT %s
                FOR UPDATE SKIP LOCKED
            """, batch_size)
            
            if not events:
                return
            
            try:
                # Batch publish to message broker
                self.broker.publish_batch([
                    {"topic": f"domain.{e.event_type}", "message": e.payload}
                    for e in events
                ])
                
                # 처리 완료 표시
                event_ids = [e.id for e in events]
                self.db.execute("""
                    UPDATE outbox 
                    SET processed_at = NOW() 
                    WHERE id = ANY(%s)
                """, event_ids)
                
            except Exception as e:
                #失败了 — 다음 번 순회 때 다시 시도
                # 롤백되면 processed_at이 NULL로 남아있음
                logger.error(f"Batch publish failed: {e}")
                raise
```

**FOR UPDATE SKIP LOCKED** 구문이 핵심입니다. 이것은 여러 Processor 인스턴스가 동시에 같은 레코드를 처리하지 않도록 보장합니다. OutboxProcessor를 여러Replica로 스케일링해도安全问题이 없습니다.

### 3.3 중복 제거: 멱등 consumer의 중요성

At-least-once 환경에서 메시지 중복은不可避免합니다. Consumer는 멱등하게 동작해야 합니다:

```python
class OrderEventHandler:
    def handle_order_created(self, message: dict):
        # 멱등성 보장: 이미 처리된 이벤트인지 확인
        event_id = message.get("event_id")
        if self.event_store.is_processed(event_id):
            logger.info(f"Event {event_id} already processed, skipping")
            return
        
        order_id = message["order_id"]
        if self.order_service.order_exists(order_id):
            logger.info(f"Order {order_id} already exists, skipping")
            return
        
        self.order_service.create_from_event(message)
        self.event_store.mark_processed(event_id)
```

Event ID를利用하여 멱등성을 확보하면, 메시지가 몇 번이고 중복 전달되어도 결과는 정확히 한 번의 효과와 동일합니다.

---

## 4. CDC와의 조합: Debezium + Outbox

### 4.1 아키텍처 개요

Outbox 테이블을 Debezium CDC로 캡처하면, DB 트랜잭션의可靠性과 Kafka의 스케일링성을 모두 확보할 수 있습니다:

```
Application(DB Transaction)
├── orders table INSERT
└── outbox table INSERT ──→ Commit
                              │
                              ▼
                    Debezium (CDC Connector)
                              │
                              ▼
                        Kafka Topic
                              │
                              ▼
                    Outbox Router SMT
                    (aggregate type → topic mapping)
                              │
                              ▼
                   Domain Topics (OrderCreated, etc.)
                              │
                              ▼
                       Consumer Services
```

### 4.2 Debezium Outbox Router SMT

Debezium 0.8+에서 도입된 **Outbox Event Router SMT**는 Outbox 테이블의 `event_type`과 `aggregate_id`를 기반으로 Kafka Topic을 동적으로Routing합니다:

```json
{
  "name": "outbox-router",
  "config": {
    "connector.class": "io.debezium.connector.postgresql.PostgresConnector",
    "database.server.name": "ordersdb",
    "table.include.list": "public.outbox",
    "transforms": "outbox",
    "transforms.outbox.type": "io.debezium.transforms.outbox.EventRouter"
  }
}
```

Outbox 테이블 구조를 다음과 같이 설계하면:

```sql
CREATE TABLE outbox (
    id UUID PRIMARY KEY,
    aggregate_type VARCHAR(255),  -- "Order"
    aggregate_id VARCHAR(255),     -- "ord-123"
    event_type VARCHAR(255),       -- "OrderCreated"
    payload JSONB,
    created_at TIMESTAMP
);
```

Debezium이 자동으로 `OrderCreated` Topic으로事件的을Routing합니다.

---

## 5. 순서 보장: 같은 Aggregate 내에서는 순서 보장

### 5.1 Kafka Partitioning 전략

Outbox에서 발행된 이벤트가 같은 Aggregate(예: 같은 Order ID)에 대해서는 순서가 보장되어야 합니다. 이것은 Kafka에서 **Partitioning 전략**으로 해결합니다:

```python
def publish_to_kafka(event: OutboxEvent):
    # 같은 aggregate_id는 항상 같은 partition으로
    partition = hash(event.aggregate_id) % num_partitions
    
    producer.send(
        topic=f"domain.{event.event_type}",
        value=event.payload,
        key=event.aggregate_id  # key 기반 partitioning
    )
```

Kafka에서 같은 Key를 가진 메시지는 항상 같은 Partition에 할당됩니다. Consumer 입장에서는 같은 Partition 내에서만 순서가 보장되므로, 같은 Aggregate ID를 Key로 사용하면 해당 Aggregate 내의 이벤트 순서가 보장됩니다.

### 5.2Partition Key vs Message Key

실무에서 흔한 실수가 Partition Key를 event_type으로 설정하는 것입니다:

```python
# ❌ 이 partition 전략은 순서를 보장하지 못합니다
producer.send(topic="domain.OrderEvents", key="OrderCreated")

# ✅ aggregate ID 기반 partition
producer.send(topic="domain.OrderEvents", key="ord-123")
```

event_type을 Key로 사용하면 같은 주문에 대한 `OrderCreated` → `OrderUpdated` → `OrderShipped` 이벤트가 다른 Partition에 갈 수 있고, Consumer에서 순서가 뒤섞일 수 있습니다.

---

## 6. 실무 체크리스트: Outbox 패턴 구현 시 확인 사항

구현 전에 반드시 확인해야 할 실무적 항목들:

- [ ] **Idempotent Consumer**: Producer가 at-least-once를 보장하면, Consumer는 멱등해야 합니다
- [ ] **Outbox 테이블 인덱싱**: `processed_at` 컬럼에 인덱스가 없으면Polling 시 전체 스캔 발생
- [ ] **배치 크기 설정**: 너무 크면 메모리 부담, 너무 작으면 처리량 부족 (100-500 정도가 일반적)
- [ ] **실패 Retry 정책**: Exponential backoff로 무한 재시도 방지
- [ ] **孤儿 이벤트 정리**: 처리 완료된 Outbox 레코드는 따로 정리 정책 필요 (예: 7일 이상 경과 시 삭제)
- [ ] **모니터링**: Outbox 테이블에 `processed_at IS NULL`인 레코드 수를 alerting하는 것이 중요

---

## 결론: 이벤트 신뢰성은 아키텍처적 결정

Transactional Outbox는 "그냥 메시지를 보내는" 코드 한 줄을 추가하는 것보다 훨씬 무겁습니다. 테이블, Processor, 중복 제거 로직, 모니터링까지 필요합니다. 

그렇기에 Outbox 도입 전에 먼저自問해야 합니다: **"이 메시지가 도착하지 않으면 어떤 일이 발생하는가?"** 

만약 아무 일도 발생하지 않는다면(예: 비 kritische 알림), 단순한 at-least-once publish로 충분합니다. 하지만 재고 확인, 결제 처리, 예약 확정처럼 **정확히 한 번**이 필요한 영역이라면, Outbox 패턴의 복잡성은 반드시 감수해야 할 비용입니다.

분산 시스템에서 reliability는 항상 trade-off입니다. Outbox 패턴은 그 trade-off를 의식적으로 선택하는 아키텍처적 결정입니다.
