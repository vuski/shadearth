precision highp float;
precision highp sampler3D;

#define PI 3.14159265358979323846

// Texture size constants
#define TRANSMITTANCE_TEXTURE_WIDTH 256
#define TRANSMITTANCE_TEXTURE_HEIGHT 64
#define SCATTERING_TEXTURE_R_SIZE 32
#define SCATTERING_TEXTURE_MU_SIZE 128
#define SCATTERING_TEXTURE_MU_S_SIZE 32
#define SCATTERING_TEXTURE_NU_SIZE 8
#define IRRADIANCE_TEXTURE_WIDTH 64
#define IRRADIANCE_TEXTURE_HEIGHT 16

#define COMBINED_SCATTERING_TEXTURES

#include "./bruneton/definitions.glsl"

uniform AtmosphereParameters ATMOSPHERE;
uniform vec3 SUN_SPECTRAL_RADIANCE_TO_LUMINANCE;
uniform vec3 SKY_SPECTRAL_RADIANCE_TO_LUMINANCE;

uniform sampler2D transmittance_texture;
uniform sampler3D scattering_texture;
uniform sampler2D irradiance_texture;
uniform sampler3D single_mie_scattering_texture;

#include "./bruneton/common.glsl"
#include "./bruneton/runtime.glsl"

uniform vec3 sunDirection;
uniform vec3 moonDirection;
uniform float moonAngularRadius;
uniform float lunarRadianceScale;
uniform sampler2D starfieldTexture;
uniform float starfieldRotation;

in vec2 vUv;
in vec3 vCameraPosition;
in vec3 vRayDirection;

out vec4 outputColor;

// Ray-sphere intersection helper
float raySphereIntersection(vec3 ro, vec3 rd, float radius) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - radius * radius;
  float d = b * b - c;
  if (d < 0.0) return -1.0;
  return -b - sqrt(d);
}

// Moon rendering helpers (from takram)
vec3 getLunarRadiance(const float angularRadius) {
  // Not a physical number but the order of 10^-6 relative to the sun may fit.
  vec3 radiance =
    ATMOSPHERE.solar_irradiance *
    0.000002 /
    (PI * angularRadius * angularRadius) *
    SUN_SPECTRAL_RADIANCE_TO_LUMINANCE;
  return radiance;
}

float intersectSphere(const vec3 ray, const vec3 point, const float radius) {
  vec3 P = -point;
  float PoR = dot(P, ray);
  float D = dot(P, P) - radius * radius;
  float discriminant = PoR * PoR - D;
  if (discriminant < 0.0) return -1.0;
  return -PoR - sqrt(discriminant);
}

// Oren-Nayar diffuse for moon surface
float orenNayarDiffuse(const vec3 L, const vec3 V, const vec3 N) {
  float NoL = dot(N, L);
  float NoV = dot(N, V);
  float s = dot(L, V) - NoL * NoV;
  float t = mix(1.0, max(NoL, NoV), step(0.0, s));
  return max(0.0, NoL) * (0.62406015 + 0.41284404 * s / t);
}

