import { describe, it, expect } from 'vitest';
import { applyFilters, stripExifMetadata, FILTER_TYPES, type QuickFilter } from './filters.js';
import type { DataRow } from './connectors/types.js';

describe('filters module', () => {
  describe('stripExifMetadata', () => {
    it('strips EXIF GPS coordinates, camera serial numbers, and identifiable info', () => {
      const input = {
        title: 'Beach sunset.jpg',
        album: 'Vacation 2026',
        latitude: 34.0522,
        longitude: -118.2437,
        gps: { lat: 34.0522, lng: -118.2437 },
        exif: { fNumber: 1.8, iso: 100 },
        serialNumber: 'CAM-SN-998877',
        cameraModel: 'Pixel 10 Pro',
        cameraMake: 'Google',
        author: 'Alice Smith',
        location: 'Santa Monica',
        deviceModel: 'Pixel 10 Pro',
        width: 4032,
        height: 3024,
      };

      const cleaned = stripExifMetadata(input);

      expect(cleaned).toEqual({
        title: 'Beach sunset.jpg',
        album: 'Vacation 2026',
        width: 4032,
        height: 3024,
      });
    });
  });

  describe('applyFilters with EXIF stripping', () => {
    const photoRow: DataRow = {
      source_item_id: 'photo-1',
      source: 'photo',
      type: 'image',
      timestamp: '2026-07-25T10:00:00Z',
      data: {
        title: 'Receipt_Lunch.jpg',
        album: 'Receipts',
        latitude: 37.7749,
        longitude: -122.4194,
        cameraModel: 'Pixel 10',
        serialNumber: 'ABC12345',
        author: 'Goose',
      },
    };

    it('automatically strips EXIF GPS and identifiable metadata by default for photo rows', () => {
      const results = applyFilters([photoRow], []);
      expect(results).toHaveLength(1);
      expect(results[0].data).toEqual({
        title: 'Receipt_Lunch.jpg',
        album: 'Receipts',
      });
      expect(results[0].data.latitude).toBeUndefined();
      expect(results[0].data.serialNumber).toBeUndefined();
    });

    it('preserves EXIF metadata only when photo_keep_exif filter is explicitly enabled', () => {
      const keepExifFilter: QuickFilter = {
        id: 'f-1',
        source: 'photo',
        type: 'photo_keep_exif',
        value: '',
        enabled: 1,
      };

      const results = applyFilters([photoRow], [keepExifFilter]);
      expect(results).toHaveLength(1);
      expect(results[0].data.latitude).toBe(37.7749);
      expect(results[0].data.cameraModel).toBe('Pixel 10');
    });

    it('filters photos by album when photo_album filter is enabled', () => {
      const albumFilter: QuickFilter = {
        id: 'f-2',
        source: 'photo',
        type: 'photo_album',
        value: 'Receipts',
        enabled: 1,
      };

      const results = applyFilters([photoRow], [albumFilter]);
      expect(results).toHaveLength(1);

      const nonMatchFilter: QuickFilter = {
        id: 'f-3',
        source: 'photo',
        type: 'photo_album',
        value: 'Vacation',
        enabled: 1,
      };

      const emptyResults = applyFilters([photoRow], [nonMatchFilter]);
      expect(emptyResults).toHaveLength(0);
    });

    it('filters SMS rows by sender using sms_sender', () => {
      const smsRow: DataRow = {
        source_item_id: 'sms-1',
        source: 'sms',
        type: 'message',
        timestamp: '2026-07-28T09:00:00Z',
        data: {
          sender: '+15551234567',
          text: 'Your code is 123456',
        },
      };

      const smsFilter: QuickFilter = {
        id: 'f-4',
        source: 'sms',
        type: 'sms_sender',
        value: '5551234567',
        enabled: 1,
      };

      expect(applyFilters([smsRow], [smsFilter])).toHaveLength(1);

      const smsFilterMismatch: QuickFilter = {
        id: 'f-5',
        source: 'sms',
        type: 'sms_sender',
        value: '9999999999',
        enabled: 1,
      };

      expect(applyFilters([smsRow], [smsFilterMismatch])).toHaveLength(0);
    });
  });

  describe('FILTER_TYPES metadata check', () => {
    it('defines sources for each filter type', () => {
      expect(FILTER_TYPES.photo_after.source).toBe('photo');
      expect(FILTER_TYPES.photo_album.source).toBe('photo');
      expect(FILTER_TYPES.photo_keep_exif.source).toBe('photo');
      expect(FILTER_TYPES.sms_after.source).toBe('sms');
      expect(FILTER_TYPES.sms_sender.source).toBe('sms');
      expect(FILTER_TYPES.email_label.source).toBe('gmail');
      expect(FILTER_TYPES.cal_calendar_id.source).toBe('calendar');
    });
  });
});
