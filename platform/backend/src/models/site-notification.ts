import { and, eq, gt, isNull, or } from "drizzle-orm";
import db, { schema } from "@/database";
import logger from "@/logging";

class SiteNotificationModel {
  static async getById(id: string, organizationId: string) {
    logger.debug(
      { id, organizationId },
      "SiteNotificationModel.getById: fetching notification",
    );
    const [notification] = await db
      .select()
      .from(schema.siteNotificationsTable)
      .where(
        and(
          eq(schema.siteNotificationsTable.id, id),
          eq(schema.siteNotificationsTable.organizationId, organizationId),
        ),
      )
      .limit(1);
    return notification;
  }

  static async getActive(organizationId: string) {
    logger.debug(
      { organizationId },
      "SiteNotificationModel.getActive: fetching active notification",
    );
    const now = new Date();
    const [notification] = await db
      .select()
      .from(schema.siteNotificationsTable)
      .where(
        and(
          eq(schema.siteNotificationsTable.organizationId, organizationId),
          eq(schema.siteNotificationsTable.isActive, true),
          or(
            isNull(schema.siteNotificationsTable.expiresAt),
            gt(schema.siteNotificationsTable.expiresAt, now),
          ),
        ),
      )
      .limit(1);
    return notification;
  }

  static async create(data: {
    organizationId: string;
    content: string;
    expiresAt?: Date;
    isActive?: boolean;
  }) {
    logger.debug(
      { data },
      "SiteNotificationModel.create: creating notification",
    );
    const id = crypto.randomUUID();
    const now = new Date();
    const [notification] = await db
      .insert(schema.siteNotificationsTable)
      .values({
        id,
        organizationId: data.organizationId,
        content: data.content,
        expiresAt: data.expiresAt ?? null,
        isActive: data.isActive ?? true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return notification;
  }

  static async update(
    id: string,
    organizationId: string,
    data: {
      content?: string;
      expiresAt?: Date | null;
      isActive?: boolean;
    },
  ) {
    logger.debug(
      { id, organizationId, data },
      "SiteNotificationModel.update: updating notification",
    );
    const now = new Date();
    const [notification] = await db
      .update(schema.siteNotificationsTable)
      .set({
        ...data,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.siteNotificationsTable.id, id),
          eq(schema.siteNotificationsTable.organizationId, organizationId),
        ),
      )
      .returning();
    return notification;
  }

  static async delete(id: string, organizationId: string) {
    logger.debug(
      { id, organizationId },
      "SiteNotificationModel.delete: deleting notification",
    );
    const result = await db
      .delete(schema.siteNotificationsTable)
      .where(
        and(
          eq(schema.siteNotificationsTable.id, id),
          eq(schema.siteNotificationsTable.organizationId, organizationId),
        ),
      );
    return result;
  }

  static async deactivateAll(organizationId: string) {
    logger.debug(
      { organizationId },
      "SiteNotificationModel.deactivateAll: deactivating all notifications",
    );
    const now = new Date();
    await db
      .update(schema.siteNotificationsTable)
      .set({ isActive: false, updatedAt: now })
      .where(
        and(
          eq(schema.siteNotificationsTable.organizationId, organizationId),
          eq(schema.siteNotificationsTable.isActive, true),
        ),
      );
  }
}

export default SiteNotificationModel;
