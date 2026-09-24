# 01. 선형 자료구조

> 배열 · List · 연결 리스트 · 스택 · 큐 · 덱 · 링 버퍼

게임 루프는 "매 프레임 같은 데이터를 순회한다"가 기본이라, 선형 구조의 **캐시 지역성**이 성능을 좌우합니다.

---

## 1. 배열 / List\<T\>

| 연산 | 복잡도 |
|---|---|
| 인덱스 접근 | O(1) |
| 끝에 추가 | 평균 O(1) (재할당 시 O(n)) |
| 중간 삽입/삭제 | O(n) |
| 탐색 | O(n) |

### 게임에서의 사용처
- 엔티티 목록, 파티클 배열, 정점/인덱스 버퍼
- 인벤토리 슬롯, 스킬 슬롯, 웨이브 스폰 테이블
- **매 프레임 전수 순회하는 데이터는 거의 전부 배열 기반** — DOD/ECS의 대전제

### 핵심 포인트: 캐시 지역성
```
연결 리스트 노드 100만 개 순회 → 포인터 추적마다 캐시 미스
배열 100만 개 순회        → 캐시 라인 하나에 여러 원소가 함께 올라옴
```
알고리즘 복잡도가 같아도 실측 성능은 수 배~수십 배 차이가 납니다.

### Unity 실전 팁
```csharp
// 나쁨: 매 프레임 할당 → GC 스파이크
void Update() {
    var enemies = FindObjectsOfType<Enemy>();   // 배열 새로 할당
}

// 좋음: 미리 확보한 리스트 재사용 + NonAlloc API
readonly List<Enemy> _buffer = new List<Enemy>(64);
readonly Collider[] _hits = new Collider[32];

void Update() {
    int count = Physics.OverlapSphereNonAlloc(transform.position, 5f, _hits);
    for (int i = 0; i < count; i++) { /* ... */ }
}
```

### 순회 중 삭제 패턴 (Swap-Remove)
순서가 중요하지 않다면 O(n) 시프트를 피할 수 있습니다.
```csharp
for (int i = list.Count - 1; i >= 0; i--) {
    if (list[i].IsDead) {
        list[i] = list[list.Count - 1];   // 마지막 원소를 당겨오고
        list.RemoveAt(list.Count - 1);    // 끝을 제거 → O(1)
    }
}
```
> `i`가 마지막 인덱스일 때는 자기 자신 대입이 되지만, 바로 다음 줄에서 제거되므로 문제없습니다.
>
> **`^1` 표기에 대해** — C# 8부터 `list[list.Count - 1]` 을 `list[^1]` 로 줄여 쓸 수 있습니다.
> `^n` 은 "끝에서 n번째"를 뜻하는 `System.Index` 값이고 `^1` 이 마지막 원소입니다(`^0` 은 끝 경계라 범위 초과).
> 컴파일러가 `list[list.Count - 1]` 로 그대로 치환하므로 성능 차이는 없습니다.
> 다만 `System.Index` 타입은 .NET Standard 2.1 이상에 있어서 **Unity 2021.2 이상 + API Compatibility Level이 .NET Standard 2.1**인 환경에서만 컴파일됩니다.
> `.NET Standard 2.0` 프로젝트에서는 위의 명시적 형태를 쓰세요.
> 참고로 범위 연산자 `list[1..3]` 은 `List<T>`에 `Slice` 메서드가 없어 사용할 수 없습니다(배열/Span은 가능).

---

## 2. 연결 리스트 (Linked List)

배열과 달리 **중간 삽입/삭제가 O(1)**. 다만 게임에서는 캐시 문제로 용도가 제한적입니다.

### 게임에서의 사용처
- **오브젝트 풀의 free list** — 사용 가능한 슬롯들을 체인으로 연결
- 파티클 시스템의 살아있는/죽은 노드 관리
- 이벤트 구독자 목록 (구독 해제가 O(1))
- 물리 엔진의 접촉(contact) 목록, 타임 휠 버킷