void main() {
  vec3 cameraPosition = vCameraPosition;
  vec3 rayDirection = normalize(vRayDirection);

  vec3 transmittance;
  vec3 radiance;

  // Check if ray hits the ground (Earth surface)
  float groundHit = raySphereIntersection(cameraPosition, rayDirection, ATMOSPHERE.bottom_radius);

  if (groundHit > 0.0) {
    // Ray hits ground - but check if sun is just behind the limb
    // If so, render a bright corona/glow effect for lens flare
    vec3 hitPoint = cameraPosition + rayDirection * groundHit;
    vec3 hitNormal = normalize(hitPoint);

    // Calculate how close the sun is to being at the limb
    float sunDotNormal = dot(sunDirection, hitNormal);
    float viewDotSun = dot(rayDirection, sunDirection);

    // Sun is behind the limb when sunDotNormal < 0 (sun below horizon at hit point)
    // and viewDotSun > 0 (looking toward sun direction)
    if (sunDotNormal < 0.1 && viewDotSun > 0.9) {
      // Calculate limb proximity - how close is the ray to grazing the surface
      float cameraToCenter = length(cameraPosition);
      float tangentDist = sqrt(cameraToCenter * cameraToCenter - ATMOSPHERE.bottom_radius * ATMOSPHERE.bottom_radius);
      float limbProximity = 1.0 - smoothstep(0.0, tangentDist * 0.01, groundHit - tangentDist);

      // Sun proximity to the limb point
      float sunLimbFactor = smoothstep(-0.1, 0.05, sunDotNormal) * smoothstep(0.9, 0.999, viewDotSun);

      // Bright corona glow
      float coronaIntensity = limbProximity * sunLimbFactor * 50.0;
      if (coronaIntensity > 0.01) {
        vec3 coronaColor = vec3(1.0, 0.9, 0.7) * coronaIntensity;
        outputColor = vec4(coronaColor, 1.0);
        return;
      }
    }

    // Normal ground hit - discard
    discard;
  }

  // Ray goes to space - render sky radiance
  radiance = GetSkyRadiance(
    cameraPosition,
    rayDirection,
    0.0,  // shadowLength
    sunDirection,
    transmittance
  );

  // Boost sky brightness for more visible atmosphere
  float skyIntensity = 5.0;
  radiance *= skyIntensity;

  // Render sun disk
  float viewDotSun = dot(rayDirection, sunDirection);
  // sun_angular_radius is about 0.00467 radians (~0.27 degrees)
  float sunAngularRadius = 0.00467;  // Real sun angular radius
  if (viewDotSun > cos(sunAngularRadius)) {
    vec3 ddx = dFdx(rayDirection);
    vec3 ddy = dFdy(rayDirection);
    float fragmentAngle = length(ddx + ddy) / length(rayDirection);

    float angle = acos(clamp(viewDotSun, -1.0, 1.0));
    float antialias = smoothstep(
      sunAngularRadius,
      sunAngularRadius - fragmentAngle,
      angle
    );
    // Sun should be very bright for lens flare to work
    // GetSolarRadiance returns physically based luminance
    radiance += transmittance * GetSolarRadiance() * antialias * 0.001;
  }

  // Render moon disk
  float viewDotMoon = dot(rayDirection, moonDirection);
  if (viewDotMoon > cos(moonAngularRadius)) {
    vec3 ddx = dFdx(rayDirection);
    vec3 ddy = dFdy(rayDirection);
    float fragmentAngle = length(ddx + ddy) / length(rayDirection);

    // Calculate angle from moon center
    float moonAngle = acos(clamp(viewDotMoon, -1.0, 1.0));

    // Approximate moon surface normal for shading
    // Treat moon as facing camera but lit by sun
    vec2 diskOffset = vec2(0.0);
    if (moonAngle > 0.0001) {
      // Calculate offset from moon center in screen space
      vec3 toMoon = moonDirection;
      vec3 right = normalize(cross(toMoon, vec3(0.0, 1.0, 0.0)));
      vec3 up = cross(right, toMoon);
      vec3 offsetDir = rayDirection - toMoon * viewDotMoon;
      diskOffset = vec2(dot(offsetDir, right), dot(offsetDir, up)) / moonAngularRadius;
    }

    // Moon surface normal (hemisphere facing camera)
    float z = sqrt(max(0.0, 1.0 - dot(diskOffset, diskOffset)));
    vec3 moonNormal = normalize(diskOffset.x * cross(moonDirection, vec3(0.0, 1.0, 0.0)) +
                                 diskOffset.y * cross(cross(moonDirection, vec3(0.0, 1.0, 0.0)), moonDirection) +
                                 z * moonDirection);

    // Simple diffuse lighting from sun
    float diffuse = max(0.0, dot(moonNormal, sunDirection));

    // Anti-aliasing at the edge
    float moonAntialias = smoothstep(moonAngularRadius, moonAngularRadius - fragmentAngle, moonAngle);

    // Add moon radiance - make it visible!
    vec3 moonColor = vec3(0.9, 0.9, 0.85) * diffuse * 5.0; // Grayish moon color
    radiance += transmittance * moonColor * lunarRadianceScale * moonAntialias;
  }

  //후처리
  // Color tint for atmosphere (adjust RGB to change color)
  vec3 colorTint = vec3(1.2, 1.5, 0.9) * 1.2;  // More cyan
  radiance *= colorTint;

  // Sample starfield texture
  // rayDirection is in ECEF coordinates
  // Need to convert to J2000 equatorial coordinates for starmap
  //
  // Key insight: Stars rotate around celestial north pole (not Earth's pole)
  // So we must first transform to equatorial coords, THEN rotate by sidereal time

  // ECEF: X=lon0, Y=north pole, Z=lon90E
  // Starmap: equirectangular with celestial north at V=1
  //
  // Simple approach: just rotate by sidereal time around Y (north pole)
  // Skip obliquity for now - Polaris is only ~1° from celestial pole anyway

  // ECEF: X=lon0, Y=geographic north pole, Z=lon90E
  // Starmap: celestial coordinates (V=1 = celestial north pole, ~23.4° from geographic)
  //
  // Mapping fix:
  // Current: -Z = Polaris, +Z = south pole
  // Wanted:  +Y = Polaris, -Y = south pole
  // Solution: swap Y and Z (Y becomes new Z, Z becomes new Y)
  vec3 starDir = vec3(rayDirection.x, rayDirection.z, rayDirection.y);

  // Rotate by sidereal time around Y axis (north pole in starDir space)
  // Add 90° (PI/2) offset to fix 6-hour timing error
  float rotAngle = -starfieldRotation - PI * 0.5;
  float cosRot = cos(rotAngle);
  float sinRot = sin(rotAngle);
  starDir = vec3(
    starDir.x * cosRot + starDir.z * sinRot,
    starDir.y,
    -starDir.x * sinRot + starDir.z * cosRot
  );

  // Convert to equirectangular UV
  float starU = atan(starDir.x, starDir.z) / (2.0 * PI) + 0.5;
  float starV = asin(clamp(starDir.y, -1.0, 1.0)) / PI + 0.5;
  vec3 starColor = texture(starfieldTexture, vec2(starU, starV)).rgb;

  // Apply gamma to boost dim stars
  starColor = pow(starColor, vec3(0.8));

  // Add stars where atmosphere is thin (transmittance high, radiance low)
  float atmosphereDensity = length(radiance) / (length(colorTint) * 5.0);
  float starVisibility = smoothstep(0.1, 0.0, atmosphereDensity);
  radiance += starColor * starVisibility * 2.0;

  // Output raw radiance - tone mapping will be done by postprocessing
  outputColor = vec4(radiance, 1.0);
}
