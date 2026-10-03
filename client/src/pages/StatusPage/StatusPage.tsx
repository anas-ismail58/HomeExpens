import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/Card/Card';
import { Button } from '@/components/Button/Button';
import { PreferenceSwitcher } from '@/components/PreferenceSwitcher/PreferenceSwitcher';
import { getHealth, type HealthStatus } from '@/services/health.service';
import { toApiFailure } from '@/services/api';
import { formatNumber } from '@/utils/format';
import type { AppLanguage } from '@/utils/i18n';
import styles from './StatusPage.module.css';

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; health: HealthStatus }
  | { kind: 'error'; message: string };

export default function StatusPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as AppLanguage;
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      setState({ kind: 'ok', health: await getHealth() });
    } catch (err) {
      setState({ kind: 'error', message: toApiFailure(err).message });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const connected = state.kind === 'ok';

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.brand}>{t('app.name')}</h1>
        <PreferenceSwitcher />
      </header>

      <Card title={t('status.title')}>
        <p className={styles.intro}>{t('status.intro')}</p>

        {state.kind === 'loading' && <p role="status">{t('common.loading')}</p>}

        {state.kind !== 'loading' && (
          <dl className={styles.list}>
            <div className={styles.row}>
              <dt>{t('status.api')}</dt>
              <dd className={connected ? styles.ok : styles.down}>{connected ? t('status.ok') : t('status.down')}</dd>
            </div>
            <div className={styles.row}>
              <dt>{t('status.database')}</dt>
              <dd className={connected ? styles.ok : styles.down}>{connected ? t('status.ok') : t('status.down')}</dd>
            </div>
            {state.kind === 'ok' && (
              <div className={styles.row}>
                <dt>{t('status.latency')}</dt>
                <dd className="tabular">{t('status.ms', { value: formatNumber(state.health.latencyMs, lang) })}</dd>
              </div>
            )}
          </dl>
        )}

        {state.kind === 'error' && (
          <div className={styles.error} role="alert">
            <p>{t('status.error')}</p>
            <p className={styles.errorDetail}>
              <span className="ltr">{state.message}</span>
            </p>
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              {t('common.retry')}
            </Button>
          </div>
        )}
      </Card>
    </main>
  );
}
