import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ListPage } from '../../manageUi';
import { usePreferences } from '../../preferences';
import { WalletCards } from '../../WalletCards';

/** Allowances (عُهد): the father adds them; holders and chosen members see theirs. */
export default function WalletsPage() {
  const { t } = usePreferences();
  const [refreshKey, setRefreshKey] = useState(0);
  useFocusEffect(useCallback(() => setRefreshKey((n) => n + 1), []));
  return (
    <ListPage hint={t('walletsHint')}>
      <WalletCards showAdd refreshKey={refreshKey} />
    </ListPage>
  );
}
