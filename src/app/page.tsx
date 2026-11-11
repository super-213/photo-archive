import Image from "next/image";
import Link from "next/link";
import { Arrow } from "@/components/icons";
import { ProjectCover } from "@/components/project-cover";
import { getPhoto, projects } from "@/lib/content";

export default function Home() {
  const hero = getPhoto("fuji");
  return (
    <>
      <section className="home-intro page-gutter">
        <div className="home-heading">
          <p className="eyebrow">A personal photographic journal</p>
          <h1>
            A collection
            <br />
            of <em>moments.</em>
          </h1>
        </div>
        <div className="home-intro-aside">
          <p>
            走过的地方，
            <br />
            停下来的瞬间。
          </p>
          <a className="text-link" href="#selected">
            探索作品 <Arrow direction="down" />
          </a>
        </div>
      </section>
      <section className="hero-section page-gutter" aria-label="首页精选摄影">
        <Link href="/works/stillness" className="hero-photo">
          <Image
            src={hero.src}
            alt={hero.alt}
            fill
            loading="eager"
            fetchPriority="high"
            sizes="100vw"
          />
          <span className="hero-open">
            山水之间 <Arrow />
          </span>
        </Link>
        <div className="image-credit">
          <span>THE SHAPE OF STILLNESS</span>
          <span>Landscape · 示例系列</span>
        </div>
      </section>
      <section className="selected-section page-gutter" id="selected">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Selected works</p>
            <h2>目光所及。</h2>
          </div>
          <Link href="/works" className="text-link">
            全部系列 <Arrow />
          </Link>
        </div>
        <div className="editorial-grid">
          {projects.map((project, index) => (
            <ProjectCover key={project.slug} project={project} index={index} />
          ))}
        </div>
      </section>
      <section className="archive-invitation page-gutter">
        <p className="eyebrow">The archive</p>
        <Link href="/archive">
          <h2>
            Every frame,
            <br />
            <em>a little memory.</em>
          </h2>
          <span className="text-link">
            浏览全部照片 <Arrow />
          </span>
        </Link>
      </section>
    </>
  );
}
