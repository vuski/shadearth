# DEM 텍스처 기반 Ray Marching 렌더링 기법 조사

> 조사일: 2026-03-08
> 주제: Shadertoy 스타일 Ray Marching 기법으로 실제 DEM 데이터 렌더링 가능성 및 사례

---

## 1. 배경 및 핵심 질문

Shadertoy에서 사용하는 Ray Marching은 대부분 **SDF(Signed Distance Field)** 기반으로,
각 픽셀의 색상/밝기/그림자를 주변 객체와의 거리 공식으로 계산한다.

```glsl
// 일반 SDF 방식 (순수 연산, 메모리 접근 없음)
float d = sdSphere(p, center, radius);
```

DEM을 사용할 경우 VRAM 텍스처를 읽어야 한다는 우려가 있으나, 실제로는 **충분히 실용적**이다.

---

## 2. GPU 텍스처 읽기 성능 — 왜 느리지 않은가

GPU는 텍스처 읽기에 특화된 **TMU(Texture Mapping Unit)** 가 별도로 존재한다.

```
일반 DRAM 접근:    수백 사이클
텍스처 샘플링:     TMU + L1 텍스처 캐시
                   캐시 히트 시 ~4-8 사이클
                   + 바이리니어 보간 하드웨어 무료 제공
```

### 왜 DEM은 캐시 효율이 특히 좋은가

DEM은 **2D 공간 지역성**이 완벽하다:

```
화면상 인접 픽셀
    → 비슷한 방향으로 레이 마치
    → 비슷한 UV 좌표 접근
    → 텍스처 캐시 히트율 매우 높음
```

무작위 SDF 공식보다 오히려 캐시 효율이 좋다.

---

## 3. Heightfield Ray Marching 알고리즘

SDF와 달리 DEM은 "얼마나 떨어졌는지"를 공식으로 알 수 없으므로 방식이 다르다.

### 3-1. 기본 Linear Search (단순, 느림)

```glsl
float castRay(vec3 ro, vec3 rd) {
    float t = 0.0;
    for (int i = 0; i < 256; i++) {
        vec3 p = ro + rd * t;
        float h = texture(dem, p.xz / worldSize).r * maxHeight;
        if (p.y < h) return t;  // 지형 아래로 내려갔으면 히트
        t += stepSize;          // 고정 스텝 → 비효율
    }
    return -1.0;
}
```

### 3-2. Linear + Binary Search Refinement

```
[1단계] 큰 스텝으로 러프하게 교차 구간 탐색
[2단계] 교차 전/후 구간에서 이분탐색으로 정밀화

스텝 수 감소: 256회 → 64 + 8회 수준
```

### 3-3. Adaptive Step Size

```glsl
// 지형과의 여유 거리에 따라 스텝 크기 조절
float margin = p.y - getHeight(p.xz);
t += max(margin * 0.5, minStep);
```

평지/바다 구간에서 큰 스텝, 지형 근접 시 작은 스텝 → 효율 향상

---

## 4. 최적화 기법

### 4-1. Cone Step Mapping (McGuire, 2005)

SDF의 "안전 거리"에 해당하는 개념을 DEM용으로 사전 계산한다.

```
[사전처리]
각 텍셀에서 반경 r 이내의 최대 높이 차이를 구워둠
→ Cone Map 텍스처 생성 (Mipmap 구조와 유사)

[레이 마칭 시]
현재 위치에서 Cone Map 읽기
→ "최소한 이 거리까지는 안전"을 알 수 있음
→ SDF의 cone stepping과 동일한 효과
→ 가변 스텝으로 반복 횟수 대폭 감소
```

### 4-2. Min-Max Mipmap (Hierarchical Ray Marching)

```
Mip 0: 원본 DEM (최고 해상도)
Mip 1: 2×2 블록의 min/max 높이
Mip 2: 4×4 블록의 min/max 높이
...

레이가 거친 블록 전체를 건너뛸 수 있는지
min/max로 판단 → 고도 변화 없는 평지/바다에서 극적 가속
```

### 4-3. 기법 비교

| 기법 | 스텝 수 감소 | 사전처리 필요 | 구현 난이도 |
|------|:---:|:---:|:---:|
| Linear Search | 기준 (256+) | 없음 | 쉬움 |
| Binary Refinement | ~1/4 | 없음 | 보통 |
| Adaptive Step | ~1/3 | 없음 | 쉬움 |
| Cone Step Mapping | ~1/10 | 필요 (1회) | 어려움 |
| Min-Max Mipmap | ~1/8 | 필요 (1회) | 보통 |

---

## 5. 실제 구현 사례

### 5-1. Shadertoy 사례

