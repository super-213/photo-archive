"use client";
import { ProjectArrangement } from "./project-arrangement";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  categories,
  categoryLabels,
  coverLayouts,
  coverLayoutLabels,
  coverRatios,
  coverRatioLabels,
  type CoverSettings,
  type Photo,
  type Project,
  type ProjectPhotoInput,
} from "@/lib/content";
import { adminRequest } from "./api";
import { CoverImage } from "../project-cover";

export function ProjectEditor({
  initialProject,
  photos,
}: {
  initialProject: Project | null;
  photos: Photo[];
}) {
  const router = useRouter();
  const [project, setProject] = useState(initialProject);
  const [items, setItems] = useState<ProjectPhotoInput[]>(
    initialProject?.items || [],
  );
  const [cover, setCover] = useState(initialProject?.coverPhotoId || "");
  const [coverSettings, setCoverSettings] = useState<CoverSettings>({
    coverLayout: initialProject?.coverLayout ?? "lead",
    coverRatio: initialProject?.coverRatio ?? "original",
    coverFocusX: initialProject?.coverFocusX ?? 50,
    coverFocusY: initialProject?.coverFocusY ?? 50,
  });
  const coverPhoto = photos.find((photo) => photo.id === cover);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <>
      <Link className="text-link" href="/admin/projects">
        ← 全部系列
      </Link>
      <div className="admin-title">
        <div>
          <p className="eyebrow">策展</p>
          <h1>{project ? "编辑摄影系列" : "创建摄影系列"}</h1>
        </div>
        {project?.status === "published" && (
          <Link
            href={`/works/${project.slug}`}
            target="_blank"
            className="admin-small-button"
          >
            查看已发布系列 ↗
          </Link>
        )}
      </div>
      <form
        className="admin-form project-editor"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          setNotice("");
          const data = Object.fromEntries(new FormData(event.currentTarget));
          try {
            const result = await adminRequest<Project>(
              project
                ? `/api/admin/projects/${project.id}`
                : "/api/admin/projects",
              project ? "PUT" : "POST",
              {
                ...data,
                version: project?.version || 0,
                sortOrder: Number(data.sortOrder),
                coverPhotoId: cover,
                ...coverSettings,
                items,
              },
            );
            setProject(result);
            setItems(result.items);
            setCoverSettings({
              coverLayout: result.coverLayout,
              coverRatio: result.coverRatio,
              coverFocusX: result.coverFocusX,
              coverFocusY: result.coverFocusY,
            });
            setNotice(
              result.status === "published"
                ? "系列已发布，前台已更新。"
                : "草稿已保存。",
            );
            if (!project) router.replace(`/admin/projects/${result.id}`);
            router.refresh();
          } catch (error) {
            setError(error instanceof Error ? error.message : "保存失败");
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy} className="project-metadata">
          <div className="form-pair">
            <label>
              系列名称
              <input
                name="title"
                defaultValue={project?.title}
                required
                maxLength={200}
              />
            </label>
            <label>
              网址标识
              <input
                name="slug"
                defaultValue={project?.slug}
                required
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                placeholder="my-photo-series"
                maxLength={100}
              />
            </label>
          </div>
          <div className="form-pair">
            <label>
              副标题（选填）
              <input
                name="subtitle"
                defaultValue={project?.subtitle}
                maxLength={200}
              />
            </label>
            <label>
              年份或时间范围
              <input name="year" defaultValue={project?.year} maxLength={30} />
            </label>
          </div>
          <label>
            系列简介
            <textarea
              name="description"
              rows={2}
              defaultValue={project?.description}
              maxLength={3000}
            />
          </label>
          <div className="form-triple">
            <label>
              题材
              <select
                name="category"
                defaultValue={project?.category || "Landscape"}
              >
                {categories.map((value) => (
                  <option key={value} value={value}>
                    {categoryLabels[value]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              状态
              <select name="status" defaultValue={project?.status || "draft"}>
                <option value="draft">草稿</option>
                <option value="published">发布</option>
              </select>
            </label>
            <label>
              展示顺序
              <input
                name="sortOrder"
                type="number"
                min={0}
                max={100000}
                defaultValue={project?.sortOrder || 0}
                required
              />
            </label>
          </div>
        </fieldset>
        <section className="project-cover-editor">
          <div className="editor-title"><h2>所见封面</h2></div>
          <fieldset disabled={busy}>
            <div className="form-pair">
              <label>
                首页版位
                <select value={coverSettings.coverLayout} onChange={(event) => setCoverSettings({
                  ...coverSettings, coverLayout: event.target.value as CoverSettings["coverLayout"],
                })}>
                  {coverLayouts.map((value) => <option key={value} value={value}>{coverLayoutLabels[value]}</option>)}
                </select>
              </label>
              <label>
                封面比例
                <select value={coverSettings.coverRatio} onChange={(event) => setCoverSettings({
                  ...coverSettings, coverRatio: event.target.value as CoverSettings["coverRatio"],
                })}>
                  {coverRatios.map((value) => <option key={value} value={value}>{coverRatioLabels[value]}</option>)}
                </select>
              </label>
            </div>
            {coverSettings.coverRatio !== "original" && (
              <div className="form-pair">
                <label>
                  水平裁切重心 · {coverSettings.coverFocusX}%
                  <input type="range" min="0" max="100" value={coverSettings.coverFocusX}
                    onChange={(event) => setCoverSettings({ ...coverSettings, coverFocusX: Number(event.target.value) })} />
                </label>
                <label>
                  垂直裁切重心 · {coverSettings.coverFocusY}%
                  <input type="range" min="0" max="100" value={coverSettings.coverFocusY}
                    onChange={(event) => setCoverSettings({ ...coverSettings, coverFocusY: Number(event.target.value) })} />
                </label>
              </div>
            )}
          </fieldset>
          {coverPhoto ? (
            <div className={`cover-preview cover-preview-${coverSettings.coverLayout}`}>
              <CoverImage photo={coverPhoto} settings={coverSettings} sizes="(max-width: 767px) 85vw, 600px" />
            </div>
          ) : <p className="admin-muted">在下方系列照片中选择封面后，即可预览。</p>}
          <p className="admin-muted">版位随系列保存。调整展示顺序后仍使用该版位，照片原比例保留完整画面。</p>
        </section>
        <ProjectArrangement
          items={items}
          onChange={setItems}
          photos={photos}
          cover={cover}
          onCover={setCover}
          busy={busy}
        />
        <div className="project-savebar">
          {error && (
            <p className="admin-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="admin-notice" role="status">
              {notice}
            </p>
          )}
          <p className="admin-muted">
            发布时需要封面，且所有关联照片均为公开状态。展示顺序数值越小越靠前。
          </p>
          <button className="admin-button" disabled={busy}>
            {busy ? "正在保存…" : "保存系列"}
          </button>
        </div>
      </form>
      {project && (
        <div className="project-delete">
          {confirmDelete ? (
            <>
              <p>删除该系列及照片关联？照片会继续保留在媒体库。</p>
              <button
                className="admin-small-button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await adminRequest(
                      `/api/admin/projects/${project.id}`,
                      "DELETE",
                      { version: project.version },
                    );
                    router.push("/admin/projects");
                    router.refresh();
                  } catch (error) {
                    setError(
                      error instanceof Error ? error.message : "删除失败",
                    );
                    setBusy(false);
                  }
                }}
              >
                确认删除系列
              </button>
              <button
                className="admin-small-button"
                onClick={() => setConfirmDelete(false)}
              >
                取消
              </button>
            </>
          ) : (
            <button
              className="admin-small-button"
              onClick={() => setConfirmDelete(true)}
            >
              删除系列
            </button>
          )}
        </div>
      )}
    </>
  );
}
