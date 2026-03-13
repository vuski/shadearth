// 고도별 색상 계산
vec3 getBaseColorByElevation(float elevation) {
  vec3 waterColor = vec3(0.1, 0.2, 0.4);
  vec3 lowColor = vec3(0.2, 0.5, 0.2);
  vec3 midColor = vec3(0.6, 0.5, 0.3);
  vec3 highColor = vec3(0.8, 0.7, 0.6);
  vec3 snowColor = vec3(1.0, 1.0, 1.0);

  if (elevation < 1.0) {
    return waterColor;
  } else if (elevation < 200.0) {
    return lowColor;
  } else if (elevation < 800.0) {
    return mix(lowColor, midColor, (elevation - 200.0) / 600.0);
  } else if (elevation < 2500.0) {
    return mix(midColor, highColor, (elevation - 800.0) / 1700.0);
  } else {
    return mix(highColor, snowColor, clamp((elevation - 2500.0) / 2500.0, 0.0, 1.0));
  }
}
