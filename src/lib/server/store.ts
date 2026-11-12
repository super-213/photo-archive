import "server-only";
import { archivePageSize, buildPhotoLayouts } from "../content";
import { randomUUID } from "node:crypto";
import type {
  Category,
  CoverSettings,
  PhotoPage,
  ProjectCoverData,
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
  uploaded_at: string;
  tags_json: string;
  has_preview: number;
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
  cover_layout: CoverSettings["coverLayout"];
  cover_ratio: CoverSettings["coverRatio"];
  cover_focus_x: number;
  cover_focus_y: number;
  status: Project["status"];
  sort_order: number;
  version: number;
};

const photoColumns = `p.*, EXISTS(SELECT 1 FROM media_variant WHERE photo_id=p.id AND variant='preview') AS has_preview, (
  SELECT json_group_array(name) FROM (
    SELECT t.name FROM tag t JOIN photo_tag pt ON pt.tag_id=t.id
    WHERE pt.photo_id=p.id ORDER BY t.name
  )
) AS tags_json`;

const publishedProjectWhere = `p.status='published'
  AND EXISTS (SELECT 1 FROM project_photo WHERE project_id=p.id AND photo_id=p.cover_photo_id)
  AND EXISTS (SELECT 1 FROM photo WHERE id=p.cover_photo_id AND visibility='public')
  AND NOT EXISTS (SELECT 1 FROM project_photo pp JOIN photo ph ON pp.photo_id=ph.id
    WHERE pp.project_id=p.id AND ph.visibility!='public')`;

