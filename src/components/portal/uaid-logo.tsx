"use client";

import { useId } from "react";
import {
  UAID_LOGO_GRADIENT,
  UAID_LOGO_PATHS,
  UAID_LOGO_STROKE,
  UAID_LOGO_VIEWBOX,
} from "@/lib/shared/uaid-logo";

type UaidLogoProps = {
  className?: string;
};

function UaidLogoGlyph() {
  return (
    <g
      fill="none"
      stroke="currentColor"
      strokeWidth={UAID_LOGO_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {UAID_LOGO_PATHS.map((d) => (
        <path key={d} d={d} />
      ))}
    </g>
  );
}

/**
 * Marca UAID a color para la barra del portal.
 * Cerebro en línea blanca.
 */
export function UaidLogoMark({ className }: UaidLogoProps) {
  const rawId = useId();
  const uid = rawId.replace(/:/g, "");
  const fillId = `uaid-fill-${uid}`;
  const shineId = `uaid-shine-${uid}`;

  return (
    <svg
      viewBox={UAID_LOGO_VIEWBOX}
      className={className}
      aria-hidden
      focusable="false"
    >
      <defs>
        <linearGradient
          id={fillId}
          x1="5"
          y1="3"
          x2="28"
          y2="30"
          gradientUnits="userSpaceOnUse"
        >
          {UAID_LOGO_GRADIENT.map((stop) => (
            <stop
              key={stop.offset}
              offset={stop.offset}
              stopColor={stop.color}
            />
          ))}
        </linearGradient>
        <linearGradient
          id={shineId}
          x1="8"
          y1="2"
          x2="22"
          y2="18"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#fff" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${fillId})`} />
      <rect width="32" height="32" rx="9" fill={`url(#${shineId})`} />
      <g className="text-white" style={{ color: "#fff" }}>
        <UaidLogoGlyph />
      </g>
    </svg>
  );
}

/** Glifo monocromo para impresión (hereda currentColor). */
export function UaidLogoGlyphSvg({ className }: UaidLogoProps) {
  return (
    <svg
      viewBox={UAID_LOGO_VIEWBOX}
      className={className}
      aria-hidden
      focusable="false"
    >
      <UaidLogoGlyph />
    </svg>
  );
}
