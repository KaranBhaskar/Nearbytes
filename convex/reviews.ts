import { mutationGeneric } from "convex/server";
import { v } from "convex/values";
import { nowIso, normalizeOptionalString, requireUser } from "./authHelpers";

export const upsertReview = mutationGeneric({
  args: {
    sessionToken: v.string(),
    restaurantId: v.id("restaurants"),
    rating: v.number(),
    comment: v.string(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx, args.sessionToken);
    const rating = Math.max(1, Math.min(5, Math.round(args.rating)));
    const comment = normalizeOptionalString(args.comment, 1200);

    if (!comment) {
      throw new Error("Write a short review before submitting.");
    }

    const existing = await ctx.db
      .query("reviews")
      .withIndex("by_user_restaurant", (query) =>
        query.eq("userId", user._id).eq("restaurantId", args.restaurantId),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        rating,
        comment,
        updatedAt: nowIso(),
      });
      return { reviewId: existing._id, updated: true };
    }

    const reviewId = await ctx.db.insert("reviews", {
      userId: user._id,
      restaurantId: args.restaurantId,
      rating,
      comment,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });

    return { reviewId, updated: false };
  },
});

export const deleteReview = mutationGeneric({
  args: {
    sessionToken: v.string(),
    reviewId: v.id("reviews"),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx, args.sessionToken);
    const review = await ctx.db.get(args.reviewId);
    if (!review) {
      throw new Error("Review not found.");
    }

    if (String(review.userId) !== String(user._id) && user.role !== "moderator") {
      throw new Error("You do not have permission to delete that review.");
    }

    await ctx.db.delete(args.reviewId);
    return { ok: true };
  },
});

