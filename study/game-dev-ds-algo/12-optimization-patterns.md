# 12. 최적화 패턴

> 오브젝트 풀링 · 더티 플래그 · 메모이제이션 · 타임 슬라이싱 · 타임 휠 · DOD

알고리즘 복잡도보다 **할당·캐시·프레임 예산**이 게임 성능을 좌우하는 경우가 훨씬 많습니다.

---

## 0. 대전제: 측정 먼저

```
추측하지 말고 프로파일링한다.
Unity Profiler → GC Alloc 열을 먼저 본다 → 프레임당 0 bytes 를 목표로 한다.
```
Unity에서 스파이크의 주범은 대개 알고리즘이 아니라 **프레임당 힙 할당으로 인한 GC**입니다.

---

## 1. 오브젝트 풀링

미리 만들어두고 빌려 쓰고 반납. `Instantiate`/`Destroy`를 런타임에 하지 않습니다.

### 사용처
총알, 피격 이펙트, 데미지 텍스트, 몬스터, 파티클, UI 아이템 슬롯, 사운드 소스

```csharp
class Pool<T> where T : Component {
    readonly Stack<T> _idle = new Stack<T>();
    readonly T _prefab;
    readonly Transform _root;

    public T Rent(Vector3 pos) {
        var obj = _idle.Count > 0 ? _idle.Pop() : Object.Instantiate(_prefab, _root);
        obj.transform.position = pos;
        obj.gameObject.SetActive(true);
        return obj;
    }

    public void Return(T obj) {
        obj.gameObject.SetActive(false);
        _idle.Push(obj);
    }
}
```

### 실전 주의점
| 함정 | 대응 |
|---|---|
| **상태 초기화 누락** | 반납 또는 대여 시 모든 상태를 리셋. 이전 HP/버프/코루틴이 남아 발생하는 버그가 가장 흔함 |
| **이중 반납** | 반납 플래그로 방어 |
| **풀 고갈** | 정책 결정: 추가 생성 / 가장 오래된 것 회수 / 요청 무시 |
| **풀이 무한 성장** | 상한과 축소(shrink) 정책 |
| **참조 잔존** | 반납된 객체를 누군가 계속 참조 → 세대 카운터 포함 핸들로 방어 |
| **비활성 오브젝트 누적** | SetActive 토글 비용도 있음. 대량이면 오프스크린 이동이 나을 때도 |

Unity 2021+는 `UnityEngine.Pool.ObjectPool<T>`를 기본 제공합니다.

---

## 2. 더티 플래그 (Dirty Flag)

변경 사실만 표시하고, **실제로 필요할 때 한 번만** 재계산.

### 사용처
- **Transform 월드 행렬** — 부모가 움직이면 자손에 dirty 전파, 조회 시 계산
- UI 레이아웃 리빌드, Canvas 리빌드
- 캐릭터 최종 스탯 (장비/버프 변경 시에만 재계산, 매 프레임 합산하지 않음)
- 인벤토리 정렬 결과, 세이브 필요 여부
- 절차적 메시 재생성

```csharp
class Stats {
    bool _dirty = true;
    int  _cachedAtk;

    public void OnEquipChanged() => _dirty = true;   // 표시만

    public int Attack {
        get {
            if (_dirty) { _cachedAtk = Recalculate(); _dirty = false; }
            return _cachedAtk;
        }
    }
}
```

### 핵심 이점
"변경은 드물고 조회는 잦다"는 게임의 전형적 패턴에서 비용을 **조회 횟수가 아니라 변경 횟수**에 비례하게 만듭니다.

---

## 3. 메모이제이션 / 캐싱

| 대상 | 설명 |
|---|---|
| 경로 캐시 | 동일 (출발, 목적지) 쌍의 A* 결과 재사용 |
| 컴포넌트 참조 | `GetComponent`를 Awake에서 1회만 (Update에서 호출 금지) |
| 문자열 해시 | `Animator.StringToHash`, Shader 프로퍼티 ID |
| 삼각함수 테이블 | 결정론 시뮬레이션이나 저사양에서 sin/cos LUT |
| 거리 제곱 | `sqrMagnitude`로 sqrt 회피 |
| 정렬 결과 | 원본이 안 바뀌면 재정렬 생략 (더티 플래그와 조합) |

### 캐시 무효화가 진짜 어려움
캐시는 넣기는 쉽고 **언제 버릴지가 어렵습니다.** 무효화 조건을 캐시와 같은 곳에 명시적으로 두세요.

---

## 4. 타임 슬라이싱 / 프레임 분산

무거운 작업을 여러 프레임에 나눕니다. 16.6ms(60fps) 예산을 지키는 것이 목표입니다.

### 사용처
- 길찾기 요청 100건 → 프레임당 5건만 처리
- 대량 오브젝트 스폰 → 프레임당 20개씩
- 맵 절차 생성 → 청크 단위로
- 세이브 직렬화, 대용량 JSON 파싱
- AI 갱신 — 전체를 N그룹으로 나눠 프레임마다 한 그룹만 (`frameCount % N == groupId`)

