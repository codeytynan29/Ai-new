// Spec §14: storage behind an interface so a database can replace the
// in-memory implementation without touching the engine.

import type { Conversation, Message } from '../types.ts'

export interface ConversationStore {
  createConversation(): Promise<Conversation>
  getConversation(id: string): Promise<Conversation | null>
  /** Assigns `seq` and returns the stored message. The store owns sequence
   *  numbering, because it is the only component that sees every write. */
  addMessage(message: Omit<Message, 'seq'>): Promise<Message>
  updateMessage(id: string, patch: Partial<Message>): Promise<Message>
  getMessages(conversationId: string): Promise<Message[]>
}
