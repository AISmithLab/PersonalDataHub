import { describe, it, expect } from 'vitest';
import { PhotoConnector } from './connector.js';
import type { DataRow } from '../types.js';

describe('PhotoConnector', () => {
  const samplePhotos: DataRow[] = [
    {
      source: 'photo',
      source_item_id: 'img-101',
      type: 'image',
      timestamp: '2026-07-25T12:00:00Z',
      data: {
        title: 'Receipt_1.jpg',
        album: 'Receipts',
        latitude: 37.7749,
        longitude: -122.4194,
        cameraModel: 'Pixel 10',
        serialNumber: 'SN-12345',
        author: 'Alice',
      },
    },
    {
      source: 'photo',
      source_item_id: 'img-102',
      type: 'image',
      timestamp: '2026-07-27T14:00:00Z',
      data: {
        title: 'Vacation_Beach.jpg',
        album: 'Vacation',
        latitude: 21.3069,
        longitude: -157.8583,
        cameraModel: 'Pixel 10 Pro',
        author: 'Alice',
      },
    },
  ];

  it('automatically strips EXIF GPS and identifiable metadata by default in fetch()', async () => {
    const connector = new PhotoConnector();
    connector.setMemoryPhotos(samplePhotos);

    const results = await connector.fetch({});
    expect(results).toHaveLength(2);
    expect(results[0].data.latitude).toBeUndefined();
    expect(results[0].data.serialNumber).toBeUndefined();
    expect(results[0].data.author).toBeUndefined();
    expect(results[0].data.title).toBe('Receipt_1.jpg');
    expect(results[0].data.album).toBe('Receipts');
  });

  it('keeps EXIF metadata only when params.keepExif is true', async () => {
    const connector = new PhotoConnector();
    connector.setMemoryPhotos(samplePhotos);

    const results = await connector.fetch({}, { keepExif: true });
    expect(results).toHaveLength(2);
    expect(results[0].data.latitude).toBe(37.7749);
    expect(results[0].data.serialNumber).toBe('SN-12345');
  });

  it('filters photos by after timestamp', async () => {
    const connector = new PhotoConnector();
    connector.setMemoryPhotos(samplePhotos);

    const results = await connector.fetch({ after: '2026-07-26T00:00:00Z' });
    expect(results).toHaveLength(1);
    expect(results[0].data.title).toBe('Vacation_Beach.jpg');
  });

  it('filters photos by album name', async () => {
    const connector = new PhotoConnector();
    connector.setMemoryPhotos(samplePhotos);

    const results = await connector.fetch({}, { album: 'Receipts' });
    expect(results).toHaveLength(1);
    expect(results[0].data.title).toBe('Receipt_1.jpg');
  });

  it('executes staged actions (share_photo, create_album)', async () => {
    const connector = new PhotoConnector();

    const shareResult = await connector.executeAction('share_photo', { photoId: 'img-101', recipient: 'bob@example.com' });
    expect(shareResult.success).toBe(true);
    expect(shareResult.message).toContain('img-101');

    const albumResult = await connector.executeAction('create_album', { albumName: 'Taxes 2026' });
    expect(albumResult.success).toBe(true);
    expect(albumResult.message).toContain('Taxes 2026');
  });
});
