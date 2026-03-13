/**
 * Shadow Accumulate Shader
 * 프레임별 1샘플 계산 후 누적
 * 인접 타일 텍스처를 사용하여 경계 처리
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
uniform sampler2D uPrevShadow;  // 이전 프레임 누적 결과
uniform float uWeight;          // 1/totalFrames

// 태양 방향 (이미 jittered)
uniform vec3 uSunDirection;

// 타일 위치 (로컬 좌표계 변환용)
uniform vec3 uTileCenter;    // 타일 중심의 월드 좌표 (정규화된 구 표면)
uniform vec3 uTileEast;      // 동쪽 방향
uniform vec3 uTileNorth;     // 북쪽 방향
uniform float uZoomLevel;    // 줌 레벨
uniform float uMetersPerTexel;
uniform float uElevationScale;
uniform float uTileX;
uniform float uTileY;
uniform vec2 uDemUvScale;
uniform vec2 uDemUvOffset;

varying vec2 vUv;

// Terrarium 디코딩
float decodeTerrarium(vec4 color) {
  return (color.r * 255.0 * 256.0 + color.g * 255.0 + color.b * 255.0 / 256.0) - 32768.0;
}

// DEM UV 변환 (z > 12일 때 상위 타일의 해당 부분만 샘플링)
vec2 transformDemUv(vec2 uv) {
  return uv * uDemUvScale + uDemUvOffset;
}

// DEM UV에서 직접 고도 샘플링 (UV 변환 없음)
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

void buildSurfaceFrame(vec3 surfaceNormal, out vec3 east, out vec3 north) {
  vec3 worldNorth = vec3(0.0, 1.0, 0.0);
  north = worldNorth - surfaceNormal * dot(worldNorth, surfaceNormal);
  float northLen2 = dot(north, north);
  if (northLen2 < 1e-8) {
    north = normalize(uTileNorth);
    east = normalize(cross(north, surfaceNormal));
    return;
  }
  north = normalize(north);
  east = normalize(cross(north, surfaceNormal));
}

// Shadow ray 추적 - DEM UV 공간에서 수행
float traceShadow(vec2 startUV, float startElevation) {
  // 타일 x/y/z와 UV로 픽셀의 구면 위치를 정확히 복원 (WebMercator 역변환)
  float n = pow(2.0, uZoomLevel);
  float tileXF = uTileX + startUV.x;
  float tileYF = uTileY + (1.0 - startUV.y);
  float lon = (tileXF / n) * (2.0 * 3.141592653589793) - 3.141592653589793;
  float mercY = 3.141592653589793 * (1.0 - (2.0 * tileYF / n));
  float lat = atan(sinh(mercY));
  vec3 pixelPos = normalize(vec3(
    cos(lat) * cos(lon),
    sin(lat),
    -cos(lat) * sin(lon)
  ));
  vec3 east;
  vec3 north;
  buildSurfaceFrame(pixelPos, east, north);
  vec3 up = pixelPos;

  vec3 localSunDir = vec3(
    dot(uSunDirection, east),
    dot(uSunDirection, north),
    dot(uSunDirection, up)
  );

  if (localSunDir.z < 0.01) return 1.0;

  vec2 sunDir2D = vec2(localSunDir.x, localSunDir.y);
  float sunAltitude = localSunDir.z;

  float horizLen = length(sunDir2D);
  if (horizLen < 0.001) return 1.0;

  vec2 rayDir = normalize(sunDir2D);

  float metersPerTexel = max(0.01, uMetersPerTexel);
  float texelSize = 1.0 / 512.0;
  float targetMetersPerStep = 120.0;
  float stepTexels = clamp(targetMetersPerStep / metersPerTexel, 0.05, 1.0);
  float horizontalMetersPerStep = metersPerTexel * stepTexels;
  float stepSize = stepTexels * texelSize;
  float heightPerStep = horizontalMetersPerStep * (sunAltitude / horizLen) / uElevationScale;

  // DEM UV 공간에서 시작 (타일 UV → DEM UV 변환)
  vec2 pos = transformDemUv(startUV);
  // ray 방향도 DEM UV 스케일 적용
  vec2 demRayDir = rayDir * uDemUvScale;
  float demStepSize = stepSize;

  float height = startElevation;
  float traveledMeters = 0.0;

  for (int i = 0; i < 1024; i++) {
    pos += demRayDir * demStepSize;
    height += heightPerStep;
    traveledMeters += horizontalMetersPerStep;

    if (traveledMeters > 120000.0) {
      return 1.0;
    }

    bool outOfBounds;
    float terrain = sampleElevationWithNeighbors(pos, outOfBounds);
    if (outOfBounds) {
      return 1.0;
    }
    if (terrain > height) {
      return 0.0;
    }
  }

  return 1.0;
}

// 노멀 계산 (DEM UV 공간에서)
vec3 calculateNormal(vec2 demUv) {
  float texelSize = 1.0 / 512.0;
  float hL = sampleElevationDirect(demUv - vec2(texelSize, 0.0));
  float hR = sampleElevationDirect(demUv + vec2(texelSize, 0.0));
  float hD = sampleElevationDirect(demUv - vec2(0.0, texelSize));
  float hU = sampleElevationDirect(demUv + vec2(0.0, texelSize));
  float metersPerTexel = max(0.01, uMetersPerTexel);
  float invTwoTexelsMeters = 1.0 / (2.0 * metersPerTexel);
  float dzdx = (hR - hL) * invTwoTexelsMeters * uElevationScale;
  float dzdy = (hU - hD) * invTwoTexelsMeters * uElevationScale;
  return normalize(vec3(-dzdx, -dzdy, 1.0));
}

void main() {
  vec2 demUv = transformDemUv(vUv);
  float elevation = sampleElevationDirect(demUv);
  float shadow = traceShadow(vUv, elevation);

  // 타일 위치에서 로컬 태양 방향 계산 (traceShadow와 동일한 방식)
  float n = pow(2.0, uZoomLevel);
  float tileXF = uTileX + vUv.x;
  float tileYF = uTileY + (1.0 - vUv.y);
  float lon = (tileXF / n) * (2.0 * 3.141592653589793) - 3.141592653589793;
  float mercY = 3.141592653589793 * (1.0 - (2.0 * tileYF / n));
  float lat = atan(sinh(mercY));
  vec3 pixelPos = normalize(vec3(
    cos(lat) * cos(lon),
    sin(lat),
    -cos(lat) * sin(lon)
  ));
  vec3 east;
  vec3 north;
  buildSurfaceFrame(pixelPos, east, north);
  vec3 up = pixelPos;
  vec3 localSunDir = vec3(
    dot(uSunDirection, east),
    dot(uSunDirection, north),
    dot(uSunDirection, up)
  );
  vec3 localLightDir = normalize(vec3(localSunDir.xy, max(0.05, localSunDir.z)));

  // wwwtyro 원본: diffuse = clamp(dot(normal, sunDirection), 0, 1)
  vec3 localNormal = calculateNormal(demUv);
  float diffuse = clamp(dot(localNormal, localLightDir), 0.0, 1.0);

  // 이전 누적값 읽기
  float prevShadow = texture2D(uPrevShadow, vUv).r;

  // wwwtyro 방식 누적: shadow가 1이면 diffuse를 더함, 0이면 안 더함
  float newShadow = clamp(prevShadow + shadow * diffuse * uWeight, 0.0, 1.0);

  gl_FragColor = vec4(vec3(newShadow), 1.0);
}
