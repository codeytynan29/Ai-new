import type { Conversation, Message } from '../types.ts'
import type { ConversationStore } from './ConversationStore.ts'

let counter = 0
const id = (p: string) => `${p}_${Date.now().toString(36)}_${(++counter).toString(36)}`

export class InMemoryStore implements ConversationStore {
  #conversations = new Map<string, Conversation>()
  #messages      = new Map<string, Message[]>()
  #seq           = new Map<string, number>()

  async createConversation(): Promise<Conversation> {
    const c: Conversation = { id: id('conv'), createdAt: new Date().toISOString() }
    this.#conversations.set(c.id, c)
    this.#messages.set(c.id, [])
    this.#seq.set(c.id, 0)
    return c
  }

  async getConversation(cid: string) { return this.#conversations.get(cid) ?? null }

  async addMessage(m: Omit<Message, 'seq'>): Promise<Message> {
    const list = this.#messages.get(m.conversationId)
    if (!list) throw new Error(`no such conversation: ${m.conversationId}`)
    const seq = (this.#seq.get(m.conversationId) ?? 0) + 1
    this.#seq.set(m.conversationId, seq)
    const stored: Message = { ...m, seq }
    list.push(stored)
    return stored
  }

  async updateMessage(mid: string, patch: Partial<Message>): Promise<Message> {
    for (const list of this.#messages.values()) {
      const i = list.findIndex(m => m.id === mid)
      if (i !== -1) { list[i] = { ...list[i], ...patch }; return list[i] }
    }
    throw new Error(`no such message: ${mid}`)
  }

  async getMessages(cid: string): Promise<Message[]> {
    return [...(this.#messages.get(cid) ?? [])].sort((a, b) => a.seq - b.seq)
  }
}

export const newId = id
