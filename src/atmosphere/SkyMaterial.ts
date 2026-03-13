import {
  DoubleSide,
  GLSL3,
  Matrix4,
  RawShaderMaterial,
  Texture,
  Uniform,
  Vector3,
} from "three";

import { AtmosphereParameters } from "./AtmosphereParameters";
import type { AtmosphereTextures } from "./AtmosphereTextureLoader";

import skyVertexShader from "./shaders/sky.vert.glsl";
import skyFragmentShader from "./shaders/sky.frag.glsl";

export interface SkyMaterialOptions {
  textures: AtmosphereTextures;
  atmosphere?: AtmosphereParameters;
}

export class SkyMaterial extends RawShaderMaterial {
  readonly sunDirection = new Vector3(0, 1, 0);
  readonly moonDirection = new Vector3(0, -1, 0);
  moonAngularRadius = 0.0045; // ~0.26 degrees

  private _atmosphere: AtmosphereParameters;

  constructor({ textures, atmosphere }: SkyMaterialOptions) {
    const atm = atmosphere ?? AtmosphereParameters.DEFAULT;

    super({
      glslVersion: GLSL3,
      vertexShader: skyVertexShader,
      fragmentShader: skyFragmentShader,
      side: DoubleSide,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        inverseProjectionMatrix: new Uniform(new Matrix4()),
        inverseViewMatrix: new Uniform(new Matrix4()),
        cameraPosition: new Uniform(new Vector3()),
        worldToECEFMatrix: new Uniform(new Matrix4()),
        altitudeCorrection: new Uniform(new Vector3()),

        ATMOSPHERE: atm.toUniform(),
        SUN_SPECTRAL_RADIANCE_TO_LUMINANCE: new Uniform(
          atm.sunRadianceToRelativeLuminance
        ),
        SKY_SPECTRAL_RADIANCE_TO_LUMINANCE: new Uniform(
          atm.skyRadianceToRelativeLuminance
        ),

        transmittance_texture: new Uniform(textures.transmittanceTexture),
        scattering_texture: new Uniform(textures.scatteringTexture),
        irradiance_texture: new Uniform(textures.irradianceTexture),
        single_mie_scattering_texture: new Uniform(null),

        sunDirection: new Uniform(new Vector3(0, 1, 0)),
        moonDirection: new Uniform(new Vector3(0, -1, 0)),
        moonAngularRadius: new Uniform(0.0045),
        lunarRadianceScale: new Uniform(1.0),
        starfieldTexture: new Uniform(null as Texture | null),
        starfieldRotation: new Uniform(0.0),
      },
    });

    this._atmosphere = atm;
  }

  updateStarfield(texture: Texture | null, rotation: number): void {
    this.uniforms.starfieldTexture.value = texture;
    this.uniforms.starfieldRotation.value = rotation;
  }

  get atmosphere(): AtmosphereParameters {
    return this._atmosphere;
  }

  updateSunDirection(direction: Vector3): void {
    this.sunDirection.copy(direction);
    (this.uniforms.sunDirection.value as Vector3).copy(direction);
  }

  updateMoonDirection(direction: Vector3, angularRadius?: number): void {
    this.moonDirection.copy(direction);
    (this.uniforms.moonDirection.value as Vector3).copy(direction);
    if (angularRadius !== undefined) {
      this.moonAngularRadius = angularRadius;
      this.uniforms.moonAngularRadius.value = angularRadius;
    }
  }

  updateCamera(
    inverseProjectionMatrix: Matrix4,
    inverseViewMatrix: Matrix4,
    cameraPosition: Vector3
  ): void {
    (this.uniforms.inverseProjectionMatrix.value as Matrix4).copy(
      inverseProjectionMatrix
    );
    (this.uniforms.inverseViewMatrix.value as Matrix4).copy(inverseViewMatrix);
    (this.uniforms.cameraPosition.value as Vector3).copy(cameraPosition);
  }

  updateWorldToECEF(matrix: Matrix4): void {
    (this.uniforms.worldToECEFMatrix.value as Matrix4).copy(matrix);
  }
}
