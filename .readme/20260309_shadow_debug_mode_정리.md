# 20260309 Shadow 디버그/수정 정리

## 목적

- 그림자(특히 soft-hard 불일치, 타일 경계 이음새, 시간대 변화) 문제를 디버깅하기 위해 임시/상시 디버그 모드를 추가함
- 로컬 노멀/글로벌 노멀/태양 로컬 벡터를 분리 확인할 수 있도록 셰이더 뷰를 확장함

## 주요 수정 파일

- `src/main.ts`
- `src/rendering/shaders/hillshade-shadow.frag.glsl`
- `src/rendering/shaders/shadow-accumulate.frag.glsl`
- `src/rendering/TileShadowRenderer.ts`
- `src/utils/sunPosition.ts`

## 디버그 모드 사용법

- 키: `F2`
- `F2`를 누를 때마다 디버그 모드가 순환됨
- 상태 텍스트는 좌하단에 `Debug: ...` 형태로 표시됨

현재 순서:

1. `Off`
2. `LocalSun`
3. `LocalNormal`
4. `SurfaceNormal`
5. `Shadow`
6. `Soft-Hard Diff`

## 디버그 모드 의미

### 1) Off

- 최종 렌더링 결과

### 2) LocalSun

- 로컬 좌표계 기준 태양 벡터 표시
- 색상 채널 의미:
  - `R`: east 성분
  - `G`: north 성분
  - `B`: up 성분

### 3) LocalNormal

- DEM 기반 지형 노멀(로컬 경사) 표시
- 경사 가시성을 위해 XY 성분을 시각화에서 확대함
- 지형의 능선/계곡 방향 확인용

### 4) SurfaceNormal

- 구면(글로벌) 노멀 표시 (`normalize(vWorldPosition)`)
- 지구 곡률에 따른 방향 확인용
- DEM 돌출은 직접 반영하지 않음

### 5) Shadow

- 최종 적용된 shadow 값(흑백)
- 흰색: 1(빛 받음), 검정: 0(그림자)

### 6) Soft-Hard Diff

- `abs(softShadow - hardShadow)` 시각화
- 검정: 두 방식 거의 동일
- 빨강: 두 방식 차이 큼
- `uUseShadowMap > 0.5`인 타일에서만 diff 계산하도록 처리해 가짜 차이(준비 전 타일)를 제거함

## 이번 세션에서 적용된 핵심 수정

### A. 로컬/글로벌 진단 확장

- 디버그 모드 다중 추가
- `LocalNormal`/`SurfaceNormal` 분리로 노멀 해석 혼선을 줄임

### B. 노멀 계산 보정

- `localNormal` 계산을 `uMetersPerTexel` 기반 기울기로 계산
- `uElevationScale` 기본값을 과소값에서 정상 범위로 조정

### C. soft shadow 좌표 복원 정확도 개선

- soft accumulate에서 픽셀 위치를 단순 선형 근사 대신
  - 타일 `x/y/z + uv` -> WebMercator 역변환 -> 구면 좌표
  방식으로 복원

### D. soft 누적 안정화

- 누적 shadow 값을 `0~1` clamp
- `sunRadiusMultiplier`를 과도값에서 낮춰 전역 아티팩트 완화

### E. 시간각 부호 수정 이력

- `sunPosition.ts` 시간각 부호를 한 차례 반대로 바꿨다가,
- 사용자 피드백 후 원래 규칙으로 복구함
- 현재 값:
  - `hourAngle = ((hours - 12) * 15) * (Math.PI / 180)`

## 현재 상태 요약

- LocalNormal/SurfaceNormal/LocalSun의 역할 구분은 가능
- soft-hard 전역 붕괴는 크게 완화됨
- 다만 특정 시점/시야에서 타일 경계 seam 및 시간대별 체감 품질은 추가 조정 여지 있음

## 참고

- 본 문서는 디버그 모드 설명 및 이번 세션 변경사항 요약 문서임
- 필요 시 다음 단계는 seam(LOD 혼합 경계) 처리와 shadow 파라미터 재튜닝으로 진행
