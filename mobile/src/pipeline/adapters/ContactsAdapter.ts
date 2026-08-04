import { NativeModules, Platform } from 'react-native';
import { DataAdapter } from '../PipelineController';

interface IContactsModule { getContacts(): Promise<{name: string, number: string}[]>; }
const ContactsNative: IContactsModule | null = Platform.OS === 'android' ? (NativeModules.ContactsModule as IContactsModule) : null;

export class ContactsAdapter implements DataAdapter {
  sourceId = 'source_android_contacts';
  
  async fetchRawData(): Promise<{name: string, number: string}[]> {
    if (!ContactsNative) throw new Error('Contacts Module not available');
    return await ContactsNative.getContacts();
  }

  normalize(rawData: {name: string, number: string}[]): string[] {
    return rawData.map(contact => JSON.stringify({
      display_name: contact.name,
      phone_number: contact.number
    }));
  }
}
