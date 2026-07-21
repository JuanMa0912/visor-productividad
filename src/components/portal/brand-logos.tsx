/**
 * Logos estáticos desde public/logos/. Usamos <img> nativo (no next/image) porque
 * en standalone el optimizador /_next/image suele fallar con "received null"
 * aunque los JPEG existan en .next/standalone/public/logos/.
 */

type BrandLogoProps = {
  className?: string;
};

export function MercamioLogo({ className }: BrandLogoProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static public asset; bypass image optimizer
    <img
      src="/logos/mercamio.jpeg"
      alt="MercaMio"
      width={210}
      height={68}
      className={className}
      decoding="async"
    />
  );
}

export function MercatodoLogo({ className }: BrandLogoProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static public asset; bypass image optimizer
    <img
      src="/logos/mercatodo.jpeg"
      alt="MercaTodo"
      width={210}
      height={68}
      className={className}
      decoding="async"
    />
  );
}

export function MerkmiosLogo({ className }: BrandLogoProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static public asset; bypass image optimizer
    <img
      src="/logos/merkmios.png"
      alt="MerkMios"
      width={210}
      height={70}
      className={className}
      decoding="async"
    />
  );
}

export function DinastiaLogo({ className }: BrandLogoProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static public asset; bypass image optimizer
    <img
      src="/logos/dinastia.png"
      alt="Outlet Dinastía"
      width={210}
      height={99}
      className={className}
      decoding="async"
    />
  );
}
