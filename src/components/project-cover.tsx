import { PhotoImage } from "@/components/photo-image";
import Link from "next/link";
import {
  coverAspectRatios,
  type CoverSettings,
  type Photo,
  type ProjectCoverData,
} from "@/lib/content";
import type { CSSProperties } from "react";
import { Arrow } from "./icons";

export function CoverImage({
  photo,
  settings,
  priority = false,
  sizes,
}: {
  photo: Photo;
  settings: CoverSettings;
  priority?: boolean;
  sizes: string;
}) {
  return (
    <div
      className="cover-image"
      style={{
        "--cover-ratio": settings.coverRatio === "original"
          ? `${photo.width} / ${photo.height}`
          : coverAspectRatios[settings.coverRatio],
        "--cover-position": `${settings.coverFocusX}% ${settings.coverFocusY}%`,
      } as CSSProperties}
    >
      <PhotoImage
        photo={photo}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        sizes={sizes}
      />
    </div>
  );
}

export function ProjectCover({
  project,
  index,
}: {
  project: ProjectCoverData;
  index: number;
}) {
  const cover = project.cover;
  if (!cover) return null;
  return (
    <Link
      href={`/works/${project.slug}`}
      className={`project-cover project-cover-${project.coverLayout}`}
    >
      <CoverImage
        photo={cover}
        settings={project}
        priority={index === 0}
        sizes={
          project.coverLayout === "offset"
            ? "(max-width: 767px) calc((100vw - 44px) * 0.8), (max-width: 1199px) 38vw, (min-width: 1600px) 460px, 30vw"
            : project.coverLayout === "wide"
              ? "(max-width: 767px) calc(100vw - 44px), (min-width: 1600px) 950px, 60vw"
              : "(max-width: 767px) calc(100vw - 44px), (min-width: 1600px) 830px, 53vw"
        }
      />
      <div className="cover-caption">
        <div>
          {project.subtitle && (
            <span className="eyebrow">{project.subtitle}</span>
          )}
          <h3>{project.title}</h3>
        </div>
        <Arrow />
      </div>
    </Link>
  );
}
