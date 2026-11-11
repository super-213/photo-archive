"use client";

import Image from "next/image";
import { useState, type Dispatch, type SetStateAction } from "react";
import {
  buildPhotoLayouts,
  layoutDefinitions,
  layoutTypes,
  type LayoutType,
  type Photo,
  type PhotoLayout,
  type ProjectPhotoInput,
} from "@/lib/content";
import { PhotoGallery } from "../photo-gallery";

export function ProjectArrangement({
  items,
  onChange,
  photos,
  cover,
  onCover,
  busy,
}: {
  items: ProjectPhotoInput[];
  onChange: Dispatch<SetStateAction<ProjectPhotoInput[]>>;
  photos: Photo[];
  cover: string;
  onCover: (id: string) => void;
  busy: boolean;
}) {
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [newType, setNewType] = useState<LayoutType>("full");
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState(false);
  const groups = buildPhotoLayouts(items);
  const target = groups.find(
    (group) =>
      group.id === activeGroup &&
      group.photoIds.length < layoutDefinitions[group.type].capacity,
  );
  const available = photos.filter(
    (photo) =>
      !items.some((item) => item.photoId === photo.id) &&
      photo.title.toLowerCase().includes(search.toLowerCase()),
  );

  function updateGroups(transform: (groups: PhotoLayout[]) => PhotoLayout[]) {
    onChange((current) => {
      const byId = new Map(current.map((item) => [item.photoId, item]));
      return transform(buildPhotoLayouts(current)).flatMap((group) =>
        group.photoIds.map((id) => ({
          ...byId.get(id)!,
          layoutType: group.type,
          groupId: group.id,
        })),
      );
    });
  }
  function changeType(id: string, type: LayoutType) {
    updateGroups((current) =>
      current.flatMap((group) => {
        if (group.id !== id) return [group];
        const split: PhotoLayout[] = [];
        const capacity = layoutDefinitions[type].capacity;
        for (let index = 0; index < group.photoIds.length; index += capacity)
          split.push({
            id: index === 0 ? id : crypto.randomUUID(),
            type,
            photoIds: group.photoIds.slice(index, index + capacity),
          });
        return split;
      }),
    );
  }
  function moveGroup(id: string, step: number) {
    updateGroups((current) => {
      const index = current.findIndex((group) => group.id === id);
      const next = [...current];
      if (index < 0 || index + step < 0 || index + step >= next.length)
        return current;
      [next[index], next[index + step]] = [next[index + step], next[index]];
      return next;
    });
  }
  function movePhoto(groupId: string, photoId: string, step: number) {
    updateGroups((current) =>
      current.map((group) => {
        if (group.id !== groupId) return group;
        const order = [...group.photoIds];
        const index = order.indexOf(photoId);
        if (index < 0 || index + step < 0 || index + step >= order.length)
          return group;
        [order[index], order[index + step]] = [
          order[index + step],
          order[index],
        ];
        return { ...group, photoIds: order };
      }),
    );
  }
  function addPhoto(photo: Photo) {
    const groupId = target?.id || crypto.randomUUID();
    const type = target?.type || newType;
    onChange((current) => {
      const next = [...current];
      const insertion = target
        ? current.findIndex((item) => item.photoId === target.photoIds.at(-1)) +
          1
        : current.length;
      next.splice(insertion, 0, {
        photoId: photo.id,
        layoutType: type,
        caption: "",
        groupId,
      });
      return next;
    });
    setActiveGroup(groupId);
  }

  return (
    <>
      <section className="project-arrangement">
        <div className="editor-title">
          <h2>
            系列排版 · {groups.length} 组 / {items.length} 张
          </h2>
          <button
            type="button"
            className="admin-small-button"
            aria-expanded={preview}
            aria-controls="layout-preview"
            onClick={() => setPreview(!preview)}
          >
            {preview ? "收起预览" : "预览排版"}
          </button>
        </div>
        {preview && (
          <div id="layout-preview" className="admin-layout-preview">
            <PhotoGallery
              photos={items.map((item) =>
                photos.find((photo) => photo.id === item.photoId)!,
              )}
              layouts={groups}
            />
          </div>
        )}
        <p className="admin-muted layout-help">
          先选择布局，再从媒体库加入照片。可整组移动，也可调整组内顺序。缩小布局容量时，照片会依次分组。
        </p>
        {!groups.length && (
          <p className="admin-empty admin-muted">
            从下方媒体库添加照片，开始编排。
          </p>
        )}
        <div className="layout-group-list">
          {groups.map((group, groupIndex) => (
            <section
              className="layout-group"
              key={group.id}
              data-active={target?.id === group.id}
              aria-label={`布局 ${groupIndex + 1}`}
            >
              <div className="layout-group-header">
                <h3>布局 {groupIndex + 1}</h3>
                <label>
                  <span className="sr-only">布局 {groupIndex + 1} 类型</span>
                  <select
                    aria-label={`布局 ${groupIndex + 1} 类型`}
                    value={group.type}
                    disabled={busy}
                    onChange={(event) =>
                      changeType(group.id, event.target.value as LayoutType)
                    }
                  >
                    {layoutTypes.map((type) => (
                      <option key={type} value={type}>
                        {layoutDefinitions[type].label}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="admin-muted">
                  {group.photoIds.length} /{" "}
                  {layoutDefinitions[group.type].capacity} 张
                </span>
                <div className="order-controls">
                  <button
                    type="button"
                    aria-label={`上移布局 ${groupIndex + 1}`}
                    disabled={busy || groupIndex === 0}
                    onClick={() => moveGroup(group.id, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`下移布局 ${groupIndex + 1}`}
                    disabled={busy || groupIndex === groups.length - 1}
                    onClick={() => moveGroup(group.id, 1)}
                  >
                    ↓
                  </button>
                </div>
              </div>
              <ol className="project-photo-list">
                {group.photoIds.map((id, photoIndex) => {
                  const photo = photos.find((photo) => photo.id === id)!;
                  return (
                    <li key={id}>
                      <Image
                        src={photo.thumbnailSrc}
                        alt={photo.alt}
                        width={100}
                        height={80}
                      />
                      <div className="project-photo-label">
                        <strong>{photo.title}</strong>
                        <span className="admin-muted">
                          {photo.visibility === "public"
                            ? "公开"
                            : photo.visibility === "private"
                              ? "私有"
                              : "草稿"}
                        </span>
                      </div>
                      <label className="cover-radio">
                        <input
                          type="radio"
                          name="coverChoice"
                          aria-label={`${photo.title} 设为封面`}
                          checked={cover === id}
                          disabled={busy}
                          onChange={() => onCover(id)}
                        />
                        封面
                      </label>
                      <div className="order-controls">
                        <button
                          type="button"
                          aria-label={`上移 ${photo.title}`}
                          disabled={busy || photoIndex === 0}
                          onClick={() => movePhoto(group.id, id, -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          aria-label={`下移 ${photo.title}`}
                          disabled={
                            busy || photoIndex === group.photoIds.length - 1
                          }
                          onClick={() => movePhoto(group.id, id, 1)}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          aria-label={`移除 ${photo.title}`}
                          disabled={busy}
                          onClick={() => {
                            onChange((current) =>
                              current.filter((item) => item.photoId !== id),
                            );
                            if (cover === id) onCover("");
                          }}
                        >
                          移除
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ol>
              {group.photoIds.length <
                layoutDefinitions[group.type].capacity && (
                <button
                  type="button"
                  className="admin-small-button"
                  disabled={busy}
                  aria-pressed={target?.id === group.id}
                  onClick={() => setActiveGroup(group.id)}
                >
                  向此布局添加照片
                </button>
              )}
            </section>
          ))}
        </div>
      </section>
      <section className="project-library">
        <div className="editor-title">
          <h2>从媒体库添加</h2>
          <input
            type="search"
            aria-label="查找待添加照片"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="按标题查找"
          />
        </div>
        <div className="layout-add-toolbar">
          <label>
            新增布局类型
            <select
              value={newType}
              disabled={busy}
              onChange={(event) => {
                setNewType(event.target.value as LayoutType);
                setActiveGroup(null);
              }}
            >
              {layoutTypes.map((type) => (
                <option key={type} value={type}>
                  {layoutDefinitions[type].label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="admin-small-button"
            disabled={busy}
            onClick={() => setActiveGroup(null)}
          >
            新建布局
          </button>
          <p className="admin-muted" role="status">
            {target
              ? `添加到布局 ${groups.indexOf(target) + 1} · ${layoutDefinitions[target.type].label}`
              : `添加到新布局 · ${layoutDefinitions[newType].label}`}
          </p>
        </div>
        <div className="library-grid">
          {available.map((photo) => (
            <button
              type="button"
              key={photo.id}
              disabled={busy}
              aria-label={`添加 ${photo.title}`}
              onClick={() => addPhoto(photo)}
            >
              <Image
                src={photo.thumbnailSrc}
                alt={photo.alt}
                width={photo.width}
                height={photo.height}
              />
              <span>{photo.title} +</span>
            </button>
          ))}
        </div>
        {!available.length && (
          <p className="admin-muted">没有其他符合条件的照片。</p>
        )}
      </section>
    </>
  );
}
