import { Ionicons } from '@expo/vector-icons';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { deleteAttachment, getAttachmentImage, getAttachments, uploadAttachment, type AttachmentMeta, type AttachmentTarget, type Session } from './api';
import { SmallButton } from './components';
import { useFormat, usePreferences, useStyles } from './preferences';
import { useSession } from './SessionContext';
import { Text } from './typography';

/** A picked image, already resized and JPEG-compressed, ready to upload. */
export type PreparedImage = { base64: string; width: number; height: number; uri: string };

const MAX_SIDE = 1600;

/**
 * Opens the photo library (or camera) and returns a compressed JPEG (~100–250 KB), small enough to
 * store with the expense. Returns null if cancelled; throws 'denied' when permission is refused.
 */
export async function pickImage(source: 'library' | 'camera'): Promise<PreparedImage | null> {
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new Error('denied');
  }
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];

  // Screenshots are tall; limit the longer side so text stays readable but the file stays small.
  const scale = Math.min(1, MAX_SIDE / Math.max(asset.width || MAX_SIDE, asset.height || MAX_SIDE));
  const context = ImageManipulator.manipulate(asset.uri);
  if (scale < 1) context.resize({ width: Math.round((asset.width || MAX_SIDE) * scale) });
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.6, base64: true });
  if (!saved.base64) return null;
  return { base64: saved.base64.replace(/^data:[^,]+,/, ''), width: saved.width, height: saved.height, uri: saved.uri };
}

export async function uploadPrepared(session: Session, onRefresh: (s: Session) => void, target: AttachmentTarget, image: PreparedImage) {
  return uploadAttachment(session, { ...target, mimeType: 'image/jpeg', data: image.base64, width: image.width, height: image.height }, onRefresh);
}

/** Loads attachment images on demand and keeps them for the session (they never change). */
const imageCache = new Map<string, string>();

