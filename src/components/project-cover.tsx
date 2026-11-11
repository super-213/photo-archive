import Image from "next/image";
import Link from "next/link";
import { getPhoto, getProjectPhotos, type Project } from "@/lib/content";
import { Arrow } from "./icons";

export function ProjectCover({
  project,
  index,
}: {
  project: Project;
  index: number;
}) {
  const cover = getPhoto(project.coverPhotoId);
  return (
    <Link
      href={`/works/${project.slug}`}
      className={`project-cover project-cover-${index + 1}`}
    >
      <div className="cover-image">
        <Image
          src={cover.src}
          alt={cover.alt}
          width={cover.width}
          height={cover.height}
          sizes="(max-width: 767px) 90vw, 60vw"
        />
      </div>
      <div className="cover-caption">
        <div>
          <span className="eyebrow">
            {project.subtitle} / {getProjectPhotos(project).length} photographs
          </span>
          <h3>{project.title}</h3>
        </div>
        <Arrow />
      </div>
    </Link>
  );
}