---

### Intrusive List (침습적 연결 리스트)

링크 필드(`Next`/`Prev`)를 **별도의 노드 객체가 아니라 원소 자신이 들고 있는** 형태입니다.
"리스트가 객체를 담는" 게 아니라 "객체가 자기가 리스트에 속해 있다는 사실을 안다"는 뒤집힌 구조라서 intrusive(침습적)라고 부릅니다.

#### 힙에 존재하는 객체 수의 차이

원소가 3개일 때 실제로 힙에 있는 객체:

```
non-intrusive  (LinkedList<Particle>)
  [Node]──→[Node]──→[Node]        ← 래퍼 노드 3개
    │Value   │Value   │Value
    ↓        ↓        ↓
  [P1]     [P2]     [P3]          ← 파티클 3개
  총 6개 객체 · 원소 접근 시 노드 → Value 로 간접 참조 1회 추가

intrusive
  [P1]──→[P2]──→[P3]              ← 파티클이 직접 연결
  총 3개 객체
```

> **"포인터로 연결된 구조"라는 점은 양쪽이 같습니다.** 차이는 연결 방식이 아니라 **객체가 몇 개 존재하느냐**입니다.
> non-intrusive는 원소 하나당 래퍼 객체가 하나씩 더 붙습니다.
> (참고: `LinkedList<T>`는 배열을 전혀 쓰지 않습니다. 내부에 배열을 쓰는 것은 `List<T>` 쪽입니다.)

#### 구현

```csharp
class Particle {
    public Vector3 pos;
    public float   life;

    // 링크를 객체가 직접 소유
    public Particle ListPrev;
    public Particle ListNext;
    public bool     InList;     // 이중 삽입/삭제 방어
}

class ParticleList {
    Particle _head, _tail;
    public int Count { get; private set; }

    public void AddLast(Particle p) {
        p.ListPrev = _tail;
        p.ListNext = null;
        if (_tail != null) _tail.ListNext = p; else _head = p;
        _tail = p;
        p.InList = true;
        Count++;
    }

    // 핵심: 객체 참조만 있으면 탐색 없이 O(1) 제거
    public void Remove(Particle p) {
        if (!p.InList) return;
        if (p.ListPrev != null) p.ListPrev.ListNext = p.ListNext; else _head = p.ListNext;
        if (p.ListNext != null) p.ListNext.ListPrev = p.ListPrev; else _tail = p.ListPrev;
        p.ListPrev = p.ListNext = null;
        p.InList = false;
        Count--;
    }
}
```

순회 중 자기 자신을 제거해도 안전합니다.
```csharp
var cur = _head;
while (cur != null) {
    var next = cur.ListNext;          // 다음을 먼저 확보
    if (cur.life <= 0f) Remove(cur);  // 빼도 순회가 안 깨짐
    cur = next;
}
```

한 객체가 여러 리스트에 동시에 들어갈 수도 있습니다. 링크 필드 세트를 여러 벌 두면 됩니다.
```csharp
class Enemy {
    public Enemy PoolNext;                 // 풀 free list 용 (단일 연결)
    public Enemy ActivePrev, ActiveNext;   // 활성 몬스터 목록 용
    public Enemy AggroPrev,  AggroNext;    // 나를 어그로 잡은 목록 용
}
```

#### "할당이 없다"의 정확한 의미 — 헷갈리기 쉬운 부분

원소 객체(`Particle`) 자체는 당연히 할당됩니다. **없어지는 것은 원소당 딸려 붙는 래퍼 노드 객체**입니다.

