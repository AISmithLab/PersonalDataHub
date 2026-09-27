export interface SmsMsg {
  id: string;
  address: string;
  body: string;
  date: number;
  type: number;
  read: boolean;
}

export interface ContactInfo {
  name: string;
  number: string;
}

export interface PhotoMsg {
  id: string;
  title: string;
  album: string;
  timestamp?: string;
  date?: string;
  uri?: string;
  width?: number;
  height?: number;
}

export interface DeviceBridge {
  getSmsMessages(box: 'inbox' | 'sent' | 'all', limit: number): Promise<SmsMsg[]>;
  sendSms(to: string, body: string): Promise<void>;
  getContacts(): Promise<ContactInfo[]>;
  getPhotos(limit: number): Promise<PhotoMsg[]>;
}
