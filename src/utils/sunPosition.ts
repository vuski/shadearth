import * as THREE from "three";
import {
  AstroTime,
  Body,
  GeoVector,
  Pivot,
  Rotation_EQJ_EQD,
  SiderealTime,
  type RotationMatrix,
} from "astronomy-engine";

export interface SunDirection {
  direction: THREE.Vector3;
  declination: number;
}

export interface MoonDirection {
  direction: THREE.Vector3;
  angularRadius: number;
}

/**
 * 날짜/시각으로 태양 방향 벡터 계산 (Y-up 좌표계)
 */
export function calculateSunDirection(date: Date): SunDirection {
  // 율리우스 날짜 계산
  const JD =
    date.getTime() / 86400000 + 2440587.5;
  const n = JD - 2451545.0; // J2000.0 기준 일수

  // 평균 경도 (degrees)
  const L = (280.46 + 0.9856474 * n) % 360;

  // 평균 근점이각 (degrees)
  const g = ((357.528 + 0.9856003 * n) % 360) * (Math.PI / 180);

  // 황경 (degrees)
  const lambda = L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g);

  // 황도 기울기 (degrees)
  const epsilon = 23.439 - 0.0000004 * n;

  // 태양 적위 (declination)
  const lambdaRad = lambda * (Math.PI / 180);
  const epsilonRad = epsilon * (Math.PI / 180);
  const declination = Math.asin(Math.sin(epsilonRad) * Math.sin(lambdaRad));

  // 시간각 계산 (UTC 기준)
  // 12시 UTC = 태양이 경도 0도 위
  // 시간이 증가하면 태양은 서쪽으로 이동
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60;
  const hourAngle = ((hours - 12) * 15) * (Math.PI / 180); // 12시 = 0도

  // 태양 방향 벡터 (Y-up, 지구 중심 기준)
  // 경도 0도, 위도 = declination 위치에서 시작, hourAngle만큼 회전
  const cosDecl = Math.cos(declination);
  const sinDecl = Math.sin(declination);
  const cosHA = Math.cos(hourAngle);
  const sinHA = Math.sin(hourAngle);

  // Y-up 좌표계
  // X: 경도 0도 방향 (본초 자오선)
  // Y: 북극 방향
  // Z: 경도 90도 동쪽 방향
  const direction = new THREE.Vector3(
    cosDecl * cosHA,
    sinDecl,
    cosDecl * sinHA
  ).normalize();

  return {
    direction,
    declination: declination * (180 / Math.PI),
  };
}

/**
 * 현재 시각의 태양 방향
 */
export function getCurrentSunDirection(): SunDirection {
  return calculateSunDirection(new Date());
}

// ============================================
// 달 위치 계산 (astronomy-engine 사용)
// ============================================

function toAstroTime(date: Date): AstroTime {
  return new AstroTime(date);
}

function fromAstroRotationMatrix(matrix: RotationMatrix, result: THREE.Matrix4): THREE.Matrix4 {
  const [row0, row1, row2] = matrix.rot;
  return result.set(
    row0[0], row1[0], row2[0], 0,
    row0[1], row1[1], row2[1], 0,
    row0[2], row1[2], row2[2], 0,
    0, 0, 0, 1
  );
}

function getECIToECEFRotationMatrix(date: Date, result: THREE.Matrix4): THREE.Matrix4 {
  const time = toAstroTime(date);
  const matrix = Pivot(Rotation_EQJ_EQD(time), 2, -15 * SiderealTime(time));
  return fromAstroRotationMatrix(matrix, result);
}

const _matrixScratch = new THREE.Matrix4();

/**
 * 날짜/시각으로 달 방향 벡터 계산 (Y-up ECEF 좌표계)
 */
export function calculateMoonDirection(date: Date): MoonDirection {
  const time = toAstroTime(date);

  // Get moon position in ECI (Earth-Centered Inertial)
  const vector = GeoVector(Body.Moon, time, false);

  // Distance in AU, convert to km for angular radius calculation
  const distanceAU = Math.sqrt(vector.x * vector.x + vector.y * vector.y + vector.z * vector.z);
  const distanceKm = distanceAU * 149597870.7; // AU to km

  // Moon's radius is about 1737.4 km
  const moonRadiusKm = 1737.4;
  const angularRadius = Math.atan(moonRadiusKm / distanceKm);

  // Direction in ECI
  const directionECI = new THREE.Vector3(vector.x, vector.y, vector.z).normalize();

  // Rotate ECI to ECEF
  const matrixECIToECEF = getECIToECEFRotationMatrix(date, _matrixScratch);
  const directionECEF = directionECI.applyMatrix4(matrixECIToECEF);

  // Convert ECEF (Z-up) to Y-up coordinate system
  // ECEF: X=lon0, Y=lon90, Z=north pole
  // Y-up: X=lon0, Y=north pole, Z=lon90
  const direction = new THREE.Vector3(
    directionECEF.x,
    directionECEF.z,
    -directionECEF.y
  ).normalize();

  return {
    direction,
    angularRadius,
  };
}

/**
 * 현재 시각의 달 방향
 */
export function getCurrentMoonDirection(): MoonDirection {
  return calculateMoonDirection(new Date());
}

/**
 * 그리니치 평균 항성시(GMST)를 라디안으로 반환
 * 별 배경 회전에 사용
 */
export function getGreenwichSiderealTime(date: Date): number {
  const time = new AstroTime(date);
  // SiderealTime returns hours, convert to radians
  const gmstHours = SiderealTime(time);
  return gmstHours * (Math.PI / 12); // hours to radians (24h = 2π)
}