이게 중요한 이유는 **둘의 수명이 다르기 때문**입니다.
```
Particle 객체   : 게임 시작 시 풀에서 한 번 만들고 끝까지 재사용 (수명 = 게임 전체)
LinkedListNode  : 리스트에 넣을 때마다 new, 뺄 때마다 버려짐    (수명 = 리스트 체류 시간)
```
`.NET`의 `LinkedList<T>`는 노드를 풀링하거나 재사용하지 않습니다. `Remove()` 하면 그 노드는 그대로 쓰레기가 됩니다.

intrusive의 `AddLast`가 하는 일은 참조 대입 세 번이 전부이고, `new`가 한 번도 없습니다.

#### 실측 감각 — 파티클 1000개 풀, 매 프레임 100개 소멸/생성

| 구성 | 원소 객체 할당 | 노드 객체 할당 | 프레임당 총 할당 |
|---|---|---|---|
| 풀링 없음 + `LinkedList<T>` | 100 | 100 | 200 |
| 풀링 없음 + intrusive | 100 | 0 | 100 |
| 풀링 + `LinkedList<T>` | 0 | **100** | 100 (초당 6,000) |
| **풀링 + intrusive** | 0 | 0 | **0** |

> **"할당 제로"는 intrusive list 단독의 성질이 아니라 오브젝트 풀링과 결합했을 때 완성되는 성질입니다.**
> 풀링으로 원소 할당을 없앴는데 노드 할당이 남아 있으면 반쪽짜리가 되고, intrusive가 그 마지막 한 조각을 제거합니다.

부수 효과로, 객체 수가 절반이면 **GC가 마크 단계에서 훑어야 할 객체 그래프도 절반**입니다.
할당 빈도뿐 아니라 상주 객체 수 자체도 GC 일시정지 시간에 영향을 줍니다.

#### 얻는 것 / 잃는 것

| 이점 | 대가 |
|---|---|
| 삽입/삭제 시 추가 힙 할당 0 | 객체가 리스트 구현에 오염됨 (도메인 데이터와 링크 필드가 섞임) |
| 객체 참조만으로 O(1) 제거 (탐색 불필요) | 같은 링크 필드로는 리스트 하나에만 소속 가능, 같은 리스트에 중복 삽입 불가 |
| 노드 → Value 간접 참조 1회 감소 | 제네릭하지 않음 — 타입마다 링크 필드를 손으로 추가 |
| 순회 중 안전한 자기 제거 | 이중 삽입/삭제 방어를 직접 구현해야 함 (`InList` 플래그) |
| 링크 필드를 여러 벌 두면 다중 리스트 소속 | |

#### 참고: `LinkedList<T>`로도 O(1) 제거는 가능하다

```csharp
class Particle {
    public LinkedListNode<Particle> Node;   // 노드 핸들을 객체가 보관
}
list.Remove(p.Node);   // O(1)
```
이것도 "객체가 리스트 정보를 들고 있다"는 점에서 intrusive의 변종입니다. 다만 **노드 할당은 여전히 발생**합니다.

#### 언제 쓸 것인가

C#은 GC 언어라 객체가 힙에 흩어져 있어서, 링크를 안으로 넣어도 C++만큼의 캐시 이득은 나지 않습니다.
순회 성능은 여전히 배열이 압도적이므로, **대부분의 경우 `List<T>` + swap-remove가 더 단순하고 빠릅니다.**

intrusive list는 아래 조건이 **동시에** 성립할 때만 값어치가 있습니다.
```
· 삽입/삭제가 매 프레임 대량으로 발생하고
· 삽입 순서를 유지해야 하며 (swap-remove를 못 씀)
· 객체 참조만으로 임의 위치를 O(1)에 빼야 하고
· 할당을 절대 만들면 안 된다
```

> C++ 진영의 고전 관용구입니다. Linux 커널의 `list_head`, Boost.Intrusive,
> Unreal의 `TIntrusiveLinkedList`가 모두 이 방식입니다.

---

### 오브젝트 풀의 free list (intrusive 활용 예)

