import { eq } from "drizzle-orm";
import { describe } from "vitest";
import db, { schema } from "@/database";
import { expect, test } from "@/test";
import SiteNotificationModel from "./site-notification";

describe("SiteNotificationModel", () => {
  test("scopes read, update, and delete operations to the organization", async ({
    makeOrganization,
  }) => {
    const orgA = await makeOrganization();
    const orgB = await makeOrganization();

    const notification = await SiteNotificationModel.create({
      organizationId: orgA.id,
      content: "Org A maintenance window",
      isActive: true,
    });

    expect(
      await SiteNotificationModel.getById(notification.id, orgB.id),
    ).toBeUndefined();

    expect(
      await SiteNotificationModel.update(notification.id, orgB.id, {
        content: "Cross-org update",
      }),
    ).toBeUndefined();

    const [afterUpdateAttempt] = await db
      .select()
      .from(schema.siteNotificationsTable)
      .where(eq(schema.siteNotificationsTable.id, notification.id));

    expect(afterUpdateAttempt.content).toBe("Org A maintenance window");

    await SiteNotificationModel.delete(notification.id, orgB.id);

    const [afterDeleteAttempt] = await db
      .select()
      .from(schema.siteNotificationsTable)
      .where(eq(schema.siteNotificationsTable.id, notification.id));

    expect(afterDeleteAttempt).toBeDefined();
  });
});
