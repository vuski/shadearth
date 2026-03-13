/**
 * UI 패널 위치 설정
 * 모든 GUI 패널의 위치를 한 곳에서 관리
 */

export interface PanelPosition {
  top?: string;
  bottom?: string;
  left?: string;
  right?: string;
}

// 기본 여백
const MARGIN = "10px";
// const PANEL_GAP = "10px"; // 현재 미사용

// 예상 패널 높이 (lil-gui 기준)
const SETTINGS_HEIGHT = 150; // Scene Settings 패널
const RENDER_HEIGHT = 50; // Render 패널
const SUN_POSITION_HEIGHT = 190; // 태양 위치 패널

export const UI_POSITIONS = {
  // 좌측 상단: Scene Settings
  settings: {
    top: MARGIN,
    left: MARGIN,
  } as PanelPosition,

  // 좌측: Render (Scene Settings 아래)
  render: {
    top: `${SETTINGS_HEIGHT + 20}px`,
    left: MARGIN,
  } as PanelPosition,

  // 좌측: Post Processing (Render 아래)
  postProcess: {
    top: `${SETTINGS_HEIGHT + RENDER_HEIGHT + 60}px`,
    left: MARGIN,
  } as PanelPosition,

  // 좌측 하단: 디버그 정보 (클릭 지점)
  debug: {
    top: `${SUN_POSITION_HEIGHT + 30}px`,
    right: MARGIN,
  } as PanelPosition,

  // 우측 상단: 태양 위치
  sunPosition: {
    top: MARGIN,
    right: MARGIN,
  } as PanelPosition,

  // 우측 상단 아래: (예비)
  reserved1: {
    top: `${SUN_POSITION_HEIGHT + 20}px`,
    right: MARGIN,
  } as PanelPosition,

  // 좌측 하단: 카메라 프리셋
  cameraPresets: {
    bottom: `${20}px`,
    right: MARGIN,
  } as PanelPosition,

  // 우측 하단: (예비)
  reserved2: {
    bottom: MARGIN,
    right: MARGIN,
  } as PanelPosition,
};

/**
 * GUI 패널에 위치 스타일 적용
 * lil-gui 기본 스타일을 초기화하고 새 위치 적용
 */
export function applyPosition(
  element: HTMLElement,
  position: PanelPosition,
): void {
  // cssText로 강제 적용 (lil-gui 기본 스타일 덮어쓰기)
  const styles: string[] = ["position: fixed !important"];

  if (position.top) {
    styles.push(`top: ${position.top} !important`);
    styles.push("bottom: auto !important");
  }
  if (position.bottom) {
    styles.push(`bottom: ${position.bottom} !important`);
    styles.push("top: auto !important");
  }
  if (position.left) {
    styles.push(`left: ${position.left} !important`);
    styles.push("right: auto !important");
  }
  if (position.right) {
    styles.push(`right: ${position.right} !important`);
    styles.push("left: auto !important");
  }

  element.style.cssText = styles.join("; ");
}
