import { site } from "@/lib/content";
import styles from "./brand-logo.module.css";

export function BrandLogo({ light = false, small = false }: { light?: boolean; small?: boolean }) {
  const iconSize = small ? 18 : 28;
  return (
    <span className={`${styles.logo}${light ? ` ${styles.light}` : ""}${small ? ` ${styles.small}` : ""}`}>
      <img src={light ? "/logo-light.svg" : "/logo.svg"} width={iconSize} height={iconSize} alt="" aria-hidden="true" />
      <span>{site.wordmark}</span>
    </span>
  );
}
