import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Text } from '../../typography';
import {
  changeRole,
  createInvitation,
  createMemberAccount,
  resetMemberPassword,
  getChildren,
  getInvitations,
  getMembers,
  removeMember,
  revokeInvitation,
  type Child,
  type FamilyMember,
  type Invitation,
  type Role,
} from '../../api';
import { WithBottomBar } from '../../BottomBar';
import { Card, ConfirmDeleteButton, InlineDelete, ListSkeleton, PrimaryButton, SectionTitle, SmallButton, ToneCard } from '../../components';
import { Chips, Field, TextField } from '../../formControls';
import type { StringKey } from '../../i18n';
import { useFormat, usePreferences, useStyles } from '../../preferences';
import { useAuthedSession } from '../../SessionContext';
import { copyText, inviteLink, inviteMessage, shareInvite, shareOnWhatsApp } from '../../invites';

/** Roles for changing an existing member (a second father = co-admin). */
const ROLES: Role[] = ['MOTHER', 'CHILD', 'FATHER'];
/** The father creates / invites accounts for the mother and the children. */
const NEW_MEMBER_ROLES: Role[] = ['MOTHER', 'CHILD'];

export default function FamilyPage() {
  return (
    <WithBottomBar>
      <FamilyScreen />
    </WithBottomBar>
  );
}

