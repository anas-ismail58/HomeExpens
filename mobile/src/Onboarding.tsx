import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ComponentProps } from 'react';
import { PrimaryButton } from './components';
import type { StringKey } from './i18n';
import { usePreferences, useStyles } from './preferences';
import type { Tone } from './theme';
import { Text } from './typography';

const INTRO_KEY = 'intro-seen-v1';

type Slide = { icon: ComponentProps<typeof Ionicons>['name']; tone: Tone; title: StringKey; body: StringKey };

const SLIDES: Slide[] = [
  { icon: 'home', tone: 'indigo', title: 'intro1Title', body: 'intro1Body' },
  { icon: 'receipt', tone: 'amber', title: 'intro2Title', body: 'intro2Body' },
  { icon: 'wallet', tone: 'teal', title: 'intro3Title', body: 'intro3Body' },
  { icon: 'school', tone: 'violet', title: 'intro4Title', body: 'intro4Body' },
  { icon: 'lock-closed', tone: 'rose', title: 'intro5Title', body: 'intro5Body' },
  { icon: 'people', tone: 'indigo', title: 'intro6Title', body: 'intro6Body' },
];

/** Whether this phone has already seen the intro slides: null while reading, then true/false, plus a setter to finish it. */
export function useIntroSeen() {
  const [seen, setSeen] = useState<boolean | null>(null);
  useEffect(() => {
    AsyncStorage.getItem(INTRO_KEY)
      .then((value) => setSeen(value === '1'))
      .catch(() => setSeen(true));
  }, []);
  const finish = useCallback(() => {
    setSeen(true);
    void AsyncStorage.setItem(INTRO_KEY, '1').catch(() => undefined);
  }, []);
  return [seen, finish] as const;
}

/**
 * Slides shown on the first open, before signing in, explaining what the app does.
 * In Arabic the pager is mirrored (and each slide mirrored back) so swiping runs right to left.
 */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const { t, colors, language, setLanguage, rtl } = usePreferences();
  const { width } = useWindowDimensions();
  const pager = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);
  const last = page === SLIDES.length - 1;
  const flip = rtl ? { transform: [{ scaleX: -1 }] } : null;

  const s = useStyles((c, d) => ({
    screen: { flex: 1, backgroundColor: c.background },
    top: { flexDirection: d.row, justifyContent: 'space-between' as const, alignItems: 'center' as const, paddingHorizontal: 18, paddingTop: 8, minHeight: 48 },
    chip: { flexDirection: d.row, alignItems: 'center' as const, gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: c.surfaceMuted },
    chipText: { color: c.textSecondary, fontSize: 13, fontWeight: '700' as const },
    skip: { color: c.muted, fontSize: 15, fontWeight: '700' as const, paddingHorizontal: 8, paddingVertical: 8 },
    slide: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, paddingHorizontal: 28, gap: 28 },
    art: { width: 220, height: 220, borderRadius: 110, alignItems: 'center' as const, justifyContent: 'center' as const, overflow: 'hidden' as const },
    title: { color: c.text, fontSize: 26, fontWeight: '800' as const, textAlign: 'center' as const },
    body: { color: c.muted, fontSize: 16, lineHeight: 25, textAlign: 'center' as const, maxWidth: 420 },
    footer: { paddingHorizontal: 24, paddingBottom: 12, gap: 20, width: '100%' as const, maxWidth: 520, alignSelf: 'center' as const },
    dots: { flexDirection: d.row, justifyContent: 'center' as const, gap: 8 },
    dot: { height: 8, borderRadius: 4 },
  }));

  const goTo = (index: number) => {
    pager.current?.scrollTo({ x: index * width, animated: true });
    setPage(index);
  };
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(event.nativeEvent.contentOffset.x / width);
    if (index !== page && index >= 0 && index < SLIDES.length) setPage(index);
  };

  return (
    <SafeAreaView style={s.screen}>
      <View style={s.top}>
        <Pressable onPress={() => setLanguage(language === 'ar' ? 'en' : 'ar')} style={s.chip} accessibilityRole="button">
          <Ionicons name="language" size={16} color={colors.textSecondary} />
          <Text style={s.chipText}>{language === 'ar' ? 'English' : 'العربية'}</Text>
        </Pressable>
        {last ? null : (
          <Pressable onPress={onDone} accessibilityRole="button" hitSlop={8}>
            <Text style={s.skip}>{t('introSkip')}</Text>
          </Pressable>
        )}
      </View>

      <ScrollView
        ref={pager}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        style={[{ flex: 1 }, flip]}
      >
        {SLIDES.map((slide) => {
          const tone = colors.tones[slide.tone];
          return (
            <View key={slide.title} style={[{ width }, flip]}>
              <View style={s.slide}>
                <LinearGradient colors={[tone.from, tone.to]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.art}>
                  <View pointerEvents="none" style={{ position: 'absolute', width: 140, height: 140, borderRadius: 70, top: -30, right: -30, backgroundColor: tone.bubble }} />
                  <View pointerEvents="none" style={{ position: 'absolute', width: 100, height: 100, borderRadius: 50, bottom: -20, left: -10, backgroundColor: tone.bubble }} />
                  <Ionicons name={slide.icon} size={96} color={tone.icon} />
                </LinearGradient>
                <View style={{ gap: 12, alignItems: 'center' }}>
                  <Text style={s.title}>{t(slide.title)}</Text>
                  <Text style={s.body}>{t(slide.body)}</Text>
                </View>
              </View>
            </View>
          );
        })}
      </ScrollView>

      <View style={s.footer}>
        <View style={s.dots}>
          {SLIDES.map((slide, index) => (
            <Pressable key={slide.title} onPress={() => goTo(index)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`${index + 1}`}>
              <View style={[s.dot, { width: index === page ? 24 : 8, backgroundColor: index === page ? colors.primary : colors.border }]} />
            </Pressable>
          ))}
        </View>
        <PrimaryButton
          label={last ? t('introStart') : t('introNext')}
          icon={last ? 'checkmark' : rtl ? 'arrow-back' : 'arrow-forward'}
          onPress={() => (last ? onDone() : goTo(page + 1))}
        />
      </View>
    </SafeAreaView>
  );
}
