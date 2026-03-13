# Rendering Pipeline 정리

## 개요

현재 렌더링은 3단계로 구성:

1. **Shadow 누적** (shadow-accumulate.frag.glsl) - 128프레임
2. **AO 누적** (ao-accumulate.frag.glsl) - 128프레임
3. **최종 합성** (hillshade-shadow.frag.glsl)

---

## 1. Shadow 누적 (shadow-accumulate.frag.glsl)

### 입력

- `uSunDirection`: jittered 태양 방향 (매 프레임 약간씩 다름)
- `uPrevShadow`: 이전 프레임 누적 결과
- `uWeight`: 1/128

### 처리

```glsl
// 1. 픽셀의 구면 위치 계산 (WebMercator 역변환)
vec3 pixelPos = ... // lat/lon → 3D 좌표

// 2. 로컬 좌표계 구축
buildSurfaceFrame(pixelPos, east, north);
localSunDir = (dot(sun, east), dot(sun, north), dot(sun, up));

// 3. shadow ray 추적
shadow = traceShadow(uv, elevation);  // 0 또는 1

// 4. diffuse 계산
localNormal = calculateNormal(uv);
diffuse = clamp(dot(localNormal, localLightDir), 0, 1);

// 5. 누적 (wwwtyro 방식)
newShadow = prevShadow + shadow * diffuse * uWeight;
```

### 출력

- `shadow * diffuse`를 누적한 값 (0~1)
- **주의**: wwwtyro는 shadow(0/1)에 diffuse를 곱해서 누적

---

## 2. AO 누적 (ao-accumulate.frag.glsl)

### 입력

- `uRandomDirection`: 랜덤 반구 방향 (매 프레임 다름)
- `uPrevAO`: 이전 프레임 누적 결과
- `uWeight`: 1/128

### 처리

```glsl
// 1. ray 방향 = 표면 법선 + 랜덤 방향
rayDir3D = normalize(localNormal + uRandomDirection);

// 2. 고도 스케일링 (wwwtyro 기본 4.0 × GUI 배율)
aoScale = 4.0 * uElevationScale;

// 3. ray march
for (i = 0; i < 512; i++) {
  terrain = sampleElevation(pos) * aoScale;
  height = startElevation * aoScale + heightPerStep * i;
  if (terrain > height) return 0.0;  // 막힘
}
return 1.0;  // 하늘 보임

// 4. 누적
newAO = prevAO + ao * uWeight;
```

### 출력

- 하늘 노출도 (0~1)
- 1.0 = 완전히 열림, 0.0 = 완전히 막힘

---

## 3. 최종 합성 (hillshade-shadow.frag.glsl)

### 위성 이미지 모드 (uUseSatellite > 0.5)

```glsl
// 해수면 처리
shadowVal = elevation <= 0 ? 1.0 : shadow;
aoVal = elevation <= 0 ? 1.0 : ao;

// wwwtyro 덧셈 합성
l = uAoShadowWeight * shadowVal + uAoDiffuseWeight * aoVal;
// 기본값: shadowWeight=4.0, aoWeight=0.25

// 구면 조명
sphereLight = 0.7 + 0.3 * max(0, sunElevation);
l *= sphereLight;

// 감마 보정 (wwwtyro 원본)
dayColor = l * pow(satellite, 2.0);    // sRGB → linear
dayColor = pow(dayColor, 1.0/gamma);   // linear → sRGB

// 낮/밤 블렌딩
finalColor = mix(nightColor, dayColor, dayFactor);
```

### DEM 색상 모드 (uUseSatellite < 0.5)

```glsl
// Slope 기반 (uShadingMode < 0.5)
lit = ambient + (1-ambient) * pow(diffuse, 0.85);
slopeShade = mix(1.0, 0.6, slopeAmount);
shadowShade = mix(0.2, 1.0, shadow);
dayColor = baseColor * lit * slopeShade * shadowShade;

// AO 기반 (uShadingMode >= 0.5)
lighting = shadowWeight * shadow + aoWeight * ao;
dayColor = baseColor * lighting;
```

---

## wwwtyro 원본과의 비교

### wwwtyro 원본 (satellite-terrain-demo.js)

```javascript
// Shadow 누적 (128회)
for (i = 0; i < 128; i++) {
  sunDirection = normalize(baseSun * 149600000000 + random() * 695508000 * 100);
  // ray march → 하늘 보이면 src + (1/128) * diffuse
}

// AO 누적 (128회)
for (i = 0; i < 128; i++) {
  direction = vec3.random([], Math.random());
  // sr3d = normalize(normal + direction)
  // ray march → 하늘 보이면 src + (1/128)
}

// 최종 합성
l = 4.0 * softShadow + 0.25 * ambient;
color = l * pow(satellite, 2.0);
color = pow(color, 1.0/2.2);
```

### 현재 구현의 차이점


| 항목         | wwwtyro 원본    | 현재 구현                  |
| ---------- | ------------- | ---------------------- |
| 좌표계        | 2D 평면         | 3D 구면 (픽셀별 로컬 프레임)     |
| Shadow ray | pixelScale 고정 | metersPerTexel (줌/위도별) |
| AO 스케일     | 4.0 고정        | 4.0 × uElevationScale  |
| 해수면        | 없음            | shadow=1, ao=1 처리      |
| 낮/밤        | 없음            | dayFactor로 블렌딩         |
| 구면 조명      | 없음            | sphereLight 적용         |


---

## 문제점 및 의문사항

### 1. Shadow 누적에서 diffuse를 곱하는 이유?

wwwtyro 원본에서 shadow 누적 시 `shadow * diffuse`를 누적함.

- shadow=1 (햇빛 도달) 이면 diffuse 값을 더함
- shadow=0 (그림자) 이면 0을 더함

**결과**: shadow map에는 "햇빛이 얼마나 도달하고, 그 면이 태양을 얼마나 바라보는지"가 합쳐져 있음.

### 2. AO에서 diffuse를 곱하지 않는 이유?

AO는 방향과 무관한 환경광 차폐이므로 diffuse 불필요.

### 3. 최종 합성 공식

```
l = 4.0 * shadow + 0.25 * ao
```

- shadow: 0~1 (diffuse 포함)
- ao: 0~1
- l 범위: 0 ~ 4.25

이 값을 위성 이미지에 곱하면 밝기가 4배까지 증폭될 수 있음.

### 4. 감마 보정

```
color = l * pow(satellite, 2.0);  // sRGB → linear
color = pow(color, 1/2.2);        // linear → sRGB
```

- `pow(x, 2.0)`: 대략적인 sRGB → linear 변환
- `pow(x, 1/2.2)`: linear → sRGB 변환

---

## GUI 파라미터


| 파라미터             | 기본값  | 용도                    |
| ---------------- | ---- | --------------------- |
| uAoShadowWeight  | 4.0  | shadow 가중치            |
| uAoDiffuseWeight | 0.25 | AO 가중치                |
| uGamma           | 2.2  | 감마 보정                 |
| uElevationScale  | 1.0  | 지형 과장 (shadow/AO에 영향) |
| uBrightness      | 1.0  | (비활성화됨)               |
| uShadowContrast  | 1.0  | (비활성화됨)               |


