# PMTiles 레이어 분석 결과

## 분석 대상

| 파일 | 크기 | 스키마 |
|------|------|--------|
| `20240812.pmtiles` | 127GB | Protomaps Basemap v3.7.1 |
| OSM Shortbread (현재 사용) | 온라인 | Shortbread v1 |

## 레이어 비교

### ShadEarth에서 필요한 레이어

| 용도 | OSM Shortbread | Protomaps Basemap | 매핑 가능 |
|------|----------------|-------------------|-----------|
| 국가/주 라벨 | `boundary_labels` | `places` (`pmap:kind=country,region`) | **O** |
| 도시/마을 라벨 | `place_labels` | `places` (`pmap:kind=locality`) | **O** |
| 바다/호수 라벨 | `water_polygons_labels` | `physical_point` | **O** |

### Protomaps Basemap 레이어 (13개)

| 레이어 | 줌 범위 | 설명 | ShadEarth 관련 |
|--------|---------|------|----------------|
| `places` | 0-15 | **국가, 주, 도시, 마을** | **O (boundary_labels + place_labels 대체)** |
| `physical_point` | 0-15 | 산, 호수, 바다 등 자연지물 | **O (water_polygons_labels 대체)** |
| `boundaries` | 0-15 | 국경선 (폴리라인만) | X |
| `water` | 0-15 | 수역 폴리곤 | X |
| `earth` | 0-15 | 육지 폴리곤 | X |
| `landcover` | 0-7 | 토지피복 | X |
| `landuse` | 2-15 | 토지이용 | X |
| `natural` | 2-15 | 자연지물 | X |
| `roads` | 3-15 | 도로 | X |
| `buildings` | 11-15 | 건물 | X |
| `transit` | 9-15 | 철도, 공항 | X |
| `pois` | 5-15 | POI | X |
| `physical_line` | 9-15 | 하천 등 | X |

## `places` 레이어 상세

### pmap:kind 값

| pmap:kind | 줌 범위 | 설명 | Shortbread 대응 |
|-----------|---------|------|-----------------|
| `country` | z=0~6 | 국가 (中国, India, USA 등) | `boundary_labels` (admin_level=2) |
| `region` | z=2~8 | 주/도/지역 | `boundary_labels` (admin_level=4) |
| `locality` | z=3~15 | 도시, 마을 | `place_labels` |

### 필드 구조

| 필드 | 설명 | 예시 |
|------|------|------|
| `name` | 현지어 이름 | "中国", "서울" |
| `name:{lang}` | **다국어 이름 (수백개 언어!)** | 아래 참조 |
| `pmap:kind` | 종류 | "country", "region", "locality" |
| `pmap:min_zoom` | 최소 줌 레벨 | 0~15 |
| `pmap:population_rank` | 인구 순위 | 1~15 (높을수록 큰 도시) |
| `population` | 인구수 | 숫자 |
| `capital` | 수도 여부 | "yes" |
| `pmap:script` | 문자 체계 | "Hangul", "Cyrillic" 등 |

### 다국어 필드 목록 (일부)

**수백개의 언어를 지원합니다!**

| 필드 | 언어 | 예시 (한국) |
|------|------|-------------|
| `name:ko` | 한국어 | 대한민국 |
| `name:en` | 영어 | South Korea |
| `name:ja` | 일본어 | 大韓民国 |
| `name:zh` | 중국어 (간체) | 韩国 |
| `name:zh-Hant` | 중국어 (번체) | 韓國 |
| `name:ar` | 아랍어 | كوريا الجنوبية |
| `name:ru` | 러시아어 | Республика Корея |
| `name:de` | 독일어 | Südkorea |
| `name:fr` | 프랑스어 | Corée du Sud |
| `name:es` | 스페인어 | Corea del Sur |
| ... | 수백개 더 | ... |

UN 공식 언어도 별도 필드로 제공:
- `name:UN:ar`, `name:UN:en`, `name:UN:es`, `name:UN:fr`, `name:UN:ru`, `name:UN:zh`

### z=0~3 국가 목록 (확인됨)

