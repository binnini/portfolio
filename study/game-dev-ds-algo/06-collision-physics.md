# 06. 충돌 · 물리

> 브로드페이즈/내로우페이즈 · AABB · Sweep and Prune · SAT · GJK/EPA · CCD · 레이 교차

---

## 0. 2단계 구조 — 왜 나누는가

```
브로드페이즈 (Broad Phase)   : 싸고 부정확. "충돌 가능성 있는 쌍"만 추림
        ↓  후보 쌍 수백 개
내로우페이즈 (Narrow Phase)  : 비싸고 정확. 실제 교차 여부와 접촉점 계산
        ↓
해결 (Resolution)            : 임펄스 적용, 침투 보정
```
n개 객체 전수 비교는 O(n²)입니다. 1000개면 50만 쌍. 브로드페이즈로 이걸 수백 쌍까지 줄이는 것이 핵심입니다.

---

## 1. 브로드페이즈

| 기법 | 특징 |
|---|---|
| **공간 해시 그리드** | 구현 쉽고 동적 객체에 강함. 분포 균일할 때 최적 (02번 문서) |
| **Sweep and Prune (SAP)** | 한 축으로 AABB 구간을 정렬해 겹치는 구간만 검사. **프레임 간 순서가 거의 안 바뀌므로 삽입 정렬이 O(n)에 가깝게 동작** |
| **Dynamic AABB Tree (BVH)** | 객체 이동 시 리프만 갱신. Box2D/PhysX가 사용 (03번 문서) |
| **쿼드트리 / 옥트리** | 정적 객체 위주일 때 |

### AABB 교차 판정 (가장 싼 필터)
```csharp
bool Overlap(in AABB a, in AABB b) =>
    a.min.x <= b.max.x && a.max.x >= b.min.x &&
    a.min.y <= b.max.y && a.max.y >= b.min.y &&
    a.min.z <= b.max.z && a.max.z >= b.min.z;
```
축 하나라도 분리되면 즉시 false → 대부분의 쌍이 여기서 걸러집니다.

---

## 2. 내로우페이즈

### 원-원 (가장 싼 정밀 판정)
```csharp
// sqrt 피하기: 제곱 거리로 비교
bool Hit(Vector3 a, float ra, Vector3 b, float rb) {
    float r = ra + rb;
    return (a - b).sqrMagnitude <= r * r;
}
```
> `Vector3.Distance` 대신 `sqrMagnitude` 비교는 게임 코드 전반에서 쓰이는 기본 습관입니다.

### SAT (분리축 정리)
두 볼록 도형은 **어떤 축에 투영했을 때 겹치지 않는 축이 하나라도 있으면 분리**되어 있습니다.
- 2D 다각형: 각 변의 법선이 후보 축
- 3D OBB: 각 면 법선 3+3개 + 변 방향의 외적 9개 = 15개 축

2D 게임, OBB 충돌, 타격 판정 박스에 널리 쓰입니다. 침투 깊이(MTV)도 함께 얻을 수 있어 밀어내기 처리가 쉽습니다.

### GJK + EPA
- **GJK**: 두 볼록 도형의 민코프스키 차가 원점을 포함하는지로 충돌 판정. 임의의 볼록 형상(구, 캡슐, 볼록 메시)에 통일적으로 적용 가능
- **EPA**: 충돌 시 침투 깊이와 방향 계산

PhysX, Bullet 등 3D 물리 엔진 내부의 핵심 알고리즘입니다. 직접 구현할 일은 드물지만 **엔진이 왜 볼록 형상만 지원하는지**를 설명할 수 있어야 합니다.
(오목 메시는 볼록 분해 — convex decomposition — 를 거칩니다.)

---

## 3. 연속 충돌 판정 (CCD)

### 터널링 문제
```
프레임 t   : 총알 ●     |벽|
프레임 t+1 : 총알        |벽|     ●    ← 벽을 통과해버림
```
이산 판정은 각 프레임의 "순간 위치"만 보므로 빠른 물체가 얇은 벽을 뚫습니다.

