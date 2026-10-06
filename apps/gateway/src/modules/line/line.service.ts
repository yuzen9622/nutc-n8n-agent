import type { LineEvent } from './line.schema.js';
import type { LineRepository } from './line.repository.js';
import type { LineProvider } from './line.provider.js';

export class LineService {
  constructor(private readonly repository: Pick<LineRepository,'accept'|'identity'>,
    private readonly provider: Pick<LineProvider,'verifyIdentity'>) {}
  async receive(events: LineEvent[]): Promise<void> {
    for (const event of events) {
      // Bound redelivery/replay before seven-day deduplication records can be purged.
      const age=Date.now()-event.timestamp;
      if (age>24*60*60*1000 || age < -5*60*1000) continue;
      // Group/room data and unsupported message types never enter storage or a model.
      if (event.source.type !== 'user' || !event.source.userId) continue;
      if (event.type === 'unfollow') {
        await this.repository.accept(event.webhookEventId,event.source.userId,'','revoke');
      } else if (event.type === 'message' && event.message?.type === 'text' && event.message.text?.trim()) {
        const text = event.message.text.trim();
        const command = text === '清除對話' ? 'clear' : text === '解除綁定' ? 'revoke' : text === '重新啟用' ? 'resume' : 'message';
        await this.repository.accept(event.webhookEventId,event.source.userId,text,command);
      }
    }
  }
  async identity(idToken: string) { return this.repository.identity(await this.provider.verifyIdentity(idToken)); }
}
