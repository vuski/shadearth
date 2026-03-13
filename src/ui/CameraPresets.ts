import * as THREE from "three";
import GUI from "lil-gui";
import { UI_POSITIONS, applyPosition } from "./layout";

// 프리셋 형식: "px,py,pz,qx,qy,qz,qw,tx,ty,tz" (카메라 위치, quaternion, 타겟 위치)
const presets = {
  slot1:
    "-2105859.1,3818855.8,4838162.3,-0.318326,-0.161135,0.035532,0.933510,-2050792.6,3706534.8,4758559.6",
  slot2:
    "-3103893.5,3942011.0,-4118312.3,0.130593,0.894524,0.294162,-0.310227,-3046377.6,3869303.0,-4040768.3",
  slot3:
    "-3045988.5,3871740.1,-4047441.5,0.097110,0.898876,0.305513,-0.298752,-3043664.1,3868084.4,-4043986.5",
  slot4:
    "-2303868.5,7424074.4,-11316489.5,0.046933,0.953882,0.278444,-0.101863,-970463.2,2954503.9,-5563205.7",
  slot5:
    "-3528477.0,4324483.0,-4713196.7,0.133670,0.897050,0.283538,-0.311512,-3154537.7,3758167.1,-4063311.1",
  slot6:
    "4398480.6,6442859.6,-7860201.1,-0.158523,0.916275,0.248414,0.271295,2788853.9,2727128.0,-5041291.4",
  slot7:
    "-3049625.9,3865600.7,-4042485.2,-0.253056,-0.443020,0.366418,0.778096,-3046053.6,3865798.6,-4044387.8",
  slot8:
    "21591006.4,-8840032.0,13615675.0,0.136679,0.478851,-0.095692,0.861895,5999910.0,-1575247.4,1474797.6",
  slot9: "",
  slot10: "",
};

interface CameraPresetDeps {
  camera: THREE.PerspectiveCamera;
  controls: { pivotPoint: THREE.Vector3; update: () => void };
  onApply: () => void;
}

let deps: CameraPresetDeps | null = null;

function parse(preset: string): {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  target: THREE.Vector3;
} | null {
  if (!preset.trim()) return null;
  const parts = preset.split(",").map((s) => parseFloat(s.trim()));
  if (parts.length !== 10 || parts.some(isNaN)) {
    console.warn(
      "Invalid preset format. Expected: px,py,pz,qx,qy,qz,qw,tx,ty,tz",
    );
    return null;
  }
  return {
    pos: new THREE.Vector3(parts[0], parts[1], parts[2]),
    quat: new THREE.Quaternion(parts[3], parts[4], parts[5], parts[6]),
    target: new THREE.Vector3(parts[7], parts[8], parts[9]),
  };
}

function apply(preset: string): void {
  if (!deps) return;
  const parsed = parse(preset);
  if (!parsed) {
    console.warn("Empty or invalid preset");
    return;
  }
  // pivotPoint 먼저 설정
  deps.controls.pivotPoint.copy(parsed.target);
  // controls.update()가 카메라를 덮어쓰지 않도록 카메라 설정을 나중에
  deps.controls.update();
  // 카메라 위치/회전을 마지막에 강제 적용
  deps.camera.position.copy(parsed.pos);
  deps.camera.quaternion.copy(parsed.quat);
  deps.onApply();
  console.log("Camera preset applied:", preset);
}

function logState(): void {
  if (!deps) return;
  const pos = deps.camera.position;
  const quat = deps.camera.quaternion;
  const target = deps.controls.pivotPoint;
  const str = [
    pos.x.toFixed(1),
    pos.y.toFixed(1),
    pos.z.toFixed(1),
    quat.x.toFixed(6),
    quat.y.toFixed(6),
    quat.z.toFixed(6),
    quat.w.toFixed(6),
    target.x.toFixed(1),
    target.y.toFixed(1),
    target.z.toFixed(1),
  ].join(",");
  console.log("=== Camera State ===");
  console.log(
    "Position:",
    pos.x.toFixed(1),
    pos.y.toFixed(1),
    pos.z.toFixed(1),
  );
  console.log(
    "Quaternion:",
    quat.x.toFixed(4),
    quat.y.toFixed(4),
    quat.z.toFixed(4),
    quat.w.toFixed(4),
  );
  console.log(
    "Target:",
    target.x.toFixed(1),
    target.y.toFixed(1),
    target.z.toFixed(1),
  );
  console.log("Preset string (copy this):");
  console.log(str);
  console.log("====================");
}

export function initCameraPresets(
  camera: THREE.PerspectiveCamera,
  controls: { pivotPoint: THREE.Vector3; update: () => void },
  onApply: () => void,
): void {
  deps = { camera, controls, onApply };

  // C 키로 카메라 상태 출력
  window.addEventListener("keydown", (e) => {
    if (e.key === "c" || e.key === "C") {
      logState();
    }
  });

  // GUI
  const gui = new GUI({ title: "카메라 프리셋" });
  applyPosition(gui.domElement, UI_POSITIONS.cameraPresets);

  const actions = {
    "Slot 1": () => apply(presets.slot1),
    "Slot 2": () => apply(presets.slot2),
    "Slot 3": () => apply(presets.slot3),
    "Slot 4": () => apply(presets.slot4),
    "Slot 5": () => apply(presets.slot5),
    "Slot 6": () => apply(presets.slot6),
    "Slot 7": () => apply(presets.slot7),
    "Slot 8": () => apply(presets.slot8),
    "Slot 9": () => apply(presets.slot9),
    "Slot 10": () => apply(presets.slot10),
  };

  gui.add(actions, "Slot 1").name("그랜드캐년");
  gui.add(actions, "Slot 2").name("수도권");
  gui.add(actions, "Slot 3").name("서울 확대");
  gui.add(actions, "Slot 4").name("지구 스케일(중국)");
  gui.add(actions, "Slot 5").name("전국");
  gui.add(actions, "Slot 6").name("이란");
  gui.add(actions, "Slot 7").name("석양");
  gui.add(actions, "Slot 8").name("지구전체 반구");
  gui.add(actions, "Slot 9").name("Slot 9");
  gui.add(actions, "Slot 10").name("Slot 10");
}
