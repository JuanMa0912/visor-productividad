import { ImageResponse } from "next/og";
import {
  UAID_LOGO_GRADIENT,
  UAID_LOGO_NODES,
  UAID_LOGO_U_PATH,
  UAID_LOGO_U_STROKE,
  uaidLogoEdgePoints,
} from "@/lib/shared/uaid-logo";

/**
 * Apple touch icon. Misma marca UAID que el favicon, a 180px.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  const edges = uaidLogoEdgePoints();

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
          {edges.map((edge) => (
            <line
              key={`${edge.from.cx}-${edge.to.cx}`}
              x1={edge.from.cx}
              y1={edge.from.cy}
              x2={edge.to.cx}
              y2={edge.to.cy}
              stroke="#fff"
              strokeWidth="1.15"
              strokeLinecap="round"
            />
          ))}
          {UAID_LOGO_NODES.map((node) => (
            <circle
              key={`${node.cx}-${node.cy}`}
              cx={node.cx}
              cy={node.cy}
              r={node.r}
              fill="#fff"
            />
          ))}
        </svg>
      </div>
    ),
    { ...size },
  );
}
