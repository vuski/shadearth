precision highp float;

uniform mat4 inverseProjectionMatrix;
uniform mat4 inverseViewMatrix;
uniform vec3 cameraPosition;
uniform mat4 worldToECEFMatrix;
uniform vec3 altitudeCorrection;

varying vec3 vCameraPosition;
varying vec3 vRayDirection;

void mainSupport(const vec2 uv) {
  // Calculate ray direction for this fragment
  vec4 clipPos = vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  vec4 viewPos = inverseProjectionMatrix * clipPos;
  viewPos /= viewPos.w;
  vec3 worldDir = (inverseViewMatrix * vec4(viewPos.xyz, 0.0)).xyz;

  // Transform camera position to ECEF and scale to km
  vec3 cameraPositionECEF = (worldToECEFMatrix * vec4(cameraPosition, 1.0)).xyz;
  vCameraPosition = (cameraPositionECEF + altitudeCorrection) * METER_TO_LENGTH_UNIT;
  vRayDirection = (worldToECEFMatrix * vec4(worldDir, 0.0)).xyz;
}