```csharp
class Bullet {
    public Bullet PoolNext;   // free list 링크 (단일 연결이면 충분)
    public bool   Active;
}

class BulletPool {
    Bullet _freeHead;
    public Bullet Rent() {
        var b = _freeHead;
        _freeHead = b.PoolNext;   // O(1), 할당 없음
        b.PoolNext = null;
        return b;
    }
    public void Return(Bullet b) {
        b.PoolNext = _freeHead;   // O(1), 할당 없음
        _freeHead = b;
    }
}
```

### 프리 리스트의 배열 버전 (권장)
실무에서는 참조 대신 **인덱스 프리 리스트**를 더 자주 씁니다. 배열 캐시 이점 + O(1) 대여/반납.
```csharp
int[] _next;      // _next[i] = 다음 빈 슬롯 인덱스, -1이면 끝
int  _freeHead;
```

---

## 3. 스택 (LIFO)

### 게임에서의 사용처
- **UI 화면 스택** — 팝업을 Push, 뒤로가기(ESC)에 Pop
- Undo / Redo (레벨 에디터, 턴 되돌리기)
- **Pushdown Automata** — AI 상태를 쌓았다가 이전 상태로 복귀
- DFS 반복 구현, 씬 그래프 순회
- 콜 스택, 파서(수식 계산, 대화 스크립트)

### UI 스택 예시
```
OpenPopup(설정)   → stack.Push(설정)
OpenPopup(키설정) → stack.Push(키설정)
ESC               → stack.Pop() → 자동으로 설정 화면 복귀
ESC               → stack.Pop() → 메인으로 복귀
```
화면 간 이동 규칙을 각 화면에 하드코딩하지 않아도 되는 것이 핵심 이점입니다.

### Pushdown Automata 예시
```
순찰 중 → [적 발견] Push(추격)
추격 중 → [사거리]  Push(공격)
공격 끝 → Pop()     → 추격으로 복귀
적 놓침 → Pop()     → 순찰로 복귀 (원래 뭘 하고 있었는지 기억할 필요 없음)
```

---

## 4. 큐 (FIFO)

### 게임에서의 사용처
- 입력 이벤트 큐 (프레임 경계와 무관하게 들어온 입력을 순서대로 소비)
- **메시지/이벤트 시스템** — 발행자와 구독자를 프레임 단위로 디커플링
- 비동기 리소스 로딩 요청 큐
- 서버 수신 패킷 처리 큐
- BFS 구현
- 명령 큐 (RTS의 Shift 클릭 이동 명령 대기열)

### 이벤트 큐를 쓰는 이유
즉시 콜백은 **순회 중 컬렉션 변경**, **재귀 이벤트**, **호출 순서 의존성** 문제를 만듭니다.
큐에 넣고 프레임 끝에 일괄 처리하면 이 문제가 사라집니다.

```csharp
class EventQueue {
    readonly Queue<GameEvent> _queue = new Queue<GameEvent>(256);
    public void Publish(GameEvent e) => _queue.Enqueue(e);

    public void Flush() {                  // 프레임 끝에 1회
        int n = _queue.Count;              // 처리 중 추가된 것은 다음 프레임으로
        for (int i = 0; i < n; i++) Dispatch(_queue.Dequeue());
    }
}
```

---

## 5. 덱 (Deque, 양방향 큐)

양쪽 끝에서 O(1) 삽입/삭제.

### 게임에서의 사용처
- **격투 게임 커맨드 입력 버퍼** — 최근 N프레임 입력을 유지하며 앞에서 만료 제거, 뒤로 추가
- 슬라이딩 윈도우 통계 — 최근 60프레임 평균 FPS, 최근 10초 DPS
- 스크롤되는 무한 맵의 타일 청크 (앞에서 빼고 뒤로 붙임)

### 커맨드 입력 판정 예시
```
버퍼(최근 20프레임): [↓, ↘, →, P]
파훼 패턴 "↓↘→P" 를 뒤에서부터 매칭 → 파동권 성립
```

