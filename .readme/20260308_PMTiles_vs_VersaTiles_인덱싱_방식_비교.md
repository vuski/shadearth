# PMTiles v3 vs VersaTiles v02 — 인덱싱 방식 비교

> 조사일: 2026-03-08
> 취약점 대응 맥락에서 시작된 두 포맷의 기술적 비교 분석

---

## 개요

| 항목 | PMTiles v3 | VersaTiles v02 |
|------|-----------|----------------|
| 개발 | Protomaps | versatiles-org |
| 언어/구현 | JS, Go, Python 등 | Rust (서버), Node.js |
| 설계 목표 | 서버리스 퍼스트 (S3/GCS) | 고성능 서버 서빙 |
| 파일 확장자 | `.pmtiles` | `.versatiles` |

---

## 1. 타일 주소 체계

### PMTiles — Hilbert Curve TileID

z/x/y 좌표를 힐베르트 곡선 상의 1차원 위치(TileID)로 변환한다.

```
zoom 0: (0,0) → TileID 0
zoom 1: (0,0) → TileID 1,  (1,0) → TileID 4
```

- 공간적으로 인접한 타일 = TileID도 인접 → **HTTP Range Request 공간 지역성 보장**

### VersaTiles — z/x/y + 256×256 블록 그룹핑

z/x/y를 직접 사용하며, 256×256 타일 영역을 하나의 블록으로 묶는다.

```
block_col = x / 256
block_row = y / 256
tile_pos  = (y%256 - row_min) × col_range + (x%256 - col_min)
```

---

## 2. 인덱스 구조

### PMTiles — 2단계 Directory

```
[Header 127B][Root Directory][Metadata][Leaf Directories][Tile Data]
              ↑ 반드시 첫 16,384 바이트 이내
```

**Directory Entry 형식** (varint + delta encoding):

| 필드 | 타입 | 크기 |
|------|------|------|
| TileID | delta varint | ~2-3 bytes |
| Offset | varint | ~4-5 bytes |
| Length | varint | ~2-3 bytes |
| RunLength | varint | ~1 byte |
| **합계** | | **평균 ~10 bytes** |

- `RunLength > 0`: 실제 타일 (연속된 N개 타일 커버)
- `RunLength = 0`: Leaf Directory 포인터
- TileID는 delta-encoding → 인접 타일 간 차이값만 저장
- 전체 디렉토리는 gzip/zstd로 압축

### VersaTiles — Block Index + Tile Index 2단계

```
[Header 66B][Metadata][Block1: TileIndex+Blobs][...][Block Index]
                                                      ↑ 파일 끝에 위치
```

**Block Index Entry** (33 bytes 고정):

| 필드 | 크기 |
|------|------|
| zoom, block_col, block_row | 각 1-2 bytes |
| col_min, row_min, col_max, row_max | 각 1 byte |
| offset | 8 bytes |
| blob_length | 8 bytes |
| tile_index_length | 4 bytes |

**Tile Index Entry** (12 bytes 고정):

| 필드 | 크기 |
|------|------|
| offset | 8 bytes |
| length | 4 bytes |

- Block Index와 Tile Index 모두 **항상 Brotli 압축**
- 빈 타일 슬롯: `offset=0, length=0` → zero bytes → Brotli에 최적

---

## 3. 타일 조회 알고리즘

### PMTiles 조회 흐름

```
z/x/y → TileID 계산 (힐베르트 비트 연산, O(1))
       ↓
Root Directory 읽기 (최초 16KB, 캐시 가능)
       ↓
TileID 이진탐색 O(log N)
       ↓
RunLength > 0 → Tile Data 읽기
RunLength = 0 → Leaf Directory 추가 요청 → 이진탐색 반복
```

### VersaTiles 조회 흐름

```
z/x/y 입력
       ↓
Block Index 읽기 (파일 끝, 캐시 가능)
       ↓
block_col/row로 이진탐색 O(log B)  ← B = 블록 수
       ↓
해당 블록의 Tile Index 읽기 (Brotli 해제)
       ↓
배열 인덱스 O(1) 계산 → Tile Data 읽기
```

---

## 4. HTTP 요청 횟수 비교

### 콜드 스타트 (캐시 없음)

| | PMTiles | VersaTiles |
|---|:---:|:---:|
| 1차 요청 | 헤더 + Root Directory (16KB 통합) | 헤더 (66 bytes) |
| 2차 요청 | [필요시] Leaf Directory | Block Index (파일 끝) |
| 3차 요청 | Tile Data | Tile Index (해당 블록) |
| 4차 요청 | — | Tile Data |
| **합계** | **2~3회** | **3~4회** |

