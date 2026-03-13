# three-geospatial 대기 효과 분석

> **참조 프로젝트**: [https://github.com/takram-design-engineering/three-geospatial](https://github.com/takram-design-engineering/three-geospatial)
> **분석 일자**: 2026-03-11
> **목적**: shadearth 프로젝트에 대기 효과 적용 가능성 검토

## 1. 개요

three-geospatial의 대기 효과는 **Eric Bruneton의 "Precomputed Atmospheric Scattering"** 논문을 기반으로 구현되어 있다. 핵심 아이디어는 복잡한 대기 산란 적분을 **사전 계산(precompute)**하여 텍스처로 저장하고, 런타임에는 텍스처 샘플링만으로 대기 효과를 렌더링하는 것이다.

### 왜 지구는 일반 구체와 다르게 보이는가?

일반 구체의 Lambert 음영:

```
brightness = max(dot(normal, lightDir), 0)  // cos 곡선으로 부드럽게 감소
```

지구의 경우:

1. **대기 산란**: 태양광이 대기를 통과하면서 사방으로 퍼짐 → 낮 반구 전체가 균일하게 밝음
2. **황혼 지대**: 수평선 근처에서 빛이 대기를 길게 통과 → 짧은 파장(파랑)은 산란되고 긴 파장(빨강)만 남음
3. **급격한 전환**: 대기 두께가 급격히 증가하는 구간이 좁음 → 얇은 붉은 띠 후 급격히 어두워짐

---

## 2. 핵심 물리 모델

### 2.1 Rayleigh 산란 (분자)

- 질소, 산소 같은 작은 분자가 빛을 산란
- **파장의 4제곱에 반비례** → 짧은 파장(파랑)이 더 많이 산란
- 결과: 맑은 하늘이 파란색

```glsl
// Rayleigh 위상 함수
float RayleighPhase(float cosTheta) {
  return 3.0 / (16.0 * PI) * (1.0 + cosTheta * cosTheta);
}
```

### 2.2 Mie 산란 (에어로졸)

- 먼지, 물방울 같은 큰 입자가 빛을 산란
- **파장에 거의 무관** → 모든 색이 비슷하게 산란
- 결과: 태양 주변의 흰색/주황색 후광, 황혼의 붉은색

```glsl
// Mie 위상 함수 (Cornette-Shanks)
float MiePhase(float g, float cosTheta) {
  float k = 3.0 / (8.0 * PI) * (1.0 - g * g) / (2.0 + g * g);
  return k * (1.0 + cosTheta * cosTheta) / pow(1.0 + g * g - 2.0 * g * cosTheta, 1.5);
}
```

### 2.3 흡수 (오존)

- 오존이 특정 파장을 흡수
- 흡수 계수: `(0.00065, 0.001881, 0.000085)` - 초록색 흡수가 가장 강함

---

## 3. 대기 파라미터 (지구 기본값)

```typescript
// 반지름
bottomRadius = 6,360,000 m    // 지구 반지름
topRadius = 6,420,000 m       // 대기 상단 (60km)

// Rayleigh 산란
rayleighScattering = (0.005802, 0.013558, 0.0331)  // RGB별 산란 계수
rayleighDensity = exp(-altitude / 8000m)          // 고도에 따른 밀도 감소

// Mie 산란
mieScattering = (0.003996, 0.003996, 0.003996)    // 파장 무관
miePhaseFunctionG = 0.8                            // 전방 산란 선호도
mieDensity = exp(-altitude / 1200m)               // Rayleigh보다 빠르게 감소

// 태양
solarIrradiance = (1.474, 1.8504, 1.91198)        // W/m²/nm
sunAngularRadius = 0.004675 rad                    // ~0.27°
```

---

## 4. 사전 계산 텍스처

Bruneton 방식의 핵심은 4차원 적분을 미리 계산하여 텍스처로 저장하는 것이다.

### 4.1 Transmittance (투과율) - 2D 텍스처 (256×64)

- **역할**: 대기를 통과하는 빛이 얼마나 감쇠되는지
- **입력**: (r, μ) = (고도, 각도)
- **용도**: 태양이 수평선 근처일 때 빛이 얼마나 통과하는지

### 4.2 Scattering (산란) - 3D 텍스처 (256×128×32)

- **역할**: 특정 위치에서 특정 방향을 볼 때의 산란 광
- **입력**: (r, μ, μs, ν) = (고도, 뷰 각도, 태양 각도, 상대 각도)
- **용도**: 하늘 색상 계산

### 4.3 Irradiance (복사 조도) - 2D 텍스처 (64×16)

- **역할**: 지표면에 도달하는 확산 광
- **입력**: (r, μs) = (고도, 태양 각도)
- **용도**: 환경 조명 (IBL)

### 메모리 사용량


| 텍스처           | 크기         | 메모리      |
| ------------- | ---------- | -------- |
| Transmittance | 256×64     | ~256KB   |
| Scattering 3D | 256×128×32 | ~4MB     |
| Irradiance    | 64×16      | ~40KB    |
| **합계**        | -          | **~5MB** |


---

## 4.5 사전 계산 텍스처 파일 (복사 가능)

three-geospatial는 **MIT 라이센스**로 사전 계산된 텍스처 파일을 제공한다. 직접 생성할 필요 없이 복사해서 사용 가능.

```
ref/three-geospatial-main/packages/atmosphere/assets/
├── transmittance.bin / .exr        # 투과율 (256×64)
├── scattering.bin / .exr           # 산란 3D (256×128×32)
├── irradiance.bin / .exr           # 복사 조도 (64×16)
├── single_mie_scattering.bin / .exr # Mie 산란
├── higher_order_scattering.bin / .exr # 다중 산란
└── stars.bin                       # 별 데이터
```

**파일 포맷**:

- `.bin`: 바이너리 (Half-float 16비트), 로더용
- `.exr`: OpenEXR HDR 이미지, 디버깅/확인용

**로딩 방법** (PrecomputedTexturesLoader.ts):

```typescript
import { PrecomputedTexturesLoader } from '@takram/three-atmosphere'

const loader = new PrecomputedTexturesLoader({
  format: 'binary',  // 'binary' or 'exr'
  type: HalfFloatType,
  combinedScattering: true,
  higherOrderScattering: true
})

const textures = await loader.loadAsync('/assets/atmosphere/')
// textures.transmittanceTexture  - DataTexture (2D)
// textures.scatteringTexture     - Data3DTexture (3D)
// textures.irradianceTexture     - DataTexture (2D)
```

---

## 5. 렌더링 파이프라인

### 5.1 Sky 렌더링 (배경 하늘)

```glsl
vec3 getSkyRadiance(
  vec3 cameraPosition,    // ECEF 좌표
  vec3 rayDirection,      // 뷰 방향
  vec3 sunDirection       // 태양 방향
) {
  // 1. 텍스처 좌표 계산
  float r = length(cameraPosition);
  float mu = dot(normalize(cameraPosition), rayDirection);
  float mu_s = dot(normalize(cameraPosition), sunDirection);
  float nu = dot(rayDirection, sunDirection);

  // 2. 산란 텍스처 샘플링
  vec3 scattering = texture(scatteringTexture, uvw).rgb;

  // 3. 태양 원판 추가 (안티앨리어싱 포함)
  if (nu > cos(sunAngularRadius)) {
    radiance += transmittance * solarRadiance;
  }

  return radiance;
}
```

### 5.2 Aerial Perspective (대기 원근감) - 포스트프로세싱

멀리 있는 물체일수록 대기 효과가 강해지는 현상.

```glsl
// 입력: 씬 렌더링 결과, 깊이 버퍼
// 출력: 대기 효과가 적용된 최종 이미지

vec4 aerialPerspective(vec3 worldPos, vec3 cameraPos) {
  vec3 rayDir = normalize(worldPos - cameraPos);
  float distance = length(worldPos - cameraPos);

  // 투과율: 원거리 물체가 흐릿해지는 정도
  vec3 transmittance = sampleTransmittance(cameraPos, rayDir, distance);

  // Inscatter: 시선 경로에서 추가되는 산란 광
  vec3 inscatter = sampleScattering(cameraPos, rayDir, distance, sunDir);

  // 최종 색상
  return vec4(originalColor * transmittance + inscatter, 1.0);
}
```

---

## 6. shadearth 적용 가능성 분석

### 6.1 현재 프로젝트 상황

- Three.js + 3d-tiles-renderer 사용
- 커스텀 GLSL 셰이더 (hillshade, shadow)
- 타일 기반 렌더링

### 6.2 적용 가능한 효과들

#### 옵션 1: 간단한 대기 효과 (권장 - 1단계)

- **Rim Lighting + 황혼 색상 그라데이션**
- 구현 복잡도: 낮음
- 성능 영향: 거의 없음
- 효과: 지구본 가장자리의 대기 느낌

```glsl
// 간단한 대기 효과
float rimLight = 1.0 - max(dot(normal, viewDir), 0.0);
rimLight = pow(rimLight, 3.0);

// 황혼 색상 (태양 각도에 따라)
float sunAngle = dot(normal, sunDir);
vec3 twilightColor = mix(vec3(1.0, 0.3, 0.1), vec3(0.5, 0.7, 1.0),
                         smoothstep(-0.1, 0.3, sunAngle));

color += rimLight * twilightColor * atmosphereStrength;
```

#### 옵션 2: Transmittance 기반 조명 (2단계)

- **사전 계산 텍스처 없이 근사**
- 구현 복잡도: 중간
- 효과: 태양 색상이 수평선 근처에서 붉어짐

```glsl
// 태양광이 대기를 통과하는 거리에 따른 색상
float opticalDepth = 1.0 / max(dot(normal, sunDir), 0.01);
vec3 sunColor = exp(-rayleighCoeff * opticalDepth);
```

#### 옵션 3: 전체 Bruneton 시스템 (3단계)

- **three-geospatial 통합 또는 포팅**
- 구현 복잡도: 높음 (사전 계산 파이프라인 필요)
- 효과: 완전한 물리 기반 대기

### 6.3 권장 접근 방식

**1단계: 간단한 대기 효과**

1. Rim lighting으로 대기 두께 표현
2. 태양 각도에 따른 색상 변화 (황혼 효과)
3. 밤 반구에서 급격한 어두워짐

**2단계: 조명 개선**

1. 태양 색상의 대기 감쇠
2. 환경광 (하늘에서 오는 확산광)

**3단계 (선택): 전체 통합**

1. 사전 계산 텍스처 생성/로드
2. Aerial Perspective 포스트프로세싱

---

## 7. 주요 파일 경로

```
ref/three-geospatial-main/packages/atmosphere/
├── src/
│   ├── AtmosphereParameters.ts      # 대기 물리 파라미터
│   ├── SkyMaterial.ts               # 하늘 렌더링
│   ├── AerialPerspectiveEffect.ts   # 포스트프로세싱
│   ├── SunDirectionalLight.ts       # 태양 조명
│   ├── celestialDirections.ts       # 천체 방향 계산
│   └── shaders/
│       ├── bruneton/
│       │   ├── definitions.glsl     # 타입 정의
│       │   ├── common.glsl          # 공용 함수
│       │   └── runtime.glsl         # 런타임 산란 계산
│       ├── sky.glsl                 # 하늘 셰이더
│       └── aerialPerspectiveEffect.frag
└── constants.ts                     # 텍스처 크기 등
```

---

## 8. 핵심 참고 코드

### 8.1 Transmittance 계산 (런타임용 간소화)

```glsl
// 대기를 통과하는 빛의 감쇠
vec3 getTransmittance(float altitude, float cosAngle) {
  float H_R = 8000.0;  // Rayleigh scale height
  float H_M = 1200.0;  // Mie scale height

  // 광학 경로 길이
  float pathLength = 1.0 / max(cosAngle, 0.001);

  // 밀도
  float densityR = exp(-altitude / H_R);
  float densityM = exp(-altitude / H_M);

  // 소광 계수
  vec3 extinctionR = vec3(0.005802, 0.013558, 0.0331) * densityR;
  vec3 extinctionM = vec3(0.00444) * densityM;

  return exp(-(extinctionR + extinctionM) * pathLength);
}
```

### 8.2 황혼 효과 계산

```glsl
// 태양 고도에 따른 하늘 색상
vec3 getTwilightColor(float sunElevation) {
  // sunElevation: -90° ~ +90°

  if (sunElevation > 10.0) {
    // 낮: 파란 하늘
    return vec3(0.5, 0.7, 1.0);
  } else if (sunElevation > -6.0) {
    // 황혼 (civil twilight)
    float t = (sunElevation + 6.0) / 16.0;
    return mix(vec3(1.0, 0.4, 0.1), vec3(0.5, 0.7, 1.0), t);
  } else {
    // 밤
    return vec3(0.02, 0.02, 0.05);
  }
}
```

---

## 9. 결론

three-geospatial의 대기 효과는 완전한 물리 기반 시스템이지만, 우리 프로젝트에는 **단계적 접근**이 적합하다:

1. **즉시 적용 가능**: Rim lighting + 황혼 색상 그라데이션
2. **중기 목표**: Transmittance 기반 태양 색상 변화
3. **장기 목표**: 필요시 전체 Bruneton 시스템 통합

핵심은 **지구가 일반 구체와 다르게 보이는 이유**를 이해하고, 그 효과를 최소한의 복잡도로 구현하는 것이다.