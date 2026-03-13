/**
 * Ambient Occlusion Accumulate Shader (wwwtyro 방식)
 *
 * 하늘 방향으로 ray march해서 하늘이 보이는지 확인
 * 128회 반복하면서 누적 → 면이 얼마나 "열려있는지" (하늘 노출도) 계산
 */

precision highp float;

// 중앙 타일
uniform sampler2D demMap;

// 인접 8개 타일
uniform sampler2D demMapN;
uniform sampler2D demMapNE;
uniform sampler2D demMapE;
uniform sampler2D demMapSE;
uniform sampler2D demMapS;
uniform sampler2D demMapSW;
uniform sampler2D demMapW;
uniform sampler2D demMapNW;

// 인접 타일 존재 여부
uniform float uHasN;
uniform float uHasNE;
uniform float uHasE;
uniform float uHasSE;
uniform float uHasS;
uniform float uHasSW;
uniform float uHasW;
uniform float uHasNW;

// 누적 관련
uniform sampler2D uPrevAO;     // 이전 프레임 누적 결과
uniform float uWeight;         // 1/totalFrames

// 랜덤 방향 (매 프레임 jittered)
uniform vec3 uRandomDirection;

// 타일 정보
uniform float uZoomLevel;
uniform float uMetersPerTexel;
uniform float uElevationScale;
uniform float uTileX;
uniform float uTileY;
uniform float uAoRangeScale;
uniform vec2 uDemUvScale;
uniform vec2 uDemUvOffset;


varying vec2 vUv;

// DEM UV 변환 (z > 12일 때 상위 타일의 해당 부분만 샘플링)
vec2 transformDemUv(vec2 uv) {
  return uv * uDemUvScale + uDemUvOffset;
}

// Terrarium 디코딩
float decodeTerrarium(vec4 color) {
  return (color.r * 255.0 * 256.0 + color.g * 255.0 + color.b * 255.0 / 256.0) - 32768.0;
}

// DEM UV에서 직접 고도 샘플링
float sampleElevationDirect(vec2 demUv) {
  return decodeTerrarium(texture2D(demMap, clamp(demUv, 0.0, 1.0)));
}

// 노멀 계산 (DEM UV 공간에서)
vec3 calculateNormal(vec2 demUv) {
  float texelSize = 1.0 / 512.0;
  float hL = sampleElevationDirect(demUv - vec2(texelSize, 0.0));
  float hR = sampleElevationDirect(demUv + vec2(texelSize, 0.0));
  float hD = sampleElevationDirect(demUv - vec2(0.0, texelSize));
  float hU = sampleElevationDirect(demUv + vec2(0.0, texelSize));
  float invTwoTexelsMeters = 1.0 / (2.0 * max(0.01, uMetersPerTexel));
  float dzdx = (hR - hL) * invTwoTexelsMeters * uElevationScale;
  float dzdy = (hU - hD) * invTwoTexelsMeters * uElevationScale;
  return normalize(vec3(-dzdx, -dzdy, 1.0));
}

// AO ray 추적 - DEM UV 공간에서 수행
float traceAO(vec2 startDemUV, float startElevation, vec3 localNormal) {
  vec3 rayDir3D = normalize(localNormal + uRandomDirection);

  if (rayDir3D.z < 0.01) return 0.0;

  float aoScale = uElevationScale;
  float metersPerTexel = max(0.01, uMetersPerTexel);
  float texelScale = uAoRangeScale;

  float baseStep = 1.0 / 512.0 * texelScale;

  // DEM UV 공간에서 시작
  vec3 rayPos = vec3(startDemUV, startElevation * aoScale / metersPerTexel);

  vec3 rayStepXYZ = rayDir3D * baseStep;
  float rayStepZ = rayDir3D.z * baseStep * 30.0;

  for (int i = 0; i < 512; i++) {
    rayPos += rayStepXYZ;
    rayPos.z += rayStepZ;

    // DEM UV 범위 체크 (0~1)
    if (rayPos.x < 0.0 || rayPos.x > 1.0 || rayPos.y < 0.0 || rayPos.y > 1.0) {
      return 1.0;
    }

    float terrain = sampleElevationDirect(rayPos.xy) * aoScale / metersPerTexel;

    if (rayPos.z < terrain) {
      return 0.0;
    }
  }

  return 1.0;
}

void main() {
  vec2 demUv = transformDemUv(vUv);
  float elevation = sampleElevationDirect(demUv);
  vec3 localNormal = calculateNormal(demUv);

  float ao = traceAO(demUv, elevation, localNormal);

  // ao가 0에 가까울수록(깊은 곳) 진하게, 1에 가까울수록(얕은 곳) 거의 흰색
  //ao = pow(ao, 10.0); 

  // 이전 누적값 읽기
  float prevAO = texture2D(uPrevAO, vUv).r;

  // 누적
  float newAO = clamp(prevAO + ao * uWeight, 0.0, 1.0);

  gl_FragColor = vec4(vec3(newAO), 1.0);
}
