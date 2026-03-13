# Shadow Ray Marching - Zoom Level Issue

## 문제 요약

줌 인/아웃 시 그림자 길이가 변하는 문제. 줌 인하면 그림자가 짧아지고, 현재 수정 후에는 그림자가 아예 안 보임.

## 현재 상황

### 타일 서버
- URL: `https://tiles.mapterhorn.com/{z}/{x}/{y}.webp`
- 제공 줌 레벨: 5 ~ 12
- 현재 화면에서 로드되는 타일 예시: `z=5, x=9, y=19`

### 핵심 문제
줌 레벨에 따라 타일 하나가 커버하는 실제 영역 크기가 다름:
- z=5: 1타일 = 약 1250km, 1텍셀(1/512) = 약 2446m
- z=10: 1타일 = 약 40km, 1텍셀 = 약 76m
- z=12: 1타일 = 약 10km, 1텍셀 = 약 19m

### Ray Marching 로직
```glsl
// 현재 코드 (hillshade-shadow.frag.glsl, shadow-accumulate.frag.glsl)
float metersPerTexel = 78270.0 / pow(2.0, uZoomLevel);
float targetMetersPerStep = 100.0;
float stepSize = targetMetersPerStep / metersPerTexel / 512.0;
float heightPerStep = targetMetersPerStep * (sunAltitude / horizLen);

for (int i = 0; i < 256; i++) {
  pos += rayDir * stepSize;
  height += heightPerStep;
  // ...
}
```

### 이전 코드 (고정값, z=10 기준)
```glsl
float texelSize = 1.0 / 512.0;
float metersPerTexel = 78.0;  // z=10 기준 고정
float stepSize = texelSize;
float heightPerStep = metersPerTexel * (sunAltitude / horizLen);
```
- 이 코드는 그림자가 보이지만, 줌 인하면 그림자가 짧아짐

## wwwtyro 참고 코드

`ref/map-tile-lighting-demo-master/soft-shadows-demo.js` 참조:

```javascript
// JavaScript에서 pixelScale 계산 (타일 로드 시 1회)
long0 = demo.tile2long(tLong, zoom);
long1 = demo.tile2long(tLong + 1, zoom);
const pixelScale = (6371000 * (long1 - long0) * 2 * Math.PI) / 360 / image.width;
```

```glsl
// GLSL에서 사용
float t = distance(p + 0.5, p0);  // 픽셀 단위 거리
float z = e0.r + t * pixelScale * sunDirection.z;  // 고도 계산
```

wwwtyro는:
1. **픽셀 단위**로 이동 (Amanatides-Woo 알고리즘)
2. `pixelScale`을 uniform으로 전달하여 픽셀 → 미터 변환
3. 줌 레벨별로 `pixelScale`이 다름

## 기대 동작

물리적으로 그림자 길이는 줌 레벨과 무관해야 함:
- 고도 3000m 산, 태양 고도 30도 → 그림자 길이 약 5196m
- 이 값은 z=5든 z=10이든 동일해야 함

## 시도한 것들

1. **고정값 78.0** → 그림자 보임, 하지만 줌 인하면 짧아짐
2. **동적 계산 (78270/2^z)** → hard shadow, soft shadow 모두 그림자 안 보임
3. **targetMetersPerStep 도입** → 여전히 그림자 안 보임

## Uniform 확인

- `uZoomLevel`: 디버그로 확인 완료, 타일 z값(5, 6, 7...)이 제대로 전달됨
- main.ts에서 `material.uniforms.uZoomLevel.value = coords.z;` 설정
- TileShadowRenderer에서도 `uZoomLevel: { value: z }` 설정

## 관련 파일

- `src/rendering/shaders/hillshade-shadow.frag.glsl` - hard shadow용
- `src/rendering/shaders/shadow-accumulate.frag.glsl` - soft shadow(ping-pong)용
- `src/main.ts` - 타일 로드 시 uniform 설정
- `src/rendering/TileShadowRenderer.ts` - soft shadow 렌더러
- `ref/map-tile-lighting-demo-master/soft-shadows-demo.js` - wwwtyro 참고 코드

## WebGL 에러 (별개 이슈)

```
WebGL: INVALID_VALUE: texSubImage2D: The source data has been detached.
GL_INVALID_VALUE: glTexStorage2D: Texture dimensions must all be greater than zero.
```

## 해결 방향 제안

1. wwwtyro처럼 Amanatides-Woo 픽셀 순회 알고리즘 사용
2. 또는 현재 UV 기반 접근 유지하면서 스텝 크기/고도 계산 재검토
3. 디버깅: 각 변수를 색상으로 출력하여 값 확인
