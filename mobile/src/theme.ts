export type Palette = {
  background: string;
  surface: string;
  surfaceMuted: string;
  border: string;
  hairline: string;
  text: string;
  textSecondary: string;
  muted: string;
  primary: string;
  primaryStrong: string;
  primaryText: string;
  primarySoft: string;
  heroFrom: string;
  heroTo: string;
  heroText: string;
  heroMuted: string;
  danger: string;
  dangerSoft: string;
  success: string;
  successSoft: string;
  lessons: string;
  lessonsSoft: string;
  household: string;
  householdSoft: string;
  /** Chart series — validated for CVD separation and 3:1 contrast against `surface`. */
  seriesLessons: string;
  seriesHousehold: string;
  shadow: string;
  overlay: string;
  tones: Record<Tone, ToneColors>;
};

export type Tone = 'indigo' | 'violet' | 'amber' | 'teal' | 'rose';
export type ToneColors = { from: string; to: string; fg: string; icon: string; bubble: string };

export const palettes: Record<'light' | 'dark', Palette> = {
  light: {
    background: '#f4f5fb',
    surface: '#ffffff',
    surfaceMuted: '#eceefa',
    border: '#dfe2f0',
    hairline: '#eaecf5',
    text: '#111633',
    textSecondary: '#363d5c',
    muted: '#646b88',
    primary: '#4f46e5',
    primaryStrong: '#3b33c4',
    primaryText: '#ffffff',
    primarySoft: '#ebeaff',
    heroFrom: '#4f46e5',
    heroTo: '#7c3aed',
    heroText: '#ffffff',
    heroMuted: '#dcd9ff',
    danger: '#d92d20',
    dangerSoft: '#fdecea',
    success: '#16833f',
    successSoft: '#e3f6ea',
    lessons: '#4f46e5',
    lessonsSoft: '#ebeaff',
    household: '#b45309',
    householdSoft: '#fdf1dc',
    seriesLessons: '#5b5bd6',
    seriesHousehold: '#d97706',
    shadow: 'rgba(27, 31, 72, 0.08)',
    overlay: 'rgba(17, 22, 51, 0.45)',
    tones: {
      indigo: { from: '#eef0ff', to: '#e0e3ff', fg: '#3730a3', icon: '#4f46e5', bubble: '#ffffff' },
      violet: { from: '#f6efff', to: '#ebdfff', fg: '#5b21b6', icon: '#7c3aed', bubble: '#ffffff' },
      amber: { from: '#fff7e6', to: '#ffecc7', fg: '#8a4503', icon: '#d97706', bubble: '#ffffff' },
      teal: { from: '#e7faf5', to: '#cff3ea', fg: '#0f5f59', icon: '#0d9488', bubble: '#ffffff' },
      rose: { from: '#fff0f3', to: '#ffdfe7', fg: '#9f1239', icon: '#e11d48', bubble: '#ffffff' },
    },
  },
  dark: {
    background: '#0c1022',
    surface: '#151b2e',
    surfaceMuted: '#1f2740',
    border: '#2a3352',
    hairline: '#232b46',
    text: '#eef0fb',
    textSecondary: '#c8cce4',
    muted: '#959bbb',
    primary: '#8b8cf6',
    primaryStrong: '#a5a6fa',
    primaryText: '#0c1022',
    primarySoft: '#262b5c',
    heroFrom: '#3730a3',
    heroTo: '#6d28d9',
    heroText: '#ffffff',
    heroMuted: '#cfcbff',
    danger: '#ff8a80',
    dangerSoft: '#3d1d22',
    success: '#5fd68d',
    successSoft: '#17301f',
    lessons: '#a5a6fa',
    lessonsSoft: '#262b5c',
    household: '#f6b54a',
    householdSoft: '#3a2c10',
    seriesLessons: '#7072ea',
    seriesHousehold: '#c97c08',
    shadow: 'rgba(0, 0, 0, 0.35)',
    overlay: 'rgba(0, 0, 0, 0.6)',
    tones: {
      indigo: { from: '#262c62', to: '#1d2250', fg: '#d3d5ff', icon: '#a5a6fa', bubble: 'rgba(255,255,255,0.08)' },
      violet: { from: '#33255e', to: '#271c4b', fg: '#e4d8ff', icon: '#c4a1ff', bubble: 'rgba(255,255,255,0.08)' },
      amber: { from: '#3d2e10', to: '#31240b', fg: '#ffe2b0', icon: '#f6b54a', bubble: 'rgba(255,255,255,0.08)' },
      teal: { from: '#103a36', to: '#0c2d2a', fg: '#b5f5e8', icon: '#2dd4bf', bubble: 'rgba(255,255,255,0.08)' },
      rose: { from: '#41192a', to: '#341420', fg: '#ffcbd6', icon: '#fb7185', bubble: 'rgba(255,255,255,0.08)' },
    },
  },
};

/** Direction helpers so layouts can be written start → end and work in Arabic and English. */
export function direction(rtl: boolean) {
  return {
    row: (rtl ? 'row-reverse' : 'row') as 'row' | 'row-reverse',
    start: (rtl ? 'right' : 'left') as 'left' | 'right',
    end: (rtl ? 'left' : 'right') as 'left' | 'right',
    alignStart: (rtl ? 'flex-end' : 'flex-start') as 'flex-start' | 'flex-end',
    alignEnd: (rtl ? 'flex-start' : 'flex-end') as 'flex-start' | 'flex-end',
  };
}

export const cardShadow = (colors: Palette) => ({ boxShadow: `0 2px 12px ${colors.shadow}` });

/** The kids' points app keeps the same layout but its own warm orange and pink look. */
export const kidsPalettes: Record<'light' | 'dark', Palette> = {
  light: {
    ...palettes.light,
    background: '#fdf8f3',
    surfaceMuted: '#f8efe6',
    border: '#efe1d2',
    hairline: '#f4eadf',
    text: '#24170f',
    textSecondary: '#4a3626',
    muted: '#7a6352',
    primary: '#c2410c',
    primaryStrong: '#9a3412',
    primarySoft: '#ffedd5',
    heroFrom: '#cf440c',
    heroTo: '#db2777',
    heroMuted: '#fff1e6',
    shadow: 'rgba(120, 60, 20, 0.08)',
    overlay: 'rgba(36, 23, 15, 0.45)',
  },
  dark: {
    ...palettes.dark,
    background: '#1a120c',
    surface: '#241911',
    surfaceMuted: '#33241a',
    border: '#45321f',
    hairline: '#3a2a1c',
    text: '#fbf1e8',
    textSecondary: '#e6d3c2',
    muted: '#b39b86',
    primary: '#fb923c',
    primaryStrong: '#fdba74',
    primaryText: '#1a120c',
    primarySoft: '#4a2a12',
    heroFrom: '#c2410c',
    heroTo: '#be185d',
    heroMuted: '#ffd9c2',
  },
};
