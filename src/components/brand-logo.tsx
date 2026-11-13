import { site } from "@/lib/content";
import styles from "./brand-logo.module.css";

export function BrandLogo({ light = false, small = false }: { light?: boolean; small?: boolean }) {
  return (
    <span className={`${styles.logo}${light ? ` ${styles.light}` : ""}${small ? ` ${styles.small}` : ""}`}>
      <img src={light ? "/logo-light.svg" : "/logo.svg"} width={52} height={52} alt="" aria-hidden="true" />
      <span>{site.wordmark}</span>
    </span>
  );
}
