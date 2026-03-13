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

// 인접 타일을 포함한 고도 샘플링
// demUv: 0~1 범위를 벗어날 수 있음
// 반환: 고도 값, outOfBounds=true면 2타일 이상 벗어남
float sampleElevationWithNeighbors(vec2 demUv, out bool outOfBounds) {
  outOfBounds = false;
  vec2 localUv = demUv;
  int tileOffsetX = 0;
  int tileOffsetY = 0;

  // X축 경계 처리
  if (demUv.x < 0.0) {
    tileOffsetX = -1;  // West
    localUv.x = demUv.x + 1.0;
  } else if (demUv.x > 1.0) {
    tileOffsetX = 1;   // East
    localUv.x = demUv.x - 1.0;
  }

  // Y축 경계 처리 (UV y > 1.0 = North, y < 0.0 = South)
  if (demUv.y < 0.0) {
    tileOffsetY = -1;  // South
    localUv.y = demUv.y + 1.0;
  } else if (demUv.y > 1.0) {
    tileOffsetY = 1;   // North
    localUv.y = demUv.y - 1.0;
  }

  // 2타일 이상 벗어남 (1회 보정 후에도 범위 밖)
  if (localUv.x < 0.0 || localUv.x > 1.0 || localUv.y < 0.0 || localUv.y > 1.0) {
    outOfBounds = true;
    return 0.0;
  }

  vec2 clampedUv = clamp(localUv, 0.001, 0.999);

  // 중앙 타일
  if (tileOffsetX == 0 && tileOffsetY == 0) {
    return decodeTerrarium(texture2D(demMap, clampedUv));
  }

  // 8방향 인접 타일 (존재 여부 체크 포함)
  // N (UV y > 1.0)
  if (tileOffsetX == 0 && tileOffsetY == 1) {
    if (uHasN < 0.5) { outOfBounds = true; return 0.0; }
    return decodeTerrarium(texture2D(demMapN, clampedUv));
  }
  // S (UV y < 0.0)
  if (tileOffsetX == 0 && tileOffsetY == -1) {
    if (uHasS < 0.5) { outOfBounds = true; return 0.0; }
    return decodeTerrarium(texture2D(demMapS, clampedUv));
  }
  // E (UV x > 1.0)
  if (tileOffsetX == 1 && tileOffsetY == 0) {
    if (uHasE < 0.5) { outOfBounds = true; return 0.0; }
    return decodeTerrarium(texture2D(demMapE, clampedUv));
  }
  // W (UV x < 0.0)
  if (tileOffsetX == -1 && tileOffsetY == 0) {
    if (uHasW < 0.5) { outOfBounds = true; return 0.0; }
    return decodeTerrarium(texture2D(demMapW, clampedUv));
  }
  // NE
  if (tileOffsetX == 1 && tileOffsetY == 1) {
    if (uHasNE < 0.5) { outOfBounds = true; return 0.0; }
    return decodeTerrarium(texture2D(demMapNE, clampedUv));
  }
  // SE
  if (tileOffsetX == 1 && tileOffsetY == -1) {
    if (uHasSE < 0.5) { outOfBounds = true; return 0.0; }
    return decodeTerrarium(texture2D(demMapSE, clampedUv));
  }
  // SW
  if (tileOffsetX == -1 && tileOffsetY == -1) {
    if (uHasSW < 0.5) { outOfBounds = true; return 0.0; }
    return decodeTerrarium(texture2D(demMapSW, clampedUv));
  }
  // NW
  if (tileOffsetX == -1 && tileOffsetY == 1) {
    if (uHasNW < 0.5) { outOfBounds = true; return 0.0; }
    return decodeTerrarium(texture2D(demMapNW, clampedUv));
  }

  outOfBounds = true;
  return 0.0;
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

    bool outOfBounds;
    float terrain = sampleElevationWithNeighbors(rayPos.xy, outOfBounds) * aoScale / metersPerTexel;
    if (outOfBounds) {
      return 1.0;
    }

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
