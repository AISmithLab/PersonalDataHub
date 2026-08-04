import { DataAdapter } from '../PipelineController';

// Example stub for iOS/Android Calendar events (e.g. via react-native-calendar-events)
interface CalendarEvent { id: string; title: string; startDate: string; endDate: string; location?: string; }

export class CalendarAdapter implements DataAdapter {
  sourceId = 'source_device_calendar';
  
  async fetchRawData(): Promise<CalendarEvent[]> {
    // In a real app, this would call NativeModules.Calendar.getEvents(...)
    console.log('[CalendarAdapter] Fetching calendar events...');
    return [
      { id: 'cal_123', title: 'Dentist Appointment', startDate: '2026-07-21T10:00:00Z', endDate: '2026-07-21T11:00:00Z' }
    ];
  }

  normalize(rawData: CalendarEvent[]): string[] {
    return rawData.map(event => JSON.stringify({
      external_id: event.id,
      event_name: event.title,
      time_start: event.startDate,
      time_end: event.endDate,
      venue: event.location || 'Unknown'
    }));
  }
}
