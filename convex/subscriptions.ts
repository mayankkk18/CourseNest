import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const getUserSubscription = query({
    args: { userId: v.id("users") },
    handler: async (ctx, args) => {
        const user = await ctx.db.get(args.userId);
        if (!user?.currentSubscriptionId) return null;

        const subscription = await ctx.db.get(user.currentSubscriptionId);
        if (!subscription) return null;

        return subscription;
    },
});

export const upsertSubscription = mutation({
    args: {
        userId: v.id("users"),
        stripeSubscriptionId: v.string(),
        status: v.string(),
        planType: v.union(v.literal("month"), v.literal("year")),
        currentPeriodStart: v.optional(v.number()),
        currentPeriodEnd: v.optional(v.number()),
        cancelAtPeriodEnd: v.boolean(),
    },
    handler: async (ctx, args) => {
        const existingSubscription = await ctx.db
            .query("subscriptions")
            .withIndex("by_stripeSubscriptionId", (q) => q.eq("stripeSubscriptionId", args.stripeSubscriptionId))
            .unique();
        
        // Prepare a data object for insert or patch
        const subscriptionData: { -readonly [K in keyof typeof args]: (typeof args)[K] } = {...args};

        if (existingSubscription) {
            await ctx.db.patch(existingSubscription._id, subscriptionData);
        } else {
            // FIX: If creating a new subscription and dates are missing, calculate them.
            if (subscriptionData.currentPeriodStart === undefined) {
                subscriptionData.currentPeriodStart = Date.now();
            }

            if (subscriptionData.currentPeriodEnd === undefined) {
                const startDate = new Date(subscriptionData.currentPeriodStart);
                if (subscriptionData.planType === "month") {
                    startDate.setMonth(startDate.getMonth() + 1);
                } else { // "year"
                    startDate.setFullYear(startDate.getFullYear() + 1);
                }
                subscriptionData.currentPeriodEnd = startDate.getTime();
            }

            const subscriptionId = await ctx.db.insert("subscriptions", subscriptionData as any);
            await ctx.db.patch(args.userId, { currentSubscriptionId: subscriptionId });
        }

        return { success: true };
    },
});

export const removeSubscription = mutation({
    args: {
        stripeSubscriptionId: v.string(),
    },
    handler: async (ctx, args) => {
        const subscription = await ctx.db
            .query("subscriptions")
            .withIndex("by_stripeSubscriptionId", (q) => q.eq("stripeSubscriptionId", args.stripeSubscriptionId))
            .unique();

        if (!subscription) {
            throw new ConvexError("Subscription not found");
        }

        const user = await ctx.db
            .query("users")
            .withIndex("by_currentSubscriptionId", (q) => q.eq("currentSubscriptionId", subscription._id))
            .unique();

        if (user) {
            await ctx.db.patch(user._id, { currentSubscriptionId: undefined });
        }

        await ctx.db.delete(subscription._id);

        return { success: true };
    },
});