import {
  IBMPlexSans_100Thin,
  IBMPlexSans_200ExtraLight,
  IBMPlexSans_300Light,
  IBMPlexSans_400Regular,
  IBMPlexSans_500Medium,
  IBMPlexSans_600SemiBold,
  IBMPlexSans_700Bold,
} from '@expo-google-fonts/ibm-plex-sans';
import {
  IBMPlexSansArabic_100Thin,
  IBMPlexSansArabic_200ExtraLight,
  IBMPlexSansArabic_300Light,
  IBMPlexSansArabic_400Regular,
  IBMPlexSansArabic_500Medium,
  IBMPlexSansArabic_600SemiBold,
  IBMPlexSansArabic_700Bold,
} from '@expo-google-fonts/ibm-plex-sans-arabic';
import {
  BalooBhaijaan2_400Regular,
  BalooBhaijaan2_500Medium,
  BalooBhaijaan2_600SemiBold,
  BalooBhaijaan2_700Bold,
  BalooBhaijaan2_800ExtraBold,
} from '@expo-google-fonts/baloo-bhaijaan-2';
import type { ReactNode, Ref } from 'react';
import { appVariant } from './appVariant';
import { StyleSheet, Text as RNText, TextInput as RNTextInput, type TextInputProps, type TextProps, type TextStyle } from 'react-native';
import { useUiLanguage } from './preferences';

const LATIN = {
  Thin: IBMPlexSans_100Thin,
  ExtraLight: IBMPlexSans_200ExtraLight,
  Light: IBMPlexSans_300Light,
  Regular: IBMPlexSans_400Regular,
  Medium: IBMPlexSans_500Medium,
  SemiBold: IBMPlexSans_600SemiBold,
  Bold: IBMPlexSans_700Bold,
};
const ARABIC_FACES = {
  Thin: IBMPlexSansArabic_100Thin,
  ExtraLight: IBMPlexSansArabic_200ExtraLight,
  Light: IBMPlexSansArabic_300Light,
  Regular: IBMPlexSansArabic_400Regular,
  Medium: IBMPlexSansArabic_500Medium,
  SemiBold: IBMPlexSansArabic_600SemiBold,
  Bold: IBMPlexSansArabic_700Bold,
};

/**
 * Every face loaded at startup. Names follow the fonts' own PostScript names ("IBMPlexSansArabic-Bold"),
 * and the bare family names "IBMPlexSans" / "IBMPlexSansArabic" are the regular weight.
 */
export const APP_FONTS: Record<string, number> = {
  IBMPlexSans: IBMPlexSans_400Regular,
  IBMPlexSansArabic: IBMPlexSansArabic_400Regular,
  ...Object.fromEntries(Object.entries(LATIN).map(([face, file]) => [`IBMPlexSans-${face}`, file])),
  ...Object.fromEntries(Object.entries(ARABIC_FACES).map(([face, file]) => [`IBMPlexSansArabic-${face}`, file])),
};

/** The kids' points app uses Baloo Bhaijaan 2: round and friendly, Arabic and Latin in one family. */
const KIDS_FACES = {
  Regular: BalooBhaijaan2_400Regular,
  Medium: BalooBhaijaan2_500Medium,
  SemiBold: BalooBhaijaan2_600SemiBold,
  Bold: BalooBhaijaan2_700Bold,
  ExtraBold: BalooBhaijaan2_800ExtraBold,
};

/** Faces to load at startup for the running app. */
export function appFonts(): Record<string, number> {
  if (appVariant() !== 'kids') return APP_FONTS;
  return { BalooBhaijaan2: BalooBhaijaan2_400Regular, ...Object.fromEntries(Object.entries(KIDS_FACES).map(([face, file]) => [`BalooBhaijaan2-${face}`, file])) };
}

const KIDS_WEIGHTS: Record<number, keyof typeof KIDS_FACES> = { 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold' };

const FACES: Record<number, keyof typeof LATIN> = {
  100: 'Thin',
  200: 'ExtraLight',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'SemiBold',
  700: 'Bold',
};

const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

/** Plex ships 100–700; heavier weights (800/900) use Bold. */
function weightOf(fontWeight: TextStyle['fontWeight']) {
  if (!fontWeight || fontWeight === 'normal') return 400;
  if (fontWeight === 'bold') return 700;
  const value = Number(fontWeight);
  return Number.isFinite(value) ? Math.min(700, Math.max(100, Math.round(value / 100) * 100)) : 400;
}

/** Baloo ships 400–800. */
function kidsWeightOf(fontWeight: TextStyle['fontWeight']) {
  if (!fontWeight || fontWeight === 'normal') return 400;
  if (fontWeight === 'bold') return 700;
  const value = Number(fontWeight);
  return Number.isFinite(value) ? Math.min(800, Math.max(400, Math.round(value / 100) * 100)) : 400;
}

/** Font family for a weight: IBM Plex Sans Arabic for Arabic, IBM Plex Sans for Latin. */
export function fontFace(fontWeight: TextStyle['fontWeight'], arabic: boolean) {
  if (appVariant() === 'kids') return `BalooBhaijaan2-${KIDS_WEIGHTS[kidsWeightOf(fontWeight)]}`;
  return `${arabic ? 'IBMPlexSansArabic' : 'IBMPlexSans'}-${FACES[weightOf(fontWeight)]}`;
}

function hasArabic(node: ReactNode): boolean {
  if (typeof node === 'string') return ARABIC.test(node);
  if (Array.isArray(node)) return node.some(hasArabic);
  return false;
}

/**
 * Picks the Plex face from the style's fontWeight. Arabic UI (or any Arabic characters in the text)
 * uses Plex Sans Arabic, which also covers Latin; English UI uses Plex Sans. An explicit fontFamily wins.
 */
function familyStyle(style: TextProps['style'], arabic: boolean): TextStyle | null {
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  if (flat.fontFamily) return null;
  // Each weight is a separate face, so the weight itself must not be synthesised on top.
  return { fontFamily: fontFace(flat.fontWeight, arabic), fontWeight: 'normal' };
}

/**
 * In Arabic the middle dot separator reads as a zero: "الكل · ١٠" looks like "الكل ١٠٠". Arabic text uses an
 * en dash instead ("الكل – ١٠"), wherever the separator comes from.
 */
function arabicSeparators(node: ReactNode): ReactNode {
  if (typeof node === 'string') return node.includes(' · ') ? node.replaceAll(' · ', ' – ') : node;
  if (Array.isArray(node)) return node.map(arabicSeparators);
  return node;
}

export function Text({ style, children, ref, ...rest }: TextProps & { ref?: Ref<RNText> }) {
  const language = useUiLanguage();
  const face = familyStyle(style, language === 'ar' || hasArabic(children));
  return (
    <RNText ref={ref} {...rest} style={face ? [style, face] : style}>
      {language === 'ar' ? arabicSeparators(children) : children}
    </RNText>
  );
}

export function TextInput({ style, ref, ...rest }: TextInputProps & { ref?: Ref<RNTextInput> }) {
  const language = useUiLanguage();
  const face = familyStyle(style, language === 'ar' || hasArabic(rest.value ?? rest.placeholder));
  return <RNTextInput ref={ref} {...rest} style={face ? [style, face] : style} />;
}
