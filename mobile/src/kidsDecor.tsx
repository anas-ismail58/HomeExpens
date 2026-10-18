import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import type { IconName } from './components';
import { usePreferences } from './preferences';

/** Scattered stars and bubbles behind the kids' app headers; purely decorative. */
const SPARKLES: { icon: IconName; size: number; top: `${number}%`; left: `${number}%`; opacity: number }[] = [
  { icon: 'star', size: 22, top: '12%', left: '8%', opacity: 0.95 },
  { icon: 'star', size: 12, top: '30%', left: '22%', opacity: 0.7 },
  { icon: 'sparkles', size: 18, top: '62%', left: '10%', opacity: 0.8 },
  { icon: 'star', size: 14, top: '18%', left: '78%', opacity: 0.75 },
  { icon: 'star', size: 26, top: '52%', left: '86%', opacity: 0.9 },
  { icon: 'sparkles', size: 14, top: '78%', left: '62%', opacity: 0.7 },
];

export function SkyDecor() {
  const { colors } = usePreferences();
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
      <View style={{ position: 'absolute', width: 220, height: 220, borderRadius: 110, top: -90, right: -70, backgroundColor: 'rgba(255,255,255,0.10)' }} />
      <View style={{ position: 'absolute', width: 140, height: 140, borderRadius: 70, bottom: -60, left: -40, backgroundColor: 'rgba(255,255,255,0.08)' }} />
      <View style={{ position: 'absolute', width: 60, height: 60, borderRadius: 30, top: '40%', left: '45%', backgroundColor: 'rgba(255,255,255,0.06)' }} />
      {SPARKLES.map((star, index) => (
        <Ionicons key={index} name={star.icon} size={star.size} color={colors.accent} style={{ position: 'absolute', top: star.top, left: star.left, opacity: star.opacity }} />
      ))}
    </View>
  );
}

/** Sky gradient with the decorations, used by the kids' login and home headers. */
export function SkyHero({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors } = usePreferences();
  return (
    <LinearGradient colors={[colors.heroFrom, colors.heroTo]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[{ overflow: 'hidden' }, style]}>
      <SkyDecor />
      {children}
    </LinearGradient>
  );
}

/** The app's mascot badge: a sunny circle with a smile and a star. */
export function KidsBadge({ size = 92 }: { size?: number }) {
  const { colors } = usePreferences();
  return (
    <View style={{ width: size, height: size }}>
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', borderWidth: 5, borderColor: 'rgba(255,255,255,0.85)', boxShadow: '0 8px 20px rgba(0,0,0,0.18)' }}>
        <Ionicons name="happy" size={size * 0.58} color={colors.accentText} />
      </View>
      <View style={{ position: 'absolute', top: -4, right: -4, width: size * 0.36, height: size * 0.36, borderRadius: size * 0.18, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="star" size={size * 0.22} color={colors.accent} />
      </View>
    </View>
  );
}
