# Starfield Orientation 문제 해결 과정

## 최종 해결 코드

```glsl
// ECEF: X=lon0, Y=north pole, Z=lon90E
// Starmap: equirectangular with celestial north at V=1

// 좌표 변환: Y와 Z를 교환
vec3 starDir = vec3(rayDirection.x, rayDirection.z, rayDirection.y);

// Sidereal time으로 회전 + 90도 오프셋
float rotAngle = -starfieldRotation - PI * 0.5;
float cosRot = cos(rotAngle);
float sinRot = sin(rotAngle);
starDir = vec3(
  starDir.x * cosRot + starDir.z * sinRot,
  starDir.y,
  -starDir.x * sinRot + starDir.z * cosRot
);

// Equirectangular UV 변환
float starU = atan(starDir.x, starDir.z) / (2.0 * PI) + 0.5;
float starV = asin(clamp(starDir.y, -1.0, 1.0)) / PI + 0.5;
```

## 발견된 문제들과 해결

### 1. 북극성 위치가 완전히 틀림
**증상**: 북극성이 지구 북극 위가 아니라 엉뚱한 방향에 보임

**원인**: ECEF 좌표계와 starmap 좌표계의 축 불일치
- ECEF: Y축 = 북극
- Starmap (equirectangular): V=1 = 북극, 이는 구면좌표에서 +Z 방향에 해당

**해결**: Y와 Z를 교환
```glsl
vec3 starDir = vec3(rayDirection.x, rayDirection.z, rayDirection.y);
```

### 2. 거울상 (Mirror Image)
**증상**: 오리온자리가 좌우 반전되어 보임

**원인**: equirectangular 매핑에서 경도 방향이 반대

**해결 시도**: X축 반전 (`-rayDirection.x`)
- 그러나 최종 해결에서는 X 반전 없이 해결됨
- 대신 sidereal rotation 방향을 음수로 적용 (`-starfieldRotation`)

### 3. 23.4도 틀어짐
**증상**: 북극성이 북극에서 약 23도 떨어진 위치에 보임

**초기 가설**: 지구 자전축 기울기(obliquity) 때문

**실제 원인**: obliquity가 아니라 좌표 축 교환 문제였음
- obliquity 적용은 오히려 문제를 악화시킴
- 최종 해결에서는 obliquity 적용 없이 해결

### 4. 천체가 회전 안 함
**증상**: 시간을 조작해도 별이 움직이지 않음

**원인**: sidereal rotation 코드가 누락되거나 잘못된 축으로 회전

**해결**: Y축 주변으로 회전 (starDir 공간에서 Y는 원래 Z이므로 적도면 회전)
```glsl
starDir = vec3(
  starDir.x * cosRot + starDir.z * sinRot,
  starDir.y,
  -starDir.x * sinRot + starDir.z * cosRot
);
```

### 5. 회전 방향 반대
**증상**: 시간이 흐르면 별이 반대 방향으로 회전

**해결**: rotation 각도에 음수 적용
```glsl
float rotAngle = -starfieldRotation - PI * 0.5;
```

### 6. 6시간 (90도) 오프셋
**증상**: 오리온자리가 실제보다 6시간 늦게 뜸

**원인**: ECEF X축(경도 0)과 starmap의 RA=0 방향이 90도 차이

**해결**: 90도 오프셋 추가
```glsl
float rotAngle = -starfieldRotation - PI * 0.5;
```

## 디버깅 방법

카메라를 특정 방향으로 설정하여 테스트:
```javascript
controls.enabled = false;
camera.position.set(0, 50000000, 0);  // Y축 위 (북극 위)
camera.lookAt(0, 100000000, 0);       // Y+ 방향 바라봄 (우주 방향)
renderState.needsRender = true;
```

각 축 방향 테스트:
- `+Y`: 북극성이 보여야 함
- `-Y`: 남극 (마젤란 은하 등)
- `+Z`, `-Z`, `+X`, `-X`: 적도 부근 별자리

## 좌표계 정리

### ECEF (Earth-Centered, Earth-Fixed)
- X: 경도 0도 (본초 자오선)
- Y: 북극 방향
- Z: 경도 90도 동쪽

### Starmap (Equirectangular)
- U: 적경 (Right Ascension), 0~1 = 0h~24h
- V: 적위 (Declination), 0 = -90°, 1 = +90°
- V=1 (위쪽 가장자리) = 천구 북극 = 북극성 위치

### 변환 관계
```
starDir.x = rayDirection.x   (경도 방향 유지)
starDir.y = rayDirection.z   (ECEF Z → starmap "적도면" 축)
starDir.z = rayDirection.y   (ECEF Y=북극 → starmap V 방향)
```

## 교훈

1. **obliquity (23.4°)는 필요 없음**: 천구 북극과 지리적 북극의 차이는 ~1°에 불과 (북극성 위치)
2. **체계적 디버깅 필요**: 각 축 방향에서 뭐가 보이는지 먼저 확인
3. **좌표계 문서화 중요**: ECEF, starmap, Three.js 각각의 축 방향을 명확히 정리
4. **거울상 문제**: X 반전보다는 회전 방향 조정이 올바른 해결책이었음
