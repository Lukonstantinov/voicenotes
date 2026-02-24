import React, { useState, useCallback, useEffect } from 'react';
import {
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { Session, SessionSummary } from '../../utils/sessionTypes';
import { listSessions, loadSession, deleteSession } from '../../utils/sessionStorage';
import { useTheme } from '../theme/ThemeContext';

interface Props {
  onSelect: (session: Session) => void;
  onBack: () => void;
}

export function SessionListScreen({ onSelect, onBack }: Props) {
  const { colors } = useTheme();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const list = await listSessions();
    setSessions(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleSelect = useCallback(async (id: string) => {
    const session = await loadSession(id);
    if (session) onSelect(session);
  }, [onSelect]);

  const handleDelete = useCallback((id: string, name: string) => {
    Alert.alert('Delete Session', `Delete "${name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteSession(id);
          refresh();
        },
      },
    ]);
  }, [refresh]);

  const renderItem = useCallback(({ item }: { item: SessionSummary }) => (
    <TouchableOpacity
      style={[styles.item, { borderBottomColor: colors.border }]}
      onPress={() => handleSelect(item.id)}
      onLongPress={() => handleDelete(item.id, item.name)}
    >
      <View style={styles.itemMain}>
        <Text style={[styles.itemName, { color: colors.text }]} numberOfLines={1}>{item.name}</Text>
        <Text style={[styles.itemMeta, { color: colors.textMuted }]}>
          {item.noteCount} notes | {formatDuration(item.durationMs)}
        </Text>
      </View>
      <Text style={[styles.itemDate, { color: colors.textPlaceholder }]}>{formatDate(item.createdAt)}</Text>
    </TouchableOpacity>
  ), [handleSelect, handleDelete, colors]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={[styles.backText, { color: colors.accent }]}>Back</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Session History</Text>
        <View style={{ width: 50 }} />
      </View>

      {sessions.length === 0 && !loading ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: colors.textMuted }]}>No sessions yet.</Text>
          <Text style={[styles.emptyHint, { color: colors.textPlaceholder }]}>Record a session from the Tuner tab.</Text>
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
        />
      )}
    </View>
  );
}

function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const s = sec % 60;
  return `${min}:${s.toString().padStart(2, '0')}`;
}

function formatDate(epoch: number): string {
  const d = new Date(epoch);
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${month}/${day}`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  backText: {
    fontSize: 15,
    fontWeight: '500',
    width: 50,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
  },
  list: {
    paddingHorizontal: 16,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  itemMain: {
    flex: 1,
  },
  itemName: {
    fontSize: 15,
    fontWeight: '600',
  },
  itemMeta: {
    fontSize: 12,
    marginTop: 2,
  },
  itemDate: {
    fontSize: 12,
    marginLeft: 8,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
  },
  emptyHint: {
    fontSize: 13,
    marginTop: 4,
  },
});