### 해결책
| 기법 | 설명 |
|---|---|
| **Swept AABB / Swept Sphere** | 이동 경로 전체를 훑은 볼륨으로 판정. 최초 충돌 시각 t(0~1) 반환 |
| **Raycast 기반 히트스캔** | 총알처럼 빠른 것은 물리 객체 대신 이전→현재 위치로 레이 |
| **서브스테핑** | 프레임을 여러 번 쪼개 시뮬레이션 (비용 큼) |
| **고정 타임스텝** | `FixedUpdate` 물리 갱신 주기를 짧게 |

Unity에서는 Rigidbody의 `Collision Detection`을 `Continuous`로 설정하는 것이 이에 해당합니다.

---

## 4. 레이 교차

### 레이 - 삼각형: Möller–Trumbore
정점 데이터만으로 교차점과 무게중심 좌표(UV 보간용)를 한 번에 구하는 표준 알고리즘.

### 게임에서의 사용처
- **히트스캔 사격**, 레이저
- **마우스 피킹** (화면 좌표 → 월드 레이 → 오브젝트 선택)
- AI 시야 판정 (Line of Sight)
- 카메라 충돌 (벽 뚫음 방지: 캐릭터→카메라로 레이/스피어캐스트)
- 접지 판정 (발 밑으로 짧은 레이)
- 데칼 배치, 조준점 표시

```csharp
// 카메라 벽 뚫음 방지
Vector3 dir = desiredCamPos - pivot;
if (Physics.SphereCast(pivot, 0.25f, dir.normalized,
                       out var hit, dir.magnitude, wallMask))
    camPos = pivot + dir.normalized * (hit.distance - 0.05f);
else
    camPos = desiredCamPos;
```

---

## 5. 충돌 응답

| 개념 | 설명 |
|---|---|
| **침투 해소 (Penetration Resolution)** | MTV(최소 변위 벡터)만큼 밀어냄. 질량 비율로 분배 |
| **임펄스 (Impulse)** | 충돌 법선 방향 속도 변화를 순간적으로 적용. 반발 계수(restitution) 반영 |
| **순차 임펄스 (Sequential Impulse)** | 여러 접촉/구속을 반복적으로 수렴시킴. 대부분의 2D/3D 엔진 방식 |
| **마찰** | 접선 방향 임펄스 제한 (쿨롱 마찰) |
| **슬리핑** | 거의 안 움직이는 강체를 시뮬레이션에서 제외해 비용 절감 |

---

## 6. Unity 실전 체크리스트

- **Collision Matrix** (Project Settings → Physics) — 불필요한 레이어 쌍을 꺼서 브로드페이즈 부하 감소. **가장 가성비 좋은 물리 최적화**
- `Physics.OverlapSphereNonAlloc` 등 **NonAlloc API** 사용 → GC 회피
- 정적 배경 콜라이더에는 Rigidbody를 붙이지 말 것 (Static Collider로 두면 별도 트리에 저장되어 효율적)
- Mesh Collider는 비싸다 → Box/Capsule/Sphere 조합으로 근사
- `FixedUpdate` 주기와 물리 정확도의 트레이드오프 이해
- 타격 판정은 물리 콜라이더 대신 **전용 Hitbox/Hurtbox 구조체 + 직접 판정**이 결정론과 롤백에 유리

---

## 체크리스트

- [ ] 브로드페이즈/내로우페이즈로 나누는 이유를 O(n²) 수치로 설명할 수 있다
- [ ] AABB 교차 판정을 즉석에서 작성할 수 있다
- [ ] SAT의 원리와 2D/3D에서 검사할 축을 설명할 수 있다
- [ ] Sweep and Prune이 삽입 정렬과 궁합이 좋은 이유를 안다
- [ ] 터널링이 왜 생기고 CCD가 어떻게 해결하는지 설명할 수 있다
- [ ] `sqrMagnitude` 비교를 습관적으로 쓴다
- [ ] Collision Matrix 정리가 왜 효과적인 최적화인지 안다