---

## 6. 링 버퍼 (순환 큐)

고정 크기 배열을 인덱스가 빙 돌며 재사용. **추가 할당 없이 최근 N개를 유지**합니다.

```csharp
class RingBuffer<T> {
    readonly T[] _buf;
    readonly int _mask;
    int _head;

    public RingBuffer(int capacityPow2) {      // 반드시 2의 거듭제곱
        _buf  = new T[capacityPow2];
        _mask = capacityPow2 - 1;
    }

    public void Push(T item) {
        _buf[_head] = item;
        _head = (_head + 1) & _mask;
    }

    // ago = 0 이면 가장 최근, 1이면 그 직전
    public T this[int ago] => _buf[(_head - 1 - ago) & _mask];
}
```

---

### 왜 2의 거듭제곱 + `& (len - 1)` 인가

#### 원리

2의 거듭제곱 `N`에 대해 **`x % N` 은 "x의 하위 몇 비트"와 정확히 같습니다.**

```
N     = 8 = 1000₂
N - 1 = 7 = 0111₂       ← 하위 3비트만 1인 마스크

x = 13 = 1101₂
13 & 7 :  1101
        & 0111
        ------
          0101 = 5       ← 13 % 8 = 5 와 동일
```

8로 나눈 나머지는 하위 3비트, 16이면 하위 4비트, 1024면 하위 10비트입니다. `N-1`이 딱 그만큼만 남기는 마스크가 됩니다.

```
x   : 0  1  2  3  4  5  6  7  8  9 10 11 12 13
x&7 : 0  1  2  3  4  5  6  7  0  1  2  3  4  5   ← 8에서 자동으로 0으로 순환
```

#### 이유 A — 음수 인덱싱이 자동으로 해결된다 (실전에서 가장 큰 이유)

C#의 `%` 는 **나머지의 부호가 피제수를 따릅니다.**
```csharp
-1 % 8   // == -1   (수학적 mod 8 이라면 7이어야 함)
-9 % 8   // == -1   (수학적으로는 7)
```

그래서 "N프레임 전"처럼 **뒤로 세는** 인덱싱을 하면 배열 범위를 벗어납니다.
```csharp
// % 를 쓰면 음수 보정이 두 번 필요 — 읽기 어렵고 실수하기 쉬움
_buf[((_head - 1 - ago) % _buf.Length + _buf.Length) % _buf.Length]
```

마스크는 2의 보수 표현 덕분에 **음수까지 알아서 맞습니다.**
```
-1 = 1111 1111 ... 1111₂
   & 0000 0000 ... 0111₂
   ----------------------
     0000 0000 ... 0111₂ = 7        ← 정확히 원하는 값
```
```csharp
_buf[(_head - 1 - ago) & _mask]     // 보정 코드가 사라짐
```

#### 이유 B — 프레임 번호를 그대로 인덱스로 쓸 수 있다

링 버퍼의 가장 우아한 지점입니다. head/tail 관리 자체가 필요 없어집니다.

```csharp
const int Capacity = 8;
const int Mask     = Capacity - 1;
GameState[] _states = new GameState[Capacity];

void Save(int frame)      => _states[frame & Mask].CopyFrom(_current);
GameState Load(int frame) => _states[frame & Mask];
```
```
frame 100 → 100 & 7 = 4
frame 101 → 101 & 7 = 5
 ...
frame 108 → 108 & 7 = 4   ← 8프레임 전 것을 덮어씀. 어차피 필요 없으므로 의도한 동작
```

**단조 증가하는 프레임 번호·시퀀스 번호를 그대로 던지면 알아서 자리를 찾습니다.**
`uint` 시퀀스 번호가 42억을 넘어 0으로 래핑해도 용량이 2의 거듭제곱이면 연속성이 깨지지 않습니다. 넷코드에서 중요한 성질입니다.