| Shader ID | 제목 | 특징 |
|-----------|------|------|
| [WtKSDt](https://www.shadertoy.com/view/WtKSDt) | Heightmap | **아이슬란드 실제 DEM** (Tangram Heightmapper 생성) |
| [WdKGzt](https://www.shadertoy.com/view/WdKGzt) | Raymarching a height map | iChannel 텍스처 기반 |
| [NsySzz](https://www.shadertoy.com/view/NsySzz) | Height Map with RayMarching | iChannel 텍스처 기반 |
| [WdBcDG](https://www.shadertoy.com/view/WdBcDG) | Biquadratic Heightfield | IQ 작성, biquadratic 보간 |
| [7l23Rc](https://www.shadertoy.com/view/7l23Rc) | Heightmap with Layers | 텍스처 레이어드 |

> Shadertoy의 구조적 한계: 텍스처 업로드 최대 1024×1024, 외부 URL 불가
> → 소규모 DEM(섬, 소지역)만 실용적, 전국 단위 타일링은 불가

### 5-2. WebGL 사례 — wwwtyro "Advanced Map Shading" (2019)

가장 완성도 높은 실제 DEM 레이마칭 구현체.

- **링크**: https://wwwtyro.net/2019/03/21/advanced-map-shading.html
- **DEM 소스**: Mapbox Terrain-RGB 타일
- **레이 순회**: Amanatides-Woo 격자 순회 알고리즘

**Terrain-RGB 디코딩:**

```glsl
float elevation = -10000.0 + (
    (rgb.r * 255.0 * 65536.0 +
     rgb.g * 255.0 * 256.0 +
     rgb.b * 255.0) * 0.1
);
```

**노멀 계산:**

```glsl
vec3 dx = vec3(pixelScale, 0.0, px - p0);
vec3 dy = vec3(0.0, pixelScale, py - p0);
vec3 n = normalize(cross(dx, dy));
```

**렌더링 효과:**
- Hillshading
- Soft Shadow (128샘플 Monte Carlo, ping-pong 프레임버퍼 누적)
- Ambient Occlusion

---

## 6. DEM 특화 고려사항

### SDF 방식 vs DEM Heightfield 비교

| 항목 | SDF Ray Marching | DEM Heightfield |
|------|:---:|:---:|
| 연산 방식 | ALU (순수 계산) | TMU (텍스처 샘플링) |
| 교차 보장 | SDF 특성상 보장 | 스텝 너무 크면 지형 뚫림 가능 |
| 해상도 한계 | 없음 (공식 기반) | DEM 해상도에 종속 |
| 오버행/동굴 | 표현 가능 | **불가** (heightfield 구조적 한계) |
| 메모리 접근 | 없음 | TMU 캐시 경유 (~4-8 사이클) |

### 수직 절벽/오버행 문제

Heightfield는 x,z 위치당 y값이 하나뿐이므로 동굴이나 절벽 오버행을 표현할 수 없다.
이는 Ray Marching 방식과 무관한 DEM 자체의 구조적 한계다.

---

## 7. 실용적 구현 시나리오

### Shadertoy에서 DEM 사용하기

```glsl
// iChannel0에 DEM 그레이스케일 하이트맵 업로드 (최대 1024×1024)
float getHeight(vec2 uv) {
    return texture(iChannel0, uv).r * maxHeight;
}

// 레이마칭 루프
float t = tMin;
for (int i = 0; i < MAX_STEPS; i++) {
    vec3 p = ro + rd * t;
    float h = getHeight(p.xz / worldSize);
    float margin = p.y - h;
    if (margin < 0.01) return t;
    t += max(margin * 0.4, 0.1);
}
```

### WebGL + 실제 DEM 타일 사용하기

```javascript
// Mapbox Terrain-RGB 타일 로드
const dem = await fetchDEMTile(z, x, y);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, dem);

// 셰이더에서 디코딩
// elevation = -10000 + ((R*256*256 + G*256 + B) * 0.1)
```

### 환경별 실용성 비교

| 환경 | 실제 DEM 레이마칭 | 비고 |
|------|:---:|------|
| **Shadertoy** | 제한적 | 소형 DEM(섬 수준)만 가능, 텍스처 크기 제한 |
| **WebGL 직접** | ✅ 가능 | Mapbox/SRTM 타일 API 연동 가능 |
| **Three.js** | ✅ 가능 | Custom ShaderMaterial 활용 |
| **deck.gl** | ✅ 가능 | Custom Layer + GLSL 확장 |

---

## 8. 관련 논문 및 자료

| 자료 | 내용 |
|------|------|
| McGuire & McGuire (2005) | *Cone Step Mapping* — Heightfield SDF 근사 |
| GPU Gems 3 | *Terrain Rendering at High Altitudes* |
| Inigo Quilez | [Terrain Marching](https://iquilezles.org/articles/terrainmarching/) — 절차적이지만 기법 동일 |
| wwwtyro (2019) | [Advanced Map Shading](https://wwwtyro.net/2019/03/21/advanced-map-shading.html) — 실제 DEM 적용 |
| pouet.net | [Heightmap/terrain raytracing discussion](https://www.pouet.net/topic.php?which=7236) — 데모씬 커뮤니티 |

---

## 9. 결론

DEM 기반 Ray Marching은 **충분히 실용적**이다.

1. **텍스처 캐시 + TMU** 덕분에 메모리 접근 오버헤드는 우려할 수준이 아님
2. **Cone Map / Min-Max Mipmap** 으로 반복 횟수를 SDF 수준으로 줄일 수 있음
3. Shadertoy 수준 데모는 이미 존재하며, WebGL + DEM 타일 조합으로 실용화 가능
4. 단, Heightfield의 구조적 한계(오버행 불가)는 DEM 자체의 특성으로 회피 불가

> 가장 추천하는 참고 구현: wwwtyro Advanced Map Shading
> Shadertoy 입문: [WtKSDt](https://www.shadertoy.com/view/WtKSDt) (아이슬란드 실제 DEM)
