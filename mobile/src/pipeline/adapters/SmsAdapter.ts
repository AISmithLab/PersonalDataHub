import { NativeModules, Platform } from 'react-native';
import { DataAdapter } from '../PipelineController';

interface SmsMsg { id: string; address: string; body: string; date: number; type: number; read: boolean; }
interface ISmsModule { getMessages(box: string, limit: number): Promise<SmsMsg[]>; }

const SmsNative = Platform.OS === 'android' ? (NativeModules.SmsModule as ISmsModule) : null;

export class SmsAdapter implements DataAdapter {
  sourceId = 'source_android_sms';
  
  async fetchRawData(): Promise<SmsMsg[]> {
    if (!SmsNative) throw new Error('SMS Module not available');
    // Fetch last 50 messages for processing
    return await SmsNative.getMessages('inbox', 50);
  }

  normalize(rawData: SmsMsg[]): string[] {
    // Standardize native objects into simple JSON strings for the Sandbox
    // This creates a strict boundary between native objects and the JS execution environment
    return rawData.map(msg => JSON.stringify({
      external_id: msg.id,
      sender: msg.address,
      text_content: msg.body,
      timestamp: msg.date
    }));
  }
}
