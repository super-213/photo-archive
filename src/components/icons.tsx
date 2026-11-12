export function Arrow({
  direction = "right",
  className = "",
}: {
  direction?: "right" | "left" | "down";
  className?: string;
}) {
  const rotation = direction === "left" ? 180 : direction === "down" ? 90 : 0;
  return (
    <svg
      className={className}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{ transform: `rotate(${rotation}deg)` }}
    >
      <path d="M4 12h15M13 5l7 7-7 7" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

export function Close() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path d="m6 6 12 12M6 18 18 6" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

export function Adjustments() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M3 5h5m4 0h9M3 12h11m4 0h3M3 19h4m4 0h10" />
      <path d="M10 2.5v5M16 9.5v5M9 16.5v5" />
    </svg>
  );
}
