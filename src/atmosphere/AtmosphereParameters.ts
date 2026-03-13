import { Color, Uniform, Vector3 } from "three";
import { METER_TO_UNIT } from "./constants";

const LUMINANCE_COEFFS = new Vector3(0.2126, 0.7152, 0.0722);

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export class DensityProfileLayer {
  width: number;
  expTerm: number;
  expScale: number;
  linearTerm: number;
  constantTerm: number;

  constructor(
    width: number,
    expTerm: number,
    expScale: number,
    linearTerm: number,
    constantTerm: number,
  ) {
    this.width = width;
    this.expTerm = expTerm;
    this.expScale = expScale;
    this.linearTerm = linearTerm;
    this.constantTerm = constantTerm;
  }

  toUniform() {
    return new Uniform({
      width: this.width,
      exp_term: this.expTerm,
      exp_scale: this.expScale,
      linear_term: this.linearTerm,
      constant_term: this.constantTerm,
    });
  }
}

type DensityProfile = [DensityProfileLayer, DensityProfileLayer];

export class AtmosphereParameters {
  static readonly DEFAULT = new AtmosphereParameters();

  // Solar irradiance at top of atmosphere
  solarIrradiance = new Vector3(1.474, 1.8504, 1.91198);

  // Sun's angular radius (~0.27 degrees)
  sunAngularRadius = 0.004675;

  // Planet bottom radius (meters) - matches EARTH_RADIUS in constants.ts
  bottomRadius = 6350000; //6371000;

  // Atmosphere top radius (meters) - 60km atmosphere thickness
  topRadius = 6650000;

  // Rayleigh density profile
  rayleighDensity: DensityProfile = [
    new DensityProfileLayer(0, 0, 0, 0, 0),
    new DensityProfileLayer(0, 1, -0.125, 0, 0),
  ];

  // Rayleigh scattering coefficients
  rayleighScattering = new Vector3(0.005802, 0.013558, 0.0331);

  // Mie density profile
  mieDensity: DensityProfile = [
    new DensityProfileLayer(0, 0, 0, 0, 0),
    new DensityProfileLayer(0, 1, -0.833333, 0, 0),
  ];

  // Mie scattering coefficients
  mieScattering = new Vector3(0.003996, 0.003996, 0.003996);

  // Mie extinction coefficients
  mieExtinction = new Vector3(0.00444, 0.00444, 0.00444);

  // Mie phase function asymmetry parameter
  miePhaseFunctionG = 0.8;

  // Absorption (ozone) density profile
  absorptionDensity: DensityProfile = [
    new DensityProfileLayer(25, 0, 0, 1 / 15, -2 / 3),
    new DensityProfileLayer(0, 0, 0, -1 / 15, 8 / 3),
  ];

  // Absorption extinction coefficients
  absorptionExtinction = new Vector3(0.00065, 0.001881, 0.000085);

  // Ground albedo
  groundAlbedo = new Color().setScalar(0.1);

  // Min sun zenith angle cosine
  muSMin = Math.cos(radians(120));

  // Radiance to luminance conversion
  sunRadianceToLuminance = new Vector3(
    98242.786222,
    69954.398112,
    66475.012354,
  );
  skyRadianceToLuminance = new Vector3(
    114974.916437,
    71305.954816,
    65310.548555,
  );
  sunRadianceToRelativeLuminance = new Vector3();
  skyRadianceToRelativeLuminance = new Vector3();

  constructor() {
    const luminance = LUMINANCE_COEFFS.dot(this.sunRadianceToLuminance);
    this.sunRadianceToRelativeLuminance
      .copy(this.sunRadianceToLuminance)
      .divideScalar(luminance);
    this.skyRadianceToRelativeLuminance
      .copy(this.skyRadianceToLuminance)
      .divideScalar(luminance);
  }

  toUniform() {
    return new Uniform({
      solar_irradiance: this.solarIrradiance,
      sun_angular_radius: this.sunAngularRadius,
      bottom_radius: this.bottomRadius * METER_TO_UNIT,
      top_radius: this.topRadius * METER_TO_UNIT,
      rayleigh_density: {
        layers: this.rayleighDensity.map((layer) => layer.toUniform().value),
      },
      rayleigh_scattering: this.rayleighScattering,
      mie_density: {
        layers: this.mieDensity.map((layer) => layer.toUniform().value),
      },
      mie_scattering: this.mieScattering,
      mie_extinction: this.mieExtinction,
      mie_phase_function_g: this.miePhaseFunctionG,
      absorption_density: {
        layers: this.absorptionDensity.map((layer) => layer.toUniform().value),
      },
      absorption_extinction: this.absorptionExtinction,
      ground_albedo: this.groundAlbedo,
      mu_s_min: this.muSMin,
    });
  }
}
