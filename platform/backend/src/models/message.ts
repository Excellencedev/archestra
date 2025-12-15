import { and, eq, gt } from "drizzle-orm";
import db, { schema } from "@/database";
import type { InsertMessage, Message } from "@/types";

class MessageModel {
  static async create(data: InsertMessage): Promise<Message> {
    const [message] = await db
      .insert(schema.messagesTable)
      .values(data)
      .returning();

    return message;
  }

  static async bulkCreate(messages: InsertMessage[]): Promise<void> {
    if (messages.length === 0) {
      return;
    }

    await db.insert(schema.messagesTable).values(messages);
  }

  static async findByConversation(conversationId: string): Promise<Message[]> {
    const messages = await db
      .select()
      .from(schema.messagesTable)
      .where(eq(schema.messagesTable.conversationId, conversationId))
      .orderBy(schema.messagesTable.createdAt);

    return messages;
  }

  static async delete(id: string): Promise<void> {
    await db
      .delete(schema.messagesTable)
      .where(eq(schema.messagesTable.id, id));
  }

  static async deleteByConversation(conversationId: string): Promise<void> {
    await db
      .delete(schema.messagesTable)
      .where(eq(schema.messagesTable.conversationId, conversationId));
  }

  static async deleteAfter(conversationId: string, date: Date): Promise<void> {
    await db
      .delete(schema.messagesTable)
      .where(
        and(
          eq(schema.messagesTable.conversationId, conversationId),
          gt(schema.messagesTable.createdAt, date),
        ),
      );
  }

  static async findById(id: string): Promise<Message | undefined> {
    const [message] = await db
      .select()
      .from(schema.messagesTable)
      .where(eq(schema.messagesTable.id, id));
    return message;
  }

  // biome-ignore lint/suspicious/noExplicitAny: Content is dynamic json
  static async update(id: string, content: any): Promise<Message | undefined> {
    const [message] = await db
      .update(schema.messagesTable)
      .set({ content })
      .where(eq(schema.messagesTable.id, id))
      .returning();

    return message;
  }
}

export default MessageModel;
