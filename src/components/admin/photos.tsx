"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { categories, categoryLabels, type Photo } from "@/lib/content";
import { maxUploadBytes } from "@/lib/media-settings";
import { adminRequest } from "./api";
import type { getFolderImportStatus } from "@/lib/server/folder-import";

const visibilityLabels = { draft: "草稿", public: "公开", private: "私有" };
type UploadItem = {
  id: number;
  file: File;
  state: "waiting" | "uploading" | "done" | "error";
  message: string;
};

type FolderImportStatus = ReturnType<typeof getFolderImportStatus>;

export function PhotoManager({ initialPhotos, initialFolderImport }: {
  initialPhotos: Photo[];
  initialFolderImport: FolderImportStatus;
}) {
  const [photos, setPhotos] = useState(initialPhotos);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [queue, setQueue] = useState<UploadItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState("");
  const [folderImport, setFolderImport] = useState(initialFolderImport);
  const [refreshing, setRefreshing] = useState(false);
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
        if (!item.file.size || item.file.size > maxUploadBytes)
          throw new Error("单张照片最大 256 MiB");
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
        JPEG / PNG / WebP / AVIF / TIFF · 单张最大 256 MiB · 支持多选
      </p>
      <section className="admin-folder-import" aria-label="文件夹导入">
        <div>
          <strong>文件夹导入{folderImport.enabled ? "" : "（自动扫描已暂停）"}</strong>
          <p className="admin-muted">将照片或子文件夹复制到服务器上的 <code>{folderImport.directory}</code>，复制稳定后自动导入为草稿，源文件保留。</p>
          <p className="admin-muted" aria-live="polite">
            等待 {folderImport.counts.waiting} · 处理中 {folderImport.counts.processing} · 已导入 {folderImport.counts.imported} · 重复 {folderImport.counts.duplicate} · 失败 {folderImport.counts.error}
          </p>
        </div>
        <button type="button" className="admin-small-button" disabled={refreshing || uploading}
          onClick={async () => {
            setRefreshing(true);
            try {
              const [updatedPhotos, status] = await Promise.all([
                adminRequest<Photo[]>("/api/admin/photos"),
                adminRequest<FolderImportStatus>("/api/admin/imports"),
              ]);
              setPhotos(updatedPhotos);
              setFolderImport(status);
              setNotice("已刷新照片与导入进度");
            } catch (error) {
              setNotice(error instanceof Error ? error.message : "刷新失败，请重试");
            } finally {
              setRefreshing(false);
            }
          }}>
          {refreshing ? "正在刷新…" : "刷新导入结果"}
        </button>
        {folderImport.counts.error > 0 && <details>
          <summary>查看导入失败原因</summary>
          {folderImport.errors.map((entry) => (
            <p key={entry.file} className="admin-error">{entry.file}：{entry.error}</p>
          ))}
          <p className="admin-muted">显示最近 20 个失败文件。替换或重新复制后会自动重试。完整记录保存在数据库，最近记录见导入文件夹内的“导入记录.json”。</p>
        </details>}
      </section>
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
                <strong>{photo.title || "未命名照片"}</strong>
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
      aria-label={`编辑照片 ${photo.title || "未命名照片"}`}
    >
      <div className="editor-title">
        <h2>照片信息</h2>
        <button className="admin-small-button" onClick={onClose}>
          关闭 ×
        </button>
      </div>
      <Image
        src={photo.previewSrc || photo.src}
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
        <p className="admin-muted">
          <span className="admin-required" aria-hidden="true">*</span> 为必填项
        </p>
        <fieldset disabled={busy}>
          <label>
            标题（选填）
            <input
              name="title"
              defaultValue={photo.title}
              maxLength={200}
            />
          </label>
          <label>
            图片替代文本（选填）
            <input
              name="alt"
              defaultValue={photo.alt}
              maxLength={500}
            />
          </label>
          <div className="form-pair">
            <label>
              <span>公开状态 <span className="admin-required" aria-hidden="true">*</span></span>
              <select name="visibility" required defaultValue={photo.visibility}>
                {Object.entries(visibilityLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <span className="admin-muted">公开展示图使用 CDN 缓存，默认有效期 60 秒。转为草稿或私有后，已缓存副本可能在过期前短暂可见。</span>
            </label>
            <label>
              <span>题材 <span className="admin-required" aria-hidden="true">*</span></span>
              <select name="category" required defaultValue={photo.category}>
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
