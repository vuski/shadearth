/**
 * Hillshade Vertex Shader
 * DEM 타일 기반 지형 렌더링 + 고도 displacement
 *
 * HighResXYZTilesPlugin으로 고해상도 메시 생성 후
 * DEM 텍스처에서 고도를 샘플링하여 법선 방향으로 displacement 적용
 */

uniform sampler2D demMap;
uniform float uElevationScale;
uniform vec2 uDemUvScale;
uniform vec2 uDemUvOffset;

varying vec2 vUv;
varying vec3 vWorldPosition;

// Terrarium 디코딩: RGB (0~1) → 고도(m)
// height = (R * 255 * 256 + G * 255 + B * 255 / 256) - 32768
float decodeTerrarium(vec3 rgb) {
  return (rgb.r * 255.0 * 256.0 + rgb.g * 255.0 + rgb.b * 255.0 / 256.0) - 32768.0;
}

void main() {
  vUv = uv;

  // DEM UV 변환 (z > 12일 때 상위 타일의 해당 부분만 샘플링)
  vec2 demUv = uv * uDemUvScale + uDemUvOffset;

  // DEM에서 고도 샘플링
  vec4 demSample = texture2D(demMap, demUv);
  float elevation = decodeTerrarium(demSample.rgb);

  // normal은 지구 표면의 바깥 방향 (ellipsoid normal)
  // elevation은 미터 단위
  // uElevationScale로 과장 (1.0 = 실제 스케일, 10.0 = 10배 과장)
  vec3 displacedPosition = position + normal * elevation * uElevationScale;

  // 월드 위치 (태양 고도 계산용)
  vec4 worldPos = modelMatrix * vec4(displacedPosition, 1.0);
  vWorldPosition = worldPos.xyz;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(displacedPosition, 1.0);
}
