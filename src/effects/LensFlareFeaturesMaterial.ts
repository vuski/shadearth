import {
  NoBlending,
  ShaderMaterial,
  Uniform,
  Vector2,
  type Texture,
} from "three";

import fragmentShader from "./shaders/lensFlareFeatures.frag.glsl";
import vertexShader from "./shaders/lensFlareFeatures.vert.glsl";

export interface LensFlareFeaturesMaterialOptions {
  inputBuffer?: Texture | null;
  ghostAmount?: number;
  haloAmount?: number;
  chromaticAberration?: number;
}

export class LensFlareFeaturesMaterial extends ShaderMaterial {
  constructor(options?: LensFlareFeaturesMaterialOptions) {
    const {
      inputBuffer = null,
      ghostAmount = 0.001,
      haloAmount = 0.001,
      chromaticAberration = 10,
    } = options ?? {};

    super({
      name: "LensFlareFeaturesMaterial",
      fragmentShader,
      vertexShader,
      blending: NoBlending,
      toneMapped: false,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        inputBuffer: new Uniform(inputBuffer),
        texelSize: new Uniform(new Vector2()),
        ghostAmount: new Uniform(ghostAmount),
        haloAmount: new Uniform(haloAmount),
        chromaticAberration: new Uniform(chromaticAberration),
      },
    });
  }

  setSize(width: number, height: number): void {
    this.uniforms.texelSize.value.set(1 / width, 1 / height);
  }

  get inputBuffer(): Texture | null {
    return this.uniforms.inputBuffer.value;
  }

  set inputBuffer(value: Texture | null) {
    this.uniforms.inputBuffer.value = value;
  }

  get ghostAmount(): number {
    return this.uniforms.ghostAmount.value;
  }

  set ghostAmount(value: number) {
    this.uniforms.ghostAmount.value = value;
  }

  get haloAmount(): number {
    return this.uniforms.haloAmount.value;
  }

  set haloAmount(value: number) {
    this.uniforms.haloAmount.value = value;
  }

  get chromaticAberration(): number {
    return this.uniforms.chromaticAberration.value;
  }

  set chromaticAberration(value: number) {
    this.uniforms.chromaticAberration.value = value;
  }
}
