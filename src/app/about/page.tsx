import type { Metadata } from "next";
import { PhotoImage } from "@/components/photo-image";
import Link from "next/link";
import { Arrow } from "@/components/icons";
import { listPhotos } from "@/lib/server/store";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "About · 关于" };

export default function About() {
  const publicPhotos = listPhotos();
  const photo =
    publicPhotos.find((item) => item.id === "lakeside") || publicPhotos[0];
  const samples = publicPhotos.filter((item) => item.isSample && item.source);
  return (
    <div className="about-page page-gutter">
      <header className="page-heading">
        <div>
          <p className="eyebrow">关于这个作品集</p>
          <h1>
            A way of <em>seeing.</em>
          </h1>
        </div>
      </header>
      <section className="about-content">
        {photo && (
          <PhotoImage photo={photo} sizes="(max-width: 767px) 90vw, 50vw" />
        )}
        <div>
          <h2>
            给经过的世界，
            <br />
            留一个位置。
          </h2>
          <p>
            这里收集风光、街巷与微小世界里的片刻。通过摄影系列慢慢观看，也可以在档案里自由寻找。
          </p>
          <p>
            Photo Archive
            是当前使用的临时站点名称。个人介绍与联系信息将在正式作品入库时补充。
          </p>
          <Link href="/works" className="text-link">
            浏览摄影系列 <Arrow />
          </Link>
        </div>
      </section>
      <section className="credits" id="credits">
        <p className="eyebrow">素材说明</p>
        <h2>示例照片与来源</h2>
        <p>
          当前展示的 {samples.length} 张样例照片来自
          Unsplash，用于验证网站布局与交互。系列名称、描述与年份为演示编排，年份代表示例分组。拍摄日期和器材信息尚未录入。各照片版权归原作者所有。
        </p>
        <ul>
          {samples.map((photo) => (
            <li key={photo.id}>
              <span>{photo.title}</span>
              <a href={photo.source} target="_blank" rel="noreferrer">
                Unsplash 原始来源 ↗
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
