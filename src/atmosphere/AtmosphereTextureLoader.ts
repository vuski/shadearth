import {
  Data3DTexture,
  DataTexture,
  FloatType,
  LinearFilter,
  RGBAFormat,
  ClampToEdgeWrapping,
} from "three";

import {
  IRRADIANCE_TEXTURE_WIDTH,
  IRRADIANCE_TEXTURE_HEIGHT,
  SCATTERING_TEXTURE_WIDTH,
  SCATTERING_TEXTURE_HEIGHT,
  SCATTERING_TEXTURE_DEPTH,
  TRANSMITTANCE_TEXTURE_WIDTH,
  TRANSMITTANCE_TEXTURE_HEIGHT,
} from "./constants";

export interface AtmosphereTextures {
  transmittanceTexture: DataTexture;
  scatteringTexture: Data3DTexture;
  irradianceTexture: DataTexture;
}

/**
 * Parse binary data as Float16 array
 * The .bin files from three-geospatial are stored as half-float (16-bit)
 */
function parseFloat16Array(buffer: ArrayBuffer): Float32Array {
  const uint16 = new Uint16Array(buffer);
  const float32 = new Float32Array(uint16.length);

  for (let i = 0; i < uint16.length; i++) {
    float32[i] = float16ToFloat32(uint16[i]);
  }

  return float32;
}

/**
 * Convert IEEE 754 half-precision float to single-precision
 */
function float16ToFloat32(h: number): number {
  const sign = (h >>> 15) & 0x1;
  const exponent = (h >>> 10) & 0x1f;
  const mantissa = h & 0x3ff;

  if (exponent === 0) {
    if (mantissa === 0) {
      // Zero
      return sign === 0 ? 0 : -0;
    } else {
      // Subnormal
      const f = mantissa / 1024;
      return (sign === 0 ? 1 : -1) * f * Math.pow(2, -14);
    }
  } else if (exponent === 31) {
    if (mantissa === 0) {
      // Infinity
      return sign === 0 ? Infinity : -Infinity;
    } else {
      // NaN
      return NaN;
    }
  }

  // Normalized
  const f = 1 + mantissa / 1024;
  return (sign === 0 ? 1 : -1) * f * Math.pow(2, exponent - 15);
}

/**
 * Load a 2D texture from binary file
 */
async function load2DTexture(
  url: string,
  width: number,
  height: number
): Promise<DataTexture> {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  const data = parseFloat16Array(buffer);

  const texture = new DataTexture(data, width, height, RGBAFormat, FloatType);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.needsUpdate = true;

  return texture;
}

/**
 * Load a 3D texture from binary file
 */
async function load3DTexture(
  url: string,
  width: number,
  height: number,
  depth: number
): Promise<Data3DTexture> {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  const data = parseFloat16Array(buffer);

  const texture = new Data3DTexture(data, width, height, depth);
  texture.format = RGBAFormat;
  texture.type = FloatType;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.wrapR = ClampToEdgeWrapping;
  texture.needsUpdate = true;

  return texture;
}

/**
 * Load all precomputed atmosphere textures
 */
export async function loadAtmosphereTextures(
  basePath: string = "/atmosphere"
): Promise<AtmosphereTextures> {
  const [transmittanceTexture, scatteringTexture, irradianceTexture] =
    await Promise.all([
      load2DTexture(
        `${basePath}/transmittance.bin`,
        TRANSMITTANCE_TEXTURE_WIDTH,
        TRANSMITTANCE_TEXTURE_HEIGHT
      ),
      load3DTexture(
        `${basePath}/scattering.bin`,
        SCATTERING_TEXTURE_WIDTH,
        SCATTERING_TEXTURE_HEIGHT,
        SCATTERING_TEXTURE_DEPTH
      ),
      load2DTexture(
        `${basePath}/irradiance.bin`,
        IRRADIANCE_TEXTURE_WIDTH,
        IRRADIANCE_TEXTURE_HEIGHT
      ),
    ]);

  return {
    transmittanceTexture,
    scatteringTexture,
    irradianceTexture,
  };
}
