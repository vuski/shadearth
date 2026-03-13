precision highp float;
precision highp sampler3D;

#ifndef PI
#define PI 3.14159265358979323846
#endif

#include "./bruneton/definitions.glsl"

uniform AtmosphereParameters ATMOSPHERE;
uniform vec3 SUN_SPECTRAL_RADIANCE_TO_LUMINANCE;
uniform vec3 SKY_SPECTRAL_RADIANCE_TO_LUMINANCE;

uniform sampler2D transmittance_texture;
uniform sampler3D scattering_texture;
uniform sampler2D irradiance_texture;
uniform sampler3D single_mie_scattering_texture;

#include "./bruneton/common.glsl"
#include "./bruneton/runtime.glsl"

uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat4 inverseProjectionMatrix;
uniform mat4 inverseViewMatrix;
uniform mat4 worldToECEFMatrix;
uniform vec3 sunDirection;
uniform float uEnabled;  // 1.0 = on, 0.0 = off (bypass)

varying vec3 vCameraPosition;

// Reconstruct world position from depth
vec3 getWorldPosition(const vec2 uv, const float depth) {
  vec4 clipPos = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 viewPos = inverseProjectionMatrix * clipPos;
  viewPos /= viewPos.w;
  return (inverseViewMatrix * vec4(viewPos.xyz, 1.0)).xyz;
}

void mainImage(const vec4 inputColor, const vec2 uv, const float depth, out vec4 outputColor) {
  // Bypass if disabled
  if (uEnabled < 0.5) {
    outputColor = inputColor;
    return;
  }

  // If at far plane (sky), just pass through
  // if (depth >= 0.9999) {
  //   outputColor = inputColor;
  //   return;
  // }

  // Reconstruct world position
  vec3 worldPosition = getWorldPosition(uv, depth);

  // Transform to ECEF and scale to km
  vec3 positionECEF = (worldToECEFMatrix * vec4(worldPosition, 1.0)).xyz * METER_TO_LENGTH_UNIT;

  // Use camera position from vertex shader (already in ECEF km with altitude correction)
  vec3 cameraPositionECEF = vCameraPosition;

  // Calculate limb factor based on surface normal vs view direction
  vec3 surfaceNormal = normalize(positionECEF);
  vec3 viewDir = normalize(cameraPositionECEF - positionECEF);
  float NoV = dot(surfaceNormal, viewDir);

  // Calculate distance from camera to surface point (in km)
  //float distanceToPoint = length(cameraPositionECEF - positionECEF);

  // Distance-based atmosphere factor (aerial perspective for distant terrain)
  //float distanceFactor = pow(smoothstep(0.0, 100.0, distanceToPoint), 5.0);  // 0-800km range

  // DEBUG: visualize distance (0-20000km range for full globe view)
  //float debugDist = smoothstep(0.0, 10.0, distanceToPoint);
  //outputColor = vec4(vec3(debugDist), 1.0); return;

  // Limb factor based on viewing angle (thinner at edge)
    // Limb effect: purely angle-based (edge of globe gets atmosphere glow)
  // 아래 내용 임의로 조정 금지
  float limbFactor = (1.0 - pow(smoothstep(0.0, 0.7, NoV), 3.0)) * 1.0;
  //limbFactor = 0.0;
  // 위의 내용 임의로 조정 금지
  //outputColor = vec4(vec3(limbFactor), 1.0); return;

  // Calculate atmospheric scattering to this point
  vec3 transmittance;


  // 물리적 의미:
  // 먼 지형 → 대기 통과 거리 김 → inscatter 많음, transmittance 낮음 → 뿌옇게
  // 가까운 지형 → 대기 통과 거리 짧음 → inscatter 적음, transmittance 높음 → 선명
  // (return): 카메라→지표면 경로에서 대기 분자에 의해 산란되어 들어온 빛 (하늘색/뿌연 효과)
  vec3 inscatter = GetSkyRadianceToPoint(
    vCameraPosition,
    positionECEF,
    0.0,
    sunDirection,
    //(out): 지표면 원래 색이 얼마나 보존되는지 (1.0=100% 보존, 낮을수록 탁해짐)
    transmittance 
  );
  // 
  //outputColor = vec4(transmittance, 1.0); return;
  // Apply color tint (same as sky.frag.glsl)
  vec3 colorTint = vec3(1.2, 1.5, 0.9) * 1.2;
  inscatter *= colorTint;
  //outputColor = vec4(inscatter, 1.0); return;
  // Atmosphere intensity (reduced from sky)
  float atmosphereIntensity = 4.0;
  inscatter *= atmosphereIntensity;

  // Apply limb factor - but keep some minimum at the very edge to blend with sky
  inscatter *= limbFactor;
  transmittance = mix(vec3(1.0), transmittance, limbFactor * 0.3);

  // Apply transmittance and inscatter
  vec3 radiance = inputColor.rgb;
  //outputColor = vec4(transmittance, 1.0); return;
  #ifdef TRANSMITTANCE
  radiance = radiance * transmittance;
  #endif

  #ifdef INSCATTER
  radiance = radiance + inscatter;
  #endif
  //outputColor = vec4(radiance, 1.0); return;
  //degug : 이 셰이더의 효과 무시
  //outputColor = inputColor; return;
  outputColor = vec4(radiance, inputColor.a);
}
