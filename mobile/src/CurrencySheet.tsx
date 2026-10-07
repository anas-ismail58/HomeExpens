import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from './typography';
import { DISPLAY_CURRENCIES, convert, currencyName, useFormat, usePreferences, useStyles } from './preferences';
import { useSession } from './SessionContext';

/**
 * Picks the currency every amount in the app is shown in. Only the display changes: each payment,
 * expense or fee keeps the currency it was entered in.
 */
export function CurrencySheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { session } = useSession();
  const { t, colors, language, displayCurrency, setDisplayCurrency, rates } = usePreferences();
  const format = useFormat();
  const insets = useSafeAreaInsets();
  const base = session?.family.currency ?? 'EGP';

  const s = useStyles((c, d) => ({
    backdrop: { flex: 1, justifyContent: 'flex-end' as const, backgroundColor: c.overlay },
    sheet: { maxHeight: '80%' as const, backgroundColor: c.background, borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden' as const },
    handle: { alignSelf: 'center' as const, width: 44, height: 5, borderRadius: 3, backgroundColor: c.border, marginTop: 10 },
    header: { flexDirection: d.row, alignItems: 'center' as const, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 4 },
    title: { flex: 1, color: c.text, fontSize: 20, fontWeight: '800' as const, textAlign: d.start },
    close: { width: 36, height: 36, borderRadius: 18, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: c.surfaceMuted },
    hint: { color: c.muted, fontSize: 12, lineHeight: 18, textAlign: d.start, paddingHorizontal: 18, paddingBottom: 8 },
    list: { paddingHorizontal: 14, gap: 6 },
    row: { flexDirection: d.row, alignItems: 'center' as const, gap: 12, padding: 12, borderRadius: 16, backgroundColor: c.surface, borderWidth: 1, borderColor: c.hairline },
    rowActive: { borderColor: c.primary, backgroundColor: c.primarySoft },
    code: { width: 50, color: c.primary, fontSize: 15, fontWeight: '800' as const, textAlign: 'center' as const },
    copy: { flex: 1, gap: 2 },
    name: { color: c.text, fontSize: 15, fontWeight: '700' as const, textAlign: d.start },
    rate: { color: c.muted, fontSize: 12, textAlign: d.start },
  }));

  const choose = (code: (typeof DISPLAY_CURRENCIES)[number]) => {
    setDisplayCurrency(code);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel={t('close')}>
        <Pressable style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]} onPress={() => undefined}>
          <View style={s.handle} />
          <View style={s.header}>
            <Text style={s.title}>{t('showAmountsIn')}</Text>
            <Pressable onPress={onClose} style={s.close} accessibilityLabel={t('close')}>
              <Ionicons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>
          <Text style={s.hint}>{t('displayCurrencyHint', { base })}</Text>
          <ScrollView contentContainerStyle={s.list} showsVerticalScrollIndicator={false}>
            {DISPLAY_CURRENCIES.map((code) => {
              const active = code === displayCurrency;
              const oneUnit = code === base ? null : convert(1, code, base, rates);
              return (
                <Pressable key={code} onPress={() => choose(code)} style={[s.row, active && s.rowActive]} accessibilityRole="radio" accessibilityState={{ selected: active }}>
                  <Text style={s.code}>{code}</Text>
                  <View style={s.copy}>
                    <Text style={s.name}>{currencyName(code, language)}</Text>
                    <Text style={s.rate}>
                      {code === base ? t('familyCurrencyLabel') : oneUnit !== null ? `⁨${format.rawMoney(1, code)}⁩ = ⁨${format.rawMoney(oneUnit, base)}⁩` : t('ratesUnavailable')}
                    </Text>
                  </View>
                  {active ? <Ionicons name="checkmark-circle" size={22} color={colors.primary} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