```csharp
IEnumerator SpawnMany(int total) {
    var sw = System.Diagnostics.Stopwatch.StartNew();
    for (int i = 0; i < total; i++) {
        Spawn(i);
        if (sw.Elapsed.TotalMilliseconds > 2.0) {   // 프레임 예산 2ms
            yield return null;
            sw.Restart();
        }
    }
}
```
> **개수 기준보다 시간 기준**이 안전합니다. 기기 성능 차이를 흡수합니다.

### 갱신 주기 차등 (LOD 사고의 확장)
```
플레이어 5m 이내 몬스터  : 매 프레임 AI 갱신
20m 이내                  : 4프레임에 1회
그 밖                     : 20프레임에 1회 또는 비활성
```

---

## 5. 타임 휠 (Timing Wheel)

대량 타이머를 버킷 배열로 관리해 O(1) 삽입/만료.

```
[0][1][2][3] ... [N-1]   ← 각 버킷은 해당 틱에 만료될 타이머 리스트
현재 틱 포인터가 한 칸씩 돌며 그 버킷만 처리
만료까지 N틱 이상이면 "몇 바퀴 남았는지" 카운터를 함께 저장
```

### 힙과의 비교
| | 힙 | 타임 휠 |
|---|---|---|
| 삽입 | O(log n) | O(1) |
| 만료 처리 | O(log n) | O(1) |
| 적합 규모 | 수백~수천 | 수만 이상 |
| 정밀도 | 임의 | 틱 단위 |

MMO 서버의 수만 개 쿨다운/버프, 네트워크 타임아웃 관리에 씁니다. 클라이언트는 보통 힙으로 충분합니다.

---

## 6. 데이터 지향 설계 (DOD)

### AoS vs SoA
```csharp
// AoS (Array of Structs) — 객체지향적
struct Particle { Vector3 pos; Vector3 vel; Color col; float life; }
Particle[] particles;
// 위치만 갱신해도 색상·수명까지 캐시에 끌려옴

// SoA (Struct of Arrays) — 데이터 지향적
Vector3[] positions;
Vector3[] velocities;
Color[]   colors;
float[]   lifetimes;
// 위치 갱신 시 positions/velocities만 순회 → 캐시 라인 낭비 없음
```

### 원칙
- **필요한 데이터만 연속 메모리에 두고 순차 접근**
- 분기를 데이터로 분리 (조건별로 배열을 나눠 브랜치 미스 제거)
- Unity DOTS/Burst/Job System이 이 사고를 강제하는 프레임워크

### 언제 쓰나
객체 수가 수천~수만 개이고 매 프레임 전수 순회할 때. 수십 개짜리에 DOD를 적용하는 것은 복잡도만 늘립니다.

---

## 7. Unity 특화 체크리스트

### GC 할당 제거
- `foreach` over non-generic collections, LINQ → Update 루프에서 금지
- 문자열 연결 → `StringBuilder` 또는 미리 캐시
- `Physics.OverlapSphere` → `OverlapSphereNonAlloc`
- `GetComponent`, `Camera.main`, `FindObjectOfType` → 캐시
- 람다 클로저가 매 프레임 델리게이트를 할당하는지 확인
- 구조체를 `object`/인터페이스로 받으면 boxing 발생

### 기타
- `Update()` 자체의 오버헤드 — 수천 개면 매니저가 일괄 순회하는 편이 빠름
- `Transform` 접근은 네이티브 호출 → 로컬 변수에 모으기
- `Physics` Collision Matrix 정리
- 애니메이터가 많으면 `Animator.cullingMode` 활용
- 텍스처 압축·밉맵·아틀라스

---

## 8. 최적화 우선순위

```
1. 측정 (Profiler, Frame Debugger)
2. 알고리즘/자료구조 교체      ← 효과가 가장 큼 (O(n²) → O(n))
3. 호출 횟수 줄이기            ← 컬링, 더티 플래그, 갱신 주기 차등
4. 할당 제거                   ← 풀링, NonAlloc
5. 캐시 친화적 배치            ← DOD, SoA
6. 미시 최적화                 ← 마지막에, 측정으로 검증하며
```

---

## 체크리스트

- [ ] 오브젝트 풀에서 상태 초기화 누락 버그를 왜 조심해야 하는지 안다
- [ ] 더티 플래그가 비용을 조회 횟수가 아닌 변경 횟수에 비례시킨다는 것을 설명할 수 있다
- [ ] 타임 슬라이싱을 개수가 아닌 시간 예산 기준으로 구현할 수 있다
- [ ] AoS와 SoA의 캐시 동작 차이를 설명할 수 있다
- [ ] Unity에서 프레임당 GC 할당을 만드는 흔한 코드 패턴 다섯 가지를 안다
- [ ] 최적화를 어떤 순서로 진행해야 하는지 말할 수 있다
