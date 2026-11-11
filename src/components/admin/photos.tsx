"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { categories, categoryLabels, type Photo } from "@/lib/content";
import { adminRequest } from "./api";

const visibilityLabels = { draft: "草稿", public: "公开", private: "私有" };
type UploadItem = {
  id: number;
  file: File;
  state: "waiting" | "uploading" | "done" | "error";
  message: string;
};

export function PhotoManager({ initialPhotos }: { initialPhotos: Photo[] }) {
  const [photos, setPhotos] = useState(initialPhotos);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [queue, setQueue] = useState<UploadItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState("");
  const nextId = useRef(0);
  const selected = photos.find((photo) => photo.id === selectedId);
  const visible = photos.filter(
    (photo) =>
      (filter === "all" || photo.visibility === filter) &&
      `${photo.title} ${photo.tags.join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );

  async function upload(items: UploadItem[]) {
    setUploading(true);
    for (const item of items) {
      setQueue((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? { ...entry, state: "uploading", message: "正在上传与生成展示图…" }
            : entry,
        ),
      );
      try {
        if (!item.file.size || item.file.size > 32 * 1024 * 1024)
          throw new Error("单张照片最大 32 MB");
        const data = new FormData();
        data.set("file", item.file);
        const result = await adminRequest<{ photo: Photo; duplicate: boolean }>(
          "/api/admin/photos",
          "POST",
          data,
        );
        setPhotos((current) =>
          current.some((photo) => photo.id === result.photo.id)
            ? current
            : [result.photo, ...current],
        );
        setQueue((current) =>
          current.map((entry) =>
            entry.id === item.id
              ? {
                  ...entry,
                  state: "done",
                  message: result.duplicate
                    ? "已存在，沿用原照片及编辑信息"
                    : "上传完成 · 草稿",
                }
              : entry,
          ),
        );
      } catch (error) {
        setQueue((current) =>
          current.map((entry) =>
            entry.id === item.id
              ? {
                  ...entry,
                  state: "error",
                  message: error instanceof Error ? error.message : "上传失败",
                }
              : entry,
          ),
        );
      }
    }
    setUploading(false);
  }

  return (
    <>
      <div className="admin-title">
        <div>
          <p className="eyebrow">媒体库</p>
          <h1>照片管理</h1>
          <p className="admin-muted">
            上传后进入草稿。设为私有或草稿时，相关已发布系列会自动退回草稿。
          </p>
        </div>
        <label
          className={`admin-button upload-label ${uploading ? "disabled" : ""}`}
        >
          {uploading ? "正在处理…" : "上传照片 +"}
          <input
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,image/avif,image/tiff,.tif,.tiff"
            disabled={uploading}
            onChange={(event) => {
              const items = Array.from(event.target.files || []).map(
                (file) => ({
                  id: nextId.current++,
                  file,
                  state: "waiting" as const,
                  message: "等待上传",
                }),
              );
              setQueue((current) => [
                ...current.filter((item) => item.state === "error"),
                ...items,
              ]);
              event.target.value = "";
              void upload(items);
            }}
          />
        </label>
      </div>
      <p className="admin-upload-hint">
        JPEG / PNG / WebP / AVIF / TIFF · 单张最大 32 MB · 支持多选
      </p>
      {queue.length > 0 && (
        <section
          className="upload-queue"
          aria-label="上传进度"
          aria-live="polite"
        >
          {queue.map((item) => (
            <div key={item.id}>
              <span>{item.file.name}</span>
              <span
                className={
                  item.state === "error" ? "admin-error" : "admin-muted"
                }
              >
                {item.message}
              </span>
              {item.state === "error" && (
                <button
                  className="admin-small-button"
                  disabled={uploading}
                  onClick={() => void upload([item])}
                >
                  重试
                </button>
              )}
            </div>
          ))}
          {!uploading && (
            <button className="admin-small-button" onClick={() => setQueue([])}>
              清空上传记录
            </button>
          )}
        </section>
      )}
      {notice && (
        <p role="status" className="admin-notice">
          {notice}
        </p>
      )}
      <div className="admin-filterbar">
        <label>
          公开状态
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="all">全部状态</option>
            {Object.entries(visibilityLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          查找照片
          <input
            type="search"
            placeholder="标题或标签"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <span className="admin-muted">
          {visible.length} / {photos.length} 张照片
        </span>
      </div>
      <div className="admin-photo-workspace">
        <div className="admin-photo-grid">
          {visible.map((photo) => (
            <button
              className="admin-photo-item"
              key={photo.id}
              aria-pressed={photo.id === selectedId}
              onClick={() => {
                setSelectedId(photo.id);
                setNotice("");
              }}
            >
              <Image
                src={photo.thumbnailSrc}
                alt={photo.alt}
                width={photo.width}
                height={photo.height}
              />
              <span>
                <strong>{photo.title}</strong>
                <span>{visibilityLabels[photo.visibility]}</span>
              </span>
            </button>
          ))}
          {!visible.length && (
            <p className="admin-muted admin-empty">当前没有符合条件的照片。</p>
          )}
        </div>
        {selected && (
          <PhotoEditor
            key={`${selected.id}-${selected.version}`}
            photo={selected}
            onClose={() => setSelectedId(null)}
            onSave={(photo, unpublished) => {
              setPhotos((current) =>
                current.map((item) => (item.id === photo.id ? photo : item)),
              );
              setNotice(
                `已保存${unpublished ? `，${unpublished} 个相关系列已退回草稿` : ""}`,
              );
            }}
          />
        )}
      </div>
    </>
  );
}

function PhotoEditor({
  photo,
  onClose,
  onSave,
}: {
  photo: Photo;
  onClose: () => void;
  onSave: (photo: Photo, unpublished: number) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editor = useRef<HTMLElement>(null);
  useEffect(() => {
    if (window.matchMedia("(max-width: 767px)").matches)
      editor.current?.scrollIntoView({ block: "start" });
  }, [photo.id]);
  return (
    <section
      ref={editor}
      className="photo-editor"
      aria-label={`编辑照片 ${photo.title}`}
    >
      <div className="editor-title">
        <h2>照片信息</h2>
        <button className="admin-small-button" onClick={onClose}>
          关闭 ×
        </button>
      </div>
      <Image
        src={photo.src}
        alt={photo.alt}
        width={photo.width}
        height={photo.height}
      />
      <form
        className="admin-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          const data = Object.fromEntries(new FormData(event.currentTarget));
          try {
            const result = await adminRequest<{
              photo: Photo;
              unpublished: number;
            }>(`/api/admin/photos/${photo.id}`, "PUT", {
              ...data,
              version: photo.version,
              tags: String(data.tags)
                .split(/[,，]/)
                .map((tag) => tag.trim())
                .filter(Boolean),
            });
            onSave(result.photo, result.unpublished);
          } catch (error) {
            setError(error instanceof Error ? error.message : "保存失败");
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy}>
          <label>
            标题
            <input
              name="title"
              defaultValue={photo.title}
              required
              maxLength={200}
            />
          </label>
          <label>
            图片替代文本
            <input
              name="alt"
              defaultValue={photo.alt}
              required
              maxLength={500}
            />
          </label>
          <div className="form-pair">
            <label>
              公开状态
              <select name="visibility" defaultValue={photo.visibility}>
                {Object.entries(visibilityLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              题材
              <select name="category" defaultValue={photo.category}>
                {categories.map((value) => (
                  <option key={value} value={value}>
                    {categoryLabels[value]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-pair">
            <label>
              年份
              <input
                name="year"
                defaultValue={photo.year}
                maxLength={4}
                pattern="[0-9]{4}|"
              />
            </label>
            <label>
              拍摄日期
              <input
                type="date"
                name="capturedAt"
                defaultValue={photo.capturedAt}
              />
            </label>
          </div>
          <label>
            地点
            <input
              name="location"
              defaultValue={photo.location}
              maxLength={200}
            />
          </label>
          <label>
            标签
            <input
              name="tags"
              defaultValue={photo.tags.join(", ")}
              placeholder="用逗号分隔"
            />
          </label>
          <label>
            简短描述
            <textarea
              name="description"
              defaultValue={photo.description}
              maxLength={3000}
              rows={3}
            />
          </label>
          <details>
            <summary>器材与拍摄参数</summary>
            {(
              [
                { name: "cameraMake", label: "机身品牌" },
                { name: "cameraModel", label: "机身型号" },
                { name: "lensModel", label: "镜头" },
                { name: "focalLength", label: "焦距" },
                { name: "aperture", label: "光圈" },
                { name: "shutterSpeed", label: "快门" },
                { name: "iso", label: "ISO" },
              ] as const
            ).map(({ name, label }) => (
              <label key={name}>
                {label}
                <input name={name} defaultValue={photo[name]} maxLength={200} />
              </label>
            ))}
          </details>
        </fieldset>
        {error && (
          <p role="alert" className="admin-error">
            {error}
          </p>
        )}
        <button className="admin-button" disabled={busy}>
          {busy ? "正在保存…" : "保存照片"}
        </button>
      </form>
      <a className="text-link" href={`/media/${photo.id}/original`}>
        下载原图 ↗
      </a>
    </section>
  );
}
