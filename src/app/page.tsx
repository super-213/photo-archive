import { PhotoImage } from "@/components/photo-image";
import Link from "next/link";
import { Arrow } from "@/components/icons";
import { ProjectCover } from "@/components/project-cover";
import { categoryLabels, getCover } from "@/lib/content";
import { listProjects } from "@/lib/server/store";
export const dynamic = "force-dynamic";

export default function Home() {
  const projects = listProjects();
  const firstProject = projects[0];
  const hero = firstProject && getCover(firstProject);
  return (
    <>
      <section className="home-intro page-gutter">
        <div className="home-heading">
          <p className="eyebrow">个人摄影集</p>
          <h1>
            收集
            <br />
            <em lang="zh-CN">片刻。</em>
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
      {hero && (
        <section className="hero-section page-gutter" aria-label="首页精选摄影">
          <Link href={`/works/${firstProject.slug}`} className="hero-photo">
            <PhotoImage
              photo={hero}
              fill
              loading="eager"
              fetchPriority="high"
              sizes="100vw"
            />
            <span className="hero-open">
              {firstProject.subtitle || firstProject.title} <Arrow />
            </span>
          </Link>
          <div className="image-credit">
            <span>{firstProject.title.toUpperCase()}</span>
            <span>
              {categoryLabels[firstProject.category]}
              {hero.isSample ? " · 示例系列" : ""}
            </span>
          </div>
        </section>
      )}
      <section className="selected-section page-gutter" id="selected">
        <div className="section-heading">
          <div>
            <p className="eyebrow">所见</p>
            <h2>目光所及。</h2>
          </div>
          <Link href="/works" className="text-link">
            浏览所见 <Arrow />
          </Link>
        </div>
        <div className="editorial-grid">
          {projects.map((project, index) => (
            <ProjectCover key={project.slug} project={project} index={index} />
          ))}
        </div>
      </section>
      <section className="archive-invitation page-gutter">
        <p className="eyebrow">所藏</p>
        <Link href="/archive">
          <h2>
            每一帧，
            <br />
            <em lang="zh-CN">一段记忆。</em>
          </h2>
          <span className="text-link">
            浏览所藏 <Arrow />
          </span>
        </Link>
      </section>
    </>
  );
}