中国, India, United States of America, Indonesia, Brasil, 日本, Россия,
México, ایران, Türkiye, Deutschland, ไทย, United Kingdom, France, Italia,
대한민국, España, Canada, Australia, مصر, etc.

## `physical_point` 레이어 상세

| pmap:kind | 설명 | Shortbread 대응 |
|-----------|------|-----------------|
| `sea` | 바다 | `water_polygons_labels` |
| `ocean` | 대양 | `water_polygons_labels` |
| `lake` | 호수 | `water_polygons_labels` |
| `peak` | 산봉우리 | - |

## 필드 매핑 (Shortbread → Protomaps)

| Shortbread | Protomaps | 비고 |
|------------|-----------|------|
| `name` | `name` | 동일 |
| `name_en` | `name:en` | 콜론 표기 |
| `kind` | `pmap:kind` | 값 체계 다름 |
| `admin_level` | `pmap:min_zoom` | 숫자 체계 다름 |
| `population` | `population` | **동일하게 있음!** |
| kind="capital" | `capital="yes"` | 별도 필드 |

### kind 값 매핑

| Shortbread kind | Protomaps pmap:kind |
|-----------------|---------------------|
| "country" | "country" |
| "state" | "region" |
| "capital", "city", "town" | "locality" |
| "sea", "ocean", "lake" | physical_point의 해당 kind |

## 결론

### 추출 가능 여부

| Shortbread 레이어 | Protomaps 대응 | 추출 가능 |
|-------------------|----------------|-----------|
| `boundary_labels` | `places` (pmap:kind=country,region) | **O** |
| `place_labels` | `places` (pmap:kind=locality) | **O** |
| `water_polygons_labels` | `physical_point` | **O** |

**모든 필요 레이어 추출 가능!**

### 권장 사항

1. **Protomaps 마이그레이션 권장**
   - `places` + `physical_point` 레이어만 추출
   - z=0~10 범위로 제한
   - 예상 크기: 수백 MB 이하 (127GB → ~500MB)

2. **코드 수정 필요**
   - `PlaceLabelsManager.ts`에서 레이어명 및 필드명 변경
   - `kind` → `pmap:kind`
   - `name_en` → `name:en`
   - `admin_level` → `pmap:min_zoom`

## 다국어 지명 표시 구현

### 사용자 언어 감지

```typescript
// 브라우저 언어 설정 가져오기
const userLang = navigator.language.split('-')[0]; // "ko", "ja", "en" 등
const userLangs = navigator.languages; // ["ko-KR", "en-US", "ja"] 등
```

### 언어별 이름 가져오기

```typescript
function getLocalizedName(properties: any, userLang: string): string {
  // 1. 사용자 언어로 된 이름 우선
  const localName = properties[`name:${userLang}`];
  if (localName) return localName;

  // 2. 영어 fallback
  const enName = properties['name:en'];
  if (enName) return enName;

  // 3. 기본 이름 (현지어)
  return properties['name'] || '';
}

// 예시
// 한국 사용자: getLocalizedName(china, 'ko') → "중국"
// 일본 사용자: getLocalizedName(china, 'ja') → "中国"
// 영어 사용자: getLocalizedName(china, 'en') → "China"
```

### 표시 예시

| 국가 | 한국어 사용자 | 일본어 사용자 | 영어 사용자 |
|------|--------------|--------------|------------|
| 중국 | 중국 | 中国 | China |
| 일본 | 일본 | 日本 | Japan |
| 미국 | 미국 | アメリカ合衆国 | United States |
| 프랑스 | 프랑스 | フランス | France |
| 한국 | 대한민국 | 大韓民国 | South Korea |

## 추출 명령어 (참고)

`places` 레이어만 z=2~10으로 추출하려면:

```bash
# tippecanoe가 필요하지만, PMTiles에서 직접 추출은 불가
# MBTiles로 변환 후 tippecanoe로 재처리 필요

# 또는 ogr2ogr로 GeoJSON 추출 후 재생성
pmtiles extract 20240812.pmtiles places.pmtiles --layers=places --maxzoom=10
```

> 참고: `pmtiles extract`는 레이어 필터링을 직접 지원하지 않음.
> 타일별로 읽어서 레이어만 추출하는 커스텀 스크립트 필요.