export function getPhoto(id: string): Photo | undefined {
  const row = getDatabase()
    .prepare(`SELECT ${photoColumns} FROM photo p WHERE p.id = ?`)
    .get(id) as PhotoRow | undefined;
  return row && serializePhoto(row);
}
function serializePhoto(row: PhotoRow): Photo {
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
    ...(row.has_preview ? { previewSrc: `/media/${row.id}/preview` } : {}),
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
    tags: JSON.parse(row.tags_json),
  };
}
export function listPhotos(publicOnly = true): Photo[] {
  const rows = getDatabase()
    .prepare(
      `SELECT ${photoColumns} FROM photo p ${publicOnly ? "WHERE p.visibility = 'public'" : ""} ORDER BY p.uploaded_at DESC, p.id`,
    )
    .all() as PhotoRow[];
  return rows.map(serializePhoto);
}
export function listPhotoPage(category: Category | "all", cursor?: string): PhotoPage {
  let after: string[] = [];
  if (cursor) {
    try {
      if (cursor.length > 512) throw new Error();
      const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
      if (!Array.isArray(value) || value.length !== 2 ||
          !value.every((part) => typeof part === "string" && part.length <= 100))
        throw new Error();
      after = value;
    } catch {
      throw new AppError("分页位置无效，请刷新后重试");
    }
  }
  const db = getDatabase();
  const categoryWhere = category === "all" ? "" : " AND p.category = ?";
  const values = category === "all" ? [] : [category];
  const { total } = db.prepare(
    `SELECT COUNT(*) AS total FROM photo p WHERE p.visibility='public'${categoryWhere}`,
  ).get(...values) as { total: number };
  const cursorValues = after.length ? [after[0], after[0], after[0], after[1]] : [];
  const rows = db.prepare(
    `SELECT ${photoColumns} FROM photo p WHERE p.visibility='public'${categoryWhere}
    ${after.length ? "AND p.uploaded_at <= ? AND (p.uploaded_at < ? OR (p.uploaded_at = ? AND p.id > ?))" : ""}
    ORDER BY p.uploaded_at DESC, p.id LIMIT ?`,
  ).all(...values, ...cursorValues, archivePageSize + 1) as PhotoRow[];
  const visible = rows.slice(0, archivePageSize);
  const last = visible.at(-1);
  return {
    photos: visible.map(serializePhoto),
    total,
    nextCursor: rows.length > archivePageSize && last
      ? Buffer.from(JSON.stringify([last.uploaded_at, last.id])).toString("base64url")
      : null,
  };
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
type ProjectMemberRow = PhotoRow & {
  project_id: string;
  photo_id: string;
  layout_type: PhotoLayout["type"];
  caption: string;
  layout_group: string | null;
};

function serializeProject(row: ProjectRow, members: ProjectMemberRow[]): Project {
  const photos = members.map(serializePhoto);
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
    coverLayout: row.cover_layout,
    coverRatio: row.cover_ratio,
    coverFocusX: row.cover_focus_x,
    coverFocusY: row.cover_focus_y,
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
function loadProjects(rows: ProjectRow[]): Project[] {
  if (!rows.length) return [];
  const members = getDatabase().prepare(
    `SELECT ${photoColumns}, pp.project_id, pp.photo_id, pp.layout_type, pp.caption, pp.layout_group
    FROM project_photo pp JOIN photo p ON p.id=pp.photo_id
    WHERE pp.project_id IN (SELECT value FROM json_each(?)) ORDER BY pp.sort_order`,
  ).all(JSON.stringify(rows.map((row) => row.id))) as ProjectMemberRow[];
  const byProject = new Map<string, ProjectMemberRow[]>();
  for (const member of members) {
    const group = byProject.get(member.project_id) || [];
    group.push(member);
    byProject.set(member.project_id, group);
  }
  return rows.map((row) => serializeProject(row, byProject.get(row.id) || []));
}

export function listProjects(publicOnly = true): Project[] {
  const rows = getDatabase().prepare(
    `SELECT p.* FROM project p ${publicOnly ? `WHERE ${publishedProjectWhere}` : ""}
    ORDER BY p.sort_order, p.id`,
  ).all() as ProjectRow[];
  return loadProjects(rows);
}

export function listProjectCovers(): ProjectCoverData[] {
  const rows = getDatabase().prepare(
    `SELECT ${photoColumns}, pr.slug, pr.title AS project_title, pr.subtitle, pr.cover_layout, pr.cover_ratio, pr.cover_focus_x, pr.cover_focus_y
    FROM project pr JOIN photo p ON p.id=pr.cover_photo_id
    WHERE pr.id IN (SELECT p.id FROM project p WHERE ${publishedProjectWhere})
    ORDER BY pr.sort_order, pr.id`,
  ).all() as (PhotoRow & Pick<ProjectRow, "cover_layout" | "cover_ratio" | "cover_focus_x" | "cover_focus_y"> & { slug: string; project_title: string; subtitle: string })[];
  return rows.map((row) => ({
    slug: row.slug,
    title: row.project_title,
    subtitle: row.subtitle,
    cover: serializePhoto(row),
    coverLayout: row.cover_layout,
    coverRatio: row.cover_ratio,
    coverFocusX: row.cover_focus_x,
    coverFocusY: row.cover_focus_y,
  }));
}

export function getPublishedProject(slug: string): Project | undefined {
  const row = getDatabase().prepare(
    `SELECT p.* FROM project p WHERE p.slug=? AND ${publishedProjectWhere}`,
  ).get(slug) as ProjectRow | undefined;
  return row && loadProjects([row])[0];
}

export function getNextPublishedProject(project: Project) {
  const db = getDatabase();
  const next = db.prepare(
    `SELECT p.slug, p.title FROM project p WHERE ${publishedProjectWhere}
    AND (p.sort_order > ? OR (p.sort_order = ? AND p.id > ?))
    ORDER BY p.sort_order, p.id LIMIT 1`,
  ).get(project.sortOrder, project.sortOrder, project.id);
  return (next || db.prepare(
    `SELECT p.slug, p.title FROM project p WHERE ${publishedProjectWhere} AND p.id != ?
    ORDER BY p.sort_order, p.id LIMIT 1`,
  ).get(project.id)) as { slug: string; title: string } | undefined;
}

export function getProject(id: string) {
  const row = getDatabase().prepare("SELECT * FROM project WHERE id = ?")
    .get(id) as ProjectRow | undefined;
  return row && loadProjects([row])[0];
}
export function saveProject(
  id: string | null,
  input: z.infer<typeof projectInput>,
) {
  const db = getDatabase();
  return db
    .transaction(() => {
      const previous = id ? getProject(id) : undefined;
      if (id) {
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
      const projectId = id || randomUUID();
      const baseSlug = input.title
        .normalize("NFKD")
        .toLowerCase()
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .slice(0, 90)
        .replace(/^-+|-+$/g, "") || `series-${projectId}`;
      let slug = input.slug || previous?.slug || baseSlug;
      const slugExists = db.prepare("SELECT id FROM project WHERE slug=? AND id!=?");
      let suffix = 2;
      while (slugExists.get(slug, projectId)) {
        if (input.slug) throw new AppError("网址标识已被其他系列使用", 409);
        slug = `${baseSlug}-${suffix++}`;
      }
      const { items, version, ...fields } = input;
      const values = {
        ...fields,
        slug,
        id: projectId,
        coverPhotoId: input.coverPhotoId || null,
        coverLayout: input.coverLayout ?? previous?.coverLayout ?? "lead",
        coverRatio: input.coverRatio ?? previous?.coverRatio ?? "original",
        coverFocusX: input.coverFocusX ?? previous?.coverFocusX ?? 50,
        coverFocusY: input.coverFocusY ?? previous?.coverFocusY ?? 50,
        publishedAt:
          input.status === "published" ? new Date().toISOString() : null,
      };
      if (id)
        db.prepare(
          `UPDATE project SET slug=@slug, title=@title, subtitle=@subtitle, description=@description, category=@category,
      year=@year, cover_photo_id=@coverPhotoId, cover_layout=@coverLayout, cover_ratio=@coverRatio,
      cover_focus_x=@coverFocusX, cover_focus_y=@coverFocusY, status=@status, sort_order=@sortOrder, published_at=@publishedAt,
      version=version+1 WHERE id=@id`,
        ).run(values);
      else
        db.prepare(
          `INSERT INTO project(id,slug,title,subtitle,description,category,year,cover_photo_id,cover_layout,cover_ratio,cover_focus_x,cover_focus_y,status,sort_order,published_at)
      VALUES (@id,@slug,@title,@subtitle,@description,@category,@year,@coverPhotoId,@coverLayout,@coverRatio,@coverFocusX,@coverFocusY,@status,@sortOrder,@publishedAt)`,
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
