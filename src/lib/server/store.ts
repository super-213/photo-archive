import "server-only";
import { buildPhotoLayouts } from "../content";
import { randomUUID } from "node:crypto";
import type {
  Category,
  Photo,
  PhotoLayout,
  Project,
  ProjectPhotoInput,
} from "../content";
import { getDatabase } from "./database";
import { AppError, photoInput, projectInput } from "./validation";
import type { z } from "zod";

type PhotoRow = {
  id: string;
  storage_key: string;
  title: string;
  alt: string;
  description: string;
  width: number;
  height: number;
  category: Category;
  year: string;
  location: string;
  source: string;
  visibility: Photo["visibility"];
  captured_at: string;
  camera_make: string;
  camera_model: string;
  lens_model: string;
  focal_length: string;
  aperture: string;
  shutter_speed: string;
  iso: string;
  is_sample: number;
  version: number;
};
type ProjectRow = {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  category: Category;
  year: string;
  cover_photo_id: string | null;
  status: Project["status"];
  sort_order: number;
  version: number;
};

export function getPhoto(id: string): Photo | undefined {
  const row = getDatabase()
    .prepare("SELECT * FROM photo WHERE id = ?")
    .get(id) as PhotoRow | undefined;
  return row && serializePhoto(row);
}
function serializePhoto(row: PhotoRow): Photo {
  const tags = getDatabase()
    .prepare(
      "SELECT t.name FROM tag t JOIN photo_tag pt ON pt.tag_id = t.id WHERE pt.photo_id = ? ORDER BY t.name",
    )
    .all(row.id) as { name: string }[];
  return {
    id: row.id,
    title: row.title,
    alt: row.alt,
    description: row.description,
    width: row.width,
    height: row.height,
    src: `/media/${row.id}/grid`,
    lightboxSrc: `/media/${row.id}/lightbox`,
    thumbnailSrc: `/media/${row.id}/thumbnail`,
    category: row.category,
    year: row.year,
    location: row.location,
    source: row.source,
    visibility: row.visibility,
    capturedAt: row.captured_at,
    cameraMake: row.camera_make,
    cameraModel: row.camera_model,
    lensModel: row.lens_model,
    focalLength: row.focal_length,
    aperture: row.aperture,
    shutterSpeed: row.shutter_speed,
    iso: row.iso,
    isSample: Boolean(row.is_sample),
    version: row.version,
    tags: tags.map((tag) => tag.name),
  };
}
export function listPhotos(publicOnly = true): Photo[] {
  const rows = getDatabase()
    .prepare(
      `SELECT * FROM photo ${publicOnly ? "WHERE visibility = 'public'" : ""} ORDER BY uploaded_at DESC, id`,
    )
    .all() as PhotoRow[];
  return rows.map(serializePhoto);
}
export function updatePhoto(id: string, input: z.infer<typeof photoInput>) {
  const db = getDatabase();
  return db
    .transaction(() => {
      const previous = getPhoto(id);
      if (!previous) throw new AppError("照片不存在", 404);
      if (previous.version !== input.version)
        throw new AppError("照片已被其他操作更新，请重新打开后编辑", 409);
      const { tags, ...fields } = input;
      db.prepare(
        `UPDATE photo SET title=@title, alt=@alt, description=@description, category=@category, visibility=@visibility,
      year=@year, location=@location, captured_at=@capturedAt, camera_make=@cameraMake, camera_model=@cameraModel,
      lens_model=@lensModel, focal_length=@focalLength, aperture=@aperture, shutter_speed=@shutterSpeed, iso=@iso,
      version=version+1 WHERE id=@id`,
      ).run({ ...fields, id });
      db.prepare("DELETE FROM photo_tag WHERE photo_id = ?").run(id);
      for (const name of tags) {
        db.prepare("INSERT OR IGNORE INTO tag(name) VALUES (?)").run(name);
        db.prepare(
          "INSERT INTO photo_tag(photo_id, tag_id) SELECT ?, id FROM tag WHERE name = ?",
        ).run(id, name);
      }
      let unpublished = 0;
      if (input.visibility !== "public")
        unpublished = db
          .prepare(
            `UPDATE project SET status='draft', version=version+1 WHERE status='published'
      AND id IN (SELECT project_id FROM project_photo WHERE photo_id = ? UNION SELECT id FROM project WHERE cover_photo_id = ?)`,
          )
          .run(id, id).changes;
      return { photo: getPhoto(id)!, unpublished };
    })
    .immediate();
}
function serializeProject(row: ProjectRow): Project {
  const members = getDatabase()
    .prepare(
      "SELECT photo_id, layout_type, caption, layout_group FROM project_photo WHERE project_id = ? ORDER BY sort_order",
    )
    .all(row.id) as {
    photo_id: string;
    layout_type: PhotoLayout["type"];
    caption: string;
    layout_group: string | null;
  }[];
  const photos = members
    .map((item) => getPhoto(item.photo_id)!)
    .filter(Boolean);
  const rawItems = members.map((item): ProjectPhotoInput => ({
    photoId: item.photo_id,
    layoutType: item.layout_type,
    caption: item.caption,
    groupId: item.layout_group || undefined,
  }));
  const layouts = buildPhotoLayouts(rawItems);
  const groupIds = new Map(
    layouts.flatMap((layout) =>
      layout.photoIds.map((id) => [id, layout.id] as const),
    ),
  );
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle,
    description: row.description,
    category: row.category,
    year: row.year,
    coverPhotoId: row.cover_photo_id || "",
    status: row.status,
    sortOrder: row.sort_order,
    version: row.version,
    photos,
    layouts,
    items: rawItems.map((item) => ({
      ...item,
      groupId: groupIds.get(item.photoId),
    })),
  };
}
export function listProjects(publicOnly = true): Project[] {
  const rows = getDatabase()
    .prepare(
      `SELECT p.* FROM project p ${
        publicOnly
          ? `WHERE status='published'
    AND EXISTS (SELECT 1 FROM project_photo WHERE project_id=p.id AND photo_id=p.cover_photo_id)
    AND EXISTS (SELECT 1 FROM photo WHERE id=p.cover_photo_id AND visibility='public')
    AND NOT EXISTS (SELECT 1 FROM project_photo pp JOIN photo ph ON pp.photo_id=ph.id WHERE pp.project_id=p.id AND ph.visibility!='public')`
          : ""
      } ORDER BY sort_order, id`,
    )
    .all() as ProjectRow[];
  return rows.map(serializeProject);
}
export function getProject(id: string) {
  const row = getDatabase()
    .prepare("SELECT * FROM project WHERE id = ?")
    .get(id) as ProjectRow | undefined;
  return row && serializeProject(row);
}
export function saveProject(
  id: string | null,
  input: z.infer<typeof projectInput>,
) {
  const db = getDatabase();
  return db
    .transaction(() => {
      if (id) {
        const previous = getProject(id);
        if (!previous) throw new AppError("系列不存在", 404);
        if (previous.version !== input.version)
          throw new AppError("系列已被其他操作更新，请重新打开后编辑", 409);
      }
      const members = input.items.map((item) => getPhoto(item.photoId));
      if (members.some((photo) => !photo))
        throw new AppError("包含不存在的照片");
      if (
        input.coverPhotoId &&
        !input.items.some((item) => item.photoId === input.coverPhotoId)
      )
        throw new AppError("封面必须来自当前系列");
      if (
        input.status === "published" &&
        (!members.length ||
          !input.coverPhotoId ||
          members.some((photo) => photo?.visibility !== "public"))
      )
        throw new AppError("发布需要选择封面，且系列内所有照片均为公开状态");
      if (
        db
          .prepare("SELECT id FROM project WHERE slug=? AND id!=?")
          .get(input.slug, id || "")
      )
        throw new AppError("网址标识已被其他系列使用", 409);
      const projectId = id || randomUUID();
      const { items, version, ...fields } = input;
      const values = {
        ...fields,
        id: projectId,
        coverPhotoId: input.coverPhotoId || null,
        publishedAt:
          input.status === "published" ? new Date().toISOString() : null,
      };
      if (id)
        db.prepare(
          `UPDATE project SET slug=@slug, title=@title, subtitle=@subtitle, description=@description, category=@category,
      year=@year, cover_photo_id=@coverPhotoId, status=@status, sort_order=@sortOrder, published_at=@publishedAt,
      version=version+1 WHERE id=@id`,
        ).run(values);
      else
        db.prepare(
          `INSERT INTO project(id,slug,title,subtitle,description,category,year,cover_photo_id,status,sort_order,published_at)
      VALUES (@id,@slug,@title,@subtitle,@description,@category,@year,@coverPhotoId,@status,@sortOrder,@publishedAt)`,
        ).run(values);
      db.prepare("DELETE FROM project_photo WHERE project_id = ?").run(
        projectId,
      );
      const groupIds = new Map(
        buildPhotoLayouts(items).flatMap((layout) =>
          layout.photoIds.map((id) => [id, layout.id] as const),
        ),
      );
      items.forEach((item, index) =>
        db
          .prepare(
            "INSERT INTO project_photo(project_id,photo_id,sort_order,layout_type,caption,layout_group) VALUES (?,?,?,?,?,?)",
          )
          .run(
            projectId,
            item.photoId,
            index,
            item.layoutType,
            item.caption,
            groupIds.get(item.photoId),
          ),
      );
      return getProject(projectId)!;
    })
    .immediate();
}
export function deleteProject(id: string, version: number) {
  const result = getDatabase()
    .prepare("DELETE FROM project WHERE id=? AND version=?")
    .run(id, version);
  if (!result.changes) throw new AppError("系列已变更，请刷新后重试", 409);
}