function FamilyScreen() {
  const { session, call } = useAuthedSession();
  const { t, colors, rtl } = usePreferences();
  const format = useFormat();
  const isAdmin = session.user.isAdmin;
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [children, setChildren] = useState<Child[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('MOTHER');
  const [childId, setChildId] = useState('');
  const [inviting, setInviting] = useState(false);
  const [created, setCreated] = useState<Invitation | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // Direct account creation (the father makes the login himself).
  const [accName, setAccName] = useState('');
  const [accLogin, setAccLogin] = useState('');
  const [accPassword, setAccPassword] = useState('');
  const [accRole, setAccRole] = useState<Role>('MOTHER');
  const [accChild, setAccChild] = useState('');
  const [creating, setCreating] = useState(false);
  const [newPassword, setNewPassword] = useState('');

  const load = useCallback(async () => {
    try {
      const [nextMembers, nextChildren, nextInvites] = await Promise.all([
        call(getMembers),
        call(getChildren),
        isAdmin ? call(getInvitations) : Promise.resolve([] as Invitation[]),
      ]);
      setMembers(nextMembers);
      setChildren(nextChildren);
      setInvitations(nextInvites);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [call, isAdmin, t]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const invite = async () => {
    setInviting(true);
    setError('');
    try {
      const invitation = await call((s, r) => createInvitation(s, { email: email.trim(), role, memberId: role === 'CHILD' && childId ? childId : undefined }, r));
      setCreated(invitation);
      setEmail('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveError'));
    } finally {
      setInviting(false);
    }
  };

  const createAccount = async () => {
    setCreating(true);
    setError('');
    setNotice('');
    try {
      const login = accLogin.trim().toLowerCase();
      // No child picked: the server adds the child under this name.
      await call((s, r) => createMemberAccount(s, { name: accName.trim(), login, password: accPassword, role: accRole, memberId: accRole === 'CHILD' && accChild ? accChild : undefined }, r));
      setNotice(t('accountCreated', { name: accName.trim(), login }));
      setAccName('');
      setAccLogin('');
      setAccPassword('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveError'));
    } finally {
      setCreating(false);
    }
  };


  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveError'));
    }
  };

  const linkedChildren = new Set(members.map((member) => member.child?.id).filter(Boolean));
  const freeChildren = children.filter((child) => !linkedChildren.has(child.id));
  const validEmail = /^\S+@\S+\.\S+$/.test(email.trim());
  const validAccount =
    accName.trim().length >= 2 && /^[A-Za-z0-9._@+-]{3,}$/.test(accLogin.trim()) && accPassword.length >= 4;

  const s = useStyles((c, d) => ({
    screen: { flex: 1, backgroundColor: c.background },
    page: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 40, gap: 18 },
    row: { flexDirection: d.row, alignItems: 'center' as const, gap: 12, paddingVertical: 12 },
    divider: { borderTopWidth: 1, borderTopColor: c.hairline },
    avatar: { width: 42, height: 42, borderRadius: 14, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: c.primarySoft },
    avatarText: { color: c.primary, fontSize: 17, fontWeight: '800' as const },
    info: { flex: 1, minWidth: 0 },
    name: { color: c.text, fontSize: 15, fontWeight: '700' as const, textAlign: d.start },
    sub: { color: c.muted, fontSize: 12, marginTop: 2, textAlign: d.start },
    badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 9, backgroundColor: c.surfaceMuted },
    badgeText: { color: c.textSecondary, fontSize: 11, fontWeight: '800' as const },
    manage: { gap: 12, paddingBottom: 14 },
    codeBox: { gap: 10 },
    code: { fontSize: 28, fontWeight: '800' as const, letterSpacing: 4, textAlign: 'center' as const, fontVariant: ['tabular-nums' as const] },
    codeHint: { fontSize: 13, textAlign: 'center' as const },
    link: { fontSize: 12, textAlign: 'center' as const, writingDirection: 'ltr' as const },
    inviteCode: { color: c.primary, fontSize: 13, fontWeight: '800' as const, letterSpacing: 1.5, textAlign: d.start, marginTop: 2 },
    error: { color: c.danger, fontSize: 13, textAlign: d.start },
    notice: { color: c.success, fontSize: 13, fontWeight: '700' as const, lineHeight: 20, textAlign: d.start },
    hint: { color: c.muted, fontSize: 12, textAlign: d.start },
  }));

  const roleLabel = (value: Role) => t(`role${value}` as StringKey);

  return (
    <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}
      style={s.screen}
      contentContainerStyle={s.page}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} />}
    >
      {error ? <Text style={s.error}>{error}</Text> : null}
      {notice ? <Text style={s.notice}>{notice}</Text> : null}

      <View style={{ gap: 10 }}>
        <SectionTitle
          title={t('familyMembers')}
          count={members.length}
          action={isAdmin ? <SmallButton label={t('permissions')} icon="key" onPress={() => router.push('/family/permissions')} /> : undefined}
        />
        <Card padded={false} style={{ paddingHorizontal: 14 }}>
          {loading ? <ListSkeleton rows={2} /> : members.map((member, index) => {
            const me = member.id === session.user.id;
            const manageable = isAdmin && !member.isOwner && !me;
            return (
              <View key={member.id} style={index > 0 && s.divider}>
                <Pressable disabled={!manageable} onPress={() => setExpanded(expanded === member.id ? null : member.id)} style={s.row} accessibilityRole={manageable ? 'button' : undefined}>
                  <View style={s.avatar}><Text style={s.avatarText}>{member.name.trim().charAt(0).toUpperCase()}</Text></View>
                  <View style={s.info}>
                    <Text style={s.name} numberOfLines={1}>{member.name}{me ? ` (${t('you')})` : ''}</Text>
                    <Text style={s.sub} numberOfLines={1}>
                      {[member.isOwner ? t('owner') : null, member.child ? member.child.name : null, member.email ?? null].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <View style={s.badge}><Text style={s.badgeText}>{roleLabel(member.role)}</Text></View>
                  {manageable ? <Ionicons name={expanded === member.id ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} /> : null}
                </Pressable>
                {manageable && expanded === member.id ? (
                  <View style={s.manage}>
                    <Field label={t('changeRole')}>
                      <Chips
                        options={ROLES.filter((r) => r !== 'CHILD' || member.child || freeChildren.length).map((r) => ({ value: r, label: roleLabel(r) }))}
                        value={member.role}
                        onChange={(next) => void run(() => call((sess, r) => changeRole(sess, member.id, next, next === 'CHILD' ? member.child?.id ?? freeChildren[0]?.id : undefined, r)))}
                      />
                    </Field>
                    {member.role !== 'FATHER' ? (
                      <SmallButton label={t('familyPermissions')} icon="key" onPress={() => router.push({ pathname: '/family/permissions', params: { userId: member.id } })} />
                    ) : null}
                    <Field label={t('newPassword')}>
                      <TextField value={newPassword} onChange={setNewPassword} autoCapitalize="none" />
                    </Field>
                    <SmallButton
                      label={t('setPassword')}
                      icon="key-outline"
                      onPress={() => {
                        if (newPassword.length < 4) return;
                        void call((sess, r) => resetMemberPassword(sess, member.id, newPassword, r))
                          .then(() => { setNewPassword(''); setNotice(t('passwordUpdated')); })
                          .catch((err: unknown) => setError(err instanceof Error ? err.message : t('saveError')));
                      }}
                    />
                    <ConfirmDeleteButton
                      label={t('removeMember')}
                      question={t('removeMemberQuestion', { name: member.name })}
                      onConfirm={() => run(() => call((sess, r) => removeMember(sess, member.id, r)))}
                    />
                  </View>
                ) : null}
              </View>
            );
          })}
        </Card>
      </View>

      {isAdmin ? (
        <>
          {created ? (
            <ToneCard tone="teal" style={s.codeBox}>
              <Text style={[s.code, { color: colors.tones.teal.fg }]} selectable>{created.code}</Text>
              <Text style={[s.codeHint, { color: colors.tones.teal.fg }]}>{t('inviteCreated', { email: created.email })}</Text>
              <Text style={[s.link, { color: colors.tones.teal.fg }]} selectable numberOfLines={2}>{inviteLink(created.code)}</Text>
              <InviteActions invitation={created} familyName={session.family.name} primary />
            </ToneCard>
          ) : null}

          <View style={{ gap: 10 }}>
            <SectionTitle title={t('createMemberAccount')} />
            <Card style={{ gap: 14 }}>
              <Text style={s.hint}>{t('createMemberHint')}</Text>
              <Field label={t('memberName')}>
                <TextField value={accName} onChange={setAccName} />
              </Field>
              <Field label={t('loginName')}>
                <TextField value={accLogin} onChange={setAccLogin} placeholder="sara" autoCapitalize="none" />
              </Field>
              <Field label={t('password')}>
                <TextField value={accPassword} onChange={setAccPassword} autoCapitalize="none" />
              </Field>
              <Field label={t('role')}>
                <Chips options={NEW_MEMBER_ROLES.map((r) => ({ value: r, label: roleLabel(r) }))} value={accRole} onChange={setAccRole} />
              </Field>
              {accRole === 'CHILD' && freeChildren.length ? (
                <Field label={t('whichChild')}>
                  <Chips
                    options={[{ value: '', label: t('newChildFromName'), icon: 'add' as const }, ...freeChildren.map((child) => ({ value: child.id, label: child.name }))]}
                    value={accChild}
                    onChange={setAccChild}
                  />
                </Field>
              ) : null}
              <PrimaryButton label={t('createAccount')} icon="person-add" busy={creating} disabled={!validAccount} onPress={() => void createAccount()} />
            </Card>
          </View>

          <View style={{ gap: 10 }}>
            <SectionTitle title={t('orInvite')} />
            <Card style={{ gap: 14 }}>
              <Field label={t('inviteEmail')}>
                <TextField value={email} onChange={setEmail} placeholder="name@example.com" keyboardType="email-address" autoCapitalize="none" />
              </Field>
              <Field label={t('role')}>
                <Chips options={NEW_MEMBER_ROLES.map((r) => ({ value: r, label: roleLabel(r) }))} value={role} onChange={setRole} />
              </Field>
              {role === 'CHILD' && freeChildren.length ? (
                <Field label={t('whichChild')}>
                  <Chips
                    options={[{ value: '', label: t('newChildFromName'), icon: 'add' as const }, ...freeChildren.map((child) => ({ value: child.id, label: child.name }))]}
                    value={childId}
                    onChange={setChildId}
                  />
                </Field>
              ) : null}
              <PrimaryButton
                label={t('createInvite')}
                icon="mail"
                busy={inviting}
                disabled={!validEmail}
                onPress={() => void invite()}
              />
            </Card>
          </View>

          {invitations.length ? (
            <View style={{ gap: 10 }}>
              <SectionTitle title={t('invitations')} count={invitations.length} />
              <Card padded={false} style={{ paddingHorizontal: 14 }}>
                {invitations.map((invitation, index) => (
                  <View key={invitation.id} style={[s.row, index > 0 && s.divider]}>
                    <View style={s.info}>
                      <Text style={s.name} numberOfLines={1}>{invitation.email}</Text>
                      <Text style={s.sub}>
                        {roleLabel(invitation.role)} · {t(`inviteStatus${invitation.status}` as StringKey)}
                        {invitation.status === 'PENDING' ? ` · ${format.date(invitation.expiresAt.slice(0, 10))}` : ''}
                      </Text>
                      {invitation.status === 'PENDING' ? (
                        <>
                          <Text style={s.inviteCode} selectable>{invitation.code}</Text>
                          <InviteActions invitation={invitation} familyName={session.family.name} />
                        </>
                      ) : null}
                    </View>
                    {invitation.status === 'PENDING' ? (
                      <>
                        <InlineDelete label={invitation.email} onConfirm={() => run(() => call((sess, r) => revokeInvitation(sess, invitation.id, r)))} />
                      </>
                    ) : (
                      <Ionicons name={rtl ? 'chevron-back' : 'chevron-forward'} size={16} color="transparent" />
                    )}
                  </View>
                ))}
              </Card>
            </View>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}

/**
 * Ways to send an invitation. The app sends no email, so the father passes the link on himself:
 * WhatsApp, copy link / code, or the system share sheet where the device has one.
 */
function InviteActions({ invitation, familyName, primary = false }: { invitation: Invitation; familyName: string; primary?: boolean }) {
  const { t } = usePreferences();
  const [note, setNote] = useState('');
  const message = inviteMessage(invitation, familyName, (params) => t('inviteShareMessage', params));
  const done = () => {
    setNote(t('copiedToSend'));
    setTimeout(() => setNote(''), 2500);
  };
  const s = useStyles((c, d) => ({
    row: { flexDirection: d.row, flexWrap: 'wrap' as const, gap: 8, marginTop: primary ? 2 : 8 },
    note: { color: c.success, fontSize: 12, fontWeight: '700' as const, textAlign: d.start, marginTop: 6 },
  }));
  return (
    <View>
      {primary ? <PrimaryButton label={t('whatsapp')} icon="logo-whatsapp" onPress={() => void shareOnWhatsApp(message).catch(() => undefined)} /> : null}
      <View style={s.row}>
        {!primary ? <SmallButton label={t('whatsapp')} icon="logo-whatsapp" onPress={() => void shareOnWhatsApp(message).catch(() => undefined)} /> : null}
        {/* Copy link copies only the URL; WhatsApp / Share send the full message with the code. */}
        <SmallButton label={t('copyLink')} icon="link" onPress={() => void copyText(inviteLink(invitation.code)).then(done)} />
        <SmallButton label={t('copyCode')} icon="copy-outline" onPress={() => void copyText(invitation.code).then(done)} />
        {Platform.OS !== 'web' || typeof navigator?.share === 'function' ? (
          <SmallButton label={t('share')} icon="share-social" onPress={() => void shareInvite(message).then((how) => how === 'copied' && done())} />
        ) : null}
      </View>
      {note ? <Text style={s.note}>{note}</Text> : null}
    </View>
  );
}

