import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import {
  hashPassword,
  invalidateSession,
  issueSession,
  normalizeDisplayName,
  normalizeEmail,
  normalizeRole,
  nowIso,
  presentUser,
  requireRole,
  requireUser,
  resolveSession,
  validatePassword,
  generateRandomHex,
} from "./authHelpers";
import { deleteRestaurantTree } from "./restaurantHelpers";

export const signUp = mutationGeneric({
  args: {
    displayName: v.string(),
    email: v.string(),
    password: v.string(),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    const emailLower = normalizeEmail(args.email);
    if (!emailLower.includes("@")) {
      throw new Error("Enter a valid email address.");
    }

    const existing = await ctx.db
      .query("users")
      .withIndex("by_email_lower", (query) => query.eq("emailLower", emailLower))
      .unique();

    if (existing) {
      throw new Error("An account already exists for that email.");
    }

    const password = validatePassword(args.password);
    const passwordSalt = generateRandomHex(16);
    const passwordHash = await hashPassword(password, passwordSalt);
    const userId = await ctx.db.insert("users", {
      email: String(args.email || "").trim(),
      emailLower,
      displayName: normalizeDisplayName(args.displayName, args.email),
      role: normalizeRole(args.role),
      passwordHash,
      passwordSalt,
      createdAt: nowIso(),
      lastLoginAt: nowIso(),
    });

    const user = await ctx.db.get(userId);
    const sessionToken = await issueSession(ctx, userId);

    return {
      sessionToken,
      user: presentUser(user),
    };
  },
});

export const signIn = mutationGeneric({
  args: {
    email: v.string(),
    password: v.string(),
  },
  handler: async (ctx, args) => {
    const emailLower = normalizeEmail(args.email);
    const user = await ctx.db
      .query("users")
      .withIndex("by_email_lower", (query) => query.eq("emailLower", emailLower))
      .unique();

    if (!user) {
      throw new Error("No account matches that email and password.");
    }

    const attemptedHash = await hashPassword(String(args.password || ""), user.passwordSalt);
    if (attemptedHash !== user.passwordHash) {
      throw new Error("No account matches that email and password.");
    }

    await ctx.db.patch(user._id, { lastLoginAt: nowIso() });
    const sessionToken = await issueSession(ctx, user._id);
    const refreshedUser = await ctx.db.get(user._id);

    return {
      sessionToken,
      user: presentUser(refreshedUser),
    };
  },
});

export const signOut = mutationGeneric({
  args: {
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    await invalidateSession(ctx, args.sessionToken);
    return { ok: true };
  },
});

export const getCurrentUser = queryGeneric({
  args: {
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const result = await resolveSession(ctx, args.sessionToken);
    return result?.user ? presentUser(result.user) : null;
  },
});

export const listUsers = queryGeneric({
  args: {
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, args.sessionToken, ["moderator"]);
    const users = await ctx.db.query("users").collect();

    return users
      .map((user) => presentUser(user))
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  },
});

export const deleteUser = mutationGeneric({
  args: {
    sessionToken: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const moderator = await requireRole(ctx, args.sessionToken, ["moderator"]);

    if (String(moderator.user._id) === String(args.userId)) {
      throw new Error("Moderators cannot delete their own account here.");
    }

    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found.");
    }

    const [sessions, favorites, reviews, ownedRestaurants] = await Promise.all([
      ctx.db
        .query("sessions")
        .withIndex("by_user_id", (query) => query.eq("userId", args.userId))
        .collect(),
      ctx.db
        .query("favorites")
        .withIndex("by_user_id", (query) => query.eq("userId", args.userId))
        .collect(),
      ctx.db
        .query("reviews")
        .withIndex("by_user_id", (query) => query.eq("userId", args.userId))
        .collect(),
      ctx.db
        .query("restaurants")
        .withIndex("by_owner_user_id", (query) => query.eq("ownerUserId", args.userId))
        .collect(),
    ]);

    for (const session of sessions) {
      await ctx.db.delete(session._id);
    }

    for (const favorite of favorites) {
      await ctx.db.delete(favorite._id);
    }

    for (const review of reviews) {
      await ctx.db.delete(review._id);
    }

    for (const restaurant of ownedRestaurants) {
      await deleteRestaurantTree(ctx, restaurant._id);
    }

    await ctx.db.delete(args.userId);

    return {
      deletedUserId: args.userId,
      deletedOwnedRestaurantCount: ownedRestaurants.length,
    };
  },
});
