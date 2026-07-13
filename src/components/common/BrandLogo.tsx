import logoUrl from '../../assets/labnexus-logo.svg';

interface BrandLogoProps {
  size?: number;
  className?: string;
}

export function BrandLogo({ size = 64, className }: BrandLogoProps) {
  return (
    <img
      src={logoUrl}
      width={size}
      height={size}
      className={className}
      alt="LabNexus"
      draggable={false}
    />
  );
}
