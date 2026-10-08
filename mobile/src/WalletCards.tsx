import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View, type StyleProp, type TextStyle } from 'react-native';
import { getWallets, type Wallet } from './api';
import { Card, IconBubble, SectionTitle, SmallButton } from './components';
import { GrowBar, PressableScale, useCountUp } from './motion';
import { useFormat, usePreferences, useStyles } from './preferences';
import { useAuthedSession } from './SessionContext';
import { Text } from './typography';

/**
 * Allowances (عهدة) the viewer can see: name, who holds it, balance left and a bar of how much of
 * what was given is left. `showAdd` lets the father create one; `hideWhenEmpty` keeps Home tidy.
 */
export function WalletCards({ showAdd = false, hideWhenEmpty = false, refreshKey }: { showAdd?: boolean; hideWhenEmpty?: boolean; refreshKey?: unknown }) {
  const { session, call } = useAuthedSession();
  const { t, colors } = usePreferences();
  const format = useFormat();
  const [wallets, setWallets] = useState<Wallet[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      call((s, r) => getWallets(s, r)).then((list) => active && setWallets(list)).catch(() => active && setWallets([]));
      return () => {
        active = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [call, refreshKey]),
  );

  const s = useStyles((c, d) => ({
    row: { flexDirection: d.row, alignItems: 'center' as const, gap: 12 },
    name: { color: c.text, fontSize: 15, fontWeight: '800' as const, textAlign: d.start },
    sub: { color: c.muted, fontSize: 12, textAlign: d.start, marginTop: 2 },
    balance: { color: c.text, fontSize: 16, fontWeight: '800' as const, fontVariant: ['tabular-nums' as const] },
    track: { height: 8, borderRadius: 4, backgroundColor: c.surfaceMuted, overflow: 'hidden' as const, flexDirection: d.row, marginTop: 12 },
    hint: { color: c.muted, fontSize: 13, lineHeight: 19, textAlign: d.start },
  }));

  const add = showAdd && session.user.isAdmin;
  if (!wallets || (hideWhenEmpty && !wallets.length)) return null;
  return (
    <View style={{ gap: 10 }}>
      <SectionTitle title={t('wallets')} count={wallets.length} action={add ? <SmallButton label={t('add')} icon="add" onPress={() => router.push('/wallet/new')} /> : undefined} />
      {wallets.length ? (
        wallets.map((wallet) => {
          const added = Number(wallet.added);
          const left = Number(wallet.balance);
          const share = added > 0 ? Math.max(0, Math.min(1, left / added)) : 0;
          return (
            <PressableScale key={wallet.id} onPress={() => router.push(`/wallet/${wallet.id}`)} accessibilityRole="button" accessibilityLabel={`${wallet.name} ${format.money(wallet.balance, wallet.currency)}`}>
              <Card>
                <View style={s.row}>
                  <IconBubble name="wallet" color={colors.tones.amber.icon} background={colors.tones.amber.from} size={40} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.name} numberOfLines={1}>{wallet.name}</Text>
                    <Text style={s.sub} numberOfLines={1}>{t('heldBy', { name: wallet.holder.name })} · {t('walletSpent')} {format.money(wallet.spent, wallet.currency)}</Text>
                  </View>
                  <Balance value={left} currency={wallet.currency} style={[s.balance, left <= 0 && { color: colors.danger }]} />
                </View>
                {/* How much of what was given is left. */}
                <View style={s.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(share * 100) }}>
                  <GrowBar share={share} color={share < 0.15 ? colors.danger : colors.tones.amber.icon} />
                </View>
              </Card>
            </PressableScale>
          );
        })
      ) : (
        <Card><Text style={s.hint}>{t('noWallets')} {t('walletsHint')}</Text></Card>
      )}
    </View>
  );
}

/** The balance, counting up to its value. */
function Balance({ value, currency, style }: { value: number; currency: string; style: StyleProp<TextStyle> }) {
  const format = useFormat();
  return <Text style={style}>{format.money(useCountUp(value), currency)}</Text>;
}
