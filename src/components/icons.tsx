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
