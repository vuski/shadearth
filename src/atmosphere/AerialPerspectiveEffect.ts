import { BlendFunction, Effect } from "postprocessing";
import {
  Camera,
  Matrix4,
  Uniform,
  Vector3,
} from "three";

import { AtmosphereParameters } from "./AtmosphereParameters";
import type { AtmosphereTextures } from "./AtmosphereTextureLoader";
import { METER_TO_UNIT } from "./constants";

import aerialPerspectiveFragmentShader from "./shaders/aerialPerspective.frag.glsl";
import aerialPerspectiveVertexShader from "./shaders/aerialPerspective.vert.glsl";

export interface AerialPerspectiveEffectOptions {
  textures: AtmosphereTextures;
  atmosphere?: AtmosphereParameters;
}

export class AerialPerspectiveEffect extends Effect {
  private camera: Camera;
  readonly sunDirection = new Vector3(0, 1, 0);
  readonly worldToECEFMatrix = new Matrix4();

  constructor(camera: Camera, options: AerialPerspectiveEffectOptions) {
    const atm = options.atmosphere ?? AtmosphereParameters.DEFAULT;
    const textures = options.textures;

    super("AerialPerspectiveEffect", aerialPerspectiveFragmentShader, {
      blendFunction: BlendFunction.SET,
      vertexShader: aerialPerspectiveVertexShader,
      uniforms: new Map<string, Uniform>([
        ["projectionMatrix", new Uniform(new Matrix4())],
        ["viewMatrix", new Uniform(new Matrix4())],
        ["inverseProjectionMatrix", new Uniform(new Matrix4())],
        ["inverseViewMatrix", new Uniform(new Matrix4())],
        ["cameraPosition", new Uniform(new Vector3())],
        ["worldToECEFMatrix", new Uniform(new Matrix4())],
        ["altitudeCorrection", new Uniform(new Vector3())],
        ["sunDirection", new Uniform(new Vector3(0, 1, 0))],
        ["uEnabled", new Uniform(1.0)],

        // Atmosphere uniforms
        ["ATMOSPHERE", atm.toUniform()],
        [
          "SUN_SPECTRAL_RADIANCE_TO_LUMINANCE",
          new Uniform(atm.sunRadianceToRelativeLuminance),
        ],
        [
          "SKY_SPECTRAL_RADIANCE_TO_LUMINANCE",
          new Uniform(atm.skyRadianceToRelativeLuminance),
        ],
        ["transmittance_texture", new Uniform(textures.transmittanceTexture)],
        ["scattering_texture", new Uniform(textures.scatteringTexture)],
        ["irradiance_texture", new Uniform(textures.irradianceTexture)],
        ["single_mie_scattering_texture", new Uniform(null)],
      ]),
      defines: new Map<string, string>([
        ["TRANSMITTANCE_TEXTURE_WIDTH", "256"],
        ["TRANSMITTANCE_TEXTURE_HEIGHT", "64"],
        ["SCATTERING_TEXTURE_R_SIZE", "32"],
        ["SCATTERING_TEXTURE_MU_SIZE", "128"],
        ["SCATTERING_TEXTURE_MU_S_SIZE", "32"],
        ["SCATTERING_TEXTURE_NU_SIZE", "8"],
        ["IRRADIANCE_TEXTURE_WIDTH", "64"],
        ["IRRADIANCE_TEXTURE_HEIGHT", "16"],
        ["METER_TO_LENGTH_UNIT", METER_TO_UNIT.toFixed(7)],
        ["COMBINED_SCATTERING_TEXTURES", "1"],
        ["TRANSMITTANCE", "1"],
        ["INSCATTER", "1"],
      ]),
      attributes: 1, // EffectAttribute.DEPTH
    });

    this.camera = camera;
  }

  override get mainCamera(): Camera {
    return this.camera;
  }

  override set mainCamera(value: Camera) {
    this.camera = value;
  }

  updateSunDirection(direction: Vector3): void {
    this.sunDirection.copy(direction);
    (this.uniforms.get("sunDirection")!.value as Vector3).copy(direction);
  }

  updateWorldToECEF(matrix: Matrix4): void {
    this.worldToECEFMatrix.copy(matrix);
    (this.uniforms.get("worldToECEFMatrix")!.value as Matrix4).copy(matrix);
  }

  setEnabled(value: boolean): void {
    this.uniforms.get("uEnabled")!.value = value ? 1.0 : 0.0;
  }

  override update(): void {
    const camera = this.camera;
    const uniforms = this.uniforms;

    (uniforms.get("projectionMatrix")!.value as Matrix4).copy(
      camera.projectionMatrix
    );
    (uniforms.get("viewMatrix")!.value as Matrix4).copy(camera.matrixWorldInverse);
    (uniforms.get("inverseProjectionMatrix")!.value as Matrix4).copy(
      camera.projectionMatrixInverse
    );
    (uniforms.get("inverseViewMatrix")!.value as Matrix4).copy(camera.matrixWorld);
    camera.getWorldPosition(uniforms.get("cameraPosition")!.value as Vector3);
  }
}
