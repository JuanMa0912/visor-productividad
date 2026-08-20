import { ImageResponse } from "next/og";
import {
  UAID_LOGO_DOT,
  UAID_LOGO_GRADIENT,
  UAID_LOGO_U_PATH,
  UAID_LOGO_U_STROKE,
} from "@/lib/shared/uaid-logo";

/**
 * Apple touch icon. Misma marca UAID que el favicon, a 180px.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          borderRadius: 40,
          overflow: "hidden",
          background: `linear-gradient(135deg, ${UAID_LOGO_GRADIENT[0].color} 0%, ${UAID_LOGO_GRADIENT[1].color} 46%, ${UAID_LOGO_GRADIENT[2].color} 100%)`,
        }}
      >
        <svg width="180" height="180" viewBox="0 0 32 32">
          <path
            d={UAID_LOGO_U_PATH}
            fill="none"
            stroke="#fff"
            strokeWidth={UAID_LOGO_U_STROKE}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle
            cx={UAID_LOGO_DOT.cx}
            cy={UAID_LOGO_DOT.cy}
            r={UAID_LOGO_DOT.r}
            fill="#fff"
          />
        </svg>
      </div>
    ),
    { ...size },
  );
}
