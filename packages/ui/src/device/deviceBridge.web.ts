import { API_BASE_URL } from '../api/baseUrl';
import type { DeviceBridge } from './deviceBridge.types';

export const deviceBridge: DeviceBridge = {
  async getSmsMessages() {
    throw new Error('NOT_ANDROID');
  },

  async sendSms() {
    throw new Error('NOT_ANDROID');
  },

  async getContacts() {
    return [];
  },

  async getPhotos(limit) {
    const res = await fetch(`${API_BASE_URL}/api/photos/preview?limit=${limit}&t=${Date.now()}`);
    const data = await res.json();
    return data?.photos ?? [];
  },
};
