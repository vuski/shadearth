// Atmosphere texture constants from three-geospatial
// Based on Bruneton's precomputed atmospheric scattering

export const IRRADIANCE_TEXTURE_WIDTH = 64;
export const IRRADIANCE_TEXTURE_HEIGHT = 16;

export const SCATTERING_TEXTURE_R_SIZE = 32;
export const SCATTERING_TEXTURE_MU_SIZE = 128;
export const SCATTERING_TEXTURE_MU_S_SIZE = 32;
export const SCATTERING_TEXTURE_NU_SIZE = 8;
export const SCATTERING_TEXTURE_WIDTH =
  SCATTERING_TEXTURE_NU_SIZE * SCATTERING_TEXTURE_MU_S_SIZE; // 256
export const SCATTERING_TEXTURE_HEIGHT = SCATTERING_TEXTURE_MU_SIZE; // 128
export const SCATTERING_TEXTURE_DEPTH = SCATTERING_TEXTURE_R_SIZE; // 32

export const TRANSMITTANCE_TEXTURE_WIDTH = 256;
export const TRANSMITTANCE_TEXTURE_HEIGHT = 64;

// Unit conversion (three-geospatial uses km internally)
export const METER_TO_UNIT = 1 / 1000;

// Earth atmosphere parameters
export const EARTH_RADIUS = 6360; // km
export const ATMOSPHERE_HEIGHT = 60; // km
export const ATMOSPHERE_RADIUS = EARTH_RADIUS + ATMOSPHERE_HEIGHT; // 6420 km
