import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { addHouseholdSection, deleteHouseholdSection, getHouseholdSections, renameHouseholdSection, type HouseholdSection } from '../../api';
import { Card, IconBubble, InlineDelete, ListSkeleton, PrimaryButton, SmallButton } from '../../components';
import { Field, TextField } from '../../formControls';
import { ListPage, useRowStyles } from '../../manageUi';
import { useFormat, usePreferences } from '../../preferences';
import { useAuthedSession, useCan } from '../../SessionContext';
import { Text } from '../../typography';

/** Household sections (rent, electricity, groceries…): the father adds, renames and removes them here. */
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

  const load = useCallback(async () => {
    try {
      setSections(await call(getHouseholdSections));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadError'));
    }
  }, [call, t]);
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
    <ListPage allowed={can('SERVICE_HOUSEHOLD')} error={error}>
      {manage ? (
        <Card style={{ gap: 10 }}>
          <Field label={t('addSection')}>
            <TextField value={name} onChange={setName} placeholder={t('newSectionPlaceholder')} />
          </Field>
          <PrimaryButton label={t('add')} icon="add" busy={busy} disabled={!name.trim()} onPress={() => void run(() => call((sess, r) => addHouseholdSection(sess, name.trim(), r)), () => setName(''))} />
        </Card>
      ) : null}
      <Card padded={false} style={{ paddingHorizontal: 14 }}>
        {!sections ? <ListSkeleton rows={4} /> : sections.length ? sections.map((section, index) => (
          <View key={section.id} style={[s.row, index > 0 && s.divider]}>
            <IconBubble name="home" color={colors.household} background={colors.householdSoft} size={34} />
            {renaming?.id === section.id ? (
              <View style={{ flex: 1, gap: 8 }}>
                <TextField value={renaming.name} onChange={(next) => setRenaming({ id: section.id, name: next })} />
                <View style={s.actions}>
                  <SmallButton label={t('save')} icon="checkmark" onPress={() => renaming.name.trim() && void run(() => call((sess, r) => renameHouseholdSection(sess, section.id, renaming.name.trim(), r)), () => setRenaming(null))} />
                  <SmallButton label={t('cancel')} icon="close" onPress={() => setRenaming(null)} />
                </View>
              </View>
            ) : (
              <>
                <Pressable style={s.info} disabled={!manage} onPress={() => setRenaming({ id: section.id, name: format.name(section) })}>
                  <Text style={s.title}>{format.name(section)}</Text>
                </Pressable>
                {manage ? <SmallButton label={t('kEdit')} icon="create-outline" onPress={() => setRenaming({ id: section.id, name: format.name(section) })} /> : null}
                {manage ? <InlineDelete label={format.name(section)} onConfirm={() => run(() => call((sess, r) => deleteHouseholdSection(sess, section.id, r)))} /> : null}
              </>
            )}
          </View>
        )) : <Text style={s.empty}>{t('noSections')}</Text>}
      </Card>
    </ListPage>
  );
}
