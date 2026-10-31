import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { addHouseholdSection, deleteHouseholdSection, getHouseholdSections, renameHouseholdSection, type HouseholdSection, type SectionGroup } from '../../api';
import { Card, IconBubble, InlineDelete, ListSkeleton, PrimaryButton, SmallButton } from '../../components';
import { Field, TextField } from '../../formControls';
import { ListPage, useRowStyles } from '../../manageUi';
import { useFormat, usePreferences } from '../../preferences';
import { useAuthedSession, useCan } from '../../SessionContext';
import { Text } from '../../typography';

/**
 * Household sections (rent, electricity, groceries…), or personal ones with ?group=personal (barber,
 * clothing…): the father adds, renames and removes them here.
 */
export default function SectionsPage() {
  const { session, call } = useAuthedSession();
  const { t, colors } = usePreferences();
  const format = useFormat();
  const can = useCan();
  const s = useRowStyles();
  const [sections, setSections] = useState<HouseholdSection[] | null>(null);
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const manage = session.user.isAdmin;
  const params = useLocalSearchParams<{ group?: string }>();
  const group: SectionGroup = params.group === 'personal' ? 'personal' : 'household';
  const personal = group === 'personal';

  const load = useCallback(async () => {
    try {
      setSections(await call((sess, r) => getHouseholdSections(sess, r, group)));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadError'));
    }
  }, [call, group, t]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const run = async (action: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setError('');
    try {
      await action();
      after?.();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ListPage allowed={personal || can('SERVICE_HOUSEHOLD')} error={error}>
      {personal ? <Stack.Screen options={{ title: t('personalSections') }} /> : null}
      {manage ? (
        <Card style={{ gap: 10 }}>
          <Field label={t('addSection')}>
            <TextField value={name} onChange={setName} placeholder={t('newSectionPlaceholder')} />
          </Field>
          <PrimaryButton label={t('add')} icon="add" busy={busy} disabled={!name.trim()} onPress={() => void run(() => call((sess, r) => addHouseholdSection(sess, name.trim(), r, group)), () => setName(''))} />
        </Card>
      ) : null}
      <Card padded={false} style={{ paddingHorizontal: 14 }}>
        {!sections ? <ListSkeleton rows={4} /> : sections.length ? sections.map((section, index) => (
          <View key={section.id} style={[s.row, index > 0 && s.divider]}>
            <IconBubble name={personal ? 'person' : 'home'} color={personal ? colors.tones.rose.icon : colors.household} background={personal ? colors.tones.rose.from : colors.householdSoft} size={34} />
            {renaming?.id === section.id ? (
              <View style={{ flex: 1, gap: 8 }}>
                <TextField value={renaming.name} onChange={(next) => setRenaming({ id: section.id, name: next })} />
                <View style={s.actions}>
                  <SmallButton label={t('save')} icon="checkmark" onPress={() => renaming.name.trim() && void run(() => call((sess, r) => renameHouseholdSection(sess, section.id, renaming.name.trim(), r, group)), () => setRenaming(null))} />
                  <SmallButton label={t('cancel')} icon="close" onPress={() => setRenaming(null)} />
                </View>
              </View>
            ) : (
              <>
                <Pressable style={s.info} disabled={!manage} onPress={() => setRenaming({ id: section.id, name: format.name(section) })}>
                  <Text style={s.title}>{format.name(section)}</Text>
                </Pressable>
                {manage ? <SmallButton label={t('kEdit')} icon="create-outline" onPress={() => setRenaming({ id: section.id, name: format.name(section) })} /> : null}
                {manage ? <InlineDelete label={format.name(section)} onConfirm={() => run(() => call((sess, r) => deleteHouseholdSection(sess, section.id, r, group)))} /> : null}
              </>
            )}
          </View>
        )) : <Text style={s.empty}>{t('noSections')}</Text>}
      </Card>
    </ListPage>
  );
}