### 웜 상태 (캐시 후)

- 둘 다 **1회/타일** (캐시된 인덱스 참조 후 데이터만 요청)

---

## 5. 인덱스 크기 이론 추정 (전세계 zoom 0~14)

| 항목 | PMTiles | VersaTiles |
|------|---------|------------|
| 전체 타일 슬롯 | ~3.5억 | ~3.5억 |
| 실제 엔트리 수 | ~5천만 (RunLength로 빈타일 제거) | ~3억 슬롯 (zero 포함) |
| **압축 전 인덱스** | ~500MB | ~4,200MB |
| **압축 후 인덱스** | ~80~150MB | ~30~60MB |
| 압축 특성 | delta varint → entropy 높음 | zero 배열 → Brotli 100:1 |

> VersaTiles는 압축 전 크기가 크지만 Brotli의 zero 압축 효율 덕분에
> 최종 압축 크기가 오히려 작을 수 있다.

---

## 6. 탐색 알고리즘 복잡도

| | PMTiles | VersaTiles |
|---|---------|------------|
| 알고리즘 | O(log N) 이진탐색 | O(log B) + O(1) |
| 실제 비교 횟수 (zoom 14) | log₂(5천만) ≈ **26회** | log₂(1,100) ≈ **10회** + O(1) |

탐색 속도는 VersaTiles가 이론상 유리. 단, 둘 다 ns 단위라 실체감 차이 없음.

---

## 7. 압축 전략 비교

| | PMTiles | VersaTiles |
|---|---------|------------|
| **전략** | 정보량 자체를 줄임 | 구조 단순, 압축기에 위임 |
| **방법** | varint + delta encoding (의미론적 사전압축) | 고정 12B 슬롯 + Brotli |
| **비유** | 짐 싸기 전 불필요한 물건 버림 | 물건 다 넣고 진공포장 |

---

## 8. 서버리스 운영 가능성

| | PMTiles | VersaTiles |
|---|:---:|:---:|
| 클라이언트 사이드 JS 라이브러리 | **있음** (npm pmtiles, MapLibre 플러그인) | **없음** |
| S3/GCS 파일만으로 서빙 | **가능** | 불가 (서버 필요) |
| 서버 운영 시 표준 XYZ 호환 | 별도 설정 필요 | **기본 제공** |
| Docker 운영 | 가능 | **공식 이미지 제공** (amd64/arm64) |

### VersaTiles 시놀로지 NAS Docker 운영

```yaml
services:
  versatiles:
    image: versatiles/versatiles-frontend:latest
    ports:
      - "8080:8080"
    volumes:
      - /volume1/docker/versatiles/data:/data:ro
    command: osm.versatiles
    restart: unless-stopped
```

- 전세계 OSM `.versatiles` 파일 크기: 약 70~80GB
- 권장 메모리: Block Index 캐싱을 위해 512MB~1GB 여유 필요

---

## 9. 종합 정리

| 항목 | PMTiles | VersaTiles | 우위 |
|------|---------|------------|:---:|
| 압축 후 인덱스 크기 | ~100MB | ~40MB | VersaTiles |
| 콜드 스타트 요청 수 | 2~3회 | 3~4회 | PMTiles |
| 웜 상태 요청 수 | 1회 | 1회 | 동일 |
| 탐색 비교 횟수 | ~26회 | ~10회 | VersaTiles |
| 인덱스 설계 단순성 | 복잡 | 단순 | VersaTiles |
| 서버리스 운영 | ✅ | ❌ | PMTiles |
| 표준 XYZ 호환성 | 추가 필요 | 기본 제공 | VersaTiles |

**한 줄 요약**
- **PMTiles** → 서버 없이 S3/GCS에 파일 하나로 서빙, 첫 연결 최적화
- **VersaTiles** → 서버 기반, 인덱스 단순·작음, 표준 XYZ 엔드포인트 제공

---

## 참고 자료

- [PMTiles v3 Spec](https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md)
- [VersaTiles v02 Spec](https://github.com/versatiles-org/versatiles-spec/blob/main/v02/readme.md)
- [versatiles-rs (GitHub)](https://github.com/versatiles-org/versatiles-rs)
- [node-versatiles-google-cloud](https://github.com/versatiles-org/node-versatiles-google-cloud)
- [Protomaps Docs](https://docs.protomaps.com/pmtiles/)
