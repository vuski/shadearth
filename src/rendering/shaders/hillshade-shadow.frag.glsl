/**
 * Hillshade + Shadow (인접 타일 지원)
 * 8방향 인접 타일 텍스처를 사용하여 타일 경계를 넘는 그림자 계산
 * v2 - 밝기 조정
 */

precision highp float;

#include "./chunks/elevation-colors.glsl"

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

uniform vec3 uSunDirection;
uniform vec2 uTileSize;
uniform float uElevationScale;
uniform float uZoomLevel;
uniform float uMetersPerTexel;
uniform vec3 uTileCenter;
uniform vec3 uTileEast;
uniform vec3 uTileNorth;

// wwwtyro 방식: 누적된 shadow map (ping-pong 렌더링 결과)
uniform sampler2D uShadowMap;
uniform sampler2D uAOMap;     // AO map (ping-pong 렌더링 결과)
uniform float uUseShadowMap;  // 1.0 = 누적된 shadow map 사용, 0.0 = hard shadow
uniform float uDebugMode;     // 0: off, 1: local sun, 2: local normal, 3: surface normal, 4: shadow, 5: soft-hard diff, 6: elevation
uniform float uShadingMode;   // 0.0 = slope 기반 (기존), 1.0 = AO 기반 (wwwtyro)
uniform float uAoShadowWeight;   // AO 모드: shadow 가중치 (기본 4.0, wwwtyro 원본)
uniform float uAoDiffuseWeight;  // AO 모드: AO 가중치 (기본 0.25, wwwtyro 원본)
uniform float uBrightness;       // 전체 밝기 (기본 1.0)
uniform float uGamma;            // 감마 보정 (기본 1.0)
uniform float uShadowContrast;   // shadow 강도/대비 (비활성화됨)
uniform float uGroupBlendMode;   // 0: Multiply, 1: Overlay, 2: Hard Light
uniform float uShadowBlendMode;  // 0: Hard Light, 1: Multiply, 2: pow 강화
uniform float uShadowPow;        // pow 강화 시 지수 (기본 2.0)

// 위성 이미지 관련
uniform sampler2D uSatelliteMap;
uniform sampler2D uNightMap;     // 야간 조명 텍스처
uniform vec2 uNightUvScale;      // nightmap UV 스케일 (z > 8일 때 < 1.0)
uniform vec2 uNightUvOffset;     // nightmap UV 오프셋
uniform vec2 uDemUvScale;        // DEM UV 스케일 (z > 12일 때 < 1.0)
uniform vec2 uDemUvOffset;       // DEM UV 오프셋
uniform float uUseSatellite;     // 1.0 = 위성 이미지 사용, 0.0 = DEM 색상
uniform float uGreenDesatAmount; // 녹색 탈채도 (0~1, 기본 0.7)
uniform float uWbStrength;       // 화이트밸런스 강도 (기본 0.15)
uniform float uWbTemp;           // 색온도 (-100~100, 기본 -16)
uniform float uWbTint;           // 틴트 (-100~100, 기본 8)

// Hillshade 오버레이
uniform sampler2D uHillshadeMap;
uniform vec2 uHillshadeUvScale;
uniform vec2 uHillshadeUvOffset;
uniform float uUseHillshade;
uniform float uUseAtmosphere;  // 대기 효과 (twilight tint) on/off

varying vec2 vUv;
varying vec3 vWorldPosition;

// Photoshop Overlay 블렌딩
float overlay(float base, float blend) {
  return base < 0.5
    ? 2.0 * base * blend
    : 1.0 - 2.0 * (1.0 - base) * (1.0 - blend);
}

vec3 overlayVec3(vec3 base, float blend) {
  return vec3(
    overlay(base.r, blend),
    overlay(base.g, blend),
    overlay(base.b, blend)
  );
}

// Photoshop Hard Light 블렌딩 (Overlay의 반대: blend 기준으로 판단)
float hardLight(float base, float blend) {
  return blend < 0.5
    ? 2.0 * base * blend
    : 1.0 - 2.0 * (1.0 - base) * (1.0 - blend);
}

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

