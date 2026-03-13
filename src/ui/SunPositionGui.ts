import * as THREE from "three";
import GUI from "lil-gui";
import { calculateSunDirection, calculateMoonDirection } from "../utils/sunPosition";
import { UI_POSITIONS, applyPosition } from "./layout";

export interface SunPositionState {
  sunDirection: THREE.Vector3;
}

interface SunPositionDeps {
  onTimeChange: () => void;
  onSceneChange: () => void; // hard shadow 전환용
}

const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function getDayOfYear(d: Date): number {
  const startOfYear = new Date(d.getFullYear(), 0, 1);
  return Math.floor((d.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000)) + 1;
}

function dayOfYearToDate(year: number, dayOfYear: number): Date {
  const startOfYear = new Date(year, 0, 1);
  return new Date(startOfYear.getTime() + (dayOfYear - 1) * 24 * 60 * 60 * 1000);
}

function formatMonthDay(d: Date): string {
  return `${monthNames[d.getMonth()]} ${d.getDate()}`;
}

function formatTime(hours: number, minutes: number): string {
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

export class SunPositionGui {
  private gui: GUI;
  private deps: SunPositionDeps;

  private date: Date;
  private sunDirection: THREE.Vector3;
  private moonDirection: THREE.Vector3;
  private moonAngularRadius: number;
  private lastUpdate: number = 0;

  private params = {
    realTime: false,
    year: 2026,
    dayOfYear: 1,
    dayValue: "Mar 13",
    timeMinutes: 720, // 12:00
    timeValue: "12:00",
    speed: 1,
  };

  private daySliderController: ReturnType<GUI["add"]> | null = null;
  private timeSliderController: ReturnType<GUI["add"]> | null = null;

  constructor(deps: SunPositionDeps) {
    this.deps = deps;
    this.date = new Date();
    this.sunDirection = calculateSunDirection(this.date).direction;
    const moonData = calculateMoonDirection(this.date);
    this.moonDirection = moonData.direction;
    this.moonAngularRadius = moonData.angularRadius;

    // 초기값 설정
    this.params.year = this.date.getFullYear();
    this.params.dayOfYear = getDayOfYear(this.date);
    this.params.dayValue = formatMonthDay(this.date);
    this.params.timeMinutes = this.date.getHours() * 60 + this.date.getMinutes();
    this.params.timeValue = formatTime(this.date.getHours(), this.date.getMinutes());

    this.gui = new GUI({ title: "Sun Position" });
    applyPosition(this.gui.domElement, UI_POSITIONS.sunPosition);

    this.setupGui();
    this.setupKeyboardControls();
  }

  private setupGui(): void {
    this.gui.add(this.params, "realTime").name("Real Time");
    this.gui.add(this.params, "speed", { "1x (Real)": 1, "60x (1hr/min)": 60, "360x (6hr/min)": 360, "1440x (1day/min)": 1440 })
      .name("Speed");

    this.gui.add(this.params, "year", 1900, 2100, 1).name("Year").listen().onChange(() => {
      if (!this.params.realTime) this.updateDateFromParams();
    });

    // Day of Year: 첫째줄 레이블, 둘째줄 슬라이더
    this.gui.add(this.params, "dayValue").name("Day ( key: A(-) / F(+) )").disable().listen();
    this.daySliderController = this.gui.add(this.params, "dayOfYear", 1, 365, 1)
      .name("")
      .listen()
      .onChange(() => {
        if (!this.params.realTime) {
          const d = dayOfYearToDate(this.params.year, this.params.dayOfYear);
          this.params.dayValue = formatMonthDay(d);
          this.updateDateFromParams();
        }
      });
    this.applyFullWidthSlider(this.daySliderController);

    // Time (Local): 첫째줄 레이블, 둘째줄 슬라이더
    this.gui.add(this.params, "timeValue").name("Time ( key: S(-) / D(+) )").disable().listen();
    this.timeSliderController = this.gui.add(this.params, "timeMinutes", 0, 1439, 1)
      .name("")
      .listen()
      .onChange(() => {
        if (!this.params.realTime) {
          const h = Math.floor(this.params.timeMinutes / 60);
          const m = this.params.timeMinutes % 60;
          this.params.timeValue = formatTime(h, m);
          this.updateDateFromParams();
        }
      });
    this.applyFullWidthSlider(this.timeSliderController);

  }

  private updateParamsFromDate(): void {
    this.params.year = this.date.getFullYear();
    this.params.dayOfYear = getDayOfYear(this.date);
    this.params.dayValue = formatMonthDay(this.date);
    this.params.timeMinutes = this.date.getHours() * 60 + this.date.getMinutes();
    this.params.timeValue = formatTime(this.date.getHours(), this.date.getMinutes());
  }

  private updateDateFromParams(): void {
    const d = dayOfYearToDate(this.params.year, this.params.dayOfYear);
    const h = Math.floor(this.params.timeMinutes / 60);
    const m = this.params.timeMinutes % 60;

    this.date = new Date(this.params.year, d.getMonth(), d.getDate(), h, m);
    this.sunDirection = calculateSunDirection(this.date).direction;
    const moonData = calculateMoonDirection(this.date);
    this.moonDirection = moonData.direction;
    this.moonAngularRadius = moonData.angularRadius;
    this.deps.onSceneChange(); // hard shadow 전환
    this.deps.onTimeChange();
  }

  update(): void {
    const now = Date.now();
    const deltaTime = (now - this.lastUpdate) / 1000;
    this.lastUpdate = now;

    if (this.params.realTime) {
      if (this.params.speed === 1) {
        this.date = new Date();
      } else {
        const newTime = this.date.getTime() + deltaTime * 1000 * this.params.speed;
        this.date = new Date(newTime);
      }
      this.updateParamsFromDate();
      this.sunDirection = calculateSunDirection(this.date).direction;
      const moonData = calculateMoonDirection(this.date);
      this.moonDirection = moonData.direction;
      this.moonAngularRadius = moonData.angularRadius;
      this.deps.onSceneChange(); // hard shadow 전환
      this.deps.onTimeChange();
    }
  }

  getSunDirection(): THREE.Vector3 {
    return this.sunDirection;
  }

  getMoonDirection(): THREE.Vector3 {
    return this.moonDirection;
  }

  getMoonAngularRadius(): number {
    return this.moonAngularRadius;
  }

  getDate(): Date {
    return this.date;
  }

  private applyFullWidthSlider(controller: ReturnType<GUI["add"]>): void {
    const row = controller.domElement;
    // 이름 영역을 들여쓰기용 최소 폭으로
    const nameEl = row.querySelector(".lil-name") as HTMLElement;
    if (nameEl) {
      nameEl.style.width = "20px";
      nameEl.style.minWidth = "20px";
    }
    // 숫자 입력 필드 숨기기
    const input = row.querySelector("input[type='text']") as HTMLElement;
    if (input) {
      input.style.display = "none";
    }
    // 슬라이더가 나머지 폭 사용
    const slider = row.querySelector(".lil-slider") as HTMLElement;
    if (slider) {
      slider.style.width = "100%";
    }
  }

  private setupKeyboardControls(): void {
    document.addEventListener("keydown", (e) => {
      // input 등에 포커스 시 무시
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case "a": // Day -1
          this.params.dayOfYear = Math.max(1, this.params.dayOfYear - 1);
          this.onDayChange();
          break;
        case "f": // Day +1
          this.params.dayOfYear = Math.min(365, this.params.dayOfYear + 1);
          this.onDayChange();
          break;
        case "s": // Time -1분
          this.params.timeMinutes = Math.max(0, this.params.timeMinutes - 1);
          this.onTimeChange();
          break;
        case "d": // Time +1분
          this.params.timeMinutes = Math.min(1439, this.params.timeMinutes + 1);
          this.onTimeChange();
          break;
      }
    }, true); // capture phase
  }

  private onDayChange(): void {
    const d = dayOfYearToDate(this.params.year, this.params.dayOfYear);
    this.params.dayValue = formatMonthDay(d);
    this.updateDateFromParams();
  }

  private onTimeChange(): void {
    const h = Math.floor(this.params.timeMinutes / 60);
    const m = this.params.timeMinutes % 60;
    this.params.timeValue = formatTime(h, m);
    this.updateDateFromParams();
  }

}