#### 이유 C — 나눗셈이 느리다

| 연산 | 대략적 지연 (x86) |
|---|---|
| `&` (AND) | 1 사이클 |
| `%` (idiv) | 20~40 사이클, 파이프라이닝도 잘 안 됨 |

**단, 컴파일러는 `x % 8`처럼 나누는 수가 컴파일 타임 상수면 알아서 마스크로 바꿔줍니다.**
문제는 `x % _buf.Length` — `Length`가 런타임 값이라 최적화가 안 되고 진짜 나눗셈 명령이 나갑니다.

솔직히 말하면 프레임당 몇 번 호출되는 수준에서는 이 차이가 체감되지 않습니다.
오디오 샘플 루프(초당 48,000회)나 파티클 대량 순회 같은 **진짜 뜨거운 루프**에서만 유의미하고,
실무에서 마스크를 쓰는 동기는 성능보다 **이유 A·B의 코드 단순함**인 경우가 많습니다.

#### 대안과 트레이드오프

2의 거듭제곱이 아니어도 링 버퍼는 만들 수 있습니다.
```csharp
// 분기 방식 — 용량이 임의여도 되고 나눗셈도 없음
_head++;
if (_head == _buf.Length) _head = 0;
```
앞으로만 전진한다면 이걸로 충분하고 널리 쓰입니다.
**뒤로 인덱싱하거나 시퀀스 번호를 직접 인덱스로 쓰려는 순간** 마스크 방식이 훨씬 편해집니다.

대가는 메모리입니다. 100칸이 필요해도 128칸을 잡아야 하므로 28칸이 낭비됩니다. 원소가 큰 구조체라면 고려 대상입니다.

---

### 사용처 — 어떤 상황인지 구체적으로

링 버퍼가 답이 되는 상황은 항상 이 세 조건이 겹칩니다.
```
① 최근 N개만 필요하다 (그보다 오래된 건 버려도 됨)
② 매 프레임/매 샘플 갱신된다 → 할당하면 안 된다
③ N이 미리 정해져 있다
```
한마디로 **"고정 크기 창으로 시간축을 들여다보는" 구조**입니다.

#### 사례 A. 롤백 넷코드 — 가장 대표적인 용례

**상황.** 격투 게임, 60fps. 상대 입력이 네트워크로 오는데 50ms(3프레임) 걸립니다.
```
프레임 100 : 내 입력은 안다. 상대 입력은 아직 안 왔다.
             → 기다리면 입력 지연 50ms가 상시 발생 → 격투 게임에선 치명적
             → "상대가 직전과 같은 입력을 하겠지" 예측하고 그냥 진행
프레임 101, 102 : 계속 예측으로 진행
프레임 103 : 프레임 100의 진짜 입력 도착 → 예측이 틀렸다!
             → 프레임 100 상태로 되감아야 한다
```

**여기서 문제.** "프레임 100 상태"가 어디 있어야 할까요?
- 매 프레임 상태를 `new` 해서 쌓으면 → 초당 60개 할당 → GC 스파이크로 게임이 끊김
- 저장하지 않으면 → 되감을 방법이 없음

**링 버퍼.** 되감을 수 있는 최대 거리는 어차피 정해져 있습니다(보통 7~8프레임). 그보다 오래된 상태는 영원히 쓸 일이 없습니다.

```csharp
const int MaxRollback = 8;
const int Mask = MaxRollback - 1;

GameState[] _states = new GameState[MaxRollback];   // 시작할 때 한 번만 할당
InputData[] _inputs = new InputData[MaxRollback];

void SimulateFrame(int frame) {
    _states[frame & Mask].CopyFrom(_current);   // 덮어쓰기, 할당 0
    _inputs[frame & Mask] = currentInput;
    Advance();
}

void Rollback(int toFrame, int currentFrame) {
    _current.CopyFrom(_states[toFrame & Mask]);       // 되감기
    for (int f = toFrame; f <= currentFrame; f++)     // 재시뮬레이션
        Advance(_inputs[f & Mask]);                   // 한 프레임 안에 4~8회 전부 수행
}
```
8칸짜리 배열이 무한히 돌면서 "항상 최근 8프레임"을 유지합니다. 게임 내내 할당은 **초기 8개가 전부**입니다.

