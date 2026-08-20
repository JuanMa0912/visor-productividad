import { ImageResponse } from "next/og";
import {
  UAID_LOGO_GRADIENT,
  UAID_LOGO_ORBIT_STROKE,
  UAID_LOGO_U_PATH,
  UAID_LOGO_U_STROKE,
  uaidLogoOrbitPaths,
} from "@/lib/shared/uaid-logo";

/**
 * Favicon dinamico del Portal UAID.
 * Misma marca que la barra: U + dos órbitas.
 */
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  const orbits = uaidLogoOrbitPaths();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: `linear-gradient(135deg, ${UAID_LOGO_GRADIENT[0].color} 0%, ${UAID_LOGO_GRADIENT[1].color} 46%, ${UAID_LOGO_GRADIENT[2].color} 100%)`,
        }}
      >
        <svg width="32" height="32" viewBox="0 0 32 32">
          {orbits.map((d) => (
            <path
              key={d}
              d={d}
              fill="none"
              stroke="#fff"
              strokeWidth={UAID_LOGO_ORBIT_STROKE}
              strokeLinecap="round"
              opacity={0.82}
            />
          ))}
          <path
            d={UAID_LOGO_U_PATH}
            fill="none"
            stroke="#fff"
            strokeWidth={UAID_LOGO_U_STROKE}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    ),
    { ...size },
  );
}
