import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

/**
 * Small, fast animations built on React Native's Animated API (no native module, so they ship
 * with an over-the-air update). Everything turns off when the phone's "Reduce Motion" is on.
 */

const native = Platform.OS !== 'web';

let reduceMotion = false;
void AccessibilityInfo.isReduceMotionEnabled()
  .then((value) => {
    reduceMotion = value;
  })
  .catch(() => undefined);
AccessibilityInfo.addEventListener?.('reduceMotionChanged', (value) => {
  reduceMotion = value;
});

/** Fades and slides its children up into place. `index` staggers siblings (~60 ms apart). */
export function FadeInView({ children, index = 0, style }: { children: ReactNode; index?: number; style?: StyleProp<ViewStyle> }) {
  const [progress] = useState(() => new Animated.Value(reduceMotion ? 1 : 0));
  useEffect(() => {
    if (reduceMotion) return;
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 360,
      delay: Math.min(index, 8) * 60,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: native,
    });
    animation.start();
    return () => animation.stop();
  }, [index, progress]);
  return (
    <Animated.View
      style={[
        style,
        { opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] },
      ]}
    >
      {children}
    </Animated.View>
  );
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** A Pressable that dips slightly while pressed — tactile feedback for cards and tiles. */
export function PressableScale({ children, style, ...props }: Omit<PressableProps, 'style'> & { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const [scale] = useState(() => new Animated.Value(1));
  const to = (value: number) => {
    if (reduceMotion) return;
    Animated.spring(scale, { toValue: value, speed: 40, bounciness: 6, useNativeDriver: native }).start();
  };
  return (
    <AnimatedPressable
      {...props}
      style={[style, { transform: [{ scale }] }]}
      onPressIn={(event) => {
        to(0.97);
        props.onPressIn?.(event);
      }}
      onPressOut={(event) => {
        to(1);
        props.onPressOut?.(event);
      }}
    >
      {children}
    </AnimatedPressable>
  );
}

/** Counts from the previous value to the new one (from 0 the first time). */
export function useCountUp(target: number, duration = 650) {
  const [shown, setShown] = useState(reduceMotion ? target : 0);
  const from = useRef(reduceMotion ? target : 0);
  useEffect(() => {
    if (reduceMotion || !Number.isFinite(target)) {
      from.current = target;
      void Promise.resolve().then(() => setShown(target));
      return;
    }
    const start = from.current;
    const value = new Animated.Value(0);
    const id = value.addListener(({ value: t }) => setShown(start + (target - start) * t));
    const animation = Animated.timing(value, { toValue: 1, duration, easing: Easing.out(Easing.cubic), useNativeDriver: false });
    animation.start(() => {
      from.current = target;
      setShown(target);
    });
    return () => {
      animation.stop();
      value.removeListener(id);
      from.current = target;
    };
  }, [duration, target]);
  return shown;
}

/** `useCountUp` as a component, for screens that return early: `<CountUp value={n}>{(v) => <Text>{v}</Text>}</CountUp>`. */
export function CountUp({ value, children }: { value: number; children: (shown: number) => ReactNode }) {
  return <>{children(useCountUp(value))}</>;
}

/** A bar that grows to `share` (0–1) of its track. */
export function GrowBar({ share, color, height = 8, radius = 4, minWidth = 0 }: { share: number; color: string; height?: number; radius?: number; minWidth?: number }) {
  const clamped = Math.max(0, Math.min(1, share));
  const [width] = useState(() => new Animated.Value(reduceMotion ? clamped : 0));
  useEffect(() => {
    if (reduceMotion) {
      width.setValue(clamped);
      return;
    }
    const animation = Animated.timing(width, { toValue: clamped, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: false });
    animation.start();
    return () => animation.stop();
  }, [clamped, width]);
  return (
    <Animated.View
      style={{
        height,
        borderRadius: radius,
        minWidth: clamped > 0 ? minWidth : 0,
        backgroundColor: color,
        width: width.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
      }}
    />
  );
}
