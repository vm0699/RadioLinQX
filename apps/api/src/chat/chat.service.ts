import { Injectable } from '@nestjs/common';
import { JsonStore } from '../store/json-store';

export interface ChatMessage {
  id: string;
  author: string;
  role: 'radiologist' | 'centre' | 'referrer' | 'system';
  text: string;
  at: string;
}

/** One thread per case. id === caseId. */
export interface ChatThread {
  id: string;
  caseId: string;
  patientName: string;
  messages: ChatMessage[];
  updatedAt: string;
}

@Injectable()
export class ChatService {
  private store = new JsonStore<ChatThread>('chat.json', () => []);

  async thread(caseId: string, patientName = ''): Promise<ChatThread> {
    const existing = await this.store.find(caseId);
    if (existing) return existing;
    const fresh: ChatThread = {
      id: caseId,
      caseId,
      patientName,
      messages: [],
      updatedAt: new Date().toISOString(),
    };
    await this.store.insert(fresh);
    return fresh;
  }

  async post(
    caseId: string,
    msg: Pick<ChatMessage, 'author' | 'role' | 'text'>,
    patientName = '',
  ): Promise<ChatThread> {
    const t = await this.thread(caseId, patientName);
    const now = new Date().toISOString();
    t.messages.push({
      id: `m-${Date.now().toString(36)}`,
      author: msg.author || 'You',
      role: msg.role || 'centre',
      text: msg.text,
      at: now,
    });
    t.updatedAt = now;
    if (patientName && !t.patientName) t.patientName = patientName;
    await this.store.update(caseId, t);
    return t;
  }

  async threads(): Promise<ChatThread[]> {
    return (await this.store.all()).sort(
      (a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt),
    );
  }
}
