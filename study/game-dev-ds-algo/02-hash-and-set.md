# 02. 해시와 집합

> Dictionary · HashSet · 공간 해시 그리드 · 비트셋 · Sparse Set

---

## 1. Dictionary / HashMap

평균 O(1) 조회. 게임 로직의 "ID로 뭔가를 찾는다"는 거의 전부 여기에 해당합니다.

### 게임에서의 사용처
- `instanceID → Entity`, `networkID → Player` 매핑
- 리소스 캐시: `경로 → 로드된 에셋` (중복 로드 방지)
- 데이터 테이블: `itemID → ItemData`, `skillID → SkillData`
- 활성 버프 목록, 쿨다운 관리
- 애니메이션 파라미터 해시 캐시

### Unity 실전 팁
```csharp
// enum 키는 기본 비교자가 boxing을 유발할 수 있음 (구버전 Unity/Mono)
// → 명시적 IEqualityComparer 제공
var table = new Dictionary<ItemType, ItemData>(ItemTypeComparer.Instance);

// string 키를 프레임마다 조회하면 해시 계산 + 문자 단위 비교 비용이 누적됨
// → 정수 해시로 인터닝
static readonly int RunHash = Animator.StringToHash("Run");
animator.SetBool(RunHash, true);
```
> 두 줄 모두 "왜 그런가"가 중요합니다. 아래 [키 타입별 숨은 비용](#키-타입별-숨은-비용) 참조.

### 주의점
- **순회 순서가 보장되지 않음** → 순서 의존 로직/리플레이/결정론 시뮬레이션에서 절대 의존 금지
- GetHashCode가 나쁘면 충돌이 몰려 O(n)으로 퇴화
- 가변 객체를 키로 쓰고 나중에 필드를 바꾸면 영영 못 찾음

---

### 키 타입별 숨은 비용

Dictionary는 "평균 O(1)"이라고 배우지만, **그 O(1) 안에 들어가는 상수가 키 타입에 따라 크게 다릅니다.**
게임 루프에서 프레임당 수천 번 조회한다면 이 상수가 곧 성능입니다.

#### enum 키의 박싱

비교자를 주지 않으면 `EqualityComparer<TKey>.Default`가 쓰이는데, 타입별로 다른 구현이 선택됩니다.
```
TKey 가 IEquatable<TKey> 를 구현? ─── 예 ──→ GenericEqualityComparer<T>   (박싱 없음)
                                  └── 아니오 → ObjectEqualityComparer<T>   (박싱 발생)
```

**enum은 `IEquatable<TEnum>`을 구현하지 않습니다.** `System.Enum`이 구현하는 건 `IComparable`, `IConvertible`, `IFormattable` 뿐이라 폴백 경로로 빠집니다.

`ObjectEqualityComparer<T>`가 하는 일을 개념적으로 쓰면:
```csharp
public override bool Equals(T x, T y) {
    return x.Equals(y);        // ← Enum.Equals(object) 호출. y가 object로 박싱됨
}
public override int GetHashCode(T obj) {
    return obj.GetHashCode();  // ← ValueType.GetHashCode 경로에서도 박싱 가능
}
```
`x.Equals(y)`가 호출하는 건 `Equals(object)` 오버로드입니다. `y`는 값 타입인데 `object` 파라미터로 넘어가야 하니 **힙에 박스 객체를 만들어 참조를 전달**합니다.

**왜 문제인가.** 박싱 1회 = 힙 할당 1회(64비트에서 약 24바이트)이고, 이게 **조회 한 번마다** 발생합니다.
```
몬스터 200마리 × 프레임당 상태 테이블 조회 3회 = 600회/frame
600 × 24바이트 = 14KB/frame × 60fps        = 초당 840KB 쓰레기
```
로직상 아무것도 할당하지 않았는데 GC가 도는, 추적하기 까다로운 부류의 문제입니다.

#### 전용 비교자가 막는 원리

핵심은 **메서드 시그니처가 `object`가 아니라 값 타입을 직접 받는다**는 점입니다.

```csharp
public sealed class ItemTypeComparer : IEqualityComparer<ItemType> {
    public static readonly ItemTypeComparer Instance = new ItemTypeComparer();

    public bool Equals(ItemType a, ItemType b) => a == b;   // 값 타입 파라미터
    public int GetHashCode(ItemType v) => (int)v;           // 값 타입 파라미터
}

var table = new Dictionary<ItemType, ItemData>(ItemTypeComparer.Instance);
```
- `Equals(ItemType, ItemType)` — 파라미터가 값 타입이라 **`object`로 변환할 일 자체가 없습니다.** `a == b`는 기반 정수 비교이므로 IL의 `ceq` 명령 하나로 끝납니다
- `GetHashCode(ItemType v)` — `(int)v`는 enum의 기반값을 꺼내는 캐스팅일 뿐 박싱이 아니고, 해시 계산 비용도 사실상 0

즉 박싱을 "방지"한다기보다 **박싱이 필요한 코드 경로 자체를 타지 않게 우회**하는 것입니다.
(`sealed`를 붙이는 이유: JIT가 가상 호출을 직접 호출로 치환할 여지가 생깁니다.)

> **다만 현대 Unity에서는 대개 불필요합니다.**
> 이건 구버전 Mono(.NET 3.5 시절)의 실제 문제였고, 이후 런타임들이 enum 전용 비교자를 특수 처리하도록 개선했습니다.
> 최신 Unity(IL2CPP 포함)에서는 대부분 해결되어 있으므로 **Profiler의 GC Alloc 열로 확인 후 적용**하세요.
> "enum 키는 무조건 비교자를 만든다"는 맹목적 적용은 코드만 늘립니다.
> 개념은 알아두되 적용은 측정 후에 — 가 맞는 태도입니다.

#### string 키의 해시 비용 — 비용이 두 겹이다

**① 해시 계산 — O(문자열 길이)**
`string.GetHashCode()`는 **모든 문자를 순회**해 해시를 만듭니다. 20자 키면 20글자를 다 읽습니다.
여기서 중요한 사실:
```
Java   : String 객체 안에 hash 필드가 있어 최초 1회만 계산하고 저장
.NET   : 캐시 없음 → GetHashCode() 를 부를 때마다 매번 전체 순회
```
**.NET은 문자열 해시를 캐시하지 않습니다.** 같은 문자열로 100번 조회하면 해시 계산을 100번 합니다. 이것이 "비용이 누적된다"의 의미입니다.

**② 동등 비교 — 또 O(문자열 길이)**
해시가 같아 버킷을 찾았다고 끝이 아닙니다. 해시 충돌일 수 있으므로 **실제로 같은 문자열인지 문자 단위로 확인**합니다. 이것도 길이에 비례합니다.

```
int 키    : 해시 = 값 자체(O(1))     + 비교 = 정수 비교 1회(O(1))
string 키 : 해시 = 전체 순회(O(len)) + 비교 = 전체 순회(O(len))
```

**누적 규모**
```
엔티티 200개 × 프레임당 문자열 키 조회 5회 = 1,000회/frame
× 60fps                                    = 60,000회/초
키 평균 길이 20자 → 해시 20 + 비교 20      = 초당 240만 문자 연산
```
개별 조회는 수십~수백 나노초라 무시할 만합니다. **문제는 그게 프레임마다 수천 번 반복되며 쌓인다**는 점입니다.

**사실 더 큰 문제 — 문자열 생성 자체**
```csharp
// 최악: 조회할 때마다 새 문자열을 힙에 만듦
var data = _table["enemy_" + level + "_" + type];   // 프레임당 할당 → GC
```
해시 계산은 CPU만 쓰지만 문자열 연결은 **힙 할당**이라 GC까지 끌고 옵니다. 실무에서는 이쪽이 더 자주 사고를 냅니다.

#### 대응 정리

| 상황 | 대응 |
|---|---|
| 데이터 테이블 조회 | 로드 시점에 `string → int ID`로 변환하고, 런타임에는 `Dictionary<int, T>` |
| Animator / Shader 프로퍼티 | `StringToHash` / `PropertyToID`를 `static readonly`에 캐시 → [13번 문서](13-strings-and-misc.md#2-문자열--정수-해시-인터닝) |
| 키를 동적으로 조합해야 함 | 문자열 조합 대신 중첩 딕셔너리나 튜플 키(`(int, int)`) |
| enum 키에서 GC Alloc이 잡힘 | 전용 `IEqualityComparer<TEnum>` 제공 |
| 초기화·로딩 시 1회 조회 | **그냥 문자열 쓰세요.** 최적화 대상이 아닙니다 |

---

## 2. HashSet

"있다/없다"만 필요할 때. 중복 제거와 방문 체크.

### 게임에서의 사용처
- **"이번 공격 스윙에 이미 맞은 적"** — 다단 히트 방지의 표준 패턴
- BFS/DFS/A*의 visited(closed) 집합
- 발견한 지역, 해금한 도감, 읽은 대사 ID
- 현재 트리거 안에 들어와 있는 오브젝트 집합

```csharp
readonly HashSet<int> _hitThisSwing = new HashSet<int>();

void OnSwingStart() => _hitThisSwing.Clear();   // 할당 없이 재사용

void OnHit(Collider c) {
    if (!_hitThisSwing.Add(c.GetInstanceID())) return;  // 이미 있으면 false
    ApplyDamage(c);
}
```

---

## 3. 공간 해시 그리드 (Spatial Hash Grid)

월드를 격자로 자르고 **좌표를 셀 인덱스로 바꿔 딕셔너리 키로 쓰는 것**이 전부입니다. 트리도 계층도 없습니다.

```
월드 좌표 (37.4, _, -12.8),  셀 크기 10
  → 셀 인덱스 (3, -2)
  → 딕셔너리 키
  → 그 셀에 속한 객체 목록
```
"내 주변 20m"를 물으면 내 셀 주변 몇 칸만 꺼내봅니다. 나머지 월드는 아예 쳐다보지 않습니다.

### 효과
```
1000마리 전수 비교        = 1000 × 999 / 2 ≈ 50만 회
그리드 (셀당 평균 5마리)  = 마리당 이웃 9칸 × 5 ≈ 45회 → 총 4.5만 회
```

### 전체 코드

```csharp
public sealed class SpatialHashGrid {
    readonly float _invCell;
    readonly Dictionary<long, List<int>> _cells = new Dictionary<long, List<int>>(256);
    readonly Stack<List<int>> _listPool = new Stack<List<int>>();

    public SpatialHashGrid(float cellSize) => _invCell = 1f / cellSize;

    // 셀 좌표 두 개를 long 하나로 패킹
    static long Hash(int cx, int cz) => ((long)cx << 32) | (uint)cz;

    int ToCell(float v) => Mathf.FloorToInt(v * _invCell);

    public void Clear() {
        foreach (var kv in _cells) {      // List를 버리지 않고 재사용
            kv.Value.Clear();
            _listPool.Push(kv.Value);
        }
        _cells.Clear();
    }

    public void Insert(int id, Vector3 pos) {
        long key = Hash(ToCell(pos.x), ToCell(pos.z));
        if (!_cells.TryGetValue(key, out var list)) {
            list = _listPool.Count > 0 ? _listPool.Pop() : new List<int>(8);
            _cells[key] = list;
        }
        list.Add(id);
    }

    public void QueryRadius(Vector3 center, float radius, List<int> result) {
        result.Clear();
        int minX = ToCell(center.x - radius), maxX = ToCell(center.x + radius);
        int minZ = ToCell(center.z - radius), maxZ = ToCell(center.z + radius);

        for (int cx = minX; cx <= maxX; cx++)
        for (int cz = minZ; cz <= maxZ; cz++)
            if (_cells.TryGetValue(Hash(cx, cz), out var list))
                result.AddRange(list);
    }
}
```

### 함정 네 가지

#### ① `FloorToInt` 여야 한다 — `(int)` 캐스팅은 버그다

```csharp
(int)(-0.5f)             ==  0     // 0을 향해 잘림
(int)(-1.5f)             == -1
Mathf.FloorToInt(-0.5f)  == -1     // 아래로 내림
Mathf.FloorToInt(-1.5f)  == -2
```
`(int)`를 쓰면 **원점 주변 셀 하나만 폭이 두 배가 됩니다** (`-0.9 ~ +0.9`가 전부 셀 0).
원점 근처에서만 성능이 나빠지고 판정이 어긋나는, 재현하기 까다로운 버그가 됩니다.

#### ② `(uint)` 캐스팅이 핵심이다

셀 좌표 둘을 `long` 하나에 담는 이유는 **키 전용 구조체나 튜플을 만들지 않기 위해서**입니다.
키가 `long`이면 박싱도 없고 비교도 정수 한 번입니다.

`(uint)`를 빼고 `(long)cz`로 쓰면 깨집니다.
```
cz = -1 일 때
  (long)(-1) = 0xFFFFFFFF_FFFFFFFF   ← 부호 확장으로 상위 32비트까지 1
                                       cx 자리를 덮어써 서로 다른 셀이 같은 키가 됨
  (uint)(-1) = 0x00000000_FFFFFFFF   ← 하위 32비트에만 머묾  ✅
```
`|` 대신 `^`를 써도 동일합니다. `(uint)` 덕분에 상위 32비트가 0이라 겹치는 비트가 없기 때문입니다.

> 읽기 쉬운 대안으로 `Vector2Int`를 키로 써도 됩니다. `IEquatable<Vector2Int>`를 구현해 박싱이 없습니다.
> long 패킹은 마지막 한 방울까지 짜낼 때 쓰세요.

#### ③ 질의 반경으로 셀 범위를 계산해야 한다

```csharp
// 틀림 — 반경이 셀보다 크면 놓친다
for (int dx = -1; dx <= 1; dx++) ...

// 맞음 — 질의 원의 AABB를 셀 좌표로 환산
int minX = ToCell(center.x - radius);
int maxX = ToCell(center.x + radius);
```
반경 25, 셀 크기 10이면 **5×5 = 25칸**을 봐야 합니다. 3×3만 보면 바깥 20m의 적을 놓칩니다.

#### ④ 그리드는 후보만 준다 — 정밀 판정은 호출자 몫

셀은 사각형이고 질의는 보통 원입니다. 모서리 객체는 셀 안이지만 반경 밖일 수 있습니다.
```csharp
_grid.QueryRadius(pos, 20f, _candidates);

float r2 = 20f * 20f;
foreach (int id in _candidates)
    if ((entities[id].pos - pos).sqrMagnitude <= r2)   // 정밀 필터
        ApplyDamage(id);
```
**"싸고 부정확한 1차 필터 → 비싸고 정확한 2차 판정"** 은 [06번 문서](06-collision-physics.md)의 브로드페이즈/내로우페이즈와 정확히 같은 구조입니다.

### 셀 크기 정하기

가장 중요한 튜닝 파라미터이고, 양쪽 끝이 다 나쁩니다.
```
너무 작으면 → 훑을 셀 개수 폭증. 반경 20에 셀 1이면 1,600칸 조회
              딕셔너리 조회 오버헤드가 본전을 까먹음
너무 크면   → 한 셀에 객체가 몰림. 결국 전수 비교로 회귀 (O(n²))
```
경험칙:
- **셀 크기 ≈ 가장 흔한 질의 반경** → 대개 3×3 = 9칸으로 끝남
- 또는 **평균 객체 크기의 2배** 정도
- 검증 지표는 **셀당 평균 객체 수**. 한 자릿수(3~10개)면 좋음

디버그 빌드에서 `_cells.Count`와 최대 셀 점유 수를 HUD에 띄워놓고 튜닝하는 게 가장 빠릅니다.

### 매 프레임 재구축 vs 증분 갱신

```csharp
// 방식 A — 매 프레임 통째로 재구축 (단순)
void FixedUpdate() {
    _grid.Clear();
    for (int i = 0; i < count; i++) _grid.Insert(i, entities[i].pos);
}

// 방식 B — 셀이 바뀐 객체만 이동 (정적 객체가 많을 때)
if (newCell != e.CachedCell) {
    _grid.Remove(e.CachedCell, e.Id);   // List에서 swap-remove
    _grid.Insert(e.Id, e.pos);
    e.CachedCell = newCell;
}
```
의외로 **대부분 방식 A가 낫습니다.** 삽입이 "해시 한 번 + List.Add"뿐이라 매우 싸고, B는 제거를 위해 List에서 원소를 찾아야 합니다.
객체 대다수가 움직이는 액션/RTS라면 A, 대부분 정지해 있고 소수만 움직이면 B입니다.

A를 쓸 때 **`Clear()`에서 List 객체를 버리지 않고 풀에 넣는 것**이 중요합니다. 안 그러면 매 프레임 List 수백 개를 할당합니다.

### 큰 객체와 중복 결과

셀보다 큰 객체(보스, 벽, 차량)를 한 셀에만 넣으면 이웃 셀 검색에서 안 잡힙니다.
겹치는 **모든 셀에 등록**해야 하는데, 그러면 여러 셀을 훑는 질의에서 **같은 객체가 여러 번 나옵니다.**

세대 스탬프(generation stamp)가 깔끔한 해법입니다.
```csharp
int[] _lastQueryId;   // 엔티티별 마지막으로 수집된 질의 번호
int _queryCounter;

public void QueryRadius(...) {
    _queryCounter++;
    // ...
    foreach (int id in list) {
        if (_lastQueryId[id] == _queryCounter) continue;   // 이미 담았음
        _lastQueryId[id] = _queryCounter;
        result.Add(id);
    }
}
```
HashSet 중복 제거보다 훨씬 싸고, 매 질의마다 배열을 지울 필요도 없습니다.
[12번 문서](12-optimization-patterns.md)의 "세대 카운터로 초기화 생략" 기법과 같은 아이디어입니다.

### 사용처 — 구체적으로

#### A. 범위 스킬 / 근접 공격 대상 찾기
가장 흔한 용도입니다. Unity라면 `Physics.OverlapSphereNonAlloc`으로 되는데, **직접 만드는 경우가 생깁니다.**
- 물리 콜라이더가 없는 논리적 엔티티 (서버 시뮬레이션, 데이터 기반 유닛)
- **결정론이 필요할 때** — 물리 엔진 결과는 플랫폼 간 미세하게 다를 수 있음 ([13번 문서](13-strings-and-misc.md))
- DOTS/Job System에서 네이티브 컨테이너로 돌릴 때
- 프레임당 수천 번 질의해 엔진 API 오버헤드가 부담일 때

#### B. 보이드 / 플로킹 — 없으면 아예 성립하지 않음
[07번 문서](07-ai.md)의 Separation·Alignment·Cohesion은 **전부 "내 이웃"이 필요합니다.**
```
전수 비교 : 500마리 × 499 / 2 ≈ 12만 쌍 → 매 프레임
그리드    : 마리당 이웃 9칸 × 평균 5마리 ≈ 45회 → 총 2.2만 회
```
새떼 수백 마리가 60fps로 도는 데모는 예외 없이 공간 분할이 들어가 있습니다.

#### C. RTS 유닛 밀어내기 / 충돌
유닛 300기가 한 지점으로 몰릴 때 서로 겹치지 않게 밀어내야 합니다. 전 유닛 쌍 비교는 불가능하고, 내 셀 + 인접 셀만 봅니다.

#### D. MMO 관심 영역(AoI)
[11번 문서](11-networking.md)의 그것입니다. "이 플레이어에게 누구의 상태를 보낼까"를 판정합니다.
```
1000명 전원에게 전원 브로드캐스트 = 100만 쌍
그리드로 시야 50m 내 평균 20명만 = 2만 쌍
```

#### E. 아이템 자동 획득 / 트리거 감지
"플레이어 반경 2m 내 드롭 아이템 자동 습득". 아이템이 수백 개 떨어져 있어도 주변 셀만 봅니다.

#### F. 파티클 상호작용 / 유체(SPH)
SPH 유체는 **입자마다 이웃 입자를 찾는 것이 알고리즘의 본체**입니다. 공간 해시 없이는 성립하지 않습니다.

### 쿼드트리와의 비교

구조와 코드는 [03번 문서의 쿼드트리 절](03-trees.md#4-쿼드트리--옥트리)을 참조하세요. 요약 비교는 다음과 같습니다.

| 항목 | 공간 해시 그리드 | 쿼드트리 |
|---|---|---|
| 분할 방식 | 균일 셀, **계층 없는 평면 구조** | **적응적 계층** — 몰린 곳만 깊어짐 |
| 삽입 | O(1) — 해시 한 번 | O(깊이) — 루트부터 내려감 |
| 질의 | O(훑는 셀 수 + 결과) | O(log n + 결과) |
| 동적 객체 | **매우 강함** — 재삽입이 해시 재계산 | 약함 — 트리 재구성, 노드 병합 |
| 균일 분포 | **최적** | 계층 오버헤드만 손해 |
| 편중 분포 | 약함 — 한 셀에 몰리면 전수 비교로 퇴화 | **강함** — 그 구역만 잘게 쪼갬 |
| 객체 크기가 제각각 | 약함 — 셀 크기를 하나로 못 정함 | **강함** — 크기에 맞는 깊이에 배치 |
| 질의 반경이 매번 다름 | 약함 — 큰 반경이면 셀 수백 개를 훑음 | **강함** — 가지치기가 알아서 처리 |
| 메모리 | 점유된 셀만 존재 (빈 공간 비용 0) | 노드 객체 오버헤드 |
| 구현 난이도 | **쉬움** (50줄) | 중간 (150줄 + 함정들) |
| 튜닝 파라미터 | 셀 크기 하나 | 노드 용량, 최대 깊이, 경계 정책 |
| 최악의 경우 | 전원이 한 셀 → O(n²) | 전원이 한 점 → 깊이 제한에 걸려 리프에 몰림 |

#### 선택 기준
```
매 프레임 움직이는 객체가 대부분이고
크기가 비슷하고
질의 반경도 대체로 일정하다
   → 공간 해시 그리드  (액션/RTS/슈터의 게임플레이 질의 대부분)

객체가 대체로 정지해 있고
분포가 극단적으로 불균일하고 (도시는 빽빽, 사막은 텅)
질의 범위가 크게 변한다
   → 쿼드트리  (렌더링 컬링, 지형, 정적 오브젝트)
```

**둘을 함께 쓰는 것이 실무에서 흔합니다.**
```
정적 지형·건물·장식물  → 쿼드트리 (한 번 빌드, 컬링에 사용)
동적 유닛·투사체·파티클 → 공간 해시 그리드 (매 프레임 재구축)
```

#### 중간 지대와 대안

| 구조 | 언제 |
|---|---|
| **계층적 그리드 (Multi-level Grid)** | 객체 크기가 제각각일 때. 크기별로 셀 크기가 다른 그리드를 여러 겹 운용 |
| **BVH / Dynamic AABB Tree** | 공간이 아니라 **객체**를 묶음. **동적 + 불균일**을 동시에 처리 ([03번 문서](03-trees.md#5-bvh-bounding-volume-hierarchy)) |
| **k-d 트리** | 최근접 이웃 질의가 주목적이고 데이터가 정적일 때 |
| **정렬 배열 (Sweep and Prune)** | 한 축으로 길쭉한 장면, 객체 수가 적당할 때 ([06번 문서](06-collision-physics.md)) |

> 쿼드트리가 동적에 약하고 BVH가 동적에 강한 이유는 **분할 대상이 다르기 때문**입니다.
> 쿼드트리는 **공간**을 고정 분할하므로 객체가 경계를 넘으면 소속이 바뀝니다.
> BVH는 **객체**를 묶으므로 객체가 움직이면 그 객체를 감싼 상자만 키우면 되고, 트리 구조는 그대로 둘 수 있습니다.
---

## 4. 비트셋 / 비트 플래그

여러 개의 참/거짓을 정수 하나에 압축. 비교와 조합이 단일 CPU 명령입니다.

```csharp
[Flags]
enum StatusEffect {
    None    = 0,
    Stun    = 1 << 0,
    Silence = 1 << 1,
    Root    = 1 << 2,
    Burn    = 1 << 3,
    // 행동 불가 판정을 조합으로 정의
    CannotAct = Stun | Silence,
}

bool CanCastSkill(StatusEffect s) => (s & StatusEffect.CannotAct) == 0;
```

### 게임에서의 사용처
- **레이어 마스크** — `Physics.Raycast(..., layerMask)`, 충돌 매트릭스
- 상태이상 플래그
- 업적 / 퀘스트 / 도감 진행도 (수천 개를 비트 배열로)
- **타일맵 오토타일링** — 이웃 8방향 벽 여부를 8비트로 만들어 타일 인덱스 결정
- 입력 상태 스냅샷 (넷코드에서 버튼 8개를 1바이트로)

### 오토타일 예시
```
이웃 비트:  상=1, 우=2, 하=4, 좌=8
상 + 좌 가 벽이면 → 1 | 8 = 9 → 타일셋 9번(ㄱ자 코너) 사용
```

---

## 5. Sparse Set (ECS의 핵심 저장소)

**희소 배열**(entityID → dense 인덱스)과 **밀집 배열**(실제 컴포넌트 데이터)을 짝지은 구조.

```
sparse: [ _, 0, _, 1, _, 2 ]     // entityID → dense index
dense : [ 1, 3, 5 ]              // dense index → entityID
data  : [ Cm1, Cm3, Cm5 ]        // 실제 컴포넌트 (dense와 같은 순서)
```

| 연산 | 방법 | 복잡도 |
|---|---|---|
| 추가 | dense 끝에 append, sparse 갱신 | O(1) |
| 삭제 | 마지막 원소를 구멍에 swap, 둘 다 갱신 | O(1) |
| 조회 | `data[sparse[id]]` | O(1) |
| 순회 | `data` 배열 선형 순회 | 캐시 최적 |

### 왜 중요한가
**O(1) 추가/삭제**와 **캐시 친화적 순회**를 동시에 얻습니다. Dictionary는 순회가 흩어지고, 배열은 삭제가 비싼데 Sparse Set은 둘 다 해결합니다.
Unity DOTS, EnTT, Bevy 등 현대 ECS의 저장소가 이 구조(또는 아키타입 청크)를 씁니다.

### 주의점
- entityID 범위만큼 sparse 배열 메모리가 필요 → 페이지 단위 분할로 완화
- swap 삭제 때문에 **순회 중 순서가 바뀜** → 순서 의존 금지

---

## 체크리스트

- [ ] Dictionary 순회 순서에 의존하면 왜 위험한지 설명할 수 있다
- [ ] enum 키가 기본 비교자에서 박싱되는 경로(IEquatable 미구현 → 폴백)를 설명할 수 있다
- [ ] 전용 비교자가 박싱을 막는 원리가 "시그니처가 값 타입을 직접 받는 것"임을 안다
- [ ] string 키의 비용이 해시 계산과 동등 비교 두 겹이라는 것, .NET이 해시를 캐시하지 않는다는 것을 안다
- [ ] 다단 히트 방지를 HashSet으로 구현할 수 있다
- [ ] 공간 해시 그리드를 직접 구현하고 셀 크기를 정하는 기준을 말할 수 있다
- [ ] `(int)` 캐스팅 대신 `FloorToInt`를 써야 하는 이유를 음수 좌표로 설명할 수 있다
- [ ] 셀 좌표를 long으로 패킹할 때 `(uint)` 캐스팅이 필요한 이유를 안다
- [ ] 질의 반경이 셀 크기보다 클 때 3×3 고정 순회가 왜 버그인지 안다
- [ ] 그리드는 후보만 주고 정밀 판정은 호출자 몫이라는 구조를 이해했다
- [ ] 그리드와 쿼드트리 중 무엇을 쓸지 객체의 동적 여부·분포·질의 반경으로 판단할 수 있다
- [ ] `[Flags]` enum으로 상태이상 조합 판정을 작성할 수 있다
- [ ] Sparse Set이 Dictionary와 배열의 장점을 어떻게 동시에 갖는지 설명할 수 있다