#### 사례 B. 하이라이트 클립 — "방금 그 장면 저장"

**상황.** 유저가 멋진 킬을 했습니다. **그제서야** 저장 버튼을 누릅니다. 이미 지나간 30초를 어떻게 저장할까요?

답은 하나뿐입니다. **항상 녹화하고 있어야 합니다.** 그런데 계속 녹화하면 메모리가 무한히 늘어납니다.
```
링 버퍼 1800칸 (30초 × 60fps)
계속 덮어쓰기만 함 → 메모리는 항상 일정
유저가 버튼을 누르면 → 그 순간 버퍼 전체를 파일로 덤프
```
엔비디아 쉐도우플레이, 콘솔의 인스턴트 리플레이, 게임 내 "최근 플레이 저장"이 전부 이 구조입니다.
**"과거를 저장하려면 미리 찍고 있어야 하고, 무한히 찍을 수는 없다"** 는 제약이 링 버퍼를 강제합니다.

#### 사례 C. 오디오 스트리밍 — 생산자·소비자

**상황.** 디코더 스레드가 오디오 데이터를 만들고, 오디오 하드웨어 콜백이 가져다 씁니다.

오디오 콜백에는 절대 규칙이 있습니다. **락을 잡아서도, 할당해서도, 파일을 읽어서도 안 됩니다.** 조금이라도 늦으면 즉시 "툭" 하는 글리치가 들립니다.
```
[디코더 스레드] ──write──→ [ 링 버퍼 ] ──read──→ [오디오 콜백]
                             tail만 건드림      head만 건드림
```
**생산자는 tail만, 소비자는 head만 만지므로 락 없이(lock-free) 동작합니다.** 각자 자기 인덱스만 쓰고 상대 인덱스는 읽기만 하므로 경쟁이 없습니다(SPSC 큐).

여기서는 A·B와 정책이 다릅니다.
- **버퍼가 비면** → underrun, 소리 끊김 (디코더가 못 따라옴)
- **버퍼가 차면** → 덮어쓰면 안 됨. 디코더가 대기해야 함

네트워크 패킷의 지터 버퍼도 같은 구조입니다.

#### 사례 D. 프레임 타임 그래프 / 이동 평균

```csharp
float[] _frameTimes = new float[128];   // 2의 거듭제곱
int _idx; float _sum;

void Update() {
    _sum -= _frameTimes[_idx];           // 나가는 값 빼고
    _frameTimes[_idx] = Time.deltaTime;
    _sum += Time.deltaTime;              // 들어온 값 더하고
    _idx = (_idx + 1) & 127;
    float avgFps = 128f / _sum;          // 평균 계산이 O(1)
}
```
**합계를 증분으로 갱신하는 것이 포인트**입니다. 매번 128개를 다 더하면 O(n)이지만, "나간 값 빼고 들어온 값 더하기"로 O(1)이 됩니다.

같은 패턴: 네트워크 RTT 이동 평균(핑 표시), 카메라 흔들림 스무딩, DPS 미터("최근 10초 딜량"), 자동 품질 조절(최근 N프레임이 기준 이하면 LOD 하향).

#### 사례 E. 격투 게임 커맨드 입력 버퍼

