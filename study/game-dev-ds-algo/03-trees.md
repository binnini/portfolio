# 03. 트리

> 힙/우선순위 큐 · 씬 그래프 · 행동 트리 · 쿼드트리/옥트리 · BVH · k-d 트리 · BSP · Trie

---

## 1. 힙 / 우선순위 큐

"가장 우선순위 높은 하나"만 빠르게 꺼내는 구조. 삽입·삭제 O(log n), 최솟값 조회 O(1).

### 게임에서의 사용처
- **A\* 의 open list** — f값이 가장 작은 노드를 먼저 확장
- **타이머 / 쿨다운 스케줄러** — 가장 빨리 만료되는 것 하나만 확인
- 이벤트 스케줄링 (턴제의 ATB 게이지, 시뮬레이션 이벤트 큐)
- 우선순위 있는 작업 큐 (LOD가 높은 청크부터 로드)
- Top-K 랭킹 유지

### 왜 성능 차이가 큰가
```
버프 500개를 매 프레임 전수 순회하며 만료 체크 → 500회/frame
힙의 top만 확인, 아직 만료 전이면 즉시 종료      → 1회/frame
```

```csharp
// .NET 6+ / Unity 2022+ 에서는 PriorityQueue 사용 가능
var timers = new PriorityQueue<BuffInstance, float>();
timers.Enqueue(buff, Time.time + buff.Duration);

void Update() {
    while (timers.TryPeek(out var b, out float expireAt) && expireAt <= Time.time) {
        timers.Dequeue();
        b.OnExpire();
    }
}
```

### 주의점
- 힙은 **중간 원소의 우선순위 변경(decrease-key)이 느림**. A*에서는 보통 "중복 삽입 후 pop 시 stale 체크"로 우회
- 동일 우선순위의 순서가 보장되지 않음(불안정) → 결정론이 필요하면 타이브레이커 키 추가

---

## 2. 씬 그래프 (Transform 계층)

부모-자식 트리. 자식의 월드 변환 = `부모 월드 행렬 × 자식 로컬 행렬`.

### 게임에서의 사용처
- Unity의 Transform 계층 그 자체
- 캐릭터 본 계층 (스켈레톤), 무기를 손 본에 어태치
- 탈것에 탑승한 캐릭터, 배 위의 물건
- UI 계층 (Canvas → Panel → Button → Text)

### 성능 포인트: 더티 플래그
부모가 움직이면 자손 전부의 월드 행렬이 무효화됩니다. 매번 재계산하지 않고 **dirty 표시만 하고, 실제로 조회될 때 계산**합니다(12번 문서 참조).

```csharp
// 안티 패턴: 루프 안에서 Transform 반복 접근 (매번 내부 계산/마샬링)
for (int i = 0; i < n; i++) transform.position += dir * dt;

// 개선: 로컬 변수에 모아서 1회 대입
Vector3 p = transform.position;
for (int i = 0; i < n; i++) p += dir * dt;
transform.position = p;
```

### 주의점
- 깊은 계층은 순회·변환 비용 누적 → 런타임 생성 오브젝트는 계층을 얕게
- 부모 스케일이 비균등(non-uniform)이면 자식 회전이 왜곡됨

---

## 3. 행동 트리 (Behavior Tree)

AI 의사결정을 트리로 표현. 현대 상용 게임 AI의 사실상 표준입니다.

### 노드 종류
| 노드 | 동작 |
|---|---|
| **Sequence** | 자식을 순서대로 실행, 하나라도 실패하면 실패 (AND) |
| **Selector** | 자식을 순서대로 시도, 하나라도 성공하면 성공 (OR) |
| **Parallel** | 자식을 동시에 실행 (이동하면서 사격) |
| **Decorator** | 자식 하나를 감싸 조건/반복/반전 부여 (Inverter, Cooldown, Repeat) |
| **Leaf (Action/Condition)** | 실제 행동 또는 조건 판정 |

각 노드는 매 틱 `Success / Failure / Running` 중 하나를 반환합니다. `Running`이 있어서 여러 프레임에 걸친 행동(이동 중)을 자연스럽게 표현할 수 있는 것이 FSM 대비 큰 장점입니다.

