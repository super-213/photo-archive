import { z } from "zod";
import { categories } from "../content";

const shortText = z.string().trim().max(200);
export const captureDate = z.union([z.literal(""), z.iso.date()]);
export const photoInput = z.object({
  version: z.number().int().positive(),
  title: shortText.min(1),
  alt: z.string().trim().min(1).max(500),
  description: z.string().trim().max(3000),
  category: z.enum(categories),
  visibility: z.enum(["draft", "public", "private"]),
  year: z.string().regex(/^(|\d{4})$/, "年份应为四位数字"),
  location: shortText,
  capturedAt: captureDate,
  cameraMake: shortText,
  cameraModel: shortText,
  lensModel: shortText,
  focalLength: shortText,
  aperture: shortText,
  shutterSpeed: shortText,
  iso: shortText,
  tags: z
    .array(z.string().trim().min(1).max(40))
    .max(30)
    .transform((tags) => [...new Set(tags)]),
});
export const projectInput = z
  .object({
    version: z.number().int().nonnegative(),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        "网址标识使用小写字母、数字和连字符",
      ),
    title: shortText.min(1),
    subtitle: shortText,
    description: z.string().trim().max(3000),
    category: z.enum(categories),
    year: z.string().trim().max(30),
    coverPhotoId: z.string().max(100),
    status: z.enum(["draft", "published"]),
    sortOrder: z.number().int().min(0).max(100000),
    items: z
      .array(
        z.object({
          photoId: z.string().min(1).max(100),
          layoutType: z.enum(["full", "center", "pair"]),
          caption: z.string().max(500),
        }),
      )
      .max(1000),
  })
  .refine(
    (data) =>
      new Set(data.items.map((item) => item.photoId)).size ===
      data.items.length,
    "系列内不能重复加入同一张照片",
  );

export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