function useAttachmentImage(id: string) {
  const { call } = useSession();
  const [uri, setUri] = useState(() => imageCache.get(id) ?? null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (imageCache.has(id)) return;
    let active = true;
    call((s, r) => getAttachmentImage(s, id, r))
      .then((image) => {
        const data = `data:${image.mimeType};base64,${image.data}`;
        imageCache.set(id, data);
        if (active) setUri(data);
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [call, id]);
  return { uri, failed };
}

function Thumb({ item, onPress }: { item: AttachmentMeta; onPress: () => void }) {
  const { colors } = usePreferences();
  const { uri, failed } = useAttachmentImage(item.id);
  const s = useStyles((c) => ({
    thumb: { width: 96, height: 128, borderRadius: 12, overflow: 'hidden' as const, backgroundColor: c.surfaceMuted, alignItems: 'center' as const, justifyContent: 'center' as const },
  }));
  return (
    <Pressable onPress={onPress} style={s.thumb} accessibilityRole="imagebutton">
      {uri ? <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : failed ? <Ionicons name="image-outline" size={24} color={colors.muted} /> : <ActivityIndicator color={colors.primary} />}
    </Pressable>
  );
}

function Viewer({ item, onClose, onDelete }: { item: AttachmentMeta | null; onClose: () => void; onDelete: (item: AttachmentMeta) => Promise<void> }) {
  const { t } = usePreferences();
  const format = useFormat();
  const insets = useSafeAreaInsets();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const { uri, failed } = useAttachmentImage(item?.id ?? '');
  const s = useStyles((c, d) => ({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)' },
    bar: { flexDirection: d.row, alignItems: 'center' as const, gap: 10, paddingHorizontal: 16 },
    meta: { flex: 1, color: '#fff', fontSize: 13, textAlign: d.start },
    icon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: 'rgba(255,255,255,0.15)' },
    danger: { backgroundColor: c.danger, paddingHorizontal: 14, width: undefined },
    dangerText: { color: '#fff', fontSize: 13, fontWeight: '700' as const },
  }));
  if (!item) return null;
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} transparent>
      <View style={[s.backdrop, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }]}>
        <View style={s.bar}>
          <Pressable onPress={onClose} style={s.icon} accessibilityLabel={t('close')}>
            <Ionicons name="close" size={22} color="#fff" />
          </Pressable>
          <Text style={s.meta} numberOfLines={2}>
            {[item.cycleDueDate ? t('cycleOf', { date: format.date(item.cycleDueDate) }) : null, item.uploadedBy?.name, format.fullDate(new Date(item.createdAt))].filter(Boolean).join(' · ')}
          </Text>
          {item.canDelete ? (
            confirm ? (
              <Pressable
                disabled={busy}
                onPress={() => {
                  setBusy(true);
                  void onDelete(item).finally(() => { setBusy(false); setConfirm(false); });
                }}
                style={[s.icon, s.danger]}
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.dangerText}>{t('confirmDelete')}</Text>}
              </Pressable>
            ) : (
              <Pressable onPress={() => setConfirm(true)} style={s.icon} accessibilityLabel={t('deleteImage')}>
                <Ionicons name="trash-outline" size={20} color="#fff" />
              </Pressable>
            )
          ) : null}
        </View>
        <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 12 }} maximumZoomScale={4} minimumZoomScale={1} centerContent>
          {uri ? (
            <Image source={{ uri }} style={{ width: '100%', aspectRatio: item.width && item.height ? item.width / item.height : 0.6 }} resizeMode="contain" />
          ) : failed ? (
            <Text style={{ color: '#fff', textAlign: 'center' }}>{t('imageLoadError')}</Text>
          ) : (
            <ActivityIndicator color="#fff" />
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

/** "From photos" / "Take photo" buttons. Camera is offered on phones only. */
export function ImageSourceButtons({ onPicked, onError, busy }: { onPicked: (image: PreparedImage) => void; onError: (message: string) => void; busy?: boolean }) {
  const { t, colors } = usePreferences();
  const s = useStyles((_c, d) => ({ row: { flexDirection: d.row, gap: 8, flexWrap: 'wrap' as const, alignItems: 'center' as const } }));
  const pick = (source: 'library' | 'camera') =>
    void pickImage(source)
      .then((image) => image && onPicked(image))
      .catch((err: unknown) => onError(err instanceof Error && err.message === 'denied' ? t('photoDenied') : t('saveError')));
  return (
    <View style={s.row}>
      <SmallButton label={t('fromGallery')} icon="images-outline" onPress={() => pick('library')} />
      {Platform.OS !== 'web' ? <SmallButton label={t('takePhoto')} icon="camera-outline" onPress={() => pick('camera')} /> : null}
      {busy ? <ActivityIndicator color={colors.primary} /> : null}
    </View>
  );
}

/**
 * Gallery of payment screenshots / receipts for an expense or payment, with upload and a full-screen
 * viewer. `uploadTarget` lets a payment's uploads go to a specific paid cycle.
 */
export function AttachmentsSection({ target, canAdd, uploadTarget, refreshKey }: { target: AttachmentTarget; canAdd: boolean; uploadTarget?: AttachmentTarget; refreshKey?: unknown }) {
  const { call } = useSession();
  const { t } = usePreferences();
  const format = useFormat();
  const [items, setItems] = useState<AttachmentMeta[] | null>(null);
  const [open, setOpen] = useState<AttachmentMeta | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const key = JSON.stringify(target);

  const load = useCallback(async () => {
    try {
      setItems(await call((s, r) => getAttachments(s, JSON.parse(key) as AttachmentTarget, r)));
    } catch {
      setItems([]);
    }
  }, [call, key]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load, refreshKey]);

  const s = useStyles((c, d) => ({
    row: { flexDirection: d.row, flexWrap: 'wrap' as const, gap: 10 },
    hint: { color: c.muted, fontSize: 13, lineHeight: 19, textAlign: d.start },
    label: { color: c.muted, fontSize: 10, textAlign: 'center' as const, marginTop: 3, width: 96 },
    error: { color: c.danger, fontSize: 12, textAlign: d.start },
  }));

  return (
    <View style={{ gap: 12 }}>
      {items === null ? <ActivityIndicator /> : items.length ? (
        <View style={s.row}>
          {items.map((item) => (
            <View key={item.id}>
              <Thumb item={item} onPress={() => setOpen(item)} />
              {/* When the screenshot was added (for a payment receipt: when it was paid). */}
              <Text style={s.label} numberOfLines={1}>{format.dateTime(item.createdAt, '')}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={s.hint}>{t('noAttachments')}</Text>
      )}
      {canAdd ? (
        <ImageSourceButtons
          busy={busy}
          onError={setError}
          onPicked={(image) => {
            setBusy(true);
            setError('');
            void call((sess, r) => uploadPrepared(sess, r, uploadTarget ?? target, image))
              .then(load)
              .catch((err: unknown) => setError(err instanceof Error ? err.message : t('saveError')))
              .finally(() => setBusy(false));
          }}
        />
      ) : null}
      {error ? <Text style={s.error}>{error}</Text> : null}
      <Viewer
        item={open}
        onClose={() => setOpen(null)}
        onDelete={async (item) => {
          await call((sess, r) => deleteAttachment(sess, item.id, r));
          imageCache.delete(item.id);
          setOpen(null);
          await load();
        }}
      />
    </View>
  );
}

/** Images chosen on a create form before the item exists; uploaded right after saving. */
export function PendingImages({ images, onChange }: { images: PreparedImage[]; onChange: (images: PreparedImage[]) => void }) {
  const { t, colors } = usePreferences();
  const format = useFormat();
  const [error, setError] = useState('');
  const s = useStyles((c, d) => ({
    row: { flexDirection: d.row, flexWrap: 'wrap' as const, gap: 10 },
    thumb: { width: 72, height: 96, borderRadius: 10, overflow: 'hidden' as const, backgroundColor: c.surfaceMuted },
    remove: { position: 'absolute' as const, top: 4, right: 4, width: 24, height: 24, borderRadius: 12, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: 'rgba(0,0,0,0.6)' },
    hint: { color: c.muted, fontSize: 12, textAlign: d.start },
    error: { color: c.danger, fontSize: 12, textAlign: d.start },
  }));
  return (
    <View style={{ gap: 10 }}>
      {images.length ? (
        <>
          <View style={s.row}>
            {images.map((image, index) => (
              <View key={image.uri} style={s.thumb}>
                <Image source={{ uri: `data:image/jpeg;base64,${image.base64}` }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                <Pressable onPress={() => onChange(images.filter((_, i) => i !== index))} style={s.remove} accessibilityLabel={t('deleteImage')}>
                  <Ionicons name="close" size={14} color="#fff" />
                </Pressable>
              </View>
            ))}
          </View>
          <Text style={s.hint}>{t('pendingImages', { count: format.number(images.length) })}</Text>
        </>
      ) : null}
      <ImageSourceButtons onError={setError} onPicked={(image) => onChange([...images, image])} />
      {error ? <Text style={[s.error, { color: colors.danger }]}>{error}</Text> : null}
    </View>
  );
}