### 예시 트리
```
Selector (위에서부터 우선순위)
├── Sequence [전투]
│   ├── Condition: 적이 보이는가?
│   └── Selector
│       ├── Sequence [근접]
│       │   ├── Condition: 사거리 안인가?
│       │   └── Action: 공격
│       └── Action: 적에게 접근
├── Sequence [회복]
│   ├── Condition: HP < 30%
│   └── Action: 포션 사용
└── Action: 순찰   ← 위가 전부 실패하면 기본 행동
```

### FSM 대비 장점
- 상태 폭발이 없음 (FSM은 상태 n개에 전이 n² 위험)
- 서브트리를 **재사용**할 수 있음 (동일한 [전투] 트리를 여러 몬스터가 공유)
- 우선순위가 트리의 위치로 시각적으로 드러남 → 기획자 협업 용이

---

## 4. 쿼드트리 / 옥트리

**공간을 재귀적으로 4등분(2D) / 8등분(3D)** 하는 트리. 공간 해시 그리드가 "미리 균일하게 썰어놓는" 것이라면,
쿼드트리는 **객체가 몰린 곳만 더 잘게 쪼갭니다.**

```
전체 영역                    객체가 4개를 넘으면 분할
┌─────────────┐            ┌──────┬──────┐
│  ●       ●  │            │ NW   │  NE  │
│      ●      │    →       ├──────┼──────┤
│  ●   ●   ●  │            │ SW   │  SE  │
│      ●   ●  │            │      │      │
└─────────────┘            └──────┴──────┘
                            넘친 자식은 또 분할 (재귀)
```
```
                 [Root: 전체 맵]
                 /    |    |    \
             [NW]  [NE]  [SW]  [SE]
                            /  |  |  \
                        [..][..][..][..]   ← 객체가 몰린 곳만 깊어짐
```

### 코드

```csharp
public sealed class QuadTree {
    const int Capacity = 4;    // 이 수를 넘으면 분할
    const int MaxDepth = 6;    // 무한 분할 방지

    readonly Rect _bounds;
    readonly int _depth;
    readonly List<int> _items = new List<int>(Capacity);
    QuadTree[] _children;      // null이면 리프 노드

    public QuadTree(Rect bounds, int depth = 0) {
        _bounds = bounds;
        _depth  = depth;
    }

    public bool Insert(int id, Vector2 pos) {
        if (!_bounds.Contains(pos)) return false;      // 내 영역이 아님

        if (_children == null) {
            if (_items.Count < Capacity || _depth >= MaxDepth) {
                _items.Add(id);                        // 아직 여유 있음 → 여기 보관
                return true;
            }
            Subdivide();                               // 가득 참 → 4분할
        }

        foreach (var c in _children)                   // 자식에게 위임
            if (c.Insert(id, pos)) return true;
        return false;
    }

    void Subdivide() {
        float hw = _bounds.width * 0.5f, hh = _bounds.height * 0.5f;
        float x = _bounds.x, y = _bounds.y;
        _children = new[] {
            new QuadTree(new Rect(x,      y + hh, hw, hh), _depth + 1),  // NW
            new QuadTree(new Rect(x + hw, y + hh, hw, hh), _depth + 1),  // NE
            new QuadTree(new Rect(x,      y,      hw, hh), _depth + 1),  // SW
            new QuadTree(new Rect(x + hw, y,      hw, hh), _depth + 1),  // SE
        };
        foreach (int id in _items)                     // 기존 항목 재분배
            foreach (var c in _children)
                if (c.Insert(id, PositionOf(id))) break;
        _items.Clear();
    }

    public void Query(Rect area, List<int> result) {
        if (!_bounds.Overlaps(area)) return;           // ★ 가지치기 — 이 아래 전부 스킵

        foreach (int id in _items)
            if (area.Contains(PositionOf(id))) result.Add(id);

        if (_children != null)
            foreach (var c in _children) c.Query(area, result);
    }
}
```