**상황.** 파동권은 `↓ ↘ → P` 를 **일정 시간 안에** 입력해야 성립합니다.
```
버퍼(최근 20프레임): [ ... ↓ ↘ → P ]
                              ↑ 뒤에서부터 역순으로 패턴 매칭
```
```csharp
bool CheckHadouken() {
    for (int ago = 0; ago < 20; ago++) {
        var input = _buf[(_head - 1 - ago) & _mask];   // ← 음수 인덱싱!
        // ...
    }
}
```
**여기서 위의 "이유 A"가 실제로 등장합니다.** `_head - 1 - ago`는 쉽게 음수가 되고, `%`를 썼다면 보정 코드가 필요합니다. 마스크는 그냥 맞습니다.

같은 구조가 **선행 입력(input buffering)** 에도 쓰입니다. 착지 3프레임 전에 점프를 눌러도 착지하자마자 점프가 나가게 하는 그 기능입니다. 최근 입력을 버퍼에 담아두고 "유효한데 아직 소비되지 않은 입력"을 찾는 방식이며, **액션 게임 조작감의 상당 부분이 여기서 나옵니다.**

#### 사례 F. 로그 버퍼 / 크래시 리포트

크래시가 났을 때 필요한 건 **직전 200줄**이지 전체 로그가 아닙니다. 전체를 메모리에 들고 있을 수도 없습니다.
링 버퍼에 최근 200줄만 유지하다가 예외 핸들러에서 통째로 덤프합니다. 모바일 게임 크래시 리포터의 흔한 방식입니다.

---

### 두 가지 정책 — 설계 시작 시점에 정할 것

| | 덮어쓰기 (Overwrite) | 유계 큐 (Bounded Queue) |
|---|---|---|
| 가득 찼을 때 | 가장 오래된 것을 버림 | 생산자가 대기하거나 거부 |
| 관심사 | "최근 N개" | "하나도 빠짐없이 전달" |
| 사례 | A 스냅샷, B 리플레이, D 통계, E 입력, F 로그 | C 오디오, 네트워크 지터 버퍼 |

### 링 버퍼를 쓰면 안 되는 경우

- **전부 처리해야 하고 유실이 절대 안 되는 데이터** → 그냥 `Queue<T>` (결제 요청, 퀘스트 완료 이벤트)
- **필요한 크기를 미리 알 수 없는 경우** → 가변 컬렉션
- **최근 것만이 아니라 임의 시점을 오래 보관해야 하는 경우** → 파일/DB
---

## 체크리스트

- [ ] `List<T>`의 Capacity 재할당이 언제 일어나고 GC에 어떤 영향을 주는지 설명할 수 있다
- [ ] 순회 중 안전하게 원소를 제거하는 두 가지 방법(역순 순회 / swap-remove)을 안다
- [ ] 연결 리스트가 이론상 유리한데도 게임에서 잘 안 쓰이는 이유(캐시)를 설명할 수 있다
- [ ] intrusive list와 `LinkedList<T>`의 힙 객체 수 차이를 그림으로 설명할 수 있다
- [ ] intrusive list의 "할당 제로"가 오브젝트 풀링을 전제로 성립한다는 것을 안다
- [ ] intrusive list를 써야 하는 네 가지 조건과, 그렇지 않을 때 swap-remove가 나은 이유를 안다
- [ ] UI 스택과 Pushdown Automata가 같은 구조라는 걸 이해했다
- [ ] 즉시 콜백 대신 이벤트 큐를 쓰는 이유를 세 가지 댈 수 있다
- [ ] 링 버퍼를 직접 구현하고 롤백 넷코드에 어떻게 쓰이는지 설명할 수 있다
- [ ] `x % N == x & (N-1)` 이 2의 거듭제곱에서 성립하는 이유를 비트로 설명할 수 있다
- [ ] C#의 `%` 가 음수에서 수학적 mod와 다르다는 것과, 마스크가 이를 해결하는 이유를 안다
- [ ] 프레임 번호를 `frame & Mask` 로 직접 인덱싱하는 패턴을 설명할 수 있다
- [ ] 링 버퍼의 두 정책(덮어쓰기 vs 유계 큐)을 구분하고 각각의 사례를 들 수 있다
