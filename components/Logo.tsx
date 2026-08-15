/**
 * 낰낰컴퍼니 공식 로고 — 더블 K 모노그램.
 * 원본 에셋: public/brand/
 */
export default function Logo({
  className = "",
  size = 36,
  tile = "#2D336B",
}: {
  className?: string;
  size?: number;
  /** Background tile color — override on dark surfaces */
  tile?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <rect width="64" height="64" rx="16" fill={tile} />
      <path
        d="M17 16v32M17 32l13-16M17 32l13 16"
        stroke="#F7F8FC"
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M36 16v32M36 32l13-16M36 32l13 16"
        stroke="#7886C7"
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
