import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import type { ContactInfo, DeviceBridge, PhotoMsg, SmsMsg } from './deviceBridge.types';

interface ISmsModule {
  getMessages(box: string, limit: number): Promise<SmsMsg[]>;
  sendMessage(to: string, body: string): Promise<void>;
}
interface IContactsModule {
  getContacts(): Promise<ContactInfo[]>;
}
interface IPhotosModule {
  getPhotos(limit: number): Promise<PhotoMsg[]>;
}

const SmsNative: ISmsModule | null = Platform.OS === 'android' ? (NativeModules.SmsModule as ISmsModule) : null;
const ContactsNative: IContactsModule | null = (NativeModules.ContactsModule as IContactsModule) ?? null;
const PhotosNative: IPhotosModule | null = (NativeModules.PhotosModule as IPhotosModule) ?? null;

async function requestPerm(perm: string): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const r = await PermissionsAndroid.request(perm as Parameters<typeof PermissionsAndroid.request>[0]);
  return r === PermissionsAndroid.RESULTS.GRANTED;
}

export const deviceBridge: DeviceBridge = {
  async getSmsMessages(box, limit) {
    if (!SmsNative) throw new Error('NOT_ANDROID');
    const granted = await requestPerm(PermissionsAndroid.PERMISSIONS.READ_SMS);
    if (!granted) throw new Error('PERMISSION_DENIED');
    return SmsNative.getMessages(box, limit);
  },

  async sendSms(to, body) {
    if (!SmsNative) throw new Error('NOT_ANDROID');
    const granted = await requestPerm(PermissionsAndroid.PERMISSIONS.SEND_SMS);
    if (!granted) throw new Error('PERMISSION_DENIED');
    await SmsNative.sendMessage(to, body);
  },

  async getContacts() {
    if (!ContactsNative) return [];
    if (Platform.OS === 'android') {
      const granted = await requestPerm(PermissionsAndroid.PERMISSIONS.READ_CONTACTS);
      if (!granted) throw new Error('PERMISSION_DENIED');
    }
    return ContactsNative.getContacts();
  },

  async getPhotos(limit) {
    if (!PhotosNative) return [];
    if (Platform.OS === 'android') {
      const perm =
        (Platform.Version as number) >= 33
          ? 'android.permission.READ_MEDIA_IMAGES'
          : 'android.permission.READ_EXTERNAL_STORAGE';
      const granted = await requestPerm(perm);
      if (!granted) throw new Error('PERMISSION_DENIED');
    }
    return PhotosNative.getPhotos(limit);
  },
};
