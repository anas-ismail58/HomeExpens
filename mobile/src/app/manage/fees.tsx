import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { deleteRecurringFee, getRecurringFees, type RecurringFee } from '../../api';
import { Card, IconBubble, InlineDelete, ListSkeleton, PrimaryButton } from '../../components';
import type { StringKey } from '../../i18n';
import { ListPage, useRowStyles } from '../../manageUi';
import { useFormat, usePreferences } from '../../preferences';
import { useAuthedSession, useCan } from '../../SessionContext';
import { useSubjectLabel } from '../../subjects';
import { Text } from '../../typography';

/** Monthly fees (lessons and household), with a reminder shortcut and remove. */
export default function FeesPage() {
  const { call } = useAuthedSession();
  const { t, colors } = usePreferences();
  const format = useFormat();
  const can = useCan();
  const subjectLabel = useSubjectLabel();
  const s = useRowStyles();
  const [fees, setFees] = useState<RecurringFee[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setFees(await call(getRecurringFees));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadError'));
    }
  }, [call, t]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <ListPage allowed={can('SERVICE_RECURRING')} error={error}>
      {can('ADD_EXPENSE') && can('SERVICE_LESSONS') ? <PrimaryButton label={t('svcTuition')} icon="add" onPress={() => router.push('/create/tuition')} /> : null}
      <Card padded={false} style={{ paddingHorizontal: 14 }}>
        {!fees ? <ListSkeleton rows={3} /> : fees.length ? fees.map((fee, index) => (
          <View key={fee.id} style={[s.row, index > 0 && s.divider]}>
            <IconBubble
              name={fee.kind === 'HOUSEHOLD' ? 'home' : 'repeat'}
              color={fee.kind === 'HOUSEHOLD' ? colors.household : colors.lessons}
              background={fee.kind === 'HOUSEHOLD' ? colors.householdSoft : colors.lessonsSoft}
            />
            <View style={s.info}>
              <Text style={s.title} numberOfLines={1}>{fee.description}</Text>
              <Text style={s.sub} numberOfLines={1}>
                {[fee.child?.name, subjectLabel(fee.subject), fee.teacher?.name, fee.section ? format.name(fee.section) : null, t(`freq_${fee.frequency}` as StringKey)].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <Text style={s.amount}>{format.money(fee.amount, fee.currency)}</Text>
            {can('ADD_PAYMENT') ? (
              <Pressable
                hitSlop={6}
                accessibilityLabel={t('remindMe')}
                onPress={() => router.push({ pathname: '/payment/new', params: { name: fee.description, amount: fee.amount, currency: fee.currency, category: 'TUITION', memberId: fee.child?.id ?? '', day: String(Number(fee.startDate.slice(8, 10))) } })}
                style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}
              >
                <Ionicons name="notifications-outline" size={18} color={colors.primary} />
              </Pressable>
            ) : null}
            {can('DELETE_EXPENSE') ? (
              <InlineDelete
                label={fee.description}
                onConfirm={async () => {
                  try {
                    await call((sess, r) => deleteRecurringFee(sess, fee.id, r));
                    await load();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : t('deleteError'));
                  }
                }}
              />
            ) : null}
          </View>
        )) : <Text style={s.empty}>{t('noFees')}</Text>}
      </Card>
    </ListPage>
  );
}
