import { DataAdapter } from '../PipelineController';

// Example stub for Email (e.g. fetched from IMAP background sync or an App Group SQLite DB)
interface EmailMsg { messageId: string; subject: string; snippet: string; from: string; date: number; }

export class EmailAdapter implements DataAdapter {
  sourceId = 'source_synced_emails';
  
  async fetchRawData(): Promise<EmailMsg[]> {
    // In a real app, this might query a local synced SQLite database of emails
    console.log('[EmailAdapter] Fetching local emails...');
    return [
      { messageId: 'msg_999', subject: 'Your Flight Itinerary', snippet: 'Confirmation code: Z9A8B7', from: 'airlines@flight.com', date: 1784534400000 }
    ];
  }

  normalize(rawData: EmailMsg[]): string[] {
    return rawData.map(email => JSON.stringify({
      external_id: email.messageId,
      sender_address: email.from,
      header_subject: email.subject,
      body_preview: email.snippet,
      timestamp: email.date
    }));
  }
}
