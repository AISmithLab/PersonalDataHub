import React, { useEffect } from 'react';
import { View, Text, Pressable } from 'react-native';
import type { AppState } from '../hooks/useAppState';
import type { PhotoMsg } from '../device/deviceBridge.types';
import { FilterCards } from '../components/FilterCards';

const PLACEHOLDER_PHOTOS: PhotoMsg[] = [
  { id: 'img-1', title: 'Receipt_Lunch.jpg', album: 'Receipts', date: '2026-07-28T12:00:00Z', width: 4032, height: 3024 },
  { id: 'img-2', title: 'Screenshot_Flight.png', album: 'Screenshots', date: '2026-07-27T15:30:00Z', width: 1080, height: 2400 },
  { id: 'img-3', title: 'Whiteboard_Notes.jpg', album: 'Work', date: '2026-07-25T09:15:00Z', width: 3024, height: 4032 },
  { id: 'img-4', title: 'Expense_Report.jpg', album: 'Receipts', date: '2026-07-24T18:45:00Z', width: 4032, height: 3024 },
];

export function PhotoTab({ state }: { state: AppState }) {
  useEffect(() => {
    state.loadPhotos(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const photoFilters = state.filters.filter((f) => f.source === 'photo');
  const activeFilterCount = photoFilters.filter((f) => f.enabled).length;
  const photosList = state.photos && state.photos.length ? state.photos : PLACEHOLDER_PHOTOS;

  return (
    <View>
      <View className="flex-row items-center justify-between mb-5 flex-wrap gap-3">
        <View>
          <Text className="text-headline-md text-on-surface font-bold">Device Photos &amp; Gallery</Text>
          <Text className="text-body-sm text-on-surface-variant mt-1">
            Zero access by default. Automatically strips EXIF GPS coordinates, camera serial numbers, and identifiable info.
          </Text>
        </View>
      </View>

      {state.photosError ? (
        <View className="bg-surface border border-error/40 rounded-lg px-4.5 py-3.5 mb-4 flex-row items-center justify-between gap-3">
          <View className="flex-1">
            <Text className="font-semibold text-error">Photo Permission Required</Text>
            <Text className="text-body-sm text-on-surface-variant mt-0.5">
              Access was denied ({state.photosError}). Please grant photo/media access in Android Settings.
            </Text>
          </View>
          <Pressable onPress={() => state.loadPhotos(true)} className="border border-outline-variant rounded-lg px-3 py-1.5">
            <Text className="text-label-sm text-on-surface-variant">Retry Permission</Text>
          </Pressable>
        </View>
      ) : null}

      <View className="bg-surface rounded-lg border border-outline-variant p-5 mb-4">
        <View className="flex-row items-center justify-between mb-3.5">
          <Text className="text-label-sm text-on-surface-variant uppercase">Photo Quick Filters ({activeFilterCount} active)</Text>
          <Text className="text-label-sm text-primary font-semibold">EXIF Protection ON by Default</Text>
        </View>
        <FilterCards
          source="photo"
          filters={photoFilters}
          filterTypes={state.filterTypes}
          onToggle={state.toggleFilter}
          onValueChange={state.updateFilterValue}
        />
      </View>

      <View className="bg-surface rounded-lg border border-outline-variant p-5">
        <View className="flex-row items-center justify-between mb-4">
          <View>
            <Text className="text-body-md font-bold text-on-surface">Gallery Preview (EXIF Stripped)</Text>
            <Text className="text-label-sm text-on-surface-variant mt-0.5">
              What AI agents see when querying your photos with active filters
            </Text>
          </View>
          <Pressable onPress={() => state.loadPhotos(true)} className="border border-outline-variant rounded-lg px-3 py-1.5">
            <Text className="text-label-sm text-on-surface-variant">Refresh Gallery</Text>
          </Pressable>
        </View>

        <View className="flex-row flex-wrap gap-3.5">
          {photosList.map((p) => (
            <PhotoCard key={p.id} photo={p} />
          ))}
        </View>
      </View>
    </View>
  );
}

function PhotoCard({ photo }: { photo: PhotoMsg }) {
  const dateStr = photo.date ? new Date(photo.date).toLocaleDateString() : '';
  return (
    <View className="border border-outline-variant rounded-lg p-3 bg-surface" style={{ width: 220 }}>
      <View className="flex-row items-center justify-between mb-2">
        <View className="bg-primary/10 rounded px-1.5 py-0.5">
          <Text className="text-label-sm text-primary font-semibold">{photo.album || 'Gallery'}</Text>
        </View>
        <Text className="text-label-sm text-on-surface-variant">EXIF STRIPPED</Text>
      </View>
      <Text className="text-body-sm font-semibold text-on-surface mb-1.5" numberOfLines={2}>
        {photo.title || 'Photo'}
      </Text>
      <Text className="text-label-sm text-on-surface-variant">
        Dimensions: {photo.width || 4032} × {photo.height || 3024}
      </Text>
      <Text className="text-label-sm text-on-surface-variant">Date: {dateStr}</Text>
    </View>
  );
}
