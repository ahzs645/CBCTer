import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const studyReturn = v.object({
  _id: v.id("studies"),
  _creationTime: v.number(),
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
});

export const list = query({
  args: { ownerId: v.optional(v.string()) },
  returns: v.array(studyReturn),
  handler: async (ctx, args) => {
    if (args.ownerId) {
      return await ctx.db
        .query("studies")
        .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
        .filter((q) => q.eq(q.field("deletedAt"), undefined))
        .order("desc")
        .collect();
    }

    return await ctx.db
      .query("studies")
      .withIndex("by_updated")
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .order("desc")
      .collect();
  },
});

export const create = mutation({
  args: {
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
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const timestamp = Date.now();

    await ctx.db.insert("studies", {
      ...args,
      status: "indexed",
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    return null;
  },
});