**핵심은 `Query` 첫 줄의 가지치기입니다.** 노드 경계가 질의 영역과 안 겹치면 그 아래 서브트리 전체를 비교 한 번으로 건너뜁니다.
맵의 3/4를 상수 시간에 버리는 셈입니다.

### 함정 네 가지

#### ① 경계에 걸친 객체
점이 아니라 **크기가 있는 객체**는 네 자식에 동시에 걸칩니다.

| 방법 | 설명 | 대가 |
|---|---|---|
| **부모에 보관** | 자식에 완전히 안 들어가면 부모 노드에 둠 | 경계 근처 객체가 루트에 몰려 성능 저하 |
| **중복 등록** | 겹치는 모든 자식에 넣음 | 질의 결과에 중복 → 세대 스탬프 필요 ([02번 문서](02-hash-and-set.md#큰-객체와-중복-결과)) |
| **Loose Quadtree** | 노드의 판정 경계를 2배로 느슨하게 확장 | 구현 복잡, 겹침 검사 증가 |

#### ② 최대 깊이 제한이 반드시 필요하다
객체 10개가 **정확히 같은 좌표**에 있으면 아무리 쪼개도 한 자식에 다 들어갑니다. 깊이 제한이 없으면 무한 재귀로 스택 오버플로가 납니다.

#### ③ 동적 객체의 재삽입 비용
객체가 움직여 다른 노드로 넘어가면 **트리에서 빼서 다시 넣어야** 하고, 노드가 비면 병합(merge)도 고려해야 합니다.
그리드의 "해시 다시 계산" 대비 훨씬 비쌉니다. **쿼드트리가 동적 장면에 약한 이유**가 여기 있습니다.

#### ④ 노드 객체 할당
`Subdivide`마다 `QuadTree` 4개 + `List` 4개가 할당됩니다. 매 프레임 재구축하면 GC 지옥입니다.
실무에서는 노드를 풀링하거나, **배열 기반 평탄 쿼드트리**(자식을 정수 인덱스로 참조)로 구현합니다.

### 게임에서의 사용처
- **프러스텀 컬링** — 부모 노드가 절두체 밖이면 자손 수천 개를 한 번에 제외 ([10번 문서](10-rendering-visibility.md))
- **터레인 LOD** — 거리에 따라 지형 패치를 재귀 분할. 쿼드트리 구조 자체가 LOD 레벨
- **정적 지형·건물·장식물 조회** — 한 번 만들고 안 바꾸므로 재삽입 비용이 없음
- **미니맵 / 월드맵 아이콘** — 줌 레벨에 따라 질의 범위가 크게 변함
- 2D 게임의 정적 콜라이더 브로드페이즈
- **옥트리(3D)** — 복셀 저장(Sparse Voxel Octree), 라이트맵/GI 프로브 배치

### 트레이드오프 요약
- **정적·준정적 객체에 강함.** 동적 객체가 많으면 매 프레임 재삽입 비용이 큼
- **분포가 불균일할수록 유리.** 균일 분포라면 계층 오버헤드만 손해
- **질의 범위가 크게 변할 때 유리.** 가지치기가 알아서 처리

> 동적 객체가 대부분이라면 [02번 문서의 공간 해시 그리드](02-hash-and-set.md#3-공간-해시-그리드-spatial-hash-grid)가 거의 항상 낫습니다.
> 그쪽에 **전체 비교표와 선택 기준**을 정리해두었습니다.
> 동적이면서 분포도 불균일하다면 아래 **BVH**가 답입니다.
---

## 5. BVH (Bounding Volume Hierarchy)

객체를 감싸는 바운딩 볼륨(주로 AABB)을 계층으로 묶은 트리. **공간이 아니라 객체를 분할**한다는 점이 쿼드트리와 다릅니다.

### 게임에서의 사용처
- **레이캐스트 가속** — 총알 히트스캔, 마우스 피킹, AI 시야 판정
- 물리 엔진의 브로드페이즈 (PhysX, Bullet, Box2D의 Dynamic Tree)
- 레이트레이싱 / 라이트맵 베이킹
- 메시 내부의 삼각형 조회

### 특징
- 객체가 이동하면 해당 리프의 AABB만 갱신하고 부모로 전파 → **동적 장면에 강함**
- 빌드 품질 지표: SAH(Surface Area Heuristic)
- Unity의 `Physics.Raycast`가 내부적으로 이 계열을 사용

### 쿼드트리는 동적에 약한데 BVH는 강한 이유

**분할 대상이 다르기 때문입니다.**
```
쿼드트리 : 공간을 고정 분할 → 객체가 경계를 넘으면 소속 노드가 바뀜 → 빼고 다시 넣어야 함
BVH      : 객체를 묶음      → 객체가 움직이면 감싼 상자만 키우면 됨   → 트리 구조는 그대로
```
그래서 **동적이면서 분포도 불균일한** 장면에서는 BVH가 거의 유일한 답입니다.
동적이지만 분포가 균일하다면 [공간 해시 그리드](02-hash-and-set.md#3-공간-해시-그리드-spatial-hash-grid)가 더 싸고 단순합니다.

---

## 6. k-d 트리

k차원 공간을 축 정렬 초평면으로 번갈아 분할. **최근접 이웃(NN) 탐색**에 특화.

### 게임에서의 사용처
- "가장 가까운 적 / 아이템 / 커버 지점 / 회복 포인트"
- 포토맵 조회 (전역 조명)
- 스티어링의 이웃 조회
- 군집화 기반 스폰 배치 검증

### 주의점
정적 데이터에 최적. 매 프레임 움직이는 객체에는 재빌드 비용 때문에 공간 해시 그리드가 보통 더 낫습니다.

---

## 7. BSP 트리 (Binary Space Partitioning)

임의 평면으로 공간을 재귀 이분할.

### 게임에서의 사용처
- **던전 절차 생성** — 전체 공간을 재귀 분할하고 각 리프에 방을 배치, 형제 리프끼리 통로 연결 (8번 문서 참조)
- 구식 FPS의 가시성/렌더 순서 결정 (Doom, Quake) — Z버퍼 없던 시절 화가 알고리즘의 정확한 순서를 트리 순회로 얻음
- 실내 맵의 볼록 영역 분할

---

## 8. Trie (트라이, 접두사 트리)

문자열을 문자 단위 경로로 저장. 접두사 검색 O(길이).

### 게임에서의 사용처
- **채팅 금칙어 필터** (실무에서는 Aho-Corasick으로 확장 — 13번 문서)
- 닉네임 자동완성, 검색 자동완성
- 개발자 콘솔 명령어 자동완성
- 커맨드 시퀀스 매칭

---

## 9. 밸런스 BST / Skip List

정렬 상태를 유지하며 삽입·삭제·구간 조회 O(log n).

### 게임에서의 사용처
- **랭킹 보드** — 점수 삽입과 동시에 순위 조회, "내 앞뒤 5명" 구간 조회
- 경매장 가격 정렬 목록
- 이벤트 시각 순 정렬

> 실무에서는 직접 구현보다 Redis Sorted Set(내부 Skip List)을 쓰는 경우가 많습니다.

---

## 체크리스트

- [ ] 힙 기반 타이머가 왜 전수 순회보다 압도적으로 싼지 수치로 설명할 수 있다
- [ ] 행동 트리의 Sequence/Selector/Running 의미를 설명하고 간단한 트리를 그릴 수 있다
- [ ] 행동 트리가 FSM보다 나은 이유 세 가지를 댈 수 있다
- [ ] 쿼드트리(공간 분할)와 BVH(객체 분할)의 차이와 각각 유리한 상황을 안다
- [ ] 쿼드트리 `Query`의 가지치기가 왜 성능의 핵심인지 설명할 수 있다
- [ ] 경계에 걸친 객체를 처리하는 세 가지 정책과 각각의 대가를 안다
- [ ] 쿼드트리에 최대 깊이 제한이 반드시 필요한 이유를 안다
- [ ] 동적 객체가 많을 때 k-d 트리보다 공간 해시를 택하는 이유를 안다
