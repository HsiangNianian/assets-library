import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const assets = sqliteTable(
  "assets",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    mediaType: text("media_type", { enum: ["image", "video"] }).notNull(),
    originalFilename: text("original_filename").notNull(),
    originalPath: text("original_path").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    directPublish: integer("direct_publish", { mode: "boolean" }).notNull(),
    processingStatus: text("processing_status", {
      enum: ["queued", "validating", "analyzing", "completed", "failed"],
    })
      .notNull()
      .default("queued"),
    reviewStatus: text("review_status", {
      enum: ["pending_review", "published", "deleted"],
    })
      .notNull()
      .default("pending_review"),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("assets_review_created_idx").on(table.reviewStatus, table.createdAt),
  ],
);

export const uploadRequests = sqliteTable(
  "upload_requests",
  {
    id: text("id").primaryKey(),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id),
    clientFilename: text("client_filename").notNull(),
    declaredMime: text("declared_mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [uniqueIndex("upload_asset_unique").on(table.assetId)],
);

export const processingJobs = sqliteTable(
  "processing_jobs",
  {
    id: text("id").primaryKey(),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id),
    type: text("type", { enum: ["analyze", "cleanup"] }).notNull(),
    status: text("status", {
      enum: ["queued", "running", "completed", "failed"],
    })
      .notNull()
      .default("queued"),
    attempt: integer("attempt").notNull().default(0),
    availableAt: integer("available_at", { mode: "timestamp_ms" }).notNull(),
    claimedAt: integer("claimed_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("jobs_queue_idx").on(table.status, table.availableAt)],
);

export const analysisResults = sqliteTable("analysis_results", {
  assetId: text("asset_id")
    .primaryKey()
    .references(() => assets.id),
  schemaVersion: integer("schema_version").notNull().default(1),
  resultJson: text("result_json").notNull(),
  modelProtocol: text("model_protocol").notNull(),
  modelName: text("model_name").notNull(),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }).notNull(),
});

export const tags = sqliteTable(
  "tags",
  {
    id: text("id").primaryKey(),
    category: text("category").notNull(),
    value: text("value").notNull(),
    normalizedValue: text("normalized_value").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("tags_category_normalized_unique").on(
      table.category,
      table.normalizedValue,
    ),
  ],
);

export const assetTags = sqliteTable(
  "asset_tags",
  {
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id),
    source: text("source", { enum: ["model", "human"] }).notNull(),
    confidence: real("confidence"),
  },
  (table) => [primaryKey({ columns: [table.assetId, table.tagId] })],
);

export const assetTagRejections = sqliteTable(
  "asset_tag_rejections",
  {
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id),
    category: text("category").notNull(),
    normalizedValue: text("normalized_value").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.assetId, table.category, table.normalizedValue],
    }),
  ],
);
