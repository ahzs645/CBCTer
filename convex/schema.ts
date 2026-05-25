import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  studies: defineTable({
    appId: v.string(),
    ownerId: v.optional(v.string()),
    name: v.string(),
    source: v.union(
      v.literal("local-folder"),
      v.literal("local-files"),
      v.literal("sample"),
      v.literal("cloud"),
    ),
    fileCount: v.number(),
    totalBytes: v.number(),
    modality: v.optional(v.string()),
    manufacturer: v.optional(v.string()),
    seriesInstanceUid: v.optional(v.string()),
    studyInstanceUid: v.optional(v.string()),
    status: v.union(v.literal("queued"), v.literal("indexed"), v.literal("failed")),
    createdAt: v.number(),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number()),
  })
    .index("by_app_id", ["appId"])
    .index("by_owner", ["ownerId"])
    .index("by_updated", ["updatedAt"]),
  presets: defineTable({
    appId: v.string(),
    studyAppId: v.string(),
    name: v.string(),
    windowCenter: v.number(),
    windowWidth: v.number(),
    opacity: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number()),
  })
    .index("by_app_id", ["appId"])
    .index("by_study", ["studyAppId"]),
});