// 위성 이미지 색보정 (녹색 탈채도 + 화이트밸런스)
vec3 colorCorrectSatellite(vec3 satellite) {
  // 1. 녹색 탈채도 (Hue 기반)
  float luma = dot(satellite, vec3(0.299, 0.587, 0.114));

  // RGB -> Hue 계산
  float maxC = max(max(satellite.r, satellite.g), satellite.b);
  float minC = min(min(satellite.r, satellite.g), satellite.b);
  float delta = maxC - minC;
  float H = 0.0;
  if (delta > 0.0) {
    if (maxC == satellite.r) H = mod((satellite.g - satellite.b) / delta, 6.0);
    else if (maxC == satellite.g) H = (satellite.b - satellite.r) / delta + 2.0;
    else H = (satellite.r - satellite.g) / delta + 4.0;
    H *= 60.0;
    if (H < 0.0) H += 360.0;
  }

  // 녹색 Hue 마스크 (60-170도)
  float greenCenter = 115.0;
  float greenRange = 55.0;
  float hueDist = abs(H - greenCenter);
  if (hueDist > 180.0) hueDist = 360.0 - hueDist;
  float greenMask = 1.0 - smoothstep(greenRange - 20.0, greenRange, hueDist);

  // 녹색 영역만 탈채도
  float desatAmount = greenMask * uGreenDesatAmount;
  satellite = mix(satellite, vec3(luma), desatAmount);

  // 2. 화이트밸런스 (Temp/Tint)
  float temp = uWbTemp / 100.0;
  float tint = uWbTint / 100.0;
  satellite.r += temp * uWbStrength;
  satellite.b -= temp * uWbStrength;
  satellite.g -= tint * uWbStrength * 0.7;
  satellite.r += tint * uWbStrength * 0.35;
  satellite.b += tint * uWbStrength * 0.35;

  return clamp(satellite, 0.0, 1.0);
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

// 타일 경계와 무관하게 연속적인 로컬 프레임 생성
void buildSurfaceFrame(vec3 surfaceNormal, out vec3 east, out vec3 north) {
  vec3 worldNorth = vec3(0.0, 1.0, 0.0);
  north = worldNorth - surfaceNormal * dot(worldNorth, surfaceNormal);
  float northLen2 = dot(north, north);
  if (northLen2 < 1e-8) {
    // 극점 부근 fallback
    north = normalize(uTileNorth);
    east = normalize(cross(north, surfaceNormal));
    return;
  }
  north = normalize(north);
  east = normalize(cross(north, surfaceNormal));
}

// 황혼 색상 틴트 계산 (sunElevation 기반)
vec3 getTwilightTint(float sunElevation) {
  vec3 yellowTint = vec3(1.0, 0.9, 0.6);
  vec3 orangeTint = vec3(1.0, 0.4, 0.1) * 1.3;

  // sunElevation: 0.2 → -0.02 → -0.15 → -0.35
  float tYellow = smoothstep(-0.02, 0.2, sunElevation);      // 노랑 → 흰색
  float tOrange = smoothstep(-0.15, -0.02, sunElevation);    // 주황 → 노랑
  float tFade = smoothstep(-0.35, -0.15, sunElevation);      // 흰색 → 주황

  vec3 color = mix(vec3(1.0), orangeTint, tFade);            // 밤 → 주황
  color = mix(color, yellowTint, tOrange);                    // 주황 → 노랑
  return mix(color, vec3(1.0), tYellow);                      // 노랑 → 낮
}

// Shadow ray - DEM UV 공간에서 수행
float traceShadowRay(vec2 startUV, float startElevation, vec3 localSunDir) {
  vec2 sunDir2D = vec2(localSunDir.x, localSunDir.y);
  float sunAltitude = localSunDir.z;

  if (sunAltitude < 0.01) return 1.0;

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

  // DEM UV 공간에서 시작
  vec2 pos = transformDemUv(startUV);
  vec2 demRayDir = rayDir * uDemUvScale;

  float height = startElevation;
  float traveledMeters = 0.0;

  for (int i = 0; i < 1024; i++) {
    pos += demRayDir * stepSize;
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

void main() {
  vec2 demUv = transformDemUv(vUv);
  float elevation = sampleElevationDirect(demUv);
  vec3 localNormal = calculateNormal(demUv);
  vec3 surfaceNormal = normalize(vWorldPosition);

  float sunElevation = dot(surfaceNormal, uSunDirection);
  // Asymmetric day/night transition
  // Full night at -0.10, full day at 0.05
  // At sunElevation=0 (half sphere), dayFactor ≈ 0.33 (still shows nightmap)
  float dayFactor = smoothstep(-0.50, 0.05, sunElevation);

  // DEBUG: visualize dayFactor as grayscale
  // gl_FragColor = vec4(vec3(dayFactor), 1.0); return;

  // 구면 기본 밝기 및 낮/밤 블렌드
  //////////////////////////////////////////////////////////////////////
  // 이 아래로 임의 수정 금지
 
  // float sphereDiffuse = pow(smoothstep(-0.15, 0.5, sunElevation), 3.0);
  // float dayNightBlend = pow(smoothstep(-0.25, 0.0, sunElevation), 3.0);
  //float sphereDiffuse = pow(smoothstep(-0.515, -0.25, sunElevation), 3.0);
  
  // 여기까지 임의 수정 금지
  //////////////////////////////////////////////////////////////////////
  //gl_FragColor = vec4(vec3(sphereDiffuse), 1.0); return;


  // Twilight factor: peaks at center, fades toward both day and night
  // Center at -0.05 (slightly into shadow), width controls fade distance
  float twilightCenter = -0.05;
  float twilightWidthNight = 0.05;  // fade toward night side
  float twilightWidthDay = 0.10;    // fade toward day side
  float distFromCenter = sunElevation - twilightCenter;
  float twilightFactor = distFromCenter < 0.0
    ? 1.0 - pow(smoothstep(0.0, twilightWidthNight, -distFromCenter),1.0)
    : 1.0 - pow(smoothstep(0.0, twilightWidthDay, distFromCenter),1.0);
  //gl_FragColor = vec4(vec3(twilightFactor), 1.0); return;

  // float NightDarkBlend = pow(smoothstep(twilightCenter - twilightWidthNight * 20.0,
  //                      twilightCenter - twilightWidthNight, sunElevation),
  //                      3.0);
  float dayNightBlend = pow(smoothstep(twilightCenter - twilightWidthNight * 3.0,
                       twilightCenter, sunElevation),
                       3.0);
  float dayDarkBlend = pow(smoothstep(twilightCenter - twilightWidthNight * 5.0, 
                       twilightCenter + twilightWidthDay * 3.5,
                      sunElevation),
                       1.0);
  twilightFactor =dayNightBlend * (1.0 - dayDarkBlend);
  //twilightFactor = max(dayNightBlend, 1.0 - dayDarkBlend);
  //gl_FragColor = vec4(vec3(twilightFactor), 1.0); return;
  // per-pixel 연속 tangent frame 사용 (LocalSun 디버그와 실제 계산 일치)
  vec3 east;
  vec3 north;
  buildSurfaceFrame(surfaceNormal, east, north);
  vec3 up = surfaceNormal;
  vec3 localSunDir = vec3(
    dot(uSunDirection, east),
    dot(uSunDirection, north),
    dot(uSunDirection, up)
  );
  vec3 localLightDir = normalize(vec3(localSunDir.xy, max(0.05, localSunDir.z)));
  float diffuse = max(0.0, dot(localNormal, localLightDir));

  // Shadow 계산
  float shadow = 1.0;
  float hardShadow = 1.0;
  float softShadow = 1.0;
  if (dayFactor > 0.0) {
    hardShadow = traceShadowRay(vUv, elevation, localSunDir);
    softShadow = texture2D(uShadowMap, vUv).r;
    if (uUseShadowMap > 0.5) {
      // wwwtyro 방식: 누적된 shadow map 직접 사용
      // 0에서 시작해서 128프레임 후 최대 1.0까지 점진적 증가
      shadow = softShadow;
    } else {
      // Hard shadow: 직접 계산
      shadow = hardShadow;
          // 황혼 페이드아웃: sunElevation 0~0.1 사이에서 그림자를 1.0으로 페이드
      float shadowFade = pow(smoothstep(0.0, 0.1, sunElevation), 3.0);
      shadow = mix(1.0, shadow, shadowFade);
    }


  }

  // 고도별 색상
  vec3 baseColor = getBaseColorByElevation(elevation);

  // AO 값 읽기 (soft shadow 모드에서만 사용, 아니면 1.0 = 효과 없음)
  float ao = uUseShadowMap > 0.5 ? texture2D(uAOMap, vUv).r : 1.0;

  // Debug views (위성 이미지 분기 전에 체크)
  if (uDebugMode > 0.5 && uDebugMode < 1.5) {
    gl_FragColor = vec4(localSunDir * 0.5 + 0.5, 1.0);
    return;
  }
  if (uDebugMode > 1.5 && uDebugMode < 2.5) {
    vec3 normalDebug = normalize(vec3(localNormal.xy * 8.0, max(0.001, localNormal.z)));
    gl_FragColor = vec4(normalDebug * 0.5 + 0.5, 1.0);
    return;
  }
  if (uDebugMode > 2.5 && uDebugMode < 3.5) {
    gl_FragColor = vec4(surfaceNormal * 0.5 + 0.5, 1.0);
    return;
  }
  if (uDebugMode > 3.5 && uDebugMode < 4.5) {
    gl_FragColor = vec4(vec3(shadow), 1.0);
    return;
  }
  if (uDebugMode > 4.5 && uDebugMode < 5.5) {
    float diff = 0.0;
    if (uUseShadowMap > 0.5) {
      diff = abs(softShadow - hardShadow);
    }
    gl_FragColor = vec4(diff, 0.0, 0.0, 1.0);
    return;
  }
  if (uDebugMode > 5.5 && uDebugMode < 6.5) {
    float normalizedElev = clamp(elevation / 9000.0, 0.0, 1.0);
    gl_FragColor = vec4(vec3(normalizedElev), 1.0);
    return;
  }
  if (uDebugMode > 6.5 && uDebugMode < 7.5) {
    // AO map 시각화
    gl_FragColor = vec4(vec3(ao), 1.0);
    return;
  }

  // 위성 이미지 사용 시
  if (uUseSatellite > 0.5) {
    vec3 satellite = texture2D(uSatelliteMap, vUv).rgb;
    satellite = colorCorrectSatellite(satellite);

    // 야간 조명 텍스처 (도시 불빛) - UV 스케일/오프셋 적용
    vec2 nightUv = vUv * uNightUvScale + uNightUvOffset;
    vec3 nightLights = texture2D(uNightMap, nightUv).rgb;

    vec3 finalColor;

    if (uUseAtmosphere > 0.5) {
      // === Atmosphere ON: 복잡한 황혼 처리 ===
      float shadowVal = shadow;
      float aoVal = ao;

      // Shadow 값 처리 (pow 강화 옵션)
      float processedShadow = shadowVal;
      if (uShadowBlendMode > 1.5) {
        processedShadow = pow(shadowVal, uShadowPow);
      }

      // 1. 흰색 바탕에서 시작
      float layer = 1.0;

      // 2. Shadow 블렌딩 (uShadowBlendMode에 따라)
      float shadowResult;
      if (uShadowBlendMode < 0.5) {
        shadowResult = hardLight(layer, processedShadow);  // Hard Light
      } else {
        shadowResult = layer * processedShadow;            // Multiply (1, 2 모두)
      }
      layer = mix(layer, shadowResult, uAoShadowWeight);

      // 3. AO Multiply (투명도 = uAoDiffuseWeight)
      float aoResult = layer * aoVal;
      layer = mix(layer, aoResult, uAoDiffuseWeight);

      // 4. 그룹을 위성사진에 합성 (uGroupBlendMode에 따라)
      vec3 withAO;
      if (uGroupBlendMode < 0.5) {
        withAO = satellite * layer;                              // Multiply
      } else if (uGroupBlendMode < 1.5) {
        withAO = overlayVec3(satellite, layer);                  // Overlay
      } else {
        withAO = vec3(hardLight(satellite.r, layer),
                      hardLight(satellite.g, layer),
                      hardLight(satellite.b, layer));            // Hard Light
      }

      // 낮 이미지를 dayDarkBlend로 어둡게
      vec3 dayColor = withAO * dayDarkBlend;
      dayColor = pow(dayColor, vec3(1.0 / uGamma)) * uBrightness;

      // 밤 불빛 계산 (복잡한 황혼 처리)
      float darkFactor = pow(1.0 - min(sunElevation + 1.0, 1.0), 1.0);
      float nightVisibility = 1.0 - dayNightBlend;
      vec3 nightGlow = nightLights * vec3(1.0, 0.8, 0.4) * nightVisibility * darkFactor * 2.0;

      finalColor = nightGlow + dayColor;

      // 황혼 색상 틴트 적용
      finalColor *= getTwilightTint(sunElevation);
    } else {
      // === Atmosphere OFF: DEM 모드와 동일한 로직, baseColor 대신 satellite 사용 ===
      vec3 dayColor;
      if (uShadingMode < 0.5) {
        // Slope 기반 셰이딩 (DEM 방식 그대로)
        float ambient = 0.28;
        float lit = ambient + (1.0 - ambient) * pow(diffuse, 0.85);
        float slopeAmount = clamp((1.0 - localNormal.z) * 1.6, 0.0, 1.0);
        float slopeShade = mix(1.0, 0.6, slopeAmount);
        float shadowShade = mix(0.2, 1.0, shadow);
        dayColor = satellite * lit * slopeShade * shadowShade;
      } else {
        // AO 기반 셰이딩 (wwwtyro 방식) + UI 옵션 적용
        // Atmosphere ON과 동일한 순차 곱셈 방식
        float processedShadow = shadow;
        if (uShadowBlendMode > 1.5) {
          processedShadow = pow(shadow, uShadowPow);
        }

        // 1. 흰색 바탕에서 시작
        float layer = 1.0;

        // 2. Shadow 블렌딩 (uShadowBlendMode에 따라)
        float shadowResult;
        if (uShadowBlendMode < 0.5) {
          shadowResult = hardLight(layer, processedShadow);  // Hard Light
        } else {
          shadowResult = layer * processedShadow;            // Multiply (1, 2 모두)
        }
        layer = mix(layer, shadowResult, uAoShadowWeight);

        // 3. AO Multiply (투명도 = uAoDiffuseWeight)
        float aoResult = layer * ao;
        layer = mix(layer, aoResult, uAoDiffuseWeight);

        // 4. 그룹을 위성사진에 합성 (uGroupBlendMode에 따라)
        if (uGroupBlendMode < 0.5) {
          dayColor = satellite * layer;                              // Multiply
        } else if (uGroupBlendMode < 1.5) {
          dayColor = overlayVec3(satellite, layer);                  // Overlay
        } else {
          dayColor = vec3(hardLight(satellite.r, layer),
                          hardLight(satellite.g, layer),
                          hardLight(satellite.b, layer));            // Hard Light
        }
      }

      // Hillshade 오버레이 적용 (DEM과 동일 위치)
      if (uUseHillshade > 0.5) {
        vec2 hillshadeUv = vUv * uHillshadeUvScale + uHillshadeUvOffset;
        float hillshade = texture2D(uHillshadeMap, hillshadeUv).r;
        dayColor *= hillshade;
      }

      // 감마/밝기 적용
      dayColor = pow(dayColor, vec3(1.0 / uGamma)) * uBrightness;

      // 밤: 단순히 어둡게 + nightmap (DEM은 nightmap 없이 0.02 곱하지만, 위성은 nightmap 사용)
      vec3 nightColor = nightLights * vec3(1.0, 0.8, 0.4) * 2.0;

      // Simple day/night blend (DEM과 동일)
      finalColor = mix(nightColor, dayColor, dayNightBlend);

      gl_FragColor = vec4(finalColor, 1.0);
      return;
    }

    // Hillshade 오버레이 적용
    if (uUseHillshade > 0.5) {
      vec2 hillshadeUv = vUv * uHillshadeUvScale + uHillshadeUvOffset;
      float hillshade = texture2D(uHillshadeMap, hillshadeUv).r;
      finalColor *= hillshade;
    }

    gl_FragColor = vec4(finalColor, 1.0);
    return;
  }

  // DEM 기반 셰이딩 (위성 이미지 미사용 시)
  vec3 dayColor;
  if (uShadingMode < 0.5) {
    // Slope 기반 셰이딩 (기존 방식)
    float ambient = 0.28;
    float lit = ambient + (1.0 - ambient) * pow(diffuse, 0.85);
    float slopeAmount = clamp((1.0 - localNormal.z) * 1.6, 0.0, 1.0);
    float slopeShade = mix(1.0, 0.6, slopeAmount);
    float shadowShade = mix(0.2, 1.0, shadow);
    dayColor = baseColor * lit * slopeShade * shadowShade;
  } else {
    // AO 기반 셰이딩 (wwwtyro 방식)
    // uAoShadowWeight * shadow + uAoDiffuseWeight * ao
    float lighting = uAoShadowWeight * shadow + uAoDiffuseWeight * ao;
    dayColor = baseColor * lighting;
  }

  // Hillshade 오버레이 적용 (DEM 모드에서도)
  if (uUseHillshade > 0.5) {
    vec2 hillshadeUv = vUv * uHillshadeUvScale + uHillshadeUvOffset;
    float hillshade = texture2D(uHillshadeMap, hillshadeUv).r;
    dayColor *= hillshade;
  }

  // DEM 모드: nightmap 없이 밤에는 단순히 어둡게
  vec3 nightColor = baseColor * 0.02;

  // Simple day/night blend
  vec3 finalColor = mix(nightColor, dayColor, dayNightBlend);

  // 황혼 색상 틴트 적용 (대기 효과 활성화 시)
  if (uUseAtmosphere > 0.5) {
    finalColor *= getTwilightTint(sunElevation);
  }

  gl_FragColor = vec4(finalColor, 1.0);
}
