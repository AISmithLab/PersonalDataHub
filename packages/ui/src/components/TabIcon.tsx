import React from 'react';
import Svg, { Path, Circle, Ellipse, Line } from 'react-native-svg';

export type TabIconName = 'chat' | 'bolt' | 'database' | 'settings';

interface Props {
  name: TabIconName;
  color: string;
  size?: number;
}

export function TabIcon({ name, color, size = 22 }: Props) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none' };
  const stroke = { stroke: color, strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

  if (name === 'chat') {
    return (
      <Svg {...common}>
        <Path
          d="M4 5.5C4 4.67 4.67 4 5.5 4h13c.83 0 1.5.67 1.5 1.5v9c0 .83-.67 1.5-1.5 1.5H9l-3.8 3.1c-.46.38-1.2.05-1.2-.55V16H5.5C4.67 16 4 15.33 4 14.5v-9Z"
          {...stroke}
        />
      </Svg>
    );
  }

  if (name === 'bolt') {
    return (
      <Svg {...common}>
        <Path d="M13 3 6 13.5h5L10.5 21 18 10h-5L13 3Z" {...stroke} fill="none" />
      </Svg>
    );
  }

  if (name === 'database') {
    return (
      <Svg {...common}>
        <Ellipse cx="12" cy="6" rx="7" ry="2.5" {...stroke} />
        <Path d="M5 6v12c0 1.38 3.13 2.5 7 2.5s7-1.12 7-2.5V6" {...stroke} />
        <Path d="M5 12c0 1.38 3.13 2.5 7 2.5s7-1.12 7-2.5" {...stroke} />
      </Svg>
    );
  }

  // settings
  return (
    <Svg {...common}>
      <Circle cx="12" cy="12" r="3.2" {...stroke} />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
        <Line
          key={deg}
          x1="12"
          y1="3.5"
          x2="12"
          y2="5.8"
          {...stroke}
          transform={`rotate(${deg} 12 12)`}
        />
      ))}
    </Svg>
  );
}
