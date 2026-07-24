import { z } from "zod";

export const mediaTypeSchema = z.enum(["image", "video"]);
export type MediaType = z.infer<typeof mediaTypeSchema>;

export const processingStatusSchema = z.enum([
  "queued",
  "validating",
  "analyzing",
  "completed",
  "failed",
]);
export type ProcessingStatus = z.infer<typeof processingStatusSchema>;

export const reviewStatusSchema = z.enum([
  "pending_review",
  "published",
  "deleted",
]);
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;

export const failureCodeSchema = z.enum([
  "invalid_request",
  "multiple_files",
  "unsupported_media_type",
  "file_too_large",
  "corrupt_file",
  "unsupported_video_codec",
  "invalid_video_frames",
  "model_not_configured",
  "model_video_unsupported",
  "video_frames_missing",
  "model_request_failed",
  "model_response_invalid",
  "storage_error",
  "internal_error",
]);
export type FailureCode = z.infer<typeof failureCodeSchema>;

export const tagSchema = z.object({
  category: z.string().trim().min(1).max(64),
  value: z.string().trim().min(1).max(128),
  source: z.enum(["model", "human"]).optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
});
export type AssetTag = z.infer<typeof tagSchema>;

const unavailableTextSchema = z.object({
  text: z.string().nullable(),
  unavailableReason: z.string().nullable(),
});

export const imageAnalysisSchema = z.object({
  kind: z.literal("image"),
  description: z.string().min(1),
  tags: z.object({
    scene: z.array(z.string()),
    object: z.array(z.string()),
    person: z.array(z.string()),
    style: z.array(z.string()),
    color_composition: z.array(z.string()),
  }),
  ocr: unavailableTextSchema,
});
export type ImageAnalysis = z.infer<typeof imageAnalysisSchema>;

const timedSummarySchema = z.object({
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().nonnegative(),
  summary: z.string().min(1),
});

export const videoAnalysisSchema = z.object({
  kind: z.literal("video"),
  description: z.string().min(1),
  topics: z.array(z.string()),
  tags: z.object({
    scene: z.array(z.string()),
    person: z.array(z.string()),
    form: z.array(z.string()),
  }),
  visualSegments: z.array(timedSummarySchema),
  keyMoments: z.array(
    z.object({
      seconds: z.number().nonnegative(),
      summary: z.string().min(1),
    }),
  ),
  timeline: z.array(timedSummarySchema),
});
export type VideoAnalysis = z.infer<typeof videoAnalysisSchema>;

export const analysisResultSchema = z.discriminatedUnion("kind", [
  imageAnalysisSchema,
  videoAnalysisSchema,
]);
export type AnalysisResult = z.infer<typeof analysisResultSchema>;

export const uploadStatusSchema = z.object({
  uploadId: z.string().uuid(),
  assetId: z.string().uuid(),
  mediaType: mediaTypeSchema,
  processingStatus: processingStatusSchema,
  reviewStatus: reviewStatusSchema,
  progressPercent: z.number().int().min(0).max(100),
  failureCode: failureCodeSchema.nullable(),
  failureMessage: z.string().nullable(),
});
export type UploadStatus = z.infer<typeof uploadStatusSchema>;

export const assetEditSchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().max(10_000),
  tags: z.array(tagSchema.omit({ source: true, confidence: true })).max(100),
});
export type AssetEdit = z.infer<typeof assetEditSchema>;

export interface AssetSummary {
  id: string;
  name: string;
  description: string;
  mediaType: MediaType;
  processingStatus: ProcessingStatus;
  reviewStatus: ReviewStatus;
  tags: AssetTag[];
  mediaUrl: string;
  createdAt: string;
}

export interface AssetDetail extends AssetSummary {
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  directPublish: boolean;
  failureCode: FailureCode | null;
  failureMessage: string | null;
  analysis: AnalysisResult | null;
  updatedAt: string;
}

export interface AssetPage {
  items: AssetSummary[];
  nextCursor: string | null;
}
