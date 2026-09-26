import React, { useState } from 'react';
import { View, Text, Pressable, TextInput, Switch } from 'react-native';
import type { Filter, FilterType } from '../api/client';

interface Props {
  source: string;
  filters: Filter[];
  filterTypes: Record<string, FilterType>;
  onToggle: (source: string, type: string, enabled: boolean, existingId: string, value: string) => void;
  onValueChange: (source: string, type: string, value: string, existingId: string) => void;
}

export function FilterCards({ source, filters, filterTypes, onToggle, onValueChange }: Props) {
  const typeKeys = Object.keys(filterTypes).filter((k) => {
    const s = filterTypes[k].source;
    return !s || s === source || s === 'all';
  });

  if (!typeKeys.length) {
    return <Text className="text-on-surface-variant text-body-sm">Loading filter types...</Text>;
  }

  return (
    <View className="flex-row flex-wrap gap-3">
      {typeKeys.map((typeKey) => (
        <FilterCard
          key={typeKey}
          source={source}
          typeKey={typeKey}
          meta={filterTypes[typeKey]}
          existing={filters.find((f) => f.type === typeKey)}
          onToggle={onToggle}
          onValueChange={onValueChange}
        />
      ))}
    </View>
  );
}

function FilterCard({
  source,
  typeKey,
  meta,
  existing,
  onToggle,
  onValueChange,
}: {
  source: string;
  typeKey: string;
  meta: FilterType;
  existing: Filter | undefined;
  onToggle: Props['onToggle'];
  onValueChange: Props['onValueChange'];
}) {
  const isEnabled = existing ? !!existing.enabled : false;
  const [value, setValue] = useState(existing?.value ?? '');
  const filterId = existing?.id ?? '';

  return (
    <View
      className={`p-3.5 rounded-lg bg-surface border ${
        isEnabled ? 'border-primary/30' : 'border-outline-variant'
      }`}
      style={{ minWidth: 280, flexGrow: 1 }}
    >
      <View className={`flex-row items-center gap-2.5 ${meta.needsValue ? 'mb-2.5' : ''}`}>
        <Switch
          value={isEnabled}
          onValueChange={(next) => onToggle(source, typeKey, next, filterId, value)}
        />
        <Text className={isEnabled ? 'text-on-surface font-medium text-body-sm' : 'text-on-surface-variant text-body-sm'}>
          {meta.label}
        </Text>
      </View>
      {meta.needsValue && (
        <TextInput
          value={value}
          placeholder={meta.placeholder}
          onChangeText={setValue}
          onBlur={() => onValueChange(source, typeKey, value, filterId)}
          className="w-full text-body-sm px-2.5 py-1.5 rounded border border-outline-variant"
        />
      )}
    </View>
  );
}
